// Líneas agrupadas del mapa (v14, pedido 3.8 de la persona, decidido el
// 1-oct). Cuando varios enlaces unen las mismas dos ubicaciones y son de la
// misma clase (inalámbricos, por cable o por fibra), antes se dibujaban uno
// encima del otro y solo se veía el último. Ahora:
//
// - van en una sola línea, también sin colorear por red, con un tooltip que
//   los lista; el clic elige el primero;
// - al colorear por red, esa línea lleva una franja por cada red, lado a lado
//   (como los hilos de un cable) y en el orden de las redes; el clic en una
//   franja elige el primer enlace de esa red. Al apagar una red, sus enlaces
//   salen del plan y con ellos su franja;
// - si entre las mismas dos ubicaciones hay líneas de clases distintas (radio
//   y cable, por ejemplo), van una al lado de la otra;
// - el camino resaltado, la simulación (cortado, sin conectividad) y los
//   respaldos siguen enlace por enlace, como antes.
//
// Lógica pura, sin Leaflet: la vista (ui/vista-mapa.js) solo traduce los
// trazos a líneas. Se prueba en Node (tests/mapa-unit.mjs).
import { fmtDistancia } from "./geo.js";

// Los estilos que se juntan: los de una línea normal (no los del camino, la
// simulación ni los respaldos).
export const ESTILOS_AGRUPABLES = new Set(["backbone", "p2mp", "cable", "fibra"]);

// Clase de un grupo: los radioenlaces (backbone y P2MP) van juntos.
export function claseDeGrupo(estilo){ return estilo === "backbone" || estilo === "p2mp" ? "radio" : estilo; }
const ORDEN_CLASES = ["radio", "cable", "fibra"];

// El par de ubicaciones, sin importar el sentido.
export function clavePar(a, b){
  const x = Number(a), y = Number(b);
  return x <= y ? `${x}-${y}` : `${y}-${x}`;
}

// Las franjas: cada una un poco más delgada que la línea normal; el haz
// entero no pasa de 3 veces la línea normal (con muchas redes, se afinan).
export const FRANJAS = Object.freeze({ factor: 0.6, maximoHaz: 3, minimo: 0.75, separacionHaces: 2 });
export function anchoFranja(anchoLinea, n){
  if(!(n > 1)) return anchoLinea;
  const ancho = Math.min(anchoLinea * FRANJAS.factor, (anchoLinea * FRANJAS.maximoHaz) / n);
  return Math.round(Math.max(ancho, FRANJAS.minimo) * 100) / 100; // 3 × 0,6 da 1,7999…: se redondea a centésimas
}

// Centros de varias franjas (o haces) de los anchos dados, una al lado de la
// otra y centradas en el eje de la línea (en píxeles).
export function desplazamientos(anchos, separacion = 0){
  const lista = [...(anchos || [])];
  const total = lista.reduce((s, a)=>s + a, 0) + separacion * Math.max(0, lista.length - 1);
  let x = -total / 2;
  return lista.map(a=>{ const centro = x + a / 2; x += a + separacion; return redondear(centro); });
}
const redondear = v=>Math.round(v * 1000) / 1000 || 0;

// Corre un tramo `d` píxeles hacia su costado (a la izquierda del sentido del
// tramo, en coordenadas de pantalla). Para una línea de más puntos, cada punto
// se corre según el promedio de los tramos que lo tocan.
export function desplazarPuntos(puntos, d){
  const p = [...(puntos || [])];
  if(!d || p.length < 2) return p.map(q=>({ x: q.x, y: q.y }));
  const normal = (a, b)=>{
    const dx = b.x - a.x, dy = b.y - a.y, largo = Math.hypot(dx, dy);
    return largo ? { x: -dy / largo, y: dx / largo } : { x: 0, y: 0 };
  };
  return p.map((q, i)=>{
    const n1 = i > 0 ? normal(p[i - 1], q) : null;
    const n2 = i < p.length - 1 ? normal(q, p[i + 1]) : null;
    let n = n1 && n2 ? { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 } : (n1 || n2);
    const largo = Math.hypot(n.x, n.y);
    n = largo ? { x: n.x / largo, y: n.y / largo } : { x: 0, y: 0 };
    return { x: q.x + n.x * d, y: q.y + n.y * d };
  });
}

