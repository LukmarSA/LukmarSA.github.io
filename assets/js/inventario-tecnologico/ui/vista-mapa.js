// Pestaña "Mapa": ubicaciones (torres, oficinas, bodegas…), sus equipos de
// radioenlace y los activos que están en cada una.
//
// Flujo principal (el que pidió el spec):
//   1. Marcadores de ubicaciones.
//   2. Clic en un marcador → el panel lateral lista sus equipos de radioenlace
//      (y sus activos).
//   3. Clic en un equipo → se dibuja la línea de vista hacia cada equipo con el
//      que está enlazado (PtP o PtMP), con distancia y azimut, y se resalta el
//      otro extremo. Clic en ese otro extremo → pasa al equipo de allá, con la
//      línea todavía dibujada.
//
// Misma convención que las demás vistas: renderVistaMapa(main) arma todo
// dentro de <main>. Como Leaflet engancha listeners a window, renderMain()
// llama a destruirVistaMapa() al salir de la pestaña.
import { cargarActivos } from "../nucleo/datos.js";
import { estadoMapa, indicesMapa, refrescarDatosMapa } from "../nucleo/datos-mapa.js";
import { state } from "../nucleo/estado.js";
import { fmtCoordenadas } from "../nucleo/geo.js";
import { esc, fmtTag } from "../nucleo/helpers.js";
import { buscarEnMapa, describirEnlace, enlacesDeEquipo, infoTipoUbicacion, resumenMapa, traducirErrorMapa, ubicacionesEnlazadas, ubicacionesVisibles } from "../nucleo/mapa-logica.js";
import { esAdmin, puede } from "../nucleo/permisos.js";
import { eliminarEnlace, eliminarEquipo, eliminarUbicacion, establecerUbicacionActiva, quitarActivoDeUbicacion } from "../negocio/operaciones-mapa.js";
import { urlFoto } from "../negocio/operaciones.js";
import { abrirDetalle } from "./detalle/vista.js";
import { abrirAsignarActivos, abrirFormEnlace, abrirFormEquipo, abrirFormUbicacion, abrirMoverActivo } from "./mapa/formularios.js";
import { CAPAS_BASE, CENTRO_POR_DEFECTO, ESTILOS_ENLACE, capaBaseInicial, cargarLeaflet, crearCapasBase, iconoUbicacion, recordarCapaBase } from "./mapa/leaflet.js";
import { htmlPanelCargando, htmlPanelError, htmlPanelResumen, htmlPanelUbicacion } from "./mapa/panel.js";
import { abrirCarruselFotos, cerrarModal, confirmarAccion, mostrarToast, renderMain } from "./render-raiz.js";

const P = "inventario-tecnologico-";

let vista = null;     // { L, mapa, capaMarcadores, capaEnlaces, marcadores, main, colocando, alTeclear, ... }
let generacion = 0;   // invalida cargas en curso si se sale de la pestaña antes de que terminen
let alClicFueraBuscador = null;
let ubicacionEnPanel = null; // para conservar el scroll del panel solo si sigue mostrando la misma ubicación

// ---------------------------------------------------------------------------
// Ciclo de vida
// ---------------------------------------------------------------------------
export async function renderVistaMapa(main){
  destruirVistaMapa();
  const gen = ++generacion;
  if(!puede("ver_mapa")){
    main.innerHTML = `<div class="${P}empty-state"><div class="${P}big">—</div>No tienes permiso para ver el mapa.</div>`;
    return;
  }
  main.innerHTML = htmlEsqueleto();
  const panel = main.querySelector(`#${P}mapa-panel`);
  panel.innerHTML = htmlPanelCargando();
  panel.addEventListener("click", alClicPanel);
  montarBarra(main);

  const [rLeaflet, rDatos] = await Promise.allSettled([cargarLeaflet(), refrescarDatosMapa()]);
  if(gen !== generacion || !main.isConnected || state.vista !== "mapa") return;

  const canvas = main.querySelector(`#${P}mapa-canvas`);
  if(rLeaflet.status === "rejected"){
    canvas.innerHTML = `<div class="${P}mapa-error-lienzo"><div class="${P}alert ${P}alert-error">No se pudo cargar la librería del mapa (Leaflet) desde unpkg.com.<br><br>Revisa tu conexión, o si un firewall o bloqueador está impidiendo ese dominio, y recarga la página.<br><br>Detalle: ${esc(rLeaflet.reason && rLeaflet.reason.message)}</div></div>`;
  } else {
    crearMapa(rLeaflet.value, main);
  }
  if(rDatos.status === "rejected"){
    panel.innerHTML = htmlPanelError(traducirErrorMapa(rDatos.reason));
    return;
  }
  pintarTodo();
  aplicarFocoPendiente();
}

