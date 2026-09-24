// Prueba de humo del módulo de mapa en un navegador real (Chromium vía
// Playwright), con la app servida localmente y Supabase reemplazado por
// stubs/supabase-stub.js. Hace los clics de verdad: marcador → panel →
// equipo → línea → otro extremo, más los formularios de administrador,
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
const HOY = "2026-09-24";
const SVG16 = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect x="2" y="3" width="12" height="9" rx="1"/></svg>`;
const ACCIONES = ["ver_listado","ver_detalle","crear_activo","editar_activo","cambiar_custodio","editar_historial","dar_baja","restaurar_baja","ver_bajas","ver_mapa","asignar_ubicacion"];
const UBIC = {
  cerroAzul: { id:1, nombre:"Torre Cerro Azul", tipo:"torre", lat:-2.1735, lng:-79.9587, direccion:null, notas:"Acceso por la vía a la costa", fotos:[], activa:true },
  santaAna: { id:2, nombre:"Torre Santa Ana", tipo:"torre", lat:-2.1839, lng:-79.8756, direccion:null, notas:null, fotos:[], activa:true },
  oficina: { id:3, nombre:"Oficina Centro", tipo:"oficina", lat:-2.1894, lng:-79.8891, direccion:"Av. 9 de Octubre", notas:null, fotos:[], activa:true },
};

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
      ubicaciones: [UBIC.cerroAzul, UBIC.santaAna, UBIC.oficina],
      equipos_radioenlace: [
        { id:10, ubicacion_id:1, nombre:"PTP CA-SA", modelo:"Cambium PTP 550", activo_id:null, notas:null },
        { id:11, ubicacion_id:1, nombre:"AP Sector Norte", modelo:"Cambium ePMP 3000", activo_id:null, notas:"Sector 90°" },
        { id:20, ubicacion_id:2, nombre:"PTP SA-CA", modelo:"Cambium PTP 550", activo_id:null, notas:null },
        { id:21, ubicacion_id:2, nombre:"SM Santa Ana", modelo:"Cambium Force 300", activo_id:null, notas:null },
        { id:30, ubicacion_id:3, nombre:"SM Oficina", modelo:"Cambium Force 300-25", activo_id:2, notas:null },
      ],
      enlaces: [
        { id:100, equipo_origen_id:10, equipo_destino_id:20, banda:"5 GHz", frecuencia_mhz:5745, notas:null },
        { id:101, equipo_origen_id:11, equipo_destino_id:30, banda:"5 GHz", frecuencia_mhz:5180, notas:null },
        { id:102, equipo_origen_id:11, equipo_destino_id:21, banda:"5 GHz", frecuencia_mhz:5180, notas:null },
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
  lineas: "path.inventario-tecnologico-mapa-linea-enlace",
  fondo: "path.inventario-tecnologico-mapa-linea-fondo",
  etiquetas: ".leaflet-tooltip.inventario-tecnologico-mapa-etiqueta-enlace",
  tab: id=>`.inventario-tecnologico-tab-btn[data-tab="${id}"]`,
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
async function confirmar(page){
  await page.waitForSelector("#inventario-tecnologico-btn-confirmar-si");
  await page.click("#inventario-tecnologico-btn-confirmar-si");
}
// Llegar a una ubicación desde la lista del panel (como haría alguien con
// teclado, o cuando el marcador quedó fuera de la vista tras un encuadre).
async function irAUbicacionDesdePanel(page, id){
  if(await page.locator(`${SEL.panel} [data-accion="volver-resumen"]`).count()) await page.click(`${SEL.panel} [data-accion="volver-resumen"]`);
  await page.click(`${SEL.panel} [data-accion="ver-ubicacion"][data-id="${id}"]`);
  await page.waitForFunction(id=>!!document.querySelector(`#inventario-tecnologico-mapa-panel [data-accion="nuevo-equipo"][data-id="${id}"], #inventario-tecnologico-mapa-panel [data-accion="asignar-activos"][data-id="${id}"]`) || !!document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo"), id);
}
async function captura(page, nombre){ await page.screenshot({ path: path.join(CAPTURAS, nombre) }); }

