// Formulario del tipo de activo (v10): nombre, color, ícono y qué campos usa,
// con cuáles son obligatorios (012). Lo comparten Configuración → Tipos y
// opciones (en un modal) y el formulario del activo (el «+» y el «✎» de Tipo,
// en un submodal que no borra lo que ya se escribió).
//
// p = prefijo de los id ("ct" en Configuración, "nt" en el formulario del
// activo), así las pruebas y el CSS de siempre siguen valiendo.
import { sb } from "../../nucleo/config.js";
import { cargarActivos, cargarCamposActivo, hayCamposConfigurables, refrescarDatos } from "../../nucleo/datos.js";
import { esc } from "../../nucleo/helpers.js";
import { CAMPOS_BLOQUEABLES, TIPOS_CON_UNICO, TIPOS_DATO, etiquetaConUnidad, ordenarCampos, valorDeOpcion } from "../../nucleo/campos-personalizados.js";
import { TIPO_CELULAR_NOMBRE, crearCampoActivo, crearTipoActivo, editarTipoActivo, renombrarTipoActivo } from "../../nucleo/opciones-configurables.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { tipoEquipoDeActivo } from "../../nucleo/selector-servidor.js";
import { validarSvg } from "../../nucleo/svg-seguro.js";

const P = "inventario-tecnologico-";
// Para selectores de atributo: las claves ya son [a-z0-9_], pero por las dudas.
const enComillas = k=>String(k).replace(/["\\]/g, "\\$&");

// Los tipos de equipo de red (007), para avisar si al renombrar un tipo de
// activo deja de emparejar con uno (y sus activos dejan de ofrecerse como
// servidor en el mapa). Se leen una vez; sin la 007, no hay aviso.
let tiposEquipoRed = null;
async function cargarTiposEquipoRed(){
  if(tiposEquipoRed) return tiposEquipoRed;
  try{
    const { data, error } = await sb.from("tipos_equipo_red").select("valor, etiqueta, activo");
    tiposEquipoRed = error ? [] : (data || []);
  }catch(e){ tiposEquipoRed = []; }
  return tiposEquipoRed;
}

function filaCampo(p, d, usa, obligatorio, conObligatorio){
  const casilla = `<label class="${P}nt-usa"><input type="checkbox" data-usa value="${esc(d.clave)}" ${usa ? "checked" : ""}> ${esc(etiquetaConUnidad(d))}</label>`;
  if(!conObligatorio) return casilla;
  return `<div class="${P}nt-campo" data-campo-fila="${esc(d.clave)}">${casilla}<label class="${P}nt-obl" title="Obligatorio en este tipo"><input type="checkbox" data-obligatorio="${esc(d.clave)}" ${obligatorio && usa ? "checked" : ""} ${usa ? "" : "disabled"}> obligatorio</label></div>`;
}

function htmlCampos(p, marcados, obligatorios){
  const conObligatorio = hayCamposConfigurables();
  const defs = ordenarCampos(cargarCamposActivo().filter(d=>d.activo));
  return defs.map(d=>filaCampo(p, d, marcados.has(d.clave), obligatorios.has(d.clave), conObligatorio)).join("");
}

function htmlMiniCampo(p){
  return `<div class="${P}nt-nuevo-campo" id="${P}${p}-mini-campo" hidden>
    <div class="${P}form-grid">
      <div class="${P}field"><label for="${P}${p}-nc-etiqueta">Nombre del campo</label><input type="text" id="${P}${p}-nc-etiqueta" maxlength="60" placeholder="Ej: IMEI" autocomplete="off"></div>
      <div class="${P}field"><label for="${P}${p}-nc-tipo">Tipo de dato</label><select id="${P}${p}-nc-tipo">${TIPOS_DATO.map(t=>`<option value="${t.id}">${esc(t.etiqueta)}</option>`).join("")}</select></div>
      <div class="${P}field" data-nc-si="numero" hidden><label for="${P}${p}-nc-unidad">Unidad <span class="${P}cell-muted">(opcional)</span></label><input type="text" id="${P}${p}-nc-unidad" maxlength="12" placeholder="Ej: GB, m, VA"></div>
      <div class="${P}field ${P}span-2" data-nc-si="lista" hidden><label for="${P}${p}-nc-opciones">Opciones (una por línea)</label><textarea id="${P}${p}-nc-opciones" rows="3" placeholder="Ej:&#10;Claro&#10;Movistar&#10;CNT"></textarea></div>
      <div class="${P}field ${P}span-2 ${P}nt-nc-marcas">
        <label data-nc-si="texto numero"><input type="checkbox" id="${P}${p}-nc-unico"> Único entre activos (no se puede repetir)</label>
        <label><input type="checkbox" id="${P}${p}-nc-acta"> Aparece en el acta de entrega</label>
      </div>
    </div>
    <div class="${P}nt-nc-botones">
      <button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" id="${P}${p}-nc-crear">Crear campo</button>
      <button type="button" class="${P}btn ${P}btn-sm" id="${P}${p}-nc-cancelar">Cancelar</button>
    </div>
    <div class="${P}field-error" id="${P}${p}-nc-error" role="alert"></div>
  </div>`;
}

// HTML de la grilla del formulario. t = la fila del tipo (editar) o null (crear).
export function htmlFormTipo(p, t){
  const editando = !!t;
  const marcados = new Set(editando ? (t.campos_pertinentes || []) : CAMPOS_BLOQUEABLES);
  const obligatorios = new Set(editando ? (t.campos_obligatorios || []) : []);
  const renombrable = editando && hayCamposConfigurables() && t.nombre !== TIPO_CELULAR_NOMBRE;
  const nActivos = editando ? cargarActivos().activos.filter(a=>a.tipo === t.nombre).length : 0;
  const ayudaNombre = !editando ? ""
    : t.nombre === TIPO_CELULAR_NOMBRE ? "«Celular» no se puede renombrar: ese nombre activa los datos de celular."
    : !hayCamposConfigurables() ? "Para cambiar el nombre hace falta la migración 012. Mientras, si ya no aplica, desactívalo y crea otro."
    : `Si cambias el nombre, la base lo cambia también en ${nActivos === 1 ? "el activo" : `los ${nActivos} activos`} de este tipo y en las bajas.`;
  return `<div class="${P}form-grid">
      <div class="${P}field">
        <label for="${P}${p}-nombre">Nombre</label>
        <input type="text" id="${P}${p}-nombre" value="${editando ? esc(t.nombre) : ""}" ${editando && !renombrable ? "disabled" : ""} placeholder="Ej: Cámara IP" autocomplete="off" maxlength="60">
        ${ayudaNombre ? `<div class="${P}hint" id="${P}${p}-nombre-ayuda">${esc(ayudaNombre)}</div>` : ""}
        <div class="${P}hint ${P}nt-aviso" id="${P}${p}-nombre-aviso" hidden></div>
      </div>
      <div class="${P}field"><label for="${P}${p}-color">Color</label><input type="color" id="${P}${p}-color" value="${editando ? esc(t.color || "#57697C") : "#57697C"}"></div>
      <div class="${P}field ${P}span-2"><label for="${P}${p}-icono">Ícono (SVG, opcional)</label><textarea id="${P}${p}-icono" class="${P}mono" placeholder="Pega acá el &lt;svg&gt;...&lt;/svg&gt; de un ícono (ej. de icons.getbootstrap.com). Si se deja vacío, se usa un ícono genérico.">${editando && t.icono_svg ? esc(t.icono_svg) : ""}</textarea></div>
      <div class="${P}field ${P}span-2">
        <span class="${P}field-titulo" id="${P}${p}-campos-titulo">Campos de este tipo${hayCamposConfigurables() ? " (y cuáles son obligatorios)" : ""}</span>
        <div id="${P}${p}-campos" class="${P}nt-campos${hayCamposConfigurables() ? ` ${P}nt-campos-obl` : ""}" role="group" aria-labelledby="${P}${p}-campos-titulo">
          ${htmlCampos(p, marcados, obligatorios)}
        </div>
        <div class="${P}hint">Marcados por defecto los campos "de cómputo" (serie, SO, RAM, etc.) — desmárcalos si no aplican a este tipo (ej. un cable o una fuente de alimentación).</div>
        ${esAdmin() && hayCamposConfigurables() ? `<button type="button" class="${P}btn ${P}btn-sm ${P}nt-boton-nuevo-campo" id="${P}${p}-nuevo-campo">+ Nuevo campo</button>${htmlMiniCampo(p)}` : ""}
      </div>
    </div>`;
}

// Cablea el formulario ya montado en raiz. Devuelve { leer } para guardarlo.
export function montarFormTipo(raiz, p, t){
  const $ = sel=>raiz.querySelector(sel);
  const contCampos = $(`#${P}${p}-campos`);

  // «obligatorio» solo si el tipo usa el campo.
  const enlazarObligatorios = ()=>{
    contCampos.querySelectorAll("input[data-usa]").forEach(cb=>{
      cb.addEventListener("change", ()=>{
        const obl = contCampos.querySelector(`input[data-obligatorio="${enComillas(cb.value)}"]`);
        if(!obl) return;
        obl.disabled = !cb.checked;
        if(!cb.checked) obl.checked = false;
      });
    });
  };
  enlazarObligatorios();

  // Aviso al renombrar: si hoy empareja con un tipo de equipo de red y con el
  // nombre nuevo ya no, sus activos dejan de ofrecerse como servidor.
  const inNombre = $(`#${P}${p}-nombre`);
  const aviso = $(`#${P}${p}-nombre-aviso`);
  if(t && inNombre && !inNombre.disabled && aviso){
    const revisar = async ()=>{
      const nuevo = inNombre.value.trim();
      if(!nuevo || nuevo === t.nombre){ aviso.hidden = true; return; }
      const tipos = await cargarTiposEquipoRed();
      const antes = tipoEquipoDeActivo(t.nombre, tipos);
      const despues = tipoEquipoDeActivo(nuevo, tipos);
      if(antes && antes !== despues){
        const et = (tipos.find(x=>x.valor === antes) || {}).etiqueta || antes;
        aviso.textContent = `⚠ «${t.nombre}» coincide con el tipo de equipo de red «${et}»: sus activos se ofrecen como servidor en el mapa. Con «${nuevo}», ya no${despues ? ` (coincidiría con otro tipo de equipo)` : ""}.`;
        aviso.hidden = false;
      } else aviso.hidden = true;
    };
    inNombre.addEventListener("input", revisar);
  }

  // «+ Nuevo campo»: un mini formulario dentro del mismo modal (no se abre
  // otro encima, así no se pierde lo que ya se marcó).
  const botonNuevo = $(`#${P}${p}-nuevo-campo`);
  const mini = $(`#${P}${p}-mini-campo`);
  if(botonNuevo && mini){
    const selTipo = $(`#${P}${p}-nc-tipo`);
    const error = $(`#${P}${p}-nc-error`);
    const pintarSegunTipo = ()=>{
      mini.querySelectorAll("[data-nc-si]").forEach(el=>{ el.hidden = !el.dataset.ncSi.split(" ").includes(selTipo.value); });
      if(!TIPOS_CON_UNICO.has(selTipo.value)) $(`#${P}${p}-nc-unico`).checked = false;
    };
    selTipo.addEventListener("change", pintarSegunTipo);
    pintarSegunTipo();
    const cerrar = ()=>{ mini.hidden = true; error.textContent = ""; botonNuevo.hidden = false; botonNuevo.focus(); };
    botonNuevo.addEventListener("click", ()=>{ mini.hidden = false; botonNuevo.hidden = true; $(`#${P}${p}-nc-etiqueta`).focus(); });
    $(`#${P}${p}-nc-cancelar`).addEventListener("click", cerrar);
    const crear = async ()=>{
      error.textContent = "";
      const tipo_dato = selTipo.value;
      const opciones = [];
      for(const linea of $(`#${P}${p}-nc-opciones`).value.split("\n")){
        const etiqueta = linea.trim();
        if(etiqueta) opciones.push({ valor: valorDeOpcion(etiqueta, opciones), etiqueta, activo: true });
      }
      const def = {
        etiqueta: $(`#${P}${p}-nc-etiqueta`).value, tipo_dato,
        unidad: $(`#${P}${p}-nc-unidad`).value, opciones,
        unico: $(`#${P}${p}-nc-unico`).checked, en_acta: $(`#${P}${p}-nc-acta`).checked,
      };
      const boton = $(`#${P}${p}-nc-crear`);
      boton.disabled = true; boton.textContent = "Creando…";
      try{
        // Lo que ya se marcó se conserva al repintar la lista.
        const marcados = new Set([...contCampos.querySelectorAll("input[data-usa]:checked")].map(cb=>cb.value));
        const obligatorios = new Set([...contCampos.querySelectorAll("input[data-obligatorio]:checked")].map(cb=>cb.dataset.obligatorio));
        const clave = await crearCampoActivo(def);
        marcados.add(clave);
        contCampos.innerHTML = htmlCampos(p, marcados, obligatorios);
        enlazarObligatorios();
        for(const id of ["etiqueta", "unidad", "opciones"]) $(`#${P}${p}-nc-${id}`).value = "";
        $(`#${P}${p}-nc-unico`).checked = false; $(`#${P}${p}-nc-acta`).checked = false;
        cerrar();
        const nueva = contCampos.querySelector(`input[data-usa][value="${enComillas(clave)}"]`);
        if(nueva) nueva.focus();
      }catch(err){
        error.textContent = err.message;
      }finally{
        boton.disabled = false; boton.textContent = "Crear campo";
      }
    };
    $(`#${P}${p}-nc-crear`).addEventListener("click", crear);
    // Enter dentro del mini formulario crea el campo, no envía el formulario del tipo.
    mini.addEventListener("keydown", e=>{
      if(e.key === "Enter" && e.target.tagName !== "TEXTAREA"){ e.preventDefault(); e.stopPropagation(); crear(); }
    });
  }

  // Lee y valida lo escrito. Lanza Error con un mensaje para la persona.
  function leer(){
    const nombre = inNombre ? inNombre.value.trim() : (t ? t.nombre : "");
    if(!nombre) throw Object.assign(new Error(t ? "El nombre no puede quedar vacío." : "Ingresa el nombre del nuevo tipo."), { campo: inNombre });
    const icono = validarSvg($(`#${P}${p}-icono`).value, { exigir16: true });
    if(!icono.ok) throw Object.assign(new Error(icono.error), { campo: $(`#${P}${p}-icono`) });
    const visibles = new Set([...contCampos.querySelectorAll("input[data-usa]")].map(cb=>cb.value));
    const usados = [...contCampos.querySelectorAll("input[data-usa]:checked")].map(cb=>cb.value);
    // Lo que el tipo ya tenía y no se muestra acá (un campo desactivado) se conserva.
    const conservados = t ? (t.campos_pertinentes || []).filter(k=>!visibles.has(k)) : [];
    const campos_pertinentes = [...usados, ...conservados];
    const obligatoriosMarcados = [...contCampos.querySelectorAll("input[data-obligatorio]:checked")].map(cb=>cb.dataset.obligatorio);
    const obligatoriosConservados = t ? (t.campos_obligatorios || []).filter(k=>!visibles.has(k) && campos_pertinentes.includes(k)) : [];
    return {
      nombre, color: $(`#${P}${p}-color`).value, icono_svg: icono.svg,
      campos_pertinentes,
      campos_obligatorios: [...obligatoriosMarcados, ...obligatoriosConservados],
    };
  }
  return { leer };
}

// Crea o guarda el tipo. Devuelve el nombre con el que quedó.
export async function guardarFormTipo(t, datos){
  if(!t){
    await crearTipoActivo(datos);
    return datos.nombre;
  }
  let nombre = t.nombre;
  if(datos.nombre && datos.nombre !== t.nombre){
    await renombrarTipoActivo(t.nombre, datos.nombre);
    nombre = datos.nombre;
  }
  try{
    await editarTipoActivo(nombre, datos);
  }catch(err){
    // Si el nombre ya cambió y lo demás no se pudo guardar, igual se recarga
    // (para no seguir mostrando el nombre viejo).
    if(nombre !== t.nombre) await refrescarDatos().catch(()=>{});
    throw err;
  }
  return nombre;
}