// Junta las líneas del plan (nucleo/mapa-jerarquia.js, planDeLineas).
//   redDe(d)     la red de la línea (id) o null («sin red»)
//   ordenRedes   los ids de las redes en su orden (las franjas van así)
//   nombreDe(id) el nombre de un equipo (dentro de cada red, por nombre)
// Devuelve { grupos, sueltas }: los grupos de líneas normales (uno por par de
// ubicaciones y clase, aunque tenga un solo enlace) y las demás líneas, que se
// dibujan una por una.
export function agruparLineas(plan, { redDe = ()=>null, ordenRedes = [], nombreDe = id=>String(id) } = {}){
  const posicion = new Map(ordenRedes.map((id, i)=>[id, i]));
  const grupos = new Map();
  const sueltas = [];
  for(const d of plan || []){
    const agrupable = d.tipo === "principal" && ESTILOS_AGRUPABLES.has(d.estilo) && d.desdeId !== undefined && d.hastaId !== undefined;
    if(!agrupable){ sueltas.push(d); continue; }
    const clase = claseDeGrupo(d.estilo);
    const par = clavePar(d.desdeId, d.hastaId);
    const clave = `${par}|${clase}`;
    if(!grupos.has(clave)){
      // El sentido del grupo: de la ubicación de id menor a la otra.
      const alReves = Number(d.desdeId) > Number(d.hastaId);
      grupos.set(clave, {
        clave, par, clase, estilo: d.estilo, enlaces: [],
        desdeId: Number(alReves ? d.hastaId : d.desdeId), hastaId: Number(alReves ? d.desdeId : d.hastaId),
        desde: alReves ? d.hasta : d.desde, hasta: alReves ? d.desde : d.hasta,
        distanciaKm: d.distanciaKm,
      });
    }
    const g = grupos.get(clave);
    g.enlaces.push(d);
    if(d.estilo === "backbone") g.estilo = "backbone"; // un backbone manda sobre un P2MP en el mismo tramo
  }
  const ordenRed = r=>(r === null || r === undefined) ? Infinity : (posicion.has(r) ? posicion.get(r) : ordenRedes.length);
  const porNombre = (a, b)=>String(nombreDe(a.clienteId) ?? "").localeCompare(String(nombreDe(b.clienteId) ?? ""), "es") || (a.clienteId - b.clienteId);
  const lista = [...grupos.values()];
  for(const g of lista){
    const porRed = new Map();
    for(const d of g.enlaces){
      const r = redDe(d);
      const k = r === undefined ? null : r;
      if(!porRed.has(k)) porRed.set(k, []);
      porRed.get(k).push(d);
    }
    g.redes = [...porRed.entries()]
      .sort(([a], [b])=>(ordenRed(a) - ordenRed(b)) || String(a).localeCompare(String(b)))
      .map(([red, enlaces])=>{ enlaces.sort(porNombre); return { red, enlaces, atenuada: enlaces.every(d=>d.atenuada) }; });
    g.enlaces = g.redes.flatMap(r=>r.enlaces);
    g.atenuada = g.enlaces.every(d=>d.atenuada);
  }
  return { grupos: lista, sueltas };
}

