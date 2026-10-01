// Escrituras del mapa en Supabase. Cada función valida antes (mismas reglas
// que la base, para no gastar un viaje en un error obvio), escribe, y
// recarga los datos del mapa. Los errores de Supabase se traducen a un
// mensaje legible (traducirErrorMapa); el original queda en error.original.
//
// Quién puede qué lo decide la RLS de las migraciones 002/003 (ubicaciones,
// equipos, respaldos y tipos: solo administrador; historial_ubicacion: acción
// "asignar_ubicacion" de la matriz). La UI solo esconde los botones.
import { sb } from "../nucleo/config.js";
import { cargarAtajos, cargarPiscinas, cargarRedes, cargarTiposEquipo, cargarTiposUbicacion, cargarUbicaciones, cargarEquiposRadioenlace, datosNombres, estadoMapa, hayMedio, indicesMapa, redMapa, refrescarDatosMapa, refrescarPlanoMapa, refrescarTiposUbicacion } from "../nucleo/datos-mapa.js";
import { hayCamposConfigurables } from "../nucleo/datos.js";
import { validarSvg } from "../nucleo/svg-seguro.js";
import { numeroHectareas, redondearPunto, validarPiscina } from "../nucleo/piscinas.js";
import { nombreParaGuardar, nombresAutomaticos, slugTipo, validarAtajo, validarRed, validarTipoEquipo } from "../nucleo/mapa-nombres.js";
import { copiarEsquinas, esquinasValidas } from "../nucleo/plano-mapa.js";
import { hoyLocalISO, traducirErrorMapa, validarEquipo, validarFechaMovimiento, validarTipoUbicacion, validarUbicacion } from "../nucleo/mapa-logica.js";
import { esMedio, validarRespaldo, validarServidor } from "../nucleo/mapa-jerarquia.js";
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
// v10: el ícono (icono_svg) existe desde la 012; sin ella no se envía.
// Desde Configuración (sin el mapa abierto) solo se recargan los tipos.
async function recargarTiposUbicacion(){
  if(estadoMapa().cargado) await refrescarDatosMapa();
  else await refrescarTiposUbicacion();
}

function iconoUbicacionParaGuardar(icono_svg){
  const v = validarSvg(icono_svg, { exigirViewBox: true });
  if(!v.ok) throw new ErrorValidacion({ icono_svg: v.error });
  return v.svg || null;
}

export async function crearTipoUbicacion(etiqueta, color, icono_svg = ""){
  const etq = String(etiqueta ?? "").trim();
  const valor = slugify(etq);
  const existentes = cargarTiposUbicacion();
  const v = validarTipoUbicacion(valor, etq, existentes);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const orden = existentes.length ? Math.max(...existentes.map(t=>t.orden || 0)) + 10 : 10;
  const fila = { valor, etiqueta: etq, color: color || "#57697C", orden };
  const icono = iconoUbicacionParaGuardar(icono_svg);
  if(hayCamposConfigurables()) fila.icono_svg = icono;
  else if(icono) throw new ErrorValidacion({ icono_svg: "Para guardar el ícono de un tipo de ubicación hace falta la migración 012." });
  exigir(await sb.from("tipos_ubicacion").insert(fila));
  await recargarTiposUbicacion();
  return valor;
}

// v10: la etiqueta, el color, el ícono y si se ofrece (activo). El valor
// (la clave) no cambia: lo usan las ubicaciones y el glifo de fábrica.
export async function editarTipoUbicacion(valor, { etiqueta, color, icono_svg, activo } = {}){
  const actual = cargarTiposUbicacion().find(t=>t.valor === valor);
  if(!actual) throw new Error("Ese tipo de ubicación ya no existe. Recarga la página.");
  const parche = {};
  if(etiqueta !== undefined){
    const etq = String(etiqueta ?? "").trim();
    if(!etq) throw new ErrorValidacion({ etiqueta: "La etiqueta no puede quedar vacía." });
    if(cargarTiposUbicacion().some(t=>t.valor !== valor && t.etiqueta.trim().toLowerCase() === etq.toLowerCase())) throw new ErrorValidacion({ etiqueta: "Ya hay otro tipo de ubicación con esa etiqueta." });
    parche.etiqueta = etq;
  }
  if(color !== undefined) parche.color = color || "#57697C";
  if(icono_svg !== undefined){
    const icono = iconoUbicacionParaGuardar(icono_svg);
    if(hayCamposConfigurables()) parche.icono_svg = icono;
    else if(icono) throw new ErrorValidacion({ icono_svg: "Para guardar el ícono de un tipo de ubicación hace falta la migración 012." });
  }
  if(activo !== undefined) parche.activo = !!activo;
  if(!Object.keys(parche).length) return;
  exigirFilas(await sb.from("tipos_ubicacion").update(parche).eq("valor", valor).select("valor"), "guardó el tipo de ubicación");
  await recargarTiposUbicacion();
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
  if(s.ubicacionId === id) Object.assign(s, { ubicacionId: null, equipoId: null, activoId: null });
  await refrescarDatosMapa();
}

