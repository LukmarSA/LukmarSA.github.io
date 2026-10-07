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
//   * La red (010) y la referencia van entre paréntesis, en ese orden y
//     separadas por " · ": "Cámara (Red Cámaras · Norte) en Torre K…",
//     "Estación (Red Oficina) en …", "Cámara (Norte) en …" si no tiene red.
//     En el nombre del servidor, su red va solo si es distinta de la del
//     equipo (pedido de la persona: "solo si es distinta").
//   * Con la 011 la red se hereda: un equipo sin red propia lleva la de su
//     servidor (y así hacia arriba), en su nombre y en el del servidor.
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
// (tests/mapa-unit.mjs y db/pruebas/mapa_pruebas_reglas_rls.sql, secciones S,
// U y V). La red entra en el nombre solo con la 010 (conRed: la app lo sabe por
// version_nombres_equipos()) y se hereda solo con la 011 (herencia); sin ellas,
// la base arma los nombres sin la red (o sin herencia) y la app hace lo mismo,
// así nunca se contradicen.
import { esMedio, redesEfectivas } from "./mapa-jerarquia.js";

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

// " (Red Oficina · Norte)", " (Red Oficina)", " (Norte)" o nada.
export function textoParentesis(partes){
  const p = partes.map(x=>String(x ?? "").trim()).filter(Boolean);
  return p.length ? ` (${p.join(" · ")})` : "";
}

// Índices mínimos que necesitan los nombres. conRed = la base ya tiene la
// migración 010 (la red entra en el nombre); herencia = tiene la 011 (sin red
// propia, la del servidor).
export function contextoNombres({ equipos = [], ubicaciones = [], tipos = [], redes = [], conRed = false, herencia = false } = {}){
  const conHerencia = !!conRed && !!herencia;
  return {
    equipoPorId: new Map(equipos.map(e=>[e.id, e])),
    ubicacionPorId: new Map(ubicaciones.map(u=>[u.id, u])),
    tipoPorValor: new Map(tipos.map(t=>[t.valor, t])),
    redPorId: new Map(redes.map(r=>[Number(r.id), r])),
    conRed: !!conRed,
    herencia: conHerencia,
    // Red efectiva de cada equipo de la lista (sale de su red_id PROPIA, no
    // de lo anotado en memoria: así sirve también para copias con cambios).
    efectivas: conHerencia ? redesEfectivas(equipos) : null,
  };
}

// La red de una fila: la propia o, con la 011, la heredada de su servidor
// (una fila editada todavía no está en la lista: se mira su servidor).
function redDe(fila, ctx){
  if(!ctx.conRed) return null;
  let id = tieneValor(fila.red_id) && fila.red_id !== "" ? Number(fila.red_id) : null;
  if(id === null && ctx.herencia && tieneValor(fila.servidor_id)){
    const r = ctx.efectivas.get(Number(fila.servidor_id));
    id = r ? r.redId : null;
  }
  return id !== null ? ctx.redPorId.get(id) || null : null;
}

// Nombre armado para una fila de equipo (sin numerar). null si no tiene un
// tipo conocido: ahí manda el nombre escrito a mano.
// fila = { ubicacion_id, tipo_equipo, referencia, red_id, servidor_id, medio }.
export function nombreBase(fila, ctx){
  const t = fila && fila.tipo_equipo ? ctx.tipoPorValor.get(fila.tipo_equipo) : null;
  if(!t) return null;
  const u = ctx.ubicacionPorId.get(Number(fila.ubicacion_id));
  const red = redDe(fila, ctx);
  let nombre = `${t.etiqueta}${textoParentesis([red && red.nombre, fila.referencia])} en ${u ? u.nombre : "?"}`;
  const s = tieneValor(fila.servidor_id) ? ctx.equipoPorId.get(Number(fila.servidor_id)) : null;
  if(s){
    const mismaUbicacion = Number(s.ubicacion_id) === Number(fila.ubicacion_id);
    const medio = esMedio(fila.medio) ? fila.medio : (mismaUbicacion ? "cable" : "inalambrico");
    const ts = s.tipo_equipo ? ctx.tipoPorValor.get(s.tipo_equipo) : null;
    // La red del servidor, solo si es distinta de la del equipo.
    const redS = ts ? redDe(s, ctx) : null;
    const otraRed = redS && (!red || Number(redS.id) !== Number(red.id)) ? redS.nombre : null;
    // Servidor sin tipo (anterior a la 007): se lo nombra por su nombre guardado.
    const quien = ts ? `${ts.etiqueta}${textoParentesis([otraRed, s.referencia])}` : (s.nombre_guardado ?? s.nombre);
    const us = ctx.ubicacionPorId.get(s.ubicacion_id);
    nombre += ` ${participio(t.genero, medio !== "inalambrico")} a ${quien}${mismaUbicacion ? "" : ` en ${us ? us.nombre : "?"}`}`;
  }
  return nombre;
}

