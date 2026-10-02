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
import { cargarPiscinas, cargarPlanoMapa, estadoMapa, hayCobertura, hayMedio, hayPiscinas, hayRedFinca, indicesMapa, redMapa, refrescarDatosMapa, refrescarPlanoMapa, simulacionMapa } from "../nucleo/datos-mapa.js";
import { cargarTiposActivo } from "../nucleo/datos.js";
import { normalizarCobertura, puntosSector, textoCobertura } from "../nucleo/cobertura.js";
import { MODOS_TOOLTIP, conRedes, conTipos, resumenUbicacion, textoActivos, textoOcultos, textoSinEquipos } from "../nucleo/tooltip-ubicacion.js";
import { cajaPiscinas } from "../nucleo/piscinas.js";
import { caidosEfectivos } from "../nucleo/mapa-nombres.js";
import { cajaEsquinas } from "../nucleo/plano-mapa.js";
import { state } from "../nucleo/estado.js";
import { fmtCoordenadas, fmtDistancia } from "../nucleo/geo.js";
import { esc, fmtTag } from "../nucleo/helpers.js";
import { buscarEnMapa, infoTipoUbicacion, resumenMapa, traducirErrorMapa, ubicacionesVisibles } from "../nucleo/mapa-logica.js";
import { ESTADOS_SIMULACION, GROSOR_LINEAS, ROLES, TIPO_EQUIPO_SIN, UBICACION_SIN_EQUIPOS, UMBRAL_AGRUPAR_CLIENTES, caminoARaiz, claveRed, conGrosor, contarRoles, equipoVisible, estadoPorUbicacion, grosorDeLinea, normalizarGrosor, planDeAgrupados, planDeLineas, redEfectivaDe, resumenRed, textoGrosor, tituloSinRed, ubicacionVisiblePorEquipos, ubicacionesSinEquipos } from "../nucleo/mapa-jerarquia.js";
import { LINEAS_POR_DEFECTO, cuantosFiltros, filtrosLimpios, lineasConVisibles, ocultosSoloEsta, opcionesTiposEquipo, resumenDesplegable } from "../nucleo/filtros-mapa.js";
import { AYUDA_SOLO, esMayusEnter, tituloSolo } from "../nucleo/solo-esta.js";
import { AYUDA_BUSCAR_OPCION, coincideOpcion, textoSinCoincidencias } from "../nucleo/buscar-opciones.js";
import { esAdmin, puede } from "../nucleo/permisos.js";
import { editarPiscina, eliminarEquipo, eliminarRespaldo, eliminarUbicacion, establecerUbicacionActiva, guardarAjustePlano, quitarActivoDeUbicacion } from "../negocio/operaciones-mapa.js";
import { urlFoto } from "../negocio/operaciones.js";
import { abrirDetalle } from "./detalle/vista.js";
import { abrirAsignacionEnLote, abrirAsignarActivos, abrirEditarAtajo, abrirFormEquipo, abrirFormPiscina, abrirFormRespaldo, abrirFormUbicacion, abrirGuardarAtajo, abrirMoverActivo, abrirRedesYTipos } from "./mapa/formularios.js";
import { CAPAS_BASE, CAPAS_SUPERPUESTAS, CENTRO_POR_DEFECTO, COLOR_COBERTURA, COLOR_COBERTURA_SIN_SERVICIO, ESTILOS_CON_HALO, ESTILOS_LINEA, HALO, OPACIDAD_ATENUADA, PANE_COBERTURA, capaBaseInicial, cargarLeaflet, coberturaInicial, crearCapasBase, crearPaneCobertura, grosorInicial, iconoAgrupado, iconoUbicacion, lineaCorrida, modoTooltipInicial, recordarCapaBase, recordarCobertura, recordarGrosor, recordarModoTooltip, recordarSuperpuesta, superpuestaInicial } from "./mapa/leaflet.js";
import { iconoTipoEquipo } from "./mapa/iconos-equipo.js";
import { agruparLineas, planDeTrazos, textoTrazo } from "../nucleo/lineas-agrupadas.js";
import { crearControlPantallaCompleta, crearPantallaCompleta } from "./mapa/pantalla-completa.js";
import { htmlPanelCargando, htmlPanelError, htmlPanelResumen, htmlPanelUbicacion } from "./mapa/panel.js";
import { crearCapaPlano, crearControlPlano, crearPanesPlano, htmlLeyendaPlano, iniciarAjustePlano, opacidadInicial, recordarOpacidad } from "./mapa/plano.js";
import { ZOOM_ROTULOS, crearControlPiscinas, crearPanesPiscinas, htmlPopupPiscina, iniciarEdicionPiscina, pintarPiscinas } from "./mapa/piscinas.js";
import { abrirCarruselFotos, cerrarModal, confirmarAccion, mostrarToast, renderMain } from "./render-raiz.js";
import { expandir, plegarFantasma } from "./transiciones.js";

const P = "inventario-tecnologico-";

