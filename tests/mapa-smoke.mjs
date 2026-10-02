// Prueba de humo del módulo de mapa en un navegador real (Chromium vía
// Playwright), con la app servida localmente y Supabase reemplazado por
// stubs/supabase-stub.js. Hace los clics de verdad: marcador → panel →
// equipo → camino a la raíz, los toggles de líneas/equipos, la simulación de
// fallas, los formularios de administrador (equipo con servidor, respaldos),
// permisos por rol, los casos de falla (tablas faltantes, unpkg caído) y la
// capa Plano con su herramienta de ajuste (mover, agrandar, guardar, cancelar)
// y, del inventario, el modal «Nuevo activo» (tipo con búsqueda, campos según
// el tipo, submodales de «+»). v10: los campos configurables (con y sin la
// migración 012: tabla, detalle, formulario, Configuración, Excel, acta) y la
// edición de tipos de activo y de ubicación (ícono de la burbuja).
//
// Uso (desde tests/):  npm install   (una vez; trae playwright y leaflet)
//                      npx playwright install chromium   (si no hay navegador)
//                      node mapa-smoke.mjs
// Variables opcionales: CHROMIUM_PATH (usar un Chromium ya instalado),
// CAPTURAS (carpeta para las capturas; por defecto tests/capturas).
import { chromium } from "playwright";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import JSZip from "jszip";
import { distanciaKm, fmtDistancia } from "../assets/js/inventario-tecnologico/nucleo/geo.js";
import { PLANO_POR_DEFECTO } from "../assets/js/inventario-tecnologico/nucleo/plano-mapa.js";
import { cuadradoAlrededor } from "../assets/js/inventario-tecnologico/nucleo/piscinas.js";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(AQUI, "..");
const LEAFLET_DIST = path.join(AQUI, "node_modules", "leaflet", "dist");
const STUB = fs.readFileSync(path.join(AQUI, "stubs", "supabase-stub.js"), "utf8");
const CAPTURAS = process.env.CAPTURAS || path.join(AQUI, "capturas");
fs.mkdirSync(CAPTURAS, { recursive: true });

// ------------------------------------------------------------------ utilidades
const resultados = [];
function registrar(nombre, ok, detalle = ""){
  resultados.push({ nombre, ok });
  console.log(`${ok ? "OK" : "FALLA"}: ${nombre}${detalle ? ` — ${detalle}` : ""}`);
}
async function verificar(nombre, fn){
  try{ const d = await fn(); registrar(nombre, true, typeof d === "string" ? d : ""); }
  catch(err){ registrar(nombre, false, err.message.split("\n").slice(0, process.env.DEPURAR ? 4 : 1).join(" / ")); }
}
function exigir(cond, msg){ if(!cond) throw new Error(msg); }

function crc32(buf){
  let c, crc = 0xFFFFFFFF;
  for(let n = 0; n < buf.length; n++){
    c = (crc ^ buf[n]) & 0xFF;
    for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
// Tesela de 256×256 gris azulado con borde, para que las capturas se lean como un mapa.
function teselaPng(){
  const w = 256, h = 256, filas = [];
  for(let y = 0; y < h; y++){
    const fila = Buffer.alloc(1 + w * 3);
    for(let x = 0; x < w; x++){
      const borde = x === 0 || y === 0;
      const [r, g, b] = borde ? [205, 216, 226] : [230, 237, 243];
      fila[1 + x*3] = r; fila[2 + x*3] = g; fila[3 + x*3] = b;
    }
    filas.push(fila);
  }
  const trozo = (tipo, datos)=>{
    const len = Buffer.alloc(4); len.writeUInt32BE(datos.length);
    const td = Buffer.concat([Buffer.from(tipo), datos]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), trozo("IHDR", ihdr), trozo("IDAT", zlib.deflateSync(Buffer.concat(filas))), trozo("IEND", Buffer.alloc(0))]);
}
const TESELA = teselaPng();

function servir(raiz){
  const tipos = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".png":"image/png", ".webp":"image/webp", ".json":"application/json" };
  return new Promise(resolve=>{
    const srv = http.createServer((req, res)=>{
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if(p === "/") p = "/index.html";
      const f = path.join(raiz, p);
      if(!f.startsWith(raiz) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": tipos[path.extname(f)] || "application/octet-stream", "Cache-Control": "no-store" });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", ()=>resolve(srv));
  });
}

// ------------------------------------------------------------------ datos de prueba
// Red: Router Oficina (raíz) ─cable─ PTP Oficina → CA ═backbone═ PTP CA ← Oficina
//      en Cerro Azul: ─cable─ AP Sector Norte (9 CPE en piscinas: se agrupa)
//                     ─cable─ PTP CA → SA ═backbone═ PTP SA ← CA ─cable─ AP Santa Ana
//      AP Santa Ana: SM Oficina (radio = activo 2) y SM Bodega (P2MP de 2)
//      Respaldo: CPE Piscina 1 → AP Santa Ana (prioridad 1)
// La fecha de "hoy" que usa la app (la del navegador, con la zona de Ecuador del contexto).
const HOY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
const SVG16 = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="2" y="3" width="12" height="9" rx="1"/></svg>`;
const ACCIONES = ["ver_listado","ver_detalle","crear_activo","editar_activo","cambiar_custodio","editar_historial","dar_baja","restaurar_baja","ver_bajas","ver_mapa","asignar_ubicacion"];
const UBIC = {
  cerroAzul: { id:1, nombre:"Torre Cerro Azul", tipo:"torre", lat:-2.1735, lng:-79.9587, direccion:null, notas:"Acceso por la vía a la costa", fotos:[], activa:true },
  santaAna: { id:2, nombre:"Torre Santa Ana", tipo:"torre", lat:-2.1839, lng:-79.8756, direccion:null, notas:null, fotos:[], activa:true },
  oficina: { id:3, nombre:"Oficina Centro", tipo:"oficina", lat:-2.1894, lng:-79.8891, direccion:"Av. 9 de Octubre", notas:null, fotos:[], activa:true },
  bodega: { id:4, nombre:"Bodega Sur", tipo:"bodega", lat:-2.2150, lng:-79.8700, direccion:null, notas:null, fotos:[], activa:true },
};
const PISCINAS = Array.from({ length: 9 }, (_, i)=>({ id:10 + i, nombre:`Piscina ${i + 1}`, tipo:"otro", lat:-2.22 - 0.01 * Math.floor(i / 3), lng:-79.97 - 0.015 * (i % 3), direccion:null, notas:null, fotos:[], activa:true }));
const eq = (id, ubicacion_id, nombre, servidor_id = null, extra = {})=>({ id, ubicacion_id, nombre, modelo:null, activo_id:null, notas:null, servidor_id, banda:null, frecuencia_mhz:null, ...extra });

// Migración 007 (red de la finca): tipos de equipo, redes y atajos. Sin
// red007, el stub se comporta como una base sin la 007.
const TIPOS_EQUIPO_RED = [
  ["router","Router","m",10], ["switch","Switch","m",20], ["ptp","Punto a Punto","m",30], ["ap","AP","m",40],
  ["estacion","Estación","f",50], ["camara","Cámara","f",60], ["nvr","NVR","m",70], ["otro","Equipo","m",90],
].map(([valor, etiqueta, genero, orden])=>({ valor, etiqueta, genero, orden, activo:true }));
const TIPO_DE = { 30:"router", 31:"ptp", 10:"ptp", 11:"ap", 12:"ptp", 20:"ptp", 21:"ap", 32:"estacion" };
function conRed007(tablas){
  for(const e of tablas.equipos_radioenlace){
    e.tipo_equipo = TIPO_DE[e.id] || (e.id > 100 ? "estacion" : null); // SM Bodega (40) queda sin tipo: nombre a mano
    e.red_id = e.id > 100 || e.id === 40 ? null : 1;
    e.referencia = null;
  }
  tablas.equipos_radioenlace.push(
    eq(50, 1, "Switch CA", 10, { tipo_equipo:"switch", red_id:2, referencia:null }),
    eq(51, 1, "Cámara Norte CA", 50, { tipo_equipo:"camara", red_id:2, referencia:"Norte" }),
    eq(52, 1, "Cámara Sur CA", 50, { tipo_equipo:"camara", red_id:2, referencia:"Sur" }),
  );
  tablas.tipos_equipo_red = TIPOS_EQUIPO_RED.map(x=>({ ...x }));
  tablas.redes = [
    { id:1, nombre:"Red Administrativa", color:"#004DAB", orden:10, activa:true },
    { id:2, nombre:"Red Cámaras", color:"#EC741D", orden:20, activa:true },
  ];
  tablas.atajos_simulacion = [{ id:1, nombre:"Cámaras Cerro Azul", equipos:[50], orden:10 }];
  return tablas;
}

// Migración 009: tres piscinas al sur de las ubicaciones "Piscina N", sin marcadores encima (una por revisar).
const PISCINAS_POLIGONOS = [
  { id:1, nombre:"L01", sector:"L", hectareas:4.7, puntos:cuadradoAlrededor([-2.2650, -79.9550], 4.7), fuente:"vector", revisar:false, notas:null, orden:10, activa:true },
  { id:2, nombre:"L02", sector:"L", hectareas:4.5, puntos:cuadradoAlrededor([-2.2650, -79.9330], 4.5), fuente:"imagen", revisar:false, notas:"Sembrada en agosto", orden:20, activa:true },
  { id:3, nombre:"L08", sector:"L", hectareas:null, puntos:cuadradoAlrededor([-2.2650, -79.9110], 1.1), fuente:"imagen", revisar:true, notas:null, orden:30, activa:true },
];

// v8: un Data Center junto a la Oficina con un Router del inventario ubicado
// ahí que todavía no es equipo de red (y otro Router sin ubicación).
const DATA_CENTER = { id:5, nombre:"Data Center", tipo:"oficina", lat:-2.1896, lng:-79.8894, direccion:null, notas:null, fotos:[], activa:true };
function fixture({ rol = "administrador", permitidas = [], fallas = {}, red007 = false, red008 = false, red010 = false, red011 = false, servidor = false, piscinas = false } = {}){
  const uid = rol === "administrador" ? "u-admin" : "u-usuario";
  const permisos = [];
  for(const r of ["registrador", "visitante"]){
    for(const a of ACCIONES){
      const base = r === "registrador" ? ["ver_listado","ver_detalle","crear_activo","editar_activo","cambiar_custodio","ver_bajas"] : ["ver_listado","ver_detalle"];
      permisos.push({ rol: r, accion: a, permitido: base.includes(a) || (r === rol && permitidas.includes(a)) });
    }
  }
  const conExtras = tablas=>{
    if(red008) for(const e of tablas.equipos_radioenlace) e.medio = null;
    if(servidor){
      tablas.ubicaciones.push({ ...DATA_CENTER });
      tablas.tipos_activo.push({ nombre:"Router", icono_svg:SVG16, color:"#3E7D4F", campos_pertinentes:["serie","mac_ethernet"], orden:40, activo:true });
      tablas.activos.push({ id:4, propiedad:"lukmar", tipo:"Router", marca:"MikroTik", modelo:"RB4011", serie:"SN-R4", estado:"uso", fotos:[] });
      tablas.activos.push({ id:5, propiedad:"lukmar", tipo:"Router", marca:"TP-Link", modelo:"ER605", serie:"SN-R5", estado:"disponible", fotos:[] });
      tablas.historial_ubicacion.push({ id:1002, activo_id:4, ubicacion_id:5, desde:"2026-09-25", hasta:null, notas:null });
    }
    if(piscinas) tablas.piscinas = PISCINAS_POLIGONOS.map(p=>JSON.parse(JSON.stringify(p)));
    return tablas;
  };
  return {
    hoy: HOY,
    fallas,
    m008: red008,
    m010: red010 || red011,
    m011: red011,
    sesion: { user: { id: uid, email: `${rol}@lukmar.local` } },
    tablas: conExtras((red007 ? conRed007 : x=>x)({
      perfiles: [{ id:"u-admin", rol:"administrador", nombre_completo:"Admin Pruebas" }, { id:"u-usuario", rol, nombre_completo:"Usuario Pruebas" }],
      permisos,
      tipos_activo: [
        { nombre:"Laptop", icono_svg:SVG16, color:"#004DAB", campos_pertinentes:["serie","so","ram_gb","disco_gb","procesador","mac_wifi","mac_ethernet"], orden:10, activo:true },
        { nombre:"Antena", icono_svg:SVG16, color:"#EC741D", campos_pertinentes:["serie","mac_ethernet"], orden:20, activo:true },
        { nombre:"Monitor", icono_svg:SVG16, color:"#5B4B8A", campos_pertinentes:["serie"], orden:30, activo:true },
      ],
      propiedad_opciones: [{ valor:"lukmar", etiqueta:"Lukmar", orden:10, activo:true }, { valor:"eq", etiqueta:"EQ Soluciones", orden:20, activo:true }],
      estado_opciones: [
        { valor:"uso", etiqueta:"En uso", color_fg:"#3E7D4F", color_bg:"#E1EFE3", orden:10, activo:true },
        { valor:"disponible", etiqueta:"Disponible", color_fg:"#007EB2", color_bg:"#E1F0F8", orden:20, activo:true },
      ],
      activos: [
        { id:1, propiedad:"lukmar", tipo:"Laptop", marca:"Dell", modelo:"Latitude 5440", serie:"SN-L1", estado:"uso", fotos:[] },
        { id:2, propiedad:"lukmar", tipo:"Antena", marca:"Cambium", modelo:"Force 300-25", serie:"SN-A2", estado:"uso", fotos:[] },
        { id:3, propiedad:"eq", tipo:"Monitor", marca:"LG", modelo:"24MK600", serie:"SN-M3", estado:"disponible", fotos:[] },
      ],
      historial_custodia: [
        { id:1, activo_id:1, orden:1, tipo_custodio:"persona", nombre:"María López", cargo:"Contadora", desde:"2026-01-10", hasta:null, tipo_entrega:"firmada", tipo_devolucion:null, observacion_entrega:null, observacion_devolucion:null },
        { id:2, activo_id:2, orden:1, tipo_custodio:"area", nombre:"Sistemas", cargo:null, desde:"2026-02-01", hasta:null, tipo_entrega:"simple", tipo_devolucion:null, observacion_entrega:null, observacion_devolucion:null },
      ],
      bajas: [],
      auditoria: [],
      tipos_ubicacion: [
        { valor:"torre", etiqueta:"Torre", color:"#EC741D", orden:10, activo:true },
        { valor:"oficina", etiqueta:"Oficina", color:"#004DAB", orden:20, activo:true },
        { valor:"bodega", etiqueta:"Bodega", color:"#A6710B", orden:30, activo:true },
        { valor:"otro", etiqueta:"Otro", color:"#57697C", orden:40, activo:true },
      ],
      ubicaciones: [UBIC.cerroAzul, UBIC.santaAna, UBIC.oficina, UBIC.bodega, ...PISCINAS],
      equipos_radioenlace: [
        eq(30, 3, "Router Oficina", null, { modelo:"MikroTik CCR2004" }),
        eq(31, 3, "PTP Oficina → CA", 30, { modelo:"Cambium PTP 550", banda:"5 GHz", frecuencia_mhz:5745 }),
        eq(10, 1, "PTP CA ← Oficina", 31, { modelo:"Cambium PTP 550", banda:"5 GHz", frecuencia_mhz:5745 }),
        eq(11, 1, "AP Sector Norte", 10, { modelo:"Cambium ePMP 3000", banda:"5 GHz", frecuencia_mhz:5180, notas:"Sector 90°" }),
        eq(12, 1, "PTP CA → SA", 10, { modelo:"Ubiquiti PowerBeam 5AC", banda:"5 GHz", frecuencia_mhz:5300 }),
        eq(20, 2, "PTP SA ← CA", 12, { modelo:"Ubiquiti PowerBeam 5AC", banda:"5 GHz", frecuencia_mhz:5300 }),
        eq(21, 2, "AP Santa Ana", 20, { modelo:"Cambium ePMP 3000", banda:"5 GHz", frecuencia_mhz:5220 }),
        eq(32, 3, "SM Oficina", 21, { modelo:"Cambium Force 300-25", activo_id:2 }),
        eq(40, 4, "SM Bodega", 21, { modelo:"Cambium Force 300-25" }),
        ...PISCINAS.map((u, i)=>eq(101 + i, u.id, `CPE Piscina ${i + 1}`, 11, { modelo:"Cambium Force 300-25" })),
      ],
      enlaces_respaldo: [
        { id:1, equipo_id:101, servidor_alternativo_id:21, prioridad:1, notas:null },
      ],
      historial_ubicacion: [
        { id:1000, activo_id:2, ubicacion_id:3, desde:"2026-09-01", hasta:null, notas:"Automático: instalado como equipo de radioenlace «SM Oficina»" },
        { id:1001, activo_id:1, ubicacion_id:3, desde:"2026-09-05", hasta:null, notas:null },
      ],
      planos_mapa: [
        { id:1, nombre:PLANO_POR_DEFECTO.nombre, imagen:PLANO_POR_DEFECTO.imagen, ancho_px:PLANO_POR_DEFECTO.ancho_px, alto_px:PLANO_POR_DEFECTO.alto_px,
          esquinas:PLANO_POR_DEFECTO.esquinas, esquinas_originales:PLANO_POR_DEFECTO.esquinas, activo:true, actualizado_en:"2026-09-25T12:00:00Z", actualizado_por:null },
      ],
    })),
  };
}

// JSZip de verdad (el mismo 3.10.1 de cdnjs, desde node_modules) para las
// pruebas que exportan el Excel; las demás usan uno vacío, como siempre.
const JSZIP_MIN = path.join(AQUI, "node_modules", "jszip", "dist", "jszip.min.js");
async function abrirApp(browser, base, fx, { leafletFalla = false, viewport = { width: 1400, height: 900 }, jszipReal = false, tactil = false } = {}){
  // tactil (v13): un celular de verdad para el navegador, con pantalla táctil
  // («pointer: coarse», «hover: none»).
  const context = await browser.newContext({ viewport, locale: "es-EC", timezoneId: "America/Guayaquil", ...(tactil ? { hasTouch: true, isMobile: true } : {}) });
  const page = await context.newPage();
  const errores = [];
  page.on("pageerror", e=>errores.push(e.message));
  if(process.env.DEPURAR) page.on("console", m=>{ if(/DEPURAR/.test(m.text())) console.log("   [consola]", m.text()); });
  page.on("console", m=>{ if(m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push("console: " + m.text()); });
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", r=>r.fulfill({ contentType: "text/javascript", body: `window.__FIXTURE__ = ${JSON.stringify(fx)};\n${STUB}` }));
  await page.route("https://cdnjs.cloudflare.com/**", r=>{
    if(jszipReal && /\/jszip\/3\.10\.1\/jszip\.min\.js$/.test(r.request().url())) return r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(JSZIP_MIN) });
    return r.fulfill({ contentType: "text/javascript", body: "window.JSZip = function(){};" });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.fulfill({ contentType: "text/css", body: "" }));
  // Leaflet: se sirve el archivo EXACTO del paquete npm leaflet@1.9.4, así el
  // navegador valida el atributo integrity (SRI) contra los mismos bytes que unpkg.
  await page.route("https://unpkg.com/**", r=>{
    if(leafletFalla) return r.fulfill({ status: 404, body: "" });
    const m = new URL(r.request().url()).pathname.match(/^\/leaflet@1\.9\.4\/dist\/(.+)$/);
    if(!m || !fs.existsSync(path.join(LEAFLET_DIST, m[1]))) return r.fulfill({ status: 404, body: "" });
    const f = path.join(LEAFLET_DIST, m[1]);
    return r.fulfill({ status: 200, contentType: f.endsWith(".css") ? "text/css" : f.endsWith(".png") ? "image/png" : "text/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: fs.readFileSync(f) });
  });
  await page.route(/tile\.openstreetmap\.org|arcgisonline\.com/, r=>r.fulfill({ contentType: "image/png", body: TESELA }));
  await page.goto(base + "/index.html");
  await page.waitForSelector(".inventario-tecnologico-topbar", { timeout: 10000 });
  return { context, page, errores };
}

const SEL = {
  panel: "#inventario-tecnologico-mapa-panel",
  titulo: "#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo",
  marcador: nombre=>`.leaflet-marker-icon[aria-label="${nombre}"]`,
  linea: estilo=>`path.inventario-tecnologico-mapa-linea-${estilo}`,
  lineas: "path.inventario-tecnologico-mapa-linea",
  etiquetas: ".leaflet-tooltip.inventario-tecnologico-mapa-etiqueta-enlace",
  agrupado: ".inventario-tecnologico-mapa-agrupado",
  tab: id=>`.inventario-tecnologico-tab-btn[data-tab="${id}"]`,
  equipo: id=>`#inventario-tecnologico-mapa-panel [data-accion="seleccionar-equipo"][data-id="${id}"]`,
  chip: (data, valor)=>`.inventario-tecnologico-mapa-filtros [data-${data}="${valor}"]`,
  simular: id=>`#inventario-tecnologico-mapa-panel [data-accion="simular-caida"][data-id="${id}"]`,
};

// v12 (3.3): las opciones de los filtros del mapa viven en desplegables. Se
// abre el que corresponde (si está cerrado), se hace clic en la opción y se
// vuelve a cerrar, para que el panel no tape el mapa en el clic siguiente.
async function abrirFiltroDe(page, selector){
  const el = page.locator(selector).first();
  if(await el.isVisible()) return el;
  const id = await el.evaluate(n=>n.closest("[data-desplegable]")?.dataset.desplegable || null);
  if(id){
    await page.click(`#inventario-tecnologico-mapa-dd-${id}`);
    await el.waitFor({ state: "visible", timeout: 3000 });
  }
  return el;
}
async function cerrarFiltros(page){
  const abierto = page.locator('.inventario-tecnologico-mapa-desplegable-btn[aria-expanded="true"]');
  if(await abierto.count()) await abierto.first().click();
}
async function clicFiltro(page, selector, { cerrar = true } = {}){
  await (await abrirFiltroDe(page, selector)).click();
  if(cerrar) await cerrarFiltros(page);
}
async function marcarFiltro(page, selector, marcar = true){
  const el = await abrirFiltroDe(page, selector);
  if(marcar) await el.check(); else await el.uncheck();
  await cerrarFiltros(page);
}

async function irAlMapa(page){
  await page.click(SEL.tab("mapa"));
  await page.waitForSelector(".leaflet-marker-icon", { timeout: 10000 });
  await page.waitForFunction(()=>!!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-cifras, #inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo"));
}
// Espera a que el mapa termine de moverse (encuadres animados): un clic en un
// marcador que todavía se desplaza puede caer en el fondo del mapa.
// v15: waitForFunction no espera una función async (la promesa ya cuenta como
// verdadera): se deja a mano la función que da el mapa y se consulta sin await.
async function exponerMapa(page){
  await page.evaluate(async ()=>{ if(!window.__mapaActual) window.__mapaActual = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual; });
}
async function mapaQuieto(page){
  await exponerMapa(page);
  await page.waitForFunction(()=>{
    const m = window.__mapaActual();
    return !m || (!m._animatingZoom && !(m._panAnim && m._panAnim._inProgress));
  }, null, { timeout: 5000 });
  await page.waitForTimeout(120);
}
async function clicVacio(page){
  const caja = await page.locator("#inventario-tecnologico-mapa-canvas").boundingBox();
  await page.mouse.click(caja.x + caja.width / 2, caja.y + 18);
}
const texto = (page, sel)=>page.locator(sel).first().innerText();
const db = (page, t)=>page.evaluate(t=>window.__DB__[t], t);
const cuenta = (page, sel)=>page.locator(sel).count();
async function esperarCuenta(page, sel, n, detalle = ""){
  try{ await page.waitForFunction(([s, n])=>document.querySelectorAll(s).length === n, [sel, n], { timeout: 4000 }); }
  catch(e){ throw new Error(`${detalle || sel}: se esperaban ${n}, hay ${await cuenta(page, sel)}`); }
}
async function confirmar(page){
  await page.waitForSelector("#inventario-tecnologico-btn-confirmar-si");
  await page.click("#inventario-tecnologico-btn-confirmar-si");
}
// Selector de servidor (v8): abre el panel y hace clic en la opción.
async function elegirServidor(page, valor, id = "inventario-tecnologico-equipo-servidor"){
  await page.click(`#${id}-boton`);
  await page.waitForSelector(`#${id}-panel:not([hidden])`);
  await page.click(`#${id}-lista [data-clave="${valor}"]`);
  await page.waitForSelector(`#${id}-panel[hidden]`, { state: "attached" });
}
async function esperarSinModal(page){ await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal")); }
async function toast(page, re){ await page.waitForFunction(re=>new RegExp(re).test(document.querySelector(".inventario-tecnologico-toast-stack")?.innerText || ""), re.source, { timeout: 4000 }); }
// Llegar a una ubicación desde la lista del panel (como haría alguien con
// teclado, o cuando el marcador quedó fuera de la vista tras un encuadre).
async function irAUbicacionDesdePanel(page, id){
  if(await page.locator(`${SEL.panel} [data-accion="volver-resumen"]`).count()) await page.click(`${SEL.panel} [data-accion="volver-resumen"]`);
  await page.click(`${SEL.panel} [data-accion="ver-ubicacion"][data-id="${id}"]`);
  await page.waitForSelector(SEL.titulo);
}
async function seleccionarEquipoDesdeSuUbicacion(page, ubicacionId, equipoId){
  await irAUbicacionDesdePanel(page, ubicacionId);
  await page.click(SEL.equipo(equipoId));
  await page.waitForSelector(`${SEL.panel} [data-equipo-id="${equipoId}"].inventario-tecnologico-mapa-equipo-sel`);
}
// Antes de la captura se deja terminar el encuadre (el mapa anima los cambios de vista).
async function captura(page, nombre){
  await page.waitForTimeout(900);
  if(process.env.DEPURAR) console.log("   [captura]", nombre, JSON.stringify(await page.evaluate(async ()=>{
    const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual();
    return m ? { zoom: m.getZoom(), centro: m.getCenter(), lineas: document.querySelectorAll("path.inventario-tecnologico-mapa-linea").length } : null;
  })));
  await page.screenshot({ path: path.join(CAPTURAS, nombre) });
}

// ------------------------------------------------------------------ escenarios
async function escenarioAdmin(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());

  await verificar("la pestaña Mapa aparece para el admin, después de Bajas", async ()=>{
    const tabs = await page.locator(".inventario-tecnologico-tab-btn").allInnerTexts();
    exigir(tabs.indexOf("Mapa") === tabs.indexOf("Bajas") + 1, "orden: " + tabs.join(", "));
  });
  await irAlMapa(page);
  await verificar("Leaflet cargó con SRI desde el mismo archivo que unpkg", async ()=>{
    const v = await page.evaluate(()=>window.L && window.L.version);
    exigir(v === "1.9.4", "window.L.version = " + v);
    const integ = await page.evaluate(()=>[...document.querySelectorAll('script[src*="unpkg.com/leaflet"], link[href*="unpkg.com/leaflet"]')].map(e=>e.getAttribute("integrity")));
    exigir(integ.length === 2 && integ.every(Boolean), "faltan atributos integrity");
  });
  await verificar("un marcador por ubicación (13) y el resumen cuenta equipos, radioenlaces y la red", async ()=>{
    exigir(await cuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono") === 13, "marcadores: " + await cuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono"));
    const t = await texto(page, SEL.panel);
    exigir(/13\s*ubicaciones/.test(t) && /18\s*equipos de red/.test(t) && /13\s*radioenlaces/.test(t) && /2\s*activos ubicados/.test(t), t.replace(/\s+/g, " ").slice(0, 240));
    exigir(/1 raíz · 2 enlaces backbone · 11 enlaces P2MP · 1 respaldo registrado/.test(t), "línea de la red: " + t.replace(/\s+/g, " ").slice(0, 400));
  });
  await verificar("por defecto: 2 líneas backbone y 2 P2MP; el AP con 9 clientes queda agrupado; respaldos ocultos", async ()=>{
    await esperarCuenta(page, SEL.linea("backbone"), 2);
    await esperarCuenta(page, SEL.linea("p2mp"), 2);
    exigir(await cuenta(page, SEL.linea("respaldo")) === 0, "se ven respaldos");
    const g = await texto(page, SEL.agrupado);
    exigir(/AP Sector Norte · 9 clientes/.test(g), "indicador: " + g);
  });
  await verificar("la barra (v12): desplegables Ubicaciones, Líneas y Equipos con su cuenta, Simulación y «Quitar filtros»; las opciones con sus conteos", async ()=>{
    const t = await texto(page, ".inventario-tecnologico-mapa-filtros");
    for(const re of [/Ubicaciones\s*4\/4/, /Líneas\s*2\/3/, /Equipos\s*4\/4/, /Simulación de fallas/, /Quitar filtros/]) exigir(re.test(t), `falta ${re}: ${t.replace(/\s+/g, " ")}`);
    const todo = await page.locator(".inventario-tecnologico-mapa-filtros").evaluate(n=>n.textContent);
    for(const re of [/Torre\s*2/, /Backbone\s*2/, /P2MP\s*11/, /Respaldos\s*1/, /Raíz\s*1/, /Distribución\s*2/, /Cliente\s*11/]) exigir(re.test(todo), `falta ${re}: ${todo.replace(/\s+/g, " ")}`);
    exigir(await page.locator(SEL.chip("linea", "respaldos")).getAttribute("aria-pressed") === "false", "Respaldos no arranca apagado");
    exigir(await page.locator("#inventario-tecnologico-mapa-quitar-filtros").isDisabled(), "«Quitar filtros» habilitado sin filtros");
  });
  await captura(page, "01-red.png");

  // Torre → equipos → camino a la raíz
  await page.click(SEL.marcador("Torre Cerro Azul"));
  await verificar("clic en la torre abre su panel con sus 3 equipos y su rol", async ()=>{
    exigir((await texto(page, SEL.titulo)) === "Torre Cerro Azul", "título: " + await texto(page, SEL.titulo));
    exigir(await cuenta(page, `${SEL.panel} [data-accion="seleccionar-equipo"]`) === 3, "equipos listados");
    const t = await texto(page, SEL.panel);
    exigir(/AP Sector Norte[\s\S]*Distribución/.test(t) && /PTP CA ← Oficina[\s\S]*Backbone/i.test(t), t.replace(/\s+/g, " ").slice(0, 300));
  });
  await page.click(SEL.equipo(11));
  await verificar("seleccionar el AP agrupado despliega sus 9 líneas y resalta su camino hasta la raíz", async ()=>{
    await esperarCuenta(page, `${SEL.linea("p2mp")}:not(.inventario-tecnologico-mapa-linea-atenuada)`, 9, "líneas P2MP sin atenuar");
    await esperarCuenta(page, SEL.linea("cadena"), 1, "tramos del camino");
    exigir(await page.locator(`${SEL.linea("cadena")}[data-cliente-id="10"]`).count() === 1, "el tramo resaltado no es PTP CA ← Oficina");
    exigir(/▾/.test(await texto(page, SEL.agrupado)), "el indicador no quedó como expandido");
  });
  await verificar("el camino del panel lista los saltos, incluidos los de cable, hasta la raíz", async ()=>{
    const t = await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-camino`);
    exigir(/AP Sector Norte[\s\S]*cable[\s\S]*PTP CA ← Oficina[\s\S]*PTP Oficina → CA[\s\S]*cable[\s\S]*Router Oficina/.test(t), t.replace(/\s+/g, " "));
    exigir(/3 saltos/.test(await texto(page, SEL.panel)), "no cuenta 3 saltos");
  });
  await verificar("el resto del mapa se atenúa (líneas y marcadores fuera del camino)", async ()=>{
    exigir(await cuenta(page, ".inventario-tecnologico-mapa-linea-atenuada") >= 3, "líneas atenuadas: " + await cuenta(page, ".inventario-tecnologico-mapa-linea-atenuada"));
    exigir(await cuenta(page, `${SEL.marcador("Bodega Sur")} .inventario-tecnologico-mapa-pin-atenuada`) === 1, "Bodega Sur no se atenuó");
    exigir(await cuenta(page, `${SEL.marcador("Oficina Centro")} .inventario-tecnologico-mapa-pin-atenuada`) === 0, "la Oficina (raíz del camino) se atenuó");
  });
  await captura(page, "02-camino-ap.png");

  // Un cliente: su camino atraviesa el P2MP y el backbone
  await page.click(`${SEL.panel} .inventario-tecnologico-mapa-sublista [data-accion="seleccionar-equipo-mapa"][data-id="101"]`);
  const esperada = fmtDistancia(distanciaKm(PISCINAS[0], UBIC.cerroAzul));
  await verificar(`un cliente del AP: camino con 2 líneas resaltadas y la distancia a su servidor (${esperada})`, async ()=>{
    await page.waitForFunction(()=>document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo")?.textContent === "Piscina 1");
    await esperarCuenta(page, SEL.linea("cadena"), 2, "tramos del camino");
    const etiquetas = await page.locator(SEL.etiquetas).allInnerTexts();
    exigir(etiquetas.some(e=>e.includes(esperada)), "etiquetas: " + etiquetas.join(" | "));
    const t = await texto(page, SEL.panel);
    exigir(t.includes(esperada) && /azimut desde aquí/i.test(t) && /4 saltos/.test(t), t.replace(/\s+/g, " ").slice(0, 400));
  });
  await mapaQuieto(page);
  await page.click(SEL.marcador("Torre Cerro Azul"));
  await verificar("clic en el marcador de su servidor pasa al AP y el camino se sigue viendo", async ()=>{
    await page.waitForSelector(`${SEL.equipo(11)}[aria-pressed="true"]`);
    await esperarCuenta(page, SEL.linea("cadena"), 1);
  });

  await clicVacio(page);
  await verificar("clic en un área vacía suelta la selección: el AP vuelve a quedar agrupado", async ()=>{
    await page.waitForSelector(`${SEL.panel} .inventario-tecnologico-mapa-cifras`);
    await esperarCuenta(page, SEL.linea("cadena"), 0);
    await esperarCuenta(page, SEL.linea("p2mp"), 2);
  });

  // ---------------- Toggles
  await clicFiltro(page, SEL.chip("linea", "p2mp"));
  await verificar("toggle P2MP: oculta las líneas de distribución y deja el backbone", async ()=>{
    await esperarCuenta(page, SEL.linea("p2mp"), 0);
    await esperarCuenta(page, SEL.linea("backbone"), 2);
  });
  await clicFiltro(page, SEL.chip("linea", "backbone"));
  await verificar("toggle Backbone: sin líneas", async ()=>{ await esperarCuenta(page, SEL.lineas, 0); });
  await clicFiltro(page, SEL.chip("linea", "respaldos"));
  await verificar("toggle Respaldos (apagado de fábrica): muestra el respaldo registrado, punteado", async ()=>{
    await esperarCuenta(page, SEL.linea("respaldo"), 1);
    exigir(await page.locator(`${SEL.linea("respaldo")}[data-cliente-id="101"][data-servidor-id="21"]`).count() === 1, "no es Piscina 1 → AP Santa Ana");
  });
  for(const l of ["respaldos", "backbone", "p2mp"]) await clicFiltro(page, SEL.chip("linea", l));
  await esperarCuenta(page, SEL.lineas, 4);
  await clicFiltro(page, SEL.chip("rol", "cliente"));
  await verificar("filtro de equipos por tipo: ocultar «Cliente» saca las piscinas y la bodega (solo tienen clientes)", async ()=>{
    await esperarCuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono", 3, "marcadores");
    exigir(await cuenta(page, SEL.agrupado) === 1, "el indicador del AP (distribución) debería seguir");
  });
  await clicFiltro(page, SEL.chip("rol", "cliente"));
  await clicFiltro(page, SEL.chip("tipo", "torre"));
  await verificar("el filtro por tipo de ubicación sigue funcionando (sin torres: 11 marcadores)", async ()=>{
    await esperarCuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono", 11);
  });
  await clicFiltro(page, SEL.chip("tipo", "torre"));
  await esperarCuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono", 13);

  // ---------------- Simulación de fallas
  await seleccionarEquipoDesdeSuUbicacion(page, 10, 101);
  await page.click(SEL.simular(101));
  await verificar("simular caída de un equipo CON respaldo: conmuta solo al de prioridad 1 y se dibuja «recuperado vía respaldo»", async ()=>{
    await page.waitForSelector(`${SEL.simular(101)}[aria-pressed="true"]`);
    const t = await texto(page, SEL.panel);
    exigir(/Recuperado vía respaldo[\s\S]*AP Santa Ana[\s\S]*prioridad 1/.test(t), t.replace(/\s+/g, " ").slice(0, 500));
    await esperarCuenta(page, SEL.linea("cadenaRespaldo"), 1, "respaldo en uso (en el camino)");
    const etiquetas = await page.locator(SEL.etiquetas).allInnerTexts();
    exigir(etiquetas.some(e=>/↺ vía respaldo → Torre Santa Ana/.test(e)), "etiquetas: " + etiquetas.join(" | "));
    exigir(await cuenta(page, SEL.linea("cortado")) === 1, "no se ve su enlace cortado");
    exigir(await page.locator("#inventario-tecnologico-mapa-simulacion").getAttribute("aria-pressed") === "true", "el toggle de simulación no quedó activo");
    exigir(/1 caído \(1 recuperado vía respaldo\) · 0 vía respaldo · 0 sin conectividad/.test(await texto(page, "#inventario-tecnologico-mapa-aviso-sim")), await texto(page, "#inventario-tecnologico-mapa-aviso-sim"));
  });
  await captura(page, "03-simulacion-respaldo.png");
  await verificar("el camino simulado sale por Santa Ana (PTP SA ← CA) y no por el AP caído", async ()=>{
    const t = await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-camino`);
    exigir(/vía respaldo[\s\S]*AP Santa Ana[\s\S]*PTP SA ← CA[\s\S]*PTP CA → SA/.test(t), t.replace(/\s+/g, " "));
  });
  await page.click(`${SEL.panel} [data-accion="volver-resumen"]`);
  await verificar("sin selección, el resumen de la simulación dice a qué respaldo conmutó el caído", async ()=>{
    await page.waitForFunction(()=>/recuperado vía respaldo/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    const t = await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-sim-lista`);
    exigir(/↺ recuperado vía respaldo → AP Santa Ana/.test(t), t.replace(/\s+/g, " "));
  });
  await seleccionarEquipoDesdeSuUbicacion(page, 10, 101);
  await page.click(`${SEL.panel} [data-accion="restablecer-simulacion"]`);
  await verificar("Restablecer simulación: vuelve todo a la normalidad (el modo sigue activo)", async ()=>{
    await page.waitForSelector(`${SEL.simular(101)}[aria-pressed="false"]`);
    await esperarCuenta(page, SEL.linea("cortado"), 0);
    exigir(/Simulación activa/.test(await texto(page, "#inventario-tecnologico-mapa-aviso-sim")), "el aviso no quedó en modo activo");
  });

  await seleccionarEquipoDesdeSuUbicacion(page, 2, 20);
  await page.click(SEL.simular(20));
  await verificar("simular caída de un equipo SIN respaldo: su subárbol entero queda sin conectividad", async ()=>{
    await page.waitForFunction(()=>/Caído y sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    exigir(/1 caído · 0 vía respaldo · 3 sin conectividad/.test(await texto(page, "#inventario-tecnologico-mapa-aviso-sim")), await texto(page, "#inventario-tecnologico-mapa-aviso-sim"));
    exigir(await cuenta(page, `${SEL.marcador("Bodega Sur")} .inventario-tecnologico-mapa-pin-sin-conexion`) === 1, "Bodega Sur no se marca sin conexión");
    exigir(await cuenta(page, `${SEL.marcador("Torre Santa Ana")} .inventario-tecnologico-mapa-pin-sin-conexion`) === 1, "Santa Ana no se marca sin conexión");
    exigir(await cuenta(page, `${SEL.linea("sinConexion")}[data-cliente-id="40"]`) === 1, "la línea a la bodega no quedó punteada gris");
    exigir(await cuenta(page, `${SEL.linea("cortado")}[data-cliente-id="20"]`) === 1, "el enlace de subida no quedó cortado");
  });
  await captura(page, "04-simulacion-sin-respaldo.png");
  await seleccionarEquipoDesdeSuUbicacion(page, 10, 101);
  await page.click(SEL.simular(101));
  await verificar("fallas encadenadas: si su único respaldo también perdió el servicio, queda sin conectividad", async ()=>{
    await page.waitForFunction(()=>/Caído y sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    exigir(/2 caídos · 0 vía respaldo · 3 sin conectividad/.test(await texto(page, "#inventario-tecnologico-mapa-aviso-sim")), await texto(page, "#inventario-tecnologico-mapa-aviso-sim"));
  });
  await clicFiltro(page, SEL.chip("estado", "sin_conexion"));
  await verificar("filtro por estado de la simulación: ocultar «Sin conectividad» saca la bodega", async ()=>{
    await esperarCuenta(page, SEL.marcador("Bodega Sur"), 0);
  });
  await clicFiltro(page, SEL.chip("estado", "sin_conexion"));
  await page.click("#inventario-tecnologico-mapa-simulacion");
  await verificar("apagar el modo simulación muestra la red normal sin perder el escenario", async ()=>{
    await esperarCuenta(page, SEL.linea("cortado"), 0);
    exigir(await page.locator("#inventario-tecnologico-mapa-aviso-sim").isHidden(), "el aviso sigue visible");
    await page.click("#inventario-tecnologico-mapa-simulacion");
    await page.waitForFunction(()=>/2 caídos/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
  });
  await page.click("#inventario-tecnologico-mapa-sim-restablecer");
  await page.click('#inventario-tecnologico-mapa-aviso-sim [data-sim-accion="salir"]');
  await verificar("nada de la simulación se escribió en la base", async ()=>{
    const escrituras = await page.evaluate(()=>window.__ESCRITURAS__.length);
    exigir(escrituras === 0, `escrituras: ${escrituras}`);
  });

  // ---------------- Formularios de administrador: equipo con servidor, respaldos
  await irAUbicacionDesdePanel(page, 4);
  await page.click(`${SEL.panel} [data-accion="nuevo-equipo"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-servidor-boton");
  await page.fill("#inventario-tecnologico-equipo-nombre", "Cámara Bodega");
  await elegirServidor(page, "40");
  await verificar("equipo nuevo: el servidor en la misma ubicación se ofrece primero y se explica como cable", async ()=>{
    await page.click("#inventario-tecnologico-equipo-servidor-boton");
    const primeras = await page.locator("#inventario-tecnologico-equipo-servidor-lista [role=option]").evaluateAll(l=>l.slice(0, 2).map(x=>x.dataset.clave + ":" + x.innerText.replace(/\s+/g, " ")));
    await page.keyboard.press("Escape");
    exigir(primeras[0].startsWith(":Ninguno") && /^40:.*misma ubicación/.test(primeras[1]), primeras.join(" | "));
    exigir(/Por cable/.test(await texto(page, "#inventario-tecnologico-equipo-servidor-calculo")), await texto(page, "#inventario-tecnologico-equipo-servidor-calculo"));
  });
  await elegirServidor(page, "21");
  await verificar("… y uno en otra ubicación muestra distancia y azimut", async ()=>{
    exigir(/Radioenlace con «AP Santa Ana».*km · azimut desde aquí/.test(await texto(page, "#inventario-tecnologico-equipo-servidor-calculo")), await texto(page, "#inventario-tecnologico-equipo-servidor-calculo"));
  });
  await verificar("el formulario de equipo ya no pide banda ni frecuencia", async ()=>{
    exigir(await cuenta(page, "#inventario-tecnologico-equipo-banda, #inventario-tecnologico-equipo-frecuencia") === 0, "siguen los campos");
  });
  await page.click("#inventario-tecnologico-equipo-guardar");
  await verificar("crear equipo con servidor: se guarda servidor_id (sin banda ni frecuencia) y aparece su línea", async ()=>{
    await esperarSinModal(page);
    const e = (await db(page, "equipos_radioenlace")).find(x=>x.nombre === "Cámara Bodega");
    exigir(e && e.servidor_id === 21 && (e.banda ?? null) === null && (e.frecuencia_mhz ?? null) === null, JSON.stringify(e));
    await page.waitForSelector(`${SEL.lineas}[data-cliente-id="${e.id}"]`);
  });
  const idCamara = (await db(page, "equipos_radioenlace")).find(x=>x.nombre === "Cámara Bodega").id;

  await seleccionarEquipoDesdeSuUbicacion(page, 1, 10);
  await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="10"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-servidor-boton");
  await verificar("editar equipo: no ofrece como servidor a él mismo ni a nada de su subárbol (armaría un ciclo)", async ()=>{
    const valores = await page.locator("#inventario-tecnologico-equipo-servidor option").evaluateAll(o=>o.map(x=>x.value));
    for(const prohibido of ["10", "11", "12", "20", "21", "32", "40", "101", String(idCamara)]) exigir(!valores.includes(prohibido), `ofrece ${prohibido}: ${valores.join(",")}`);
    exigir(valores.includes("31") && valores.includes("30") && valores.includes(""), "faltan 30/31/raíz");
    exigir((await page.inputValue("#inventario-tecnologico-equipo-servidor")) === "31", "no quedó elegido su servidor actual");
  });
  await page.click("#inventario-tecnologico-equipo-guardar");
  await verificar("editar y guardar un equipo no borra la banda ni la frecuencia que ya tenía", async ()=>{
    await esperarSinModal(page);
    const parche = await page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "equipos_radioenlace" && e.op === "update").pop()?.parche);
    exigir(parche && !("banda" in parche) && !("frecuencia_mhz" in parche), JSON.stringify(parche));
    const e = (await db(page, "equipos_radioenlace")).find(x=>x.id === 10);
    exigir(e.banda === "5 GHz" && e.frecuencia_mhz === 5745, JSON.stringify(e));
  });

  await seleccionarEquipoDesdeSuUbicacion(page, 3, 32);
  await page.click(`${SEL.panel} [data-accion="nuevo-respaldo"][data-id="32"]`);
  await page.waitForSelector("#inventario-tecnologico-respaldo-servidor-boton");
  await verificar("formulario de respaldo: no ofrece al propio equipo ni a su servidor actual; prioridad sugerida 1", async ()=>{
    const valores = await page.locator("#inventario-tecnologico-respaldo-servidor option").evaluateAll(o=>o.map(x=>x.value));
    exigir(!valores.includes("32") && !valores.includes("21") && valores.includes("11"), valores.join(","));
    exigir((await page.inputValue("#inventario-tecnologico-respaldo-prioridad")) === "1", "prioridad sugerida");
  });
  await elegirServidor(page, "11", "inventario-tecnologico-respaldo-servidor");
  await page.fill("#inventario-tecnologico-respaldo-prioridad", "0");
  await page.click("#inventario-tecnologico-respaldo-guardar");
  await verificar("prioridad 0 se rechaza antes de ir a la base", async ()=>{
    await page.waitForFunction(()=>/desde 1/.test(document.querySelector('[data-error="prioridad"]')?.textContent || ""));
  });
  await page.fill("#inventario-tecnologico-respaldo-prioridad", "1");
  await page.click("#inventario-tecnologico-respaldo-guardar");
  await verificar("crear respaldo: se guarda y aparece en el panel con su prioridad", async ()=>{
    await esperarSinModal(page);
    const r = (await db(page, "enlaces_respaldo")).find(x=>x.equipo_id === 32);
    exigir(r && r.servidor_alternativo_id === 11 && r.prioridad === 1, JSON.stringify(r));
    await page.waitForSelector(`${SEL.panel} [data-respaldo-id="${r.id}"]`);
  });
  const idResp = (await db(page, "enlaces_respaldo")).find(x=>x.equipo_id === 32).id;
  await page.click(`${SEL.panel} [data-accion="editar-respaldo"][data-id="${idResp}"]`);
  await page.waitForSelector("#inventario-tecnologico-respaldo-prioridad");
  await page.fill("#inventario-tecnologico-respaldo-prioridad", "2");
  await page.click("#inventario-tecnologico-respaldo-guardar");
  await verificar("editar respaldo: cambia la prioridad", async ()=>{
    await esperarSinModal(page);
    exigir((await db(page, "enlaces_respaldo")).find(x=>x.id === idResp).prioridad === 2, "prioridad");
  });
  await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="32"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-servidor-boton");
  await elegirServidor(page, "11");
  await page.click("#inventario-tecnologico-equipo-guardar");
  await verificar("usar un respaldo como servidor principal: sale de la lista de respaldos (y se avisa)", async ()=>{
    await esperarSinModal(page);
    exigir((await db(page, "equipos_radioenlace")).find(x=>x.id === 32).servidor_id === 11, "servidor");
    exigir(!(await db(page, "enlaces_respaldo")).some(x=>x.id === idResp), "el respaldo sigue");
    await toast(page, /pasó a ser el principal/);
  });

  await seleccionarEquipoDesdeSuUbicacion(page, 2, 21);
  await page.click(`${SEL.panel} [data-accion="eliminar-equipo"][data-id="21"]`);
  await verificar("eliminar un equipo que es servidor de otros se rechaza con un mensaje claro", async ()=>{
    await toast(page, /lo tienen? como servidor/);
    exigir((await db(page, "equipos_radioenlace")).some(x=>x.id === 21), "se borró");
  });
  await seleccionarEquipoDesdeSuUbicacion(page, 4, idCamara);
  await page.click(`${SEL.panel} [data-accion="eliminar-equipo"][data-id="${idCamara}"]`);
  await confirmar(page);
  await verificar("eliminar un equipo hoja: desaparece de la base y del mapa", async ()=>{
    await page.waitForFunction(id=>!document.querySelector(`path[data-cliente-id="${id}"]`), idCamara);
    exigir(!(await db(page, "equipos_radioenlace")).some(x=>x.id === idCamara), "sigue en la base");
  });

  // ---------------- Ubicaciones y activos (como en la parte 1)
  await page.click("#inventario-tecnologico-mapa-nueva-ubicacion");
  await page.waitForSelector("#inventario-tecnologico-ubic-nombre");
  await page.fill("#inventario-tecnologico-ubic-nombre", "Bodega Norte");
  await page.selectOption("#inventario-tecnologico-ubic-tipo", "bodega");
  await page.fill("#inventario-tecnologico-ubic-coords", "https://www.google.com/maps/@-2.1402,-79.9105,16z");
  await verificar("el formulario de ubicación lee un enlace de Google Maps", async ()=>{
    exigir((await texto(page, "#inventario-tecnologico-ubic-coords-lectura")).includes("-2.140200, -79.910500"), await texto(page, "#inventario-tecnologico-ubic-coords-lectura"));
  });
  await page.click("#inventario-tecnologico-ubic-guardar");
  await verificar("crear ubicación: se guarda y queda seleccionada", async ()=>{
    await esperarCuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono", 14);
    exigir((await texto(page, SEL.titulo)) === "Bodega Norte", "no quedó seleccionada");
  });
  await irAUbicacionDesdePanel(page, 1);
  await page.click(`${SEL.panel} [data-accion="asignar-activos"]`);
  await page.waitForSelector("#inventario-tecnologico-asignar-lista");
  await page.check("#inventario-tecnologico-asignar-incluir");
  await verificar("asignar activos: con «Incluir…» el que es radio queda bloqueado", async ()=>{
    exigir(await page.locator('#inventario-tecnologico-asignar-lista input[value="2"]').isDisabled(), "LKM-002 (radio) no está bloqueado");
  });
  await page.check('#inventario-tecnologico-asignar-lista input[value="1"]');
  await page.click("#inventario-tecnologico-asignar-guardar");
  await verificar("asignar: el activo se mueve (tramo anterior cerrado, nuevo vigente)", async ()=>{
    await esperarSinModal(page);
    const tramos = (await db(page, "historial_ubicacion")).filter(x=>x.activo_id === 1);
    exigir(tramos.length === 2 && tramos.find(t=>t.ubicacion_id === 3).hasta === HOY && tramos.find(t=>t.ubicacion_id === 1).hasta === null, JSON.stringify(tramos));
  });
  await page.click(`${SEL.panel} [data-accion="quitar-activo"][data-id="1"]`);
  await confirmar(page);
  await verificar("quitar ubicación: cierra el tramo", async ()=>{
    await page.waitForFunction(()=>!document.querySelector('#inventario-tecnologico-mapa-panel [data-activo-id="1"]'));
  });
  await page.click(`${SEL.panel} [data-accion="eliminar-ubicacion"]`);
  await confirmar(page);
  await verificar("eliminar una ubicación con equipos se rechaza con un mensaje que sugiere archivar", async ()=>{
    await toast(page, /No se puede eliminar/);
    exigir((await db(page, "ubicaciones")).some(u=>u.id === 1), "se borró");
  });

  // Detalle del activo: bloque Ubicación + "Ver en mapa"
  await page.click(SEL.tab("activos"));
  await verificar("volver a Activos libera el mapa", async ()=>{
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-mapa-canvas"));
  });
  await page.locator("tr", { hasText: "LKM-002" }).first().click();
  await verificar("el detalle del activo muestra su ubicación actual y que es un radio", async ()=>{
    await page.waitForFunction(()=>/Oficina Centro/.test(document.getElementById("inventario-tecnologico-ubicacion-activo")?.innerText || ""));
    const t = await texto(page, "#inventario-tecnologico-ubicacion-activo");
    exigir(/instalado como equipo de radioenlace «SM Oficina»/.test(t) && /Ver en mapa/.test(t), t);
  });
  await page.click('[data-ubic-accion="ver-en-mapa"]');
  await verificar("«Ver en mapa» abre la pestaña Mapa con su equipo seleccionado y su camino", async ()=>{
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="32"].inventario-tecnologico-mapa-equipo-sel`, { timeout: 10000 });
    await esperarCuenta(page, SEL.linea("cadena"), 2, "tramos del camino de SM Oficina"); // SM Oficina ← AP Sector Norte y CA ← Oficina (los de cable no tienen línea)
  });

  await verificar("sin errores de JavaScript en toda la sesión de admin", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

async function escenarioPermisos(browser, base){
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture({ rol: "registrador" }));
    await verificar("registrador sin «ver_mapa»: la pestaña Mapa no aparece", async ()=>{
      const tabs = await page.locator(".inventario-tecnologico-tab-btn").allInnerTexts();
      exigir(!tabs.includes("Mapa"), tabs.join(", "));
    });
    await page.locator("tr", { hasText: "LKM-002" }).first().click();
    await verificar("registrador sin «ver_mapa»: el detalle igual dice que el activo es un radio (equipo_radio_de_activo), sin «Ver en mapa»", async ()=>{
      await page.waitForFunction(()=>/Oficina Centro/.test(document.getElementById("inventario-tecnologico-ubicacion-activo")?.innerText || ""));
      const t = await texto(page, "#inventario-tecnologico-ubicacion-activo");
      exigir(/instalado como equipo de radioenlace «SM Oficina»/.test(t) && !/Ver en mapa/.test(t), t);
      // La tabla de equipos (la red) no le devuelve nada: el dato vino de la función.
      const directo = await page.evaluate(async ()=>(await window.supabase.createClient().from("equipos_radioenlace").select("*")).data.length);
      exigir(directo === 0, `la tabla de equipos le devolvió ${directo} filas`);
    });
    await verificar("sin errores de JavaScript (registrador sin mapa)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture({ rol: "registrador", permitidas: ["ver_mapa"] }));
    await irAlMapa(page);
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
    await verificar("con «ver_mapa»: ve la red y puede simular, pero no editar equipos ni respaldos", async ()=>{
      exigir(await page.locator("#inventario-tecnologico-mapa-nueva-ubicacion").count() === 0, "ve «+ Ubicación»");
      for(const a of ["editar-ubicacion","nuevo-equipo","editar-equipo","eliminar-equipo","nuevo-respaldo"]){
        exigir(await page.locator(`${SEL.panel} [data-accion="${a}"]`).count() === 0, `ve la acción ${a}`);
      }
      exigir(await page.locator(SEL.simular(11)).count() === 1, "no ve «Simular caída»");
    });
    await page.click(SEL.simular(11));
    await verificar("… y su simulación también es solo local", async ()=>{
      // 9 clientes: la Piscina 1 conmuta a su respaldo (AP Santa Ana) y las otras 8 quedan sin conectividad.
      await page.waitForFunction(()=>/1 caído · 1 vía respaldo · 8 sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
      exigir(await page.evaluate(()=>window.__ESCRITURAS__.length) === 0, "escribió en la base");
    });
    await verificar("sin errores de JavaScript (registrador con ver_mapa)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

async function escenarioFallas(browser, base){
  {
    const fx = fixture({ fallas: { "rpc:equipo_radio_de_activo": { code: "PGRST202", message: "Could not find the function public.equipo_radio_de_activo(p_activo_id) in the schema cache" } } });
    const { context, page } = await abrirApp(browser, base, fx);
    await page.locator("tr", { hasText: "LKM-002" }).first().click();
    await verificar("sin la migración 004: el bloque Ubicación del detalle dice qué migración falta", async ()=>{
      await page.waitForFunction(()=>/004_permisos_y_fechas/.test(document.getElementById("inventario-tecnologico-ubicacion-activo")?.innerText || ""));
    });
    await context.close();
  }
  {
    const falta = { code: "PGRST205", message: "Could not find the table 'public.ubicaciones' in the schema cache" };
    const fx = fixture({ fallas: { tipos_ubicacion: falta, ubicaciones: falta, equipos_radioenlace: falta, enlaces_respaldo: falta, historial_ubicacion: falta } });
    const { context, page } = await abrirApp(browser, base, fx);
    await page.click(SEL.tab("mapa"));
    await verificar("sin las tablas del mapa: la pestaña explica que falta la migración 002", async ()=>{
      await page.waitForFunction(()=>/migraciones\/002/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    });
    await context.close();
  }
  {
    const fx = fixture({ fallas: { enlaces_respaldo: { code: "PGRST205", message: "Could not find the table 'public.enlaces_respaldo' in the schema cache" } } });
    const { context, page } = await abrirApp(browser, base, fx);
    await page.click(SEL.tab("mapa"));
    await verificar("con la 002 pero sin la 003: explica que falta la migración 003", async ()=>{
      await page.waitForFunction(()=>/migraciones\/003/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    });
    await context.close();
  }
  {
    const { context, page } = await abrirApp(browser, base, fixture(), { leafletFalla: true });
    await page.click(SEL.tab("mapa"));
    await verificar("si unpkg no responde: el mapa avisa y el panel sigue usable (también la simulación)", async ()=>{
      await page.waitForFunction(()=>/No se pudo cargar la librería del mapa/.test(document.getElementById("inventario-tecnologico-mapa-canvas")?.innerText || ""));
      await seleccionarEquipoDesdeSuUbicacion(page, 2, 20);
      await page.click(SEL.simular(20));
      await page.waitForFunction(()=>/Caído y sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    });
    await context.close();
  }
}

async function escenarioCelular(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture(), { viewport: { width: 390, height: 844 } });
  await irAlMapa(page);
  await verificar("celular: los filtros arrancan plegados (el mapa se ve sin bajar) y se despliegan al tocar", async ()=>{
    exigir(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-filtros-det").open) === false, "arrancaron desplegados");
    await page.click(".inventario-tecnologico-mapa-filtros-resumen");
    await page.waitForSelector("#inventario-tecnologico-mapa-dd-lineas", { state: "visible" });
    await page.click(".inventario-tecnologico-mapa-filtros-resumen");
  });
  await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
  await verificar("celular (390 px): mapa arriba, panel abajo, sin scroll horizontal (con la barra de filtros)", async ()=>{
    await esperarCuenta(page, SEL.linea("cadena"), 1);
    const ancho = await page.evaluate(()=>document.documentElement.scrollWidth);
    exigir(ancho <= 390, `scrollWidth ${ancho}`);
    const m = await page.locator("#inventario-tecnologico-mapa-canvas").boundingBox();
    const p = await page.locator(SEL.panel).boundingBox();
    exigir(p.y >= m.y + m.height - 1, "el panel no quedó debajo del mapa");
  });
  await page.screenshot({ path: path.join(CAPTURAS, "05-celular.png"), fullPage: true });
  await verificar("sin errores de JavaScript (celular)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ capa Plano (006)
async function elegirCapa(page, nombre){
  await page.evaluate(n=>{
    const l = [...document.querySelectorAll(".leaflet-control-layers-base label")].find(x=>x.textContent.trim() === n);
    l.querySelector("input").click();
  }, nombre);
}
// Capas superpuestas (casillas): el plano y las piscinas.
async function alternarSuperpuesta(page, nombre){
  await page.evaluate(n=>{
    const l = [...document.querySelectorAll(".leaflet-control-layers-overlays label")].find(x=>x.textContent.trim() === n);
    l.querySelector("input").click();
  }, nombre);
}
const superpuestas = page=>page.evaluate(()=>[...document.querySelectorAll(".leaflet-control-layers-overlays label")].map(l=>l.textContent.trim() + (l.querySelector("input").checked ? " ✓" : "")));
const IMG_PLANO = "img.inventario-tecnologico-mapa-plano";
const matrizPlano = page=>page.evaluate(sel=>{ const m = new DOMMatrix(getComputedStyle(document.querySelector(sel)).transform); return [m.a, m.b, m.c, m.d, m.e, m.f]; }, IMG_PLANO);
const escriturasPlano = page=>page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "planos_mapa"));

async function escenarioPlano(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());
  await irAlMapa(page);
  await verificar("capas: base Mapa o Satélite; el plano de lotes es una capa superpuesta (apagada al empezar)", async ()=>{
    const t = (await page.locator(".leaflet-control-layers-base label").allInnerTexts()).map(x=>x.trim());
    exigir(t.join("|") === "Mapa|Satélite", t.join("|"));
    exigir((await superpuestas(page)).join("|") === "Plano de lotes", (await superpuestas(page)).join("|"));
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 0, "el control del plano aparece sin encender la capa");
  });
  await alternarSuperpuesta(page, "Plano de lotes");
  await verificar("Plano sobre el mapa de carreteras: imagen, control, leyenda y el navegador lo recuerda", async ()=>{
    await page.waitForFunction(sel=>{ const i = document.querySelector(`.leaflet-inventarioPlano-pane ${sel}`); return !!(i && i.complete && i.naturalWidth === 3198); }, IMG_PLANO, { timeout: 8000 });
    exigir(await page.locator(".leaflet-tile-pane img[src*='openstreetmap']").count() > 0, "sin teselas del mapa de carreteras debajo");
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 1, "sin control del plano");
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-ver-plano")) === "1", "no se recordó");
  });
  await elegirCapa(page, "Satélite");
  await verificar("Plano: la imagen carga en su pane, sobre el satélite, con su control y su leyenda", async ()=>{
    await page.waitForFunction(sel=>{ const i = document.querySelector(`.leaflet-inventarioPlano-pane ${sel}`); return !!(i && i.complete && i.naturalWidth === 3198); }, IMG_PLANO, { timeout: 8000 });
    exigir(await page.locator(".leaflet-tile-pane img[src*='arcgisonline']").count() > 0, "sin teselas del satélite debajo");
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 1, "sin control del plano");
    exigir(await page.locator("#inventario-tecnologico-mapa-plano-ajustar").count() === 1, "el admin no ve «Ajustar plano»");
    exigir(await page.evaluate(()=>!document.getElementById("inventario-tecnologico-mapa-leyenda-plano").hidden), "no se ve la leyenda del plano");
    exigir(/Consultora ZH/.test(await texto(page, ".leaflet-control-attribution")), "falta el crédito del plano");
  });
  await page.click('[data-plano="encuadrar"]');
  await page.waitForTimeout(800);
  await verificar("Plano: las tres esquinas quedan donde dicen sus coordenadas y «Ver plano» lo encuadra", async ()=>{
    const r = await page.evaluate(async sel=>{
      const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual();
      const { PLANO_POR_DEFECTO: PD } = await import("/assets/js/inventario-tecnologico/nucleo/plano-mapa.js");
      const img = document.querySelector(sel);
      const mat = new DOMMatrix(getComputedStyle(img).transform);
      const origen = m.getPixelOrigin();
      const esperado = ["no", "ne", "so"].map(k=>m.project(PD.esquinas[k])._subtract(origen));
      const real = [[0, 0], [PD.ancho_px, 0], [0, PD.alto_px]].map(([x, y])=>mat.transformPoint(new DOMPoint(x, y)));
      const caja = img.getBoundingClientRect(), lienzo = document.getElementById("inventario-tecnologico-mapa-canvas").getBoundingClientRect();
      const caja4 = ["no", "ne", "so", "se"].map(k=>m.latLngToContainerPoint(k === "se" ? [PD.esquinas.ne[0] + PD.esquinas.so[0] - PD.esquinas.no[0], PD.esquinas.ne[1] + PD.esquinas.so[1] - PD.esquinas.no[1]] : PD.esquinas[k]));
      const t = m.getSize();
      return { dif: Math.max(...esperado.map((p, i)=>Math.hypot(p.x - real[i].x, p.y - real[i].y))), dentro: caja4.every(p=>p.x >= -1 && p.y >= -1 && p.x <= t.x + 1 && p.y <= t.y + 1), detalle: JSON.stringify({ caja4: caja4.map(p=>[Math.round(p.x), Math.round(p.y)]), t, zoom: m.getZoom() }) };
    }, IMG_PLANO);
    exigir(r.dif < 0.05, `las esquinas quedaron a ${r.dif.toFixed(3)} px de su lugar`);
    exigir(r.dentro, "«Ver plano» no dejó el plano entero a la vista: " + r.detalle);
  });
  await captura(page, "20-plano.png");
  await verificar("opacidad del plano: cambia la imagen y el navegador la recuerda", async ()=>{
    await page.locator("#inventario-tecnologico-mapa-plano-opacidad").fill("50");
    exigir(await page.evaluate(sel=>document.querySelector(sel).style.opacity, IMG_PLANO) === "0.5", "no cambió la opacidad");
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-plano-opacidad")) === "0.5", "no se recordó");
  });

  await page.click("#inventario-tecnologico-mapa-plano-ajustar");
  await verificar("Ajustar plano: barra, cuatro esquinas, plano semitransparente y el control escondido", async ()=>{
    await page.waitForSelector(".inventario-tecnologico-mapa-aviso-plano");
    await esperarCuenta(page, ".inventario-tecnologico-mapa-plano-esquina", 4);
    exigir(await page.evaluate(sel=>document.querySelector(sel).style.opacity, IMG_PLANO) === "0.6", "opacidad de ajuste");
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").isHidden(), "el control del plano sigue visible");
  });
  const lienzo = await page.locator("#inventario-tecnologico-mapa-canvas").boundingBox();
  await verificar("Ajustar plano: arrastrar el plano lo mueve lo mismo que el puntero (sin mover el mapa)", async ()=>{
    const m0 = await matrizPlano(page);
    const centro0 = await page.evaluate(async ()=>(await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual().getCenter());
    const x = lienzo.x + lienzo.width / 2, y = lienzo.y + lienzo.height / 2 + 60;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + 30, y + 15, { steps: 5 }); await page.mouse.move(x + 60, y + 30, { steps: 5 });
    await page.mouse.up();
    const m1 = await matrizPlano(page);
    const centro1 = await page.evaluate(async ()=>(await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual().getCenter());
    exigir(Math.abs(m1[4] - m0[4] - 60) < 1.5 && Math.abs(m1[5] - m0[5] - 30) < 1.5, `se movió ${(m1[4] - m0[4]).toFixed(1)}, ${(m1[5] - m0[5]).toFixed(1)} px`);
    exigir(Math.abs(m1[0] - m0[0]) < 1e-9, "cambió el tamaño");
    exigir(centro0.lat === centro1.lat && centro0.lng === centro1.lng, "el mapa se desplazó");
  });
  // Tras moverlo, la esquina de abajo a la derecha queda fuera del lienzo: se aleja un nivel de zoom.
  await page.evaluate(async ()=>{ const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual(); m.setZoom(m.getZoom() - 1, { animate: false }); });
  await page.waitForTimeout(300);
  await verificar("Ajustar plano: arrastrar una esquina lo achica sin deformarlo y deja fija la opuesta", async ()=>{
    const m0 = await matrizPlano(page);
    const se = await page.locator(".inventario-tecnologico-mapa-plano-esquina-se").boundingBox();
    const x = se.x + se.width / 2, y = se.y + se.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x - 20, y - 25, { steps: 4 }); await page.mouse.move(x - 40, y - 50, { steps: 4 });
    await page.mouse.up();
    const m1 = await matrizPlano(page);
    exigir(Math.hypot(m1[4] - m0[4], m1[5] - m0[5]) < 1, "se movió la esquina opuesta (arriba-izquierda)");
    const fx = Math.hypot(m1[0], m1[1]) / Math.hypot(m0[0], m0[1]), fy = Math.hypot(m1[2], m1[3]) / Math.hypot(m0[2], m0[3]);
    exigir(fx < 0.99 && Math.abs(fx - fy) < 1e-3, `factores ${fx.toFixed(4)} y ${fy.toFixed(4)}`);
  });
  await verificar("Ajustar plano: la barra dice cuánto cambió", async ()=>{
    exigir(/se movió hasta .* m · -[\d,]+ % de tamaño/.test(await texto(page, '[data-ajuste="info"]')), await texto(page, '[data-ajuste="info"]'));
  });
  await captura(page, "21-plano-ajustando.png");
  await verificar("Guardar: escribe las esquinas nuevas en planos_mapa, avisa y sale del ajuste", async ()=>{
    await page.click('[data-ajuste="guardar"]');
    await toast(page, /Ajuste del plano guardado/);
    const esc = await escriturasPlano(page);
    exigir(esc.length === 1 && esc[0].op === "update" && esc[0].parche.esquinas, JSON.stringify(esc));
    const fila = (await db(page, "planos_mapa"))[0];
    exigir(JSON.stringify(fila.esquinas) !== JSON.stringify(fila.esquinas_originales), "las esquinas no cambiaron");
    await esperarCuenta(page, ".inventario-tecnologico-mapa-plano-esquina", 0);
    exigir(await page.locator(".inventario-tecnologico-mapa-aviso-plano").count() === 0, "la barra de ajuste sigue");
    exigir(await page.evaluate(sel=>document.querySelector(sel).style.opacity, IMG_PLANO) === "0.5", "no volvió la opacidad elegida");
    exigir(!(await page.locator(".inventario-tecnologico-mapa-plano-control").isHidden()), "el control no volvió");
  });
  const guardada = await matrizPlano(page);
  await page.click("#inventario-tecnologico-mapa-plano-ajustar");
  await page.waitForSelector(".inventario-tecnologico-mapa-aviso-plano");
  await verificar("Ajustar plano: Shift+flecha mueve 10 m; Esc cancela y no escribe nada", async ()=>{
    for(let i = 0; i < 5; i++) await page.keyboard.press("Shift+ArrowRight");
    const m1 = await matrizPlano(page);
    const mPorPx = await page.evaluate(async ()=>{ const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual(); return 40075016.686 * Math.cos(m.getCenter().lat * Math.PI / 180) / (256 * Math.pow(2, m.getZoom())); });
    exigir(Math.abs((m1[4] - guardada[4]) * mPorPx - 50) < 3, `se movió ${((m1[4] - guardada[4]) * mPorPx).toFixed(1)} m`);
    await page.keyboard.press("Escape");
    await esperarCuenta(page, ".inventario-tecnologico-mapa-plano-esquina", 0);
    const m2 = await matrizPlano(page);
    exigir(Math.abs(m2[4] - guardada[4]) < 0.5 && Math.abs(m2[5] - guardada[5]) < 0.5, "Esc no dejó el plano como estaba guardado");
    exigir((await escriturasPlano(page)).length === 1, "el Esc escribió en la base");
  });
  await page.click("#inventario-tecnologico-mapa-plano-ajustar");
  await page.waitForSelector(".inventario-tecnologico-mapa-aviso-plano");
  await verificar("Ajustar plano: «Calce original» vuelve a las esquinas con que se publicó; Cancelar no lo guarda", async ()=>{
    await page.click('[data-ajuste="original"]');
    const r = await page.evaluate(async sel=>{
      const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual();
      const { PLANO_POR_DEFECTO: PD } = await import("/assets/js/inventario-tecnologico/nucleo/plano-mapa.js");
      const mat = new DOMMatrix(getComputedStyle(document.querySelector(sel)).transform);
      const p = m.project(PD.esquinas.no)._subtract(m.getPixelOrigin());
      return Math.hypot(mat.e - p.x, mat.f - p.y);
    }, IMG_PLANO);
    exigir(r < 0.05, `quedó a ${r.toFixed(3)} px del calce original`);
    await page.click('[data-ajuste="cancelar"]');
    await esperarCuenta(page, ".inventario-tecnologico-mapa-plano-esquina", 0);
    const m2 = await matrizPlano(page);
    exigir(Math.abs(m2[4] - guardada[4]) < 0.5, "Cancelar no volvió a lo guardado");
    exigir((await escriturasPlano(page)).length === 1, "Cancelar escribió en la base");
  });
  await verificar("mientras se ajusta, los clics en el mapa no abren nada (y al salir vuelven a funcionar)", async ()=>{
    await page.click("#inventario-tecnologico-mapa-plano-ajustar");
    await page.waitForSelector(".inventario-tecnologico-mapa-aviso-plano");
    await page.mouse.click(lienzo.x + lienzo.width / 2, lienzo.y + lienzo.height / 2 + 60, { button: "right" });
    await page.waitForTimeout(300);
    exigir(await page.locator("#inventario-tecnologico-modal-host .inventario-tecnologico-modal").count() === 0, "el clic derecho abrió «Nueva ubicación» durante el ajuste");
    await page.keyboard.press("Escape");
    await esperarCuenta(page, ".inventario-tecnologico-mapa-plano-esquina", 0);
  });
  await verificar("al volver a abrir el mapa siguen el satélite y el plano encendido (el navegador los recuerda)", async ()=>{
    await page.reload();
    await page.waitForSelector(".inventario-tecnologico-topbar");
    await irAlMapa(page);
    await page.waitForSelector(IMG_PLANO);
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 1, "no está el control del plano");
    exigir(await page.evaluate(()=>[...document.querySelectorAll(".leaflet-control-layers-base input")].findIndex(i=>i.checked)) === 1, "la capa base no es Satélite");
    exigir((await superpuestas(page)).join("|") === "Plano de lotes ✓", (await superpuestas(page)).join("|"));
  });
  await elegirCapa(page, "Mapa");
  await verificar("cambiar la base a «Mapa» deja el plano encima", async ()=>{
    await page.waitForTimeout(300);
    exigir(await page.locator(IMG_PLANO).count() === 1, "se fue el plano");
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 1, "se fue el control");
  });
  await alternarSuperpuesta(page, "Plano de lotes");
  await verificar("apagar la casilla quita el plano, su control y su leyenda", async ()=>{
    await esperarCuenta(page, IMG_PLANO, 0);
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 0, "quedó el control");
    exigir(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-leyenda-plano").hidden), "quedó la leyenda del plano");
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-ver-plano")) === "0", "no recordó que se apagó");
  });
  await verificar("quien tenía la capa base «Plano» de la v6 abre en satélite con el plano encima", async ()=>{
    await page.evaluate(()=>{ localStorage.setItem("inventario-tecnologico-mapa-capa", "plano"); localStorage.removeItem("inventario-tecnologico-mapa-ver-plano"); });
    await page.reload();
    await page.waitForSelector(".inventario-tecnologico-topbar");
    await irAlMapa(page);
    await page.waitForSelector(IMG_PLANO);
    exigir(await page.evaluate(()=>[...document.querySelectorAll(".leaflet-control-layers-base input")].findIndex(i=>i.checked)) === 1, "la base no es Satélite");
    exigir((await superpuestas(page)).join("|") === "Plano de lotes ✓", (await superpuestas(page)).join("|"));
  });
  await verificar("sin errores de JavaScript (capa Plano)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  {
    const { context, page, errores } = await abrirApp(browser, base, fixture({ rol: "registrador", permitidas: ["ver_mapa"] }));
    await irAlMapa(page);
    await alternarSuperpuesta(page, "Plano de lotes");
    await verificar("con «ver_mapa» sin ser admin: ve el plano y su opacidad, pero no «Ajustar plano»", async ()=>{
      await page.waitForSelector(IMG_PLANO);
      exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 1, "sin control");
      exigir(await page.locator("#inventario-tecnologico-mapa-plano-ajustar").count() === 0, "ve «Ajustar plano»");
    });
    await verificar("sin errores de JavaScript (plano sin ser admin)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const fx = fixture({ fallas: { planos_mapa: { code: "PGRST205", message: "Could not find the table 'public.planos_mapa' in the schema cache" } } });
    const { context, page, errores } = await abrirApp(browser, base, fx);
    await irAlMapa(page);
    await alternarSuperpuesta(page, "Plano de lotes");
    await verificar("sin la migración 006: el plano se ve igual (calce de la app) y el mapa no se rompe", async ()=>{
      await page.waitForFunction(sel=>{ const i = document.querySelector(sel); return !!(i && i.complete && i.naturalWidth === 3198); }, IMG_PLANO, { timeout: 8000 });
      exigir(await page.locator(".leaflet-marker-icon").count() > 0, "no hay marcadores");
    });
    await page.click("#inventario-tecnologico-mapa-plano-ajustar");
    await page.waitForSelector(".inventario-tecnologico-mapa-aviso-plano");
    await verificar("sin la migración 006: «Guardar» explica que falta correr la 006 y deja seguir ajustando", async ()=>{
      await page.keyboard.press("Shift+ArrowUp");
      await page.click('[data-ajuste="guardar"]');
      await toast(page, /006_plano_mapa\.sql/);
      exigir(await page.locator(".inventario-tecnologico-mapa-aviso-plano").count() === 1, "se cerró el ajuste");
      exigir(!(await page.locator('[data-ajuste="guardar"]').isDisabled()), "«Guardar» quedó deshabilitado");
    });
    await verificar("sin errores de JavaScript (sin la 006)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

// ------------------------------------------------------------------ detalle de la torre
// Casilla por equipo para simular su caída, conectores del camino a la raíz
// (onda = inalámbrico, enchufe = cable) y detalle que se despliega (acordeón).
const CASILLA = id=>`${SEL.panel} [data-accion="casilla-caida"][data-id="${id}"]`;
const esperarPanelQuieto = page=>page.waitForFunction(()=>document.getElementById("inventario-tecnologico-mapa-panel").getAnimations({ subtree: true }).every(a=>a.playState !== "running"), null, { timeout: 4000 });

async function escenarioTorre(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());
  await irAlMapa(page);
  await irAUbicacionDesdePanel(page, 1);
  await verificar("torre: cada equipo tiene su casilla para simular la caída, fuera del botón de la fila", async ()=>{
    for(const id of [10, 11, 12]) exigir(await cuenta(page, CASILLA(id)) === 1, `falta la casilla de ${id}`);
    exigir(await page.evaluate(()=>!document.querySelector('#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-fila [data-accion="casilla-caida"]')), "la casilla quedó dentro del botón");
    exigir(/Marca la casilla de un equipo para simular su caída/.test(await texto(page, SEL.panel)), "sin la ayuda");
  });
  await verificar("marcar la casilla simula la caída sin abrir el detalle del equipo", async ()=>{
    await page.click(CASILLA(12));
    await page.waitForFunction(()=>/1 caído · 0 vía respaldo · 4 sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
    exigir(await page.isChecked(CASILLA(12)), "la casilla no quedó marcada");
    exigir(await cuenta(page, `${SEL.panel} [data-equipo-id="12"].inventario-tecnologico-mapa-equipo-caido`) === 1, "la fila no se ve caída");
    exigir(await cuenta(page, `${SEL.panel} .inventario-tecnologico-mapa-equipo-sel`) === 0, "se abrió el detalle");
    exigir((await texto(page, SEL.titulo)) === "Torre Cerro Azul", "cambió el panel");
  });
  await verificar("con teclado: Espacio sobre la casilla la desmarca y el foco se queda en ella", async ()=>{
    await page.focus(CASILLA(12));
    await page.keyboard.press("Space");
    await page.waitForFunction(()=>/Simulación activa/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
    exigir(!(await page.isChecked(CASILLA(12))), "sigue marcada");
    exigir(await page.evaluate(()=>document.activeElement?.dataset?.accion === "casilla-caida" && document.activeElement?.dataset?.id === "12"), "el foco se perdió al repintar");
    await page.click('#inventario-tecnologico-mapa-aviso-sim [data-sim-accion="salir"]');
  });
  await page.click(SEL.equipo(11));
  await page.waitForSelector(`${SEL.panel} [data-equipo-id="11"].inventario-tecnologico-mapa-equipo-sel`);
  await verificar("seleccionar un equipo despliega su detalle con transición, no de golpe", async ()=>{
    const n = await page.evaluate(()=>document.querySelector('#inventario-tecnologico-mapa-panel [data-equipo-id="11"] .inventario-tecnologico-mapa-equipo-detalle')?.getAnimations().length ?? -1);
    exigir(n > 0, `sin animación (${n})`);
    await esperarPanelQuieto(page);
    exigir(await page.getAttribute(SEL.equipo(11), "aria-expanded") === "true", "aria-expanded");
  });
  await verificar("camino: entre cada salto, un conector con su símbolo (onda o enchufe) y el badge junto a la línea", async ()=>{
    const con = await page.evaluate(()=>[...document.querySelectorAll("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-camino-conector")].map(c=>({
      cable: c.classList.contains("inventario-tecnologico-mapa-camino-cable"),
      inalambrico: c.classList.contains("inventario-tecnologico-mapa-camino-inalambrico"),
      simbolo: !!c.querySelector(".inventario-tecnologico-mapa-camino-simbolo svg"),
      texto: c.innerText.replace(/\s+/g, " ").trim(),
    })));
    exigir(con.length === 3, JSON.stringify(con));
    exigir(con.every(c=>c.simbolo), "falta el símbolo en algún conector");
    exigir(con[0].cable && con[0].texto === "cable", JSON.stringify(con[0]));
    exigir(con[1].inalambrico && /^inalámbrico · [\d,.]+ (km|m)$/.test(con[1].texto), JSON.stringify(con[1]));
    exigir(con[2].cable && con[2].texto === "cable", JSON.stringify(con[2]));
    const nodos = await page.locator(`${SEL.panel} .inventario-tecnologico-mapa-camino-nodo`).allInnerTexts();
    exigir(nodos.length === 4 && nodos.every(n=>!/cable|inalámbrico/.test(n)), "el badge quedó en la descripción: " + nodos.join(" | "));
  });
  await page.screenshot({ path: path.join(CAPTURAS, "13-torre-camino.png") });
  await verificar("elegir otro equipo de la torre: se pliega el anterior y se despliega el nuevo (acordeón)", async ()=>{
    await page.click(SEL.equipo(12));
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="12"].inventario-tecnologico-mapa-equipo-sel`);
    const estado = await page.evaluate(()=>({
      nuevo: document.querySelector('#inventario-tecnologico-mapa-panel [data-equipo-id="12"] .inventario-tecnologico-mapa-equipo-detalle')?.getAnimations().length ?? -1,
      fantasma: document.querySelector('#inventario-tecnologico-mapa-panel [data-equipo-id="11"] > div[aria-hidden="true"]') ? 1 : 0,
    }));
    exigir(estado.nuevo > 0 && estado.fantasma === 1, JSON.stringify(estado));
    await esperarPanelQuieto(page);
    exigir(await cuenta(page, `${SEL.panel} .inventario-tecnologico-mapa-equipo-detalle`) === 1, "quedó más de un detalle");
    exigir(await page.getAttribute(SEL.equipo(11), "aria-expanded") === "false", "el anterior sigue desplegado");
  });
  await verificar("volver a tocar el equipo lo pliega", async ()=>{
    await page.click(SEL.equipo(12));
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-equipo-sel"));
    await esperarPanelQuieto(page);
    exigir(await cuenta(page, `${SEL.panel} .inventario-tecnologico-mapa-equipo-detalle`) === 0, "sigue el detalle");
    exigir((await texto(page, SEL.titulo)) === "Torre Cerro Azul", "cambió el panel");
  });
  await verificar("sin errores de JavaScript (torre)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ red de la finca (007)
// Nombre automático, red de cada equipo, cableado dentro de la torre, atajos
// de simulación (encender/apagar, guardar las caídas, editar, eliminar),
// formulario de equipo sin nombre a mano y el catálogo de redes y tipos.
const NOMBRE = {
  ptpCA: "Punto a Punto en Torre Cerro Azul enlazado a Punto a Punto en Oficina Centro",
  ap: "AP en Torre Cerro Azul conectado a Punto a Punto",
  sw: "Switch en Torre Cerro Azul conectado a Punto a Punto",
  camN: "Cámara (Norte) en Torre Cerro Azul conectada a Switch",
  camS: "Cámara (Sur) en Torre Cerro Azul conectada a Switch",
  sm: "Estación en Oficina Centro enlazada a AP en Torre Santa Ana",
};
const ATAJO = id=>`${SEL.panel} [data-accion="alternar-atajo"][data-id="${id}"]`;
async function volverAlResumen(page){
  if(await page.locator(`${SEL.panel} [data-accion="volver-resumen"]`).count()) await page.click(`${SEL.panel} [data-accion="volver-resumen"]`);
  await page.waitForSelector(`${SEL.panel} .inventario-tecnologico-mapa-cifras`);
}

async function escenarioRed(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true }));
  await irAlMapa(page);
  await verificar("007: el administrador ve «Redes y tipos» y el resumen tiene los atajos de simulación", async ()=>{
    exigir(await page.locator("#inventario-tecnologico-mapa-redes-tipos").isVisible(), "sin el botón");
    exigir(await cuenta(page, ATAJO(1)) === 1, "sin el atajo");
    exigir(await page.getAttribute(ATAJO(1), "aria-checked") === "false", "arrancó encendido");
  });
  await irAUbicacionDesdePanel(page, 1);
  await verificar("nombres automáticos en la torre (según tipo y servidor; la referencia entre paréntesis)", async ()=>{
    const titulos = await page.locator(`${SEL.panel} .inventario-tecnologico-mapa-equipo-fila .inventario-tecnologico-mapa-fila-titulo`).evaluateAll(l=>l.map(x=>x.title));
    for(const n of [NOMBRE.ptpCA, NOMBRE.ap, NOMBRE.sw, NOMBRE.camN, NOMBRE.camS]) exigir(titulos.includes(n), `falta «${n}»: ${titulos.join(" | ")}`);
  });
  await verificar("en la lista de la torre el nombre se acorta (sin repetir «en Torre Cerro Azul»)", async ()=>{
    const visibles = await page.locator(`${SEL.panel} .inventario-tecnologico-mapa-equipo-fila .inventario-tecnologico-mapa-fila-titulo`).allTextContents();
    exigir(visibles.includes("Cámara (Norte) conectada a Switch") && visibles.includes("Punto a Punto enlazado a Punto a Punto en Oficina Centro"), visibles.join(" | "));
    exigir(visibles.every(v=>!v.includes("en Torre Cerro Azul")), visibles.join(" | "));
  });
  await verificar("cada equipo muestra su red y la torre dibuja su cableado (switch → cámaras)", async ()=>{
    exigir(await cuenta(page, `${SEL.panel} [data-equipo-id="50"] .inventario-tecnologico-mapa-red-chip`) === 1, "sin chip de red");
    exigir((await texto(page, `${SEL.panel} [data-equipo-id="50"] .inventario-tecnologico-mapa-red-chip`)) === "Red Cámaras", "red equivocada");
    const arbol = await page.evaluate(()=>{
      const raiz = document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-cab");
      if(!raiz) return null;
      const nodo = li=>({
        n: li.querySelector(":scope > .inventario-tecnologico-mapa-cab-nodo .inventario-tecnologico-mapa-cab-nombre")?.title,
        conector: li.querySelector(":scope > .inventario-tecnologico-mapa-cab-conector .inventario-tecnologico-mapa-camino-medio")?.textContent,
        h: [...li.querySelectorAll(":scope > .inventario-tecnologico-mapa-cab-hijos > li")].map(nodo),
      });
      return [...raiz.children].map(nodo);
    });
    exigir(arbol && arbol.length === 1 && arbol[0].n === NOMBRE.ptpCA, JSON.stringify(arbol));
    const sw = arbol[0].h.find(x=>x.n === NOMBRE.sw);
    exigir(arbol[0].h.length === 3 && sw && sw.h.map(x=>x.n).sort().join("|") === [NOMBRE.camN, NOMBRE.camS].sort().join("|"), JSON.stringify(arbol[0]));
    exigir(arbol[0].h.every(x=>x.conector === "cable") && sw.h.every(x=>x.conector === "cable"), "cada rama lleva su conector «cable»");
    const entrada = await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-cab-entrada`);
    exigir(/inalámbrico · \d/.test(entrada) && /desde Punto a Punto .*· Oficina Centro/.test(entrada), "entrada: " + entrada);
    exigir(/9 clientes por radio/.test(await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-cab`)), "sin la salida por radio del AP");
  });
  await verificar("la torre muestra sus secciones como tarjetas de colores distintos (equipos, cableado, activos)", async ()=>{
    const tarjetas = await page.locator(`${SEL.panel} .inventario-tecnologico-mapa-tarjeta`).evaluateAll(l=>l.map(t=>({ clase: [...t.classList].find(c=>/tarjeta-(equipos|cableado|activos)$/.test(c)), borde: getComputedStyle(t).borderTopColor, titulo: t.querySelector(".inventario-tecnologico-mapa-tarjeta-titulo").textContent })));
    exigir(tarjetas.map(t=>t.clase && t.clase.replace(/.*tarjeta-/, "")).join("|") === "equipos|cableado|activos", JSON.stringify(tarjetas));
    exigir(new Set(tarjetas.map(t=>t.borde)).size === 3, "los tres bordes deberían ser de colores distintos: " + tarjetas.map(t=>t.borde).join(", "));
  });
  await page.screenshot({ path: path.join(CAPTURAS, "14-red-torre.png") });
  await verificar("cableado: un respaldo dentro de la torre es una rama punteada; en la simulación se ve cortado / en uso", async ()=>{
    // El AP también está cableado al switch como respaldo (prioridad 1).
    await page.evaluate(()=>window.__DB__.enlaces_respaldo.push({ id: 90, equipo_id: 11, servidor_alternativo_id: 50, prioridad: 1, notas: null }));
    await page.click("#inventario-tecnologico-mapa-recargar");
    await page.waitForSelector(`${SEL.panel} .inventario-tecnologico-mapa-cab-rama-respaldo`);
    const rama = await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-cab-rama-respaldo`);
    exigir(/cable · respaldo/.test(rama) && /prioridad 1/.test(rama) && /respaldo de\s+AP conectado a Punto a Punto/.test(rama), rama);
    // Se corta el enlace de subida del AP: conmuta a su respaldo (el switch).
    await page.click(CASILLA(11));
    await page.waitForFunction(()=>/en uso/.test(document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-cab-rama-respaldo")?.innerText || ""));
    const marcas = await page.locator(`${SEL.panel} .inventario-tecnologico-mapa-cab .inventario-tecnologico-mapa-camino-marca`).allTextContents();
    exigir(marcas.includes("cortado") && marcas.includes("en uso"), marcas.join(" | "));
    // Se deja todo como estaba: sin caídas, fuera de la simulación y sin el respaldo agregado.
    await page.click(`${SEL.panel} [data-equipo-id="11"] .inventario-tecnologico-mapa-caida-check`);
    await page.waitForFunction(()=>!/en uso/.test(document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-cab-rama-respaldo")?.innerText || ""));
    await page.click('#inventario-tecnologico-mapa-aviso-sim [data-sim-accion="salir"]');
    await page.evaluate(()=>{ window.__DB__.enlaces_respaldo = window.__DB__.enlaces_respaldo.filter(r=>r.id !== 90); });
    await page.click("#inventario-tecnologico-mapa-recargar");
    await esperarCuenta(page, `${SEL.panel} .inventario-tecnologico-mapa-cab-rama-respaldo`, 0, "rama de respaldo");
  });

  await volverAlResumen(page);
  await verificar("encender un atajo simula la caída de sus equipos (y lo que depende de ellos)", async ()=>{
    await page.click(ATAJO(1));
    await page.waitForFunction(()=>/1 caído · 0 vía respaldo · 2 sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
    exigir(await page.getAttribute(ATAJO(1), "aria-checked") === "true", "el switch no quedó encendido");
  });
  await irAUbicacionDesdePanel(page, 1);
  await verificar("un equipo caído por un atajo tiene la casilla marcada y bloqueada, con la explicación", async ()=>{
    const c = CASILLA(50);
    exigir(await page.isChecked(c) && await page.isDisabled(c), "no está marcada y bloqueada");
    const titulo = await page.locator(`${SEL.panel} [data-equipo-id="50"] .inventario-tecnologico-mapa-caida-check`).getAttribute("title");
    exigir(/atajo «Cámaras Cerro Azul»/.test(titulo), titulo);
  });
  await page.click(CASILLA(12));
  await page.waitForFunction(()=>/2 caídos/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
  await volverAlResumen(page);
  await verificar("apagar el atajo levanta solo sus equipos (lo marcado a mano sigue caído)", async ()=>{
    await page.click(ATAJO(1));
    await page.waitForFunction(()=>/1 caído · 0 vía respaldo · 4 sin conectividad/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
  });
  await verificar("guardar las caídas actuales como atajo: queda encendido con esos equipos", async ()=>{
    await page.click(`${SEL.panel} [data-accion="guardar-atajo"]`);
    await page.waitForSelector("#inventario-tecnologico-atajo-nombre");
    exigir(/Punto a Punto en Torre Cerro Azul conectado a Punto a Punto/.test(await texto(page, "#inventario-tecnologico-modal-host .inventario-tecnologico-mapa-atajo-equipos")), "no lista el equipo");
    await page.fill("#inventario-tecnologico-atajo-nombre", "PtP a Santa Ana");
    await page.keyboard.press("Enter");
    await esperarSinModal(page);
    const ins = await page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "atajos_simulacion" && e.op === "insert").map(e=>e.filas[0]));
    exigir(ins.length === 1 && ins[0].nombre === "PtP a Santa Ana" && JSON.stringify(ins[0].equipos) === "[12]", JSON.stringify(ins));
    await page.waitForSelector(`${ATAJO(ins[0].id)}[aria-checked="true"]`);
    exigir(/1 caído/.test(await texto(page, "#inventario-tecnologico-mapa-aviso-sim")), "cambió la simulación");
  });
  await verificar("editar un atajo (renombrar) y eliminarlo (con confirmación en el mismo botón)", async ()=>{
    const id = await page.evaluate(()=>window.__DB__.atajos_simulacion.find(a=>a.nombre === "PtP a Santa Ana").id);
    await page.click(`${SEL.panel} [data-accion="editar-atajo"][data-id="${id}"]`);
    await page.waitForSelector("#inventario-tecnologico-atajo-nombre");
    await page.fill("#inventario-tecnologico-atajo-nombre", "Enlace a Santa Ana");
    await page.click("#inventario-tecnologico-atajo-guardar");
    await esperarSinModal(page);
    exigir(await page.evaluate(i=>window.__DB__.atajos_simulacion.find(a=>a.id === i).nombre, id) === "Enlace a Santa Ana", "no se renombró");
    await page.click(`${SEL.panel} [data-accion="editar-atajo"][data-id="${id}"]`);
    await page.waitForSelector("#inventario-tecnologico-atajo-eliminar");
    await page.click("#inventario-tecnologico-atajo-eliminar");
    exigir(await page.evaluate(i=>window.__DB__.atajos_simulacion.some(a=>a.id === i), id), "borró sin confirmar");
    await page.click("#inventario-tecnologico-atajo-eliminar");
    await esperarSinModal(page);
    exigir(!(await page.evaluate(i=>window.__DB__.atajos_simulacion.some(a=>a.id === i), id)), "no se borró");
    exigir(await cuenta(page, ATAJO(id)) === 0, "sigue en el panel");
  });
  await page.click('#inventario-tecnologico-mapa-aviso-sim [data-sim-accion="salir"]');

  await irAUbicacionDesdePanel(page, 1);
  await page.click(`${SEL.panel} [data-accion="nuevo-equipo"][data-id="1"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-tipo");
  await verificar("formulario de equipo con la 007: sin nombre a mano; tipo, referencia y red", async ()=>{
    exigir(await cuenta(page, "#inventario-tecnologico-equipo-nombre") === 0, "sigue el campo nombre");
    exigir(await cuenta(page, "#inventario-tecnologico-equipo-referencia, #inventario-tecnologico-equipo-red") === 2, "faltan referencia/red");
    exigir(/Elige el tipo/.test(await texto(page, "#inventario-tecnologico-equipo-nombre-auto")), "la vista previa no pide el tipo");
  });
  await verificar("sin tipo no se guarda (lo pide el formulario)", async ()=>{
    await page.click("#inventario-tecnologico-equipo-guardar");
    await page.waitForFunction(()=>/Elige el tipo de equipo/.test(document.querySelector('[data-error="tipo_equipo"]')?.textContent || ""));
    exigir(!(await page.evaluate(()=>window.__ESCRITURAS__.some(e=>e.tabla === "equipos_radioenlace" && e.op === "insert"))), "se guardó");
  });
  await verificar("el nombre se arma en vivo con el tipo, el servidor y la referencia", async ()=>{
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "camara");
    exigir((await texto(page, '[data-error="tipo_equipo"]')) === "", "sigue el aviso de que falta el tipo");
    await elegirServidor(page, "50");
    exigir((await texto(page, "#inventario-tecnologico-equipo-nombre-auto")) === "Cámara en Torre Cerro Azul conectada a Switch", await texto(page, "#inventario-tecnologico-equipo-nombre-auto"));
    await page.fill("#inventario-tecnologico-equipo-referencia", "Este");
    exigir((await texto(page, "#inventario-tecnologico-equipo-nombre-auto")) === "Cámara (Este) en Torre Cerro Azul conectada a Switch", await texto(page, "#inventario-tecnologico-equipo-nombre-auto"));
    await page.selectOption("#inventario-tecnologico-equipo-red", "2");
  });
  await verificar("guardar: nombre automático, tipo, red y referencia en la base", async ()=>{
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const f = await page.evaluate(()=>window.__ESCRITURAS__.find(e=>e.tabla === "equipos_radioenlace" && e.op === "insert").filas[0]);
    exigir(f.nombre === "Cámara (Este) en Torre Cerro Azul conectada a Switch" && f.tipo_equipo === "camara" && f.red_id === 2 && f.referencia === "Este" && f.servidor_id === 50, JSON.stringify(f));
    exigir((await texto(page, SEL.panel)).includes("Cámara (Este) en Torre Cerro Azul conectada a Switch"), "no aparece en el panel");
  });
  await verificar("un equipo sin tipo (anterior a la 007) conserva su nombre; su cliente lo cita por ese nombre", async ()=>{
    await irAUbicacionDesdePanel(page, 4);
    exigir((await texto(page, SEL.panel)).includes("SM Bodega"), "cambió el nombre del equipo sin tipo");
  });

  await page.click("#inventario-tecnologico-mapa-redes-tipos");
  await page.waitForSelector("#inventario-tecnologico-red-nueva-nombre");
  await verificar("redes y tipos: crear una red y renombrar un tipo (los nombres automáticos lo siguen)", async ()=>{
    await page.fill("#inventario-tecnologico-red-nueva-nombre", "Red Producción");
    await page.click('[data-cat="crear-red"]');
    await toast(page, /Red «Red Producción» creada/);
    exigir(await page.evaluate(()=>window.__DB__.redes.some(r=>r.nombre === "Red Producción")), "no se creó");
    const fila = '#inventario-tecnologico-modal-host [data-tipo-valor="estacion"]';
    await page.waitForSelector(fila);
    await page.fill(`${fila} [data-campo="etiqueta"]`, "Estación CPE");
    await page.click(`${fila} [data-cat="guardar-tipo"]`);
    await toast(page, /Tipo guardado/);
    await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");
    await esperarSinModal(page);
    await irAUbicacionDesdePanel(page, 3);
    exigir((await texto(page, SEL.panel)).includes("Estación CPE en Oficina Centro enlazada a AP en Torre Santa Ana"), "el nombre no siguió al tipo");
  });
  await verificar("sin errores de JavaScript (red de la finca)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  // Alguien con «Ver mapa» que no es administrador: usa los atajos, pero no los edita.
  const v = await abrirApp(browser, base, fixture({ rol: "visitante", permitidas: ["ver_mapa"], red007: true }));
  await irAlMapa(v.page);
  await verificar("sin ser administrador: enciende atajos, pero no ve «Editar», «Guardar caídas» ni «Redes y tipos»", async ()=>{
    exigir(await v.page.locator("#inventario-tecnologico-mapa-redes-tipos").count() === 0, "ve «Redes y tipos»");
    await v.page.click(ATAJO(1));
    await v.page.waitForFunction(()=>/1 caído/.test(document.getElementById("inventario-tecnologico-mapa-aviso-sim")?.innerText || ""));
    exigir(await cuenta(v.page, `${SEL.panel} [data-accion="editar-atajo"], ${SEL.panel} [data-accion="guardar-atajo"]`) === 0, "ve botones de administrador");
    exigir(await v.page.evaluate(()=>window.__ESCRITURAS__.length) === 0, "escribió en la base");
  });
  await verificar("sin errores de JavaScript (red de la finca, sin ser administrador)", async ()=>{ exigir(v.errores.length === 0, v.errores.join(" | ")); });
  await v.context.close();
}

// ------------------------------------------------------------------ v7: medio del enlace (008)
// Cable o fibra entre ubicaciones: campo «Medio», nombre «conectada a … en …»
// y su propia línea en el mapa. Sin la 008 no aparece nada de eso.
const ESCRITURAS_EQUIPOS = page=>page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "equipos_radioenlace"));
async function escenarioMedio(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true, red008: true }));
  await irAlMapa(page);
  await verificar("008: el filtro de líneas ofrece «Cable/fibra»", async ()=>{
    exigir(await cuenta(page, SEL.chip("linea", "cable")) === 1, "sin el chip");
  });
  await irAUbicacionDesdePanel(page, 4);
  await page.click(`${SEL.panel} [data-accion="nuevo-equipo"][data-id="4"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-medio", { state: "attached" });
  await verificar("008: el formulario pide el medio solo si hay servidor, y dice qué hace «Automático»", async ()=>{
    exigir(await page.locator("#inventario-tecnologico-equipo-medio-campo").isHidden(), "se ve sin servidor");
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "estacion");
    await elegirServidor(page, "21");
    exigir(!(await page.locator("#inventario-tecnologico-equipo-medio-campo").isHidden()), "no apareció con servidor");
    exigir(/Automático: inalámbrico \(otra ubicación\)/.test(await texto(page, "#inventario-tecnologico-equipo-medio-ayuda")), await texto(page, "#inventario-tecnologico-equipo-medio-ayuda"));
    exigir((await texto(page, "#inventario-tecnologico-equipo-nombre-auto")) === "Estación en Bodega Sur enlazada a AP en Torre Santa Ana", await texto(page, "#inventario-tecnologico-equipo-nombre-auto"));
  });
  await verificar("v8: si un extremo no hace radio (Cámara, Switch) y el servidor está en otra ubicación, el medio se pone en «Cable»; si vuelve a ser radio con radio, vuelve a «Automático»", async ()=>{
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "camara");
    exigir(await page.inputValue("#inventario-tecnologico-equipo-medio") === "cable", "al elegir Cámara: " + await page.inputValue("#inventario-tecnologico-equipo-medio"));
    exigir(/Puesto en «Cable»: Cámara no hace radioenlaces/.test(await texto(page, "#inventario-tecnologico-equipo-medio-ayuda")), await texto(page, "#inventario-tecnologico-equipo-medio-ayuda"));
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "estacion");
    exigir(await page.inputValue("#inventario-tecnologico-equipo-medio") === "", "no volvió a Automático");
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "camara");
    await elegirServidor(page, "50");
    exigir(await page.inputValue("#inventario-tecnologico-equipo-medio") === "cable", "con el Switch");
    exigir(/Puesto en «Cable»: Switch no hace radioenlaces/.test(await texto(page, "#inventario-tecnologico-equipo-medio-ayuda")), await texto(page, "#inventario-tecnologico-equipo-medio-ayuda"));
    exigir((await texto(page, "#inventario-tecnologico-equipo-nombre-auto")) === "Cámara en Bodega Sur conectada a Switch en Torre Cerro Azul", await texto(page, "#inventario-tecnologico-equipo-nombre-auto"));
  });
  await verificar("008: con fibra el nombre dice «conectada a … en …» y el cálculo explica la línea de fibra", async ()=>{
    await page.selectOption("#inventario-tecnologico-equipo-medio", "fibra");
    exigir((await texto(page, "#inventario-tecnologico-equipo-nombre-auto")) === "Cámara en Bodega Sur conectada a Switch en Torre Cerro Azul", await texto(page, "#inventario-tecnologico-equipo-nombre-auto"));
    exigir(/Por fibra óptica hasta .* línea de fibra/.test(await texto(page, "#inventario-tecnologico-equipo-servidor-calculo")), await texto(page, "#inventario-tecnologico-equipo-servidor-calculo"));
  });
  await verificar("008: al guardar viaja el medio; el mapa dibuja la fibra entre las dos ubicaciones", async ()=>{
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const f = (await ESCRITURAS_EQUIPOS(page)).find(e=>e.op === "insert").filas[0];
    exigir(f.medio === "fibra" && f.servidor_id === 50 && f.nombre === "Cámara en Bodega Sur conectada a Switch en Torre Cerro Azul", JSON.stringify(f));
    // Recién creado queda elegido (su camino se resalta): se suelta para ver la línea con su estilo.
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await esperarCuenta(page, SEL.linea("fibra"), 1, "línea de fibra");
    exigir(/1/.test(await texto(page, SEL.chip("linea", "cable"))), "el chip no cuenta la fibra");
  });
  await verificar("008: en la torre, el switch dice que sale una fibra hacia Bodega Sur", async ()=>{
    await irAUbicacionDesdePanel(page, 1);
    const salidas = await page.locator(`${SEL.panel} .inventario-tecnologico-mapa-cab-salida.inventario-tecnologico-mapa-cab-medio-fibra`).allTextContents();
    exigir(salidas.some(t=>/Bodega Sur/.test(t)), salidas.join(" | "));
  });
  await verificar("008: el toggle «Cable/fibra» oculta la línea de fibra", async ()=>{
    await clicFiltro(page, SEL.chip("linea", "cable"));
    await esperarCuenta(page, SEL.linea("fibra"), 0, "línea de fibra");
    await clicFiltro(page, SEL.chip("linea", "cable"));
    await esperarCuenta(page, SEL.linea("fibra"), 1, "línea de fibra");
  });
  await verificar("008: volver el medio a «Automático» lo manda en NULL (y la línea pasa a ser radioenlace)", async ()=>{
    const id = await page.evaluate(()=>window.__DB__.equipos_radioenlace.find(e=>e.medio === "fibra").id);
    await irAUbicacionDesdePanel(page, 4);
    await page.click(SEL.equipo(id));
    await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="${id}"]`);
    await page.waitForSelector("#inventario-tecnologico-equipo-medio");
    exigir(await page.inputValue("#inventario-tecnologico-equipo-medio") === "fibra", "no carga el medio guardado");
    await page.selectOption("#inventario-tecnologico-equipo-medio", "");
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const u = (await ESCRITURAS_EQUIPOS(page)).filter(e=>e.op === "update").pop();
    exigir(u.parche.medio === null && u.parche.nombre === "Cámara en Bodega Sur enlazada a Switch en Torre Cerro Azul", JSON.stringify(u.parche));
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await esperarCuenta(page, SEL.linea("fibra"), 0, "línea de fibra");
    exigir(await cuenta(page, `path.inventario-tecnologico-mapa-linea[data-cliente-id="${id}"]`) === 1, "no quedó la línea de radio");
  });
  await verificar("sin errores de JavaScript (medio)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  const s7 = await abrirApp(browser, base, fixture({ red007: true }));
  await irAlMapa(s7.page);
  await verificar("sin la 008: ni el chip «Cable/fibra» ni el campo «Medio»; el equipo se guarda sin medio", async ()=>{
    exigir(await cuenta(s7.page, SEL.chip("linea", "cable")) === 0, "está el chip");
    await irAUbicacionDesdePanel(s7.page, 4);
    await s7.page.click(`${SEL.panel} [data-accion="nuevo-equipo"][data-id="4"]`);
    await s7.page.waitForSelector("#inventario-tecnologico-equipo-tipo");
    exigir(await cuenta(s7.page, "#inventario-tecnologico-equipo-medio") === 0, "está el campo medio");
    await s7.page.selectOption("#inventario-tecnologico-equipo-tipo", "camara");
    await elegirServidor(s7.page, "50");
    await s7.page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(s7.page);
    const f = (await ESCRITURAS_EQUIPOS(s7.page)).find(e=>e.op === "insert").filas[0];
    exigir(!("medio" in f), JSON.stringify(f));
  });
  await verificar("sin errores de JavaScript (sin la 008)", async ()=>{ exigir(s7.errores.length === 0, s7.errores.join(" | ")); });
  await s7.context.close();
}

// ------------------------------------------------------------------ v7: tipo y red en lote
async function escenarioLote(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true, red008: true }));
  await irAlMapa(page);
  await page.click("#inventario-tecnologico-mapa-lote");
  await page.waitForSelector("#inventario-tecnologico-lote-filas");
  const filasVisibles = ()=>page.locator("#inventario-tecnologico-lote-filas [data-lote-id]").evaluateAll(l=>l.map(x=>Number(x.dataset.loteId)));
  await verificar("lote: «Solo sin tipo» deja solo los equipos anteriores a la 007", async ()=>{
    await page.check("#inventario-tecnologico-lote-sin-tipo");
    exigir(JSON.stringify(await filasVisibles()) === "[40]", JSON.stringify(await filasVisibles()));
    exigir(await page.isDisabled("#inventario-tecnologico-lote-aplicar"), "se puede aplicar sin elegir nada");
  });
  await verificar("lote: marcar todos + tipo y red → muestra cómo quedan los nombres antes de aplicar", async ()=>{
    await page.check("#inventario-tecnologico-lote-todos");
    await page.selectOption("#inventario-tecnologico-lote-tipo", "estacion");
    await page.selectOption("#inventario-tecnologico-lote-red", "2");
    const vista = await texto(page, "#inventario-tecnologico-lote-vista");
    exigir(/1 equipo elegido/.test(vista) && /Red Cámaras/.test(vista) && /SM Bodega → Estación en Bodega Sur enlazada a AP en Torre Santa Ana/.test(vista.replace(/\s+/g, " ")), vista);
    exigir((await texto(page, "#inventario-tecnologico-lote-aplicar")) === "Aplicar a 1 equipo", "botón: " + await texto(page, "#inventario-tecnologico-lote-aplicar"));
  });
  await verificar("lote con la 008: un solo UPDATE sin nombres (los pone la base) y el mapa muestra el nombre nuevo", async ()=>{
    await page.click("#inventario-tecnologico-lote-aplicar");
    await esperarSinModal(page);
    await toast(page, /1 equipo actualizado/);
    const u = (await ESCRITURAS_EQUIPOS(page)).filter(e=>e.op === "update");
    exigir(u.length === 1 && JSON.stringify(u[0].parche) === JSON.stringify({ tipo_equipo: "estacion", red_id: 2 }) && u[0].filas.map(f=>f.id).join() === "40", JSON.stringify(u));
    exigir(await page.evaluate(()=>window.__DB__.equipos_radioenlace.find(e=>e.id === 40).nombre) === "Estación en Bodega Sur enlazada a AP en Torre Santa Ana", "la base no quedó con el nombre al día");
    await irAUbicacionDesdePanel(page, 4);
    exigir((await texto(page, SEL.panel)).includes("Estación enlazada a AP en Torre Santa Ana"), "el panel no muestra el nombre nuevo");
  });
  await verificar("lote: abierto con una ubicación a la vista arranca con sus equipos marcados; «Quitar la red» manda NULL", async ()=>{
    await irAUbicacionDesdePanel(page, 1);
    await page.click("#inventario-tecnologico-mapa-lote");
    await page.waitForSelector("#inventario-tecnologico-lote-filas");
    const marcados = await page.locator("#inventario-tecnologico-lote-filas [data-lote-id]:checked").evaluateAll(l=>l.map(x=>Number(x.dataset.loteId)).sort((a, b)=>a - b));
    exigir(JSON.stringify(marcados) === "[10,11,12,50,51,52]", JSON.stringify(marcados));
    await page.selectOption("#inventario-tecnologico-lote-red", "");
    await page.click("#inventario-tecnologico-lote-aplicar");
    await esperarSinModal(page);
    const u = (await ESCRITURAS_EQUIPOS(page)).filter(e=>e.op === "update").pop();
    exigir(JSON.stringify(u.parche) === JSON.stringify({ red_id: null }) && u.filas.length === 6, JSON.stringify(u.parche));
  });
  await verificar("sin errores de JavaScript (lote)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  const s7 = await abrirApp(browser, base, fixture({ red007: true }));
  await irAlMapa(s7.page);
  await verificar("lote sin la 008: un UPDATE por equipo, cada uno con su nombre automático", async ()=>{
    await s7.page.click("#inventario-tecnologico-mapa-lote");
    await s7.page.waitForSelector("#inventario-tecnologico-lote-filas");
    await s7.page.check('[data-lote-id="40"]');
    await s7.page.check('[data-lote-id="32"]');
    await s7.page.selectOption("#inventario-tecnologico-lote-tipo", "camara");
    await s7.page.click("#inventario-tecnologico-lote-aplicar");
    await esperarSinModal(s7.page);
    const u = (await ESCRITURAS_EQUIPOS(s7.page)).filter(e=>e.op === "update");
    exigir(u.length === 2, `${u.length} UPDATE`);
    exigir(u[0].filas[0].id === 32 && u[0].parche.nombre === "Cámara en Oficina Centro enlazada a AP en Torre Santa Ana", JSON.stringify(u[0].parche));
    exigir(u[1].filas[0].id === 40 && u[1].parche.nombre === "Cámara en Bodega Sur enlazada a AP en Torre Santa Ana", JSON.stringify(u[1].parche));
  });
  await s7.context.close();
  const v = await abrirApp(browser, base, fixture({ rol: "visitante", permitidas: ["ver_mapa"], red007: true }));
  await irAlMapa(v.page);
  await verificar("sin ser administrador no aparece «Tipo y red en lote»", async ()=>{ exigir(await cuenta(v.page, "#inventario-tecnologico-mapa-lote") === 0, "aparece"); });
  await v.context.close();
}

// ------------------------------------------------------------------ v7: filtro por red y colores por red
async function escenarioRedes(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true }));
  await irAlMapa(page);
  await verificar("redes: un chip por red y «Sin red», con cuántos equipos tiene cada una", async ()=>{
    const chips = await page.locator(".inventario-tecnologico-mapa-filtros [data-red]").evaluateAll(l=>l.map(c=>c.dataset.red + ":" + c.querySelector(".inventario-tecnologico-mapa-chip-n").textContent));
    exigir(chips.join("|") === "1:8|2:3|sin:10", chips.join("|"));
  });
  await verificar("redes: ocultar «Sin red» esconde sus equipos (y las ubicaciones que quedan vacías)", async ()=>{
    const antes = await cuenta(page, ".leaflet-marker-icon[data-ubicacion-id]");
    await clicFiltro(page, SEL.chip("red", "sin"));
    await page.waitForFunction(n=>document.querySelectorAll(".leaflet-marker-icon[data-ubicacion-id]").length === n, antes - 10, { timeout: 4000 });
    exigir(await page.getAttribute('.inventario-tecnologico-mapa-filtros [data-red="sin"]', "aria-pressed") === "false", "el chip no quedó apagado");
    exigir(/1 activo/.test(await texto(page, "#inventario-tecnologico-mapa-filtros-cuenta")), "el contador de filtros no lo cuenta");
    await clicFiltro(page, SEL.chip("red", "sin"));
    await page.waitForFunction(n=>document.querySelectorAll(".leaflet-marker-icon[data-ubicacion-id]").length === n, antes, { timeout: 4000 });
  });
  await verificar("redes: «Colorear líneas por red» pinta cada línea con el color de su red (y la leyenda lo explica)", async ()=>{
    const linea = 'path.inventario-tecnologico-mapa-linea[data-cliente-id="32"]';
    exigir((await page.getAttribute(linea, "stroke")).toUpperCase() === "#007EB2", "color inicial");
    await page.click("#inventario-tecnologico-mapa-color-red");
    await page.waitForFunction(sel=>(document.querySelector(sel)?.getAttribute("stroke") || "").toUpperCase() === "#004DAB", linea, { timeout: 4000 });
    exigir(!(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-leyenda-redes").hidden)), "sin la leyenda de redes");
    await page.click("#inventario-tecnologico-mapa-color-red");
    await page.waitForFunction(sel=>(document.querySelector(sel)?.getAttribute("stroke") || "").toUpperCase() === "#007EB2", linea, { timeout: 4000 });
  });
  await verificar("redes: Enter en el nombre de la red nueva la crea", async ()=>{
    await page.click("#inventario-tecnologico-mapa-redes-tipos");
    await page.waitForSelector("#inventario-tecnologico-red-nueva-nombre");
    await page.fill("#inventario-tecnologico-red-nueva-nombre", "Red Bombas");
    await page.keyboard.press("Enter");
    await toast(page, /Red «Red Bombas» creada/);
    await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");
    await esperarSinModal(page);
    exigir(await cuenta(page, '.inventario-tecnologico-mapa-filtros [data-red="3"]') === 1, "la red nueva no aparece en los filtros");
  });
  await verificar("sin errores de JavaScript (redes)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ v7: capa Piscinas (009)
const PISCINA = id=>`path[data-piscina-id="${id}"]`;
const ESCRITURAS_PISCINAS = page=>page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "piscinas"));
// El mapa puede seguir acomodándose (encuadre animado): si el clic no abrió la
// ventanita, se espera a que se quede quieto y se vuelve a intentar.
async function clicPiscina(page, id){
  const sel = `.inventario-tecnologico-mapa-piscina-popup[data-piscina-id="${id}"]`;
  for(let intento = 0; intento < 3; intento++){
    // Todas a la vista (el encuadre inicial del mapa o una edición pueden haberlas dejado afuera).
    await mapaQuieto(page);
    if(await page.locator('[data-piscinas="encuadrar"]').isVisible()){ await page.click('[data-piscinas="encuadrar"]'); await mapaQuieto(page); }
    await page.waitForTimeout(250);
    const c = await page.locator(PISCINA(id)).boundingBox();
    await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
    try{ await page.waitForSelector(sel, { timeout: 1500 }); return; }catch(e){ if(process.env.DEPURAR) console.log("   [piscina]", id, JSON.stringify(c), await page.evaluate(([x, y])=>{ const el = document.elementFromPoint(x, y); return el ? el.tagName + " " + String(el.getAttribute("class")).slice(0, 90) + " " + JSON.stringify(el.dataset || {}) : null; }, [c.x + c.width / 2, c.y + c.height / 2]), await page.evaluate(()=>[...document.querySelectorAll(".leaflet-popup")].length)); }
  }
  await page.waitForSelector(sel, { timeout: 1000 });
}
const BOTON_PISCINA = (id, accion)=>`.inventario-tecnologico-mapa-piscina-popup[data-piscina-id="${id}"] [data-piscina-accion="${accion}"]`;
async function escenarioPiscinas(browser, base){
  const sin = await abrirApp(browser, base, fixture({ red007: true }));
  await irAlMapa(sin.page);
  await verificar("sin la 009: el selector de capas no ofrece «Piscinas»", async ()=>{ exigir((await superpuestas(sin.page)).join("|") === "Plano de lotes", (await superpuestas(sin.page)).join("|")); });
  await sin.context.close();

  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true, piscinas: true }));
  await irAlMapa(page);
  await verificar("009: «Piscinas» aparece como capa superpuesta; al encenderla se ven sus polígonos, su control y su leyenda", async ()=>{
    exigir((await superpuestas(page)).join("|") === "Plano de lotes|Piscinas", (await superpuestas(page)).join("|"));
    await alternarSuperpuesta(page, "Piscinas");
    await esperarCuenta(page, "path[data-piscina-id]", 3, "polígonos");
    exigir(/\(3\)/.test(await texto(page, ".inventario-tecnologico-mapa-piscinas-control")), "el control no dice cuántas hay");
    exigir(!(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-leyenda-piscinas").hidden)), "sin leyenda");
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-ver-piscinas")) === "1", "no se recordó");
  });
  await page.click('[data-piscinas="encuadrar"]');
  await mapaQuieto(page);
  await verificar("009: clic en una piscina → nombre, sector, hectáreas del plano, área del dibujo y notas", async ()=>{
    await clicPiscina(page, 2);
    const t = await texto(page, ".inventario-tecnologico-mapa-piscina-popup");
    exigir(/L02/.test(t) && /sector L/.test(t) && /4,50 ha/.test(t) && /Sembrada en agosto/.test(t) && /Editar forma/.test(t), t);
    await page.keyboard.press("Escape");
    await esperarCuenta(page, ".leaflet-popup", 0, "la ventanita sigue abierta después de Esc");
  });
  await verificar("009: «Solo por revisar» deja solo la que está marcada", async ()=>{
    await page.check('[data-piscinas="revisar"]');
    await esperarCuenta(page, "path[data-piscina-id]", 1, "polígonos");
    exigir(await cuenta(page, PISCINA(3)) === 1, "no es la de revisar");
    await page.uncheck('[data-piscinas="revisar"]');
    await esperarCuenta(page, "path[data-piscina-id]", 3, "polígonos");
  });
  await page.click('[data-piscinas="encuadrar"]');
  await mapaQuieto(page);
  await clicPiscina(page, 1);
  await page.click(BOTON_PISCINA(1, "forma"));
  await page.waitForSelector(".inventario-tecnologico-mapa-aviso-piscina");
  const vertices = ".inventario-tecnologico-mapa-piscina-vertice";
  await verificar("editor: 4 vértices y 4 puntos medios; el resto del mapa no recibe clics", async ()=>{
    await esperarCuenta(page, vertices, 4);
    await esperarCuenta(page, ".inventario-tecnologico-mapa-piscina-medio", 4);
    exigir(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-canvas").classList.contains("inventario-tecnologico-mapa-editando-piscina")), "el mapa no está en modo edición");
    exigir(/4 puntos/.test(await texto(page, ".inventario-tecnologico-mapa-aviso-piscina")), "la barra no cuenta los puntos");
  });
  await verificar("editor: arrastrar un punto medio agrega un vértice; «Deshacer» lo quita", async ()=>{
    const m = await page.locator(".inventario-tecnologico-mapa-piscina-medio").first().boundingBox();
    await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2);
    await page.mouse.down();
    await page.mouse.move(m.x + 30, m.y - 25, { steps: 5 });
    await page.mouse.up();
    await esperarCuenta(page, vertices, 5);
    await page.click('[data-ed="deshacer"]');
    await esperarCuenta(page, vertices, 4);
  });
  await verificar("editor: con el teclado, flecha mueve el punto y Supr lo quita (mínimo 3)", async ()=>{
    await page.locator(vertices).first().focus();
    const antes = await texto(page, '[data-ed="info"]');
    await page.keyboard.press("Shift+ArrowUp");
    exigir((await texto(page, '[data-ed="info"]')) !== antes, "la flecha no movió el punto");
    await page.keyboard.press("Delete");
    await esperarCuenta(page, vertices, 3);
    await page.locator(vertices).first().focus();
    await page.keyboard.press("Delete");
    await page.waitForTimeout(150);
    exigir(await cuenta(page, vertices) === 3, "bajó de 3 puntos");
  });
  await verificar("editor: Esc cancela y no escribe nada", async ()=>{
    await page.keyboard.press("Escape");
    await esperarCuenta(page, vertices, 0);
    exigir(await cuenta(page, ".inventario-tecnologico-mapa-aviso-piscina") === 0, "quedó la barra");
    exigir((await ESCRITURAS_PISCINAS(page)).length === 0, "escribió");
    await esperarCuenta(page, "path[data-piscina-id]", 3, "polígonos");
  });
  await verificar("editor: mover un vértice y «Guardar» escribe los puntos nuevos (el dibujo pasa a «a mano»)", async ()=>{
    await clicPiscina(page, 1);
    await page.click(BOTON_PISCINA(1, "forma"));
    await esperarCuenta(page, vertices, 4);
    const v = await page.locator(vertices).nth(2).boundingBox();
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    await page.mouse.down();
    await page.mouse.move(v.x + 40, v.y + 20, { steps: 5 });
    await page.mouse.up();
    await page.click('[data-ed="guardar"]');
    await esperarCuenta(page, vertices, 0);
    await toast(page, /Forma de L01 guardada/);
    const w = await ESCRITURAS_PISCINAS(page);
    exigir(w.length === 1 && w[0].op === "update" && w[0].parche.puntos.length === 4 && w[0].parche.fuente === "manual" && Object.keys(w[0].parche).length === 2, JSON.stringify(w.map(x=>x.parche)));
  });
  await verificar("datos: editar las hectáreas (con coma) y desmarcar «Por revisar»", async ()=>{
    await clicPiscina(page, 3);
    await page.click(BOTON_PISCINA(3, "datos"));
    await page.waitForSelector("#inventario-tecnologico-piscina-hectareas");
    await page.fill("#inventario-tecnologico-piscina-hectareas", "1,15");
    await page.uncheck("#inventario-tecnologico-piscina-revisar");
    await page.click("#inventario-tecnologico-piscina-guardar");
    await esperarSinModal(page);
    const f = await page.evaluate(()=>window.__DB__.piscinas.find(p=>p.id === 3));
    exigir(f.hectareas === 1.15 && f.revisar === false && f.sector === "L", JSON.stringify(f));
  });
  await verificar("nueva piscina: se crea como un cuadrado en el centro y se abre el editor de su forma", async ()=>{
    await page.click('[data-piscinas="nueva"]');
    await page.waitForSelector("#inventario-tecnologico-piscina-nombre");
    await page.fill("#inventario-tecnologico-piscina-nombre", "l99");
    await page.fill("#inventario-tecnologico-piscina-hectareas", "2");
    await page.click("#inventario-tecnologico-piscina-guardar");
    await page.waitForSelector(".inventario-tecnologico-mapa-aviso-piscina");
    const ins = (await ESCRITURAS_PISCINAS(page)).find(e=>e.op === "insert").filas[0];
    exigir(ins.nombre === "l99" && ins.sector === "L" && ins.puntos.length === 4 && ins.fuente === "manual", JSON.stringify(ins));
    await page.click('[data-ed="guardar"]');
    await esperarCuenta(page, vertices, 0);
  });
  await verificar("eliminar una piscina (con confirmación en el mismo botón)", async ()=>{
    const id = await page.evaluate(()=>window.__DB__.piscinas.find(p=>p.nombre === "l99").id);
    await clicPiscina(page, id);
    await page.click(BOTON_PISCINA(id, "datos"));
    await page.waitForSelector("#inventario-tecnologico-piscina-eliminar");
    await page.click("#inventario-tecnologico-piscina-eliminar");
    exigir(await page.evaluate(i=>window.__DB__.piscinas.some(p=>p.id === i), id), "borró sin confirmar");
    await page.click("#inventario-tecnologico-piscina-eliminar");
    await esperarSinModal(page);
    await esperarCuenta(page, "path[data-piscina-id]", 3, "polígonos");
  });
  await verificar("al volver a abrir el mapa la capa Piscinas sigue encendida", async ()=>{
    await page.reload();
    await page.waitForSelector(".inventario-tecnologico-topbar");
    await irAlMapa(page);
    await esperarCuenta(page, "path[data-piscina-id]", 3, "polígonos");
  });
  await verificar("sin errores de JavaScript (piscinas)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  const v = await abrirApp(browser, base, fixture({ rol: "visitante", permitidas: ["ver_mapa"], piscinas: true }));
  await irAlMapa(v.page);
  await alternarSuperpuesta(v.page, "Piscinas");
  await esperarCuenta(v.page, "path[data-piscina-id]", 3, "polígonos");
  await v.page.click('[data-piscinas="encuadrar"]');
  await mapaQuieto(v.page);
  await verificar("piscinas sin ser administrador: ve los datos, pero no puede editar ni crear", async ()=>{
    await clicPiscina(v.page, 2);
    exigir(await cuenta(v.page, "[data-piscina-accion]") === 0, "ve botones de edición");
    exigir(await cuenta(v.page, '[data-piscinas="nueva"]') === 0, "ve «+ Nueva piscina»");
    exigir(v.errores.length === 0, v.errores.join(" | "));
  });
  await v.context.close();
}

// ------------------------------------------------------------------ v8: selector de servidor y la red en el nombre (010)
const SERV = "#inventario-tecnologico-equipo-servidor";
const opcionesVisibles = page=>page.locator(`${SERV}-lista [role=option]`).evaluateAll(l=>l.map(x=>x.dataset.clave));
async function escenarioServidor(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true, red008: true, red010: true, servidor: true }));
  await irAlMapa(page);
  await verificar("010: la red va entre paréntesis en el nombre (la del servidor, solo si es distinta)", async ()=>{
    await irAUbicacionDesdePanel(page, 1);
    const t = await texto(page, SEL.panel);
    exigir(t.includes("Switch (Red Cámaras) conectado a Punto a Punto (Red Administrativa)"), "switch: " + t.slice(0, 400));
    exigir(t.includes("Cámara (Red Cámaras · Norte) conectada a Switch"), "cámara");
  });
  await irAUbicacionDesdePanel(page, 3);
  await page.click(`${SEL.panel} [data-accion="nuevo-equipo"][data-id="3"]`);
  await page.waitForSelector(`${SERV}-boton`);
  await verificar("selector: el rótulo «Servidor» apunta al botón; botón y panel con sus roles ARIA", async ()=>{
    exigir(await page.getAttribute(`label[for="inventario-tecnologico-equipo-servidor-boton"]`, "for") === "inventario-tecnologico-equipo-servidor-boton", "el rótulo no apunta al botón");
    exigir(await page.getAttribute(`${SERV}-boton`, "aria-haspopup") === "dialog" && await page.getAttribute(`${SERV}-boton`, "aria-expanded") === "false", "botón");
    exigir(await page.locator(SERV).isHidden(), "el select original sigue a la vista");
    exigir(/Ninguno: es una raíz/.test(await texto(page, `${SERV}-boton`)), "sin servidor al empezar");
  });
  await verificar("selector: se abre con el teclado, enfoca la búsqueda y anuncia cuántos hay", async ()=>{
    await page.focus(`${SERV}-boton`);
    await page.keyboard.press("ArrowDown");
    await page.waitForSelector(`${SERV}-panel:not([hidden])`);
    exigir(await page.evaluate(()=>document.activeElement.id) === "inventario-tecnologico-equipo-servidor-filtro", "el foco no está en la búsqueda");
    exigir(await page.getAttribute(`${SERV}-boton`, "aria-expanded") === "true", "aria-expanded");
    exigir(await page.getAttribute(`${SERV}-panel`, "role") === "dialog", "el panel no es diálogo");
    exigir(await page.getAttribute(`${SERV}-filtro`, "role") === "combobox" && await page.getAttribute(`${SERV}-filtro`, "aria-controls") === "inventario-tecnologico-equipo-servidor-lista", "combobox");
    exigir(/^\d+ de \d+ posibles servidores$/.test(await texto(page, `${SERV}-cuenta`)), await texto(page, `${SERV}-cuenta`));
    exigir(await page.getAttribute(`${SERV}-cuenta`, "aria-live") === "polite", "sin aria-live");
  });
  await verificar("selector: «más cerca primero» — ninguno, lo de la misma ubicación y después por distancia; el activo del Data Center en su grupo", async ()=>{
    const claves = await opcionesVisibles(page);
    exigir(claves[0] === "" && ["30", "31", "32"].every(c=>claves.slice(1, 4).includes(c)), claves.join(","));
    exigir(claves[claves.length - 1] === "a:4" && !claves.includes("a:5"), "el Router ubicado va al final y el que no tiene ubicación no está: " + claves.join(","));
    const grupos = await page.locator(`${SERV}-lista .inventario-tecnologico-serv-grupo`).allInnerTexts();
    exigir(grupos.length === 2 && /activos del inventario/i.test(grupos[1]) && /se registran al guardar/i.test(grupos[1]), grupos.join(" | "));
    exigir(/misma ubicación/.test(await page.locator(`${SERV}-lista [data-clave="30"]`).innerText()), "sin la marca de misma ubicación");
  });
  await verificar("selector: búsqueda sin tildes y por varias palabras, con lo buscado resaltado", async ()=>{
    await page.fill(`${SERV}-filtro`, "router data");
    exigir(JSON.stringify(await opcionesVisibles(page)) === '["a:4"]', JSON.stringify(await opcionesVisibles(page)));
    exigir(await cuenta(page, `${SERV}-lista mark`) >= 2, "no resalta");
    await page.fill(`${SERV}-filtro`, "camara");
    const conCamara = (await opcionesVisibles(page)).sort();
    exigir(JSON.stringify(conCamara) === '["50","51","52"]', "«camara» sin tilde (tipo o red «Cámaras»): " + JSON.stringify(conCamara));
    await page.fill(`${SERV}-filtro`, "zzz");
    exigir((await opcionesVisibles(page)).length === 0 && /Ningún equipo coincide/.test(await texto(page, `${SERV}-panel .inventario-tecnologico-serv-vacio`)), "sin mensaje de vacío");
    exigir(/asigna el activo del inventario a su ubicación/.test(await texto(page, `${SERV}-panel .inventario-tecnologico-serv-vacio`)), "sin la ayuda");
    await page.fill(`${SERV}-filtro`, "");
  });
  await verificar("selector: filtro de ubicación con casillas y cuentas — Ninguno, doble clic deja solo una, «Quitar filtros»", async ()=>{
    await page.click(`${SERV}-panel [data-faceta="ubicacion"] > summary`);
    exigir(await page.locator(`${SERV}-panel [data-faceta="ubicacion"]`).evaluate(d=>d.open), "no se abrió");
    const cuentaDC = await texto(page, `${SERV}-panel [data-faceta="ubicacion"] [data-cuenta="5"]`);
    exigir(cuentaDC === "1", "cuenta del Data Center: " + cuentaDC);
    await page.screenshot({ path: path.join(CAPTURAS, "30-servidor-filtros.png") });
    await page.click(`${SERV}-panel [data-faceta-ninguno="ubicacion"]`);
    exigir((await opcionesVisibles(page)).length === 0, "Ninguno no vació la lista");
    exigir(/ninguna/.test(await texto(page, `${SERV}-panel [data-estado="ubicacion"]`)), "resumen");
    await page.dblclick(`${SERV}-panel [data-faceta-opt="ubicacion"][data-valor="5"]`);
    exigir(JSON.stringify(await opcionesVisibles(page)) === '["a:4"]', JSON.stringify(await opcionesVisibles(page)));
    exigir(/1 de \d+/.test(await texto(page, `${SERV}-panel [data-estado="ubicacion"]`)) && /con filtros/.test(await texto(page, `${SERV}-cuenta`)), "resumen/cuenta con filtros");
    // Esc pliega el filtro (no cierra el panel) y un clic fuera de un filtro desplegado también lo pliega.
    await page.keyboard.press("Escape");
    exigir(!(await page.locator(`${SERV}-panel [data-faceta="ubicacion"]`).evaluate(d=>d.open)) && !(await page.locator(`${SERV}-panel`).isHidden()), "Esc no plegó solo el filtro");
    exigir(await page.evaluate(()=>document.activeElement.matches('[data-faceta="ubicacion"] > summary')), "el foco no volvió al filtro");
    await page.click(`${SERV}-panel [data-faceta-limpiar]`);
    exigir((await opcionesVisibles(page)).length > 5, "no volvieron todos");
    exigir(await page.locator(`${SERV}-panel [data-faceta-limpiar]`).isHidden(), "«Quitar filtros» sigue a la vista");
  });
  await verificar("selector (v12, 3.5): «solo», Mayús+Enter y doble clic en la única devuelven todos", async ()=>{
    await page.click(`${SERV}-panel [data-faceta="ubicacion"] > summary`);
    const total = (await opcionesVisibles(page)).length;
    const opDC = `${SERV}-panel [data-faceta-opt="ubicacion"][data-valor="5"]`;
    await page.dblclick(opDC);
    exigir(JSON.stringify(await opcionesVisibles(page)) === '["a:4"]', JSON.stringify(await opcionesVisibles(page)));
    await page.dblclick(opDC);
    exigir((await opcionesVisibles(page)).length === total, "el doble clic en la única no devolvió todos");
    exigir(/Doble clic, «solo» o Mayús\+Enter/.test(await texto(page, `${SERV}-panel [data-faceta="ubicacion"] .inventario-tecnologico-filter-panel-hint`)), "ayuda");
    await page.hover(`${SERV}-panel .inventario-tecnologico-filtro-fila:has([data-faceta-opt="ubicacion"][data-valor="5"])`);
    await page.click(`${SERV}-panel [data-faceta-solo="ubicacion"][data-valor="5"]`);
    exigir(JSON.stringify(await opcionesVisibles(page)) === '["a:4"]', "«solo»: " + JSON.stringify(await opcionesVisibles(page)));
    await page.focus(`${SERV}-panel input[data-faceta-casilla="ubicacion"][value="5"]`);
    await page.keyboard.press("Shift+Enter");
    exigir((await opcionesVisibles(page)).length === total, "Mayús+Enter en la única no devolvió todos");
    exigir(await page.isChecked(`${SERV}-panel input[data-faceta-casilla="ubicacion"][value="5"]`), "Mayús+Enter alternó la casilla");
    exigir(!(await page.locator(`${SERV}-panel`).isHidden()), "el panel se cerró");
    await page.click(`${SERV}-panel [data-faceta="ubicacion"] > summary`);
  });
  await verificar("selector: filtro de origen (equipos de red / activos del inventario)", async ()=>{
    await page.click(`${SERV}-panel [data-faceta="ubicacion"] > summary`);
    await page.click(`${SERV}-panel [data-faceta="origen"] > summary`);
    exigir(!(await page.locator(`${SERV}-panel [data-faceta="ubicacion"]`).evaluate(d=>d.open)), "se abren dos filtros a la vez");
    await page.uncheck(`${SERV}-panel input[data-faceta-casilla="origen"][value="equipo"]`);
    exigir(JSON.stringify(await opcionesVisibles(page)) === '["a:4"]', "con filtros «Ninguno» no se muestra: " + JSON.stringify(await opcionesVisibles(page)));
    await page.check(`${SERV}-panel input[data-faceta-casilla="origen"][value="equipo"]`);
    await page.click(`${SERV}-cuenta`); // clic fuera: se pliega
    exigir(!(await page.locator(`${SERV}-panel [data-faceta="origen"]`).evaluate(d=>d.open)), "no se plegó al hacer clic fuera");
  });
  await verificar("selector: el orden se cambia y se recuerda (Z–A)", async ()=>{
    await page.selectOption(`${SERV}-orden`, "za");
    const nombres = await page.locator(`${SERV}-lista [role=option]:not([data-clave=""]):not([data-clave^="a:"]) .inventario-tecnologico-serv-op-nombre`).allInnerTexts();
    const ordenados = [...nombres].sort((a, b)=>b.localeCompare(a, "es", { sensitivity: "base", numeric: true }));
    exigir(JSON.stringify(nombres) === JSON.stringify(ordenados), nombres.slice(0, 4).join(" | "));
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-orden-servidor")) === "za", "no se guardó");
  });
  await verificar("selector: Esc cierra solo el panel (el formulario sigue abierto) y devuelve el foco al botón", async ()=>{
    await page.focus(`${SERV}-filtro`);
    await page.keyboard.press("Escape");
    await page.waitForSelector(`${SERV}-panel[hidden]`, { state: "attached" });
    exigir(await cuenta(page, "#inventario-tecnologico-modal-host .inventario-tecnologico-modal") === 1, "se cerró el formulario");
    exigir(await page.evaluate(()=>document.activeElement.id) === "inventario-tecnologico-equipo-servidor-boton", "el foco no volvió al botón");
  });
  await verificar("selector: escribir sobre el botón abre la búsqueda; flechas + Enter eligen el Router del Data Center", async ()=>{
    await page.keyboard.type("data c");
    await page.waitForSelector(`${SERV}-panel:not([hidden])`);
    exigir(await page.inputValue(`${SERV}-filtro`) === "data c", "la búsqueda no empezó con lo escrito: " + await page.inputValue(`${SERV}-filtro`));
    exigir(await page.evaluate(s=>document.getElementById(s).getAttribute("aria-activedescendant"), "inventario-tecnologico-equipo-servidor-filtro") === "inventario-tecnologico-equipo-servidor-op-0", "activa");
    await page.keyboard.press("Enter");
    await page.waitForSelector(`${SERV}-panel[hidden]`, { state: "attached" });
    exigir(await page.inputValue(SERV) === "a:4", "no quedó elegido: " + await page.inputValue(SERV));
    const b = await texto(page, `${SERV}-boton`);
    exigir(/Router en Data Center/.test(b) && /activo LKM-004/.test(b) && /se registra al guardar/.test(b), b);
  });
  await verificar("con un Router de otra ubicación el medio se pone en «Cable» (un Router no hace radioenlaces) y el nombre lo sigue", async ()=>{
    exigir(await page.inputValue("#inventario-tecnologico-equipo-medio") === "cable", "medio: " + await page.inputValue("#inventario-tecnologico-equipo-medio"));
    exigir(/Puesto en «Cable».*Router no hace radioenlaces/.test(await texto(page, "#inventario-tecnologico-equipo-medio-ayuda")), await texto(page, "#inventario-tecnologico-equipo-medio-ayuda"));
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "ptp");
    await page.fill("#inventario-tecnologico-equipo-referencia", "Hacia CA");
    await page.selectOption("#inventario-tecnologico-equipo-red", "1");
    const n = await texto(page, "#inventario-tecnologico-equipo-nombre-auto");
    exigir(n === "Punto a Punto (Red Administrativa · Hacia CA) en Oficina Centro conectado a Router en Data Center", n);
    exigir(/Por cable hasta «Router en Data Center».*se registra como equipo de red de «Data Center»/.test(await texto(page, `${SERV}-calculo`)), await texto(page, `${SERV}-calculo`));
    await page.screenshot({ path: path.join(CAPTURAS, "31-servidor-elegido.png") });
  });
  await verificar("guardar: primero se registra el Router del Data Center (con su activo) y después el equipo queda colgado de él por cable", async ()=>{
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const ins = (await ESCRITURAS_EQUIPOS(page)).filter(e=>e.op === "insert");
    exigir(ins.length === 2, `${ins.length} altas`);
    const router = ins[0].filas[0], ptp = ins[1].filas[0];
    exigir(router.ubicacion_id === 5 && router.tipo_equipo === "router" && router.activo_id === 4 && router.servidor_id === null && router.nombre === "Router en Data Center", JSON.stringify(router));
    exigir(ptp.servidor_id === router.id && ptp.medio === "cable" && ptp.red_id === 1 && ptp.nombre === "Punto a Punto (Red Administrativa · Hacia CA) en Oficina Centro conectado a Router en Data Center", JSON.stringify(ptp));
    await toast(page, /quedó registrado como equipo de red/);
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await esperarCuenta(page, `path.inventario-tecnologico-mapa-linea-cable[data-cliente-id="${ptp.id}"]`, 1, "línea de cable Data Center → Oficina");
  });
  await verificar("al volver a editarlo, su servidor es el Router ya registrado y ese activo ya no se ofrece como nuevo", async ()=>{
    const ptp = (await db(page, "equipos_radioenlace")).find(e=>e.referencia === "Hacia CA");
    const router = (await db(page, "equipos_radioenlace")).find(e=>e.activo_id === 4);
    await irAUbicacionDesdePanel(page, 3);
    await page.click(SEL.equipo(ptp.id));
    await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="${ptp.id}"]`);
    await page.waitForSelector(`${SERV}-boton`);
    exigir(await page.inputValue(SERV) === String(router.id), "servidor: " + await page.inputValue(SERV));
    const valores = await page.locator(`${SERV} option`).evaluateAll(o=>o.map(x=>x.value));
    exigir(!valores.includes("a:4"), valores.join(","));
    await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");
    await esperarSinModal(page);
  });
  await verificar("010: renombrar una red pone al día los nombres (en la base y en el panel)", async ()=>{
    await page.click("#inventario-tecnologico-mapa-redes-tipos");
    await page.waitForSelector("#inventario-tecnologico-red-nueva-nombre");
    const fila = page.locator('#inventario-tecnologico-modal-host [data-red-id="1"]');
    await fila.locator('input[type="text"]').fill("Red Admin");
    await fila.locator("button", { hasText: "Guardar" }).click();
    await toast(page, /Red|red/);
    await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");
    await esperarSinModal(page);
    const ptp = (await db(page, "equipos_radioenlace")).find(e=>e.referencia === "Hacia CA");
    exigir(ptp.nombre === "Punto a Punto (Red Admin · Hacia CA) en Oficina Centro conectado a Router en Data Center", ptp.nombre);
    await irAUbicacionDesdePanel(page, 3);
    exigir((await texto(page, SEL.panel)).includes("Punto a Punto (Red Admin · Hacia CA) conectado a Router en Data Center"), "el panel no lo muestra");
  });
  await verificar("respaldo: el mismo selector (sin «Ninguno»), con búsqueda, y se guarda el elegido", async ()=>{
    await irAUbicacionDesdePanel(page, 3);
    await page.click(SEL.equipo(32));
    await page.click(`${SEL.panel} [data-accion="nuevo-respaldo"][data-id="32"]`);
    await page.waitForSelector("#inventario-tecnologico-respaldo-servidor-boton");
    exigir(/Elige un equipo/.test(await texto(page, "#inventario-tecnologico-respaldo-servidor-boton")), "placeholder");
    await page.click("#inventario-tecnologico-respaldo-servidor-boton");
    const claves = await page.locator("#inventario-tecnologico-respaldo-servidor-lista [role=option]").evaluateAll(l=>l.map(x=>x.dataset.clave));
    exigir(!claves.includes("") && !claves.some(c=>c.startsWith("a:")) && !claves.includes("32") && !claves.includes("21"), claves.join(","));
    await page.fill("#inventario-tecnologico-respaldo-servidor-filtro", "epmp");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#inventario-tecnologico-respaldo-servidor-panel[hidden]", { state: "attached" });
    await page.click("#inventario-tecnologico-respaldo-guardar");
    await esperarSinModal(page);
    const r = (await db(page, "enlaces_respaldo")).find(x=>x.equipo_id === 32);
    exigir(r && r.servidor_alternativo_id === 11, JSON.stringify(r));
  });
  await verificar("sin errores de JavaScript (servidor)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  // Sin la 010: la base arma los nombres sin la red y la app también.
  const s8 = await abrirApp(browser, base, fixture({ red007: true, red008: true, servidor: true }));
  await irAlMapa(s8.page);
  await verificar("sin la 010: los nombres no llevan la red (igual que en la base)", async ()=>{
    await irAUbicacionDesdePanel(s8.page, 1);
    const t = await texto(s8.page, SEL.panel);
    exigir(t.includes("Switch conectado a Punto a Punto") && !t.includes("(Red Cámaras)"), t.slice(0, 300));
  });
  await verificar("sin errores de JavaScript (sin la 010)", async ()=>{ exigir(s8.errores.length === 0, s8.errores.join(" | ")); });
  await s8.context.close();

  // En el celular: el panel cabe en la pantalla, sin scroll horizontal, y el
  // filtro desplegado no se sale por el borde.
  const cel = await abrirApp(browser, base, fixture({ red007: true, red008: true, red010: true, servidor: true }), { viewport: { width: 390, height: 844 } });
  await irAlMapa(cel.page);
  await irAUbicacionDesdePanel(cel.page, 3);
  await cel.page.click(`${SEL.panel} [data-accion="nuevo-equipo"][data-id="3"]`);
  await cel.page.waitForSelector(`${SERV}-boton`);
  await verificar("celular (390 px): el selector de servidor cabe en la pantalla, sin scroll horizontal, y se elige con el dedo", async ()=>{
    await cel.page.click(`${SERV}-boton`);
    await cel.page.waitForSelector(`${SERV}-panel:not([hidden])`);
    const fuera = async sel=>{ const b = await cel.page.locator(sel).boundingBox(); return b && b.x >= 0 && b.x + b.width <= 390 + 0.5 ? "" : JSON.stringify(b); };
    await cel.page.waitForTimeout(300); // que termine la animación de entrada
    await cel.page.screenshot({ path: path.join(CAPTURAS, "32-servidor-celular.png") });
    const p = await fuera(`${SERV}-panel`);
    if(p && process.env.DEPURAR) console.log(await cel.page.evaluate(()=>{
      const out = [];
      const body = document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-body");
      out.push(`body scrollLeft=${body.scrollLeft} scrollWidth=${body.scrollWidth} clientWidth=${body.clientWidth}`);
      for(const el of body.querySelectorAll("*")){
        const r = el.getBoundingClientRect();
        if(r.width && (r.right > 391 || r.left < -1) && ![...el.children].some(c=>{ const q = c.getBoundingClientRect(); return q.width && (q.right > 391 || q.left < -1); }))
          out.push(`${el.tagName}.${[...el.classList].join(".")}#${el.id} left=${r.left.toFixed(1)} right=${r.right.toFixed(1)} w=${r.width.toFixed(1)} sw=${el.scrollWidth}`);
      }
      return out.slice(0, 40).join("\n");
    }));
    exigir(!p, "el panel se sale por el borde: " + p);
    await cel.page.click(`${SERV}-panel [data-faceta="ubicacion"] > summary`);
    await cel.page.screenshot({ path: path.join(CAPTURAS, "33-servidor-celular-filtro.png") });
    const f = await fuera(`${SERV}-panel [data-faceta="ubicacion"] .inventario-tecnologico-serv-faceta-cuerpo`);
    exigir(!f, "el filtro desplegado se sale por el borde: " + f);
    const anchoModal = await cel.page.evaluate(()=>{ const m = document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal"); return [document.documentElement.scrollWidth, m ? m.scrollWidth - m.clientWidth : 0]; });
    exigir(anchoModal[0] <= 390 && anchoModal[1] <= 0, "scroll horizontal: " + anchoModal.join(","));
    await cel.page.click(`${SERV}-panel [data-faceta="ubicacion"] > summary`);
    const alto = (await cel.page.locator(`${SERV}-lista [data-clave="a:4"]`).boundingBox()).height;
    exigir(alto >= 44, `opción de ${alto} px (mínimo 44 para el dedo)`);
    await cel.page.locator(`${SERV}-lista [data-clave="a:4"]`).tap().catch(()=>cel.page.click(`${SERV}-lista [data-clave="a:4"]`));
    await cel.page.waitForSelector(`${SERV}-panel[hidden]`, { state: "attached" });
    exigir(await cel.page.inputValue(SERV) === "a:4", "no quedó elegido");
  });
  await verificar("sin errores de JavaScript (servidor en el celular)", async ()=>{ exigir(cel.errores.length === 0, cel.errores.join(" | ")); });
  await cel.context.close();
}

// ------------------------------------------------------------------ v9: la red se hereda del servidor (011)
// Con la 011 el stub arranca normalizado: solo el Router de la Oficina (Red
// Administrativa) y el Switch de Cerro Azul (Red Cámaras) tienen red propia;
// lo demás la hereda.
const CHIP_RED = (id, heredada)=>`${SEL.panel} [data-equipo-id="${id}"] .inventario-tecnologico-mapa-red-chip${heredada ? ".inventario-tecnologico-mapa-red-chip-heredada" : ":not(.inventario-tecnologico-mapa-red-chip-heredada)"}`;
async function abrirEdicionEquipo(page, ubicacionId, equipoId){
  await irAUbicacionDesdePanel(page, ubicacionId);
  await page.click(SEL.equipo(equipoId));
  await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="${equipoId}"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-red");
}
async function cerrarFormulario(page){
  await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");
  await esperarSinModal(page);
}
const primeraOpcionRed = page=>page.locator("#inventario-tecnologico-equipo-red option").first().innerText();
async function escenarioHerencia(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture({ red007: true, red008: true, red011: true }));
  await irAlMapa(page);
  await verificar("011: al aplicar la migración las redes propias repetidas quedan vacías y los nombres llevan la red heredada", async ()=>{
    const eqs = await db(page, "equipos_radioenlace");
    const e = id=>eqs.find(x=>x.id === id);
    const conPropia = eqs.filter(x=>x.red_id !== null).map(x=>x.id).sort((a, b)=>a - b);
    exigir(JSON.stringify(conPropia) === "[30,50]", "con red propia: " + JSON.stringify(conPropia));
    exigir(e(10).nombre === "Punto a Punto (Red Administrativa) en Torre Cerro Azul enlazado a Punto a Punto en Oficina Centro", e(10).nombre);
    exigir(e(50).nombre === "Switch (Red Cámaras) en Torre Cerro Azul conectado a Punto a Punto (Red Administrativa)", e(50).nombre);
    exigir(e(51).nombre === "Cámara (Red Cámaras · Norte) en Torre Cerro Azul conectada a Switch", e(51).nombre);
    exigir(e(32).nombre === "Estación (Red Administrativa) en Oficina Centro enlazada a AP en Torre Santa Ana", e(32).nombre);
  });
  await verificar("011: los chips REDES cuentan la red efectiva (sin «Sin red»: todo hereda alguna)", async ()=>{
    const chips = await page.locator(".inventario-tecnologico-mapa-filtros [data-red]").evaluateAll(l=>l.map(c=>c.dataset.red + ":" + c.querySelector(".inventario-tecnologico-mapa-chip-n").textContent));
    exigir(chips.join("|") === "1:18|2:3", chips.join("|"));
  });
  await verificar("011: en la torre, la red propia va con borde lleno y la heredada punteada, diciendo de quién la hereda", async ()=>{
    await irAUbicacionDesdePanel(page, 1);
    exigir(await cuenta(page, CHIP_RED(50, false)) === 1, "el switch (red propia) no tiene chip lleno");
    exigir(await cuenta(page, CHIP_RED(51, true)) === 1, "la cámara no tiene chip heredado");
    exigir(/heredada de «Switch \(Red Cámaras\)/.test(await page.getAttribute(CHIP_RED(51, true), "title")), await page.getAttribute(CHIP_RED(51, true), "title"));
    exigir(/Red Administrativa/.test(await texto(page, CHIP_RED(10, true))), "el PTP no hereda la red del Router");
    exigir(/heredada de «Router \(Red Administrativa\) en Oficina Centro»/.test(await page.getAttribute(CHIP_RED(10, true), "title")), await page.getAttribute(CHIP_RED(10, true), "title"));
  });
  await verificar("011: formulario de un equipo que hereda: «Heredada del servidor: …», sin repetir esa red como propia, y de quién la hereda", async ()=>{
    await abrirEdicionEquipo(page, 2, 21);
    exigir(await primeraOpcionRed(page) === "Heredada del servidor: Red Administrativa", await primeraOpcionRed(page));
    exigir(await page.inputValue("#inventario-tecnologico-equipo-red") === "", "no quedó heredando");
    const valores = await page.locator("#inventario-tecnologico-equipo-red option").evaluateAll(o=>o.map(x=>x.value));
    exigir(JSON.stringify(valores) === '["","2"]', "la red heredada no debe ofrecerse como propia: " + JSON.stringify(valores));
    const ayuda = await texto(page, "#inventario-tecnologico-equipo-red-ayuda");
    exigir(/La hereda de «Router \(Red Administrativa\) en Oficina Centro» y la pasa a los 2 equipos que cuelgan de él/.test(ayuda), ayuda);
    exigir(await page.getAttribute("#inventario-tecnologico-equipo-red", "aria-describedby") === "inventario-tecnologico-equipo-red-ayuda", "la ayuda no está asociada al campo");
  });
  await verificar("011: otra red en un equipo intermedio: se explica que forma una red aparte y el nombre la muestra", async ()=>{
    await page.selectOption("#inventario-tecnologico-equipo-red", "2");
    const ayuda = await texto(page, "#inventario-tecnologico-equipo-red-ayuda");
    exigir(/Red aparte de «Red Administrativa», la de su servidor\. «Red Cámaras» vale también para los 2 equipos que cuelgan de él/.test(ayuda), ayuda);
    const n = await texto(page, "#inventario-tecnologico-equipo-nombre-auto");
    exigir(n === "AP (Red Cámaras) en Torre Santa Ana conectado a Punto a Punto (Red Administrativa)", n);
  });
  await verificar("011: al guardar, él y lo que cuelga de él quedan en esa red (en la base y en los nombres)", async ()=>{
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const u = (await ESCRITURAS_EQUIPOS(page)).filter(e=>e.op === "update").pop();
    exigir(u.parche.red_id === 2, "parche: " + JSON.stringify(u.parche));
    const eqs = await db(page, "equipos_radioenlace");
    exigir(eqs.find(x=>x.id === 32).nombre === "Estación (Red Cámaras) en Oficina Centro enlazada a AP en Torre Santa Ana", eqs.find(x=>x.id === 32).nombre);
    const chips = await page.locator(".inventario-tecnologico-mapa-filtros [data-red]").evaluateAll(l=>l.map(c=>c.dataset.red + ":" + c.querySelector(".inventario-tecnologico-mapa-chip-n").textContent));
    exigir(chips.join("|") === "1:15|2:6", chips.join("|"));
  });
  await verificar("011: «Colorear líneas por red»: la red aparte sale con su color y el resto con el de la red que hereda", async ()=>{
    await clicVacio(page); // sin selección: el camino resaltado tiene su propio color
    await page.waitForFunction(()=>!document.querySelector("path.inventario-tecnologico-mapa-linea-cadena"), null, { timeout: 4000 });
    await page.click("#inventario-tecnologico-mapa-color-red");
    const color = sel=>page.evaluate(sel=>(document.querySelector(sel)?.getAttribute("stroke") || "").toUpperCase(), sel);
    await page.waitForFunction(()=>(document.querySelector('path.inventario-tecnologico-mapa-linea[data-cliente-id="32"]')?.getAttribute("stroke") || "").toUpperCase() === "#EC741D", null, { timeout: 4000 });
    exigir(await color('path.inventario-tecnologico-mapa-linea[data-cliente-id="40"]') === "#EC741D", "SM Bodega (sin tipo) hereda la red aparte");
    exigir(await color('path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]') === "#004DAB", "el enlace Cerro Azul → Santa Ana sigue en la red del Router");
    exigir(await color('path.inventario-tecnologico-mapa-linea[data-cliente-id="10"]') === "#004DAB", "el PTP de Cerro Azul hereda la red del Router");
    await page.screenshot({ path: path.join(CAPTURAS, "34-red-heredada-colores.png") });
    await page.click("#inventario-tecnologico-mapa-color-red");
  });
  await verificar("011: ocultar una red oculta lo que la hereda, pero no la red aparte que cuelga de ella", async ()=>{
    exigir(await cuenta(page, 'path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]') === 1, "falta la línea de Santa Ana");
    await clicFiltro(page, SEL.chip("red", "1"));
    await page.waitForFunction(()=>!document.querySelector('path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]'), null, { timeout: 4000 });
    exigir(await cuenta(page, 'path.inventario-tecnologico-mapa-linea[data-cliente-id="32"]') === 1, "la red aparte también se ocultó");
    await clicFiltro(page, SEL.chip("red", "1"));
    await page.waitForSelector('path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]');
  });
  await verificar("011: al cambiar el servidor en el formulario, cambia la red que se hereda", async ()=>{
    await abrirEdicionEquipo(page, 3, 32);
    exigir(await primeraOpcionRed(page) === "Heredada del servidor: Red Cámaras", await primeraOpcionRed(page));
    await elegirServidor(page, "11");
    exigir(await primeraOpcionRed(page) === "Heredada del servidor: Red Administrativa", await primeraOpcionRed(page));
    exigir(/^Estación \(Red Administrativa\) en Oficina Centro enlazada a AP en Torre Cerro Azul/.test(await texto(page, "#inventario-tecnologico-equipo-nombre-auto")), await texto(page, "#inventario-tecnologico-equipo-nombre-auto"));
    await cerrarFormulario(page);
  });
  await verificar("011: en la raíz, su red propia y a cuántos equipos pasa", async ()=>{
    await abrirEdicionEquipo(page, 3, 30);
    exigir(await primeraOpcionRed(page) === "— Sin red —", await primeraOpcionRed(page));
    exigir(await page.inputValue("#inventario-tecnologico-equipo-red") === "1", "la raíz perdió su red");
    const ayuda = await texto(page, "#inventario-tecnologico-equipo-red-ayuda");
    exigir(/«Red Administrativa» vale también para los 14 equipos que cuelgan de él \(los que tienen otra red propia la conservan\)/.test(ayuda), ayuda);
    await cerrarFormulario(page);
  });
  await verificar("011: lote: «Quitar la propia (hereda la del servidor)», la columna dice «heredada» y avisa cuántos cambian por herencia", async ()=>{
    await irAUbicacionDesdePanel(page, 3);
    await page.click("#inventario-tecnologico-mapa-lote");
    await page.waitForSelector("#inventario-tecnologico-lote-red");
    exigir(/Quitar la propia \(hereda la del servidor\)/.test(await page.locator('#inventario-tecnologico-lote-red option[value=""]').innerText()), "texto de quitar");
    const fila32 = await texto(page, '#inventario-tecnologico-lote-filas tr[data-id="32"]');
    exigir(/Red Cámaras/.test(fila32) && /heredada/.test(fila32), fila32);
    for(const id of await page.locator("#inventario-tecnologico-lote-filas input[data-lote-id]:checked").evaluateAll(l=>l.map(x=>x.dataset.loteId))) await page.uncheck(`#inventario-tecnologico-lote-filas input[data-lote-id="${id}"]`);
    await page.check('#inventario-tecnologico-lote-filas input[data-lote-id="30"]');
    await page.selectOption("#inventario-tecnologico-lote-red", "2");
    const vista = await texto(page, "#inventario-tecnologico-lote-vista");
    exigir(/Por herencia también cambian de red 14 equipos que cuelgan de ellos/.test(vista), vista);
    exigir(/AP \(Red Administrativa\) en Torre Cerro Azul conectado a Punto a Punto\s*→\s*AP \(Red Cámaras\) en Torre Cerro Azul conectado a Punto a Punto/.test(vista), "la vista previa no muestra los nombres de los que heredan: " + vista.replace(/\s+/g, " ").slice(0, 600));
    await page.screenshot({ path: path.join(CAPTURAS, "35-red-heredada-lote.png") });
    await page.click("#inventario-tecnologico-lote-aplicar");
    await esperarSinModal(page);
    const eqs = await db(page, "equipos_radioenlace");
    const conPropia = eqs.filter(x=>x.red_id !== null).map(x=>x.id + ":" + x.red_id);
    exigir(JSON.stringify(conPropia) === '["30:2"]', "las redes propias iguales a la heredada no quedaron vacías: " + JSON.stringify(conPropia));
    exigir(eqs.find(x=>x.id === 50).nombre === "Switch (Red Cámaras) en Torre Cerro Azul conectado a Punto a Punto", eqs.find(x=>x.id === 50).nombre);
  });
  await verificar("011: «Redes y tipos» cuenta los que heredan cada red y cuántos la tienen propia", async ()=>{
    await page.click("#inventario-tecnologico-mapa-redes-tipos");
    await page.waitForSelector("#inventario-tecnologico-red-nueva-nombre");
    const cuentaRed = id=>texto(page, `#inventario-tecnologico-modal-host [data-red-id="${id}"] .inventario-tecnologico-catalogo-cuenta`);
    exigir(await cuentaRed(2) === "21 equipos (1 con la red propia)", await cuentaRed(2));
    exigir(await cuentaRed(1) === "0 equipos", await cuentaRed(1));
    await cerrarFormulario(page);
  });
  await verificar("sin errores de JavaScript (red heredada)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  // Sin la 011 (con la 010): cada equipo tiene solo su red, como en el v8.
  const s10 = await abrirApp(browser, base, fixture({ red007: true, red008: true, red010: true }));
  await irAlMapa(s10.page);
  await verificar("sin la 011: el campo Red es el de siempre («— Sin red —», sin ayuda de herencia) y el chip no dice «heredada»", async ()=>{
    await irAUbicacionDesdePanel(s10.page, 1);
    exigir(await cuenta(s10.page, `${SEL.panel} .inventario-tecnologico-mapa-red-chip-heredada`) === 0, "hay chips heredados sin la 011");
    await abrirEdicionEquipo(s10.page, 2, 21);
    exigir(await primeraOpcionRed(s10.page) === "— Sin red —", await primeraOpcionRed(s10.page));
    exigir(await s10.page.inputValue("#inventario-tecnologico-equipo-red") === "1", "perdió su red");
    exigir(await cuenta(s10.page, "#inventario-tecnologico-equipo-red-ayuda") === 0, "ayuda de herencia sin la 011");
    await cerrarFormulario(s10.page);
  });
  await verificar("sin errores de JavaScript (sin la 011)", async ()=>{ exigir(s10.errores.length === 0, s10.errores.join(" | ")); });
  await s10.context.close();
}

// ------------------------------------------------------------------ v9: pantalla completa y grosor de las líneas
const VENTANA = { barra: ".inventario-tecnologico-mapa-barra", panel: ".inventario-tecnologico-mapa-panel-ventana" };
const ALTERNAR = cual=>`[data-ventana-alternar="${cual}"]`;
const BOTON_COMPLETA = "#inventario-tecnologico-mapa-pantalla-completa";
const COMPLETA = ".inventario-tecnologico-mapa-vista.inventario-tecnologico-mapa-completa";
const anchoLinea = (page, cliente)=>page.evaluate(id=>Number(document.querySelector(`path.inventario-tecnologico-mapa-linea[data-cliente-id="${id}"]`)?.getAttribute("stroke-width")), cliente);
async function escenarioPantalla(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());
  await irAlMapa(page);
  await verificar("grosor: un control en «Líneas» (1× al empezar) que engrosa todas las líneas y sus punteados", async ()=>{
    exigir(await page.inputValue("#inventario-tecnologico-mapa-grosor") === "1", "valor inicial");
    exigir(await texto(page, "#inventario-tecnologico-mapa-grosor-valor") === "1×", "texto inicial");
    exigir(await page.locator("#inventario-tecnologico-mapa-grosor-normal").isHidden(), "«Normal» a la vista con 1×");
    const antes = await anchoLinea(page, 20);
    exigir(antes === 5, "backbone: " + antes);
    await page.locator("#inventario-tecnologico-mapa-grosor").fill("2");
    await page.waitForFunction(()=>Number(document.querySelector('path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]')?.getAttribute("stroke-width")) === 10, null, { timeout: 4000 });
    exigir(await anchoLinea(page, 101) === 4.4 || await cuenta(page, 'path.inventario-tecnologico-mapa-linea[data-cliente-id="101"]') === 0, "P2MP");
    exigir(await texto(page, "#inventario-tecnologico-mapa-grosor-valor") === "2×" && await page.getAttribute("#inventario-tecnologico-mapa-grosor", "aria-valuetext") === "2×", "texto");
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-grosor-lineas")) === "2", "no se recordó");
    exigir(!(await page.locator("#inventario-tecnologico-mapa-grosor-normal").isHidden()), "sin «Normal»");
  });
  await verificar("grosor: el camino resaltado y los punteados también (el punteado conserva su forma)", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
    const w = await page.evaluate(()=>[...document.querySelectorAll("path.inventario-tecnologico-mapa-linea-cadena")].map(p=>Number(p.getAttribute("stroke-width"))));
    exigir(w.length && w.every(x=>x === 12), "cadena: " + w.join(","));
    await seleccionarEquipoDesdeSuUbicacion(page, 2, 20);
    await page.click(SEL.simular(20));
    await page.waitForSelector("path.inventario-tecnologico-mapa-linea-cortado");
    const dash = await page.getAttribute("path.inventario-tecnologico-mapa-linea-cortado", "stroke-dasharray");
    exigir(dash === "6 16" || dash === "6,16", "punteado de «cortado» (3 8 × 2): " + dash);
    exigir(Number(await page.getAttribute("path.inventario-tecnologico-mapa-linea-cortado", "stroke-width")) === 6, "ancho de «cortado»");
    await page.click("#inventario-tecnologico-mapa-simulacion");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  });
  await verificar("grosor: se recuerda al volver al mapa y «Normal» lo deja en 1×", async ()=>{
    await page.click(SEL.tab("activos"));
    await irAlMapa(page);
    exigir(await page.inputValue("#inventario-tecnologico-mapa-grosor") === "2", "no se recordó: " + await page.inputValue("#inventario-tecnologico-mapa-grosor"));
    exigir(await anchoLinea(page, 20) === 10, "al volver: " + await anchoLinea(page, 20));
    await page.click("#inventario-tecnologico-mapa-grosor-normal");
    await page.waitForFunction(()=>Number(document.querySelector('path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]')?.getAttribute("stroke-width")) === 5, null, { timeout: 4000 });
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-grosor-lineas")) === "1", "no se guardó el 1×");
    exigir(await page.evaluate(()=>document.activeElement.id) === "inventario-tecnologico-mapa-grosor", "el foco no volvió al control");
  });

  await verificar("pantalla completa: botón debajo del zoom; el mapa cubre la ventana y las dos ventanas arrancan minimizadas", async ()=>{
    exigir(await page.getAttribute(BOTON_COMPLETA, "aria-label") === "Ver el mapa en pantalla completa", "rótulo");
    const antes = await page.locator("#inventario-tecnologico-mapa-canvas").boundingBox();
    await page.click(BOTON_COMPLETA);
    await page.waitForSelector(COMPLETA);
    await page.waitForFunction(()=>{ const r = document.getElementById("inventario-tecnologico-mapa-canvas").getBoundingClientRect(); return r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }, null, { timeout: 4000 });
    exigir(antes.width < 1300, "el mapa ya ocupaba todo antes");
    exigir(await page.getAttribute(BOTON_COMPLETA, "aria-pressed") === "true" && /Salir/.test(await page.getAttribute(BOTON_COMPLETA, "aria-label")), "botón");
    for(const cual of ["barra", "panel"]){
      exigir(await page.locator(VENTANA[cual]).evaluate(el=>el.classList.contains("inventario-tecnologico-ventana-minimizada")), `${cual} no arrancó minimizada`);
      exigir(await page.getAttribute(ALTERNAR(cual), "aria-expanded") === "false", `${cual}: aria-expanded`);
    }
    exigir(await page.locator("#inventario-tecnologico-mapa-buscar").isHidden() && await page.locator("#inventario-tecnologico-mapa-panel").isHidden(), "el contenido se ve minimizado");
    exigir(await page.evaluate(()=>document.body.classList.contains("inventario-tecnologico-con-mapa-completo") && getComputedStyle(document.body).overflow === "hidden"), "la página de atrás se desplaza");
    exigir(await page.evaluate(()=>{ const m = window.__mapaActual; return true; }), "");
    await page.screenshot({ path: path.join(CAPTURAS, "36-pantalla-completa.png") });
  });
  await verificar("pantalla completa: una ventana se muestra y se minimiza con su botón (y con doble clic en su título)", async ()=>{
    await page.click(ALTERNAR("panel"));
    exigir(await page.getAttribute(ALTERNAR("panel"), "aria-expanded") === "true", "no se abrió");
    exigir(!(await page.locator("#inventario-tecnologico-mapa-panel").isHidden()), "el panel no se ve");
    exigir(await texto(page, `${VENTANA.panel} [data-ventana-titulo]`) === "Ubicaciones y radioenlaces", await texto(page, `${VENTANA.panel} [data-ventana-titulo]`));
    const caja = await page.locator(VENTANA.panel).boundingBox();
    const controles = await page.locator(".leaflet-top.leaflet-right").boundingBox();
    exigir(caja.y >= controles.y + controles.height - 1, "el panel tapa los controles de capas");
    await page.dblclick(`${VENTANA.panel} [data-ventana-titulo]`);
    exigir(await page.getAttribute(ALTERNAR("panel"), "aria-expanded") === "false", "doble clic no la minimizó");
    await page.dblclick(`${VENTANA.panel} [data-ventana-titulo]`);
    exigir(await page.getAttribute(ALTERNAR("panel"), "aria-expanded") === "true", "doble clic no la mostró");
  });
  await verificar("pantalla completa: al elegir una ubicación en el mapa, el título de la ventana la nombra (y se ilumina si está minimizada)", async ()=>{
    await page.click(SEL.marcador("Torre Cerro Azul"));
    await page.waitForFunction(()=>document.querySelector('.inventario-tecnologico-mapa-panel-ventana [data-ventana-titulo]').textContent === "Torre Cerro Azul", null, { timeout: 4000 });
    await page.click(ALTERNAR("panel"));
    await page.click(SEL.marcador("Torre Santa Ana"));
    await page.waitForFunction(()=>document.querySelector('.inventario-tecnologico-mapa-panel-ventana [data-ventana-titulo]').textContent === "Torre Santa Ana", null, { timeout: 4000 });
    exigir(await page.locator(VENTANA.panel).evaluate(el=>el.classList.contains("inventario-tecnologico-ventana-aviso")), "no avisa: " + await page.locator(VENTANA.panel).evaluate(el=>el.className));
    await page.click(`${VENTANA.panel} [data-ventana-titulo]`);
    exigir(await page.getAttribute(ALTERNAR("panel"), "aria-expanded") === "true", "un clic en el título de la minimizada no la mostró");
  });
  await verificar("pantalla completa: la ventana se arrastra por su título y no se sale de la pantalla", async ()=>{
    const cab = page.locator(`${VENTANA.panel} [data-ventana-titulo]`);
    const r = await cab.boundingBox();
    await page.mouse.move(r.x + 20, r.y + r.height / 2);
    await page.mouse.down();
    await page.mouse.move(r.x - 300, r.y + 200, { steps: 6 });
    await page.mouse.up();
    const d = await page.locator(VENTANA.panel).boundingBox();
    exigir(Math.abs(d.x - (r.x - 320 - 12)) < 60 || d.x < r.x - 200, `no se movió: ${JSON.stringify(d)}`);
    exigir(await page.getAttribute(ALTERNAR("panel"), "aria-expanded") === "true", "arrastrar la minimizó o la cambió");
    await page.mouse.move(d.x + 30, d.y + 15);
    await page.mouse.down();
    await page.mouse.move(-500, -500, { steps: 4 });
    await page.mouse.up();
    const e = await page.locator(VENTANA.panel).boundingBox();
    exigir(e.x >= -1 && e.y >= -1, `se salió: ${JSON.stringify(e)}`);
    // Se la devuelve a la derecha, para que no tape la barra.
    await page.mouse.move(e.x + 30, e.y + 15);
    await page.mouse.down();
    await page.mouse.move(1000, 320, { steps: 4 });
    await page.mouse.up();
  });
  await verificar("pantalla completa: la barra de búsqueda y filtros funciona como ventana (la lista de resultados se ve entera)", async ()=>{
    await page.click(ALTERNAR("barra"));
    exigir(!(await page.locator("#inventario-tecnologico-mapa-buscar").isHidden()), "no se ve el buscador");
    await page.fill("#inventario-tecnologico-mapa-buscar", "Santa");
    await page.waitForSelector("#inventario-tecnologico-mapa-resultados:not([hidden])");
    const alto = await page.evaluate(()=>{ const l = document.getElementById("inventario-tecnologico-mapa-resultados"); const r = l.getBoundingClientRect(); return document.elementFromPoint(r.left + 20, r.bottom - 6)?.closest("#inventario-tecnologico-mapa-resultados") !== null; });
    exigir(alto, "la lista queda tapada o recortada");
    await page.keyboard.press("Escape");
    await page.fill("#inventario-tecnologico-mapa-buscar", "");
    await page.click(ALTERNAR("barra")); // de nuevo minimizada, para no tapar el mapa
    exigir(await page.getAttribute(ALTERNAR("barra"), "aria-expanded") === "false", "no se minimizó");
  });
  await verificar("pantalla completa: los formularios (modales) se ven encima del mapa", async ()=>{
    await irAUbicacionDesdePanel(page, 1);
    await page.waitForSelector(`${SEL.panel} [data-accion="editar-ubicacion"], ${SEL.panel} [data-accion="nuevo-equipo"]`);
    const accion = await page.locator(`${SEL.panel} [data-accion="editar-ubicacion"]`).count() ? "editar-ubicacion" : "nuevo-equipo";
    await page.click(`${SEL.panel} [data-accion="${accion}"]`);
    await page.waitForSelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal");
    const visible = await page.evaluate(()=>{ const m = document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal"); const r = m.getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + 20); return !!(el && el.closest("#inventario-tecnologico-modal-host")); });
    exigir(visible, "el modal queda debajo del mapa");
    await page.keyboard.press("Escape");
    await esperarSinModal(page);
    exigir(await cuenta(page, COMPLETA) === 1, "cerrar el modal sacó de la pantalla completa");
  });
  await verificar("pantalla completa: Esc primero cierra lo seleccionado y después sale; todo vuelve a su lugar", async ()=>{
    await page.keyboard.press("Escape");
    exigir(await cuenta(page, COMPLETA) === 1, "salió con algo seleccionado");
    await page.keyboard.press("Escape");
    await page.waitForFunction(()=>!document.querySelector(".inventario-tecnologico-mapa-completa"), null, { timeout: 4000 });
    exigir(await cuenta(page, ".inventario-tecnologico-mapa-ventana-cab") === 0 && await cuenta(page, VENTANA.panel) === 0, "quedaron títulos o contenedores de ventana");
    exigir(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-panel").parentElement.classList.contains("inventario-tecnologico-mapa-layout")), "el panel no volvió a su lugar");
    exigir(!(await page.locator("#inventario-tecnologico-mapa-buscar").isHidden()), "el buscador quedó oculto");
    exigir(await page.getAttribute(BOTON_COMPLETA, "aria-pressed") === "false", "botón");
    exigir(!(await page.evaluate(()=>document.body.classList.contains("inventario-tecnologico-con-mapa-completo"))), "la página sigue bloqueada");
    await page.waitForFunction(()=>document.getElementById("inventario-tecnologico-mapa-canvas").getBoundingClientRect().width < innerWidth - 100, null, { timeout: 4000 });
    // El panel sigue funcionando con sus clics (sus listeners viajaron con él).
    await page.click(SEL.marcador("Torre Cerro Azul"));
    await page.click(SEL.equipo(11));
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="11"].inventario-tecnologico-mapa-equipo-sel`);
  });
  await verificar("pantalla completa: al volver a entrar, las ventanas arrancan minimizadas otra vez (y el botón también sale)", async ()=>{
    await page.click(BOTON_COMPLETA);
    await page.waitForSelector(COMPLETA);
    exigir(await page.getAttribute(ALTERNAR("panel"), "aria-expanded") === "false" && await page.getAttribute(ALTERNAR("barra"), "aria-expanded") === "false", "no arrancaron minimizadas");
    exigir(await texto(page, `${VENTANA.panel} [data-ventana-titulo]`) !== "", "sin título");
    await page.click(BOTON_COMPLETA);
    await page.waitForFunction(()=>!document.querySelector(".inventario-tecnologico-mapa-completa"), null, { timeout: 4000 });
  });
  await verificar("sin errores de JavaScript (pantalla completa y grosor)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  const cel = await abrirApp(browser, base, fixture(), { viewport: { width: 390, height: 844 } });
  await irAlMapa(cel.page);
  await verificar("celular (390 px): pantalla completa con las ventanas dentro de la pantalla y el panel como hoja de abajo", async ()=>{
    await cel.page.click(BOTON_COMPLETA);
    await cel.page.waitForSelector(COMPLETA);
    const dentro = async sel=>{ const b = await cel.page.locator(sel).boundingBox(); return b && b.x >= -0.5 && b.x + b.width <= 390.5 && b.y >= -0.5 && b.y + b.height <= 844.5; };
    exigir(await dentro(VENTANA.barra) && await dentro(VENTANA.panel), "las ventanas minimizadas se salen");
    await cel.page.click(ALTERNAR("panel"));
    exigir(await dentro(VENTANA.panel), "el panel abierto se sale");
    const p = await cel.page.locator(VENTANA.panel).boundingBox();
    exigir(p.y + p.height > 844 - 80, "no está abajo: " + JSON.stringify(p));
    exigir(await cel.page.evaluate(()=>document.documentElement.scrollWidth) <= 390, "scroll horizontal");
    await cel.page.screenshot({ path: path.join(CAPTURAS, "37-pantalla-completa-celular.png") });
    await cel.page.click(BOTON_COMPLETA);
    await cel.page.waitForFunction(()=>!document.querySelector(".inventario-tecnologico-mapa-completa"), null, { timeout: 4000 });
  });
  await verificar("sin errores de JavaScript (pantalla completa en el celular)", async ()=>{ exigir(cel.errores.length === 0, cel.errores.join(" | ")); });
  await cel.context.close();
}

// ------------------------------------------------------------------ inventario: modal «Nuevo activo»
// Tipo con búsqueda y orden, campos según el tipo (con transición), «+» en
// un submodal que no borra lo escrito, y que al guardar no viajen los campos
// que el tipo oculta.
const FA = id=>`#inventario-tecnologico-fa-${id}`;
const COMBO = { boton: "#inventario-tecnologico-fa-tipo-boton", panel: "#inventario-tecnologico-fa-tipo-panel", filtro: "#inventario-tecnologico-fa-tipo-filtro", orden: "#inventario-tecnologico-fa-tipo-orden", opciones: "#inventario-tecnologico-fa-tipo-lista li" };
const SUBMODAL = "#inventario-tecnologico-submodal-host .inventario-tecnologico-modal";
const camposVisiblesForm = page=>page.evaluate(()=>[...document.querySelectorAll("#inventario-tecnologico-form-activo [data-campo]")].filter(el=>!el.hidden).map(el=>el.dataset.campo).sort().join(","));
async function esperarTransicion(page){
  await page.waitForFunction(()=>{
    const f = document.getElementById("inventario-tecnologico-form-activo");
    return !!f && f.getAnimations({ subtree: true }).every(a=>a.playState !== "running");
  }, null, { timeout: 4000 });
}
async function elegirTipo(page, buscar){
  await page.click(COMBO.boton);
  await page.waitForSelector(COMBO.panel, { state: "visible" });
  await page.fill(COMBO.filtro, buscar);
  await page.keyboard.press("Enter");
  await page.waitForSelector(COMBO.panel, { state: "hidden" });
  await esperarTransicion(page);
}

async function escenarioActivo(browser, base){
  const fx = fixture();
  fx.tablas.tipos_activo.push(
    { nombre:"Cámara IP", icono_svg:SVG16, color:"#007EB2", campos_pertinentes:["serie","mac_ethernet"], orden:40, activo:true },
    { nombre:"Celular", icono_svg:SVG16, color:"#3E7D4F", campos_pertinentes:["serie"], orden:50, activo:true },
    { nombre:"Cable", icono_svg:SVG16, color:"#A6710B", campos_pertinentes:["color","longitud_m"], orden:60, activo:true },
    { nombre:"Switch 16 puertos", icono_svg:SVG16, color:"#57697C", campos_pertinentes:["serie","mac_ethernet"], orden:70, activo:true },
    { nombre:"Switch 8 puertos", icono_svg:SVG16, color:"#57697C", campos_pertinentes:["serie","mac_ethernet"], orden:80, activo:true },
    { nombre:"Fax", icono_svg:SVG16, color:"#8B9AAA", campos_pertinentes:[], orden:90, activo:false },
  );
  const { context, page, errores } = await abrirApp(browser, base, fx);
  await page.click("#inventario-tecnologico-btn-nuevo");
  await page.waitForSelector("#inventario-tecnologico-form-activo");

  await verificar("nuevo activo: el Tipo es un selector con búsqueda (el <select> queda oculto)", async ()=>{
    exigir(await page.locator(FA("tipo")).isHidden(), "el <select> se ve");
    exigir((await texto(page, COMBO.boton)).includes("Selecciona"), await texto(page, COMBO.boton));
    exigir(await page.evaluate(()=>document.querySelector('label[for="inventario-tecnologico-fa-tipo-boton"]')?.textContent) === "Tipo", "la etiqueta no apunta al selector");
  });
  await verificar("nuevo activo sin tipo: campos de cómputo sí; color, longitud y celular no", async ()=>{
    const v = await camposVisiblesForm(page);
    exigir(v === "disco_gb,mac_ethernet,mac_wifi,procesador,ram_gb,serie,so", v);
    exigir(await page.locator("#inventario-tecnologico-fs-celular").isHidden(), "celular visible");
  });
  await page.fill(FA("marca"), "Hikvision");
  await page.fill(FA("modelo"), "DS-2CD1043");
  await page.fill(FA("serie"), "SN-OCULTA");
  await page.fill(FA("so"), "Linux");

  await verificar("lista de tipos: A–Z con acentos y números bien ordenados, sin los inactivos", async ()=>{
    await page.click(COMBO.boton);
    await page.waitForSelector(COMBO.panel, { state: "visible" });
    exigir(await page.evaluate(()=>document.activeElement?.id) === "inventario-tecnologico-fa-tipo-filtro", "el foco no quedó en la búsqueda");
    const t = (await page.locator(COMBO.opciones).allInnerTexts()).map(x=>x.replace("✓", "").trim());
    exigir(t.join("|") === "— Sin tipo —|Antena|Cable|Cámara IP|Celular|Laptop|Monitor|Switch 8 puertos|Switch 16 puertos", t.join("|"));
    exigir((await texto(page, COMBO.orden)) === "A–Z", "el botón de orden no dice A–Z");
  });
  await verificar("orden Z–A: invierte la lista (la opción vacía sigue primero) y se recuerda", async ()=>{
    await page.click(COMBO.orden);
    const t = (await page.locator(COMBO.opciones).allInnerTexts()).map(x=>x.replace("✓", "").trim());
    exigir(t.join("|") === "— Sin tipo —|Switch 16 puertos|Switch 8 puertos|Monitor|Laptop|Celular|Cámara IP|Cable|Antena", t.join("|"));
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-orden-tipos")) === "desc", "no se guardó el orden");
    await page.click(COMBO.orden);
  });
  await verificar("búsqueda sin tildes: «cam» encuentra «Cámara IP» y resalta la coincidencia", async ()=>{
    await page.fill(COMBO.filtro, "cam");
    await page.screenshot({ path: path.join(CAPTURAS, "10-nuevo-activo-selector.png") });
    const t = await page.locator(COMBO.opciones).allInnerTexts();
    exigir(t.length === 1 && t[0].includes("Cámara IP"), t.join("|"));
    exigir(await page.locator(`${COMBO.opciones} mark`).innerText() === "Cám", "no resaltó «Cám»");
    await page.fill(COMBO.filtro, "zzz");
    exigir(await page.locator(COMBO.opciones).count() === 0, "con «zzz» quedaron opciones");
    exigir((await texto(page, "#inventario-tecnologico-fa-tipo-panel .inventario-tecnologico-combo-vacio")).includes("zzz"), "sin aviso de «ningún tipo»");
  });
  await verificar("Esc en la búsqueda cierra solo la lista: el formulario sigue abierto", async ()=>{
    await page.keyboard.press("Escape");
    await page.waitForSelector(COMBO.panel, { state: "hidden" });
    exigir(await page.locator("#inventario-tecnologico-form-activo").count() === 1, "se cerró el modal");
    exigir(await page.evaluate(()=>document.activeElement?.id) === "inventario-tecnologico-fa-tipo-boton", "el foco no volvió al selector");
  });
  await verificar("elegir «Cámara IP» con teclado: quedan serie y MAC Ethernet, con transición y sin perder lo escrito", async ()=>{
    await page.click(COMBO.boton);
    await page.fill(COMBO.filtro, "cama");
    await page.keyboard.press("Enter");
    await page.waitForSelector(COMBO.panel, { state: "hidden" });
    // A mitad de la transición hay animaciones corriendo (no es un cambio plano).
    const animando = await page.evaluate(()=>document.getElementById("inventario-tecnologico-form-activo").getAnimations({ subtree: true }).length);
    exigir(animando > 0, "no hubo animación");
    await esperarTransicion(page);
    exigir(await page.inputValue(FA("tipo")) === "Cámara IP", await page.inputValue(FA("tipo")));
    exigir((await texto(page, COMBO.boton)).includes("Cámara IP"), "el botón no muestra el tipo");
    const v = await camposVisiblesForm(page);
    exigir(v === "mac_ethernet,serie", v);
    exigir(await page.inputValue(FA("marca")) === "Hikvision" && await page.inputValue(FA("modelo")) === "DS-2CD1043", "se perdió marca/modelo");
  });
  await verificar("«Cable»: solo color y longitud; «Celular»: aparecen los datos de celular", async ()=>{
    await elegirTipo(page, "cable");
    let v = await camposVisiblesForm(page);
    exigir(v === "color,longitud_m", v);
    await elegirTipo(page, "celu");
    v = await camposVisiblesForm(page);
    exigir(v === "celular,serie", v);
    exigir(await page.locator("#inventario-tecnologico-fs-celular").isVisible(), "celular oculto");
  });
  await verificar("«+» de Tipo abre un modal aparte encima; Esc lo cierra y el formulario queda intacto", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo-tipo");
    await page.waitForSelector(SUBMODAL, { state: "visible" });
    exigir(await page.locator("#inventario-tecnologico-form-activo").isVisible(), "el formulario de abajo desapareció");
    exigir(await page.evaluate(()=>document.activeElement?.id) === "inventario-tecnologico-nt-nombre", "el foco no está en el nombre");
    exigir(await page.locator("#inventario-tecnologico-fs-nuevo-tipo").count() === 0, "sigue la sección dentro del modal");
    await page.keyboard.press("Escape");
    await page.waitForSelector("#inventario-tecnologico-submodal-host", { state: "detached" });
    exigir(await page.locator("#inventario-tecnologico-form-activo").isVisible(), "Esc cerró también el formulario");
    exigir(await page.inputValue(FA("marca")) === "Hikvision", "se perdió la marca");
    exigir(await page.evaluate(()=>document.activeElement?.id) === "inventario-tecnologico-btn-nuevo-tipo", "el foco no volvió al «+»");
  });
  await verificar("Tab queda atrapado dentro del submodal", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo-tipo");
    await page.waitForSelector(SUBMODAL, { state: "visible" });
    for(let i = 0; i < 16; i++) await page.keyboard.press("Tab");
    exigir(await page.evaluate(()=>!!document.activeElement?.closest("#inventario-tecnologico-submodal-host")), "el foco salió del submodal");
    await page.click("#inventario-tecnologico-btn-cancelar-tipo");
    await page.waitForSelector("#inventario-tecnologico-submodal-host", { state: "detached" });
  });
  await verificar("crear el tipo «Switch PoE» desde el submodal: queda elegido y los campos siguen al tipo nuevo", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo-tipo");
    await page.waitForSelector(SUBMODAL, { state: "visible" });
    await page.fill("#inventario-tecnologico-nt-nombre", "Switch PoE");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(CAPTURAS, "11-nuevo-activo-submodal.png") });
    for(const c of ["serie","so","ram_gb","disco_gb","procesador","mac_wifi"]) await page.uncheck(`#inventario-tecnologico-nt-campos input[value="${c}"]`);
    await page.focus("#inventario-tecnologico-nt-nombre");
    await page.keyboard.press("Enter");
    await page.waitForSelector("#inventario-tecnologico-submodal-host", { state: "detached" });
    await toast(page, /Tipo creado/);
    await esperarTransicion(page);
    const ins = await page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "tipos_activo" && e.op === "insert").map(e=>e.filas[0]));
    exigir(ins.length === 1 && ins[0].nombre === "Switch PoE" && JSON.stringify(ins[0].campos_pertinentes) === '["mac_ethernet"]', JSON.stringify(ins));
    exigir(await page.inputValue(FA("tipo")) === "Switch PoE", await page.inputValue(FA("tipo")));
    const v = await camposVisiblesForm(page);
    exigir(v === "mac_ethernet", v);
    exigir(await page.inputValue(FA("marca")) === "Hikvision", "se perdió la marca");
  });
  await verificar("«+» de Propiedad también es un submodal y deja la propiedad nueva elegida", async ()=>{
    await page.click("#inventario-tecnologico-btn-nueva-propiedad");
    await page.waitForSelector(SUBMODAL, { state: "visible" });
    await page.fill("#inventario-tecnologico-np-etiqueta", "Comodato");
    await page.click("#inventario-tecnologico-btn-crear-propiedad");
    await page.waitForSelector("#inventario-tecnologico-submodal-host", { state: "detached" });
    exigir(await page.inputValue(FA("propiedad")) === "comodato", await page.inputValue(FA("propiedad")));
  });
  await page.screenshot({ path: path.join(CAPTURAS, "12-nuevo-activo-switch.png") });
  await verificar("guardar: van los campos del tipo; la serie y el SO escritos antes (ahora ocultos) no viajan", async ()=>{
    await page.fill(FA("maceth"), "AA:BB:CC:00:11:22");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.some(e=>e.tabla === "activos" && e.op === "insert"));
    const fila = await page.evaluate(()=>window.__ESCRITURAS__.find(e=>e.tabla === "activos" && e.op === "insert").filas[0]);
    exigir(fila.tipo === "Switch PoE" && fila.marca === "Hikvision" && fila.propiedad === "comodato", JSON.stringify(fila));
    exigir(fila.mac_ethernet === "AA:BB:CC:00:11:22", "no guardó la MAC");
    exigir(fila.serie === null && fila.sistema_operativo === null, `viajaron campos ocultos: serie=${fila.serie} so=${fila.sistema_operativo}`);
    exigir(fila.celular_gmail === null, "viajó el gmail");
  });

  await verificar("editar datos base: solo los campos del tipo (Antena: serie y MAC Ethernet)", async ()=>{
    await page.evaluate(async ()=>{ (await import("/assets/js/inventario-tecnologico/nucleo/../ui/render-raiz.js")).cerrarModal(); });
    await page.evaluate(async ()=>{ (await import("/assets/js/inventario-tecnologico/ui/detalle/form-activo.js")).abrirFormActivo(2); });
    await page.waitForSelector("#inventario-tecnologico-form-activo");
    const v = await camposVisiblesForm(page);
    exigir(v === "mac_ethernet,serie", v);
    exigir((await texto(page, COMBO.boton)).includes("Antena"), "el selector no muestra Antena");
    exigir(await page.inputValue(FA("serie")) === "SN-A2", "no cargó la serie");
  });
  await verificar("editar: pasar a Laptop y volver a Antena anima los campos; al guardar no se toca lo oculto", async ()=>{
    await elegirTipo(page, "lapt");
    exigir((await camposVisiblesForm(page)) === "disco_gb,mac_ethernet,mac_wifi,procesador,ram_gb,serie,so", await camposVisiblesForm(page));
    await page.fill(FA("so"), "Windows 11");
    await elegirTipo(page, "anten");
    exigir((await camposVisiblesForm(page)) === "mac_ethernet,serie", await camposVisiblesForm(page));
    await page.fill(FA("serie"), "SN-A2-NUEVA");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.some(e=>e.tabla === "activos" && e.op === "update"));
    const parche = await page.evaluate(()=>window.__ESCRITURAS__.find(e=>e.tabla === "activos" && e.op === "update").parche);
    exigir(parche.serie === "SN-A2-NUEVA" && parche.tipo === "Antena", JSON.stringify(parche));
    exigir(!("sistema_operativo" in parche) && !("ram_gb" in parche) && !("color" in parche), `tocó campos ocultos: ${Object.keys(parche).join(",")}`);
  });
  await verificar("con movimiento reducido el cambio de campos es inmediato", async ()=>{
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(async ()=>{ (await import("/assets/js/inventario-tecnologico/ui/render-raiz.js")).cerrarModal(); });
    await page.evaluate(async ()=>{ (await import("/assets/js/inventario-tecnologico/ui/detalle/form-activo.js")).abrirFormActivo(2); });
    await page.waitForSelector("#inventario-tecnologico-form-activo");
    await page.click(COMBO.boton);
    await page.fill(COMBO.filtro, "lapt");
    await page.keyboard.press("Enter");
    const v = await camposVisiblesForm(page);
    exigir(v === "disco_gb,mac_ethernet,mac_wifi,procesador,ram_gb,serie,so", v);
    await page.emulateMedia({ reducedMotion: "no-preference" });
  });
  await verificar("sin errores de JavaScript (nuevo activo)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ v10: campos configurables (012)
// Con la 012 en el stub: la tabla campos_activo (los 9 de siempre y campos
// nuevos), activos.personalizados, obligatorios y únicos, renombrar tipos e
// ícono de los tipos de ubicación. Sin ella (escenario «sin012»): todo como en
// el v9 y sin errores; además, «Editar» y «Desactivar» de Configuración
// buscan por nombre/valor (en la base real esas tablas no tienen id).
const CAMPOS_FIJOS_012 = [
  ["serie", "Serie", "texto", null, "serie"], ["so", "Sistema operativo", "texto", null, "sistema_operativo"],
  ["ram_gb", "RAM", "numero", "GB", "ram_gb"], ["disco_gb", "Almacenamiento", "numero", "GB", "disco_gb"],
  ["procesador", "Procesador", "texto", null, "procesador"], ["mac_wifi", "MAC WiFi", "texto", null, "mac_wifi"],
  ["mac_ethernet", "MAC Ethernet", "texto", null, "mac_ethernet"], ["color", "Color", "texto", null, "color"],
  ["longitud_m", "Longitud", "numero", "m", "longitud_m"],
].map(([clave, etiqueta, tipo_dato, unidad, columna], i)=>({ id: i + 1, clave, etiqueta, tipo_dato, unidad, opciones: [], fijo: true, columna, unico: false, en_acta: false, orden: (i + 1) * 10, activo: true }));
const ICONO_TORRE = '<svg viewBox="0 0 16 16"><path d="M8 1L15 15H1z"/></svg>';
function fixtureCampos(){
  const fx = fixture({ red007: true });
  const campo = (id, clave, etiqueta, tipo_dato, extra = {})=>({ id, clave, etiqueta, tipo_dato, unidad: null, opciones: [], fijo: false, columna: null, unico: false, en_acta: false, orden: id * 10, activo: true, ...extra });
  fx.tablas.campos_activo = [
    ...CAMPOS_FIJOS_012.map(c=>({ ...c })),
    campo(10, "imei", "IMEI", "texto", { unico: true, en_acta: true }),
    campo(11, "operadora", "Operadora", "lista", { opciones: [{ valor: "claro", etiqueta: "Claro", activo: true }, { valor: "movistar", etiqueta: "Movistar", activo: true }, { valor: "cnt", etiqueta: "CNT", activo: false }] }),
    campo(12, "capacidad", "Capacidad", "numero", { unidad: "VA" }),
    campo(13, "garantia_hasta", "Garantía hasta", "fecha"),
    campo(14, "propio", "¿Propio?", "si_no"),
    campo(15, "codigo_antiguo", "Código antiguo", "texto", { activo: false }),
  ];
  for(const t of fx.tablas.tipos_activo) t.campos_obligatorios = [];
  fx.tablas.tipos_activo.push(
    { nombre: "Celular", icono_svg: SVG16, color: "#3E7D4F", campos_pertinentes: ["serie", "imei", "operadora", "garantia_hasta"], campos_obligatorios: ["imei"], orden: 40, activo: true },
    { nombre: "UPS", icono_svg: SVG16, color: "#A6710B", campos_pertinentes: ["serie", "capacidad", "propio", "codigo_antiguo"], campos_obligatorios: [], orden: 50, activo: true },
    { nombre: "Router", icono_svg: SVG16, color: "#3E7D4F", campos_pertinentes: ["serie", "mac_ethernet"], campos_obligatorios: [], orden: 60, activo: true },
  );
  for(const a of fx.tablas.activos) a.personalizados = {};
  fx.tablas.activos.push(
    { id: 6, propiedad: "lukmar", tipo: "Celular", marca: "Samsung", modelo: "Galaxy A54", serie: "SN-C6", estado: "uso", fotos: [], personalizados: { imei: "351234567890123", operadora: "claro" } },
    { id: 7, propiedad: "lukmar", tipo: "UPS", marca: "APC", modelo: "BX1100", serie: "SN-U7", estado: "disponible", fotos: [], personalizados: { capacidad: 1100, propio: true, codigo_antiguo: "UPS-VIEJO-01" } },
    { id: 8, propiedad: "lukmar", tipo: "UPS", marca: "CDP", modelo: "R-UPR508", serie: "SN-U8", estado: "disponible", fotos: [], personalizados: { capacidad: 500 } },
  );
  for(const t of fx.tablas.tipos_ubicacion) t.icono_svg = null;
  return fx;
}
const escrituras = (page, tabla, op = null)=>page.evaluate(([t, o])=>window.__ESCRITURAS__.filter(e=>e.tabla === t && (!o || e.op === o)), [tabla, op]);
const idsTabla = page=>page.evaluate(()=>[...document.querySelectorAll("#inventario-tecnologico-tbody-activos tr[data-id]")].map(tr=>Number(tr.dataset.id)));
const celdaCampo = (page, id, clave)=>page.evaluate(([id, clave])=>{
  const tr = document.querySelector(`#inventario-tecnologico-tbody-activos tr[data-id="${id}"]`);
  const td = tr && [...tr.children].find(td=>td.classList.contains(`inventario-tecnologico-col-campo:${clave}`));
  return td ? td.innerText.trim() : null;
}, [id, clave]);
const cerrarModales = page=>page.evaluate(async ()=>{ (await import("/assets/js/inventario-tecnologico/ui/render-raiz.js")).cerrarModal(); });
const abrirFormDe = (page, id)=>page.evaluate(async id=>{ (await import("/assets/js/inventario-tecnologico/ui/detalle/form-activo.js")).abrirFormActivo(id); }, id);
const valoresDetalle = page=>page.evaluate(()=>Object.fromEntries([...document.querySelectorAll("[data-kv-campo]")].map(el=>[el.dataset.kvCampo, el.querySelector(".inventario-tecnologico-v").innerText.trim()])));
const mismosElementos = (a, b)=>JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
async function esperarFilas(page, n){
  try{ await page.waitForFunction(n=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr[data-id]").length === n, n, { timeout: 4000 }); }
  catch(e){ throw new Error(`se esperaban ${n} filas: ${JSON.stringify(await idsTabla(page))}`); }
}
async function irAOpciones(page){
  await page.click(SEL.tab("config"));
  await page.click('[data-subtab="opciones"]');
  await page.waitForSelector('[data-toggle-tipo="Laptop"]');
}
// Descarga el Excel del listado y lo abre con el JSZip de Node.
async function descargarExcel(page){
  const [descarga] = await Promise.all([page.waitForEvent("download", { timeout: 10000 }), page.click("#inventario-tecnologico-btn-exportar")]);
  const zip = await JSZip.loadAsync(fs.readFileSync(await descarga.path()));
  const hoja = await zip.file("xl/worksheets/sheet1.xml").async("string");
  const tabla = await zip.file("xl/tables/table1.xml").async("string");
  // XML bien formado (lo lee el mismo navegador).
  const errXml = await page.evaluate(xs=>xs.map(x=>new DOMParser().parseFromString(x, "application/xml").querySelector("parsererror")?.textContent || "").filter(Boolean), [hoja, tabla]);
  if(errXml.length) throw new Error("XML mal formado: " + errXml[0].slice(0, 200));
  const celda = ref=>{ const m = hoja.match(new RegExp(`<c r="${ref}"[^>]*>(?:<is><t[^>]*>([^<]*)</t></is>)?`)); return m ? (m[1] ?? "") : null; };
  const filaDe = tag=>{ const m = hoja.match(new RegExp(`<c r="A(\\d+)"[^>]*><is><t[^>]*>${tag}</t>`)); return m ? Number(m[1]) : null; };
  return { hoja, tabla, celda, filaDe };
}

async function escenarioCampos(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixtureCampos(), { jszipReal: true });

  // ---------- tabla de activos
  await verificar("012: el gestor de columnas ofrece los campos nuevos activos (con su unidad), no el desactivado", async ()=>{
    await page.click("#inventario-tecnologico-btn-columnas");
    await page.waitForSelector("#inventario-tecnologico-lista-cols");
    const claves = await page.evaluate(()=>[...document.querySelectorAll("[data-col-toggle]")].map(x=>x.dataset.colToggle));
    for(const k of ["campo:imei", "campo:operadora", "campo:capacidad", "campo:garantia_hasta", "campo:propio"]) exigir(claves.includes(k), `falta ${k}: ${claves.join(",")}`);
    exigir(!claves.includes("campo:codigo_antiguo"), "ofrece el campo desactivado");
    exigir((await texto(page, '[data-col-opt="campo:capacidad"]')).trim() === "Capacidad (VA)", await texto(page, '[data-col-opt="campo:capacidad"]'));
  });
  await verificar("columnas IMEI y Capacidad: sus valores (con unidad) y «n/a» en los tipos que no las usan", async ()=>{
    await page.check('[data-col-toggle="campo:imei"]');
    await page.check('[data-col-toggle="campo:capacidad"]');
    await cerrarModales(page);
    const th = await page.evaluate(()=>[...document.querySelectorAll("thead .inventario-tecnologico-th-label-text")].map(x=>x.textContent));
    exigir(th.includes("IMEI") && th.includes("Capacidad (VA)"), th.join("|"));
    exigir(await celdaCampo(page, 6, "imei") === "351234567890123", String(await celdaCampo(page, 6, "imei")));
    exigir(await celdaCampo(page, 7, "capacidad") === "1100 VA", String(await celdaCampo(page, 7, "capacidad")));
    exigir(await celdaCampo(page, 1, "capacidad") === "n/a", String(await celdaCampo(page, 1, "capacidad")));
  });
  await verificar("el filtro de la columna IMEI y la búsqueda general encuentran por los campos nuevos (también por la opción de una lista)", async ()=>{
    await page.fill('[data-col-texto="campo:imei"]', "35123");
    await esperarFilas(page, 1);
    exigir(JSON.stringify(await idsTabla(page)) === "[6]", JSON.stringify(await idsTabla(page)));
    await page.fill('[data-col-texto="campo:imei"]', "");
    await esperarFilas(page, 6);
    await page.fill("#inventario-tecnologico-f-texto", "claro");
    await esperarFilas(page, 1);
    exigir(JSON.stringify(await idsTabla(page)) === "[6]", JSON.stringify(await idsTabla(page)));
    await page.fill("#inventario-tecnologico-f-texto", "");
    await esperarFilas(page, 6);
  });
  await verificar("ordenar por Capacidad: de menor a mayor y al revés", async ()=>{
    const ups = async ()=>JSON.stringify((await idsTabla(page)).filter(id=>id === 7 || id === 8));
    await page.click('[data-sort="campo:capacidad"]');
    exigir(await ups() === "[8,7]", JSON.stringify(await idsTabla(page)));
    await page.click('[data-sort="campo:capacidad"]');
    exigir(await ups() === "[7,8]", JSON.stringify(await idsTabla(page)));
    await page.click('[data-sort="id"]');
    exigir(JSON.stringify(await idsTabla(page)) === "[1,2,3,6,7,8]", "no volvió al orden por tag: " + JSON.stringify(await idsTabla(page)));
  });
  await verificar("detalle: los campos del tipo con su formato (lista → la opción, sí/no → Sí), sin el desactivado", async ()=>{
    await page.click('#inventario-tecnologico-tbody-activos tr[data-id="7"] .inventario-tecnologico-tag');
    await page.waitForSelector('[data-kv-campo="capacidad"]');
    const kv = await valoresDetalle(page);
    exigir(kv.capacidad === "1100 VA" && kv.propio === "Sí" && kv.serie === "SN-U7", JSON.stringify(kv));
    exigir(!("codigo_antiguo" in kv), "muestra el campo desactivado");
    await cerrarModales(page);
    await page.click('#inventario-tecnologico-tbody-activos tr[data-id="6"] .inventario-tecnologico-tag');
    await page.waitForSelector('[data-kv-campo="imei"]');
    const kv6 = await valoresDetalle(page);
    exigir(Object.keys(kv6).join(",") === "serie,imei,operadora,garantia_hasta", Object.keys(kv6).join(","));
    exigir(kv6.imei === "351234567890123" && kv6.operadora === "Claro" && kv6.garantia_hasta === "—", JSON.stringify(kv6));
    await cerrarModales(page);
  });

  // ---------- formulario del activo
  await page.click("#inventario-tecnologico-btn-nuevo");
  await page.waitForSelector("#inventario-tecnologico-form-activo");
  await verificar("nuevo activo: el «✎» de Tipo está apagado hasta elegir uno", async ()=>{
    exigir(await page.locator("#inventario-tecnologico-btn-editar-tipo").isDisabled(), "✎ encendido sin tipo");
  });
  await verificar("tipo Celular: sus campos en el orden global, IMEI obligatorio (asterisco) y la lista sin la opción inactiva", async ()=>{
    await elegirTipo(page, "celu");
    const v = await camposVisiblesForm(page);
    exigir(v === "celular,garantia_hasta,imei,operadora,serie", v);
    const orden = await page.evaluate(()=>[...document.querySelectorAll("#inventario-tecnologico-fa-grid [data-campo]")].filter(el=>!el.hidden).map(el=>el.dataset.campo).join(","));
    exigir(orden === "serie,imei,operadora,garantia_hasta", orden);
    exigir(await page.locator('[data-campo="imei"] .inventario-tecnologico-fa-obligatorio').isVisible(), "sin asterisco en IMEI");
    exigir(await page.getAttribute("#inventario-tecnologico-fa-c-imei", "aria-required") === "true", "sin aria-required");
    exigir(await page.locator('[data-campo="serie"] .inventario-tecnologico-fa-obligatorio').isHidden(), "asterisco en Serie");
    const ops = await page.evaluate(()=>[...document.querySelectorAll("#inventario-tecnologico-fa-c-operadora option")].map(o=>o.value).join(","));
    exigir(ops === ",claro,movistar", ops);
    exigir(!(await page.locator("#inventario-tecnologico-btn-editar-tipo").isDisabled()), "✎ sigue apagado");
  });
  await page.fill(FA("marca"), "Xiaomi");
  await page.fill(FA("modelo"), "Redmi Note 13");
  await page.fill(FA("serie"), "SN-C9");
  await verificar("guardar sin IMEI: avisa que es obligatorio, va al campo y no guarda nada", async ()=>{
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await toast(page, /Falta «IMEI»: es obligatorio para Celular/);
    exigir((await escrituras(page, "activos", "insert")).length === 0, "se guardó");
    exigir(await page.evaluate(()=>document.activeElement?.id) === "inventario-tecnologico-fa-c-imei", "el foco no fue al IMEI");
  });
  await verificar("IMEI repetido (con espacios de más): «ya hay otro activo» con su tag, y no se guarda", async ()=>{
    await page.fill("#inventario-tecnologico-fa-c-imei", " 351234567890123 ");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await toast(page, /Ya hay otro activo con ese «IMEI»: LKM-006/);
    exigir((await escrituras(page, "activos", "insert")).length === 0, "se guardó");
  });
  await verificar("guardar bien: los campos nuevos van en personalizados (sin los vacíos)", async ()=>{
    await page.fill("#inventario-tecnologico-fa-c-imei", "359876543210987");
    await page.selectOption("#inventario-tecnologico-fa-c-operadora", "movistar");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.some(e=>e.tabla === "activos" && e.op === "insert"));
    const fila = (await escrituras(page, "activos", "insert"))[0].filas[0];
    exigir(JSON.stringify(fila.personalizados) === '{"imei":"359876543210987","operadora":"movistar"}', JSON.stringify(fila.personalizados));
    exigir(fila.serie === "SN-C9" && fila.tipo === "Celular", JSON.stringify(fila));
  });
  await cerrarModales(page);

  await verificar("editar un UPS: sus campos con lo guardado (número, sí/no) y la unidad en la etiqueta; el desactivado no está", async ()=>{
    await abrirFormDe(page, 7);
    await page.waitForSelector("#inventario-tecnologico-form-activo");
    exigir(await camposVisiblesForm(page) === "capacidad,propio,serie", await camposVisiblesForm(page));
    exigir(await page.inputValue("#inventario-tecnologico-fa-c-capacidad") === "1100", await page.inputValue("#inventario-tecnologico-fa-c-capacidad"));
    exigir(await page.inputValue("#inventario-tecnologico-fa-c-propio") === "si", await page.inputValue("#inventario-tecnologico-fa-c-propio"));
    exigir(await page.locator("#inventario-tecnologico-fa-c-codigo_antiguo").count() === 0, "se ve el campo desactivado");
    exigir((await texto(page, 'label[for="inventario-tecnologico-fa-c-capacidad"]')).includes("Capacidad (VA)"), "sin unidad en la etiqueta");
  });
  await verificar("un número mal escrito se rechaza con un mensaje claro", async ()=>{
    await page.fill("#inventario-tecnologico-fa-c-capacidad", "mil");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await toast(page, /«Capacidad» tiene que ser un número/);
    exigir((await escrituras(page, "activos", "update")).length === 0, "se guardó");
  });
  await verificar("guardar: «1.500,5» queda como número, vaciar un campo lo quita y el desactivado se conserva", async ()=>{
    await page.fill("#inventario-tecnologico-fa-c-capacidad", "1.500,5");
    await page.selectOption("#inventario-tecnologico-fa-c-propio", "");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.some(e=>e.tabla === "activos" && e.op === "update"));
    const parche = (await escrituras(page, "activos", "update"))[0].parche;
    exigir(JSON.stringify(parche.personalizados) === '{"capacidad":1500.5,"propio":null}', JSON.stringify(parche.personalizados));
    const enBase = (await db(page, "activos")).find(a=>a.id === 7).personalizados;
    exigir(JSON.stringify(enBase) === '{"capacidad":1500.5,"codigo_antiguo":"UPS-VIEJO-01"}', JSON.stringify(enBase));
    await page.waitForSelector('[data-kv-campo="capacidad"]');
    const kv = await valoresDetalle(page);
    exigir(kv.capacidad === "1500.5 VA" && kv.propio === "—", JSON.stringify(kv));
  });
  await cerrarModales(page);

  await verificar("acta: el IMEI (marcado «en el acta») va en la descripción del equipo; la operadora no", async ()=>{
    const d = await page.evaluate(async ()=>{
      const { descripcionItemActa } = await import("/assets/js/inventario-tecnologico/ui/detalle/acta.js");
      const { cargarActivos } = await import("/assets/js/inventario-tecnologico/nucleo/datos.js");
      return descripcionItemActa(cargarActivos().activos.find(a=>a.id === 6));
    });
    exigir(d === "Celular Samsung — Modelo: Galaxy A54 — Número de serie: SN-C6 — IMEI: 351234567890123", d);
  });
  await verificar("Excel: los campos nuevos van como columnas al final de la Tabla (encabezado con unidad y sus valores)", async ()=>{
    const x = await descargarExcel(page);
    const enc = ["X9", "Y9", "Z9", "AA9", "AB9"].map(x.celda);
    exigir(enc.join("|") === "IMEI|Operadora|Capacidad (VA)|Garantía hasta|¿Propio?", enc.join("|"));
    exigir(/<tableColumns count="28">/.test(x.tabla), (x.tabla.match(/<tableColumns count="\d+">/) || [""])[0]);
    exigir(x.tabla.includes('<tableColumn id="24" name="IMEI"/>') && x.tabla.includes('<tableColumn id="28" name="¿Propio?"/>'), "faltan columnas en la Tabla");
    exigir(x.tabla.includes('ref="A9:AB16"') && x.hoja.includes('<dimension ref="A1:AB16"/>'), (x.tabla.match(/ref="[^"]*"/g) || []).join(","));
    const f6 = x.filaDe("LKM-006"), f7 = x.filaDe("LKM-007"), f1 = x.filaDe("LKM-001"), f9 = x.filaDe("LKM-009");
    exigir(x.celda(`X${f6}`) === "351234567890123" && x.celda(`Y${f6}`) === "Claro", `LKM-006: ${x.celda(`X${f6}`)} / ${x.celda(`Y${f6}`)}`);
    exigir(x.celda(`Z${f7}`) === "1500.5" && x.celda(`X${f1}`) === "" && x.celda(`Y${f9}`) === "Movistar", `Z${f7}=${x.celda(`Z${f7}`)} X${f1}=${x.celda(`X${f1}`)} Y${f9}=${x.celda(`Y${f9}`)}`);
    // Anchos de columna: rangos ordenados y sin encimarse (si no, Excel repara el archivo).
    const cols = [...x.hoja.matchAll(/<col\b[^>]*\bmin="(\d+)"[^>]*\bmax="(\d+)"/g)].map(m=>[Number(m[1]), Number(m[2])]);
    exigir(cols.every(([mi, ma], i)=>mi <= ma && (i === 0 || mi > cols[i - 1][1])), JSON.stringify(cols));
    exigir(cols.some(([mi, ma])=>mi === 24 && ma === 28), "sin ancho para las columnas nuevas");
  });

  // ---------- Configuración → Tipos y opciones
  await irAOpciones(page);
  await verificar("Configuración → Campos: los 9 de siempre (sin «Desactivar») y los nuevos, en su orden", async ()=>{
    const filas = await page.evaluate(()=>[...document.querySelectorAll("[data-fila-campo]")].map(tr=>tr.dataset.filaCampo));
    exigir(filas.join(",") === "serie,so,ram_gb,disco_gb,procesador,mac_wifi,mac_ethernet,color,longitud_m,imei,operadora,capacidad,garantia_hasta,propio,codigo_antiguo", filas.join(","));
    exigir(await page.locator('[data-toggle-campo="serie"]').count() === 0, "un campo de siempre se puede desactivar");
    exigir((await page.locator('[data-toggle-campo="codigo_antiguo"]').innerText()) === "Activar", "el desactivado no dice «Activar»");
    exigir(await page.locator('[data-mover-campo="serie"][data-dir="arriba"]').isDisabled() && await page.locator('[data-mover-campo="codigo_antiguo"][data-dir="abajo"]').isDisabled(), "flechas de los extremos encendidas");
  });
  await page.screenshot({ path: path.join(CAPTURAS, "40-config-campos.png"), fullPage: true });
  await verificar("crear un campo de lista: clave desde el nombre, opciones con su valor interno, al final del orden", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo-campo-cfg");
    await page.waitForSelector("#inventario-tecnologico-cc-etiqueta");
    await page.fill("#inventario-tecnologico-cc-etiqueta", "Plan de datos");
    await page.selectOption("#inventario-tecnologico-cc-tipo", "lista");
    const opciones = page.locator("#inventario-tecnologico-cc-opciones [data-opcion-etiqueta]");
    await opciones.nth(0).fill("Básico");
    await opciones.nth(1).fill("Ilimitado");
    await page.screenshot({ path: path.join(CAPTURAS, "41-config-nuevo-campo.png") });
    await page.click("#inventario-tecnologico-btn-guardar-campo-cfg");
    await toast(page, /Campo «Plan de datos» creado/);
    const ins = (await escrituras(page, "campos_activo", "insert")).map(e=>e.filas[0]);
    exigir(ins.length === 1 && ins[0].clave === "plan_de_datos" && ins[0].tipo_dato === "lista" && ins[0].orden === 160, JSON.stringify(ins));
    exigir(JSON.stringify(ins[0].opciones.map(o=>[o.valor, o.etiqueta, o.activo])) === '[["basico","Básico",true],["ilimitado","Ilimitado",true]]', JSON.stringify(ins[0].opciones));
    await page.waitForSelector('[data-fila-campo="plan_de_datos"]');
  });
  await verificar("un campo con el nombre de otro (sin distinguir mayúsculas) no se crea", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo-campo-cfg");
    await page.waitForSelector("#inventario-tecnologico-cc-etiqueta");
    await page.fill("#inventario-tecnologico-cc-etiqueta", "imei");
    await page.click("#inventario-tecnologico-btn-guardar-campo-cfg");
    await toast(page, /No se pudo crear el campo: Ya hay un campo que se llama «imei»/);
    exigir((await escrituras(page, "campos_activo", "insert")).length === 1, "se creó el repetido");
    await cerrarModales(page);
  });
  await verificar("editar un campo de siempre: cambia la etiqueta (no el tipo de dato) y no se toca nada más", async ()=>{
    await page.click('[data-editar-campo="serie"]');
    await page.waitForSelector("#inventario-tecnologico-cc-etiqueta");
    exigir(await page.locator("#inventario-tecnologico-cc-tipo").isDisabled(), "se puede cambiar el tipo de dato de un campo de siempre");
    await page.fill("#inventario-tecnologico-cc-etiqueta", "Número de serie");
    await page.click("#inventario-tecnologico-btn-guardar-campo-cfg");
    await toast(page, /Campo guardado/);
    const upd = (await escrituras(page, "campos_activo", "update")).map(e=>e.parche);
    exigir(upd.length === 1 && upd[0].etiqueta === "Número de serie" && !("opciones" in upd[0]) && !("tipo_dato" in upd[0]) && !("unidad" in upd[0]), JSON.stringify(upd));
  });
  await verificar("mover un campo: «↓» en IMEI lo cambia de lugar con Operadora y el foco sigue en la flecha", async ()=>{
    await page.click('[data-mover-campo="imei"][data-dir="abajo"]');
    await page.waitForFunction(()=>{ const f = [...document.querySelectorAll("[data-fila-campo]")].map(tr=>tr.dataset.filaCampo); return f.indexOf("operadora") >= 0 && f.indexOf("operadora") < f.indexOf("imei"); });
    const upd = (await escrituras(page, "campos_activo", "update")).slice(1).map(e=>[e.filas[0].clave, e.parche.orden]);
    exigir(JSON.stringify(upd) === '[["imei",110],["operadora",100]]', JSON.stringify(upd));
    exigir(await page.evaluate(()=>document.activeElement?.dataset?.moverCampo) === "imei", "el foco no quedó en la flecha de IMEI");
  });
  await verificar("desactivar un campo nuevo: queda «Activar», su columna se va y su valor se conserva", async ()=>{
    await page.click('[data-toggle-campo="capacidad"]');
    await toast(page, /Campo «Capacidad» desactivado/);
    await page.waitForFunction(()=>document.querySelector('[data-toggle-campo="capacidad"]')?.textContent === "Activar");
    exigir((await db(page, "activos")).find(a=>a.id === 8).personalizados.capacidad === 500, "se perdió el valor");
  });
  await verificar("editar el tipo Celular: «Celular» no se renombra; marcar Operadora como obligatoria", async ()=>{
    await page.click('[data-editar-tipo="Celular"]');
    await page.waitForSelector("#inventario-tecnologico-ct-nombre");
    exigir(await page.locator("#inventario-tecnologico-ct-nombre").isDisabled(), "se puede renombrar «Celular»");
    exigir(await page.locator('#inventario-tecnologico-ct-campos input[data-obligatorio="imei"]').isChecked(), "IMEI no aparece obligatorio");
    exigir(await page.locator('#inventario-tecnologico-ct-campos input[data-obligatorio="ram_gb"]').isDisabled(), "«obligatorio» encendido en un campo que no usa");
    await page.check('#inventario-tecnologico-ct-campos input[data-obligatorio="operadora"]');
    await page.screenshot({ path: path.join(CAPTURAS, "42-config-tipo-obligatorios.png") });
    await page.click("#inventario-tecnologico-btn-guardar-tipo-cfg");
    await toast(page, /Tipo actualizado/);
    const p = (await escrituras(page, "tipos_activo", "update")).at(-1);
    exigir(p.filas[0].nombre === "Celular" && mismosElementos(p.parche.campos_obligatorios, ["imei", "operadora"]), JSON.stringify(p.parche));
    exigir(mismosElementos(p.parche.campos_pertinentes, ["serie", "imei", "operadora", "garantia_hasta"]), JSON.stringify(p.parche.campos_pertinentes));
  });
  await verificar("renombrar el tipo UPS: la función de la 012 lo cambia en sus activos y se conservan los campos desactivados del tipo", async ()=>{
    await page.click('[data-editar-tipo="UPS"]');
    await page.waitForSelector("#inventario-tecnologico-ct-nombre");
    exigir((await texto(page, "#inventario-tecnologico-ct-nombre-ayuda")).includes("los 2 activos"), await texto(page, "#inventario-tecnologico-ct-nombre-ayuda"));
    await page.fill("#inventario-tecnologico-ct-nombre", "UPS / Regulador");
    await page.click("#inventario-tecnologico-btn-guardar-tipo-cfg");
    await toast(page, /Tipo renombrado a «UPS \/ Regulador» y guardado/);
    const rpc = await page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.rpc === "renombrar_tipo_activo"));
    exigir(rpc.length === 1 && rpc[0].args.p_viejo === "UPS" && rpc[0].args.p_nuevo === "UPS / Regulador" && rpc[0].activos === 2, JSON.stringify(rpc));
    const tipos = (await db(page, "activos")).filter(a=>a.id === 7 || a.id === 8).map(a=>a.tipo);
    exigir(tipos.join("|") === "UPS / Regulador|UPS / Regulador", tipos.join("|"));
    const p = (await escrituras(page, "tipos_activo", "update")).at(-1);
    exigir(p.filas[0].nombre === "UPS / Regulador" && mismosElementos(p.parche.campos_pertinentes, ["serie", "propio", "capacidad", "codigo_antiguo"]), JSON.stringify(p.parche.campos_pertinentes));
    await page.waitForSelector('[data-fila-tipo="UPS / Regulador"]');
  });
  await verificar("renombrar «Router» avisa que deja de coincidir con el tipo de equipo de red (y cancelar no cambia nada)", async ()=>{
    await page.click('[data-editar-tipo="Router"]');
    await page.waitForSelector("#inventario-tecnologico-ct-nombre");
    await page.fill("#inventario-tecnologico-ct-nombre", "Ruteador");
    await page.waitForSelector("#inventario-tecnologico-ct-nombre-aviso:not([hidden])");
    const aviso = await texto(page, "#inventario-tecnologico-ct-nombre-aviso");
    exigir(/coincide con el tipo de equipo de red «Router».*Con «Ruteador», ya no/.test(aviso), aviso);
    await page.fill("#inventario-tecnologico-ct-nombre", "ROUTER");
    await page.waitForSelector("#inventario-tecnologico-ct-nombre-aviso", { state: "hidden" });
    await cerrarModales(page);
    exigir(!(await page.evaluate(()=>window.__ESCRITURAS__.some(e=>e.rpc === "renombrar_tipo_activo" && e.args.p_viejo === "Router"))), "se renombró al cancelar");
  });
  await verificar("crear un tipo con un obligatorio: se guarda solo entre los campos que usa", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo-tipo-cfg");
    await page.waitForSelector("#inventario-tecnologico-ct-nombre");
    await page.fill("#inventario-tecnologico-ct-nombre", "Radio portátil");
    for(const c of ["so", "ram_gb", "disco_gb", "procesador", "mac_wifi", "mac_ethernet"]) await page.uncheck(`#inventario-tecnologico-ct-campos input[data-usa][value="${c}"]`);
    await page.check('#inventario-tecnologico-ct-campos input[data-obligatorio="serie"]');
    await page.check('#inventario-tecnologico-ct-campos input[data-usa][value="imei"]');
    await page.click("#inventario-tecnologico-btn-guardar-tipo-cfg");
    await toast(page, /Tipo creado/);
    const f = (await escrituras(page, "tipos_activo", "insert")).at(-1).filas[0];
    exigir(f.nombre === "Radio portátil" && JSON.stringify(f.campos_pertinentes) === '["serie","imei"]' && JSON.stringify(f.campos_obligatorios) === '["serie"]', JSON.stringify(f));
  });
  await verificar("tipos de ubicación: editar «Torre» con un ícono (con script y onload) lo guarda limpio y lo muestra en su burbuja", async ()=>{
    await page.waitForSelector('[data-fila-tipo-ubicacion="torre"]');
    await page.click('[data-editar-tipo-ubicacion="torre"]');
    await page.waitForSelector("#inventario-tecnologico-cu-icono");
    await page.fill("#inventario-tecnologico-cu-icono", '<svg viewBox="0 0 16 16" onload="alert(1)"><script>alert(2)</script><path d="M8 1L15 15H1z"/></svg>');
    await page.waitForSelector('#inventario-tecnologico-cu-vista path[d="M8 1L15 15H1z"]');
    await page.click("#inventario-tecnologico-btn-guardar-tipo-ubicacion-cfg");
    await toast(page, /Tipo de ubicación guardado/);
    const p = (await escrituras(page, "tipos_ubicacion", "update")).at(-1);
    exigir(p.filas[0].valor === "torre" && p.parche.icono_svg === ICONO_TORRE, JSON.stringify(p.parche));
    await page.waitForSelector('[data-fila-tipo-ubicacion="torre"] path[d="M8 1L15 15H1z"]');
  });
  await verificar("un ícono de ubicación sin viewBox se rechaza con el motivo", async ()=>{
    await page.click('[data-editar-tipo-ubicacion="bodega"]');
    await page.waitForSelector("#inventario-tecnologico-cu-icono");
    await page.fill("#inventario-tecnologico-cu-icono", '<svg width="16" height="16"><path d="M1 1h14v14H1z"/></svg>');
    exigir(/viewBox/.test(await texto(page, "#inventario-tecnologico-cu-icono-ayuda")), "la ayuda no avisa");
    await page.click("#inventario-tecnologico-btn-guardar-tipo-ubicacion-cfg");
    await toast(page, /No se pudo guardar el tipo de ubicación: .*viewBox/);
    exigir(!(await escrituras(page, "tipos_ubicacion", "update")).some(e=>e.filas.some(f=>f.valor === "bodega")), "se guardó");
    await cerrarModales(page);
  });

  // ---------- mapa: la burbuja y el «✎» del formulario de ubicación
  await verificar("mapa: la burbuja de las torres usa el ícono nuevo (y las demás, el dibujo de siempre)", async ()=>{
    await irAlMapa(page);
    await page.waitForSelector(`${SEL.marcador("Torre Cerro Azul")} path[d="M8 1L15 15H1z"]`, { timeout: 5000 });
    exigir(await page.locator(`${SEL.marcador("Oficina Centro")} path[d="M8 1L15 15H1z"]`).count() === 0, "la oficina también lo tiene");
  });
  await captura(page, "43-mapa-icono-torre.png");
  await verificar("formulario de ubicación: «✎» edita el tipo elegido sin perder lo escrito", async ()=>{
    await page.click("#inventario-tecnologico-mapa-nueva-ubicacion");
    await page.waitForSelector("#inventario-tecnologico-ubic-nombre");
    await page.fill("#inventario-tecnologico-ubic-nombre", "Repetidora Norte");
    await page.selectOption("#inventario-tecnologico-ubic-tipo", "bodega");
    await page.click("#inventario-tecnologico-ubic-btn-editar-tipo");
    await page.waitForSelector("#inventario-tecnologico-ubic-mini-tipo:not([hidden])");
    exigir((await texto(page, "#inventario-tecnologico-ubic-tipo-titulo")) === "Editar el tipo «Bodega»", await texto(page, "#inventario-tecnologico-ubic-tipo-titulo"));
    exigir(await page.inputValue("#inventario-tecnologico-ubic-tipo-etiqueta") === "Bodega", await page.inputValue("#inventario-tecnologico-ubic-tipo-etiqueta"));
    await page.fill("#inventario-tecnologico-ubic-tipo-etiqueta", "Bodega / Galpón");
    await page.fill("#inventario-tecnologico-ubic-tipo-icono", ICONO_TORRE);
    await page.waitForSelector('#inventario-tecnologico-ubic-tipo-vista path[d="M8 1L15 15H1z"]');
    await page.click("#inventario-tecnologico-ubic-tipo-crear");
    await toast(page, /Tipo «Bodega \/ Galpón» guardado/);
    const p = (await escrituras(page, "tipos_ubicacion", "update")).at(-1);
    exigir(p.filas[0].valor === "bodega" && p.parche.etiqueta === "Bodega / Galpón" && p.parche.icono_svg === ICONO_TORRE, JSON.stringify(p.parche));
    exigir(await page.inputValue("#inventario-tecnologico-ubic-nombre") === "Repetidora Norte", "se perdió lo escrito");
    exigir(await page.inputValue("#inventario-tecnologico-ubic-tipo") === "bodega", "cambió el tipo elegido");
    exigir((await page.locator('#inventario-tecnologico-ubic-tipo option[value="bodega"]').innerText()) === "Bodega / Galpón", "el selector no muestra la etiqueta nueva");
    // El mapa de atrás ya se repintó: la burbuja de la bodega tiene el ícono nuevo.
    await page.waitForSelector(`${SEL.marcador("Bodega Sur")} path[d="M8 1L15 15H1z"]`, { state: "attached", timeout: 4000 });
    await cerrarModales(page);
  });

  // ---------- «✎» y «+ Nuevo campo» desde el formulario del activo
  await page.click(SEL.tab("activos"));
  await page.click("#inventario-tecnologico-btn-nuevo");
  await page.waitForSelector("#inventario-tecnologico-form-activo");
  await verificar("formulario del activo: la etiqueta nueva de un campo de siempre («Número de serie») llega al formulario", async ()=>{
    await elegirTipo(page, "lapt");
    exigir((await texto(page, 'label[for="inventario-tecnologico-fa-serie"]')).includes("Número de serie"), await texto(page, 'label[for="inventario-tecnologico-fa-serie"]'));
  });
  await page.fill(FA("marca"), "Lenovo");
  await page.fill(FA("serie"), "SN-L10");
  await verificar("«✎» de Laptop y «+ Nuevo campo» adentro: el campo aparece en el formulario sin perder lo escrito", async ()=>{
    await page.click("#inventario-tecnologico-btn-editar-tipo");
    await page.waitForSelector(SUBMODAL, { state: "visible" });
    exigir((await texto(page, "#inventario-tecnologico-nt-titulo")) === "Editar el tipo «Laptop»", await texto(page, "#inventario-tecnologico-nt-titulo"));
    await page.click("#inventario-tecnologico-nt-nuevo-campo");
    await page.fill("#inventario-tecnologico-nt-nc-etiqueta", "Código de barras");
    await page.check("#inventario-tecnologico-nt-nc-unico");
    await page.screenshot({ path: path.join(CAPTURAS, "44-submodal-nuevo-campo.png") });
    await page.click("#inventario-tecnologico-nt-nc-crear");
    await page.waitForSelector('#inventario-tecnologico-nt-campos input[data-usa][value="codigo_de_barras"]:checked');
    const ins = (await escrituras(page, "campos_activo", "insert")).at(-1).filas[0];
    exigir(ins.clave === "codigo_de_barras" && ins.unico === true && ins.tipo_dato === "texto", JSON.stringify(ins));
    await page.click("#inventario-tecnologico-btn-guardar-tipo");
    await page.waitForSelector("#inventario-tecnologico-submodal-host", { state: "detached" });
    await toast(page, /Tipo guardado/);
    await esperarTransicion(page);
    const p = (await escrituras(page, "tipos_activo", "update")).at(-1);
    exigir(p.filas[0].nombre === "Laptop" && p.parche.campos_pertinentes.includes("codigo_de_barras"), JSON.stringify(p.parche));
    exigir(await page.locator('#inventario-tecnologico-fa-grid [data-campo="codigo_de_barras"]').isVisible(), "el campo nuevo no se ve en el formulario");
    exigir(await page.inputValue(FA("marca")) === "Lenovo" && await page.inputValue(FA("serie")) === "SN-L10", "se perdió lo escrito");
  });
  await verificar("guardar el activo con el campo recién creado", async ()=>{
    await page.fill("#inventario-tecnologico-fa-c-codigo_de_barras", "7861234567890");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "activos" && e.op === "insert").length === 2);
    const fila = (await escrituras(page, "activos", "insert")).at(-1).filas[0];
    exigir(fila.tipo === "Laptop" && fila.serie === "SN-L10" && JSON.stringify(fila.personalizados) === '{"codigo_de_barras":"7861234567890"}', JSON.stringify(fila));
  });
  await cerrarModales(page);
  await verificar("sin errores de JavaScript (campos configurables)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

async function escenarioSin012(browser, base){
  const fx = fixture();
  fx.tablas.tipos_activo.push({ nombre: "Celular", icono_svg: SVG16, color: "#3E7D4F", campos_pertinentes: ["serie"], orden: 40, activo: true });
  const { context, page, errores } = await abrirApp(browser, base, fx, { jszipReal: true });
  await verificar("sin la 012: el gestor de columnas no ofrece campos nuevos", async ()=>{
    await page.click("#inventario-tecnologico-btn-columnas");
    await page.waitForSelector("#inventario-tecnologico-lista-cols");
    exigir(await page.locator('[data-col-toggle^="campo:"]').count() === 0, "ofrece columnas de campos");
    await cerrarModales(page);
  });
  await verificar("sin la 012: el Excel sale con las 23 columnas de la plantilla", async ()=>{
    const x = await descargarExcel(page);
    exigir(/<tableColumns count="23">/.test(x.tabla) && x.tabla.includes('ref="A9:W12"') && x.celda("X9") === null, (x.tabla.match(/<tableColumns count="\d+">|ref="[^"]*"/g) || []).join(","));
  });
  await irAOpciones(page);
  await verificar("sin la 012: Configuración avisa que los campos nuevos necesitan la 012 (sin botón ni tabla)", async ()=>{
    exigir(await page.locator("#inventario-tecnologico-btn-nuevo-campo-cfg").count() === 0 && await page.locator("[data-fila-campo]").count() === 0, "hay campos configurables");
    exigir(/hace falta aplicar la migración 012/.test(await page.locator(".inventario-tecnologico-alert-info").allInnerTexts().then(t=>t.join(" "))), "sin el aviso de la 012");
  });
  await verificar("«Desactivar» un tipo, una propiedad y un estado cambia justo esa fila (por nombre / valor)", async ()=>{
    await page.click('[data-toggle-tipo="Monitor"]');
    await toast(page, /Tipo desactivado/);
    await page.click('[data-toggle-propiedad="eq"]');
    await toast(page, /Propiedad desactivada/);
    await page.click('[data-toggle-estado="disponible"]');
    await toast(page, /Estado desactivado/);
    const upd = (await page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.op === "update"))).map(e=>[e.tabla, e.filas.map(f=>f.nombre || f.valor).join("+"), JSON.stringify(e.parche)]);
    exigir(JSON.stringify(upd) === JSON.stringify([["tipos_activo", "Monitor", '{"activo":false}'], ["propiedad_opciones", "eq", '{"activo":false}'], ["estado_opciones", "disponible", '{"activo":false}']]), JSON.stringify(upd));
    exigir((await db(page, "tipos_activo")).filter(t=>t.activo === false).map(t=>t.nombre).join(",") === "Monitor", "se desactivó otro tipo");
  });
  await verificar("sin la 012: editar Laptop no ofrece renombrar ni «obligatorio», y no envía campos_obligatorios", async ()=>{
    await page.click('[data-editar-tipo="Laptop"]');
    await page.waitForSelector("#inventario-tecnologico-ct-nombre");
    exigir(await page.locator("#inventario-tecnologico-ct-nombre").isDisabled(), "el nombre se puede cambiar");
    exigir(/migración 012/.test(await texto(page, "#inventario-tecnologico-ct-nombre-ayuda")), "sin la ayuda de la 012");
    exigir(await page.locator("#inventario-tecnologico-ct-campos input[data-obligatorio]").count() === 0 && await page.locator("#inventario-tecnologico-ct-nuevo-campo").count() === 0, "ofrece obligatorios o «+ Nuevo campo»");
    await page.uncheck('#inventario-tecnologico-ct-campos input[data-usa][value="mac_wifi"]');
    await page.click("#inventario-tecnologico-btn-guardar-tipo-cfg");
    await toast(page, /Tipo actualizado/);
    const p = (await escrituras(page, "tipos_activo", "update")).at(-1);
    exigir(p.filas[0].nombre === "Laptop" && !("campos_obligatorios" in p.parche) && !p.parche.campos_pertinentes.includes("mac_wifi"), JSON.stringify(p.parche));
  });
  await verificar("sin la 012: los tipos de ubicación se editan (etiqueta y color) sin campo de ícono", async ()=>{
    await page.waitForSelector('[data-fila-tipo-ubicacion="torre"]');
    await page.click('[data-editar-tipo-ubicacion="torre"]');
    await page.waitForSelector("#inventario-tecnologico-cu-etiqueta");
    exigir(await page.locator("#inventario-tecnologico-cu-icono").count() === 0, "ofrece el ícono sin la 012");
    await page.fill("#inventario-tecnologico-cu-etiqueta", "Torre de enlace");
    await page.click("#inventario-tecnologico-btn-guardar-tipo-ubicacion-cfg");
    await toast(page, /Tipo de ubicación guardado/);
    const p = (await escrituras(page, "tipos_ubicacion", "update")).at(-1);
    exigir(p.filas[0].valor === "torre" && p.parche.etiqueta === "Torre de enlace" && !("icono_svg" in p.parche), JSON.stringify(p.parche));
  });
  await page.click(SEL.tab("activos"));
  await verificar("sin la 012: «✎» del formulario edita el tipo, sin «+ Nuevo campo»; el activo se guarda sin personalizados", async ()=>{
    await page.click("#inventario-tecnologico-btn-nuevo");
    await page.waitForSelector("#inventario-tecnologico-form-activo");
    await elegirTipo(page, "lapt");
    await page.click("#inventario-tecnologico-btn-editar-tipo");
    await page.waitForSelector(SUBMODAL, { state: "visible" });
    exigir(await page.locator("#inventario-tecnologico-nt-nuevo-campo").count() === 0 && await page.locator("#inventario-tecnologico-nt-nombre").isDisabled(), "ofrece «+ Nuevo campo» o renombrar");
    await page.click("#inventario-tecnologico-btn-cancelar-tipo");
    await page.waitForSelector("#inventario-tecnologico-submodal-host", { state: "detached" });
    await page.fill(FA("marca"), "HP");
    await page.fill(FA("serie"), "SN-HP1");
    await page.fill(FA("ram"), "16");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.some(e=>e.tabla === "activos" && e.op === "insert"));
    const fila = (await escrituras(page, "activos", "insert"))[0].filas[0];
    exigir(!("personalizados" in fila) && fila.ram_gb === 16 && fila.serie === "SN-HP1", JSON.stringify(fila));
    await cerrarModales(page);
    await abrirFormDe(page, 2);
    await page.waitForSelector("#inventario-tecnologico-form-activo");
    await page.fill(FA("serie"), "SN-A2-B");
    await page.click("#inventario-tecnologico-btn-guardar-activo");
    await page.waitForFunction(()=>window.__ESCRITURAS__.some(e=>e.tabla === "activos" && e.op === "update"));
    const parche = (await escrituras(page, "activos", "update"))[0].parche;
    exigir(!("personalizados" in parche) && parche.serie === "SN-A2-B", JSON.stringify(parche));
    await cerrarModales(page);
  });
  await verificar("sin la 012: el formulario de ubicación tiene «✎» pero no el campo de ícono", async ()=>{
    await irAlMapa(page);
    await page.click("#inventario-tecnologico-mapa-nueva-ubicacion");
    await page.waitForSelector("#inventario-tecnologico-ubic-nombre");
    await page.click("#inventario-tecnologico-ubic-btn-editar-tipo");
    await page.waitForSelector("#inventario-tecnologico-ubic-mini-tipo:not([hidden])");
    exigir(await page.locator("#inventario-tecnologico-ubic-tipo-icono").count() === 0, "ofrece el ícono sin la 012");
    await cerrarModales(page);
  });
  await verificar("sin errores de JavaScript (sin la 012)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ v11 (3.6): ubicaciones sin equipos de red
// Una oficina con un activo pero sin equipos, un comedor vacío y una bodega
// vacía archivada. Con red007, los 9 CPE y el SM Bodega no tienen red.
const UBIC_VACIAS = [
  { id:60, nombre:"Oficina Vacía", tipo:"oficina", lat:-2.1950, lng:-79.8800, direccion:null, notas:null, fotos:[], activa:true },
  { id:61, nombre:"Comedor", tipo:"otro", lat:-2.2000, lng:-79.8850, direccion:null, notas:null, fotos:[], activa:true },
  { id:62, nombre:"Bodega Vieja", tipo:"bodega", lat:-2.2050, lng:-79.8900, direccion:null, notas:null, fotos:[], activa:false },
];
function fixtureVacias({ red007 = true, todasConRed = false } = {}){
  const fx = fixture({ red007 });
  fx.tablas.ubicaciones.push(...UBIC_VACIAS.map(u=>({ ...u })));
  fx.tablas.historial_ubicacion.push({ id:1003, activo_id:3, ubicacion_id:60, desde:"2026-09-20", hasta:null, notas:null });
  if(todasConRed) for(const e of fx.tablas.equipos_radioenlace) if(e.red_id === null || e.red_id === undefined) e.red_id = 1;
  return fx;
}
const MARCADORES = ".leaflet-marker-icon[data-ubicacion-id]";
const CHIP_SIN_RED = '.inventario-tecnologico-mapa-filtros [data-red="sin"]';
const hayMarcador = (page, id)=>page.locator(`.leaflet-marker-icon[data-ubicacion-id="${id}"]`).count();
const esperarMarcadores = (page, n)=>page.waitForFunction(n=>document.querySelectorAll(".leaflet-marker-icon[data-ubicacion-id]").length === n, n, { timeout: 4000 });
async function escenarioVacias(browser, base){
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias());
    await irAlMapa(page);
    await verificar("3.6: con «Sin red» encendido se ven las ubicaciones sin equipos de red (la oficina cuenta su activo; la archivada no)", async ()=>{
      exigir(await hayMarcador(page, 60) === 1 && await hayMarcador(page, 61) === 1, "no se ven");
      exigir(await hayMarcador(page, 62) === 0, "la archivada se ve");
      exigir(await texto(page, '.leaflet-marker-icon[data-ubicacion-id="60"] .inventario-tecnologico-mapa-pin-cantidad') === "1", "la oficina no cuenta su activo");
    });
    await verificar("3.6: «Sin red» cuenta sus equipos y su ayuda dice cuántas ubicaciones vacías oculta", async ()=>{
      exigir(await texto(page, `${CHIP_SIN_RED} .inventario-tecnologico-mapa-chip-n`) === "10", "cuenta: " + await texto(page, `${CHIP_SIN_RED} .inventario-tecnologico-mapa-chip-n`));
      const t = await page.getAttribute(CHIP_SIN_RED, "title");
      exigir(t === "Ocultar los 10 equipos sin red y las 2 ubicaciones sin equipos de red", t);
    });
    await verificar("3.6: apagar «Sin red» oculta también las ubicaciones sin equipos de red, en el mapa y en la lista del panel", async ()=>{
      const antes = await cuenta(page, MARCADORES);
      await clicFiltro(page, CHIP_SIN_RED);
      await esperarMarcadores(page, antes - 12);
      exigir(await hayMarcador(page, 60) === 0 && await hayMarcador(page, 61) === 0, "las vacías siguen");
      const t = await page.getAttribute(CHIP_SIN_RED, "title");
      exigir(t === "Mostrar los 10 equipos sin red y las 2 ubicaciones sin equipos de red", t);
      exigir(await cuenta(page, `${SEL.panel} [data-accion="ver-ubicacion"][data-id="60"]`) === 0, "la lista del panel la sigue mostrando");
      exigir(/1 activo/.test(await texto(page, "#inventario-tecnologico-mapa-filtros-cuenta")), "el contador de filtros no lo cuenta");
      await captura(page, "v11-sin-red-vacias.png");
      await clicFiltro(page, CHIP_SIN_RED);
      await esperarMarcadores(page, antes);
    });
    await verificar("3.6: la ubicación vacía seleccionada se sigue viendo con «Sin red» apagado y se oculta al soltarla", async ()=>{
      await irAUbicacionDesdePanel(page, 60);
      await clicFiltro(page, CHIP_SIN_RED);
      await page.waitForFunction(()=>!document.querySelector('.leaflet-marker-icon[data-ubicacion-id="61"]'), null, { timeout: 4000 });
      exigir(await hayMarcador(page, 60) === 1, "se ocultó la seleccionada");
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await page.waitForFunction(()=>!document.querySelector('.leaflet-marker-icon[data-ubicacion-id="60"]'), null, { timeout: 4000 });
      await clicFiltro(page, CHIP_SIN_RED);
      await page.waitForSelector('.leaflet-marker-icon[data-ubicacion-id="60"]', { timeout: 4000 });
    });
    await verificar("3.6: con «Archivadas», la ayuda cuenta también la archivada vacía", async ()=>{
      await marcarFiltro(page, "#inventario-tecnologico-mapa-ver-archivadas", true);
      await page.waitForSelector('.leaflet-marker-icon[data-ubicacion-id="62"]', { timeout: 4000 });
      const t = await page.getAttribute(CHIP_SIN_RED, "title");
      exigir(t === "Ocultar los 10 equipos sin red y las 3 ubicaciones sin equipos de red", t);
      await marcarFiltro(page, "#inventario-tecnologico-mapa-ver-archivadas", false);
      await page.waitForFunction(()=>!document.querySelector('.leaflet-marker-icon[data-ubicacion-id="62"]'), null, { timeout: 4000 });
    });
    await verificar("3.6: los roles no ocultan las ubicaciones vacías", async ()=>{
      const roles = await page.locator(".inventario-tecnologico-mapa-filtros [data-rol]").evaluateAll(l=>l.map(c=>c.dataset.rol));
      exigir(roles.length >= 4, "roles: " + roles.join(","));
      for(const r of roles) await clicFiltro(page, `.inventario-tecnologico-mapa-filtros [data-rol="${r}"]`);
      await esperarMarcadores(page, 2);
      exigir(await hayMarcador(page, 60) === 1 && await hayMarcador(page, 61) === 1, "se ocultaron las vacías");
      for(const r of roles) await clicFiltro(page, `.inventario-tecnologico-mapa-filtros [data-rol="${r}"]`);
      await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon[data-ubicacion-id]").length > 2, null, { timeout: 4000 });
    });
    await verificar("sin errores de JavaScript (ubicaciones vacías)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias({ todasConRed: true }));
    await irAlMapa(page);
    await verificar("3.6: si todos los equipos tienen red, «Sin red» aparece igual por las ubicaciones vacías (con 0 equipos)", async ()=>{
      exigir(await cuenta(page, CHIP_SIN_RED) === 1, "no aparece");
      exigir(await texto(page, `${CHIP_SIN_RED} .inventario-tecnologico-mapa-chip-n`) === "0", "cuenta");
      const t = await page.getAttribute(CHIP_SIN_RED, "title");
      exigir(t === "Ocultar las 2 ubicaciones sin equipos de red", t);
      const antes = await cuenta(page, MARCADORES);
      await clicFiltro(page, CHIP_SIN_RED);
      await esperarMarcadores(page, antes - 2);
      exigir(await hayMarcador(page, 60) === 0 && await hayMarcador(page, 61) === 0, "las vacías siguen");
    });
    await verificar("sin errores de JavaScript (todas con red)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias({ red007: false }));
    await irAlMapa(page);
    await verificar("3.6 sin la 007: no hay chips de redes y las ubicaciones vacías se ven", async ()=>{
      exigir(await page.locator("#inventario-tecnologico-mapa-grupo-redes").isHidden(), "el grupo de redes está a la vista");
      exigir(await hayMarcador(page, 60) === 1 && await hayMarcador(page, 61) === 1, "no se ven");
    });
    await verificar("sin errores de JavaScript (vacías sin la 007)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

// ------------------------------------------------------------------ v11 (3.7): grosor de las líneas hasta 0
const CLAVE_GROSOR = "inventario-tecnologico-mapa-grosor-lineas";
async function escenarioGrosorCero(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());
  await irAlMapa(page);
  const GROSOR = "#inventario-tecnologico-mapa-grosor";
  const sinLineas = ()=>page.waitForFunction(()=>document.querySelectorAll("path.inventario-tecnologico-mapa-linea").length === 0, null, { timeout: 4000 });
  await verificar("3.7: la barra llega a 0: dice «0× (sin líneas)», no dibuja ninguna línea ni etiqueta, y se recuerda", async ()=>{
    exigir(await page.getAttribute(GROSOR, "min") === "0", "mínimo: " + await page.getAttribute(GROSOR, "min"));
    exigir(await cuenta(page, SEL.lineas) > 0, "sin líneas al empezar");
    await page.locator(GROSOR).fill("0");
    await sinLineas();
    exigir(await texto(page, "#inventario-tecnologico-mapa-grosor-valor") === "0× (sin líneas)", "texto");
    exigir(await page.getAttribute(GROSOR, "aria-valuetext") === "0× (sin líneas)", "aria-valuetext");
    exigir(await page.evaluate(k=>localStorage.getItem(k), CLAVE_GROSOR) === "0", "no se recordó");
    exigir(!(await page.locator("#inventario-tecnologico-mapa-grosor-normal").isHidden()), "sin «Normal»");
    exigir(await cuenta(page, SEL.etiquetas) === 0, "quedaron etiquetas de enlaces");
    await captura(page, "v11-grosor-cero.png");
  });
  await verificar("3.7: en 0, el camino del equipo elegido se dibuja a 0,5× (y nada más); al soltarlo no queda ninguna línea", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
    await page.waitForSelector(SEL.linea("cadena"), { timeout: 4000 });
    const dibujadas = await page.evaluate(()=>[...document.querySelectorAll("path.inventario-tecnologico-mapa-linea")].map(p=>[(p.getAttribute("class").match(/mapa-linea-(\w+)/) || [])[1], Number(p.getAttribute("stroke-width"))]));
    // El camino del AP 11 cruza una sola vez de ubicación (Cerro Azul → Oficina Centro).
    exigir(dibujadas.length === 1 && dibujadas.every(([c, w])=>c === "cadena" && w === 3), JSON.stringify(dibujadas));
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await sinLineas();
  });
  await verificar("3.7: al volver al mapa sigue en 0, y «Normal» devuelve las líneas a 1×", async ()=>{
    await page.click(SEL.tab("activos"));
    await irAlMapa(page);
    exigir(await page.inputValue(GROSOR) === "0", "no se recordó: " + await page.inputValue(GROSOR));
    exigir(await cuenta(page, SEL.lineas) === 0, "hay líneas");
    await page.click("#inventario-tecnologico-mapa-grosor-normal");
    await page.waitForFunction(()=>Number(document.querySelector('path.inventario-tecnologico-mapa-linea[data-cliente-id="20"]')?.getAttribute("stroke-width")) === 5, null, { timeout: 4000 });
    exigir(await page.evaluate(k=>localStorage.getItem(k), CLAVE_GROSOR) === "1", "no se guardó el 1×");
  });
  await verificar("3.7: un valor guardado vacío o raro vuelve a 1× (no se toma como 0)", async ()=>{
    for(const raro of ["", "abc"]){
      await page.evaluate(([k, v])=>localStorage.setItem(k, v), [CLAVE_GROSOR, raro]);
      await page.reload();
      await page.waitForSelector(".inventario-tecnologico-topbar", { timeout: 10000 });
      await irAlMapa(page);
      exigir(await page.inputValue(GROSOR) === "1", `con «${raro}»: ` + await page.inputValue(GROSOR));
      exigir(await cuenta(page, SEL.lineas) > 0, `con «${raro}» no hay líneas`);
    }
  });
  await verificar("sin errores de JavaScript (grosor 0)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ v12 (3.3, 3.4 y 3.5): filtros del mapa en desplegables
const DD = id=>`#inventario-tecnologico-mapa-dd-${id}`;
const DD_PANEL = id=>`#inventario-tecnologico-mapa-dd-${id}-panel`;
const OPCION = (dd, valor)=>`.inventario-tecnologico-mapa-opcion[data-opcion-dd="${dd}"][data-opcion-valor="${valor}"]`;
const textoBoton = (page, id)=>page.locator(DD(id)).innerText().then(s=>s.replace(/\s+/g, " ").trim());
async function escenarioFiltros(browser, base){
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias());
    await irAlMapa(page);
    await verificar("3.3: la barra tiene un desplegable por categoría con su cuenta; a la vista quedan Colorear, Simulación, Grosor y «Quitar filtros»", async ()=>{
      const botones = [];
      for(const id of ["ubicaciones", "lineas", "roles", "redes", "tiposEquipo"]) botones.push(await textoBoton(page, id));
      exigir(JSON.stringify(botones) === JSON.stringify(["Ubicaciones 4/4", "Líneas 2/3", "Equipos 4/4", "Redes 3/3", "Tipos de equipo 10/10"]), JSON.stringify(botones));
      exigir(await page.locator(DD("estados")).isHidden(), "«Estados» a la vista sin simulación");
      for(const sel of ["#inventario-tecnologico-mapa-color-red", "#inventario-tecnologico-mapa-simulacion", "#inventario-tecnologico-mapa-grosor", "#inventario-tecnologico-mapa-quitar-filtros"]) exigir(await page.locator(sel).isVisible(), "no se ve " + sel);
      exigir(await page.locator("#inventario-tecnologico-mapa-quitar-filtros").isDisabled(), "«Quitar filtros» habilitado sin filtros");
      exigir(await page.locator(".inventario-tecnologico-mapa-opcion-btn:visible").count() === 0, "hay opciones a la vista con todo cerrado");
      exigir(!(await page.locator(DD("lineas")).evaluate(b=>b.classList.contains("inventario-tecnologico-mapa-desplegable-filtrado"))), "«Líneas» resaltada de fábrica (Respaldos arranca apagado)");
      exigir(await cuenta(page, MARCADORES) === 15, "marcadores: " + await cuenta(page, MARCADORES));
    });
    await verificar("3.3: el desplegable abre un panel con título, «Todas», «Ninguna», casillas con cuentas y la ayuda; uno a la vez", async ()=>{
      await page.click(DD("redes"));
      exigir(await page.getAttribute(DD("redes"), "aria-expanded") === "true" && await page.locator(DD_PANEL("redes")).isVisible(), "no se abrió");
      const t = await texto(page, DD_PANEL("redes"));
      for(const re of [/Redes/i, /Todas/, /Ninguna/, /Red Administrativa\s*8/, /Red Cámaras\s*3/, /Sin red\s*10/, /Doble clic, «solo» o Mayús\+Enter/]) exigir(re.test(t), `falta ${re}: ${t.replace(/\s+/g, " ")}`);
      exigir(await page.getAttribute(OPCION("redes", "1") + " [data-red]", "aria-pressed") === "true", "casilla");
      const caja = await page.locator(DD_PANEL("redes")).boundingBox();
      exigir(caja && caja.x >= 0 && caja.x + caja.width <= 1400, "el panel se sale: " + JSON.stringify(caja));
      await captura(page, "v12-desplegable-redes.png");
      await page.click(DD("ubicaciones"));
      exigir(await page.locator(DD_PANEL("redes")).isHidden() && await page.locator(DD_PANEL("ubicaciones")).isVisible(), "quedaron dos abiertos");
      await page.click("#inventario-tecnologico-mapa-buscar");
      await page.waitForFunction(()=>document.getElementById("inventario-tecnologico-mapa-dd-ubicaciones-panel").hidden, null, { timeout: 3000 });
    });
    await verificar("3.3: «Ninguna» y «Todas»; la cuenta y el resaltado del botón lo siguen", async ()=>{
      await page.click(DD("redes"));
      await page.click('[data-dd-ninguna="redes"]');
      await esperarMarcadores(page, 0);
      exigir(await textoBoton(page, "redes") === "Redes 0/3", await textoBoton(page, "redes"));
      exigir(await page.locator(DD("redes")).evaluate(b=>b.classList.contains("inventario-tecnologico-mapa-desplegable-filtrado")), "sin resaltar");
      exigir(await page.locator(DD_PANEL("redes")).isVisible(), "el panel se cerró al tocar «Ninguna»");
      await page.click('[data-dd-todas="redes"]');
      await esperarMarcadores(page, 15);
      exigir(await textoBoton(page, "redes") === "Redes 3/3", await textoBoton(page, "redes"));
    });
    await verificar("3.5: doble clic deja solo esa red; otra vez en la única, vuelven todas", async ()=>{
      await page.dblclick(OPCION("redes", "1") + " [data-red]");
      await esperarMarcadores(page, 3);
      exigir(await textoBoton(page, "redes") === "Redes 1/3", await textoBoton(page, "redes"));
      exigir(await page.getAttribute(OPCION("redes", "2") + " [data-red]", "aria-pressed") === "false" && await page.getAttribute(OPCION("redes", "sin") + " [data-red]", "aria-pressed") === "false", "las otras siguen marcadas");
      await page.dblclick(OPCION("redes", "1") + " [data-red]");
      await esperarMarcadores(page, 15);
    });
    await verificar("3.5: el botón «solo» aparece al pasar el mouse y deja solo esa; Mayús+Enter en la única devuelve todas", async ()=>{
      const solo = OPCION("redes", "2") + " .inventario-tecnologico-mapa-solo";
      exigir(Number(await page.locator(solo).evaluate(b=>getComputedStyle(b).opacity)) === 0, "«solo» a la vista sin el mouse");
      await page.hover(OPCION("redes", "2"));
      await page.waitForFunction(sel=>Number(getComputedStyle(document.querySelector(sel)).opacity) === 1, solo, { timeout: 2000 });
      await page.click(solo);
      await esperarMarcadores(page, 1);
      await page.focus(OPCION("redes", "2") + " [data-red]");
      await page.keyboard.press("Shift+Enter");
      await esperarMarcadores(page, 15);
      exigir(await page.getAttribute(OPCION("redes", "2") + " [data-red]", "aria-pressed") === "true", "Mayús+Enter también alternó la casilla");
    });
    await verificar("3.5: con el teclado: Enter abre, Espacio alterna sin perder el foco, Mayús+Enter deja solo esa y Esc cierra y devuelve el foco", async ()=>{
      await cerrarFiltros(page);
      await page.focus(DD("ubicaciones"));
      await page.keyboard.press("Enter");
      exigir(await page.getAttribute(DD("ubicaciones"), "aria-expanded") === "true", "Enter no lo abrió");
      await page.focus(OPCION("ubicaciones", "otro") + " [data-tipo]");
      await page.keyboard.press("Space");
      await esperarMarcadores(page, 5);
      exigir(await page.evaluate(()=>document.activeElement && document.activeElement.dataset.tipo) === "otro", "el foco se perdió al alternar");
      await page.keyboard.press("Shift+Enter");
      await esperarMarcadores(page, 10);
      exigir(await textoBoton(page, "ubicaciones") === "Ubicaciones 1/4", await textoBoton(page, "ubicaciones"));
      await page.keyboard.press("Shift+Enter");
      await esperarMarcadores(page, 15);
      await page.keyboard.press("Escape");
      exigir(await page.locator(DD_PANEL("ubicaciones")).isHidden(), "Esc no lo cerró");
      exigir(await page.evaluate(()=>document.activeElement.id) === "inventario-tecnologico-mapa-dd-ubicaciones", "el foco no volvió al botón");
      exigir(await page.locator(SEL.panel).isVisible(), "Esc hizo otra cosa");
    });
    await verificar("3.3: «Quitar filtros» deja todo como al empezar (Archivadas apagada, Respaldos apagado) y conserva «Colorear líneas por red»", async ()=>{
      await page.click("#inventario-tecnologico-mapa-color-red");
      await clicFiltro(page, SEL.chip("linea", "respaldos"));
      await clicFiltro(page, SEL.chip("red", "sin"));
      await clicFiltro(page, SEL.chip("tipo-equipo", "camara"));
      await marcarFiltro(page, "#inventario-tecnologico-mapa-ver-archivadas", true);
      exigir(/4 activos/.test(await page.locator("#inventario-tecnologico-mapa-filtros-cuenta").textContent()), "contador: " + await page.locator("#inventario-tecnologico-mapa-filtros-cuenta").textContent());
      exigir(!(await page.locator("#inventario-tecnologico-mapa-quitar-filtros").isDisabled()), "deshabilitado con filtros");
      await page.click("#inventario-tecnologico-mapa-quitar-filtros");
      await esperarMarcadores(page, 15);
      const botones = [];
      for(const id of ["ubicaciones", "lineas", "roles", "redes", "tiposEquipo"]) botones.push(await textoBoton(page, id));
      exigir(JSON.stringify(botones) === JSON.stringify(["Ubicaciones 4/4", "Líneas 2/3", "Equipos 4/4", "Redes 3/3", "Tipos de equipo 10/10"]), JSON.stringify(botones));
      exigir(!(await page.locator("#inventario-tecnologico-mapa-ver-archivadas").isChecked()), "Archivadas sigue marcada");
      exigir(await page.getAttribute(SEL.chip("linea", "respaldos"), "aria-pressed") === "false", "Respaldos quedó encendido");
      exigir(await page.locator("#inventario-tecnologico-mapa-quitar-filtros").isDisabled(), "sigue habilitado");
      exigir(await page.getAttribute("#inventario-tecnologico-mapa-color-red", "aria-pressed") === "true", "se apagó Colorear");
      await page.click("#inventario-tecnologico-mapa-color-red");
    });
    await verificar("3.4: «Tipos de equipo» con cuentas, «Sin tipo» y «Sin equipos»; solo los AP deja las torres con AP", async ()=>{
      await page.click(DD("tiposEquipo"));
      const op = await page.locator(`${DD_PANEL("tiposEquipo")} .inventario-tecnologico-mapa-opcion-btn`).evaluateAll(l=>l.map(b=>b.querySelector(".inventario-tecnologico-mapa-opcion-etiqueta").textContent + ":" + b.querySelector(".inventario-tecnologico-mapa-chip-n").textContent));
      exigir(JSON.stringify(op) === JSON.stringify(["Router:1", "Switch:1", "Punto a Punto:4", "AP:2", "Estación:10", "Cámara:2", "NVR:0", "Equipo:0", "Sin tipo:1", "Sin equipos:2"]), JSON.stringify(op));
      await page.dblclick(OPCION("tiposEquipo", "ap") + " [data-tipo-equipo]");
      await esperarMarcadores(page, 2);
      exigir(await hayMarcador(page, 1) === 1 && await hayMarcador(page, 2) === 1, "no son Cerro Azul y Santa Ana");
      exigir(await textoBoton(page, "tiposEquipo") === "Tipos de equipo 1/10", await textoBoton(page, "tiposEquipo"));
      await cerrarFiltros(page);
    });
    await verificar("3.4: al elegir un AP se ve su camino a la raíz completo, aunque pase por torres de otros tipos", async ()=>{
      await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
      await page.waitForSelector('.leaflet-marker-icon[data-ubicacion-id="3"]', { timeout: 4000 });
      exigir(await cuenta(page, SEL.linea("cadena")) >= 1, "sin el camino resaltado");
      await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
      await esperarMarcadores(page, 2);
      // «solo» en la única a la vista: vuelven todas (el botón aparece al pasar el mouse).
      await abrirFiltroDe(page, OPCION("tiposEquipo", "ap") + " [data-tipo-equipo]");
      await page.hover(OPCION("tiposEquipo", "ap"));
      await page.click(OPCION("tiposEquipo", "ap") + " .inventario-tecnologico-mapa-solo");
      await esperarMarcadores(page, 15);
      await cerrarFiltros(page);
    });
    await verificar("3.4: «Sin equipos» oculta las ubicaciones vacías y «Sin tipo», la bodega (su único equipo no tiene tipo)", async ()=>{
      await clicFiltro(page, SEL.chip("tipo-equipo", "-sin-equipos"));
      await esperarMarcadores(page, 13);
      exigir(await hayMarcador(page, 60) === 0 && await hayMarcador(page, 61) === 0, "las vacías siguen");
      await clicFiltro(page, SEL.chip("tipo-equipo", "-sin-tipo"));
      await esperarMarcadores(page, 12);
      exigir(await hayMarcador(page, 4) === 0, "la bodega sigue");
      await page.click("#inventario-tecnologico-mapa-quitar-filtros");
      await esperarMarcadores(page, 15);
    });
    await verificar("3.3: con la simulación aparece «Estados» (desplegable) y se va al apagarla", async ()=>{
      await page.click("#inventario-tecnologico-mapa-simulacion");
      await page.waitForSelector(DD("estados"), { state: "visible", timeout: 3000 });
      exigir(await textoBoton(page, "estados") === "Estados 4/4", await textoBoton(page, "estados"));
      await page.click(DD("estados"));
      exigir((await texto(page, DD_PANEL("estados"))).includes("En servicio"), "sin opciones");
      await page.click("#inventario-tecnologico-mapa-simulacion");
      await page.waitForSelector(DD("estados"), { state: "hidden", timeout: 3000 });
      exigir(await page.locator(DD_PANEL("estados")).isHidden(), "el panel quedó abierto");
    });
    await verificar("3.3: en pantalla completa los desplegables funcionan dentro de la ventana de filtros", async ()=>{
      await page.click(BOTON_COMPLETA);
      await page.waitForSelector(COMPLETA);
      await page.click(ALTERNAR("barra"));
      await page.click(DD("redes"));
      const caja = await page.locator(DD_PANEL("redes")).boundingBox();
      exigir(caja && caja.width > 100 && caja.x >= 0 && caja.x + caja.width <= 1400 && caja.y + caja.height <= 900, "panel: " + JSON.stringify(caja));
      await page.click(OPCION("redes", "sin") + " [data-red]");
      await esperarMarcadores(page, 3);
      await page.click(OPCION("redes", "sin") + " [data-red]");
      await esperarMarcadores(page, 15);
      await page.keyboard.press("Escape");
      exigir(await page.locator(DD_PANEL("redes")).isHidden() && await cuenta(page, COMPLETA) === 1, "Esc salió de la pantalla completa antes de cerrar el desplegable");
      await page.click(BOTON_COMPLETA);
      await page.waitForFunction(()=>!document.querySelector(".inventario-tecnologico-mapa-vista.inventario-tecnologico-mapa-completa"), null, { timeout: 4000 });
    });
    await verificar("sin errores de JavaScript (filtros en desplegables)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias(), { viewport: { width: 390, height: 844 } });
    await irAlMapa(page);
    await verificar("3.3 en el celular: el panel del último desplegable cabe en la pantalla", async ()=>{
      await page.click(".inventario-tecnologico-mapa-filtros-resumen");
      await page.click(DD("tiposEquipo"));
      const caja = await page.locator(DD_PANEL("tiposEquipo")).boundingBox();
      exigir(caja && caja.x >= 0 && caja.x + caja.width <= 390, "se sale: " + JSON.stringify(caja));
      const ancho = await page.evaluate(()=>document.documentElement.scrollWidth);
      exigir(ancho <= 390, "scroll horizontal: " + ancho);
      await captura(page, "v12-celular-tipos.png");
    });
    await verificar("sin errores de JavaScript (desplegables en el celular)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture());
    await irAlMapa(page);
    await verificar("3.3 sin la 007: sin «Redes», «Tipos de equipo» ni «Colorear»; los otros desplegables funcionan", async ()=>{
      exigir(await page.locator(DD("redes")).isHidden() && await page.locator(DD("tiposEquipo")).isHidden() && await page.locator("#inventario-tecnologico-mapa-color-red").isHidden(), "se ven");
      await clicFiltro(page, SEL.chip("rol", "cliente"));
      await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon.inventario-tecnologico-mapa-icono").length === 3, null, { timeout: 4000 });
      exigir(await textoBoton(page, "roles") === "Equipos 3/4", await textoBoton(page, "roles"));
      await page.click("#inventario-tecnologico-mapa-quitar-filtros");
      await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon.inventario-tecnologico-mapa-icono").length === 13, null, { timeout: 4000 });
    });
    await verificar("sin errores de JavaScript (desplegables sin la 007)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

// ------------------------------------------------------------------ v12 (3.5): «solo esta» en los filtros de la tabla de activos
async function escenarioSoloTabla(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());
  const FILAS = "#inventario-tecnologico-tbody-activos tr[data-id], #inventario-tecnologico-tbody-activos tr:has(td)";
  const tags = ()=>page.locator("#inventario-tecnologico-tbody-activos tr").evaluateAll(l=>l.map(tr=>(tr.innerText.match(/(LKM|EQS)-\d+/) || [""])[0]).filter(Boolean));
  const abrirPanelTipo = async ()=>{ await page.hover('[data-filtro-btn="tipo"]'); await page.waitForSelector('.inventario-tecnologico-filter-opt[data-filtro-opt-campo="tipo"]', { state: "visible", timeout: 3000 }); };
  await page.waitForSelector("#inventario-tecnologico-tbody-activos tr");
  await verificar("3.5 tabla: el filtro de Tipo tiene «solo» por opción y la ayuda nueva", async ()=>{
    exigir(JSON.stringify(await tags()) === '["LKM-001","LKM-002","EQS-003"]', JSON.stringify(await tags()));
    await abrirPanelTipo();
    exigir(await cuenta(page, '[data-filtro-solo-campo="tipo"]') === 3, "sin los botones «solo»");
    exigir(/Doble clic, «solo» o Mayús\+Enter/.test(await page.locator('.inventario-tecnologico-th-filter:has([data-filtro-btn="tipo"]) .inventario-tecnologico-filter-panel-hint').innerText()), "ayuda");
  });
  await verificar("3.5 tabla: «solo» deja solo ese tipo; otra vez, vuelven todos", async ()=>{
    await abrirPanelTipo();
    await page.hover('.inventario-tecnologico-filtro-fila:has([data-filtro-opt-valor="Laptop"])');
    await page.click('[data-filtro-solo-campo="tipo"][data-filtro-solo-valor="Laptop"]');
    await page.waitForFunction(()=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr").length === 1, null, { timeout: 3000 });
    exigir(JSON.stringify(await tags()) === '["LKM-001"]', JSON.stringify(await tags()));
    await abrirPanelTipo();
    await page.hover('.inventario-tecnologico-filtro-fila:has([data-filtro-opt-valor="Laptop"])');
    await page.click('[data-filtro-solo-campo="tipo"][data-filtro-solo-valor="Laptop"]');
    await page.waitForFunction(()=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr").length === 3, null, { timeout: 3000 });
  });
  await verificar("3.5 tabla: doble clic deja solo esa opción y, en la única, vuelven todas", async ()=>{
    await abrirPanelTipo();
    await page.dblclick('.inventario-tecnologico-filter-opt[data-filtro-opt-campo="tipo"][data-filtro-opt-valor="Monitor"] .inventario-tecnologico-filter-opt-label');
    await page.waitForFunction(()=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr").length === 1, null, { timeout: 3000 });
    exigir(JSON.stringify(await tags()) === '["EQS-003"]', JSON.stringify(await tags()));
    await abrirPanelTipo();
    await page.dblclick('.inventario-tecnologico-filter-opt[data-filtro-opt-campo="tipo"][data-filtro-opt-valor="Monitor"] .inventario-tecnologico-filter-opt-label');
    await page.waitForFunction(()=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr").length === 3, null, { timeout: 3000 });
  });
  await verificar("3.5 tabla: Mayús+Enter en la casilla deja solo esa (sin alternarla) y otra vez devuelve todas", async ()=>{
    await abrirPanelTipo();
    await page.focus('input[data-filtro-campo="tipo"][data-filtro-valor="Antena"]');
    await page.keyboard.press("Shift+Enter");
    await page.waitForFunction(()=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr").length === 1, null, { timeout: 3000 });
    exigir(JSON.stringify(await tags()) === '["LKM-002"]', JSON.stringify(await tags()));
    exigir(await page.isChecked('input[data-filtro-campo="tipo"][data-filtro-valor="Antena"]'), "la casilla quedó desmarcada");
    await page.keyboard.press("Shift+Enter");
    await page.waitForFunction(()=>document.querySelectorAll("#inventario-tecnologico-tbody-activos tr").length === 3, null, { timeout: 3000 });
  });
  await verificar("sin errores de JavaScript («solo» en la tabla)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ v13: buscador en los desplegables del mapa y en los filtros de la tabla; búsqueda general angosta (§4)
async function escenarioBuscar(browser, base){
  const BUSCAR = id=>`[data-dd-buscar="${id}"]`;
  const VACIO = id=>`[data-dd-vacio="${id}"]`;
  const visibles = (page, id)=>page.locator(`${DD_PANEL(id)} .inventario-tecnologico-mapa-opcion:not([hidden]) .inventario-tecnologico-mapa-opcion-etiqueta`).evaluateAll(l=>l.map(n=>n.textContent));
  const enVista = async (page, id)=>JSON.stringify(await visibles(page, id));
  const foco = page=>page.evaluate(()=>{
    const a = document.activeElement;
    if(!a || a === document.body) return null;
    if(a.dataset.ddBuscar) return "buscar:" + a.dataset.ddBuscar;
    return a.id || a.dataset.tipoEquipo || a.dataset.red || a.dataset.tipo || a.tagName;
  });
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias());
    await irAlMapa(page);
    await verificar("v13: Ubicaciones, Redes y Tipos de equipo traen buscador; Líneas, Equipos y Estados (fijos) no", async ()=>{
      for(const [id, ph] of [["ubicaciones", "Buscar tipo de ubicación…"], ["redes", "Buscar red…"], ["tiposEquipo", "Buscar tipo de equipo…"]]){
        exigir(await cuenta(page, BUSCAR(id)) === 1, "sin buscador: " + id);
        exigir(await page.getAttribute(BUSCAR(id), "placeholder") === ph, id + ": " + await page.getAttribute(BUSCAR(id), "placeholder"));
        exigir(/Enter/.test(await page.getAttribute(BUSCAR(id), "title")), "sin la ayuda: " + id);
      }
      for(const id of ["lineas", "roles", "estados"]) exigir(await cuenta(page, `${DD_PANEL(id)} input`) === 0, "con buscador: " + id);
    });
    await verificar("v13: al abrir, el foco va al buscador; lo escrito (sin tildes ni mayúsculas, palabras en cualquier orden) filtra la lista, no el mapa", async ()=>{
      await page.click(DD("tiposEquipo"));
      exigir(await foco(page) === "buscar:tiposEquipo", "foco: " + await foco(page));
      await page.keyboard.type("CAMARA");
      exigir(await enVista(page, "tiposEquipo") === '["Cámara"]', await enVista(page, "tiposEquipo"));
      exigir(await textoBoton(page, "tiposEquipo") === "Tipos de equipo 10/10", await textoBoton(page, "tiposEquipo"));
      exigir(await cuenta(page, MARCADORES) === 15, "cambió el mapa: " + await cuenta(page, MARCADORES));
      exigir(await page.locator(VACIO("tiposEquipo")).isHidden(), "aviso con una coincidencia");
      await page.fill(BUSCAR("tiposEquipo"), "sin");
      exigir(await enVista(page, "tiposEquipo") === '["Sin tipo","Sin equipos"]', await enVista(page, "tiposEquipo"));
      await page.fill(BUSCAR("tiposEquipo"), "a punto");
      exigir(await enVista(page, "tiposEquipo") === '["Punto a Punto"]', await enVista(page, "tiposEquipo"));
      await captura(page, "v13-buscador-tipos.png");
    });
    await verificar("v13: sin coincidencias avisa «Ninguna coincide…»; Esc borra lo escrito y deja el panel abierto; otro Esc lo cierra", async ()=>{
      await page.fill(BUSCAR("tiposEquipo"), "xyz");
      exigir((await visibles(page, "tiposEquipo")).length === 0, "quedan opciones: " + await enVista(page, "tiposEquipo"));
      const aviso = page.locator(VACIO("tiposEquipo"));
      exigir(await aviso.isVisible() && await aviso.textContent() === "Ninguna coincide con «xyz».", "aviso: " + await aviso.textContent());
      await captura(page, "v13-buscador-sin-coincidencias.png");
      await page.keyboard.press("Escape");
      exigir(await page.inputValue(BUSCAR("tiposEquipo")) === "", "no se borró");
      exigir((await visibles(page, "tiposEquipo")).length === 10, "no volvieron todas: " + await enVista(page, "tiposEquipo"));
      exigir(await page.locator(DD_PANEL("tiposEquipo")).isVisible() && await foco(page) === "buscar:tiposEquipo", "se cerró o perdió el foco: " + await foco(page));
      exigir(await aviso.isHidden(), "quedó el aviso");
      await page.keyboard.press("Escape");
      exigir(await page.locator(DD_PANEL("tiposEquipo")).isHidden(), "no se cerró");
      exigir(await foco(page) === "inventario-tecnologico-mapa-dd-tiposEquipo", "foco: " + await foco(page));
      exigir(await page.locator(SEL.panel).isVisible(), "Esc hizo otra cosa");
    });
    await verificar("v13: al cerrar el desplegable (otro desplegable, un clic afuera) se borra lo escrito; al abrir de nuevo están todas", async ()=>{
      await page.click(DD("redes"));
      await page.keyboard.type("cam");
      exigir(await enVista(page, "redes") === '["Red Cámaras"]', await enVista(page, "redes"));
      await page.click(DD("ubicaciones"));
      exigir(await page.locator(DD_PANEL("redes")).isHidden(), "Redes sigue abierto");
      exigir(await foco(page) === "buscar:ubicaciones", "foco: " + await foco(page));
      exigir(await page.inputValue(BUSCAR("redes")) === "" && (await visibles(page, "redes")).length === 3, "quedó lo escrito en Redes");
      await page.keyboard.type("piscina");
      await page.click("#inventario-tecnologico-mapa-buscar");
      await page.waitForFunction(()=>document.getElementById("inventario-tecnologico-mapa-dd-ubicaciones-panel").hidden, null, { timeout: 3000 });
      exigir(await page.inputValue(BUSCAR("ubicaciones")) === "", "clic afuera: quedó lo escrito");
    });
    await verificar("v13: con una sola a la vista, Enter la marca o desmarca (el foco sigue en el buscador) y Mayús+Enter la deja sola; otra vez, vuelven todas", async ()=>{
      await page.click(DD("redes"));
      await page.keyboard.type("administ");
      await page.keyboard.press("Enter");
      exigir(await textoBoton(page, "redes") === "Redes 2/3", await textoBoton(page, "redes"));
      exigir(await page.getAttribute(OPCION("redes", "1") + " [data-red]", "aria-pressed") === "false", "no se desmarcó");
      exigir(await foco(page) === "buscar:redes", "foco: " + await foco(page));
      await page.keyboard.press("Enter");
      exigir(await textoBoton(page, "redes") === "Redes 3/3", await textoBoton(page, "redes"));
      await page.keyboard.press("Shift+Enter");
      await esperarMarcadores(page, 3);
      exigir(await textoBoton(page, "redes") === "Redes 1/3", await textoBoton(page, "redes"));
      await page.keyboard.press("Shift+Enter");
      await esperarMarcadores(page, 15);
      exigir(await textoBoton(page, "redes") === "Redes 3/3", await textoBoton(page, "redes"));
    });
    await verificar("v13: con varias a la vista, Enter no cambia nada", async ()=>{
      await page.fill(BUSCAR("redes"), "red");
      exigir((await visibles(page, "redes")).length === 3, await enVista(page, "redes"));
      await page.keyboard.press("Enter");
      await page.keyboard.press("Shift+Enter");
      exigir(await textoBoton(page, "redes") === "Redes 3/3", await textoBoton(page, "redes"));
      exigir(await cuenta(page, MARCADORES) === 15, "cambió el mapa");
      await cerrarFiltros(page);
    });
    await verificar("v13: flecha abajo baja a la primera que se ve; arriba y abajo recorren solo las que se ven; desde la primera, arriba vuelve al buscador", async ()=>{
      await page.click(DD("tiposEquipo"));
      await page.keyboard.type("sin");
      await page.keyboard.press("ArrowDown");
      exigir(await foco(page) === "-sin-tipo", "foco: " + await foco(page));
      await page.keyboard.press("ArrowDown");
      exigir(await foco(page) === "-sin-equipos", "foco: " + await foco(page));
      await page.keyboard.press("ArrowDown");
      exigir(await foco(page) === "-sin-equipos", "se pasó de la última: " + await foco(page));
      await page.keyboard.press("ArrowUp");
      exigir(await foco(page) === "-sin-tipo", "foco: " + await foco(page));
      await page.keyboard.press("ArrowUp");
      exigir(await foco(page) === "buscar:tiposEquipo", "no volvió al buscador: " + await foco(page));
      // En uno sin buscador (Equipos), las flechas recorren las casillas.
      await cerrarFiltros(page);
      await page.click(DD("roles"));
      await page.focus(OPCION("roles", "raiz") + " [data-rol]");
      await page.keyboard.press("ArrowDown");
      exigir(await page.evaluate(()=>document.activeElement.dataset.rol) === "backbone", "roles: " + await page.evaluate(()=>document.activeElement.dataset.rol));
      await page.keyboard.press("ArrowUp"); await page.keyboard.press("ArrowUp");
      exigir(await page.evaluate(()=>document.activeElement.dataset.rol) === "raiz", "roles arriba: " + await page.evaluate(()=>document.activeElement.dataset.rol));
      await cerrarFiltros(page);
    });
    await verificar("v13: lo escrito sigue valiendo cuando las opciones se rearman (cambia el catálogo mientras está abierto)", async ()=>{
      await page.click(DD("tiposEquipo"));
      await page.keyboard.type("sin");
      // Se fuerza el rearmado (como si cambiara el catálogo) y se repinta alternando una opción.
      await page.evaluate(()=>{ document.querySelector('[data-dd-lista="tiposEquipo"]').dataset.firma = "otra"; });
      await page.click(OPCION("tiposEquipo", "-sin-equipos") + " [data-tipo-equipo]");
      await esperarMarcadores(page, 13);
      exigir(await page.evaluate(()=>document.querySelector('[data-dd-lista="tiposEquipo"]').dataset.firma) !== "otra", "no se rearmó");
      exigir(await enVista(page, "tiposEquipo") === '["Sin tipo","Sin equipos"]', "se perdió lo escrito: " + await enVista(page, "tiposEquipo"));
      await page.click(OPCION("tiposEquipo", "-sin-equipos") + " [data-tipo-equipo]");
      await esperarMarcadores(page, 15);
    });
    await verificar("v13: «Todas» y «Ninguna» aplican a todas las opciones, como en la tabla (no solo a las que se ven)", async ()=>{
      exigir(await enVista(page, "tiposEquipo") === '["Sin tipo","Sin equipos"]', await enVista(page, "tiposEquipo"));
      await page.click('[data-dd-ninguna="tiposEquipo"]');
      await esperarMarcadores(page, 0);
      exigir(await textoBoton(page, "tiposEquipo") === "Tipos de equipo 0/10", await textoBoton(page, "tiposEquipo"));
      await page.click('[data-dd-todas="tiposEquipo"]');
      await esperarMarcadores(page, 15);
      exigir(await textoBoton(page, "tiposEquipo") === "Tipos de equipo 10/10", await textoBoton(page, "tiposEquipo"));
      await cerrarFiltros(page);
    });
    await verificar("v13: en pantalla completa el buscador filtra y Esc borra, cierra y recién después sale", async ()=>{
      await page.click(BOTON_COMPLETA);
      await page.waitForSelector(COMPLETA);
      await page.click(ALTERNAR("barra"));
      await page.click(DD("redes"));
      exigir(await foco(page) === "buscar:redes", "foco: " + await foco(page));
      await page.keyboard.type("cam");
      exigir(await enVista(page, "redes") === '["Red Cámaras"]', await enVista(page, "redes"));
      await page.keyboard.press("Escape");
      exigir(await page.inputValue(BUSCAR("redes")) === "" && await page.locator(DD_PANEL("redes")).isVisible(), "el primer Esc no borró o cerró");
      await page.keyboard.press("Escape");
      exigir(await page.locator(DD_PANEL("redes")).isHidden() && await cuenta(page, COMPLETA) === 1, "el segundo Esc no cerró o salió de la pantalla completa");
      await page.click(BOTON_COMPLETA);
      await page.waitForFunction(()=>!document.querySelector(".inventario-tecnologico-mapa-vista.inventario-tecnologico-mapa-completa"), null, { timeout: 4000 });
    });
    await verificar("sin errores de JavaScript (buscador de los desplegables)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias(), { viewport: { width: 390, height: 844 }, tactil: true });
    await irAlMapa(page);
    await verificar("v13 en un celular táctil: al abrir no se enfoca el buscador (no saca el teclado), pero filtra al escribir y cabe en la pantalla", async ()=>{
      exigir(await page.evaluate(()=>matchMedia("(pointer: coarse)").matches), "el contexto no es táctil");
      await page.tap(".inventario-tecnologico-mapa-filtros-resumen");
      await page.tap(DD("tiposEquipo"));
      await page.waitForSelector(DD_PANEL("tiposEquipo"), { state: "visible", timeout: 3000 });
      exigir(await foco(page) !== "buscar:tiposEquipo", "se enfocó el buscador");
      await page.tap(BUSCAR("tiposEquipo"));
      await page.keyboard.type("est");
      exigir(await enVista(page, "tiposEquipo") === '["Estación"]', await enVista(page, "tiposEquipo"));
      const caja = await page.locator(DD_PANEL("tiposEquipo")).boundingBox();
      exigir(caja && caja.x >= 0 && caja.x + caja.width <= 390, "se sale: " + JSON.stringify(caja));
      exigir(await page.evaluate(()=>document.documentElement.scrollWidth) <= 390, "scroll horizontal");
      await captura(page, "v13-celular-buscador.png");
    });
    await verificar("sin errores de JavaScript (buscador en el celular)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture());
    await page.waitForSelector("#inventario-tecnologico-tbody-activos tr");
    const opcionesTipo = ()=>page.locator('.inventario-tecnologico-filter-opt[data-filtro-opt-campo="tipo"]').evaluateAll(l=>l.filter(o=>(o.closest(".inventario-tecnologico-filtro-fila") || o).style.display !== "none").map(o=>o.dataset.filtroOptValor));
    await verificar("v13 tabla: el buscador del filtro de Tipo no distingue mayúsculas ni tildes; sin coincidencias avisa", async ()=>{
      await page.hover('[data-filtro-btn="tipo"]');
      await page.waitForSelector('[data-filtro-buscar="tipo"]', { state: "visible", timeout: 3000 });
      await page.fill('[data-filtro-buscar="tipo"]', "LAPTÓP");
      exigir(JSON.stringify(await opcionesTipo()) === '["Laptop"]', JSON.stringify(await opcionesTipo()));
      await page.fill('[data-filtro-buscar="tipo"]', "xyz");
      exigir(JSON.stringify(await opcionesTipo()) === "[]", JSON.stringify(await opcionesTipo()));
      const aviso = page.locator('[data-filtro-vacio="tipo"]');
      exigir(await aviso.isVisible() && await aviso.textContent() === "Ninguna coincide con «xyz».", "aviso: " + await aviso.textContent());
      await page.fill('[data-filtro-buscar="tipo"]', "");
      exigir((await opcionesTipo()).length === 3 && await aviso.isHidden(), "no volvieron todas");
      exigir(await page.locator("#inventario-tecnologico-tbody-activos tr").count() === 3, "el buscador filtró la tabla");
    });
    await verificar("sin errores de JavaScript (buscador de la tabla)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture(), { viewport: { width: 390, height: 844 } });
    await page.waitForSelector("#inventario-tecnologico-tbody-activos tr");
    // En pantalla angosta la fila no muestra el tag: se mira su data-id.
    const ids = ()=>page.locator("#inventario-tecnologico-tbody-activos tr[data-id]").evaluateAll(l=>l.map(tr=>Number(tr.dataset.id)));
    const buscar = async (q, esperado)=>{
      await page.fill("#inventario-tecnologico-f-texto", q);
      const t = JSON.stringify(await ids());
      exigir(t === JSON.stringify(esperado), `«${q}»: ${t} — ${(await page.locator("#inventario-tecnologico-tbody-activos").innerText()).replace(/\s+/g, " ").slice(0, 300)}`);
    };
    await verificar("§4: en pantalla angosta la búsqueda general busca en todo (serie, marca, modelo), como en la ancha", async ()=>{
      exigir(await page.evaluate(()=>matchMedia("(max-width:720px)").matches), "no está angosta");
      await buscar("SN-A2", [2]);
      await buscar("cambium", [2]);
      await buscar("24MK600", [3]);
      await buscar("Laptop", [1]);
      await buscar("", [1, 2, 3]);
    });
    await verificar("sin errores de JavaScript (búsqueda angosta)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

// ------------------------------------------------------------------ v14 (3.8): una línea por tramo y clase, con franjas por red
// Como en la base real (30-sep y 1-oct): entre el Data Center y la Torre
// principal, 11 enlaces por cable (9 de CCTV, 1 de Red Oficina y 1 de AQ1);
// de la Torre principal al Lote 9 y a Intensivo, 2 radioenlaces cada uno. Para
// probar dos clases en el mismo tramo, además, una fibra al Data Center.
const REDES_FRANJAS = [
  { id:2, nombre:"CCTV", color:"#fbff00", orden:10, activa:true },
  { id:3, nombre:"Red Oficina", color:"#007eb2", orden:20, activa:true },
  { id:4, nombre:"AQ1", color:"#ff0000", orden:30, activa:true },
];
function fixtureFranjas(){
  const fx = fixture({ red007: true, red008: true });
  const u = (id, nombre, tipo, lat, lng)=>({ id, nombre, tipo, lat, lng, direccion:null, notas:null, fotos:[], activa:true });
  fx.tablas.ubicaciones = [
    u(70, "Data Center", "oficina", -2.2000, -79.9000), u(71, "Torre principal", "torre", -2.2025, -79.9035),
    u(72, "Torre principal del Lote 9", "torre", -2.2300, -79.9300), u(73, "Intensivo", "otro", -2.1800, -79.9300),
  ];
  // Sin tipo, para que la base de prueba no les arme el nombre (así los tooltips se leen fácil).
  const e = (id, ubicacion_id, nombre, servidor_id, red_id, tipo, medio = null)=>({ id, ubicacion_id, nombre, modelo:null, activo_id:null, notas:null, servidor_id, banda:null, frecuencia_mhz:null, tipo_equipo:null, red_id, referencia:null, medio });
  fx.tablas.equipos_radioenlace = [
    e(200, 70, "Router DC", null, 2, "router"),
    ...Array.from({ length: 8 }, (_, i)=>e(201 + i, 71, `Cámara ${i + 1}`, 200, 2, "camara", "cable")),
    e(209, 71, "Switch CCTV", 200, 2, "switch", "cable"),
    e(210, 71, "Switch Oficina", 200, 3, "switch", "cable"),
    e(211, 71, "Switch AQ1", 200, 4, "switch", "cable"),
    e(230, 71, "PTP TP → L9 AQ1", 211, 4, "ptp"), e(231, 72, "PTP L9 ← TP AQ1", 230, 4, "ptp"),
    e(232, 71, "PTP TP → L9 CCTV", 209, 2, "ptp"), e(233, 72, "PTP L9 ← TP CCTV", 232, 2, "ptp"),
    e(240, 71, "PTP TP → INT CCTV", 209, 2, "ptp"), e(241, 73, "PTP INT ← TP CCTV", 240, 2, "ptp"),
    e(242, 71, "PTP TP → INT Oficina", 210, 3, "ptp"), e(243, 73, "PTP INT ← TP Oficina", 242, 3, "ptp"),
    e(250, 71, "Conversor fibra", 200, 3, "otro", "fibra"),
  ];
  fx.tablas.redes = REDES_FRANJAS.map(r=>({ ...r }));
  fx.tablas.atajos_simulacion = [];
  fx.tablas.enlaces_respaldo = [];
  fx.tablas.historial_ubicacion = [];
  return fx;
}
async function escenarioFranjas(browser, base){
  const L = SEL.lineas;
  const GRUPO = (par, clase)=>`${L}[data-grupo="${par}|${clase}"]`;
  const CABLE = GRUPO("70-71", "cable"), FIBRA = GRUPO("70-71", "fibra"), L9 = GRUPO("71-72", "radio"), INT = GRUPO("71-73", "radio");
  // Los dos extremos de cada trazo (el «d» de su path en el SVG) y la distancia entre dos trazos paralelos.
  const extremos = (page, sel)=>page.locator(sel).evaluateAll(l=>l.map(p=>{ const n = (p.getAttribute("d") || "").match(/-?\d+(?:\.\d+)?/g).map(Number); return { red: p.dataset.red ?? null, a: { x:n[0], y:n[1] }, b: { x:n[n.length - 2], y:n[n.length - 1] }, ancho: Number(p.getAttribute("stroke-width")), color: (p.getAttribute("stroke") || "").toLowerCase(), enlaces: Number(p.dataset.enlaces), cliente: Number(p.dataset.clienteId) }; }));
  const distancia = (s, t)=>{ const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y; return Math.abs(dx * (t.a.y - s.a.y) - dy * (t.a.x - s.a.x)) / Math.hypot(dx, dy); };
  // Con el grosor en 3× las franjas miden 5,4 px: el mouse cae en la que se apunta.
  const grosor = async (page, k)=>{ await page.fill("#inventario-tecnologico-mapa-grosor", String(k)); await page.dispatchEvent("#inventario-tecnologico-mapa-grosor", "change"); };
  const tooltip = async (page, sel)=>{
    await page.hover(sel, { timeout: 5000 });
    await page.waitForSelector(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-grupo", { timeout: 3000 });
    const t = await page.locator(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-grupo").last().innerText();
    await page.mouse.move(5, 5);
    return t;
  };
  const acercar = async (page, zoom)=>{
    await mapaQuieto(page);
    await page.evaluate(async z=>{ const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual(); m.setView([-2.20125, -79.90175], z, { animate: false }); }, zoom);
    await mapaQuieto(page);
  };
  const { context, page, errores } = await abrirApp(browser, base, fixtureFranjas());
  await irAlMapa(page);
  await acercar(page, 17);
  await verificar("3.8: sin colorear, los enlaces del mismo tramo y clase van en una sola línea (cable 11, radio 2 y 2); la fibra, al lado del cable", async ()=>{
    await esperarCuenta(page, L, 4, "líneas");
    const [cable] = await extremos(page, CABLE), [fibra] = await extremos(page, FIBRA);
    exigir(cable.enlaces === 11 && (await extremos(page, L9))[0].enlaces === 2 && (await extremos(page, INT))[0].enlaces === 2, "enlaces por línea");
    exigir(await cuenta(page, `${L}.inventario-tecnologico-mapa-linea-grupo`) === 3, "las de varios enlaces llevan su clase");
    exigir(await cuenta(page, `${L}.inventario-tecnologico-mapa-linea-franja`) === 0, "franjas sin colorear");
    const d = distancia(cable, fibra);
    exigir(Math.abs(d - 5.25) < 0.6, "cable y fibra, lado a lado (3 + 2 + 3,5 px): " + d.toFixed(2));
    exigir(cable.cliente === 201, "el clic va al primero (Cámara 1): " + cable.cliente);
    await captura(page, "v14-tramos-sin-colorear.png");
  });
  await verificar("3.8: el tooltip de la línea agrupada dice cuántos son, entre qué ubicaciones, cuántos de cada red, cuáles y qué elige el clic", async ()=>{
    const t = await tooltip(page, CABLE);
    for(const re of [/11 enlaces por cable entre Data Center y Torre principal · \d+ m/, /9 de CCTV, 1 de Red Oficina, 1 de AQ1/, /Cámara 1 ← Router DC/, /y 5 más/, /Clic: elige «Cámara 1»/]) exigir(re.test(t), `falta ${re}: ${t.replace(/\s+/g, " ")}`);
    const etiqueta = await page.getAttribute(CABLE, "aria-label");
    exigir(/11 enlaces por cable/.test(etiqueta) && /Clic: elige «Cámara 1»/.test(etiqueta), "aria-label: " + etiqueta);
    const r = await tooltip(page, L9);
    exigir(/2 enlaces inalámbricos entre Torre principal y Torre principal del Lote 9/.test(r) && /1 de CCTV, 1 de AQ1/.test(r), r.replace(/\s+/g, " "));
  });
  await verificar("3.8: un tramo de un solo enlace sigue como antes (su tooltip de siempre, sin «grupo»)", async ()=>{
    exigir(!(await page.locator(FIBRA).evaluate(p=>p.classList.contains("inventario-tecnologico-mapa-linea-grupo"))), "la fibra quedó como grupo");
    exigir(/^Conversor fibra ← Router DC · \d+ m — por fibra óptica$/.test(await page.getAttribute(FIBRA, "aria-label")), await page.getAttribute(FIBRA, "aria-label"));
  });
  await verificar("3.8: el clic en la línea agrupada elige el primero", async ()=>{
    await page.click(CABLE);
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="201"].inventario-tecnologico-mapa-equipo-sel`, { timeout: 4000 });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-equipo-sel"), null, { timeout: 4000 });
    await acercar(page, 17);
  });
  await page.click("#inventario-tecnologico-mapa-color-red");
  await verificar("3.8: al colorear por red, una franja por red, lado a lado, en el orden de las redes y con su color", async ()=>{
    await esperarCuenta(page, `${CABLE}.inventario-tecnologico-mapa-linea-franja`, 3, "franjas del cable");
    const cable = await extremos(page, CABLE);
    exigir(JSON.stringify(cable.map(x=>x.red)) === '["2","3","4"]', "orden: " + JSON.stringify(cable.map(x=>x.red)));
    exigir(JSON.stringify(cable.map(x=>x.color)) === '["#fbff00","#007eb2","#ff0000"]', "colores: " + JSON.stringify(cable.map(x=>x.color)));
    exigir(cable.every(x=>Math.abs(x.ancho - 1.8) < 0.01), "ancho: " + cable.map(x=>x.ancho));
    exigir(JSON.stringify(cable.map(x=>x.enlaces)) === "[9,1,1]" && JSON.stringify(cable.map(x=>x.cliente)) === "[201,210,211]", "enlaces y clic por franja: " + JSON.stringify(cable.map(x=>[x.enlaces, x.cliente])));
    exigir(Math.abs(distancia(cable[0], cable[1]) - 1.8) < 0.3 && Math.abs(distancia(cable[0], cable[2]) - 3.6) < 0.3, "separación: " + [distancia(cable[0], cable[1]), distancia(cable[0], cable[2])].map(x=>x.toFixed(2)));
    const l9 = await extremos(page, L9);
    exigir(JSON.stringify(l9.map(x=>[x.red, x.color, x.ancho])) === '[["2","#fbff00",3],["4","#ff0000",3]]', "Lote 9: " + JSON.stringify(l9.map(x=>[x.red, x.color, x.ancho])));
    const int = await extremos(page, INT);
    exigir(JSON.stringify(int.map(x=>x.red)) === '["2","3"]', "Intensivo: " + JSON.stringify(int.map(x=>x.red)));
    const [fibra] = await extremos(page, FIBRA);
    exigir(fibra.red === "3" && fibra.color === "#007eb2" && fibra.ancho === 3.5 && !(await page.locator(FIBRA).evaluate(p=>p.classList.contains("inventario-tecnologico-mapa-linea-franja"))), "fibra: " + JSON.stringify(fibra));
    exigir(Math.abs(distancia(cable[1], fibra) - 3.7 - 2.75) < 0.6, "el haz de cable y la fibra, lado a lado: " + distancia(cable[1], fibra).toFixed(2));
    const leyenda = await page.locator("#inventario-tecnologico-mapa-leyenda-redes").textContent(); // la leyenda está plegada
    exigir(/Varias redes en un tramo: una franja por red/.test(leyenda), "leyenda: " + leyenda);
    await captura(page, "v14-franjas.png");
  });
  await verificar("3.8: con las franjas finas (1×), el tooltip de la que quede bajo el mouse trae el total por red", async ()=>{
    const t = await page.locator(`${CABLE}[data-red="2"]`).hover({ force: true }).then(async ()=>{
      await page.waitForSelector(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-grupo", { timeout: 3000 });
      return page.locator(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-grupo").last().innerText();
    });
    await page.mouse.move(5, 5);
    exigir(/^(CCTV|Red Oficina|AQ1): \d+ de 11 enlaces por cable/.test(t) && /En total: 9 de CCTV, 1 de Red Oficina, 1 de AQ1/.test(t), t.replace(/\s+/g, " "));
  });
  await verificar("3.8: el tooltip de cada franja dice su red, cuántos lleva de ese tramo, el total por red y su primer enlace", async ()=>{
    await grosor(page, 3);
    await page.waitForFunction(sel=>Number(document.querySelector(sel)?.getAttribute("stroke-width")) === 5.4, `${CABLE}[data-red="2"]`, { timeout: 4000 });
    const t = await tooltip(page, `${CABLE}[data-red="2"]`);
    for(const re of [/CCTV: 9 de 11 enlaces por cable/, /entre Data Center y Torre principal/, /En total: 9 de CCTV, 1 de Red Oficina, 1 de AQ1/, /Cámara 1 ← Router DC/, /y 3 más/, /Clic: elige «Cámara 1»/]) exigir(re.test(t), `falta ${re}: ${t.replace(/\s+/g, " ")}`);
    exigir(/^Red Oficina: 1 de 11 enlaces por cable[\s\S]*Switch Oficina ← Router DC[\s\S]*Clic: elige «Switch Oficina»/.test(await tooltip(page, `${CABLE}[data-red="3"]`)), "Red Oficina");
    exigir(/^AQ1: 1 de 11 enlaces por cable[\s\S]*Clic: elige «Switch AQ1»/.test(await tooltip(page, `${CABLE}[data-red="4"]`)), "AQ1");
  });
  await verificar("3.8: el clic en una franja elige el primer enlace de esa red", async ()=>{
    await page.click(`${CABLE}[data-red="3"]`);
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="210"].inventario-tecnologico-mapa-equipo-sel`, { timeout: 4000 });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-equipo-sel"), null, { timeout: 4000 });
    await grosor(page, 1);
    await page.waitForFunction(sel=>Number(document.querySelector(sel)?.getAttribute("stroke-width")) === 1.8, `${CABLE}[data-red="2"]`, { timeout: 4000 });
    await acercar(page, 17);
  });
  await verificar("3.8: al hacer zoom las franjas quedan a la misma distancia en píxeles (se corren al proyectar)", async ()=>{
    const antes = await extremos(page, CABLE);
    await acercar(page, 15);
    const despues = await extremos(page, CABLE);
    const largo = s=>Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
    exigir(largo(despues[0]) < largo(antes[0]) / 3, "el zoom no cambió: " + [largo(antes[0]), largo(despues[0])].map(x=>x.toFixed(1)));
    exigir(Math.abs(distancia(despues[0], despues[2]) - 3.6) < 0.3, "separación a otro zoom: " + distancia(despues[0], despues[2]).toFixed(2));
    await acercar(page, 17);
  });
  await verificar("3.8: al apagar una red, su franja sale de la línea; con una sola red queda la línea entera de su color", async ()=>{
    await clicFiltro(page, SEL.chip("red", "4"));
    await esperarCuenta(page, `${CABLE}.inventario-tecnologico-mapa-linea-franja`, 2, "franjas del cable sin AQ1");
    exigir(JSON.stringify((await extremos(page, CABLE)).map(x=>x.red)) === '["2","3"]', JSON.stringify((await extremos(page, CABLE)).map(x=>x.red)));
    const l9 = await extremos(page, L9);
    exigir(l9.length === 1 && l9[0].red === "2" && l9[0].color === "#fbff00" && l9[0].ancho === 5 && l9[0].enlaces === 1, "Lote 9 con CCTV sola: " + JSON.stringify(l9));
    exigir(!(await page.locator(L9).evaluate(p=>p.classList.contains("inventario-tecnologico-mapa-linea-franja"))), "quedó como franja");
    await clicFiltro(page, SEL.chip("red", "4"));
    await esperarCuenta(page, `${CABLE}.inventario-tecnologico-mapa-linea-franja`, 3, "franjas del cable con AQ1 otra vez");
  });
  await verificar("3.8: el camino resaltado sigue enlace por enlace, encima; lo demás del tramo queda atenuado", async ()=>{
    await page.click(`${L9}[data-red="4"]`);
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="231"].inventario-tecnologico-mapa-equipo-sel`, { timeout: 4000 });
    await esperarCuenta(page, SEL.linea("cadena"), 2, "tramos del camino (radio y cable)");
    exigir(await cuenta(page, `${SEL.linea("cadena")}[data-cliente-id="231"]`) === 1 && await cuenta(page, `${SEL.linea("cadena")}[data-cliente-id="211"]`) === 1, "no son PTP L9 ← TP AQ1 y Switch AQ1");
    const cable = await extremos(page, CABLE);
    exigir(cable.reduce((s, x)=>s + x.enlaces, 0) === 10 && JSON.stringify(cable.map(x=>x.red)) === '["2","3"]', "el cable sin el enlace del camino: " + JSON.stringify(cable.map(x=>[x.red, x.enlaces])));
    exigir(await page.locator(CABLE).evaluateAll(l=>l.every(p=>p.classList.contains("inventario-tecnologico-mapa-linea-atenuada"))), "el resto del tramo no quedó atenuado");
    const orden = await page.evaluate(()=>[...document.querySelectorAll("path.inventario-tecnologico-mapa-linea")].map(p=>p.classList.contains("inventario-tecnologico-mapa-linea-cadena") ? "c" : "o").join(""));
    exigir(/^o+c+$/.test(orden), "el camino no quedó encima: " + orden);
    await captura(page, "v14-camino.png");
  });
  await verificar("3.8: la simulación sigue enlace por enlace (sin juntar los que quedan sin conectividad)", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 70, 200);
    await page.click(SEL.simular(200));
    await page.waitForSelector(`${SEL.simular(200)}[aria-pressed="true"]`);
    await esperarCuenta(page, SEL.linea("sinConexion"), 16, "líneas sin conectividad (11 de cable, 4 de radio y la fibra)");
    exigir(await cuenta(page, `${L}.inventario-tecnologico-mapa-linea-grupo`) === 0 && await cuenta(page, `${L}.inventario-tecnologico-mapa-linea-franja`) === 0, "se juntaron en la simulación");
    await page.click(`${SEL.panel} [data-accion="restablecer-simulacion"]`);
    await esperarCuenta(page, SEL.linea("sinConexion"), 0);
    await page.click("#inventario-tecnologico-mapa-simulacion");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    await esperarCuenta(page, `${CABLE}.inventario-tecnologico-mapa-linea-franja`, 3, "las franjas al salir de la simulación");
  });
  await verificar("3.8: con el grosor en 0 no se dibujan ni las líneas agrupadas ni sus franjas (ni sus halos)", async ()=>{
    await grosor(page, 0);
    await esperarCuenta(page, L, 0, "líneas en 0");
    exigir(await page.evaluate(()=>document.querySelectorAll(".leaflet-overlay-pane path").length) === 0, "quedaron halos");
    await grosor(page, 1);
    await esperarCuenta(page, `${CABLE}.inventario-tecnologico-mapa-linea-franja`, 3, "franjas en 1×");
  });
  await verificar("3.8: el grosor también afina o engrosa las franjas", async ()=>{
    await grosor(page, 2);
    await page.waitForFunction(sel=>Number(document.querySelector(sel)?.getAttribute("stroke-width")) === 3.6, `${CABLE}[data-red="2"]`, { timeout: 4000 });
    const cable = await extremos(page, CABLE);
    exigir(Math.abs(distancia(cable[0], cable[2]) - 7.2) < 0.4, "separación en 2×: " + distancia(cable[0], cable[2]).toFixed(2));
    await grosor(page, 1);
    await page.click("#inventario-tecnologico-mapa-color-red");
    await esperarCuenta(page, `${L}.inventario-tecnologico-mapa-linea-franja`, 0, "sin colorear, sin franjas");
  });
  await verificar("sin errores de JavaScript (líneas agrupadas y franjas)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ v15 (3.10 y 3.9): tooltip de las ubicaciones y cobertura de los AP (013)
const COBERTURA = (id, forma = null)=>`path.inventario-tecnologico-mapa-cobertura[data-equipo-id="${id}"]${forma ? `[data-cobertura="${forma}"]` : ""}`;
const TT_UBIC = ".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-ubicacion";
function fixtureCobertura({ m013 = true, conCobertura = true, red007 = true } = {}){
  const fx = fixture({ red007, red008: red007 });
  fx.m013 = m013;
  if(m013){
    for(const e of fx.tablas.equipos_radioenlace) Object.assign(e, { radio_cobertura_m: null, azimut_cobertura: null, apertura_cobertura: null });
    for(const t of fx.tablas.tipos_equipo_red || []) t.icono_svg = null;
    if(conCobertura){
      const eq = id=>fx.tablas.equipos_radioenlace.find(e=>e.id === id);
      Object.assign(eq(11), { radio_cobertura_m: 800 });                                                // AP Sector Norte: círculo
      Object.assign(eq(21), { radio_cobertura_m: 600, azimut_cobertura: 135, apertura_cobertura: 90 }); // AP Santa Ana: sector hacia el SE
    }
  }
  return fx;
}
// Las filas de la tablita del tooltip abierto: [etiqueta, cantidad, ¿tiene ícono?].
const filasTooltip = (page, cual = "")=>page.locator(`${TT_UBIC} table${cual}`).last().evaluate(t=>[...t.querySelectorAll("tr")].map(tr=>[tr.querySelector(".inventario-tecnologico-mapa-tt-etq").textContent, Number(tr.querySelector(".inventario-tecnologico-mapa-tt-n").textContent), !!tr.querySelector("svg, .inventario-tecnologico-mapa-tt-punto")]));
async function tooltipDe(page, ubicacionId, { teclado = false } = {}){
  const sel = `.leaflet-marker-icon[data-ubicacion-id="${ubicacionId}"]`;
  if(teclado) await page.focus(sel); else await page.hover(sel);
  await page.waitForSelector(".leaflet-tooltip", { timeout: 3000 });
  return page.locator(".leaflet-tooltip").last();
}
async function soltarTooltip(page){ await page.mouse.move(2, 2); await page.evaluate(()=>document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.waitForFunction(()=>!document.querySelector(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-ubicacion"), null, { timeout: 3000 }).catch(()=>{}); }
async function elegirModoTooltip(page, modo){
  await page.selectOption("#inventario-tecnologico-mapa-tooltip-modo", modo);
  await page.waitForFunction(m=>localStorage.getItem("inventario-tecnologico-mapa-tooltip") === m, modo, { timeout: 3000 });
}
async function escenarioTooltip(browser, base){
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureCobertura());
    await irAlMapa(page);
    await verificar("3.10: «Al pasar el mouse» está junto al grosor y arranca en «Tipos de equipo»", async ()=>{
      exigir(await page.locator("#inventario-tecnologico-mapa-tooltip-modo").isVisible(), "no se ve el selector");
      exigir(await page.inputValue("#inventario-tecnologico-mapa-tooltip-modo") === "tipos", await page.inputValue("#inventario-tecnologico-mapa-tooltip-modo"));
      const op = await page.locator("#inventario-tecnologico-mapa-tooltip-modo option").allTextContents();
      exigir(JSON.stringify(op) === '["Solo el nombre","Tipos de equipo","Redes","Tipos y redes"]', JSON.stringify(op));
    });
    await verificar("3.10: al pasar el mouse por una ubicación: su nombre, su tipo y cuántos equipos hay de cada tipo, con su ícono", async ()=>{
      const tt = await tooltipDe(page, 3);
      exigir(/Oficina Centro/.test(await tt.innerText()) && /Oficina/.test(await tt.locator(".inventario-tecnologico-mapa-tt-tipo").innerText()), await tt.innerText());
      const filas = await filasTooltip(page);
      exigir(JSON.stringify(filas) === '[["Router",1,true],["Punto a Punto",1,true],["Estación",1,true]]', JSON.stringify(filas));
      exigir(/1 activo que no es equipo de red/.test(await tt.innerText()), "falta el activo que no es de red: " + await tt.innerText());
      await captura(page, "v15-tooltip-tipos.png");
      await soltarTooltip(page);
    });
    await verificar("3.10: también con el foco del teclado en la burbuja (Cerro Azul: tipos en su orden, con sus cantidades)", async ()=>{
      await tooltipDe(page, 1, { teclado: true });
      const filas = await filasTooltip(page);
      exigir(JSON.stringify(filas) === '[["Switch",1,true],["Punto a Punto",2,true],["AP",1,true],["Cámara",2,true]]', JSON.stringify(filas));
      exigir(/AP en Torre Cerro Azul[^:]*: 800 m a la redonda/.test(await page.locator(TT_UBIC).last().innerText()), "sin la cobertura de su AP: " + await page.locator(TT_UBIC).last().innerText());
      await soltarTooltip(page);
    });
    await verificar("3.10: cerca del borde de arriba del mapa, la tablita se abre hacia abajo, no se corta y tapa lo que queda debajo", async ()=>{
      await exponerMapa(page);
      await page.evaluate(()=>{ const m = window.__mapaActual(); const p = m.latLngToContainerPoint([-2.1735, -79.9587]); m.panBy([0, p.y - 45], { animate: false }); });
      await mapaQuieto(page);
      await tooltipDe(page, 1, { teclado: true });
      const dentro = await page.evaluate(()=>{
        const t = [...document.querySelectorAll(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-ubicacion")].pop().getBoundingClientRect();
        const c = document.getElementById("inventario-tecnologico-mapa-canvas").getBoundingClientRect();
        return { ok: t.top >= c.top && t.bottom <= c.bottom && t.left >= c.left && t.right <= c.right, abajo: document.querySelector(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-ubicacion").classList.contains("leaflet-tooltip-bottom"), t: [t.left, t.top, t.right, t.bottom].map(Math.round), c: [c.left, c.top, c.right, c.bottom].map(Math.round) };
      });
      exigir(dentro.ok && dentro.abajo, "se corta o no se abrió hacia abajo: " + JSON.stringify(dentro));
      // Opaca y encima de la etiqueta del AP agrupado que queda debajo (Leaflet
      // deja los tooltips al 90 % y la etiqueta se veía a través).
      const encima = await page.evaluate(()=>{
        const tt = [...document.querySelectorAll(".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-ubicacion")].pop();
        const t = tt.getBoundingClientRect();
        const etq = [...document.querySelectorAll(".inventario-tecnologico-mapa-icono-agrupado > div, .inventario-tecnologico-mapa-etiqueta-enlace")].map(e=>e.getBoundingClientRect())
          .find(r=>r.left < t.right && r.right > t.left && r.top < t.bottom && r.bottom > t.top);
        if(!etq) return { solapa: false, t: [t.left, t.top, t.right, t.bottom].map(Math.round), etiquetas: [...document.querySelectorAll(".inventario-tecnologico-mapa-icono-agrupado > div")].map(e=>{ const r = e.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map(Math.round); }) };
        const x = (Math.max(etq.left, t.left) + Math.min(etq.right, t.right)) / 2, y = (Math.max(etq.top, t.top) + Math.min(etq.bottom, t.bottom)) / 2;
        // Los tooltips de Leaflet no reciben el mouse (pointer-events: none) y
        // elementFromPoint los salta: se encienden un instante para ver quién
        // queda encima en ese punto.
        const antes = tt.style.pointerEvents;
        tt.style.pointerEvents = "auto";
        const arriba = tt.contains(document.elementFromPoint(x, y));
        tt.style.pointerEvents = antes;
        return { solapa: true, opacidad: getComputedStyle(tt).opacity, arriba };
      });
      exigir(encima.solapa, "en este fixture la etiqueta del AP agrupado queda debajo de la tablita: no se pudo probar " + JSON.stringify(encima));
      exigir(encima.opacidad === "1" && encima.arriba, "la etiqueta se ve a través o queda encima: " + JSON.stringify(encima));
      await captura(page, "v15-tooltip-borde.png");
      await soltarTooltip(page);
    });
    await verificar("3.10: «Redes»: cuántos equipos de cada red (con su color); «Tipos y redes», las dos tablitas", async ()=>{
      await elegirModoTooltip(page, "redes");
      await tooltipDe(page, 1, { teclado: true });
      const redes = await filasTooltip(page);
      exigir(JSON.stringify(redes) === '[["Red Administrativa",3,true],["Red Cámaras",3,true]]', JSON.stringify(redes));
      await soltarTooltip(page);
      await elegirModoTooltip(page, "ambos");
      await tooltipDe(page, 1, { teclado: true });
      exigir(await page.locator(`${TT_UBIC} table`).count() === 2, "no son dos tablitas");
      exigir(JSON.stringify(await filasTooltip(page, ".inventario-tecnologico-mapa-tt-tabla-redes")) === '[["Red Administrativa",3,true],["Red Cámaras",3,true]]', "redes en «ambos»");
      await captura(page, "v15-tooltip-ambos.png");
      await soltarTooltip(page);
    });
    await verificar("3.10: «Solo el nombre» deja el tooltip de siempre", async ()=>{
      await elegirModoTooltip(page, "nombre");
      const tt = await tooltipDe(page, 3);
      exigir((await tt.innerText()).trim() === "Oficina Centro" && await page.locator(TT_UBIC).count() === 0, await tt.innerText());
      await soltarTooltip(page);
      await elegirModoTooltip(page, "tipos");
    });
    await verificar("3.10: cuenta todo lo que hay, aunque los filtros oculten algo, y avisa cuántos oculta", async ()=>{
      await clicFiltro(page, SEL.chip("red", "2"));
      await tooltipDe(page, 1, { teclado: true });
      const filas = await filasTooltip(page);
      exigir(JSON.stringify(filas) === '[["Switch",1,true],["Punto a Punto",2,true],["AP",1,true],["Cámara",2,true]]', "las cuentas cambiaron con el filtro: " + JSON.stringify(filas));
      exigir(/3 ocultos por los filtros/.test(await page.locator(TT_UBIC).last().innerText()), "sin el aviso: " + await page.locator(TT_UBIC).last().innerText());
      await soltarTooltip(page);
      await clicFiltro(page, SEL.chip("red", "2"));
    });
    await verificar("3.10: el modo elegido se recuerda en este navegador (al volver a abrir la app)", async ()=>{
      await elegirModoTooltip(page, "ambos");
      await page.reload();
      await page.waitForSelector(".inventario-tecnologico-topbar", { timeout: 10000 });
      await irAlMapa(page);
      exigir(await page.inputValue("#inventario-tecnologico-mapa-tooltip-modo") === "ambos", await page.inputValue("#inventario-tecnologico-mapa-tooltip-modo"));
      await elegirModoTooltip(page, "tipos");
    });
    await verificar("sin errores de JavaScript (tooltip de las ubicaciones)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureVacias());
    await irAlMapa(page);
    await verificar("3.10: una ubicación sin equipos de red lo dice", async ()=>{
      const tt = await tooltipDe(page, 61);
      exigir(/Comedor/.test(await tt.innerText()) && /Sin equipos de red/.test(await tt.innerText()), await tt.innerText());
      await soltarTooltip(page);
    });
    await verificar("sin errores de JavaScript (tooltip de una ubicación vacía)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixtureCobertura({ m013: false }));
    await irAlMapa(page);
    await verificar("3.10 sin la 013: el tooltip funciona con los íconos de fábrica; no hay cobertura ni íconos para editar", async ()=>{
      await tooltipDe(page, 3);
      exigir(JSON.stringify(await filasTooltip(page)) === '[["Router",1,true],["Punto a Punto",1,true],["Estación",1,true]]', JSON.stringify(await filasTooltip(page)));
      await soltarTooltip(page);
      exigir(await page.locator("#inventario-tecnologico-mapa-cobertura").isHidden() && await cuenta(page, "path.inventario-tecnologico-mapa-cobertura") === 0, "hay cobertura");
      await page.click("#inventario-tecnologico-mapa-redes-tipos");
      await page.waitForSelector('.inventario-tecnologico-catalogo-fila[data-tipo-valor="router"]');
      exigir(await cuenta(page, ".inventario-tecnologico-tipo-icono-btn") === 0, "ofrece cambiar los íconos sin la 013");
      await cerrarModales(page);
    });
    await verificar("3.9 sin la 013: «Editar equipo de red» de un AP no trae los campos de cobertura y guarda como antes", async ()=>{
      await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
      await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="11"]`);
      await page.waitForSelector("#inventario-tecnologico-equipo-servidor-boton");
      exigir(await cuenta(page, "#inventario-tecnologico-equipo-cobertura") === 0, "trae la cobertura sin la 013");
      await page.fill("#inventario-tecnologico-equipo-referencia", "Sector Norte");
      await page.click("#inventario-tecnologico-equipo-guardar");
      await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-equipo-guardar"), null, { timeout: 5000 });
      const fila = (await db(page, "equipos_radioenlace")).find(e=>e.id === 11);
      exigir(fila.referencia === "Sector Norte" && !("radio_cobertura_m" in fila), "no guardó o mandó la cobertura: " + JSON.stringify(fila));
    });
    await verificar("sin errores de JavaScript (tooltip sin la 013)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture());
    await irAlMapa(page);
    await verificar("3.10 sin la 007: no hay selector y el tooltip es solo el nombre", async ()=>{
      exigir(await page.locator("#inventario-tecnologico-mapa-tooltip-modo-grupo").isHidden(), "se ve el selector");
      const tt = await tooltipDe(page, 3);
      exigir((await tt.innerText()).trim() === "Oficina Centro", await tt.innerText());
      await soltarTooltip(page);
    });
    await verificar("sin errores de JavaScript (tooltip sin la 007)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    // Un celular de verdad (táctil, sin mouse): no hay «pasar el mouse».
    const { context, page, errores } = await abrirApp(browser, base, fixtureCobertura(), { viewport: { width: 390, height: 844 }, tactil: true });
    await irAlMapa(page);
    await verificar("3.10 en un celular (sin mouse): no hay selector; el toque elige la ubicación y el tooltip queda con el nombre, como antes", async ()=>{
      // En el celular «Filtros y capas» arranca plegado: se mira el propio grupo, no si se ve.
      exigir(await page.locator("#inventario-tecnologico-mapa-tooltip-modo-grupo").evaluate(e=>e.hidden), "«Al pasar el mouse» no está escondido en el celular");
      await exponerMapa(page);
      await mapaQuieto(page);
      // Una burbuja que no tape otra cosa (en el celular, la etiqueta del AP agrupado tapa algunas).
      const id = await page.evaluate(()=>[...document.querySelectorAll(".leaflet-marker-icon[data-ubicacion-id]")].map(m=>{
        const r = m.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        return { id: m.dataset.ubicacionId, libre: x > 0 && y > 0 && x < innerWidth && y < innerHeight && m.contains(document.elementFromPoint(x, y)) };
      }).find(m=>m.libre)?.id);
      exigir(id, "ninguna burbuja libre para tocar");
      await page.tap(`.leaflet-marker-icon[data-ubicacion-id="${id}"]`);
      await page.waitForSelector(`${SEL.panel} [data-accion="volver-resumen"]`, { timeout: 3000 });
      await page.waitForTimeout(300);
      exigir(await cuenta(page, ".leaflet-tooltip.inventario-tecnologico-mapa-tooltip-ubicacion") === 0, "salió la tablita con el toque");
      const nombre = await page.evaluate(i=>document.querySelector(`.leaflet-marker-icon[data-ubicacion-id="${i}"]`).getAttribute("aria-label"), id);
      const tt = page.locator(".leaflet-tooltip");
      exigir(await tt.count() === 0 || (await tt.last().innerText()).trim() === nombre, "el tooltip no es solo el nombre: " + (await tt.count() ? await tt.last().innerText() : ""));
      await captura(page, "v15-tooltip-celular.png");
    });
    await verificar("sin errores de JavaScript (tooltip en el celular)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

// El mapa puede empezar a moverse un cuadro después (moverVista): se espera a
// que el centro y el zoom queden iguales un rato, sin animación.
async function mapaEstable(page){
  await exponerMapa(page);
  await page.evaluate(()=>{ window.__vistaAnterior = null; });
  await page.waitForFunction(()=>{
    const m = window.__mapaActual();
    if(!m || m._animatingZoom || (m._panAnim && m._panAnim._inProgress)) return false;
    // Al terminar una animación de zoom, Leaflet quita la escala de las capas un cuadro después.
    if(m.getContainer().classList.contains("leaflet-zoom-anim") || [...m.getContainer().querySelectorAll(".leaflet-pane > svg")].some(s=>/scale\(/.test(s.style.transform))) return false;
    const ahora = JSON.stringify([m.getCenter(), m.getZoom()]);
    const igual = window.__vistaAnterior === ahora;
    window.__vistaAnterior = ahora;
    return igual;
  }, null, { timeout: 6000, polling: 250 });
}
async function escenarioCobertura(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixtureCobertura());
  const UB = { cerroAzul: { lat:-2.1735, lng:-79.9587 }, santaAna: { lat:-2.1839, lng:-79.8756 } };
  // El centro y el radio en píxeles de pantalla, para comparar con la caja del path.
  const enPantalla = (centro, metros, azimut = 90)=>page.evaluate(async ({ centro, metros, azimut })=>{
    const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual();
    const { puntoDestino } = await import("/assets/js/inventario-tecnologico/nucleo/cobertura.js");
    const r = m.getContainer().getBoundingClientRect();
    const c = m.latLngToContainerPoint([centro.lat, centro.lng]);
    const d = puntoDestino(centro, azimut, metros);
    const p = m.latLngToContainerPoint([d.lat, d.lng]);
    return { x: r.left + c.x, y: r.top + c.y, radio: Math.hypot(p.x - c.x, p.y - c.y), destino: { x: r.left + p.x, y: r.top + p.y } };
  }, { centro, metros, azimut });
  const caja = sel=>page.locator(sel).evaluate(p=>{ const r = p.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const trazo = sel=>page.locator(sel).evaluate(p=>({ stroke: (p.getAttribute("stroke") || "").toLowerCase(), dash: p.getAttribute("stroke-dasharray"), atenuada: p.classList.contains("inventario-tecnologico-mapa-cobertura-atenuada"), sin: p.dataset.sinServicio || null }));
  await irAlMapa(page);
  await verificar("3.9: «Cobertura de los AP» aparece (y encendida) porque hay AP con cobertura; un círculo y un sector", async ()=>{
    exigir(await page.locator("#inventario-tecnologico-mapa-cobertura").isVisible() && await page.getAttribute("#inventario-tecnologico-mapa-cobertura", "aria-pressed") === "true", "sin el chip encendido");
    await esperarCuenta(page, "path.inventario-tecnologico-mapa-cobertura", 2, "áreas de cobertura");
    exigir(await cuenta(page, COBERTURA(11, "circulo")) === 1 && await cuenta(page, COBERTURA(21, "sector")) === 1, "no son el círculo del AP Sector Norte y el sector del AP Santa Ana");
    exigir(await page.locator("#inventario-tecnologico-mapa-leyenda-cobertura").evaluate(n=>!n.hidden), "sin la leyenda");
    await exponerMapa(page);
    await page.evaluate(()=>window.__mapaActual().setView([-2.178, -79.917], 13, { animate: false }));
    await mapaEstable(page);
    await captura(page, "v15-cobertura.png");
  });
  await verificar("3.9: el círculo mide su radio (800 m) en el mapa y va centrado en su ubicación", async ()=>{
    await mapaEstable(page);
    const c = await enPantalla(UB.cerroAzul, 800);
    const b = await caja(COBERTURA(11));
    exigir(Math.abs(b.w / 2 - c.radio) < 3 && Math.abs(b.h / 2 - c.radio) < 3, `radio ${c.radio.toFixed(1)} px, caja ${b.w.toFixed(1)}×${b.h.toFixed(1)}`);
    exigir(Math.abs(b.x + b.w / 2 - c.x) < 3 && Math.abs(b.y + b.h / 2 - c.y) < 3, `no está centrado: caja ${JSON.stringify(b)}, centro ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
  });
  await verificar("3.9: el sector (600 m, 90° hacia el SE) es una cuña entre el este y el sur de su ubicación", async ()=>{
    await mapaEstable(page);
    const c = await enPantalla(UB.santaAna, 600);
    const b = await caja(COBERTURA(21));
    exigir(Math.abs(b.x - c.x) < 3 && Math.abs(b.y - c.y) < 3, `la punta no está en la ubicación: caja ${JSON.stringify(b)}, centro ${c.x.toFixed(1)},${c.y.toFixed(1)}`);
    exigir(Math.abs(b.w - c.radio) < 3 && Math.abs(b.h - c.radio) < 3, `no mide el radio: ${b.w.toFixed(1)}×${b.h.toFixed(1)} vs ${c.radio.toFixed(1)}`);
  });
  await verificar("3.9: el tooltip de la cobertura dice de qué AP es (con su nombre automático)", async ()=>{
    await mapaEstable(page);
    const c = await enPantalla(UB.cerroAzul, 800);
    await page.mouse.move(c.x - c.radio * 0.45, c.y - c.radio * 0.45);
    await page.waitForFunction(()=>[...document.querySelectorAll(".leaflet-tooltip")].some(t=>/^AP en Torre Cerro Azul.* · 800 m a la redonda$/.test(t.textContent)), null, { timeout: 3000 });
    await page.mouse.move(2, 2);
    exigir(/^Cobertura de AP en Torre Santa Ana.* · 600 m · sector de 90° hacia el SE \(135°\)$/.test(await page.getAttribute(COBERTURA(21), "aria-label")), await page.getAttribute(COBERTURA(21), "aria-label"));
  });
  await verificar("3.9: un clic dentro de la cobertura sigue al mapa (suelta la selección), no elige el AP", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 2, 21);
    await mapaEstable(page);
    // Dentro de la cuña del AP Santa Ana (que quedó a la vista al elegirlo), hacia el SE a media distancia.
    const { destino } = await enPantalla(UB.santaAna, 300, 135);
    const debajo = await page.evaluate(([x, y])=>{ const el = document.elementFromPoint(x, y); return el ? (el.getAttribute("class") || el.tagName) : ""; }, [destino.x, destino.y]);
    exigir(/mapa-cobertura/.test(debajo), "el clic no cae en la cobertura: " + debajo);
    await page.mouse.click(destino.x, destino.y);
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-equipo-sel"), null, { timeout: 3000 });
  });
  await verificar("3.9: del color de su red al colorear por red; de fábrica, el celeste", async ()=>{
    exigir((await trazo(COBERTURA(11))).stroke === "#007eb2", "sin colorear: " + (await trazo(COBERTURA(11))).stroke);
    await page.click("#inventario-tecnologico-mapa-color-red");
    await page.waitForFunction(sel=>(document.querySelector(sel)?.getAttribute("stroke") || "").toLowerCase() === "#004dab", COBERTURA(11), { timeout: 3000 });
    await page.click("#inventario-tecnologico-mapa-color-red");
  });
  await verificar("3.9: si los filtros ocultan el AP, no se dibuja su cobertura", async ()=>{
    await clicFiltro(page, SEL.chip("tipo-equipo", "ap"));
    await esperarCuenta(page, "path.inventario-tecnologico-mapa-cobertura", 0, "cobertura con los AP ocultos");
    await clicFiltro(page, SEL.chip("tipo-equipo", "ap"));
    await esperarCuenta(page, "path.inventario-tecnologico-mapa-cobertura", 2);
  });
  await verificar("3.9: al elegir un equipo, la cobertura de los AP que no son de su camino queda atenuada", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 4, 40);
    await page.waitForFunction(sel=>document.querySelector(sel)?.classList.contains("inventario-tecnologico-mapa-cobertura-atenuada"), COBERTURA(11), { timeout: 3000 });
    exigir(!(await trazo(COBERTURA(21))).atenuada, "la del AP Santa Ana (de su camino) quedó atenuada");
    exigir(/Cobertura:\s*600 m · sector de 90° hacia el SE \(135°\)/.test(await texto(page, SEL.panel)) === false, "el panel de SM Bodega no debería mostrar cobertura");
  });
  await verificar("3.9: el panel del AP muestra su cobertura", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 2, 21);
    exigir(/Cobertura:\s*600 m · sector de 90° hacia el SE \(135°\)/.test(await texto(page, `${SEL.panel} [data-cobertura-equipo="21"]`)), await texto(page, SEL.panel));
  });
  await verificar("3.9: en la simulación, la cobertura de un AP sin servicio queda gris y punteada", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 10);
    await page.click(SEL.simular(10));
    await page.waitForSelector(`${SEL.simular(10)}[aria-pressed="true"]`);
    await page.waitForFunction(sel=>document.querySelector(sel)?.dataset.sinServicio === "1", COBERTURA(11), { timeout: 3000 });
    const t = await trazo(COBERTURA(11));
    exigir(t.stroke === "#8b9aaa" && t.dash, "no quedó gris y punteada: " + JSON.stringify(t));
    exigir(/sin servicio en la simulación/.test(await page.getAttribute(COBERTURA(11), "aria-label")), "el tooltip no lo dice");
    await page.click(`${SEL.panel} [data-accion="restablecer-simulacion"]`);
    await page.waitForFunction(sel=>!document.querySelector(sel)?.dataset.sinServicio, COBERTURA(11), { timeout: 3000 });
    await page.click("#inventario-tecnologico-mapa-simulacion");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  });
  await verificar("3.9: el chip la apaga y la enciende, y se recuerda en este navegador", async ()=>{
    await page.click("#inventario-tecnologico-mapa-cobertura");
    await esperarCuenta(page, "path.inventario-tecnologico-mapa-cobertura", 0, "con el chip apagado");
    exigir(await page.evaluate(()=>localStorage.getItem("inventario-tecnologico-mapa-cobertura")) === "0", "no se recordó");
    await page.reload();
    await page.waitForSelector(".inventario-tecnologico-topbar", { timeout: 10000 });
    await irAlMapa(page);
    exigir(await page.getAttribute("#inventario-tecnologico-mapa-cobertura", "aria-pressed") === "false" && await cuenta(page, "path.inventario-tecnologico-mapa-cobertura") === 0, "al volver no quedó apagada");
    await page.click("#inventario-tecnologico-mapa-cobertura");
    await esperarCuenta(page, "path.inventario-tecnologico-mapa-cobertura", 2, "al encenderla");
  });
  await verificar("3.9: «Editar equipo de red»: la cobertura aparece para un AP (con lo guardado) y no para un PTP, salvo que lo cambies a AP", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 10);
    await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="10"]`);
    await page.waitForSelector("#inventario-tecnologico-equipo-servidor-boton");
    exigir(await page.locator("#inventario-tecnologico-equipo-cobertura").isHidden(), "se ve en un PTP");
    await page.selectOption("#inventario-tecnologico-equipo-tipo", "ap");
    exigir(await page.locator("#inventario-tecnologico-equipo-cobertura").isVisible(), "no apareció al elegir AP");
    await cerrarModales(page);
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 11);
    await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="11"]`);
    await page.waitForSelector("#inventario-tecnologico-equipo-cobertura-radio");
    exigir(await page.locator("#inventario-tecnologico-equipo-cobertura").isVisible() && await page.inputValue("#inventario-tecnologico-equipo-cobertura-radio") === "800", "radio: " + await page.inputValue("#inventario-tecnologico-equipo-cobertura-radio"));
    exigir(/Se dibuja: 800 m a la redonda/.test(await texto(page, "#inventario-tecnologico-equipo-cobertura-ayuda")), await texto(page, "#inventario-tecnologico-equipo-cobertura-ayuda"));
  });
  await verificar("3.9: con valores fuera de rango o un sector sin dirección avisa en el campo y no guarda", async ()=>{
    await page.fill("#inventario-tecnologico-equipo-cobertura-radio", "0");
    await page.click("#inventario-tecnologico-equipo-guardar");
    await page.waitForFunction(()=>/de más de 0 a 20/.test(document.querySelector('[data-error="radio_cobertura_m"]')?.textContent || ""), null, { timeout: 3000 });
    await page.fill("#inventario-tecnologico-equipo-cobertura-radio", "500");
    await page.fill("#inventario-tecnologico-equipo-cobertura-apertura", "120");
    await page.click("#inventario-tecnologico-equipo-guardar");
    await page.waitForFunction(()=>/hacia dónde apunta/.test(document.querySelector('[data-error="azimut_cobertura"]')?.textContent || ""), null, { timeout: 3000 });
    exigir(Number((await db(page, "equipos_radioenlace")).find(e=>e.id === 11).radio_cobertura_m) === 800, "guardó algo");
  });
  await verificar("3.9: guardar un sector (500 m, 120° hacia el norte, con coma decimal) lo dibuja como cuña", async ()=>{
    await page.fill("#inventario-tecnologico-equipo-cobertura-radio", "500,5");
    await page.fill("#inventario-tecnologico-equipo-cobertura-azimut", "0");
    exigir(/Se dibuja: 500,5 m · sector de 120° hacia el N \(0°\)|Se dibuja: 501 m · sector de 120° hacia el N \(0°\)/.test(await texto(page, "#inventario-tecnologico-equipo-cobertura-ayuda")), await texto(page, "#inventario-tecnologico-equipo-cobertura-ayuda"));
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const e = (await db(page, "equipos_radioenlace")).find(x=>x.id === 11);
    exigir(e.radio_cobertura_m === 500.5 && e.azimut_cobertura === 0 && e.apertura_cobertura === 120, JSON.stringify([e.radio_cobertura_m, e.azimut_cobertura, e.apertura_cobertura]));
    await page.waitForSelector(COBERTURA(11, "sector"), { timeout: 3000 });
  });
  await verificar("3.9: vaciar los tres campos le quita la cobertura", async ()=>{
    await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="11"]`);
    await page.waitForSelector("#inventario-tecnologico-equipo-cobertura-radio");
    for(const k of ["radio", "azimut", "apertura"]) await page.fill(`#inventario-tecnologico-equipo-cobertura-${k}`, "");
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const e = (await db(page, "equipos_radioenlace")).find(x=>x.id === 11);
    exigir(e.radio_cobertura_m === null && e.azimut_cobertura === null && e.apertura_cobertura === null, JSON.stringify(e));
    await esperarCuenta(page, "path.inventario-tecnologico-mapa-cobertura", 1, "queda la del AP Santa Ana");
  });
  await verificar("3.9: editar un equipo que no es AP no envía la cobertura (no la toca)", async ()=>{
    await seleccionarEquipoDesdeSuUbicacion(page, 1, 12);
    await page.click(`${SEL.panel} [data-accion="editar-equipo"][data-id="12"]`);
    await page.waitForSelector("#inventario-tecnologico-equipo-servidor-boton");
    await page.click("#inventario-tecnologico-equipo-guardar");
    await esperarSinModal(page);
    const parche = await page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "equipos_radioenlace" && e.op === "update").pop()?.parche);
    exigir(parche && !("radio_cobertura_m" in parche), "envió la cobertura: " + JSON.stringify(parche));
  });
  await verificar("3.10 con la 013: en «Redes y tipos» cada tipo muestra su ícono; uno con script se rechaza y uno bueno se guarda y se ve en el tooltip", async ()=>{
    await page.click("#inventario-tecnologico-mapa-redes-tipos");
    await page.waitForSelector('.inventario-tecnologico-catalogo-fila[data-tipo-valor="ptp"] .inventario-tecnologico-tipo-icono-btn');
    exigir(/Ícono de fábrica/.test(await page.getAttribute('.inventario-tecnologico-catalogo-fila[data-tipo-valor="router"] .inventario-tecnologico-tipo-icono-btn', "title")), "router sin el de fábrica");
    await page.click('.inventario-tecnologico-catalogo-fila[data-tipo-valor="ptp"] .inventario-tecnologico-tipo-icono-btn');
    await page.waitForSelector("#inventario-tecnologico-icono-tipo-svg");
    await page.fill("#inventario-tecnologico-icono-tipo-svg", '<svg viewBox="0 0 16 16"><script>alert(1)</script><circle cx="8" cy="8" r="6"/></svg>');
    await page.click("#inventario-tecnologico-icono-tipo-guardar");
    // svg-seguro limpia el script; lo que se guarda es el SVG limpio.
    await toast(page, /Ícono guardado/);
    const ptp = (await db(page, "tipos_equipo_red")).find(t=>t.valor === "ptp");
    exigir(/<circle/.test(ptp.icono_svg) && !/script/i.test(ptp.icono_svg), "guardó: " + ptp.icono_svg);
    await page.waitForSelector('.inventario-tecnologico-catalogo-fila[data-tipo-valor="ptp"] .inventario-tecnologico-tipo-icono-btn[title^="Ícono propio"]', { timeout: 3000 });
    await cerrarModales(page);
    await tooltipDe(page, 3);
    const svgPtp = await page.locator(`${TT_UBIC} tr:has(td:text-is("Punto a Punto")) svg`).evaluate(s=>s.outerHTML);
    exigir(/<circle cx="8" cy="8" r="6"/.test(svgPtp), "el tooltip no usa el ícono propio: " + svgPtp);
    await soltarTooltip(page);
  });
  await verificar("3.10: un ícono sin <svg ni viewBox no se acepta; «Volver al de fábrica» lo quita", async ()=>{
    await page.click("#inventario-tecnologico-mapa-redes-tipos");
    await page.click('.inventario-tecnologico-catalogo-fila[data-tipo-valor="ptp"] .inventario-tecnologico-tipo-icono-btn');
    await page.waitForSelector("#inventario-tecnologico-icono-tipo-svg");
    await page.fill("#inventario-tecnologico-icono-tipo-svg", '<svg><circle cx="8" cy="8" r="6"/></svg>');
    exigir(/viewBox/.test(await texto(page, "#inventario-tecnologico-icono-tipo-ayuda")), "no avisa del viewBox: " + await texto(page, "#inventario-tecnologico-icono-tipo-ayuda"));
    await page.click("#inventario-tecnologico-icono-tipo-guardar");
    await page.waitForFunction(()=>/viewBox/.test(document.getElementById("inventario-tecnologico-icono-tipo-ayuda")?.textContent || ""), null, { timeout: 3000 });
    exigir(/<circle cx="8" cy="8" r="6"\/>/.test((await db(page, "tipos_equipo_red")).find(t=>t.valor === "ptp").icono_svg), "se cambió");
    await page.click("#inventario-tecnologico-icono-tipo-fabrica");
    await toast(page, /Ícono guardado/);
    exigir((await db(page, "tipos_equipo_red")).find(t=>t.valor === "ptp").icono_svg === null, "no volvió al de fábrica");
    await cerrarModales(page);
  });
  await verificar("sin errores de JavaScript (cobertura de los AP)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();
}

// ------------------------------------------------------------------ main
const srv = await servir(RAIZ);
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try{
  // SOLO=plano (u otro nombre) corre un solo escenario, para depurar.
  const escenarios = { admin: escenarioAdmin, permisos: escenarioPermisos, fallas: escenarioFallas, celular: escenarioCelular, plano: escenarioPlano, torre: escenarioTorre, red: escenarioRed, medio: escenarioMedio, lote: escenarioLote, redes: escenarioRedes, piscinas: escenarioPiscinas, servidor: escenarioServidor, herencia: escenarioHerencia, pantalla: escenarioPantalla, activo: escenarioActivo, campos: escenarioCampos, sin012: escenarioSin012, vacias: escenarioVacias, grosor0: escenarioGrosorCero, filtros: escenarioFiltros, solo: escenarioSoloTabla, buscar: escenarioBuscar, franjas: escenarioFranjas, tooltip: escenarioTooltip, cobertura: escenarioCobertura };
  // SOLO=plano o SOLO=plano,torre (varios, separados por comas).
  const solo = process.env.SOLO ? process.env.SOLO.split(",").map(x=>x.trim()).filter(Boolean) : null;
  for(const [nombre, fn] of Object.entries(escenarios)) if(!solo || solo.includes(nombre)) await fn(browser, base);
}finally{
  await browser.close();
  srv.close();
}
const ok = resultados.filter(r=>r.ok).length;
console.log(`\n=== ${ok}/${resultados.length} pruebas OK === (capturas en ${CAPTURAS})`);
if(ok !== resultados.length) process.exit(1);