// Los trazos a dibujar. Por cada par de ubicaciones, sus grupos van lado a
// lado (radio, cable, fibra); un grupo coloreado por red con más de una red
// lleva una franja por red. Cada trazo dice qué enlaces tiene, cuánto se
// corre del eje (px) y su ancho; el halo va una vez por grupo.
//   colorPorRed      ¿se colorea por red?
//   anchoDe(estilo)  el ancho de la línea normal de ese estilo (con el grosor elegido)
export function planDeTrazos(grupos, { colorPorRed = false, anchoDe = ()=>3 } = {}){
  const porPar = new Map();
  for(const g of grupos || []){
    if(!porPar.has(g.par)) porPar.set(g.par, []);
    porPar.get(g.par).push(g);
  }
  const trazos = [];
  for(const delPar of porPar.values()){
    delPar.sort((a, b)=>ORDEN_CLASES.indexOf(a.clase) - ORDEN_CLASES.indexOf(b.clase));
    const haces = delPar.map(g=>{
      const conFranjas = !!colorPorRed && g.redes.length > 1;
      const base = anchoDe(g.estilo);
      const ancho = conFranjas ? anchoFranja(base, g.redes.length) : base;
      const n = conFranjas ? g.redes.length : 1;
      return { g, conFranjas, ancho, anchoHaz: ancho * n };
    });
    const centros = desplazamientos(haces.map(h=>h.anchoHaz), haces.length > 1 ? FRANJAS.separacionHaces : 0);
    haces.forEach((h, i)=>{
      const { g } = h;
      if(!h.conFranjas){
        trazos.push({ grupo: g, red: colorPorRed && g.redes.length === 1 ? g.redes[0].red : undefined, enlaces: g.enlaces, franja: false,
          desplazamiento: centros[i], ancho: h.ancho, anchoHaz: h.anchoHaz, desplazamientoHaz: centros[i], atenuada: g.atenuada, halo: true });
        return;
      }
      const propios = desplazamientos(g.redes.map(()=>h.ancho));
      g.redes.forEach((r, j)=>{
        trazos.push({ grupo: g, red: r.red, enlaces: r.enlaces, franja: true,
          desplazamiento: redondear(centros[i] + propios[j]), ancho: h.ancho, anchoHaz: h.anchoHaz, desplazamientoHaz: centros[i], atenuada: r.atenuada, halo: j === 0 });
      });
    });
  }
  return trazos;
}

// ---------------------------------------------------------------- textos
const ENLACES = {
  radio: n=>n === 1 ? "enlace inalámbrico" : "enlaces inalámbricos",
  cable: n=>n === 1 ? "enlace por cable" : "enlaces por cable",
  fibra: n=>n === 1 ? "enlace por fibra óptica" : "enlaces por fibra óptica",
};
export function textoCantidadEnlaces(clase, n){ return `${n} ${(ENLACES[clase] || ENLACES.radio)(n)}`; }

// «9 de CCTV, 1 de Red Oficina, 1 sin red».
export function resumenRedes(grupo, nombreRed = id=>String(id)){
  return grupo.redes.map(r=>r.red === null || r.red === undefined ? `${r.enlaces.length} sin red` : `${r.enlaces.length} de ${nombreRed(r.red)}`).join(", ");
}

const MAXIMO_LISTADOS = 6;

// Las líneas del tooltip de un trazo con más de un enlace (el de un solo
// enlace sigue siendo el de siempre, textoLinea en la vista).
//   nombreEquipo(id), nombreUbicacion(id), nombreRed(id), hayRedes (¿mostrar
//   cuántos van por cada red?)
export function textoTrazo(trazo, { nombreEquipo = id=>String(id), nombreUbicacion = id=>String(id), nombreRed = id=>String(id), hayRedes = false } = {}){
  const g = trazo.grupo;
  const total = g.enlaces.length;
  const propios = trazo.enlaces;
  const lineas = [];
  const dist = Number.isFinite(g.distanciaKm) ? fmtDistancia(g.distanciaKm) : "";
  const entre = `entre ${nombreUbicacion(g.desdeId)} y ${nombreUbicacion(g.hastaId)}${dist ? ` · ${dist}` : ""}`;
  if(trazo.franja){
    const red = trazo.red === null || trazo.red === undefined ? "Sin red" : nombreRed(trazo.red);
    lineas.push(`${red}: ${propios.length} de ${textoCantidadEnlaces(g.clase, total)}`);
    lineas.push(entre);
    lineas.push(`En total: ${resumenRedes(g, nombreRed)}`);
  } else {
    lineas.push(`${textoCantidadEnlaces(g.clase, total)} ${entre}`);
    if(hayRedes) lineas.push(resumenRedes(g, nombreRed));
  }
  const listados = propios.slice(0, MAXIMO_LISTADOS).map(d=>`${nombreEquipo(d.clienteId)} ← ${nombreEquipo(d.servidorId)}`);
  if(propios.length > MAXIMO_LISTADOS) listados.push(`y ${propios.length - MAXIMO_LISTADOS} más`);
  lineas.push(...listados);
  if(propios[0]) lineas.push(`Clic: elige «${nombreEquipo(propios[0].clienteId)}»`);
  return lineas;
}
