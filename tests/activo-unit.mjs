// Pruebas unitarias de nucleo/formulario-activo.js (modal «Nuevo activo» /
// «Editar»): campos según el tipo, qué se guarda y el orden/búsqueda de tipos.
// v10: también nucleo/campos-personalizados.js (campos configurables) y
// nucleo/svg-seguro.js (íconos limpios).
// Uso: cd tests && node activo-unit.mjs
import { CLAVE_GUARDADO, camposParaGuardar, camposVisibles, filtrarYOrdenar, normalizarBusqueda, ordenSiguiente } from "../assets/js/inventario-tecnologico/nucleo/formulario-activo.js";

let pruebas = 0, fallos = 0;
function ok(cond, msg){ pruebas++; if(cond) console.log("OK:", msg); else { fallos++; console.log("FALLO:", msg); } }
const lista = s=>[...s].sort().join(",");

// Mismas listas que nucleo/opciones-configurables.js
const BLOQ = ["serie","so","ram_gb","disco_gb","procesador","mac_wifi","mac_ethernet"];
const EXTRA = ["color","longitud_m"];

ok(lista(camposVisibles({ tipo:"Laptop", pertinentes: BLOQ, bloqueables: BLOQ, extras: EXTRA })) === "disco_gb,mac_ethernet,mac_wifi,procesador,ram_gb,serie,so", "Laptop: todos los de cómputo, sin extras ni celular");
ok(lista(camposVisibles({ tipo:"Antena", pertinentes: ["serie","mac_ethernet"], bloqueables: BLOQ, extras: EXTRA })) === "mac_ethernet,serie", "Antena: solo serie y MAC Ethernet");
ok(lista(camposVisibles({ tipo:"Cable", pertinentes: ["color","longitud_m"], bloqueables: BLOQ, extras: EXTRA })) === "color,longitud_m", "Cable: solo color y longitud");
ok(lista(camposVisibles({ tipo:"Celular", pertinentes: ["serie"], bloqueables: BLOQ, extras: EXTRA })) === "celular,serie", "Celular: agrega el bloque de celular");
ok(camposVisibles({ tipo:"X", pertinentes: ["inventado"], bloqueables: BLOQ, extras: EXTRA }).size === 0, "un campo pertinente desconocido no aparece");
ok(camposVisibles().size === 0, "sin parámetros no revienta");

const valores = { tipo:"Antena", propiedad:"lukmar", marca:"Cambium", modelo:"F300", nombre_dispositivo:"", proveedor:"", fecha_adquisicion:"", valor_compra:"", vida_util_anios:"3",
  serie:"SN-1", sistema_operativo:"Linux", ram_gb:"8", disco_gb:"", procesador:"", mac_wifi:"", mac_ethernet:"AA:BB", color:"rojo", longitud_m:"2", gmail:"x@gmail.com", password:"123" };
const COMUNES = ["tipo","propiedad","marca","modelo","nombre_dispositivo","proveedor","fecha_adquisicion","valor_compra","vida_util_anios"];
const g = camposParaGuardar(valores, new Set(["serie","mac_ethernet"]), { comunes: COMUNES });
ok(g.serie === "SN-1" && g.mac_ethernet === "AA:BB", "guarda los campos visibles del tipo");
ok(!("sistema_operativo" in g) && !("ram_gb" in g) && !("color" in g) && !("longitud_m" in g), "no envía los campos que el tipo oculta");
ok(!("gmail" in g) && !("password" in g), "sin el bloque de celular no envía gmail ni password");
ok(COMUNES.every(k=>k in g), "los comunes van siempre");
const gc = camposParaGuardar(valores, new Set(["celular"]), { comunes: COMUNES });
ok(gc.gmail === "x@gmail.com" && gc.password === "123", "con el bloque de celular envía gmail y password");
ok(Object.keys(CLAVE_GUARDADO).length === BLOQ.length + EXTRA.length && BLOQ.concat(EXTRA).every(c=>c in CLAVE_GUARDADO), "hay clave de guardado para cada campo opcional");
ok(CLAVE_GUARDADO.so === "sistema_operativo", "«so» se guarda como sistema_operativo");

ok(normalizarBusqueda("  Cámara IP ") === "camara ip", "normaliza tildes, mayúsculas y espacios");
ok(normalizarBusqueda(null) === "" && normalizarBusqueda(undefined) === "", "null/undefined → vacío");
ok(normalizarBusqueda("ÑANDÚ") === "nandu", "la ñ se busca como n");

