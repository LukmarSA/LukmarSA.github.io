import { cargarActivos } from "../../nucleo/datos.js";
import { state } from "../../nucleo/estado.js";
import { esc, fmtFecha, fmtTag, fmtValorActualConPorcentaje } from "../../nucleo/helpers.js";
import { colorTipo, columnaAplicaATipo, iconoTipo, pillEstado, pillPropiedad } from "../../nucleo/opciones-configurables.js";
import { puede } from "../../nucleo/permisos.js";
import { estaEnPortapapeles, toggleEnPortapapeles } from "../detalle/acta.js";
import { abrirCambiarCustodio } from "../detalle/cambiar-custodio.js";
import { abrirConfirmarBaja } from "../detalle/confirmar-baja.js";
import { abrirFormActivo } from "../detalle/form-activo.js";
import { abrirDetalle } from "../detalle/vista.js";
import { abrirGestorColumnas, columnasVisiblesOrdenadas, filaEncabezados } from "./columnas.js";
import { exportarActivosExcel } from "./exportar-excel.js";
import { actualizarBotonFiltroActivo, actualizarConteosFiltros, actualizarFlechasOrden, estadoInicialFiltros, hayFiltrosActivos, listaOrdenadaFiltrada, marcarCheckboxesPanel, opcionesFiltroCache, recalcularOpcionesFiltro, tramoVigente } from "./filtros.js";
import { abrirHistorialCustodio } from "./historial-custodio.js";
import { abrirPendientesFirma, listaPendientesFirma } from "./pendientes-firma.js";
import { CAMPOS_RESUMEN_GLOBAL, abrirModalKpiColumna, calcularResumenColumna, copiarAlPortapapelesTexto, descargarArchivoTexto, resumenACSV, resumenAHTML, resumenATextoWhatsApp } from "./resumen.js";
import { mostrarToast, renderMain } from "../render-raiz.js";

