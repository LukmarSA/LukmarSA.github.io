// Pruebas unitarias de la lógica pura del mapa (nucleo/geo.js y
// nucleo/mapa-logica.js). No necesitan navegador ni Supabase.
//   node mapa-unit.mjs        (o: npm run test:mapa)
process.env.TZ = "America/Guayaquil"; // para probar el caso "después de las 19:00" de hoyLocalISO

import assert from "node:assert/strict";
import * as geo from "../assets/js/inventario-tecnologico/nucleo/geo.js";
import * as L from "../assets/js/inventario-tecnologico/nucleo/mapa-logica.js";

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
  { id:10, ubicacion_id:1, nombre:"PTP CA-SA", modelo:"Cambium PTP 550", activo_id:null },
  { id:11, ubicacion_id:1, nombre:"AP Sector Norte", modelo:"Cambium ePMP 3000", activo_id:null },
  { id:20, ubicacion_id:2, nombre:"PTP SA-CA", modelo:"Cambium PTP 550", activo_id:null },
  { id:30, ubicacion_id:3, nombre:"SM Oficina", modelo:"Force 300", activo_id:7 },
];
const enlaces = [
  { id:100, equipo_origen_id:10, equipo_destino_id:20, banda:"5 GHz", frecuencia_mhz:5745 },
  { id:101, equipo_origen_id:30, equipo_destino_id:11, banda:"5 GHz", frecuencia_mhz:null },
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
const idx = L.indexarMapa({ ubicaciones, equipos, enlaces, vigentes, activos });

prueba("índices: equipos por ubicación, ordenados por nombre", ()=>{
  assert.deepEqual(idx.equiposPorUbicacion.get(1).map(e=>e.id), [11, 10]);
  assert.equal(idx.equiposPorUbicacion.get(4), undefined);
});
prueba("índices: cada enlace queda en los dos equipos", ()=>{
  assert.deepEqual(idx.enlacesPorEquipo.get(10).map(l=>l.id), [100]);
  assert.deepEqual(idx.enlacesPorEquipo.get(20).map(l=>l.id), [100]);
  assert.deepEqual(idx.enlacesPorEquipo.get(11).map(l=>l.id), [101]);
});
prueba("índices: tramos vigentes solo de activos que existen en el listado", ()=>{
  assert.ok(idx.vigentePorActivo.has(7) && idx.vigentePorActivo.has(8));
  assert.equal(idx.vigentePorActivo.has(99), false);
  assert.deepEqual((idx.activosPorUbicacion.get(2) || []).map(a=>a.id), []);
  assert.deepEqual(idx.activosPorUbicacion.get(3).map(a=>a.id), [7]);
});
prueba("índices: equipo por activo vinculado", ()=>assert.equal(idx.equipoPorActivo.get(7).id, 30));
prueba("extremo opuesto de un enlace", ()=>{
  assert.equal(L.extremoOpuesto(enlaces[0], 10), 20);
  assert.equal(L.extremoOpuesto(enlaces[0], 20), 10);
});
prueba("enlaces de un equipo: otro extremo, distancia y azimuts", ()=>{
  const [d] = L.enlacesDeEquipo(idx, 20);
  assert.equal(d.otro.id, 10); assert.equal(d.otraUbicacion.id, 1);
  cerca(d.distanciaKm, geo.distanciaKm(ubicaciones[1], ubicaciones[0]), 1e-9);
  cerca(((d.azimutVuelta - d.azimutIda) + 360) % 360, 180, 0.01);
});
prueba("ubicaciones enlazadas desde un equipo (para resaltar el otro extremo)", ()=>{
  assert.deepEqual([...L.ubicacionesEnlazadas(idx, 10)], [2]);
  assert.deepEqual([...L.ubicacionesEnlazadas(idx, 11)], [3]);
});
prueba("filtros: tipos ocultos y archivadas", ()=>{
  assert.deepEqual(L.ubicacionesVisibles(ubicaciones, {}).map(u=>u.id), [1,2,3]);
  assert.deepEqual(L.ubicacionesVisibles(ubicaciones, { verArchivadas:true }).map(u=>u.id), [1,2,3,4]);
  assert.deepEqual(L.ubicacionesVisibles(ubicaciones, { tiposOcultos:["torre"] }).map(u=>u.id), [3]);
});
prueba("orden: por orden del tipo y luego por nombre", ()=>{
  assert.deepEqual(L.ordenarUbicaciones([ubicaciones[2], ubicaciones[1], ubicaciones[0]], tipos).map(u=>u.id), [1,2,3]);
});
prueba("resumen: cifras del panel", ()=>{
  const r = L.resumenMapa(idx, { ubicaciones, equipos, enlaces, activos });
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
prueba("validar enlace: misma ubicación, consigo mismo, par repetido (en cualquier sentido)", ()=>{
  assert.match(L.validarEnlace({ equipo_origen_id:10, equipo_destino_id:11 }, idx, enlaces).errores.equipo_destino_id, /distintas/);
  assert.match(L.validarEnlace({ equipo_origen_id:10, equipo_destino_id:10 }, idx, enlaces).errores.equipo_destino_id, /consigo mismo/);
  assert.match(L.validarEnlace({ equipo_origen_id:20, equipo_destino_id:10 }, idx, enlaces).errores.equipo_destino_id, /ya están enlazados/);
  assert.equal(L.validarEnlace({ equipo_origen_id:20, equipo_destino_id:10 }, idx, enlaces, 100).ok, true);
  assert.equal(L.validarEnlace({ equipo_origen_id:11, equipo_destino_id:20 }, idx, enlaces).ok, true); // PtMP: AP con un segundo enlace
});
prueba("validar enlace: frecuencia no positiva rechazada, vacía permitida", ()=>{
  assert.ok(L.validarEnlace({ equipo_origen_id:11, equipo_destino_id:20, frecuencia_mhz:"-5" }, idx, enlaces).errores.frecuencia_mhz);
  assert.equal(L.validarEnlace({ equipo_origen_id:11, equipo_destino_id:20, frecuencia_mhz:"" }, idx, enlaces).ok, true);
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

prueba("errores: restricciones únicas y checks → mensaje en español", ()=>{
  assert.equal(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "ubicaciones_nombre_unico"' }), "Ya existe una ubicación con ese nombre.");
  assert.equal(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "enlaces_par_unico"' }), "Esos dos equipos ya están enlazados.");
  assert.equal(L.traducirErrorMapa({ code:"23505", message:'duplicate key value violates unique constraint "equipos_radioenlace_activo_unico"' }), "Ese activo ya está vinculado a otro equipo de radioenlace.");
});
prueba("errores: borrar ubicación en uso (FK RESTRICT) sugiere archivar", ()=>{
  assert.match(L.traducirErrorMapa({ code:"23503", message:'update or delete on table "ubicaciones" violates foreign key constraint "historial_ubicacion_ubicacion_id_fkey" on table "historial_ubicacion"' }), /archivarla/);
});
prueba("errores: RLS vs. falta de GRANT se distinguen (el GRANT fue la caída de producción anterior)", ()=>{
  assert.match(L.traducirErrorMapa({ code:"42501", message:'new row violates row-level security policy for table "ubicaciones"' }), /No tienes permiso/);
  assert.match(L.traducirErrorMapa({ code:"42501", message:"permission denied for table ubicaciones" }), /GRANT/);
});
prueba("errores: tablas inexistentes apuntan a la migración 002", ()=>{
  assert.match(L.traducirErrorMapa({ code:"PGRST205", message:"Could not find the table 'public.ubicaciones' in the schema cache" }), /migraciones\/002/);
});
prueba("errores: mensajes de los triggers pasan tal cual", ()=>{
  const m = "Este activo está instalado como equipo de radioenlace «SM Oficina» en «Oficína Centro»: muévelo editando ese equipo.";
  assert.equal(L.traducirErrorMapa({ code:"23514", message:m }), m);
});

console.log(`\n=== ${ok}/${total} pruebas OK ===`);
if(fallas.length){ console.log("Fallaron: " + fallas.join(" | ")); process.exit(1); }
