// Tooltip de una ubicación en el mapa (v15, pedido 3.10 de la persona,
// decidido el 1-oct). Al pasar el mouse (o con el foco del teclado) sobre la
// burbuja: el nombre y el tipo de la ubicación y, según lo elegido en «Al
// pasar el mouse», una tablita con cuántos equipos hay de cada tipo, cuántos
// de cada red, o las dos. Hasta el v18 las cantidades contaban TODO lo que
// hay en la ubicación; desde el v19 (3.20) cuentan lo que los filtros dejan a
// la vista, y una línea avisa cuántos esconden. Lógica pura (la vista pone los íconos y el HTML); se prueba en Node
// (tests/mapa-unit.mjs). v18 (3.17, pedido del 2-oct): en «Tipos y redes» ya
// no hay una segunda tabla por red: cada tipo lleva sus cantidades del color
// de su red, separadas por «/», y abajo una línea con el color de cada red.

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
// routerDe(e) (v17, 014): si el equipo lleva la marca «Router»; cada fila de
// tipos trae cuántos de ellos (routers).
// v18 (3.17): cada fila de tipos (y «Sin tipo», en sinTipoPorRed) trae también
// porRed: cuántos de ese tipo hay en cada red, en el orden de las redes de la
// ubicación (las desconocidas después) y «Sin red» (id null) al final. Es lo
// que pinta «Tipos y redes»: las cantidades del color de su red, con «/».
// v19 (3.20, decidido el 7-oct): las cantidades cuentan solo lo que los
// filtros dejan a la vista (visibleEquipo: «Tipos de equipo», «Redes»,
// «Equipos» y, con la simulación, sus estados); ocultos dice cuántos esconden.
// total sigue siendo todo lo que hay (para «Sin equipos de red») y visibles,
// lo que se cuenta.
export function resumenUbicacion({ equipos = [], visibleEquipo = ()=>true, tipos = [], redes = [], redDe = e=>e.red_id ?? null, activos = 0, routerDe = ()=>false } = {}){
  const porTipo = new Map(), porRed = new Map(), routers = new Map(), cruce = new Map();
  let sinTipo = 0, sinRed = 0, ocultos = 0, visibles = 0;
  for(const e of equipos){
    if(!visibleEquipo(e.id)){ ocultos++; continue; }
    visibles++;
    const tipo = e.tipo_equipo || null;
    if(tipo){
      porTipo.set(tipo, (porTipo.get(tipo) || 0) + 1);
      if(routerDe(e)) routers.set(tipo, (routers.get(tipo) || 0) + 1);
    } else sinTipo++;
    const r0 = redDe(e);
    const r = r0 === null || r0 === undefined ? null : r0;
    if(r === null) sinRed++; else porRed.set(r, (porRed.get(r) || 0) + 1);
    if(!cruce.has(tipo)) cruce.set(tipo, new Map());
    const c = cruce.get(tipo);
    c.set(r, (c.get(r) || 0) + 1);
  }
  const conocidas = new Set(redes.map(r=>r.id));
  const filasRedes = redes.filter(r=>porRed.has(r.id)).map(r=>({ id: r.id, nombre: r.nombre, color: r.color, n: porRed.get(r.id) }));
  for(const [id, n] of porRed) if(!conocidas.has(id)) filasRedes.push({ id, nombre: `Red ${id}`, color: null, n });
  const repartoDe = tipo=>{
    const c = cruce.get(tipo) || new Map();
    const lista = filasRedes.filter(x=>c.has(x.id)).map(x=>({ id: x.id, nombre: x.nombre, color: x.color, n: c.get(x.id) }));
    if(c.has(null)) lista.push({ id: null, nombre: "Sin red", color: null, n: c.get(null) });
    return lista;
  };
  const ordenTipos = [...tipos].sort((a, b)=>(a.orden ?? 0) - (b.orden ?? 0) || String(a.etiqueta).localeCompare(String(b.etiqueta), "es"));
  const conocidos = new Set(ordenTipos.map(t=>t.valor));
  const filasTipos = ordenTipos.filter(t=>porTipo.has(t.valor)).map(t=>({ valor: t.valor, etiqueta: t.etiqueta || t.valor, n: porTipo.get(t.valor), routers: routers.get(t.valor) || 0, porRed: repartoDe(t.valor) }));
  for(const [valor, n] of porTipo) if(!conocidos.has(valor)) filasTipos.push({ valor, etiqueta: valor, n, routers: routers.get(valor) || 0, porRed: repartoDe(valor) });
  return { total: equipos.length, visibles, tipos: filasTipos, sinTipo, sinTipoPorRed: sinTipo ? repartoDe(null) : [], redes: filasRedes, sinRed, ocultos, activos: Math.max(0, Number(activos) || 0) };
}

// v18 (3.17): si un color de red es tan claro que, como letra sobre el fondo
// blanco del tooltip, casi no se lee (contraste menor que 2:1, p. ej. un
// amarillo): ese número lleva un borde fino oscuro. #RRGGBB (o #RGB); otro
// valor, false.
export function colorMuyClaro(color){
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(String(color || "").trim());
  if(!m) return false;
  const h = m[1].length === 3 ? m[1].split("").map(x=>x + x).join("") : m[1];
  const lin = i=>{ const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
  return 1.05 / (L + 0.05) < 2;
}

// v18 (3.17): el reparto de un tipo por red, dicho con palabras (para los
// lectores de pantalla, que no ven los colores): «10 en CCTV, 1 en Red Oficina
// y 1 sin red».
export function textoPorRed(porRed = []){
  const partes = porRed.map(x=>x.id === null ? `${x.n} sin red` : `${x.n} en ${x.nombre}`);
  return partes.length > 1 ? `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}` : (partes[0] || "");
}

export function textoOcultos(n){ return n === 1 ? "1 oculto por los filtros" : `${n} ocultos por los filtros`; }
export function textoActivos(n){ return n === 1 ? "1 activo que no es equipo de red" : `${n} activos que no son equipos de red`; }
export function textoSinEquipos(){ return "Sin equipos de red"; }
