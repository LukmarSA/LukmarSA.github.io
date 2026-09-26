// Capa "Plano" (migración 006) y la herramienta "Ajustar plano".
//
// La imagen del plano va en su propio pane, entre las teselas del satélite y
// las líneas de la red, y se ubica con una matriz CSS calculada desde sus tres
// esquinas (nucleo/plano-mapa.js): así puede quedar con cualquier tamaño y
// giro, cosa que L.imageOverlay no permite.
//
// "Ajustar plano" (solo administrador): se arrastra el plano para moverlo y
// sus esquinas para agrandarlo o achicarlo (la esquina opuesta queda fija y no
// se deforma). También: flechas del teclado (1 m; con Shift, 10 m), giro fino,
// transparencia, volver al calce original, cancelar y guardar. Mientras se
// ajusta, los marcadores y las líneas de la red no reciben clics.
import { esc } from "../../nucleo/helpers.js";
import { ESQUINAS, copiarEsquinas, desplazarEsquinas, distanciaMaxima, escalarDesdeEsquina, esquinasCompletas, girarEsquinas, matrizCss, moverEsquinas, tamanoEnMetros, giroGrados } from "../../nucleo/plano-mapa.js";

const P = "inventario-tecnologico-";
export const PANE_PLANO = "inventarioPlano";
export const PANE_MANIJAS = "inventarioPlanoManijas";
const CLAVE_OPACIDAD = "inventario-tecnologico-mapa-plano-opacidad";
export const OPACIDAD_AJUSTE = 0.6;
export const GIRO_PASO = 0.1;

export function opacidadInicial(){
  try{
    const v = Number(localStorage.getItem(CLAVE_OPACIDAD));
    if(v >= 0.2 && v <= 1) return v;
  }catch(e){ /* almacenamiento bloqueado */ }
  return 1;
}
export function recordarOpacidad(v){
  try{ localStorage.setItem(CLAVE_OPACIDAD, String(v)); }catch(e){ /* sin almacenamiento: no pasa nada */ }
}

// Panes propios: el plano entre las teselas (200) y las líneas (400); las
// manijas del ajuste por encima de los marcadores (600).
export function crearPanesPlano(mapa){
  if(!mapa.getPane(PANE_PLANO)) mapa.createPane(PANE_PLANO).style.zIndex = "250";
  if(!mapa.getPane(PANE_MANIJAS)) mapa.createPane(PANE_MANIJAS).style.zIndex = "650";
}

function claseCapa(L){
  if(L.__inventarioCapaPlano) return L.__inventarioCapaPlano;
  const Capa = L.Layer.extend({
    options: { pane: PANE_PLANO, opacity: 1, attribution: null },
    initialize(url, esquinas, ancho, alto, opciones){
      L.setOptions(this, opciones);
      this._url = url;
      this._esquinas = copiarEsquinas(esquinas);
      this._ancho = ancho;
      this._alto = alto;
    },
    onAdd(){
      if(!this._img) this._crearImagen();
      this.getPane().appendChild(this._img);
      this._reubicar();
    },
    onRemove(){ L.DomUtil.remove(this._img); },
    getEvents(){
      const ev = { zoom: this._reubicar, viewreset: this._reubicar };
      if(this._zoomAnimated) ev.zoomanim = this._animarZoom;
      return ev;
    },
    _crearImagen(){
      const img = this._img = L.DomUtil.create("img", `leaflet-image-layer ${P}mapa-plano`);
      if(this._zoomAnimated) L.DomUtil.addClass(img, "leaflet-zoom-animated");
      img.alt = "";
      img.draggable = false;
      img.decoding = "async";
      img.onselectstart = L.Util.falseFn;
      img.onmousemove = L.Util.falseFn;
      img.onload = ()=>{ this._cargada = true; this.fire("load"); };
      img.onerror = ()=>this.fire("error");
      img.style.opacity = String(this.options.opacity);
      img.style.width = `${this._ancho}px`;
      img.style.height = `${this._alto}px`;
      img.style.transformOrigin = "0 0";
      img.src = this._url;
    },
    _puntos(convertir){ return ESQUINAS.map(k=>convertir(L.latLng(this._esquinas[k][0], this._esquinas[k][1]))); },
    _aplicar([p0, p1, p2]){ this._img.style.transform = `matrix(${matrizCss(p0, p1, p2, this._ancho, this._alto).join(",")})`; },
    // Sin redondear a píxeles enteros (latLngToLayerPoint redondea): el plano
    // queda donde dicen sus esquinas con precisión de fracción de píxel.
    _reubicar(){
      if(!this._map || !this._img) return;
      const origen = this._map.getPixelOrigin();
      this._aplicar(this._puntos(ll=>this._map.project(ll)._subtract(origen)));
    },
    _animarZoom(e){ this._aplicar(this._puntos(ll=>this._map._latLngToNewLayerPoint(ll, e.zoom, e.center))); },
    setEsquinas(esquinas){ this._esquinas = copiarEsquinas(esquinas); this._reubicar(); return this; },
    getEsquinas(){ return copiarEsquinas(this._esquinas); },
    setOpacity(o){ this.options.opacity = o; if(this._img) this._img.style.opacity = String(o); return this; },
    setImagen(url, ancho, alto){
      if(url === this._url && ancho === this._ancho && alto === this._alto) return this;
      this._url = url; this._ancho = ancho; this._alto = alto;
      if(this._img){
        this._img.style.width = `${ancho}px`;
        this._img.style.height = `${alto}px`;
        this._img.src = url;
        this._reubicar();
      }
      return this;
    },
    getElement(){ return this._img || null; },
    estaCargada(){ return !!this._cargada; },
  });
  L.__inventarioCapaPlano = Capa;
  return Capa;
}