// ---------------------------------------------------------------------------
// Equipos de radioenlace. Vincular un activo lo mueve solo a la ubicación
// del equipo (trigger de la base), con su tramo en historial_ubicacion.
// servidor_id = servidor activo (NULL = raíz). Banda y frecuencia ya no se
// piden en el formulario: solo se escriben si vienen en los campos (así un
// equipo editado conserva lo que tenía). La base rechaza los ciclos (trigger
// de la 003); aquí se avisa antes para no gastar el viaje.
// ---------------------------------------------------------------------------
function numeroOpcional(v){
  if(v === "" || v === null || v === undefined) return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
}

function filaEquipo(c){
  const fila = {
    ubicacion_id: Number(c.ubicacion_id),
    nombre: String(c.nombre ?? "").trim(),
    modelo: textoOpcional(c.modelo),
    activo_id: (c.activo_id === "" || c.activo_id === null || c.activo_id === undefined) ? null : Number(c.activo_id),
    notas: textoOpcional(c.notas),
    servidor_id: (c.servidor_id === "" || c.servidor_id === null || c.servidor_id === undefined) ? null : Number(c.servidor_id),
  };
  if("banda" in c) fila.banda = textoOpcional(c.banda);
  if("frecuencia_mhz" in c) fila.frecuencia_mhz = numeroOpcional(c.frecuencia_mhz);
  // 007: solo si el formulario los trae (sin la migración no se envían).
  if("tipo_equipo" in c) fila.tipo_equipo = textoOpcional(c.tipo_equipo);
  if("red_id" in c) fila.red_id = (c.red_id === "" || c.red_id === null || c.red_id === undefined) ? null : Number(c.red_id);
  if("referencia" in c) fila.referencia = textoOpcional(c.referencia);
  // 008: medio del enlace con el servidor (sin servidor no aplica).
  if("medio" in c) fila.medio = fila.servidor_id !== null && esMedio(c.medio) ? c.medio : null;
  return fila;
}

function validarFilaEquipo(fila, idActual){
  const v = validarEquipo(fila, cargarEquiposRadioenlace(), idActual);
  const errores = { ...v.errores };
  const errorServidor = validarServidor(redMapa(), idActual, fila.servidor_id);
  if(errorServidor && !errores.servidor_id) errores.servidor_id = errorServidor;
  if(Number.isNaN(fila.frecuencia_mhz)) errores.frecuencia_mhz = "La frecuencia debe ser un número mayor que cero.";
  if(Object.keys(errores).length) throw new ErrorValidacion(errores);
}

export async function crearEquipo(campos){
  const fila = filaEquipo(campos);
  validarFilaEquipo(fila, null);
  const { id } = exigir(await sb.from("equipos_radioenlace").insert(fila).select("id").single());
  await refrescarDatosMapa();
  return id;
}

// Si el servidor nuevo era uno de sus respaldos, la base quita esa fila de
// respaldo (quedó promovido a principal).
export async function editarEquipo(id, campos){
  const fila = filaEquipo(campos);
  validarFilaEquipo(fila, id);
  exigirFilas(await sb.from("equipos_radioenlace").update(fila).eq("id", id).select("id"), "guardó el equipo");
  await refrescarDatosMapa();
}