let vista = null;     // { L, mapa, capaLineas, capaMarcadores, capaAgrupados, marcadores, main, colocando, alTeclear, ... }
let generacion = 0;   // invalida cargas en curso si se sale de la pestaña antes de que terminen
let alClicFueraBuscador = null;
let alClicFueraFiltros = null; // v12: cierra el desplegable de filtros abierto
let ubicacionEnPanel = null; // para conservar el scroll del panel solo si sigue mostrando la misma ubicación
let grosorLineas = GROSOR_LINEAS.porDefecto; // factor del grosor de las líneas (v9), recordado en el navegador
let modoTooltip = modoTooltipInicial();        // v15 (3.10): qué muestra el tooltip de una ubicación
let verCobertura = coberturaInicial();          // v15 (3.9): la cobertura de los AP, a la vista

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
  if(alClicFueraFiltros){ document.removeEventListener("click", alClicFueraFiltros); alClicFueraFiltros = null; }
  if(!vista) return;
  if(vista.ajustePlano){ try{ vista.ajustePlano.terminar(); }catch(e){ /* el mapa ya se está desarmando */ } }
  if(vista.edicionPiscina){ try{ vista.edicionPiscina.terminar(); }catch(e){ /* el mapa ya se está desarmando */ } }
  document.removeEventListener("keydown", vista.alTeclear, true);
  if(vista.pantalla){ try{ vista.pantalla.destruir(); }catch(e){ /* la vista ya se está desarmando */ } }
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
          <div class="${P}mapa-desplegables">
            ${htmlDesplegable("ubicaciones", "Ubicaciones", { ayuda: "Tipos de ubicación que se ven en el mapa", buscador: "Buscar tipo de ubicación…", extra: `<label class="${P}mapa-check ${P}mapa-desplegable-extra"><input type="checkbox" id="${P}mapa-ver-archivadas"> Ver también las archivadas</label>` })}
            ${htmlDesplegable("lineas", "Líneas", { ayuda: "Clases de línea que se dibujan" })}
            ${htmlDesplegable("roles", "Equipos", { ayuda: "Equipos por su papel en la red: raíz, backbone, distribución o cliente" })}
            ${htmlDesplegable("redes", "Redes", { oculto: true, idWrap: `${P}mapa-grupo-redes`, ayuda: "Redes de la finca", buscador: "Buscar red…" })}
            ${htmlDesplegable("tiposEquipo", "Tipos de equipo", { oculto: true, ayuda: "Router, PtP, Switch…: las torres sin los tipos elegidos se ocultan", buscador: "Buscar tipo de equipo…" })}
          </div>
          <button type="button" class="${P}btn ${P}btn-sm ${P}btn-ghost ${P}mapa-quitar-filtros" id="${P}mapa-quitar-filtros" disabled title="Volver a ver todo: tipos, líneas, equipos, redes y archivadas">✕ Quitar filtros</button>
          <button type="button" class="${P}mapa-chip ${P}mapa-chip-color-red" id="${P}mapa-color-red" data-color-red="1" aria-pressed="false" hidden title="Pintar cada línea con el color de la red de su equipo">Colorear líneas por red</button>
          <button type="button" class="${P}mapa-chip ${P}mapa-chip-cobertura" id="${P}mapa-cobertura" aria-pressed="true" hidden title="Mostrar u ocultar el área de cobertura de los AP (se recuerda en este navegador)">Cobertura de los AP</button>
          <div class="${P}mapa-filtro-grupo ${P}mapa-filtro-simulacion" role="group" aria-label="Simulación de fallas">
            <button type="button" class="${P}mapa-chip ${P}mapa-chip-sim" id="${P}mapa-simulacion" aria-pressed="false" title="Activar o apagar la simulación de fallas (no se guarda nada)">Simulación de fallas</button>
            ${htmlDesplegable("estados", "Estados", { oculto: true, ayuda: "Equipos según su estado en la simulación" })}
            <button type="button" class="${P}btn ${P}btn-sm" id="${P}mapa-sim-restablecer" hidden>Restablecer simulación</button>
          </div>
          <div class="${P}mapa-grosor" title="Grosor de todas las líneas de conexión. En 0 no se dibujan, salvo el camino del equipo elegido (se recuerda en este navegador)">
            <label for="${P}mapa-grosor">Grosor</label>
            <input type="range" id="${P}mapa-grosor" min="${GROSOR_LINEAS.min}" max="${GROSOR_LINEAS.max}" step="${GROSOR_LINEAS.paso}" value="${GROSOR_LINEAS.porDefecto}">
            <output id="${P}mapa-grosor-valor" for="${P}mapa-grosor">${textoGrosor(GROSOR_LINEAS.porDefecto)}</output>
            <button type="button" class="${P}btn ${P}btn-sm ${P}btn-ghost" id="${P}mapa-grosor-normal" hidden title="Volver al grosor normal">Normal</button>
          </div>
          <div class="${P}mapa-tooltip-modo" id="${P}mapa-tooltip-modo-grupo" hidden title="Qué muestra la ubicación al pasar el mouse o con el foco del teclado (se recuerda en este navegador)">
            <label for="${P}mapa-tooltip-modo">Al pasar el mouse</label>
            <select id="${P}mapa-tooltip-modo">${MODOS_TOOLTIP.map(mo=>`<option value="${mo.id}">${esc(mo.etiqueta)}</option>`).join("")}</select>
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
            <ul class="${P}mapa-leyenda-cobertura" id="${P}mapa-leyenda-cobertura" aria-label="Cobertura" hidden>
              <li><span class="${P}mapa-leyenda-area"></span>Cobertura de un AP (círculo o sector)</li>
            </ul>
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
  crearPaneCobertura(mapa);
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
    // En pantalla completa, el panel se acomoda debajo de los controles de esa esquina.
    if(vista.pantalla) vista.pantalla.controlesCambio();
  });
  // v9: pantalla completa (botón debajo del zoom).
  crearControlPantallaCompleta(L, ()=>{ if(vista && vista.pantalla) vista.pantalla.alternar(); }).addTo(mapa);
  L.control.scale({ metric: true, imperial: false }).addTo(mapa);
  const capaLineas = L.layerGroup().addTo(mapa);
  const capaMarcadores = L.layerGroup().addTo(mapa);
  const capaAgrupados = L.layerGroup().addTo(mapa);
  const capaCobertura = L.layerGroup().addTo(mapa); // v15 (3.9): sus capas van en PANE_COBERTURA
  mapa.on("click", alClicMapa);
  mapa.on("contextmenu", alClicDerechoMapa);

  vista = { L, mapa, capaLineas, capaMarcadores, capaAgrupados, capaCobertura, marcadores: new Map(), main, colocando: null, encuadrado: false, alTeclear: null,
    capas, capaPlano, controlCapas, controlPlano: null, ajustePlano: null,
    capaPiscinas, piscinasEnControl: false, piscinasVisibles: false, piscinasSoloRevisar: false, piscinasDibujadas: null,
    controlPiscinas: null, edicionPiscina: null, edicionPiscinaId: null, pantalla: null };
  vista.pantalla = crearPantallaCompleta({ raiz: main.querySelector(`.${P}mapa-vista`), mapa });
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
    // v13: en el buscador de un desplegable, Esc primero borra lo escrito.
    const buscarDd = e.target && e.target.closest ? e.target.closest("[data-dd-buscar]") : null;
    if(buscarDd && buscarDd.value && limpiarBusquedaDesplegable(buscarDd.dataset.ddBuscar)){ e.preventDefault(); e.stopPropagation(); return; }
    // v12: un desplegable de filtros abierto se cierra primero (el foco vuelve a su botón).
    if(cerrarDesplegables({ foco: true })){ e.preventDefault(); e.stopPropagation(); return; }
    if(vista.ajustePlano || vista.edicionPiscina) return; // el Esc lo manejan "Ajustar plano" y el editor de piscinas
    if(vista.mapa.getContainer().querySelector(".leaflet-popup")){ e.preventDefault(); vista.mapa.closePopup(); return; } // primero se cierra la ventanita de una piscina
    if(e.target && e.target.id === `${P}mapa-buscar`) return; // el buscador maneja su propio Esc
    if(vista.colocando){ e.preventDefault(); cancelarColocacion(); return; }
    const s = estadoMapa().seleccion;
    if(s.equipoId){ seleccionarUbicacion(s.ubicacionId); return; }
    if(s.ubicacionId){ deseleccionar(); return; }
    // Nada más que cerrar: sale de la pantalla completa (con el Esc bloqueado
    // por la pantalla completa del navegador, la tecla llega hasta aquí).
    if(vista.pantalla && vista.pantalla.activa()){ e.preventDefault(); vista.pantalla.salir(); }
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
  // v11 (3.6): una sin equipos de red cuenta como «Sin red».
  const visibleUbicacion = id=>{
    if(id === s.ubicacionId || ubicacionesCamino.has(id)) return true;
    if(!base.has(id)) return false;
    return ubicacionVisiblePorEquipos(idx.equiposPorUbicacion.get(id) || [], f, visibleEquipo);
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
    cobertura013: hayCobertura(),
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
    pintarCobertura(c);
    prepararPiscinas();
  }
  pintarPanel(c);
}

// ---------------------------------------------------------------------------
// Barra de filtros (se repinta con los conteos al día)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Filtros en desplegables (v12, pedido 3.3). Cada categoría es un botón con su
// cuenta («Redes 2/3 ▾») que abre un panel con casillas, cuántos hay de cada
// opción, «Todas» y «Ninguna». Las casillas son botones con aria-pressed y el
// mismo data-* de los chips de antes (data-tipo, data-linea, data-rol,
// data-red, data-estado y, nuevo, data-tipo-equipo). «Solo esta» (3.5): doble
// clic, su botón «solo» o Mayús+Enter. Se abre uno a la vez; Esc o un clic
// afuera lo cierran. v13: los que pueden crecer (Ubicaciones, Redes y Tipos de
// equipo) traen un buscador, como los filtros de Tipo y Marca de la tabla.
// ---------------------------------------------------------------------------
function htmlDesplegable(id, titulo, { oculto = false, ayuda = "", extra = "", idWrap = "", buscador = "" } = {}){
  return `<div class="${P}mapa-desplegable" data-desplegable="${id}"${idWrap ? ` id="${idWrap}"` : ""}${oculto ? " hidden" : ""}>
    <button type="button" class="${P}mapa-desplegable-btn" id="${P}mapa-dd-${id}" data-dd-boton="${id}" aria-expanded="false" aria-controls="${P}mapa-dd-${id}-panel"${ayuda ? ` title="${esc(ayuda)}"` : ""}>
      <span class="${P}mapa-desplegable-titulo">${esc(titulo)}</span><span class="${P}mapa-chip-n" data-dd-cuenta="${id}"></span><span class="${P}mapa-desplegable-flecha" aria-hidden="true"></span>
    </button>
    <div class="${P}mapa-desplegable-panel" id="${P}mapa-dd-${id}-panel" role="group" aria-labelledby="${P}mapa-dd-${id}" hidden>
      <div class="${P}filter-panel-card">
        <div class="${P}filter-panel-titlebar">${esc(titulo)}</div>
        <div class="${P}filter-panel-card-inner">
          ${buscador ? `<input type="search" class="${P}filter-panel-search ${P}mapa-desplegable-buscar" data-dd-buscar="${id}" placeholder="${esc(buscador)}" aria-label="${esc(buscador)}" title="${esc(AYUDA_BUSCAR_OPCION)}" autocomplete="off" spellcheck="false">` : ""}
          <div class="${P}filter-panel-actions">
            <button type="button" class="${P}btn ${P}btn-sm" data-dd-todas="${id}">Todas</button>
            <button type="button" class="${P}btn ${P}btn-sm" data-dd-ninguna="${id}">Ninguna</button>
          </div>
          <div class="${P}mapa-opciones" data-dd-lista="${id}"></div>
          ${buscador ? `<div class="${P}mapa-opciones-vacio" data-dd-vacio="${id}" role="status" hidden></div>` : ""}
          ${extra}
          <div class="${P}filter-panel-hint">${esc(AYUDA_SOLO)}</div>
        </div>
      </div>
    </div>
  </div>`;
}