const tipos = ["Switch 16 puertos","Laptop","Cámara IP","Antena","Cable","Switch 8 puertos","Celular","monitor"].map(e=>({ valor:e, etiqueta:e }));
ok(filtrarYOrdenar(tipos).map(o=>o.etiqueta).join("|") === "Antena|Cable|Cámara IP|Celular|Laptop|monitor|Switch 8 puertos|Switch 16 puertos", "A–Z: sin distinguir tildes ni mayúsculas, números en orden natural");
ok(filtrarYOrdenar(tipos, { orden:"desc" }).map(o=>o.etiqueta).join("|") === "Switch 16 puertos|Switch 8 puertos|monitor|Laptop|Celular|Cámara IP|Cable|Antena", "Z–A: exactamente al revés");
ok(filtrarYOrdenar(tipos, { texto:"CAM" }).map(o=>o.etiqueta).join("|") === "Cámara IP", "buscar «CAM» encuentra «Cámara IP»");
ok(filtrarYOrdenar(tipos, { texto:"switch" }).length === 2, "buscar «switch» encuentra los dos");
ok(filtrarYOrdenar(tipos, { texto:"zzz" }).length === 0, "sin coincidencias → lista vacía");
ok(filtrarYOrdenar(tipos).length === tipos.length && tipos[0].etiqueta === "Switch 16 puertos", "no modifica la lista original");
ok(ordenSiguiente("asc") === "desc" && ordenSiguiente("desc") === "asc" && ordenSiguiente(undefined) === "desc", "alterna el orden");

// ---------------------------------------------------------------------------
// v10: campos configurables (nucleo/campos-personalizados.js)
// ---------------------------------------------------------------------------
const C = await import("../assets/js/inventario-tecnologico/nucleo/campos-personalizados.js");
const S = await import("../assets/js/inventario-tecnologico/nucleo/svg-seguro.js");

ok(C.CAMPOS_FIJOS.length === 9 && C.CAMPOS_FIJOS.every(c=>c.fijo && c.columna), "9 campos fijos, cada uno con su columna");
ok(C.CAMPOS_BLOQUEABLES.join() === BLOQ.join() && C.CAMPOS_EXTRA.join() === EXTRA.join(), "los 7 de cómputo y los 2 extra son los de siempre");
ok(C.CAMPOS_FIJOS.find(c=>c.clave === "so").columna === "sistema_operativo", "«so» vive en la columna sistema_operativo");
ok(Object.values(C.CLAVE_CAMPO_POR_COLUMNA).every(k=>C.CAMPOS_FIJOS.some(c=>c.clave === k)), "cada columna de la tabla apunta a un campo fijo");

const sin012 = C.definicionesDeCampos([], { hay012: false });
ok(sin012.length === 9 && sin012.map(d=>d.clave).join() === "serie,so,ram_gb,disco_gb,procesador,mac_wifi,mac_ethernet,color,longitud_m", "sin la 012: los 9 de siempre, en su orden");
const filas = [
  ...C.CAMPOS_FIJOS.map(c=>({ ...c, etiqueta: c.clave === "serie" ? "Número de serie" : c.etiqueta })),
  { id: 20, clave: "imei", etiqueta: "IMEI", tipo_dato: "texto", fijo: false, unico: true, en_acta: true, orden: 15, activo: true },
  { id: 21, clave: "capacidad", etiqueta: "Capacidad", tipo_dato: "numero", unidad: "VA", fijo: false, orden: 95, activo: true },
  { id: 22, clave: "operadora", etiqueta: "Operadora", tipo_dato: "lista", opciones: [{ valor: "claro", etiqueta: "Claro" }, { valor: "cnt", etiqueta: "CNT", activo: false }], fijo: false, orden: 96, activo: true },
  { id: 23, clave: "garantia", etiqueta: "Garantía hasta", tipo_dato: "fecha", fijo: false, orden: 97, activo: true },
  { id: 24, clave: "propio", etiqueta: "¿Propio?", tipo_dato: "si_no", fijo: false, orden: 98, activo: true },
  { id: 25, clave: "viejo", etiqueta: "Viejo", tipo_dato: "texto", fijo: false, orden: 99, activo: false },
  { id: 26, clave: "Mal Formada", etiqueta: "X", tipo_dato: "texto", orden: 1 },
];
const defs = C.definicionesDeCampos(filas, { hay012: true });
ok(defs.length === 15 && !defs.some(d=>d.clave === "Mal Formada"), "con la 012: las filas válidas (una clave mal formada se ignora)");
ok(defs.map(d=>d.clave).slice(0, 3).join() === "serie,imei,so", "un solo orden: IMEI (15) queda entre la serie (10) y el SO (20)");
ok(defs.find(d=>d.clave === "serie").etiqueta === "Número de serie", "la etiqueta de un fijo se puede cambiar");
ok(C.definicionesDeCampos([filas[9]], { hay012: true }).length === 10, "si a la tabla le faltan fijos, se completan con los de fábrica");
const op = defs.find(d=>d.clave === "operadora");
ok(op.opciones.length === 2 && op.opciones[0].activo === true && op.opciones[1].activo === false, "las opciones de una lista se normalizan (activo por defecto)");

