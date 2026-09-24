// Lógica pura del mapa: índices, búsquedas, validaciones y traducción de
// errores. No toca el DOM ni Supabase (los datos llegan por parámetro), para
// poder probarla en Node sin navegador (tests/mapa-unit.mjs). Solo importa
// módulos igual de puros.
import { fmtTag } from "./helpers.js";
import { azimutGrados, coordenadasValidas, distanciaKm } from "./geo.js";

export function normalizarTexto(s){
  return String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

// Misma regla que los índices únicos de la migración 002: lower(btrim(nombre)).
export function claveNombre(s){ return String(s ?? "").trim().toLowerCase(); }

// Fecha de HOY en la hora local del navegador. No usar toISOString(): en
// Ecuador (UTC-5) después de las 19:00 ya devuelve la fecha de mañana.
export function hoyLocalISO(fecha = new Date()){
  const y = fecha.getFullYear(), m = String(fecha.getMonth()+1).padStart(2,"0"), d = String(fecha.getDate()).padStart(2,"0");
  return `${y}-${m}-${d}`;
}

export function infoTipoUbicacion(tipos, valor){
  const t = (tipos||[]).find(x=>x.valor===valor);
  return { etiqueta: t ? t.etiqueta : (valor || "—"), color: (t && t.color) || "#57697C", activo: !!t && t.activo !== false };
}

// Índices para pintar el mapa y el panel sin recorrer listas en cada clic.
// Los tramos vigentes de activos que no están en `activos` (por ejemplo, uno
// que se acaba de dar de baja en otra pestaña) se ignoran.
export function indexarMapa({ ubicaciones = [], equipos = [], enlaces = [], vigentes = [], activos = [] } = {}){
  const ubicacionPorId = new Map(ubicaciones.map(u=>[u.id, u]));
  const equipoPorId = new Map(equipos.map(e=>[e.id, e]));
  const activoPorId = new Map(activos.map(a=>[a.id, a]));
  const equiposPorUbicacion = new Map();
  const equipoPorActivo = new Map();
  for(const e of equipos){
    if(!equiposPorUbicacion.has(e.ubicacion_id)) equiposPorUbicacion.set(e.ubicacion_id, []);
    equiposPorUbicacion.get(e.ubicacion_id).push(e);
    if(e.activo_id !== null && e.activo_id !== undefined) equipoPorActivo.set(e.activo_id, e);
  }
  const enlacesPorEquipo = new Map();
  for(const l of enlaces){
    for(const id of [l.equipo_origen_id, l.equipo_destino_id]){
      if(!enlacesPorEquipo.has(id)) enlacesPorEquipo.set(id, []);
      enlacesPorEquipo.get(id).push(l);
    }
  }
  const vigentePorActivo = new Map();
  const activosPorUbicacion = new Map();
  for(const t of vigentes){
    const a = activoPorId.get(t.activo_id);
    if(!a) continue;
    vigentePorActivo.set(t.activo_id, t);
    if(!activosPorUbicacion.has(t.ubicacion_id)) activosPorUbicacion.set(t.ubicacion_id, []);
    activosPorUbicacion.get(t.ubicacion_id).push(a);
  }
  for(const lista of activosPorUbicacion.values()) lista.sort((a,b)=>a.id-b.id);
  for(const lista of equiposPorUbicacion.values()) lista.sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre), "es"));
  return { ubicacionPorId, equipoPorId, activoPorId, equiposPorUbicacion, equipoPorActivo, enlacesPorEquipo, vigentePorActivo, activosPorUbicacion };
}

export function extremoOpuesto(enlace, equipoId){
  return enlace.equipo_origen_id === equipoId ? enlace.equipo_destino_id : enlace.equipo_origen_id;
}