export function destruirVistaMapa(){
  generacion++;
  ubicacionEnPanel = null;
  if(alClicFueraBuscador){ document.removeEventListener("click", alClicFueraBuscador); alClicFueraBuscador = null; }
  if(!vista) return;
  document.removeEventListener("keydown", vista.alTeclear, true);
  // Leaflet programa un setTimeout de 250 ms al animar un zoom
  // (_onZoomTransitionEnd); si el mapa se destruye antes, ese callback revienta
  // con "Cannot read properties of undefined (reading '_leaflet_pos')". Se
  // detiene cualquier animación y se libera un poco después, cuando ya corrió.
  const mapa = vista.mapa;
  vista = null;
  try{ mapa.stop(); }catch(e){ /* sin animación en curso */ }
  setTimeout(()=>{ try{ mapa.off(); mapa.remove(); }catch(e){ /* el contenedor ya no existe: nada que limpiar */ } }, 300);
}

// Navegar al mapa desde otra vista (p. ej. "Ver en mapa" en el detalle de un activo).
export function irAlMapa(foco){
  estadoMapa().foco = foco;
  cerrarModal();
  if(state.vista === "mapa" && vista && vista.mapa){ aplicarFocoPendiente(); return; }
  state.vista = "mapa";
  renderMain();
}

function htmlEsqueleto(){
  return `
    <div class="${P}mapa-vista">
      <div class="${P}mapa-barra">
        <div class="${P}mapa-buscador">
          <input type="search" id="${P}mapa-buscar" placeholder="Buscar ubicación, equipo o activo (LKM-045, serie, custodio…)" autocomplete="off" spellcheck="false"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${P}mapa-resultados" aria-label="Buscar en el mapa">
          <ul id="${P}mapa-resultados" class="${P}mapa-resultados" role="listbox" hidden></ul>
        </div>
        <div class="${P}mapa-chips" id="${P}mapa-chips" role="group" aria-label="Tipos de ubicación visibles"></div>
        <label class="${P}mapa-check"><input type="checkbox" id="${P}mapa-ver-enlaces"> Todos los enlaces</label>
        <label class="${P}mapa-check"><input type="checkbox" id="${P}mapa-ver-archivadas"> Archivadas</label>
        <span class="${P}fb-spacer"></span>
        <button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-recargar" title="Volver a leer ubicaciones, equipos y enlaces desde la base">Recargar</button>
        ${esAdmin() ? `<button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" id="${P}mapa-nueva-ubicacion">+ Ubicación</button>` : ""}
      </div>
      <div class="${P}mapa-layout">
        <div class="${P}mapa-lienzo-wrap">
          <div id="${P}mapa-canvas" class="${P}mapa-canvas" aria-label="Mapa de ubicaciones"></div>
          <div class="${P}mapa-aviso" id="${P}mapa-aviso" hidden>
            <span>Haz clic en el mapa donde está la ubicación.</span>
            <button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-aviso-cancelar">Cancelar (Esc)</button>
          </div>
        </div>
        <aside class="${P}mapa-panel" id="${P}mapa-panel" aria-label="Detalle de la ubicación"></aside>
      </div>
    </div>`;
}

function crearMapa(L, main){
  const canvas = main.querySelector(`#${P}mapa-canvas`);
  const mapa = L.map(canvas, { zoomControl: true, worldCopyJump: true }).setView([CENTRO_POR_DEFECTO.lat, CENTRO_POR_DEFECTO.lng], CENTRO_POR_DEFECTO.zoom);
  const capas = crearCapasBase(L);
  const inicial = capaBaseInicial();
  capas[inicial].addTo(mapa);
  L.control.layers(Object.fromEntries(Object.entries(capas).map(([id, capa])=>[CAPAS_BASE[id].etiqueta, capa])), null, { position: "topright" }).addTo(mapa);
  mapa.on("baselayerchange", e=>{
    const id = Object.keys(capas).find(k=>capas[k] === e.layer);
    if(id) recordarCapaBase(id);
  });
  L.control.scale({ metric: true, imperial: false }).addTo(mapa);
  const capaEnlaces = L.layerGroup().addTo(mapa);
  const capaMarcadores = L.layerGroup().addTo(mapa);
  mapa.on("click", alClicMapa);
  mapa.on("contextmenu", alClicDerechoMapa);

  vista = { L, mapa, capaEnlaces, capaMarcadores, marcadores: new Map(), main, colocando: null, encuadrado: false, alTeclear: null };

  // Captura: corre antes que el Esc de los modales (render-raiz.js), así
  // puede ignorar la tecla si hay un modal abierto.
  vista.alTeclear = e=>{
    if(e.key !== "Escape" || state.vista !== "mapa" || !vista) return;
    if(hayModalAbierto()) return;
    if(e.target && e.target.id === `${P}mapa-buscar`) return; // el buscador maneja su propio Esc
    if(vista.colocando){ e.preventDefault(); cancelarColocacion(); return; }
    const s = estadoMapa().seleccion;
    if(s.equipoId){ seleccionarUbicacion(s.ubicacionId); return; }
    if(s.ubicacionId) deseleccionar();
  };
  document.addEventListener("keydown", vista.alTeclear, true);
  requestAnimationFrame(()=>{ if(vista && vista.mapa === mapa) mapa.invalidateSize(); });
}

