import { cambiarCustodio, editarTramoHistorial } from "../../negocio/operaciones.js";
import { cargarActivos } from "../../nucleo/datos.js";
import { TIPOS_DEVOLUCION, TIPOS_ENTREGA, buscarActivo, esc, fmtTag, hoyISO } from "../../nucleo/helpers.js";
import { crearEstadoOpcion, htmlOpcionesEstado, slugify } from "../../nucleo/opciones-configurables.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { abrirDetalle } from "./vista.js";
import { abrirModal, cerrarModal, mostrarToast, renderMain } from "../render-raiz.js";

export function abrirCambiarCustodio(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const tieneVigente = a.custodio !== null;
  const html = `
    <div class="inventario-tecnologico-modal">
      <div class="inventario-tecnologico-modal-header"><h3>Cambiar custodio — ${fmtTag(a)}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
      <div class="inventario-tecnologico-modal-body">
        <div class="inventario-tecnologico-alert inventario-tecnologico-alert-info">${tieneVigente
          ? `Custodio actual: <strong>${esc(a.custodio.nombre)}</strong>. Al confirmar, este tramo se cierra hoy y se abre uno nuevo.`
          : `Este activo todavía no tiene custodio — es obligatorio asignarle uno.`}</div>
        ${tieneVigente ? `
        <fieldset style="margin-bottom:14px;">
          <legend>Cierre del tramo actual</legend>
          <div class="inventario-tecnologico-form-grid">
            <div class="inventario-tecnologico-field"><label>Tipo de devolución</label>
              <select id="inventario-tecnologico-cc-tipodev">
                <option value="">— Selecciona —</option>
                ${TIPOS_DEVOLUCION.map(t=>`<option value="${t.v}">${t.label}</option>`).join("")}
              </select>
            </div>
            <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Observación de la devolución</label><textarea id="inventario-tecnologico-cc-observaciondev" placeholder="Ej: equipo devuelto con un rayón en la tapa, cargador incluido…"></textarea></div>
          </div>
        </fieldset>` : ""}
        <fieldset style="margin-bottom:14px;">
          <legend>Nuevo tramo</legend>
          <div class="inventario-tecnologico-form-grid">
            <div class="inventario-tecnologico-field"><label>Fecha</label><input type="date" id="inventario-tecnologico-cc-fecha" value="${hoyISO()}"></div>
            <div class="inventario-tecnologico-field">
              <label>Estado resultante</label>
              <div style="display:flex;gap:6px;">
                <select id="inventario-tecnologico-cc-estado" style="flex:1;">${htmlOpcionesEstado("")}</select>
                ${esAdmin() ? `<button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-nuevo-estado" title="Crear nuevo estado">+</button>` : ""}
              </div>
            </div>
            <div class="inventario-tecnologico-field"><label>Tipo de entrega</label>
              <select id="inventario-tecnologico-cc-tipoentrega">
                <option value="">— Selecciona —</option>
                ${TIPOS_ENTREGA.map(t=>`<option value="${t.v}">${t.label}</option>`).join("")}
              </select>
            </div>
            <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Observación de la entrega (opcional)</label><textarea id="inventario-tecnologico-cc-observacionentrega" placeholder="Ej: se entrega con cargador original y funda…"></textarea></div>
          </div>
        </fieldset>
        ${esAdmin() ? `
        <fieldset style="margin-bottom:14px;display:none;" id="inventario-tecnologico-fs-nuevo-estado">
          <legend>Nuevo estado</legend>
          <div class="inventario-tecnologico-form-grid">
            <div class="inventario-tecnologico-field"><label>Etiqueta</label><input type="text" id="inventario-tecnologico-ne-etiqueta" placeholder="Ej: En tránsito"></div>
            <div class="inventario-tecnologico-field"><label>Color</label><input type="color" id="inventario-tecnologico-ne-color" value="#57697C"></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px;">
            <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-primary inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-crear-estado">Crear estado</button>
            <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-cancelar-estado">Cancelar</button>
          </div>
        </fieldset>` : ""}
        <fieldset>
          <legend>Custodio</legend>
          <div class="inventario-tecnologico-form-grid">
            <div class="inventario-tecnologico-field"><label>Tipo</label>
              <select id="inventario-tecnologico-cc-tipo">
                <option value="persona">Persona</option>
                <option value="area">Área / departamento</option>
              </select>
            </div>
            <div class="inventario-tecnologico-field"><label>Nombre</label><input type="text" id="inventario-tecnologico-cc-nombre" placeholder="Nombre de la persona o del área — ej. Bodega General si queda disponible"></div>
            <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Cargo (opcional)</label><input type="text" id="inventario-tecnologico-cc-cargo"></div>
          </div>
        </fieldset>
      </div>
      <div class="inventario-tecnologico-modal-footer">
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-confirmar-cambiar">Confirmar</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    // ---------- "+ Nuevo estado" (botón solo admin) ----------
    const btnNuevoEstado = document.getElementById("inventario-tecnologico-btn-nuevo-estado");
    if(btnNuevoEstado){
      const fsEstado = document.getElementById("inventario-tecnologico-fs-nuevo-estado");
      btnNuevoEstado.addEventListener("click", ()=>{ fsEstado.style.display = fsEstado.style.display==="none" ? "" : "none"; });
      document.getElementById("inventario-tecnologico-btn-cancelar-estado").addEventListener("click", ()=>{ fsEstado.style.display = "none"; });
      document.getElementById("inventario-tecnologico-btn-crear-estado").addEventListener("click", async ()=>{
        const etiqueta = document.getElementById("inventario-tecnologico-ne-etiqueta").value.trim();
        if(!etiqueta){ mostrarToast("Ingresa la etiqueta del nuevo estado.", "error"); return; }
        const btn = document.getElementById("inventario-tecnologico-btn-crear-estado");
        btn.disabled = true; btn.textContent = "Creando…";
        try{
          await crearEstadoOpcion(etiqueta, document.getElementById("inventario-tecnologico-ne-color").value);
          document.getElementById("inventario-tecnologico-cc-estado").innerHTML = htmlOpcionesEstado(slugify(etiqueta));
          fsEstado.style.display = "none";
          document.getElementById("inventario-tecnologico-ne-etiqueta").value = "";
          mostrarToast("Estado creado.", "success");
        } catch(err){
          mostrarToast("No se pudo crear el estado: " + err.message, "error");
        } finally {
          btn.disabled = false; btn.textContent = "Crear estado";
        }
      });
    }
    document.getElementById("inventario-tecnologico-btn-confirmar-cambiar").addEventListener("click", async ()=>{
      const nombre = document.getElementById("inventario-tecnologico-cc-nombre").value.trim();
      if(!nombre){ mostrarToast("Ingresa el nombre del custodio — es obligatorio, el activo no puede quedar sin uno.", "error"); return; }
      const nuevoEstado = document.getElementById("inventario-tecnologico-cc-estado").value;
      if(!nuevoEstado){ mostrarToast("Selecciona el estado resultante.", "error"); return; }
      const tipoEntrega = document.getElementById("inventario-tecnologico-cc-tipoentrega").value;
      if(!tipoEntrega){ mostrarToast("Selecciona el tipo de entrega.", "error"); return; }
      let tipoDev = null, observacionDev = "";
      if(tieneVigente){
        tipoDev = document.getElementById("inventario-tecnologico-cc-tipodev").value;
        if(!tipoDev){ mostrarToast("Selecciona el tipo de devolución del tramo que se cierra.", "error"); return; }
        observacionDev = document.getElementById("inventario-tecnologico-cc-observaciondev").value.trim();
        if(!observacionDev){ mostrarToast("La observación de la devolución es obligatoria.", "error"); return; }
      }
      const fecha = document.getElementById("inventario-tecnologico-cc-fecha").value || hoyISO();
      const observacionEntrega = document.getElementById("inventario-tecnologico-cc-observacionentrega").value.trim();
      try{
        await cambiarCustodio(id, {
          tipo_custodio: document.getElementById("inventario-tecnologico-cc-tipo").value,
          nombre, cargo: document.getElementById("inventario-tecnologico-cc-cargo").value.trim(),
        }, tipoDev, fecha, observacionDev, tipoEntrega, nuevoEstado, observacionEntrega);
        cerrarModal(); renderMain(); abrirDetalle(id);
      } catch(err){ mostrarToast("No se pudo cambiar el custodio: " + err.message, "error"); }
    });
  });
}

