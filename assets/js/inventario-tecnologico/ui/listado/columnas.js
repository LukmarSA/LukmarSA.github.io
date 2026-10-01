import { state } from "../../nucleo/estado.js";
import { esc } from "../../nucleo/helpers.js";
import { cargarCamposActivo } from "../../nucleo/datos.js";
import { CLAVE_CAMPO_POR_COLUMNA, LABEL_CAMPO, PREFIJO_COLUMNA_CAMPO, etiquetaConUnidad, ordenarCampos } from "../../nucleo/campos-personalizados.js";
import { contenidoBotonFiltro, flechaOrden, opcionesFiltroCache, panelFiltroHtml, seleccionActiva } from "./filtros.js";
import { abrirModal, cerrarModal, renderMain } from "../render-raiz.js";

export const DEFINICION_COLUMNAS = [
  { key:"inventario-tecnologico-tag",        label:"Tag",             core:true,  weight:1.0, sortCampo:"id",       filterCampo:null,           campoTexto:"colTag",       placeholder:"Ej: 012" },
  { key:"tipo",       label:"Tipo",            core:false, weight:1.9, sortCampo:"tipo",     filterCampo:"tipo",         campoTexto:"colTipo",      placeholder:"Buscar tipo…" },
  { key:"marca",      label:"Marca",           core:false, weight:1.5, sortCampo:"marca",    filterCampo:"marca",        campoTexto:"colMarca",     placeholder:"Buscar marca…" },
  { key:"modelo",     label:"Modelo",          core:false, weight:1.6, sortCampo:"modelo",   filterCampo:null,           campoTexto:"colModelo",    placeholder:"Buscar modelo…" },
  { key:"nombre",     label:"Nombre equipo",   core:false, weight:1.6, sortCampo:"nombre",   filterCampo:null,           campoTexto:"colNombre",    placeholder:"Buscar nombre…" },
  { key:"estado",     label:"Estado",          core:false, weight:1.2, sortCampo:"estado",   filterCampo:"estado",       campoTexto:null,           placeholder:null },
  { key:"custodio",   label:"Custodio",        core:false, weight:2.4, sortCampo:"custodio", filterCampo:"custodioClase",campoTexto:"colCustodio",  placeholder:"Buscar nombre…" },
  { key:"cargo",      label:"Cargo",           core:false, weight:1.5, sortCampo:"cargo",    filterCampo:null,           campoTexto:"colCargo",     placeholder:"Buscar cargo…" },
  { key:"fechaentrega",label:"Fecha entrega",  core:false, weight:1.3, sortCampo:"fechaentrega",filterCampo:null,        campoTexto:null,           placeholder:null },
  { key:"propiedad",  label:"Propiedad",       core:false, weight:1.1, sortCampo:"propiedad",filterCampo:"propiedad",    campoTexto:"colPropiedad", placeholder:"Buscar propiedad…" },
  { key:"serie",      label:"Serie",           core:false, weight:1.4, sortCampo:"serie",    filterCampo:null,           campoTexto:"colSerie",     placeholder:"Buscar serie…" },
  { key:"so",         label:"Sist. operativo", core:false, weight:1.3, sortCampo:"so",       filterCampo:null,           campoTexto:"colSo",        placeholder:"Buscar SO…" },
  { key:"ram",        label:"RAM (GB)",        core:false, weight:0.8, sortCampo:"ram",      filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"disco",      label:"Disco (GB)",      core:false, weight:0.8, sortCampo:"disco",    filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"procesador", label:"Procesador",      core:false, weight:1.5, sortCampo:"procesador",filterCampo:null,          campoTexto:null,           placeholder:null },
  { key:"macwifi",    label:"MAC WiFi",        core:false, weight:1.4, sortCampo:"macwifi",  filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"maceth",     label:"MAC Ethernet",    core:false, weight:1.4, sortCampo:"maceth",   filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"fecha",      label:"Adquisición",     core:false, weight:1.6, sortCampo:"fecha",    filterCampo:null,           campoTexto:null,           placeholder:null, filtroFecha:true },
  { key:"proveedor",  label:"Proveedor",       core:false, weight:1.3, sortCampo:"proveedor",filterCampo:null,           campoTexto:"colProveedor", placeholder:"Buscar proveedor…" },
  { key:"valorcompra",label:"Valor compra",    core:false, weight:1.1, sortCampo:"valorcompra",filterCampo:null,         campoTexto:null,           placeholder:null },
  { key:"valoractual",label:"Valor actual",    core:false, weight:1.3, sortCampo:"valoractual",filterCampo:null,         campoTexto:null,           placeholder:null },
  { key:"vidautil",   label:"Vida útil",       core:false, weight:0.8, sortCampo:"vidautil", filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"color",      label:"Color",           core:false, weight:0.8, sortCampo:"color",    filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"longitud",   label:"Longitud (m)",    core:false, weight:0.8, sortCampo:"longitud", filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"acciones",   label:"",                core:true,  weight:2.2, sortCampo:null,       filterCampo:null,           campoTexto:null,           placeholder:null },
];

