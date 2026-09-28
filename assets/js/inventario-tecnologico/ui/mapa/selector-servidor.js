// Selector de «Servidor» (de dónde recibe la conexión un equipo de red):
// botón + panel con búsqueda por texto (sin tildes), filtros con casillas y
// cuentas (ubicación, tipo, red, origen), orden (el más cercano primero por
// defecto, se recuerda) y la lista de posibles servidores con su tipo,
// ubicación y distancia.
//
// Como el selector de Tipo del inventario, el <select> original queda oculto
// como fuente de verdad: el formulario lo lee igual (.value) y cada elección
// dispara su evento "change". Las opciones las da obtener() (ver
// nucleo/selector-servidor.js): con refrescar() se vuelven a pedir (p. ej. al
// cambiar la ubicación del equipo, porque cambian las distancias).
//
// Accesibilidad: el botón abre un diálogo no modal (aria-haspopup="dialog");
// la búsqueda es un combobox que maneja la lista con aria-activedescendant
// (flechas, Re Pág / Av Pág, Enter elige); los filtros son <details> con
// casillas; Esc cierra solo el panel (el modal sigue abierto) y devuelve el
// foco al botón; la cantidad de resultados se anuncia con aria-live.
import { esc } from "../../nucleo/helpers.js";
import { fmtDistancia } from "../../nucleo/geo.js";
import { normalizarBusqueda } from "../../nucleo/formulario-activo.js";
import { FACETAS_SERVIDOR, ORDENES_SERVIDOR, ORDEN_SERVIDOR_POR_DEFECTO, esOrdenServidor, facetasServidor, filtrarServidores, ordenarServidores } from "../../nucleo/selector-servidor.js";

const P = "inventario-tecnologico-";
const CLAVE_ORDEN = "inventario-tecnologico-orden-servidor";

const ICONO_EQUIPO = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><rect x="2" y="9" width="12" height="4.5" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 11.3h.01M7.5 11.3h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M11.5 9V5.5M9.6 3.8a2.7 2.7 0 0 1 3.8 0M8.2 2.4a4.7 4.7 0 0 1 6.6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;
const ICONO_ACTIVO = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M2.5 4.8 8 2.2l5.5 2.6v6.4L8 13.8l-5.5-2.6zM2.5 4.8 8 7.4l5.5-2.6M8 7.4v6.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const ICONO_RAIZ = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.9 8h12.2M8 1.8c2.2 2.2 2.2 10.2 0 12.4M8 1.8c-2.2 2.2-2.2 10.2 0 12.4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;

function leerOrden(){
  try{ const v = localStorage.getItem(CLAVE_ORDEN); return esOrdenServidor(v) ? v : ORDEN_SERVIDOR_POR_DEFECTO; } catch(e){ return ORDEN_SERVIDOR_POR_DEFECTO; }
}
function guardarOrden(orden){
  try{ localStorage.setItem(CLAVE_ORDEN, orden); } catch(e){ /* sin almacenamiento: solo no se recuerda */ }
}

// Resalta las palabras buscadas respetando tildes ("cám" en "Cámara").
function resaltar(texto, busqueda){
  const palabras = normalizarBusqueda(busqueda).split(/\s+/).filter(Boolean);
  if(!palabras.length) return esc(texto);
  const chars = [...String(texto)];
  const normal = chars.map(c=>normalizarBusqueda(c) || c.toLowerCase());
  const plano = normal.join("");
  const marcar = new Array(chars.length).fill(false);
  for(const q of palabras){
    let desdePlano = 0;
    while(true){
      const i = plano.indexOf(q, desdePlano);
      if(i < 0) break;
      let pos = 0;
      for(let k = 0; k < chars.length; k++){
        const fin = pos + normal[k].length;
        if(fin > i && pos < i + q.length) marcar[k] = true;
        pos = fin;
      }
      desdePlano = i + q.length;
    }
  }
  let out = "", abierto = false;
  chars.forEach((c, k)=>{
    if(marcar[k] && !abierto){ out += "<mark>"; abierto = true; }
    if(!marcar[k] && abierto){ out += "</mark>"; abierto = false; }
    out += esc(c);
  });
  return out + (abierto ? "</mark>" : "");
}

function metaDe(o){
  const partes = [];
  if(o.origen === "activo" && o.tag) partes.push(`activo ${o.tag}`);
  partes.push(o.tipoEtiqueta || "sin tipo");
  partes.push(o.ubicacionNombre);
  partes.push(o.misma ? "misma ubicación" : fmtDistancia(o.distanciaKm));
  if(o.modelo) partes.push(o.modelo);
  return partes.join(" · ");
}

