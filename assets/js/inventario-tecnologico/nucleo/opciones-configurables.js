import { sb } from "./config.js";
import { cargarEstadoOpciones, cargarPropiedadOpciones, cargarTiposActivo, refrescarDatos } from "./datos.js";
import { esc } from "./helpers.js";
import { capitalizar } from "../ui/listado/filtros.js";

export async function crearTipoActivo({ nombre, color, icono_svg, campos_pertinentes }){
  if(!nombre || !nombre.trim()) throw new Error("El nombre no puede quedar vacío.");
  const existentes = cargarTiposActivo();
  if(existentes.some(t=>t.nombre.toLowerCase()===nombre.toLowerCase())) throw new Error("Ya existe un tipo con ese nombre.");
  const orden = existentes.length ? Math.max(...existentes.map(t=>t.orden||0)) + 10 : 10;
  const { error } = await sb.from("tipos_activo").insert({
    nombre, color, icono_svg: icono_svg || ICONO_TIPO_GENERICO,
    campos_pertinentes: campos_pertinentes || [], orden,
  });
  if(error) throw error;
  await refrescarDatos();
}

export function slugify(texto){
  return (texto||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
}

export function tintarClaro(hex, factor){
  const n = (hex||"#57697C").replace("#","");
  const r = parseInt(n.substring(0,2),16), g = parseInt(n.substring(2,4),16), b = parseInt(n.substring(4,6),16);
  const mezclar = c => Math.round(c + (255-c)*factor);
  const h2 = c => c.toString(16).padStart(2,"0");
  return "#" + h2(mezclar(r)) + h2(mezclar(g)) + h2(mezclar(b));
}

export async function crearPropiedadOpcion(etiqueta){
  const valor = slugify(etiqueta);
  if(!valor) throw new Error("La etiqueta no puede quedar vacía.");
  const existentes = cargarPropiedadOpciones();
  if(existentes.some(o=>o.valor===valor)) throw new Error("Ya existe una propiedad equivalente a esa etiqueta.");
  const orden = existentes.length ? Math.max(...existentes.map(o=>o.orden||0)) + 10 : 10;
  const { error } = await sb.from("propiedad_opciones").insert({ valor, etiqueta, orden });
  if(error) throw error;
  await refrescarDatos();
}

export async function crearEstadoOpcion(etiqueta, colorFg){
  const valor = slugify(etiqueta);
  if(!valor) throw new Error("La etiqueta no puede quedar vacía.");
  const existentes = cargarEstadoOpciones();
  if(existentes.some(o=>o.valor===valor)) throw new Error("Ya existe un estado equivalente a esa etiqueta.");
  const orden = existentes.length ? Math.max(...existentes.map(o=>o.orden||0)) + 10 : 10;
  const { error } = await sb.from("estado_opciones").insert({
    valor, etiqueta, color_fg: colorFg || "#57697C", color_bg: tintarClaro(colorFg, 0.85), orden,
  });
  if(error) throw error;
  await refrescarDatos();
}

// ---------------------------------------------------------------------------
// Edición y desactivación de tipo/propiedad/estado (Task #24).
//
// Decisión de diseño importante: el "nombre" de un tipo y el "valor" (slug)
// de una propiedad/estado son la clave con la que los activos los referencian
// (ver configTipo(), infoPropiedad(), infoEstado() en este mismo archivo —
// todas buscan por ese campo, no por id). Por eso esa clave se trata como
// INMUTABLE una vez creada: editar solo cambia los atributos de presentación
// (color, ícono, campos pertinentes, etiqueta visible) y nunca la clave —
// así no hay riesgo de dejar activos huérfanos apuntando a un nombre/valor
// que ya no existe. Para "retirar" una opción sin perder la trazabilidad de
// los activos que ya la usaban, se usa desactivar (activo=false) en vez de
// renombrar o borrar: opcionesVigentes() ya se encarga de seguir mostrando
// una opción inactiva en el activo que la tenía asignada, mientras la oculta
// como alternativa nueva para el resto.
// ---------------------------------------------------------------------------

export async function editarTipoActivo(id, { color, icono_svg, campos_pertinentes }){
  const { error } = await sb.from("tipos_activo").update({
    color, icono_svg: icono_svg || ICONO_TIPO_GENERICO, campos_pertinentes: campos_pertinentes || [],
  }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function establecerActivoTipo(id, activo){
  const { error } = await sb.from("tipos_activo").update({ activo }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function editarPropiedadOpcion(id, etiqueta){
  if(!etiqueta || !etiqueta.trim()) throw new Error("La etiqueta no puede quedar vacía.");
  const { error } = await sb.from("propiedad_opciones").update({ etiqueta }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function establecerActivoPropiedadOpcion(id, activo){
  const { error } = await sb.from("propiedad_opciones").update({ activo }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function editarEstadoOpcion(id, etiqueta, colorFg){
  if(!etiqueta || !etiqueta.trim()) throw new Error("La etiqueta no puede quedar vacía.");
  const { error } = await sb.from("estado_opciones").update({
    etiqueta, color_fg: colorFg || "#57697C", color_bg: tintarClaro(colorFg, 0.85),
  }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export async function establecerActivoEstadoOpcion(id, activo){
  const { error } = await sb.from("estado_opciones").update({ activo }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

export const COLOR_PROPIEDAD = {
  lukmar:  { fg:"#3A5068", bg:"#E7ECF1" },
  eq:      { fg:"#1A3756", bg:"#DCE6EC" },
  rentado: { fg:"#B35A17", bg:"#FCE3D0" },
  externo: { fg:"#4A3F73", bg:"#E9E4F3" },
};

export function infoPropiedad(valor){
  const o = cargarPropiedadOpciones().find(p=>p.valor===valor);
  const c = COLOR_PROPIEDAD[valor] || { fg:"#57697C", bg:"#EEF1F4" };
  return { label: o ? o.etiqueta : capitalizar(valor), fg:c.fg, bg:c.bg };
}

export function pillPropiedad(valor){
  const i = infoPropiedad(valor);
  return `<span class="inventario-tecnologico-pill" style="background:${i.bg};color:${i.fg};"><span class="inventario-tecnologico-pill-dot"></span>${esc(i.label)}</span>`;
}

export function infoEstado(valor){
  const o = cargarEstadoOpciones().find(e=>e.valor===valor);
  return o ? { label:o.etiqueta, fg:o.color_fg, bg:o.color_bg } : { label: valor || "—", fg:"#57697C", bg:"#EEF1F4" };
}

export function pillEstado(valor){
  const i = infoEstado(valor);
  return `<span class="inventario-tecnologico-pill" style="background:${i.bg};color:${i.fg};"><span class="inventario-tecnologico-pill-dot"></span>${esc(i.label)}</span>`;
}

export function htmlOpcionesTipo(seleccionado){
  return `<option value="">— Selecciona —</option>` +
    opcionesVigentes(cargarTiposActivo(), seleccionado, "nombre")
      .map(t=>`<option value="${esc(t.nombre)}" ${t.nombre===seleccionado?'selected':''}>${esc(t.nombre)}${t.activo===false?' (inactivo)':''}</option>`).join("");
}

// campoValor: nombre del campo que identifica cada opción — "valor" (slug)
// para propiedad/estado, "nombre" para tipos_activo (ver el comentario sobre
// claves inmutables más abajo, junto a editarTipoActivo).
export function opcionesVigentes(todas, seleccionado, campoValor = "valor"){
  const activas = todas.filter(o=>o.activo!==false);
  if(!seleccionado || activas.some(o=>o[campoValor]===seleccionado)) return activas;
  return [...activas, ...todas.filter(o=>o[campoValor]===seleccionado)];
}

export function htmlOpcionesPropiedad(seleccionado){
  return opcionesVigentes(cargarPropiedadOpciones(), seleccionado)
    .map(o=>`<option value="${esc(o.valor)}" ${o.valor===seleccionado?'selected':''}>${esc(o.etiqueta)}${o.activo===false?' (inactivo)':''}</option>`).join("");
}

export function htmlOpcionesEstado(seleccionado){
  return `<option value="">— Selecciona —</option>` +
    opcionesVigentes(cargarEstadoOpciones(), seleccionado)
      .map(o=>`<option value="${esc(o.valor)}" ${o.valor===seleccionado?'selected':''}>${esc(o.etiqueta)}${o.activo===false?' (inactivo)':''}</option>`).join("");
}

export const ICONO_TIPO_GENERICO = `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5zM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24zM7.5 14.762V6.838L1 4.239v7.923zM7.443.184a1.5 1.5 0 0 1 1.114 0l7.129 2.852A.5.5 0 0 1 16 3.5v8.662a1 1 0 0 1-.629.928l-7.185 2.874a.5.5 0 0 1-.372 0L.63 13.09a1 1 0 0 1-.63-.928V3.5a.5.5 0 0 1 .314-.464z"/></svg>`;

export const COLOR_TIPO_GENERICO = "#8B9AAA";

export const CAMPOS_BLOQUEABLES = ["serie","so","ram_gb","disco_gb","procesador","mac_wifi","mac_ethernet"];

export const CAMPOS_EXTRA = ["color","longitud_m"];

export const LABEL_CAMPO = {
  serie:"Serie", so:"Sistema operativo", ram_gb:"RAM", disco_gb:"Almacenamiento",
  procesador:"Procesador", mac_wifi:"MAC WiFi", mac_ethernet:"MAC Ethernet",
  color:"Color", longitud_m:"Longitud",
};

export function configTipo(tipo){
  return cargarTiposActivo().find(t=>t.nombre===tipo) || null;
}

export function iconoTipo(tipo){
  const t = configTipo(tipo);
  return (t && t.icono_svg) || ICONO_TIPO_GENERICO;
}

export function iconoTipoTam(tipo, tam){
  return iconoTipo(tipo).replace(/width="16" height="16"/, `width="${tam}" height="${tam}"`);
}

export function colorTipo(tipo){
  const t = configTipo(tipo);
  return (t && t.color) || COLOR_TIPO_GENERICO;
}

export function camposPertinentesParaTipo(tipo){
  const t = configTipo(tipo);
  return t ? (t.campos_pertinentes || []) : CAMPOS_BLOQUEABLES;
}

export function camposNoRelevantesParaDetalle(tipo){
  const pertinentes = camposPertinentesParaTipo(tipo);
  return CAMPOS_BLOQUEABLES.filter(c => !pertinentes.includes(c));
}

export function camposExtraParaTipo(tipo){
  const pertinentes = camposPertinentesParaTipo(tipo);
  return CAMPOS_EXTRA.filter(c => pertinentes.includes(c));
}

export const CAMPO_BLOQUEADO_POR_COLUMNA = {
  serie:"serie", so:"so", ram:"ram_gb", disco:"disco_gb",
  procesador:"procesador", macwifi:"mac_wifi", maceth:"mac_ethernet",
};

export const CAMPO_EXTRA_POR_COLUMNA = { color:"color", longitud:"longitud_m" };

export function columnaAplicaATipo(colKey, tipo){
  const bloqueado = CAMPO_BLOQUEADO_POR_COLUMNA[colKey];
  if(bloqueado) return camposPertinentesParaTipo(tipo).includes(bloqueado);
  const extra = CAMPO_EXTRA_POR_COLUMNA[colKey];
  if(extra) return camposExtraParaTipo(tipo).includes(extra);
  return true; // columnas que no dependen del tipo de activo (tag, marca, valor de compra, etc.)
}