function hayModalAbierto(){
  return !!document.querySelector(`#${P}modal-host .${P}modal-backdrop`);
}

// ---------------------------------------------------------------------------
// Pintado
// ---------------------------------------------------------------------------
function contextoPanel(){
  const m = estadoMapa();
  const indices = indicesMapa();
  const activos = cargarActivos().activos;
  const visibles = ubicacionesVisibles(m.ubicaciones, m.filtros);
  return {
    indices,
    tipos: m.tiposUbicacion,
    seleccion: m.seleccion,
    esAdmin: esAdmin(),
    puedeAsignar: puede("asignar_ubicacion"),
    ubicacionesVisibles: visibles,
    ubicacionesTotal: m.ubicaciones.length,
    resumen: resumenMapa(indices, { ubicaciones: m.ubicaciones, equipos: m.equipos, enlaces: m.enlaces, activos }),
  };
}

function pintarTodo(){
  pintarChips();
  pintarMarcadores();
  pintarEnlaces();
  pintarPanel();
  if(vista && !vista.encuadrado){ encuadrarTodo(); vista.encuadrado = true; }
}

function pintarChips(){
  const cont = document.getElementById(`${P}mapa-chips`);
  if(!cont) return;
  const m = estadoMapa();
  const usados = new Set(m.ubicaciones.map(u=>u.tipo));
  const tipos = m.tiposUbicacion.filter(t=>t.activo !== false || usados.has(t.valor));
  cont.innerHTML = tipos.map(t=>{
    const n = m.ubicaciones.filter(u=>u.tipo === t.valor && (m.filtros.verArchivadas || u.activa !== false)).length;
    const visible = !m.filtros.tiposOcultos.includes(t.valor);
    return `<button type="button" class="${P}mapa-chip" data-tipo="${esc(t.valor)}" aria-pressed="${visible}" style="--chip-color:${esc(t.color)}" title="${visible ? "Ocultar" : "Mostrar"} ${esc(t.etiqueta)}"><span class="${P}mapa-chip-punto"></span>${esc(t.etiqueta)} <span class="${P}mapa-chip-n">${n}</span></button>`;
  }).join("");
  const ve = document.getElementById(`${P}mapa-ver-enlaces`);
  const va = document.getElementById(`${P}mapa-ver-archivadas`);
  if(ve) ve.checked = m.filtros.verTodosEnlaces;
  if(va) va.checked = m.filtros.verArchivadas;
}

function opcionesIcono(u, { seleccionada, enlazada }){
  const m = estadoMapa();
  const idx = indicesMapa();
  const equipos = (idx.equiposPorUbicacion.get(u.id) || []).length;
  // Un activo que es el radio de un equipo de esta ubicación no se cuenta dos veces.
  const activos = (idx.activosPorUbicacion.get(u.id) || []).filter(a=>{ const e = idx.equipoPorActivo.get(a.id); return !(e && e.ubicacion_id === u.id); }).length;
  return { color: infoTipoUbicacion(m.tiposUbicacion, u.tipo).color, tipo: u.tipo, cantidad: equipos + activos, seleccionada, enlazada, archivada: u.activa === false };
}

function pintarMarcadores(){
  if(!vista) return;
  const { L } = vista;
  const m = estadoMapa();
  const s = m.seleccion;
  const enlazadas = s.equipoId ? ubicacionesEnlazadas(indicesMapa(), s.equipoId) : new Set();
  vista.capaMarcadores.clearLayers();
  vista.marcadores.clear();
  for(const u of ubicacionesVisibles(m.ubicaciones, m.filtros)){
    const sel = s.ubicacionId === u.id, enl = enlazadas.has(u.id);
    const marcador = L.marker([u.lat, u.lng], {
      icon: iconoUbicacion(L, opcionesIcono(u, { seleccionada: sel, enlazada: enl })),
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: sel ? 1000 : (enl ? 500 : 0),
    });
    marcador.bindTooltip(esc(u.nombre), { direction: "top", className: `${P}mapa-tooltip` });
    marcador.on("click", ()=>alClicMarcador(u.id));
    marcador.on("add", ()=>{ const el = marcador.getElement(); if(el){ el.setAttribute("aria-label", u.nombre); el.dataset.ubicacionId = u.id; } });
    marcador.addTo(vista.capaMarcadores);
    vista.marcadores.set(u.id, marcador);
  }
}

// Solo cambia íconos (selección/extremo enlazado), sin recrear marcadores.
function actualizarIconos(){
  if(!vista) return;
  const m = estadoMapa();
  const s = m.seleccion;
  const enlazadas = s.equipoId ? ubicacionesEnlazadas(indicesMapa(), s.equipoId) : new Set();
  for(const [id, marcador] of vista.marcadores){
    const u = m.ubicaciones.find(x=>x.id === id);
    if(!u) continue;
    const sel = s.ubicacionId === id, enl = enlazadas.has(id);
    marcador.setIcon(iconoUbicacion(vista.L, opcionesIcono(u, { seleccionada: sel, enlazada: enl })));
    marcador.setZIndexOffset(sel ? 1000 : (enl ? 500 : 0));
    const el = marcador.getElement();
    if(el){ el.setAttribute("aria-label", u.nombre); el.dataset.ubicacionId = id; }
  }
}