export function crearCapaPlano(L, plano, { opacidad = 1 } = {}){
  const Capa = claseCapa(L);
  return new Capa(plano.imagen, plano.esquinas, plano.ancho_px, plano.alto_px, { opacity: opacidad, attribution: esc(plano.fuente || "") });
}

// Control del plano (arriba a la derecha, debajo del selector de capas). Solo
// está puesto mientras la capa base es "Plano".
export function crearControlPlano(L, { opacidad, puedeAjustar, alCambiarOpacidad, alEncuadrar, alAjustar }){
  const Control = L.Control.extend({
    options: { position: "topright" },
    onAdd(){
      const div = L.DomUtil.create("div", `leaflet-bar ${P}mapa-plano-control`);
      div.innerHTML = `
        <div class="${P}mapa-plano-control-fila">
          <span class="${P}mapa-plano-control-titulo">Plano</span>
          <button type="button" class="${P}btn ${P}btn-sm" data-plano="encuadrar" title="Encuadrar todo el plano">Ver plano</button>
        </div>
        <label class="${P}mapa-plano-control-opacidad">Opacidad
          <input type="range" min="20" max="100" step="5" value="${Math.round(opacidad * 100)}" id="${P}mapa-plano-opacidad" aria-label="Opacidad del plano">
        </label>
        ${puedeAjustar ? `<button type="button" class="${P}btn ${P}btn-sm" data-plano="ajustar" id="${P}mapa-plano-ajustar" title="Mover, agrandar o achicar el plano para que calce con el satélite">Ajustar plano</button>` : ""}`;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.querySelector("input").addEventListener("input", e=>alCambiarOpacidad(Number(e.target.value) / 100));
      div.addEventListener("click", e=>{
        const b = e.target.closest("[data-plano]");
        if(!b) return;
        if(b.dataset.plano === "encuadrar") alEncuadrar();
        else if(b.dataset.plano === "ajustar") alAjustar();
      });
      return div;
    },
  });
  return new Control();
}

const ORDEN_CONTORNO = ["no", "ne", "se", "so"];
function contornoLatLngs(esquinas){
  const c = esquinasCompletas(esquinas);
  return ORDEN_CONTORNO.map(k=>c[k]);
}

function textoCambio(esquinas, guardadas){
  const d = distanciaMaxima(esquinas, guardadas);
  if(d < 0.05) return "Sin cambios";
  const t0 = tamanoEnMetros(guardadas).ancho, t1 = tamanoEnMetros(esquinas).ancho;
  const escala = (t1 / t0 - 1) * 100;
  const giro = giroGrados(esquinas) - giroGrados(guardadas);
  const partes = [`se movió hasta ${d < 10 ? d.toFixed(1).replace(".", ",") : Math.round(d)} m`];
  if(Math.abs(escala) >= 0.05) partes.push(`${escala > 0 ? "+" : ""}${escala.toFixed(1).replace(".", ",")} % de tamaño`);
  if(Math.abs(giro) >= 0.05) partes.push(`${giro > 0 ? "+" : ""}${giro.toFixed(1).replace(".", ",")}° de giro`);
  return partes.join(" · ");
}