// obtener() → { opciones }. ninguno = { texto, meta } para ofrecer "sin
// servidor" (null en el respaldo, que exige elegir uno). placeholder = texto
// del botón cuando no hay nada elegido y no hay "ninguno".
export function montarSelectorServidor(select, {
  id, obtener, ninguno = null, placeholder = "— Elige un equipo —",
  etiquetaDialogo = "Elegir el servidor", etiquetaLista = "Posibles servidores",
  textoVacio = "Ningún equipo coincide.", ayudaVacio = "",
} = {}){
  let orden = leerOrden();
  let abierto = false;
  let activo = -1;
  let items = [];        // [{ ninguno: true } | { opcion }] en el orden visible
  let opciones = [];
  let filtros = {};      // faceta → Set de valores marcados (sin clave = todos)
  let facetaAbierta = null;

  const raiz = document.createElement("div");
  raiz.className = `${P}combo ${P}serv`;
  raiz.innerHTML = `
    <button type="button" class="${P}combo-boton ${P}serv-boton" id="${id}-boton" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}-panel"></button>
    <div class="${P}combo-panel ${P}serv-panel" id="${id}-panel" role="dialog" aria-label="${esc(etiquetaDialogo)}" hidden>
      <div class="${P}serv-herramientas">
        <input type="text" class="${P}combo-filtro ${P}serv-filtro" id="${id}-filtro" role="combobox" aria-autocomplete="list" aria-expanded="true"
          aria-controls="${id}-lista" aria-describedby="${id}-cuenta" aria-label="Buscar servidor por nombre, tipo, ubicación, red, modelo o tag"
          placeholder="Buscar nombre, ubicación, tipo, tag…" autocomplete="off" spellcheck="false">
        <label class="${P}serv-orden">
          <span>Ordenar</span>
          <select id="${id}-orden">${ORDENES_SERVIDOR.map(o=>`<option value="${o.id}">${esc(o.etiqueta)}</option>`).join("")}</select>
        </label>
      </div>
      <div class="${P}serv-facetas" role="group" aria-label="Filtros"></div>
      <div class="${P}serv-cuenta" id="${id}-cuenta" aria-live="polite"></div>
      <ul class="${P}combo-lista ${P}serv-lista" id="${id}-lista" role="listbox" aria-label="${esc(etiquetaLista)}"></ul>
      <div class="${P}combo-vacio ${P}serv-vacio" hidden></div>
      <div class="${P}serv-teclas" aria-hidden="true">↑ ↓ para moverte · Enter para elegir · Esc para cerrar</div>
    </div>`;
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.after(raiz);
  const boton = raiz.querySelector(`.${P}serv-boton`);
  const panel = raiz.querySelector(`.${P}serv-panel`);
  const filtro = raiz.querySelector(`.${P}serv-filtro`);
  const selOrden = raiz.querySelector(`#${id}-orden`);
  const cajaFacetas = raiz.querySelector(`.${P}serv-facetas`);
  const cuenta = raiz.querySelector(`.${P}serv-cuenta`);
  const lista = raiz.querySelector(`.${P}serv-lista`);
  const vacio = raiz.querySelector(`.${P}serv-vacio`);
  selOrden.value = orden;

  const opcionPorClave = clave=>opciones.find(o=>o.clave === clave) || null;

  // El <select> oculto tiene siempre TODAS las opciones (el formulario y las
  // pruebas leen sus valores), con la elegida marcada.
  function sincronizarSelect(){
    const valor = select.value;
    const vacioTexto = ninguno ? ninguno.texto : placeholder;
    select.innerHTML = `<option value="">${esc(vacioTexto)}</option>` + opciones.map(o=>`<option value="${esc(o.clave)}">${esc(o.nombre)}</option>`).join("");
    select.value = opcionPorClave(valor) ? valor : "";
  }

  function pintarBoton(){
    const o = opcionPorClave(select.value);
    if(o){
      boton.innerHTML = `<span class="${P}combo-icono ${P}serv-icono-${o.origen}">${o.origen === "activo" ? ICONO_ACTIVO : ICONO_EQUIPO}</span>`
        + `<span class="${P}serv-boton-texto"><span class="${P}serv-boton-nombre">${esc(o.nombre)}</span><span class="${P}serv-boton-meta">${esc(metaDe(o))}${o.origen === "activo" ? " · se registra al guardar" : ""}</span></span>`
        + `<span class="${P}combo-flecha" aria-hidden="true"></span>`;
    }else if(ninguno){
      boton.innerHTML = `<span class="${P}combo-icono ${P}serv-icono-raiz">${ICONO_RAIZ}</span>`
        + `<span class="${P}serv-boton-texto"><span class="${P}serv-boton-nombre">${esc(ninguno.texto)}</span>${ninguno.meta ? `<span class="${P}serv-boton-meta">${esc(ninguno.meta)}</span>` : ""}</span>`
        + `<span class="${P}combo-flecha" aria-hidden="true"></span>`;
    }else{
      boton.innerHTML = `<span class="${P}combo-texto ${P}combo-placeholder">${esc(placeholder)}</span><span class="${P}combo-flecha" aria-hidden="true"></span>`;
    }
  }

  // --- filtros (facetas) ----------------------------------------------------
  const hayFiltros = ()=>Object.values(filtros).some(Boolean);
  function estadoFaceta(f, valores){
    const sel = filtros[f];
    if(!sel) return "todas";
    if(!sel.size) return "ninguna";
    return `${sel.size} de ${valores.length}`;
  }
  // Se arma al abrir (los valores no cambian mientras el panel está abierto);
  // después solo se ponen al día cuentas, casillas y resúmenes, así no se
  // pierde el foco de la casilla que se acaba de tocar.
  function armarFacetas(){
    const f = facetasServidor(opciones, { texto: filtro.value, filtros });
    const etiquetas = Object.fromEntries(FACETAS_SERVIDOR.map(x=>[x.id, x.etiqueta]));
    cajaFacetas.innerHTML = Object.entries(f).map(([faceta, valores])=>`
      <details class="${P}serv-faceta" data-faceta="${faceta}"${facetaAbierta === faceta ? " open" : ""}>
        <summary><span class="${P}serv-faceta-nombre">${esc(etiquetas[faceta])}</span> <span class="${P}serv-faceta-estado" data-estado="${faceta}">${esc(estadoFaceta(faceta, valores))}</span></summary>
        <div class="${P}serv-faceta-cuerpo">
          <div class="${P}filter-panel-actions">
            <button type="button" class="${P}btn ${P}btn-sm" data-faceta-todos="${faceta}">Todos</button>
            <button type="button" class="${P}btn ${P}btn-sm" data-faceta-ninguno="${faceta}">Ninguno</button>
          </div>
          <div class="${P}filter-panel-list" role="group" aria-label="${esc(etiquetas[faceta])}">
            ${valores.map(v=>`<label class="${P}filter-opt${v.misma ? ` ${P}serv-faceta-misma` : ""}" data-faceta-opt="${faceta}" data-valor="${esc(v.valor)}">
              <input type="checkbox" data-faceta-casilla="${faceta}" value="${esc(v.valor)}" ${!filtros[faceta] || filtros[faceta].has(v.valor) ? "checked" : ""}>
              <span class="${P}filter-opt-label">${esc(v.etiqueta)}${v.misma ? ` <span class="${P}mapa-muted">(esta)</span>` : ""}</span>
              <span class="${P}filter-opt-count" data-cuenta="${esc(v.valor)}">${v.n}</span>
            </label>`).join("")}
          </div>
          <div class="${P}filter-panel-hint">Doble clic en una opción para dejar solo esa.</div>
        </div>
      </details>`).join("")
      + `<button type="button" class="${P}btn ${P}btn-sm ${P}serv-limpiar" data-faceta-limpiar hidden>Quitar filtros</button>`;
    cajaFacetas.hidden = !Object.keys(f).length;
    ponerAlDiaFacetas(f);
  }
  function ponerAlDiaFacetas(f = facetasServidor(opciones, { texto: filtro.value, filtros })){
    for(const [faceta, valores] of Object.entries(f)){
      const d = cajaFacetas.querySelector(`[data-faceta="${faceta}"]`);
      if(!d) continue;
      d.querySelector(`[data-estado="${faceta}"]`).textContent = estadoFaceta(faceta, valores);
      d.classList.toggle(`${P}serv-faceta-activa`, !!filtros[faceta]);
      for(const v of valores){
        const c = d.querySelector(`[data-cuenta="${CSS.escape(v.valor)}"]`);
        if(c) c.textContent = v.n;
        const casilla = d.querySelector(`input[value="${CSS.escape(v.valor)}"]`);
        if(casilla) casilla.checked = !filtros[faceta] || filtros[faceta].has(v.valor);
      }
    }
    const limpiar = cajaFacetas.querySelector("[data-faceta-limpiar]");
    if(limpiar) limpiar.hidden = !hayFiltros();
  }
  function valoresDe(faceta){ return [...cajaFacetas.querySelectorAll(`input[data-faceta-casilla="${faceta}"]`)].map(c=>c.value); }
  function marcar(faceta, valores){
    const todos = valoresDe(faceta);
    filtros[faceta] = valores.length === todos.length ? null : new Set(valores);
    ponerAlDiaFacetas();
    pintarLista();
  }

  // --- lista ------------------------------------------------------------------
  function pintarLista({ mantenerActivo = false } = {}){
    const texto = filtro.value;
    const visibles = ordenarServidores(filtrarServidores(opciones, { texto, filtros }), orden);
    const equipos = visibles.filter(o=>o.origen === "equipo");
    const activos = visibles.filter(o=>o.origen === "activo");
    // «Ninguno» (sin servidor) no es un equipo: con búsqueda o filtros no se muestra.
    const conNinguno = !!ninguno && !normalizarBusqueda(texto) && !hayFiltros();
    items = [...(conNinguno ? [{ ninguno: true }] : []), ...equipos.map(o=>({ opcion: o })), ...activos.map(o=>({ opcion: o }))];
    if(!mantenerActivo){
      const elegido = items.findIndex(it=>(it.ninguno ? "" : it.opcion.clave) === select.value);
      activo = normalizarBusqueda(texto) || hayFiltros() ? (items.length ? 0 : -1) : (elegido >= 0 ? elegido : (items.length ? 0 : -1));
    }
    if(activo >= items.length) activo = items.length - 1;
    const encabezados = equipos.length && activos.length;
    let html = "";
    items.forEach((it, i)=>{
      if(encabezados && it.opcion && it.opcion === equipos[0]) html += `<li role="presentation" class="${P}serv-grupo">Equipos de red</li>`;
      if(it.opcion && it.opcion === activos[0]) html += `<li role="presentation" class="${P}serv-grupo">Activos del inventario que todavía no son equipos de red <span class="${P}mapa-muted">— se registran al guardar</span></li>`;
      const clave = it.ninguno ? "" : it.opcion.clave;
      const elegido = clave === select.value;
      const clases = `${P}combo-opcion ${P}serv-op${i === activo ? ` ${P}combo-opcion-activa` : ""}${it.ninguno ? ` ${P}serv-op-ninguno` : ""}${it.opcion && it.opcion.origen === "activo" ? ` ${P}serv-op-activo` : ""}`;
      if(it.ninguno){
        html += `<li role="option" id="${id}-op-${i}" class="${clases}" data-indice="${i}" data-clave="" aria-selected="${elegido}">`
          + `<span class="${P}serv-op-icono ${P}serv-icono-raiz">${ICONO_RAIZ}</span>`
          + `<span class="${P}serv-op-texto"><span class="${P}serv-op-nombre">${esc(ninguno.texto)}</span>${ninguno.meta ? `<span class="${P}serv-op-meta">${esc(ninguno.meta)}</span>` : ""}</span>`
          + (elegido ? `<span class="${P}combo-check" aria-hidden="true">✓</span>` : "") + `</li>`;
        return;
      }
      const o = it.opcion;
      const marcas = [
        o.misma ? `<span class="${P}serv-marca ${P}serv-marca-misma">misma ubicación</span>` : "",
        o.origen === "activo" ? `<span class="${P}serv-marca ${P}serv-marca-nuevo">se registra al guardar</span>` : "",
        o.redNombre ? `<span class="${P}mapa-red-chip${o.redHeredada ? ` ${P}mapa-red-chip-heredada` : ""}" style="--red-color:${esc(o.redColor || "#57697C")}"${o.redHeredada ? ` title="Red ${esc(o.redNombre)}, heredada de su servidor"` : ""}>${esc(o.redNombre)}</span>` : "",
      ].join("");
      html += `<li role="option" id="${id}-op-${i}" class="${clases}" data-indice="${i}" data-clave="${esc(o.clave)}" aria-selected="${elegido}" title="${esc(`${o.nombre} — ${metaDe(o)}`)}">`
        + `<span class="${P}serv-op-icono ${P}serv-icono-${o.origen}">${o.origen === "activo" ? ICONO_ACTIVO : ICONO_EQUIPO}</span>`
        + `<span class="${P}serv-op-texto"><span class="${P}serv-op-nombre">${resaltar(o.nombre, texto)}</span><span class="${P}serv-op-meta">${resaltar(metaDe(o), texto)}</span></span>`
        + (marcas ? `<span class="${P}serv-op-marcas">${marcas}</span>` : "")
        + (elegido ? `<span class="${P}combo-check" aria-hidden="true">✓</span>` : "") + `</li>`;
    });
    lista.innerHTML = html;
    const n = equipos.length + activos.length;
    cuenta.textContent = `${n} de ${opciones.length} ${opciones.length === 1 ? "posible servidor" : "posibles servidores"}${hayFiltros() ? " · con filtros" : ""}`;
    vacio.hidden = n > 0 || conNinguno;
    if(!vacio.hidden) vacio.innerHTML = `${esc(textoVacio)}${ayudaVacio ? `<div class="${P}serv-vacio-ayuda">${esc(ayudaVacio)}</div>` : ""}`;
    filtro.setAttribute("aria-activedescendant", activo >= 0 ? `${id}-op-${activo}` : "");
    asegurarVisible(activo >= 0 ? lista.querySelector(`#${CSS.escape(`${id}-op-${activo}`)}`) : null);
  }
  function asegurarVisible(el){
    if(!el) return;
    const arriba = el.offsetTop, abajo = arriba + el.offsetHeight;
    if(arriba < lista.scrollTop) lista.scrollTop = arriba;
    else if(abajo > lista.scrollTop + lista.clientHeight) lista.scrollTop = abajo - lista.clientHeight;
  }
  function moverActivo(delta){
    if(!items.length) return;
    activo = Math.max(0, Math.min(items.length - 1, (activo < 0 ? 0 : activo + delta)));
    pintarLista({ mantenerActivo: true });
  }

  // --- abrir / cerrar / elegir ----------------------------------------------
  function alClicFuera(e){ if(!raiz.contains(e.target)) cerrar(); }
  // Esc cierra lo de más adentro: primero un filtro desplegado (el foco vuelve
  // a su botón) y, si no hay ninguno, el panel (el modal sigue abierto). Se
  // escucha en captura sobre document para que funcione aunque el foco haya
  // quedado fuera del panel (p. ej. en el fondo, tras un doble clic en un
  // filtro) y para que no llegue al Esc del modal.
  function alTeclaGlobal(e){
    if(e.key !== "Escape" || !abierto) return;
    e.preventDefault(); e.stopPropagation();
    const abiertaAhora = cajaFacetas.querySelector("details[data-faceta][open]");
    if(abiertaAhora){ abiertaAhora.open = false; abiertaAhora.querySelector("summary").focus(); return; }
    cerrar({ devolverFoco: true });
  }
  function abrir(textoInicial = ""){
    if(abierto) return;
    abierto = true;
    opciones = (obtener() || {}).opciones || [];
    sincronizarSelect();
    filtro.value = textoInicial;
    armarFacetas();
    pintarLista();
    panel.hidden = false;
    asegurarVisible(activo >= 0 ? lista.querySelector(`#${CSS.escape(`${id}-op-${activo}`)}`) : null);
    if(panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
    boton.setAttribute("aria-expanded", "true");
    raiz.classList.add(`${P}combo-abierto`);
    document.addEventListener("mousedown", alClicFuera, true);
    document.addEventListener("keydown", alTeclaGlobal, true);
    filtro.focus();
    if(textoInicial) filtro.setSelectionRange(textoInicial.length, textoInicial.length);
  }
  function cerrar({ devolverFoco = false } = {}){
    if(!abierto) return;
    abierto = false;
    panel.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    raiz.classList.remove(`${P}combo-abierto`);
    document.removeEventListener("mousedown", alClicFuera, true);
    document.removeEventListener("keydown", alTeclaGlobal, true);
    if(devolverFoco) boton.focus();
  }
  function elegir(clave){
    const cambio = select.value !== clave;
    select.value = clave;
    pintarBoton();
    cerrar({ devolverFoco: true });
    if(cambio) select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  boton.addEventListener("click", ()=>{ if(abierto) cerrar({ devolverFoco: true }); else abrir(); });
  boton.addEventListener("keydown", e=>{
    if(["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)){ e.preventDefault(); abrir(); return; }
    // Escribir sobre el botón abre la búsqueda con esa letra.
    if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); abrir(e.key); }
  });
  filtro.addEventListener("input", ()=>{ ponerAlDiaFacetas(); pintarLista(); });
  filtro.addEventListener("keydown", e=>{
    if(e.key === "ArrowDown"){ e.preventDefault(); moverActivo(1); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); moverActivo(-1); }
    else if(e.key === "PageDown"){ e.preventDefault(); moverActivo(8); }
    else if(e.key === "PageUp"){ e.preventDefault(); moverActivo(-8); }
    else if(e.key === "Enter"){
      e.preventDefault();
      const it = items[activo];
      if(it) elegir(it.ninguno ? "" : it.opcion.clave);
    }
  });
  // Un filtro desplegado se pliega al hacer clic fuera de él (dentro del panel).
  panel.addEventListener("mousedown", e=>{
    const abiertaAhora = cajaFacetas.querySelector("details[data-faceta][open]");
    if(abiertaAhora && !abiertaAhora.contains(e.target)) abiertaAhora.open = false;
  });
  selOrden.addEventListener("change", ()=>{
    orden = esOrdenServidor(selOrden.value) ? selOrden.value : ORDEN_SERVIDOR_POR_DEFECTO;
    guardarOrden(orden);
    pintarLista();
  });
  cajaFacetas.addEventListener("toggle", e=>{
    const d = e.target.closest?.("details[data-faceta]");
    if(!d) return;
    if(d.open){
      facetaAbierta = d.dataset.faceta;
      cajaFacetas.querySelectorAll("details[data-faceta][open]").forEach(x=>{ if(x !== d) x.open = false; });
    }else if(facetaAbierta === d.dataset.faceta) facetaAbierta = null;
  }, true);
  cajaFacetas.addEventListener("change", e=>{
    const c = e.target.closest("input[data-faceta-casilla]");
    if(!c) return;
    const f = c.dataset.facetaCasilla;
    marcar(f, [...cajaFacetas.querySelectorAll(`input[data-faceta-casilla="${f}"]`)].filter(x=>x.checked).map(x=>x.value));
  });
  cajaFacetas.addEventListener("click", e=>{
    const t = e.target.closest("[data-faceta-todos], [data-faceta-ninguno], [data-faceta-limpiar]");
    if(!t) return;
    if(t.hasAttribute("data-faceta-limpiar")){ filtros = {}; ponerAlDiaFacetas(); pintarLista(); filtro.focus(); return; }
    const f = t.dataset.facetaTodos || t.dataset.facetaNinguno;
    marcar(f, t.dataset.facetaTodos ? valoresDe(f) : []);
  });
  cajaFacetas.addEventListener("dblclick", e=>{
    const op = e.target.closest("[data-faceta-opt]");
    if(!op) return;
    e.preventDefault();
    marcar(op.dataset.facetaOpt, [op.dataset.valor]);
  });
  lista.addEventListener("mousedown", e=>e.preventDefault()); // el foco sigue en la búsqueda
  lista.addEventListener("click", e=>{
    const li = e.target.closest("li[data-indice]");
    if(li) elegir(li.dataset.clave);
  });
  lista.addEventListener("mousemove", e=>{
    const li = e.target.closest("li[data-indice]");
    if(!li) return;
    const i = Number(li.dataset.indice);
    if(i === activo) return;
    lista.querySelector(`.${P}combo-opcion-activa`)?.classList.remove(`${P}combo-opcion-activa`);
    activo = i;
    li.classList.add(`${P}combo-opcion-activa`);
    filtro.setAttribute("aria-activedescendant", `${id}-op-${i}`);
  });
  raiz.addEventListener("focusout", e=>{ if(abierto && e.relatedTarget && !raiz.contains(e.relatedTarget)) cerrar(); });

  function refrescar(){
    opciones = (obtener() || {}).opciones || [];
    sincronizarSelect();
    pintarBoton();
    if(abierto){ armarFacetas(); pintarLista({ mantenerActivo: true }); }
  }
  refrescar();
  return {
    boton,
    refrescar,
    abrir, cerrar,
    // La opción elegida (con tipo, ubicación, distancia, origen…) o null.
    elegida(){ return opcionPorClave(select.value); },
    elegir(clave){ select.value = opcionPorClave(clave) ? clave : ""; pintarBoton(); },
  };
}