function etiquetaLinea(d){
  const partes = [d.distanciaKm !== null ? (d.distanciaKm < 1 ? `${Math.round(d.distanciaKm * 1000)} m` : `${d.distanciaKm.toFixed(2)} km`) : "", d.enlace.banda || ""].filter(Boolean);
  return esc(partes.join(" · "));
}

function pintarEnlaces(){
  if(!vista) return;
  const { L } = vista;
  const m = estadoMapa();
  const s = m.seleccion;
  const idx = indicesMapa();
  const visibles = new Set(ubicacionesVisibles(m.ubicaciones, m.filtros).map(u=>u.id));
  vista.capaEnlaces.clearLayers();

  if(m.filtros.verTodosEnlaces){
    for(const l of m.enlaces){
      if(s.equipoId && (l.equipo_origen_id === s.equipoId || l.equipo_destino_id === s.equipoId)) continue;
      const d = describirEnlace(idx, l, l.equipo_origen_id);
      if(!d.otro || !d.ubicacion || !d.otraUbicacion || !visibles.has(d.ubicacion.id) || !visibles.has(d.otraUbicacion.id)) continue;
      L.polyline([[d.ubicacion.lat, d.ubicacion.lng], [d.otraUbicacion.lat, d.otraUbicacion.lng]], ESTILOS_ENLACE.fondo)
        .bindTooltip(`${esc(d.equipo.nombre)} ↔ ${esc(d.otro.nombre)}`, { sticky: true, className: `${P}mapa-tooltip` })
        .on("click", ()=>seleccionarEquipo(l.equipo_origen_id, { enlaceId: l.id }))
        .addTo(vista.capaEnlaces);
    }
  }

  if(s.equipoId){
    for(const d of enlacesDeEquipo(idx, s.equipoId)){
      const puntos = [[d.ubicacion.lat, d.ubicacion.lng], [d.otraUbicacion.lat, d.otraUbicacion.lng]];
      L.polyline(puntos, ESTILOS_ENLACE.borde).addTo(vista.capaEnlaces);
      const linea = L.polyline(puntos, s.enlaceId === d.enlace.id ? ESTILOS_ENLACE.destacado : ESTILOS_ENLACE.seleccionado).addTo(vista.capaEnlaces);
      linea.bindTooltip(etiquetaLinea(d), { permanent: true, direction: "center", className: `${P}mapa-etiqueta-enlace` });
      linea.on("click", ()=>{ s.enlaceId = d.enlace.id; pintarEnlaces(); pintarPanel(); });
      const el = linea.getElement();
      if(el){ el.dataset.enlaceId = d.enlace.id; el.setAttribute("aria-label", `Enlace ${d.equipo.nombre} ↔ ${d.otro.nombre}`); }
    }
  }
}

function pintarPanel(){
  const panel = document.getElementById(`${P}mapa-panel`);
  if(!panel) return;
  const m = estadoMapa();
  const ctx = contextoPanel();
  const u = m.seleccion.ubicacionId ? m.ubicaciones.find(x=>x.id === m.seleccion.ubicacionId) : null;
  const scroll = panel.scrollTop;
  panel.innerHTML = u ? htmlPanelUbicacion(ctx, u) : htmlPanelResumen(ctx);
  panel.scrollTop = (u ? u.id : null) === ubicacionEnPanel ? scroll : 0;
  ubicacionEnPanel = u ? u.id : null;
  const destino = m.seleccion.activoId
    ? panel.querySelector(`[data-activo-id="${m.seleccion.activoId}"]`)
    : (m.seleccion.equipoId ? panel.querySelector(`[data-equipo-id="${m.seleccion.equipoId}"]`) : null);
  if(destino && destino.scrollIntoView) destino.scrollIntoView({ block: "nearest" });
}

// Leaflet descarta setView/fitBounds pedidos mientras anima un zoom
// (_tryAnimatedZoom devuelve true sin mover nada si _animatingZoom), p. ej.
// al elegir algo en el panel justo después de un encuadre. Se guarda el
// último pedido y se aplica al terminar la animación.
function moverVista(fn){
  if(!vista) return;
  const mapa = vista.mapa;
  if(mapa._animatingZoom){
    const yaEsperando = !!vista.movimientoPendiente;
    vista.movimientoPendiente = fn;
    if(!yaEsperando) mapa.once("zoomend", ()=>{
      if(!vista || vista.mapa !== mapa) return;
      const pendiente = vista.movimientoPendiente;
      vista.movimientoPendiente = null;
      if(pendiente) moverVista(pendiente);
    });
    return;
  }
  fn(mapa);
}

