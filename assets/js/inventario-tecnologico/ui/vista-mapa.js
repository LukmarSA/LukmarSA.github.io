// Pestaña "Mapa": ubicaciones (torres, oficinas, bodegas…), sus equipos de
// radioenlace, la jerarquía servidor → clientes y los activos de cada lugar.
//
// Flujo principal:
//   1. Marcadores de ubicaciones y las líneas de la red: backbone (un
//      servidor con un solo cliente, gruesa) y distribución P2MP (varios
//      clientes, delgada). Un servidor con más de 8 clientes se agrupa en un
//      indicador hasta que se lo selecciona o se fijan sus líneas.
//   2. Clic en un marcador → el panel lista sus equipos (y sus activos).
//   3. Clic en un equipo → se resalta su camino hasta la raíz y se atenúa el
//      resto. Clic en el marcador de su servidor (o de un cliente) → pasa a
//      ese equipo.
//   4. Simulación de fallas (solo en el navegador, nada se guarda): "Simular
//      caída de este equipo" corta su enlace de subida; cada equipo sin camino
//      conmuta solo a su respaldo de mejor prioridad con servicio, y lo que no
//      tiene salida se marca sin conectividad.
//
// Misma convención que las demás vistas: renderVistaMapa(main) arma todo
// dentro de <main>. Como Leaflet engancha listeners a window, renderMain()
// llama a destruirVistaMapa() al salir de la pestaña.
import { cargarActivos } from "../nucleo/datos.js";
import { cargarPiscinas, cargarPlanoMapa, estadoMapa, hayMedio, hayPiscinas, hayRedFinca, indicesMapa, redMapa, refrescarDatosMapa, refrescarPlanoMapa, simulacionMapa } from "../nucleo/datos-mapa.js";
import { cajaPiscinas } from "../nucleo/piscinas.js";
import { caidosEfectivos } from "../nucleo/mapa-nombres.js";
import { cajaEsquinas } from "../nucleo/plano-mapa.js";
import { state } from "../nucleo/estado.js";
import { fmtCoordenadas, fmtDistancia } from "../nucleo/geo.js";
import { esc, fmtTag } from "../nucleo/helpers.js";
import { buscarEnMapa, infoTipoUbicacion, resumenMapa, traducirErrorMapa, ubicacionesVisibles } from "../nucleo/mapa-logica.js";
import { ESTADOS_SIMULACION, ROLES, UMBRAL_AGRUPAR_CLIENTES, caminoARaiz, claveRed, contarRoles, equipoVisible, estadoPorUbicacion, planDeAgrupados, planDeLineas, resumenRed } from "../nucleo/mapa-jerarquia.js";
import { esAdmin, puede } from "../nucleo/permisos.js";
import { editarPiscina, eliminarEquipo, eliminarRespaldo, eliminarUbicacion, establecerUbicacionActiva, guardarAjustePlano, quitarActivoDeUbicacion } from "../negocio/operaciones-mapa.js";
import { urlFoto } from "../negocio/operaciones.js";
import { abrirDetalle } from "./detalle/vista.js";
import { abrirAsignacionEnLote, abrirAsignarActivos, abrirEditarAtajo, abrirFormEquipo, abrirFormPiscina, abrirFormRespaldo, abrirFormUbicacion, abrirGuardarAtajo, abrirMoverActivo, abrirRedesYTipos } from "./mapa/formularios.js";
import { CAPAS_BASE, CAPAS_SUPERPUESTAS, CENTRO_POR_DEFECTO, ESTILOS_CON_HALO, ESTILOS_LINEA, HALO, OPACIDAD_ATENUADA, capaBaseInicial, cargarLeaflet, crearCapasBase, iconoAgrupado, iconoUbicacion, recordarCapaBase, recordarSuperpuesta, superpuestaInicial } from "./mapa/leaflet.js";
import { htmlPanelCargando, htmlPanelError, htmlPanelResumen, htmlPanelUbicacion } from "./mapa/panel.js";
import { crearCapaPlano, crearControlPlano, crearPanesPlano, htmlLeyendaPlano, iniciarAjustePlano, opacidadInicial, recordarOpacidad } from "./mapa/plano.js";
import { ZOOM_ROTULOS, crearControlPiscinas, crearPanesPiscinas, htmlPopupPiscina, iniciarEdicionPiscina, pintarPiscinas } from "./mapa/piscinas.js";
import { abrirCarruselFotos, cerrarModal, confirmarAccion, mostrarToast, renderMain } from "./render-raiz.js";
import { expandir, plegarFantasma } from "./transiciones.js";

const P = "inventario-tecnologico-";

let vista = null;     // { L, mapa, capaLineas, capaMarcadores, capaAgrupados, marcadores, main, colocando, alTeclear, ... }
let generacion = 0;   // invalida cargas en curso si se sale de la pestaña antes de que terminen
let alClicFueraBuscador = null;
let ubicacionEnPanel = null; // para conservar el scroll del panel solo si sigue mostrando la misma ubicación

const LINEAS = [
  { id: "backbone", etiqueta: "Backbone", ayuda: "Enlaces punto a punto: servidor con un solo cliente." },
  { id: "p2mp", etiqueta: "P2MP", ayuda: "Distribución punto-multipunto: servidor con varios clientes." },
  { id: "cable", etiqueta: "Cable/fibra", ayuda: "Cable o fibra entre dos ubicaciones (migración 008)." },
  { id: "respaldos", etiqueta: "Respaldos", ayuda: "Enlaces de respaldo registrados (normalmente ocultos)." },
];

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

  // refrescarPlanoMapa() nunca rechaza: sin la migración 006 la capa Plano usa el plano que trae la app.
  const [rLeaflet, rDatos] = await Promise.allSettled([cargarLeaflet(), refrescarDatosMapa(), refrescarPlanoMapa()]);
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
  refrescar();
  if(vista && !vista.encuadrado){ encuadrarTodo(); vista.encuadrado = true; }
  aplicarFocoPendiente();
}

