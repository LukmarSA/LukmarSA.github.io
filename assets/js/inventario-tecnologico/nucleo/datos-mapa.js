// Datos del mapa (ubicaciones, radioenlaces e historial de ubicación).
//
// A diferencia de refrescarDatos() — que corre al iniciar sesión y después de
// cada guardado — esto se carga SOLO al abrir la pestaña Mapa (o el bloque
// "Ubicación" del detalle de un activo). Dos razones:
//   * si las tablas no existen o su RLS/GRANT falla, se rompe el mapa y nada
//     más: el listado de activos sigue funcionando;
//   * quien no tiene "ver_mapa" no paga cinco consultas extra en cada guardado.
// El patrón de acceso es el mismo que en datos.js: refrescar*() trae de
// Supabase y deja todo en state; cargar*() lo lee sin volver a consultar.
import { sb } from "./config.js";
import { cargarActivos } from "./datos.js";
import { state } from "./estado.js";
import { indexarMapa } from "./mapa-logica.js";

export function crearEstadoMapa(){
  return {
    cargado: false,
    error: null,
    tiposUbicacion: [],   // filas de tipos_ubicacion (valor, etiqueta, color, orden, activo)
    ubicaciones: [],      // filas de ubicaciones (incluye archivadas: activa=false)
    equipos: [],          // filas de equipos_radioenlace
    enlaces: [],          // filas de enlaces
    vigentes: [],         // tramos de historial_ubicacion con hasta = null
    seleccion: { ubicacionId: null, equipoId: null, enlaceId: null, activoId: null },
    filtros: { tiposOcultos: [], verTodosEnlaces: false, verArchivadas: false },
    foco: null,           // { ubicacionId, activoId } pendiente de aplicar al abrir el mapa (p. ej. "Ver en mapa")
  };
}

export function estadoMapa(){
  if(!state.mapa) state.mapa = crearEstadoMapa();
  return state.mapa;
}

export async function refrescarDatosMapa(){
  const m = estadoMapa();
  const [t, u, e, l, h] = await Promise.all([
    sb.from("tipos_ubicacion").select("*").order("orden"),
    sb.from("ubicaciones").select("*").order("nombre"),
    sb.from("equipos_radioenlace").select("*").order("nombre"),
    sb.from("enlaces").select("*").order("id"),
    sb.from("historial_ubicacion").select("id, activo_id, ubicacion_id, desde, notas").is("hasta", null),
  ]);
  const error = t.error || u.error || e.error || l.error || h.error;
  if(error){ m.error = error; throw error; }
  m.tiposUbicacion = t.data || [];
  m.ubicaciones = u.data || [];
  m.equipos = e.data || [];
  m.enlaces = l.data || [];
  m.vigentes = h.data || [];
  m.cargado = true;
  m.error = null;
  // Si una selección apunta a algo que ya no existe (lo borró otra persona), se suelta.
  const s = m.seleccion;
  if(s.ubicacionId && !m.ubicaciones.some(x=>x.id===s.ubicacionId)) Object.assign(s, { ubicacionId:null, equipoId:null, enlaceId:null, activoId:null });
  if(s.equipoId && !m.equipos.some(x=>x.id===s.equipoId)) Object.assign(s, { equipoId:null, enlaceId:null });
  if(s.enlaceId && !m.enlaces.some(x=>x.id===s.enlaceId)) s.enlaceId = null;
}

export function cargarTiposUbicacion(){ return estadoMapa().tiposUbicacion; }

export function cargarUbicaciones(){ return estadoMapa().ubicaciones; }

export function cargarEquiposRadioenlace(){ return estadoMapa().equipos; }

export function cargarEnlaces(){ return estadoMapa().enlaces; }

export function cargarUbicacionesVigentes(){ return estadoMapa().vigentes; }

// Índices calculados sobre lo ya cargado + los activos del listado. Es barato
// (decenas de ubicaciones, ~100 activos), así que se recalcula cuando se pide
// en lugar de mantener una caché que habría que invalidar.
export function indicesMapa(){
  const m = estadoMapa();
  return indexarMapa({ ubicaciones: m.ubicaciones, equipos: m.equipos, enlaces: m.enlaces, vigentes: m.vigentes, activos: cargarActivos().activos });
}

// ---------------------------------------------------------------------------
// Consultas puntuales para el detalle de un activo (no dependen de haber
// abierto el mapa antes).
// ---------------------------------------------------------------------------

export async function obtenerUbicacionDeActivo(activoId){
  const [vig, eq, cuenta, tipos] = await Promise.all([
    sb.from("historial_ubicacion").select("id, desde, notas, ubicacion:ubicaciones(id, nombre, tipo, activa)").eq("activo_id", activoId).is("hasta", null).maybeSingle(),
    sb.from("equipos_radioenlace").select("id, nombre, ubicacion_id").eq("activo_id", activoId).maybeSingle(),
    sb.from("historial_ubicacion").select("id", { count: "exact", head: true }).eq("activo_id", activoId),
    estadoMapa().tiposUbicacion.length ? Promise.resolve({ data: estadoMapa().tiposUbicacion, error: null }) : sb.from("tipos_ubicacion").select("*").order("orden"),
  ]);
  const error = vig.error || eq.error || cuenta.error || tipos.error;
  if(error) throw error;
  return { vigente: vig.data || null, equipo: eq.data || null, totalTramos: cuenta.count || 0, tipos: tipos.data || [] };
}

export async function obtenerHistorialUbicacionActivo(activoId){
  const { data, error } = await sb.from("historial_ubicacion")
    .select("id, desde, hasta, notas, ubicacion:ubicaciones(id, nombre, tipo)")
    .eq("activo_id", activoId)
    .order("desde", { ascending: false })
    .order("id", { ascending: false });
  if(error) throw error;
  return data || [];
}
