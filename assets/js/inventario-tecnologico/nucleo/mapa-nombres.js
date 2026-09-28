// Red de la finca (migración 007): nombre automático de cada equipo, según su
// tipo y su servidor, y la lista de caídos efectiva de la simulación (marcados
// a mano + atajos encendidos).
//
// Nomenclatura (pedido de la persona): "Estación en Torre X enlazada a Punto a
// Punto en Torre Y". Solo el servidor inmediato, sin decir de dónde toma
// internet él a su vez, para no alargar el nombre.
//   * Servidor en otra ubicación (radioenlace): "… enlazado/a a {tipo} en {ubicación}".
//   * Servidor en la misma ubicación (cable):   "… conectado/a a {tipo}" (sin repetir la ubicación).
//   * Cable o fibra a otra ubicación (008):     "… conectado/a a {tipo} en {ubicación}".
//   * Sin servidor (raíz):                      "{tipo} en {ubicación}".
//   El participio sale del medio (inalámbrico → enlazado; cable o fibra →
//   conectado) y la ubicación del servidor se nombra si es otra.
//   * La referencia (opcional) va entre paréntesis: "Cámara (Norte) en Torre K…".
//   * El género del tipo hace concordar el participio (Estación → enlazada).
//   * Si dos equipos de la misma ubicación quedan con el mismo nombre, el de
//     id más alto se numera: "… (2)", "… (3)".
// Un equipo sin tipo (cargado antes de la 007) conserva el nombre que se
// escribió a mano.
//
// Lógica pura, como mapa-jerarquia.js: todo llega por parámetro.
//
// La migración 008 hace lo mismo en SQL (recalcular_nombres_equipos) para
// que el nombre GUARDADO siga al día; las dos versiones tienen que coincidir
// (tests/mapa-unit.mjs y db/pruebas/mapa_pruebas_reglas_rls.sql, sección S).
import { esMedio } from "./mapa-jerarquia.js";

export const GENEROS = [
  { id: "m", etiqueta: "Masculino (el switch, el router)" },
  { id: "f", etiqueta: "Femenino (la estación, la cámara)" },
];

