import { sb } from "../nucleo/config.js";
import { cargarActivos, cargarBajas, hayCamposConfigurables, refrescarDatos } from "../nucleo/datos.js";
import { personalizadosIniciales } from "../nucleo/campos-personalizados.js";
import { buscarActivo, hoyISO } from "../nucleo/helpers.js";

// personalizados = { <clave>: valor } de los campos nuevos (v10, migración
// 012). Sin la 012 no se envía (la columna no existe).
export async function crearActivo(campos, { personalizados = null } = {}){
  const esCelular = campos.tipo === "Celular" && (campos.gmail || campos.password);
  const extra = {};
  const iniciales = personalizadosIniciales(personalizados);
  if(hayCamposConfigurables() && Object.keys(iniciales).length) extra.personalizados = iniciales;
  const { data, error } = await sb.from("activos").insert({
    propiedad: campos.propiedad,
    tipo: campos.tipo || null,
    marca: campos.marca || null,
    modelo: campos.modelo || null,
    serie: campos.serie || null,
    nombre_dispositivo: campos.nombre_dispositivo || null,
    mac_wifi: campos.mac_wifi || null,
    mac_ethernet: campos.mac_ethernet || null,
    sistema_operativo: campos.sistema_operativo || null,
    ram_gb: campos.ram_gb ? Number(campos.ram_gb) : null,
    disco_gb: campos.disco_gb ? Number(campos.disco_gb) : null,
    procesador: campos.procesador || null,
    proveedor: campos.proveedor || null,
    fecha_adquisicion: campos.fecha_adquisicion || null,
    color: campos.color || null,
    longitud_m: campos.longitud_m ? Number(campos.longitud_m) : null,
    valor_compra: campos.valor_compra ? Number(campos.valor_compra) : null,
    vida_util_anios: campos.vida_util_anios ? Number(campos.vida_util_anios) : null,
    estado: "disponible",
    celular_gmail: esCelular ? (campos.gmail || null) : null,
    celular_password: esCelular ? (campos.password || null) : null,
    trazabilidad: { categoria:null, custodio_texto:null, numero_original:null, estado_notas:null, seccion_origen:"Alta manual (app)", fila_excel:null, id_anterior:null },
    ...extra,
  }).select("id").single();
  if(error) throw error;
  await refrescarDatos();
  return data.id;
}

