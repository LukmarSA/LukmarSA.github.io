// Campos configurables de los activos (v10, migración 012).
//
// Hay dos clases de campos, en una sola lista con un orden para todos:
//   - los 9 de siempre ("fijos"): son columnas de activos (serie, SO, RAM,
//     almacenamiento, procesador, las dos MAC, color y longitud). Se les
//     cambia la etiqueta y el orden, pero no se borran ni cambian de tipo;
//   - los que crea el administrador: sus valores van en activos.personalizados
//     (jsonb), { <clave>: valor }.
// Cada tipo de activo elige cuáles usa (tipos_activo.campos_pertinentes) y
// cuáles son obligatorios (tipos_activo.campos_obligatorios, desde la 012).
// Un tipo sin configuración ve los 7 de cómputo, como siempre.
//
// Sin la 012 no hay tabla de definiciones: la app usa CAMPOS_FIJOS tal cual.
//
// Lógica pura (sin DOM ni Supabase): se prueba en Node (tests/activo-unit.mjs).
import { fmtFecha } from "./helpers.js";

export const TIPOS_DATO = [
  { id: "texto",       etiqueta: "Texto" },
  { id: "texto_largo", etiqueta: "Texto largo" },
  { id: "numero",      etiqueta: "Número" },
  { id: "fecha",       etiqueta: "Fecha" },
  { id: "si_no",       etiqueta: "Sí / No" },
  { id: "lista",       etiqueta: "Lista de opciones" },
];
const IDS_TIPO_DATO = new Set(TIPOS_DATO.map(t=>t.id));
export function etiquetaTipoDato(id){ return (TIPOS_DATO.find(t=>t.id === id) || { etiqueta: id }).etiqueta; }

// "Único entre activos" solo tiene sentido para estos.
export const TIPOS_CON_UNICO = new Set(["texto", "numero"]);

// Los 7 "de cómputo": un tipo sin configuración los ve todos. Y los 2 "extra".
export const CAMPOS_BLOQUEABLES = ["serie","so","ram_gb","disco_gb","procesador","mac_wifi","mac_ethernet"];
export const CAMPOS_EXTRA = ["color","longitud_m"];

// Los 9 fijos, igual que la semilla de la 012 (etiqueta, tipo, unidad, columna y orden).
export const CAMPOS_FIJOS = [
  { clave: "serie",        etiqueta: "Serie",             tipo_dato: "texto",  unidad: null, columna: "serie",             orden: 10 },
  { clave: "so",           etiqueta: "Sistema operativo", tipo_dato: "texto",  unidad: null, columna: "sistema_operativo", orden: 20 },
  { clave: "ram_gb",       etiqueta: "RAM",               tipo_dato: "numero", unidad: "GB", columna: "ram_gb",            orden: 30 },
  { clave: "disco_gb",     etiqueta: "Almacenamiento",    tipo_dato: "numero", unidad: "GB", columna: "disco_gb",          orden: 40 },
  { clave: "procesador",   etiqueta: "Procesador",        tipo_dato: "texto",  unidad: null, columna: "procesador",        orden: 50 },
  { clave: "mac_wifi",     etiqueta: "MAC WiFi",          tipo_dato: "texto",  unidad: null, columna: "mac_wifi",          orden: 60 },
  { clave: "mac_ethernet", etiqueta: "MAC Ethernet",      tipo_dato: "texto",  unidad: null, columna: "mac_ethernet",      orden: 70 },
  { clave: "color",        etiqueta: "Color",             tipo_dato: "texto",  unidad: null, columna: "color",             orden: 80 },
  { clave: "longitud_m",   etiqueta: "Longitud",          tipo_dato: "numero", unidad: "m",  columna: "longitud_m",        orden: 90 },
].map(c=>Object.freeze({ opciones: [], fijo: true, unico: false, en_acta: false, activo: true, ...c }));

export const LABEL_CAMPO = Object.fromEntries(CAMPOS_FIJOS.map(c=>[c.clave, c.etiqueta]));

// Tabla de activos: la columna de cada campo de siempre (clave de columna →
// clave del campo) y el prefijo de las columnas de los campos nuevos.
export const CLAVE_CAMPO_POR_COLUMNA = { serie:"serie", so:"so", ram:"ram_gb", disco:"disco_gb", procesador:"procesador", macwifi:"mac_wifi", maceth:"mac_ethernet", color:"color", longitud:"longitud_m" };
export const PREFIJO_COLUMNA_CAMPO = "campo:";

