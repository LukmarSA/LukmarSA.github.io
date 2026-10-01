// Íconos SVG que pega el administrador (tipos de activo, desde el v10 también
// los tipos de ubicación). Se muestran a todos con innerHTML, así que se
// limpian: fuera <script>, <foreignObject>, <iframe>, <object>, <embed>,
// <style>, <image>, los atributos on…, los enlaces que no son internos
// (#algo) y los url() hacia afuera. Solo el administrador los escribe (RLS),
// pero así un SVG copiado de cualquier lado no puede correr nada.
//
// Lógica pura, sin DOM: se prueba en Node (tests/activo-unit.mjs).

const TAMANO_MAXIMO = 20000; // caracteres

// También las animaciones (set, animate…): un ícono no las necesita y con
// ellas se puede cambiar un atributo después de limpiarlo.
const PELIGROSOS = ["script", "foreignObject", "iframe", "object", "embed", "style", "image", "audio", "video", "canvas", "noscript", "template", "set", "animate", "animateMotion", "animateTransform", "discard", "handler", "listener"];

// Se limpia hasta que ya no cambie nada: al sacar una parte, lo que quedaba a
// los lados podría juntarse y formar otra peligrosa («<path o onload="" nload=…»
// → «<path onload=…»). Si no se estabiliza, se rechaza.
const PASADAS_MAXIMAS = 8;

export function limpiarSvg(texto){
  let t = String(texto ?? "").trim();
  if(!t || t.length > TAMANO_MAXIMO) return "";
  for(let i = 0; i < PASADAS_MAXIMAS; i++){
    const antes = t;
    t = pasadaLimpieza(t);
    if(!t) return "";
    if(t === antes) return t;
  }
  return "";
}

function pasadaLimpieza(texto){
  let t = texto;
  // Comentarios, CDATA, DOCTYPE y declaraciones XML.
  t = t.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "").replace(/<!DOCTYPE[^>]*>/gi, "").replace(/<\?[\s\S]*?\?>/g, "").trim();
  if(!/^<svg[\s>]/i.test(t) || !/<\/svg\s*>$/i.test(t)) return "";
  for(const el of PELIGROSOS){
    t = t.replace(new RegExp(`<${el}\\b[^>]*>[\\s\\S]*?<\\/${el}\\s*>`, "gi"), "")
         .replace(new RegExp(`<${el}\\b[^>]*\\/?>`, "gi"), "")
         .replace(new RegExp(`<\\/${el}\\s*>`, "gi"), "");
  }
  // <a> se desarma y queda lo que tenía adentro.
  t = t.replace(/<a\b[^>]*>/gi, "").replace(/<\/a\s*>/gi, "");
  // Atributos: cada etiqueta se rearma leyendo sus atributos uno por uno
  // (como el navegador, que también los lee pegados a una barra o a la
  // comilla del anterior: «<path/onload=…», «d="x"onload=…»). Fuera los de
  // eventos (on…) y los href/src que no son internos (#id).
  t = t.replace(/<([a-zA-Z][\w:-]*)([^>]*)>/g, rearmarEtiqueta);
  // url(...) hacia afuera (en style o en atributos como fill): solo url(#id).
  t = t.replace(/url\(\s*(?!['"]?\s*#)[^)]*\)/gi, "none");
  t = t.replace(/(?:java|vb)script\s*:/gi, "");
  t = t.trim();
  if(!/^<svg[\s>]/i.test(t) || !/<\/svg\s*>$/i.test(t)) return "";
  return t;
}

const ATRIBUTO = /([^\s"'<>\/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
const ENLACES = new Set(["href", "xlink:href", "src"]);

function rearmarEtiqueta(_m, nombre, resto){
  const cierre = /\/\s*$/.test(resto) ? "/" : "";
  const atributos = [];
  for(const a of resto.matchAll(ATRIBUTO)){
    const n = a[1].toLowerCase();
    const crudo = a[2];
    const valor = crudo === undefined ? "" : crudo.replace(/^(["'])([\s\S]*)\1$/, "$2");
    if(n.startsWith("on")) continue;
    if(ENLACES.has(n) && !valor.trim().startsWith("#")) continue;
    if(crudo === undefined) atributos.push(a[1]);
    else atributos.push(`${a[1]}=${/^["']/.test(crudo) ? crudo : `"${crudo}"`}`);
  }
  return `<${nombre}${atributos.length ? " " + atributos.join(" ") : ""}${cierre}>`;
}

// Valida lo que se pegó en un formulario. vacío = sin ícono (se usa el de
// siempre). exigir16: los tipos de activo piden width="16" height="16"
// (iconoTipoTam lo agranda reemplazando esas medidas). exigirViewBox: los de
// ubicación se dibujan a otro tamaño dentro de la burbuja, así que necesitan
// viewBox para escalar.
export function validarSvg(texto, { exigir16 = false, exigirViewBox = false } = {}){
  const crudo = String(texto ?? "").trim();
  if(!crudo) return { ok: true, svg: "", limpiado: false };
  if(!/^<svg[\s>]/i.test(crudo)) return { ok: false, error: "El ícono debe empezar con <svg — pega el markup completo o deja el campo vacío." };
  if(crudo.length > TAMANO_MAXIMO) return { ok: false, error: `El SVG es demasiado grande (máximo ${TAMANO_MAXIMO} caracteres).` };
  const svg = limpiarSvg(crudo);
  if(!svg) return { ok: false, error: "El SVG no se pudo leer: revisa que termine en </svg>." };
  const raiz = (svg.match(/^<svg\b[^>]*>/i) || [""])[0];
  if(exigir16 && !/width="16"\s+height="16"/.test(raiz)){
    return { ok: false, error: 'El SVG debe tener width="16" height="16" (mismo tamaño que los íconos existentes, ej. de icons.getbootstrap.com) para verse bien también en la vista grande del detalle.' };
  }
  if(exigirViewBox && !/\sviewBox\s*=\s*["'][^"']+["']/i.test(raiz)){
    return { ok: false, error: 'El SVG necesita un viewBox (por ejemplo viewBox="0 0 16 16") para poder dibujarse dentro de la burbuja.' };
  }
  return { ok: true, svg, limpiado: svg !== crudo };
}

// El mismo SVG a otro tamaño: cambia (o agrega) width y height de la raíz.
// Si la raíz no dice de qué color rellenar, se usa el del texto (currentColor):
// en la burbuja del mapa, blanco sobre el color del tipo (sin esto, un ícono
// sin fill sale negro).
export function svgConTamano(svg, px){
  const t = String(svg ?? "");
  const m = t.match(/^<svg\b[^>]*>/i);
  if(!m) return t;
  let raiz = m[0].replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  raiz = raiz.replace(/^<svg\b/i, `<svg width="${px}" height="${px}"`);
  if(!/\saria-hidden\s*=/i.test(raiz)) raiz = raiz.replace(/^<svg\b/i, `<svg aria-hidden="true"`);
  if(!/\sfill\s*=/i.test(raiz)) raiz = raiz.replace(/\s*(\/?)>$/, ` fill="currentColor"$1>`);
  return raiz + t.slice(m[0].length);
}
