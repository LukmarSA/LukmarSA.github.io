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
  assert.deepEqual(L.infoTipoUbicacion(tipos, "repetidora"), { etiqueta:"repetidora", color:"#57697C", activo:false });
  assert.equal(L.infoTipoUbicacion(tipos, "torre").color, "#EC741D");
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

prueba("errores de la 008/009 traducidos", ()=>{
  assert.match(L.traducirErrorMapa({ code:"23514", message:'violates check constraint "equipos_radioenlace_medio_valido"' }), /cable, fibra/);
  assert.match(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "piscinas_nombre_unico"' }), /Ya hay una piscina/);
  assert.match(L.traducirErrorMapa({ code:"PGRST205", message:"Could not find the table 'public.piscinas' in the schema cache" }), /009_piscinas/);
  assert.match(L.traducirErrorMapa({ code:"PGRST204", message:"Could not find the 'medio' column of 'equipos_radioenlace' in the schema cache" }), /008_medio_y_nombres/);
});

console.log(`\n=== ${ok}/${total} pruebas OK ===`);
if(fallas.length){ console.log("Fallaron: " + fallas.join(" | ")); process.exit(1); }