export function renderVistaActivos(main){
  const datos = cargarActivos();
  recalcularOpcionesFiltro(datos);
  const nPendientesFirma = listaPendientesFirma(datos).length;

  main.innerHTML = `
    <div class="inventario-tecnologico-filterbar">
      <input type="text" id="inventario-tecnologico-f-texto" placeholder="Buscar por tag, marca, serie, custodio…" value="${esc(state.filtros.texto)}">
      <div class="inventario-tecnologico-fb-spacer"></div>
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-limpiar-filtros" ${hayFiltrosActivos()?"":"disabled"} title="Quitar todos los filtros aplicados">✕ Quitar filtros</button>
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-columnas">☰ Columnas</button>
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-exportar">⭳ Exportar a Excel</button>
      <div class="inventario-tecnologico-dropdown-wrap" id="inventario-tecnologico-dropdown-resumenes">
        <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-exportar-resumenes">📊 Exportar resúmenes ▾</button>
        <div class="inventario-tecnologico-dropdown-menu" id="inventario-tecnologico-menu-exportar-resumenes" hidden>
          <button type="button" class="inventario-tecnologico-dropdown-item" data-formato-global="wa">Copiar para WhatsApp</button>
          <button type="button" class="inventario-tecnologico-dropdown-item" data-formato-global="csv">Descargar CSV</button>
          <button type="button" class="inventario-tecnologico-dropdown-item" data-formato-global="html">Descargar HTML</button>
        </div>
      </div>
      <button class="inventario-tecnologico-btn ${nPendientesFirma?'inventario-tecnologico-btn-warn':''}" id="inventario-tecnologico-btn-pendientes-firma" title="Entregas ya realizadas cuya acta todavía no se ha firmado">🖊️ Pendientes de firma${nPendientesFirma?` (${nPendientesFirma})`:""}</button>
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-historial-custodio" title="Buscar activos por un custodio pasado o presente, con fechas">🕘 Historial por custodio</button>
      ${puede("crear_activo") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-nuevo">+ Nuevo activo</button>` : ""}
    </div>
    <div class="inventario-tecnologico-tablewrap inventario-tecnologico-tablewrap-activos">
      <table>
        <thead><tr id="inventario-tecnologico-fila-encabezados"></tr></thead>
        <tbody id="inventario-tecnologico-tbody-activos"></tbody>
      </table>
      <div id="inventario-tecnologico-empty-state-holder"></div>
    </div>
  `;
  document.getElementById("inventario-tecnologico-fila-encabezados").innerHTML = filaEncabezados();
  document.querySelectorAll(".inventario-tecnologico-th-text-filter").forEach(inp=>{
    inp.addEventListener("input", e=>{
      state.filtros[e.target.dataset.colTexto] = e.target.value;
      actualizarTablaYResumen();
    });
  });
  document.querySelectorAll(".inventario-tecnologico-th-date-filter").forEach(inp=>{
    inp.addEventListener("input", e=>{
      state.filtros[e.target.dataset.colFecha] = e.target.value;
      actualizarTablaYResumen();
    });
  });
  actualizarTablaYResumen();

  document.getElementById("inventario-tecnologico-f-texto").addEventListener("input", e=>{
    state.filtros.texto = e.target.value;
    actualizarTablaYResumen();
  });
  const btnNuevo = document.getElementById("inventario-tecnologico-btn-nuevo");
  if(btnNuevo) btnNuevo.addEventListener("click", ()=>abrirFormActivo(null));
  const btnPendientesFirma = document.getElementById("inventario-tecnologico-btn-pendientes-firma");
  if(btnPendientesFirma) btnPendientesFirma.addEventListener("click", abrirPendientesFirma);
  document.getElementById("inventario-tecnologico-btn-historial-custodio").addEventListener("click", abrirHistorialCustodio);
  document.getElementById("inventario-tecnologico-btn-exportar").addEventListener("click", async ()=>{
    try{ await exportarActivosExcel(); }
    catch(err){ mostrarToast("No se pudo generar el Excel: " + err.message, "error"); }
  });
  document.getElementById("inventario-tecnologico-btn-limpiar-filtros").addEventListener("click", ()=>{
    state.filtros = estadoInicialFiltros();
    renderMain();
  });
  document.getElementById("inventario-tecnologico-btn-columnas").addEventListener("click", abrirGestorColumnas);
  document.getElementById("inventario-tecnologico-btn-exportar-resumenes").addEventListener("click", (e)=>{
    e.stopPropagation();
    document.getElementById("inventario-tecnologico-menu-exportar-resumenes").hidden = !document.getElementById("inventario-tecnologico-menu-exportar-resumenes").hidden;
  });
  document.querySelectorAll("[data-formato-global]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      document.getElementById("inventario-tecnologico-menu-exportar-resumenes").hidden = true;
      const secciones = CAMPOS_RESUMEN_GLOBAL.map(calcularResumenColumna);
      const formato = b.dataset.formatoGlobal;
      if(formato==="wa"){
        try{ await copiarAlPortapapelesTexto(resumenATextoWhatsApp(secciones)); mostrarToast("Copiado — pégalo directo en WhatsApp.", "success"); }
        catch(err){ mostrarToast("No se pudo copiar: " + err.message, "error"); }
      } else if(formato==="csv"){
        descargarArchivoTexto("resumenes_activos.csv", resumenACSV(secciones), "text/csv");
      } else if(formato==="html"){
        descargarArchivoTexto("resumenes_activos.html", resumenAHTML(secciones, "Resúmenes de activos"), "text/html");
      }
    });
  });
}

export function actualizarTablaYResumen(){
  const main = document.getElementById("inventario-tecnologico-main");
  if(!main || state.vista !== "activos") return;
  const btnLimpiar = document.getElementById("inventario-tecnologico-btn-limpiar-filtros");
  if(btnLimpiar) btnLimpiar.disabled = !hayFiltrosActivos();
  // Cualquier cambio de filtro puede achicar la tabla (menos filas, o incluso
  // 0). Sin esto, el navegador puede "clampear" el scroll hacia arriba al
  // reducirse la altura de la página, moviendo el header bajo el cursor y
  // cerrando el menú de filtro que estaba abierto por hover.
  const scrollXAntes = window.scrollX, scrollYAntes = window.scrollY;
  const datos = cargarActivos();
  const lista = listaOrdenadaFiltrada(datos);
  const tbody = document.getElementById("inventario-tecnologico-tbody-activos");
  if(tbody){
    tbody.innerHTML = lista.map(a=>filaActivo(a)).join("");
    tbody.querySelectorAll("tr[data-id]").forEach(tr=>{
      tr.addEventListener("click", (e)=>{
        if(e.target.closest("[data-stop]")) return;
        abrirDetalle(Number(tr.dataset.id));
      });
    });
  }
  const holder = document.getElementById("inventario-tecnologico-empty-state-holder");
  if(holder) holder.innerHTML = lista.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Ningún activo coincide con estos filtros.</div>` : "";
  actualizarConteosFiltros();
  if(window.scrollX !== scrollXAntes || window.scrollY !== scrollYAntes){
    window.scrollTo(scrollXAntes, scrollYAntes);
  }
}

