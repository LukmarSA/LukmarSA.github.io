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
//
// Red de la finca (migración 007): tipos de equipo, redes y atajos de
// simulación. Se leen junto con lo demás, pero sin exigirlos: si la 007 no se
// corrió, m.red007.disponible queda en false y la app sigue como antes (nombre
// a mano, sin tipo, red ni atajos). Con la 007, cada equipo en memoria queda
// con nombre = el nombre automático y nombre_guardado = el de la base.
//
// Migración 008: medio de cada enlace (cable, fibra, inalámbrico) y nombres
// guardados al día (los recalcula la base). Se detecta pidiendo la columna
// "medio" (m.red008.disponible). Migración 009: piscinas de la camaronera
// (polígonos) para la capa "Piscinas" (m.piscinas009.disponible).
import { sb } from "./config.js";
import { cargarActivos } from "./datos.js";
import { state } from "./estado.js";
import { indexarMapa } from "./mapa-logica.js";
import { analizarRed, simularFallas } from "./mapa-jerarquia.js";
import { aplicarNombres, caidosEfectivos } from "./mapa-nombres.js";
import { normalizarPlano } from "./plano-mapa.js";

export function crearEstadoMapa(){
  return {
    cargado: false,
    error: null,
    tiposUbicacion: [],   // filas de tipos_ubicacion (valor, etiqueta, color, orden, activo)
    ubicaciones: [],      // filas de ubicaciones (incluye archivadas: activa=false)
    equipos: [],          // filas de equipos_radioenlace (servidor_id; con la 007: tipo_equipo, red_id, referencia, nombre_guardado)
    respaldos: [],        // filas de enlaces_respaldo
    vigentes: [],         // tramos de historial_ubicacion con hasta = null
    seleccion: { ubicacionId: null, equipoId: null, activoId: null },
    filtros: {
      tiposOcultos: [],   // tipos de ubicación ocultos
      verArchivadas: false,
      lineas: { backbone: true, p2mp: true, cable: true, respaldos: false }, // cable = cable y fibra entre sitios (008)
      rolesOcultos: [],   // raiz / backbone / distribucion / cliente
      redesOcultas: [],   // ids de redes (texto) y "sin" = equipos sin red (007)
      colorPorRed: false, // colorear las líneas con el color de la red del cliente
      estadosOcultos: [], // servicio / respaldo / sin_conexion / caido (solo en simulación)
    },
    expandidos: [],       // servidores agrupados (muchos clientes) con sus líneas desplegadas
    simulacion: { activa: false, caidos: [], atajos: [] }, // caidos = marcados a mano; atajos = ids de atajos encendidos
    tiposEquipo: [],      // tipos_equipo_red (007)
    redes: [],            // redes de la finca (007)
    atajos: [],           // atajos_simulacion (007)
    red007: { disponible: false, error: null },
    red008: { disponible: false },                 // columna equipos_radioenlace.medio (008)
    piscinas: [],                                  // piscinas de la camaronera (009)
    piscinas009: { disponible: false, error: null },
    foco: null,           // { ubicacionId, activoId } pendiente de aplicar al abrir el mapa (p. ej. "Ver en mapa")
    plano: null,          // capa "Plano" (migración 006): normalizarPlano(fila) + error (null si se leyó bien)
  };
}

export function estadoMapa(){
  if(!state.mapa) state.mapa = crearEstadoMapa();
  return state.mapa;
}

// Una consulta que puede fallar sin romper el mapa (tablas de la 007).
const opcional = consulta=>Promise.resolve(consulta).then(r=>r, err=>({ data: null, error: err }));

