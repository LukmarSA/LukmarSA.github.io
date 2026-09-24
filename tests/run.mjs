// Arnés de pruebas para los módulos ES de inventario-tecnologico.
//
// Uso:
//   cd tests && npm install && npm test
//   (o, si ya tienes jsdom instalado: node run.mjs)
//
// Qué hace: simula, con jsdom, una sesión ya autenticada con datos de
// prueba (fixtures.mjs) — no toca Supabase real — y ejercita las pantallas
// tal como las usaría una persona: tabla de activos, detalle/timeline,
// Configuración → Tipos y opciones, Historial por custodio, Pendientes de
// firma (con sus botones de acta) y el filtro del gestor de columnas.
// Sirve para detectar sin abrir un navegador si un cambio futuro rompe el
// grafo de módulos, el namespacing CSS/JS, o el cableado de alguna pantalla.
import { JSDOM } from "jsdom";
import { TABLAS, SESION_FAKE, crearClienteFake } from "./fixtures.mjs";

const RAIZ_APP = "../assets/js/inventario-tecnologico";

let fallos = 0, pruebas = 0;
function assert(cond, msg){
  pruebas++;
  if(!cond){ fallos++; console.log("FALLO:", msg); }
  else console.log("OK:", msg);
}

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="inventario-tecnologico-app"></div></body></html>`, { url: "http://localhost/" });
global.window = dom.window;
global.document = dom.window.document;
global.window.supabase = { createClient(){ return crearClienteFake(TABLAS, SESION_FAKE); } };

function disparar(el, tipo){
  el.dispatchEvent(new dom.window.Event(tipo, { bubbles:true }));
}
function esperar(ms){ return new Promise(r=>setTimeout(r,ms)); }

try{
  await import(`${RAIZ_APP}/entrada.js`);
  await esperar(300); // iniciar() es async (getSession + refrescarDatos)

  const root = document.getElementById("inventario-tecnologico-app");

  // ---------- Sesión + shell ----------
  assert(!!root.querySelector(".inventario-tecnologico-userchip"), "la sesión de admin inicia y el shell principal se renderiza");
  assert(root.innerHTML.includes("Configuración"), "la pestaña Configuración (solo admin) aparece");

  // ---------- Tabla de activos ----------
  const filasTabla = document.querySelectorAll("#inventario-tecnologico-tbody-activos tr");
  assert(filasTabla.length === 2, `la tabla muestra los 2 activos vigentes (encontrados: ${filasTabla.length})`);
  assert(root.innerHTML.includes("María López"), "el custodio vigente del activo 1 (María López) aparece en la tabla");
  assert(root.innerHTML.includes("Juan Pérez"), "el custodio vigente del activo 2 (Juan Pérez) aparece en la tabla");

  // ---------- Detalle + regresión de fmtFecha ----------
  const { fmtFecha } = await import(`${RAIZ_APP}/nucleo/helpers.js`);
  const esperado9 = fmtFecha("2026-09-09");
  const esperado8 = fmtFecha("2026-09-08");
  assert(esperado9 !== esperado8, "fmtFecha distingue 9 de septiembre de 8 de septiembre (sanity del propio formateador)");
  const { abrirDetalle } = await import(`${RAIZ_APP}/ui/detalle/vista.js`);
  abrirDetalle(2); // activo 2: Juan Pérez, tramo vigente desde 2026-09-09
  await esperar(20);
  const modalHost = document.getElementById("inventario-tecnologico-modal-host");
  assert(modalHost && modalHost.innerHTML.includes(esperado9), `el detalle del activo 2 muestra la fecha "${esperado9}" (9 de septiembre), no "8"`);
  assert(modalHost && !modalHost.innerHTML.includes(esperado8), `el detalle del activo 2 NO muestra "${esperado8}" (regresión del bug de huso horario)`);
  document.querySelector(".inventario-tecnologico-modal-close")?.click();
  await esperar(20);

  // ---------- Configuración → Tipos y opciones ----------
  const { renderConfigOpciones } = await import(`${RAIZ_APP}/ui/configuracion/tipos-propiedades-estados.js`);
  const contenedorTmp = document.createElement("div");
  document.body.appendChild(contenedorTmp);
  renderConfigOpciones(contenedorTmp);
  assert(contenedorTmp.innerHTML.includes("Laptop") && contenedorTmp.innerHTML.includes("Monitor"), "la pantalla de Tipos y opciones lista Laptop y Monitor");
  const filaMonitor = [...contenedorTmp.querySelectorAll("tr")].find(tr=>tr.textContent.includes("Monitor"));
  assert(!!filaMonitor && filaMonitor.textContent.includes("Inactivo"), "Monitor (activo=false) se muestra como Inactivo");
  const filaLaptop = [...contenedorTmp.querySelectorAll("tr")].find(tr=>tr.textContent.includes("Laptop"));
  assert(!!filaLaptop && filaLaptop.textContent.includes("Activo") && !filaLaptop.textContent.includes("Inactivo"), "Laptop (activo=true) se muestra como Activo");
  document.body.removeChild(contenedorTmp);

  // ---------- Historial por custodio ----------
  const { abrirHistorialCustodio } = await import(`${RAIZ_APP}/ui/listado/historial-custodio.js`);
  abrirHistorialCustodio();
  await esperar(20);
  const inputHc = document.getElementById("inventario-tecnologico-hc-buscar");
  inputHc.value = "Juan";
  disparar(inputHc, "input");
  await esperar(20);
  const resultadosHc = document.getElementById("inventario-tecnologico-hc-resultados");
  const filasHc = resultadosHc.querySelectorAll("tbody tr");
  assert(filasHc.length === 3, `"Juan" encuentra sus 3 tramos (activo 1 pasado + activo 2 vigente + baja) — encontrados: ${filasHc.length}`);
  assert(resultadosHc.innerHTML.includes("De baja"), "el tramo del activo dado de baja aparece marcado \"De baja\"");
  assert(resultadosHc.innerHTML.includes("Presente"), "el tramo vigente de Juan Pérez (activo 2) aparece como \"Presente\"");
  document.querySelector(".inventario-tecnologico-modal-close")?.click();
  await esperar(20);

  // ---------- Pendientes de firma + botones de acta ----------
  const { abrirPendientesFirma } = await import(`${RAIZ_APP}/ui/listado/pendientes-firma.js`);
  abrirPendientesFirma();
  await esperar(20);
  const hostPend = document.getElementById("inventario-tecnologico-modal-host");
  assert(hostPend.innerHTML.includes("María López"), "Pendientes de firma muestra el tramo de María López (pendiente_firma)");
  assert(!!document.getElementById("inventario-tecnologico-btn-marcar-todos-pendientes"), "el botón \"Marcar todos para acta unificada\" está en el footer");
  assert(!!document.getElementById("inventario-tecnologico-btn-generar-acta-pendientes"), "el botón \"Generar acta de entrega\" está en el footer");
  assert(!!document.querySelector("[data-marcar-pendiente]"), "cada fila con custodio vigente tiene su botón 🔖 de marcar individual");
  document.querySelector(".inventario-tecnologico-modal-close")?.click();
  await esperar(20);

  // ---------- Filtro de texto en el gestor de columnas ----------
  const { abrirGestorColumnas } = await import(`${RAIZ_APP}/ui/listado/columnas.js`);
  abrirGestorColumnas();
  await esperar(20);
  const totalColsAntes = document.querySelectorAll("#inventario-tecnologico-lista-cols [data-col-opt]").length;
  const inputCols = document.getElementById("inventario-tecnologico-filtro-cols-texto");
  inputCols.value = "serie";
  disparar(inputCols, "input");
  await esperar(20);
  const visiblesTrasFiltro = [...document.querySelectorAll("#inventario-tecnologico-lista-cols [data-col-opt]")].filter(f=>f.style.display !== "none").length;
  assert(totalColsAntes > 1, "el gestor de columnas lista varias columnas antes de filtrar");
  assert(visiblesTrasFiltro === 1, `filtrar por "serie" deja visible solo esa columna (visibles: ${visiblesTrasFiltro})`);
  document.querySelector(".inventario-tecnologico-modal-close")?.click();

  console.log(`\n=== ${pruebas-fallos}/${pruebas} pruebas OK ===`);
  process.exit(fallos>0 ? 1 : 0);
} catch(err){
  console.error("ERROR FATAL EN EL ARNÉS:");
  console.error(err.stack || err);
  process.exit(1);
}
