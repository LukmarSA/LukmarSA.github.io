// Íconos de los tipos de equipo de red (v15, pedido 3.10; migración 013).
// Se ven en el tooltip de las ubicaciones del mapa y en «Redes y tipos».
// Cuál se usa, en este orden:
//   1. el que puso la persona en «Redes y tipos» (tipos_equipo_red.icono_svg);
//   2. el de fábrica de la app, para los 8 tipos de semilla (por su valor);
//   3. el del tipo de activo que empareja (Router, Switch, AP, Inyector POE…,
//      tipoEquipoDeActivo);
//   4. uno genérico (el de radio).
import { svgConTamano } from "../../nucleo/svg-seguro.js";
import { tipoEquipoDeActivo } from "../../nucleo/selector-servidor.js";
import { GLIFO_RADIO } from "./leaflet.js";

const SVG = cuerpo=>`<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;

export const GLIFOS_TIPO_EQUIPO = Object.freeze({
  // Router: caja con dos antenas.
  router: SVG(`<rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 16.5h.01M10.5 16.5h.01"/><path d="M8 13 6 5.5M16 13l2-7.5"/>`),
  // Switch: caja con sus puertos.
  switch: SVG(`<rect x="2.5" y="7.5" width="19" height="9" rx="1.5"/><path d="M6 11h2M10 11h2M14 11h2M6 13.5h2M10 13.5h2M14 13.5h2M18.5 12h.01"/>`),
  // Punto a punto: plato de antena apuntando.
  ptp: SVG(`<path d="M5 4.5a10.5 10.5 0 0 0 14.5 14.5Z"/><path d="M12 12l5.5-5.5"/><circle cx="18" cy="6" r="1.4"/><path d="M8.5 19.5 10 15.5"/>`),
  // AP: punto que irradia a los costados.
  ap: SVG(`<circle cx="12" cy="12" r="1.7"/><path d="M8.6 8.6a4.8 4.8 0 0 0 0 6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8M5.8 5.8a8.8 8.8 0 0 0 0 12.4M18.2 5.8a8.8 8.8 0 0 1 0 12.4"/>`),
  // Estación (CPE): caja chica con su señal arriba.
  estacion: SVG(`<rect x="7.5" y="10" width="9" height="11" rx="1.5"/><path d="M10.5 17.5h3"/><path d="M9.5 7a3.6 3.6 0 0 1 5 0M7.3 4.6a6.8 6.8 0 0 1 9.4 0"/>`),
  // Cámara: cámara de video.
  camara: SVG(`<rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="m15.5 10.5 6-3.5v10l-6-3.5"/>`),
  // NVR: grabador con su disco.
  nvr: SVG(`<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 10h7M6 14h4"/><circle cx="17" cy="12" r="2"/>`),
  // Equipo (otro): caja genérica.
  otro: SVG(`<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M9 12h6M12 9v6"/>`),
});

// De dónde sale el ícono de un tipo: "propio", "fabrica", "activo" o "generico".
export function origenIconoTipoEquipo(tipo, { tiposEquipo = [], tiposActivo = [] } = {}){
  if(tipo && tipo.icono_svg) return "propio";
  if(tipo && GLIFOS_TIPO_EQUIPO[tipo.valor]) return "fabrica";
  if(tipo && iconoDeActivo(tipo.valor, { tiposEquipo, tiposActivo })) return "activo";
  return "generico";
}
function iconoDeActivo(valor, { tiposEquipo, tiposActivo }){
  const t = tiposActivo.find(a=>a.icono_svg && tipoEquipoDeActivo(a.nombre, tiposEquipo) === valor);
  return t ? t.icono_svg : null;
}

// El SVG del ícono (16 px, del color del texto). tipo = la fila de
// tipos_equipo_red (o null para «Sin tipo»).
export function iconoTipoEquipo(tipo, { tiposEquipo = [], tiposActivo = [], px = 16 } = {}){
  if(tipo && tipo.icono_svg) return svgConTamano(tipo.icono_svg, px);
  if(tipo && GLIFOS_TIPO_EQUIPO[tipo.valor]) return px === 16 ? GLIFOS_TIPO_EQUIPO[tipo.valor] : svgConTamano(GLIFOS_TIPO_EQUIPO[tipo.valor], px);
  const deActivo = tipo ? iconoDeActivo(tipo.valor, { tiposEquipo, tiposActivo }) : null;
  if(deActivo) return svgConTamano(deActivo, px);
  return svgConTamano(GLIFO_RADIO, px);
}

export const TEXTO_ORIGEN_ICONO = Object.freeze({
  propio: "Ícono propio",
  fabrica: "Ícono de fábrica",
  activo: "El del tipo de activo",
  generico: "Ícono genérico",
});
