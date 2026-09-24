// Cálculos geográficos y parseo de coordenadas del mapa. Módulo puro: sin
// DOM, sin Supabase, sin imports — así se prueba directo en Node
// (tests/mapa-unit.mjs).

export const RADIO_TIERRA_KM = 6371.0088; // radio medio (IUGG)

export function aRad(grados){ return grados * Math.PI / 180; }

function aGrados(rad){ return rad * 180 / Math.PI; }

// Distancia de círculo máximo (haversine) entre {lat,lng} y {lat,lng}, en km.
// Para un radioenlace es la distancia en línea recta sobre el terreno; no
// considera relieve ni zona de Fresnel.
export function distanciaKm(a, b){
  const dLat = aRad(b.lat - a.lat);
  const dLng = aRad(b.lng - a.lng);
  const h = Math.sin(dLat/2) ** 2 + Math.cos(aRad(a.lat)) * Math.cos(aRad(b.lat)) * Math.sin(dLng/2) ** 2;
  return 2 * RADIO_TIERRA_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Azimut inicial de a hacia b, en grados desde el norte geográfico (0–360,
// sentido horario): hacia dónde hay que apuntar la antena de a.
export function azimutGrados(a, b){
  const f1 = aRad(a.lat), f2 = aRad(b.lat), dl = aRad(b.lng - a.lng);
  const y = Math.sin(dl) * Math.cos(f2);
  const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (aGrados(Math.atan2(y, x)) + 360) % 360;
}

export const PUNTOS_CARDINALES = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];

export function puntoCardinal(grados){
  const g = ((Number(grados) % 360) + 360) % 360;
  return PUNTOS_CARDINALES[Math.round(g / 22.5) % 16];
}

export function fmtDistancia(km){
  if(!Number.isFinite(km)) return "—";
  if(km < 1) return `${Math.round(km * 1000)} m`;
  if(km < 100) return `${km.toFixed(2)} km`;
  return `${Math.round(km)} km`;
}

export function fmtAzimut(grados){
  if(!Number.isFinite(grados)) return "—";
  return `${grados.toFixed(1)}° ${puntoCardinal(grados)}`;
}

export function coordenadasValidas(lat, lng){
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

export function fmtCoordenadas(lat, lng, decimales = 6){
  if(!coordenadasValidas(Number(lat), Number(lng))) return "—";
  return `${Number(lat).toFixed(decimales)}, ${Number(lng).toFixed(decimales)}`;
}

export function urlGoogleMaps(lat, lng){
  return `https://www.google.com/maps?q=${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
}

function resultadoPar(lat, lng){
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok:false, error:"No se pudieron leer los números de las coordenadas." };
  if(Math.abs(lat) > 90){
    return Math.abs(lng) <= 90 && Math.abs(lat) <= 180
      ? { ok:false, error:"La latitud debe estar entre -90 y 90. ¿Están invertidas? Primero va la latitud, luego la longitud." }
      : { ok:false, error:"La latitud debe estar entre -90 y 90." };
  }
  if(Math.abs(lng) > 180) return { ok:false, error:"La longitud debe estar entre -180 y 180." };
  return { ok:true, lat, lng };
}

const NUM = String.raw`-?\d+(?:\.\d+)?`;

// Grados, minutos y segundos como los muestra Google Maps:
// 2°11'21.8"S 79°53'20.8"W — también acepta O (oeste), comas decimales y
// comillas tipográficas.
const RE_DMS = /(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:["″”]|''|′′)\s*)?([NSEWO])/gi;

function parsearDMS(texto){
  const partes = [...texto.matchAll(RE_DMS)];
  if(partes.length !== 2) return null;
  let lat = null, lng = null;
  for(const m of partes){
    const n = s => s ? Number(s.replace(",", ".")) : 0;
    const valor = n(m[1]) + n(m[2]) / 60 + n(m[3]) / 3600;
    const hemi = m[4].toUpperCase();
    if(hemi === "N" || hemi === "S"){
      if(lat !== null) return { ok:false, error:"Hay dos latitudes (N/S) y ninguna longitud (E/W)." };
      lat = hemi === "S" ? -valor : valor;
    } else {
      if(lng !== null) return { ok:false, error:"Hay dos longitudes (E/W) y ninguna latitud (N/S)." };
      lng = (hemi === "W" || hemi === "O") ? -valor : valor;
    }
  }
  return resultadoPar(lat, lng);
}

// Acepta lo que un técnico tiene a mano:
//   -2.189400, -79.889100          (lo que copia Google Maps con clic derecho)
//   -2.1894 -79.8891   /   -2,1894; -79,8891
//   un enlace de Google Maps (…/@-2.18,-79.88,15z o …!3d-2.18!4d-79.88 o ?q=-2.18,-79.88)
//   2°11'21.8"S 79°53'20.8"W
// Devuelve { ok:true, lat, lng } o { ok:false, error }.
export function parsearCoordenadas(texto){
  const t = String(texto ?? "").trim();
  if(!t) return { ok:false, error:"Escribe o pega las coordenadas." };

  // !3d…!4d… es el punto exacto del lugar; @lat,lng es el centro de la vista.
  let m = t.match(new RegExp(String.raw`!3d(${NUM})!4d(${NUM})`))
       || t.match(new RegExp(String.raw`@(${NUM}),\s*(${NUM})`))
       || t.match(new RegExp(String.raw`[?&](?:q|ll|query|center|destination|daddr)=(${NUM})(?:,|%2C)\s*(${NUM})`, "i"));
  if(m) return resultadoPar(Number(m[1]), Number(m[2]));

  if(t.includes("°")){
    const dms = parsearDMS(t);
    if(dms) return dms;
  }

  // Decimales (un "°" suelto al final de cada número no molesta).
  const d = t.replace(/°/g, "").trim();
  // Punto y coma como separador → se permiten comas decimales.
  if(d.includes(";")){
    const p = d.split(";").map(s => s.trim()).filter(Boolean);
    if(p.length === 2 && p.every(s => /^-?\d+(?:[.,]\d+)?$/.test(s))) return resultadoPar(Number(p[0].replace(",", ".")), Number(p[1].replace(",", ".")));
  }
  m = d.match(new RegExp(String.raw`^(${NUM})\s*[,\s]\s*(${NUM})$`));
  if(m) return resultadoPar(Number(m[1]), Number(m[2]));
  m = d.match(/^(-?\d+,\d+)\s+(-?\d+,\d+)$/);
  if(m) return resultadoPar(Number(m[1].replace(",", ".")), Number(m[2].replace(",", ".")));

  return { ok:false, error:"No reconozco ese formato. Ejemplos: «-2.189400, -79.889100», un enlace de Google Maps o «2°11'21.8\"S 79°53'20.8\"W»." };
}