function encuadrarTodo(){
  if(!vista) return;
  const m = estadoMapa();
  const puntos = ubicacionesVisibles(m.ubicaciones, m.filtros).map(u=>[u.lat, u.lng]);
  moverVista(mapa=>{
    if(puntos.length === 0) mapa.setView([CENTRO_POR_DEFECTO.lat, CENTRO_POR_DEFECTO.lng], CENTRO_POR_DEFECTO.zoom);
    else if(puntos.length === 1) mapa.setView(puntos[0], 15);
    else mapa.fitBounds(puntos, { padding: [40, 40], maxZoom: 15 });
  });
}

// ---------------------------------------------------------------------------
// Selección
// ---------------------------------------------------------------------------

// Si lo que se va a mostrar está oculto por un filtro, se quita ese filtro
// (buscar algo y no verlo sería peor).
function asegurarVisible(u){
  const f = estadoMapa().filtros;
  let cambio = false;
  if(f.tiposOcultos.includes(u.tipo)){ f.tiposOcultos = f.tiposOcultos.filter(t=>t !== u.tipo); cambio = true; }
  if(u.activa === false && !f.verArchivadas){ f.verArchivadas = true; cambio = true; }
  return cambio;
}

function refrescarSeleccion(recrearMarcadores){
  if(recrearMarcadores){ pintarChips(); pintarMarcadores(); }
  else actualizarIconos();
  pintarEnlaces();
  pintarPanel();
}

export function seleccionarUbicacion(id, { centrar = false, activoId = null } = {}){
  const m = estadoMapa();
  const u = m.ubicaciones.find(x=>x.id === id);
  if(!u) return;
  const recrear = asegurarVisible(u);
  m.seleccion = { ubicacionId: id, equipoId: null, enlaceId: null, activoId };
  refrescarSeleccion(recrear);
  moverVista(mapa=>{
    if(centrar) mapa.setView([u.lat, u.lng], Math.max(mapa.getZoom(), 15));
    else if(!mapa.getBounds().pad(-0.1).contains([u.lat, u.lng])) mapa.panTo([u.lat, u.lng]);
  });
}

export function seleccionarEquipo(equipoId, { enlaceId = null, encuadrar = true } = {}){
  const m = estadoMapa();
  const idx = indicesMapa();
  const e = idx.equipoPorId.get(equipoId);
  if(!e) return;
  const u = idx.ubicacionPorId.get(e.ubicacion_id);
  if(!u) return;
  const enlaces = enlacesDeEquipo(idx, equipoId);
  let recrear = asegurarVisible(u);
  for(const d of enlaces) recrear = asegurarVisible(d.otraUbicacion) || recrear;
  m.seleccion = { ubicacionId: u.id, equipoId, enlaceId, activoId: null };
  refrescarSeleccion(recrear);
  if(!encuadrar) return;
  moverVista(mapa=>{
    if(enlaces.length) mapa.fitBounds([[u.lat, u.lng], ...enlaces.map(d=>[d.otraUbicacion.lat, d.otraUbicacion.lng])], { padding: [70, 70], maxZoom: 15 });
    else if(!mapa.getBounds().contains([u.lat, u.lng])) mapa.panTo([u.lat, u.lng]);
  });
}

function deseleccionar(){
  const m = estadoMapa();
  m.seleccion = { ubicacionId: null, equipoId: null, enlaceId: null, activoId: null };
  refrescarSeleccion(false);
}

function aplicarFocoPendiente(){
  const m = estadoMapa();
  const f = m.foco;
  if(!f || !vista) return;
  m.foco = null;
  if(f.equipoId && indicesMapa().equipoPorId.has(f.equipoId)) seleccionarEquipo(f.equipoId);
  else if(f.ubicacionId) seleccionarUbicacion(f.ubicacionId, { centrar: true, activoId: f.activoId || null });
}

// ---------------------------------------------------------------------------
// Eventos del mapa
// ---------------------------------------------------------------------------
function alClicMarcador(id){
  if(!vista || vista.colocando) return;
  const s = estadoMapa().seleccion;
  // Clic en el otro extremo de un enlace dibujado: se pasa a su equipo y la
  // línea se mantiene.
  if(s.equipoId && id !== s.ubicacionId){
    const socio = enlacesDeEquipo(indicesMapa(), s.equipoId).find(d=>d.otraUbicacion.id === id);
    if(socio){ seleccionarEquipo(socio.otro.id, { enlaceId: socio.enlace.id, encuadrar: false }); return; }
  }
  if(s.ubicacionId === id && !s.equipoId) return;
  seleccionarUbicacion(id);
}

function alClicMapa(e){
  if(!vista) return;
  if(vista.colocando){
    const { alColocar } = vista.colocando;
    salirDeColocacion();
    alColocar(e.latlng);
    return;
  }
  const s = estadoMapa().seleccion;
  if(s.ubicacionId || s.equipoId) deseleccionar();
}

