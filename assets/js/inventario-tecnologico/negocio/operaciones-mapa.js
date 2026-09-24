// Escrituras del mapa en Supabase. Cada función valida antes (mismas reglas
// que la base, para no gastar un viaje en un error obvio), escribe, y
// recarga los datos del mapa. Los errores de Supabase se traducen a un
// mensaje legible (traducirErrorMapa); el original queda en error.original.
//
// Quién puede qué lo decide la RLS de la migración 002 (ubicaciones, equipos,
// enlaces y tipos: solo administrador; historial_ubicacion: acción
// "asignar_ubicacion" de la matriz). La UI solo esconde los botones.
import { sb } from "../nucleo/config.js";
import { cargarTiposUbicacion, cargarUbicaciones, cargarEnlaces, cargarEquiposRadioenlace, estadoMapa, indicesMapa, refrescarDatosMapa } from "../nucleo/datos-mapa.js";
import { hoyLocalISO, traducirErrorMapa, validarEnlace, validarEquipo, validarFechaMovimiento, validarTipoUbicacion, validarUbicacion } from "../nucleo/mapa-logica.js";
import { slugify } from "../nucleo/opciones-configurables.js";
import { redimensionarImagen } from "./operaciones.js";

// Las fotos de ubicaciones van al mismo bucket público que las de activos
// (sus políticas de Storage ya permiten subir/borrar a cualquier usuario
// autenticado), bajo la carpeta ubicaciones/<id>/ para no mezclarse con las
// carpetas <id>/ de los activos.
export const BUCKET_FOTOS = "fotos-activos";

export class ErrorValidacion extends Error {
  constructor(errores){
    super(Object.values(errores)[0] || "Revisa los datos.");
    this.name = "ErrorValidacion";
    this.errores = errores;
  }
}

function errorAmigable(error){
  const e = new Error(traducirErrorMapa(error));
  e.original = error;
  return e;
}

function exigir(res){
  if(res.error) throw errorAmigable(res.error);
  return res.data;
}

// update/delete bloqueados por RLS no dan error: afectan 0 filas. Con
// .select("id") se sabe si de verdad se aplicaron.
function exigirFilas(res, que){
  const filas = exigir(res) || [];
  if(!filas.length) throw new Error(`No se ${que}: la base no aplicó el cambio (¿sin permiso, o alguien lo borró?). Recarga el mapa.`);
  return filas;
}

function textoOpcional(v){
  const s = String(v ?? "").trim();
  return s ? s : null;
}

// ---------------------------------------------------------------------------
// Tipos de ubicación (mismo mecanismo que crearEstadoOpcion: valor = slug
// inmutable de la etiqueta, orden = máximo + 10)
// ---------------------------------------------------------------------------
export async function crearTipoUbicacion(etiqueta, color){
  const etq = String(etiqueta ?? "").trim();
  const valor = slugify(etq);
  const existentes = cargarTiposUbicacion();
  const v = validarTipoUbicacion(valor, etq, existentes);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const orden = existentes.length ? Math.max(...existentes.map(t=>t.orden || 0)) + 10 : 10;
  exigir(await sb.from("tipos_ubicacion").insert({ valor, etiqueta: etq, color: color || "#57697C", orden }));
  await refrescarDatosMapa();
  return valor;
}

// ---------------------------------------------------------------------------
// Ubicaciones
// ---------------------------------------------------------------------------
function filaUbicacion(c){
  return {
    nombre: String(c.nombre ?? "").trim(),
    tipo: c.tipo,
    lat: Number(c.lat),
    lng: Number(c.lng),
    direccion: textoOpcional(c.direccion),
    notas: textoOpcional(c.notas),
  };
}

export async function crearUbicacion(campos, fotosNuevas = []){
  const fila = filaUbicacion(campos);
  const v = validarUbicacion(fila, cargarUbicaciones(), null);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const { id } = exigir(await sb.from("ubicaciones").insert(fila).select("id").single());
  const erroresFotos = fotosNuevas.length ? await subirFotos(id, [], fotosNuevas) : [];
  await refrescarDatosMapa();
  return { id, erroresFotos };
}