// Todo lo que el panel muestra de un enlace, visto desde uno de sus equipos:
// el otro extremo, la distancia y hacia dónde apunta cada antena.
export function describirEnlace(indices, enlace, desdeEquipoId){
  const equipo = indices.equipoPorId.get(desdeEquipoId);
  const otro = indices.equipoPorId.get(extremoOpuesto(enlace, desdeEquipoId));
  const ubicacion = equipo ? indices.ubicacionPorId.get(equipo.ubicacion_id) : null;
  const otraUbicacion = otro ? indices.ubicacionPorId.get(otro.ubicacion_id) : null;
  const medible = !!(ubicacion && otraUbicacion);
  return {
    enlace, equipo, otro, ubicacion, otraUbicacion,
    distanciaKm: medible ? distanciaKm(ubicacion, otraUbicacion) : null,
    azimutIda: medible ? azimutGrados(ubicacion, otraUbicacion) : null,
    azimutVuelta: medible ? azimutGrados(otraUbicacion, ubicacion) : null,
  };
}

export function enlacesDeEquipo(indices, equipoId){
  return (indices.enlacesPorEquipo.get(equipoId) || [])
    .map(l=>describirEnlace(indices, l, equipoId))
    .filter(d=>d.otro && d.otraUbicacion);
}

export function ubicacionesEnlazadas(indices, equipoId){
  return new Set(enlacesDeEquipo(indices, equipoId).map(d=>d.otraUbicacion.id));
}

export function ubicacionesVisibles(ubicaciones, { tiposOcultos = [], verArchivadas = false } = {}){
  return ubicaciones.filter(u=>(verArchivadas || u.activa !== false) && !tiposOcultos.includes(u.tipo));
}

export function ordenarUbicaciones(ubicaciones, tipos){
  const orden = new Map((tipos||[]).map(t=>[t.valor, t.orden ?? 0]));
  return [...ubicaciones].sort((a,b)=>(orden.get(a.tipo) ?? 999) - (orden.get(b.tipo) ?? 999) || String(a.nombre).localeCompare(String(b.nombre), "es"));
}

export function resumenMapa(indices, { ubicaciones = [], equipos = [], enlaces = [], activos = [] } = {}){
  const activas = ubicaciones.filter(u=>u.activa !== false).length;
  return {
    ubicaciones: activas,
    archivadas: ubicaciones.length - activas,
    equipos: equipos.length,
    enlaces: enlaces.length,
    activosUbicados: indices.vigentePorActivo.size,
    activosSinUbicacion: Math.max(0, activos.length - indices.vigentePorActivo.size),
  };
}

export function textoBusquedaActivo(a){
  return normalizarTexto([fmtTag(a), a.tipo, a.marca, a.modelo, a.serie, a.nombre_dispositivo, a.custodio && a.custodio.nombre].filter(Boolean).join(" "));
}

// "45", "lkm-45", "LKM-045" o "EQS 45" → 45 (el número del tag es el id; el
// prefijo depende de la propiedad, así que no se exige que coincida).
export function idDeConsultaTag(consulta){
  const m = normalizarTexto(consulta).match(/^(?:(lkm|eqs)\s*-?\s*)?0*(\d+)$/);
  return m ? Number(m[2]) : null;
}

// Filtro de activos que usan el buscador y los formularios del mapa: por
// número de tag, o por texto (tag, tipo, marca, modelo, serie, nombre, custodio).
export function coincideActivo(a, consulta){
  const q = normalizarTexto(consulta);
  if(!q) return true;
  const id = idDeConsultaTag(q);
  if(id !== null && a.id === id) return true;
  return textoBusquedaActivo(a).includes(q);
}