document.addEventListener("click", (e)=>{
  const verKpis = e.target.closest("[data-ver-kpis]");
  if(verKpis){
    abrirModalKpiColumna(verKpis.dataset.verKpis);
    return;
  }
  const btn = e.target.closest("[data-action]");
  if(btn){
    const id = Number(btn.dataset.id);
    const accion = btn.dataset.action;
    if(accion==="custodio") abrirCambiarCustodio(id);
    if(accion==="baja") abrirConfirmarBaja(id);
    if(accion==="marcar"){ toggleEnPortapapeles(id); actualizarTablaYResumen(); return; }
    return;
  }
  const sortLabel = e.target.closest("[data-sort]");
  if(sortLabel){
    const campo = sortLabel.dataset.sort;
    if(state.orden.campo===campo) state.orden.dir = state.orden.dir==="asc"?"desc":"asc";
    else { state.orden.campo = campo; state.orden.dir = "asc"; }
    actualizarFlechasOrden();
    actualizarTablaYResumen();
    return;
  }
  const btnTodos = e.target.closest("[data-filtro-todos]");
  if(btnTodos){
    const campo = btnTodos.dataset.filtroTodos;
    state.filtros[campo] = new Set(opcionesFiltroCache[campo]);
    marcarCheckboxesPanel(campo, state.filtros[campo]);
    actualizarBotonFiltroActivo(campo);
    actualizarTablaYResumen();
    return;
  }
  const btnNinguno = e.target.closest("[data-filtro-ninguno]");
  if(btnNinguno){
    const campo = btnNinguno.dataset.filtroNinguno;
    state.filtros[campo] = new Set();
    marcarCheckboxesPanel(campo, state.filtros[campo]);
    actualizarBotonFiltroActivo(campo);
    actualizarTablaYResumen();
    return;
  }
});

document.addEventListener("input", (e)=>{
  const buscador = e.target.closest("[data-filtro-buscar]");
  if(!buscador) return;
  const campo = buscador.dataset.filtroBuscar;
  const q = buscador.value.trim().toLowerCase();
  document.querySelectorAll(`.inventario-tecnologico-filter-opt[data-filtro-opt-campo="${campo}"]`).forEach(opt=>{
    const texto = opt.querySelector(".inventario-tecnologico-filter-opt-label").textContent.toLowerCase();
    opt.style.display = texto.includes(q) ? "" : "none";
  });
});

document.addEventListener("change", (e)=>{
  const cb = e.target.closest("input[data-filtro-campo]");
  if(!cb) return;
  const campo = cb.dataset.filtroCampo;
  if(state.filtros[campo] === null) state.filtros[campo] = new Set(opcionesFiltroCache[campo]);
  const set = state.filtros[campo];
  if(cb.checked) set.add(cb.dataset.filtroValor); else set.delete(cb.dataset.filtroValor);
  actualizarBotonFiltroActivo(campo);
  actualizarTablaYResumen();
});

document.addEventListener("dblclick", (e)=>{
  const opt = e.target.closest(".inventario-tecnologico-filter-opt");
  if(!opt) return;
  e.preventDefault();
  const campo = opt.dataset.filtroOptCampo;
  const valor = opt.dataset.filtroOptValor;
  state.filtros[campo] = new Set([valor]);
  marcarCheckboxesPanel(campo, state.filtros[campo]);
  actualizarBotonFiltroActivo(campo);
  actualizarTablaYResumen();
});