export const COLUMNAS_VISIBLES_DEFAULT = ["inventario-tecnologico-tag","tipo","marca","estado","custodio","propiedad","acciones"];

// v10: las columnas de la tabla. Las de siempre, con la etiqueta que se le
// haya puesto al campo en Configuración (si cambió), y una columna opcional
// por cada campo nuevo activo (clave "campo:<clave>"), antes de Acciones.
export function definicionColumnas(){
  const defs = cargarCamposActivo();
  const porClave = new Map(defs.map(d=>[d.clave, d]));
  const fijas = DEFINICION_COLUMNAS.map(c=>{
    const d = porClave.get(CLAVE_CAMPO_POR_COLUMNA[c.key]);
    if(!d || d.etiqueta === LABEL_CAMPO[d.clave]) return c;
    return { ...c, label: etiquetaConUnidad(d) };
  });
  const nuevas = ordenarCampos(defs.filter(d=>!d.fijo && d.activo)).map(d=>({
    key: PREFIJO_COLUMNA_CAMPO + d.clave, label: etiquetaConUnidad(d), core: false,
    weight: d.tipo_dato === "texto_largo" ? 2 : 1.3,
    sortCampo: PREFIJO_COLUMNA_CAMPO + d.clave, filterCampo: null,
    campoTexto: d.tipo_dato === "fecha" ? null : PREFIJO_COLUMNA_CAMPO + d.clave,
    placeholder: "Buscar…", campo: d,
  }));
  const i = fijas.findIndex(c=>c.key === "acciones");
  return [...fijas.slice(0, i), ...nuevas, ...fijas.slice(i)];
}

export const LIMITE_COLUMNAS_RECOMENDADO = 7;

export const MEDIA_COLAPSADA = "(max-width:720px)";

export function columnasColapsadas(){
  return window.matchMedia && window.matchMedia(MEDIA_COLAPSADA).matches;
}

export function abrirGestorColumnas(){
  // Orden alfabético SOLO para cómo se listan los checkboxes acá — el orden
  // real de las columnas en la tabla lo sigue decidiendo
  // columnasVisiblesOrdenadas(), que usa el orden de DEFINICION_COLUMNAS
  // (Tag primero, Acciones al final), no este.
  const opcionesNoCore = definicionColumnas().filter(c=>!c.core)
    .sort((a,b)=>a.label.localeCompare(b.label,'es'));
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>Columnas visibles</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-bottom:10px;">Tag y Acciones siempre se muestran. Elige qué otras columnas ver en la tabla — en celular, de todos modos solo se muestran Tipo y Custodio.</div>
      <div id="inventario-tecnologico-aviso-columnas"></div>
      <input type="text" id="inventario-tecnologico-filtro-cols-texto" placeholder="Filtrar columnas por nombre…" style="margin-bottom:10px;" autocomplete="off">
      <div id="inventario-tecnologico-lista-cols" class="inventario-tecnologico-filter-panel-list" style="max-height:none;">
        ${opcionesNoCore.map(c=>`
          <label class="inventario-tecnologico-filter-opt" data-col-opt="${c.key}" data-col-opt-label="${esc(c.label.toLowerCase())}">
            <input type="checkbox" data-col-toggle="${c.key}" ${state.columnasVisibles.has(c.key)?"checked":""}>
            <span class="inventario-tecnologico-filter-opt-label">${esc(c.label)}</span>
          </label>`).join("")}
      </div>
      <div id="inventario-tecnologico-cols-sin-resultados" class="inventario-tecnologico-hint" style="display:none;">Ninguna columna coincide con esa búsqueda.</div>
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-restablecer-columnas">↺ Restablecer columnas por defecto</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cerrar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    actualizarAvisoColumnas();
    document.querySelectorAll("[data-col-toggle]").forEach(cb=>{
      cb.addEventListener("change", ()=>{
        const key = cb.dataset.colToggle;
        if(cb.checked) state.columnasVisibles.add(key); else state.columnasVisibles.delete(key);
        actualizarAvisoColumnas();
        renderMain(); // cambia el ancho de todas las columnas: hace falta rehacer el thead completo
      });
    });
    document.getElementById("inventario-tecnologico-btn-restablecer-columnas").addEventListener("click", ()=>{
      restablecerColumnasPorDefecto();
      cerrarModal(); renderMain(); abrirGestorColumnas();
    });
    // Task #30 — filtra la lista de checkboxes por su nombre mientras se
    // escribe, sin tocar el estado de columnas visibles (solo oculta filas).
    const filtroTexto = document.getElementById("inventario-tecnologico-filtro-cols-texto");
    filtroTexto.addEventListener("input", ()=>{
      const t = filtroTexto.value.trim().toLowerCase();
      let visibles = 0;
      document.querySelectorAll("#inventario-tecnologico-lista-cols [data-col-opt]").forEach(fila=>{
        const coincide = fila.dataset.colOptLabel.includes(t);
        fila.style.display = coincide ? "" : "none";
        if(coincide) visibles++;
      });
      document.getElementById("inventario-tecnologico-cols-sin-resultados").style.display = visibles===0 ? "" : "none";
    });
  });
}