export async function refrescarDatosMapa(){
  const m = estadoMapa();
  const [t, u, e, r, h, te, rd, at, me, pi] = await Promise.all([
    sb.from("tipos_ubicacion").select("*").order("orden"),
    sb.from("ubicaciones").select("*").order("nombre"),
    sb.from("equipos_radioenlace").select("*").order("nombre"),
    sb.from("enlaces_respaldo").select("*").order("prioridad").order("id"),
    sb.from("historial_ubicacion").select("id, activo_id, ubicacion_id, desde, notas").is("hasta", null),
    opcional(sb.from("tipos_equipo_red").select("*").order("orden").order("etiqueta")),
    opcional(sb.from("redes").select("*").order("orden").order("nombre")),
    opcional(sb.from("atajos_simulacion").select("*").order("orden").order("nombre")),
    opcional(sb.from("equipos_radioenlace").select("id, medio").limit(1)),
    opcional(sb.from("piscinas").select("*").order("orden").order("nombre")),
  ]);
  const error = t.error || u.error || e.error || r.error || h.error;
  if(error){ m.error = error; throw error; }
  m.tiposUbicacion = t.data || [];
  m.ubicaciones = u.data || [];
  m.equipos = e.data || [];
  m.respaldos = r.data || [];
  m.vigentes = h.data || [];
  m.red007 = { disponible: !te.error, error: te.error || rd.error || at.error || null };
  m.tiposEquipo = te.error ? [] : (te.data || []);
  m.redes = rd.error ? [] : (rd.data || []);
  m.atajos = at.error ? [] : (at.data || []);
  m.red008 = { disponible: !me.error };
  m.piscinas009 = { disponible: !pi.error, error: pi.error || null };
  m.piscinas = pi.error ? [] : (pi.data || []);
  aplicarNombres(m.equipos, { ubicaciones: m.ubicaciones, tipos: m.tiposEquipo });
  m.equipos.sort((a, b)=>String(a.nombre).localeCompare(String(b.nombre), "es"));
  m.cargado = true;
  m.error = null;
  // Lo que apunta a algo que ya no existe (lo borró otra persona) se suelta.
  const s = m.seleccion;
  const hayEquipo = id=>m.equipos.some(x=>x.id === id);
  if(s.ubicacionId && !m.ubicaciones.some(x=>x.id === s.ubicacionId)) Object.assign(s, { ubicacionId: null, equipoId: null, activoId: null });
  if(s.equipoId && !hayEquipo(s.equipoId)) s.equipoId = null;
  m.expandidos = m.expandidos.filter(hayEquipo);
  m.simulacion.caidos = m.simulacion.caidos.filter(hayEquipo);
  m.simulacion.atajos = (m.simulacion.atajos || []).filter(id=>m.atajos.some(a=>a.id === id));
}

// Plano de la capa "Plano" (migración 006). Va aparte de refrescarDatosMapa()
// y nunca lanza: si la tabla no existe o no se puede leer, la capa sigue con
// el plano que trae la app (PLANO_POR_DEFECTO) y solo no se puede guardar
// un ajuste. El error queda en m.plano.error para explicarlo al intentarlo.
export async function refrescarPlanoMapa(){
  const m = estadoMapa();
  try{
    const { data, error } = await sb.from("planos_mapa")
      .select("id, nombre, imagen, ancho_px, alto_px, esquinas, esquinas_originales, actualizado_en")
      .eq("activo", true).order("id").limit(1);
    if(error){ m.plano = { ...normalizarPlano(null), error }; return m.plano; }
    m.plano = { ...normalizarPlano((data || [])[0] || null), error: null };
  }catch(err){
    m.plano = { ...normalizarPlano(null), error: err };
  }
  return m.plano;
}

export function cargarPlanoMapa(){
  const m = estadoMapa();
  if(!m.plano) m.plano = { ...normalizarPlano(null), error: null, pendiente: true };
  return m.plano;
}

export function cargarTiposUbicacion(){ return estadoMapa().tiposUbicacion; }

export function cargarUbicaciones(){ return estadoMapa().ubicaciones; }

export function cargarEquiposRadioenlace(){ return estadoMapa().equipos; }

export function cargarRespaldos(){ return estadoMapa().respaldos; }

export function cargarUbicacionesVigentes(){ return estadoMapa().vigentes; }

export function cargarTiposEquipo(){ return estadoMapa().tiposEquipo; }

export function cargarRedes(){ return estadoMapa().redes; }

export function cargarAtajos(){ return estadoMapa().atajos; }

// true si la migración 007 está corrida (tipo, red, atajos y nombre automático).
export function hayRedFinca(){ return !!estadoMapa().red007.disponible; }

// true si la migración 008 está corrida (medio del enlace; la base mantiene los nombres).
export function hayMedio(){ return !!(estadoMapa().red008 || {}).disponible; }

// true si la migración 009 está corrida (tabla de piscinas).
export function hayPiscinas(){ return !!(estadoMapa().piscinas009 || {}).disponible; }

export function cargarPiscinas(){ return estadoMapa().piscinas || []; }

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

// Resultado de la simulación, o null si está apagada. Caen los marcados a
// mano y los de los atajos encendidos.
export function simulacionMapa(red = redMapa()){
  const m = estadoMapa();
  const s = m.simulacion;
  if(!s.activa) return null;
  return simularFallas(red, caidosEfectivos({ manuales: s.caidos, atajosActivos: s.atajos || [], atajos: m.atajos, existe: id=>red.equipoPorId.has(id) }));
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