// personalizados: solo los campos nuevos que el tipo muestra; null = vaciar.
// La base los mezcla con lo que ya había (012: personalizados || nuevos, sin
// los null), así no se pierden los valores de los campos que el tipo oculta.
export async function editarActivoBase(id, campos, { personalizados = null } = {}){
  const patch = {};
  if(hayCamposConfigurables() && personalizados && Object.keys(personalizados).length) patch.personalizados = personalizados;
  const editables = ["propiedad","tipo","marca","modelo","serie","nombre_dispositivo",
    "mac_wifi","mac_ethernet","sistema_operativo","procesador","proveedor","fecha_adquisicion","color"];
  editables.forEach(k=>{ if(k in campos) patch[k] = campos[k] || null; });
  if("ram_gb" in campos) patch.ram_gb = campos.ram_gb ? Number(campos.ram_gb) : null;
  if("disco_gb" in campos) patch.disco_gb = campos.disco_gb ? Number(campos.disco_gb) : null;
  if("longitud_m" in campos) patch.longitud_m = campos.longitud_m ? Number(campos.longitud_m) : null;
  if("valor_compra" in campos) patch.valor_compra = campos.valor_compra ? Number(campos.valor_compra) : null;
  if("vida_util_anios" in campos) patch.vida_util_anios = campos.vida_util_anios ? Number(campos.vida_util_anios) : null;
  const esCelular = (campos.tipo || (buscarActivo(cargarActivos(), id)||{}).tipo) === "Celular";
  if(esCelular){
    if("gmail" in campos) patch.celular_gmail = campos.gmail || null;
    if("password" in campos) patch.celular_password = campos.password || null;
  } else {
    patch.celular_gmail = null; patch.celular_password = null;
  }
  const { error } = await sb.from("activos").update(patch).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function cambiarCustodio(id, nuevoCustodio, tipoDevolucionSaliente, fechaHasta, observacionDevolucionSaliente, tipoEntrega, nuevoEstado, observacionEntrega){
  const { error } = await sb.rpc("f_cambiar_custodio", {
    p_activo_id: id, p_tipo_custodio: nuevoCustodio.tipo_custodio, p_nombre: nuevoCustodio.nombre,
    p_cargo: nuevoCustodio.cargo || null, p_fecha: fechaHasta || hoyISO(),
    p_tipo_devolucion: tipoDevolucionSaliente || null, p_observacion_entrega: observacionEntrega || null,
    p_tipo_entrega: tipoEntrega || null, p_observacion_devolucion: observacionDevolucionSaliente || null,
  });
  if(error) throw error;
  // Estado ya no se infiere — viene explícito del dropdown de
  // abrirCambiarCustodio (siempre obligatorio ahí).
  if(nuevoEstado){
    const { error: errorEstado } = await sb.from("activos").update({ estado: nuevoEstado }).eq("id", id);
    if(errorEstado) throw errorEstado;
  }
  await refrescarDatos();
}

export function redimensionarImagen(archivo, maxDim, calidad){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = ()=>{
      let w = img.width, h = img.height;
      if(w > maxDim || h > maxDim){
        if(w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob=>{
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen."));
      }, "image/jpeg", calidad);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("No se pudo leer el archivo como imagen.")); };
    img.src = url;
  });
}

export function urlFoto(ruta){
  return sb.storage.from("fotos-activos").getPublicUrl(ruta).data.publicUrl;
}

export async function subirFotoActivo(id, archivo){
  const blob = await redimensionarImagen(archivo, 1600, 0.82);
  const ruta = `${id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error } = await sb.storage.from("fotos-activos").upload(ruta, blob, { contentType: "image/jpeg" });
  if(error) throw error;
  const a = buscarActivo(cargarActivos(), id);
  const fotos = [...(a.fotos||[]), ruta];
  const { error: e2 } = await sb.from("activos").update({ fotos }).eq("id", id);
  if(e2) throw e2;
  await refrescarDatos();
}

export async function borrarFotoActivo(id, ruta){
  await sb.storage.from("fotos-activos").remove([ruta]);
  const a = buscarActivo(cargarActivos(), id);
  const fotos = (a.fotos||[]).filter(r=>r!==ruta);
  const { error } = await sb.from("activos").update({ fotos }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function editarTramoHistorial(id, index, campos){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const tramo = a.historial_custodia[index];
  if(!tramo || !tramo._id) return;
  const patch = {};
  ["tipo_custodio","nombre","cargo","desde","hasta","tipo_devolucion","tipo_entrega","observacion_entrega","observacion_devolucion"].forEach(k=>{
    if(k in campos) patch[k] = campos[k] || null;
  });
  const { error } = await sb.from("historial_custodia").update(patch).eq("id", tramo._id);
  if(error) throw error;
  await refrescarDatos();
}

export async function eliminarTramoHistorial(tramoId){
  const { error } = await sb.from("historial_custodia").delete().eq("id", tramoId);
  if(error) throw error;
  await refrescarDatos();
}

export async function darDeBaja(id, motivo){
  const { error } = await sb.rpc("f_dar_baja", { p_activo_id: id, p_motivo: motivo || null });
  if(error) throw error;
  await refrescarDatos();
}

export async function restaurarBaja(indexBaja){
  const bajas = cargarBajas();
  const registro = bajas[indexBaja];
  if(!registro) return;
  const { error } = await sb.rpc("f_restaurar_baja", { p_baja_id: registro.id });
  if(error) throw error;
  await refrescarDatos();
}
