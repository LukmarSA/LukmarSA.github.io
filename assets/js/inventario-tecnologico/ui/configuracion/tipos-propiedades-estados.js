// Configuración → Tipos y opciones: tipos de activo, campos de los activos
// (v10), propiedades, estados y tipos de ubicación (v10). Crear, editar y
// desactivar/reactivar; los campos, además, se ordenan.
//
// Claves: tipos_activo se identifica por "nombre"; propiedad_opciones,
// estado_opciones y tipos_ubicacion por "valor"; campos_activo por "clave".
// Ninguna de esas tablas tiene "id" (hasta el v9 esta pantalla buscaba uno y
// por eso «Editar» y «Desactivar» no funcionaban en la base real).
//
// El valor interno de propiedades, estados y tipos de ubicación no cambia
// (es lo que guardan los activos y las ubicaciones). El nombre de un tipo de
// activo sí, desde la migración 012: la base lo lleva a los activos.
import { cargarCamposActivo, cargarEstadoOpciones, cargarPropiedadOpciones, cargarTiposActivo, hayCamposConfigurables } from "../../nucleo/datos.js";
import { cargarTiposUbicacion, refrescarTiposUbicacion } from "../../nucleo/datos-mapa.js";
import { esc } from "../../nucleo/helpers.js";
import { TIPOS_CON_UNICO, TIPOS_DATO, etiquetaTipoDato, ordenarCampos, valorDeOpcion } from "../../nucleo/campos-personalizados.js";
import {
  crearCampoActivo, crearEstadoOpcion, crearPropiedadOpcion,
  editarCampoActivo, editarEstadoOpcion, editarPropiedadOpcion,
  establecerActivoCampo, establecerActivoEstadoOpcion, establecerActivoPropiedadOpcion, establecerActivoTipo,
  iconoTipoTam, moverCampoActivo,
} from "../../nucleo/opciones-configurables.js";
import { validarSvg } from "../../nucleo/svg-seguro.js";
import { crearTipoUbicacion, editarTipoUbicacion } from "../../negocio/operaciones-mapa.js";
import { htmlPin } from "../mapa/leaflet.js";
import { guardarFormTipo, htmlFormTipo, montarFormTipo } from "./form-tipo.js";
import { abrirModal, cerrarModal, mostrarToast } from "../render-raiz.js";

const P = "inventario-tecnologico-";

function pillEstadoActivo(activo){
  return activo===false
    ? `<span style="color:var(--ink-faint);font-size:13px;">○ Inactivo</span>`
    : `<span style="color:var(--good);font-size:13px;">● Activo</span>`;
}