// Una opción: la casilla (botón con aria-pressed) y su botón «solo».
function htmlOpcion(dd, o){
  return `<div class="${P}mapa-opcion" data-opcion-dd="${dd}" data-opcion-valor="${esc(o.valor)}">`
    + `<button type="button" class="${P}mapa-opcion-btn${o.especial ? ` ${P}mapa-opcion-especial` : ""}" data-${o.data}="${esc(o.valor)}" aria-pressed="${o.visible}"${o.color ? ` style="--chip-color:${esc(o.color)}"` : ""} title="${esc(o.titulo || "")}">`
    + `<span class="${P}mapa-opcion-casilla" aria-hidden="true"></span>${o.extra || (o.color ? `<span class="${P}mapa-chip-punto"></span>` : "")}`
    + `<span class="${P}mapa-opcion-etiqueta">${esc(o.etiqueta)}</span>${o.n !== null && o.n !== undefined ? `<span class="${P}mapa-chip-n">${o.n}</span>` : ""}</button>`
    + `<button type="button" class="${P}mapa-solo" data-solo-dd="${dd}" data-solo-valor="${esc(o.valor)}" title="${esc(tituloSolo(o.etiqueta))}" aria-label="${esc(`Solo ${o.etiqueta}`)}">solo</button>`
    + `</div>`;
}

// Pinta las opciones de un desplegable. Si son las mismas de antes, solo pone
// al día casillas, cuentas y ayudas (así no se pierde el foco ni se corta un
// doble clic); si cambiaron, las rearma y devuelve el foco a la misma opción.
const valoresDesplegable = {}; // id → valores a la vista (para «Todas», «Ninguna» y «solo»)
function pintarDesplegable(id, opciones, { ocultasPorDefecto = [] } = {}){
  const lista = document.querySelector(`[data-dd-lista="${id}"]`);
  if(!lista) return;
  valoresDesplegable[id] = opciones.map(o=>o.valor);
  const firma = JSON.stringify(opciones.map(o=>[o.data, o.valor, o.etiqueta, o.color || "", !!o.extra, !!o.especial]));
  if(lista.dataset.firma === firma){
    for(const o of opciones){
      const fila = lista.querySelector(`[data-opcion-valor="${CSS.escape(String(o.valor))}"]`);
      if(!fila) continue;
      const b = fila.querySelector(`.${P}mapa-opcion-btn`);
      b.setAttribute("aria-pressed", String(o.visible));
      b.title = o.titulo || "";
      const n = b.querySelector(`.${P}mapa-chip-n`);
      if(n) n.textContent = o.n;
    }
  } else {
    const activo = document.activeElement && lista.contains(document.activeElement) ? document.activeElement : null;
    const foco = activo ? { valor: activo.closest("[data-opcion-valor]")?.dataset.opcionValor, solo: activo.classList.contains(`${P}mapa-solo`) } : null;
    lista.innerHTML = opciones.map(o=>htmlOpcion(id, o)).join("");
    lista.dataset.firma = firma;
    if(foco && foco.valor !== undefined){
      const fila = lista.querySelector(`[data-opcion-valor="${CSS.escape(foco.valor)}"]`);
      const el = fila && fila.querySelector(foco.solo ? `.${P}mapa-solo` : `.${P}mapa-opcion-btn`);
      if(el) el.focus({ preventScroll: true });
    }
  }
  const ocultas = opciones.filter(o=>!o.visible).map(o=>o.valor);
  const r = resumenDesplegable(valoresDesplegable[id], ocultas);
  const cuenta = document.querySelector(`[data-dd-cuenta="${id}"]`);
  if(cuenta) cuenta.textContent = r.texto;
  // Se resalta si está distinto de como arranca (las líneas arrancan sin «Respaldos»).
  const porDefecto = new Set(ocultasPorDefecto.filter(v=>valoresDesplegable[id].includes(v)));
  const distinto = ocultas.length !== porDefecto.size || ocultas.some(v=>!porDefecto.has(v));
  const boton = document.getElementById(`${P}mapa-dd-${id}`);
  if(boton) boton.classList.toggle(`${P}mapa-desplegable-filtrado`, distinto);
  // v13: lo escrito en su buscador sigue valiendo aunque las opciones se rearmen.
  aplicarBusquedaDesplegable(id);
}

// v13: el buscador de un desplegable. Deja a la vista las opciones cuyo nombre
// coincide (sin mayúsculas ni tildes); no cambia los filtros ni la cuenta del
// botón. Sin coincidencias, avisa. Devuelve las filas a la vista.
function aplicarBusquedaDesplegable(id){
  const lista = document.querySelector(`[data-dd-lista="${id}"]`);
  if(!lista) return [];
  const input = document.querySelector(`[data-dd-buscar="${id}"]`);
  const consulta = input ? input.value : "";
  const visibles = [];
  for(const fila of lista.querySelectorAll(`.${P}mapa-opcion`)){
    const etiqueta = fila.querySelector(`.${P}mapa-opcion-etiqueta`)?.textContent || "";
    const coincide = coincideOpcion(etiqueta, consulta);
    if(fila.hidden === coincide) fila.hidden = !coincide;
    if(coincide) visibles.push(fila);
  }
  const vacio = document.querySelector(`[data-dd-vacio="${id}"]`);
  if(vacio){
    const sin = !!consulta.trim() && visibles.length === 0;
    vacio.hidden = !sin;
    vacio.textContent = sin ? textoSinCoincidencias(consulta) : "";
  }
  return visibles;
}
// Las filas de un desplegable que están a la vista (las que deja el buscador).
function filasVisiblesDesplegable(id){
  return [...document.querySelectorAll(`[data-dd-lista="${id}"] .${P}mapa-opcion`)].filter(f=>!f.hidden);
}
// Borra lo escrito en el buscador del desplegable (al cerrarlo o con Esc).
function limpiarBusquedaDesplegable(id){
  const input = document.querySelector(`[data-dd-buscar="${id}"]`);
  if(!input || !input.value) return false;
  input.value = "";
  aplicarBusquedaDesplegable(id);
  return true;
}
// Al abrir un desplegable con buscador, el foco va a él para escribir de una
// vez; en pantallas táctiles no, para no sacar el teclado sin pedirlo.
function enfocarBuscadorAlAbrir(){
  return !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches);
}
// v15 (3.10): en un celular o una tableta sin mouse no hay «pasar el mouse»: el
// toque elige la ubicación (su detalle sale en el panel) y el tooltip queda
// con el nombre, como antes. Ahí tampoco se muestra el selector.
function sinHover(){
  return !!(window.matchMedia && window.matchMedia("(hover: none)").matches);
}

