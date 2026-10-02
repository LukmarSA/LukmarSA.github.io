// Cobertura de los AP (v15, pedido 3.9 de la persona; migración 013).
// Cada equipo puede tener un radio de cobertura en metros y, para un sector,
// hacia dónde apunta (azimut, en grados desde el norte) y su apertura (en
// grados). Sin apertura, o con 360°, la cobertura es un círculo alrededor del
// equipo; con una apertura menor, una cuña. La app pide estos datos para los
// AP y los dibuja en el mapa. Lógica pura: se prueba en Node
// (tests/mapa-unit.mjs).
import { RADIO_TIERRA_KM, aRad, puntoCardinal } from "./geo.js";

export const COBERTURA = Object.freeze({ radioMaximo: 20000, pasosCirculo: 72 });

// El tipo de equipo que lleva cobertura (por su valor en tipos_equipo_red).
export const TIPO_CON_COBERTURA = "ap";
export function llevaCobertura(e){ return !!e && (e.tipo_equipo === TIPO_CON_COBERTURA || normalizarCobertura(e) !== null); }

const numero = v=>{
  if(v === null || v === undefined) return null;
  const t = String(v).trim().replace(",", ".");
  if(t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

// La cobertura guardada de un equipo: null si no tiene radio. sector = true
// si la apertura es menor que 360 y tiene dirección.
export function normalizarCobertura(e){
  if(!e) return null;
  const radio = numero(e.radio_cobertura_m);
  if(!(radio > 0)) return null;
  const azimut = numero(e.azimut_cobertura);
  const apertura = numero(e.apertura_cobertura);
  const az = Number.isFinite(azimut) ? ((azimut % 360) + 360) % 360 : null;
  const ap = Number.isFinite(apertura) && apertura > 0 && apertura <= 360 ? apertura : null;
  return { radio, azimut: az, apertura: ap, sector: ap !== null && ap < 360 && az !== null };
}

// Lo que se escribió en el formulario («Radio», «Dirección», «Apertura»; se
// acepta la coma decimal). Devuelve los valores para guardar o los errores
// por campo (con las claves de la base). Todo vacío = sin cobertura.
export function validarCobertura({ radio = "", azimut = "", apertura = "" } = {}){
  const r = numero(radio), a = numero(azimut), ap = numero(apertura);
  const errores = {};
  if(r === null){
    if(a !== null || ap !== null) errores.radio_cobertura_m = "Pon el radio de cobertura: sin él no se dibuja la dirección ni la apertura.";
  } else if(!(r > 0) || r > COBERTURA.radioMaximo){
    errores.radio_cobertura_m = `El radio va en metros, de más de 0 a ${COBERTURA.radioMaximo.toLocaleString("es-EC")}.`;
  }
  if(a !== null && !(a >= 0 && a <= 360)) errores.azimut_cobertura = "La dirección va en grados, de 0 a 360 (0 = norte, 90 = este).";
  if(ap !== null && !(ap > 0 && ap <= 360)) errores.apertura_cobertura = "La apertura va en grados, de más de 0 a 360 (360 = un círculo).";
  if(!errores.apertura_cobertura && ap !== null && ap < 360 && a === null && !errores.azimut_cobertura) errores.azimut_cobertura = "Para un sector, pon hacia dónde apunta (0 = norte, 90 = este).";
  if(Object.keys(errores).length) return { ok: false, errores, valores: null };
  return { ok: true, errores: {}, valores: {
    radio_cobertura_m: r,
    azimut_cobertura: r === null || a === null ? null : (a === 360 ? 0 : a),
    apertura_cobertura: r === null ? null : ap,
  } };
}

// El punto a `metros` de `desde` hacia `azimut` (grados desde el norte),
// sobre la esfera.
export function puntoDestino(desde, azimut, metros){
  const d = metros / (RADIO_TIERRA_KM * 1000);
  const t = aRad(azimut), f1 = aRad(desde.lat), l1 = aRad(desde.lng);
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return { lat: f2 * 180 / Math.PI, lng: ((l2 * 180 / Math.PI + 540) % 360) - 180 };
}

// Los puntos de la cuña: el centro, el arco de (azimut − apertura/2) a
// (azimut + apertura/2) y otra vez el centro. Un paso cada 5° como mucho.
export function puntosSector(centro, { radio, azimut, apertura }){
  const pasos = Math.max(2, Math.ceil(apertura / 5));
  const desde = azimut - apertura / 2;
  const arco = Array.from({ length: pasos + 1 }, (_, i)=>puntoDestino(centro, desde + (apertura * i) / pasos, radio));
  return [{ lat: centro.lat, lng: centro.lng }, ...arco, { lat: centro.lat, lng: centro.lng }];
}

// «300 m a la redonda» o «1,2 km · sector de 120° hacia el NE (45°)».
export function textoRadio(metros){
  if(!(metros > 0)) return "—";
  if(metros < 1000) return `${Math.round(metros)} m`;
  return `${(metros / 1000).toLocaleString("es-EC", { maximumFractionDigits: 2 })} km`;
}
export function textoCobertura(c){
  if(!c) return "";
  const radio = textoRadio(c.radio);
  if(!c.sector) return `${radio} a la redonda`;
  return `${radio} · sector de ${redondear(c.apertura)}° hacia el ${puntoCardinal(c.azimut)} (${redondear(c.azimut)}°)`;
}
const redondear = v=>Math.round(v * 10) / 10;