function numerado(base, n){ return n <= 1 ? base : `${base} (${n})`; }

// v21 (3.23, pedido y decidido el 7-oct): el nombre corto de un equipo para
// el tooltip de una línea, que ya dice entre qué ubicaciones va: su tipo con
// la red y la referencia entre paréntesis, sin «en …» ni a qué se conecta, y
// el número si su nombre lo lleva («PtP-E (CCTV · B02)», «Cámara (CCTV) (2)»).
// Sin tipo, el nombre escrito a mano, recortado. nombreRed(e): la red que va
// en su nombre (la efectiva) o null. El número es el que dejó aplicarNombres
// (numero_nombre): el «(2)» del final del nombre puede ser del servidor o de
// la ubicación («… conectada a Switch viejo (2)»). Sin él, se lee del nombre.
export function nombreCortoEquipo(e, { tipoPorValor = new Map(), nombreRed = ()=>null, maximo = 60 } = {}){
  if(!e) return "?";
  const t = e.tipo_equipo ? tipoPorValor.get(e.tipo_equipo) : null;
  if(!t){
    const n = String(e.nombre ?? "").trim() || "?";
    return n.length > maximo ? `${n.slice(0, maximo - 1).trimEnd()}…` : n;
  }
  const leido = /\s\((\d+)\)$/.exec(String(e.nombre ?? ""));
  const numero = Number.isInteger(e.numero_nombre) ? e.numero_nombre : (leido ? Number(leido[1]) : 1);
  return `${t.etiqueta || t.valor}${textoParentesis([nombreRed(e), e.referencia])}${numero > 1 ? ` (${numero})` : ""}`;
}

// Nombre que se muestra de cada equipo (Map id → nombre). Los equipos con tipo
// se numeran por ubicación si se repiten (en orden de id); los que no tienen
// tipo muestran su nombre guardado y cuentan como "ocupados".
// numeros (opcional, un Map): ahí deja id → número de cada uno con tipo (1 si
// no se repite).
export function nombresAutomaticos({ equipos = [], ubicaciones = [], tipos = [], redes = [], conRed = false, herencia = false } = {}, numeros = null){
  const ctx = contextoNombres({ equipos, ubicaciones, tipos, redes, conRed, herencia });
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
    if(numeros) numeros.set(e.id, n);
    ocupar(e.ubicacion_id, nombre);
  }
  return out;
}

// Nombre para GUARDAR un equipo nuevo o editado: el armado, numerado para que
// no choque con ningún otro equipo de su ubicación (ni con el nombre que se
// muestra ni con el guardado: la base tiene un índice único por ubicación).
// equipos = todos los equipos cargados (con nombre = el que se muestra y
// nombre_guardado = el de la base). idActual = el que se edita (null si es nuevo).
export function nombreParaGuardar(fila, { equipos = [], ubicaciones = [], tipos = [], redes = [], conRed = false, herencia = false } = {}, idActual = null){
  const ctx = contextoNombres({ equipos, ubicaciones, tipos, redes, conRed, herencia });
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
// v21: y numero_nombre = su número si se repite (1 si no; null sin tipo),
// para el nombre corto de los tooltips de las líneas.
export function aplicarNombres(equipos, { ubicaciones = [], tipos = [], redes = [], conRed = false, herencia = false } = {}){
  for(const e of equipos) if(!("nombre_guardado" in e)) e.nombre_guardado = e.nombre;
  const numeros = new Map();
  const nombres = nombresAutomaticos({ equipos, ubicaciones, tipos, redes, conRed, herencia }, numeros);
  for(const e of equipos){ e.nombre = nombres.get(e.id) ?? e.nombre_guardado; e.numero_nombre = numeros.get(e.id) ?? null; }
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
