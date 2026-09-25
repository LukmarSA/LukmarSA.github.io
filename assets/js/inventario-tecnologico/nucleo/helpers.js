export function fmtTag(a){
  if(a===null || typeof a!=="object") a = {id:a};
  const prefijo = a.propiedad==="eq" ? "EQS" : "LKM";
  return prefijo + "-" + String(a.id).padStart(3,"0");
}

export function valorActualActivo(a){
  if(!a.valor_compra || !a.fecha_adquisicion || !a.vida_util_anios) return null;
  const mesesTranscurridos = (Date.now() - new Date(a.fecha_adquisicion).getTime()) / (1000*60*60*24*30.44);
  const mesesVidaUtil = a.vida_util_anios * 12;
  const fraccionRestante = Math.max(0, 1 - (mesesTranscurridos / mesesVidaUtil));
  return Math.round(a.valor_compra * fraccionRestante * 100) / 100;
}

export function fmtValorActualConPorcentaje(a){
  const actual = valorActualActivo(a);
  if(actual===null) return null;
  const pct = Math.round((actual / a.valor_compra) * 100);
  return `$${actual.toFixed(2)} (${pct}%)`;
}

// OJO: iso siempre es una fecha SIN hora (columnas `date` de Postgres, tipo
// "2026-09-09") — `new Date(iso)` la interpreta como medianoche UTC, y en un
// huso horario negativo (Ecuador, UTC-5) eso cae en el día ANTERIOR en hora
// local, mostrando "8 de septiembre" para una fecha guardada como el 9. Se
// parsea a mano (mismo patrón ya usado en fechaEnPalabras/fechaDDMMAAAA) y se
// construye el Date con año/mes/día LOCALES para no cruzar el huso horario.
export function fmtFecha(iso){
  if(!iso) return "—";
  const [y,m,d] = iso.split("-").map(Number);
  if(!y||!m||!d) return iso;
  const fecha = new Date(y, m-1, d);
  if(isNaN(fecha)) return iso;
  return fecha.toLocaleDateString('es-EC', {year:'numeric', month:'short', day:'2-digit'});
}

export function fmtFechaHora(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return iso;
  return d.toLocaleString('es-EC', {year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}

// Zona horaria del negocio. La base usa la misma para "hoy":
// (now() AT TIME ZONE 'America/Guayaquil')::date (migraciones 002 y 004).
export const ZONA_HORARIA = "America/Guayaquil";

// Fecha de HOY (AAAA-MM-DD) en Ecuador. No usar toISOString(): da la fecha
// UTC, y después de las 19:00 en Guayaquil ya es la de mañana. Se arma con
// formatToParts (y no con toLocaleDateString) para no depender del formato
// de fecha de un idioma.
export function hoyISO(fecha = new Date()){
  const partes = {};
  for(const p of new Intl.DateTimeFormat("en-US", { timeZone: ZONA_HORARIA, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(fecha)) partes[p.type] = p.value;
  return `${partes.year}-${partes.month}-${partes.day}`;
}

export function esc(s){
  if(s===null||s===undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function buscarActivo(datos, id){
  return datos.activos.find(a=>a.id===id);
}

export const TIPOS_DEVOLUCION = [
  {v:"firmada", label:"Firmada (devolución normal con acta)"},
  {v:"desvinculada", label:"Desvinculada (el custodio dejó la empresa)"},
  {v:"perdida", label:"Perdida (no se recuperó el activo)"},
  {v:"simple", label:"Simple (no aplica firmar)"},
];

export function labelTipoDevolucion(v){
  const f = TIPOS_DEVOLUCION.find(t=>t.v===v);
  return f ? f.label : "—";
}

export const TIPOS_ENTREGA = [
  {v:"firmada", label:"Firmada (entrega normal con acta)"},
  {v:"pendiente_firma", label:"Pendiente de firmar (entrega ya realizada, acta aún sin firmar)"},
  {v:"simple", label:"Simple (no aplica firmar)"},
];

export function labelTipoEntrega(v){
  const f = TIPOS_ENTREGA.find(t=>t.v===v);
  return f ? f.label : "—";
}
