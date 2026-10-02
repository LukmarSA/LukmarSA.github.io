import { cargarActivos } from "../../nucleo/datos.js";
import { state } from "../../nucleo/estado.js";
import { esc, fmtTag, valorActualActivo } from "../../nucleo/helpers.js";
import { campoPorClave, camposDeTipo, infoEstado, infoPropiedad } from "../../nucleo/opciones-configurables.js";
import { PREFIJO_COLUMNA_CAMPO, textoValor, valorCrudo, valorParaOrdenar } from "../../nucleo/campos-personalizados.js";
import { NOMBRE_COLUMNA_KPI } from "./resumen.js";
import { AYUDA_SOLO, tituloSolo } from "../../nucleo/solo-esta.js";

export let opcionesFiltroCache = { tipo:[], propiedad:[], custodioClase:[], marca:[], estado:[] };

export function recalcularOpcionesFiltro(datos){
  opcionesFiltroCache.tipo = [...new Set(datos.activos.map(a=>a.tipo).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.propiedad = [...new Set(datos.activos.map(a=>a.propiedad).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.custodioClase = [...new Set(datos.activos.map(a=>claseCustodio(a)))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.marca = [...new Set(datos.activos.map(a=>a.marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.estado = [...new Set(datos.activos.map(a=>a.estado).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
}

export function contarValorEnLista(lista, filterCampo, valor){
  return lista.filter(a=>{
    if(filterCampo==="custodioClase") return claseCustodio(a)===valor;
    return a[filterCampo]===valor;
  }).length;
}

export function listaParaConteo(campoExcluir){
  const anterior = state.filtros[campoExcluir];
  state.filtros[campoExcluir] = null;
  const lista = filtrarActivos(cargarActivos());
  state.filtros[campoExcluir] = anterior;
  return lista;
}

export function actualizarConteosFiltros(){
  const porCampo = {};
  document.querySelectorAll(".inventario-tecnologico-filter-opt").forEach(opt=>{
    const campo = opt.dataset.filtroOptCampo;
    const valor = opt.dataset.filtroOptValor;
    if(!porCampo[campo]) porCampo[campo] = listaParaConteo(campo);
    const span = opt.querySelector(".inventario-tecnologico-filter-opt-count");
    if(span) span.textContent = contarValorEnLista(porCampo[campo], campo, valor);
  });
}

export function claseCustodio(a){ return a.custodio===null ? "disponible" : a.custodio.tipo_custodio; }

export function tramoVigente(a){
  return a.historial_custodia.find(t=>t.hasta===null) || null;
}

export function labelOpcionFiltro(campo, valor){
  if(campo==="custodioClase"){
    return { disponible:"Disponible", persona:"Persona", area:"Área / depto." }[valor] || valor;
  }
  if(campo==="propiedad"){
    return infoPropiedad(valor).label;
  }
  if(campo==="estado"){
    return infoEstado(valor).label;
  }
  return valor.charAt(0).toUpperCase() + valor.slice(1);
}

export function capitalizar(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }

export function seleccionActiva(campo){
  if(state.filtros[campo] === null) return new Set(opcionesFiltroCache[campo]);
  return state.filtros[campo];
}

// v13 (§4 de PENDIENTES, decidido el 1-oct): en pantallas angostas la
// búsqueda general busca en lo mismo que en las anchas (antes, solo en el
// tipo, el custodio y el estado).
export function camposBusquedaGeneral(a){
  // v10: también los campos nuevos que usa el tipo del activo (un IMEI, un
  // número de línea…). Los de siempre ya están arriba.
  const nuevos = camposDeTipo(a.tipo).filter(d=>!d.fijo).map(d=>textoValor(d, valorCrudo(a, d)));
  return [fmtTag(a), a.marca, a.modelo, a.serie, a.nombre_dispositivo,
    a.custodio?a.custodio.nombre:"Disponible", a.tipo, a.propiedad, a.sistema_operativo, a.proveedor, infoEstado(a.estado).label, ...nuevos];
}

// Filtros de texto de las columnas de los campos nuevos: state.filtros["campo:<clave>"].
// Solo cuentan los de campos activos: si un campo se desactiva, su columna
// desaparece y su filtro deja de aplicarse (no queda un filtro invisible).
function clavesFiltroCampos(f){
  return Object.keys(f).filter(k=>{
    if(!k.startsWith(PREFIJO_COLUMNA_CAMPO) || typeof f[k] !== "string" || !f[k].trim()) return false;
    const d = campoPorClave(k.slice(PREFIJO_COLUMNA_CAMPO.length));
    return !!d && d.activo;
  });
}

export function filtrarActivos(datos){
  const f = state.filtros;
  const clavesCampos = clavesFiltroCampos(f);
  return datos.activos.filter(a=>{
    if(f.tipo !== null && a.tipo && !f.tipo.has(a.tipo)) return false;
    if(f.propiedad !== null && !f.propiedad.has(a.propiedad)) return false;
    if(f.custodioClase !== null && !f.custodioClase.has(claseCustodio(a))) return false;
    if(f.marca !== null && a.marca && !f.marca.has(a.marca)) return false;
    if(f.estado !== null && !f.estado.has(a.estado)) return false;
    if(f.colTag && !fmtTag(a).toLowerCase().includes(f.colTag.toLowerCase())) return false;
    if(f.colTipo && !(a.tipo||"").toLowerCase().includes(f.colTipo.toLowerCase())) return false;
    if(f.colMarca){
      const t = f.colMarca.toLowerCase();
      if(!(a.marca||"").toLowerCase().includes(t)) return false;
    }
    if(f.colCustodio){
      const t = f.colCustodio.toLowerCase();
      const nombreActual = (a.custodio ? a.custodio.nombre : "Disponible").toLowerCase();
      // Además del custodio vigente, revisa TODO el historial (que ya incluye
      // el propio tramo vigente cuando hay custodio) — así un activo aparece
      // si cualquier custodio PASADO coincide con el nombre buscado, no solo
      // el actual. "Disponible" no vive en historial_custodia (es solo la
      // etiqueta de UI cuando no hay tramo vigente), por eso nombreActual se
      // revisa aparte.
      const coincideHistorico = a.historial_custodia.some(h => (h.nombre||"").toLowerCase().includes(t));
      if(!nombreActual.includes(t) && !coincideHistorico) return false;
    }
    if(f.colCargo){
      const t = f.colCargo.toLowerCase();
      const cargo = (a.custodio && a.custodio.cargo ? a.custodio.cargo : "").toLowerCase();
      if(!cargo.includes(t)) return false;
    }
    if(f.colPropiedad && !(a.propiedad||"").toLowerCase().includes(f.colPropiedad.toLowerCase())) return false;
    if(f.colSerie && !(a.serie||"").toLowerCase().includes(f.colSerie.toLowerCase())) return false;
    if(f.colSo && !(a.sistema_operativo||"").toLowerCase().includes(f.colSo.toLowerCase())) return false;
    if(f.colProveedor && !(a.proveedor||"").toLowerCase().includes(f.colProveedor.toLowerCase())) return false;
    if(f.colFechaDesde && (!a.fecha_adquisicion || a.fecha_adquisicion < f.colFechaDesde)) return false;
    if(f.colFechaHasta && (!a.fecha_adquisicion || a.fecha_adquisicion > f.colFechaHasta)) return false;
    if(f.colModelo && !(a.modelo||"").toLowerCase().includes(f.colModelo.toLowerCase())) return false;
    if(f.colNombre && !(a.nombre_dispositivo||"").toLowerCase().includes(f.colNombre.toLowerCase())) return false;
    for(const k of clavesCampos){
      const d = campoPorClave(k.slice(PREFIJO_COLUMNA_CAMPO.length));
      if(!d) continue;
      if(!textoValor(d, valorCrudo(a, d)).toLowerCase().includes(f[k].trim().toLowerCase())) return false;
    }
    if(f.texto){
      const t = f.texto.toLowerCase();
      const campos = camposBusquedaGeneral(a).filter(Boolean).join(" ").toLowerCase();
      if(!campos.includes(t)) return false;
    }
    return true;
  });
}

export function compararActivos(a,b,campo,dir){
  let va, vb;
  if(String(campo).startsWith(PREFIJO_COLUMNA_CAMPO)){
    const d = campoPorClave(String(campo).slice(PREFIJO_COLUMNA_CAMPO.length));
    // Un campo desactivado ya no tiene columna: se ordena como sin orden elegido.
    if(!d || !d.activo) return dir==="asc" ? a.id - b.id : b.id - a.id;
    va = valorParaOrdenar(d, valorCrudo(a, d)); vb = valorParaOrdenar(d, valorCrudo(b, d));
    const cmp = (typeof va === "number" && typeof vb === "number") ? (va-vb) : String(va).localeCompare(String(vb),'es',{sensitivity:'base', numeric:true});
    return dir==="asc" ? cmp : -cmp;
  }
  switch(campo){
    case "id": va=a.id; vb=b.id; break;
    case "tipo": va=a.tipo||""; vb=b.tipo||""; break;
    case "marca": va=((a.marca||"")+" "+(a.modelo||"")).trim(); vb=((b.marca||"")+" "+(b.modelo||"")).trim(); break;
    case "custodio": va=(a.custodio?a.custodio.nombre:"") ; vb=(b.custodio?b.custodio.nombre:""); break;
    case "cargo": va=(a.custodio&&a.custodio.cargo)?a.custodio.cargo:""; vb=(b.custodio&&b.custodio.cargo)?b.custodio.cargo:""; break;
    case "fechaentrega": va=(tramoVigente(a)||{}).desde||""; vb=(tramoVigente(b)||{}).desde||""; break;
    case "propiedad": va=a.propiedad||""; vb=b.propiedad||""; break;
    case "serie": va=a.serie||""; vb=b.serie||""; break;
    case "so": va=a.sistema_operativo||""; vb=b.sistema_operativo||""; break;
    case "ram": va=a.ram_gb??0; vb=b.ram_gb??0; break;
    case "disco": va=a.disco_gb??0; vb=b.disco_gb??0; break;
    case "procesador": va=a.procesador||""; vb=b.procesador||""; break;
    case "macwifi": va=a.mac_wifi||""; vb=b.mac_wifi||""; break;
    case "maceth": va=a.mac_ethernet||""; vb=b.mac_ethernet||""; break;
    case "proveedor": va=a.proveedor||""; vb=b.proveedor||""; break;
    case "fecha": va=a.fecha_adquisicion||""; vb=b.fecha_adquisicion||""; break;
    case "modelo": va=a.modelo||""; vb=b.modelo||""; break;
    case "nombre": va=a.nombre_dispositivo||""; vb=b.nombre_dispositivo||""; break;
    case "estado": va=a.estado||""; vb=b.estado||""; break;
    case "valorcompra": va=a.valor_compra??0; vb=b.valor_compra??0; break;
    case "valoractual": va=valorActualActivo(a)??0; vb=valorActualActivo(b)??0; break;
    case "vidautil": va=a.vida_util_anios??0; vb=b.vida_util_anios??0; break;
    case "color": va=a.color||""; vb=b.color||""; break;
    case "longitud": va=a.longitud_m??0; vb=b.longitud_m??0; break;
    default: va=a.id; vb=b.id;
  }
  let cmp = (typeof va === "number" && typeof vb === "number") ? (va-vb) : String(va).localeCompare(String(vb),'es',{sensitivity:'base'});
  return dir==="asc" ? cmp : -cmp;
}

export function listaOrdenadaFiltrada(datos){
  const lista = filtrarActivos(datos);
  lista.sort((a,b)=>compararActivos(a,b,state.orden.campo,state.orden.dir));
  return lista;
}

export function estadoInicialFiltros(){
  return { texto:"", tipo:null, propiedad:null, custodioClase:null, marca:null, estado:null,
    colTag:"", colTipo:"", colMarca:"", colCustodio:"", colCargo:"", colPropiedad:"",
    colSerie:"", colSo:"", colProveedor:"", colFechaDesde:"", colFechaHasta:"", colModelo:"", colNombre:"" };
}

export function hayFiltrosActivos(){
  const f = state.filtros;
  if(["tipo","propiedad","custodioClase","marca","estado"].some(k=>f[k]!==null)) return true;
  return ["texto","colTag","colTipo","colMarca","colCustodio","colCargo","colPropiedad",
    "colSerie","colSo","colProveedor","colFechaDesde","colFechaHasta","colModelo","colNombre"].some(k=>f[k]) || clavesFiltroCampos(f).length > 0;
}

export function flechaOrden(campo){
  if(state.orden.campo !== campo) return `<span class="inventario-tecnologico-th-arrow"></span>`;
  return `<span class="inventario-tecnologico-th-arrow inventario-tecnologico-th-arrow-active">${state.orden.dir==="asc"?"▲":"▼"}</span>`;
}

export function panelFiltroHtml(campo, opciones){
  const seleccion = seleccionActiva(campo);
  const lista = listaParaConteo(campo);
  const nombreCol = NOMBRE_COLUMNA_KPI[campo] || campo;
  const conBuscador = campo === "tipo" || campo === "marca";
  return `<div class="inventario-tecnologico-filter-panel">
    <div class="inventario-tecnologico-filter-panel-card">
      <div class="inventario-tecnologico-filter-panel-titlebar">Filtrar ${esc(nombreCol)}</div>
      <div class="inventario-tecnologico-filter-panel-card-inner">
        ${conBuscador ? `<input type="text" class="inventario-tecnologico-filter-panel-search" data-filtro-buscar="${campo}" placeholder="Buscar ${esc(nombreCol.toLowerCase())}…">` : ""}
        <div class="inventario-tecnologico-filter-panel-actions">
          <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-filtro-todos="${campo}">Todos</button>
          <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-filtro-ninguno="${campo}">Ninguno</button>
        </div>
        <div class="inventario-tecnologico-filter-panel-list">
          ${opciones.map(op=>`
            <div class="inventario-tecnologico-filtro-fila">
              <label class="inventario-tecnologico-filter-opt" data-filtro-opt-campo="${campo}" data-filtro-opt-valor="${esc(op)}">
                <input type="checkbox" data-filtro-campo="${campo}" data-filtro-valor="${esc(op)}" ${seleccion.has(op)?"checked":""}>
                <span class="inventario-tecnologico-filter-opt-label">${esc(labelOpcionFiltro(campo, op))}</span>
                <span class="inventario-tecnologico-filter-opt-count">${contarValorEnLista(lista, campo, op)}</span>
              </label>
              <button type="button" class="inventario-tecnologico-filtro-solo" data-filtro-solo-campo="${campo}" data-filtro-solo-valor="${esc(op)}" title="${esc(tituloSolo(labelOpcionFiltro(campo, op)))}" aria-label="${esc(`Solo ${labelOpcionFiltro(campo, op)}`)}">solo</button>
            </div>`).join("")}
        </div>
        ${conBuscador ? `<div class="inventario-tecnologico-filter-panel-vacio" data-filtro-vacio="${campo}" role="status" hidden></div>` : ""}
        <div class="inventario-tecnologico-filter-panel-hint">${esc(AYUDA_SOLO)}</div>
        <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm inventario-tecnologico-filter-panel-kpi-btn" data-ver-kpis="${campo}">📊 Ver resumen</button>
      </div>
    </div>
  </div>`;
}

export function contenidoBotonFiltro(campo, opciones){
  const seleccion = seleccionActiva(campo);
  const total = opciones.length;
  if(seleccion.size === total){
    return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>`;
  }
  if(seleccion.size === 0) return "0";
  return `${seleccion.size}/${total}`;
}

export function marcarCheckboxesPanel(campo, seleccion){
  document.querySelectorAll(`input[data-filtro-campo="${campo}"]`).forEach(cb=>{
    cb.checked = seleccion.has(cb.dataset.filtroValor);
  });
}

export function actualizarBotonFiltroActivo(campo){
  const opciones = opcionesFiltroCache[campo];
  const seleccion = seleccionActiva(campo);
  const btn = document.querySelector(`[data-filtro-btn="${campo}"]`);
  if(!btn) return;
  btn.classList.toggle("inventario-tecnologico-active", seleccion.size < opciones.length);
  btn.classList.toggle("inventario-tecnologico-empty", seleccion.size === 0);
  btn.innerHTML = contenidoBotonFiltro(campo, opciones);
}

export function actualizarFlechasOrden(){
  document.querySelectorAll(".inventario-tecnologico-th-label.inventario-tecnologico-th-sortable").forEach(el=>{
    const campo = el.dataset.sort;
    const arrow = el.querySelector(".inventario-tecnologico-th-arrow");
    if(!arrow) return;
    if(state.orden.campo===campo){ arrow.className="inventario-tecnologico-th-arrow inventario-tecnologico-th-arrow-active"; arrow.textContent = state.orden.dir==="asc"?"▲":"▼"; }
    else { arrow.className="inventario-tecnologico-th-arrow"; arrow.textContent=""; }
  });
}