// Buscador del mapa: ubicaciones, equipos y activos a la vez.
export function buscarEnMapa(texto, { indices, ubicaciones = [], equipos = [], activos = [], tipos = [] }, limitePorClase = 6){
  const q = normalizarTexto(texto);
  if(q.length < 2 && !/^\d+$/.test(q)) return [];
  const resultados = [];

  const us = ubicaciones.filter(u=>normalizarTexto(`${u.nombre} ${u.direccion||""} ${infoTipoUbicacion(tipos, u.tipo).etiqueta}`).includes(q)).slice(0, limitePorClase);
  for(const u of us) resultados.push({ clase:"ubicacion", id:u.id, titulo:u.nombre, detalle:infoTipoUbicacion(tipos, u.tipo).etiqueta + (u.activa === false ? " · archivada" : ""), ubicacionId:u.id });

  const es = equipos.filter(e=>normalizarTexto(`${e.nombre} ${e.modelo||""}`).includes(q)).slice(0, limitePorClase);
  for(const e of es){
    const u = indices.ubicacionPorId.get(e.ubicacion_id);
    resultados.push({ clase:"equipo", id:e.id, titulo:e.nombre, detalle:[e.modelo, u && u.nombre].filter(Boolean).join(" · "), ubicacionId:e.ubicacion_id });
  }

  const as = activos.filter(a=>coincideActivo(a, q)).slice(0, limitePorClase);
  for(const a of as){
    const t = indices.vigentePorActivo.get(a.id);
    const u = t ? indices.ubicacionPorId.get(t.ubicacion_id) : null;
    resultados.push({ clase:"activo", id:a.id, titulo:`${fmtTag(a)} · ${[a.marca, a.modelo].filter(Boolean).join(" ") || a.tipo || ""}`.trim(), detalle: u ? u.nombre : "Sin ubicación", ubicacionId: u ? u.id : null });
  }
  return resultados;
}

// ---------------------------------------------------------------------------
// Validaciones previas (las mismas reglas que la base; la base es la que manda,
// esto solo evita un viaje a Supabase para un error obvio).
// ---------------------------------------------------------------------------

function resultado(errores){ return { ok: Object.keys(errores).length === 0, errores }; }

export function validarUbicacion({ nombre, tipo, lat, lng } = {}, existentes = [], idActual = null){
  const errores = {};
  const n = String(nombre ?? "").trim();
  if(!n) errores.nombre = "El nombre no puede quedar vacío.";
  else if(existentes.some(u=>u.id !== idActual && claveNombre(u.nombre) === claveNombre(n))) errores.nombre = "Ya existe una ubicación con ese nombre.";
  if(!tipo) errores.tipo = "Elige un tipo.";
  if(!coordenadasValidas(Number(lat), Number(lng))) errores.coordenadas = "Faltan las coordenadas o no son válidas.";
  return resultado(errores);
}

export function validarEquipo({ nombre, ubicacion_id, activo_id } = {}, equipos = [], idActual = null){
  const errores = {};
  const n = String(nombre ?? "").trim();
  if(!ubicacion_id) errores.ubicacion_id = "Falta la ubicación.";
  if(!n) errores.nombre = "El nombre no puede quedar vacío.";
  else if(equipos.some(e=>e.id !== idActual && e.ubicacion_id === ubicacion_id && claveNombre(e.nombre) === claveNombre(n))) errores.nombre = "Ya hay un equipo con ese nombre en esta ubicación.";
  if(activo_id !== null && activo_id !== undefined && equipos.some(e=>e.id !== idActual && e.activo_id === activo_id)) errores.activo_id = "Ese activo ya está vinculado a otro equipo de radioenlace.";
  return resultado(errores);
}

export function validarEnlace({ equipo_origen_id, equipo_destino_id, frecuencia_mhz } = {}, indices, enlaces = [], idActual = null){
  const errores = {};
  const o = indices.equipoPorId.get(equipo_origen_id), d = indices.equipoPorId.get(equipo_destino_id);
  if(!o) errores.equipo_origen_id = "Falta el equipo de origen.";
  if(!d) errores.equipo_destino_id = "Elige el equipo del otro extremo.";
  else if(o && o.id === d.id) errores.equipo_destino_id = "Un equipo no puede enlazarse consigo mismo.";
  else if(o && o.ubicacion_id === d.ubicacion_id) errores.equipo_destino_id = "Un enlace debe unir equipos de ubicaciones distintas.";
  else if(o && enlaces.some(l=>l.id !== idActual && ((l.equipo_origen_id === o.id && l.equipo_destino_id === d.id) || (l.equipo_origen_id === d.id && l.equipo_destino_id === o.id)))) errores.equipo_destino_id = "Esos dos equipos ya están enlazados.";
  if(frecuencia_mhz !== null && frecuencia_mhz !== undefined && frecuencia_mhz !== "" && !(Number(frecuencia_mhz) > 0)) errores.frecuencia_mhz = "La frecuencia debe ser un número mayor que cero.";
  return resultado(errores);
}

