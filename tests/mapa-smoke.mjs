// Prueba de humo del módulo de mapa en un navegador real (Chromium vía
// Playwright), con la app servida localmente y Supabase reemplazado por
// stubs/supabase-stub.js. Hace los clics de verdad: marcador → panel →
// equipo → camino a la raíz, los toggles de líneas/equipos, la simulación de
// fallas, los formularios de administrador (equipo con servidor, respaldos),
// permisos por rol, los casos de falla (tablas faltantes, unpkg caído) y la
// capa Plano con su herramienta de ajuste (mover, agrandar, guardar, cancelar)
// y, del inventario, el modal «Nuevo activo» (tipo con búsqueda, campos según
// el tipo, submodales de «+»).
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
import { distanciaKm, fmtDistancia } from "../assets/js/inventario-tecnologico/nucleo/geo.js";
import { PLANO_POR_DEFECTO } from "../assets/js/inventario-tecnologico/nucleo/plano-mapa.js";

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
  catch(err){ registrar(nombre, false, err.message.split("\n")[0]); }
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

function fixture({ rol = "administrador", permitidas = [], fallas = {}, red007 = false } = {}){
  const uid = rol === "administrador" ? "u-admin" : "u-usuario";
  const permisos = [];
  for(const r of ["registrador", "visitante"]){
    for(const a of ACCIONES){
      const base = r === "registrador" ? ["ver_listado","ver_detalle","crear_activo","editar_activo","cambiar_custodio","ver_bajas"] : ["ver_listado","ver_detalle"];
      permisos.push({ rol: r, accion: a, permitido: base.includes(a) || (r === rol && permitidas.includes(a)) });
    }
  }
  return {
    hoy: HOY,
    fallas,
    sesion: { user: { id: uid, email: `${rol}@lukmar.local` } },
    tablas: (red007 ? conRed007 : x=>x)({
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
    }),
  };
}

