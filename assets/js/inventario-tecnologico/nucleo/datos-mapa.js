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
//
// La jerarquía (migración 003) viaja en equipos_radioenlace.servidor_id; los
// respaldos, en enlaces_respaldo. La simulación de fallas vive solo aquí, en
// memoria (state.mapa.simulacion): nunca se escribe en Supabase.
import { sb } from "./config.js";
import { cargarActivos } from "./datos.js";
import { state } from "./estado.js";
import { indexarMapa } from "./mapa-logica.js";
import { analizarRed, simularFallas } from "./mapa-jerarquia.js";

export function crearEstadoMapa(){
  return {
    cargado: false,
    error: null,
    tiposUbicacion: [],   // filas de tipos_ubicacion (valor, etiqueta, color, orden, activo)
    ubicaciones: [],      // filas de ubicaciones (incluye archivadas: activa=false)
    equipos: [],          // filas de equipos_radioenlace (con servidor_id, banda, frecuencia_mhz)
    respaldos: [],        // filas de enlaces_respaldo
    vigentes: [],         // tramos de historial_ubicacion con hasta = null
    seleccion: { ubicacionId: null, equipoId: null, activoId: null },
    filtros: {
      tiposOcultos: [],   // tipos de ubicación ocultos
      verArchivadas: false,
      lineas: { backbone: true, p2mp: true, respaldos: false },
      rolesOcultos: [],   // raiz / backbone / distribucion / cliente
      estadosOcultos: [], // servicio / respaldo / sin_conexion / caido (solo en simulación)
    },
    expandidos: [],       // servidores agrupados (muchos clientes) con sus líneas desplegadas
    simulacion: { activa: false, caidos: [] },
    foco: null,           // { ubicacionId, activoId } pendiente de aplicar al abrir el mapa (p. ej. "Ver en mapa")
  };
}

export function estadoMapa(){
  if(!state.mapa) state.mapa = crearEstadoMapa();
  return state.mapa;
}

export async function refrescarDatosMapa(){
  const m = estadoMapa();
  const [t, u, e, r, h] = await Promise.all([
    sb.from("tipos_ubicacion").select("*").order("orden"),
    sb.from("ubicaciones").select("*").order("nombre"),
    sb.from("equipos_radioenlace").select("*").order("nombre"),
    sb.from("enlaces_respaldo").select("*").order("prioridad").order("id"),
    sb.from("historial_ubicacion").select("id, activo_id, ubicacion_id, desde, notas").is("hasta", null),
  ]);
  const error = t.error || u.error || e.error || r.error || h.error;
  if(error){ m.error = error; throw error; }
  m.tiposUbicacion = t.data || [];
  m.ubicaciones = u.data || [];
  m.equipos = e.data || [];
  m.respaldos = r.data || [];
  m.vigentes = h.data || [];
  m.cargado = true;
  m.error = null;
  // Lo que apunta a algo que ya no existe (lo borró otra persona) se suelta.
  const s = m.seleccion;
  const hayEquipo = id=>m.equipos.some(x=>x.id === id);
  if(s.ubicacionId && !m.ubicaciones.some(x=>x.id === s.ubicacionId)) Object.assign(s, { ubicacionId: null, equipoId: null, activoId: null });
  if(s.equipoId && !hayEquipo(s.equipoId)) s.equipoId = null;
  m.expandidos = m.expandidos.filter(hayEquipo);
  m.simulacion.caidos = m.simulacion.caidos.filter(hayEquipo);
}

export function cargarTiposUbicacion(){ return estadoMapa().tiposUbicacion; }

export function cargarUbicaciones(){ return estadoMapa().ubicaciones; }

export function cargarEquiposRadioenlace(){ return estadoMapa().equipos; }

export function cargarRespaldos(){ return estadoMapa().respaldos; }

export function cargarUbicacionesVigentes(){ return estadoMapa().vigentes; }

// Índices calculados sobre lo ya cargado + los activos del listado. Es barato
// (decenas de ubicaciones, ~100 activos), así que se recalcula cuando se pide
// en lugar de mantener una caché que habría que invalidar.
export function indicesMapa(){
  const m = estadoMapa();
  return indexarMapa({ ubicaciones: m.ubicaciones, equipos: m.equipos, vigentes: m.vigentes, activos: cargarActivos().activos });
}

export function redMapa(){
  const m = estadoMapa();
  return analizarRed({ equipos: m.equipos, ubicaciones: m.ubicaciones, respaldos: m.respaldos });
}

// Resultado de la simulación, o null si está apagada.
export function simulacionMapa(red = redMapa()){
  const s = estadoMapa().simulacion;
  return s.activa ? simularFallas(red, s.caidos) : null;
}

// ---------------------------------------------------------------------------
// Consultas puntuales para el detalle de un activo (no dependen de haber
// abierto el mapa antes).
// ---------------------------------------------------------------------------

// El equipo de radio se pide a equipo_radio_de_activo() (migración 004) y no a
// la tabla: equipos_radioenlace (la red) solo la lee quien tiene «Ver mapa», y
// el detalle lo ve también quien solo tiene «Ver listado».
export async function obtenerUbicacionDeActivo(activoId){
  const [vig, eq, cuenta, tipos] = await Promise.all([
    sb.from("historial_ubicacion").select("id, desde, notas, ubicacion:ubicaciones(id, nombre, tipo, activa)").eq("activo_id", activoId).is("hasta", null).maybeSingle(),
    sb.rpc("equipo_radio_de_activo", { p_activo_id: activoId }).then(r=>({ data: Array.isArray(r.data) ? (r.data[0] || null) : (r.data || null), error: r.error })),
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