export function restablecerColumnasPorDefecto(){
  definicionColumnas()
    .filter(c => state.columnasVisibles.has(c.key) && !COLUMNAS_VISIBLES_DEFAULT.includes(c.key))
    .forEach(c=>{
      if(c.filterCampo) state.filtros[c.filterCampo] = null;
      if(c.campoTexto) state.filtros[c.campoTexto] = "";
      if(c.filtroFecha){ state.filtros.colFechaDesde = ""; state.filtros.colFechaHasta = ""; }
    });
  state.columnasVisibles = new Set(COLUMNAS_VISIBLES_DEFAULT);
}

export function actualizarAvisoColumnas(){
  const holder = document.getElementById("inventario-tecnologico-aviso-columnas");
  if(!holder) return;
  const total = state.columnasVisibles.size;
  holder.innerHTML = total > LIMITE_COLUMNAS_RECOMENDADO
    ? `<div class="inventario-tecnologico-alert inventario-tecnologico-alert-error" style="margin-bottom:10px;">Tienes ${total} columnas visibles. Recomendamos no pasar de ${LIMITE_COLUMNAS_RECOMENDADO} para que la tabla se siga leyendo bien en pantallas medianas — pero si te sirve así, puedes dejarlo.</div>`
    : "";
}

export function thColumna(o){
  const { sortCampo, filterCampo, label, ordenable, opcionesChecklist, campoTexto, placeholderTexto, filtroFecha, colClass, widthPct } = o;
  const filaLabel = ordenable
    ? `<span class="inventario-tecnologico-th-label inventario-tecnologico-th-sortable" data-sort="${sortCampo}"><span class="inventario-tecnologico-th-label-text">${esc(label)}</span>${flechaOrden(sortCampo)}</span>`
    : `<span class="inventario-tecnologico-th-label"><span class="inventario-tecnologico-th-label-text">${esc(label)}</span></span>`;
  let filtroBtn = "";
  if(opcionesChecklist){
    const seleccion = seleccionActiva(filterCampo);
    const activo = seleccion.size < opcionesChecklist.length;
    const vacio = seleccion.size === 0;
    filtroBtn = `<div class="inventario-tecnologico-th-filter">
      <button type="button" class="inventario-tecnologico-th-filter-btn ${activo?'inventario-tecnologico-active':''} ${vacio?'inventario-tecnologico-empty':''}" data-filtro-btn="${filterCampo}" tabindex="0" aria-label="Filtrar ${esc(label)}">${contenidoBotonFiltro(filterCampo, opcionesChecklist)}</button>
      ${panelFiltroHtml(filterCampo, opcionesChecklist)}
    </div>`;
  }
  const filaTexto = filtroFecha
    ? `<div class="inventario-tecnologico-th-row2 inventario-tecnologico-th-row2-fecha">
        <input type="date" class="inventario-tecnologico-th-date-filter" data-col-fecha="colFechaDesde" title="Desde" value="${esc(state.filtros.colFechaDesde||'')}">
        <input type="date" class="inventario-tecnologico-th-date-filter" data-col-fecha="colFechaHasta" title="Hasta" value="${esc(state.filtros.colFechaHasta||'')}">
      </div>`
    : campoTexto
    ? `<div class="inventario-tecnologico-th-row2"><input type="text" class="inventario-tecnologico-th-text-filter" data-col-texto="${campoTexto}" placeholder="${esc(placeholderTexto||'Buscar…')}" value="${esc(state.filtros[campoTexto]||'')}"></div>`
    : "";
  const estilo = widthPct ? ` style="width:${widthPct}"` : "";
  return `<th class="${colClass||''}"${estilo}><div class="inventario-tecnologico-th-inner"><div class="inventario-tecnologico-th-row1">${filaLabel}${filtroBtn}</div>${filaTexto}</div></th>`;
}

export function columnasVisiblesOrdenadas(){
  return definicionColumnas().filter(c=>state.columnasVisibles.has(c.key));
}

export function filaEncabezados(){
  const cols = columnasVisiblesOrdenadas();
  const pesoTotal = cols.reduce((s,c)=>s+c.weight,0);
  return cols.map(c=>{
    const widthPct = ((c.weight/pesoTotal)*100).toFixed(2)+"%";
    if(c.key==="acciones") return `<th class="inventario-tecnologico-col-acciones" style="width:${widthPct}"></th>`;
    return thColumna({
      sortCampo:c.sortCampo, filterCampo:c.filterCampo, label:c.label,
      ordenable:!!c.sortCampo,
      opcionesChecklist:c.filterCampo ? opcionesFiltroCache[c.filterCampo] : null,
      campoTexto:c.campoTexto, placeholderTexto:c.placeholder, filtroFecha:c.filtroFecha,
      colClass:`inventario-tecnologico-col-${c.key}`, widthPct,
    });
  }).join("");
}