const celular = { nombre: "Celular", campos_pertinentes: ["serie", "imei", "operadora", "viejo"], campos_obligatorios: ["imei", "capacidad"] };
ok(C.camposDelTipo(defs, celular).map(d=>d.clave).join() === "serie,imei,operadora", "el tipo ve solo sus campos activos, en el orden global (el desactivado no)");
ok(C.camposDelTipo(defs, null).map(d=>d.clave).join() === "serie,so,ram_gb,disco_gb,procesador,mac_wifi,mac_ethernet", "un activo sin tipo configurado ve los 7 de cómputo");
ok([...C.obligatoriosDelTipo(celular)].join() === "imei", "obligatorio solo si el tipo también usa el campo");
ok(C.obligatoriosDelTipo(null).size === 0 && C.obligatoriosDelTipo({ campos_pertinentes: ["serie"] }).size === 0, "sin campos_obligatorios: ninguno");

const imei = defs.find(d=>d.clave === "imei"), cap = defs.find(d=>d.clave === "capacidad"), gar = defs.find(d=>d.clave === "garantia"), prop = defs.find(d=>d.clave === "propio");
const ram = defs.find(d=>d.clave === "ram_gb");
const a1 = { id: 1, tipo: "Celular", serie: "SN-1", ram_gb: 8, personalizados: { imei: "35-111", capacidad: 1500, operadora: "cnt", propio: false } };
ok(C.valorCrudo(a1, ram) === 8 && C.valorCrudo(a1, imei) === "35-111" && C.valorCrudo({}, imei) === null, "el valor sale de la columna (fijos) o de personalizados (nuevos)");
ok(C.normalizarValor(imei, "  35 - 111  ").valor === "35 - 111", "texto: sin espacios de más");
ok(C.normalizarValor(imei, "").valor === null && C.normalizarValor(imei, "   ").valor === null && C.normalizarValor(imei, null).valor === null, "vacío → null");
ok(C.normalizarValor(imei, "x".repeat(501)).ok === false, "texto: hasta 500 caracteres");
ok(C.normalizarValor(cap, "1,5").valor === 1.5 && C.normalizarValor(cap, "1.234,5").valor === 1234.5 && C.normalizarValor(cap, "1,234.5").valor === 1234.5 && C.normalizarValor(cap, " 2000 ").valor === 2000, "número: acepta coma o punto decimal y separador de miles");
ok(C.normalizarValor(cap, "mucho").ok === false && C.normalizarValor(cap, "1,2,3x").ok === false, "número: rechaza lo que no es número");
ok(C.normalizarValor(gar, "2027-01-31").valor === "2027-01-31" && C.normalizarValor(gar, "2027-02-30").ok === false && C.normalizarValor(gar, "31/01/2027").ok === false, "fecha: AAAA-MM-DD y que exista");
ok(C.normalizarValor(prop, "si").valor === true && C.normalizarValor(prop, "Sí").valor === true && C.normalizarValor(prop, "no").valor === false && C.normalizarValor(prop, "tal vez").ok === false, "sí/no");
ok(C.normalizarValor(op, "claro").valor === "claro" && C.normalizarValor(op, "movistar").ok === false, "lista: solo sus opciones");
ok(C.normalizarValor(op, "cnt").ok === false && C.normalizarValor(op, "cnt", { valorActual: "cnt" }).ok === true, "lista: una opción desactivada solo si ya era el valor del activo");
ok(C.textoValor(cap, 1500) === "1500 VA" && C.textoValor(ram, 16) === "16 GB" && C.textoValor(op, "cnt") === "CNT" && C.textoValor(prop, false) === "No" && C.textoValor(imei, null) === "", "texto para mostrar (unidad, etiqueta de la opción, Sí/No, vacío)");
ok(C.etiquetaConUnidad(cap) === "Capacidad (VA)" && C.etiquetaConUnidad(imei) === "IMEI", "etiqueta con la unidad");
ok(C.valorParaOrdenar(cap, 900) === 900 && C.valorParaOrdenar(cap, null) === 0 && C.valorParaOrdenar(gar, "2027-01-31") === "2027-01-31", "ordenar: números como números, fechas ISO");
ok(C.valorParaExcel(cap, 1500) === 1500 && C.valorParaExcel(op, "cnt") === "CNT" && C.valorParaExcel(prop, true) === "Sí" && C.valorParaExcel(imei, null) === "", "Excel: número como número, lista y sí/no con su texto");

