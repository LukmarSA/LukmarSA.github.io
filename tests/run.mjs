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

  // v10: «Editar» y «Desactivar» usan la clave real (nombre / valor). Hasta el
  // v9 buscaban un "id" que estas tablas no tienen: cualquier «Editar» abría
  // el primero de la lista y guardar fallaba con «column … id does not exist».
  const host = ()=>document.getElementById("inventario-tecnologico-modal-host");
  contenedorTmp.querySelector('[data-editar-tipo="Monitor"]').click();
  await esperar(20);
  assert(host().innerHTML.includes("Editar tipo de activo «Monitor»"), "«Editar» en Monitor abre Monitor (no el primero de la lista)");
  const inColor = document.getElementById("inventario-tecnologico-ct-color");
  inColor.value = "#112233";
  document.getElementById("inventario-tecnologico-btn-guardar-tipo-cfg").click();
  await esperar(60);
  const tMonitor = TABLAS.tipos_activo.find(t=>t.nombre === "Monitor"), tLaptop = TABLAS.tipos_activo.find(t=>t.nombre === "Laptop");
  assert(tMonitor.color === "#112233" && tLaptop.color === "#3A5068", `guardar cambia solo Monitor (Monitor ${tMonitor.color}, Laptop ${tLaptop.color})`);
  assert(!host().querySelector(".inventario-tecnologico-modal"), "al guardar se cierra el modal");
  contenedorTmp.querySelector('[data-toggle-tipo="Laptop"]').click();
  await esperar(60);
  assert(TABLAS.tipos_activo.find(t=>t.nombre === "Laptop").activo === false && TABLAS.tipos_activo.find(t=>t.nombre === "Monitor").activo === false, "«Desactivar» en Laptop desactiva Laptop");
  contenedorTmp.querySelector('[data-toggle-tipo="Laptop"]').click();
  await esperar(60);
  assert(TABLAS.tipos_activo.find(t=>t.nombre === "Laptop").activo === true, "«Activar» lo vuelve a activar");
  contenedorTmp.querySelector('[data-editar-propiedad="rentado"]').click();
  await esperar(20);
  document.getElementById("inventario-tecnologico-cp-etiqueta").value = "En renta";
  document.getElementById("inventario-tecnologico-btn-guardar-propiedad-cfg").click();
  await esperar(60);
  assert(TABLAS.propiedad_opciones.find(o=>o.valor === "rentado").etiqueta === "En renta" && TABLAS.propiedad_opciones.find(o=>o.valor === "lukmar").etiqueta === "Lukmar", "editar una propiedad cambia solo esa (por su valor)");
  contenedorTmp.querySelector('[data-toggle-estado="danado"]').click();
  await esperar(60);
  assert(TABLAS.estado_opciones.find(o=>o.valor === "danado").activo === true && TABLAS.estado_opciones.find(o=>o.valor === "operativo").activo === true, "activar un estado cambia solo ese (por su valor)");
  const { editarTipoActivo } = await import(`${RAIZ_APP}/nucleo/opciones-configurables.js`);
  let errorSinClave = null;
  try{ await editarTipoActivo(undefined, { color: "#000000", icono_svg: "", campos_pertinentes: [] }); }catch(e){ errorSinClave = e; }
  assert(!!errorSinClave && TABLAS.tipos_activo.every(t=>t.color !== "#000000"), "sin clave no se guarda nada (antes, un filtro vacío podía tocar todas las filas)");
  assert(contenedorTmp.innerHTML.includes("Campos de los activos") && contenedorTmp.innerHTML.includes("migración 012"), "sin la 012: la sección de campos avisa que hace falta la migración");
  assert(contenedorTmp.innerHTML.includes("Tipos de ubicación"), "Configuración muestra también los tipos de ubicación");
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
