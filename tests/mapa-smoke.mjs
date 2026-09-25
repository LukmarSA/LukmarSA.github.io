// Prueba de humo del módulo de mapa en un navegador real (Chromium vía
// Playwright), con la app servida localmente y Supabase reemplazado por
// stubs/supabase-stub.js. Hace los clics de verdad: marcador → panel →
// equipo → camino a la raíz, los toggles de líneas/equipos, la simulación de
// fallas, los formularios de administrador (equipo con servidor, respaldos),
// permisos por rol y los casos de falla (tablas faltantes, unpkg caído).
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
  const tipos = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".png":"image/png", ".json":"application/json" };
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

function fixture({ rol = "administrador", permitidas = [], fallas = {} } = {}){
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
    tablas: {
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
    },
  };
}

async function abrirApp(browser, base, fx, { leafletFalla = false, viewport = { width: 1400, height: 900 } } = {}){
  const context = await browser.newContext({ viewport, locale: "es-EC", timezoneId: "America/Guayaquil" });
  const page = await context.newPage();
  const errores = [];
  page.on("pageerror", e=>errores.push(e.message));
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
    exigir(/13\s*ubicaciones/.test(t) && /18\s*equipos de radio/.test(t) && /13\s*radioenlaces/.test(t) && /2\s*activos ubicados/.test(t), t.replace(/\s+/g, " ").slice(0, 240));
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
  await page.fill("#inventario-tecnologico-equipo-banda", "5 GHz");
  await page.fill("#inventario-tecnologico-equipo-frecuencia", "5220");
  await page.click("#inventario-tecnologico-equipo-guardar");
  await verificar("crear equipo con servidor: se guarda servidor_id, banda y frecuencia, y aparece su línea", async ()=>{
    await esperarSinModal(page);
    const e = (await db(page, "equipos_radioenlace")).find(x=>x.nombre === "Cámara Bodega");
    exigir(e && e.servidor_id === 21 && e.banda === "5 GHz" && e.frecuencia_mhz === 5220, JSON.stringify(e));
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
  await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");

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

// ------------------------------------------------------------------ main
const srv = await servir(RAIZ);
const base = `http://127.0.0.1:${srv.address().port}`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try{
  await escenarioAdmin(browser, base);
  await escenarioPermisos(browser, base);
  await escenarioFallas(browser, base);
  await escenarioCelular(browser, base);
}finally{
  await browser.close();
  srv.close();
}
const ok = resultados.filter(r=>r.ok).length;
console.log(`\n=== ${ok}/${resultados.length} pruebas OK === (capturas en ${CAPTURAS})`);
if(ok !== resultados.length) process.exit(1);