const activos = [a1, { id: 2, serie: "sn-1 ", personalizados: { imei: " 35-111", capacidad: 1500.0 } }, { id: 3, personalizados: { imei: "35-222" } }];
ok(C.buscarRepetido(imei, "35-111", activos, 1)?.id === 2, "único: encuentra otro activo con el mismo valor (sin espacios ni mayúsculas)");
ok(C.buscarRepetido(imei, "35-111", [a1], 1) === null && C.buscarRepetido(imei, "", activos, null) === null, "único: el propio activo y los vacíos no cuentan");
ok(C.buscarRepetido(cap, "1500.00", activos, 3)?.id === 1, "único en números: 1500 y 1500.00 son lo mismo");
ok(C.buscarRepetido(defs.find(d=>d.clave === "serie"), "SN-1", activos, 1)?.id === 2, "único también en un fijo (la serie, en su columna)");
ok(C.repetidosActuales(imei, activos).length === 1 && C.repetidosActuales(gar, activos).length === 0, "repetidos que ya hay (antes de marcar «único»)");

const visibles = C.camposDelTipo(defs, { campos_pertinentes: ["serie", "imei", "capacidad"] });
const parche = C.parchePersonalizados(visibles, { serie: "X", imei: "35-9", capacidad: null });
ok(JSON.stringify(parche) === '{"imei":"35-9","capacidad":null}', "a personalizados van solo los campos nuevos que se ven (el vaciado, como null)");
ok(JSON.stringify(C.personalizadosIniciales(parche)) === '{"imei":"35-9"}', "al crear: solo los que tienen valor");
ok(C.partesActa(defs, a1, celular).join(" | ") === "IMEI: 35-111", "acta: los campos «en el acta» que usa el tipo (sin repetir la serie)");
ok(C.partesActa(defs, { ...a1, personalizados: {} }, celular).length === 0, "acta: sin valor, no sale");

ok(C.claveDesdeEtiqueta("Número de línea", defs) === "numero_de_linea", "clave desde la etiqueta: sin tildes, en minúsculas y con _");
ok(C.claveDesdeEtiqueta("IMEI", defs) === "imei_2" && C.claveDesdeEtiqueta("Serie", defs) === "serie_2", "clave: no choca con otra ni con un fijo");
ok(C.claveDesdeEtiqueta("Estado", []) === "estado_2" && C.claveDesdeEtiqueta("Celular", []) === "celular_2", "clave: no usa nombres reservados");
ok(C.claveDesdeEtiqueta("2 puertos", []) === "c_2_puertos" && C.claveDesdeEtiqueta("¿?", []) === "campo", "clave: empieza con letra; sin letras, «campo»");
ok(C.FORMATO_CLAVE.test(C.claveDesdeEtiqueta("x".repeat(80), [])), "clave: hasta 40 caracteres");
ok(C.valorDeOpcion("Claro Móvil", [{ valor: "claro_movil" }]) === "claro_movil_2", "valor de una opción: sin chocar");

