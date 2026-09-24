import { ROL_ADMIN, sb } from "./config.js";
import { state } from "./estado.js";

export async function refrescarDatos(){
  const [
    { data: activosRaw, error: e1 },
    { data: historialRaw, error: e2 },
    { data: tiposActivoRaw, error: e7 },
    { data: propiedadOpcionesRaw, error: e8 },
    { data: estadoOpcionesRaw, error: e9 },
  ] = await Promise.all([
    sb.from("activos").select("*").order("id"),
    sb.from("historial_custodia").select("*").order("activo_id").order("orden"),
    // Tipo/Propiedad/Estado configurables — reemplazan ICONOS_TIPO/COLOR_TIPO/
    // CAMPOS_NO_RELEVANTES_DETALLE/CAMPOS_EXTRA_TIPO hardcodeados y los 2 CHECK
    // que antes limitaban propiedad/estado. Se traen TODAS las filas (incluso
    // activo=false) porque un activo ya guardado con una opción retirada
    // todavía necesita poder mostrar su ícono/color/etiqueta — el filtro por
    // activo=true se aplica solo al armar los <select> de opciones nuevas.
    sb.from("tipos_activo").select("*").order("orden"),
    sb.from("propiedad_opciones").select("*").order("orden"),
    sb.from("estado_opciones").select("*").order("orden"),
  ]);
  if(e1) throw e1;
  if(e2) throw e2;
  if(e7) throw e7;
  if(e8) throw e8;
  if(e9) throw e9;
  state.tiposActivo = tiposActivoRaw || [];
  state.propiedadOpciones = propiedadOpcionesRaw || [];
  state.estadoOpciones = estadoOpcionesRaw || [];
  const historialPorActivo = {};
  (historialRaw||[]).forEach(t=>{
    (historialPorActivo[t.activo_id] ||= []).push({
      _id: t.id, tipo_custodio: t.tipo_custodio, nombre: t.nombre, cargo: t.cargo,
      desde: t.desde, hasta: t.hasta, tipo_devolucion: t.tipo_devolucion, tipo_entrega: t.tipo_entrega,
      observacion_entrega: t.observacion_entrega, observacion_devolucion: t.observacion_devolucion, orden: t.orden,
    });
  });
  const activos = (activosRaw||[]).map(a=>{
    const historial_custodia = historialPorActivo[a.id] || [];
    const vigente = historial_custodia.find(t=>t.hasta===null) || null;
    return {
      id: a.id, propiedad: a.propiedad, tipo: a.tipo, marca: a.marca, modelo: a.modelo,
      serie: a.serie, nombre_dispositivo: a.nombre_dispositivo, mac_wifi: a.mac_wifi,
      mac_ethernet: a.mac_ethernet, sistema_operativo: a.sistema_operativo,
      ram_gb: a.ram_gb, disco_gb: a.disco_gb, procesador: a.procesador,
      proveedor: a.proveedor, fecha_adquisicion: a.fecha_adquisicion,
      color: a.color, longitud_m: a.longitud_m,
      valor_compra: a.valor_compra, vida_util_anios: a.vida_util_anios,
      estado: a.estado,
      fotos: a.fotos || [],
      celular: (a.celular_gmail || a.celular_password) ? { gmail: a.celular_gmail, password: a.celular_password } : null,
      custodio: vigente ? { tipo_custodio: vigente.tipo_custodio, nombre: vigente.nombre, cargo: vigente.cargo } : null,
      historial_custodia,
      trazabilidad: a.trazabilidad,
    };
  });
  state.datos = { version: 8, generado_en: new Date().toISOString(), activos };

  const { data: bajasRaw, error: e3 } = await sb.from("bajas").select("*").order("fecha_baja", { ascending:false });
  if(e3) throw e3;
  state.bajas = (bajasRaw||[]).map(b=>({ id: b.id, activo: b.activo, fecha_baja: b.fecha_baja, motivo: b.motivo, dado_de_baja_por: b.dado_de_baja_por }));

  // TODOS los roles necesitan leer la matriz completa de permisos (no solo
  // la propia): puede() la usa para decidir qué botones mostrar, igual que
  // en la versión anterior con LocalStorage, donde tampoco había esa
  // restricción. La tabla permisos permite SELECT a cualquier autenticado
  // (ver política sel_permisos) — solo INSERT/UPDATE/DELETE quedan admin-only.
  const { data: permisosRaw } = await sb.from("permisos").select("*");
  const matriz = {};
  (permisosRaw||[]).forEach(p=>{ (matriz[p.rol] ||= {})[p.accion] = p.permitido; });
  state.permisos = matriz;

  if(state.sesion && state.sesion.rol === ROL_ADMIN){
    const { data: perfilesRaw } = await sb.from("perfiles").select("*");
    state.perfiles = perfilesRaw || [];
    const { data: logRaw } = await sb.from("auditoria").select("*").order("fecha", { ascending:false }).limit(500);
    state.log = (logRaw||[]).map(l=>({ fecha: l.fecha, usuario: l.usuario_id, nombre_completo: (state.perfiles.find(p=>p.id===l.usuario_id)||{}).nombre_completo || l.usuario_id, accion: l.accion, detalle: l.detalle }));
  }
}

export function cargarActivos(){ return state.datos || { version:8, generado_en:null, activos:[] }; }

export function cargarBajas(){ return state.bajas || []; }

export function cargarPermisos(){ return state.permisos || {}; }

export function cargarLog(){ return state.log || []; }

export function cargarPerfiles(){ return state.perfiles || []; }

export function cargarTiposActivo(){ return state.tiposActivo || []; }

export function cargarPropiedadOpciones(){ return state.propiedadOpciones || []; }

export function cargarEstadoOpciones(){ return state.estadoOpciones || []; }

export async function guardarPermisos(matriz){
  const filas = [];
  Object.keys(matriz).forEach(rol=>{
    Object.keys(matriz[rol]).forEach(accion=>{
      filas.push({ rol, accion, permitido: !!matriz[rol][accion] });
    });
  });
  const { error } = await sb.from("permisos").upsert(filas, { onConflict: "rol,accion" });
  if(error) throw error;
  await refrescarDatos();
}
