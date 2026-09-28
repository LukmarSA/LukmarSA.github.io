// Opciones del selector de «Servidor» (formulario del equipo de red y del
// respaldo): los equipos que pueden ser su servidor y, además, los activos
// del inventario que ya están ubicados pero todavía no son equipos de red
// (p. ej. el Router del Data Center). Elegir uno de esos lo registra como
// equipo de red al guardar.
//
// Lógica pura, como mapa-jerarquia.js: búsqueda sin tildes, facetas con sus
// cuentas (como los filtros de la tabla de activos), orden y la sugerencia de
// medio. La interfaz está en ui/mapa/selector-servidor.js.
import { distanciaKm } from "./geo.js";
import { normalizarBusqueda } from "./formulario-activo.js";
import { redEfectivaDe, redHeredadaDe } from "./mapa-jerarquia.js";

// Tipos que hacen radioenlaces (su rol calculado tiene sentido). El resto
// (router, switch, cámara, NVR…) se conecta por cable o fibra.
export const TIPOS_RADIO = new Set(["ptp", "ap", "estacion"]);
// true = hace radio; false = no; null = no se sabe (sin tipo).
export function haceRadio(tipo){ return tipo ? TIPOS_RADIO.has(tipo) : null; }

export const ORDENES_SERVIDOR = [
  { id: "cerca", etiqueta: "Más cerca primero" },
  { id: "az", etiqueta: "Nombre (A–Z)" },
  { id: "za", etiqueta: "Nombre (Z–A)" },
  { id: "ubicacion", etiqueta: "Ubicación (A–Z)" },
  { id: "tipo", etiqueta: "Tipo (A–Z)" },
];
export const ORDEN_SERVIDOR_POR_DEFECTO = "cerca";
export function esOrdenServidor(v){ return ORDENES_SERVIDOR.some(o=>o.id === v); }

export const FACETAS_SERVIDOR = [
  { id: "ubicacion", etiqueta: "Ubicación" },
  { id: "tipo", etiqueta: "Tipo" },
  { id: "red", etiqueta: "Red" },
  { id: "origen", etiqueta: "Origen" },
];
export const SIN_VALOR = "sin";

const clave = t=>normalizarBusqueda(t).replace(/\s+/g, " ");
const COL = new Intl.Collator("es", { sensitivity: "base", numeric: true });
const tieneValor = v=>v !== null && v !== undefined && v !== "";

// Tipo de equipo de red que corresponde al tipo de un activo del inventario,
// por etiqueta o valor, sin tildes ni mayúsculas ("Router" → "router").
export function tipoEquipoDeActivo(tipoActivo, tiposEquipo = []){
  const k = clave(tipoActivo);
  if(!k) return null;
  const t = tiposEquipo.find(x=>x.activo !== false && (clave(x.etiqueta) === k || clave(x.valor) === k));
  return t ? t.valor : null;
}