function desplegableAbierto(){
  const b = document.querySelector(`.${P}mapa-desplegable-btn[aria-expanded="true"]`);
  return b ? b.dataset.ddBoton : null;
}
function abrirDesplegable(id){
  for(const b of document.querySelectorAll(`.${P}mapa-desplegable-btn`)){
    const estaba = b.getAttribute("aria-expanded") === "true";
    const abrir = b.dataset.ddBoton === id && !estaba;
    b.setAttribute("aria-expanded", String(abrir));
    const panel = document.getElementById(b.getAttribute("aria-controls"));
    if(!panel) continue;
    panel.hidden = !abrir;
    if(estaba && !abrir) limpiarBusquedaDesplegable(b.dataset.ddBoton);
    if(abrir){
      acomodarPanel(panel);
      const buscar = panel.querySelector("[data-dd-buscar]");
      if(buscar && enfocarBuscadorAlAbrir()) buscar.focus({ preventScroll: true });
    }
  }
}
// El panel cuelga de su botón; si se sale de la pantalla (un botón a la
// derecha, el celular), se corre hacia adentro.
function acomodarPanel(panel){
  panel.style.left = "";
  const ancho = document.documentElement.clientWidth || window.innerWidth;
  const r = panel.getBoundingClientRect();
  const margen = 8;
  let corrimiento = 0;
  if(r.right > ancho - margen) corrimiento = (ancho - margen) - r.right;
  if(r.left + corrimiento < margen) corrimiento = margen - r.left;
  if(corrimiento) panel.style.left = `${Math.round(corrimiento)}px`;
}
// Cierra el desplegable abierto (si hay uno). Con foco: si el foco estaba
// adentro, vuelve a su botón. Devuelve true si cerró algo.
function cerrarDesplegables({ foco = false } = {}){
  const id = desplegableAbierto();
  if(!id) return false;
  const boton = document.getElementById(`${P}mapa-dd-${id}`);
  const panel = boton ? document.getElementById(boton.getAttribute("aria-controls")) : null;
  const adentro = panel && document.activeElement && panel.contains(document.activeElement);
  if(boton) boton.setAttribute("aria-expanded", "false");
  if(panel) panel.hidden = true;
  limpiarBusquedaDesplegable(id);
  if(foco && (adentro || document.activeElement === boton) && boton) boton.focus({ preventScroll: true });
  return true;
}