// No se puede borrar un equipo que todavía es servidor de otros (la FK es NO
// ACTION): hay que reasignar sus clientes antes. Sus respaldos (los suyos y
// los que otros tenían apuntando a él) se borran con él. Si tenía un activo
// vinculado, el activo se queda en esta ubicación hasta que alguien lo mueva.
export async function eliminarEquipo(id){
  const clientes = cargarEquiposRadioenlace().filter(e=>e.servidor_id === id);
  if(clientes.length) throw new Error(`No se puede eliminar: ${clientes.length === 1 ? `«${clientes[0].nombre}» lo tiene` : `${clientes.length} equipos lo tienen`} como servidor. Asígnales otro servidor primero.`);
  exigirFilas(await sb.from("equipos_radioenlace").delete().eq("id", id).select("id"), "eliminó el equipo");
  const m = estadoMapa();
  if(m.seleccion.equipoId === id) m.seleccion.equipoId = null;
  m.simulacion.caidos = m.simulacion.caidos.filter(x=>x !== id);
  m.expandidos = m.expandidos.filter(x=>x !== id);
  await refrescarDatosMapa();
}

// ---------------------------------------------------------------------------
// Respaldos (enlaces_respaldo): a qué servidores puede conmutar un equipo si
// pierde el suyo, por prioridad (1 = primera opción).
// ---------------------------------------------------------------------------
function filaRespaldo(c){
  return {
    equipo_id: Number(c.equipo_id),
    servidor_alternativo_id: (c.servidor_alternativo_id === "" || c.servidor_alternativo_id === null || c.servidor_alternativo_id === undefined) ? null : Number(c.servidor_alternativo_id),
    prioridad: Number(c.prioridad),
    notas: textoOpcional(c.notas),
  };
}

export async function crearRespaldo(campos){
  const fila = filaRespaldo(campos);
  const v = validarRespaldo(fila, redMapa(), null);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  const { id } = exigir(await sb.from("enlaces_respaldo").insert(fila).select("id").single());
  await refrescarDatosMapa();
  return id;
}

export async function editarRespaldo(id, campos){
  const fila = filaRespaldo(campos);
  const v = validarRespaldo(fila, redMapa(), id);
  if(!v.ok) throw new ErrorValidacion(v.errores);
  exigirFilas(await sb.from("enlaces_respaldo").update({ servidor_alternativo_id: fila.servidor_alternativo_id, prioridad: fila.prioridad, notas: fila.notas }).eq("id", id).select("id"), "guardó el respaldo");
  await refrescarDatosMapa();
}

