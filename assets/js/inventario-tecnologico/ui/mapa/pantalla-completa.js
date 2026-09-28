// El mapa en pantalla completa (v9, pedido de la persona): la vista del mapa
// cubre toda la ventana y, si el navegador lo permite, toda la pantalla. La
// barra de búsqueda y filtros y el panel de detalle pasan a ser ventanas
// flotantes sobre el mapa que se minimizan a su título (al entrar, las dos
// minimizadas) y se pueden arrastrar por él.
//
// Fuera de la pantalla completa el DOM queda exactamente como siempre: los
// títulos de las ventanas y el contenedor del panel se crean al entrar y se
// quitan al salir (el panel se mueve dentro de su ventana y vuelve a su
// lugar, con sus listeners).
//
// Se pide la pantalla completa del documento entero (no solo del mapa) para
// que los modales, que viven en <body>, se sigan viendo encima. Con Chrome se
// bloquea además la tecla Esc (Keyboard Lock): así Esc sigue cerrando
// ventanitas y selecciones del mapa y, cuando ya no hay nada, sale; mantenerla
// apretada sale siempre (lo avisa el navegador). Sin la API de pantalla
// completa (p. ej. Safari del iPhone) el mapa cubre la ventana del navegador.
import { esc } from "../../nucleo/helpers.js";

const P = "inventario-tecnologico-";

const ICONO_ENTRAR = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M3 8V3h5M12 3h5v5M17 12v5h-5M8 17H3v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONO_SALIR = `<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M8 3v5H3M17 8h-5V3M12 17v-5h5M3 12h5v5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONO_MINIMIZAR = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3 11h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const ICONO_RESTAURAR = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="3" y="3.5" width="10" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3 6.5h10" stroke="currentColor" stroke-width="1.8"/></svg>`;
const ICONO_BUSCAR = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10.5 10.5 14 14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
const ICONO_DETALLE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 6h6M5 8.5h6M5 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;

// Botón de Leaflet (arriba a la izquierda, debajo del zoom).
export function crearControlPantallaCompleta(L, alAlternar){
  const Control = L.Control.extend({
    options: { position: "topleft" },
    onAdd(){
      const div = L.DomUtil.create("div", `leaflet-bar ${P}mapa-completa-control`);
      div.innerHTML = `<button type="button" id="${P}mapa-pantalla-completa" class="${P}mapa-completa-boton" aria-pressed="false" aria-label="Ver el mapa en pantalla completa" title="Pantalla completa">${ICONO_ENTRAR}</button>`;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.querySelector("button").addEventListener("click", e=>{ e.preventDefault(); alAlternar(); });
      return div;
    },
  });
  return new Control();
}

