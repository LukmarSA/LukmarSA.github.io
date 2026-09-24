// Leaflet (vía unpkg, sin API key) y todo lo visual que depende de él:
// capas base, íconos de ubicación y estilos de las líneas de enlace.
//
// Leaflet se carga al abrir la pestaña Mapa por primera vez, no en
// index.html: si unpkg.com está bloqueado o lento (firewall, proxy), el
// resto de la app no se entera ni espera.
// Versión fijada con SRI: los hashes son los del paquete npm leaflet@1.9.4,
// el mismo archivo que sirve unpkg. Para actualizar Leaflet hay que cambiar
// versión y hashes juntos (Leaflet 2.x cambió la API: no es un reemplazo directo).

export const LEAFLET_VERSION = "1.9.4";
export const LEAFLET_JS = {
  url: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`,
  integrity: "sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=",
};
export const LEAFLET_CSS = {
  url: `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`,
  integrity: "sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=",
};
const ESPERA_MAXIMA_MS = 15000;

let promesaLeaflet = null;

function cargarRecurso(etiqueta, atributos){
  return new Promise((resolve, reject)=>{
    const el = document.createElement(etiqueta);
    Object.entries(atributos).forEach(([k, v])=>el.setAttribute(k, v));
    el.addEventListener("load", ()=>resolve());
    el.addEventListener("error", ()=>{ el.remove(); reject(new Error(`No se pudo cargar ${atributos.src || atributos.href}`)); });
    document.head.appendChild(el);
  });
}

export function cargarLeaflet(){
  if(window.L && typeof window.L.map === "function") return Promise.resolve(window.L);
  if(!promesaLeaflet){
    const descarga = Promise.all([
      document.querySelector("link[data-inventario-tecnologico-leaflet]")
        ? Promise.resolve()
        : cargarRecurso("link", { rel: "stylesheet", href: LEAFLET_CSS.url, integrity: LEAFLET_CSS.integrity, crossorigin: "anonymous", "data-inventario-tecnologico-leaflet": "css" }),
      cargarRecurso("script", { src: LEAFLET_JS.url, integrity: LEAFLET_JS.integrity, crossorigin: "anonymous" }),
    ]);
    const limite = new Promise((_, reject)=>setTimeout(()=>reject(new Error("unpkg.com no respondió a tiempo")), ESPERA_MAXIMA_MS));
    promesaLeaflet = Promise.race([descarga, limite])
      .then(()=>{
        if(!window.L || typeof window.L.map !== "function") throw new Error("Leaflet se descargó pero no quedó disponible (window.L).");
        return window.L;
      })
      .catch(err=>{ promesaLeaflet = null; throw err; }); // permite reintentar
  }
  return promesaLeaflet;
}

// ---------------------------------------------------------------------------
// Capas base. Para que el mapa ABRA en satélite: CAPA_BASE_POR_DEFECTO = "satelite".
// (El botón de capas arriba a la derecha permite cambiar en cualquier momento,
// y el navegador recuerda la última elegida.)
// ---------------------------------------------------------------------------
export const CAPAS_BASE = {
  mapa: {
    etiqueta: "Mapa",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    opciones: { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' },
  },
  satelite: {
    etiqueta: "Satélite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    opciones: { maxZoom: 19, attribution: "Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community" },
  },
};
export const CAPA_BASE_POR_DEFECTO = "mapa";
export const CENTRO_POR_DEFECTO = { lat: -2.1894, lng: -79.8891, zoom: 12 }; // Guayaquil, si aún no hay ubicaciones

const CLAVE_CAPA = "inventario-tecnologico-mapa-capa";

export function capaBaseInicial(){
  try{
    const guardada = localStorage.getItem(CLAVE_CAPA);
    if(guardada && CAPAS_BASE[guardada]) return guardada;
  }catch(e){ /* almacenamiento bloqueado: se usa la de por defecto */ }
  return CAPA_BASE_POR_DEFECTO;
}

export function recordarCapaBase(id){
  try{ localStorage.setItem(CLAVE_CAPA, id); }catch(e){ /* sin almacenamiento: no pasa nada */ }
}

export function crearCapasBase(L){
  const capas = {};
  for(const [id, c] of Object.entries(CAPAS_BASE)) capas[id] = L.tileLayer(c.url, c.opciones);
  return capas;
}

// ---------------------------------------------------------------------------
// Íconos. Un solo divIcon (HTML + CSS en styles.css) con el color del tipo de
// ubicación, un glifo para los tipos conocidos y un contador de equipos+activos.
// ---------------------------------------------------------------------------
const SVG = (cuerpo)=>`<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${cuerpo}</svg>`;

export const GLIFOS_TIPO_UBICACION = {
  torre: SVG(`<path d="M12 10.5 8.5 21M12 10.5 15.5 21M9.6 17.7h4.8"/><circle cx="12" cy="8.5" r="1.6" fill="currentColor" stroke="none"/><path d="M8.3 4.8a5.2 5.2 0 0 0 0 7.4M15.7 4.8a5.2 5.2 0 0 1 0 7.4"/>`),
  oficina: SVG(`<rect x="5" y="3.5" width="14" height="17" rx="1.5"/><path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2M11 20.5v-2.5h2v2.5"/>`),
  bodega: SVG(`<path d="M3.5 10 12 4.5 20.5 10v10h-17z"/><path d="M7.5 20v-6.5h9V20M7.5 16.8h9"/>`),
};
export const GLIFO_UBICACION_GENERICO = SVG(`<circle cx="12" cy="12" r="3.6" fill="currentColor" stroke="none"/>`);
export const GLIFO_RADIO = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="12.5" width="16" height="7" rx="1.5"/><path d="M8 16h.01M11 16h.01"/><path d="M15.5 12.5 18 5"/><path d="M13.6 6.2a4 4 0 0 1 6.1 1.6"/></svg>`;

export function glifoTipoUbicacion(tipo){
  return GLIFOS_TIPO_UBICACION[tipo] || GLIFO_UBICACION_GENERICO;
}

export function htmlPin({ color, tipo, cantidad = 0, seleccionada = false, enlazada = false, archivada = false }){
  const clases = ["inventario-tecnologico-mapa-pin"];
  if(seleccionada) clases.push("inventario-tecnologico-mapa-pin-seleccionada");
  if(enlazada) clases.push("inventario-tecnologico-mapa-pin-enlazada");
  if(archivada) clases.push("inventario-tecnologico-mapa-pin-archivada");
  return `<div class="${clases.join(" ")}" style="--pin-color:${color}">`
    + `<span class="inventario-tecnologico-mapa-pin-cuerpo"><span class="inventario-tecnologico-mapa-pin-glifo">${glifoTipoUbicacion(tipo)}</span></span>`
    + (cantidad > 0 ? `<span class="inventario-tecnologico-mapa-pin-cantidad">${cantidad > 99 ? "99+" : cantidad}</span>` : "")
    + `</div>`;
}

// La punta del pin queda en (16, 36): ahí se ancla la coordenada.
export function iconoUbicacion(L, opciones){
  return L.divIcon({
    className: "inventario-tecnologico-mapa-icono",
    html: htmlPin(opciones),
    iconSize: [32, 40],
    iconAnchor: [16, 36],
    tooltipAnchor: [0, -32],
  });
}

// Estilos de línea (opciones de L.polyline). bubblingMouseEvents:false para
// que el clic en una línea no llegue al mapa (que deselecciona).
export const ESTILOS_ENLACE = {
  borde:        { color: "#FFFFFF", weight: 8, opacity: 0.9, lineCap: "round", interactive: false },
  seleccionado: { color: "#EC741D", weight: 4, opacity: 1, lineCap: "round", bubblingMouseEvents: false, className: "inventario-tecnologico-mapa-linea-enlace" },
  destacado:    { color: "#EC741D", weight: 6, opacity: 1, lineCap: "round", bubblingMouseEvents: false, className: "inventario-tecnologico-mapa-linea-enlace inventario-tecnologico-mapa-linea-destacada" },
  fondo:        { color: "#004DAB", weight: 2.5, opacity: 0.55, dashArray: "6 6", lineCap: "round", bubblingMouseEvents: false, className: "inventario-tecnologico-mapa-linea-fondo" },
};
