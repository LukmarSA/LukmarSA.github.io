// Filtros del mapa en desplegables (v12, pedidos 3.3 y 3.4 de la persona).
// Lógica pura, sin DOM: qué opciones lleva cada desplegable, cuántas están a
// la vista, «Todas» / «Ninguna» / «solo esta» y «Quitar filtros». La pinta
// ui/vista-mapa.js; se prueba en Node (tests/mapa-unit.mjs).
import { TIPO_EQUIPO_SIN, UBICACION_SIN_EQUIPOS, claveTipoEquipo } from "./mapa-jerarquia.js";
import { soloEstaOcultos } from "./solo-esta.js";

// Las líneas que se ven al empezar (Respaldos, apagado).
export const LINEAS_POR_DEFECTO = Object.freeze({ backbone: true, p2mp: true, cable: true, respaldos: false });

// Lo que deja «Quitar filtros». «Colorear líneas por red» no es un filtro y
// queda como estaba; la simulación tampoco se toca.
export function filtrosLimpios(f = {}){
  return {
    ...f,
    tiposOcultos: [], verArchivadas: false, lineas: { ...LINEAS_POR_DEFECTO },
    rolesOcultos: [], redesOcultas: [], tiposEquipoOcultos: [], estadosOcultos: [],
  };
}

// Cuántos filtros cambian lo que se ve (para el contador y «Quitar filtros»).
export function cuantosFiltros(f = {}, { sim = false } = {}){
  const l = f.lineas || LINEAS_POR_DEFECTO;
  return (f.tiposOcultos || []).length + (f.rolesOcultos || []).length + (f.redesOcultas || []).length + (f.tiposEquipoOcultos || []).length
    + (sim ? (f.estadosOcultos || []).length : 0) + (f.verArchivadas ? 1 : 0)
    + (l.backbone === false ? 1 : 0) + (l.p2mp === false ? 1 : 0) + (l.cable === false ? 1 : 0) + (l.respaldos ? 1 : 0);
}

// «3/4»: cuántas opciones de un desplegable están a la vista.
export function resumenDesplegable(valores, ocultos = []){
  const fuera = new Set(ocultos);
  const total = valores.length;
  const visibles = valores.filter(v=>!fuera.has(v)).length;
  return { visibles, total, texto: `${visibles}/${total}`, filtrado: visibles < total };
}

// Opciones de «Tipos de equipo» (3.4): los tipos activos o en uso, en su
// orden, con cuántos equipos tiene cada uno; después «Sin tipo», si hay
// equipos sin tipo, y «Sin equipos», si hay ubicaciones vacías (`vacias`).
export function opcionesTiposEquipo(tipos = [], equipos = [], vacias = 0){
  const n = new Map();
  for(const e of equipos){ const k = claveTipoEquipo(e); n.set(k, (n.get(k) || 0) + 1); }
  const usados = new Set(equipos.map(e=>e.tipo_equipo).filter(Boolean));
  const conocidos = new Set(tipos.map(t=>t.valor));
  const lista = [...tipos]
    .filter(t=>t.activo !== false || usados.has(t.valor))
    .sort((a, b)=>(a.orden ?? 0) - (b.orden ?? 0) || String(a.etiqueta).localeCompare(String(b.etiqueta), "es"))
    .map(t=>({ valor: t.valor, etiqueta: t.etiqueta || t.valor, n: n.get(t.valor) || 0 }));
  // Un tipo que usa algún equipo pero no está en el catálogo (no debería pasar: hay FK).
  for(const v of usados) if(!conocidos.has(v)) lista.push({ valor: v, etiqueta: v, n: n.get(v) || 0 });
  if(n.get(TIPO_EQUIPO_SIN)) lista.push({ valor: TIPO_EQUIPO_SIN, etiqueta: "Sin tipo", n: n.get(TIPO_EQUIPO_SIN), especial: true });
  if(vacias) lista.push({ valor: UBICACION_SIN_EQUIPOS, etiqueta: "Sin equipos", n: vacias, especial: true, ubicaciones: true });
  return lista;
}

// v19 (3.21, pedido y decidido el 7-oct): el único tipo de equipo que
// «Tipos de equipo» deja a la vista (un valor o TIPO_EQUIPO_SIN), o null si se
// ven varios, ninguno, o si no hay filtro (un solo tipo con equipos en toda la
// red no cuenta). Solo cuentan las opciones con equipos; «Sin equipos» es de
// ubicaciones, no un tipo. Con él, las bolitas llevan el ícono de ese tipo.
export function tipoEquipoUnico(opciones = [], ocultos = []){
  const fuera = new Set(ocultos || []);
  const conEquipos = (opciones || []).filter(o=>o.valor !== UBICACION_SIN_EQUIPOS && (o.n || 0) > 0);
  const visibles = conEquipos.filter(o=>!fuera.has(o.valor));
  return visibles.length === 1 && conEquipos.length > 1 ? visibles[0].valor : null;
}

// «Todas», «Ninguna» y «solo esta» sobre una lista de ocultos.
export function ocultosTodas(){ return []; }
export function ocultosNinguna(valores){ return [...valores]; }
export function ocultosSoloEsta(valores, ocultos, valor){ return soloEstaOcultos(valores, ocultos, valor); }

// Lo mismo para las líneas, que se guardan como { id: visible }.
export function lineasConVisibles(ids, visibles){
  const v = new Set(visibles);
  return Object.fromEntries(ids.map(id=>[id, v.has(id)]));
}
