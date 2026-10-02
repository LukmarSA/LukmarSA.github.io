// Tooltip de una ubicación en el mapa (v15, pedido 3.10 de la persona,
// decidido el 1-oct). Al pasar el mouse (o con el foco del teclado) sobre la
// burbuja: el nombre y el tipo de la ubicación y, según lo elegido en «Al
// pasar el mouse», una tablita con cuántos equipos hay de cada tipo, cuántos
// de cada red, o las dos. Las cantidades cuentan TODO lo que hay en la
// ubicación (sirve de inventario rápido) y avisan cuántos ocultan los
// filtros. Lógica pura (la vista pone los íconos y el HTML); se prueba en Node
// (tests/mapa-unit.mjs).

export const MODOS_TOOLTIP = Object.freeze([
  { id: "nombre", etiqueta: "Solo el nombre" },
  { id: "tipos", etiqueta: "Tipos de equipo" },
  { id: "redes", etiqueta: "Redes" },
  { id: "ambos", etiqueta: "Tipos y redes" },
]);
export const MODO_TOOLTIP_POR_DEFECTO = "tipos";
export function normalizarModoTooltip(v){ return MODOS_TOOLTIP.some(m=>m.id === v) ? v : MODO_TOOLTIP_POR_DEFECTO; }
export const conTipos = modo=>modo === "tipos" || modo === "ambos";
export const conRedes = modo=>modo === "redes" || modo === "ambos";

// equipos: los de la ubicación. visibleEquipo(id): si los filtros lo dejan a
// la vista. tipos: tipos_equipo_red (en su orden). redes: las redes (en su
// orden). redDe(e): la red que cuenta (la efectiva, con la herencia de la
// 011). activos: cuántos activos hay ahí que no son equipos de red.
export function resumenUbicacion({ equipos = [], visibleEquipo = ()=>true, tipos = [], redes = [], redDe = e=>e.red_id ?? null, activos = 0 } = {}){
  const porTipo = new Map(), porRed = new Map();
  let sinTipo = 0, sinRed = 0, ocultos = 0;
  for(const e of equipos){
    if(e.tipo_equipo) porTipo.set(e.tipo_equipo, (porTipo.get(e.tipo_equipo) || 0) + 1); else sinTipo++;
    const r = redDe(e);
    if(r === null || r === undefined) sinRed++; else porRed.set(r, (porRed.get(r) || 0) + 1);
    if(!visibleEquipo(e.id)) ocultos++;
  }
  const ordenTipos = [...tipos].sort((a, b)=>(a.orden ?? 0) - (b.orden ?? 0) || String(a.etiqueta).localeCompare(String(b.etiqueta), "es"));
  const conocidos = new Set(ordenTipos.map(t=>t.valor));
  const filasTipos = ordenTipos.filter(t=>porTipo.has(t.valor)).map(t=>({ valor: t.valor, etiqueta: t.etiqueta || t.valor, n: porTipo.get(t.valor) }));
  for(const [valor, n] of porTipo) if(!conocidos.has(valor)) filasTipos.push({ valor, etiqueta: valor, n });
  const conocidas = new Set(redes.map(r=>r.id));
  const filasRedes = redes.filter(r=>porRed.has(r.id)).map(r=>({ id: r.id, nombre: r.nombre, color: r.color, n: porRed.get(r.id) }));
  for(const [id, n] of porRed) if(!conocidas.has(id)) filasRedes.push({ id, nombre: `Red ${id}`, color: null, n });
  return { total: equipos.length, tipos: filasTipos, sinTipo, redes: filasRedes, sinRed, ocultos, activos: Math.max(0, Number(activos) || 0) };
}

export function textoOcultos(n){ return n === 1 ? "1 oculto por los filtros" : `${n} ocultos por los filtros`; }
export function textoActivos(n){ return n === 1 ? "1 activo que no es equipo de red" : `${n} activos que no son equipos de red`; }
export function textoSinEquipos(){ return "Sin equipos de red"; }