let v = C.validarDefinicion({ etiqueta: "imei ", tipo_dato: "texto" }, defs);
ok(!v.ok && /Ya hay un campo/.test(v.errores[0]), "validar: etiqueta repetida (sin mayúsculas ni espacios)");
ok(C.validarDefinicion({ etiqueta: "IMEI", tipo_dato: "texto" }, defs, { claveActual: "imei" }).ok, "validar: al editar, su propia etiqueta vale");
ok(!C.validarDefinicion({ etiqueta: "", tipo_dato: "texto" }, defs).ok && !C.validarDefinicion({ etiqueta: "X", tipo_dato: "raro" }, defs).ok, "validar: etiqueta vacía o tipo de dato desconocido");
ok(!C.validarDefinicion({ etiqueta: "F", tipo_dato: "fecha", unico: true }, defs).ok, "validar: «único» solo en texto o número");
ok(!C.validarDefinicion({ etiqueta: "L", tipo_dato: "lista", opciones: [] }, defs).ok && !C.validarDefinicion({ etiqueta: "L", tipo_dato: "lista", opciones: [{ valor: "a", etiqueta: "A" }, { valor: "b", etiqueta: " a " }] }, defs).ok, "validar: lista sin opciones o con opciones repetidas");
ok(C.validarDefinicion({ etiqueta: "L", tipo_dato: "lista", opciones: [{ valor: "a", etiqueta: "A" }] }, defs).ok, "validar: lista con una opción");

const cambios = C.moverCampo(defs, "imei", "arriba");
ok(cambios.length === 2 && cambios.find(x=>x.clave === "imei").orden === 10 && cambios.find(x=>x.clave === "serie").orden === 15, "mover: intercambia el orden con el vecino");
ok(C.moverCampo(defs, "serie", "arriba").length === 0 && C.moverCampo(defs, "viejo", "abajo").length === 0, "mover: en el borde no hace nada");
const repetidos = [{ clave: "a", etiqueta: "A", orden: 10 }, { clave: "b", etiqueta: "B", orden: 10 }, { clave: "c", etiqueta: "C", orden: 10 }];
const ren = C.moverCampo(repetidos, "c", "arriba");
ok(ren.length >= 2 && ren.find(x=>x.clave === "c").orden === 20 && ren.find(x=>x.clave === "b").orden === 30, "mover: con órdenes repetidos renumera de 10 en 10");
ok(C.siguienteOrden(defs) === 109 && C.siguienteOrden([]) === 10, "orden de un campo nuevo: al final");