function alClicDerechoMapa(e){
  if(!vista || vista.colocando || !esAdmin()) return;
  abrirNuevaUbicacion({ lat: e.latlng.lat, lng: e.latlng.lng });
}

function entrarEnColocacion(alColocar, alCancelar){
  if(!vista) return;
  vista.colocando = { alColocar, alCancelar };
  vista.main.querySelector(`.${P}mapa-vista`).classList.add(`${P}mapa-colocando`);
  const aviso = document.getElementById(`${P}mapa-aviso`);
  if(aviso) aviso.hidden = false;
}

function salirDeColocacion(){
  if(!vista) return;
  vista.colocando = null;
  const cont = vista.main.querySelector(`.${P}mapa-vista`);
  if(cont) cont.classList.remove(`${P}mapa-colocando`);
  const aviso = document.getElementById(`${P}mapa-aviso`);
  if(aviso) aviso.hidden = true;
}

function cancelarColocacion(){
  if(!vista || !vista.colocando) return;
  const { alCancelar } = vista.colocando;
  salirDeColocacion();
  if(alCancelar) alCancelar();
}

// ---------------------------------------------------------------------------
// Formularios (abrir y volver al mapa con lo recién guardado seleccionado)
// ---------------------------------------------------------------------------
function trasGuardar(fn){
  return (...args)=>{
    if(!vista) return;
    pintarChips();
    pintarMarcadores();
    fn(...args);
  };
}

function abrirNuevaUbicacion({ lat = null, lng = null, id = null, borrador = null } = {}){
  const callbacks = {
    alGuardar: trasGuardar(nuevoId=>seleccionarUbicacion(nuevoId, { centrar: true })),
    alElegirEnMapa: b=>entrarEnColocacion(
      latlng=>abrirFormUbicacion({ id, borrador: b, lat: latlng.lat, lng: latlng.lng }, callbacks),
      ()=>abrirFormUbicacion({ id, borrador: b }, callbacks)
    ),
  };
  abrirFormUbicacion({ id, borrador, lat, lng }, callbacks);
}

