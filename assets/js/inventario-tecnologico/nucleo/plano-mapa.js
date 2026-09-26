// Capa "Plano" del mapa (migración 006): la imagen del plano general de la
// camaronera puesta sobre el mapa por tres esquinas de la imagen
//   no = arriba-izquierda, ne = arriba-derecha, so = abajo-izquierda
// (la cuarta, se, sale de las otras tres). Con tres puntos alcanza para
// cualquier posición, tamaño y giro. Cada esquina es [lat, lng].
//
// Lógica pura, como mapa-logica.js: no toca Leaflet, el DOM ni Supabase, así
// se prueba en Node (tests/mapa-unit.mjs). Las operaciones de la herramienta
// "Ajustar plano" (mover, agrandar o achicar sin deformar, girar) trabajan en
// metros sobre una proyección local alrededor del centro del plano: a la
// escala de una camaronera (unos 5 km) el error es de milímetros.

// Plano que trae la app. Si la migración 006 no está corrida, o su tabla no
// se puede leer, la capa usa esto. Calce: el eje de la vía Taura–Jaguito del
// plano sobre la carretera de la imagen satelital (19 puntos medidos a zoom
// 17, error medio de unos 5 m); los sectores L, K y M quedaron sobre sus
// piscinas.
export const PLANO_POR_DEFECTO = Object.freeze({
  id: null,
  nombre: "Camaronera Lukmar — plano general (lotes actualizados, agosto 2026)",
  imagen: "assets/img/mapa/plano-lukmar-2026-08.webp",
  ancho_px: 3198,
  alto_px: 4018,
  esquinas: Object.freeze({
    no: Object.freeze([-2.3111634, -79.738091]),
    ne: Object.freeze([-2.3110121, -79.700257]),
    so: Object.freeze([-2.3589797, -79.7379023]),
  }),
  fuente: "Plano general: Consultora ZH (agosto 2026)",
});

export const ESQUINAS = ["no", "ne", "so"];
export const OPUESTA = Object.freeze({ no: "se", ne: "so", so: "ne", se: "no" });
// Límites del factor de un solo arrastre de esquina: evita que el plano se
// dé vuelta o colapse si el puntero pasa por encima de la esquina opuesta.
export const FACTOR_MINIMO = 0.05;
export const FACTOR_MAXIMO = 20;

const esNumero = v=>typeof v === "number" && Number.isFinite(v);
const redondear = v=>Math.round(v * 1e7) / 1e7; // ≈ 1 cm

function puntoValido(p){
  return Array.isArray(p) && p.length === 2 && esNumero(p[0]) && esNumero(p[1]) && p[0] >= -90 && p[0] <= 90 && p[1] >= -180 && p[1] <= 180;
}

// Las mismas reglas que el CHECK de la migración 006: tres esquinas con
// [lat, lng] en rango y que no estén alineadas (el plano tendría ancho o alto 0).
export function esquinasValidas(e){
  if(!e || typeof e !== "object") return false;
  if(!ESQUINAS.every(k=>puntoValido(e[k]))) return false;
  const cruz = (e.ne[1] - e.no[1]) * (e.so[0] - e.no[0]) - (e.ne[0] - e.no[0]) * (e.so[1] - e.no[1]);
  return Math.abs(cruz) > 1e-12;
}

export function copiarEsquinas(e){
  return { no: [e.no[0], e.no[1]], ne: [e.ne[0], e.ne[1]], so: [e.so[0], e.so[1]] };
}

export function cuartaEsquina(e){
  return [e.ne[0] + e.so[0] - e.no[0], e.ne[1] + e.so[1] - e.no[1]];
}

export function esquinasCompletas(e){
  return { no: e.no, ne: e.ne, so: e.so, se: cuartaEsquina(e) };
}

export function centroEsquinas(e){
  const se = cuartaEsquina(e);
  return [(e.no[0] + se[0]) / 2, (e.no[1] + se[1]) / 2];
}

// Metros por grado en el elipsoide WGS 84, a la latitud dada.
export function metrosPorGrado(lat){
  const f = lat * Math.PI / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * f) + 1.175 * Math.cos(4 * f),
    lng: 111412.84 * Math.cos(f) - 93.5 * Math.cos(3 * f),
  };
}

// [lat, lng] → [x, y] en metros desde el origen (x = este, y = norte), y la inversa.
export function aMetros(origen, p){
  const m = metrosPorGrado(origen[0]);
  return [(p[1] - origen[1]) * m.lng, (p[0] - origen[0]) * m.lat];
}
export function desdeMetros(origen, xy){
  const m = metrosPorGrado(origen[0]);
  return [origen[0] + xy[1] / m.lat, origen[1] + xy[0] / m.lng];
}

function transformar(e, ancla, fn){
  const out = {};
  for(const k of ESQUINAS){
    const [x, y] = aMetros(ancla, e[k]);
    const [x2, y2] = fn(x, y);
    const p = desdeMetros(ancla, [x2, y2]);
    out[k] = [redondear(p[0]), redondear(p[1])];
  }
  return out;
}