function chip({ data, valor, pressed, color = null, etiqueta, n = null, titulo = "", extra = "" }){
  return `<button type="button" class="${P}mapa-chip" data-${data}="${esc(valor)}" aria-pressed="${pressed}"${color ? ` style="--chip-color:${esc(color)}"` : ""} title="${esc(titulo)}">${extra || (color ? `<span class="${P}mapa-chip-punto"></span>` : "")}${esc(etiqueta)}${n !== null ? ` <span class="${P}mapa-chip-n">${n}</span>` : ""}</button>`;
}
function pintarFiltros(c){
  const m = c.m;
  const f = m.filtros;
  if(!document.querySelector(`[data-dd-lista="ubicaciones"]`)) return;
  const usados = new Set(m.ubicaciones.map(u=>u.tipo));
  const tipos = m.tiposUbicacion.filter(t=>t.activo !== false || usados.has(t.valor));
  pintarDesplegable("ubicaciones", tipos.map(t=>{
    const visible = !f.tiposOcultos.includes(t.valor);
    return { data: "tipo", valor: t.valor, visible, color: t.color, etiqueta: t.etiqueta,
      n: m.ubicaciones.filter(u=>u.tipo === t.valor && (f.verArchivadas || u.activa !== false)).length,
      titulo: `${visible ? "Ocultar" : "Mostrar"} ${t.etiqueta}` };
  }));
  const va = document.getElementById(`${P}mapa-ver-archivadas`);
  if(va) va.checked = f.verArchivadas;

  const rr = resumenRed(c.red);
  const nLineas = { backbone: rr.backbone, p2mp: rr.p2mp, cable: rr.cable, respaldos: rr.respaldos };
  // "Cable/fibra" solo aparece con la 008 o si ya hay alguno.
  pintarDesplegable("lineas", LINEAS.filter(l=>l.id !== "cable" || hayMedio() || rr.cable).map(l=>({
    data: "linea", valor: l.id, visible: !!f.lineas[l.id], etiqueta: l.etiqueta, n: nLineas[l.id],
    titulo: `${f.lineas[l.id] ? "Ocultar" : "Mostrar"}: ${l.ayuda}`, extra: `<span class="${P}mapa-chip-linea ${P}mapa-chip-linea-${l.id}"></span>`,
  })), { ocultasPorDefecto: Object.keys(LINEAS_POR_DEFECTO).filter(id=>!LINEAS_POR_DEFECTO[id]) });

  const nRoles = contarRoles(c.red);
  pintarDesplegable("roles", ROLES.map(r=>({
    data: "rol", valor: r.id, visible: !f.rolesOcultos.includes(r.id), color: r.color, etiqueta: r.etiqueta, n: nRoles[r.id] || 0,
    titulo: `${f.rolesOcultos.includes(r.id) ? "Mostrar" : "Ocultar"}: ${r.ayuda}`,
  })));

  // Ubicaciones sin equipos de red: las oculta «Sin red» (v11, 3.6) y «Sin
  // equipos» en «Tipos de equipo» (v12, 3.4).
  const vacias = ubicacionesSinEquipos(m.ubicaciones, c.idx.equiposPorUbicacion, { verArchivadas: f.verArchivadas }).length;

  // Redes de la finca (007): una opción por red (y "Sin red"), más colorear las líneas.
  const hayRedes = hayRedFinca() && m.redes.length > 0;
  const grupoRedes = document.getElementById(`${P}mapa-grupo-redes`);
  if(grupoRedes) grupoRedes.hidden = !hayRedes;
  const colorRed = document.getElementById(`${P}mapa-color-red`);
  if(colorRed){ colorRed.hidden = !hayRedes; colorRed.setAttribute("aria-pressed", String(!!f.colorPorRed)); }
  // v15 (3.10): «Al pasar el mouse» (con la 007: sin tipos ni redes no hay nada que mostrar).
  const grupoTooltip = document.getElementById(`${P}mapa-tooltip-modo-grupo`);
  if(grupoTooltip) grupoTooltip.hidden = !hayRedFinca() || sinHover();
  const selTooltip = document.getElementById(`${P}mapa-tooltip-modo`);
  if(selTooltip && selTooltip.value !== modoTooltip) selTooltip.value = modoTooltip;
  // v15 (3.9): «Cobertura de los AP», si algún equipo tiene cobertura (013).
  const hayAlgunaCobertura = hayCobertura() && m.equipos.some(e=>normalizarCobertura(e));
  const chipCobertura = document.getElementById(`${P}mapa-cobertura`);
  if(chipCobertura){ chipCobertura.hidden = !hayAlgunaCobertura; chipCobertura.setAttribute("aria-pressed", String(verCobertura)); }
  const leyendaCobertura = document.getElementById(`${P}mapa-leyenda-cobertura`);
  if(leyendaCobertura) leyendaCobertura.hidden = !(hayAlgunaCobertura && verCobertura);
  if(hayRedes){
    const n = new Map();
    for(const e of m.equipos){ const k = claveRed(e); n.set(k, (n.get(k) || 0) + 1); }
    // «Sin red» aparece si hay equipos sin red o ubicaciones vacías. Su cuenta
    // sigue siendo la de equipos; la ayuda dice cuántas ubicaciones son.
    const opciones = [...m.redes.map(r=>({ valor: String(r.id), etiqueta: r.nombre, color: r.color })), ...(n.get("sin") || vacias ? [{ valor: "sin", etiqueta: "Sin red", color: "#8B9AAA", especial: true }] : [])];
    pintarDesplegable("redes", opciones.map(o=>{
      const visible = !f.redesOcultas.includes(o.valor);
      return { ...o, data: "red", visible, n: n.get(o.valor) || 0,
        titulo: o.valor === "sin" ? tituloSinRed(visible, n.get("sin") || 0, vacias) : `${visible ? "Ocultar" : "Mostrar"} los equipos de «${o.etiqueta}»` };
    }));
  }
  const leyendaRedes = document.getElementById(`${P}mapa-leyenda-redes`);
  if(leyendaRedes){
    leyendaRedes.hidden = !(hayRedes && f.colorPorRed);
    // v14 (3.8): con dos redes o más, cómo se ve un tramo que llevan varias.
    const franjas = m.redes.length > 1 ? `<li class="${P}mapa-leyenda-nota"><span class="${P}mapa-leyenda-linea ${P}mapa-leyenda-franjas" style="--franja-1:${esc(m.redes[0].color)};--franja-2:${esc(m.redes[1].color)}"></span>Varias redes en un tramo: una franja por red</li>` : "";
    leyendaRedes.innerHTML = hayRedes && f.colorPorRed ? `<li class="${P}mapa-leyenda-subtitulo">Líneas por red</li>` + m.redes.map(r=>`<li><span class="${P}mapa-leyenda-linea" style="border-top:4px solid ${esc(r.color)}"></span>${esc(r.nombre)}</li>`).join("") + franjas : "";
  }

  // Tipos de equipo de red (v12, 3.4): con la 007 y si hay equipos o
  // ubicaciones vacías. Los equipos de los tipos apagados se ocultan, y con
  // ellos las torres donde no queda ninguno a la vista.
  const opcionesTipos = hayRedFinca() ? opcionesTiposEquipo(m.tiposEquipo, m.equipos, vacias) : [];
  const grupoTipos = document.querySelector(`[data-desplegable="tiposEquipo"]`);
  const hayTipos = opcionesTipos.length > 0 && (m.equipos.length > 0 || vacias > 0);
  if(grupoTipos) grupoTipos.hidden = !hayTipos;
  if(hayTipos) pintarDesplegable("tiposEquipo", opcionesTipos.map(o=>{
    const visible = !f.tiposEquipoOcultos.includes(o.valor);
    const accion = visible ? "Ocultar" : "Mostrar";
    const titulo = o.valor === UBICACION_SIN_EQUIPOS ? `${accion} las ubicaciones sin equipos de red (${o.n})`
      : o.valor === TIPO_EQUIPO_SIN ? `${accion} los equipos sin tipo (${o.n})`
      : `${accion} los equipos de tipo «${o.etiqueta}» (${o.n})`;
    return { data: "tipo-equipo", valor: o.valor, visible, etiqueta: o.etiqueta, n: o.n, especial: !!o.especial, titulo };
  }));

  const cuentaFiltros = document.getElementById(`${P}mapa-filtros-cuenta`);
  const activos = cuantosFiltros(f, { sim: !!c.sim });
  if(cuentaFiltros){
    // La simulación cuenta como uno más, como antes.
    const total = activos + (c.sim ? 1 : 0);
    cuentaFiltros.textContent = total ? `${total} activo${total === 1 ? "" : "s"}${c.sim ? " · simulación" : ""}` : "";
    if(vista && vista.pantalla) vista.pantalla.filtrosCambio();
  }
  const quitar = document.getElementById(`${P}mapa-quitar-filtros`);
  if(quitar) quitar.disabled = !activos;

  const botonSim = document.getElementById(`${P}mapa-simulacion`);
  const estados = document.querySelector(`[data-desplegable="estados"]`);
  const restablecer = document.getElementById(`${P}mapa-sim-restablecer`);
  botonSim.setAttribute("aria-pressed", String(!!c.sim));
  if(estados) estados.hidden = !c.sim;
  if(!c.sim && desplegableAbierto() === "estados") cerrarDesplegables();
  restablecer.hidden = !(c.sim && c.sim.caidos.size);
  if(c.sim) pintarDesplegable("estados", ESTADOS_SIMULACION.map(e=>({
    data: "estado", valor: e.id, visible: !f.estadosOcultos.includes(e.id), color: e.color, etiqueta: e.etiqueta, n: c.sim.cuentas[e.id] || 0,
    titulo: `${f.estadosOcultos.includes(e.id) ? "Mostrar" : "Ocultar"} equipos: ${e.etiqueta.toLowerCase()}`,
  })));
  // Un desplegable que quedó oculto (p. ej. «Tipos de equipo» sin equipos) no queda abierto.
  const abierto = desplegableAbierto();
  if(abierto && document.querySelector(`[data-desplegable="${abierto}"]`)?.hidden) cerrarDesplegables();
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
    color: infoTipoUbicacion(c.m.tiposUbicacion, u.tipo).color, tipo: u.tipo, icono: infoTipoUbicacion(c.m.tiposUbicacion, u.tipo).icono, cantidad: equipos + activos,
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
    const tooltipRico = hayRedFinca() && modoTooltip !== "nombre" && !sinHover();
    // La tablita, opaca y encima de las etiquetas de los enlaces (Leaflet deja
    // los tooltips al 90 %: se veían las etiquetas por debajo).
    marcador.bindTooltip(tooltipRico ? htmlTooltipUbicacion(c, u) : esc(u.nombre), { direction: "top", className: `${P}mapa-tooltip${tooltipRico ? ` ${P}mapa-tooltip-ubicacion` : ""}`, ...(tooltipRico ? { opacity: 1 } : {}) });
    if(tooltipRico) marcador.on("tooltipopen", e=>acomodarTooltip(marcador, e.tooltip));
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

// v15 (3.10): el tooltip de una ubicación: su nombre y su tipo y, según «Al
// pasar el mouse», cuántos equipos hay de cada tipo (con su ícono), de cada
// red, o las dos. Cuenta todo lo que hay en la ubicación y avisa cuántos
// ocultan los filtros. Con la 013, también la cobertura de sus AP.
function htmlTooltipUbicacion(c, u){
  const m = c.m;
  const equipos = c.idx.equiposPorUbicacion.get(u.id) || [];
  const activos = (c.idx.activosPorUbicacion.get(u.id) || []).filter(a=>{ const e = c.idx.equipoPorActivo.get(a.id); return !(e && e.ubicacion_id === u.id); }).length;
  const r = resumenUbicacion({ equipos, visibleEquipo: c.visibleEquipo, tipos: m.tiposEquipo, redes: m.redes, redDe: e=>{ const id = redEfectivaDe(e); return id === null || id === undefined ? null : id; }, activos });
  const tipoU = infoTipoUbicacion(m.tiposUbicacion, u.tipo);
  const tipoPorValor = new Map(m.tiposEquipo.map(t=>[t.valor, t]));
  const tiposActivo = cargarTiposActivo();
  const fila = (icono, etiqueta, n, clase = "")=>`<tr${clase ? ` class="${P}${clase}"` : ""}><td class="${P}mapa-tt-ico">${icono}</td><td class="${P}mapa-tt-etq">${esc(etiqueta)}</td><td class="${P}mapa-tt-n">${n}</td></tr>`;
  let cuerpo = "";
  if(!r.total) cuerpo += `<div class="${P}mapa-tt-nota">${esc(textoSinEquipos())}</div>`;
  if(r.total && conTipos(modoTooltip)){
    cuerpo += `<table class="${P}mapa-tt-tabla" aria-label="Equipos por tipo">`
      + r.tipos.map(t=>fila(iconoTipoEquipo(tipoPorValor.get(t.valor) || { valor: t.valor }, { tiposEquipo: m.tiposEquipo, tiposActivo }), t.etiqueta, t.n)).join("")
      + (r.sinTipo ? fila(iconoTipoEquipo(null), "Sin tipo", r.sinTipo, "mapa-tt-especial") : "")
      + `</table>`;
  }
  if(r.total && conRedes(modoTooltip) && (r.redes.length || r.sinRed)){
    const punto = color=>`<span class="${P}mapa-tt-punto" style="--chip-color:${esc(color || "#8B9AAA")}"></span>`;
    cuerpo += `<table class="${P}mapa-tt-tabla${conTipos(modoTooltip) ? ` ${P}mapa-tt-tabla-redes` : ""}" aria-label="Equipos por red">`
      + r.redes.map(x=>fila(punto(x.color), x.nombre, x.n)).join("")
      + (r.sinRed ? fila(punto(null), "Sin red", r.sinRed, "mapa-tt-especial") : "")
      + `</table>`;
  }
  if(r.ocultos) cuerpo += `<div class="${P}mapa-tt-nota ${P}mapa-tt-ocultos">${esc(textoOcultos(r.ocultos))}</div>`;
  if(r.activos) cuerpo += `<div class="${P}mapa-tt-nota">${esc(textoActivos(r.activos))}</div>`;
  if(hayCobertura()){
    const conCobertura = equipos.map(e=>[e, normalizarCobertura(e)]).filter(([, cob])=>cob);
    for(const [e, cob] of conCobertura.slice(0, 3)) cuerpo += `<div class="${P}mapa-tt-nota ${P}mapa-tt-cobertura">${esc(`${e.nombre}: ${textoCobertura(cob)}`)}</div>`;
    if(conCobertura.length > 3) cuerpo += `<div class="${P}mapa-tt-nota">${esc(`y ${conCobertura.length - 3} más con cobertura`)}</div>`;
  }
  return `<div class="${P}mapa-tt"><div class="${P}mapa-tt-titulo"><strong>${esc(u.nombre)}</strong><span class="${P}mapa-tt-tipo">${esc(tipoU.etiqueta)}</span></div>${cuerpo}</div>`;
}

// v15: la tablita del tooltip es alta: cerca del borde de arriba del mapa se
// abre hacia abajo del pin, y cerca de un costado, hacia el otro lado, para
// que no se corte contra el borde.
const ANCLA_TOOLTIP_PIN = 32; // tooltipAnchor de iconoUbicacion: la punta de arriba del pin
function acomodarTooltip(marcador, tooltip){
  const mapa = vista && vista.mapa;
  const el = tooltip && tooltip.getElement();
  if(!mapa || !el) return;
  const p = mapa.latLngToContainerPoint(marcador.getLatLng());
  const tam = mapa.getSize();
  const alto = el.offsetHeight, ancho = el.offsetWidth, margen = 6;
  let direccion = "top", desplazamiento = [0, 0];
  if(p.y - ANCLA_TOOLTIP_PIN - alto - margen < 0){ direccion = "bottom"; desplazamiento = [0, ANCLA_TOOLTIP_PIN + 4]; }
  if(p.x - ancho / 2 < margen){ direccion = "right"; desplazamiento = [16, ANCLA_TOOLTIP_PIN / 2]; }
  else if(p.x + ancho / 2 > tam.x - margen){ direccion = "left"; desplazamiento = [-16, ANCLA_TOOLTIP_PIN / 2]; }
  if(tooltip.options.direction === direccion) return;
  tooltip.options.direction = direccion;
  tooltip.options.offset = desplazamiento;
  tooltip.update();
}

// v15 (3.9): la cobertura de los AP. Un círculo (L.circle, en metros) o, con
// apertura, una cuña. Del color de la red al colorear por red; gris si en la
// simulación el equipo quedó sin servicio; atenuada si hay otro equipo
// elegido. Su tooltip dice de qué equipo es; los clics siguen al mapa.
function pintarCobertura(c){
  const { L } = vista;
  vista.capaCobertura.clearLayers();
  if(!hayCobertura() || !verCobertura) return;
  const colorPorRed = c.m.filtros.colorPorRed && hayRedFinca();
  const colorRed = new Map(c.m.redes.map(r=>[r.id, r.color]));
  const enCamino = new Set(c.camino);
  for(const e of c.m.equipos){
    const cob = normalizarCobertura(e);
    if(!cob || !c.visibleEquipo(e.id) || !c.visibleUbicacion(e.ubicacion_id)) continue;
    const u = c.red.ubicacionPorId.get(e.ubicacion_id);
    if(!u) continue;
    const st = c.sim ? c.sim.estado.get(e.id) : null;
    const sinServicio = !!(c.sim && !(st && st.conectado));
    const red = redEfectivaDe(e);
    const color = sinServicio ? COLOR_COBERTURA_SIN_SERVICIO : (colorPorRed && red !== null && red !== undefined && colorRed.get(red)) || COLOR_COBERTURA;
    const atenuada = c.seleccionId !== null && e.id !== c.seleccionId && !enCamino.has(e.id);
    const estilo = { pane: PANE_COBERTURA, color, weight: 1.5, opacity: atenuada ? 0.35 : 0.85, fillColor: color, fillOpacity: atenuada ? 0.04 : 0.12,
      dashArray: sinServicio ? "4 6" : null, bubblingMouseEvents: true, className: `${P}mapa-cobertura` };
    const capa = cob.sector
      ? L.polygon(puntosSector(u, cob).map(p=>[p.lat, p.lng]), estilo)
      : L.circle([u.lat, u.lng], { ...estilo, radius: cob.radio });
    const texto = `${e.nombre} · ${textoCobertura(cob)}${sinServicio ? " — sin servicio en la simulación" : ""}`;
    capa.bindTooltip(esc(texto), { sticky: true, className: `${P}mapa-tooltip` });
    capa.addTo(vista.capaCobertura);
    const el = capa.getElement();
    if(el){
      el.dataset.equipoId = e.id;
      el.dataset.cobertura = cob.sector ? "sector" : "circulo";
      if(sinServicio) el.dataset.sinServicio = "1";
      if(atenuada) el.classList.add(`${P}mapa-cobertura-atenuada`);
      el.setAttribute("aria-label", `Cobertura de ${texto}`);
    }
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

// v14 (3.8): las líneas normales entre las mismas dos ubicaciones y de la
// misma clase van juntas en una (nucleo/lineas-agrupadas.js); al colorear por
// red, con una franja por red. El camino resaltado, la simulación y los
// respaldos siguen enlace por enlace.
function pintarLineas(c){
  const { L } = vista;
  vista.capaLineas.clearLayers();
  const plan = planDeLineas(c.red, { lineas: c.m.filtros.lineas, visibleEquipo: c.visibleEquipo, visibleUbicacion: c.visibleUbicacion, sim: c.sim, seleccionId: c.seleccionId, expandidos: c.expandidos });
  // Colorear por red: solo las líneas normales (no la simulación ni el camino resaltado).
  const colorPorRed = c.m.filtros.colorPorRed && hayRedFinca();
  const colorRed = new Map(c.m.redes.map(r=>[r.id, r.color]));
  const nombreRed = new Map(c.m.redes.map(r=>[r.id, r.nombre]));
  // La línea va con la red del cliente (con la 011, la efectiva: una red
  // aparte sale con su color desde el enlace de su primer equipo).
  const redDe = d=>{
    const e = c.red.equipoPorId.get(d.clienteId), s = c.red.equipoPorId.get(d.servidorId);
    const id = redEfectivaDe(e) ?? redEfectivaDe(s);
    return id !== null && id !== undefined ? id : null;
  };
  const nombreEquipo = id=>{ const e = c.red.equipoPorId.get(id); return e ? e.nombre : "?"; };
  const nombreUbicacion = id=>{ const u = c.red.ubicacionPorId.get(id); return u ? u.nombre : "?"; };
  const { grupos, sueltas } = agruparLineas(plan, { redDe, ordenRedes: c.m.redes.map(r=>r.id), nombreDe: nombreEquipo });
  // v9: el grosor elegido (ancho y punteado) vale para todas las líneas.
  // v11: en 0 no se dibujan (ni sus tooltips), salvo el camino resaltado
  // del equipo elegido, al mínimo visible.
  const factorNormal = grosorDeLinea(grosorLineas, { enCadena: false });
  const anchoDe = estilo=>conGrosor(ESTILOS_LINEA[estilo], factorNormal).weight;
  const trazos = factorNormal ? planDeTrazos(grupos, { colorPorRed, anchoDe }) : [];
  const hayRedes = hayRedFinca() && c.m.redes.length > 0;

  const datosLinea = (el, { clienteId, servidorId, atenuada, etiqueta })=>{
    if(!el) return;
    el.dataset.clienteId = clienteId;
    el.dataset.servidorId = servidorId;
    if(atenuada) el.classList.add(`${P}mapa-linea-atenuada`);
    el.setAttribute("aria-label", etiqueta);
  };
  // Un trazo de un grupo: la línea entera o una de sus franjas.
  const pintarTrazo = t=>{
    const g = t.grupo;
    const puntos = [[g.desde.lat, g.desde.lng], [g.hasta.lat, g.hasta.lng]];
    const base = conGrosor(ESTILOS_LINEA[g.estilo], factorNormal);
    if(t.halo && ESTILOS_CON_HALO.has(g.estilo) && !g.atenuada) lineaCorrida(L, puntos, { ...HALO, weight: t.anchoHaz + 4 }, t.desplazamientoHaz).addTo(vista.capaLineas);
    let estilo = { ...base, weight: t.ancho };
    if(colorPorRed && t.red !== null && t.red !== undefined){ const color = colorRed.get(t.red); if(color) estilo.color = color; }
    if(t.atenuada) estilo = { ...estilo, opacity: estilo.opacity * OPACIDAD_ATENUADA };
    const varios = g.enlaces.length > 1;
    if(varios) estilo.className += ` ${P}mapa-linea-grupo`;
    if(t.franja) estilo.className += ` ${P}mapa-linea-franja`;
    const linea = lineaCorrida(L, puntos, estilo, t.desplazamiento).addTo(vista.capaLineas);
    const primero = t.enlaces[0];
    const textos = varios ? textoTrazo(t, { nombreEquipo, nombreUbicacion, nombreRed: id=>nombreRed.get(id) || "?", hayRedes }) : [textoLinea(c.red, primero)];
    linea.bindTooltip(varios ? `<strong>${esc(textos[0])}</strong>${textos.slice(1).map(x=>`<br>${esc(x)}`).join("")}` : esc(textos[0]), { sticky: true, className: `${P}mapa-tooltip${varios ? ` ${P}mapa-tooltip-grupo` : ""}` });
    linea.on("click", ()=>seleccionarEquipo(primero.clienteId, { encuadrar: false }));
    const el = linea.getElement();
    datosLinea(el, { clienteId: primero.clienteId, servidorId: primero.servidorId, atenuada: t.atenuada, etiqueta: textos.join(". ") });
    if(el){
      el.dataset.grupo = g.clave;
      el.dataset.enlaces = String(t.enlaces.length);
      el.dataset.enlacesTramo = String(g.enlaces.length);
      el.dataset.clientes = t.enlaces.map(d=>d.clienteId).join(" ");
      if(t.red !== undefined) el.dataset.red = t.red === null ? "sin" : String(t.red);
    }
  };
  // Una línea suelta (camino, simulación, respaldo): como siempre.
  const pintarSuelta = d=>{
    const factor = grosorDeLinea(grosorLineas, { enCadena: d.enCadena });
    if(!factor) return;
    let estilo = conGrosor(ESTILOS_LINEA[d.estilo], factor);
    if(colorPorRed && ["backbone", "p2mp", "cable", "fibra"].includes(d.estilo)){ const id = redDe(d); const color = id !== null ? colorRed.get(id) : null; if(color) estilo = { ...estilo, color }; }
    const puntos = [[d.desde.lat, d.desde.lng], [d.hasta.lat, d.hasta.lng]];
    if(ESTILOS_CON_HALO.has(d.estilo) && !d.atenuada) L.polyline(puntos, { ...HALO, weight: estilo.weight + 4 }).addTo(vista.capaLineas);
    const linea = L.polyline(puntos, d.atenuada ? { ...estilo, opacity: estilo.opacity * OPACIDAD_ATENUADA } : estilo).addTo(vista.capaLineas);
    const permanente = d.enCadena || d.estilo === "recuperado";
    if(permanente) linea.bindTooltip(esc(etiquetaCorta(d)), { permanent: true, direction: "center", className: `${P}mapa-etiqueta-enlace ${P}mapa-etiqueta-${d.estilo}` });
    else linea.bindTooltip(esc(textoLinea(c.red, d)), { sticky: true, className: `${P}mapa-tooltip` });
    linea.on("click", ()=>seleccionarEquipo(d.clienteId, { encuadrar: false }));
    datosLinea(linea.getElement(), { clienteId: d.clienteId, servidorId: d.servidorId, atenuada: d.atenuada, etiqueta: textoLinea(c.red, d) });
  };

  // Orden de dibujo: lo atenuado abajo, lo resaltado arriba. Las franjas de
  // un mismo tramo van juntas (con su halo debajo).
  const peso = d=>(d.atenuada ? 0 : 1) + (d.enCadena ? 2 : 0) + (d.estilo === "recuperado" ? 1 : 0);
  const dibujos = [];
  for(const t of trazos){
    const ultimo = dibujos[dibujos.length - 1];
    if(ultimo && ultimo.grupo === t.grupo) ultimo.trazos.push(t);
    else dibujos.push({ grupo: t.grupo, peso: t.grupo.atenuada ? 0 : 1, trazos: [t] });
  }
  for(const d of sueltas) dibujos.push({ peso: peso(d), suelta: d });
  dibujos.sort((a, b)=>a.peso - b.peso);
  for(const x of dibujos){
    if(x.suelta) pintarSuelta(x.suelta);
    else for(const t of x.trazos) pintarTrazo(t);
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
  if(vista && vista.pantalla) vista.pantalla.panelCambio();
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
    alCambiarTipo: trasGuardar(()=>refrescar()),
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

  // v9: grosor de las líneas de conexión (un factor para todas, recordado en
  // este navegador). Mientras se arrastra se repintan solo las líneas.
  const grosor = main.querySelector(`#${P}mapa-grosor`);
  const grosorValor = main.querySelector(`#${P}mapa-grosor-valor`);
  const grosorNormal = main.querySelector(`#${P}mapa-grosor-normal`);
  if(grosor){
    let cuadro = null;
    const aplicarGrosor = (k, { guardar = false } = {})=>{
      grosorLineas = normalizarGrosor(k);
      grosor.value = String(grosorLineas);
      grosor.setAttribute("aria-valuetext", textoGrosor(grosorLineas));
      grosorValor.textContent = textoGrosor(grosorLineas);
      grosorNormal.hidden = grosorLineas === GROSOR_LINEAS.porDefecto;
      if(guardar) recordarGrosor(grosorLineas);
      if(cuadro === null) cuadro = requestAnimationFrame(()=>{
        cuadro = null;
        if(vista && estadoMapa().cargado && document.getElementById(`${P}mapa-panel`)) pintarLineas(calcular());
      });
    };
    aplicarGrosor(grosorInicial());
    grosor.addEventListener("input", ()=>aplicarGrosor(grosor.value));
    grosor.addEventListener("change", ()=>aplicarGrosor(grosor.value, { guardar: true }));
    grosorNormal.addEventListener("click", ()=>{ aplicarGrosor(GROSOR_LINEAS.porDefecto, { guardar: true }); grosor.focus(); });
  }

  // v15 (3.10): «Al pasar el mouse»: qué muestra el tooltip de una ubicación.
  const selTooltip = main.querySelector(`#${P}mapa-tooltip-modo`);
  if(selTooltip){
    selTooltip.value = modoTooltip;
    selTooltip.addEventListener("change", ()=>{
      modoTooltip = selTooltip.value;
      recordarModoTooltip(modoTooltip);
      if(vista && estadoMapa().cargado && document.getElementById(`${P}mapa-panel`)) refrescar();
    });
  }

  // Toggles: todos editan estadoMapa().filtros y repintan.
  const alternarEnLista = (lista, valor)=>lista.includes(valor) ? lista.filter(x=>x !== valor) : [...lista, valor];
  // Si la ubicación elegida quedó con su tipo oculto, se suelta.
  const soltarSiOculta = m=>{
    const u = m.seleccion.ubicacionId ? m.ubicaciones.find(x=>x.id === m.seleccion.ubicacionId) : null;
    if(u && m.filtros.tiposOcultos.includes(u.tipo)) m.seleccion = { ubicacionId: null, equipoId: null, activoId: null };
  };
  // Lo oculto de cada desplegable: leer y poner (para «Todas», «Ninguna» y «solo»).
  const ocultosDe = (f, dd)=>{
    if(dd === "lineas") return (valoresDesplegable.lineas || []).filter(id=>!f.lineas[id]);
    return { ubicaciones: f.tiposOcultos, roles: f.rolesOcultos, redes: f.redesOcultas, tiposEquipo: f.tiposEquipoOcultos, estados: f.estadosOcultos }[dd] || [];
  };
  const ponerOcultos = (m, dd, ocultos)=>{
    const f = m.filtros;
    if(dd === "lineas"){
      const ids = valoresDesplegable.lineas || [];
      f.lineas = { ...f.lineas, ...lineasConVisibles(ids, ids.filter(id=>!ocultos.includes(id))) };
    } else if(dd === "ubicaciones"){ f.tiposOcultos = ocultos; soltarSiOculta(m); }
    else if(dd === "roles") f.rolesOcultos = ocultos;
    else if(dd === "redes") f.redesOcultas = ocultos;
    else if(dd === "tiposEquipo") f.tiposEquipoOcultos = ocultos;
    else if(dd === "estados") f.estadosOcultos = ocultos;
    else return false;
    return true;
  };
  // «Solo esta» (3.5): queda solo esa opción; si ya era la única, vuelven todas.
  const soloEstaOpcion = (dd, valor)=>{
    const m = estadoMapa();
    const valores = valoresDesplegable[dd] || [];
    if(!valores.includes(valor)) return;
    if(ponerOcultos(m, dd, ocultosSoloEsta(valores, ocultosDe(m.filtros, dd), valor))) refrescar();
  };
  const barraFiltros = main.querySelector(`.${P}mapa-filtros`);
  barraFiltros.addEventListener("click", e=>{
    const m = estadoMapa();
    const f = m.filtros;
    const boton = e.target.closest("[data-dd-boton]");
    if(boton){ abrirDesplegable(boton.dataset.ddBoton); return; }
    const todas = e.target.closest("[data-dd-todas]");
    const ninguna = e.target.closest("[data-dd-ninguna]");
    if(todas || ninguna){
      const dd = (todas || ninguna).dataset[todas ? "ddTodas" : "ddNinguna"];
      if(ponerOcultos(m, dd, todas ? [] : [...(valoresDesplegable[dd] || [])])) refrescar();
      return;
    }
    const solo = e.target.closest("[data-solo-dd]");
    if(solo){ soloEstaOpcion(solo.dataset.soloDd, solo.dataset.soloValor); return; }
    const t = e.target.closest("[data-tipo]");
    const l = e.target.closest("[data-linea]");
    const r = e.target.closest("[data-rol]");
    const s = e.target.closest("[data-estado]");
    const rd = e.target.closest("[data-red]");
    const te = e.target.closest("[data-tipo-equipo]");
    if(rd){
      f.redesOcultas = alternarEnLista(f.redesOcultas, rd.dataset.red);
    } else if(te){
      f.tiposEquipoOcultos = alternarEnLista(f.tiposEquipoOcultos, te.dataset.tipoEquipo);
    } else if(e.target.closest("[data-color-red]")){
      f.colorPorRed = !f.colorPorRed;
    } else if(e.target.closest(`#${P}mapa-cobertura`)){
      verCobertura = !verCobertura; // v15 (3.9): se recuerda en este navegador
      recordarCobertura(verCobertura);
    } else if(t){
      f.tiposOcultos = alternarEnLista(f.tiposOcultos, t.dataset.tipo);
      soltarSiOculta(m);
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
    } else if(e.target.closest(`#${P}mapa-quitar-filtros`)){
      m.filtros = filtrosLimpios(f);
      soltarSiOculta(m);
    } else return;
    refrescar();
  });
  // Doble clic en una opción: los dos clics ya la alternaron dos veces (quedó
  // como estaba); el doble clic fija «solo esta».
  barraFiltros.addEventListener("dblclick", e=>{
    const fila = e.target.closest("[data-opcion-dd]");
    if(!fila || e.target.closest("[data-solo-dd]")) return;
    e.preventDefault();
    soloEstaOpcion(fila.dataset.opcionDd, fila.dataset.opcionValor);
  });
  // v13: el buscador de los desplegables filtra la lista al escribir.
  barraFiltros.addEventListener("input", e=>{
    const buscar = e.target.closest && e.target.closest("[data-dd-buscar]");
    if(buscar) aplicarBusquedaDesplegable(buscar.dataset.ddBuscar);
  });
  barraFiltros.addEventListener("keydown", e=>{
    const sinModificadores = !e.ctrlKey && !e.altKey && !e.metaKey;
    // v13, en el buscador: con una sola opción a la vista, Enter la marca o
    // desmarca y Mayús+Enter la deja sola; la flecha abajo baja a la lista.
    const buscar = e.target.closest("[data-dd-buscar]");
    if(buscar){
      const dd = buscar.dataset.ddBuscar;
      if(e.key === "ArrowDown" && sinModificadores && !e.shiftKey){
        const primera = filasVisiblesDesplegable(dd)[0];
        if(primera){ e.preventDefault(); primera.querySelector(`.${P}mapa-opcion-btn`).focus(); }
        return;
      }
      if(e.key !== "Enter" || !sinModificadores) return;
      e.preventDefault();
      const filas = filasVisiblesDesplegable(dd);
      if(filas.length !== 1) return;
      if(e.shiftKey) soloEstaOpcion(dd, filas[0].dataset.opcionValor);
      else filas[0].querySelector(`.${P}mapa-opcion-btn`).click();
      return;
    }
    // v13: flechas arriba y abajo entre las casillas a la vista; desde la
    // primera, arriba vuelve al buscador (si el desplegable tiene).
    if((e.key === "ArrowDown" || e.key === "ArrowUp") && sinModificadores && !e.shiftKey){
      const boton = e.target.closest(`.${P}mapa-opcion-btn`);
      const fila = boton && boton.closest("[data-opcion-dd]");
      if(!fila) return;
      const dd = fila.dataset.opcionDd;
      const filas = filasVisiblesDesplegable(dd);
      const i = filas.indexOf(fila);
      e.preventDefault();
      const destino = e.key === "ArrowDown" ? filas[i + 1] : filas[i - 1];
      if(destino) destino.querySelector(`.${P}mapa-opcion-btn`).focus();
      else if(e.key === "ArrowUp") document.querySelector(`[data-dd-buscar="${dd}"]`)?.focus();
      return;
    }
    // Mayús+Enter sobre una opción: «solo esta» (sin el clic que haría Enter).
    if(!esMayusEnter(e)) return;
    const fila = e.target.closest("[data-opcion-dd]");
    if(!fila) return;
    e.preventDefault();
    soloEstaOpcion(fila.dataset.opcionDd, fila.dataset.opcionValor);
  });
  // Un clic afuera cierra el desplegable abierto. Se mira el camino del evento
  // (no e.target.closest): la opción tocada puede haberse rearmado.
  if(alClicFueraFiltros) document.removeEventListener("click", alClicFueraFiltros);
  alClicFueraFiltros = e=>{
    if(!desplegableAbierto()) return;
    if(e.composedPath().some(n=>n && n.classList && n.classList.contains(`${P}mapa-desplegable`))) return;
    cerrarDesplegables();
  };
  document.addEventListener("click", alClicFueraFiltros);
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
