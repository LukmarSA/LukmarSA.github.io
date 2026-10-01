import { sb } from "./config.js";
import { cargarActivos, cargarCamposActivo, cargarEstadoOpciones, cargarPropiedadOpciones, cargarTiposActivo, hayCamposConfigurables, refrescarDatos } from "./datos.js";
import { esc } from "./helpers.js";
import { capitalizar } from "../ui/listado/filtros.js";
import {
  CAMPOS_BLOQUEABLES, CAMPOS_EXTRA, LABEL_CAMPO, PREFIJO_COLUMNA_CAMPO, TIPOS_CON_UNICO,
  aplicaATipo, camposDelTipo, claveDesdeEtiqueta, moverCampo, obligatoriosDelTipo, repetidosActuales, siguienteOrden, validarDefinicion,
} from "./campos-personalizados.js";
import { limpiarSvg } from "./svg-seguro.js";

// Los 7 "de cómputo", los 2 "extra" y sus etiquetas de fábrica viven en
// nucleo/campos-personalizados.js (lógica pura); se reexportan acá para los
// módulos que ya los importaban de este archivo.
export { CAMPOS_BLOQUEABLES, CAMPOS_EXTRA, LABEL_CAMPO };

export const TIPO_CELULAR_NOMBRE = "Celular";

export async function crearTipoActivo({ nombre, color, icono_svg, campos_pertinentes, campos_obligatorios }){
  if(!nombre || !nombre.trim()) throw new Error("El nombre no puede quedar vacío.");
  const existentes = cargarTiposActivo();
  if(existentes.some(t=>t.nombre.trim().toLowerCase()===nombre.trim().toLowerCase())) throw new Error("Ya existe un tipo con ese nombre.");
  const orden = existentes.length ? Math.max(...existentes.map(t=>t.orden||0)) + 10 : 10;
  const fila = {
    nombre: nombre.trim(), color, icono_svg: limpiarSvg(icono_svg) || ICONO_TIPO_GENERICO,
    campos_pertinentes: campos_pertinentes || [], orden,
  };
  // campos_obligatorios existe desde la 012; sin ella no se envía.
  if(hayCamposConfigurables()) fila.campos_obligatorios = (campos_obligatorios || []).filter(k=>fila.campos_pertinentes.includes(k));
  const { error } = await sb.from("tipos_activo").insert(fila);
  if(error) throw error;
  await refrescarDatos();
}