function encabezadoSeccion(titulo, idBotonNuevo, textoBotonNuevo){
  return `<div style="display:flex;align-items:center;gap:8px;">
    <div class="inventario-tecnologico-section-title" style="margin:0;flex:1;">${titulo}</div>
    ${idBotonNuevo ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary inventario-tecnologico-btn-sm" id="${idBotonNuevo}">+ ${textoBotonNuevo}</button>` : ""}
  </div>`;
}

const buscarPor = (lista, campo, valor)=>lista.find(x=>String(x[campo]) === String(valor));

export function renderConfigOpciones(content){
  const tipos = cargarTiposActivo();
  const propiedades = cargarPropiedadOpciones();
  const estados = cargarEstadoOpciones();
  const hay012 = hayCamposConfigurables();
  const campos = ordenarCampos(cargarCamposActivo());
  content.innerHTML = `
    <div class="inventario-tecnologico-alert inventario-tecnologico-alert-info">Desactivar una opción no borra nada ni afecta a los activos que ya la tengan asignada — solo deja de ofrecerla para activos nuevos o al reasignar. El valor interno de propiedades, estados y tipos de ubicación no cambia una vez creado; ${hay012 ? "el nombre de un tipo de activo sí se puede cambiar (la base lo cambia también en sus activos)." : "si ya no aplica, desactívala y crea una nueva."}</div>

    ${encabezadoSeccion("Tipos de activo", "inventario-tecnologico-btn-nuevo-tipo-cfg", "Nuevo tipo")}
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;">
      <table>
        <thead><tr><th></th><th>Nombre</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${tipos.map(t=>`<tr data-fila-tipo="${esc(t.nombre)}">
            <td style="color:${esc(t.color||'#8B9AAA')};width:28px;">${iconoTipoTam(t.nombre, 18)}</td>
            <td>${esc(t.nombre)}</td>
            <td>${pillEstadoActivo(t.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-tipo="${esc(t.nombre)}">Editar</button>
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-tipo="${esc(t.nombre)}">${t.activo===false?'Activar':'Desactivar'}</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${tipos.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Todavía no hay tipos de activo configurados.</div>` : ""}
    </div>

    ${encabezadoSeccion("Campos de los activos", hay012 ? "inventario-tecnologico-btn-nuevo-campo-cfg" : null, "Nuevo campo")}
    ${hay012 ? `
    <div class="inventario-tecnologico-hint" style="margin:6px 0 0;">Un solo orden para todos los tipos (con las flechas). Cada tipo elige cuáles usa y cuáles son obligatorios, en su «Editar». Los 9 de siempre son columnas de la tabla de activos: se les cambia la etiqueta y las reglas, pero no se borran.</div>
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;">
      <table class="${P}tabla-campos">
        <thead><tr><th>Orden</th><th>Campo</th><th>Tipo de dato</th><th>Reglas</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${campos.map((d, i)=>`<tr data-fila-campo="${esc(d.clave)}">
            <td class="${P}campo-orden">
              <button class="${P}btn ${P}btn-sm" data-mover-campo="${esc(d.clave)}" data-dir="arriba" ${i === 0 ? "disabled" : ""} aria-label="Subir «${esc(d.etiqueta)}»" title="Subir">↑</button>
              <button class="${P}btn ${P}btn-sm" data-mover-campo="${esc(d.clave)}" data-dir="abajo" ${i === campos.length - 1 ? "disabled" : ""} aria-label="Bajar «${esc(d.etiqueta)}»" title="Bajar">↓</button>
            </td>
            <td>${esc(d.etiqueta)}${d.fijo ? ` <span class="${P}cell-muted">(de siempre)</span>` : ""}<div class="${P}cell-muted ${P}mono" style="font-size:11px;">${esc(d.clave)}</div></td>
            <td>${esc(etiquetaTipoDato(d.tipo_dato))}${d.unidad ? ` (${esc(d.unidad)})` : ""}${d.tipo_dato === "lista" ? ` · ${d.opciones.filter(o=>o.activo).length} opciones` : ""}</td>
            <td>${[d.unico ? "Único" : "", d.en_acta ? "En el acta" : ""].filter(Boolean).join(" · ") || `<span class="${P}cell-muted">—</span>`}</td>
            <td>${pillEstadoActivo(d.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-campo="${esc(d.clave)}">Editar</button>
              ${d.fijo ? "" : `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-campo="${esc(d.clave)}">${d.activo ? "Desactivar" : "Activar"}</button>`}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>` : `<div class="inventario-tecnologico-alert inventario-tecnologico-alert-info" style="margin:10px 0 20px;">Para crear campos propios (IMEI, número de línea, capacidad…) hace falta aplicar la migración 012. Mientras, los activos tienen los 9 campos de siempre.</div>`}

    ${encabezadoSeccion("Propiedades", "inventario-tecnologico-btn-nueva-propiedad-cfg", "Nueva propiedad")}
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;">
      <table>
        <thead><tr><th>Etiqueta</th><th>Valor interno</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${propiedades.map(o=>`<tr data-fila-propiedad="${esc(o.valor)}">
            <td>${esc(o.etiqueta)}</td>
            <td class="inventario-tecnologico-cell-muted inventario-tecnologico-mono">${esc(o.valor)}</td>
            <td>${pillEstadoActivo(o.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-propiedad="${esc(o.valor)}">Editar</button>
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-propiedad="${esc(o.valor)}">${o.activo===false?'Activar':'Desactivar'}</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${propiedades.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Todavía no hay propiedades configuradas.</div>` : ""}
    </div>

    ${encabezadoSeccion("Estados", "inventario-tecnologico-btn-nuevo-estado-cfg", "Nuevo estado")}
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;">
      <table>
        <thead><tr><th>Etiqueta</th><th>Valor interno</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${estados.map(o=>`<tr data-fila-estado="${esc(o.valor)}">
            <td><span class="inventario-tecnologico-pill" style="background:${esc(o.color_bg||'#EEF1F4')};color:${esc(o.color_fg||'#57697C')};"><span class="inventario-tecnologico-pill-dot"></span>${esc(o.etiqueta)}</span></td>
            <td class="inventario-tecnologico-cell-muted inventario-tecnologico-mono">${esc(o.valor)}</td>
            <td>${pillEstadoActivo(o.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-estado="${esc(o.valor)}">Editar</button>
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-estado="${esc(o.valor)}">${o.activo===false?'Activar':'Desactivar'}</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${estados.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Todavía no hay estados configurados.</div>` : ""}
    </div>

    ${encabezadoSeccion("Tipos de ubicación (mapa)", "inventario-tecnologico-btn-nuevo-tipo-ubicacion-cfg", "Nuevo tipo")}
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;" id="${P}cfg-tipos-ubicacion"><div class="${P}cell-muted" style="padding:10px;">Cargando tipos de ubicación…</div></div>`;

  // ---------- Tipos ----------
  document.getElementById("inventario-tecnologico-btn-nuevo-tipo-cfg").addEventListener("click", ()=>abrirFormTipo(content, null));
  content.querySelectorAll("[data-editar-tipo]").forEach(b=>b.addEventListener("click", ()=>{
    const t = buscarPor(tipos, "nombre", b.dataset.editarTipo);
    if(t) abrirFormTipo(content, t);
  }));
  content.querySelectorAll("[data-toggle-tipo]").forEach(b=>b.addEventListener("click", async ()=>{
    const t = buscarPor(tipos, "nombre", b.dataset.toggleTipo);
    if(!t) return;
    const activar = t.activo===false;
    try{
      await establecerActivoTipo(t.nombre, activar);
      mostrarToast(activar ? "Tipo reactivado." : "Tipo desactivado.", "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar el tipo: " + err.message, "error"); }
  }));

  // ---------- Campos (012) ----------
  const botonNuevoCampo = document.getElementById("inventario-tecnologico-btn-nuevo-campo-cfg");
  if(botonNuevoCampo) botonNuevoCampo.addEventListener("click", ()=>abrirFormCampo(content, null));
  content.querySelectorAll("[data-editar-campo]").forEach(b=>b.addEventListener("click", ()=>{
    const d = buscarPor(campos, "clave", b.dataset.editarCampo);
    if(d) abrirFormCampo(content, d);
  }));
  content.querySelectorAll("[data-toggle-campo]").forEach(b=>b.addEventListener("click", async ()=>{
    const d = buscarPor(campos, "clave", b.dataset.toggleCampo);
    if(!d) return;
    try{
      await establecerActivoCampo(d.clave, !d.activo);
      mostrarToast(d.activo ? `Campo «${d.etiqueta}» desactivado: sus valores se conservan.` : `Campo «${d.etiqueta}» reactivado.`, "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar el campo: " + err.message, "error"); }
  }));
  content.querySelectorAll("[data-mover-campo]").forEach(b=>b.addEventListener("click", async ()=>{
    const clave = b.dataset.moverCampo, dir = b.dataset.dir;
    b.disabled = true;
    try{
      await moverCampoActivo(clave, dir);
      renderConfigOpciones(content);
      // El foco sigue en la misma flecha del campo que se movió.
      const igual = content.querySelector(`[data-mover-campo="${clave}"][data-dir="${dir}"]`);
      const otra = content.querySelector(`[data-mover-campo="${clave}"]:not([disabled])`);
      (igual && !igual.disabled ? igual : otra)?.focus();
    }catch(err){ b.disabled = false; mostrarToast("No se pudo cambiar el orden: " + err.message, "error"); }
  }));

  // ---------- Propiedades ----------
  document.getElementById("inventario-tecnologico-btn-nueva-propiedad-cfg").addEventListener("click", ()=>abrirFormPropiedad(content, null));
  content.querySelectorAll("[data-editar-propiedad]").forEach(b=>b.addEventListener("click", ()=>{
    const o = buscarPor(propiedades, "valor", b.dataset.editarPropiedad);
    if(o) abrirFormPropiedad(content, o);
  }));
  content.querySelectorAll("[data-toggle-propiedad]").forEach(b=>b.addEventListener("click", async ()=>{
    const o = buscarPor(propiedades, "valor", b.dataset.togglePropiedad);
    if(!o) return;
    const activar = o.activo===false;
    try{
      await establecerActivoPropiedadOpcion(o.valor, activar);
      mostrarToast(activar ? "Propiedad reactivada." : "Propiedad desactivada.", "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar la propiedad: " + err.message, "error"); }
  }));

  // ---------- Estados ----------
  document.getElementById("inventario-tecnologico-btn-nuevo-estado-cfg").addEventListener("click", ()=>abrirFormEstado(content, null));
  content.querySelectorAll("[data-editar-estado]").forEach(b=>b.addEventListener("click", ()=>{
    const o = buscarPor(estados, "valor", b.dataset.editarEstado);
    if(o) abrirFormEstado(content, o);
  }));
  content.querySelectorAll("[data-toggle-estado]").forEach(b=>b.addEventListener("click", async ()=>{
    const o = buscarPor(estados, "valor", b.dataset.toggleEstado);
    if(!o) return;
    const activar = o.activo===false;
    try{
      await establecerActivoEstadoOpcion(o.valor, activar);
      mostrarToast(activar ? "Estado reactivado." : "Estado desactivado.", "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar el estado: " + err.message, "error"); }
  }));

  // ---------- Tipos de ubicación (se leen aparte: el mapa puede no estar abierto) ----------
  document.getElementById("inventario-tecnologico-btn-nuevo-tipo-ubicacion-cfg").addEventListener("click", ()=>abrirFormTipoUbicacion(content, null));
  pintarTiposUbicacion(content);
}

async function pintarTiposUbicacion(content){
  const cont = content.querySelector(`#${P}cfg-tipos-ubicacion`);
  if(!cont) return;
  let tipos;
  try{ tipos = await refrescarTiposUbicacion(); }
  catch(err){ cont.innerHTML = `<div class="${P}alert ${P}alert-error">No se pudieron leer los tipos de ubicación: ${esc(err.message)}</div>`; return; }
  if(!cont.isConnected) return;
  cont.innerHTML = `<table>
      <thead><tr><th></th><th>Etiqueta</th><th>Valor interno</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        ${tipos.map(t=>`<tr data-fila-tipo-ubicacion="${esc(t.valor)}">
          <td class="${P}cfg-pin">${htmlPin({ color: t.color || "#57697C", tipo: t.valor, icono: t.icono_svg || null })}</td>
          <td>${esc(t.etiqueta)}</td>
          <td class="${P}cell-muted ${P}mono">${esc(t.valor)}</td>
          <td>${pillEstadoActivo(t.activo)}</td>
          <td class="${P}cell-actions">
            <button class="${P}btn ${P}btn-sm" data-editar-tipo-ubicacion="${esc(t.valor)}">Editar</button>
            <button class="${P}btn ${P}btn-sm" data-toggle-tipo-ubicacion="${esc(t.valor)}">${t.activo === false ? "Activar" : "Desactivar"}</button>
          </td>
        </tr>`).join("")}
      </tbody>
    </table>
    ${tipos.length === 0 ? `<div class="${P}empty-state"><div class="${P}big">—</div>Todavía no hay tipos de ubicación.</div>` : ""}`;
  cont.querySelectorAll("[data-editar-tipo-ubicacion]").forEach(b=>b.addEventListener("click", ()=>{
    const t = buscarPor(cargarTiposUbicacion(), "valor", b.dataset.editarTipoUbicacion);
    if(t) abrirFormTipoUbicacion(content, t);
  }));
  cont.querySelectorAll("[data-toggle-tipo-ubicacion]").forEach(b=>b.addEventListener("click", async ()=>{
    const t = buscarPor(cargarTiposUbicacion(), "valor", b.dataset.toggleTipoUbicacion);
    if(!t) return;
    try{
      await editarTipoUbicacion(t.valor, { activo: t.activo === false });
      mostrarToast(t.activo === false ? "Tipo de ubicación reactivado." : "Tipo de ubicación desactivado: las ubicaciones que ya lo tienen lo conservan.", "success");
      pintarTiposUbicacion(content);
    }catch(err){ mostrarToast("No se pudo actualizar el tipo de ubicación: " + err.message, "error"); }
  }));
}

// ---------------------------------------------------------------------------
// Tipo de activo (el formulario lo comparte el formulario del activo)
// ---------------------------------------------------------------------------
function abrirFormTipo(content, t){
  const editando = !!t;
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>${editando?`Editar tipo de activo «${esc(t.nombre)}»`:'Nuevo tipo de activo'}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body" id="${P}cfg-form-tipo">
      ${htmlFormTipo("ct", t)}
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cancelar</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-tipo-cfg">${editando?'Guardar cambios':'Crear tipo'}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const form = montarFormTipo(document.getElementById(`${P}cfg-form-tipo`), "ct", t);
    document.getElementById("inventario-tecnologico-btn-guardar-tipo-cfg").addEventListener("click", async ()=>{
      let datos;
      try{ datos = form.leer(); }
      catch(err){ mostrarToast(err.message, "error"); if(err.campo) err.campo.focus(); return; }
      const btn = document.getElementById("inventario-tecnologico-btn-guardar-tipo-cfg");
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        const nombre = await guardarFormTipo(t, datos);
        cerrarModal();
        mostrarToast(editando ? (nombre !== t.nombre ? `Tipo renombrado a «${nombre}» y guardado.` : "Tipo actualizado.") : "Tipo creado.", "success");
        renderConfigOpciones(content);
      }catch(err){
        mostrarToast(`No se pudo ${editando?'guardar':'crear'} el tipo: ` + err.message, "error");
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear tipo";
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Campo de los activos (012)
// ---------------------------------------------------------------------------
function htmlFilaOpcion(o, i){
  return `<div class="${P}cfg-opcion" data-opcion-fila="${i}" data-opcion-valor="${esc(o.valor || "")}">
    <input type="text" maxlength="60" value="${esc(o.etiqueta || "")}" placeholder="Nombre de la opción" aria-label="Opción ${i + 1}" data-opcion-etiqueta>
    <label title="Si la desactivas, deja de ofrecerse; los activos que la tienen la conservan"><input type="checkbox" data-opcion-activa ${o.activo === false ? "" : "checked"}> activa</label>
  </div>`;
}

function abrirFormCampo(content, d){
  const editando = !!d;
  const fijo = editando && d.fijo;
  const opciones = editando ? d.opciones : [{ etiqueta: "", activo: true }, { etiqueta: "", activo: true }];
  const html = `<div class="${P}modal">
    <div class="${P}modal-header"><h3>${editando ? `Editar el campo «${esc(d.etiqueta)}»` : "Nuevo campo de los activos"}</h3><button class="${P}modal-close">✕</button></div>
    <div class="${P}modal-body">
      <div class="${P}form-grid">
        <div class="${P}field"><label for="${P}cc-etiqueta">Nombre del campo</label><input type="text" id="${P}cc-etiqueta" maxlength="60" value="${editando ? esc(d.etiqueta) : ""}" placeholder="Ej: IMEI" autocomplete="off"></div>
        <div class="${P}field"><label for="${P}cc-tipo">Tipo de dato</label><select id="${P}cc-tipo" ${fijo ? "disabled" : ""}>${TIPOS_DATO.map(t=>`<option value="${t.id}" ${editando && d.tipo_dato === t.id ? "selected" : ""}>${esc(t.etiqueta)}</option>`).join("")}</select></div>
        <div class="${P}field" data-cc-si="numero"><label for="${P}cc-unidad">Unidad <span class="${P}cell-muted">(opcional)</span></label><input type="text" id="${P}cc-unidad" maxlength="12" value="${editando && d.unidad ? esc(d.unidad) : ""}" placeholder="Ej: GB, m, VA"></div>
        <div class="${P}field ${P}span-2" data-cc-si="lista">
          <span class="${P}field-titulo">Opciones de la lista</span>
          <div id="${P}cc-opciones" class="${P}cfg-opciones">${opciones.map(htmlFilaOpcion).join("")}</div>
          <button type="button" class="${P}btn ${P}btn-sm" id="${P}cc-agregar-opcion">+ Agregar opción</button>
          <div class="${P}hint">El nombre de una opción se puede cambiar; lo que guardan los activos es su valor interno, que no cambia.</div>
        </div>
        <div class="${P}field ${P}span-2 ${P}nt-nc-marcas">
          <label data-cc-si="texto numero"><input type="checkbox" id="${P}cc-unico" ${editando && d.unico ? "checked" : ""}> Único entre activos (no se puede repetir)</label>
          <label><input type="checkbox" id="${P}cc-acta" ${editando && d.en_acta ? "checked" : ""} ${editando && d.clave === "serie" ? "disabled" : ""}> Aparece en el acta de entrega${editando && d.clave === "serie" ? " (la serie ya va siempre)" : ""}</label>
        </div>
      </div>
      ${fijo ? `<div class="${P}hint" style="margin-top:8px;">Campo de siempre: es la columna <code>${esc(d.columna)}</code> de la tabla de activos. Se le cambian la etiqueta${d.tipo_dato === "numero" ? ", la unidad" : ""} y las reglas; no se borra ni cambia de tipo de dato.</div>` : ""}
      ${editando && !fijo ? `<div class="${P}hint" style="margin-top:8px;">Clave interna: <code>${esc(d.clave)}</code> (no cambia). El tipo de dato solo se puede cambiar mientras ningún activo tenga un valor en este campo.</div>` : ""}
    </div>
    <div class="${P}modal-footer">
      <button class="${P}btn ${P}modal-close">Cancelar</button>
      <button class="${P}btn ${P}btn-primary" id="${P}btn-guardar-campo-cfg">${editando ? "Guardar cambios" : "Crear campo"}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const $ = id=>document.getElementById(`${P}${id}`);
    const pintarSegunTipo = ()=>{
      const tipo = $("cc-tipo").value;
      document.querySelectorAll("[data-cc-si]").forEach(el=>{ el.hidden = !el.dataset.ccSi.split(" ").includes(tipo); });
      if(!TIPOS_CON_UNICO.has(tipo)) $("cc-unico").checked = false;
    };
    $("cc-tipo").addEventListener("change", pintarSegunTipo);
    pintarSegunTipo();
    $("cc-agregar-opcion").addEventListener("click", ()=>{
      const cont = $("cc-opciones");
      cont.insertAdjacentHTML("beforeend", htmlFilaOpcion({ etiqueta: "", activo: true }, cont.children.length));
      cont.lastElementChild.querySelector("[data-opcion-etiqueta]").focus();
    });
    $("btn-guardar-campo-cfg").addEventListener("click", async ()=>{
      const tipo_dato = fijo ? d.tipo_dato : $("cc-tipo").value;
      const lista = [];
      for(const fila of document.querySelectorAll(`#${P}cc-opciones [data-opcion-fila]`)){
        const etiqueta = fila.querySelector("[data-opcion-etiqueta]").value.trim();
        const valorPrevio = fila.dataset.opcionValor;
        if(!etiqueta && !valorPrevio) continue; // fila nueva vacía: se ignora
        lista.push({ valor: valorPrevio || valorDeOpcion(etiqueta, lista.concat(editando ? d.opciones : [])), etiqueta, activo: fila.querySelector("[data-opcion-activa]").checked });
      }
      const def = {
        etiqueta: $("cc-etiqueta").value, tipo_dato, unidad: $("cc-unidad").value,
        opciones: lista, unico: $("cc-unico").checked, en_acta: $("cc-acta").checked,
      };
      const btn = $("btn-guardar-campo-cfg");
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        if(editando) await editarCampoActivo(d.clave, def);
        else await crearCampoActivo(def);
        cerrarModal();
        mostrarToast(editando ? "Campo guardado." : `Campo «${def.etiqueta.trim()}» creado. Márcalo en los tipos que lo usan.`, "success");
        renderConfigOpciones(content);
      }catch(err){
        mostrarToast(`No se pudo ${editando ? "guardar" : "crear"} el campo: ` + err.message, "error");
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear campo";
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Tipo de ubicación (v10): etiqueta, color e ícono de la burbuja
// ---------------------------------------------------------------------------
function abrirFormTipoUbicacion(content, t){
  const editando = !!t;
  const hay012 = hayCamposConfigurables();
  const html = `<div class="${P}modal">
    <div class="${P}modal-header"><h3>${editando ? `Editar el tipo de ubicación «${esc(t.etiqueta)}»` : "Nuevo tipo de ubicación"}</h3><button class="${P}modal-close">✕</button></div>
    <div class="${P}modal-body">
      <div class="${P}form-grid">
        <div class="${P}field"><label for="${P}cu-etiqueta">Etiqueta</label><input type="text" id="${P}cu-etiqueta" maxlength="40" value="${editando ? esc(t.etiqueta) : ""}" placeholder="Ej: Repetidora" autocomplete="off"></div>
        <div class="${P}field"><label for="${P}cu-color">Color</label><input type="color" id="${P}cu-color" value="${editando ? esc(t.color || "#57697C") : "#5B4B8A"}"></div>
        ${hay012 ? `<div class="${P}field ${P}span-2">
          <label for="${P}cu-icono">Ícono de la burbuja (SVG, opcional)</label>
          <div class="${P}cfg-icono-ubicacion">
            <textarea id="${P}cu-icono" class="${P}mono" placeholder="Pega acá el &lt;svg&gt;…&lt;/svg&gt; (con viewBox). Si se deja vacío, se usa el dibujo de siempre.">${editando && t.icono_svg ? esc(t.icono_svg) : ""}</textarea>
            <span class="${P}cfg-pin ${P}mapa-mini-vista" id="${P}cu-vista" aria-hidden="true"></span>
          </div>
          <div class="${P}hint" id="${P}cu-icono-ayuda">Se dibuja en blanco sobre el color del tipo; si el SVG trae colores propios (fill), se respetan.</div>
        </div>` : `<div class="${P}field ${P}span-2 ${P}hint">Para ponerle un ícono propio a la burbuja hace falta la migración 012.</div>`}
      </div>
      ${editando ? `<div class="${P}hint" style="margin-top:8px;">Valor interno: <code>${esc(t.valor)}</code> — no cambia (es lo que tienen guardado las ubicaciones de este tipo).</div>` : ""}
    </div>
    <div class="${P}modal-footer">
      <button class="${P}btn ${P}modal-close">Cancelar</button>
      <button class="${P}btn ${P}btn-primary" id="${P}btn-guardar-tipo-ubicacion-cfg">${editando ? "Guardar cambios" : "Crear tipo"}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const $ = id=>document.getElementById(`${P}${id}`);
    const pintarVista = ()=>{
      const vista = $("cu-vista");
      if(!vista) return;
      const v = validarSvg($("cu-icono").value, { exigirViewBox: true });
      vista.innerHTML = htmlPin({ color: $("cu-color").value, tipo: editando ? t.valor : "", icono: v.ok && v.svg ? v.svg : null });
      vista.classList.toggle(`${P}mapa-mini-vista-error`, !v.ok);
      $("cu-icono-ayuda").textContent = v.ok ? "Se dibuja en blanco sobre el color del tipo; si el SVG trae colores propios (fill), se respetan." : v.error;
    };
    if($("cu-icono")) $("cu-icono").addEventListener("input", pintarVista);
    $("cu-color").addEventListener("input", pintarVista);
    pintarVista();
    $("btn-guardar-tipo-ubicacion-cfg").addEventListener("click", async ()=>{
      const etiqueta = $("cu-etiqueta").value;
      const color = $("cu-color").value;
      const icono = $("cu-icono") ? $("cu-icono").value : undefined;
      const btn = $("btn-guardar-tipo-ubicacion-cfg");
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        if(editando) await editarTipoUbicacion(t.valor, { etiqueta, color, icono_svg: icono });
        else await crearTipoUbicacion(etiqueta, color, icono);
        cerrarModal();
        mostrarToast(editando ? "Tipo de ubicación guardado." : `Tipo «${etiqueta.trim()}» creado.`, "success");
        renderConfigOpciones(content);
      }catch(err){
        mostrarToast(`No se pudo ${editando ? "guardar" : "crear"} el tipo de ubicación: ` + err.message, "error");
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear tipo";
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Propiedad y estado (valor fijo, etiqueta editable)
// ---------------------------------------------------------------------------
function abrirFormPropiedad(content, o){
  const editando = !!o;
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>${editando?'Editar propiedad':'Nueva propiedad'}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-form-grid">
        <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-cp-etiqueta">Etiqueta</label><input type="text" id="inventario-tecnologico-cp-etiqueta" value="${editando?esc(o.etiqueta):''}" placeholder="Ej: Comodato"></div>
      </div>
      ${editando?`<div class="inventario-tecnologico-hint" style="margin-top:8px;">Valor interno: <code>${esc(o.valor)}</code> — no cambia (es lo que ya tienen guardado los activos que usan esta propiedad).</div>`:''}
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cancelar</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-propiedad-cfg">${editando?'Guardar cambios':'Crear propiedad'}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    document.getElementById("inventario-tecnologico-btn-guardar-propiedad-cfg").addEventListener("click", async ()=>{
      const etiqueta = document.getElementById("inventario-tecnologico-cp-etiqueta").value.trim();
      if(!etiqueta){ mostrarToast("Ingresa la etiqueta de la propiedad.", "error"); return; }
      const btn = document.getElementById("inventario-tecnologico-btn-guardar-propiedad-cfg");
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        if(editando) await editarPropiedadOpcion(o.valor, etiqueta);
        else await crearPropiedadOpcion(etiqueta);
        cerrarModal();
        mostrarToast(editando ? "Propiedad actualizada." : "Propiedad creada.", "success");
        renderConfigOpciones(content);
      }catch(err){
        mostrarToast(`No se pudo ${editando?'guardar':'crear'} la propiedad: ` + err.message, "error");
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear propiedad";
      }
    });
  });
}

function abrirFormEstado(content, o){
  const editando = !!o;
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>${editando?'Editar estado':'Nuevo estado'}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-form-grid">
        <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-ce-etiqueta">Etiqueta</label><input type="text" id="inventario-tecnologico-ce-etiqueta" value="${editando?esc(o.etiqueta):''}" placeholder="Ej: En reparación"></div>
        <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-ce-color">Color</label><input type="color" id="inventario-tecnologico-ce-color" value="${editando?(o.color_fg||'#57697C'):'#57697C'}"></div>
      </div>
      ${editando?`<div class="inventario-tecnologico-hint" style="margin-top:8px;">Valor interno: <code>${esc(o.valor)}</code> — no cambia (es lo que ya tienen guardado los activos que usan este estado).</div>`:''}
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cancelar</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-estado-cfg">${editando?'Guardar cambios':'Crear estado'}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    document.getElementById("inventario-tecnologico-btn-guardar-estado-cfg").addEventListener("click", async ()=>{
      const etiqueta = document.getElementById("inventario-tecnologico-ce-etiqueta").value.trim();
      if(!etiqueta){ mostrarToast("Ingresa la etiqueta del estado.", "error"); return; }
      const colorFg = document.getElementById("inventario-tecnologico-ce-color").value;
      const btn = document.getElementById("inventario-tecnologico-btn-guardar-estado-cfg");
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        if(editando) await editarEstadoOpcion(o.valor, etiqueta, colorFg);
        else await crearEstadoOpcion(etiqueta, colorFg);
        cerrarModal();
        mostrarToast(editando ? "Estado actualizado." : "Estado creado.", "success");
        renderConfigOpciones(content);
      }catch(err){
        mostrarToast(`No se pudo ${editando?'guardar':'crear'} el estado: ` + err.message, "error");
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear estado";
      }
    });
  });
}