export function abrirEditarTramo(id, index){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  const t = a.historial_custodia[index];
  if(!t) return;
  const vigente = t.hasta===null; // igual que en tramoHtml: NO es lo mismo que index===0
  // cuando el activo está disponible (ahí el tramo más reciente ya está cerrado).
  const html = `
    <div class="inventario-tecnologico-modal">
      <div class="inventario-tecnologico-modal-header"><h3>Editar tramo #${index+1} — ${fmtTag(a)}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
      <div class="inventario-tecnologico-modal-body">
        <div class="inventario-tecnologico-form-grid">
          <div class="inventario-tecnologico-field"><label>Tipo</label>
            <select id="inventario-tecnologico-et-tipo">
              <option value="persona" ${t.tipo_custodio==='persona'?'selected':''}>Persona</option>
              <option value="area" ${t.tipo_custodio==='area'?'selected':''}>Área / departamento</option>
              ${t.tipo_custodio==='mantenimiento' ? `<option value="mantenimiento" selected>Mantenimiento (heredado)</option>` : ''}
            </select>
          </div>
          <div class="inventario-tecnologico-field"><label>Nombre</label><input type="text" id="inventario-tecnologico-et-nombre" value="${esc(t.nombre)}"></div>
          <div class="inventario-tecnologico-field"><label>Cargo</label><input type="text" id="inventario-tecnologico-et-cargo" value="${esc(t.cargo)}"></div>
          <div class="inventario-tecnologico-field"><label>Desde</label><input type="date" id="inventario-tecnologico-et-desde" value="${t.desde||''}"></div>
          <div class="inventario-tecnologico-field"><label>Tipo de entrega</label>
            <select id="inventario-tecnologico-et-tipoentrega">
              <option value="">— Ninguno —</option>
              ${TIPOS_ENTREGA.map(x=>`<option value="${x.v}" ${t.tipo_entrega===x.v?'selected':''}>${x.label}</option>`).join("")}
            </select>
          </div>
          <div class="inventario-tecnologico-field"><label>Hasta</label><input type="date" id="inventario-tecnologico-et-hasta" value="${t.hasta||''}" ${vigente?'disabled':''}></div>
          <div class="inventario-tecnologico-field"><label>Tipo de devolución</label>
            <select id="inventario-tecnologico-et-tipodev" ${vigente?'disabled':''}>
              <option value="">— Ninguno —</option>
              ${TIPOS_DEVOLUCION.map(x=>`<option value="${x.v}" ${t.tipo_devolucion===x.v?'selected':''}>${x.label}</option>`).join("")}
            </select>
          </div>
          <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Observación de la entrega</label><textarea id="inventario-tecnologico-et-observacion-entrega" placeholder="Ej: se entrega con cargador original…">${esc(t.observacion_entrega)}</textarea></div>
          <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Observación de la devolución</label><textarea id="inventario-tecnologico-et-observacion-devolucion" ${vigente?'disabled':''} placeholder="${vigente?'Se habilita cuando este tramo se cierre':'Ej: se devuelve con la pantalla rayada…'}">${esc(t.observacion_devolucion)}</textarea></div>
        </div>
        ${vigente ? `<div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-top:8px;">Este es el tramo vigente: "Hasta", "Tipo de devolución" y "Observación de la devolución" quedan bloqueados porque aún no ha terminado. La observación de la entrega sí se puede editar.</div>` : ""}
      </div>
      <div class="inventario-tecnologico-modal-footer">
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-tramo">Guardar</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("inventario-tecnologico-btn-guardar-tramo").addEventListener("click", async ()=>{
      await editarTramoHistorial(id, index, {
        tipo_custodio: document.getElementById("inventario-tecnologico-et-tipo").value,
        nombre: document.getElementById("inventario-tecnologico-et-nombre").value.trim(),
        cargo: document.getElementById("inventario-tecnologico-et-cargo").value.trim(),
        desde: document.getElementById("inventario-tecnologico-et-desde").value,
        tipo_entrega: document.getElementById("inventario-tecnologico-et-tipoentrega").value,
        hasta: vigente ? null : document.getElementById("inventario-tecnologico-et-hasta").value,
        tipo_devolucion: vigente ? null : document.getElementById("inventario-tecnologico-et-tipodev").value,
        observacion_entrega: document.getElementById("inventario-tecnologico-et-observacion-entrega").value.trim(),
        observacion_devolucion: vigente ? null : document.getElementById("inventario-tecnologico-et-observacion-devolucion").value.trim(),
      });
      cerrarModal(); renderMain(); abrirDetalle(id);
    });
  });
}