export function celdaInline(colLetra, fila, styleIdx, valor){
  const texto = (valor===null||valor===undefined||valor==="") ? "" :
    String(valor).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<c r="${colLetra}${fila}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
}

export function pillCustodio(a){
  if(a.custodio===null) return `<span class="inventario-tecnologico-pill inventario-tecnologico-pill-cell inventario-tecnologico-pill-good"><span class="inventario-tecnologico-pill-dot"></span>Disponible</span>`;
  if(a.custodio.tipo_custodio==="mantenimiento") return `<span class="inventario-tecnologico-pill inventario-tecnologico-pill-cell inventario-tecnologico-pill-mantenimiento"><span class="inventario-tecnologico-pill-dot"></span><span class="inventario-tecnologico-cell-clip">${esc(a.custodio.nombre)}</span></span>`;
  if(a.custodio.tipo_custodio==="area") return `<span class="inventario-tecnologico-pill inventario-tecnologico-pill-cell inventario-tecnologico-pill-area"><span class="inventario-tecnologico-pill-dot"></span><span class="inventario-tecnologico-cell-clip">${esc(a.custodio.nombre)}</span></span>`;
  return `<span class="inventario-tecnologico-pill inventario-tecnologico-pill-cell inventario-tecnologico-pill-persona"><span class="inventario-tecnologico-pill-dot"></span><span class="inventario-tecnologico-cell-clip">${esc(a.custodio.nombre)}</span></span>`;
}

export function colorCustodioActual(a){
  if(a.custodio===null) return "#3E7D4F";
  if(a.custodio.tipo_custodio==="mantenimiento") return "#A6710B";
  if(a.custodio.tipo_custodio==="area") return "#5B4B8A";
  return "#004DAB";
}

export function gradienteCustodioActual(a){
  const c = colorCustodioActual(a);
  return `linear-gradient(135deg, ${c}1F 0%, ${c}08 100%)`;
}

export function bloquePerfilCustodio(a){
  if(a.custodio===null){
    return `<div class="inventario-tecnologico-detail-profile-info">
      <div class="inventario-tecnologico-detail-profile-name">Disponible</div>
      <div class="inventario-tecnologico-detail-profile-cargo">Sin custodio asignado</div>
    </div>`;
  }
  const esArea = a.custodio.tipo_custodio==="area";
  const esMantenimiento = a.custodio.tipo_custodio==="mantenimiento";
  const linea2 = a.custodio.cargo
    ? esc(a.custodio.cargo)
    : (esMantenimiento ? "En mantenimiento" : (esArea ? "Área / departamento sin especificar" : "Sin cargo registrado"));
  return `<div class="inventario-tecnologico-detail-profile-info">
    <div class="inventario-tecnologico-detail-profile-name">${esc(a.custodio.nombre)}</div>
    <div class="inventario-tecnologico-detail-profile-cargo">${linea2}</div>
  </div>`;
}

export function tarjetaBadge(label, valorHtml, color){
  return `<div class="inventario-tecnologico-detail-badge-card" style="border-left-color:${color};background:linear-gradient(135deg, ${color}17 0%, var(--surface-2) 75%);">
    <span class="inventario-tecnologico-detail-badge" style="background:${color}22;color:${color};">${esc(label)}</span>
    <div class="inventario-tecnologico-detail-badge-value">${valorHtml}</div>
  </div>`;
}

export function celdaTextoRecortado(valor, claseExtra){
  if(!valor) return '<span class="inventario-tecnologico-cell-muted">—</span>';
  const v = esc(valor);
  return `<span class="inventario-tecnologico-cell-clip ${claseExtra||''}" title="${v}">${v}</span>`;
}

export function celdaMoneda(valor){
  return (valor===null||valor===undefined) ? '<span class="inventario-tecnologico-cell-muted">—</span>' : '$'+Number(valor).toFixed(2);
}