// ---------------------------------------------------------------------------
// Barra superior: buscador, filtros por tipo, recargar, + Ubicación
// ---------------------------------------------------------------------------
function montarBarra(main){
  const input = main.querySelector(`#${P}mapa-buscar`);
  const lista = main.querySelector(`#${P}mapa-resultados`);
  let resultados = [];
  let activo = -1;
  let espera = null;

  const cerrarLista = ()=>{ lista.hidden = true; input.setAttribute("aria-expanded", "false"); activo = -1; };
  const pintarLista = ()=>{
    if(!resultados.length){
      lista.innerHTML = input.value.trim().length >= 2 ? `<li class="${P}mapa-resultado-vacio">Sin resultados.</li>` : "";
    } else {
      const nombreClase = { ubicacion: "Ubicación", equipo: "Equipo de radio", activo: "Activo" };
      lista.innerHTML = resultados.map((r, i)=>`<li role="option" id="${P}mapa-res-${i}" class="${P}mapa-resultado${i === activo ? ` ${P}mapa-resultado-activo` : ""}" data-indice="${i}" aria-selected="${i === activo}">
        <span class="${P}mapa-resultado-clase">${nombreClase[r.clase]}</span>
        <span class="${P}mapa-resultado-titulo">${esc(r.titulo)}</span>
        ${r.detalle ? `<span class="${P}mapa-resultado-detalle">${esc(r.detalle)}</span>` : ""}
      </li>`).join("");
    }
    const hay = !!lista.innerHTML;
    lista.hidden = !hay;
    input.setAttribute("aria-expanded", String(hay));
    if(activo >= 0) input.setAttribute("aria-activedescendant", `${P}mapa-res-${activo}`); else input.removeAttribute("aria-activedescendant");
  };
  const buscar = ()=>{
    const m = estadoMapa();
    if(!m.cargado){ resultados = []; pintarLista(); return; }
    resultados = buscarEnMapa(input.value, { indices: indicesMapa(), ubicaciones: m.ubicaciones, equipos: m.equipos, activos: cargarActivos().activos, tipos: m.tiposUbicacion });
    activo = resultados.length ? 0 : -1;
    pintarLista();
  };
  const elegir = r=>{
    cerrarLista();
    input.blur();
    if(r.clase === "ubicacion") seleccionarUbicacion(r.id, { centrar: true });
    else if(r.clase === "equipo") seleccionarEquipo(r.id);
    else {
      const idx = indicesMapa();
      const equipo = idx.equipoPorActivo.get(r.id);
      if(equipo) seleccionarEquipo(equipo.id);
      else if(r.ubicacionId) seleccionarUbicacion(r.ubicacionId, { centrar: true, activoId: r.id });
      else if(puede("asignar_ubicacion")) abrirMoverActivo(r.id, { alGuardar: trasGuardar(dest=>seleccionarUbicacion(dest, { centrar: true, activoId: r.id })) });
      else mostrarToast(`${fmtTag(idx.activoPorId.get(r.id) || { id: r.id })} todavía no tiene ubicación asignada.`, "info");
    }
  };
  input.addEventListener("input", ()=>{ clearTimeout(espera); espera = setTimeout(buscar, 120); });
  input.addEventListener("focus", ()=>{ if(input.value.trim()) buscar(); });
  input.addEventListener("keydown", e=>{
    if(e.key === "ArrowDown" && resultados.length){ e.preventDefault(); activo = (activo + 1) % resultados.length; pintarLista(); }
    else if(e.key === "ArrowUp" && resultados.length){ e.preventDefault(); activo = (activo - 1 + resultados.length) % resultados.length; pintarLista(); }
    else if(e.key === "Enter" && activo >= 0 && resultados[activo]){ e.preventDefault(); elegir(resultados[activo]); }
    else if(e.key === "Escape"){ if(!lista.hidden){ e.preventDefault(); cerrarLista(); } else { input.value = ""; } }
  });
  lista.addEventListener("mousedown", e=>{
    const li = e.target.closest("[data-indice]");
    if(!li) return;
    e.preventDefault(); // que el input no pierda el foco antes del clic
    elegir(resultados[Number(li.dataset.indice)]);
  });
  alClicFueraBuscador = e=>{ if(!e.target.closest(`.${P}mapa-buscador`)) cerrarLista(); };
  document.addEventListener("click", alClicFueraBuscador);

  main.querySelector(`#${P}mapa-chips`).addEventListener("click", e=>{
    const chip = e.target.closest("[data-tipo]");
    if(!chip) return;
    const f = estadoMapa().filtros;
    const t = chip.dataset.tipo;
    f.tiposOcultos = f.tiposOcultos.includes(t) ? f.tiposOcultos.filter(x=>x !== t) : [...f.tiposOcultos, t];
    const s = estadoMapa().seleccion;
    const u = s.ubicacionId ? estadoMapa().ubicaciones.find(x=>x.id === s.ubicacionId) : null;
    if(u && f.tiposOcultos.includes(u.tipo)) estadoMapa().seleccion = { ubicacionId: null, equipoId: null, enlaceId: null, activoId: null };
    refrescarSeleccion(true);
  });
  main.querySelector(`#${P}mapa-ver-enlaces`).addEventListener("change", e=>{
    estadoMapa().filtros.verTodosEnlaces = e.target.checked;
    pintarEnlaces();
  });
  main.querySelector(`#${P}mapa-ver-archivadas`).addEventListener("change", e=>{
    const m = estadoMapa();
    m.filtros.verArchivadas = e.target.checked;
    const u = m.seleccion.ubicacionId ? m.ubicaciones.find(x=>x.id === m.seleccion.ubicacionId) : null;
    if(u && u.activa === false && !m.filtros.verArchivadas) m.seleccion = { ubicacionId: null, equipoId: null, enlaceId: null, activoId: null };
    refrescarSeleccion(true);
  });
  main.querySelector(`#${P}mapa-recargar`).addEventListener("click", e=>recargar(e.currentTarget));
  const nueva = main.querySelector(`#${P}mapa-nueva-ubicacion`);
  if(nueva) nueva.addEventListener("click", ()=>{
    if(!vista){ mostrarToast("El mapa no está disponible (Leaflet no cargó).", "error"); return; }
    abrirNuevaUbicacion({});
  });
  const cancelar = main.querySelector(`#${P}mapa-aviso-cancelar`);
  cancelar.addEventListener("click", cancelarColocacion);
}

