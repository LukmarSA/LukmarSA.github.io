// Capa "Piscinas" (migración 009) y su editor de vértices.
//
// Cada piscina es un polígono en su propio pane, entre el plano (250) y las
// líneas de la red (400): las líneas y los marcadores siguen recibiendo clics.
// Clic en una piscina → ventanita con el nombre, las hectáreas del plano y el
// área del dibujo. De cerca (zoom ≥ ZOOM_ROTULOS) se ve el nombre encima.
//
// Editor de vértices (solo administrador): arrastrar un punto lo mueve;
// arrastrar el punto del medio de un lado agrega otro; doble clic o clic
// derecho en un punto lo quita (mínimo 3). Con el teclado: Tab hasta un punto,
// flechas para moverlo (1 m; con Shift, 5 m), Supr para quitarlo. Deshacer,
// Cancelar (Esc) y Guardar. Mientras se edita, el resto del mapa no recibe clics.
import { esc } from "../../nucleo/helpers.js";
import { areaHectareas, centroide, desplazarMetros, diferenciaArea, fmtHectareas, insertarVertice, moverVertice, puntoMedio, quitarVertice } from "../../nucleo/piscinas.js";

const P = "inventario-tecnologico-";
export const PANE_PISCINAS = "inventarioPiscinas";
export const PANE_MANIJAS_PISCINA = "inventarioPiscinaManijas";
export const ZOOM_ROTULOS = 16;

const ESTILO = { color: "#0E6E78", weight: 1.4, opacity: 0.9, fillColor: "#48B7C4", fillOpacity: 0.16 };
const ESTILO_REVISAR = { color: "#C9651B", dashArray: "5 4" };
const ESTILO_SELECCION = { color: "#EC741D", weight: 3, fillOpacity: 0.3 };
const ESTILO_EDICION = { color: "#EC741D", weight: 2.5, opacity: 1, dashArray: "6 4", fillColor: "#EC741D", fillOpacity: 0.14, interactive: false };

export function crearPanesPiscinas(mapa){
  if(!mapa.getPane(PANE_PISCINAS)) mapa.createPane(PANE_PISCINAS).style.zIndex = "380";
  if(!mapa.getPane(PANE_MANIJAS_PISCINA)) mapa.createPane(PANE_MANIJAS_PISCINA).style.zIndex = "660";
}

// Dibuja las piscinas en `capa` (L.layerGroup). ocultar = id que no se dibuja
// (la que se está editando). Devuelve Map id → polígono.
export function pintarPiscinas({ L, capa, piscinas, seleccionada = null, soloRevisar = false, ocultar = null, alClic = null }){
  capa.clearLayers();
  const porId = new Map();
  for(const p of piscinas){
    if(p.activa === false || p.id === ocultar) continue;
    if(soloRevisar && !p.revisar) continue;
    const poli = L.polygon(p.puntos, {
      ...ESTILO, ...(p.revisar ? ESTILO_REVISAR : {}), ...(p.id === seleccionada ? ESTILO_SELECCION : {}),
      pane: PANE_PISCINAS, bubblingMouseEvents: false,
      className: `${P}mapa-piscina${p.revisar ? ` ${P}mapa-piscina-revisar` : ""}`,
    });
    poli.bindTooltip(esc(`${p.nombre}${p.hectareas ? ` · ${fmtHectareas(p.hectareas)}` : ""}`), { sticky: true, className: `${P}mapa-tooltip` });
    if(alClic) poli.on("click", e=>alClic(p.id, e.latlng));
    poli.on("add", ()=>{ const el = poli.getElement(); if(el){ el.dataset.piscinaId = p.id; el.setAttribute("aria-label", `Piscina ${p.nombre}`); } });
    poli.addTo(capa);
    const c = centroide(p.puntos);
    if(c) L.marker(c, {
      pane: PANE_PISCINAS, interactive: false, keyboard: false,
      icon: L.divIcon({ className: `${P}mapa-piscina-rotulo`, html: `<span>${esc(p.nombre)}</span>`, iconSize: null }),
    }).addTo(capa);
    porId.set(p.id, poli);
  }
  return porId;
}