// ---------------------------------------------------------------------------
// v10: SVG limpios (nucleo/svg-seguro.js)
// ---------------------------------------------------------------------------
const BI = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-laptop" viewBox="0 0 16 16"><path d="M13.5 3a.5.5 0 0 1 .5.5V11H2V3.5a.5.5 0 0 1 .5-.5z"/></svg>';
ok(S.limpiarSvg(BI) === BI, "un ícono normal (Bootstrap Icons) queda igual");
ok(S.limpiarSvg('<?xml version="1.0"?><!-- c --><svg viewBox="0 0 1 1"><path d="M0 0"/></svg>') === '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>', "se quitan la declaración XML y los comentarios");
const malo = '<svg viewBox="0 0 16 16" onload="alert(1)"><script>alert(2)</script><foreignObject><div>x</div></foreignObject><a href="javascript:alert(3)"><circle r="2" onclick=\'x()\'/></a><use href="https://mal.com/x.svg#a"/><use href="#b"/><rect style="fill:url(https://mal.com/a)"/><rect fill="url(#g)"/></svg>';
const limpio = S.limpiarSvg(malo);
ok(!/onload|onclick|<script|foreignObject|javascript|mal\.com|<a\b/i.test(limpio), "se quitan scripts, eventos, foreignObject, enlaces y url() hacia afuera: " + limpio);
ok(limpio.includes('<use href="#b"/>') && limpio.includes('url(#g)') && limpio.includes('<circle r="2"/>'), "se conservan las referencias internas y el dibujo");
ok(S.limpiarSvg("no es svg") === "" && S.limpiarSvg("<svg>sin cerrar") === "" && S.limpiarSvg("") === "" && S.limpiarSvg("<svg>" + "x".repeat(20001) + "</svg>") === "", "lo que no es un SVG completo (o es enorme) queda vacío");
ok(S.validarSvg("").ok && S.validarSvg("").svg === "", "validar: vacío = sin ícono");
ok(!S.validarSvg("hola").ok && /empezar con <svg/.test(S.validarSvg("hola").error), "validar: tiene que empezar con <svg");
ok(!S.validarSvg('<svg viewBox="0 0 16 16"></svg>', { exigir16: true }).ok && S.validarSvg(BI, { exigir16: true }).ok, "validar: los tipos de activo piden width=16 height=16");
ok(!S.validarSvg('<svg width="16" height="16"></svg>', { exigirViewBox: true }).ok && S.validarSvg(BI, { exigirViewBox: true }).ok, "validar: los de ubicación piden viewBox");
ok(S.validarSvg(malo).ok && S.validarSvg(malo).limpiado === true, "validar: uno con partes peligrosas se acepta limpio (y lo avisa)");
ok(S.svgConTamano(BI, 15).startsWith('<svg aria-hidden="true" width="15" height="15"') && !S.svgConTamano(BI, 15).includes('width="16"'), "a otro tamaño: cambia width y height de la raíz");
ok(S.svgConTamano('<svg viewBox="0 0 2 2"><rect width="16" height="16"/></svg>', 20).includes('<rect width="16" height="16"/>'), "a otro tamaño: no toca los width/height de adentro");
ok(S.svgConTamano('<svg viewBox="0 0 2 2"><path/></svg>', 15).includes(' fill="currentColor">') && !S.svgConTamano(BI, 15).includes('fill="currentColor" fill='), "a otro tamaño: sin fill en la raíz, rellena con el color del texto (y no duplica un fill que ya está)");
ok(S.svgConTamano('<svg viewBox="0 0 2 2" fill="none"><path/></svg>', 15).includes('fill="none"') && !S.svgConTamano('<svg viewBox="0 0 2 2" fill="none"><path/></svg>', 15).includes("currentColor"), "a otro tamaño: un fill propio se respeta");
// Trucos para que, al sacar una parte, lo de los lados forme otra peligrosa,
// y atributos pegados a una barra o a una comilla (el navegador los lee igual).
const trucos = {
  "evento pegado a una barra": '<svg viewBox="0 0 16 16"><path/onload="alert(1)" d="M0 0"/></svg>',
  "evento pegado a la comilla anterior": '<svg viewBox="0 0 16 16"><path d="M0 0"onload="alert(1)"/></svg>',
  "dos eventos seguidos sin espacio": '<svg viewBox="0 0 16 16"><path onclick="a"onload="b" d="M0 0"/></svg>',
  "script que se rearma al sacar otro": '<svg viewBox="0 0 16 16"><scr<script></script>ipt>alert(1)</scr<script></script>ipt><path d="M0 0"/></svg>',
  "javascript: que se rearma": '<svg viewBox="0 0 16 16"><use href="#a" style="x:javajavascript:script:1"/></svg>',
  "enlace externo pegado a uno interno": '<svg viewBox="0 0 16 16"><use href="#a"xlink:href="https://x.y/z.svg#a"/></svg>',
  "animaciones (set/animate)": '<svg viewBox="0 0 16 16"><set attributeName="onclick" to="alert(1)"/><animate onbegin="alert(1)" attributeName="x" dur="1s"/><path d="M0 0"/></svg>',
  "evento en mayúsculas y sin comillas": '<svg viewBox="0 0 16 16"><path ONLOAD=alert(1) d="M0 0"/></svg>',
};
for(const [nombre, svg] of Object.entries(trucos)){
  const r = S.limpiarSvg(svg);
  ok(r.startsWith("<svg") && !/[\s/"']on[a-z]+\s*=|<script|javascript:|https:|<set\b|<animate\b/i.test(r), `truco neutralizado (${nombre}): ${r}`);
}
ok(S.limpiarSvg('<svg viewBox="0 0 16 16"><path o onload="" nload="alert(1)" d="M0 0"/></svg>').includes(' o nload='), "al sacar un evento no se juntan las palabras de los lados");
ok(S.limpiarSvg('<svg viewBox="0 0 16 16"><path d=\'x>\'onload=alert(1)>t</path></svg>').startsWith('<svg viewBox="0 0 16 16"><path d x>'), "un «>» dentro de una comilla no deja un atributo sin revisar");

console.log(`\n=== ${pruebas - fallos}/${pruebas} pruebas OK ===`);
process.exit(fallos ? 1 : 0);