// Cambiar el nombre de un tipo (012). La base lo lleva a los activos (FK con
// ON UPDATE CASCADE) y a las copias de las bajas, en una sola transacción.
// «Celular» no se renombra: ese nombre prende los datos de celular.
export async function renombrarTipoActivo(viejo, nuevo){
  const n = String(nuevo ?? "").trim();
  if(!n) throw new Error("El nombre no puede quedar vacío.");
  if(viejo === TIPO_CELULAR_NOMBRE) throw new Error("«Celular» no se puede renombrar: ese nombre activa los datos de celular.");
  if(n === viejo) return 0;
  if(!hayCamposConfigurables()) throw new Error("Para cambiar el nombre de un tipo hace falta la migración 012.");
  if(cargarTiposActivo().some(t=>t.nombre !== viejo && t.nombre.trim().toLowerCase() === n.toLowerCase())) throw new Error("Ya existe un tipo con ese nombre.");
  const { data, error } = await sb.rpc("renombrar_tipo_activo", { p_viejo: viejo, p_nuevo: n });
  if(error) throw error;
  return data;
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

// Las tres tablas no tienen columna "id": la clave de tipos_activo es
// "nombre" y la de propiedad_opciones y estado_opciones es "valor" (leído en
// vivo el 30-sep-2026). Hasta el v9 estas funciones filtraban por un "id" que
// no existe, así que «Editar» y «Desactivar» fallaban en la base real.
// .select() después del update: si RLS no deja cambiar la fila, la respuesta
// viene vacía (sin error), y eso también se avisa.
async function actualizarOpcion(tabla, columnaClave, clave, parche, queHizo){
  if(clave === null || clave === undefined || clave === "") throw new Error(`No se sabe qué ${queHizo} guardar.`);
  const { data, error } = await sb.from(tabla).update(parche).eq(columnaClave, clave).select(columnaClave);
  if(error) throw error;
  if(!data || !data.length) throw new Error(`No se guardó ${queHizo}: no se encontró o no tienes permiso para cambiarlo.`);
  await refrescarDatos();
}

export async function editarTipoActivo(nombre, { color, icono_svg, campos_pertinentes, campos_obligatorios }){
  const parche = { color, icono_svg: icono_svg || ICONO_TIPO_GENERICO, campos_pertinentes: campos_pertinentes || [] };
  // campos_obligatorios existe desde la 012; sin ella no se envía.
  if(campos_obligatorios !== undefined && hayCamposConfigurables()) parche.campos_obligatorios = campos_obligatorios;
  await actualizarOpcion("tipos_activo", "nombre", nombre, parche, "el tipo");
}

export async function establecerActivoTipo(nombre, activo){
  await actualizarOpcion("tipos_activo", "nombre", nombre, { activo }, "el tipo");
}

export async function editarPropiedadOpcion(valor, etiqueta){
  if(!etiqueta || !etiqueta.trim()) throw new Error("La etiqueta no puede quedar vacía.");
  await actualizarOpcion("propiedad_opciones", "valor", valor, { etiqueta }, "la propiedad");
}

export async function establecerActivoPropiedadOpcion(valor, activo){
  await actualizarOpcion("propiedad_opciones", "valor", valor, { activo }, "la propiedad");
}

export async function editarEstadoOpcion(valor, etiqueta, colorFg){
  if(!etiqueta || !etiqueta.trim()) throw new Error("La etiqueta no puede quedar vacía.");
  await actualizarOpcion("estado_opciones", "valor", valor, {
    etiqueta, color_fg: colorFg || "#57697C", color_bg: tintarClaro(colorFg, 0.85),
  }, "el estado");
}

export async function establecerActivoEstadoOpcion(valor, activo){
  await actualizarOpcion("estado_opciones", "valor", valor, { activo }, "el estado");
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
  if(String(colKey).startsWith(PREFIJO_COLUMNA_CAMPO)){
    const def = campoPorClave(String(colKey).slice(PREFIJO_COLUMNA_CAMPO.length));
    return aplicaATipo(def, configTipo(tipo));
  }
  const bloqueado = CAMPO_BLOQUEADO_POR_COLUMNA[colKey];
  if(bloqueado) return camposPertinentesParaTipo(tipo).includes(bloqueado);
  const extra = CAMPO_EXTRA_POR_COLUMNA[colKey];
  if(extra) return camposExtraParaTipo(tipo).includes(extra);
  return true; // columnas que no dependen del tipo de activo (tag, marca, valor de compra, etc.)
}

// ---------------------------------------------------------------------------
// v10 — campos configurables (migración 012). Las definiciones las carga
// nucleo/datos.js; sin la 012 son los 9 fijos.
// ---------------------------------------------------------------------------
// (PREFIJO_COLUMNA_CAMPO viene de campos-personalizados.js.)
export { PREFIJO_COLUMNA_CAMPO };

export function campoPorClave(clave){
  return cargarCamposActivo().find(d=>d.clave === clave) || null;
}

// Etiqueta vigente de un campo (la configurada o la de fábrica).
export function etiquetaCampo(clave){
  const d = campoPorClave(clave);
  return d ? d.etiqueta : (LABEL_CAMPO[clave] || clave);
}

// Los campos que ve un tipo, en el orden global.
export function camposDeTipo(tipo){
  return camposDelTipo(cargarCamposActivo(), configTipo(tipo));
}

export function obligatoriosDeTipo(tipo){
  return obligatoriosDelTipo(configTipo(tipo));
}

// Los campos nuevos (no fijos) que están activos: columnas opcionales de la
// tabla, Excel, búsqueda.
export function camposNuevosActivos(){
  return cargarCamposActivo().filter(d=>!d.fijo && d.activo);
}

async function exigirFila(consulta, queHizo){
  const { data, error } = await consulta;
  if(error) throw error;
  if(!data || (Array.isArray(data) && !data.length)) throw new Error(`No se guardó ${queHizo}: no se encontró o no tienes permiso para cambiarlo.`);
  return data;
}

function filaDeCampo(def){
  const fila = {
    etiqueta: String(def.etiqueta).trim(),
    unidad: def.tipo_dato === "numero" && def.unidad && String(def.unidad).trim() ? String(def.unidad).trim() : null,
    opciones: def.tipo_dato === "lista" ? (def.opciones || []).map(o=>({ valor: o.valor, etiqueta: String(o.etiqueta).trim(), activo: o.activo !== false })) : [],
    unico: !!def.unico && TIPOS_CON_UNICO.has(def.tipo_dato),
    en_acta: !!def.en_acta,
  };
  return fila;
}

export async function crearCampoActivo(def){
  if(!hayCamposConfigurables()) throw new Error("Para crear campos hace falta la migración 012.");
  const existentes = cargarCamposActivo();
  const v = validarDefinicion(def, existentes);
  if(!v.ok) throw new Error(v.errores.join(" "));
  const clave = claveDesdeEtiqueta(def.etiqueta, existentes);
  const fila = { clave, tipo_dato: def.tipo_dato, ...filaDeCampo(def), orden: siguienteOrden(existentes) };
  await exigirFila(sb.from("campos_activo").insert(fila).select("clave"), "el campo");
  await refrescarDatos();
  return clave;
}

export async function editarCampoActivo(clave, def){
  const actual = campoPorClave(clave);
  if(!actual) throw new Error("Ese campo ya no existe. Recarga la página.");
  const v = validarDefinicion({ ...def, tipo_dato: actual.fijo ? actual.tipo_dato : def.tipo_dato }, cargarCamposActivo(), { claveActual: clave });
  if(!v.ok) throw new Error(v.errores.join(" "));
  const parche = filaDeCampo({ ...def, tipo_dato: actual.fijo ? actual.tipo_dato : def.tipo_dato });
  if(actual.fijo){ delete parche.opciones; if(actual.tipo_dato !== "numero") delete parche.unidad; }
  if(!actual.fijo && def.tipo_dato && def.tipo_dato !== actual.tipo_dato){
    // Cambiar el tipo de dato solo si ningún activo tiene todavía un valor.
    if(cargarActivos().activos.some(a=>a.personalizados && a.personalizados[clave] !== undefined && a.personalizados[clave] !== null)){
      throw new Error("No se puede cambiar el tipo de dato: ya hay activos con un valor en este campo.");
    }
    parche.tipo_dato = def.tipo_dato;
  }
  if(parche.unico && !actual.unico){
    const rep = repetidosActuales({ ...actual, ...parche }, cargarActivos().activos);
    if(rep.length) throw new Error(`No se puede marcar como único: ya hay valores repetidos (${rep.length === 1 ? "un grupo" : `${rep.length} grupos`}).`);
  }
  await exigirFila(sb.from("campos_activo").update(parche).eq("clave", clave).select("clave"), "el campo");
  await refrescarDatos();
}

export async function establecerActivoCampo(clave, activo){
  const actual = campoPorClave(clave);
  if(actual && actual.fijo) throw new Error("Los campos de siempre no se desactivan: cada tipo elige si los usa.");
  await exigirFila(sb.from("campos_activo").update({ activo: !!activo }).eq("clave", clave).select("clave"), "el campo");
  await refrescarDatos();
}

export async function moverCampoActivo(clave, direccion){
  const cambios = moverCampo(cargarCamposActivo(), clave, direccion);
  for(const c of cambios) await exigirFila(sb.from("campos_activo").update({ orden: c.orden }).eq("clave", c.clave).select("clave"), "el orden");
  if(cambios.length) await refrescarDatos();
  return cambios.length > 0;
}