export function htmlPopupPiscina(p, { esAdmin = false } = {}){
  const dif = diferenciaArea(p.hectareas, p.puntos);
  const fuente = { vector: "trazos del plano", imagen: "imagen del plano", aproximada: "aproximado", manual: "dibujado a mano" }[p.fuente] || "";
  return `<div class="${P}mapa-piscina-popup" data-piscina-id="${p.id}">
    <div class="${P}mapa-piscina-popup-titulo">${esc(p.nombre)}${p.sector ? ` <span class="${P}mapa-muted">· sector ${esc(p.sector)}</span>` : ""}</div>
    <dl class="${P}mapa-piscina-datos">
      <div><dt>Hectáreas (plano)</dt><dd>${fmtHectareas(p.hectareas)}</dd></div>
      <div><dt>Área del dibujo</dt><dd>${fmtHectareas(areaHectareas(p.puntos))}</dd></div>
    </dl>
    ${dif !== null ? `<div class="${P}mapa-muted ${P}mapa-piscina-fuente">El dibujo mide ${dif >= 0 ? "+" : "−"}${Math.abs(dif).toFixed(1).replace(".", ",")} % de lo rotulado.</div>` : ""}
    ${fuente ? `<div class="${P}mapa-muted ${P}mapa-piscina-fuente">Dibujo: ${fuente}.</div>` : ""}
    ${p.revisar ? `<div class="${P}mapa-piscina-aviso">Por revisar${p.hectareas ? "" : ": sin hectáreas en el plano"}</div>` : ""}
    ${p.notas ? `<div class="${P}mapa-panel-notas">${esc(p.notas)}</div>` : ""}
    ${esAdmin ? `<div class="${P}mapa-acciones">
      <button type="button" class="${P}btn ${P}btn-sm" data-piscina-accion="forma" data-id="${p.id}">Editar forma</button>
      <button type="button" class="${P}btn ${P}btn-sm" data-piscina-accion="datos" data-id="${p.id}">Editar datos</button>
    </div>` : ""}
  </div>`;
}

// Control de la capa (arriba a la derecha): cuántas hay, encuadrarlas, ver
// solo las que hay que revisar y, para el administrador, crear una.
export function crearControlPiscinas(L, { puedeEditar, alEncuadrar, alSoloRevisar, alNueva }){
  const Control = L.Control.extend({
    options: { position: "topright" },
    onAdd(){
      const div = L.DomUtil.create("div", `leaflet-bar ${P}mapa-piscinas-control`);
      div.innerHTML = `
        <div class="${P}mapa-plano-control-fila">
          <span class="${P}mapa-plano-control-titulo">Piscinas <span class="${P}mapa-muted" data-piscinas="cuenta"></span></span>
          <button type="button" class="${P}btn ${P}btn-sm" data-piscinas="encuadrar" title="Encuadrar todas las piscinas">Ver todas</button>
        </div>
        <label class="${P}mapa-check" data-piscinas="fila-revisar"><input type="checkbox" data-piscinas="revisar"> Solo por revisar <span class="${P}mapa-muted" data-piscinas="n-revisar"></span></label>
        ${puedeEditar ? `<button type="button" class="${P}btn ${P}btn-sm" data-piscinas="nueva" id="${P}mapa-piscina-nueva" title="Crear una piscina en el centro del mapa y dibujarla">+ Nueva piscina</button>` : ""}`;
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      div.querySelector('[data-piscinas="revisar"]').addEventListener("change", e=>alSoloRevisar(e.target.checked));
      div.addEventListener("click", e=>{
        const b = e.target.closest("button[data-piscinas]");
        if(!b) return;
        if(b.dataset.piscinas === "encuadrar") alEncuadrar();
        else if(b.dataset.piscinas === "nueva") alNueva();
      });
      this._div = div;
      return div;
    },
    actualizar({ total = 0, revisar = 0, soloRevisar = false } = {}){
      if(!this._div) return;
      this._div.querySelector('[data-piscinas="cuenta"]').textContent = `(${total})`;
      this._div.querySelector('[data-piscinas="n-revisar"]').textContent = `(${revisar})`;
      this._div.querySelector('[data-piscinas="revisar"]').checked = soloRevisar;
      this._div.querySelector('[data-piscinas="fila-revisar"]').hidden = !revisar && !soloRevisar;
    },
  });
  return new Control();
}