async function recargar(boton){
  const panel = document.getElementById(`${P}mapa-panel`);
  if(boton) boton.disabled = true;
  try{
    await refrescarDatosMapa();
    if(!document.getElementById(`${P}mapa-panel`)) return;
    pintarChips();
    pintarMarcadores();
    pintarEnlaces();
    pintarPanel();
    if(vista && !vista.encuadrado){ encuadrarTodo(); vista.encuadrado = true; }
  }catch(err){
    if(panel) panel.innerHTML = htmlPanelError(traducirErrorMapa(err));
  }finally{
    if(boton && boton.isConnected) boton.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Acciones del panel (delegación sobre data-accion / data-id)
// ---------------------------------------------------------------------------
async function alClicPanel(e){
  const b = e.target.closest("[data-accion]");
  if(!b) return;
  const accion = b.dataset.accion;
  const id = b.dataset.id !== undefined ? Number(b.dataset.id) : null;
  const m = estadoMapa();
  const s = m.seleccion;
  const idx = m.cargado ? indicesMapa() : null;
  const u = s.ubicacionId ? m.ubicaciones.find(x=>x.id === s.ubicacionId) : null;
  try{
    switch(accion){
      case "reintentar": return recargar(b);
      case "ver-ubicacion": return seleccionarUbicacion(id, { centrar: true });
      case "volver-resumen": return deseleccionar();
      case "seleccionar-equipo":
        if(s.equipoId === id) return seleccionarUbicacion(s.ubicacionId);
        return seleccionarEquipo(id);
      case "ir-extremo": {
        const d = enlacesDeEquipo(idx, s.equipoId).find(x=>x.enlace.id === id);
        if(d) seleccionarEquipo(d.otro.id, { enlaceId: id, encuadrar: true });
        return;
      }
      case "ver-activo": return abrirDetalle(id);
      case "copiar-coords": {
        const texto = u ? fmtCoordenadas(u.lat, u.lng) : "";
        try{ await navigator.clipboard.writeText(texto); mostrarToast(`Coordenadas copiadas: ${texto}`, "success"); }
        catch(err){ mostrarToast(`No se pudo copiar automáticamente. Coordenadas: ${texto}`, "info"); }
        return;
      }
      case "ver-foto": if(u) abrirCarruselFotos((u.fotos || []).map(urlFoto), id); return;
      case "editar-ubicacion": return abrirNuevaUbicacion({ id });
      case "archivar-ubicacion": {
        const reactivar = u && u.activa === false;
        const ok = await confirmarAccion(reactivar
          ? `¿Reactivar «${u.nombre}»? Volverá a aparecer en el mapa.`
          : `¿Archivar «${u.nombre}»? Se oculta del mapa (y de las listas para asignar), pero su historial se conserva. Puedes reactivarla con «Archivadas».`, reactivar ? "Reactivar" : "Archivar");
        if(!ok) return;
        await establecerUbicacionActiva(id, reactivar);
        if(!reactivar && !m.filtros.verArchivadas) m.seleccion = { ubicacionId: null, equipoId: null, enlaceId: null, activoId: null };
        mostrarToast(reactivar ? "Ubicación reactivada." : "Ubicación archivada.", "success");
        return refrescarSeleccion(true);
      }
      case "eliminar-ubicacion": {
        const ok = await confirmarAccion(`¿Eliminar «${u.nombre}»? Solo se puede si nunca tuvo equipos ni activos; si ya se usó, archívala. No se puede deshacer.`, "Eliminar");
        if(!ok) return;
        await eliminarUbicacion(id);
        mostrarToast("Ubicación eliminada.", "success");
        return refrescarSeleccion(true);
      }
      case "nuevo-equipo": return abrirFormEquipo({ ubicacionId: id }, { alGuardar: trasGuardar(nuevo=>seleccionarEquipo(nuevo, { encuadrar: false })) });
      case "editar-equipo": return abrirFormEquipo({ id }, { alGuardar: trasGuardar(eq=>seleccionarEquipo(eq)) });
      case "eliminar-equipo": {
        const e2 = idx.equipoPorId.get(id);
        const n = enlacesDeEquipo(idx, id).length;
        const ok = await confirmarAccion(`¿Eliminar el equipo «${e2 ? e2.nombre : ""}»?${n ? ` También se eliminan sus ${n} enlace(s).` : ""}${e2 && e2.activo_id ? " El activo vinculado se queda registrado en esta ubicación." : ""}`, "Eliminar");
        if(!ok) return;
        await eliminarEquipo(id);
        mostrarToast("Equipo eliminado.", "success");
        return refrescarSeleccion(true);
      }
      case "nuevo-enlace": return abrirFormEnlace({ equipoOrigenId: id }, { alGuardar: trasGuardar(nuevo=>seleccionarEquipo(id, { enlaceId: nuevo })) });
      case "editar-enlace": return abrirFormEnlace({ id, equipoOrigenId: s.equipoId }, { alGuardar: trasGuardar(()=>seleccionarEquipo(s.equipoId, { enlaceId: id, encuadrar: false })) });
      case "eliminar-enlace": {
        const d = enlacesDeEquipo(idx, s.equipoId).find(x=>x.enlace.id === id);
        const ok = await confirmarAccion(`¿Eliminar el enlace con «${d ? d.otro.nombre : ""}»?`, "Eliminar");
        if(!ok) return;
        const equipo = s.equipoId;
        await eliminarEnlace(id);
        mostrarToast("Enlace eliminado.", "success");
        pintarMarcadores();
        return seleccionarEquipo(equipo, { encuadrar: false });
      }
      case "asignar-activos": return abrirAsignarActivos(id, { alGuardar: trasGuardar(()=>seleccionarUbicacion(id)) });
      case "mover-activo": return abrirMoverActivo(id, { alGuardar: trasGuardar(dest=>seleccionarUbicacion(dest, { centrar: true, activoId: id })) });
      case "quitar-activo": {
        const a = idx.activoPorId.get(id);
        const ok = await confirmarAccion(`¿Quitar ${a ? fmtTag(a) : "el activo"} de «${u ? u.nombre : ""}»? Quedará sin ubicación (su tramo se cierra con la fecha de hoy y queda en el historial).`, "Quitar");
        if(!ok) return;
        await quitarActivoDeUbicacion(id);
        mostrarToast("Ubicación quitada.", "success");
        return refrescarSeleccion(true);
      }
    }
  }catch(err){
    mostrarToast(err.message || String(err), "error");
    if(vista) refrescarSeleccion(true);
  }
}
