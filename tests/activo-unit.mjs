// Pruebas unitarias de nucleo/formulario-activo.js (modal «Nuevo activo» /
// «Editar»): campos según el tipo, qué se guarda y el orden/búsqueda de tipos.
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

console.log(`\n=== ${pruebas - fallos}/${pruebas} pruebas OK ===`);
process.exit(fallos ? 1 : 0);