// Editor de vértices. Devuelve { terminar() }.
//   alGuardar(puntos) → Promise; si resuelve, termina la edición.
//   alTerminar(guardado) → se llama siempre al salir.
export function iniciarEdicionPiscina({ L, mapa, piscina, contenedor, alGuardar, alTerminar }){
  let puntos = piscina.puntos.map(p=>[...p]);
  const pila = [];
  let terminado = false, guardando = false;
  const capa = L.layerGroup().addTo(mapa);
  const poli = L.polygon(puntos, { ...ESTILO_EDICION, pane: PANE_PISCINAS }).addTo(capa);
  const vertices = [], medios = [];
  const lienzo = mapa.getContainer();
  lienzo.classList.add(`${P}mapa-editando-piscina`);
  mapa.doubleClickZoom.disable();

  const barra = document.createElement("div");
  barra.className = `${P}mapa-aviso ${P}mapa-aviso-plano ${P}mapa-aviso-piscina`;
  barra.setAttribute("role", "region");
  barra.setAttribute("aria-label", "Editar la forma de la piscina");
  barra.innerHTML = `
    <span class="${P}mapa-aviso-plano-texto"><strong>Forma de «${esc(piscina.nombre)}»</strong> · <span data-ed="info"></span></span>
    <span class="${P}mapa-aviso-plano-controles">
      <button type="button" class="${P}btn ${P}btn-sm" data-ed="deshacer" disabled>Deshacer</button>
      <button type="button" class="${P}btn ${P}btn-sm" data-ed="cancelar">Cancelar (Esc)</button>
      <button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" data-ed="guardar">Guardar</button>
    </span>
    <span class="${P}mapa-aviso-plano-info">Arrastra un punto para moverlo; arrastra el punto del medio de un lado para agregar otro; doble clic o clic derecho en un punto lo quita. Con el teclado: Tab hasta un punto, flechas para moverlo (Shift: 5 m) y Supr para quitarlo.</span>`;
  contenedor.appendChild(barra);
  L.DomEvent.disableClickPropagation(barra);
  const info = barra.querySelector('[data-ed="info"]');
  const botonDeshacer = barra.querySelector('[data-ed="deshacer"]');

  const pintarInfo = ()=>{
    const ha = areaHectareas(puntos);
    info.textContent = `${puntos.length} puntos · ${fmtHectareas(ha)}${piscina.hectareas ? ` (plano: ${fmtHectareas(piscina.hectareas)})` : ""}`;
    botonDeshacer.disabled = !pila.length;
  };
  const recordar = ()=>{ pila.push(puntos.map(p=>[...p])); if(pila.length > 100) pila.shift(); };
  const icono = clase=>L.divIcon({ className: `${P}mapa-piscina-${clase}`, iconSize: clase === "vertice" ? [14, 14] : [11, 11] });
  const medioDe = i=>puntoMedio(puntos[i], puntos[(i + 1) % puntos.length]);

  function quitar(i){
    const q = quitarVertice(puntos, i);
    if(!q) return;
    recordar();
    puntos = q;
    reconstruir();
  }
  function moverConTeclado(i, norte, este){
    recordar();
    puntos = moverVertice(puntos, i, desplazarMetros(puntos[i], norte, este));
    poli.setLatLngs(puntos);
    vertices[i].setLatLng(puntos[i]);
    const n = puntos.length;
    medios[i].setLatLng(medioDe(i));
    medios[(i - 1 + n) % n].setLatLng(medioDe((i - 1 + n) % n));
    pintarInfo();
  }
  function reconstruir(foco = null){
    for(const m of [...vertices, ...medios]) m.remove();
    vertices.length = 0; medios.length = 0;
    poli.setLatLngs(puntos);
    const n = puntos.length;
    puntos.forEach((p, i)=>{
      const m = L.marker(p, { icon: icono("vertice"), draggable: true, keyboard: true, pane: PANE_MANIJAS_PISCINA, title: `Punto ${i + 1} de ${n}` });
      m.on("dragstart", recordar);
      m.on("drag", e=>{
        puntos = moverVertice(puntos, i, [e.latlng.lat, e.latlng.lng]);
        poli.setLatLngs(puntos);
        medios[i].setLatLng(medioDe(i));
        medios[(i - 1 + n) % n].setLatLng(medioDe((i - 1 + n) % n));
        pintarInfo();
      });
      m.on("dblclick contextmenu", e=>{ L.DomEvent.stop(e); quitar(i); });
      m.on("add", ()=>{
        const el = m.getElement();
        if(!el) return;
        el.setAttribute("role", "button");
        el.setAttribute("aria-label", `Punto ${i + 1} de ${n}: flechas para moverlo, Supr para quitarlo`);
        el.dataset.vertice = i;
        el.addEventListener("keydown", ev=>{
          const paso = ev.shiftKey ? 5 : 1;
          const mov = { ArrowUp: [paso, 0], ArrowDown: [-paso, 0], ArrowRight: [0, paso], ArrowLeft: [0, -paso] }[ev.key];
          if(mov){ ev.preventDefault(); ev.stopPropagation(); moverConTeclado(i, mov[0], mov[1]); return; }
          if(ev.key === "Delete" || ev.key === "Backspace"){ ev.preventDefault(); ev.stopPropagation(); quitar(i); reconstruirFoco(Math.min(i, puntos.length - 1)); }
        });
      });
      m.addTo(capa);
      vertices.push(m);
    });
    puntos.forEach((_, i)=>{
      const m = L.marker(medioDe(i), { icon: icono("medio"), draggable: true, keyboard: false, pane: PANE_MANIJAS_PISCINA, title: "Arrastra para agregar un punto" });
      let insertado = false;
      m.on("dragstart", ()=>{ recordar(); puntos = insertarVertice(puntos, i, [m.getLatLng().lat, m.getLatLng().lng]); insertado = true; });
      m.on("drag", e=>{ if(!insertado) return; puntos = moverVertice(puntos, i + 1, [e.latlng.lat, e.latlng.lng]); poli.setLatLngs(puntos); pintarInfo(); });
      m.on("dragend", ()=>reconstruir());
      m.addTo(capa);
      medios.push(m);
    });
    pintarInfo();
    if(foco !== null) reconstruirFoco(foco);
  }
  function reconstruirFoco(i){
    const m = vertices[i];
    const el = m && m.getElement();
    if(el) el.focus({ preventScroll: true });
  }

  function terminar(guardado = false){
    if(terminado) return;
    terminado = true;
    document.removeEventListener("keydown", alTeclear, true);
    capa.remove();
    barra.remove();
    lienzo.classList.remove(`${P}mapa-editando-piscina`);
    mapa.doubleClickZoom.enable();
    if(alTerminar) alTerminar(guardado);
  }
  async function guardar(){
    if(guardando) return;
    guardando = true;
    const b = barra.querySelector('[data-ed="guardar"]');
    b.disabled = true; b.textContent = "Guardando…";
    try{
      await alGuardar(puntos.map(p=>[...p]));
      terminar(true);
    }catch(err){
      if(b.isConnected){ b.disabled = false; b.textContent = "Guardar"; }
    }finally{
      guardando = false;
    }
  }
  function alTeclear(e){
    if(e.key !== "Escape" || terminado) return;
    if(document.querySelector(`#${P}modal-host .${P}modal-backdrop`)) return;
    e.preventDefault(); e.stopPropagation();
    terminar(false);
  }
  document.addEventListener("keydown", alTeclear, true);
  barra.addEventListener("click", e=>{
    const b = e.target.closest("[data-ed]");
    if(!b || b.tagName !== "BUTTON") return;
    if(b.dataset.ed === "cancelar") terminar(false);
    else if(b.dataset.ed === "guardar") guardar();
    else if(b.dataset.ed === "deshacer" && pila.length){ puntos = pila.pop(); reconstruir(); }
  });
  reconstruir();
  return { terminar: ()=>terminar(false), puntos: ()=>puntos.map(p=>[...p]) };
}
