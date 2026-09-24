// Task #25 — Pantalla dedicada de gestión de tipos de activo, propiedades y
// estados: crear, editar (solo atributos de presentación — ver el comentario
// junto a editarTipoActivo en nucleo/opciones-configurables.js sobre por qué
// el nombre/valor no se puede cambiar) y desactivar/reactivar. Vive como una
// subpestaña más de Configuración (junto a Permisos y Usuarios), separada
// del formulario de activo — los botones "+" que ya existían ahí (Nuevo
// tipo / Nueva propiedad) siguen funcionando igual, como acceso rápido; esta
// pantalla es el lugar completo para administrar las 3 listas, incluyendo
// estados (que antes no se podían crear desde ninguna parte de la interfaz).
import { cargarEstadoOpciones, cargarPropiedadOpciones, cargarTiposActivo } from "../../nucleo/datos.js";
import { esc } from "../../nucleo/helpers.js";
import {
  CAMPOS_BLOQUEABLES, CAMPOS_EXTRA, LABEL_CAMPO,
  crearEstadoOpcion, crearPropiedadOpcion, crearTipoActivo,
  editarEstadoOpcion, editarPropiedadOpcion, editarTipoActivo,
  establecerActivoEstadoOpcion, establecerActivoPropiedadOpcion, establecerActivoTipo,
  iconoTipoTam,
} from "../../nucleo/opciones-configurables.js";
import { abrirModal, cerrarModal, mostrarToast } from "../render-raiz.js";

function pillEstadoActivo(activo){
  return activo===false
    ? `<span style="color:var(--ink-faint);font-size:13px;">○ Inactivo</span>`
    : `<span style="color:var(--good);font-size:13px;">● Activo</span>`;
}

function encabezadoSeccion(titulo, idBotonNuevo, textoBotonNuevo){
  return `<div style="display:flex;align-items:center;gap:8px;">
    <div class="inventario-tecnologico-section-title" style="margin:0;flex:1;">${titulo}</div>
    <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary inventario-tecnologico-btn-sm" id="${idBotonNuevo}">+ ${textoBotonNuevo}</button>
  </div>`;
}

