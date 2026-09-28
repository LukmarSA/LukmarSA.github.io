// Piscinas de la camaronera (migración 009): lógica pura de la capa
// "Piscinas" y de su editor de vértices. Cada piscina es un polígono
// puntos = [[lat, lng], …] (sin repetir el primero al final).
//
// Como mapa-jerarquia.js: no toca el DOM ni Supabase (se prueba en Node).

const R_TIERRA = 6371008.8; // m (radio medio)
const RAD = Math.PI / 180;

const esNumero = v=>typeof v === "number" && Number.isFinite(v);

// Mismas reglas que el CHECK piscinas_geom_valida (f_piscinas_puntos_validos).
export function validarPuntosPiscina(puntos){
  return Array.isArray(puntos) && puntos.length >= 3 && puntos.length <= 2000
    && puntos.every(p=>Array.isArray(p) && p.length === 2 && esNumero(p[0]) && esNumero(p[1]) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
}

// Proyección local (equirectangular alrededor del centro): para piscinas de
// cientos de metros el error es despreciable.
function proyectar(puntos){
  const lat0 = puntos.reduce((s, p)=>s + p[0], 0) / puntos.length;
  const k = Math.cos(lat0 * RAD);
  return { xy: puntos.map(([lat, lng])=>[R_TIERRA * lng * RAD * k, R_TIERRA * lat * RAD]), k };
}

// Área del polígono en m² (fórmula del cordón sobre la proyección local).
export function areaM2(puntos){
  if(!Array.isArray(puntos) || puntos.length < 3) return 0;
  const { xy } = proyectar(puntos);
  let s = 0;
  for(let i = 0; i < xy.length; i++){
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2;
}

export function areaHectareas(puntos){ return areaM2(puntos) / 1e4; }

// Centro de masa del polígono (para rotular). Si el área es ~0, el promedio.
export function centroide(puntos){
  if(!Array.isArray(puntos) || !puntos.length) return null;
  const { xy, k } = proyectar(puntos);
  let a = 0, cx = 0, cy = 0;
  for(let i = 0; i < xy.length; i++){
    const [x1, y1] = xy[i], [x2, y2] = xy[(i + 1) % xy.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if(Math.abs(a) < 1e-9){
    return [puntos.reduce((s, p)=>s + p[0], 0) / puntos.length, puntos.reduce((s, p)=>s + p[1], 0) / puntos.length];
  }
  cx /= 3 * a; cy /= 3 * a;
  return [cy / (R_TIERRA * RAD), cx / (R_TIERRA * RAD * k)];
}

// Caja [[latMin, lngMin], [latMax, lngMax]] de varias piscinas (null si no hay puntos).
export function cajaPiscinas(piscinas){
  let s = Infinity, o = Infinity, n = -Infinity, e = -Infinity;
  for(const p of piscinas || []) for(const [lat, lng] of p.puntos || []){
    s = Math.min(s, lat); n = Math.max(n, lat); o = Math.min(o, lng); e = Math.max(e, lng);
  }
  return Number.isFinite(s) ? [[s, o], [n, e]] : null;
}

// --- editor de vértices ------------------------------------------------------
const redondear = v=>Math.round(v * 1e7) / 1e7;
export function redondearPunto([lat, lng]){ return [redondear(lat), redondear(lng)]; }

export function puntoMedio(a, b){ return redondearPunto([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); }

// Inserta un vértice DESPUÉS del índice i (en el lado i → i+1).
export function insertarVertice(puntos, i, punto){
  const out = puntos.map(p=>[...p]);
  out.splice(i + 1, 0, redondearPunto(punto));
  return out;
}

// Quita el vértice i; un polígono no baja de 3 puntos (devuelve null).
export function quitarVertice(puntos, i){
  if(puntos.length <= 3 || i < 0 || i >= puntos.length) return null;
  return puntos.filter((_, j)=>j !== i).map(p=>[...p]);
}

export function moverVertice(puntos, i, punto){
  return puntos.map((p, j)=>j === i ? redondearPunto(punto) : [...p]);
}

// Desplazar un punto unos metros (flechas del teclado en el editor).
export function desplazarMetros([lat, lng], norteM, esteM){
  return redondearPunto([lat + norteM / (R_TIERRA * RAD), lng + esteM / (R_TIERRA * RAD * Math.cos(lat * RAD))]);
}

// Cuadrado de `hectareas` centrado en un punto (piscina nueva, para editar después).
export function cuadradoAlrededor([lat, lng], hectareas = 1){
  const lado = Math.sqrt(Math.max(hectareas, 0.01) * 1e4) / 2;
  return [
    desplazarMetros([lat, lng], lado, -lado),
    desplazarMetros([lat, lng], lado, lado),
    desplazarMetros([lat, lng], -lado, lado),
    desplazarMetros([lat, lng], -lado, -lado),
  ];
}

// --- textos y validación del formulario -------------------------------------
export function fmtHectareas(v){
  if(!esNumero(Number(v)) || v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return `${n.toLocaleString("es-EC", { minimumFractionDigits: n < 10 ? 2 : 1, maximumFractionDigits: 2 })} ha`;
}

// Diferencia del área dibujada con la rotulada, en % (null si no hay rotulada).
export function diferenciaArea(rotuladas, puntos){
  const r = Number(rotuladas);
  if(!(r > 0)) return null;
  return (areaHectareas(puntos) / r - 1) * 100;
}

const clave = t=>String(t ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

// Sector a partir del nombre: las letras del principio ("PCM04" → "PCM").
export function sectorDeNombre(nombre){
  const m = String(nombre ?? "").trim().toUpperCase().match(/^[A-ZÑ]+/);
  return m ? m[0] : "";
}

export function validarPiscina({ nombre, sector, hectareas, puntos } = {}, piscinas = [], idActual = null){
  const errores = {};
  const n = String(nombre ?? "").trim();
  if(!n) errores.nombre = "Ponle un nombre a la piscina.";
  else if(n.length > 40) errores.nombre = "El nombre puede tener hasta 40 caracteres.";
  else if(piscinas.some(p=>p.id !== idActual && clave(p.nombre) === clave(n))) errores.nombre = "Ya hay una piscina con ese nombre.";
  if(String(sector ?? "").trim().length > 40) errores.sector = "El sector puede tener hasta 40 caracteres.";
  if(hectareas !== null && hectareas !== undefined && hectareas !== ""){
    const h = Number(String(hectareas).replace(",", "."));
    if(!(h > 0) || h > 999999) errores.hectareas = "Las hectáreas tienen que ser un número mayor que cero.";
  }
  if(puntos !== undefined && !validarPuntosPiscina(puntos)) errores.puntos = "La forma necesita al menos tres puntos válidos.";
  return { ok: !Object.keys(errores).length, errores };
}

// "4,7" / "4.7" / "" → número o null.
export function numeroHectareas(v){
  const s = String(v ?? "").trim().replace(",", ".");
  if(!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
