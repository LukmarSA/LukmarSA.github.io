// Pruebas unitarias de la lógica pura del mapa (nucleo/geo.js,
// nucleo/mapa-logica.js, nucleo/mapa-jerarquia.js, nucleo/plano-mapa.js y
// nucleo/mapa-nombres.js, nucleo/piscinas.js, nucleo/selector-servidor.js). No necesitan navegador
// ni Supabase.
//   node mapa-unit.mjs        (o: npm run test:mapa)
process.env.TZ = "America/Guayaquil"; // para probar el caso "después de las 19:00" de hoyLocalISO

import assert from "node:assert/strict";
import * as geo from "../assets/js/inventario-tecnologico/nucleo/geo.js";
import * as H from "../assets/js/inventario-tecnologico/nucleo/helpers.js";
import * as L from "../assets/js/inventario-tecnologico/nucleo/mapa-logica.js";
import * as J from "../assets/js/inventario-tecnologico/nucleo/mapa-jerarquia.js";
import * as PL from "../assets/js/inventario-tecnologico/nucleo/plano-mapa.js";
import * as N from "../assets/js/inventario-tecnologico/nucleo/mapa-nombres.js";
import * as PI from "../assets/js/inventario-tecnologico/nucleo/piscinas.js";
import * as SS from "../assets/js/inventario-tecnologico/nucleo/selector-servidor.js";
import { htmlPin } from "../assets/js/inventario-tecnologico/ui/mapa/leaflet.js";
import * as SOLO from "../assets/js/inventario-tecnologico/nucleo/solo-esta.js";
import * as FM from "../assets/js/inventario-tecnologico/nucleo/filtros-mapa.js";
import * as BO from "../assets/js/inventario-tecnologico/nucleo/buscar-opciones.js";
import * as LA from "../assets/js/inventario-tecnologico/nucleo/lineas-agrupadas.js";
import * as CO from "../assets/js/inventario-tecnologico/nucleo/cobertura.js";
import * as TU from "../assets/js/inventario-tecnologico/nucleo/tooltip-ubicacion.js";
import * as IE from "../assets/js/inventario-tecnologico/ui/mapa/iconos-equipo.js";
import * as MR from "../assets/js/inventario-tecnologico/nucleo/modo-red.js";

let ok = 0, total = 0;
const fallas = [];
function prueba(nombre, fn){
  total++;
  try{ fn(); ok++; console.log("OK: " + nombre); }
  catch(err){ fallas.push(nombre); console.log("FALLA: " + nombre + "\n   " + (err && err.message)); }
}
const cerca = (a, b, tol, msg)=>assert.ok(Math.abs(a - b) <= tol, `${msg || ""} esperado ≈${b} ± ${tol}, obtenido ${a}`);

// ---------------------------------------------------------------- geo
prueba("distancia: 1° de latitud sobre un meridiano ≈ 111.195 km", ()=>cerca(geo.distanciaKm({lat:0,lng:0},{lat:1,lng:0}), 111.195, 0.01));
prueba("distancia: mismo punto = 0", ()=>assert.equal(geo.distanciaKm({lat:-2.19,lng:-79.88},{lat:-2.19,lng:-79.88}), 0));
prueba("distancia: Guayaquil–Quito ≈ 270 km (orden de magnitud real)", ()=>cerca(geo.distanciaKm({lat:-2.1894,lng:-79.8891},{lat:-0.1807,lng:-78.4678}), 270, 6));
prueba("distancia simétrica", ()=>{
  const a = {lat:-2.1735,lng:-79.9587}, b = {lat:-2.1839,lng:-79.8756};
  assert.equal(geo.distanciaKm(a,b), geo.distanciaKm(b,a));
});
prueba("azimut: norte 0°, este 90°, sur 180°, oeste 270°", ()=>{
  cerca(geo.azimutGrados({lat:0,lng:0},{lat:1,lng:0}), 0, 1e-9);
  cerca(geo.azimutGrados({lat:0,lng:0},{lat:0,lng:1}), 90, 1e-9);
  cerca(geo.azimutGrados({lat:1,lng:0},{lat:0,lng:0}), 180, 1e-9);
  cerca(geo.azimutGrados({lat:0,lng:1},{lat:0,lng:0}), 270, 1e-9);
});
prueba("azimut de vuelta ≈ ida + 180° en un enlace corto", ()=>{
  const a = {lat:-2.1735,lng:-79.9587}, b = {lat:-2.1839,lng:-79.8756};
  const ida = geo.azimutGrados(a,b), vuelta = geo.azimutGrados(b,a);
  cerca(((vuelta - ida) + 360) % 360, 180, 0.01);
});
prueba("punto cardinal (rosa de 16, en español)", ()=>{
  assert.equal(geo.puntoCardinal(0), "N"); assert.equal(geo.puntoCardinal(45), "NE");
  assert.equal(geo.puntoCardinal(90), "E"); assert.equal(geo.puntoCardinal(225), "SO");
  assert.equal(geo.puntoCardinal(270), "O"); assert.equal(geo.puntoCardinal(337.5), "NNO");
  assert.equal(geo.puntoCardinal(359), "N"); assert.equal(geo.puntoCardinal(-90), "O");
});
prueba("formato de distancia: m / km con 2 decimales / km enteros", ()=>{
  assert.equal(geo.fmtDistancia(0.85), "850 m");
  assert.equal(geo.fmtDistancia(5.2449), "5.24 km");
  assert.equal(geo.fmtDistancia(150.4), "150 km");
  assert.equal(geo.fmtDistancia(NaN), "—");
});
prueba("formato de azimut", ()=>assert.equal(geo.fmtAzimut(47.26), "47.3° NE"));

const coords = (t)=>geo.parsearCoordenadas(t);
const esPar = (r, lat, lng, tol = 1e-6)=>{ assert.ok(r.ok, "debía parsear: " + r.error); cerca(r.lat, lat, tol, "lat"); cerca(r.lng, lng, tol, "lng"); };
prueba("coordenadas: formato de Google Maps (clic derecho)", ()=>esPar(coords("-2.189400, -79.889100"), -2.1894, -79.8891));
prueba("coordenadas: separadas por espacio", ()=>esPar(coords("-2.1894 -79.8891"), -2.1894, -79.8891));
prueba("coordenadas: comas decimales con punto y coma", ()=>esPar(coords("-2,1894; -79,8891"), -2.1894, -79.8891));
prueba("coordenadas: comas decimales separadas por espacio", ()=>esPar(coords("-2,1894 -79,8891"), -2.1894, -79.8891));
prueba("coordenadas: con símbolo de grados suelto", ()=>esPar(coords("-2.1894°, -79.8891°"), -2.1894, -79.8891));
prueba("coordenadas: enlace de Google Maps con @lat,lng,zoom", ()=>esPar(coords("https://www.google.com/maps/@-2.1712345,-79.9223456,17z"), -2.1712345, -79.9223456));
prueba("coordenadas: enlace de lugar (!3d!4d gana sobre @, es el punto exacto)", ()=>esPar(coords("https://www.google.com/maps/place/X/@-2.17,-79.92,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-2.1733!4d-79.9251"), -2.1733, -79.9251));
prueba("coordenadas: enlace con ?q=lat,lng", ()=>esPar(coords("https://maps.google.com/?q=-2.1894,-79.8891"), -2.1894, -79.8891));
prueba("coordenadas: grados/minutos/segundos con W", ()=>esPar(coords(`2°11'21.8"S 79°53'20.8"W`), -(2 + 11/60 + 21.8/3600), -(79 + 53/60 + 20.8/3600), 1e-9));
prueba("coordenadas: grados/minutos/segundos con O (oeste) y comillas tipográficas", ()=>esPar(coords("2°11′21,8″S 79°53′20,8″O"), -(2 + 11/60 + 21.8/3600), -(79 + 53/60 + 20.8/3600), 1e-9));
prueba("coordenadas: latitud imposible sugiere que están invertidas", ()=>{
  const r = coords("-179.5, 45.2");
  assert.equal(r.ok, false); assert.match(r.error, /invertidas/);
});
prueba("coordenadas: vacío y texto cualquiera dan error legible", ()=>{
  assert.equal(coords("").ok, false);
  const r = coords("cerca del parque");
  assert.equal(r.ok, false); assert.match(r.error, /No reconozco/);
});
prueba("coordenadas válidas / formato", ()=>{
  assert.equal(geo.coordenadasValidas(-2.19, -79.88), true);
  assert.equal(geo.coordenadasValidas(91, 0), false);
  assert.equal(geo.fmtCoordenadas(-2.1894, -79.8891), "-2.189400, -79.889100");
  assert.equal(geo.urlGoogleMaps(-2.1894, -79.8891), "https://www.google.com/maps?q=-2.189400,-79.889100");
});

// ---------------------------------------------------------------- lógica
const tipos = [
  { valor:"torre", etiqueta:"Torre", color:"#EC741D", orden:10, activo:true },
  { valor:"oficina", etiqueta:"Oficina", color:"#004DAB", orden:20, activo:true },
  { valor:"bodega", etiqueta:"Bodega", color:"#A6710B", orden:30, activo:false },
];
const ubicaciones = [
  { id:1, nombre:"Torre Cerro Azul", tipo:"torre", lat:-2.1735, lng:-79.9587, activa:true },
  { id:2, nombre:"Torre Santa Ana", tipo:"torre", lat:-2.1839, lng:-79.8756, activa:true },
  { id:3, nombre:"Oficína Centro", tipo:"oficina", lat:-2.1894, lng:-79.8891, activa:true, direccion:"Av. 9 de Octubre" },
  { id:4, nombre:"Bodega vieja", tipo:"bodega", lat:-2.2, lng:-79.9, activa:false },
];
const equipos = [
  { id:10, ubicacion_id:1, nombre:"PTP CA-SA", modelo:"Cambium PTP 550", activo_id:null, servidor_id:null },
  { id:11, ubicacion_id:1, nombre:"AP Sector Norte", modelo:"Cambium ePMP 3000", activo_id:null, servidor_id:10 },
  { id:20, ubicacion_id:2, nombre:"PTP SA-CA", modelo:"Cambium PTP 550", activo_id:null, servidor_id:10 },
  { id:30, ubicacion_id:3, nombre:"SM Oficina", modelo:"Force 300", activo_id:7, servidor_id:11 },
];
const activos = [
  { id:7, propiedad:"lukmar", tipo:"Antena", marca:"Cambium", modelo:"Force 300", serie:"SN-777", custodio:{ nombre:"Área de Sistemas" } },
  { id:8, propiedad:"eq", tipo:"Laptop", marca:"Dell", modelo:"Latitude 5440", serie:"ABC123", custodio:{ nombre:"María López" } },
  { id:9, propiedad:"lukmar", tipo:"Monitor", marca:"LG", modelo:"24MK", serie:"LG-9", custodio:null },
];
const vigentes = [
  { id:1000, activo_id:7, ubicacion_id:3, desde:"2026-09-01" },
  { id:1001, activo_id:8, ubicacion_id:1, desde:"2026-09-10" },
  { id:1002, activo_id:99, ubicacion_id:2, desde:"2026-09-11" }, // activo que ya no está en el listado
];
const idx = L.indexarMapa({ ubicaciones, equipos, vigentes, activos });

prueba("índices: equipos por ubicación, ordenados por nombre", ()=>{
  assert.deepEqual(idx.equiposPorUbicacion.get(1).map(e=>e.id), [11, 10]);
  assert.equal(idx.equiposPorUbicacion.get(4), undefined);
});
prueba("índices: tramos vigentes solo de activos que existen en el listado", ()=>{
  assert.ok(idx.vigentePorActivo.has(7) && idx.vigentePorActivo.has(8));
  assert.equal(idx.vigentePorActivo.has(99), false);
  assert.deepEqual((idx.activosPorUbicacion.get(2) || []).map(a=>a.id), []);
  assert.deepEqual(idx.activosPorUbicacion.get(3).map(a=>a.id), [7]);
});
prueba("índices: equipo por activo vinculado", ()=>assert.equal(idx.equipoPorActivo.get(7).id, 30));
prueba("filtros: tipos ocultos y archivadas", ()=>{
  assert.deepEqual(L.ubicacionesVisibles(ubicaciones, {}).map(u=>u.id), [1,2,3]);
  assert.deepEqual(L.ubicacionesVisibles(ubicaciones, { verArchivadas:true }).map(u=>u.id), [1,2,3,4]);
  assert.deepEqual(L.ubicacionesVisibles(ubicaciones, { tiposOcultos:["torre"] }).map(u=>u.id), [3]);
});
prueba("orden: por orden del tipo y luego por nombre", ()=>{
  assert.deepEqual(L.ordenarUbicaciones([ubicaciones[2], ubicaciones[1], ubicaciones[0]], tipos).map(u=>u.id), [1,2,3]);
});
prueba("resumen: cifras del panel (enlaces = radioenlaces de la jerarquía, sin los de cable)", ()=>{
  const red = J.analizarRed({ equipos, ubicaciones, respaldos: [] });
  const r = L.resumenMapa(idx, { ubicaciones, equipos, activos, red });
  assert.deepEqual(r, { ubicaciones:3, archivadas:1, equipos:4, enlaces:2, activosUbicados:2, activosSinUbicacion:1 });
});
prueba("tipo desconocido: etiqueta = valor y color neutro", ()=>{
  assert.deepEqual(L.infoTipoUbicacion(tipos, "repetidora"), { etiqueta:"repetidora", color:"#57697C", activo:false, icono:null });
  assert.equal(L.infoTipoUbicacion(tipos, "torre").color, "#EC741D");
});
prueba("v10: el pin dibuja el ícono del tipo a 15 px; sin ícono, el glifo de fábrica", ()=>{
  const svg = '<svg viewBox="0 0 16 16" width="16" height="16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>';
  const con = htmlPin({ color: "#EC741D", tipo: "torre", icono: svg });
  assert.ok(/<svg[^>]*width="15" height="15"/.test(con) && con.includes('<circle cx="8"') && con.includes('aria-hidden="true"'), con);
  assert.ok(!con.includes('width="16"'), "quedó el tamaño original");
  const sin = htmlPin({ color: "#EC741D", tipo: "torre" });
  assert.ok(sin.includes('M12 10.5 8.5 21'), "no usó el glifo de la torre");
  assert.ok(htmlPin({ color: "#57697C", tipo: "camara" }).includes('r="3.6"'), "un tipo sin glifo ni ícono sale con el punto");
});
prueba("v10: el tipo de ubicación trae su ícono (012), o null", ()=>{
  const svg = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4"/></svg>';
  const conIcono = tipos.map(t=>t.valor === "torre" ? { ...t, icono_svg: svg } : t);
  assert.equal(L.infoTipoUbicacion(conIcono, "torre").icono, svg);
  assert.equal(L.infoTipoUbicacion(conIcono, "oficina").icono, null);
});

const buscar = q=>L.buscarEnMapa(q, { indices: idx, ubicaciones, equipos, activos, tipos });
prueba("buscador: '7', 'lkm-7' y 'LKM-007' encuentran el mismo activo", ()=>{
  for(const q of ["7", "lkm-7", "LKM-007"]) assert.ok(buscar(q).some(r=>r.clase === "activo" && r.id === 7), q);
});
prueba("buscador: sin tildes ni mayúsculas ('oficina' encuentra 'Oficína Centro')", ()=>{
  assert.ok(buscar("oficina").some(r=>r.clase === "ubicacion" && r.id === 3));
});
prueba("buscador: por modelo de equipo y por custodio", ()=>{
  assert.ok(buscar("epmp").some(r=>r.clase === "equipo" && r.id === 11));
  assert.ok(buscar("maría").some(r=>r.clase === "activo" && r.id === 8));
});
prueba("buscador: el activo trae su ubicación (o 'Sin ubicación')", ()=>{
  assert.equal(buscar("LKM-007").find(r=>r.clase === "activo").ubicacionId, 3);
  assert.equal(buscar("24MK").find(r=>r.clase === "activo").detalle, "Sin ubicación");
});
prueba("buscador: menos de 2 letras no busca", ()=>assert.deepEqual(buscar("t"), []));
prueba("filtro de activos: por número de tag sin importar prefijo o ceros, y por texto", ()=>{
  const eq = activos.find(a=>a.id === 8); // propiedad "eq" → EQS-008
  for(const q of ["8", "008", "EQS-008", "eqs 8", "lkm-8"]) assert.equal(L.coincideActivo(eq, q), true, q);
  assert.equal(L.coincideActivo(eq, "latitude"), true);
  assert.equal(L.coincideActivo(eq, "9"), false);
  assert.equal(L.coincideActivo(eq, ""), true);
  assert.equal(L.idDeConsultaTag("LKM-045"), 45);
  assert.equal(L.idDeConsultaTag("torre"), null);
});

prueba("validar ubicación: nombre vacío, duplicado por mayúsculas/espacios, coordenadas", ()=>{
  const v1 = L.validarUbicacion({ nombre:"  ", tipo:"torre", lat:0, lng:0 }, ubicaciones);
  assert.equal(v1.ok, false); assert.ok(v1.errores.nombre);
  const v2 = L.validarUbicacion({ nombre:"  torre CERRO azul ", tipo:"torre", lat:0, lng:0 }, ubicaciones);
  assert.match(v2.errores.nombre, /Ya existe/);
  const v3 = L.validarUbicacion({ nombre:"Nueva", tipo:"torre", lat:95, lng:0 }, ubicaciones);
  assert.ok(v3.errores.coordenadas);
  assert.equal(L.validarUbicacion({ nombre:"Nueva", tipo:"", lat:0, lng:0 }, ubicaciones).errores.tipo, "Elige un tipo.");
});
prueba("validar ubicación: al editarse a sí misma no choca con su propio nombre", ()=>{
  assert.equal(L.validarUbicacion({ nombre:"Torre Cerro Azul", tipo:"torre", lat:0, lng:0 }, ubicaciones, 1).ok, true);
});
prueba("validar equipo: nombre repetido solo cuenta dentro de la misma ubicación", ()=>{
  assert.match(L.validarEquipo({ nombre:"ptp ca-sa", ubicacion_id:1 }, equipos).errores.nombre, /Ya hay/);
  assert.equal(L.validarEquipo({ nombre:"PTP CA-SA", ubicacion_id:2 }, equipos).ok, true);
  assert.equal(L.validarEquipo({ nombre:"PTP CA-SA", ubicacion_id:1 }, equipos, 10).ok, true);
});
prueba("validar equipo: un activo no puede ser dos equipos", ()=>{
  assert.ok(L.validarEquipo({ nombre:"Otro", ubicacion_id:2, activo_id:7 }, equipos).errores.activo_id);
  assert.equal(L.validarEquipo({ nombre:"SM Oficina", ubicacion_id:3, activo_id:7 }, equipos, 30).ok, true);
});
prueba("validar equipo: no puede ser su propio servidor; frecuencia no positiva rechazada, vacía permitida", ()=>{
  assert.match(L.validarEquipo({ nombre:"PTP CA-SA", ubicacion_id:1, servidor_id:10 }, equipos, 10).errores.servidor_id, /propio servidor/);
  assert.ok(L.validarEquipo({ nombre:"Nuevo", ubicacion_id:2, frecuencia_mhz:"-5" }, equipos).errores.frecuencia_mhz);
  assert.equal(L.validarEquipo({ nombre:"Nuevo", ubicacion_id:2, frecuencia_mhz:"" }, equipos).ok, true);
});
prueba("validar tipo de ubicación: vacío y equivalente existente", ()=>{
  assert.equal(L.validarTipoUbicacion("", "  ", tipos).ok, false);
  assert.match(L.validarTipoUbicacion("torre", "Torre", tipos).errores.etiqueta, /Ya existe/);
  assert.equal(L.validarTipoUbicacion("repetidora", "Repetidora", tipos).ok, true);
});
prueba("fecha de movimiento: obligatoria, no futura, no antes de la llegada actual", ()=>{
  assert.match(L.validarFechaMovimiento("", null, "2026-09-24"), /Elige/);
  assert.match(L.validarFechaMovimiento("2026-09-25", null, "2026-09-24"), /futura/);
  assert.match(L.validarFechaMovimiento("2026-09-05", { desde:"2026-09-10" }, "2026-09-24"), /anterior/);
  assert.equal(L.validarFechaMovimiento("2026-09-10", { desde:"2026-09-10" }, "2026-09-24"), null);
});
prueba("hoyLocalISO usa la fecha local: 20:00 en Ecuador sigue siendo el mismo día (toISOString daría el siguiente)", ()=>{
  const noche = new Date(2026, 8, 24, 20, 0, 0);
  assert.equal(noche.toISOString().slice(0,10), "2026-09-25");
  assert.equal(L.hoyLocalISO(noche), "2026-09-24");
});
prueba("hoyISO (toda la app): la fecha de Ecuador en los bordes del día y del año", ()=>{
  assert.equal(H.hoyISO(new Date(Date.UTC(2026, 8, 25, 1, 0))), "2026-09-24");   // 20:00 del 24 en Guayaquil
  assert.equal(H.hoyISO(new Date(Date.UTC(2026, 8, 25, 4, 59))), "2026-09-24");  // 23:59
  assert.equal(H.hoyISO(new Date(Date.UTC(2026, 8, 25, 5, 0))), "2026-09-25");   // 00:00 del 25
  assert.equal(H.hoyISO(new Date(Date.UTC(2027, 0, 1, 4, 59))), "2026-12-31");   // Año Nuevo en UTC, no en Ecuador
  assert.match(H.hoyISO(), /^\d{4}-\d{2}-\d{2}$/);
});
prueba("hoyISO no depende de la zona horaria del equipo (un navegador en Madrid da la fecha de Ecuador)", ()=>{
  const antes = process.env.TZ;
  try{
    process.env.TZ = "Europe/Madrid";
    const instante = new Date(Date.UTC(2026, 8, 25, 1, 0)); // 03:00 del 25 en Madrid, 20:00 del 24 en Guayaquil
    assert.equal(instante.getDate(), 25, "el TZ de prueba no se aplicó");
    assert.equal(H.hoyISO(instante), "2026-09-24");
    assert.equal(L.hoyLocalISO(instante), "2026-09-24");
  } finally { process.env.TZ = antes; }
});