export async function editarUbicacion(id, campos, { fotosNuevas = [], fotosABorrar = [] } = {}){
  const fila = filaUbicacion(campos);
  const v = validarUbicacion(fila, cargarUbicaciones(), id);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const actual = cargarUbicaciones().find(u=>u.id === id);
  const fotos = (actual && actual.fotos || []).filter(r=>!fotosABorrar.includes(r));
  exigirFilas(await sb.from("ubicaciones").update(fotosABorrar.length ? { ...fila, fotos } : fila).eq("id", id).select("id"), "guardó la ubicación");
  // Si borrar el archivo falla, queda huérfano en Storage pero la ficha ya no lo muestra.
  if(fotosABorrar.length) await sb.storage.from(BUCKET_FOTOS).remove(fotosABorrar);
  const erroresFotos = fotosNuevas.length ? await subirFotos(id, fotos, fotosNuevas) : [];
  await refrescarDatosMapa();
  return { erroresFotos };
}

async function subirFotos(id, fotosActuales, archivos){
  const fotos = [...fotosActuales];
  const errores = [];
  for(const archivo of archivos){
    try{
      const blob = await redimensionarImagen(archivo, 1600, 0.82);
      const ruta = `ubicaciones/${id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const { error } = await sb.storage.from(BUCKET_FOTOS).upload(ruta, blob, { contentType: "image/jpeg" });
      if(error) throw error;
      fotos.push(ruta);
    }catch(err){
      errores.push(`${archivo.name || "foto"}: ${err.message}`);
    }
  }
  if(fotos.length !== fotosActuales.length) exigir(await sb.from("ubicaciones").update({ fotos }).eq("id", id));
  return errores;
}

export async function establecerUbicacionActiva(id, activa){
  exigirFilas(await sb.from("ubicaciones").update({ activa: !!activa }).eq("id", id).select("id"), activa ? "reactivó la ubicación" : "archivó la ubicación");
  await refrescarDatosMapa();
}

// Una ubicación solo se borra si nunca se usó: sin equipos y sin ningún tramo
// de historial (la FK es RESTRICT a propósito). Si ya se usó, se archiva.
export async function eliminarUbicacion(id){
  const equipos = cargarEquiposRadioenlace().filter(e=>e.ubicacion_id === id).length;
  if(equipos) throw new Error(`No se puede eliminar: tiene ${equipos} equipo(s) de radioenlace. Elimínalos o muévelos primero, o archiva la ubicación.`);
  const { count, error } = await sb.from("historial_ubicacion").select("id", { count: "exact", head: true }).eq("ubicacion_id", id);
  if(error) throw errorAmigable(error);
  if(count) throw new Error(`No se puede eliminar: ${count} registro(s) del historial de activos pasan por esta ubicación. Archívala para ocultarla sin perder ese historial.`);
  const fotos = (cargarUbicaciones().find(u=>u.id === id) || {}).fotos || [];
  exigirFilas(await sb.from("ubicaciones").delete().eq("id", id).select("id"), "eliminó la ubicación");
  if(fotos.length) await sb.storage.from(BUCKET_FOTOS).remove(fotos);
  const s = estadoMapa().seleccion;
  if(s.ubicacionId === id) Object.assign(s, { ubicacionId: null, equipoId: null, enlaceId: null, activoId: null });
  await refrescarDatosMapa();
}

// ---------------------------------------------------------------------------
// Equipos de radioenlace. Vincular un activo lo mueve solo a la ubicación
// del equipo (trigger de la base), con su tramo en historial_ubicacion.
// ---------------------------------------------------------------------------
function filaEquipo(c){
  return {
    ubicacion_id: Number(c.ubicacion_id),
    nombre: String(c.nombre ?? "").trim(),
    modelo: textoOpcional(c.modelo),
    activo_id: (c.activo_id === "" || c.activo_id === null || c.activo_id === undefined) ? null : Number(c.activo_id),
    notas: textoOpcional(c.notas),
  };
}

export async function crearEquipo(campos){
  const fila = filaEquipo(campos);
  const v = validarEquipo(fila, cargarEquiposRadioenlace(), null);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const { id } = exigir(await sb.from("equipos_radioenlace").insert(fila).select("id").single());
  await refrescarDatosMapa();
  return id;
}

export async function editarEquipo(id, campos){
  const fila = filaEquipo(campos);
  const v = validarEquipo(fila, cargarEquiposRadioenlace(), id);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  exigirFilas(await sb.from("equipos_radioenlace").update(fila).eq("id", id).select("id"), "guardó el equipo");
  await refrescarDatosMapa();
}

// Sus enlaces se borran con él (ON DELETE CASCADE). Si tenía un activo
// vinculado, el activo se queda en esta ubicación hasta que alguien lo mueva.
export async function eliminarEquipo(id){
  exigirFilas(await sb.from("equipos_radioenlace").delete().eq("id", id).select("id"), "eliminó el equipo");
  const s = estadoMapa().seleccion;
  if(s.equipoId === id) Object.assign(s, { equipoId: null, enlaceId: null });
  await refrescarDatosMapa();
}

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------
function filaEnlace(c){
  const f = c.frecuencia_mhz;
  return {
    equipo_origen_id: Number(c.equipo_origen_id),
    equipo_destino_id: Number(c.equipo_destino_id),
    banda: textoOpcional(c.banda),
    frecuencia_mhz: (f === "" || f === null || f === undefined) ? null : Number(String(f).replace(",", ".")),
    notas: textoOpcional(c.notas),
  };
}

export async function crearEnlace(campos){
  const fila = filaEnlace(campos);
  const v = validarEnlace(fila, indicesMapa(), cargarEnlaces(), null);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const { id } = exigir(await sb.from("enlaces").insert(fila).select("id").single());
  await refrescarDatosMapa();
  return id;
}

export async function editarEnlace(id, campos){
  const fila = filaEnlace(campos);
  const v = validarEnlace(fila, indicesMapa(), cargarEnlaces(), id);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  exigirFilas(await sb.from("enlaces").update(fila).eq("id", id).select("id"), "guardó el enlace");
  await refrescarDatosMapa();
}

export async function eliminarEnlace(id){
  exigirFilas(await sb.from("enlaces").delete().eq("id", id).select("id"), "eliminó el enlace");
  const s = estadoMapa().seleccion;
  if(s.enlaceId === id) s.enlaceId = null;
  await refrescarDatosMapa();
}

// ---------------------------------------------------------------------------
// Activos ↔ ubicaciones (historial_ubicacion). Mover = un INSERT: el trigger
// cierra el tramo vigente con la fecha del nuevo.
// ---------------------------------------------------------------------------

// Asigna (o mueve) varios activos a una ubicación en una sola inserción.
// Los que no pueden moverse por aquí se omiten con su motivo, en vez de hacer
// fallar a todos: los que ya están ahí, los que son un equipo de radioenlace
// instalado en otra ubicación (se mueven editando el equipo) y los que
// llegaron a su ubicación actual después de la fecha elegida.
export async function asignarActivosAUbicacion(activoIds, ubicacionId, { fecha = hoyLocalISO(), notas = null } = {}){
  if(!estadoMapa().cargado) await refrescarDatosMapa();
  const indices = indicesMapa();
  const filas = [];
  const omitidos = [];
  for(const id of activoIds){
    const vigente = indices.vigentePorActivo.get(id);
    const equipo = indices.equipoPorActivo.get(id);
    if(vigente && vigente.ubicacion_id === ubicacionId){ omitidos.push({ id, motivo: "ya está en esta ubicación" }); continue; }
    if(equipo && equipo.ubicacion_id !== ubicacionId){ omitidos.push({ id, motivo: `es el equipo de radioenlace «${equipo.nombre}»; se mueve editando ese equipo` }); continue; }
    const errorFecha = validarFechaMovimiento(fecha, vigente);
    if(errorFecha){ omitidos.push({ id, motivo: errorFecha }); continue; }
    filas.push({ activo_id: id, ubicacion_id: ubicacionId, desde: fecha, notas: textoOpcional(notas) });
  }
  if(filas.length) exigir(await sb.from("historial_ubicacion").insert(filas));
  await refrescarDatosMapa();
  return { asignados: filas.length, omitidos };
}

// Deja al activo sin ubicación: cierra su tramo vigente con esa fecha.
export async function quitarActivoDeUbicacion(activoId, fecha = hoyLocalISO()){
  if(!estadoMapa().cargado) await refrescarDatosMapa();
  const indices = indicesMapa();
  const vigente = indices.vigentePorActivo.get(activoId);
  if(!vigente) throw new Error("Ese activo no tiene una ubicación vigente.");
  const equipo = indices.equipoPorActivo.get(activoId);
  if(equipo && equipo.ubicacion_id === vigente.ubicacion_id) throw new Error(`Es el equipo de radioenlace «${equipo.nombre}»: desvincúlalo del equipo antes de sacarlo de esta ubicación.`);
  const errorFecha = validarFechaMovimiento(fecha, vigente);
  if(errorFecha) throw new Error(errorFecha);
  exigirFilas(await sb.from("historial_ubicacion").update({ hasta: fecha }).eq("id", vigente.id).is("hasta", null).select("id"), "quitó la ubicación");
  await refrescarDatosMapa();
}