const clave = t=>String(t ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
const tieneValor = v=>v !== null && v !== undefined;

export function participio(genero, cable){
  const base = cable ? "conectad" : "enlazad";
  return base + (genero === "f" ? "a" : "o");
}

function textoReferencia(ref){
  const r = String(ref ?? "").trim();
  return r ? ` (${r})` : "";
}

// Índices mínimos que necesitan los nombres.
export function contextoNombres({ equipos = [], ubicaciones = [], tipos = [] } = {}){
  return {
    equipoPorId: new Map(equipos.map(e=>[e.id, e])),
    ubicacionPorId: new Map(ubicaciones.map(u=>[u.id, u])),
    tipoPorValor: new Map(tipos.map(t=>[t.valor, t])),
  };
}

// Nombre armado para una fila de equipo (sin numerar). null si no tiene un
// tipo conocido: ahí manda el nombre escrito a mano.
// fila = { ubicacion_id, tipo_equipo, referencia, servidor_id, medio }.
export function nombreBase(fila, ctx){
  const t = fila && fila.tipo_equipo ? ctx.tipoPorValor.get(fila.tipo_equipo) : null;
  if(!t) return null;
  const u = ctx.ubicacionPorId.get(Number(fila.ubicacion_id));
  let nombre = `${t.etiqueta}${textoReferencia(fila.referencia)} en ${u ? u.nombre : "?"}`;
  const s = tieneValor(fila.servidor_id) ? ctx.equipoPorId.get(Number(fila.servidor_id)) : null;
  if(s){
    const mismaUbicacion = Number(s.ubicacion_id) === Number(fila.ubicacion_id);
    const medio = esMedio(fila.medio) ? fila.medio : (mismaUbicacion ? "cable" : "inalambrico");
    const ts = s.tipo_equipo ? ctx.tipoPorValor.get(s.tipo_equipo) : null;
    // Servidor sin tipo (anterior a la 007): se lo nombra por su nombre guardado.
    const quien = ts ? `${ts.etiqueta}${textoReferencia(s.referencia)}` : (s.nombre_guardado ?? s.nombre);
    const us = ctx.ubicacionPorId.get(s.ubicacion_id);
    nombre += ` ${participio(t.genero, medio !== "inalambrico")} a ${quien}${mismaUbicacion ? "" : ` en ${us ? us.nombre : "?"}`}`;
  }
  return nombre;
}

function numerado(base, n){ return n <= 1 ? base : `${base} (${n})`; }

// Nombre que se muestra de cada equipo (Map id → nombre). Los equipos con tipo
// se numeran por ubicación si se repiten (en orden de id); los que no tienen
// tipo muestran su nombre guardado y cuentan como "ocupados".
export function nombresAutomaticos({ equipos = [], ubicaciones = [], tipos = [] } = {}){
  const ctx = contextoNombres({ equipos, ubicaciones, tipos });
  const out = new Map();
  const ocupados = new Map(); // ubicacion_id → Set(claves)
  const ocupar = (u, n)=>{ if(!ocupados.has(u)) ocupados.set(u, new Set()); ocupados.get(u).add(clave(n)); };
  const conTipo = [];
  for(const e of equipos){
    const base = nombreBase(e, ctx);
    if(base === null){ const n = e.nombre_guardado ?? e.nombre; out.set(e.id, n); ocupar(e.ubicacion_id, n); }
    else conTipo.push({ e, base });
  }
  conTipo.sort((a, b)=>a.e.id - b.e.id);
  for(const { e, base } of conTipo){
    const usados = ocupados.get(e.ubicacion_id) || new Set();
    let n = 1;
    while(usados.has(clave(numerado(base, n)))) n++;
    const nombre = numerado(base, n);
    out.set(e.id, nombre);
    ocupar(e.ubicacion_id, nombre);
  }
  return out;
}

// Nombre para GUARDAR un equipo nuevo o editado: el armado, numerado para que
// no choque con ningún otro equipo de su ubicación (ni con el nombre que se
// muestra ni con el guardado: la base tiene un índice único por ubicación).
// equipos = todos los equipos cargados (con nombre = el que se muestra y
// nombre_guardado = el de la base). idActual = el que se edita (null si es nuevo).
export function nombreParaGuardar(fila, { equipos = [], ubicaciones = [], tipos = [] } = {}, idActual = null){
  const ctx = contextoNombres({ equipos, ubicaciones, tipos });
  const base = nombreBase(fila, ctx);
  if(base === null) return null;
  const usados = new Set();
  for(const e of equipos){
    if(e.id === idActual || e.ubicacion_id !== fila.ubicacion_id) continue;
    usados.add(clave(e.nombre));
    if(tieneValor(e.nombre_guardado)) usados.add(clave(e.nombre_guardado));
  }
  let n = 1;
  while(usados.has(clave(numerado(base, n)))) n++;
  return numerado(base, n);
}

// Deja en cada fila en memoria: nombre_guardado = lo de la base y nombre = el
// que se muestra (así el resto de la app no cambia). Devuelve las mismas filas.
export function aplicarNombres(equipos, { ubicaciones = [], tipos = [] } = {}){
  for(const e of equipos) if(!("nombre_guardado" in e)) e.nombre_guardado = e.nombre;
  const nombres = nombresAutomaticos({ equipos, ubicaciones, tipos });
  for(const e of equipos) e.nombre = nombres.get(e.id) ?? e.nombre_guardado;
  return equipos;
}

// ---------------------------------------------------------------------------
// Atajos de simulación
// ---------------------------------------------------------------------------

// Caídos que se simulan: los marcados a mano + los de los atajos encendidos
// (sin repetir, solo equipos que existen).
export function caidosEfectivos({ manuales = [], atajosActivos = [], atajos = [], existe = ()=>true } = {}){
  const out = new Set(manuales.filter(existe));
  const activos = new Set(atajosActivos);
  for(const a of atajos) if(activos.has(a.id)) for(const id of a.equipos || []) if(existe(id)) out.add(id);
  return [...out].sort((a, b)=>a - b);
}

// Por equipo: qué atajos encendidos lo mantienen caído (para explicar por qué
// su casilla está marcada y bloqueada).
export function atajosQueLoApagan(equipoId, { atajosActivos = [], atajos = [] } = {}){
  const activos = new Set(atajosActivos);
  return atajos.filter(a=>activos.has(a.id) && (a.equipos || []).includes(equipoId));
}

export function validarAtajo({ nombre, equipos } = {}, atajos = [], idActual = null){
  const errores = {};
  const n = String(nombre ?? "").trim();
  if(!n) errores.nombre = "Ponle un nombre al atajo.";
  else if(n.length > 60) errores.nombre = "El nombre puede tener hasta 60 caracteres.";
  else if(atajos.some(a=>a.id !== idActual && clave(a.nombre) === clave(n))) errores.nombre = "Ya hay un atajo con ese nombre.";
  if(!Array.isArray(equipos) || !equipos.length) errores.equipos = "El atajo necesita al menos un equipo caído.";
  return { ok: !Object.keys(errores).length, errores };
}

export function validarRed({ nombre, color } = {}, redes = [], idActual = null){
  const errores = {};
  const n = String(nombre ?? "").trim();
  if(!n) errores.nombre = "Ponle un nombre a la red.";
  else if(n.length > 60) errores.nombre = "El nombre puede tener hasta 60 caracteres.";
  else if(redes.some(r=>r.id !== idActual && clave(r.nombre) === clave(n))) errores.nombre = "Ya hay una red con ese nombre.";
  if(!/^#[0-9A-Fa-f]{6}$/.test(String(color ?? ""))) errores.color = "Elige un color.";
  return { ok: !Object.keys(errores).length, errores };
}

export function slugTipo(etiqueta){
  return String(etiqueta ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
}

export function validarTipoEquipo({ etiqueta, genero } = {}, tipos = [], valorActual = null){
  const errores = {};
  const e = String(etiqueta ?? "").trim();
  const valor = valorActual || slugTipo(e);
  if(!e || !valor) errores.etiqueta = "Escribe el nombre del tipo.";
  else if(e.length > 40) errores.etiqueta = "Hasta 40 caracteres.";
  else if(tipos.some(t=>t.valor !== valorActual && (clave(t.etiqueta) === clave(e) || (!valorActual && t.valor === valor)))) errores.etiqueta = "Ya hay un tipo con ese nombre.";
  if(!["m", "f"].includes(genero)) errores.genero = "Elige el género.";
  return { ok: !Object.keys(errores).length, errores, valor };
}