// Claves que un campo nuevo no puede usar: las columnas de activos, lo que
// el formulario ya usa (celular) y nombres que confundirían.
const RESERVADAS = new Set([
  "id","propiedad","tipo","marca","modelo","nombre_dispositivo","sistema_operativo","proveedor","fecha_adquisicion",
  "celular","celular_gmail","celular_password","gmail","password","trazabilidad","creado_en","valor_compra",
  "vida_util_anios","fotos","estado","personalizados","custodio","historial_custodia","historial_ubicacion",
  "nombre","cargo","tag","acciones","ubicacion",
  ...CAMPOS_FIJOS.map(c=>c.clave),
]);
export const FORMATO_CLAVE = /^[a-z][a-z0-9_]{0,39}$/;
export const LARGO_ETIQUETA = 60;
export const LARGO_UNIDAD = 12;
const LARGO_TEXTO = 500;
const LARGO_TEXTO_LARGO = 4000;

const vacio = v=>v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const claveTexto = s=>String(s ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

export function slugCampo(texto){
  return String(texto ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// Clave fija de un campo nuevo, a partir de su etiqueta: sin tildes, en
// minúsculas, con "_", que empiece con letra y sin chocar con otra.
export function claveDesdeEtiqueta(etiqueta, existentes = []){
  let base = slugCampo(etiqueta).slice(0, 36).replace(/_+$/, "");
  if(!base) base = "campo";
  if(!/^[a-z]/.test(base)) base = `c_${base}`.slice(0, 36);
  const usadas = new Set(existentes.map(c=>c.clave));
  const libre = k=>!usadas.has(k) && !RESERVADAS.has(k);
  if(libre(base)) return base;
  for(let n = 2; n < 1000; n++){ const k = `${base}_${n}`; if(libre(k)) return k; }
  return `${base}_${Date.now() % 100000}`;
}

// Opción de una lista: valor fijo (sale de la etiqueta) y etiqueta editable.
export function valorDeOpcion(etiqueta, existentes = []){
  let base = slugCampo(etiqueta).slice(0, 40) || "opcion";
  const usados = new Set(existentes.map(o=>o.valor));
  if(!usados.has(base)) return base;
  for(let n = 2; n < 1000; n++){ const k = `${base}_${n}`; if(!usados.has(k)) return k; }
  return `${base}_${Date.now() % 100000}`;
}

export function normalizarDefinicion(f){
  const fijo = !!f.fijo;
  const base = fijo ? CAMPOS_FIJOS.find(c=>c.clave === f.clave) : null;
  return {
    id: f.id ?? null,
    clave: String(f.clave ?? ""),
    etiqueta: String(f.etiqueta ?? (base ? base.etiqueta : f.clave) ?? ""),
    tipo_dato: IDS_TIPO_DATO.has(f.tipo_dato) ? f.tipo_dato : (base ? base.tipo_dato : "texto"),
    unidad: vacio(f.unidad) ? null : String(f.unidad).trim(),
    opciones: Array.isArray(f.opciones) ? f.opciones.filter(o=>o && !vacio(o.valor)).map(o=>({ valor: String(o.valor), etiqueta: String(o.etiqueta ?? o.valor), activo: o.activo !== false })) : [],
    fijo,
    columna: fijo ? (f.columna || (base && base.columna) || f.clave) : null,
    unico: !!f.unico,
    en_acta: !!f.en_acta,
    orden: Number.isFinite(Number(f.orden)) ? Number(f.orden) : 0,
    activo: f.activo !== false,
  };
}

const COMPARADOR = new Intl.Collator("es", { sensitivity: "base", numeric: true });
export function ordenarCampos(defs){
  return [...defs].sort((a, b)=>(a.orden - b.orden) || COMPARADOR.compare(a.etiqueta, b.etiqueta) || COMPARADOR.compare(a.clave, b.clave));
}

// Las definiciones que usa la app: las de la tabla (con la 012) o los 9 fijos.
// Si a la tabla le faltara alguno de los fijos, se completa con el de fábrica.
export function definicionesDeCampos(filas = [], { hay012 = false } = {}){
  if(!hay012) return CAMPOS_FIJOS.map(c=>({ ...c, opciones: [] }));
  const defs = (filas || []).map(normalizarDefinicion).filter(d=>FORMATO_CLAVE.test(d.clave));
  for(const f of CAMPOS_FIJOS) if(!defs.some(d=>d.clave === f.clave)) defs.push({ ...f, opciones: [] });
  return ordenarCampos(defs);
}

// ---------------------------------------------------------------------------
// Qué ve cada tipo
// ---------------------------------------------------------------------------
// tipoCfg = la fila de tipos_activo (o null si el activo no tiene tipo, o si
// su tipo no está configurado: entonces ve los 7 de cómputo).
export function pertinentesDelTipo(tipoCfg){
  return tipoCfg ? (Array.isArray(tipoCfg.campos_pertinentes) ? tipoCfg.campos_pertinentes : []) : CAMPOS_BLOQUEABLES;
}

export function obligatoriosDelTipo(tipoCfg){
  const pert = new Set(pertinentesDelTipo(tipoCfg));
  const obl = tipoCfg && Array.isArray(tipoCfg.campos_obligatorios) ? tipoCfg.campos_obligatorios : [];
  return new Set(obl.filter(k=>pert.has(k)));
}

// Los campos que el tipo usa, en el orden global. Los desactivados no se
// muestran (sus valores se conservan en la base).
export function camposDelTipo(defs, tipoCfg){
  const pert = new Set(pertinentesDelTipo(tipoCfg));
  return ordenarCampos(defs.filter(d=>d.activo && pert.has(d.clave)));
}

export function aplicaATipo(def, tipoCfg){
  return !!def && def.activo && pertinentesDelTipo(tipoCfg).includes(def.clave);
}

// ---------------------------------------------------------------------------
// Valores
// ---------------------------------------------------------------------------
export function valorCrudo(a, def){
  if(!a || !def) return null;
  if(def.fijo) return a[def.columna] ?? null;
  const p = a.personalizados && typeof a.personalizados === "object" ? a.personalizados : {};
  return p[def.clave] ?? null;
}

function numeroDesdeTexto(v){
  if(typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let t = String(v).trim().replace(/\s+/g, "");
  // «1.234,5» o «1,234.5»: el último separador es el decimal.
  const coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
  if(coma >= 0 && punto >= 0){
    if(coma > punto) t = t.replace(/\./g, "").replace(",", ".");
    else t = t.replace(/,/g, "");
  } else if(coma >= 0){
    t = (t.match(/,/g).length > 1) ? t.replace(/,/g, "") : t.replace(",", ".");
  }
  if(!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
  return Number(t);
}

function fechaValida(t){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(t)) return false;
  const [y, m, d] = t.split("-").map(Number);
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCFullYear() === y && f.getUTCMonth() === m - 1 && f.getUTCDate() === d;
}

// Convierte lo que se escribió en el formulario al valor que se guarda.
// { ok, valor } o { ok:false, error }. Vacío → null.
export function normalizarValor(def, entrada, { valorActual = null } = {}){
  const etq = `«${def.etiqueta}»`;
  if(entrada === null || entrada === undefined) return { ok: true, valor: null };
  if(typeof entrada === "string" && entrada.trim() === "") return { ok: true, valor: null };
  switch(def.tipo_dato){
    case "texto": {
      const t = String(entrada).trim().replace(/\s+/g, " ");
      if(t.length > LARGO_TEXTO) return { ok: false, error: `${etq} admite hasta ${LARGO_TEXTO} caracteres.` };
      return { ok: true, valor: t };
    }
    case "texto_largo": {
      const t = String(entrada).replace(/\r\n?/g, "\n").trim();
      if(t.length > LARGO_TEXTO_LARGO) return { ok: false, error: `${etq} admite hasta ${LARGO_TEXTO_LARGO} caracteres.` };
      return { ok: true, valor: t };
    }
    case "numero": {
      const n = numeroDesdeTexto(entrada);
      if(!Number.isFinite(n)) return { ok: false, error: `${etq} tiene que ser un número.` };
      return { ok: true, valor: n };
    }
    case "fecha": {
      const t = String(entrada).trim();
      if(!fechaValida(t)) return { ok: false, error: `${etq}: la fecha no es válida.` };
      return { ok: true, valor: t };
    }
    case "si_no": {
      if(typeof entrada === "boolean") return { ok: true, valor: entrada };
      const t = String(entrada).trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if(["si","true","1"].includes(t)) return { ok: true, valor: true };
      if(["no","false","0"].includes(t)) return { ok: true, valor: false };
      return { ok: false, error: `${etq}: elige Sí o No.` };
    }
    case "lista": {
      const t = String(entrada);
      const o = def.opciones.find(x=>x.valor === t);
      // Una opción desactivada se acepta solo si ya era el valor del activo.
      if(!o || (!o.activo && t !== valorActual)) return { ok: false, error: `${etq}: «${t}» no es una de sus opciones.` };
      return { ok: true, valor: t };
    }
    default:
      return { ok: true, valor: String(entrada).trim() };
  }
}

export function etiquetaConUnidad(def){
  return def.tipo_dato === "numero" && def.unidad ? `${def.etiqueta} (${def.unidad})` : def.etiqueta;
}

// Texto para mostrar ("" si no hay valor).
export function textoValor(def, valor){
  if(valor === null || valor === undefined || valor === "") return "";
  switch(def.tipo_dato){
    case "numero": return def.unidad ? `${valor} ${def.unidad}` : String(valor);
    case "fecha": return fmtFecha(String(valor));
    case "si_no": return valor === true || valor === "true" ? "Sí" : (valor === false || valor === "false" ? "No" : String(valor));
    case "lista": { const o = def.opciones.find(x=>x.valor === String(valor)); return o ? o.etiqueta : String(valor); }
    default: return String(valor);
  }
}

// Para ordenar la tabla: números como números, fechas ISO, el resto como texto.
export function valorParaOrdenar(def, valor){
  if(valor === null || valor === undefined || valor === "") return def.tipo_dato === "numero" ? 0 : "";
  if(def.tipo_dato === "numero"){ const n = Number(valor); return Number.isFinite(n) ? n : 0; }
  if(def.tipo_dato === "fecha") return String(valor);
  return textoValor(def, valor);
}

// Para el Excel: el número como número; la fecha en ISO (como la fecha de
// adquisición); sí/no y listas con su texto.
export function valorParaExcel(def, valor){
  if(valor === null || valor === undefined || valor === "") return "";
  if(def.tipo_dato === "numero"){ const n = Number(valor); return Number.isFinite(n) ? n : String(valor); }
  if(def.tipo_dato === "fecha") return String(valor);
  return textoValor(def, valor);
}

// ---------------------------------------------------------------------------
// Único entre activos (la base lo exige; esto es para avisar antes de guardar)
// ---------------------------------------------------------------------------
export function claveComparacion(def, valor){
  if(valor === null || valor === undefined || (typeof valor === "string" && valor.trim() === "")) return null;
  if(def.tipo_dato === "numero"){ const n = Number(valor); return Number.isFinite(n) ? `n:${n}` : null; }
  return `t:${claveTexto(valor)}`;
}

export function buscarRepetido(def, valor, activos = [], idPropio = null){
  const k = claveComparacion(def, valor);
  if(k === null) return null;
  return activos.find(a=>a.id !== idPropio && claveComparacion(def, valorCrudo(a, def)) === k) || null;
}

// Valores repetidos que ya hay (antes de marcar un campo como único).
export function repetidosActuales(def, activos = []){
  const grupos = new Map();
  for(const a of activos){
    const k = claveComparacion(def, valorCrudo(a, def));
    if(k === null) continue;
    if(!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(a);
  }
  return [...grupos.values()].filter(g=>g.length > 1);
}

// ---------------------------------------------------------------------------
// Guardar: qué va a activos.personalizados. Solo los campos nuevos que se ven
// (un campo oculto por el tipo no se envía y la base conserva su valor). Un
// campo vaciado va como null: la base lo quita del JSON (012).
// ---------------------------------------------------------------------------
export function parchePersonalizados(defsVisibles, valores){
  const parche = {};
  for(const d of defsVisibles){
    if(d.fijo || !(d.clave in valores)) continue;
    parche[d.clave] = valores[d.clave] === undefined ? null : valores[d.clave];
  }
  return parche;
}

// Al crear: solo los que tienen valor.
export function personalizadosIniciales(parche){
  return Object.fromEntries(Object.entries(parche || {}).filter(([, v])=>v !== null && v !== undefined && v !== ""));
}

// ---------------------------------------------------------------------------
// Acta de entrega: los campos marcados «en el acta» (menos la serie, que ya va
// siempre), si el tipo los usa y el activo tiene valor.
// ---------------------------------------------------------------------------
export function partesActa(defs, a, tipoCfg){
  return camposDelTipo(defs, tipoCfg)
    .filter(d=>d.en_acta && d.clave !== "serie")
    .map(d=>{ const t = textoValor(d, valorCrudo(a, d)); return t ? `${d.etiqueta}: ${t}` : null; })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Validar una definición antes de crearla o editarla
// ---------------------------------------------------------------------------
export function validarDefinicion(def, existentes = [], { claveActual = null } = {}){
  const errores = [];
  const etiqueta = String(def.etiqueta ?? "").trim();
  if(!etiqueta) errores.push("La etiqueta no puede quedar vacía.");
  else if(etiqueta.length > LARGO_ETIQUETA) errores.push(`La etiqueta admite hasta ${LARGO_ETIQUETA} caracteres.`);
  else if(existentes.some(c=>c.clave !== claveActual && claveTexto(c.etiqueta) === claveTexto(etiqueta))) errores.push(`Ya hay un campo que se llama «${etiqueta}».`);
  if(!IDS_TIPO_DATO.has(def.tipo_dato)) errores.push("Elige el tipo de dato.");
  if(!vacio(def.unidad) && String(def.unidad).trim().length > LARGO_UNIDAD) errores.push(`La unidad admite hasta ${LARGO_UNIDAD} caracteres.`);
  if(def.unico && !TIPOS_CON_UNICO.has(def.tipo_dato)) errores.push("«Único» solo se puede marcar en campos de texto o de número.");
  if(def.tipo_dato === "lista"){
    const ops = Array.isArray(def.opciones) ? def.opciones : [];
    if(!ops.some(o=>o.activo !== false)) errores.push("Una lista necesita al menos una opción activa.");
    if(ops.some(o=>!String(o.etiqueta ?? "").trim())) errores.push("Hay una opción sin nombre.");
    const vistos = new Set();
    for(const o of ops){
      const k = claveTexto(o.etiqueta);
      if(!k) continue;
      if(vistos.has(k)){ errores.push(`La opción «${String(o.etiqueta).trim()}» está repetida.`); break; }
      vistos.add(k);
    }
    if(ops.some(o=>!o.valor || String(o.valor).length > 60)) errores.push("Hay una opción con un valor interno inválido.");
  }
  if(claveActual === null && def.clave !== undefined && def.clave !== null && !FORMATO_CLAVE.test(def.clave)) errores.push("La clave interna no es válida.");
  return { ok: errores.length === 0, errores };
}

// Mover un campo una posición (Configuración, flechas): devuelve los cambios
// de orden [{ clave, orden }] (vacío si ya está en el borde). Si hay órdenes
// repetidos, renumera todo de 10 en 10.
export function moverCampo(defs, clave, direccion){
  const lista = ordenarCampos(defs);
  const i = lista.findIndex(d=>d.clave === clave);
  const j = direccion === "arriba" ? i - 1 : i + 1;
  if(i < 0 || j < 0 || j >= lista.length) return [];
  const repetidos = new Set(lista.map(d=>d.orden)).size !== lista.length;
  if(repetidos){
    const nueva = [...lista];
    [nueva[i], nueva[j]] = [nueva[j], nueva[i]];
    return nueva.map((d, k)=>({ clave: d.clave, orden: (k + 1) * 10 })).filter((c, k)=>lista.find(d=>d.clave === c.clave).orden !== c.orden);
  }
  return [{ clave: lista[i].clave, orden: lista[j].orden }, { clave: lista[j].clave, orden: lista[i].orden }];
}

export function siguienteOrden(defs){
  return defs.length ? Math.max(...defs.map(d=>Number(d.orden) || 0)) + 10 : 10;
}