export function renderConfigOpciones(content){
  const tipos = cargarTiposActivo();
  const propiedades = cargarPropiedadOpciones();
  const estados = cargarEstadoOpciones();
  content.innerHTML = `
    <div class="inventario-tecnologico-alert inventario-tecnologico-alert-info">Desactivar una opción no borra nada ni afecta a los activos que ya la tengan asignada — solo deja de ofrecerla para activos nuevos o al reasignar. El nombre/valor de cada opción no se puede editar una vez creada; si ya no aplica, desactívala y crea una nueva.</div>

    ${encabezadoSeccion("Tipos de activo", "inventario-tecnologico-btn-nuevo-tipo-cfg", "Nuevo tipo")}
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;">
      <table>
        <thead><tr><th></th><th>Nombre</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${tipos.map(t=>`<tr>
            <td style="color:${esc(t.color||'#8B9AAA')};width:28px;">${iconoTipoTam(t.nombre, 18)}</td>
            <td>${esc(t.nombre)}</td>
            <td>${pillEstadoActivo(t.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-tipo="${t.id}">Editar</button>
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-tipo="${t.id}">${t.activo===false?'Activar':'Desactivar'}</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${tipos.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Todavía no hay tipos de activo configurados.</div>` : ""}
    </div>

    ${encabezadoSeccion("Propiedades", "inventario-tecnologico-btn-nueva-propiedad-cfg", "Nueva propiedad")}
    <div class="inventario-tecnologico-tablewrap" style="margin:10px 0 20px;">
      <table>
        <thead><tr><th>Etiqueta</th><th>Valor interno</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          ${propiedades.map(o=>`<tr>
            <td>${esc(o.etiqueta)}</td>
            <td class="inventario-tecnologico-cell-muted inventario-tecnologico-mono">${esc(o.valor)}</td>
            <td>${pillEstadoActivo(o.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-propiedad="${o.id}">Editar</button>
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-propiedad="${o.id}">${o.activo===false?'Activar':'Desactivar'}</button>
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
          ${estados.map(o=>`<tr>
            <td><span class="inventario-tecnologico-pill" style="background:${esc(o.color_bg||'#EEF1F4')};color:${esc(o.color_fg||'#57697C')};"><span class="inventario-tecnologico-pill-dot"></span>${esc(o.etiqueta)}</span></td>
            <td class="inventario-tecnologico-cell-muted inventario-tecnologico-mono">${esc(o.valor)}</td>
            <td>${pillEstadoActivo(o.activo)}</td>
            <td class="inventario-tecnologico-cell-actions">
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-estado="${o.id}">Editar</button>
              <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-toggle-estado="${o.id}">${o.activo===false?'Activar':'Desactivar'}</button>
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${estados.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Todavía no hay estados configurados.</div>` : ""}
    </div>`;

  // ---------- Tipos ----------
  document.getElementById("inventario-tecnologico-btn-nuevo-tipo-cfg").addEventListener("click", ()=>abrirFormTipo(content, null));
  content.querySelectorAll("[data-editar-tipo]").forEach(b=>b.addEventListener("click", ()=>{
    const t = tipos.find(x=>String(x.id)===b.dataset.editarTipo);
    abrirFormTipo(content, t);
  }));
  content.querySelectorAll("[data-toggle-tipo]").forEach(b=>b.addEventListener("click", async ()=>{
    const t = tipos.find(x=>String(x.id)===b.dataset.toggleTipo);
    const activar = t.activo===false;
    try{
      await establecerActivoTipo(t.id, activar);
      mostrarToast(activar ? "Tipo reactivado." : "Tipo desactivado.", "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar el tipo: " + err.message, "error"); }
  }));

  // ---------- Propiedades ----------
  document.getElementById("inventario-tecnologico-btn-nueva-propiedad-cfg").addEventListener("click", ()=>abrirFormPropiedad(content, null));
  content.querySelectorAll("[data-editar-propiedad]").forEach(b=>b.addEventListener("click", ()=>{
    const o = propiedades.find(x=>String(x.id)===b.dataset.editarPropiedad);
    abrirFormPropiedad(content, o);
  }));
  content.querySelectorAll("[data-toggle-propiedad]").forEach(b=>b.addEventListener("click", async ()=>{
    const o = propiedades.find(x=>String(x.id)===b.dataset.togglePropiedad);
    const activar = o.activo===false;
    try{
      await establecerActivoPropiedadOpcion(o.id, activar);
      mostrarToast(activar ? "Propiedad reactivada." : "Propiedad desactivada.", "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar la propiedad: " + err.message, "error"); }
  }));

  // ---------- Estados ----------
  document.getElementById("inventario-tecnologico-btn-nuevo-estado-cfg").addEventListener("click", ()=>abrirFormEstado(content, null));
  content.querySelectorAll("[data-editar-estado]").forEach(b=>b.addEventListener("click", ()=>{
    const o = estados.find(x=>String(x.id)===b.dataset.editarEstado);
    abrirFormEstado(content, o);
  }));
  content.querySelectorAll("[data-toggle-estado]").forEach(b=>b.addEventListener("click", async ()=>{
    const o = estados.find(x=>String(x.id)===b.dataset.toggleEstado);
    const activar = o.activo===false;
    try{
      await establecerActivoEstadoOpcion(o.id, activar);
      mostrarToast(activar ? "Estado reactivado." : "Estado desactivado.", "success");
      renderConfigOpciones(content);
    }catch(err){ mostrarToast("No se pudo actualizar el estado: " + err.message, "error"); }
  }));
}

function htmlCamposChecklist(idContenedor, camposMarcados){
  return `<div class="inventario-tecnologico-field inventario-tecnologico-span-2">
    <label>Campos pertinentes para este tipo</label>
    <div id="${idContenedor}" style="display:flex;flex-wrap:wrap;gap:8px 16px;">
      ${CAMPOS_BLOQUEABLES.concat(CAMPOS_EXTRA).map(c=>{
        const marcado = camposMarcados.includes(c);
        return `<label style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:13px;"><input type="checkbox" value="${c}" ${marcado?'checked':''}> ${LABEL_CAMPO[c]}</label>`;
      }).join("")}
    </div>
    <div class="inventario-tecnologico-hint">Marcados por defecto los campos "de cómputo" (serie, SO, RAM, etc.) — desmárcalos si no aplican a este tipo (ej. un cable o una fuente de alimentación).</div>
  </div>`;
}

function abrirFormTipo(content, t){
  const editando = !!t;
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>${editando?'Editar tipo de activo':'Nuevo tipo de activo'}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-form-grid">
        <div class="inventario-tecnologico-field"><label>Nombre</label><input type="text" id="inventario-tecnologico-ct-nombre" value="${editando?esc(t.nombre):''}" ${editando?'disabled':''} placeholder="Ej: Cámara IP"></div>
        <div class="inventario-tecnologico-field"><label>Color</label><input type="color" id="inventario-tecnologico-ct-color" value="${editando?(t.color||'#57697C'):'#57697C'}"></div>
        <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Ícono (SVG, opcional)</label><textarea id="inventario-tecnologico-ct-icono" class="inventario-tecnologico-mono" placeholder="Pega acá el &lt;svg&gt;...&lt;/svg&gt; de un ícono (ej. de icons.getbootstrap.com). Si se deja vacío, se usa un ícono genérico.">${editando&&t.icono_svg?esc(t.icono_svg):''}</textarea></div>
        ${htmlCamposChecklist("inventario-tecnologico-ct-campos", editando ? (t.campos_pertinentes||[]) : CAMPOS_BLOQUEABLES)}
      </div>
      ${editando?'<div class="inventario-tecnologico-hint" style="margin-top:8px;">El nombre no se puede cambiar una vez creado (los activos existentes lo identifican por su nombre) — si ya no aplica, desactívalo abajo y crea uno nuevo con el nombre correcto.</div>':''}
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cancelar</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-tipo-cfg">${editando?'Guardar cambios':'Crear tipo'}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    document.getElementById("inventario-tecnologico-btn-guardar-tipo-cfg").addEventListener("click", async ()=>{
      const nombre = document.getElementById("inventario-tecnologico-ct-nombre").value.trim();
      if(!nombre){ mostrarToast("Ingresa el nombre del tipo.", "error"); return; }
      const iconoRaw = document.getElementById("inventario-tecnologico-ct-icono").value.trim();
      if(iconoRaw){
        if(!/^<svg[\s>]/i.test(iconoRaw)){ mostrarToast("El ícono debe empezar con <svg — pega el markup completo o deja el campo vacío.", "error"); return; }
        if(!/width="16"\s+height="16"/.test(iconoRaw)){
          mostrarToast('El SVG debe tener width="16" height="16" (mismo tamaño que los íconos existentes, ej. de icons.getbootstrap.com) para verse bien también en la vista grande del detalle.', "error"); return;
        }
      }
      const campos = Array.from(document.querySelectorAll("#inventario-tecnologico-ct-campos input:checked")).map(cb=>cb.value);
      const color = document.getElementById("inventario-tecnologico-ct-color").value;
      const btn = document.getElementById("inventario-tecnologico-btn-guardar-tipo-cfg");
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        if(editando) await editarTipoActivo(t.id, { color, icono_svg: iconoRaw, campos_pertinentes: campos });
        else await crearTipoActivo({ nombre, color, icono_svg: iconoRaw, campos_pertinentes: campos });
        cerrarModal();
        mostrarToast(editando ? "Tipo actualizado." : "Tipo creado.", "success");
        renderConfigOpciones(content);
      }catch(err){
        mostrarToast(`No se pudo ${editando?'guardar':'crear'} el tipo: ` + err.message, "error");
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear tipo";
      }
    });
  });
}

function abrirFormPropiedad(content, o){
  const editando = !!o;
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>${editando?'Editar propiedad':'Nueva propiedad'}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-form-grid">
        <div class="inventario-tecnologico-field"><label>Etiqueta</label><input type="text" id="inventario-tecnologico-cp-etiqueta" value="${editando?esc(o.etiqueta):''}" placeholder="Ej: Comodato"></div>
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
        if(editando) await editarPropiedadOpcion(o.id, etiqueta);
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
        <div class="inventario-tecnologico-field"><label>Etiqueta</label><input type="text" id="inventario-tecnologico-ce-etiqueta" value="${editando?esc(o.etiqueta):''}" placeholder="Ej: En reparación"></div>
        <div class="inventario-tecnologico-field"><label>Color</label><input type="color" id="inventario-tecnologico-ce-color" value="${editando?(o.color_fg||'#57697C'):'#57697C'}"></div>
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
        if(editando) await editarEstadoOpcion(o.id, etiqueta, colorFg);
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