// candidatos = equipos que pueden ser el servidor (candidatosServidor o
// candidatosRespaldo de mapa-jerarquia.js). Con conActivos, se suman los
// activos ubicados de un tipo de red que no están vinculados a ningún equipo.
// nombreNuevo({ tipo, ubicacion, activo }) = el nombre que tendría al
// registrarse (por defecto "{Tipo} en {ubicación}"); tagActivo(a) = "LKM-134".
export function opcionesServidor({
  candidatos = [], ubicacionId = null, ubicacionPorId = new Map(), tiposEquipo = [], redes = [],
  conActivos = false, activos = [], vigentePorActivo = new Map(), equipoPorActivo = new Map(),
  excluirActivos = [], nombreNuevo = null, tagActivo = ()=>null,
} = {}){
  const desde = ubicacionPorId.get(Number(ubicacionId)) || null;
  const tipoPorValor = new Map(tiposEquipo.map(t=>[t.valor, t]));
  const redPorId = new Map(redes.map(r=>[Number(r.id), r]));
  const lugar = u=>{
    const misma = !!(desde && u && desde.id === u.id);
    return {
      ubicacionId: u ? u.id : null,
      ubicacionNombre: u ? u.nombre : "—",
      misma,
      distanciaKm: misma ? 0 : (desde && u ? distanciaKm(desde, u) : null),
    };
  };
  const opciones = [];
  for(const e of candidatos){
    const t = e.tipo_equipo ? tipoPorValor.get(e.tipo_equipo) : null;
    // La red con la que se lo ve (con la 011, la heredada si no tiene propia).
    const rid = redEfectivaDe(e);
    const r = rid !== null ? redPorId.get(rid) : null;
    opciones.push({
      clave: String(e.id), origen: "equipo", id: e.id, activoId: tieneValor(e.activo_id) ? Number(e.activo_id) : null,
      nombre: e.nombre, tipo: e.tipo_equipo || null, tipoEtiqueta: t ? t.etiqueta : null,
      redId: r ? Number(r.id) : null, redNombre: r ? r.nombre : null, redColor: r ? r.color : null, redHeredada: !!r && redHeredadaDe(e) !== null,
      modelo: e.modelo || null, referencia: e.referencia || null, tag: null,
      ...lugar(ubicacionPorId.get(e.ubicacion_id)),
    });
  }
  if(conActivos){
    const excluidos = new Set(excluirActivos.filter(tieneValor).map(Number));
    for(const a of activos){
      if(excluidos.has(a.id) || equipoPorActivo.has(a.id)) continue;
      const vigente = vigentePorActivo.get(a.id);
      if(!vigente) continue;
      const tipo = tipoEquipoDeActivo(a.tipo, tiposEquipo);
      const u = tipo ? ubicacionPorId.get(vigente.ubicacion_id) : null;
      if(!u) continue;
      const t = tipoPorValor.get(tipo);
      opciones.push({
        clave: `a:${a.id}`, origen: "activo", id: null, activoId: a.id,
        nombre: nombreNuevo ? nombreNuevo({ tipo, ubicacion: u, activo: a }) : `${t.etiqueta} en ${u.nombre}`,
        tipo, tipoEtiqueta: t.etiqueta, redId: null, redNombre: null, redColor: null, redHeredada: false,
        modelo: [a.marca, a.modelo].filter(Boolean).join(" ") || null, referencia: null, tag: tagActivo(a) || null,
        ...lugar(u),
      });
    }
  }
  for(const o of opciones){
    o.buscable = clave([o.nombre, o.tipoEtiqueta, o.ubicacionNombre, o.redNombre, o.modelo, o.referencia, o.tag].filter(Boolean).join(" "));
  }
  return opciones;
}

export function valorFaceta(o, faceta){
  switch(faceta){
    case "ubicacion": return o.ubicacionId === null ? SIN_VALOR : String(o.ubicacionId);
    case "tipo": return o.tipo || SIN_VALOR;
    case "red": return o.redId === null ? SIN_VALOR : String(o.redId);
    case "origen": return o.origen;
    default: return null;
  }
}

function etiquetaFaceta(o, faceta){
  switch(faceta){
    case "ubicacion": return o.ubicacionId === null ? "Sin ubicación" : o.ubicacionNombre;
    case "tipo": return o.tipoEtiqueta || "Sin tipo";
    case "red": return o.redNombre || "Sin red";
    case "origen": return o.origen === "activo" ? "Activo del inventario (sin registrar)" : "Equipo de red";
    default: return "";
  }
}

// filtros = { ubicacion: Set|null, tipo: Set|null, red: Set|null, origen: Set|null }
// (null = todos). La búsqueda exige cada palabra, sin tildes ni mayúsculas.
function pasaTexto(o, palabras){ return palabras.every(p=>o.buscable.includes(p)); }
function pasaFacetas(o, filtros, excepto = null){
  for(const [f, sel] of Object.entries(filtros || {})){
    if(f === excepto || !sel) continue;
    if(!sel.has(valorFaceta(o, f))) return false;
  }
  return true;
}
const palabrasDe = texto=>{ const q = clave(texto); return q ? q.split(" ") : []; };