// ------------------------------------------------------------------ escenarios
async function escenarioAdmin(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture());

  await verificar("la pestaña Mapa aparece para el admin, después de Bajas", async ()=>{
    const tabs = await page.locator(".inventario-tecnologico-tab-btn").allInnerTexts();
    exigir(tabs.indexOf("Mapa") === tabs.indexOf("Bajas") + 1, "orden: " + tabs.join(", "));
  });
  await irAlMapa(page);
  await verificar("al entrar al mapa, la pestaña Mapa queda resaltada (y Activos ya no)", async ()=>{
    exigir(await page.locator(SEL.tab("mapa") + ".inventario-tecnologico-active").count() === 1, "Mapa no quedó activa");
    exigir(await page.locator(SEL.tab("activos") + ".inventario-tecnologico-active").count() === 0, "Activos sigue activa");
  });
  await verificar("Leaflet cargó con SRI desde el mismo archivo que unpkg", async ()=>{
    const v = await page.evaluate(()=>window.L && window.L.version);
    exigir(v === "1.9.4", "window.L.version = " + v);
    const integ = await page.evaluate(()=>[...document.querySelectorAll('script[src*="unpkg.com/leaflet"], link[href*="unpkg.com/leaflet"]')].map(e=>e.getAttribute("integrity")));
    exigir(integ.length === 2 && integ.every(Boolean), "faltan atributos integrity");
  });
  await verificar("se dibuja un marcador por ubicación (3)", async ()=>{
    const n = await page.locator(".leaflet-marker-icon").count();
    exigir(n === 3, `marcadores: ${n}`);
  });
  await verificar("el resumen del panel cuenta ubicaciones, equipos, enlaces y activos ubicados", async ()=>{
    const t = await texto(page, SEL.panel);
    exigir(/3\s*ubicaciones/.test(t) && /5\s*equipos de radio/.test(t) && /3\s*enlaces/.test(t) && /2\s*activos ubicados/.test(t), t.replace(/\s+/g, " ").slice(0, 200));
    exigir(/1 activo todavía no tiene ubicación/.test(t), "no avisa del activo sin ubicación");
  });
  await captura(page, "01-mapa-resumen.png");

  // Paso 2 del spec: clic en torre → lista de equipos
  await page.click(SEL.marcador("Torre Cerro Azul"));
  await verificar("clic en la torre abre su panel con la lista de equipos de radioenlace", async ()=>{
    exigir((await texto(page, SEL.titulo)) === "Torre Cerro Azul", "título: " + await texto(page, SEL.titulo));
    const equipos = await page.locator(`${SEL.panel} [data-accion="seleccionar-equipo"]`).count();
    exigir(equipos === 2, `equipos listados: ${equipos}`);
    exigir(await page.locator(SEL.marcador("Torre Cerro Azul") + " .inventario-tecnologico-mapa-pin-seleccionada").count() === 1, "el marcador no quedó resaltado");
  });

  // Paso 3 del spec: clic en equipo → línea hacia el otro extremo, resaltado
  await page.click(`${SEL.panel} [data-accion="seleccionar-equipo"][data-id="10"]`);
  await verificar("clic en un equipo dibuja la línea de vista hacia el equipo enlazado", async ()=>{
    await page.waitForSelector(SEL.lineas);
    exigir(await page.locator(SEL.lineas).count() === 1, "líneas: " + await page.locator(SEL.lineas).count());
  });
  await verificar("el otro extremo (Torre Santa Ana) queda resaltado", async ()=>{
    exigir(await page.locator(SEL.marcador("Torre Santa Ana") + " .inventario-tecnologico-mapa-pin-enlazada").count() === 1, "sin clase enlazada");
    exigir(await page.locator(SEL.marcador("Oficina Centro") + " .inventario-tecnologico-mapa-pin-enlazada").count() === 0, "resaltó una ubicación que no es el otro extremo");
  });
  const esperada = fmtDistancia(distanciaKm(UBIC.cerroAzul, UBIC.santaAna));
  await verificar(`la línea y el panel muestran la distancia correcta (${esperada}) y el azimut`, async ()=>{
    const etiqueta = await texto(page, SEL.etiquetas);
    exigir(etiqueta.includes(esperada) && etiqueta.includes("5 GHz"), "etiqueta: " + etiqueta);
    const t = await texto(page, SEL.panel);
    exigir(t.includes(esperada) && /azimut desde aquí/i.test(t) && /PTP SA-CA/.test(t) && /5745 MHz/.test(t), t.replace(/\s+/g, " ").slice(0, 300));
  });
  await captura(page, "02-enlace-ptp.png");

  await page.click(SEL.marcador("Torre Santa Ana"));
  await verificar("clic en el otro extremo pasa a su equipo y la línea se mantiene", async ()=>{
    exigir((await texto(page, SEL.titulo)) === "Torre Santa Ana", "título: " + await texto(page, SEL.titulo));
    exigir(await page.locator(`${SEL.panel} [data-accion="seleccionar-equipo"][data-id="20"][aria-pressed="true"]`).count() === 1, "el equipo PTP SA-CA no quedó seleccionado");
    exigir(await page.locator(SEL.lineas).count() === 1, "la línea desapareció");
    exigir(await page.locator(SEL.marcador("Torre Cerro Azul") + " .inventario-tecnologico-mapa-pin-enlazada").count() === 1, "Cerro Azul no quedó como extremo enlazado");
  });

  await clicVacio(page);
  await verificar("clic en un área vacía del mapa limpia la selección y las líneas", async ()=>{
    await page.waitForSelector(`${SEL.panel} .inventario-tecnologico-mapa-cifras`);
    exigir(await page.locator(SEL.lineas).count() === 0, "quedaron líneas");
  });

  await page.click(SEL.marcador("Torre Cerro Azul"));
  await page.click(`${SEL.panel} [data-accion="seleccionar-equipo"][data-id="11"]`);
  await verificar("punto-multipunto: un AP con dos enlaces dibuja dos líneas y resalta ambos extremos", async ()=>{
    await page.waitForFunction(sel=>document.querySelectorAll(sel).length === 2, SEL.lineas);
    exigir(await page.locator(SEL.marcador("Torre Santa Ana") + " .inventario-tecnologico-mapa-pin-enlazada").count() === 1, "Santa Ana");
    exigir(await page.locator(SEL.marcador("Oficina Centro") + " .inventario-tecnologico-mapa-pin-enlazada").count() === 1, "Oficina");
  });
  await captura(page, "03-ptmp.png");

  await page.keyboard.press("Escape");
  await verificar("Esc suelta el equipo (vuelve a la torre) y un segundo Esc limpia la selección", async ()=>{
    await page.waitForFunction(sel=>document.querySelectorAll(sel).length === 0, SEL.lineas);
    exigir((await texto(page, SEL.titulo)) === "Torre Cerro Azul", "no volvió a la torre");
    await page.keyboard.press("Escape");
    await page.waitForSelector(`${SEL.panel} .inventario-tecnologico-mapa-cifras`);
  });

  await page.check("#inventario-tecnologico-mapa-ver-enlaces");
  await verificar("«Todos los enlaces» dibuja la red completa (3 líneas punteadas)", async ()=>{
    await page.waitForFunction(sel=>document.querySelectorAll(sel).length === 3, SEL.fondo);
  });
  await page.uncheck("#inventario-tecnologico-mapa-ver-enlaces");

  await page.click('.inventario-tecnologico-mapa-chip[data-tipo="torre"]');
  await verificar("el filtro por tipo oculta las torres (queda 1 marcador)", async ()=>{
    await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon").length === 1);
  });
  await page.click('.inventario-tecnologico-mapa-chip[data-tipo="torre"]');
  await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon").length === 3);

  // Buscador
  await page.fill("#inventario-tecnologico-mapa-buscar", "LKM-002");
  await page.waitForSelector(".inventario-tecnologico-mapa-resultado");
  await page.keyboard.press("Enter");
  await verificar("buscar LKM-002 (un radio vinculado) lleva a su equipo en Oficina Centro", async ()=>{
    await page.waitForFunction(()=>document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo")?.textContent === "Oficina Centro");
    exigir(await page.locator(`${SEL.panel} [data-equipo-id="30"].inventario-tecnologico-mapa-equipo-sel`).count() === 1, "SM Oficina no quedó seleccionado");
    exigir(await page.locator(SEL.lineas).count() === 1, "no dibujó su enlace con el AP");
  });

  // ---------------- Formularios de administrador
  await page.click("#inventario-tecnologico-mapa-nueva-ubicacion");
  await page.waitForSelector("#inventario-tecnologico-ubic-nombre");
  await page.fill("#inventario-tecnologico-ubic-nombre", "Bodega Norte");
  await page.selectOption("#inventario-tecnologico-ubic-tipo", "bodega");
  await page.fill("#inventario-tecnologico-ubic-coords", "https://www.google.com/maps/@-2.1402,-79.9105,16z");
  await verificar("el formulario lee un enlace de Google Maps y lo confirma", async ()=>{
    exigir((await texto(page, "#inventario-tecnologico-ubic-coords-lectura")).includes("-2.140200, -79.910500"), await texto(page, "#inventario-tecnologico-ubic-coords-lectura"));
  });
  await page.fill("#inventario-tecnologico-ubic-nombre", " torre cerro AZUL ");
  await page.click("#inventario-tecnologico-ubic-guardar");
  await verificar("nombre duplicado (mayúsculas/espacios) se rechaza antes de ir a la base", async ()=>{
    await page.waitForFunction(()=>/Ya existe/.test(document.querySelector('[data-error="nombre"]')?.textContent || ""));
    exigir(!(await db(page, "ubicaciones")).some(u=>u.nombre.trim().toLowerCase() === "torre cerro azul" && u.id !== 1), "se insertó el duplicado");
  });
  await page.fill("#inventario-tecnologico-ubic-nombre", "Bodega Norte");
  await page.click("#inventario-tecnologico-ubic-guardar");
  await verificar("crear ubicación: se guarda y aparece su marcador seleccionado", async ()=>{
    await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon").length === 4);
    const u = (await db(page, "ubicaciones")).find(x=>x.nombre === "Bodega Norte");
    exigir(u && u.tipo === "bodega" && Math.abs(u.lat + 2.1402) < 1e-9 && Math.abs(u.lng + 79.9105) < 1e-9, JSON.stringify(u));
    exigir((await texto(page, SEL.titulo)) === "Bodega Norte", "no quedó seleccionada");
  });

  await page.click(`${SEL.panel} [data-accion="editar-ubicacion"]`);
  await page.waitForSelector("#inventario-tecnologico-ubic-btn-elegir");
  await page.fill("#inventario-tecnologico-ubic-notas", "Nota escrita antes de elegir en el mapa");
  await page.click("#inventario-tecnologico-ubic-btn-elegir");
  await verificar("«Elegir en el mapa» cierra el formulario y muestra el aviso de colocación", async ()=>{
    await page.waitForSelector("#inventario-tecnologico-mapa-aviso:not([hidden])");
    exigir(await page.locator("#inventario-tecnologico-modal-host .inventario-tecnologico-modal").count() === 0, "el modal sigue abierto");
  });
  const caja = await page.locator("#inventario-tecnologico-mapa-canvas").boundingBox();
  await page.mouse.click(caja.x + 26, caja.y + caja.height - 70);
  await verificar("el clic en el mapa reabre el formulario con coordenadas nuevas y sin perder lo escrito", async ()=>{
    await page.waitForSelector("#inventario-tecnologico-ubic-coords");
    const v = await page.inputValue("#inventario-tecnologico-ubic-coords");
    exigir(v && v !== "-2.140200, -79.910500", "coords: " + v);
    exigir((await page.inputValue("#inventario-tecnologico-ubic-notas")) === "Nota escrita antes de elegir en el mapa", "se perdió la nota");
  });
  await page.click("#inventario-tecnologico-ubic-guardar");
  await verificar("editar ubicación: las coordenadas elegidas en el mapa se guardan", async ()=>{
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal"));
    const u = (await db(page, "ubicaciones")).find(x=>x.nombre === "Bodega Norte");
    exigir(Math.abs(u.lat + 2.1402) > 1e-6 && u.notas === "Nota escrita antes de elegir en el mapa", JSON.stringify(u));
  });

  // "+" tipo de ubicación desde el formulario, sin cerrarlo
  await page.click(`${SEL.panel} [data-accion="editar-ubicacion"]`);
  await page.waitForSelector("#inventario-tecnologico-ubic-btn-mas-tipo");
  await page.click("#inventario-tecnologico-ubic-btn-mas-tipo");
  await page.fill("#inventario-tecnologico-ubic-tipo-etiqueta", "Repetidora");
  await page.click("#inventario-tecnologico-ubic-tipo-crear");
  await verificar("«+» crea un tipo de ubicación y lo deja elegido sin cerrar el formulario", async ()=>{
    await page.waitForFunction(()=>document.querySelector("#inventario-tecnologico-ubic-tipo")?.value === "repetidora");
    const t = (await db(page, "tipos_ubicacion")).find(x=>x.valor === "repetidora");
    exigir(t && t.etiqueta === "Repetidora" && t.orden === 50, JSON.stringify(t));
  });
  await page.click("#inventario-tecnologico-modal-host .inventario-tecnologico-modal-footer .inventario-tecnologico-modal-close");

  await page.click(`${SEL.panel} [data-accion="nuevo-equipo"]`);
  await page.waitForSelector("#inventario-tecnologico-equipo-nombre");
  await page.fill("#inventario-tecnologico-equipo-nombre", "PTP Bodega");
  await page.fill("#inventario-tecnologico-equipo-activo-filtro", "EQS-003");
  await page.selectOption("#inventario-tecnologico-equipo-activo", "3");
  await verificar("el formulario de equipo autocompleta el modelo desde el activo y avisa dónde quedará", async ()=>{
    exigir((await page.inputValue("#inventario-tecnologico-equipo-modelo")) === "LG 24MK600", "modelo: " + await page.inputValue("#inventario-tecnologico-equipo-modelo"));
    exigir(/quedará ubicado en «Bodega Norte»/.test(await texto(page, "#inventario-tecnologico-equipo-activo-aviso")), await texto(page, "#inventario-tecnologico-equipo-activo-aviso"));
  });
  await page.fill("#inventario-tecnologico-equipo-modelo", "Cambium PTP 550");
  await page.click("#inventario-tecnologico-equipo-guardar");
  await verificar("crear equipo vinculado a un activo: se guarda y el activo queda en esa ubicación", async ()=>{
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal"));
    const e = (await db(page, "equipos_radioenlace")).find(x=>x.nombre === "PTP Bodega");
    exigir(e && e.activo_id === 3, JSON.stringify(e));
    const t = (await db(page, "historial_ubicacion")).find(x=>x.activo_id === 3 && x.hasta === null);
    exigir(t && t.ubicacion_id === e.ubicacion_id, JSON.stringify(t));
  });

  const idNuevo = (await db(page, "equipos_radioenlace")).find(x=>x.nombre === "PTP Bodega").id;
  await page.click(`${SEL.panel} [data-accion="nuevo-enlace"][data-id="${idNuevo}"]`);
  await page.waitForSelector("#inventario-tecnologico-enlace-destino");
  await verificar("el formulario de enlace no ofrece equipos de la misma ubicación", async ()=>{
    const opciones = await page.locator("#inventario-tecnologico-enlace-destino option").allInnerTexts();
    exigir(!opciones.some(o=>o.includes("PTP Bodega")), opciones.join(" | "));
    exigir(opciones.some(o=>o.includes("PTP SA-CA")), "falta PTP SA-CA");
  });
  await page.selectOption("#inventario-tecnologico-enlace-destino", "20");
  await page.fill("#inventario-tecnologico-enlace-banda", "5 GHz");
  await verificar("el formulario de enlace calcula distancia y azimut al elegir el destino", async ()=>{
    exigir(/Distancia .*km · azimut desde aquí/.test(await texto(page, "#inventario-tecnologico-enlace-calculo")), await texto(page, "#inventario-tecnologico-enlace-calculo"));
  });
  await page.fill("#inventario-tecnologico-enlace-frecuencia", "5800");
  await page.click("#inventario-tecnologico-enlace-guardar");
  await verificar("crear enlace: se guarda y se dibuja", async ()=>{
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal"));
    const l = (await db(page, "enlaces")).find(x=>x.equipo_origen_id === idNuevo && x.equipo_destino_id === 20);
    exigir(l && l.frecuencia_mhz === 5800 && l.banda === "5 GHz", JSON.stringify(l));
    await page.waitForFunction(sel=>document.querySelectorAll(sel).length === 1, SEL.lineas);
  });

  // Activos: asignar, mover y quitar
  await irAUbicacionDesdePanel(page, 1);
  await verificar("la lista del panel lleva a una ubicación fuera de la vista y la centra", async ()=>{
    exigir((await texto(page, SEL.titulo)) === "Torre Cerro Azul", "título: " + await texto(page, SEL.titulo));
    // setView anima el paneo/zoom: se espera a que el marcador termine dentro del lienzo.
    await page.waitForFunction(sel=>{
      const m = document.querySelector(sel), c = document.getElementById("inventario-tecnologico-mapa-canvas");
      if(!m || !c) return false;
      const a = m.getBoundingClientRect(), b = c.getBoundingClientRect();
      const x = a.left + a.width / 2, y = a.top + a.height / 2;
      return x > b.left && x < b.right && y > b.top && y < b.bottom;
    }, SEL.marcador("Torre Cerro Azul"), { timeout: 4000 }).catch(async err=>{
      const info = await page.evaluate(sel=>{
        const m = document.querySelector(sel), c = document.getElementById("inventario-tecnologico-mapa-canvas");
        const r = e=>e && (({left,top,width,height})=>({left,top,width,height}))(e.getBoundingClientRect());
        return { marcador: r(m), lienzo: r(c), estilo: m && m.style.transform, n: document.querySelectorAll(".leaflet-marker-icon").length };
      }, SEL.marcador("Torre Cerro Azul"));
      await captura(page, "depuracion-centrar.png");
      throw new Error(err.message + " " + JSON.stringify(info));
    });
  });
  await page.click(`${SEL.panel} [data-accion="asignar-activos"]`);
  await page.waitForSelector("#inventario-tecnologico-asignar-lista");
  await verificar("asignar activos: por defecto solo ofrece los que no tienen ubicación", async ()=>{
    const n = await page.locator('#inventario-tecnologico-asignar-lista input[type="checkbox"]').count();
    exigir(n === 0, `ofreció ${n}`); // los 3 activos ya están ubicados (2 y 1 en Oficina, 3 en Bodega)
  });
  await page.check("#inventario-tecnologico-asignar-incluir");
  await verificar("con «Incluir…» aparecen los ubicados en otra parte, y el que es radio queda bloqueado", async ()=>{
    const items = await page.locator("#inventario-tecnologico-asignar-lista .inventario-tecnologico-mapa-asignar-item").allInnerTexts();
    exigir(items.length === 3, items.join(" | "));
    exigir(await page.locator('#inventario-tecnologico-asignar-lista input[value="2"]').isDisabled(), "LKM-002 (radio) no está bloqueado");
  });
  await page.check('#inventario-tecnologico-asignar-lista input[value="1"]');
  await page.click("#inventario-tecnologico-asignar-guardar");
  await verificar("asignar: el activo se mueve (tramo anterior cerrado, nuevo vigente) y aparece en la torre", async ()=>{
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-modal-host .inventario-tecnologico-modal"));
    const tramos = (await db(page, "historial_ubicacion")).filter(x=>x.activo_id === 1);
    exigir(tramos.length === 2 && tramos.find(t=>t.ubicacion_id === 3).hasta === HOY && tramos.find(t=>t.ubicacion_id === 1).hasta === null, JSON.stringify(tramos));
    exigir(await page.locator(`${SEL.panel} [data-activo-id="1"]`).count() === 1, "no aparece en el panel");
  });
  await page.click(`${SEL.panel} [data-accion="quitar-activo"][data-id="1"]`);
  await confirmar(page);
  await verificar("quitar ubicación: cierra el tramo y el activo sale del panel", async ()=>{
    await page.waitForFunction(()=>!document.querySelector('#inventario-tecnologico-mapa-panel [data-activo-id="1"]'));
    exigir((await db(page, "historial_ubicacion")).filter(x=>x.activo_id === 1 && x.hasta === null).length === 0, "sigue vigente");
  });

  // Borrados y archivado
  await page.click(`${SEL.panel} [data-accion="seleccionar-equipo"][data-id="10"]`);
  await page.click(`${SEL.panel} [data-accion="eliminar-enlace"][data-id="100"]`);
  await confirmar(page);
  await verificar("eliminar enlace: desaparece de la base y del mapa", async ()=>{
    await page.waitForFunction(sel=>document.querySelectorAll(sel).length === 0, SEL.lineas);
    exigir(!(await db(page, "enlaces")).some(l=>l.id === 100), "sigue en la base");
  });
  await page.click(`${SEL.panel} [data-accion="archivar-ubicacion"]`);
  await confirmar(page);
  await verificar("archivar: la ubicación se oculta del mapa y reaparece con «Archivadas»", async ()=>{
    await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon").length === 3);
    exigir((await db(page, "ubicaciones")).find(u=>u.id === 1).activa === false, "no quedó activa=false");
    await page.check("#inventario-tecnologico-mapa-ver-archivadas");
    await page.waitForFunction(()=>document.querySelectorAll(".leaflet-marker-icon").length === 4);
    exigir(await page.locator(SEL.marcador("Torre Cerro Azul") + " .inventario-tecnologico-mapa-pin-archivada").count() === 1, "no se ve como archivada");
  });
  await irAUbicacionDesdePanel(page, 1);
  await page.click(`${SEL.panel} [data-accion="eliminar-ubicacion"]`);
  await confirmar(page);
  await verificar("eliminar una ubicación con equipos se rechaza con un mensaje que sugiere archivar", async ()=>{
    await page.waitForFunction(()=>/No se puede eliminar/.test(document.querySelector(".inventario-tecnologico-toast-stack")?.innerText || ""));
    exigir((await db(page, "ubicaciones")).some(u=>u.id === 1), "se borró");
  });

  // Detalle del activo: bloque Ubicación + "Ver en mapa"
  await page.click(SEL.tab("activos"));
  await verificar("volver a Activos resalta Activos y libera el mapa", async ()=>{
    await page.waitForFunction(()=>!document.querySelector("#inventario-tecnologico-mapa-canvas"));
    exigir(await page.locator(SEL.tab("activos") + ".inventario-tecnologico-active").count() === 1, "Activos no quedó activa");
  });
  await page.locator("tr", { hasText: "LKM-002" }).first().click();
  await verificar("el detalle del activo muestra su ubicación actual y que es un radio", async ()=>{
    await page.waitForFunction(()=>/Oficina Centro/.test(document.getElementById("inventario-tecnologico-ubicacion-activo")?.innerText || ""));
    const t = await texto(page, "#inventario-tecnologico-ubicacion-activo");
    exigir(/instalado como equipo de radioenlace «SM Oficina»/.test(t) && /Ver en mapa/.test(t) && /Historial \(1\)/.test(t), t);
    exigir(!/Mover/.test(t), "ofrece «Mover» para un radio (debe moverse desde el equipo)");
  });
  await page.click('[data-ubic-accion="historial"]');
  await verificar("el historial de ubicación se despliega dentro del mismo detalle", async ()=>{
    await page.waitForFunction(()=>/presente/.test(document.querySelector(".inventario-tecnologico-ubicacion-activo-historial")?.innerText || ""));
  });
  await captura(page, "04-detalle-ubicacion.png");
  await page.click('[data-ubic-accion="ver-en-mapa"]');
  await verificar("«Ver en mapa» abre la pestaña Mapa con su equipo seleccionado", async ()=>{
    await page.waitForSelector(`${SEL.panel} [data-equipo-id="30"].inventario-tecnologico-mapa-equipo-sel`, { timeout: 10000 });
    exigir(await page.locator(SEL.tab("mapa") + ".inventario-tecnologico-active").count() === 1, "la pestaña Mapa no quedó activa");
    exigir(await page.locator("#inventario-tecnologico-modal-host .inventario-tecnologico-modal").count() === 0, "el detalle quedó abierto");
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
    await verificar("… pero en el detalle ve la ubicación, sin «Ver en mapa»", async ()=>{
      await page.waitForFunction(()=>/Oficina Centro/.test(document.getElementById("inventario-tecnologico-ubicacion-activo")?.innerText || ""));
      exigir(!/Ver en mapa/.test(await texto(page, "#inventario-tecnologico-ubicacion-activo")), "mostró «Ver en mapa»");
    });
    await verificar("sin errores de JavaScript (registrador sin mapa)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture({ rol: "registrador", permitidas: ["ver_mapa"] }));
    await irAlMapa(page);
    await page.click(SEL.marcador("Torre Cerro Azul"));
    await verificar("con «ver_mapa»: ve el mapa, pero sin botones de administrador ni de asignar", async ()=>{
      exigir(await page.locator("#inventario-tecnologico-mapa-nueva-ubicacion").count() === 0, "ve «+ Ubicación»");
      for(const a of ["editar-ubicacion","archivar-ubicacion","eliminar-ubicacion","nuevo-equipo","asignar-activos"]){
        exigir(await page.locator(`${SEL.panel} [data-accion="${a}"]`).count() === 0, `ve la acción ${a}`);
      }
    });
    await page.click(`${SEL.panel} [data-accion="seleccionar-equipo"][data-id="10"]`);
    await verificar("… y el flujo torre → equipo → línea funciona igual", async ()=>{
      await page.waitForSelector(SEL.lineas);
      exigir(await page.locator(`${SEL.panel} [data-accion="editar-enlace"]`).count() === 0, "ve «Editar enlace»");
    });
    await verificar("sin errores de JavaScript (registrador con ver_mapa)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
  {
    const { context, page, errores } = await abrirApp(browser, base, fixture({ rol: "registrador", permitidas: ["ver_mapa", "asignar_ubicacion"] }));
    await irAlMapa(page);
    await page.click(SEL.marcador("Oficina Centro"));
    await verificar("con «asignar_ubicacion»: aparece «+ Asignar» y Mover/Quitar en los activos (no en el radio)", async ()=>{
      exigir(await page.locator(`${SEL.panel} [data-accion="asignar-activos"]`).count() === 1, "sin «+ Asignar»");
      exigir(await page.locator(`${SEL.panel} [data-accion="mover-activo"][data-id="1"]`).count() === 1, "sin «Mover» para LKM-001");
      exigir(await page.locator(`${SEL.panel} [data-accion="mover-activo"][data-id="2"]`).count() === 0, "ofrece «Mover» para el radio LKM-002");
    });
    await verificar("sin errores de JavaScript (registrador con asignar_ubicacion)", async ()=>{ exigir(errores.length === 0, errores.join(" | ")); });
    await context.close();
  }
}

async function escenarioFallas(browser, base){
  {
    const falta = { code: "PGRST205", message: "Could not find the table 'public.ubicaciones' in the schema cache" };
    const fx = fixture({ fallas: { tipos_ubicacion: falta, ubicaciones: falta, equipos_radioenlace: falta, enlaces: falta, historial_ubicacion: falta } });
    const { context, page } = await abrirApp(browser, base, fx);
    await page.click(SEL.tab("mapa"));
    await verificar("sin las tablas del mapa: la pestaña explica que falta la migración 002", async ()=>{
      await page.waitForFunction(()=>/migraciones\/002/.test(document.getElementById("inventario-tecnologico-mapa-panel")?.innerText || ""));
    });
    await page.click(SEL.tab("activos"));
    await verificar("… y el resto de la app sigue funcionando (listado + detalle)", async ()=>{
      await page.locator("tr", { hasText: "LKM-001" }).first().click();
      await page.waitForFunction(()=>/No se pudo cargar la ubicación/.test(document.getElementById("inventario-tecnologico-ubicacion-activo")?.innerText || ""));
      exigir(/historial de custodia/i.test(await texto(page, "#inventario-tecnologico-modal-host")), "el detalle no cargó");
    });
    await context.close();
  }
  {
    const { context, page } = await abrirApp(browser, base, fixture(), { leafletFalla: true });
    await page.click(SEL.tab("mapa"));
    await verificar("si unpkg no responde: el mapa avisa y el panel sigue usable con los datos", async ()=>{
      await page.waitForFunction(()=>/No se pudo cargar la librería del mapa/.test(document.getElementById("inventario-tecnologico-mapa-canvas")?.innerText || ""));
      await page.click(`${SEL.panel} [data-accion="ver-ubicacion"][data-id="2"]`);
      await page.waitForFunction(()=>document.querySelector("#inventario-tecnologico-mapa-panel .inventario-tecnologico-mapa-panel-titulo")?.textContent === "Torre Santa Ana");
    });
    await context.close();
  }
}

async function escenarioCelular(browser, base){
  const { context, page, errores } = await abrirApp(browser, base, fixture(), { viewport: { width: 390, height: 844 } });
  await irAlMapa(page);
  await page.click(SEL.marcador("Torre Cerro Azul"));
  await page.click(`${SEL.panel} [data-accion="seleccionar-equipo"][data-id="11"]`);
  await verificar("celular (390 px): mapa arriba, panel abajo, sin scroll horizontal", async ()=>{
    await page.waitForFunction(sel=>document.querySelectorAll(sel).length === 2, SEL.lineas);
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