async function abrirApp(browser, base, fx, { leafletFalla = false, viewport = { width: 1400, height: 900 } } = {}){
  const context = await browser.newContext({ viewport, locale: "es-EC", timezoneId: "America/Guayaquil" });
  const page = await context.newPage();
  const errores = [];
  page.on("pageerror", e=>errores.push(e.message));
  if(process.env.DEPURAR) page.on("console", m=>{ if(/DEPURAR/.test(m.text())) console.log("   [consola]", m.text()); });
  page.on("console", m=>{ if(m.type() === "error" && !/Failed to load resource/.test(m.text())) errores.push("console: " + m.text()); });
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", r=>r.fulfill({ contentType: "text/javascript", body: `window.__FIXTURE__ = ${JSON.stringify(fx)};\n${STUB}` }));
  await page.route("https://cdnjs.cloudflare.com/**", r=>r.fulfill({ contentType: "text/javascript", body: "window.JSZip = function(){};" }));
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

async function irAlMapa(page){
  await page.click(SEL.tab("mapa"));
  await page.waitForSelector(".leaflet-marker-icon", { timeout: 10000 });
  await page.waitForFunction(()=>!!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-cifras, #inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo"));
}
// Espera a que el mapa termine de moverse (encuadres animados): un clic en un
// marcador que todavía se desplaza puede caer en el fondo del mapa.
async function mapaQuieto(page){
  await page.waitForFunction(async ()=>{
    const m = (await import("/assets/js/inventario-tecnologico/ui/vista-mapa.js")).mapaActual();
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
  await verificar("la barra conserva los filtros de ubicación y suma Líneas, Equipos y Simulación con sus conteos", async ()=>{
    const t = await texto(page, ".inventario-tecnologico-mapa-filtros");
    for(const re of [/Torre\s*2/, /Backbone\s*2/, /P2MP\s*11/, /Respaldos\s*1/, /Raíz\s*1/, /Distribución\s*2/, /Cliente\s*11/, /Simulación de fallas/]) exigir(re.test(t), `falta ${re}: ${t.replace(/\s+/g, " ")}`);
    exigir(await page.locator(SEL.chip("linea", "respaldos")).getAttribute("aria-pressed") === "false", "Respaldos no arranca apagado");
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
  await page.click(SEL.chip("linea", "p2mp"));
  await verificar("toggle P2MP: oculta las líneas de distribución y deja el backbone", async ()=>{
    await esperarCuenta(page, SEL.linea("p2mp"), 0);
    await esperarCuenta(page, SEL.linea("backbone"), 2);
  });
  await page.click(SEL.chip("linea", "backbone"));
  await verificar("toggle Backbone: sin líneas", async ()=>{ await esperarCuenta(page, SEL.lineas, 0); });
  await page.click(SEL.chip("linea", "respaldos"));
  await verificar("toggle Respaldos (apagado de fábrica): muestra el respaldo registrado, punteado", async ()=>{
    await esperarCuenta(page, SEL.linea("respaldo"), 1);
    exigir(await page.locator(`${SEL.linea("respaldo")}[data-cliente-id="101"][data-servidor-id="21"]`).count() === 1, "no es Piscina 1 → AP Santa Ana");
  });
  for(const l of ["respaldos", "backbone", "p2mp"]) await page.click(SEL.chip("linea", l));
  await esperarCuenta(page, SEL.lineas, 4);
  await page.click(SEL.chip("rol", "cliente"));
  await verificar("filtro de equipos por tipo: ocultar «Cliente» saca las piscinas y la bodega (solo tienen clientes)", async ()=>{
    await esperarCuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono", 3, "marcadores");
    exigir(await cuenta(page, SEL.agrupado) === 1, "el indicador del AP (distribución) debería seguir");
  });
  await page.click(SEL.chip("rol", "cliente"));
  await page.click('.inventario-tecnologico-mapa-chip[data-tipo="torre"]');
  await verificar("el filtro por tipo de ubicación sigue funcionando (sin torres: 11 marcadores)", async ()=>{
    await esperarCuenta(page, ".leaflet-marker-icon.inventario-tecnologico-mapa-icono", 11);
  });
  await page.click('.inventario-tecnologico-mapa-chip[data-tipo="torre"]');
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
  await page.click(SEL.chip("estado", "sin_conexion"));
  await verificar("filtro por estado de la simulación: ocultar «Sin conectividad» saca la bodega", async ()=>{
    await esperarCuenta(page, SEL.marcador("Bodega Sur"), 0);
  });
  await page.click(SEL.chip("estado", "sin_conexion"));
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
  await page.waitForSelector("#inventario-tecnologico-equipo-servidor");
  await page.fill("#inventario-tecnologico-equipo-nombre", "Cámara Bodega");
  await page.selectOption("#inventario-tecnologico-equipo-servidor", "40");
  await verificar("equipo nuevo: el servidor en la misma ubicación se ofrece primero y se explica como cable", async ()=>{
    const grupos = await page.locator("#inventario-tecnologico-equipo-servidor optgroup").evaluateAll(g=>g.map(x=>x.label));
    exigir(/^Bodega Sur — misma ubicación/.test(grupos[0]), grupos.join(" | "));
    exigir(/Por cable/.test(await texto(page, "#inventario-tecnologico-equipo-servidor-calculo")), await texto(page, "#inventario-tecnologico-equipo-servidor-calculo"));
  });
  await page.selectOption("#inventario-tecnologico-equipo-servidor", "21");
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
  await page.waitForSelector("#inventario-tecnologico-equipo-servidor");
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
  await page.waitForSelector("#inventario-tecnologico-respaldo-servidor");
  await verificar("formulario de respaldo: no ofrece al propio equipo ni a su servidor actual; prioridad sugerida 1", async ()=>{
    const valores = await page.locator("#inventario-tecnologico-respaldo-servidor option").evaluateAll(o=>o.map(x=>x.value));
    exigir(!valores.includes("32") && !valores.includes("21") && valores.includes("11"), valores.join(","));
    exigir((await page.inputValue("#inventario-tecnologico-respaldo-prioridad")) === "1", "prioridad sugerida");
  });
  await page.selectOption("#inventario-tecnologico-respaldo-servidor", "11");
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
  await page.waitForSelector("#inventario-tecnologico-equipo-servidor");
  await page.selectOption("#inventario-tecnologico-equipo-servidor", "11");
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
    await page.waitForSelector(`${SEL.chip("linea", "backbone")}`, { state: "visible" });
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
const IMG_PLANO = "img.inventario-tecnologico-mapa-plano";
const matrizPlano = page=>page.evaluate(sel=>{ const m = new DOMMatrix(getComputedStyle(document.querySelector(sel)).transform); return [m.a, m.b, m.c, m.d, m.e, m.f]; }, IMG_PLANO);
const escriturasPlano = page=>page.evaluate(()=>window.__ESCRITURAS__.filter(e=>e.tabla === "planos_mapa"));

async function escenarioPlano(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());
  await irAlMapa(page);
  await verificar("capas base: Mapa, Satélite y Plano", async ()=>{
    const t = (await page.locator(".leaflet-control-layers-base label").allInnerTexts()).map(x=>x.trim());
    exigir(t.join("|") === "Mapa|Satélite|Plano", t.join("|"));
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 0, "el control del plano aparece sin elegir la capa");
  });
  await elegirCapa(page, "Plano");
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
  await verificar("al volver a abrir el mapa sigue en la capa Plano (el navegador la recuerda)", async ()=>{
    await page.reload();
    await page.waitForSelector(".inventario-tecnologico-topbar");
    await irAlMapa(page);
    await page.waitForSelector(IMG_PLANO);
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 1, "no está el control del plano");
    exigir(await page.evaluate(()=>[...document.querySelectorAll(".leaflet-control-layers-base input")].findIndex(i=>i.checked)) === 2, "la capa elegida no es Plano");
  });
  await elegirCapa(page, "Mapa");
  await verificar("al volver a «Mapa» se quitan el plano, su control y su leyenda", async ()=>{
    await esperarCuenta(page, IMG_PLANO, 0);
    exigir(await page.locator(".inventario-tecnologico-mapa-plano-control").count() === 0, "quedó el control");
    exigir(await page.evaluate(()=>document.getElementById("inventario-tecnologico-mapa-leyenda-plano").hidden), "quedó la leyenda del plano");
  });
  await verificar("sin errores de JavaScript (capa Plano)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
  await context.close();

  {
    const { context, page, errores } = await abrirApp(browser, base, fixture({ rol: "registrador", permitidas: ["ver_mapa"] }));
    await irAlMapa(page);
    await elegirCapa(page, "Plano");
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
    await elegirCapa(page, "Plano");
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
      const raiz = document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-cableado-arbol");
      if(!raiz) return null;
      const nodo = li=>({ n: li.querySelector(":scope > .inventario-tecnologico-mapa-cableado-fila .inventario-tecnologico-mapa-enlace-texto").title, h: [...li.querySelectorAll(":scope > .inventario-tecnologico-mapa-cableado-hijos > li")].map(nodo) });
      return [...raiz.children].map(nodo);
    });
    exigir(arbol && arbol.length === 1 && arbol[0].n === NOMBRE.ptpCA, JSON.stringify(arbol));
    const sw = arbol[0].h.find(x=>x.n === NOMBRE.sw);
    exigir(arbol[0].h.length === 3 && sw && sw.h.map(x=>x.n).sort().join("|") === [NOMBRE.camN, NOMBRE.camS].sort().join("|"), JSON.stringify(arbol[0]));
    exigir(/de Oficina Centro/.test(await texto(page, `${SEL.panel} .inventario-tecnologico-mapa-cableado-subida`)), "sin la subida inalámbrica");
  });
  await page.screenshot({ path: path.join(CAPTURAS, "14-red-torre.png") });

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
    await page.selectOption("#inventario-tecnologico-equipo-servidor", "50");
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

// ------------------------------------------------------------------ main
const srv = await servir(RAIZ);
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try{
  // SOLO=plano (u otro nombre) corre un solo escenario, para depurar.
  const escenarios = { admin: escenarioAdmin, permisos: escenarioPermisos, fallas: escenarioFallas, celular: escenarioCelular, plano: escenarioPlano, torre: escenarioTorre, red: escenarioRed, activo: escenarioActivo };
  for(const [nombre, fn] of Object.entries(escenarios)) if(!process.env.SOLO || process.env.SOLO === nombre) await fn(browser, base);
}finally{
  await browser.close();
  srv.close();
}
const ok = resultados.filter(r=>r.ok).length;
console.log(`\n=== ${ok}/${resultados.length} pruebas OK === (capturas en ${CAPTURAS})`);
if(ok !== resultados.length) process.exit(1);