export function filtrarServidores(opciones, { texto = "", filtros = {} } = {}){
  const palabras = palabrasDe(texto);
  return opciones.filter(o=>pasaTexto(o, palabras) && pasaFacetas(o, filtros));
}

// Valores de cada faceta (de todas las opciones, para poder volver a
// marcarlos) con la cuenta de lo que quedaría al marcarlo: texto + las
// DEMÁS facetas, como en los filtros de la tabla de activos. Una faceta con
// un solo valor no sirve para filtrar y no se devuelve.
export function facetasServidor(opciones, { texto = "", filtros = {}, desdeUbicacionId = null } = {}){
  const palabras = palabrasDe(texto);
  const out = {};
  for(const { id: f } of FACETAS_SERVIDOR){
    const valores = new Map();
    for(const o of opciones){
      const v = valorFaceta(o, f);
      if(!valores.has(v)) valores.set(v, { valor: v, etiqueta: etiquetaFaceta(o, f), n: 0, misma: f === "ubicacion" && o.misma });
    }
    if(valores.size < 2) continue;
    for(const o of opciones) if(pasaTexto(o, palabras) && pasaFacetas(o, filtros, f)) valores.get(valorFaceta(o, f)).n++;
    const lista = [...valores.values()];
    if(f === "origen") lista.sort((a, b)=>(a.valor === "equipo" ? -1 : 1) - (b.valor === "equipo" ? -1 : 1));
    else lista.sort((a, b)=>(a.valor === SIN_VALOR) - (b.valor === SIN_VALOR)
      || (f === "ubicacion" ? (b.misma - a.misma) : 0)
      || COL.compare(a.etiqueta, b.etiqueta));
    out[f] = lista;
  }
  return out;
}

const porNombre = (a, b)=>COL.compare(a.nombre, b.nombre);
const COMPARADORES = {
  // La misma ubicación primero (por cable), después por distancia.
  cerca: (a, b)=>(b.misma - a.misma) || ((a.distanciaKm ?? Infinity) - (b.distanciaKm ?? Infinity)) || porNombre(a, b),
  az: porNombre,
  za: (a, b)=>-porNombre(a, b),
  ubicacion: (a, b)=>COL.compare(a.ubicacionNombre, b.ubicacionNombre) || porNombre(a, b),
  tipo: (a, b)=>((a.tipoEtiqueta === null) - (b.tipoEtiqueta === null)) || COL.compare(a.tipoEtiqueta || "", b.tipoEtiqueta || "") || porNombre(a, b),
};
export function ordenarServidores(opciones, orden = ORDEN_SERVIDOR_POR_DEFECTO){
  return [...opciones].sort(COMPARADORES[orden] || COMPARADORES[ORDEN_SERVIDOR_POR_DEFECTO]);
}

// Si el servidor está en otra ubicación y uno de los dos extremos no hace
// radio (un Router, un Switch, una Cámara…), el enlace tiene que ser por
// cable: "Automático" diría inalámbrico. null = dejar "Automático".
export function medioSugerido({ clienteTipo = null, servidorTipo = null, misma = false } = {}){
  if(misma) return null;
  if(haceRadio(servidorTipo) === false || haceRadio(clienteTipo) === false) return "cable";
  return null;
}

// Por qué se sugiere cable: "Router no hace radioenlaces".
export function motivoMedioSugerido({ clienteTipo = null, servidorTipo = null } = {}, tiposEquipo = []){
  const etiqueta = v=>(tiposEquipo.find(t=>t.valor === v) || {}).etiqueta || v;
  const quien = haceRadio(servidorTipo) === false ? servidorTipo : haceRadio(clienteTipo) === false ? clienteTipo : null;
  return quien ? `${etiqueta(quien)} no hace radioenlaces` : "";
}