// Mover el plano entero: dx metros al este, dy metros al norte.
export function moverEsquinas(e, dx, dy){
  return transformar(e, centroEsquinas(e), (x, y)=>[x + dx, y + dy]);
}

// Mover por una diferencia de coordenadas (lo que da un arrastre con el mouse).
export function desplazarEsquinas(e, dLat, dLng){
  const out = {};
  for(const k of ESQUINAS) out[k] = [redondear(e[k][0] + dLat), redondear(e[k][1] + dLng)];
  return out;
}

// Agrandar (factor > 1) o achicar alrededor de un punto que queda fijo. Es
// una escala uniforme: el plano no se deforma.
export function escalarEsquinas(e, factor, ancla = centroEsquinas(e)){
  if(!(factor > 0)) throw new Error("El factor de escala tiene que ser mayor que 0.");
  return transformar(e, ancla, (x, y)=>[x * factor, y * factor]);
}

// Girar (grados, positivo = antihorario) alrededor de un punto que queda fijo.
export function girarEsquinas(e, grados, ancla = centroEsquinas(e)){
  const a = grados * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return transformar(e, ancla, (x, y)=>[x * c - y * s, x * s + y * c]);
}

// Arrastre de una esquina: la opuesta queda fija y el factor es la proyección
// de la nueva posición sobre la diagonal, así el plano crece o se achica sin
// deformarse aunque el puntero no vaya exactamente por la diagonal.
export function factorDesdeArrastre(e, esquina, nuevaPos){
  const c = esquinasCompletas(e);
  const ancla = c[OPUESTA[esquina]];
  const v0 = aMetros(ancla, c[esquina]);
  const v1 = aMetros(ancla, nuevaPos);
  const n0 = v0[0] * v0[0] + v0[1] * v0[1];
  if(!(n0 > 0)) return 1;
  const f = (v0[0] * v1[0] + v0[1] * v1[1]) / n0;
  return Math.min(FACTOR_MAXIMO, Math.max(FACTOR_MINIMO, f));
}

export function escalarDesdeEsquina(e, esquina, nuevaPos){
  const ancla = esquinasCompletas(e)[OPUESTA[esquina]];
  return escalarEsquinas(e, factorDesdeArrastre(e, esquina, nuevaPos), ancla);
}

const distancia = (a, b)=>{ const [x, y] = aMetros(a, b); return Math.hypot(x, y); };

// Ancho y alto del plano en el terreno, en metros.
export function tamanoEnMetros(e){
  return { ancho: distancia(e.no, e.ne), alto: distancia(e.no, e.so) };
}

// Giro del borde superior respecto del este, en grados (positivo = antihorario).
export function giroGrados(e){
  const [x, y] = aMetros(e.no, e.ne);
  return Math.atan2(y, x) * 180 / Math.PI;
}

// Cuánto se movió la esquina que más se movió, en metros (para saber si hay
// cambios sin guardar y para las pruebas).
export function distanciaMaxima(a, b){
  return Math.max(...ESQUINAS.map(k=>distancia(a[k], b[k])), distancia(cuartaEsquina(a), cuartaEsquina(b)));
}

// Matriz CSS (matrix(a, b, c, d, e, f)) que lleva la imagen de ancho × alto
// píxeles a los puntos de pantalla p0 (no), p1 (ne) y p2 (so).
export function matrizCss(p0, p1, p2, ancho, alto){
  return [
    (p1.x - p0.x) / ancho, (p1.y - p0.y) / ancho,
    (p2.x - p0.x) / alto, (p2.y - p0.y) / alto,
    p0.x, p0.y,
  ];
}

// Fila de planos_mapa → plano usable. Lo que falte o esté mal se completa
// con el plano que trae la app; esquinas_originales es el "calce original"
// al que se puede volver desde "Ajustar plano".
export function normalizarPlano(fila){
  const base = PLANO_POR_DEFECTO;
  if(!fila) return { ...base, esquinas: copiarEsquinas(base.esquinas), esquinasOriginales: copiarEsquinas(base.esquinas), guardado: false };
  const esquinas = esquinasValidas(fila.esquinas) ? copiarEsquinas(fila.esquinas) : copiarEsquinas(base.esquinas);
  const originales = esquinasValidas(fila.esquinas_originales) ? copiarEsquinas(fila.esquinas_originales) : copiarEsquinas(base.esquinas);
  const entero = v=>Number.isInteger(v) && v > 0;
  return {
    id: fila.id ?? null,
    nombre: fila.nombre || base.nombre,
    imagen: fila.imagen || base.imagen,
    ancho_px: entero(fila.ancho_px) ? fila.ancho_px : base.ancho_px,
    alto_px: entero(fila.alto_px) ? fila.alto_px : base.alto_px,
    esquinas,
    esquinasOriginales: originales,
    actualizado_en: fila.actualizado_en || null,
    fuente: base.fuente,
    guardado: fila.id !== undefined && fila.id !== null,
  };
}

// Caja [[latMin, lngMin], [latMax, lngMax]] que contiene el plano (para encuadrarlo).
export function cajaEsquinas(e){
  const c = esquinasCompletas(e);
  const lats = Object.values(c).map(p=>p[0]), lngs = Object.values(c).map(p=>p[1]);
  return [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]];
}