export async function eliminarRespaldo(id){
  exigirFilas(await sb.from("enlaces_respaldo").delete().eq("id", id).select("id"), "quitó el respaldo");
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

// ---------------------------------------------------------------------------
// Capa "Plano" (migración 006): guardar dónde va el plano sobre el mapa. Solo
// administrador (RLS). Si no hay fila (tabla vacía), se crea con la imagen y
// el calce original del plano que trae la app.
// ---------------------------------------------------------------------------
export async function guardarAjustePlano(plano, esquinas){
  if(!esquinasValidas(esquinas)) throw new Error("La posición del plano no es válida: vuelve a ajustarlo.");
  if(plano && plano.error) throw errorAmigable(plano.error);
  const columnas = "id, esquinas, actualizado_en";
  const res = plano && plano.id
    ? await sb.from("planos_mapa").update({ esquinas: copiarEsquinas(esquinas) }).eq("id", plano.id).select(columnas)
    : await sb.from("planos_mapa").insert({
        nombre: plano.nombre,
        imagen: plano.imagen,
        ancho_px: plano.ancho_px,
        alto_px: plano.alto_px,
        esquinas: copiarEsquinas(esquinas),
        esquinas_originales: copiarEsquinas(plano.esquinasOriginales || esquinas),
        activo: true,
      }).select(columnas);
  exigirFilas(res, "guardó el ajuste del plano");
  return refrescarPlanoMapa();
}

// ---------------------------------------------------------------------------
// Red de la finca (migración 007): redes, tipos de equipo y atajos. Solo el
// administrador (RLS). Cada escritura recarga los datos del mapa (los nombres
// automáticos dependen de los tipos).
// ---------------------------------------------------------------------------
function exigirValido(v){ if(!v.ok) throw new ErrorValidacion(v.errores); }
const siguienteOrden = filas=>filas.length ? Math.max(...filas.map(f=>Number(f.orden) || 0)) + 10 : 10;

export async function crearRed({ nombre, color }){
  exigirValido(validarRed({ nombre, color }, cargarRedes()));
  const { id } = exigir(await sb.from("redes").insert({ nombre: nombre.trim(), color, orden: siguienteOrden(cargarRedes()) }).select("id").single());
  await refrescarDatosMapa();
  return id;
}

export async function editarRed(id, { nombre, color, activa }){
  exigirValido(validarRed({ nombre, color }, cargarRedes(), id));
  const parche = { nombre: nombre.trim(), color };
  if(activa !== undefined) parche.activa = !!activa;
  exigirFilas(await sb.from("redes").update(parche).eq("id", id).select("id"), "guardó la red");
  await refrescarDatosMapa();
}

export async function eliminarRed(id){
  exigirFilas(await sb.from("redes").delete().eq("id", id).select("id"), "eliminó la red");
  await refrescarDatosMapa();
}

export async function crearTipoEquipo({ etiqueta, genero }){
  const v = validarTipoEquipo({ etiqueta, genero }, cargarTiposEquipo());
  exigirValido(v);
  exigir(await sb.from("tipos_equipo_red").insert({ valor: v.valor || slugTipo(etiqueta), etiqueta: etiqueta.trim(), genero, orden: siguienteOrden(cargarTiposEquipo()) }).select("valor").single());
  await refrescarDatosMapa();
  return v.valor;
}

export async function editarTipoEquipo(valor, { etiqueta, genero, activo }){
  exigirValido(validarTipoEquipo({ etiqueta, genero }, cargarTiposEquipo(), valor));
  const parche = { etiqueta: etiqueta.trim(), genero };
  if(activo !== undefined) parche.activo = !!activo;
  exigirFilas(await sb.from("tipos_equipo_red").update(parche).eq("valor", valor).select("valor"), "guardó el tipo de equipo");
  await refrescarDatosMapa();
}

export async function crearAtajo({ nombre, equipos }){
  exigirValido(validarAtajo({ nombre, equipos }, cargarAtajos()));
  const { id } = exigir(await sb.from("atajos_simulacion").insert({ nombre: nombre.trim(), equipos, orden: siguienteOrden(cargarAtajos()) }).select("id").single());
  await refrescarDatosMapa();
  return id;
}

export async function editarAtajo(id, { nombre, equipos }){
  const actual = cargarAtajos().find(a=>a.id === id);
  const lista = equipos === undefined ? (actual ? actual.equipos : []) : equipos;
  exigirValido(validarAtajo({ nombre, equipos: lista }, cargarAtajos(), id));
  const parche = { nombre: nombre.trim() };
  if(equipos !== undefined) parche.equipos = equipos;
  exigirFilas(await sb.from("atajos_simulacion").update(parche).eq("id", id).select("id"), "guardó el atajo");
  await refrescarDatosMapa();
}

export async function eliminarAtajo(id){
  exigirFilas(await sb.from("atajos_simulacion").delete().eq("id", id).select("id"), "eliminó el atajo");
  await refrescarDatosMapa();
}

// ---------------------------------------------------------------------------
// Asignación en lote (007): tipo y/o red para varios equipos a la vez.
// cambios = { tipo_equipo?, red_id? }: solo viaja lo que se cambia (red_id
// null = quitar la red). Devuelve cuántos equipos cambiaron.
//   * Con la 008 (o si el tipo no cambia): un solo UPDATE; los nombres los
//     pone al día la base.
//   * Sin la 008 y con cambio de tipo: un UPDATE por equipo, en orden de id,
//     con su nombre automático (así no choca con el índice único de nombres).
// ---------------------------------------------------------------------------
export async function asignarEnLote(ids, cambios = {}){
  const lista = [...new Set((ids || []).map(Number))].filter(Number.isFinite).sort((a, b)=>a - b);
  if(!lista.length) throw new Error("Elige al menos un equipo.");
  const parche = {};
  if("tipo_equipo" in cambios) parche.tipo_equipo = textoOpcional(cambios.tipo_equipo);
  if("red_id" in cambios) parche.red_id = cambios.red_id === null || cambios.red_id === "" || cambios.red_id === undefined ? null : Number(cambios.red_id);
  if(!Object.keys(parche).length) throw new Error("Elige qué cambiar: el tipo, la red o los dos.");
  if("tipo_equipo" in parche && !parche.tipo_equipo) throw new Error("Elige el tipo de equipo (el nombre automático lo necesita).");
  if(parche.tipo_equipo && !cargarTiposEquipo().some(t=>t.valor === parche.tipo_equipo)) throw new Error("Ese tipo de equipo ya no existe. Recarga el mapa.");
  if(parche.red_id !== undefined && parche.red_id !== null && !cargarRedes().some(r=>r.id === parche.red_id)) throw new Error("Esa red ya no existe. Recarga el mapa.");
  const existentes = new Set(cargarEquiposRadioenlace().map(e=>e.id));
  const faltan = lista.filter(id=>!existentes.has(id));
  if(faltan.length) throw new Error("Algún equipo ya no existe. Recarga el mapa.");

  if(hayMedio() || !("tipo_equipo" in parche)){
    const filas = exigirFilas(await sb.from("equipos_radioenlace").update(parche).in("id", lista).select("id"), "aplicó el cambio");
    await refrescarDatosMapa();
    return filas.length;
  }
  // Sin la 008: copia local que se va poniendo al día equipo por equipo.
  const copia = cargarEquiposRadioenlace().map(e=>({ ...e }));
  const alDia = ()=>{
    const nombres = nombresAutomaticos(datosNombres(copia.map(e=>({ ...e, nombre: e.nombre_guardado ?? e.nombre }))));
    for(const e of copia) e.nombre = nombres.get(e.id) ?? e.nombre_guardado ?? e.nombre;
  };
  let hechos = 0;
  try{
    for(const id of lista){
      const e = copia.find(x=>x.id === id);
      const fila = { ...e, ...parche };
      const nombre = nombreParaGuardar(fila, datosNombres(copia), id) || e.nombre_guardado || e.nombre;
      exigirFilas(await sb.from("equipos_radioenlace").update({ ...parche, nombre }).eq("id", id).select("id"), "aplicó el cambio");
      Object.assign(e, parche, { nombre_guardado: nombre });
      alDia();
      hechos++;
    }
  }catch(err){
    await refrescarDatosMapa().catch(()=>{});
    if(hechos) err.message = `${err.message} Se alcanzaron a cambiar ${hechos} de ${lista.length}.`;
    throw err;
  }
  await refrescarDatosMapa();
  return hechos;
}

// ---------------------------------------------------------------------------
// Piscinas (migración 009): solo el administrador (RLS). Solo viaja lo que
// se cambia (el editor de vértices manda solo los puntos).
// ---------------------------------------------------------------------------
function filaPiscina(c){
  const f = {};
  if("nombre" in c) f.nombre = String(c.nombre ?? "").trim();
  if("sector" in c) f.sector = textoOpcional(c.sector);
  if("hectareas" in c) f.hectareas = numeroHectareas(c.hectareas);
  if("puntos" in c) f.puntos = (c.puntos || []).map(redondearPunto);
  if("notas" in c) f.notas = textoOpcional(c.notas);
  if("revisar" in c) f.revisar = !!c.revisar;
  if("fuente" in c) f.fuente = c.fuente;
  return f;
}

export async function crearPiscina(campos){
  const fila = filaPiscina({ fuente: "manual", ...campos });
  exigirValido(validarPiscina(fila, cargarPiscinas()));
  const { id } = exigir(await sb.from("piscinas").insert({ ...fila, orden: siguienteOrden(cargarPiscinas()) }).select("id").single());
  await refrescarDatosMapa();
  return id;
}

export async function editarPiscina(id, campos){
  const actual = cargarPiscinas().find(p=>p.id === id);
  if(!actual) throw new Error("Esa piscina ya no existe. Recarga el mapa.");
  const fila = filaPiscina(campos);
  exigirValido(validarPiscina({ ...actual, ...fila }, cargarPiscinas(), id));
  exigirFilas(await sb.from("piscinas").update(fila).eq("id", id).select("id"), "guardó la piscina");
  await refrescarDatosMapa();
}

export async function eliminarPiscina(id){
  exigirFilas(await sb.from("piscinas").delete().eq("id", id).select("id"), "eliminó la piscina");
  await refrescarDatosMapa();
}