// Modo "Ajustar plano". Devuelve { terminar(), esquinas() }.
//   alGuardar(esquinas) → Promise; si resuelve, el ajuste termina.
//   alTerminar(guardado) → se llama siempre al salir.
export function iniciarAjustePlano({ L, mapa, capa, contenedor, esquinasGuardadas, esquinasOriginales, alGuardar, alTerminar }){
  let esquinas = capa.getEsquinas();
  let guardando = false;
  let terminado = false;
  const opacidadAntes = capa.options.opacity;
  capa.setOpacity(OPACIDAD_AJUSTE);
  const img = capa.getElement();
  const lienzo = mapa.getContainer();
  L.DomUtil.addClass(lienzo, `${P}mapa-ajustando-plano`);

  const contorno = L.polygon(contornoLatLngs(esquinas), { pane: PANE_MANIJAS, color: "#EC741D", weight: 2, dashArray: "6 5", fill: false, interactive: false }).addTo(mapa);

  const manijas = {};
  const completas = ()=>esquinasCompletas(esquinas);
  function aplicar({ salvo = null } = {}){
    capa.setEsquinas(esquinas);
    contorno.setLatLngs(contornoLatLngs(esquinas));
    const c = completas();
    for(const k of Object.keys(manijas)) if(k !== salvo) manijas[k].setLatLng(c[k]);
    info.textContent = textoCambio(esquinas, esquinasGuardadas);
  }

  // Barra de herramientas (misma estética que el aviso de "Haz clic en el mapa…").
  const barra = document.createElement("div");
  barra.className = `${P}mapa-aviso ${P}mapa-aviso-plano`;
  barra.setAttribute("role", "toolbar");
  barra.setAttribute("aria-label", "Ajustar plano");
  barra.innerHTML = `
    <span class="${P}mapa-aviso-plano-texto">Arrastra el plano para moverlo y sus esquinas para agrandarlo o achicarlo. Flechas: 1 m (Shift: 10 m).</span>
    <span class="${P}mapa-aviso-plano-info" data-ajuste="info" aria-live="polite">Sin cambios</span>
    <span class="${P}mapa-aviso-plano-controles">
      <label class="${P}mapa-aviso-plano-opacidad">Transparencia <input type="range" min="10" max="100" step="5" value="${Math.round(OPACIDAD_AJUSTE * 100)}" data-ajuste="opacidad" aria-label="Opacidad del plano mientras se ajusta"></label>
      <button type="button" class="${P}btn ${P}btn-sm" data-ajuste="girar-izq" title="Girar ${String(GIRO_PASO).replace(".", ",")}° a la izquierda" aria-label="Girar a la izquierda">↺</button>
      <button type="button" class="${P}btn ${P}btn-sm" data-ajuste="girar-der" title="Girar ${String(GIRO_PASO).replace(".", ",")}° a la derecha" aria-label="Girar a la derecha">↻</button>
      <button type="button" class="${P}btn ${P}btn-sm" data-ajuste="original" title="Volver al calce con el que se publicó el plano (no se guarda hasta que presiones Guardar)">Calce original</button>
      <button type="button" class="${P}btn ${P}btn-sm" data-ajuste="cancelar">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" data-ajuste="guardar">Guardar</button>
    </span>`;
  contenedor.appendChild(barra);
  const info = barra.querySelector('[data-ajuste="info"]');
  L.DomEvent.disableClickPropagation(barra);
  L.DomEvent.disableScrollPropagation(barra);

  // Esquinas: la opuesta queda fija.
  for(const k of ["no", "ne", "so", "se"]){
    const icono = L.divIcon({ className: `${P}mapa-plano-esquina ${P}mapa-plano-esquina-${k}`, iconSize: [16, 16], iconAnchor: [8, 8] });
    const m = L.marker(completas()[k], { icon: icono, draggable: true, keyboard: false, pane: PANE_MANIJAS, title: "Arrastra para agrandar o achicar el plano" }).addTo(mapa);
    let inicio = null;
    m.on("dragstart", ()=>{ inicio = copiarEsquinas(esquinas); });
    m.on("drag", e=>{
      if(!inicio) return;
      const ll = e.target.getLatLng();
      esquinas = escalarDesdeEsquina(inicio, k, [ll.lat, ll.lng]);
      aplicar({ salvo: k });
    });
    m.on("dragend", ()=>{ inicio = null; aplicar(); });
    manijas[k] = m;
  }

  // Arrastrar el plano: pointer events (mouse, lápiz y dedo).
  L.DomUtil.addClass(img, "leaflet-interactive");
  L.DomUtil.addClass(img, `${P}mapa-plano-ajustando`);
  let arrastre = null;
  const latLngDe = ev=>mapa.containerPointToLatLng(mapa.mouseEventToContainerPoint(ev));
  const alBajar = ev=>{
    if(ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    arrastre = { id: ev.pointerId, desde: latLngDe(ev), inicio: copiarEsquinas(esquinas) };
    try{ img.setPointerCapture(ev.pointerId); }catch(e){ /* sin captura: igual funciona dentro de la imagen */ }
    if(mapa.dragging) mapa.dragging.disable();
  };
  const alMover = ev=>{
    if(!arrastre || ev.pointerId !== arrastre.id) return;
    ev.preventDefault();
    const ll = latLngDe(ev);
    esquinas = desplazarEsquinas(arrastre.inicio, ll.lat - arrastre.desde.lat, ll.lng - arrastre.desde.lng);
    aplicar();
  };
  const alSoltar = ev=>{
    if(!arrastre || (ev && ev.pointerId !== arrastre.id)) return;
    arrastre = null;
    if(mapa.dragging) mapa.dragging.enable();
  };
  const sinClic = ev=>L.DomEvent.stopPropagation(ev);
  img.addEventListener("pointerdown", alBajar);
  img.addEventListener("pointermove", alMover);
  img.addEventListener("pointerup", alSoltar);
  img.addEventListener("pointercancel", alSoltar);
  img.addEventListener("click", sinClic);
  img.addEventListener("dblclick", sinClic);

  const alTeclear = e=>{
    if(terminado) return;
    const enCampo = e.target && e.target.closest && e.target.closest("input, textarea, select");
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cancelar(); return; }
    if(enCampo || guardando) return;
    const paso = e.shiftKey ? 10 : 1;
    const mov = { ArrowUp: [0, paso], ArrowDown: [0, -paso], ArrowLeft: [-paso, 0], ArrowRight: [paso, 0] }[e.key];
    if(!mov) return;
    e.preventDefault();
    e.stopPropagation();
    esquinas = moverEsquinas(esquinas, mov[0], mov[1]);
    aplicar();
  };
  document.addEventListener("keydown", alTeclear, true);

  barra.addEventListener("input", e=>{
    if(e.target.dataset.ajuste === "opacidad") capa.setOpacity(Number(e.target.value) / 100);
  });
  barra.addEventListener("click", async e=>{
    const b = e.target.closest("[data-ajuste]");
    if(!b || guardando) return;
    const accion = b.dataset.ajuste;
    if(accion === "girar-izq"){ esquinas = girarEsquinas(esquinas, GIRO_PASO); aplicar(); }
    else if(accion === "girar-der"){ esquinas = girarEsquinas(esquinas, -GIRO_PASO); aplicar(); }
    else if(accion === "original"){ esquinas = copiarEsquinas(esquinasOriginales); aplicar(); }
    else if(accion === "cancelar") cancelar();
    else if(accion === "guardar") await guardar(b);
  });

  // alGuardar avisa el error (toast); aquí solo se sigue ajustando.
  async function guardar(boton){
    guardando = true;
    boton.disabled = true;
    try{
      await alGuardar(copiarEsquinas(esquinas));
      terminar(true);
    }catch(err){
      guardando = false;
      if(boton.isConnected) boton.disabled = false;
    }
  }
  function cancelar(){
    esquinas = copiarEsquinas(esquinasGuardadas);
    capa.setEsquinas(esquinas);
    terminar(false);
  }
  function terminar(guardado){
    if(terminado) return;
    terminado = true;
    document.removeEventListener("keydown", alTeclear, true);
    img.removeEventListener("pointerdown", alBajar);
    img.removeEventListener("pointermove", alMover);
    img.removeEventListener("pointerup", alSoltar);
    img.removeEventListener("pointercancel", alSoltar);
    img.removeEventListener("click", sinClic);
    img.removeEventListener("dblclick", sinClic);
    L.DomUtil.removeClass(img, "leaflet-interactive");
    L.DomUtil.removeClass(img, `${P}mapa-plano-ajustando`);
    L.DomUtil.removeClass(lienzo, `${P}mapa-ajustando-plano`);
    if(mapa.dragging) mapa.dragging.enable();
    Object.values(manijas).forEach(m=>m.remove());
    contorno.remove();
    barra.remove();
    capa.setOpacity(opacidadAntes);
    alTerminar(!!guardado);
  }

  aplicar();
  return { terminar: ()=>cancelar(), esquinas: ()=>copiarEsquinas(esquinas) };
}

export function htmlLeyendaPlano(){
  return `
    <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-plano-drenaje"></span>Canal de drenaje</li>
    <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-plano-reservorio"></span>Canal de reservorio</li>
    <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-plano-lluvias"></span>Canal de aguas lluvias</li>
    <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-plano-via"></span>Vía Taura–Jaguito</li>`;
}