export function destruirVistaMapa(){
  generacion++;
  ubicacionEnPanel = null;
  if(alClicFueraBuscador){ document.removeEventListener("click", alClicFueraBuscador); alClicFueraBuscador = null; }
  if(!vista) return;
  if(vista.ajustePlano){ try{ vista.ajustePlano.terminar(); }catch(e){ /* el mapa ya se está desarmando */ } }
  if(vista.edicionPiscina){ try{ vista.edicionPiscina.terminar(); }catch(e){ /* el mapa ya se está desarmando */ } }
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

// Para las pruebas en navegador (tests/mapa-smoke.mjs): el mapa de Leaflet activo.
export function mapaActual(){ return vista ? vista.mapa : null; }

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
        <span class="${P}fb-spacer"></span>
        <button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-recargar" title="Volver a leer ubicaciones, equipos y respaldos desde la base">Recargar</button>
        ${esAdmin() ? `<button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-redes-tipos" hidden aria-label="Redes y tipos" title="Redes de la finca y tipos de equipo (nombre automático)">Redes y tipos</button>` : ""}
        ${esAdmin() ? `<button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-lote" hidden aria-label="Tipo y red en lote" title="Elegir el tipo y la red de varios equipos a la vez">Tipo y red en lote</button>` : ""}
        ${esAdmin() ? `<button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" id="${P}mapa-nueva-ubicacion">+ Ubicación</button>` : ""}
        <details class="${P}mapa-filtros-det" id="${P}mapa-filtros-det" open>
        <summary class="${P}mapa-filtros-resumen">Filtros y capas <span class="${P}mapa-chip-n" id="${P}mapa-filtros-cuenta"></span></summary>
        <div class="${P}mapa-filtros" role="toolbar" aria-label="Capas y filtros del mapa">
          <div class="${P}mapa-filtro-grupo" role="group" aria-label="Ubicaciones">
            <span class="${P}mapa-filtro-titulo">Ubicaciones</span>
            <div class="${P}mapa-chips" id="${P}mapa-chips"></div>
            <label class="${P}mapa-check"><input type="checkbox" id="${P}mapa-ver-archivadas"> Archivadas</label>
          </div>
          <div class="${P}mapa-filtro-grupo" role="group" aria-label="Líneas">
            <span class="${P}mapa-filtro-titulo">Líneas</span>
            <div class="${P}mapa-chips" id="${P}mapa-chips-lineas"></div>
          </div>
          <div class="${P}mapa-filtro-grupo" role="group" aria-label="Equipos por tipo">
            <span class="${P}mapa-filtro-titulo">Equipos</span>
            <div class="${P}mapa-chips" id="${P}mapa-chips-roles"></div>
          </div>
          <div class="${P}mapa-filtro-grupo" role="group" aria-label="Redes" id="${P}mapa-grupo-redes" hidden>
            <span class="${P}mapa-filtro-titulo">Redes</span>
            <div class="${P}mapa-chips" id="${P}mapa-chips-redes"></div>
            <button type="button" class="${P}mapa-chip ${P}mapa-chip-color-red" id="${P}mapa-color-red" data-color-red="1" aria-pressed="false" title="Pintar cada línea con el color de la red de su equipo">Colorear líneas por red</button>
          </div>
          <div class="${P}mapa-filtro-grupo ${P}mapa-filtro-simulacion" role="group" aria-label="Simulación de fallas">
            <button type="button" class="${P}mapa-chip ${P}mapa-chip-sim" id="${P}mapa-simulacion" aria-pressed="false" title="Activar o apagar la simulación de fallas (no se guarda nada)">Simulación de fallas</button>
            <div class="${P}mapa-chips" id="${P}mapa-chips-estados" hidden></div>
            <button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-sim-restablecer" hidden>Restablecer simulación</button>
          </div>
        </div>
        </details>
      </div>
      <div class="${P}mapa-layout">
        <div class="${P}mapa-lienzo-wrap">
          <div id="${P}mapa-canvas" class="${P}mapa-canvas" aria-label="Mapa de ubicaciones"></div>
          <div class="${P}mapa-aviso" id="${P}mapa-aviso" hidden>
            <span>Haz clic en el mapa donde está la ubicación.</span>
            <button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-aviso-cancelar">Cancelar (Esc)</button>
          </div>
          <div class="${P}mapa-aviso ${P}mapa-aviso-sim" id="${P}mapa-aviso-sim" role="status" hidden></div>
          <details class="${P}mapa-leyenda" id="${P}mapa-leyenda">
            <summary>Leyenda</summary>
            <ul>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-backbone"></span>Backbone (punto a punto)</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-p2mp"></span>Distribución P2MP</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-cable"></span>Cable entre ubicaciones</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-fibra"></span>Fibra entre ubicaciones</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-respaldo"></span>Respaldo registrado</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-cadena"></span>Camino a la raíz</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-recuperado"></span>Recuperado vía respaldo</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-cortado"></span>Enlace cortado (simulado)</li>
              <li><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-sinConexion"></span>Sin conectividad</li>
            </ul>
            <ul class="${P}mapa-leyenda-redes" id="${P}mapa-leyenda-redes" aria-label="Colores de las redes" hidden></ul>
            <ul class="${P}mapa-leyenda-piscinas" id="${P}mapa-leyenda-piscinas" aria-label="Piscinas" hidden>
              <li><span class="${P}mapa-leyenda-piscina"></span>Piscina (clic: nombre y hectáreas)</li>
              <li><span class="${P}mapa-leyenda-piscina ${P}mapa-leyenda-piscina-revisar"></span>Piscina por revisar</li>
            </ul>
            <ul class="${P}mapa-leyenda-plano" id="${P}mapa-leyenda-plano" aria-label="Plano de la camaronera" hidden>
              <li class="${P}mapa-leyenda-subtitulo">Plano</li>
              ${htmlLeyendaPlano()}
            </ul>
          </details>
        </div>
        <aside class="${P}mapa-panel" id="${P}mapa-panel" aria-label="Detalle de la ubicación"></aside>
      </div>
    </div>`;
}

function crearMapa(L, main){
  const canvas = main.querySelector(`#${P}mapa-canvas`);
  const mapa = L.map(canvas, { zoomControl: true, worldCopyJump: true }).setView([CENTRO_POR_DEFECTO.lat, CENTRO_POR_DEFECTO.lng], CENTRO_POR_DEFECTO.zoom);
  crearPanesPlano(mapa);
  crearPanesPiscinas(mapa);
  const capaPlano = crearCapaPlano(L, cargarPlanoMapa(), { opacidad: opacidadInicial() });
  const capaPiscinas = L.layerGroup();
  const capas = crearCapasBase(L);
  const inicial = capaBaseInicial();
  capas[inicial].addTo(mapa);
  // Capas base (radio: una a la vez) y superpuestas (casillas): el plano de
  // lotes va encima del mapa de carreteras o del satélite. La de piscinas
  // (migración 009) se suma al control cuando hay datos (pintarPiscinas).
  const controlCapas = L.control.layers(
    Object.fromEntries(Object.entries(capas).map(([id, capa])=>[CAPAS_BASE[id].etiqueta, capa])),
    { [CAPAS_SUPERPUESTAS.plano.etiqueta]: capaPlano },
    { position: "topright" }).addTo(mapa);
  mapa.on("baselayerchange", e=>{
    const id = Object.keys(capas).find(k=>capas[k] === e.layer);
    if(id) recordarCapaBase(id);
  });
  mapa.on("overlayadd overlayremove", e=>{
    if(!vista) return;
    const encendida = e.type === "overlayadd";
    if(e.layer === vista.capaPlano){ recordarSuperpuesta("plano", encendida); alternarPlano(encendida); }
    else if(e.layer === vista.capaPiscinas){ recordarSuperpuesta("piscinas", encendida); alternarPiscinas(encendida); }
  });
  L.control.scale({ metric: true, imperial: false }).addTo(mapa);
  const capaLineas = L.layerGroup().addTo(mapa);
  const capaMarcadores = L.layerGroup().addTo(mapa);
  const capaAgrupados = L.layerGroup().addTo(mapa);
  mapa.on("click", alClicMapa);
  mapa.on("contextmenu", alClicDerechoMapa);

  vista = { L, mapa, capaLineas, capaMarcadores, capaAgrupados, marcadores: new Map(), main, colocando: null, encuadrado: false, alTeclear: null,
    capas, capaPlano, controlCapas, controlPlano: null, ajustePlano: null,
    capaPiscinas, piscinasEnControl: false, piscinasVisibles: false, piscinasSoloRevisar: false, piscinasDibujadas: null,
    controlPiscinas: null, edicionPiscina: null, edicionPiscinaId: null };
  // Los nombres de las piscinas se ven solo de cerca.
  const rotulos = ()=>{ if(vista && vista.mapa === mapa) canvas.classList.toggle(`${P}mapa-sin-rotulos`, mapa.getZoom() < ZOOM_ROTULOS); };
  mapa.on("zoomend", rotulos);
  rotulos();
  mapa.on("popupopen", e=>{
    const el = e.popup.getElement();
    if(el && el.querySelector(`.${P}mapa-piscina-popup`)) el.addEventListener("click", alClicPopupPiscina);
  });
  if(superpuestaInicial("plano")){ capaPlano.addTo(mapa); alternarPlano(true); }

  // Captura: corre antes que el Esc de los modales (render-raiz.js), así
  // puede ignorar la tecla si hay un modal abierto.
  vista.alTeclear = e=>{
    if(e.key !== "Escape" || state.vista !== "mapa" || !vista) return;
    if(hayModalAbierto()) return;
    if(vista.ajustePlano || vista.edicionPiscina) return; // el Esc lo manejan "Ajustar plano" y el editor de piscinas
    if(vista.mapa.getContainer().querySelector(".leaflet-popup")){ e.preventDefault(); vista.mapa.closePopup(); return; } // primero se cierra la ventanita de una piscina
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
// Cálculo compartido de un repintado: red, simulación, visibilidad y camino.
// ---------------------------------------------------------------------------
function calcular(){
  const m = estadoMapa();
  const idx = indicesMapa();
  const red = redMapa();
  const sim = simulacionMapa(red);
  const f = m.filtros;
  const s = m.seleccion;
  const seleccionId = s.equipoId && red.equipoPorId.has(s.equipoId) ? s.equipoId : null;
  const camino = seleccionId !== null ? caminoARaiz(red, seleccionId, sim) : [];
  const ubicacionesCamino = new Set(camino.map(id=>red.equipoPorId.get(id).ubicacion_id));
  const ubicacionesClientes = new Set(seleccionId !== null ? (red.clientes.get(seleccionId) || []).map(c=>c.ubicacion_id) : []);
  const visibleEquipo = id=>equipoVisible(red, id, f, sim);
  const base = new Set(ubicacionesVisibles(m.ubicaciones, f).map(u=>u.id));
  // Una ubicación se oculta por los filtros de equipos solo si TODOS sus
  // equipos quedaron ocultos; la seleccionada y las del camino se ven siempre.
  const visibleUbicacion = id=>{
    if(id === s.ubicacionId || ubicacionesCamino.has(id)) return true;
    if(!base.has(id)) return false;
    const equipos = idx.equiposPorUbicacion.get(id) || [];
    return !equipos.length || equipos.some(e=>visibleEquipo(e.id));
  };
  return { m, idx, red, sim, seleccionId, camino, ubicacionesCamino, ubicacionesClientes, visibleEquipo, visibleUbicacion, expandidos: new Set(m.expandidos), estadoUbicaciones: estadoPorUbicacion(red, sim) };
}

function contextoPanel(c){
  const m = c.m;
  const activos = cargarActivos().activos;
  return {
    indices: c.idx,
    red: c.red,
    sim: c.sim,
    simActiva: !!c.sim,
    expandidos: c.expandidos,
    umbralAgrupar: UMBRAL_AGRUPAR_CLIENTES,
    tipos: m.tiposUbicacion,
    seleccion: m.seleccion,
    esAdmin: esAdmin(),
    puedeAsignar: puede("asignar_ubicacion"),
    puedeSimular: puede("ver_mapa"),
    // Red de la finca (007)
    red007: hayRedFinca(),
    atajos: m.atajos,
    simEstado: m.simulacion,
    redPorId: new Map(m.redes.map(r=>[r.id, r])),
    tipoPorValor: new Map(m.tiposEquipo.map(x=>[x.valor, x])),
    ubicacionesVisibles: m.ubicaciones.filter(u=>c.visibleUbicacion(u.id)),
    ubicacionesTotal: m.ubicaciones.length,
    estadoUbicaciones: c.estadoUbicaciones,
    resumen: resumenMapa(c.idx, { ubicaciones: m.ubicaciones, equipos: m.equipos, activos, red: c.red }),
    resumenRed: resumenRed(c.red),
  };
}

// Repinta todo: barra de filtros, marcadores, líneas, indicadores y panel.
function refrescar(){
  const c = calcular();
  const botonRedes = document.getElementById(`${P}mapa-redes-tipos`);
  if(botonRedes) botonRedes.hidden = !hayRedFinca();
  const botonLote = document.getElementById(`${P}mapa-lote`);
  if(botonLote) botonLote.hidden = !hayRedFinca() || !estadoMapa().equipos.length;
  pintarFiltros(c);
  pintarAvisoSimulacion(c);
  if(vista){
    pintarMarcadores(c);
    pintarLineas(c);
    pintarAgrupados(c);
    prepararPiscinas();
  }
  pintarPanel(c);
}

// ---------------------------------------------------------------------------
// Barra de filtros (se repinta con los conteos al día)
// ---------------------------------------------------------------------------
function chip({ data, valor, pressed, color = null, etiqueta, n = null, titulo = "", extra = "" }){
  return `<button type="button" class="${P}mapa-chip" data-${data}="${esc(valor)}" aria-pressed="${pressed}"${color ? ` style="--chip-color:${esc(color)}"` : ""} title="${esc(titulo)}">${extra || (color ? `<span class="${P}mapa-chip-punto"></span>` : "")}${esc(etiqueta)}${n !== null ? ` <span class="${P}mapa-chip-n">${n}</span>` : ""}</button>`;
}

function pintarFiltros(c){
  const m = c.m;
  const f = m.filtros;
  const cont = document.getElementById(`${P}mapa-chips`);
  if(!cont) return;
  const usados = new Set(m.ubicaciones.map(u=>u.tipo));
  const tipos = m.tiposUbicacion.filter(t=>t.activo !== false || usados.has(t.valor));
  cont.innerHTML = tipos.map(t=>{
    const n = m.ubicaciones.filter(u=>u.tipo === t.valor && (f.verArchivadas || u.activa !== false)).length;
    const visible = !f.tiposOcultos.includes(t.valor);
    return chip({ data: "tipo", valor: t.valor, pressed: visible, color: t.color, etiqueta: t.etiqueta, n, titulo: `${visible ? "Ocultar" : "Mostrar"} ${t.etiqueta}` });
  }).join("");
  const va = document.getElementById(`${P}mapa-ver-archivadas`);
  if(va) va.checked = f.verArchivadas;

  const rr = resumenRed(c.red);
  const nLineas = { backbone: rr.backbone, p2mp: rr.p2mp, cable: rr.cable, respaldos: rr.respaldos };
  // "Cable/fibra" solo aparece con la 008 o si ya hay alguno.
  document.getElementById(`${P}mapa-chips-lineas`).innerHTML = LINEAS.filter(l=>l.id !== "cable" || hayMedio() || rr.cable).map(l=>chip({
    data: "linea", valor: l.id, pressed: !!f.lineas[l.id], etiqueta: l.etiqueta, n: nLineas[l.id],
    titulo: `${f.lineas[l.id] ? "Ocultar" : "Mostrar"}: ${l.ayuda}`, extra: `<span class="${P}mapa-chip-linea ${P}mapa-chip-linea-${l.id}"></span>`,
  })).join("");

  const nRoles = contarRoles(c.red);
  document.getElementById(`${P}mapa-chips-roles`).innerHTML = ROLES.map(r=>chip({
    data: "rol", valor: r.id, pressed: !f.rolesOcultos.includes(r.id), color: r.color, etiqueta: r.etiqueta, n: nRoles[r.id] || 0,
    titulo: `${f.rolesOcultos.includes(r.id) ? "Mostrar" : "Ocultar"}: ${r.ayuda}`,
  })).join("");

  // Redes de la finca (007): un chip por red (y "Sin red"), más colorear las líneas.
  const grupoRedes = document.getElementById(`${P}mapa-grupo-redes`);
  if(grupoRedes){
    const hayRedes = hayRedFinca() && m.redes.length > 0;
    grupoRedes.hidden = !hayRedes;
    if(hayRedes){
      const n = new Map();
      for(const e of m.equipos){ const k = claveRed(e); n.set(k, (n.get(k) || 0) + 1); }
      const opciones = [...m.redes.map(r=>({ valor: String(r.id), etiqueta: r.nombre, color: r.color })), ...(n.get("sin") ? [{ valor: "sin", etiqueta: "Sin red", color: "#8B9AAA" }] : [])];
      document.getElementById(`${P}mapa-chips-redes`).innerHTML = opciones.map(o=>{
        const visible = !f.redesOcultas.includes(o.valor);
        return chip({ data: "red", valor: o.valor, pressed: visible, color: o.color, etiqueta: o.etiqueta, n: n.get(o.valor) || 0, titulo: `${visible ? "Ocultar" : "Mostrar"} los equipos de «${o.etiqueta}»` });
      }).join("");
      document.getElementById(`${P}mapa-color-red`).setAttribute("aria-pressed", String(!!f.colorPorRed));
    }
    const leyendaRedes = document.getElementById(`${P}mapa-leyenda-redes`);
    if(leyendaRedes){
      leyendaRedes.hidden = !(hayRedes && f.colorPorRed);
      leyendaRedes.innerHTML = hayRedes && f.colorPorRed ? `<li class="${P}mapa-leyenda-subtitulo">Líneas por red</li>` + m.redes.map(r=>`<li><span class="${P}mapa-leyenda-linea" style="border-top:4px solid ${esc(r.color)}"></span>${esc(r.nombre)}</li>`).join("") : "";
    }
  }

  const cuentaFiltros = document.getElementById(`${P}mapa-filtros-cuenta`);
  if(cuentaFiltros){
    const activos = f.tiposOcultos.length + f.rolesOcultos.length + (c.sim ? f.estadosOcultos.length + 1 : 0) + (f.verArchivadas ? 1 : 0)
      + (f.lineas.backbone ? 0 : 1) + (f.lineas.p2mp ? 0 : 1) + (f.lineas.cable === false ? 1 : 0) + (f.lineas.respaldos ? 1 : 0) + f.redesOcultas.length;
    cuentaFiltros.textContent = activos ? `${activos} activo${activos === 1 ? "" : "s"}${c.sim ? " · simulación" : ""}` : "";
  }

  const botonSim = document.getElementById(`${P}mapa-simulacion`);
  const estados = document.getElementById(`${P}mapa-chips-estados`);
  const restablecer = document.getElementById(`${P}mapa-sim-restablecer`);
  botonSim.setAttribute("aria-pressed", String(!!c.sim));
  estados.hidden = !c.sim;
  restablecer.hidden = !(c.sim && c.sim.caidos.size);
  estados.innerHTML = c.sim ? ESTADOS_SIMULACION.map(e=>chip({
    data: "estado", valor: e.id, pressed: !f.estadosOcultos.includes(e.id), color: e.color, etiqueta: e.etiqueta, n: c.sim.cuentas[e.id] || 0,
    titulo: `${f.estadosOcultos.includes(e.id) ? "Mostrar" : "Ocultar"} equipos: ${e.etiqueta.toLowerCase()}`,
  })).join("") : "";
}

function pintarAvisoSimulacion(c){
  const aviso = document.getElementById(`${P}mapa-aviso-sim`);
  if(!aviso) return;
  aviso.hidden = !c.sim;
  if(!c.sim) return;
  const n = c.sim.cuentas;
  // Un caído que conmutó a su propio respaldo cuenta como "caído" (los estados
  // son excluyentes), así que se aclara aparte que sí se recuperó.
  const recuperados = [...c.sim.caidos].filter(id=>(c.sim.estado.get(id) || {}).conectado).length;
  aviso.innerHTML = c.sim.caidos.size
    ? `<span><strong>Simulación:</strong> ${n.caido} caído${n.caido === 1 ? "" : "s"}${recuperados ? ` (${recuperados} recuperado${recuperados === 1 ? "" : "s"} vía respaldo)` : ""} · ${n.respaldo} vía respaldo · ${n.sin_conexion} sin conectividad</span>
       <button type="button" class="${P}btn ${P}btn-sm" data-sim-accion="restablecer">Restablecer</button>
       <button type="button" class="${P}btn ${P}btn-sm" data-sim-accion="salir">Salir</button>`
    : `<span><strong>Simulación activa.</strong> Elige un equipo y usa «Simular caída de este equipo».</span>
       <button type="button" class="${P}btn ${P}btn-sm" data-sim-accion="salir">Salir</button>`;
}

// ---------------------------------------------------------------------------
// Marcadores, líneas e indicadores
// ---------------------------------------------------------------------------
function opcionesIcono(c, u){
  const idx = c.idx;
  const equipos = (idx.equiposPorUbicacion.get(u.id) || []).length;
  // Un activo que es el radio de un equipo de esta ubicación no se cuenta dos veces.
  const activos = (idx.activosPorUbicacion.get(u.id) || []).filter(a=>{ const e = idx.equipoPorActivo.get(a.id); return !(e && e.ubicacion_id === u.id); }).length;
  const s = c.m.seleccion;
  const servidor = c.seleccionId !== null && c.camino.length > 1 ? c.red.equipoPorId.get(c.camino[1]) : null;
  const est = c.sim ? c.estadoUbicaciones.get(u.id) : null;
  const hayCadena = c.seleccionId !== null;
  return {
    color: infoTipoUbicacion(c.m.tiposUbicacion, u.tipo).color, tipo: u.tipo, cantidad: equipos + activos,
    seleccionada: s.ubicacionId === u.id,
    enlazada: !!(servidor && servidor.ubicacion_id === u.id && u.id !== s.ubicacionId),
    archivada: u.activa === false,
    atenuada: hayCadena && u.id !== s.ubicacionId && !c.ubicacionesCamino.has(u.id) && !c.ubicacionesClientes.has(u.id),
    sinConexion: !!(est && est.total && est.sinConexion === est.total),
    parcial: !!(est && est.sinConexion && est.sinConexion < est.total),
    caida: !!(est && est.caidos),
  };
}

function pintarMarcadores(c){
  const { L } = vista;
  const m = c.m;
  const enfocado = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ubicacionId : null;
  vista.capaMarcadores.clearLayers();
  vista.marcadores.clear();
  for(const u of m.ubicaciones){
    if(!c.visibleUbicacion(u.id)) continue;
    const o = opcionesIcono(c, u);
    const marcador = L.marker([u.lat, u.lng], {
      icon: iconoUbicacion(L, o),
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: o.seleccionada ? 1000 : (o.enlazada ? 500 : (o.atenuada ? -200 : 0)),
    });
    marcador.bindTooltip(esc(u.nombre), { direction: "top", className: `${P}mapa-tooltip` });
    marcador.on("click", ()=>alClicMarcador(u.id));
    marcador.on("add", ()=>{
      const el = marcador.getElement();
      if(!el) return;
      el.setAttribute("aria-label", u.nombre);
      el.dataset.ubicacionId = u.id;
      if(enfocado !== null && String(u.id) === enfocado) el.focus({ preventScroll: true });
    });
    marcador.addTo(vista.capaMarcadores);
    vista.marcadores.set(u.id, marcador);
  }
}

function textoLinea(red, d){
  const cliente = red.equipoPorId.get(d.clienteId), servidor = red.equipoPorId.get(d.servidorId);
  const partes = [`${cliente ? cliente.nombre : "?"} ← ${servidor ? servidor.nombre : "?"}`, fmtDistancia(d.distanciaKm)].filter(Boolean);
  const extra = { cortado: "enlace cortado (simulado)", sinConexion: "sin servicio en la simulación", recuperado: "recuperado vía respaldo", respaldo: `respaldo (prioridad ${d.prioridad})`, cadenaRota: "camino cortado" }[d.estilo]
    || (d.clase === "cable" ? "por cable" : d.clase === "fibra" ? "por fibra óptica" : "");
  return partes.join(" · ") + (extra ? ` — ${extra}` : "");
}

function etiquetaCorta(d){
  if(d.estilo === "recuperado" || d.estilo === "cadenaRespaldo") return `↺ vía respaldo → ${d.ubicacionRespaldo}`;
  return fmtDistancia(d.distanciaKm);
}

function pintarLineas(c){
  const { L } = vista;
  vista.capaLineas.clearLayers();
  const plan = planDeLineas(c.red, { lineas: c.m.filtros.lineas, visibleEquipo: c.visibleEquipo, visibleUbicacion: c.visibleUbicacion, sim: c.sim, seleccionId: c.seleccionId, expandidos: c.expandidos });
  // Orden de dibujo: lo atenuado abajo, lo resaltado arriba.
  const peso = d=>(d.atenuada ? 0 : 1) + (d.enCadena ? 2 : 0) + (d.estilo === "recuperado" ? 1 : 0);
  plan.sort((a, b)=>peso(a) - peso(b));
  // Colorear por red: solo las líneas normales (no la simulación ni el camino resaltado).
  const colorPorRed = c.m.filtros.colorPorRed && hayRedFinca();
  const colorRed = new Map(c.m.redes.map(r=>[r.id, r.color]));
  const colorDe = d=>{
    const e = c.red.equipoPorId.get(d.clienteId), s = c.red.equipoPorId.get(d.servidorId);
    const id = e && e.red_id !== null && e.red_id !== undefined ? e.red_id : (s ? s.red_id : null);
    return id !== null && id !== undefined ? colorRed.get(id) || null : null;
  };
  for(const d of plan){
    let estilo = ESTILOS_LINEA[d.estilo];
    if(colorPorRed && ["backbone", "p2mp", "cable", "fibra"].includes(d.estilo)){ const color = colorDe(d); if(color) estilo = { ...estilo, color }; }
    const puntos = [[d.desde.lat, d.desde.lng], [d.hasta.lat, d.hasta.lng]];
    if(ESTILOS_CON_HALO.has(d.estilo) && !d.atenuada) L.polyline(puntos, { ...HALO, weight: estilo.weight + 4 }).addTo(vista.capaLineas);
    const linea = L.polyline(puntos, d.atenuada ? { ...estilo, opacity: estilo.opacity * OPACIDAD_ATENUADA } : estilo).addTo(vista.capaLineas);
    const permanente = d.enCadena || d.estilo === "recuperado";
    if(permanente) linea.bindTooltip(esc(etiquetaCorta(d)), { permanent: true, direction: "center", className: `${P}mapa-etiqueta-enlace ${P}mapa-etiqueta-${d.estilo}` });
    else linea.bindTooltip(esc(textoLinea(c.red, d)), { sticky: true, className: `${P}mapa-tooltip` });
    linea.on("click", ()=>seleccionarEquipo(d.clienteId, { encuadrar: false }));
    const el = linea.getElement();
    if(el){
      el.dataset.clienteId = d.clienteId;
      el.dataset.servidorId = d.servidorId;
      if(d.atenuada) el.classList.add(`${P}mapa-linea-atenuada`);
      el.setAttribute("aria-label", textoLinea(c.red, d));
    }
  }
}

function pintarAgrupados(c){
  const { L } = vista;
  vista.capaAgrupados.clearLayers();
  const porUbicacion = new Map();
  for(const g of planDeAgrupados(c.red, { sim: c.sim, expandidos: c.expandidos, seleccionId: c.seleccionId })){
    if(!c.visibleUbicacion(g.ubicacionId) || !c.visibleEquipo(g.servidorId)) continue;
    const u = c.red.ubicacionPorId.get(g.ubicacionId);
    if(!u) continue;
    const indice = porUbicacion.get(g.ubicacionId) || 0;
    porUbicacion.set(g.ubicacionId, indice + 1);
    const detalle = g.servidorSinConexion ? "sin conectividad" : (g.clientesSinConexion ? `${g.clientesSinConexion} sin conectividad` : "");
    const m = L.marker([u.lat, u.lng], {
      icon: iconoAgrupado(L, { texto: esc(`${g.nombre} · ${g.clientes} clientes`), detalle: esc(detalle), expandido: g.expandido, alerta: !!detalle, indice }),
      keyboard: true, zIndexOffset: 1500,
    });
    m.on("click", ()=>seleccionarEquipo(g.servidorId));
    m.on("add", ()=>{ const el = m.getElement(); if(el){ el.dataset.servidorId = g.servidorId; el.setAttribute("aria-label", `${g.nombre}: ${g.clientes} clientes${g.expandido ? " (líneas visibles)" : ". Clic para ver sus líneas"}`); } });
    m.addTo(vista.capaAgrupados);
  }
}

// El panel se repinta entero con HTML. Para que no se note como un cambio de
// pantalla: se conserva el foco (mismo control), y al elegir otro equipo de la
// MISMA ubicación su detalle se despliega suavemente (acordeón) mientras el
// que estaba abierto se pliega.
function focoEnPanel(panel){
  const el = document.activeElement;
  if(!el || !panel.contains(el) || !el.dataset || !el.dataset.accion) return null;
  return { accion: el.dataset.accion, id: el.dataset.id };
}
function restaurarFoco(panel, foco){
  if(!foco) return;
  const sel = `[data-accion="${CSS.escape(foco.accion)}"]${foco.id !== undefined ? `[data-id="${CSS.escape(foco.id)}"]` : ""}`;
  const el = panel.querySelector(sel);
  if(el) el.focus({ preventScroll: true });
}
function mostrarEnPanel(panel, el){
  if(!el || !el.isConnected) return;
  const p = panel.getBoundingClientRect(), r = el.getBoundingClientRect();
  if(r.top >= p.top && r.bottom <= p.bottom) return;
  // Si no entra entero, que al menos se vea desde su fila.
  const delta = r.height > p.height || r.top < p.top ? r.top - p.top - 8 : r.bottom - p.bottom + 8;
  panel.scrollBy({ top: delta, behavior: "smooth" });
}

function pintarPanel(c){
  const panel = document.getElementById(`${P}mapa-panel`);
  if(!panel) return;
  const m = c.m;
  const ctx = contextoPanel(c);
  const u = m.seleccion.ubicacionId ? m.ubicaciones.find(x=>x.id === m.seleccion.ubicacionId) : null;
  const scroll = panel.scrollTop;
  const mismaUbicacion = !!u && u.id === ubicacionEnPanel;
  // Qué equipo estaba desplegado y cuánto medía su detalle (para plegarlo).
  const abiertoAntes = mismaUbicacion ? panel.querySelector(`.${P}mapa-equipo-sel`) : null;
  const idAntes = abiertoAntes ? Number(abiertoAntes.dataset.equipoId) : null;
  const detalleAntes = abiertoAntes ? abiertoAntes.querySelector(`.${P}mapa-equipo-detalle`) : null;
  const altoAntes = detalleAntes ? detalleAntes.getBoundingClientRect().height + parseFloat(getComputedStyle(detalleAntes).marginTop) + parseFloat(getComputedStyle(detalleAntes).marginBottom) : 0;
  const foco = focoEnPanel(panel);
  panel.innerHTML = u ? htmlPanelUbicacion(ctx, u) : htmlPanelResumen(ctx);
  panel.scrollTop = (u ? u.id : null) === ubicacionEnPanel ? scroll : 0;
  ubicacionEnPanel = u ? u.id : null;
  restaurarFoco(panel, foco);
  const idAhora = m.seleccion.equipoId !== null && m.seleccion.equipoId !== undefined ? m.seleccion.equipoId : null;
  const destino = m.seleccion.activoId
    ? panel.querySelector(`[data-activo-id="${m.seleccion.activoId}"]`)
    : (idAhora !== null ? panel.querySelector(`[data-equipo-id="${idAhora}"]`) : null);
  if(mismaUbicacion && idAntes !== idAhora && !m.seleccion.activoId){
    const liAntes = idAntes !== null ? panel.querySelector(`[data-equipo-id="${idAntes}"]`) : null;
    if(liAntes && altoAntes) plegarFantasma(liAntes.querySelector(`.${P}mapa-equipo-fila`), altoAntes, { antes: false });
    const detalle = destino ? destino.querySelector(`.${P}mapa-equipo-detalle`) : null;
    if(detalle){
      expandir(detalle).then(()=>mostrarEnPanel(panel, destino));
      return;
    }
    if(liAntes) return; // solo se plegó: la lista queda donde estaba
  }
  if(destino && destino.scrollIntoView) destino.scrollIntoView({ block: "nearest" });
}

// Leaflet descarta setView/fitBounds pedidos mientras anima un zoom
// (_tryAnimatedZoom devuelve true sin mover nada si _animatingZoom), y la
// animación recién marca _animatingZoom en el cuadro siguiente: dos pedidos
// seguidos (elegir una ubicación y enseguida uno de sus equipos) se pisan y
// gana el primero. Por eso se guarda solo el ÚLTIMO pedido y se aplica en el
// próximo cuadro, o al terminar la animación de zoom si hay una en curso.
function moverVista(fn){
  if(!vista) return;
  vista.movimientoPendiente = fn;
  if(vista.movimientoProgramado) return;
  vista.movimientoProgramado = true;
  const mapa = vista.mapa;
  const aplicar = ()=>{
    if(!vista || vista.mapa !== mapa) return;
    if(mapa._animatingZoom){ mapa.once("zoomend", ()=>requestAnimationFrame(aplicar)); return; }
    vista.movimientoProgramado = false;
    const pendiente = vista.movimientoPendiente;
    vista.movimientoPendiente = null;
    if(pendiente) pendiente(mapa);
  };
  requestAnimationFrame(aplicar);
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

// Si lo que se va a mostrar está oculto por un filtro de ubicaciones, se
// quita ese filtro (buscar algo y no verlo sería peor).
function asegurarVisible(u){
  const f = estadoMapa().filtros;
  if(f.tiposOcultos.includes(u.tipo)) f.tiposOcultos = f.tiposOcultos.filter(t=>t !== u.tipo);
  if(u.activa === false && !f.verArchivadas) f.verArchivadas = true;
}

export function seleccionarUbicacion(id, { centrar = false, activoId = null } = {}){
  const m = estadoMapa();
  const u = m.ubicaciones.find(x=>x.id === id);
  if(!u) return;
  asegurarVisible(u);
  m.seleccion = { ubicacionId: id, equipoId: null, activoId };
  refrescar();
  moverVista(mapa=>{
    if(centrar) mapa.setView([u.lat, u.lng], Math.max(mapa.getZoom(), 15));
    else if(!mapa.getBounds().pad(-0.1).contains([u.lat, u.lng])) mapa.panTo([u.lat, u.lng]);
  });
}

export function seleccionarEquipo(equipoId, { encuadrar = true } = {}){
  const m = estadoMapa();
  const red = redMapa();
  const e = red.equipoPorId.get(equipoId);
  if(!e) return;
  const u = red.ubicacionPorId.get(e.ubicacion_id);
  if(!u) return;
  asegurarVisible(u);
  m.seleccion = { ubicacionId: u.id, equipoId, activoId: null };
  refrescar();
  if(!encuadrar) return;
  // Encuadre: su camino hasta la raíz y sus clientes.
  const c = calcular();
  const ids = new Set([...c.ubicacionesCamino, ...c.ubicacionesClientes, u.id]);
  const puntos = [...ids].map(id=>red.ubicacionPorId.get(id)).filter(Boolean).map(x=>[x.lat, x.lng]);
  moverVista(mapa=>{
    if(puntos.length > 1) mapa.fitBounds(puntos, { padding: [70, 70], maxZoom: 15 });
    else if(!mapa.getBounds().contains([u.lat, u.lng])) mapa.panTo([u.lat, u.lng]);
  });
}

function deseleccionar(){
  estadoMapa().seleccion = { ubicacionId: null, equipoId: null, activoId: null };
  refrescar();
}

function aplicarFocoPendiente(){
  const m = estadoMapa();
  const f = m.foco;
  if(!f || !vista) return;
  m.foco = null;
  if(f.equipoId && m.equipos.some(e=>e.id === f.equipoId)) seleccionarEquipo(f.equipoId);
  else if(f.ubicacionId) seleccionarUbicacion(f.ubicacionId, { centrar: true, activoId: f.activoId || null });
}

// ---------------------------------------------------------------------------
// Simulación (en memoria: estadoMapa().simulacion)
// ---------------------------------------------------------------------------
function alternarCaida(equipoId){
  const s = estadoMapa().simulacion;
  const estaba = s.caidos.includes(equipoId);
  s.caidos = estaba ? s.caidos.filter(x=>x !== equipoId) : [...s.caidos, equipoId];
  s.activa = true;
  refrescar();
}

function restablecerSimulacion(){
  const s = estadoMapa().simulacion;
  s.caidos = [];
  s.atajos = [];
  refrescar();
}

// Atajo (007): enciende o apaga la caída de sus equipos. Encenderlo activa la
// simulación.
function alternarAtajo(id){
  const s = estadoMapa().simulacion;
  const lista = s.atajos || [];
  s.atajos = lista.includes(id) ? lista.filter(x=>x !== id) : [...lista, id];
  if(s.atajos.length) s.activa = true;
  refrescar();
}

// Equipos caídos ahora (marcados a mano + atajos encendidos), para guardarlos como atajo.
function caidosActuales(){
  const m = estadoMapa();
  const red = redMapa();
  return caidosEfectivos({ manuales: m.simulacion.caidos, atajosActivos: m.simulacion.atajos || [], atajos: m.atajos, existe: id=>red.equipoPorId.has(id) });
}

function alternarModoSimulacion(activa){
  const s = estadoMapa().simulacion;
  s.activa = activa === undefined ? !s.activa : !!activa;
  if(!s.activa) estadoMapa().filtros.estadosOcultos = [];
  refrescar();
}

// ---------------------------------------------------------------------------
// Eventos del mapa
// ---------------------------------------------------------------------------
function alClicMarcador(id){
  if(!vista || vista.colocando || vista.ajustePlano) return;
  const s = estadoMapa().seleccion;
  // Con un equipo seleccionado, clic en la ubicación de su servidor (o de uno
  // de sus clientes) pasa a ese equipo y el camino se sigue viendo.
  if(s.equipoId && id !== s.ubicacionId){
    const red = redMapa();
    const e = red.equipoPorId.get(s.equipoId);
    const servidor = e && e.servidor_id !== null && e.servidor_id !== undefined ? red.equipoPorId.get(e.servidor_id) : null;
    if(servidor && servidor.ubicacion_id === id){ seleccionarEquipo(servidor.id, { encuadrar: false }); return; }
    const clientesAhi = (red.clientes.get(s.equipoId) || []).filter(c=>c.ubicacion_id === id);
    if(clientesAhi.length === 1){ seleccionarEquipo(clientesAhi[0].id, { encuadrar: false }); return; }
  }
  if(s.ubicacionId === id && !s.equipoId) return;
  seleccionarUbicacion(id);
}

function alClicMapa(e){
  if(!vista || vista.ajustePlano || vista.edicionPiscina) return;
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
  if(!vista || vista.colocando || vista.ajustePlano || vista.edicionPiscina || !esAdmin()) return;
  abrirNuevaUbicacion({ lat: e.latlng.lat, lng: e.latlng.lng });
}

// ---------------------------------------------------------------------------
// Capa "Plano": control (opacidad, encuadrar, ajustar) y modo "Ajustar plano"
// ---------------------------------------------------------------------------
function alternarPlano(activa){
  if(!vista) return;
  if(!activa && vista.ajustePlano) vista.ajustePlano.terminar();
  if(activa && !vista.controlPlano){
    vista.controlPlano = crearControlPlano(vista.L, {
      opacidad: vista.capaPlano.options.opacity,
      puedeAjustar: esAdmin(),
      alCambiarOpacidad: v=>{ if(!vista || vista.ajustePlano) return; vista.capaPlano.setOpacity(v); recordarOpacidad(v); },
      alEncuadrar: encuadrarPlano,
      alAjustar: entrarAjustePlano,
    }).addTo(vista.mapa);
  } else if(!activa && vista.controlPlano){
    vista.controlPlano.remove();
    vista.controlPlano = null;
  }
  const leyenda = vista.main.querySelector(`#${P}mapa-leyenda-plano`);
  if(leyenda) leyenda.hidden = !activa;
}

function encuadrarPlano(){
  if(!vista) return;
  const caja = cajaEsquinas(vista.capaPlano.getEsquinas());
  moverVista(mapa=>mapa.fitBounds(caja, { padding: [24, 24] })); // espera si hay un zoom animándose
}

function entrarAjustePlano(){
  if(!vista || vista.ajustePlano || !esAdmin()) return;
  if(vista.edicionPiscina) vista.edicionPiscina.terminar(); // no se mezclan los dos modos
  if(vista.colocando){ mostrarToast("Primero termina de colocar la ubicación (o cancela con Esc).", "info"); return; }
  const plano = cargarPlanoMapa();
  const contenedor = vista.main.querySelector(`.${P}mapa-lienzo-wrap`);
  if(vista.controlPlano) vista.controlPlano.getContainer().hidden = true;
  vista.ajustePlano = iniciarAjustePlano({
    L: vista.L,
    mapa: vista.mapa,
    capa: vista.capaPlano,
    contenedor,
    esquinasGuardadas: plano.esquinas,
    esquinasOriginales: plano.esquinasOriginales,
    alGuardar: async esquinas=>{
      try{
        await guardarAjustePlano(cargarPlanoMapa(), esquinas);
        mostrarToast("Ajuste del plano guardado: todos los usuarios lo ven así.", "success");
      }catch(err){
        mostrarToast(err.message || String(err), "error");
        throw err;
      }
    },
    alTerminar: ()=>{
      if(!vista) return;
      vista.ajustePlano = null;
      if(vista.controlPlano) vista.controlPlano.getContainer().hidden = false;
    },
  });
}

// ---------------------------------------------------------------------------
// Capa "Piscinas" (migración 009): se suma al selector de capas cuando la
// tabla existe; al encenderla aparece su control (cuántas hay, ver todas,
// solo por revisar, + nueva) y cada piscina abre una ventanita al hacer clic.
// El administrador edita la forma (vértices) y los datos.
// ---------------------------------------------------------------------------
function prepararPiscinas(){
  if(!vista || !hayPiscinas()) return;
  if(!vista.piscinasEnControl){
    vista.controlCapas.addOverlay(vista.capaPiscinas, CAPAS_SUPERPUESTAS.piscinas.etiqueta);
    vista.piscinasEnControl = true;
    if(superpuestaInicial("piscinas")){ vista.capaPiscinas.addTo(vista.mapa); alternarPiscinas(true); return; }
  }
  // Solo se redibujan si cambiaron los datos (refrescar() corre en cada selección).
  if(vista.piscinasVisibles && vista.piscinasDibujadas !== cargarPiscinas()) pintarPiscinasVista();
}

function pintarPiscinasVista(){
  if(!vista) return;
  const piscinas = cargarPiscinas();
  vista.piscinasDibujadas = piscinas;
  pintarPiscinas({ L: vista.L, capa: vista.capaPiscinas, piscinas, soloRevisar: vista.piscinasSoloRevisar, ocultar: vista.edicionPiscinaId, alClic: abrirPopupPiscina });
  if(vista.controlPiscinas) vista.controlPiscinas.actualizar({ total: piscinas.filter(p=>p.activa !== false).length, revisar: piscinas.filter(p=>p.activa !== false && p.revisar).length, soloRevisar: vista.piscinasSoloRevisar });
}

function alternarPiscinas(visible){
  if(!vista) return;
  vista.piscinasVisibles = visible;
  if(!visible && vista.edicionPiscina) vista.edicionPiscina.terminar();
  if(visible && !vista.controlPiscinas){
    vista.controlPiscinas = crearControlPiscinas(vista.L, {
      puedeEditar: esAdmin(),
      alEncuadrar: encuadrarPiscinas,
      alSoloRevisar: v=>{ vista.piscinasSoloRevisar = v; pintarPiscinasVista(); if(v) encuadrarPiscinas(); },
      alNueva: nuevaPiscina,
    }).addTo(vista.mapa);
  } else if(!visible && vista.controlPiscinas){
    vista.controlPiscinas.remove();
    vista.controlPiscinas = null;
  }
  if(visible) pintarPiscinasVista(); else { vista.capaPiscinas.clearLayers(); vista.piscinasDibujadas = null; vista.mapa.closePopup(); }
  const leyenda = vista.main.querySelector(`#${P}mapa-leyenda-piscinas`);
  if(leyenda) leyenda.hidden = !visible;
}

function encuadrarPiscinas(){
  if(!vista) return;
  const lista = cargarPiscinas().filter(p=>p.activa !== false && (!vista.piscinasSoloRevisar || p.revisar));
  const caja = cajaPiscinas(lista);
  if(caja) vista.mapa.fitBounds(caja, { padding: [30, 30], maxZoom: 18 });
}

function abrirPopupPiscina(id, latlng){
  if(!vista || vista.edicionPiscina) return;
  const p = cargarPiscinas().find(x=>x.id === id);
  if(!p) return;
  vista.L.popup({ className: `${P}mapa-piscina-popup-leaflet`, maxWidth: 280, autoPanPadding: [20, 20] })
    .setLatLng(latlng).setContent(htmlPopupPiscina(p, { esAdmin: esAdmin() })).openOn(vista.mapa);
}

function alClicPopupPiscina(e){
  const b = e.target.closest("[data-piscina-accion]");
  if(!b || !vista) return;
  const id = Number(b.dataset.id);
  vista.mapa.closePopup();
  if(b.dataset.piscinaAccion === "forma") editarFormaPiscina(id);
  else if(b.dataset.piscinaAccion === "datos") abrirFormPiscina({ id }, { alGuardar: ()=>refrescarTrasPiscina(), alEliminar: ()=>refrescarTrasPiscina() });
}

function refrescarTrasPiscina(){
  if(!document.getElementById(`${P}mapa-panel`)) return;
  refrescar();
  if(vista && vista.piscinasVisibles) pintarPiscinasVista();
}

function nuevaPiscina(){
  if(!vista || !esAdmin()) return;
  const c = vista.mapa.getCenter();
  abrirFormPiscina({ centro: [c.lat, c.lng] }, { alGuardar: (id, { nueva } = {})=>{ refrescarTrasPiscina(); if(nueva) editarFormaPiscina(id); } });
}

function editarFormaPiscina(id){
  if(!vista || vista.edicionPiscina || !esAdmin()) return;
  const piscina = cargarPiscinas().find(p=>p.id === id);
  if(!piscina) return;
  if(vista.ajustePlano) vista.ajustePlano.terminar();
  if(vista.colocando) cancelarColocacion();
  if(!vista.piscinasVisibles){ vista.capaPiscinas.addTo(vista.mapa); alternarPiscinas(true); }
  vista.edicionPiscinaId = id;
  pintarPiscinasVista();
  if(vista.controlPiscinas) vista.controlPiscinas.getContainer().hidden = true;
  // De cerca, para que los puntos se puedan tomar (arriba queda lugar para la barra).
  vista.mapa.fitBounds(vista.L.latLngBounds(piscina.puntos), { paddingTopLeft: [40, 120], paddingBottomRight: [40, 40], maxZoom: 18, animate: false });
  const contenedor = vista.main.querySelector(`.${P}mapa-lienzo-wrap`);
  vista.edicionPiscina = iniciarEdicionPiscina({
    L: vista.L, mapa: vista.mapa, piscina, contenedor,
    alGuardar: async puntos=>{
      try{
        await editarPiscina(id, { puntos, fuente: "manual" });
        mostrarToast(`Forma de ${piscina.nombre} guardada.${piscina.revisar ? " Si ya quedó bien, desmarca «Por revisar» en «Editar datos»." : ""}`, "success");
      }catch(err){
        mostrarToast(err.message || String(err), "error");
        throw err;
      }
    },
    alTerminar: ()=>{
      if(!vista) return;
      vista.edicionPiscina = null;
      vista.edicionPiscinaId = null;
      if(vista.controlPiscinas) vista.controlPiscinas.getContainer().hidden = false;
      pintarPiscinasVista();
    },
  });
}

function entrarEnColocacion(alColocar, alCancelar){
  if(!vista) return;
  if(vista.ajustePlano) vista.ajustePlano.terminar(); // no se mezclan los dos modos
  if(vista.edicionPiscina) vista.edicionPiscina.terminar();
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
    if(!document.getElementById(`${P}mapa-panel`)) return;
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
// Barra superior: buscador, filtros, simulación, recargar, + Ubicación
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

  // En pantallas angostas (celular, o el panel lateral de un navegador) los
  // filtros arrancan plegados para que el mapa se vea sin bajar; en escritorio
  // siempre están desplegados.
  const detalles = main.querySelector(`#${P}mapa-filtros-det`);
  const angosta = window.matchMedia ? window.matchMedia("(max-width: 720px)") : null;
  if(detalles && angosta){
    detalles.open = !angosta.matches;
    const alCambiar = e=>{ if(!e.matches && detalles.isConnected) detalles.open = true; };
    if(angosta.addEventListener) angosta.addEventListener("change", alCambiar);
  }

  // Toggles: todos editan estadoMapa().filtros y repintan.
  const alternarEnLista = (lista, valor)=>lista.includes(valor) ? lista.filter(x=>x !== valor) : [...lista, valor];
  main.querySelector(`.${P}mapa-filtros`).addEventListener("click", e=>{
    const m = estadoMapa();
    const f = m.filtros;
    const t = e.target.closest("[data-tipo]");
    const l = e.target.closest("[data-linea]");
    const r = e.target.closest("[data-rol]");
    const s = e.target.closest("[data-estado]");
    const rd = e.target.closest("[data-red]");
    if(rd){
      f.redesOcultas = alternarEnLista(f.redesOcultas, rd.dataset.red);
    } else if(e.target.closest("[data-color-red]")){
      f.colorPorRed = !f.colorPorRed;
    } else if(t){
      f.tiposOcultos = alternarEnLista(f.tiposOcultos, t.dataset.tipo);
      const u = m.seleccion.ubicacionId ? m.ubicaciones.find(x=>x.id === m.seleccion.ubicacionId) : null;
      if(u && f.tiposOcultos.includes(u.tipo)) m.seleccion = { ubicacionId: null, equipoId: null, activoId: null };
    } else if(l){
      f.lineas = { ...f.lineas, [l.dataset.linea]: !f.lineas[l.dataset.linea] };
    } else if(r){
      f.rolesOcultos = alternarEnLista(f.rolesOcultos, r.dataset.rol);
    } else if(s){
      f.estadosOcultos = alternarEnLista(f.estadosOcultos, s.dataset.estado);
    } else if(e.target.closest(`#${P}mapa-simulacion`)){
      return alternarModoSimulacion();
    } else if(e.target.closest(`#${P}mapa-sim-restablecer`)){
      return restablecerSimulacion();
    } else return;
    refrescar();
  });
  main.querySelector(`#${P}mapa-ver-archivadas`).addEventListener("change", e=>{
    const m = estadoMapa();
    m.filtros.verArchivadas = e.target.checked;
    const u = m.seleccion.ubicacionId ? m.ubicaciones.find(x=>x.id === m.seleccion.ubicacionId) : null;
    if(u && u.activa === false && !m.filtros.verArchivadas) m.seleccion = { ubicacionId: null, equipoId: null, activoId: null };
    refrescar();
  });
  main.querySelector(`#${P}mapa-aviso-sim`).addEventListener("click", e=>{
    const b = e.target.closest("[data-sim-accion]");
    if(!b) return;
    if(b.dataset.simAccion === "restablecer") restablecerSimulacion();
    else alternarModoSimulacion(false);
  });
  main.querySelector(`#${P}mapa-recargar`).addEventListener("click", e=>recargar(e.currentTarget));
  const redesTipos = main.querySelector(`#${P}mapa-redes-tipos`);
  const trasCatalogo = ()=>{ if(document.getElementById(`${P}mapa-panel`)) refrescar(); };
  if(redesTipos) redesTipos.addEventListener("click", ()=>abrirRedesYTipos({ alCambiar: trasCatalogo }));
  const lote = main.querySelector(`#${P}mapa-lote`);
  if(lote) lote.addEventListener("click", ()=>{
    // Si hay una ubicación abierta, arranca con sus equipos marcados.
    const s = estadoMapa().seleccion;
    const seleccion = s.ubicacionId ? estadoMapa().equipos.filter(e=>e.ubicacion_id === s.ubicacionId).map(e=>e.id) : [];
    abrirAsignacionEnLote({ alGuardar: trasCatalogo, seleccion });
  });
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
    refrescar();
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
  const u = s.ubicacionId ? m.ubicaciones.find(x=>x.id === s.ubicacionId) : null;
  try{
    switch(accion){
      case "reintentar": return recargar(b);
      case "ver-ubicacion": return seleccionarUbicacion(id, { centrar: true });
      case "volver-resumen": return deseleccionar();
      case "seleccionar-equipo":
        if(s.equipoId === id) return seleccionarUbicacion(s.ubicacionId);
        return seleccionarEquipo(id);
      case "seleccionar-equipo-mapa": return seleccionarEquipo(id);
      case "simular-caida":
      case "casilla-caida": return alternarCaida(id);
      case "alternar-atajo": return alternarAtajo(id);
      case "guardar-atajo": return abrirGuardarAtajo({ equipos: caidosActuales() }, { alGuardar: trasGuardar(nuevo=>{
        // El atajo recién guardado queda encendido y las caídas pasan a ser suyas.
        const sim = estadoMapa().simulacion;
        sim.caidos = [];
        sim.atajos = [...new Set([...(sim.atajos || []), nuevo])];
        refrescar();
      }) });
      case "editar-atajo": return abrirEditarAtajo(id, { caidosActuales: caidosActuales(), alGuardar: trasGuardar(()=>refrescar()) });
      case "restablecer-simulacion": return restablecerSimulacion();
      case "alternar-expandido":
        m.expandidos = m.expandidos.includes(id) ? m.expandidos.filter(x=>x !== id) : [...m.expandidos, id];
        return refrescar();
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
        if(!reactivar && !m.filtros.verArchivadas) m.seleccion = { ubicacionId: null, equipoId: null, activoId: null };
        mostrarToast(reactivar ? "Ubicación reactivada." : "Ubicación archivada.", "success");
        return refrescar();
      }
      case "eliminar-ubicacion": {
        const ok = await confirmarAccion(`¿Eliminar «${u.nombre}»? Solo se puede si nunca tuvo equipos ni activos; si ya se usó, archívala. No se puede deshacer.`, "Eliminar");
        if(!ok) return;
        await eliminarUbicacion(id);
        mostrarToast("Ubicación eliminada.", "success");
        return refrescar();
      }
      case "nuevo-equipo": return abrirFormEquipo({ ubicacionId: id }, { alGuardar: trasGuardar(nuevo=>seleccionarEquipo(nuevo, { encuadrar: false })) });
      case "editar-equipo": return abrirFormEquipo({ id }, { alGuardar: trasGuardar(eq=>seleccionarEquipo(eq, { encuadrar: false })) });
      case "eliminar-equipo": {
        const red = redMapa();
        const eq = red.equipoPorId.get(id);
        const clientes = red.clientes.get(id) || [];
        if(clientes.length){
          mostrarToast(`No se puede eliminar «${eq ? eq.nombre : ""}»: ${clientes.length === 1 ? `«${clientes[0].nombre}» lo tiene` : `${clientes.length} equipos lo tienen`} como servidor. Asígnales otro servidor primero.`, "error");
          return;
        }
        const propios = (red.respaldosPorEquipo.get(id) || []).length;
        const ajenos = (red.respaldadosPor.get(id) || []).length;
        const extra = [propios ? `sus ${propios} respaldo(s)` : "", ajenos ? `${ajenos} respaldo(s) de otros equipos que apuntaban a él` : ""].filter(Boolean).join(" y ");
        const ok = await confirmarAccion(`¿Eliminar el equipo «${eq ? eq.nombre : ""}»?${extra ? ` También se quitan ${extra}.` : ""}${eq && eq.activo_id ? " El activo vinculado se queda registrado en esta ubicación." : ""}`, "Eliminar");
        if(!ok) return;
        await eliminarEquipo(id);
        mostrarToast("Equipo eliminado.", "success");
        return refrescar();
      }
      case "nuevo-respaldo": return abrirFormRespaldo({ equipoId: id }, { alGuardar: trasGuardar(()=>seleccionarEquipo(id, { encuadrar: false })) });
      case "editar-respaldo": return abrirFormRespaldo({ id }, { alGuardar: trasGuardar(()=>seleccionarEquipo(s.equipoId, { encuadrar: false })) });
      case "eliminar-respaldo": {
        const red = redMapa();
        const fila = m.respaldos.find(r=>r.id === id);
        const alt = fila ? red.equipoPorId.get(fila.servidor_alternativo_id) : null;
        const ok = await confirmarAccion(`¿Quitar «${alt ? alt.nombre : "ese equipo"}» de los respaldos?`, "Quitar");
        if(!ok) return;
        await eliminarRespaldo(id);
        mostrarToast("Respaldo quitado.", "success");
        return refrescar();
      }
      case "asignar-activos": return abrirAsignarActivos(id, { alGuardar: trasGuardar(()=>seleccionarUbicacion(id)) });
      case "mover-activo": return abrirMoverActivo(id, { alGuardar: trasGuardar(dest=>seleccionarUbicacion(dest, { centrar: true, activoId: id })) });
      case "quitar-activo": {
        const a = indicesMapa().activoPorId.get(id);
        const ok = await confirmarAccion(`¿Quitar ${a ? fmtTag(a) : "el activo"} de «${u ? u.nombre : ""}»? Quedará sin ubicación (su tramo se cierra con la fecha de hoy y queda en el historial).`, "Quitar");
        if(!ok) return;
        await quitarActivoDeUbicacion(id);
        mostrarToast("Ubicación quitada.", "success");
        return refrescar();
      }
    }
  }catch(err){
    mostrarToast(err.message || String(err), "error");
    if(document.getElementById(`${P}mapa-panel`)) refrescar();
  }
}