export function validarTipoUbicacion(valor, etiqueta, existentes = []){
  const errores = {};
  if(!String(etiqueta ?? "").trim() || !valor) errores.etiqueta = "La etiqueta no puede quedar vacía.";
  else if(existentes.some(t=>t.valor === valor)) errores.etiqueta = "Ya existe un tipo equivalente a esa etiqueta.";
  return resultado(errores);
}

// Fecha de un movimiento de ubicación: obligatoria, no futura y no anterior a
// la llegada del activo a su ubicación actual (misma regla que el trigger).
export function validarFechaMovimiento(fecha, vigente, hoy = hoyLocalISO()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) return "Elige la fecha del movimiento.";
  if(fecha > hoy) return "La fecha no puede ser futura.";
  if(vigente && vigente.desde && fecha < vigente.desde) return `La fecha no puede ser anterior a su llegada a la ubicación actual (${vigente.desde}).`;
  return null;
}

// ---------------------------------------------------------------------------
// Errores de Supabase → mensaje para una persona. Los mensajes que levantan
// los triggers de la migración 002 ya vienen en español y se muestran tal cual.
// ---------------------------------------------------------------------------
const ERRORES_POR_RESTRICCION = [
  ["ubicaciones_nombre_unico", "Ya existe una ubicación con ese nombre."],
  ["ubicaciones_nombre_no_vacio", "El nombre de la ubicación no puede quedar vacío."],
  ["ubicaciones_lat_rango", "La latitud debe estar entre -90 y 90."],
  ["ubicaciones_lng_rango", "La longitud debe estar entre -180 y 180."],
  ["equipos_radioenlace_nombre_unico", "Ya hay un equipo con ese nombre en esta ubicación."],
  ["equipos_radioenlace_nombre_no_vacio", "El nombre del equipo no puede quedar vacío."],
  ["equipos_radioenlace_activo_unico", "Ese activo ya está vinculado a otro equipo de radioenlace."],
  ["enlaces_par_unico", "Esos dos equipos ya están enlazados."],
  ["enlaces_extremos_distintos", "Un equipo no puede enlazarse consigo mismo."],
  ["enlaces_frecuencia_positiva", "La frecuencia debe ser mayor que cero."],
  ["historial_ubicacion_un_vigente", "Ese activo ya tiene una ubicación vigente. Recarga el mapa e inténtalo de nuevo."],
  ["historial_ubicacion_fechas", "La fecha de fin no puede ser anterior a la de inicio."],
  ["tipos_ubicacion_pkey", "Ya existe un tipo equivalente a esa etiqueta."],
];

export function traducirErrorMapa(error){
  if(!error) return "Error desconocido.";
  const msg = String(error.message || error);
  const code = String(error.code || "");
  for(const [restriccion, texto] of ERRORES_POR_RESTRICCION) if(msg.includes(restriccion)) return texto;
  if(code === "PGRST205" || code === "42P01" || /Could not find the table|does not exist/i.test(msg)){
    return "Las tablas del mapa todavía no existen en Supabase: falta correr db/migraciones/002_mapa_ubicaciones_radioenlaces.sql.";
  }
  if(code === "23503"){
    return /update or delete on table "ubicaciones"/i.test(msg)
      ? "No se puede eliminar: todavía hay equipos o historial de activos que apuntan a esta ubicación. Puedes archivarla."
      : "La operación apunta a un registro que ya no existe. Recarga el mapa e inténtalo de nuevo.";
  }
  if(code === "42501"){
    if(/row-level security/i.test(msg)) return "No tienes permiso para hacer esto (lo bloqueó la política de seguridad de la base).";
    if(/permission denied for (table|relation)/i.test(msg)) return `La base rechazó el acceso a la tabla: falta el GRANT de la migración 002 (${msg}).`;
  }
  return msg;
}