export function celdaNumeroUnidad(valor, unidad){
  return (valor===null||valor===undefined||valor==="") ? '<span class="inventario-tecnologico-cell-muted">—</span>' : `${valor} ${unidad}`;
}

export function celdaActivo(col, a){
  if(!columnaAplicaATipo(col.key, a.tipo)) return '<span class="inventario-tecnologico-cell-na" title="No aplica para este tipo de activo">n/a</span>';
  switch(col.key){
    case "inventario-tecnologico-tag": return `<span class="inventario-tecnologico-tag">${fmtTag(a)}</span>`;
    case "tipo": return `<span class="inventario-tecnologico-tipo-cell"><span class="inventario-tecnologico-tipo-icon" style="color:${colorTipo(a.tipo)}">${iconoTipo(a.tipo)}</span><span class="inventario-tecnologico-cell-clip">${esc(a.tipo)||'<span class="inventario-tecnologico-cell-muted">—</span>'}</span></span>`;
    case "marca": return celdaTextoRecortado(a.marca);
    case "modelo": return celdaTextoRecortado(a.modelo);
    case "nombre": return celdaTextoRecortado(a.nombre_dispositivo);
    case "estado": return pillEstado(a.estado);
    case "custodio": return pillCustodio(a);
    case "cargo": return celdaTextoRecortado(a.custodio ? a.custodio.cargo : null);
    case "fechaentrega": { const t = tramoVigente(a); return (t && t.desde) ? fmtFecha(t.desde) : '<span class="inventario-tecnologico-cell-muted">—</span>'; }
    case "propiedad": return pillPropiedad(a.propiedad);
    case "serie": return celdaTextoRecortado(a.serie, "inventario-tecnologico-mono");
    case "so": return celdaTextoRecortado(a.sistema_operativo);
    case "ram": return celdaNumeroUnidad(a.ram_gb, "GB");
    case "disco": return celdaNumeroUnidad(a.disco_gb, "GB");
    case "procesador": return celdaTextoRecortado(a.procesador);
    case "macwifi": return celdaTextoRecortado(a.mac_wifi, "inventario-tecnologico-mono");
    case "maceth": return celdaTextoRecortado(a.mac_ethernet, "inventario-tecnologico-mono");
    case "fecha": return a.fecha_adquisicion ? fmtFecha(a.fecha_adquisicion) : '<span class="inventario-tecnologico-cell-muted">—</span>';
    case "proveedor": return celdaTextoRecortado(a.proveedor);
    case "valorcompra": return celdaMoneda(a.valor_compra);
    case "valoractual": return fmtValorActualConPorcentaje(a) || '<span class="inventario-tecnologico-cell-muted">—</span>';
    case "vidautil": return celdaNumeroUnidad(a.vida_util_anios, a.vida_util_anios===1?"año":"años");
    case "color": return celdaTextoRecortado(a.color);
    case "longitud": return celdaNumeroUnidad(a.longitud_m, "m");
    case "acciones": {
      const marcado = estaEnPortapapeles(a.id);
      return `<div class="inventario-tecnologico-cell-actions">
      ${a.custodio ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm ${marcado?'inventario-tecnologico-btn-primary':''}" data-action="marcar" data-id="${a.id}" aria-pressed="${marcado}" title="${marcado?'Marcado para acta — clic para quitar':'Marcar para acta de entrega unificada'}">🔖</button>` : ""}
      ${puede("cambiar_custodio") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-action="custodio" data-id="${a.id}">Custodio</button>`:""}
      ${puede("dar_baja") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm inventario-tecnologico-btn-danger" data-action="baja" data-id="${a.id}">Baja</button>`:""}
    </div>`;
    }
    default: return "";
  }
}

export function filaActivo(a){
  const celdas = columnasVisiblesOrdenadas().map(c=>{
    const stop = c.key==="acciones" ? " data-stop" : "";
    return `<td class="inventario-tecnologico-col-${c.key}"${stop}>${celdaActivo(c, a)}</td>`;
  }).join("");
  return `<tr class="inventario-tecnologico-rowclick" data-id="${a.id}">${celdas}</tr>`;
}