prueba("errores: restricciones únicas y checks → mensaje en español", ()=>{
  assert.equal(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "ubicaciones_nombre_unico"' }), "Ya existe una ubicación con ese nombre.");
  assert.equal(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "enlaces_respaldo_par_unico"' }), "Ese servidor ya está entre sus respaldos.");
  assert.equal(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "equipos_radioenlace_activo_unico"' }), "Ese activo ya está vinculado a otro equipo de radioenlace.");
});
prueba("errores: borrar ubicación en uso (FK RESTRICT) sugiere archivar", ()=>{
  assert.match(L.traducirErrorMapa({ code:"23503", message:'update or delete on table "ubicaciones" violates foreign key constraint "historial_ubicacion_ubicacion_id_fkey" on table "historial_ubicacion"' }), /archivarla/);
});
prueba("errores: RLS vs. falta de GRANT se distinguen (el GRANT fue la caída de producción anterior)", ()=>{
  assert.match(L.traducirErrorMapa({ code:"42501", message:'new row violates row-level security policy for table "ubicaciones"' }), /No tienes permiso/);
  assert.match(L.traducirErrorMapa({ code:"42501", message:"permission denied for table ubicaciones" }), /GRANT/);
});
prueba("errores: tablas inexistentes apuntan a la migración que falta (002 o 003)", ()=>{
  assert.match(L.traducirErrorMapa({ code:"PGRST205", message:"Could not find the table 'public.ubicaciones' in the schema cache" }), /migraciones\/002/);
  assert.match(L.traducirErrorMapa({ code:"PGRST205", message:"Could not find the table 'public.enlaces_respaldo' in the schema cache" }), /migraciones\/003/);
  assert.match(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'servidor_id' column of 'equipos_radioenlace' in the schema cache" }), /migraciones\/003/);
  assert.match(L.traducirErrorMapa({ code:"42501", message:"permission denied for table enlaces_respaldo" }), /GRANT de la migración 003/);
  assert.match(L.traducirErrorMapa({ code:"PGRST202", message:"Could not find the function public.equipo_radio_de_activo(p_activo_id) in the schema cache" }), /migraciones\/004_permisos_y_fechas/);
});
prueba("errores: borrar un equipo que es servidor de otros (FK NO ACTION) pide reasignar", ()=>{
  assert.match(L.traducirErrorMapa({ code:"23503", message:'update or delete on table "equipos_radioenlace" violates foreign key constraint "equipos_radioenlace_servidor_fk" on table "equipos_radioenlace"' }), /otros equipos lo tienen como servidor/);
});
prueba("errores: mensajes de los triggers pasan tal cual", ()=>{
  const m = "Este activo está instalado como equipo de radioenlace «SM Oficina» en «Oficína Centro»: muévelo editando ese equipo.";
  assert.equal(L.traducirErrorMapa({ code:"23514", message:m }), m);
});


// ---------------------------------------------------------------- jerarquía (migración 003)
// La misma red de db/pruebas/mapa_datos_prueba.sql, con ids fijos.
const ub = [
  { id:1, nombre:"Oficina Matriz", tipo:"oficina", lat:-2.1894, lng:-79.8891, activa:true },
  { id:2, nombre:"Torre Norte", tipo:"torre", lat:-2.1180, lng:-79.9050, activa:true },
  { id:3, nombre:"Torre Cerro Azul", tipo:"torre", lat:-2.1735, lng:-79.9587, activa:true },
  { id:4, nombre:"Torre Santa Ana", tipo:"torre", lat:-2.1839, lng:-79.8756, activa:true },
];
const coordsPiscinas = [[-2.22,-79.97],[-2.22,-80.00],[-2.22,-80.03],[-2.24,-79.97],[-2.24,-80.00],[-2.24,-80.03],[-2.26,-79.97],[-2.26,-80.00],[-2.26,-80.03],[-2.23,-79.86],[-2.245,-79.88],[-2.095,-79.93],[-2.085,-79.895]];
coordsPiscinas.forEach(([lat, lng], i)=>ub.push({ id:10 + i, nombre:`Piscina ${i + 1}`, tipo:"otro", lat, lng, activa:true }));
const eq = (id, ubicacion_id, nombre, servidor_id = null, banda = null, frecuencia_mhz = null)=>({ id, ubicacion_id, nombre, servidor_id, banda, frecuencia_mhz, activo_id:null });
const red0 = [
  eq(100, 1, "Router Matriz"), eq(101, 1, "PTP Matriz → CA", 100, "5 GHz", 5745),
  eq(200, 2, "Router LTE Norte"), eq(201, 2, "PTP Norte → CA", 200, "5 GHz", 5825), eq(202, 2, "AP Norte", 200, "5 GHz", 5500),
  eq(300, 3, "PTP CA ← Matriz", 101, "5 GHz", 5745), eq(301, 3, "PTP CA ← Norte", 201), eq(302, 3, "Router CA", 300),
  eq(303, 3, "AP CA", 302, "5 GHz", 5180), eq(304, 3, "PTP CA → SA", 302, "5 GHz", 5300),
  eq(400, 4, "PTP SA ← CA", 304), eq(401, 4, "AP SA", 400, "5 GHz", 5220),
];
for(let i = 1; i <= 13; i++) red0.push(eq(500 + i, 9 + i, `CPE Piscina ${i}`, i <= 9 ? 303 : (i <= 11 ? 401 : 202)));
const resp0 = [
  { id:1, equipo_id:302, servidor_alternativo_id:301, prioridad:1 },
  { id:3, equipo_id:501, servidor_alternativo_id:202, prioridad:2 },
  { id:2, equipo_id:501, servidor_alternativo_id:401, prioridad:1 },
];
const red = J.analizarRed({ equipos: red0, ubicaciones: ub, respaldos: resp0 });
const ids = arr=>arr.map(x=>x.id);

prueba("red: clientes por servidor (WHERE servidor_id = X), sin guardar listas", ()=>{
  assert.deepEqual(ids(red.clientes.get(302)).sort(), [303, 304]);
  assert.equal(red.clientes.get(303).length, 9);
  assert.equal(red.clientes.get(501), undefined);
});
prueba("red: el servidor en la misma ubicación es cable y no genera línea", ()=>{
  assert.equal(red.enlacePorCliente.has(302), false); // Router CA ← PTP CA ← Matriz, ambos en la torre
  assert.equal(J.esPorCable(red, 302, 300), true);
  assert.equal(red.enlaces.length, 16);
});
prueba("red: 1 cliente remoto = backbone; varios = P2MP (el cable no cuenta)", ()=>{
  assert.equal(red.enlacePorCliente.get(300).clase, "backbone");  // PTP Matriz → CA (su cliente por cable no existe)
  assert.equal(red.enlacePorCliente.get(400).clase, "backbone");  // PTP CA → SA: 1 remoto aunque el router tenga más por cable
  assert.equal(red.enlacePorCliente.get(510).clase, "p2mp");
  assert.equal(red.enlacePorCliente.get(501).clase, "p2mp");
});
prueba(`red: más de ${J.UMBRAL_AGRUPAR_CLIENTES} clientes remotos se agrupan (AP CA con 9); 2 no`, ()=>{
  assert.deepEqual([...red.agrupados], [303]);
  assert.equal(red.enlacePorCliente.get(501).agrupado, true);
  assert.equal(red.enlacePorCliente.get(510).agrupado, false);
});
prueba("red: respaldos ordenados por prioridad (y en empate, por id)", ()=>{
  assert.deepEqual(red.respaldosPorEquipo.get(501).map(r=>r.servidor_alternativo_id), [401, 202]);
  const empate = J.analizarRed({ equipos: red0, ubicaciones: ub, respaldos: [{ id:9, equipo_id:501, servidor_alternativo_id:202, prioridad:1 }, { id:4, equipo_id:501, servidor_alternativo_id:401, prioridad:1 }] });
  assert.deepEqual(empate.respaldosPorEquipo.get(501).map(r=>r.id), [4, 9]);
  assert.deepEqual(red.respaldadosPor.get(401).map(r=>r.equipo_id), [501]);
});
prueba("roles automáticos: raíz, backbone (extremos PTP y equipos de torre), distribución, cliente", ()=>{
  const rol = id=>red.rol.get(id);
  assert.equal(rol(100), "raiz"); assert.equal(rol(200), "raiz");
  assert.equal(rol(101), "backbone"); assert.equal(rol(300), "backbone"); assert.equal(rol(302), "backbone"); assert.equal(rol(400), "backbone");
  assert.equal(rol(303), "distribucion"); assert.equal(rol(401), "distribucion"); assert.equal(rol(202), "distribucion");
  assert.equal(rol(501), "cliente"); assert.equal(rol(513), "cliente");
  assert.equal(rol(301), "backbone"); // extremo de un PTP que hoy solo sirve de respaldo
  assert.deepEqual(J.contarRoles(red), { raiz:2, backbone:7, distribucion:3, cliente:13 });
});
prueba("resumen de la red: raíces, backbone, P2MP, respaldos, agrupados", ()=>{
  assert.deepEqual(J.resumenRed(red), { raices:2, backbone:3, p2mp:13, cable:0, respaldos:3, agrupados:1 });
});
prueba("conexión: distancia/azimut desde el equipo hacia su servidor; banda del servidor; cable sin distancia", ()=>{
  const d = J.describirConexion(red, 501, 303);
  cerca(d.distanciaKm, geo.distanciaKm(ub[4], ub[2]), 1e-9);
  cerca(d.azimutIda, geo.azimutGrados(ub[4], ub[2]), 1e-9);
  assert.equal(d.banda, "5 GHz"); assert.equal(d.frecuencia, 5180);
  const c = J.describirConexion(red, 302, 300);
  assert.equal(c.cable, true); assert.equal(c.distanciaKm, null);
});
prueba("descendientes y servidores posibles: nunca uno propio ni del subárbol (ciclo)", ()=>{
  const d = J.descendientes(red, 302);
  assert.equal(d.size, 2 + 9 + 2 + 2); // AP CA, PTP CA → SA, 9 piscinas, PTP SA ← CA, AP SA, piscinas 10-11
  assert.ok(d.has(511) && !d.has(512) && !d.has(302));
  const cand = new Set(ids(J.candidatosServidor(red, 302)));
  assert.ok(!cand.has(302) && !cand.has(401) && !cand.has(501) && cand.has(300) && cand.has(202));
  assert.equal(J.candidatosServidor(red, null).length, red0.length);
});
prueba("validar servidor: propio, del subárbol (ciclo), inexistente, válido", ()=>{
  assert.match(J.validarServidor(red, 302, 302), /propio servidor/);
  assert.match(J.validarServidor(red, 302, 401), /ciclo/);
  assert.match(J.validarServidor(red, 302, 9999), /ya no existe/);
  assert.equal(J.validarServidor(red, 302, 301), null);
  assert.equal(J.validarServidor(red, 302, null), null); // sin servidor = raíz
});
prueba("respaldos posibles y validación: ni él, ni su servidor, ni repetidos; prioridad desde 1", ()=>{
  const cand = new Set(ids(J.candidatosRespaldo(red, 501)));
  assert.ok(!cand.has(501) && !cand.has(303) && !cand.has(401) && !cand.has(202) && cand.has(304));
  assert.ok(new Set(ids(J.candidatosRespaldo(red, 501, 2))).has(401)); // al editar el respaldo 2, su servidor sigue elegible
  const v = (f, id = null)=>J.validarRespaldo(f, red, id);
  assert.match(v({ equipo_id:501, servidor_alternativo_id:501, prioridad:1 }).errores.servidor_alternativo_id, /propio respaldo/);
  assert.match(v({ equipo_id:501, servidor_alternativo_id:303, prioridad:1 }).errores.servidor_alternativo_id, /principal/);
  assert.match(v({ equipo_id:501, servidor_alternativo_id:401, prioridad:3 }).errores.servidor_alternativo_id, /ya está/);
  assert.equal(v({ equipo_id:501, servidor_alternativo_id:401, prioridad:3 }, 2).ok, true);
  assert.match(v({ equipo_id:501, servidor_alternativo_id:304, prioridad:0 }).errores.prioridad, /desde 1/);
  assert.match(v({ equipo_id:501, servidor_alternativo_id:304, prioridad:1.5 }).errores.prioridad, /entero/);
  assert.equal(J.siguientePrioridad(red, 501), 3); assert.equal(J.siguientePrioridad(red, 400), 1);
});
prueba("camino a la raíz (con los saltos por cable marcados)", ()=>{
  const c = J.caminoARaiz(red, 501);
  assert.deepEqual(c, [501, 303, 302, 300, 101, 100]);
  assert.deepEqual(J.tramosDeCamino(red, c).map(t=>t.cable), [false, true, true, false, true]);
});

const cuentas = sim=>sim.cuentas;
prueba("simulación sin caídas: todo en servicio por su camino normal", ()=>{
  const sim = J.simularFallas(red, []);
  assert.deepEqual(cuentas(sim), { servicio:25, respaldo:0, sin_conexion:0, caido:0 });
  assert.equal(sim.estado.get(501).via, 303);
  assert.equal(sim.estado.get(100).via, null);
});
prueba("caída con respaldo: el equipo conmuta solo a su respaldo de prioridad 1", ()=>{
  const sim = J.simularFallas(red, [501]);
  const st = sim.estado.get(501);
  assert.equal(st.caido, true); assert.equal(st.conectado, true); assert.equal(st.via, 401); assert.equal(st.respaldo.prioridad, 1);
  assert.equal(st.estado, "caido"); assert.equal(st.rutaAlterna, true);
  assert.deepEqual(cuentas(sim), { servicio:24, respaldo:0, sin_conexion:0, caido:1 });
  assert.deepEqual(J.caminoARaiz(red, 501, sim), [501, 401, 400, 304, 302, 300, 101, 100]);
});
prueba("fallas encadenadas: si el respaldo 1 también cayó, pasa al 2", ()=>{
  const sim = J.simularFallas(red, [501, 400]); // cae el PTP de Santa Ana: el AP Santa Ana queda sin servicio
  assert.equal(sim.estado.get(501).via, 202);
  assert.equal(sim.estado.get(501).respaldo.prioridad, 2);
  assert.equal(sim.estado.get(401).estado, "sin_conexion");
  assert.deepEqual(cuentas(sim), { servicio:20, respaldo:0, sin_conexion:3, caido:2 });
});
prueba("sin ningún respaldo: el equipo y todo su subárbol quedan sin conectividad", ()=>{
  const sim = J.simularFallas(red, [400]);
  for(const id of [401, 510, 511]) assert.equal(sim.estado.get(id).estado, "sin_conexion", String(id));
  assert.equal(sim.estado.get(400).conectado, false);
  assert.equal(sim.estado.get(501).estado, "servicio"); // cuelga del AP CA, no de Santa Ana
  assert.deepEqual(cuentas(sim), { servicio:21, respaldo:0, sin_conexion:3, caido:1 });
});
prueba("un cliente conmuta por cable y todo lo que cuelga de él lo sigue (sigue en servicio, por ruta alterna)", ()=>{
  const sim = J.simularFallas(red, [300]); // se corta PTP CA ← Matriz; el Router CA tiene respaldo por el PTP de Norte
  const r = sim.estado.get(302);
  assert.equal(r.estado, "respaldo"); assert.equal(r.via, 301);
  assert.equal(sim.estado.get(501).estado, "servicio"); assert.equal(sim.estado.get(501).rutaAlterna, true);
  assert.deepEqual(cuentas(sim), { servicio:23, respaldo:1, sin_conexion:0, caido:1 });
  assert.deepEqual(J.caminoARaiz(red, 501, sim), [501, 303, 302, 301, 201, 200]);
});
prueba("si también cae la raíz del respaldo, la torre entera queda sin conectividad", ()=>{
  const sim = J.simularFallas(red, [300, 200]);
  assert.deepEqual(cuentas(sim), { servicio:2, respaldo:0, sin_conexion:21, caido:2 });
  assert.equal(sim.estado.get(501).conectado, false); // sus dos respaldos también dependen de lo caído
  assert.deepEqual(J.caminoARaiz(red, 501, sim), [501, 303, 302, 300]); // se ve dónde se corta
  assert.deepEqual(J.tramosDeCamino(red, [501, 303, 302, 300], sim).map(t=>t.funciona), [false, false, false]);
});
prueba("una raíz caída arrastra a su subárbol hasta donde haya respaldo", ()=>{
  const sim = J.simularFallas(red, [100]);
  assert.equal(sim.estado.get(101).estado, "sin_conexion");
  assert.equal(sim.estado.get(302).estado, "respaldo");
  assert.deepEqual(cuentas(sim), { servicio:21, respaldo:1, sin_conexion:2, caido:1 });
});
prueba("prioridad: si primero quedó en un respaldo peor, al final se pasa al mejor disponible", ()=>{
  // A(1) raíz; Z(2)←A; N(3) caído con respaldos [Y prio 1, Z prio 2]; X(4)←A; Y(5)←X.
  // En la primera ronda N solo ve a Z con servicio (Y todavía no): termina en Y.
  const u = [{ id:1, nombre:"U", tipo:"torre", lat:0, lng:0 }, { id:2, nombre:"V", tipo:"torre", lat:0.1, lng:0.1 }];
  const e = [eq(1, 1, "A"), eq(2, 2, "Z", 1), eq(3, 2, "N", 1), eq(4, 1, "X", 1), eq(5, 1, "Y", 4)];
  const r = J.analizarRed({ equipos: e, ubicaciones: u, respaldos: [{ id:1, equipo_id:3, servidor_alternativo_id:5, prioridad:1 }, { id:2, equipo_id:3, servidor_alternativo_id:2, prioridad:2 }] });
  const sim = J.simularFallas(r, [3]);
  assert.equal(sim.estado.get(3).via, 5);
});
prueba("nunca sale por alguien que depende de él (sin ciclos), pero sí por una malla válida", ()=>{
  const u = [{ id:1, nombre:"U", tipo:"torre", lat:0, lng:0 }, { id:2, nombre:"V", tipo:"torre", lat:0.1, lng:0.1 }];
  // E(2)←A(1); D(3)←E. E caído con respaldo = D: D solo tenía servicio a través de E.
  const r1 = J.analizarRed({ equipos: [eq(1, 1, "A"), eq(2, 2, "E", 1), eq(3, 1, "D", 2)], ubicaciones: u, respaldos: [{ id:1, equipo_id:2, servidor_alternativo_id:3, prioridad:1 }] });
  const s1 = J.simularFallas(r1, [2]);
  assert.equal(s1.estado.get(2).conectado, false); assert.equal(s1.estado.get(3).conectado, false);
  // Igual, pero D tiene su propio respaldo Z(4)←A: D sale por Z y E por D.
  const r2 = J.analizarRed({ equipos: [eq(1, 1, "A"), eq(2, 2, "E", 1), eq(3, 1, "D", 2), eq(4, 1, "Z", 1)], ubicaciones: u, respaldos: [{ id:1, equipo_id:2, servidor_alternativo_id:3, prioridad:1 }, { id:2, equipo_id:3, servidor_alternativo_id:4, prioridad:1 }] });
  const s2 = J.simularFallas(r2, [2]);
  assert.equal(s2.estado.get(3).via, 4); assert.equal(s2.estado.get(2).via, 3);
  assert.deepEqual(J.caminoARaiz(r2, 2, s2), [2, 3, 4, 1]);
});
prueba("estado por ubicación (para pintar los pines en la simulación)", ()=>{
  const sim = J.simularFallas(red, [400]);
  const e = J.estadoPorUbicacion(red, sim);
  assert.deepEqual(e.get(4), { total:2, sinConexion:2, caidos:1, respaldo:0 });
  assert.deepEqual(e.get(19), { total:1, sinConexion:1, caidos:0, respaldo:0 }); // Piscina 10
});
prueba("filtro de equipos: rol oculto y estado oculto (este solo con simulación)", ()=>{
  assert.equal(J.equipoVisible(red, 501, { rolesOcultos:["cliente"] }), false);
  assert.equal(J.equipoVisible(red, 303, { rolesOcultos:["cliente"] }), true);
  const sim = J.simularFallas(red, [400]);
  assert.equal(J.equipoVisible(red, 401, { estadosOcultos:["sin_conexion"] }, sim), false);
  assert.equal(J.equipoVisible(red, 401, { estadosOcultos:["sin_conexion"] }, null), true);
});

const plan = (o = {})=>J.planDeLineas(red, o);
const porEstilo = lineas=>lineas.reduce((a, l)=>(a[l.estilo] = (a[l.estilo] || 0) + 1, a), {});
prueba("plan de líneas por defecto: backbone y P2MP; el AP con 9 clientes queda agrupado; respaldos ocultos", ()=>{
  assert.deepEqual(porEstilo(plan()), { backbone:3, p2mp:4 });
});
prueba("toggles de líneas: sin P2MP quedan solo backbone; con Respaldos aparecen los de otra ubicación (no los de cable)", ()=>{
  assert.deepEqual(porEstilo(plan({ lineas:{ backbone:true, p2mp:false, respaldos:false } })), { backbone:3 });
  assert.deepEqual(porEstilo(plan({ lineas:{ backbone:false, p2mp:false, respaldos:true } })), { respaldo:2 });
});
prueba("expandir el AP agrupado (fijado o seleccionado) dibuja sus 9 líneas", ()=>{
  assert.equal(porEstilo(plan({ expandidos:new Set([303]) })).p2mp, 13);
  const sel = plan({ seleccionId:303 });
  assert.equal(sel.filter(l=>l.servidorId === 303 && !l.atenuada).length, 9); // sus clientes no se atenúan
});
prueba("seleccionar un equipo resalta su camino a la raíz y atenúa el resto", ()=>{
  const p = plan({ seleccionId:501 });
  const cadena = p.filter(l=>l.enCadena);
  assert.deepEqual(cadena.map(l=>l.clave).sort(), ["p:300", "p:501"]); // los saltos por cable no tienen línea
  assert.ok(cadena.every(l=>l.estilo === "cadena" && !l.atenuada));
  assert.ok(p.filter(l=>!l.enCadena).every(l=>l.atenuada));
});
prueba("simulación: enlace cortado, línea recuperada vía respaldo (sin activar el toggle) y subárbol sin conectividad", ()=>{
  const s1 = plan({ sim:J.simularFallas(red, [501]), seleccionId:501 });
  assert.equal(s1.find(l=>l.clave === "p:501").estilo, "cortado");
  const rec = s1.find(l=>l.tipo === "respaldo" && l.enUso);
  assert.ok(rec && rec.servidorId === 401 && rec.estilo === "cadenaRespaldo" && rec.ubicacionRespaldo === "Torre Santa Ana");
  const s2 = plan({ sim:J.simularFallas(red, [501]) });
  assert.equal(s2.find(l=>l.tipo === "respaldo" && l.enUso).estilo, "recuperado");
  assert.equal(s2.some(l=>l.tipo === "respaldo" && !l.enUso), false); // los que no se usan siguen ocultos
  const s3 = plan({ sim:J.simularFallas(red, [400]) });
  assert.equal(s3.find(l=>l.clave === "p:400").estilo, "cortado");
  assert.deepEqual(["p:510", "p:511"].map(k=>s3.find(l=>l.clave === k).estilo), ["sinConexion", "sinConexion"]);
});
prueba("camino roto en la simulación: los tramos que no funcionan salen como cadenaRota", ()=>{
  const p = plan({ sim:J.simularFallas(red, [300, 200]), seleccionId:510 });
  assert.equal(p.find(l=>l.clave === "p:510").estilo, "cadenaRota");
});
prueba("indicadores de agrupados: nombre, cantidad y cuántos clientes quedaron sin conectividad", ()=>{
  const [g] = J.planDeAgrupados(red);
  assert.deepEqual({ id:g.servidorId, n:g.clientes, exp:g.expandido }, { id:303, n:9, exp:false });
  const [g2] = J.planDeAgrupados(red, { sim:J.simularFallas(red, [300, 200]), seleccionId:303 });
  assert.equal(g2.servidorSinConexion, true); assert.equal(g2.clientesSinConexion, 9); assert.equal(g2.expandido, true);
});

// ---------------------------------------------------------------- capa Plano (nucleo/plano-mapa.js)
const E0 = PL.PLANO_POR_DEFECTO.esquinas;
const m = (a, b)=>Math.hypot(...PL.aMetros(a, b));
prueba("plano: las esquinas que trae la app son válidas y el plano mide ≈ 4,2 × 5,3 km", ()=>{
  assert.equal(PL.esquinasValidas(E0), true);
  const t = PL.tamanoEnMetros(E0);
  cerca(t.ancho, 4207, 15, "ancho"); cerca(t.alto, 5286, 15, "alto");
  cerca(t.ancho / t.alto, PL.PLANO_POR_DEFECTO.ancho_px / PL.PLANO_POR_DEFECTO.alto_px, 0.002, "misma proporción que la imagen");
});
prueba("plano: esquinas inválidas (falta una, alineadas, fuera de rango, texto, nada)", ()=>{
  assert.equal(PL.esquinasValidas({ no:[-2.3,-79.7], ne:[-2.3,-79.6] }), false);
  assert.equal(PL.esquinasValidas({ no:[-2.3,-79.7], ne:[-2.3,-79.6], so:[-2.3,-79.5] }), false);
  assert.equal(PL.esquinasValidas({ no:[-200,-79.7], ne:[-2.3,-79.6], so:[-2.4,-79.7] }), false);
  assert.equal(PL.esquinasValidas({ no:["-2.3",-79.7], ne:[-2.3,-79.6], so:[-2.4,-79.7] }), false);
  assert.equal(PL.esquinasValidas(null), false);
});
prueba("plano: metros ↔ grados ida y vuelta sin error (< 1 mm)", ()=>{
  const o = PL.centroEsquinas(E0), p = [-2.3401, -79.7123];
  const q = PL.desdeMetros(o, PL.aMetros(o, p));
  assert.ok(m(p, q) < 0.001, `error ${m(p, q)} m`);
});
prueba("plano: la cuarta esquina cierra el paralelogramo y el centro está en la diagonal", ()=>{
  const c = PL.esquinasCompletas(E0), cen = PL.centroEsquinas(E0);
  cerca(m(c.no, cen), m(c.se, cen), 0.2); cerca(m(c.ne, cen), m(c.so, cen), 0.2); // cm en 3 km: la escala de la longitud cambia con la latitud
});
prueba("plano: mover 10 m al este y 5 m al norte mueve las tres esquinas igual y no cambia el tamaño", ()=>{
  const e = PL.moverEsquinas(E0, 10, 5);
  for(const k of PL.ESQUINAS){ const [x, y] = PL.aMetros(E0[k], e[k]); cerca(x, 10, 0.05, k + " x"); cerca(y, 5, 0.05, k + " y"); }
  cerca(PL.tamanoEnMetros(e).ancho, PL.tamanoEnMetros(E0).ancho, 0.05);
});
prueba("plano: arrastrar la esquina de abajo a la derecha por la diagonal agranda sin deformar y deja fija la opuesta", ()=>{
  const c = PL.esquinasCompletas(E0);
  const destino = PL.desdeMetros(c.no, PL.aMetros(c.no, c.se).map(v=>v * 1.1));
  const e = PL.escalarDesdeEsquina(E0, "se", destino);
  assert.ok(m(e.no, E0.no) < 0.02, "la esquina opuesta (no) no se mueve");
  const t0 = PL.tamanoEnMetros(E0), t1 = PL.tamanoEnMetros(e);
  cerca(t1.ancho / t0.ancho, 1.1, 1e-4); cerca(t1.alto / t0.alto, 1.1, 1e-4);
  cerca(PL.giroGrados(e), PL.giroGrados(E0), 1e-3, "sin giro"); // las esquinas se redondean a 1e-7° (≈ 1 cm)
});
prueba("plano: un arrastre fuera de la diagonal igual mantiene la proporción (proyección sobre la diagonal)", ()=>{
  const c = PL.esquinasCompletas(E0);
  const [x, y] = PL.aMetros(c.so, c.ne);
  const e = PL.escalarDesdeEsquina(E0, "ne", PL.desdeMetros(c.so, [x * 0.9 + 150, y * 0.9 - 80]));
  const t0 = PL.tamanoEnMetros(E0), t1 = PL.tamanoEnMetros(e);
  cerca(t1.ancho / t1.alto, t0.ancho / t0.alto, 1e-5);
  assert.ok(m(e.so, E0.so) < 0.02, "so fija");
});
prueba("plano: si el puntero cruza la esquina opuesta, el factor se limita (no se da vuelta)", ()=>{
  const c = PL.esquinasCompletas(E0);
  assert.equal(PL.factorDesdeArrastre(E0, "se", PL.desdeMetros(c.no, PL.aMetros(c.no, c.se).map(v=>-v))), PL.FACTOR_MINIMO);
});
prueba("plano: girar 0,1° y volver deja todo igual; el giro se mide en el borde superior", ()=>{
  const g = PL.girarEsquinas(E0, 0.1);
  cerca(PL.giroGrados(g) - PL.giroGrados(E0), 0.1, 1e-3);
  cerca(PL.tamanoEnMetros(g).ancho, PL.tamanoEnMetros(E0).ancho, 0.02);
  assert.ok(PL.distanciaMaxima(PL.girarEsquinas(g, -0.1), E0) < 0.02);
});
prueba("plano: la matriz CSS lleva las esquinas de la imagen a sus puntos de pantalla", ()=>{
  const p0 = { x: 10, y: 20 }, p1 = { x: 310, y: 35 }, p2 = { x: -5, y: 420 };
  const [a, b, c, d, e, f] = PL.matrizCss(p0, p1, p2, 3198, 4018);
  const ap = (x, y)=>[a * x + c * y + e, b * x + d * y + f];
  assert.deepEqual(ap(0, 0).map(v=>+v.toFixed(9)), [10, 20]);
  assert.deepEqual(ap(3198, 0).map(v=>+v.toFixed(9)), [310, 35]);
  assert.deepEqual(ap(0, 4018).map(v=>+v.toFixed(9)), [-5, 420]);
});
prueba("plano: normalizarPlano completa con el plano de la app lo que falte o esté mal", ()=>{
  const sin = PL.normalizarPlano(null);
  assert.equal(sin.guardado, false); assert.deepEqual(sin.esquinas, PL.copiarEsquinas(E0));
  const mal = PL.normalizarPlano({ id: 4, esquinas: { no: [1, 2] }, esquinas_originales: null, ancho_px: 0 });
  assert.equal(mal.guardado, true); assert.equal(mal.id, 4);
  assert.deepEqual(mal.esquinas, PL.copiarEsquinas(E0)); assert.equal(mal.ancho_px, PL.PLANO_POR_DEFECTO.ancho_px);
  const e2 = PL.moverEsquinas(E0, 30, 0);
  const bien = PL.normalizarPlano({ id: 1, nombre: "X", imagen: "assets/img/mapa/x.webp", ancho_px: 100, alto_px: 50, esquinas: e2, esquinas_originales: E0 });
  assert.deepEqual([bien.imagen, bien.ancho_px, bien.alto_px], ["assets/img/mapa/x.webp", 100, 50]);
  assert.deepEqual(bien.esquinas, e2); assert.deepEqual(bien.esquinasOriginales, PL.copiarEsquinas(E0));
});
prueba("plano: la caja del plano contiene sus cuatro esquinas", ()=>{
  const [[a, b], [c, d]] = PL.cajaEsquinas(PL.girarEsquinas(E0, 5));
  for(const p of Object.values(PL.esquinasCompletas(PL.girarEsquinas(E0, 5)))) assert.ok(p[0] >= a && p[0] <= c && p[1] >= b && p[1] <= d);
});
// Calce: tres puntos de la carretera medidos sobre el satélite (zoom 17) caen
// a menos de 12 m del eje de la vía del plano puesto con las esquinas de la app.
prueba("plano: el eje de la vía Taura–Jaguito del plano cae sobre la carretera real (< 12 m)", ()=>{
  const X0 = 372, Y0 = 36, K = 2.5, W = 3198, H = 4018;
  const aLatLng = ([x, y])=>{ const u = (x - X0) * K / W, v = (y - Y0) * K / H; return [E0.no[0] + u * (E0.ne[0] - E0.no[0]) + v * (E0.so[0] - E0.no[0]), E0.no[1] + u * (E0.ne[1] - E0.no[1]) + v * (E0.so[1] - E0.no[1])]; };
  const distSeg = (p, a, b)=>{ const o = a; const [px, py] = PL.aMetros(o, p), [bx, by] = PL.aMetros(o, b); const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by))); return Math.hypot(px - t * bx, py - t * by); };
  const casos = [
    { real: [-2.3350768, -79.7195815], eje: [[992.05, 834.3], [997.48, 841.48], [1002.91, 848.65]] },
    { real: [-2.350987, -79.7110768], eje: [[1277.4, 1368.46], [1281.97, 1377.19], [1286.58, 1384.71]] },
    { real: [-2.3213785, -79.7308102], eje: [[614.91, 371.96], [616.73, 380.78], [618.54, 389.59]] },
  ];
  for(const c of casos){
    const pts = c.eje.map(aLatLng);
    const d = Math.min(distSeg(c.real, pts[0], pts[1]), distSeg(c.real, pts[1], pts[2]));
    assert.ok(d < 12, `a ${d.toFixed(1)} m de la carretera`);
  }
});
prueba("error de Supabase: sin la tabla del plano pide la migración 006", ()=>{
  assert.match(L.traducirErrorMapa({ code: "PGRST205", message: "Could not find the table 'public.planos_mapa' in the schema cache" }), /006_plano_mapa\.sql/);
  assert.match(L.traducirErrorMapa({ code: "23514", message: 'new row for relation "planos_mapa" violates check constraint "planos_mapa_esquinas_validas"' }), /posición del plano no es válida/);
});

// ---------------------------------------------------------------- nombres automáticos y atajos (007)
const TIPOS_RED = [
  { valor:"router", etiqueta:"Router", genero:"m" }, { valor:"switch", etiqueta:"Switch", genero:"m" },
  { valor:"ptp", etiqueta:"Punto a Punto", genero:"m" }, { valor:"ap", etiqueta:"AP", genero:"m" },
  { valor:"estacion", etiqueta:"Estación", genero:"f" }, { valor:"camara", etiqueta:"Cámara", genero:"f" },
];
const UB_RED = [{ id:1, nombre:"Torre K" }, { id:2, nombre:"Torre L" }, { id:3, nombre:"Oficina" }, { id:4, nombre:"Piscina 12" }];
const eqN = (id, ubicacion_id, tipo_equipo, servidor_id = null, extra = {})=>({ id, ubicacion_id, nombre:`guardado ${id}`, tipo_equipo, servidor_id, referencia:null, ...extra });
prueba("nombre: estación enlazada a un Punto a Punto de otra torre (femenino, sin decir de dónde toma internet él)", ()=>{
  const equipos = [eqN(1, 3, "router"), eqN(2, 2, "ptp", 1), eqN(3, 1, "estacion", 2)];
  const n = N.nombresAutomaticos({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED });
  assert.equal(n.get(3), "Estación en Torre K enlazada a Punto a Punto en Torre L");
  assert.equal(n.get(2), "Punto a Punto en Torre L enlazado a Router en Oficina");
  assert.equal(n.get(1), "Router en Oficina");
});
prueba("nombre: por cable (misma ubicación) dice «conectado/a» y no repite la ubicación", ()=>{
  const equipos = [eqN(1, 1, "ptp"), eqN(2, 1, "switch", 1), eqN(3, 1, "camara", 2)];
  const n = N.nombresAutomaticos({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED });
  assert.equal(n.get(2), "Switch en Torre K conectado a Punto a Punto");
  assert.equal(n.get(3), "Cámara en Torre K conectada a Switch");
});
prueba("nombre: la referencia va entre paréntesis (también la del servidor)", ()=>{
  const equipos = [eqN(1, 2, "ap", null, { referencia:"Sector Norte" }), eqN(2, 4, "estacion", 1, { referencia:"  Bomba  " })];
  const n = N.nombresAutomaticos({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED });
  assert.equal(n.get(2), "Estación (Bomba) en Piscina 12 enlazada a AP (Sector Norte) en Torre L");
});
prueba("nombre: dos iguales en la misma ubicación → el de id más alto se numera (2); en otra ubicación no", ()=>{
  const equipos = [eqN(1, 1, "switch"), eqN(5, 1, "camara", 1), eqN(4, 1, "camara", 1), eqN(6, 2, "camara")];
  const n = N.nombresAutomaticos({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED });
  assert.equal(n.get(4), "Cámara en Torre K conectada a Switch");
  assert.equal(n.get(5), "Cámara en Torre K conectada a Switch (2)");
  assert.equal(n.get(6), "Cámara en Torre L");
});
prueba("nombre: sin tipo (antes de la 007) conserva el nombre escrito a mano; si es servidor, se lo cita por ese nombre", ()=>{
  const equipos = [eqN(1, 2, null, null, { nombre:"PTP viejo" }), eqN(2, 1, "estacion", 1)];
  const n = N.nombresAutomaticos({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED });
  assert.equal(n.get(1), "PTP viejo");
  assert.equal(n.get(2), "Estación en Torre K enlazada a PTP viejo en Torre L");
});
prueba("nombre: uno escrito a mano que coincide con el armado cuenta como ocupado", ()=>{
  const equipos = [eqN(1, 1, null, null, { nombre:"switch en torre k" }), eqN(2, 1, "switch")];
  assert.equal(N.nombresAutomaticos({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED }).get(2), "Switch en Torre K (2)");
});
prueba("nombre para guardar: único en su ubicación contra el mostrado y el guardado; al editar no choca consigo mismo", ()=>{
  const equipos = N.aplicarNombres([eqN(1, 1, "switch"), eqN(2, 1, "camara", 1), eqN(3, 1, "camara", 1, { nombre:"Cámara en Torre K conectada a Switch (3)" })], { ubicaciones: UB_RED, tipos: TIPOS_RED });
  assert.equal(equipos[1].nombre, "Cámara en Torre K conectada a Switch");
  assert.equal(equipos[2].nombre_guardado, "Cámara en Torre K conectada a Switch (3)");
  const fila = { ubicacion_id:1, tipo_equipo:"camara", servidor_id:1, referencia:null };
  assert.equal(N.nombreParaGuardar(fila, { equipos, ubicaciones: UB_RED, tipos: TIPOS_RED }, null), "Cámara en Torre K conectada a Switch (4)");
  assert.equal(N.nombreParaGuardar(fila, { equipos, ubicaciones: UB_RED, tipos: TIPOS_RED }, 2), "Cámara en Torre K conectada a Switch");
  assert.equal(N.nombreParaGuardar({ ...fila, referencia:"Norte" }, { equipos, ubicaciones: UB_RED, tipos: TIPOS_RED }, 2), "Cámara (Norte) en Torre K conectada a Switch");
  assert.equal(N.nombreParaGuardar({ ubicacion_id:1, tipo_equipo:null }, { equipos, ubicaciones: UB_RED, tipos: TIPOS_RED }), null);
});
prueba("aplicarNombres: se puede llamar dos veces sin perder el nombre guardado", ()=>{
  const equipos = [eqN(1, 1, "switch")];
  N.aplicarNombres(equipos, { ubicaciones: UB_RED, tipos: TIPOS_RED });
  N.aplicarNombres(equipos, { ubicaciones: UB_RED, tipos: [] });
  assert.equal(equipos[0].nombre_guardado, "guardado 1");
  assert.equal(equipos[0].nombre, "guardado 1");
});
prueba("participio según género y medio", ()=>{
  assert.equal(N.participio("f", false), "enlazada"); assert.equal(N.participio("m", false), "enlazado");
  assert.equal(N.participio("f", true), "conectada"); assert.equal(N.participio("m", true), "conectado");
});
prueba("atajos: caídos efectivos = marcados a mano ∪ atajos encendidos (sin repetir ni inexistentes)", ()=>{
  const atajos = [{ id:1, equipos:[10, 11] }, { id:2, equipos:[11, 12, 99] }, { id:3, equipos:[13] }];
  const existe = id=>id !== 99;
  assert.deepEqual(N.caidosEfectivos({ manuales:[5, 10], atajosActivos:[1, 2], atajos, existe }), [5, 10, 11, 12]);
  assert.deepEqual(N.caidosEfectivos({ manuales:[], atajosActivos:[], atajos, existe }), []);
  assert.deepEqual(N.atajosQueLoApagan(11, { atajosActivos:[1, 2], atajos }).map(a=>a.id), [1, 2]);
  assert.deepEqual(N.atajosQueLoApagan(13, { atajosActivos:[1, 2], atajos }), []);
});
prueba("validaciones de atajo, red y tipo de equipo", ()=>{
  assert.equal(N.validarAtajo({ nombre:"Red 2", equipos:[1] }, [{ id:1, nombre:"red 2 " }]).errores.nombre, "Ya hay un atajo con ese nombre.");
  assert.ok(N.validarAtajo({ nombre:"Red 2", equipos:[1] }, [{ id:1, nombre:"red 2" }], 1).ok);
  assert.ok(N.validarAtajo({ nombre:"X", equipos:[] }).errores.equipos);
  assert.ok(N.validarRed({ nombre:"Cámaras", color:"rojo" }).errores.color);
  assert.ok(N.validarRed({ nombre:"Cámaras", color:"#EC741D" }).ok);
  const v = N.validarTipoEquipo({ etiqueta:"Cámara PTZ", genero:"f" }, TIPOS_RED);
  assert.ok(v.ok); assert.equal(v.valor, "camara_ptz");
  assert.ok(N.validarTipoEquipo({ etiqueta:"switch", genero:"m" }, TIPOS_RED).errores.etiqueta);
  assert.ok(N.validarTipoEquipo({ etiqueta:"Switch", genero:"m" }, TIPOS_RED, "switch").ok);
  assert.ok(N.validarTipoEquipo({ etiqueta:"Nuevo", genero:"x" }).errores.genero);
});

// ---------------------------------------------------------------- 008: medio del enlace
{
  const U = [{ id:1, nombre:"Torre K", lat:-2.30, lng:-79.70 }, { id:2, nombre:"Poste 3", lat:-2.301, lng:-79.701 }, { id:3, nombre:"Torre L", lat:-2.35, lng:-79.72 }];
  const E = [
    { id:1, ubicacion_id:3, nombre:"Router L", servidor_id:null },
    { id:2, ubicacion_id:3, nombre:"PTP L", servidor_id:1 },
    { id:3, ubicacion_id:1, nombre:"PTP K", servidor_id:2 },                        // radio automático
    { id:4, ubicacion_id:1, nombre:"Switch K", servidor_id:3 },                     // cable automático
    { id:5, ubicacion_id:2, nombre:"Cámara poste", servidor_id:4, medio:"cable" },  // cable entre sitios
    { id:6, ubicacion_id:2, nombre:"Cámara poste 2", servidor_id:4, medio:"fibra" },// fibra entre sitios
    { id:7, ubicacion_id:1, nombre:"AP K", servidor_id:4, medio:"inalambrico" },    // radio en la misma ubicación
  ];
  const R = [{ id:1, equipo_id:5, servidor_alternativo_id:3, prioridad:1 }];
  const rd = J.analizarRed({ equipos:E, ubicaciones:U, respaldos:R });
  prueba("008: medio explícito o deducido (misma ubicación = cable; otra = inalámbrico)", ()=>{
    assert.equal(J.medioEnlace(rd, 3, 2), "inalambrico");
    assert.equal(J.medioEnlace(rd, 4, 3), "cable");
    assert.equal(J.medioEnlace(rd, 5, 4), "cable");
    assert.equal(J.medioEnlace(rd, 6, 4), "fibra");
    assert.equal(J.medioEnlace(rd, 7, 4), "inalambrico");
    assert.ok(J.esPorCable(rd, 6, 4) && !J.esPorCable(rd, 7, 4));
  });
  prueba("008: el medio guardado vale solo para el servidor principal (un respaldo se deduce)", ()=>{
    assert.equal(J.medioEnlace(rd, 5, 3), "inalambrico"); // respaldo (no es su principal) en otra ubicación: se deduce
    const rd2 = J.analizarRed({ equipos:[...E.slice(0, 4), { id:5, ubicacion_id:2, nombre:"Cámara", servidor_id:4, medio:"fibra" }], ubicaciones:U });
    assert.equal(J.medioDe(rd2.equipoPorId.get(5), rd2.equipoPorId.get(3)), "inalambrico");
  });
  prueba("008: cable/fibra entre sitios no son radioenlaces: clase propia, no cuentan para backbone/P2MP ni se agrupan", ()=>{
    const porCliente = new Map(rd.enlaces.map(l=>[l.cliente.id, l]));
    assert.equal(porCliente.get(3).clase, "backbone");
    assert.equal(porCliente.get(5).clase, "cable");
    assert.equal(porCliente.get(6).clase, "fibra");
    assert.ok(!porCliente.has(4) && !porCliente.has(7), "misma ubicación: sin línea");
    assert.deepEqual((rd.clientesRemotos.get(4) || []).map(e=>e.id), []);
    assert.equal(J.resumenRed(rd).cable, 2);
    assert.equal(rd.rol.get(5), "cliente");
  });
  prueba("008: planDeLineas dibuja cable y fibra con su estilo; el toggle «cable» los oculta", ()=>{
    const plan = J.planDeLineas(rd, { lineas:{ backbone:true, p2mp:true, cable:true, respaldos:false } });
    const estilos = new Map(plan.filter(d=>d.tipo === "principal").map(d=>[d.clienteId, d.estilo]));
    assert.equal(estilos.get(5), "cable"); assert.equal(estilos.get(6), "fibra");
    const sin = J.planDeLineas(rd, { lineas:{ backbone:true, p2mp:true, cable:false, respaldos:false } });
    assert.ok(!sin.some(d=>d.clienteId === 5 || d.clienteId === 6));
  });
  prueba("008: tramos y conexión llevan el medio y si es la misma ubicación", ()=>{
    const t = J.tramosDeCamino(rd, J.caminoARaiz(rd, 6));
    assert.deepEqual(t.map(x=>x.medio), ["fibra", "cable", "inalambrico", "cable"]);
    const d = J.describirConexion(rd, 6, 4);
    assert.equal(d.medio, "fibra"); assert.equal(d.cable, true); assert.equal(d.mismaUbicacion, false); assert.ok(d.distanciaKm > 0.1 && d.distanciaKm < 0.2);
    const d2 = J.describirConexion(rd, 4, 3);
    assert.equal(d2.mismaUbicacion, true); assert.equal(d2.distanciaKm, null);
  });
  prueba("filtro por red: oculta los de una red y, con «sin», los que no tienen red", ()=>{
    const E2 = E.map(e=>({ ...e, red_id: e.id <= 3 ? 1 : (e.id === 4 ? 2 : null) }));
    const rd2 = J.analizarRed({ equipos:E2, ubicaciones:U });
    assert.equal(J.claveRed(E2[0]), "1"); assert.equal(J.claveRed(E2[6]), "sin");
    assert.ok(!J.equipoVisible(rd2, 1, { redesOcultas:["1"] }));
    assert.ok(J.equipoVisible(rd2, 4, { redesOcultas:["1"] }));
    assert.ok(!J.equipoVisible(rd2, 7, { redesOcultas:["sin"] }));
    assert.ok(J.equipoVisible(rd2, 7, {}));
  });
  const T = [{ valor:"switch", etiqueta:"Switch", genero:"m" }, { valor:"camara", etiqueta:"Cámara", genero:"f" }, { valor:"ap", etiqueta:"AP", genero:"m" }, { valor:"ptp", etiqueta:"Punto a Punto", genero:"m" }];
  const EN = [
    { id:3, ubicacion_id:1, nombre:"PTP K", servidor_id:null, tipo_equipo:"ptp" },
    { id:4, ubicacion_id:1, nombre:"x", servidor_id:3, tipo_equipo:"switch" },
    { id:5, ubicacion_id:2, nombre:"x", servidor_id:4, tipo_equipo:"camara", medio:"cable" },
    { id:6, ubicacion_id:2, nombre:"x", servidor_id:4, tipo_equipo:"camara", medio:"fibra", referencia:"Norte" },
    { id:7, ubicacion_id:1, nombre:"x", servidor_id:4, tipo_equipo:"ap", medio:"inalambrico" },
    { id:8, ubicacion_id:2, nombre:"x", servidor_id:4, tipo_equipo:"camara" },
  ];
  prueba("008: nombres con medio (cable/fibra a otra ubicación: «conectada a … en …»; radio en la misma: «enlazado a …»)", ()=>{
    const n = N.nombresAutomaticos({ equipos:EN, ubicaciones:U, tipos:T });
    assert.equal(n.get(5), "Cámara en Poste 3 conectada a Switch en Torre K");
    assert.equal(n.get(6), "Cámara (Norte) en Poste 3 conectada a Switch en Torre K");
    assert.equal(n.get(7), "AP en Torre K enlazado a Switch");
    assert.equal(n.get(8), "Cámara en Poste 3 enlazada a Switch en Torre K");
    assert.equal(N.nombreBase({ ubicacion_id:"2", tipo_equipo:"camara", servidor_id:"4", medio:"" }, N.contextoNombres({ equipos:EN, ubicaciones:U, tipos:T })), "Cámara en Poste 3 enlazada a Switch en Torre K", "valores del formulario (texto)");
  });
}

// ---------------------------------------------------------------- 009: piscinas
prueba("piscinas: validación de puntos (igual que el CHECK)", ()=>{
  assert.ok(PI.validarPuntosPiscina([[-2.3, -79.7], [-2.3, -79.69], [-2.31, -79.69]]));
  assert.ok(!PI.validarPuntosPiscina([[-2.3, -79.7], [-2.3, -79.69]]), "dos puntos");
  assert.ok(!PI.validarPuntosPiscina([[-2.3, -79.7], [-2.3, -79.69], [-95, 0]]), "latitud fuera de rango");
  assert.ok(!PI.validarPuntosPiscina([[-2.3, -79.7], [-2.3, "x"], [-2.31, -79.69]]), "no numérico");
  assert.ok(!PI.validarPuntosPiscina(null));
});
prueba("piscinas: un cuadrado de 4,7 ha mide 4,7 ha y su centro es el pedido", ()=>{
  const q = PI.cuadradoAlrededor([-2.34, -79.72], 4.7);
  cerca(PI.areaHectareas(q), 4.7, 0.01);
  const c = PI.centroide(q);
  cerca(c[0], -2.34, 1e-6); cerca(c[1], -79.72, 1e-6);
  cerca(geo.distanciaKm({ lat:q[0][0], lng:q[0][1] }, { lat:q[1][0], lng:q[1][1] }) * 1000, Math.sqrt(47000), 0.5, "lado");
});
prueba("piscinas: el área no depende del sentido ni del punto de inicio", ()=>{
  const q = PI.cuadradoAlrededor([-2.34, -79.72], 2);
  cerca(PI.areaM2([...q].reverse()), PI.areaM2(q), 1e-6);
  cerca(PI.areaM2([...q.slice(2), ...q.slice(0, 2)]), PI.areaM2(q), 1e-6);
});
prueba("piscinas: editor (insertar en un lado, mover, quitar sin bajar de 3)", ()=>{
  const q = PI.cuadradoAlrededor([-2.34, -79.72], 1);
  const m = PI.puntoMedio(q[0], q[1]);
  const q5 = PI.insertarVertice(q, 0, m);
  assert.equal(q5.length, 5); assert.deepEqual(q5[1], m);
  const mov = PI.moverVertice(q5, 1, PI.desplazarMetros(m, 10, 0));
  cerca(geo.distanciaKm({ lat:m[0], lng:m[1] }, { lat:mov[1][0], lng:mov[1][1] }) * 1000, 10, 0.05, "10 m al norte");
  assert.equal(PI.quitarVertice(q5, 1).length, 4);
  assert.equal(PI.quitarVertice(q.slice(0, 3), 0), null);
  assert.deepEqual(q, PI.cuadradoAlrededor([-2.34, -79.72], 1), "no muta el original");
});
prueba("piscinas: validación del formulario, hectáreas con coma, sector y textos", ()=>{
  const lista = [{ id:1, nombre:"L01" }];
  assert.equal(PI.validarPiscina({ nombre:" l01 " }, lista).errores.nombre, "Ya hay una piscina con ese nombre.");
  assert.ok(PI.validarPiscina({ nombre:"L01" }, lista, 1).ok);
  assert.ok(PI.validarPiscina({ nombre:"" }).errores.nombre);
  assert.ok(PI.validarPiscina({ nombre:"X", hectareas:"-1" }).errores.hectareas);
  assert.ok(PI.validarPiscina({ nombre:"X", hectareas:"4,7" }).ok);
  assert.ok(PI.validarPiscina({ nombre:"X", puntos:[[0, 0]] }).errores.puntos);
  assert.equal(PI.numeroHectareas("4,75"), 4.75); assert.equal(PI.numeroHectareas(""), null); assert.ok(Number.isNaN(PI.numeroHectareas("abc")));
  assert.equal(PI.sectorDeNombre("pcm04"), "PCM"); assert.equal(PI.sectorDeNombre("12"), "");
  assert.equal(PI.fmtHectareas(4.7), "4,70 ha"); assert.equal(PI.fmtHectareas(null), "—");
  cerca(PI.diferenciaArea(4.7, PI.cuadradoAlrededor([-2.34, -79.72], 4.935)), 5, 0.05);
  assert.equal(PI.diferenciaArea(null, []), null);
});
prueba("piscinas: caja de varias piscinas", ()=>{
  const caja = PI.cajaPiscinas([{ puntos:[[-2.3, -79.7], [-2.31, -79.69], [-2.32, -79.71]] }, { puntos:[[-2.35, -79.72], [-2.36, -79.7], [-2.34, -79.73]] }]);
  assert.deepEqual(caja, [[-2.36, -79.73], [-2.3, -79.69]]);
  assert.equal(PI.cajaPiscinas([]), null);
});
// ---------------------------------------------------------------- v8: la red en el nombre (010)
const REDES_N = [{ id:1, nombre:"Red Oficina", color:"#004DAB" }, { id:2, nombre:" Red  Cámaras ", color:"#EC741D" }];
const ctxRed = equipos=>({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED, redes: REDES_N, conRed: true });
prueba("010: la red va entre paréntesis con la referencia («Red · Referencia»); la del servidor solo si es distinta", ()=>{
  const equipos = [
    eqN(1, 3, "router", null, { red_id:1 }),
    eqN(2, 3, "switch", 1, { red_id:1 }),                                // misma red que su servidor: no se repite
    eqN(3, 1, "camara", 2, { red_id:2, referencia:" Norte ", medio:"cable" }), // otra red: se nombra la del servidor
    eqN(4, 3, "ap", 2),                                                  // sin red: se nombra la del servidor
    eqN(5, 2, "ptp", 4, { red_id:1 }),                                   // servidor sin red: nada que nombrar
  ];
  const n = N.nombresAutomaticos(ctxRed(equipos));
  assert.equal(n.get(1), "Router (Red Oficina) en Oficina");
  assert.equal(n.get(2), "Switch (Red Oficina) en Oficina conectado a Router");
  assert.equal(n.get(3), "Cámara (Red  Cámaras · Norte) en Torre K conectada a Switch (Red Oficina) en Oficina");
  assert.equal(n.get(4), "AP en Oficina conectado a Switch (Red Oficina)");
  assert.equal(n.get(5), "Punto a Punto (Red Oficina) en Torre L enlazado a AP en Oficina");
});
prueba("010: sin la migración (conRed = false) la red no entra en el nombre, como en la base", ()=>{
  const equipos = [eqN(1, 3, "router", null, { red_id:1 }), eqN(2, 3, "switch", 1, { red_id:2 })];
  const n = N.nombresAutomaticos({ ...ctxRed(equipos), conRed: false });
  assert.equal(n.get(1), "Router en Oficina");
  assert.equal(n.get(2), "Switch en Oficina conectado a Router");
});
prueba("010: una red que ya no existe no se nombra; un servidor sin tipo sigue con su nombre guardado", ()=>{
  const equipos = [eqN(1, 3, null, null, { red_id:2, nombre:"Radio viejo" }), eqN(2, 3, "switch", 1, { red_id:99 })];
  const n = N.nombresAutomaticos(ctxRed(equipos));
  assert.equal(n.get(2), "Switch en Oficina conectado a Radio viejo");
});
prueba("010: con la misma red se numera «(2)»; con otra red ya no chocan", ()=>{
  const equipos = [eqN(1, 1, "camara", null, { red_id:1 }), eqN(2, 1, "camara", null, { red_id:1 }), eqN(3, 1, "camara", null, { red_id:2 })];
  const n = N.nombresAutomaticos(ctxRed(equipos));
  assert.equal(n.get(1), "Cámara (Red Oficina) en Torre K");
  assert.equal(n.get(2), "Cámara (Red Oficina) en Torre K (2)");
  assert.equal(n.get(3), "Cámara (Red  Cámaras) en Torre K");
  assert.equal(N.nombreParaGuardar({ ubicacion_id:1, tipo_equipo:"camara", red_id:2 }, ctxRed(equipos), 3), "Cámara (Red  Cámaras) en Torre K");
  assert.equal(N.textoParentesis(["  ", null, " Sur "]), " (Sur)");
  assert.equal(N.textoParentesis([]), "");
});

// ---------------------------------------------------------------- v8: selector de servidor
const UB_S = [
  { id:1, nombre:"Torre principal", lat:-2.351129, lng:-79.724676 },
  { id:2, nombre:"Data Center", lat:-2.350922, lng:-79.724339 },
  { id:3, nombre:"Intensivo", lat:-2.342065, lng:-79.726569 },
  { id:4, nombre:"Bodega", lat:-2.352943, lng:-79.725584 },
];
const UB_S_MAP = new Map(UB_S.map(u=>[u.id, u]));
const TIPOS_S = [...TIPOS_RED, { valor:"nvr", etiqueta:"NVR", genero:"m", activo:false }];
const EQ_S = [
  { id:10, ubicacion_id:1, nombre:"Punto a Punto (Apuntando al Intensivo) en Torre principal", tipo_equipo:"ptp", red_id:1, modelo:"Cambium PTP 550" },
  { id:11, ubicacion_id:1, nombre:"Switch en Torre principal", tipo_equipo:"switch", red_id:null },
  { id:12, ubicacion_id:3, nombre:"Estación (Red Oficina) en Intensivo", tipo_equipo:"estacion", red_id:1, activo_id:7 },
  { id:13, ubicacion_id:4, nombre:"PTP viejo", tipo_equipo:null, red_id:null },
];
const ACT_S = [
  { id:134, tipo:"Router", marca:"MikroTik", modelo:"RB4011", propiedad:"lukmar" }, // ubicado en el Data Center: se ofrece
  { id:135, tipo:"router", marca:null, modelo:null },     // sin ubicación: no
  { id:136, tipo:"Laptop", marca:"Dell", modelo:"5440" },  // no es de red: no
  { id:7, tipo:"Estación", marca:null, modelo:null },     // ya es un equipo (12): no
  { id:138, tipo:"NVR", marca:null, modelo:null },        // tipo inactivo: no
  { id:139, tipo:"Cámara", marca:"Hik", modelo:null },    // excluido a propósito (es el activo del propio equipo): no
];
const VIG_S = new Map([[134, { ubicacion_id:2 }], [136, { ubicacion_id:2 }], [7, { ubicacion_id:3 }], [138, { ubicacion_id:2 }], [139, { ubicacion_id:2 }]]);
const opcionesS = (extra = {})=>SS.opcionesServidor({
  candidatos: EQ_S, ubicacionId: 1, ubicacionPorId: UB_S_MAP, tiposEquipo: TIPOS_S, redes: REDES_N,
  conActivos: true, activos: ACT_S, vigentePorActivo: VIG_S, equipoPorActivo: new Map([[7, EQ_S[2]]]),
  excluirActivos: [139], tagActivo: a=>`LKM-${a.id}`, ...extra,
});
prueba("selector: tipo de red de un activo por etiqueta o valor, sin tildes ni mayúsculas (y no uno inactivo)", ()=>{
  assert.equal(SS.tipoEquipoDeActivo("Router", TIPOS_S), "router");
  assert.equal(SS.tipoEquipoDeActivo(" ESTACION ", TIPOS_S), "estacion");
  assert.equal(SS.tipoEquipoDeActivo("punto a punto", TIPOS_S), "ptp");
  assert.equal(SS.tipoEquipoDeActivo("NVR", TIPOS_S), null);
  assert.equal(SS.tipoEquipoDeActivo("Laptop", TIPOS_S), null);
  assert.equal(SS.tipoEquipoDeActivo("", TIPOS_S), null);
});
prueba("selector: ofrece los equipos candidatos y los activos ubicados de un tipo de red que todavía no son equipos", ()=>{
  const ops = opcionesS();
  assert.deepEqual(ops.map(o=>o.clave), ["10", "11", "12", "13", "a:134"]);
  const r = ops.find(o=>o.clave === "a:134");
  assert.equal(r.origen, "activo"); assert.equal(r.nombre, "Router en Data Center"); assert.equal(r.tipo, "router");
  assert.equal(r.ubicacionNombre, "Data Center"); assert.equal(r.tag, "LKM-134"); assert.equal(r.modelo, "MikroTik RB4011");
  assert.equal(r.misma, false); cerca(r.distanciaKm, 0.044, 0.01, "Data Center a unos 44 m");
  const s = ops.find(o=>o.clave === "11");
  assert.equal(s.misma, true); assert.equal(s.distanciaKm, 0);
  assert.equal(ops.find(o=>o.clave === "10").redNombre, "Red Oficina");
  assert.equal(opcionesS({ conActivos: false }).length, 4, "sin activos (formulario de respaldo)");
  assert.equal(opcionesS({ nombreNuevo: ({ tipo, ubicacion })=>`${tipo}@${ubicacion.id}` }).find(o=>o.origen === "activo").nombre, "router@2");
});
prueba("selector: búsqueda sin tildes, por varias palabras y por tag o modelo", ()=>{
  const ops = opcionesS();
  assert.deepEqual(SS.filtrarServidores(ops, { texto:"router data" }).map(o=>o.clave), ["a:134"]);
  assert.deepEqual(SS.filtrarServidores(ops, { texto:"ESTACION" }).map(o=>o.clave), ["12"]);
  assert.deepEqual(SS.filtrarServidores(ops, { texto:"lkm-134" }).map(o=>o.clave), ["a:134"]);
  assert.deepEqual(SS.filtrarServidores(ops, { texto:"cambium" }).map(o=>o.clave), ["10"]);
  assert.equal(SS.filtrarServidores(ops, { texto:"   " }).length, 5);
  assert.equal(SS.filtrarServidores(ops, { texto:"zzz" }).length, 0);
});
prueba("selector: filtros por ubicación, tipo, red y origen (null = todos, vacío = ninguno)", ()=>{
  const ops = opcionesS();
  assert.deepEqual(SS.filtrarServidores(ops, { filtros:{ ubicacion: new Set(["1"]) } }).map(o=>o.clave), ["10", "11"]);
  assert.deepEqual(SS.filtrarServidores(ops, { filtros:{ tipo: new Set(["router", "sin"]) } }).map(o=>o.clave), ["13", "a:134"]);
  assert.deepEqual(SS.filtrarServidores(ops, { filtros:{ red: new Set(["1"]) } }).map(o=>o.clave), ["10", "12"]);
  assert.deepEqual(SS.filtrarServidores(ops, { filtros:{ origen: new Set(["activo"]) } }).map(o=>o.clave), ["a:134"]);
  assert.equal(SS.filtrarServidores(ops, { filtros:{ ubicacion: new Set() } }).length, 0);
  assert.equal(SS.filtrarServidores(ops, { filtros:{ ubicacion: null } }).length, 5);
});
prueba("selector: facetas con cuentas que respetan la búsqueda y las demás facetas (como los filtros de la tabla)", ()=>{
  const ops = opcionesS();
  const f = SS.facetasServidor(ops);
  assert.deepEqual(Object.keys(f), ["ubicacion", "tipo", "red", "origen"]);
  assert.deepEqual(f.ubicacion.map(v=>`${v.etiqueta}:${v.n}`), ["Torre principal:2", "Bodega:1", "Data Center:1", "Intensivo:1"], "la propia ubicación primero");
  assert.equal(f.tipo[f.tipo.length - 1].valor, "sin", "«Sin tipo» al final");
  assert.deepEqual(f.origen.map(v=>v.valor), ["equipo", "activo"]);
  const g = SS.facetasServidor(ops, { filtros:{ ubicacion: new Set(["1"]) } });
  assert.equal(g.ubicacion.find(v=>v.valor === "2").n, 1, "su propia faceta no se filtra a sí misma");
  assert.equal(g.tipo.find(v=>v.valor === "router").n, 0, "las demás sí");
  const h = SS.facetasServidor(ops, { texto:"torre" });
  assert.equal(h.ubicacion.find(v=>v.valor === "1").n, 2);
  assert.equal(h.ubicacion.find(v=>v.valor === "2").n, 0);
  assert.ok(!("origen" in SS.facetasServidor(opcionesS({ conActivos: false }))), "una faceta con un solo valor no se muestra");
});
prueba("selector: orden más cerca primero (misma ubicación arriba), por nombre, ubicación y tipo", ()=>{
  const ops = opcionesS();
  assert.deepEqual(SS.ordenarServidores(ops, "cerca").map(o=>o.clave), ["10", "11", "a:134", "13", "12"]);
  assert.deepEqual(SS.ordenarServidores(ops, "az").map(o=>o.clave), ["12", "13", "10", "a:134", "11"]);
  assert.deepEqual(SS.ordenarServidores(ops, "za").map(o=>o.clave), ["11", "a:134", "10", "13", "12"]);
  assert.deepEqual(SS.ordenarServidores(ops, "ubicacion").map(o=>o.clave), ["13", "a:134", "12", "10", "11"]);
  assert.deepEqual(SS.ordenarServidores(ops, "tipo").map(o=>o.tipoEtiqueta), ["Estación", "Punto a Punto", "Router", "Switch", null]);
  assert.deepEqual(SS.ordenarServidores(ops, "otro").map(o=>o.clave), SS.ordenarServidores(ops, "cerca").map(o=>o.clave), "orden desconocido = por defecto");
  assert.ok(SS.esOrdenServidor("za") && !SS.esOrdenServidor("x"));
});
prueba("selector: sugiere cable cuando el servidor está en otra ubicación y un extremo no hace radio", ()=>{
  assert.equal(SS.medioSugerido({ clienteTipo:"ptp", servidorTipo:"router", misma:false }), "cable");
  assert.equal(SS.medioSugerido({ clienteTipo:"camara", servidorTipo:"switch", misma:false }), "cable");
  assert.equal(SS.medioSugerido({ clienteTipo:null, servidorTipo:"router", misma:false }), "cable");
  assert.equal(SS.medioSugerido({ clienteTipo:"estacion", servidorTipo:"ptp", misma:false }), null, "radio con radio: automático");
  assert.equal(SS.medioSugerido({ clienteTipo:null, servidorTipo:null, misma:false }), null, "sin tipos no se sabe");
  assert.equal(SS.medioSugerido({ clienteTipo:"ptp", servidorTipo:"router", misma:true }), null, "en la misma ubicación el automático ya es cable");
  assert.equal(SS.motivoMedioSugerido({ clienteTipo:"ptp", servidorTipo:"router" }, TIPOS_S), "Router no hace radioenlaces");
  assert.equal(SS.motivoMedioSugerido({ clienteTipo:"camara", servidorTipo:"ptp" }, TIPOS_S), "Cámara no hace radioenlaces");
  assert.equal(SS.haceRadio(null), null);
});

// ---------------------------------------------------------------- v9: la red se hereda del servidor (011)
const REDES_H = [{ id:1, nombre:"Red Oficina", color:"#007EB2" }, { id:2, nombre:"CCTV", color:"#FBFF00" }, { id:3, nombre:"Invitados", color:"#2E8B57" }];
// Router(1, Red Oficina) ← PTP(2) ← Estación(3, en otra torre) ← Switch(4, CCTV) ← Cámara(5) y Cámara(6, Invitados) ← NVR sin tipo(7)
const EQ_H = ()=>[
  eqN(1, 3, "router", null, { red_id:1 }),
  eqN(2, 3, "ptp", 1),
  eqN(3, 1, "estacion", 2),
  eqN(4, 1, "switch", 3, { red_id:2 }),
  eqN(5, 1, "camara", 4),
  eqN(6, 1, "camara", 4, { red_id:3, referencia:"Norte" }),
  eqN(7, 1, null, 6, { nombre:"NVR viejo" }),
];
prueba("011: red efectiva = la propia o la del servidor, hasta la raíz; una red propia distinta empieza una red aparte", ()=>{
  const ef = J.redesEfectivas(EQ_H());
  const r = id=>ef.get(id);
  assert.deepEqual(r(1), { redId:1, desdeId:1 });
  assert.deepEqual(r(2), { redId:1, desdeId:1 });
  assert.deepEqual(r(3), { redId:1, desdeId:1 });
  assert.deepEqual(r(4), { redId:2, desdeId:4 }, "el switch con CCTV: red aparte");
  assert.deepEqual(r(5), { redId:2, desdeId:4 }, "su cámara la hereda de él");
  assert.deepEqual(r(6), { redId:3, desdeId:6 });
  assert.deepEqual(r(7), { redId:3, desdeId:6 }, "un equipo sin tipo también hereda");
  // Sin red en el camino, un servidor que no existe o un ciclo (que la base no deja): sin red.
  const raros = J.redesEfectivas([eqN(1, 1, "ptp"), eqN(2, 1, "ap", 1), eqN(3, 1, "ap", 99), eqN(4, 1, "ap", 5), eqN(5, 1, "ap", 4)]);
  for(const id of [1, 2, 3, 4, 5]) assert.deepEqual(raros.get(id), { redId:null, desdeId:null }, `id ${id}`);
  assert.deepEqual(J.redesEfectivas([{ id:1, red_id:"2", servidor_id:null }]).get(1), { redId:2, desdeId:1 }, "el id de la red llega como texto desde un select");
});
prueba("011: anotar deja red_efectiva y de quién la hereda; sin la 011 cada equipo muestra solo su red", ()=>{
  const eqs = EQ_H();
  J.anotarRedesEfectivas(eqs, true);
  const e = id=>eqs.find(x=>x.id === id);
  assert.equal(J.redEfectivaDe(e(5)), 2);
  assert.equal(J.redHeredadaDe(e(5)), 4);
  assert.equal(J.redHeredadaDe(e(4)), null, "la del switch es propia");
  assert.equal(J.redHeredadaDe(e(1)), null);
  assert.equal(J.claveRed(e(3)), "1");
  assert.equal(e(4).red_id, 2, "red_id sigue siendo la propia");
  J.anotarRedesEfectivas(eqs, false);
  assert.equal(J.redEfectivaDe(e(5)), null);
  assert.equal(J.claveRed(e(3)), "sin");
  assert.equal(J.claveRed(e(4)), "2");
  assert.ok(!("red_efectiva" in e(5)) && !("red_desde" in e(5)));
  assert.equal(J.redEfectivaDe(null), null);
});
prueba("011: filtro por red y cuentas con la red efectiva (ocultar Red Oficina no oculta la red aparte CCTV)", ()=>{
  const eqs = EQ_H();
  J.anotarRedesEfectivas(eqs, true);
  const red = J.analizarRed({ equipos: eqs, ubicaciones: UB_RED.map(u=>({ ...u, lat:-2.3 - u.id * 0.01, lng:-79.7 })) });
  const visibles = eqs.filter(e=>J.equipoVisible(red, e.id, { redesOcultas: ["1"] })).map(e=>e.id);
  assert.deepEqual(visibles, [4, 5, 6, 7]);
  const cuenta = new Map();
  for(const e of eqs){ const k = J.claveRed(e); cuenta.set(k, (cuenta.get(k) || 0) + 1); }
  assert.deepEqual(Object.fromEntries(cuenta), { "1":3, "2":2, "3":2 });
});
prueba("011: herederos de la red de un equipo = lo que cuelga de él sin red propia (sin entrar en las redes aparte)", ()=>{
  const eqs = EQ_H();
  const red = J.analizarRed({ equipos: eqs, ubicaciones: UB_RED.map(u=>({ ...u, lat:-2.3 - u.id * 0.01, lng:-79.7 })) });
  assert.deepEqual(J.herederosDeRed(red, 1).map(e=>e.id).sort(), [2, 3]);
  assert.deepEqual(J.herederosDeRed(red, 4).map(e=>e.id).sort(), [5]);
  assert.deepEqual(J.herederosDeRed(red, 6).map(e=>e.id), [7]);
  assert.deepEqual(J.herederosDeRed(red, 7), []);
});
const ctxH = (equipos, herencia = true)=>({ equipos, ubicaciones: UB_RED, tipos: TIPOS_RED, redes: REDES_H, conRed: true, herencia });
prueba("011: el nombre lleva la red heredada; la del servidor, solo si es distinta (en el borde de una red aparte)", ()=>{
  const n = N.nombresAutomaticos(ctxH(EQ_H()));
  assert.equal(n.get(1), "Router (Red Oficina) en Oficina");
  assert.equal(n.get(2), "Punto a Punto (Red Oficina) en Oficina conectado a Router");
  assert.equal(n.get(3), "Estación (Red Oficina) en Torre K enlazada a Punto a Punto en Oficina");
  assert.equal(n.get(4), "Switch (CCTV) en Torre K conectado a Estación (Red Oficina)");
  assert.equal(n.get(5), "Cámara (CCTV) en Torre K conectada a Switch");
  assert.equal(n.get(6), "Cámara (Invitados · Norte) en Torre K conectada a Switch (CCTV)");
  assert.equal(n.get(7), "NVR viejo", "sin tipo: su nombre de siempre");
});
prueba("011: sin la 011 (herencia = false) cada equipo lleva solo su red propia, como con la 010", ()=>{
  const n = N.nombresAutomaticos(ctxH(EQ_H(), false));
  assert.equal(n.get(2), "Punto a Punto en Oficina conectado a Router (Red Oficina)");
  assert.equal(n.get(5), "Cámara en Torre K conectada a Switch (CCTV)");
  const sinRed = N.nombresAutomaticos({ ...ctxH(EQ_H()), conRed: false });
  assert.equal(sinRed.get(5), "Cámara en Torre K conectada a Switch", "sin la 010 no hay red que heredar");
});
prueba("011: cambiar la red de la raíz cambia el nombre de lo que la hereda, no el de la red aparte", ()=>{
  const eqs = EQ_H().map(e=>e.id === 1 ? { ...e, red_id:3 } : e);
  const n = N.nombresAutomaticos(ctxH(eqs));
  assert.equal(n.get(3), "Estación (Invitados) en Torre K enlazada a Punto a Punto en Oficina");
  assert.equal(n.get(4), "Switch (CCTV) en Torre K conectado a Estación (Invitados)");
  assert.equal(n.get(5), "Cámara (CCTV) en Torre K conectada a Switch");
  assert.equal(n.get(6), "Cámara (Invitados · Norte) en Torre K conectada a Switch (CCTV)");
});
prueba("011: nombre para guardar de un equipo editado: sin red propia hereda la del servidor elegido", ()=>{
  const eqs = N.aplicarNombres(EQ_H(), ctxH([]));
  assert.equal(N.nombreParaGuardar({ ubicacion_id:1, tipo_equipo:"camara", red_id:"", servidor_id:4 }, ctxH(eqs), null), "Cámara (CCTV) en Torre K conectada a Switch (2)");
  assert.equal(N.nombreParaGuardar({ ubicacion_id:1, tipo_equipo:"camara", red_id:"", servidor_id:3, referencia:"Sur" }, ctxH(eqs), null), "Cámara (Red Oficina · Sur) en Torre K conectada a Estación");
  assert.equal(N.nombreParaGuardar({ ubicacion_id:1, tipo_equipo:"camara", red_id:"1", servidor_id:4, referencia:"Sur" }, ctxH(eqs), null), "Cámara (Red Oficina · Sur) en Torre K conectada a Switch (CCTV)");
  // El switch editado (id 4) sin red propia: pasa a heredar Red Oficina de la estación.
  assert.equal(N.nombreParaGuardar({ ubicacion_id:1, tipo_equipo:"switch", red_id:null, servidor_id:3 }, ctxH(eqs), 4), "Switch (Red Oficina) en Torre K conectado a Estación");
});
prueba("011: el selector de servidor muestra y filtra por la red efectiva y marca la heredada", ()=>{
  const eqs = EQ_H();
  J.anotarRedesEfectivas(eqs, true);
  const ops = SS.opcionesServidor({ candidatos: eqs.filter(e=>e.id !== 5), ubicacionId: 1, ubicacionPorId: new Map(UB_RED.map(u=>[u.id, { ...u, lat:-2.3 - u.id * 0.01, lng:-79.7 }])), tiposEquipo: TIPOS_RED, redes: REDES_H });
  const op = id=>ops.find(o=>o.clave === String(id));
  assert.equal(op(3).redNombre, "Red Oficina"); assert.equal(op(3).redHeredada, true);
  assert.equal(op(4).redNombre, "CCTV"); assert.equal(op(4).redHeredada, false);
  assert.equal(op(7).redNombre, "Invitados"); assert.equal(op(7).redHeredada, true);
  const f = SS.facetasServidor(ops, {});
  assert.deepEqual(f.red.map(v=>[v.etiqueta, v.n]), [["CCTV", 1], ["Invitados", 2], ["Red Oficina", 3]]);
  assert.deepEqual(SS.filtrarServidores(ops, { texto: "invitados" }).map(o=>o.clave).sort(), ["6", "7"]);
});

// ---------------------------------------------------------------- v9: grosor de las líneas (v11: desde 0)
prueba("grosor: factor entre 0× y 3× de a 0,25 (lo que falta o no es número vuelve a 1×)", ()=>{
  assert.equal(J.GROSOR_LINEAS.min, 0);
  assert.equal(J.normalizarGrosor(2), 2);
  assert.equal(J.normalizarGrosor("1.6"), 1.5);
  assert.equal(J.normalizarGrosor(0.2), 0.25);
  assert.equal(J.normalizarGrosor(9), 3);
  // v11: 0 es un valor válido («sin líneas»), también como texto (localStorage) y -0.
  for(const cero of [0, "0", "0.0", 0.1, -0]) assert.ok(Object.is(J.normalizarGrosor(cero), 0), String(cero));
  // Number("") y Number(null) darían 0: lo que falta sigue volviendo a 1×.
  for(const raro of [null, undefined, "", "  ", "abc", -1, -0.25, NaN, Infinity, true, false]) assert.equal(J.normalizarGrosor(raro), 1, String(raro));
  assert.equal(J.textoGrosor(1.5), "1,5×");
  assert.equal(J.textoGrosor(1), "1×");
  assert.equal(J.textoGrosor(0.75), "0,75×");
  assert.equal(J.textoGrosor(0.25), "0,25×");
  assert.equal(J.textoGrosor(0), "0× (sin líneas)");
  assert.equal(J.textoGrosor("0"), "0× (sin líneas)");
});
prueba("grosor 0 (v11): ninguna línea, salvo el camino resaltado del equipo elegido, al mínimo visible", ()=>{
  assert.equal(J.GROSOR_MINIMO_VISIBLE, 0.5);
  assert.equal(J.grosorDeLinea(0), 0);
  assert.equal(J.grosorDeLinea("0", { enCadena: false }), 0);
  assert.equal(J.grosorDeLinea(0, { enCadena: true }), 0.5);
  assert.equal(J.grosorDeLinea(2, { enCadena: true }), 2, "con otro grosor, el camino va con ese");
  assert.equal(J.grosorDeLinea(0.25, { enCadena: true }), 0.25);
  assert.equal(J.grosorDeLinea(null), 1);
  assert.equal(J.grosorDeLinea(undefined, { enCadena: true }), 1);
  // conGrosor con 0: no se dibuja (un dashArray «0 0» se vería continuo).
  assert.equal(J.conGrosor({ weight:3, dashArray:"3 8" }, 0), null);
  assert.equal(J.conGrosor(null, 0), null);
  assert.deepEqual(J.conGrosor({ weight:6, dashArray:"12 7" }, J.grosorDeLinea(0, { enCadena: true })), { weight:3, dashArray:"6 3.5" });
});
prueba("«Sin red» (v11, 3.6): una ubicación sin equipos de red cuenta como «Sin red»", ()=>{
  const todos = ()=>true, ninguno = ()=>false;
  assert.equal(J.ubicacionVisiblePorEquipos([], {}), true, "sin filtros se ve");
  assert.equal(J.ubicacionVisiblePorEquipos([], { redesOcultas: ["1"] }), true, "ocultar otra red no la toca");
  assert.equal(J.ubicacionVisiblePorEquipos([], { redesOcultas: ["sin"] }), false, "con «Sin red» apagado se oculta");
  assert.equal(J.ubicacionVisiblePorEquipos(undefined, { redesOcultas: ["sin"] }), false);
  assert.equal(J.ubicacionVisiblePorEquipos([], { redesOcultas: [], rolesOcultos: ["raiz", "backbone", "distribucion", "cliente"] }), true, "los roles no tocan a las vacías");
  assert.equal(J.ubicacionVisiblePorEquipos([{ id:1 }, { id:2 }], { redesOcultas: ["sin"] }, id=>id === 2), true, "con equipos: si alguno se ve");
  assert.equal(J.ubicacionVisiblePorEquipos([{ id:1 }], { redesOcultas: [] }, ninguno), false, "con equipos: si ninguno se ve");
  assert.equal(J.ubicacionVisiblePorEquipos([{ id:1 }], { redesOcultas: ["sin"] }, todos), true);
  const ubic = [{ id:1, activa:true }, { id:2, activa:true }, { id:3, activa:false }, { id:4 }];
  const porUbic = new Map([[1, [{ id:10 }]], [2, []]]);
  assert.deepEqual(J.ubicacionesSinEquipos(ubic, porUbic).map(u=>u.id), [2, 4], "las archivadas no cuentan");
  assert.deepEqual(J.ubicacionesSinEquipos(ubic, porUbic, { verArchivadas: true }).map(u=>u.id), [2, 3, 4], "salvo si se están viendo");
  assert.deepEqual(J.ubicacionesSinEquipos(ubic, null).map(u=>u.id), [1, 2, 4]);
  assert.deepEqual(J.ubicacionesSinEquipos(null, porUbic), []);
});
prueba("«Sin red» (v11): la ayuda dice qué oculta, con cuántos son", ()=>{
  assert.equal(J.tituloSinRed(true, 7, 0), "Ocultar los equipos de «Sin red»", "sin vacías, como antes");
  assert.equal(J.tituloSinRed(false, 7, 0), "Mostrar los equipos de «Sin red»");
  assert.equal(J.tituloSinRed(true, 7, 9), "Ocultar los 7 equipos sin red y las 9 ubicaciones sin equipos de red");
  assert.equal(J.tituloSinRed(false, 1, 1), "Mostrar el equipo sin red y la ubicación sin equipos de red");
  assert.equal(J.tituloSinRed(true, 0, 9), "Ocultar las 9 ubicaciones sin equipos de red");
  assert.equal(J.tituloSinRed(true, 0, 1), "Ocultar la ubicación sin equipos de red");
});
prueba("grosor: escala el ancho y los punteados (conservan su forma); con 1× no copia nada", ()=>{
  const base = { color:"#000", weight:2.2, opacity:0.8, dashArray:"3 8" };
  const doble = J.conGrosor(base, 2);
  assert.deepEqual(doble, { color:"#000", weight:4.4, opacity:0.8, dashArray:"6 16" });
  assert.equal(base.weight, 2.2, "no toca el original");
  assert.equal(J.conGrosor(base, 1), base);
  assert.deepEqual(J.conGrosor({ weight:5 }, 0.5), { weight:2.5 });
  assert.equal(J.conGrosor({ weight:3, dashArray:"12, 7" }, 1.5).dashArray, "18 10.5");
  assert.equal(J.conGrosor(null, 2), null);
});

// ---------------------------------------------------------------- v12: filtros en desplegables (3.3), tipo de equipo (3.4) y «solo esta» (3.5)
prueba("«solo esta»: deja solo esa; si ya era la única, vuelven todas (también con lo oculto)", ()=>{
  const todos = ["a", "b", "c"];
  assert.deepEqual(SOLO.soloEsta(todos, ["a", "b", "c"], "b"), ["b"]);
  assert.deepEqual(SOLO.soloEsta(todos, new Set(["a", "c"]), "c"), ["c"]);
  assert.deepEqual(SOLO.soloEsta(todos, ["b"], "b"), ["a", "b", "c"], "la única: vuelven todas");
  assert.deepEqual(SOLO.soloEsta(todos, [], "a"), ["a"], "con ninguna marcada");
  assert.deepEqual(SOLO.soloEsta(todos, null, "a"), ["a"]);
  // Los filtros del mapa guardan lo oculto.
  assert.deepEqual(SOLO.soloEstaOcultos(todos, [], "b"), ["a", "c"]);
  assert.deepEqual(SOLO.soloEstaOcultos(todos, ["a", "c"], "b"), [], "la única a la vista: vuelven todas");
  assert.deepEqual(SOLO.soloEstaOcultos(todos, ["a", "b", "c"], "a"), ["b", "c"], "con todas ocultas, queda esa");
  assert.deepEqual(FM.ocultosSoloEsta(todos, ["x"], "a"), ["b", "c"], "lo oculto que ya no es opción no cuenta");
  assert.equal(SOLO.esMayusEnter({ key: "Enter", shiftKey: true }), true);
  for(const e of [{ key: "Enter" }, { key: "Enter", shiftKey: true, ctrlKey: true }, { key: "Enter", shiftKey: true, metaKey: true }, { key: " ", shiftKey: true }, null]) assert.equal(SOLO.esMayusEnter(e), false, JSON.stringify(e));
  assert.match(SOLO.tituloSolo("Red Oficina"), /^Dejar solo «Red Oficina» \(Mayús\+Enter\)/);
  assert.match(SOLO.AYUDA_SOLO, /Doble clic, «solo» o Mayús\+Enter/);
});
prueba("desplegables: cuenta «a/b», «Quitar filtros» y cuántos filtros hay (la simulación aparte)", ()=>{
  assert.deepEqual(FM.resumenDesplegable(["a", "b", "c"], ["b"]), { visibles: 2, total: 3, texto: "2/3", filtrado: true });
  assert.deepEqual(FM.resumenDesplegable(["a", "b"], ["z"]), { visibles: 2, total: 2, texto: "2/2", filtrado: false });
  assert.equal(FM.resumenDesplegable([], []).texto, "0/0");
  const sucios = { tiposOcultos: ["torre"], verArchivadas: true, lineas: { backbone: false, p2mp: true, cable: true, respaldos: true }, rolesOcultos: ["cliente"], redesOcultas: ["1", "sin"], tiposEquipoOcultos: ["ap"], estadosOcultos: ["caido"], colorPorRed: true };
  // tipo 1 + rol 1 + redes 2 + tipo de equipo 1 + archivadas 1 + backbone apagado 1 + respaldos encendido 1
  assert.equal(FM.cuantosFiltros(sucios), 8, "sin simulación no cuentan los estados");
  assert.equal(FM.cuantosFiltros(sucios, { sim: true }), 9);
  const limpios = FM.filtrosLimpios(sucios);
  assert.deepEqual(limpios, { tiposOcultos: [], verArchivadas: false, lineas: { backbone: true, p2mp: true, cable: true, respaldos: false }, rolesOcultos: [], redesOcultas: [], tiposEquipoOcultos: [], estadosOcultos: [], colorPorRed: true }, "«Colorear líneas por red» queda");
  assert.equal(FM.cuantosFiltros(limpios, { sim: true }), 0);
  assert.equal(FM.cuantosFiltros({}), 0, "un estado vacío no rompe");
  assert.notEqual(limpios.lineas, FM.LINEAS_POR_DEFECTO, "copia, no la constante");
  assert.deepEqual(FM.lineasConVisibles(["backbone", "p2mp", "respaldos"], ["p2mp"]), { backbone: false, p2mp: true, respaldos: false });
  assert.deepEqual(FM.ocultosTodas(), []);
  assert.deepEqual(FM.ocultosNinguna(["a", "b"]), ["a", "b"]);
});
prueba("tipo de equipo (3.4): opciones con cuentas, «Sin tipo» y «Sin equipos»; las torres sin esos tipos se ocultan", ()=>{
  const tipos = [
    { valor:"router", etiqueta:"Router", orden:10, activo:true }, { valor:"ap", etiqueta:"AP", orden:40, activo:true },
    { valor:"ptp", etiqueta:"PtP-E", orden:30, activo:true }, { valor:"nvr", etiqueta:"NVR", orden:70, activo:false },
    { valor:"camara", etiqueta:"Cámara", orden:60, activo:false },
  ];
  const equipos = [{ id:1, tipo_equipo:"router" }, { id:2, tipo_equipo:"ptp" }, { id:3, tipo_equipo:"ptp" }, { id:4, tipo_equipo:"ap" }, { id:5, tipo_equipo:null }, { id:6, tipo_equipo:"camara" }];
  const o = FM.opcionesTiposEquipo(tipos, equipos, 2);
  assert.deepEqual(o.map(x=>[x.valor, x.etiqueta, x.n]), [["router", "Router", 1], ["ptp", "PtP-E", 2], ["ap", "AP", 1], ["camara", "Cámara", 1], [J.TIPO_EQUIPO_SIN, "Sin tipo", 1], [J.UBICACION_SIN_EQUIPOS, "Sin equipos", 2]], "en su orden; el inactivo sin uso no; el inactivo en uso sí");
  assert.deepEqual(FM.opcionesTiposEquipo(tipos, [{ id:1, tipo_equipo:"router" }], 0).map(x=>x.valor), ["router", "ptp", "ap"], "sin «Sin tipo» ni «Sin equipos» si no hay");
  assert.ok(!/^[a-z0-9_]+$/.test(J.TIPO_EQUIPO_SIN) && !/^[a-z0-9_]+$/.test(J.UBICACION_SIN_EQUIPOS), "las claves especiales no chocan con un valor de tipos_equipo_red");
  assert.equal(J.claveTipoEquipo({ tipo_equipo: "ap" }), "ap");
  assert.equal(J.claveTipoEquipo({ tipo_equipo: null }), J.TIPO_EQUIPO_SIN);
  // equipoVisible con los tipos ocultos.
  const red = J.analizarRed({ equipos: [{ id:1, ubicacion_id:1, servidor_id:null, tipo_equipo:"router" }, { id:2, ubicacion_id:2, servidor_id:1, tipo_equipo:"ap" }, { id:3, ubicacion_id:3, servidor_id:2, tipo_equipo:null }], ubicaciones: [{ id:1, lat:0, lng:0 }, { id:2, lat:0, lng:0.01 }, { id:3, lat:0, lng:0.02 }], respaldos: [] });
  assert.equal(J.equipoVisible(red, 2, { tiposEquipoOcultos: ["ap"] }), false);
  assert.equal(J.equipoVisible(red, 1, { tiposEquipoOcultos: ["ap"] }), true);
  assert.equal(J.equipoVisible(red, 3, { tiposEquipoOcultos: [J.TIPO_EQUIPO_SIN] }), false, "«Sin tipo»");
  assert.equal(J.equipoVisible(red, 3, {}), true, "sin el filtro, como antes");
  // Las vacías: «Sin equipos» apagado las oculta; con equipos, no la toca.
  assert.equal(J.ubicacionVisiblePorEquipos([], { tiposEquipoOcultos: [J.UBICACION_SIN_EQUIPOS] }), false);
  assert.equal(J.ubicacionVisiblePorEquipos([], { tiposEquipoOcultos: ["ap"] }), true);
  assert.equal(J.ubicacionVisiblePorEquipos([{ id:1 }], { tiposEquipoOcultos: [J.UBICACION_SIN_EQUIPOS] }, ()=>true), true);
});

prueba("v13: buscador de las listas de casillas (sin mayúsculas ni tildes, palabras en cualquier orden)", ()=>{
  assert.equal(BO.normalizarOpcion("  Cámara   IP "), "camara ip");
  assert.equal(BO.normalizarOpcion(null), "");
  assert.equal(BO.normalizarOpcion("ESTACIÓN Ñandú"), "estacion nandu", "tildes y eñe fuera, minúsculas");
  assert.ok(BO.coincideOpcion("Cámara", "camara"), "sin la tilde");
  assert.ok(BO.coincideOpcion("camara", "CÁMARA"), "la tilde en lo escrito");
  assert.ok(BO.coincideOpcion("Cámara IP", "ip cam"), "palabras en otro orden");
  assert.ok(!BO.coincideOpcion("Cámara IP", "cam wifi"), "todas las palabras tienen que estar");
  assert.ok(BO.coincideOpcion("Red Cámaras", "") && BO.coincideOpcion("Red Cámaras", "   ") && BO.coincideOpcion("x", null), "sin nada escrito, coinciden todas");
  assert.ok(BO.coincideOpcion("Punto a Punto", "a punto") && !BO.coincideOpcion("Cámara", "ap"), "partes de palabra");
  assert.ok(BO.coincideOpcion(null, "") && !BO.coincideOpcion(null, "x"), "sin nombre");
  const ops = [{ etiqueta: "Router" }, { etiqueta: "Punto a Punto" }, { etiqueta: "AP" }, { etiqueta: "Cámara" }, { etiqueta: "Sin tipo" }, { etiqueta: "Sin equipos" }];
  assert.deepEqual(BO.filtrarOpciones(ops, "sin").map(o=>o.etiqueta), ["Sin tipo", "Sin equipos"], "en su orden");
  assert.deepEqual(BO.filtrarOpciones(ops, "").length, 6);
  assert.deepEqual(BO.filtrarOpciones(["Laptop", "Antena", "Monitor"], "ANT"), ["Antena"], "también con textos");
  assert.deepEqual(BO.filtrarOpciones([{ nombre: "Red Oficina" }, { nombre: "CCTV" }], "ofi", o=>o.nombre).map(o=>o.nombre), ["Red Oficina"], "con su propio nombre");
  assert.deepEqual(BO.filtrarOpciones(null, "x"), []);
  assert.equal(BO.textoSinCoincidencias("  xyz   abc "), "Ninguna coincide con «xyz abc».");
  assert.match(BO.AYUDA_BUSCAR_OPCION, /Enter/);
  assert.match(BO.AYUDA_BUSCAR_OPCION, /Esc/);
});

// ---------------------------------------------------------------- v14 (3.8): líneas agrupadas y franjas por red
{
  // Torre principal (1) ─cable─ Data Center (2): 4 enlaces por cable (2 de CCTV, 1 de Oficina, 1 sin red) y 1 por fibra;
  // Torre principal ═radio═ Lote 9 (3): 2 backbones (AQ1 y CCTV). Redes en este orden: CCTV (2), Oficina (3), AQ1 (1).
  const U = [{ id:1, nombre:"Torre principal", lat:0, lng:0 }, { id:2, nombre:"Data Center", lat:0, lng:0.001 }, { id:3, nombre:"Lote 9", lat:0.02, lng:0.02 }];
  const e = (id, ubicacion_id, nombre, servidor_id, extra = {})=>({ id, ubicacion_id, nombre, servidor_id, banda:null, frecuencia_mhz:null, activo_id:null, ...extra });
  const E = [
    e(1, 2, "Router DC", null, { red_id:1 }),
    e(11, 1, "Cámara B", 1, { medio:"cable", red_id:2 }), e(12, 1, "Cámara A", 1, { medio:"cable", red_id:2 }),
    e(13, 1, "Switch Oficina", 1, { medio:"cable", red_id:3 }), e(14, 1, "Equipo suelto", 1, { medio:"cable", red_id:null }),
    e(15, 1, "PTP fibra", 1, { medio:"fibra", red_id:1 }),
    e(21, 1, "PTP TP → L9 a", 15, { red_id:1 }), e(22, 1, "PTP TP → L9 b", 15, { red_id:2 }),
    e(30, 3, "PTP L9 a", 21, { red_id:1 }), e(31, 3, "PTP L9 b", 22, { red_id:2 }),
  ];
  const rd = J.analizarRed({ equipos:E, ubicaciones:U, respaldos:[] });
  const nombre = id=>rd.equipoPorId.get(id).nombre;
  const redDe = d=>rd.equipoPorId.get(d.clienteId).red_id ?? null;
  const ORDEN = [2, 3, 1];
  const NOMBRE_RED = { 1:"AQ1", 2:"CCTV", 3:"Red Oficina" };
  const todas = { backbone:true, p2mp:true, cable:true, respaldos:false };
  const agrupar = (o = {})=>LA.agruparLineas(J.planDeLineas(rd, { lineas:todas, ...o }), { redDe, ordenRedes:ORDEN, nombreDe:nombre });
  const ANCHO = { backbone:5, p2mp:2.2, cable:3, fibra:3.5 };
  const anchoDe = estilo=>ANCHO[estilo];

  prueba("v14: el plan trae los ids de las ubicaciones de cada línea", ()=>{
    const d = J.planDeLineas(rd, { lineas:todas }).find(x=>x.clienteId === 30);
    assert.deepEqual([d.desdeId, d.hastaId], [1, 3], "desde el servidor hacia el cliente");
  });
  prueba("v14: clase del grupo (backbone y P2MP son radio), clave del par sin importar el sentido", ()=>{
    assert.deepEqual(["backbone", "p2mp", "cable", "fibra"].map(LA.claseDeGrupo), ["radio", "radio", "cable", "fibra"]);
    assert.equal(LA.clavePar(5, 2), "2-5"); assert.equal(LA.clavePar("2", 5), "2-5"); assert.equal(LA.clavePar(10, 9), "9-10", "como números, no como texto");
  });
  prueba("v14: se juntan por par de ubicaciones y clase; cada red en su orden y, dentro, por nombre", ()=>{
    const { grupos, sueltas } = agrupar();
    assert.equal(sueltas.length, 0);
    assert.deepEqual(grupos.map(g=>[g.clave, g.enlaces.length]).sort(), [["1-2|cable", 4], ["1-2|fibra", 1], ["1-3|radio", 2]]);
    const cable = grupos.find(g=>g.clave === "1-2|cable");
    assert.deepEqual(cable.redes.map(r=>[r.red, r.enlaces.map(d=>d.clienteId)]), [[2, [12, 11]], [3, [13]], [null, [14]]], "CCTV (Cámara A antes que B), Oficina y al final sin red");
    assert.deepEqual(cable.enlaces.map(d=>d.clienteId), [12, 11, 13, 14], "el primero es el que elige el clic");
    assert.deepEqual([cable.desdeId, cable.hastaId, cable.desde.lng, cable.hasta.lng], [1, 2, 0, 0.001], "va de la ubicación de id menor a la otra");
    assert.equal(cable.atenuada, false);
    const radio = grupos.find(g=>g.clave === "1-3|radio");
    assert.equal(radio.estilo, "backbone");
    assert.deepEqual(radio.redes.map(r=>r.red), [2, 1], "CCTV antes que AQ1, por el orden de las redes");
  });
  prueba("v14: un backbone manda sobre un P2MP en el mismo tramo", ()=>{
    const plan = [
      { tipo:"principal", estilo:"p2mp", clienteId:1, servidorId:9, desdeId:7, hastaId:8, desde:{ lat:0, lng:0 }, hasta:{ lat:1, lng:1 } },
      { tipo:"principal", estilo:"backbone", clienteId:2, servidorId:9, desdeId:7, hastaId:8, desde:{ lat:0, lng:0 }, hasta:{ lat:1, lng:1 } },
    ];
    const { grupos } = LA.agruparLineas(plan);
    assert.equal(grupos.length, 1); assert.equal(grupos[0].estilo, "backbone");
  });
  prueba("v14: el camino resaltado, la simulación y los respaldos quedan sueltos (enlace por enlace)", ()=>{
    const sel = agrupar({ seleccionId:30 });
    assert.deepEqual(sel.sueltas.map(d=>[d.clienteId, d.estilo]).sort(), [[15, "cadena"], [30, "cadena"]].sort(), "los tramos del camino de PTP L9 a");
    const radio = sel.grupos.find(g=>g.clave === "1-3|radio");
    assert.deepEqual(radio.enlaces.map(d=>d.clienteId), [31], "en el grupo queda solo el otro");
    assert.equal(radio.atenuada, true, "lo que no es del camino, atenuado");
    const sim = agrupar({ sim:J.simularFallas(rd, [1]) });
    assert.ok(sim.sueltas.length > 0 && sim.sueltas.every(d=>!LA.ESTILOS_AGRUPABLES.has(d.estilo)), "lo cortado o sin conectividad va suelto");
    assert.equal(sim.grupos.length, 0, "con el router caído no queda ninguna línea normal");
    const conRespaldo = LA.agruparLineas([{ tipo:"respaldo", estilo:"respaldo", clienteId:1, servidorId:2, desdeId:1, hastaId:2 }]);
    assert.equal(conRespaldo.sueltas.length, 1);
  });
  prueba("v14: un grupo está atenuado solo si todos sus enlaces lo están; cada red, igual", ()=>{
    const { grupos } = agrupar({ seleccionId:1 }); // el router: sus clientes directos no se atenúan
    const cable = grupos.find(g=>g.clave === "1-2|cable");
    assert.equal(cable.atenuada, false);
    assert.ok(cable.redes.every(r=>r.atenuada === false));
  });
  prueba("v14: ancho de las franjas: un poco más delgadas que la línea; el haz no pasa de 3 líneas", ()=>{
    assert.equal(LA.anchoFranja(5, 1), 5, "una sola: el ancho de siempre");
    assert.equal(LA.anchoFranja(5, 2), 3);
    cerca(LA.anchoFranja(3, 3), 1.8, 1e-9);
    assert.equal(LA.anchoFranja(5, 10), 1.5, "con muchas redes, se afinan");
    assert.equal(LA.anchoFranja(1, 10), LA.FRANJAS.minimo, "nunca menos que el mínimo");
  });
  prueba("v14: desplazamientos centrados en el eje, con y sin separación", ()=>{
    assert.deepEqual(LA.desplazamientos([5]), [0]);
    assert.deepEqual(LA.desplazamientos([3, 3]), [-1.5, 1.5]);
    assert.deepEqual(LA.desplazamientos([3, 3, 3]), [-3, 0, 3]);
    assert.deepEqual(LA.desplazamientos([5, 3], 2), [-2.5, 3.5]);
    assert.deepEqual(LA.desplazamientos([]), []);
  });
  prueba("v14: correr un tramo hacia su costado (en píxeles de pantalla)", ()=>{
    assert.deepEqual(LA.desplazarPuntos([{ x:0, y:0 }, { x:10, y:0 }], 2), [{ x:0, y:2 }, { x:10, y:2 }]);
    assert.deepEqual(LA.desplazarPuntos([{ x:0, y:0 }, { x:0, y:10 }], 2), [{ x:-2, y:0 }, { x:-2, y:10 }]);
    const diag = LA.desplazarPuntos([{ x:0, y:0 }, { x:3, y:4 }], 5);
    cerca(diag[0].x, -4, 1e-9); cerca(diag[0].y, 3, 1e-9); cerca(diag[1].x, -1, 1e-9); cerca(diag[1].y, 7, 1e-9);
    assert.deepEqual(LA.desplazarPuntos([{ x:1, y:2 }, { x:5, y:2 }], 0), [{ x:1, y:2 }, { x:5, y:2 }], "sin corrimiento, igual");
    assert.deepEqual(LA.desplazarPuntos([{ x:1, y:1 }, { x:1, y:1 }], 3), [{ x:1, y:1 }, { x:1, y:1 }], "un tramo de largo 0 no se mueve");
  });
  prueba("v14: trazos sin colorear: uno por grupo; dos clases en el mismo par, lado a lado", ()=>{
    const t = LA.planDeTrazos(agrupar().grupos, { colorPorRed:false, anchoDe });
    assert.equal(t.length, 3);
    const cable = t.find(x=>x.grupo.clave === "1-2|cable"), fibra = t.find(x=>x.grupo.clave === "1-2|fibra"), radio = t.find(x=>x.grupo.clave === "1-3|radio");
    assert.deepEqual([cable.desplazamiento, fibra.desplazamiento], [-2.75, 2.5], "3 + 2 + 3,5 px, centrados");
    assert.equal(radio.desplazamiento, 0, "solo en su par: en el eje");
    assert.ok(t.every(x=>!x.franja && x.red === undefined && x.halo));
    assert.equal(cable.enlaces.length, 4);
  });
  prueba("v14: trazos coloreando por red: una franja por red, lado a lado; un grupo de una sola red, entero y con su red", ()=>{
    const t = LA.planDeTrazos(agrupar().grupos, { colorPorRed:true, anchoDe });
    const cable = t.filter(x=>x.grupo.clave === "1-2|cable");
    assert.deepEqual(cable.map(x=>x.red), [2, 3, null]);
    assert.ok(cable.every(x=>x.franja));
    cerca(cable[0].ancho, 1.8, 1e-9);
    assert.deepEqual(cable.map(x=>x.desplazamiento), [-4.55, -2.75, -0.95], "haz de 5,4 px al lado de la fibra");
    assert.deepEqual(cable.map(x=>x.halo), [true, false, false], "un halo por haz");
    assert.deepEqual(cable.map(x=>x.enlaces.map(d=>d.clienteId)), [[12, 11], [13], [14]]);
    const fibra = t.find(x=>x.grupo.clave === "1-2|fibra");
    assert.deepEqual([fibra.franja, fibra.red, fibra.desplazamiento, fibra.ancho], [false, 1, 3.7, 3.5]);
    const radio = t.filter(x=>x.grupo.clave === "1-3|radio");
    assert.deepEqual(radio.map(x=>[x.red, x.desplazamiento, x.ancho]), [[2, -1.5, 3], [1, 1.5, 3]]);
  });
  prueba("v14: al apagar una red sale su franja (sus enlaces ya no vienen en el plan)", ()=>{
    const oculta = new Set([13, 14]); // Switch Oficina (Red Oficina) y el equipo sin red
    const g = agrupar({ visibleEquipo:id=>!oculta.has(id) }).grupos;
    const cable = LA.planDeTrazos(g, { colorPorRed:true, anchoDe }).filter(x=>x.grupo.clave === "1-2|cable");
    assert.deepEqual(cable.map(x=>x.red), [2], "quedan los de CCTV: una sola red, sin franjas");
    assert.equal(cable[0].franja, false);
  });
  prueba("v14: tooltip de un tramo con varios enlaces: cuántos, entre qué ubicaciones, por red, la lista y qué elige el clic", ()=>{
    const g = agrupar().grupos;
    const opciones = { nombreEquipo:nombre, nombreUbicacion:id=>U.find(u=>u.id === id).nombre, nombreRed:id=>NOMBRE_RED[id], hayRedes:true };
    const [entero] = LA.planDeTrazos(g, { colorPorRed:false, anchoDe }).filter(x=>x.grupo.clave === "1-2|cable");
    const txt = LA.textoTrazo(entero, opciones);
    assert.match(txt[0], /^4 enlaces por cable entre Torre principal y Data Center · \d+ m$/);
    assert.equal(txt[1], "2 de CCTV, 1 de Red Oficina, 1 sin red");
    assert.deepEqual(txt.slice(2), ["Cámara A ← Router DC", "Cámara B ← Router DC", "Switch Oficina ← Router DC", "Equipo suelto ← Router DC", "Clic: elige «Cámara A»"]);
    const franja = LA.planDeTrazos(g, { colorPorRed:true, anchoDe }).find(x=>x.grupo.clave === "1-2|cable" && x.red === 3);
    const tf = LA.textoTrazo(franja, opciones);
    assert.equal(tf[0], "Red Oficina: 1 de 4 enlaces por cable");
    assert.match(tf[1], /^entre Torre principal y Data Center/);
    assert.equal(tf[2], "En total: 2 de CCTV, 1 de Red Oficina, 1 sin red");
    assert.deepEqual(tf.slice(3), ["Switch Oficina ← Router DC", "Clic: elige «Switch Oficina»"]);
    const sinRed = LA.planDeTrazos(g, { colorPorRed:true, anchoDe }).find(x=>x.grupo.clave === "1-2|cable" && x.red === null);
    assert.equal(LA.textoTrazo(sinRed, opciones)[0], "Sin red: 1 de 4 enlaces por cable");
    const sinRedes = LA.textoTrazo(entero, { ...opciones, hayRedes:false });
    assert.ok(!sinRedes.some(x=>/de CCTV/.test(x)), "sin la 007, sin el detalle por red");
  });
  prueba("v14: la lista del tooltip se corta en 6 («y N más»); clases en singular y plural", ()=>{
    const muchos = Array.from({ length: 8 }, (_, i)=>({ tipo:"principal", estilo:"cable", clienteId:100 + i, servidorId:1, desdeId:1, hastaId:2, desde:{ lat:0, lng:0 }, hasta:{ lat:0, lng:1 } }));
    const { grupos } = LA.agruparLineas(muchos, { nombreDe:id=>`E${id}` });
    const [t] = LA.planDeTrazos(grupos, { anchoDe });
    const txt = LA.textoTrazo(t, { nombreEquipo:id=>`E${id}` });
    assert.equal(txt.filter(x=>/←/.test(x)).length, 6);
    assert.ok(txt.includes("y 2 más"));
    assert.equal(LA.textoCantidadEnlaces("radio", 1), "1 enlace inalámbrico");
    assert.equal(LA.textoCantidadEnlaces("radio", 2), "2 enlaces inalámbricos");
    assert.equal(LA.textoCantidadEnlaces("fibra", 3), "3 enlaces por fibra óptica");
  });
}

// ---------------------------------------------------------------- v15 (3.9): cobertura de los AP
prueba("v15: la cobertura guardada de un equipo (círculo, sector, 360° y valores raros)", ()=>{
  assert.equal(CO.normalizarCobertura({}), null, "sin radio, sin cobertura");
  assert.equal(CO.normalizarCobertura({ radio_cobertura_m: 0 }), null);
  assert.equal(CO.normalizarCobertura(null), null);
  assert.deepEqual(CO.normalizarCobertura({ radio_cobertura_m: 300 }), { radio: 300, azimut: null, apertura: null, sector: false }, "círculo");
  assert.deepEqual(CO.normalizarCobertura({ radio_cobertura_m: "300", azimut_cobertura: "45", apertura_cobertura: "120" }), { radio: 300, azimut: 45, apertura: 120, sector: true }, "sector (llega como texto de la base)");
  assert.equal(CO.normalizarCobertura({ radio_cobertura_m: 300, azimut_cobertura: 45, apertura_cobertura: 360 }).sector, false, "360° es un círculo");
  assert.equal(CO.normalizarCobertura({ radio_cobertura_m: 300, apertura_cobertura: 90 }).sector, false, "sin dirección no hay sector");
  assert.equal(CO.normalizarCobertura({ radio_cobertura_m: 300, azimut_cobertura: 400, apertura_cobertura: 60 }).azimut, 40, "la dirección se lleva a 0–360");
  assert.equal(CO.llevaCobertura({ tipo_equipo: "ap" }), true, "un AP lleva cobertura");
  assert.equal(CO.llevaCobertura({ tipo_equipo: "ptp" }), false);
  assert.equal(CO.llevaCobertura({ tipo_equipo: "ptp", radio_cobertura_m: 50 }), true, "o cualquier equipo que ya tenga una");
});
prueba("v15: validar la cobertura del formulario (coma decimal, rangos, sector sin dirección, sin radio)", ()=>{
  assert.deepEqual(CO.validarCobertura({ radio: "", azimut: "", apertura: "" }), { ok: true, errores: {}, valores: { radio_cobertura_m: null, azimut_cobertura: null, apertura_cobertura: null } }, "todo vacío: sin cobertura");
  assert.deepEqual(CO.validarCobertura({ radio: "300,5" }).valores, { radio_cobertura_m: 300.5, azimut_cobertura: null, apertura_cobertura: null }, "coma decimal");
  assert.deepEqual(CO.validarCobertura({ radio: "300", azimut: "360", apertura: "120" }).valores, { radio_cobertura_m: 300, azimut_cobertura: 0, apertura_cobertura: 120 }, "360° de dirección = 0 (norte)");
  assert.deepEqual(CO.validarCobertura({ radio: "300", apertura: "360" }).valores, { radio_cobertura_m: 300, azimut_cobertura: null, apertura_cobertura: 360 }, "360° de apertura sin dirección: un círculo");
  for(const [entrada, campo] of [[{ radio: "0" }, "radio_cobertura_m"], [{ radio: "-3" }, "radio_cobertura_m"], [{ radio: "20001" }, "radio_cobertura_m"], [{ radio: "abc" }, "radio_cobertura_m"],
    [{ radio: "300", azimut: "361" }, "azimut_cobertura"], [{ radio: "300", azimut: "-1" }, "azimut_cobertura"], [{ radio: "300", apertura: "0" }, "apertura_cobertura"], [{ radio: "300", apertura: "400" }, "apertura_cobertura"],
    [{ radio: "300", apertura: "90" }, "azimut_cobertura"], [{ azimut: "45" }, "radio_cobertura_m"], [{ apertura: "90", azimut: "10" }, "radio_cobertura_m"]]){
    const v = CO.validarCobertura(entrada);
    assert.ok(!v.ok && v.errores[campo], `${JSON.stringify(entrada)} → error en ${campo}: ${JSON.stringify(v.errores)}`);
  }
  assert.equal(CO.validarCobertura({ radio: "20000" }).ok, true, "el tope entra");
});
prueba("v15: el punto a tantos metros hacia un azimut, y la cuña del sector", ()=>{
  const c = { lat: -2.2, lng: -79.9 };
  const n = CO.puntoDestino(c, 0, 1000);
  cerca(geo.distanciaKm(c, n) * 1000, 1000, 0.5, "1 km al norte"); cerca(geo.azimutGrados(c, n), 0, 0.01);
  const e = CO.puntoDestino(c, 90, 500);
  cerca(geo.distanciaKm(c, e) * 1000, 500, 0.5, "500 m al este"); cerca(geo.azimutGrados(c, e), 90, 0.01);
  const p = CO.puntosSector(c, { radio: 300, azimut: 45, apertura: 120 });
  assert.deepEqual(p[0], c); assert.deepEqual(p[p.length - 1], c);
  assert.equal(p.length, 24 + 3, "un paso cada 5° (120/5 = 24 tramos), más el centro dos veces");
  cerca(geo.azimutGrados(c, p[1]), 345, 0.01, "empieza en 45 − 60"); cerca(geo.azimutGrados(c, p[p.length - 2]), 105, 0.01, "termina en 45 + 60");
  assert.ok(p.slice(1, -1).every(q=>Math.abs(geo.distanciaKm(c, q) * 1000 - 300) < 0.5), "todo el arco a 300 m");
  assert.equal(CO.puntosSector(c, { radio: 100, azimut: 0, apertura: 4 }).length, 2 + 1 + 2, "uno muy angosto tiene al menos dos tramos");
});
prueba("v15: textos de la cobertura", ()=>{
  assert.equal(CO.textoRadio(300), "300 m"); assert.equal(CO.textoRadio(1250), "1,25 km"); assert.equal(CO.textoRadio(0), "—");
  assert.equal(CO.textoCobertura({ radio: 300, azimut: null, apertura: null, sector: false }), "300 m a la redonda");
  assert.equal(CO.textoCobertura({ radio: 1200, azimut: 45, apertura: 120, sector: true }), "1,2 km · sector de 120° hacia el NE (45°)");
  assert.equal(CO.textoCobertura(null), "");
});

// ---------------------------------------------------------------- v15 (3.10): tooltip de las ubicaciones
prueba("v15 y v19 (3.20): el resumen de una ubicación cuenta por tipo y por red lo que dejan a la vista los filtros, y avisa cuántos esconden", ()=>{
  const tipos = [{ valor:"router", etiqueta:"Router", orden:10 }, { valor:"ptp", etiqueta:"PtP-E", orden:30 }, { valor:"camara", etiqueta:"Cámara", orden:60 }];
  const redes = [{ id:2, nombre:"CCTV", color:"#fbff00" }, { id:3, nombre:"Red Oficina", color:"#007eb2" }];
  const equipos = [
    { id:1, tipo_equipo:"camara", red_id:2 }, { id:2, tipo_equipo:"ptp", red_id:2 }, { id:3, tipo_equipo:"ptp", red_id:3 },
    { id:4, tipo_equipo:null, red_id:null }, { id:5, tipo_equipo:"inyector_poe", red_id:9 }, { id:6, tipo_equipo:"camara", red_id:2 },
  ];
  // Sin filtros, todo (como en el v15).
  const todo = TU.resumenUbicacion({ equipos, tipos, redes, activos: 2 });
  assert.equal(todo.total, 6); assert.equal(todo.visibles, 6); assert.equal(todo.ocultos, 0);
  assert.deepEqual(todo.tipos.map(t=>[t.etiqueta, t.n]), [["PtP-E", 2], ["Cámara", 2], ["inyector_poe", 1]], "en el orden de los tipos; uno que no está en el catálogo, al final");
  assert.deepEqual(todo.redes.map(x=>[x.nombre, x.n]), [["CCTV", 3], ["Red Oficina", 1], ["Red 9", 1]], "en el orden de las redes");
  // v19 (3.20): con los equipos 3 y 6 ocultos por los filtros, cuenta lo que queda a la vista.
  const r = TU.resumenUbicacion({ equipos, tipos, redes, visibleEquipo:id=>id !== 3 && id !== 6, activos: 2 });
  assert.equal(r.total, 6, "total: todo lo que hay (para «Sin equipos de red»)");
  assert.equal(r.visibles, 4);
  assert.deepEqual(r.tipos.map(t=>[t.etiqueta, t.n]), [["PtP-E", 1], ["Cámara", 1], ["inyector_poe", 1]], "solo lo que se ve");
  assert.equal(r.sinTipo, 1);
  assert.deepEqual(r.redes.map(x=>[x.nombre, x.n]), [["CCTV", 2], ["Red 9", 1]], "Red Oficina, con su único equipo oculto, no aparece");
  assert.deepEqual(r.tipos.map(t=>t.porRed.map(x=>[x.id, x.n])), [[[2, 1]], [[2, 1]], [[9, 1]]], "el reparto por red, también solo lo visible");
  assert.equal(r.sinRed, 1);
  assert.equal(r.ocultos, 2, "y se avisa cuántos esconden los filtros");
  assert.equal(r.activos, 2, "los activos no dependen de los filtros de equipos");
  const nada = TU.resumenUbicacion({ equipos, tipos, redes, visibleEquipo:()=>false });
  assert.deepEqual([nada.total, nada.visibles, nada.ocultos, nada.tipos.length, nada.redes.length, nada.sinTipo, nada.sinRed], [6, 0, 6, 0, 0, 0, 0], "todo oculto: solo la cuenta de ocultos");
  const routers = TU.resumenUbicacion({ equipos:[{ id:1, tipo_equipo:"ptp", red_id:2 }, { id:2, tipo_equipo:"ptp", red_id:3 }], tipos, redes, visibleEquipo:id=>id === 1, routerDe:()=>true });
  assert.deepEqual(routers.tipos.map(t=>[t.n, t.routers]), [[1, 1]], "los routers, también solo los visibles");
  const conHerencia = TU.resumenUbicacion({ equipos:[{ id:1, red_id:null, red_efectiva:2 }], redes, redDe:e=>e.red_efectiva ?? null });
  assert.deepEqual(conHerencia.redes.map(x=>x.nombre), ["CCTV"], "con la red efectiva (011)");
  const vacia = TU.resumenUbicacion({});
  assert.deepEqual([vacia.total, vacia.tipos.length, vacia.redes.length, vacia.ocultos, vacia.activos], [0, 0, 0, 0, 0]);
});
// ---------------------------------------------------------------- v18 (3.17): «Tipos y redes», cada tipo repartido por red
prueba("v18: cada tipo trae cuántos hay en cada red, en el orden de las redes, con las desconocidas después y «Sin red» al final", ()=>{
  const tipos = [{ valor:"switch", etiqueta:"Switch", orden:20 }, { valor:"ptp", etiqueta:"PtP-E", orden:30 }, { valor:"camara", etiqueta:"Cámara", orden:60 }];
  const redes = [{ id:2, nombre:"CCTV", color:"#1eb913" }, { id:3, nombre:"Red Oficina", color:"#007eb2" }, { id:4, nombre:"AQ1", color:"#ff0000" }];
  // Desordenados a propósito: el orden sale de las redes, no de los equipos.
  const equipos = [
    { id:1, tipo_equipo:"ptp", red_id:4 }, { id:2, tipo_equipo:"ptp", red_id:2 }, { id:3, tipo_equipo:"ptp", red_id:null }, { id:4, tipo_equipo:"ptp", red_id:2 },
    { id:5, tipo_equipo:"ptp", red_id:9 }, { id:6, tipo_equipo:"ptp", red_id:3 }, { id:7, tipo_equipo:"camara", red_id:2 }, { id:8, tipo_equipo:"switch", red_id:4 },
    { id:9, tipo_equipo:null, red_id:null }, { id:10, tipo_equipo:null, red_id:3 }, { id:11, tipo_equipo:"inyector_poe", red_id:4 },
  ];
  const r = TU.resumenUbicacion({ equipos, tipos, redes });
  const reparto = lista=>lista.map(x=>[x.id, x.n]);
  assert.deepEqual(r.tipos.map(t=>[t.etiqueta, t.n, reparto(t.porRed)]), [
    ["Switch", 1, [[4, 1]]],
    ["PtP-E", 6, [[2, 2], [3, 1], [4, 1], [9, 1], [null, 1]]],
    ["Cámara", 1, [[2, 1]]],
    ["inyector_poe", 1, [[4, 1]]],
  ]);
  assert.deepEqual(reparto(r.sinTipoPorRed), [[3, 1], [null, 1]], "«Sin tipo» también se reparte");
  const ptp = r.tipos[1].porRed;
  assert.deepEqual(ptp.map(x=>x.nombre), ["CCTV", "Red Oficina", "AQ1", "Red 9", "Sin red"], "con el nombre de cada red");
  assert.deepEqual(ptp.map(x=>x.color), ["#1eb913", "#007eb2", "#ff0000", null, null], "y su color (la desconocida y «Sin red», sin color)");
  for(const t of r.tipos) assert.equal(t.porRed.reduce((s, x)=>s + x.n, 0), t.n, `${t.etiqueta}: el reparto suma lo del tipo`);
  for(const red of r.redes) assert.equal([...r.tipos.map(t=>t.porRed), r.sinTipoPorRed].flat().filter(x=>x.id === red.id).reduce((s, x)=>s + x.n, 0), red.n, `${red.nombre}: suma lo de la red`);
  assert.equal([...r.tipos.map(t=>t.porRed), r.sinTipoPorRed].flat().filter(x=>x.id === null).reduce((s, x)=>s + x.n, 0), r.sinRed, "«Sin red» suma lo de «Sin red»");
  const conHerencia = TU.resumenUbicacion({ equipos:[{ id:1, tipo_equipo:"ptp", red_id:null, red_efectiva:3 }], tipos, redes, redDe:e=>e.red_efectiva ?? null });
  assert.deepEqual(reparto(conHerencia.tipos[0].porRed), [[3, 1]], "con la red efectiva (011)");
  assert.deepEqual(TU.resumenUbicacion({ equipos:[{ id:1, tipo_equipo:"ptp", red_id:2 }], tipos, redes }).sinTipoPorRed, [], "sin «Sin tipo», vacío");
  const indefinida = TU.resumenUbicacion({ equipos:[{ id:1, tipo_equipo:"ptp" }], tipos, redes, redDe:()=>undefined });
  assert.deepEqual(reparto(indefinida.tipos[0].porRed), [[null, 1]], "undefined cuenta como «Sin red»");
});
prueba("v18: el reparto dicho con palabras y los colores muy claros", ()=>{
  assert.equal(TU.textoPorRed([{ id:2, nombre:"CCTV", n:10 }, { id:3, nombre:"Red Oficina", n:1 }, { id:4, nombre:"AQ1", n:1 }]), "10 en CCTV, 1 en Red Oficina y 1 en AQ1");
  assert.equal(TU.textoPorRed([{ id:2, nombre:"CCTV", n:2 }, { id:null, nombre:"Sin red", n:1 }]), "2 en CCTV y 1 sin red");
  assert.equal(TU.textoPorRed([{ id:4, nombre:"AQ1", n:1 }]), "1 en AQ1");
  assert.equal(TU.textoPorRed([]), "");
  // Contraste con el blanco menor que 2:1: el amarillo que tuvo CCTV, el blanco y un amarillo claro, sí.
  for(const c of ["#fbff14", "#FFFFFF", "#ff0", "#f5e663"]) assert.equal(TU.colorMuyClaro(c), true, c);
  // Los de hoy en la base real, y otros que se leen, no.
  for(const c of ["#1eb913", "#007eb2", "#ff0000", "#dc0be0", "#EC741D", "#004DAB", "#000000", "#8B9AAA"]) assert.equal(TU.colorMuyClaro(c), false, c);
  for(const c of [null, undefined, "", "rojo", "#12345", "#1234567"]) assert.equal(TU.colorMuyClaro(c), false, String(c));
});
// ---------------------------------------------------------------- v19 (3.21): con un solo tipo de equipo a la vista
prueba("v19: el único tipo de equipo que deja a la vista el filtro (o ninguno)", ()=>{
  const tipos = [{ valor:"router", etiqueta:"Router", orden:10, activo:true }, { valor:"ptp", etiqueta:"PtP-E", orden:30, activo:true }, { valor:"camara", etiqueta:"Cámara", orden:60, activo:true }, { valor:"nvr", etiqueta:"NVR", orden:70, activo:true }];
  const equipos = [{ tipo_equipo:"router" }, { tipo_equipo:"ptp" }, { tipo_equipo:"ptp" }, { tipo_equipo:"camara" }, { tipo_equipo:null }];
  const ops = FM.opcionesTiposEquipo(tipos, equipos, 2); // NVR sin equipos; «Sin tipo» y «Sin equipos» al final
  const valores = ops.map(o=>o.valor);
  assert.deepEqual(valores, ["router", "ptp", "camara", "nvr", "-sin-tipo", "-sin-equipos"]);
  const soloPtp = FM.ocultosSoloEsta(valores, [], "ptp");
  assert.equal(FM.tipoEquipoUnico(ops, soloPtp), "ptp", "«solo esta» en PtP-E");
  assert.equal(FM.tipoEquipoUnico(ops, []), null, "sin filtro, ninguno");
  assert.equal(FM.tipoEquipoUnico(ops, ["router"]), null, "quedan varios");
  assert.equal(FM.tipoEquipoUnico(ops, ["router", "camara", "-sin-tipo"]), "ptp", "lo demás apagado a mano; NVR (sin equipos) y «Sin equipos» no cuentan");
  assert.equal(FM.tipoEquipoUnico(ops, ["router", "ptp", "camara"]), "-sin-tipo", "«Sin tipo» como único");
  assert.equal(FM.tipoEquipoUnico(ops, valores), null, "todo apagado: ninguno");
  const unTipo = FM.opcionesTiposEquipo([{ valor:"ptp", etiqueta:"PtP-E", orden:30, activo:true }], [{ tipo_equipo:"ptp" }], 0);
  assert.equal(FM.tipoEquipoUnico(unTipo, []), null, "si en toda la red hay un solo tipo con equipos, no hay filtro: la bolita queda como siempre");
  assert.equal(FM.tipoEquipoUnico([], []), null);
});
prueba("v19: la bolita con el ícono de un tipo de equipo lo dice (clase y data-tipo-equipo)", ()=>{
  const pin = htmlPin({ color:"#EC741D", tipo:"torre", icono:'<svg viewBox="0 0 24 24"><path d="M1 1h2"/></svg>', cantidad: 4, tipoEquipo:"ptp" });
  assert.match(pin, /inventario-tecnologico-mapa-pin-por-tipo/);
  assert.match(pin, /data-tipo-equipo="ptp"/);
  assert.match(pin, /mapa-pin-cantidad">4</);
  assert.match(pin, /<svg[^>]*\swidth="15" height="15"[^>]*viewBox="0 0 24 24"/, "el ícono, a 15 px como el de la ubicación");
  const normal = htmlPin({ color:"#EC741D", tipo:"torre", cantidad: 2 });
  assert.doesNotMatch(normal, /pin-por-tipo|data-tipo-equipo/, "sin tipo de equipo, como siempre");
  assert.match(htmlPin({ color:"#000", tipo:"torre", tipoEquipo:'x"><script>' }), /data-tipo-equipo="xscript"/, "el valor va limpio");
});
// ---------------------------------------------------------------- v20 (3.22): las cifras del panel, según los filtros
prueba("v20: cifras del panel: torres, equipos de red, radioenlaces (PtP-R colgados por radio de un PtP-E) y cámaras, con y sin filtros", ()=>{
  const ubicaciones = [
    { id:1, tipo:"torre", activa:true }, { id:2, tipo:"torre", activa:true }, { id:3, tipo:"oficina", activa:true }, { id:4, tipo:"torre", activa:false },
  ];
  const equipos = [
    { id:10, ubicacion_id:1, tipo_equipo:"ptp", servidor_id:null },
    { id:11, ubicacion_id:2, tipo_equipo:"estacion", servidor_id:10 },                       // radioenlace (otra ubicación: radio)
    { id:12, ubicacion_id:3, tipo_equipo:"estacion", servidor_id:10 },                       // radioenlace
    { id:13, ubicacion_id:1, tipo_equipo:"estacion", servidor_id:10 },                       // en la misma ubicación, sin medio: cable
    { id:14, ubicacion_id:2, tipo_equipo:"estacion", servidor_id:10, medio:"cable" },        // por cable: no
    { id:15, ubicacion_id:1, tipo_equipo:"ap", servidor_id:10 },
    { id:16, ubicacion_id:3, tipo_equipo:"estacion", servidor_id:15 },                       // de un AP: no
    { id:17, ubicacion_id:1, tipo_equipo:"camara", servidor_id:10 },
    { id:18, ubicacion_id:2, tipo_equipo:"camara", servidor_id:11 },
    { id:19, ubicacion_id:4, tipo_equipo:"camara", servidor_id:null },                       // en una archivada
    { id:20, ubicacion_id:1, tipo_equipo:"estacion", servidor_id:10, medio:"inalambrico" },  // misma ubicación, por radio: sí
    { id:21, ubicacion_id:2, tipo_equipo:"estacion", servidor_id:999 },                      // su servidor no existe: no
  ];
  const par = c=>[c.visibles, c.total];
  const sin = J.cifrasPanel({ ubicaciones, equipos });
  assert.deepEqual([par(sin.torres), par(sin.equipos), par(sin.radioenlaces), par(sin.camaras)], [[2, 2], [11, 11], [3, 3], [2, 2]], "sin filtros (la archivada no cuenta)");
  const archivadas = J.cifrasPanel({ ubicaciones, equipos, verArchivadas: true });
  assert.deepEqual([par(archivadas.torres), par(archivadas.equipos), par(archivadas.camaras)], [[3, 3], [12, 12], [3, 3]], "viendo las archivadas, también cuentan");
  const filtrado = J.cifrasPanel({ ubicaciones, equipos, visibleUbicacion: id=>id !== 2, visibleEquipo: id=>id !== 12 });
  assert.deepEqual([par(filtrado.torres), par(filtrado.equipos), par(filtrado.radioenlaces), par(filtrado.camaras)], [[1, 2], [6, 11], [1, 3], [1, 2]], "con filtros: lo visible y el total");
  assert.deepEqual(J.cifrasPanel({}), { torres: { visibles: 0, total: 0 }, equipos: { visibles: 0, total: 0 }, radioenlaces: { visibles: 0, total: 0 }, camaras: { visibles: 0, total: 0 } });
  assert.equal(J.TIPO_UBICACION_TORRE, "torre");
});
prueba("v15: modos del tooltip y sus textos", ()=>{
  assert.deepEqual(TU.MODOS_TOOLTIP.map(m=>m.id), ["nombre", "tipos", "redes", "ambos"]);
  assert.equal(TU.MODO_TOOLTIP_POR_DEFECTO, "tipos", "de fábrica, los tipos de equipo (lo decidió la persona)");
  assert.equal(TU.normalizarModoTooltip("redes"), "redes"); assert.equal(TU.normalizarModoTooltip("xyz"), "tipos"); assert.equal(TU.normalizarModoTooltip(null), "tipos");
  assert.deepEqual(["nombre", "tipos", "redes", "ambos"].map(m=>[TU.conTipos(m), TU.conRedes(m)]), [[false, false], [true, false], [false, true], [true, true]]);
  assert.equal(TU.textoOcultos(1), "1 oculto por los filtros"); assert.equal(TU.textoOcultos(3), "3 ocultos por los filtros");
  assert.equal(TU.textoActivos(1), "1 activo que no es equipo de red"); assert.equal(TU.textoActivos(2), "2 activos que no son equipos de red");
});
prueba("v15: ícono de un tipo de equipo: el propio, el de fábrica, el del tipo de activo o el genérico", ()=>{
  const tiposEquipo = [{ valor:"router", etiqueta:"Router" }, { valor:"inyector_poe", etiqueta:"Inyector POE" }, { valor:"raro", etiqueta:"Raro" }];
  const tiposActivo = [{ nombre:"Inyector POE", icono_svg:'<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><rect width="8" height="8"/></svg>' }];
  const propio = { valor:"router", icono_svg:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/></svg>' };
  const o = { tiposEquipo, tiposActivo };
  assert.equal(IE.origenIconoTipoEquipo(propio, o), "propio");
  assert.equal(IE.origenIconoTipoEquipo({ valor:"router" }, o), "fabrica");
  assert.equal(IE.origenIconoTipoEquipo({ valor:"inyector_poe" }, o), "activo", "Inyector POE: el del tipo de activo que empareja");
  assert.equal(IE.origenIconoTipoEquipo({ valor:"raro" }, o), "generico");
  assert.match(IE.iconoTipoEquipo(propio, o), /^<svg aria-hidden="true" width="16" height="16"[^>]*fill="currentColor"[^>]*><circle/, "el propio, a 16 px y del color del texto");
  assert.equal(IE.iconoTipoEquipo({ valor:"router" }, o), IE.GLIFOS_TIPO_EQUIPO.router);
  assert.match(IE.iconoTipoEquipo({ valor:"inyector_poe" }, o), /<rect width="8" height="8"\/>/);
  assert.match(IE.iconoTipoEquipo({ valor:"raro" }, o), /viewBox="0 0 24 24"/, "el genérico (radio)");
  assert.match(IE.iconoTipoEquipo(null, o), /viewBox="0 0 24 24"/, "«Sin tipo»: el genérico");
  assert.match(IE.iconoTipoEquipo({ valor:"ap" }, { ...o, px: 24 }), /width="24" height="24"/, "a otro tamaño");
  assert.deepEqual(Object.keys(IE.GLIFOS_TIPO_EQUIPO), ["router", "switch", "ptp", "ap", "estacion", "camara", "nvr", "otro"], "los 8 de la semilla de la 007");
  assert.ok(Object.values(IE.GLIFOS_TIPO_EQUIPO).every(g=>/^<svg viewBox="0 0 24 24" width="16" height="16"/.test(g) && !/on[a-z]+=/i.test(g)));
});
prueba("v15: errores de la 013 traducidos (sin la migración y por sus reglas)", ()=>{
  assert.equal(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'radio_cobertura_m' column of 'equipos_radioenlace' in the schema cache" }), L.TEXTO_FALTA_013);
  assert.equal(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'icono_svg' column of 'tipos_equipo_red' in the schema cache" }), L.TEXTO_FALTA_013, "no la confunde con la 007");
  assert.equal(L.traducirErrorMapa({ code:"42703", message:"column tipos_equipo_red.icono_svg does not exist" }), L.TEXTO_FALTA_013);
  assert.match(L.traducirErrorMapa({ code:"23514", message:'new row for relation "equipos_radioenlace" violates check constraint "equipos_radioenlace_sector_con_direccion"' }), /hacia dónde apunta/);
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "equipos_radioenlace_radio_cobertura_valido"' }), /20 000/);
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "tipos_equipo_red_icono_valido"' }), /SVG sin scripts/);
  assert.equal(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'tipo_equipo' column of 'equipos_radioenlace' in the schema cache" }), L.TEXTO_FALTA_007, "la 007 sigue igual");
});

// ---------------------------------------------------------------- v17: modo de red y rangos IP (014)
prueba("v17: el modo de cada tipo (el guardado o el de fábrica) y el del equipo (el suyo o el de su tipo)", ()=>{
  assert.equal(MR.modoDelTipo({ valor:"router" }), "router");
  assert.equal(MR.modoDelTipo({ valor:"switch" }), "bridge");
  for(const v of ["camara", "nvr", "inyector_poe"]) assert.equal(MR.modoDelTipo({ valor:v }), "no_aplica", v);
  for(const v of ["ap", "ptp", "estacion", "otro", "cam_ip"]) assert.equal(MR.modoDelTipo({ valor:v }), "elegir", v);
  assert.equal(MR.modoDelTipo(null), "elegir", "sin tipo: a elegir");
  assert.equal(MR.modoDelTipo({ valor:"switch", modo_red:"router" }), "router", "con la 014 manda lo guardado");
  assert.equal(MR.modoDelTipo({ valor:"ap", modo_red:"raro" }), "elegir", "un valor raro: el de fábrica");
  assert.equal(MR.modoEfectivo({ modo_red:"router" }, { valor:"ap" }), "router", "un AP que enruta");
  assert.equal(MR.modoEfectivo({ modo_red:null }, { valor:"switch" }), "bridge");
  assert.equal(MR.modoEfectivo({ modo_red:"bridge" }, { valor:"router" }), "bridge", "el propio pisa al del tipo");
  assert.equal(MR.modoEfectivo({ modo_red:"router" }, { valor:"camara" }), "router", "también en un tipo «no aplica» (como la base)");
  assert.equal(MR.modoEfectivo({}, null), "elegir");
  assert.deepEqual(["router", "elegir", "bridge", "no_aplica"].map(MR.defineRed), [true, true, false, false], "solo los routers (y los sin indicar) definen red");
});
prueba("v17: la marca «Router» va en lo que enruta salvo que su tipo ya sea Router", ()=>{
  assert.equal(MR.llevaMarcaRouter({ modo_red:"router" }, { valor:"ap" }), true);
  assert.equal(MR.llevaMarcaRouter({ modo_red:null }, { valor:"router" }), false, "un Router no la necesita");
  assert.equal(MR.llevaMarcaRouter({ modo_red:null }, { valor:"switch", modo_red:"router" }), true, "un tipo entero en modo router");
  assert.equal(MR.llevaMarcaRouter({ modo_red:"bridge" }, { valor:"ap" }), false);
  assert.equal(MR.llevaMarcaRouter({ modo_red:null }, { valor:"ap" }), false, "sin indicar");
  assert.equal(MR.llevaMarcaRouter({ modo_red:"router" }, null), true, "sin tipo y en modo router");
});
prueba("v17: «Hace radio» y «Lleva cobertura» por tipo (de fábrica, como antes)", ()=>{
  assert.deepEqual(["ptp", "ap", "estacion", "router", "switch", "camara", "otro"].map(v=>MR.haceRadioTipo({ valor:v })), [true, true, true, false, false, false, false]);
  assert.equal(MR.haceRadioTipo(null), null, "sin tipo no se sabe");
  assert.equal(MR.haceRadioTipo({ valor:"router", hace_radio:true }), true, "con la 014, lo guardado");
  assert.equal(MR.haceRadioTipo({ valor:"ptp", hace_radio:false }), false);
  assert.deepEqual(["ap", "ptp", "estacion"].map(v=>MR.llevaCoberturaTipo({ valor:v })), [true, false, false]);
  assert.equal(MR.llevaCoberturaTipo({ valor:"estacion", lleva_cobertura:true }), true);
  assert.equal(MR.llevaCoberturaTipo({ valor:"ap", lleva_cobertura:false }), false);
  assert.equal(MR.llevaCoberturaTipo(null), false);
  // Quien lo usa: el medio sugerido y la cobertura del formulario.
  const tipos = [{ valor:"router", etiqueta:"Router", hace_radio:true }, { valor:"ptp", etiqueta:"PtP-E", hace_radio:true }];
  assert.equal(SS.medioSugerido({ clienteTipo:"ptp", servidorTipo:"router", misma:false }), "cable", "de fábrica el Router no hace radio");
  assert.equal(SS.medioSugerido({ clienteTipo:"ptp", servidorTipo:"router", misma:false }, tipos), null, "con la 014, un Router que hace radio: automático");
  assert.equal(SS.motivoMedioSugerido({ clienteTipo:"ptp", servidorTipo:"router" }, tipos), "");
  assert.equal(SS.haceRadio("switch", [{ valor:"switch", hace_radio:true }]), true);
  assert.equal(CO.llevaCobertura({ tipo_equipo:"estacion" }, [{ valor:"estacion", lleva_cobertura:true }]), true);
  assert.equal(CO.llevaCobertura({ tipo_equipo:"ap" }, [{ valor:"ap", lleva_cobertura:false }]), false, "un AP cuyo tipo ya no la lleva");
  assert.equal(CO.llevaCobertura({ tipo_equipo:"ap", radio_cobertura_m:300 }, [{ valor:"ap", lleva_cobertura:false }]), true, "salvo que ya tenga una guardada");
});
prueba("v17: los textos del modo (selector del equipo)", ()=>{
  assert.equal(MR.textoModoDeSuTipo({ valor:"switch" }), "El de su tipo: Bridge (capa 2)");
  assert.equal(MR.textoModoDeSuTipo({ valor:"router" }), "El de su tipo: Router (capa 3)");
  assert.equal(MR.textoModoDeSuTipo({ valor:"camara" }), "No aplica a su tipo");
  assert.equal(MR.textoModoDeSuTipo({ valor:"ap" }), "Sin indicar");
  assert.equal(MR.textoModoDeSuTipo(null), "Sin indicar");
  assert.equal(MR.etiquetaModo("no_aplica"), "No aplica");
  assert.equal(MR.etiquetaModo("raro"), "");
});
prueba("v17: un rango IPv4 en CIDR (la red se normaliza; se rechaza lo mal escrito)", ()=>{
  const r = MR.parsearRango(" 10.10.0.0/24 ");
  assert.equal(r.ok, true); assert.equal(r.rango, "10.10.0.0/24"); assert.equal(r.corregido, null);
  assert.equal(r.fin - r.base, 255);
  const h = MR.parsearRango("192.168.88.1/24");
  assert.equal(h.rango, "192.168.88.0/24", "con bits de host se guarda la red"); assert.equal(h.corregido, "192.168.88.1/24");
  assert.equal(MR.parsearRango("10.0.0.7/32").rango, "10.0.0.7/32");
  assert.equal(MR.parsearRango("0.0.0.0/0").fin, 2 ** 32 - 1);
  for(const malo of ["", "10.10.0.0", "10.10.0/24", "10.10.0.256/24", "10.10.0.0/33", "010.1.1.0/24", "10.1.1.0/24/1", "hola/24", "10.1.1.0/x", "10.1.1.0/-1", "2001:db8::/32"]){
    assert.equal(MR.parsearRango(malo).ok, false, malo);
  }
  assert.match(MR.parsearRango("10.10.0.0").error, /le falta la máscara/);
  assert.match(MR.parsearRango("10.10.0.0/40").error, /de \/0 a \/32/);
});
prueba("v17: «Rangos IP»: separados por comas, espacios o líneas, sin repetir, como mucho 20", ()=>{
  const v = MR.validarRangos("10.10.0.0/24, 10.20.0.0/16\n10.10.0.0/24;192.168.88.1/24");
  assert.equal(v.ok, true);
  assert.deepEqual(v.rangos, ["10.10.0.0/24", "10.20.0.0/16", "192.168.88.0/24"]);
  assert.deepEqual(v.avisos, ["192.168.88.1/24 se guarda como 192.168.88.0/24 (la red de ese rango)."]);
  assert.deepEqual(MR.validarRangos("").rangos, [], "vacío = sin rangos");
  assert.equal(MR.validarRangos("  ").ok, true);
  const mal = MR.validarRangos("10.0.0.0/8, 10.1.1.0");
  assert.equal(mal.ok, false); assert.equal(mal.errores.length, 1); assert.deepEqual(mal.rangos, ["10.0.0.0/8"]);
  const muchos = Array.from({ length: 21 }, (_, i)=>`10.${i}.0.0/16`).join(" ");
  assert.equal(MR.validarRangos(muchos).ok, false);
  assert.match(MR.validarRangos(muchos).errores[0], /Como mucho 20/);
  assert.equal(MR.validarRangos(Array.from({ length: 20 }, (_, i)=>`10.${i}.0.0/16`).join(" ")).ok, true);
  assert.equal(MR.textoRangos(["10.0.0.0/8", "192.168.1.0/24"]), "10.0.0.0/8, 192.168.1.0/24");
  assert.equal(MR.textoRangos(null), "");
});
prueba("v17: cruces de rangos entre redes (y dentro de una), con su aviso", ()=>{
  assert.equal(MR.seCruzan("10.0.0.0/8", "10.20.0.0/16"), true, "uno dentro de otro");
  assert.equal(MR.seCruzan("10.0.0.0/24", "10.0.1.0/24"), false, "contiguos no se cruzan");
  assert.equal(MR.seCruzan("192.168.88.0/24", "192.168.88.0/24"), true, "el mismo");
  assert.equal(MR.seCruzan("hola", "10.0.0.0/8"), false);
  const redes = [
    { id:1, nombre:"CCTV", rangos_ip:["10.10.0.0/16"] },
    { id:2, nombre:"AQ1", rangos_ip:["10.10.5.0/24", "172.16.0.0/24"] },
    { id:3, nombre:"Oficina", rangos_ip:["192.168.1.0/24", "192.168.1.128/25"] },
    { id:4, nombre:"Sin rangos", rangos_ip:[] },
  ];
  assert.equal(MR.crucesDeRangos(redes).length, 2);
  assert.deepEqual(MR.avisosDeCruce(1, redes), ["10.10.0.0/16 se cruza con 10.10.5.0/24, de «AQ1»."]);
  assert.deepEqual(MR.avisosDeCruce(2, redes), ["10.10.5.0/24 se cruza con 10.10.0.0/16, de «CCTV»."]);
  assert.deepEqual(MR.avisosDeCruce(3, redes), ["192.168.1.0/24 se cruza con 192.168.1.128/25, de esta misma red."]);
  assert.deepEqual(MR.avisosDeCruce(4, redes), []);
});
prueba("v17: lote con «solo los routers definen red» (plan de los UPDATE)", ()=>{
  const tipos = [{ valor:"switch", modo_red:"bridge" }, { valor:"ap", modo_red:"elegir" }, { valor:"camara", modo_red:"no_aplica" }, { valor:"router", modo_red:"router" }];
  const eqs = [
    { id:1, tipo_equipo:"ap", modo_red:null, red_id:null },
    { id:2, tipo_equipo:"switch", modo_red:null, red_id:null },
    { id:3, tipo_equipo:"switch", modo_red:"router", red_id:7 },
    { id:4, tipo_equipo:"camara", modo_red:null, red_id:null },
    { id:5, tipo_equipo:"ap", modo_red:"router", red_id:8 },
  ];
  // Poner la red 9 a todos: el switch en bridge y la cámara no la toman.
  let p = MR.planLote(eqs, [1, 2, 3, 4, 5], { red_id: 9 }, tipos);
  assert.deepEqual(p.grupos, [{ ids:[1, 3, 5], parche:{ red_id:9 } }]);
  assert.deepEqual(p.sinLaRed, [2, 4]); assert.deepEqual(p.dejanRed, []); assert.deepEqual(p.sinCambio, [2, 4]);
  // Pasar a bridge: los que tenían red propia la dejan.
  p = MR.planLote(eqs, [1, 3, 5], { modo_red:"bridge" }, tipos);
  assert.deepEqual(p.grupos, [{ ids:[1], parche:{ modo_red:"bridge" } }, { ids:[3, 5], parche:{ modo_red:"bridge", red_id:null } }]);
  assert.deepEqual(p.sinLaRed, []); assert.deepEqual(p.dejanRed, [3, 5]);
  // Router + red: todos la toman (también la cámara, si enruta).
  p = MR.planLote(eqs, [2, 4], { modo_red:"router", red_id: 9 }, tipos);
  assert.deepEqual(p.grupos, [{ ids:[2, 4], parche:{ modo_red:"router", red_id:9 } }]);
  // Cambiar el tipo a Switch (bridge de fábrica) a uno con red propia sin modo: la deja.
  p = MR.planLote([{ id:6, tipo_equipo:"ap", modo_red:null, red_id:3 }], [6], { tipo_equipo:"switch" }, tipos);
  assert.deepEqual(p.grupos, [{ ids:[6], parche:{ tipo_equipo:"switch", red_id:null } }]); assert.deepEqual(p.dejanRed, [6]);
  // Quitar la propia vale para todos.
  p = MR.planLote(eqs, [2, 3], { red_id: null }, tipos);
  assert.deepEqual(p.grupos, [{ ids:[2, 3], parche:{ red_id:null } }]);
  // Sin modos (sin la 014 todo es «a elegir» o de fábrica): igual que antes.
  p = MR.planLote([{ id:1, tipo_equipo:"ap", red_id:null }], [1, 99], { red_id: 2 }, []);
  assert.deepEqual(p.grupos, [{ ids:[1], parche:{ red_id:2 } }], "el que no existe se ignora");
});
prueba("v17: el tooltip cuenta los routers de cada tipo (y ya no trae la cobertura)", ()=>{
  const eqs = [{ id:1, tipo_equipo:"ap", modo_red:"router" }, { id:2, tipo_equipo:"ap", modo_red:null }, { id:3, tipo_equipo:"router" }];
  const tipos = [{ valor:"router", etiqueta:"Router", orden:10 }, { valor:"ap", etiqueta:"AP", orden:40 }];
  const r = TU.resumenUbicacion({ equipos: eqs, tipos, routerDe: e=>MR.llevaMarcaRouter(e, tipos.find(t=>t.valor === e.tipo_equipo)) });
  assert.deepEqual(r.tipos.map(t=>[t.etiqueta, t.n, t.routers]), [["Router", 1, 0], ["AP", 2, 1]]);
  assert.deepEqual(TU.resumenUbicacion({ equipos: eqs, tipos }).tipos.map(t=>t.routers), [0, 0], "sin routerDe (sin la 014): ninguno");
});
prueba("v17: errores de la 014 traducidos (sus reglas y sin la migración)", ()=>{
  assert.equal(L.traducirErrorMapa({ code:"23514", message:"equipos_radioenlace_red_solo_routers: «Switch (CCTV) en Torre L22» no define red (trabaja como bridge o su tipo no tiene modo de red): va en la red de su servidor. Para darle otra red, ponlo en modo router." }),
    "«Switch (CCTV) en Torre L22» no define red: trabaja como bridge (o su tipo no tiene modo de red) y va en la red de su servidor. Para darle otra red, ponlo en modo router.");
  assert.equal(L.traducirErrorMapa({ code:"23514", message:"tipos_equipo_red_modo_con_redes: 2 equipo(s) de tipo «Switch» tienen red propia: ponlos en modo router o quítales la red antes de pasar el tipo a bridge." }),
    "2 equipos de tipo «Switch» tienen red propia: ponlos en modo router o quítales la red antes de pasar el tipo a «Bridge (capa 2)».");
  assert.equal(L.traducirErrorMapa({ code:"23514", message:"tipos_equipo_red_modo_con_redes: 1 equipo(s) de tipo «Cámara» tienen red propia: ponlos en modo router o quítales la red antes de pasar el tipo a no_aplica." }),
    "1 equipo de tipo «Cámara» tiene red propia: ponlo en modo router o quítale la red antes de pasar el tipo a «No aplica».");
  assert.match(L.traducirErrorMapa({ code:"22P02", message:'invalid cidr value: "192.168.88.1/24"' }), /Algún rango IP no es válido/);
  assert.match(L.traducirErrorMapa({ code:"22P02", message:'invalid input syntax for type cidr: "hola"' }), /10\.10\.0\.0\/24/);
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "redes_rangos_ip_validos"' }), /20 rangos/);
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "equipos_radioenlace_modo_valido"' }), /router o bridge/);
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "tipos_equipo_red_modo_valido"' }), /no aplica/);
  for(const [code, message] of [["PGRST204", "Could not find the 'modo_red' column of 'equipos_radioenlace' in the schema cache"], ["PGRST204", "Could not find the 'rangos_ip' column of 'redes' in the schema cache"],
    ["PGRST204", "Could not find the 'lleva_cobertura' column of 'tipos_equipo_red' in the schema cache"], ["42703", "column tipos_equipo_red.hace_radio does not exist"]]){
    assert.equal(L.traducirErrorMapa({ code, message }), L.TEXTO_FALTA_014, message);
  }
  assert.equal(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'radio_cobertura_m' column of 'equipos_radioenlace' in the schema cache" }), L.TEXTO_FALTA_013, "la 013 sigue igual");
  assert.equal(L.traducirErrorMapa({ code:"22P02", message:'invalid input syntax for type integer: "x"' }), 'invalid input syntax for type integer: "x"', "otro 22P02 no es de los rangos");
});

prueba("errores de la 008/009 traducidos", ()=>{
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "equipos_radioenlace_medio_valido"' }), /cable, fibra/);
  assert.match(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "piscinas_nombre_unico"' }), /Ya hay una piscina/);
  assert.match(L.traducirErrorMapa({ code:"PGRST205", message:"Could not find the table 'public.piscinas' in the schema cache" }), /009_piscinas/);
  assert.match(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'medio' column of 'equipos_radioenlace' in the schema cache" }), /008_medio_y_nombres/);
});

console.log(`\n=== ${ok}/${total} pruebas OK ===`);
if(fallas.length){ console.log("Fallaron: " + fallas.join(" | ")); process.exit(1); }