// raiz = .mapa-vista; mapa = el mapa de Leaflet. alCambiar(activa) avisa a la vista.
export function crearPantallaCompleta({ raiz, mapa, alCambiar = ()=>{} }){
  let activa = false;
  let nativa = false;
  let bloqueoEsc = false;
  let ventanas = null; // { barra: {el, cab, boton}, panel: {el, cab, boton, lugar} }
  let arrastre = null;
  let mostradaPorClic = 0; // cuándo un clic en el título mostró una minimizada (el doble clic que sigue no la vuelve a minimizar)

  const boton = ()=>document.getElementById(`${P}mapa-pantalla-completa`);
  const barra = ()=>raiz.querySelector(`.${P}mapa-barra`);
  const panel = ()=>raiz.querySelector(`#${P}mapa-panel`);

  function pintarBoton(){
    const b = boton();
    if(!b) return;
    b.setAttribute("aria-pressed", String(activa));
    b.setAttribute("aria-label", activa ? "Salir de la pantalla completa" : "Ver el mapa en pantalla completa");
    b.title = activa ? "Salir de la pantalla completa (Esc)" : "Pantalla completa";
    b.innerHTML = activa ? ICONO_SALIR : ICONO_ENTRAR;
  }

  function cabecera(cual, titulo, icono, extra = ""){
    const cab = document.createElement("div");
    cab.className = `${P}mapa-ventana-cab`;
    cab.dataset.ventanaCab = cual;
    cab.innerHTML = `<span class="${P}mapa-ventana-icono">${icono}</span>`
      + `<span class="${P}mapa-ventana-titulo" data-ventana-titulo>${esc(titulo)}</span>${extra}`
      + `<button type="button" class="${P}mapa-ventana-btn" data-ventana-alternar="${cual}" aria-expanded="true"></button>`;
    return cab;
  }

  function armarVentanas(){
    const b = barra(), p = panel();
    const cabBarra = cabecera("barra", "Buscar, filtros y capas", ICONO_BUSCAR, `<span class="${P}mapa-chip-n" data-ventana-cuenta></span>`);
    b.prepend(cabBarra);
    const idPuesto = !b.id;
    if(idPuesto) b.id = `${P}mapa-barra`;
    b.classList.add(`${P}mapa-ventana`);
    b.setAttribute("role", "region");
    b.setAttribute("aria-label", "Buscar, filtros y capas");
    const lugar = { padre: p.parentNode, siguiente: p.nextSibling };
    const envoltura = document.createElement("div");
    envoltura.className = `${P}mapa-ventana ${P}mapa-panel-ventana`;
    envoltura.setAttribute("role", "region");
    envoltura.setAttribute("aria-label", "Detalle del mapa");
    const cabPanel = cabecera("panel", tituloDelPanel(), ICONO_DETALLE);
    envoltura.append(cabPanel);
    lugar.padre.insertBefore(envoltura, p);
    envoltura.append(p);
    ventanas = {
      barra: { el: b, cab: cabBarra, boton: cabBarra.querySelector("[data-ventana-alternar]"), idPuesto },
      panel: { el: envoltura, cab: cabPanel, boton: cabPanel.querySelector("[data-ventana-alternar]"), lugar },
    };
    ventanas.barra.boton.setAttribute("aria-controls", b.id);
    ventanas.panel.boton.setAttribute("aria-controls", `${P}mapa-panel`);
    for(const [cual, v] of Object.entries(ventanas)){
      v.cab.addEventListener("pointerdown", empezarArrastre);
      v.cab.addEventListener("dblclick", alDobleClic);
      v.boton.addEventListener("click", alBoton);
      // La ventana que se toca queda encima de la otra.
      v.alFrente = ()=>{ for(const w of Object.values(ventanas)) w.el.classList.toggle(`${P}mapa-ventana-al-frente`, w === ventanas[cual]); };
      v.el.addEventListener("pointerdown", v.alFrente, true);
    }
    pintarCuenta();
  }

  function desarmarVentanas(){
    if(!ventanas) return;
    const { barra: b, panel: p } = ventanas;
    b.cab.remove();
    b.el.removeEventListener("pointerdown", b.alFrente, true);
    b.el.classList.remove(`${P}mapa-ventana`, `${P}ventana-minimizada`, `${P}ventana-aviso`, `${P}ventana-movida`, `${P}mapa-ventana-al-frente`);
    b.el.removeAttribute("role");
    b.el.removeAttribute("aria-label");
    if(b.idPuesto) b.el.removeAttribute("id");
    b.el.style.left = b.el.style.top = b.el.style.right = b.el.style.bottom = "";
    const aside = panel();
    if(aside){
      if(p.lugar.siguiente && p.lugar.siguiente.parentNode === p.lugar.padre) p.lugar.padre.insertBefore(aside, p.lugar.siguiente);
      else p.lugar.padre.append(aside);
    }
    p.el.remove();
    ventanas = null;
  }

  function tituloDelPanel(){
    const t = panel() && panel().querySelector(`.${P}mapa-panel-titulo`);
    const texto = t ? t.textContent.replace(/\s+/g, " ").trim() : "";
    return texto || "Detalle";
  }

  function minimizada(cual){ return !!(ventanas && ventanas[cual].el.classList.contains(`${P}ventana-minimizada`)); }

  function minimizar(cual, si){
    if(!ventanas) return;
    const v = ventanas[cual];
    // Si el foco estaba adentro, queda en el botón (no se pierde en <body>).
    const conFoco = si && v.el.contains(document.activeElement) && !v.cab.contains(document.activeElement);
    v.el.classList.toggle(`${P}ventana-minimizada`, si);
    if(conFoco) v.boton.focus();
    if(!si) v.el.classList.remove(`${P}ventana-aviso`);
    const titulo = v.cab.querySelector("[data-ventana-titulo]").textContent;
    v.boton.setAttribute("aria-expanded", String(!si));
    v.boton.setAttribute("aria-label", `${si ? "Mostrar" : "Minimizar"} «${titulo}»`);
    v.boton.title = si ? "Mostrar" : "Minimizar";
    v.boton.innerHTML = si ? ICONO_RESTAURAR : ICONO_MINIMIZAR;
    requestAnimationFrame(acomodar);
  }

  function alBoton(e){
    const cual = e.currentTarget.dataset.ventanaAlternar;
    minimizar(cual, !minimizada(cual));
  }
  function alDobleClic(e){
    if(e.target.closest("[data-ventana-alternar]")) return;
    if(Date.now() - mostradaPorClic < 700) return; // el primer clic ya la mostró
    const cual = e.currentTarget.dataset.ventanaCab;
    minimizar(cual, !minimizada(cual));
  }

  // Arrastrar una ventana por su título (con un umbral, para que un clic no
  // la mueva). Un clic en el título de una ventana minimizada la muestra.
  function empezarArrastre(e){
    if(e.button !== 0 || e.target.closest("[data-ventana-alternar]")) return;
    const cab = e.currentTarget;
    const cual = cab.dataset.ventanaCab;
    const el = ventanas[cual].el;
    const r = el.getBoundingClientRect(), rr = raiz.getBoundingClientRect();
    arrastre = { cual, el, cab, x0: e.clientX, y0: e.clientY, izq: r.left - rr.left, arr: r.top - rr.top, movido: false, id: e.pointerId };
    cab.setPointerCapture(e.pointerId);
    cab.addEventListener("pointermove", moverArrastre);
    cab.addEventListener("pointerup", terminarArrastre);
    cab.addEventListener("pointercancel", terminarArrastre);
  }
  function moverArrastre(e){
    if(!arrastre || e.pointerId !== arrastre.id) return;
    const dx = e.clientX - arrastre.x0, dy = e.clientY - arrastre.y0;
    if(!arrastre.movido && Math.hypot(dx, dy) < 5) return;
    arrastre.movido = true;
    const el = arrastre.el;
    el.classList.add(`${P}ventana-movida`);
    ponerEn(el, arrastre.izq + dx, arrastre.arr + dy);
  }
  function terminarArrastre(e){
    if(!arrastre) return;
    const { cab, cual, movido } = arrastre;
    cab.removeEventListener("pointermove", moverArrastre);
    cab.removeEventListener("pointerup", terminarArrastre);
    cab.removeEventListener("pointercancel", terminarArrastre);
    try{ cab.releasePointerCapture(arrastre.id); }catch(err){ /* ya se soltó */ }
    arrastre = null;
    if(!movido && e.type === "pointerup" && minimizada(cual)){ mostradaPorClic = Date.now(); minimizar(cual, false); }
  }
  // Deja la ventana dentro de la vista (siempre queda a la vista su título).
  function ponerEn(el, izq, arr){
    const rr = raiz.getBoundingClientRect(), r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(izq, rr.width - Math.min(r.width, rr.width)));
    const y = Math.max(0, Math.min(arr, rr.height - 40));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
    el.style.right = "auto";
    el.style.bottom = "auto";
  }

  // El panel va a la derecha, debajo de los controles de Leaflet de esa
  // esquina (capas, plano, piscinas), que cambian de alto.
  function acomodar(){
    if(!activa || !ventanas) return;
    const rr = raiz.getBoundingClientRect();
    const esquina = mapa.getContainer().querySelector(".leaflet-top.leaflet-right");
    let libre = 10;
    if(esquina) for(const c of esquina.children){ const r = c.getBoundingClientRect(); if(r.height) libre = Math.max(libre, r.bottom - rr.top); }
    raiz.style.setProperty("--mapa-derecha-libre", `${Math.round(libre + 8)}px`);
    for(const v of Object.values(ventanas)) if(v.el.classList.contains(`${P}ventana-movida`)){
      const r = v.el.getBoundingClientRect();
      ponerEn(v.el, r.left - rr.left, r.top - rr.top);
    }
  }

  function invalidar(){
    requestAnimationFrame(()=>{ try{ mapa.invalidateSize(); }catch(err){ /* el mapa se desarmó */ } acomodar(); });
    setTimeout(()=>{ try{ mapa.invalidateSize(); }catch(err){ /* idem */ } acomodar(); }, 350);
  }

  function pintarCuenta(){
    if(!ventanas) return;
    const fuente = document.getElementById(`${P}mapa-filtros-cuenta`);
    const destino = ventanas.barra.cab.querySelector("[data-ventana-cuenta]");
    if(destino) destino.textContent = fuente ? fuente.textContent : "";
  }

  const alCambiarNativa = ()=>{ if(activa && nativa && !document.fullscreenElement) salir({ desdeNavegador: true }); };
  const alRedimensionar = ()=>{ if(activa) acomodar(); };

  async function entrar(){
    if(activa) return;
    activa = true;
    raiz.classList.add(`${P}mapa-completa`);
    document.body.classList.add(`${P}con-mapa-completo`);
    armarVentanas();
    minimizar("barra", true);
    minimizar("panel", true);
    pintarBoton();
    window.addEventListener("resize", alRedimensionar);
    document.addEventListener("fullscreenchange", alCambiarNativa);
    invalidar();
    alCambiar(true);
    const doc = document.documentElement;
    if(doc.requestFullscreen && !document.fullscreenElement){
      try{
        await doc.requestFullscreen({ navigationUI: "hide" });
        if(!activa){ if(document.fullscreenElement) document.exitFullscreen().catch(()=>{}); return; }
        nativa = true;
        if(navigator.keyboard && navigator.keyboard.lock){
          try{ await navigator.keyboard.lock(["Escape"]); bloqueoEsc = true; }catch(err){ bloqueoEsc = false; }
        }
        invalidar();
      }catch(err){
        // Sin permiso, o no se puede (un iframe, el iPhone): el mapa cubre la ventana del navegador.
        nativa = false;
      }
    }
  }

  function salir({ desdeNavegador = false } = {}){
    if(!activa) return;
    activa = false;
    window.removeEventListener("resize", alRedimensionar);
    document.removeEventListener("fullscreenchange", alCambiarNativa);
    if(bloqueoEsc && navigator.keyboard && navigator.keyboard.unlock){ try{ navigator.keyboard.unlock(); }catch(err){ /* ya estaba libre */ } }
    bloqueoEsc = false;
    if(nativa && !desdeNavegador && document.fullscreenElement) document.exitFullscreen().catch(()=>{});
    nativa = false;
    desarmarVentanas();
    raiz.classList.remove(`${P}mapa-completa`);
    raiz.style.removeProperty("--mapa-derecha-libre");
    document.body.classList.remove(`${P}con-mapa-completo`);
    pintarBoton();
    invalidar();
    alCambiar(false);
  }

  return {
    activa: ()=>activa,
    entrar,
    salir,
    alternar(){ if(activa) salir(); else entrar(); },
    minimizada,
    minimizar,
    // La vista repintó el panel: su título pasa a la ventana. Si está
    // minimizada y cambió lo que muestra, el título se ilumina un momento.
    panelCambio(){
      if(!activa || !ventanas) return;
      const t = ventanas.panel.cab.querySelector("[data-ventana-titulo]");
      const nuevo = tituloDelPanel();
      if(t.textContent === nuevo) return;
      t.textContent = nuevo;
      minimizar("panel", minimizada("panel"));
      if(minimizada("panel")){
        const el = ventanas.panel.el;
        el.classList.remove(`${P}ventana-aviso`);
        void el.offsetWidth;
        el.classList.add(`${P}ventana-aviso`);
      }
    },
    filtrosCambio: pintarCuenta,
    controlesCambio(){ if(activa) requestAnimationFrame(acomodar); },
    destruir(){ salir(); },
  };
}
