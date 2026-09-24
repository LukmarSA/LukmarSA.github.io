import { ACCIONES, ROL_ADMIN, sb } from "../../nucleo/config.js";
import { cargarPerfiles, cargarPermisos, guardarPermisos, refrescarDatos } from "../../nucleo/datos.js";
import { state } from "../../nucleo/estado.js";
import { esc } from "../../nucleo/helpers.js";
import { mostrarToast } from "../render-raiz.js";
import { renderConfigOpciones } from "./tipos-propiedades-estados.js";

export function renderVistaConfig(main){
  main.innerHTML = `
    <div class="inventario-tecnologico-subtabs">
      <button class="inventario-tecnologico-subtab-btn ${state.configSubtab==='permisos'?'inventario-tecnologico-active':''}" data-subtab="permisos">Permisos</button>
      <button class="inventario-tecnologico-subtab-btn ${state.configSubtab==='usuarios'?'inventario-tecnologico-active':''}" data-subtab="usuarios">Usuarios</button>
      <button class="inventario-tecnologico-subtab-btn ${state.configSubtab==='opciones'?'inventario-tecnologico-active':''}" data-subtab="opciones">Tipos y opciones</button>
    </div>
    <div id="inventario-tecnologico-config-content"></div>`;
  main.querySelectorAll("[data-subtab]").forEach(b=>b.addEventListener("click", ()=>{
    state.configSubtab = b.dataset.subtab; renderVistaConfig(main);
  }));
  const content = document.getElementById("inventario-tecnologico-config-content");
  if(state.configSubtab==="permisos") renderConfigPermisos(content);
  else if(state.configSubtab==="opciones") renderConfigOpciones(content);
  else renderConfigUsuarios(content);
}

export function renderConfigPermisos(content){
  const matriz = cargarPermisos();
  const roles = Object.keys(matriz);
  content.innerHTML = `
    <div class="inventario-tecnologico-alert inventario-tecnologico-alert-info">El rol <strong>administrador</strong> siempre tiene todos los permisos y no aparece aquí, para evitar que quede bloqueado por un error de configuración.</div>
    <div class="inventario-tecnologico-tablewrap" style="margin-bottom:14px;">
      <table class="inventario-tecnologico-matrix-table">
        <thead><tr><th>Acción</th>${roles.map(r=>`<th>${esc(r)}</th>`).join("")}</tr></thead>
        <tbody>
          ${ACCIONES.map(acc=>`<tr>
            <td>${acc.label}</td>
            ${roles.map(r=>`<td><input type="checkbox" data-rol="${esc(r)}" data-accion="${acc.id}" ${matriz[r][acc.id]?'checked':''}></td>`).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" id="inventario-tecnologico-nuevo-rol" placeholder="Nombre del nuevo rol (ej: soporte)" style="border:1px solid var(--border-strong);border-radius:6px;padding:7px 10px;">
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-agregar-rol">+ Agregar rol</button>
      <div class="inventario-tecnologico-fb-spacer"></div>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-permisos">Guardar matriz de permisos</button>
    </div>`;
  document.getElementById("inventario-tecnologico-btn-guardar-permisos").addEventListener("click", async ()=>{
    const nueva = {};
    roles.forEach(r=>{ nueva[r]={}; });
    content.querySelectorAll("input[type=checkbox]").forEach(cb=>{
      nueva[cb.dataset.rol][cb.dataset.accion] = cb.checked;
    });
    await guardarPermisos(nueva);
    mostrarToast("Matriz de permisos guardada.", "success");
  });
  document.getElementById("inventario-tecnologico-btn-agregar-rol").addEventListener("click", async ()=>{
    const nombre = document.getElementById("inventario-tecnologico-nuevo-rol").value.trim().toLowerCase();
    if(!nombre){ return; }
    if(nombre===ROL_ADMIN || matriz[nombre]){ mostrarToast("Ese nombre de rol ya existe.", "error"); return; }
    matriz[nombre] = {}; ACCIONES.forEach(a=>matriz[nombre][a.id]=false);
    await guardarPermisos(matriz);
    renderVistaConfig(document.getElementById("inventario-tecnologico-main"));
  });
}

export function renderConfigUsuarios(content){
  const perfiles = cargarPerfiles();
  const matriz = cargarPermisos();
  const roles = [ROL_ADMIN, ...Object.keys(matriz)];
  content.innerHTML = `
    <div class="inventario-tecnologico-tablewrap" style="margin-bottom:14px;">
      <table>
        <thead><tr><th>Nombre</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          ${perfiles.map(p=>`<tr>
            <td>${esc(p.nombre_completo)}</td>
            <td>
              ${p.id===state.sesionUid ? `<span class="inventario-tecnologico-rolebadge inventario-tecnologico-rol-${esc(p.rol)}">${esc(p.rol)}</span>` : `
              <select data-cambiar-rol="${esc(p.id)}">${roles.map(r=>`<option value="${esc(r)}" ${r===p.rol?'selected':''}>${esc(r)}</option>`).join("")}</select>`}
            </td>
            <td class="inventario-tecnologico-cell-actions">${p.id===state.sesionUid ? `<span class="inventario-tecnologico-cell-muted">(tú)</span>` : ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="inventario-tecnologico-alert inventario-tecnologico-alert-info">
      Para dar acceso a alguien nuevo: primero créale la cuenta en el panel de Supabase (Authentication → Add user, con su correo y una contraseña), y luego vincúlala aquí abajo con su rol. Esta pantalla nunca puede crear cuentas de acceso por sí sola — eso es intencional, por seguridad.
    </div>
    <fieldset>
      <legend>Vincular usuario existente</legend>
      <div class="inventario-tecnologico-form-grid">
        <div class="inventario-tecnologico-field"><label>Correo (el mismo con el que se creó en Supabase)</label><input type="email" id="inventario-tecnologico-nu-email"></div>
        <div class="inventario-tecnologico-field"><label>Nombre completo</label><input type="text" id="inventario-tecnologico-nu-nombre"></div>
        <div class="inventario-tecnologico-field"><label>Rol</label><select id="inventario-tecnologico-nu-rol">${roles.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("")}</select></div>
      </div>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-vincular-usuario" style="margin-top:10px;">Vincular</button>
    </fieldset>`;
  content.querySelectorAll("[data-cambiar-rol]").forEach(sel=>{
    sel.addEventListener("change", async ()=>{
      const { error } = await sb.from("perfiles").update({ rol: sel.value }).eq("id", sel.dataset.cambiarRol);
      if(error){ mostrarToast("No se pudo cambiar el rol: " + error.message, "error"); return; }
      await refrescarDatos();
      renderVistaConfig(document.getElementById("inventario-tecnologico-main"));
    });
  });
  document.getElementById("inventario-tecnologico-btn-vincular-usuario").addEventListener("click", async ()=>{
    const email = document.getElementById("inventario-tecnologico-nu-email").value.trim();
    const nombre_completo = document.getElementById("inventario-tecnologico-nu-nombre").value.trim();
    const rol = document.getElementById("inventario-tecnologico-nu-rol").value;
    if(!email || !nombre_completo){ mostrarToast("Completa correo y nombre.", "error"); return; }
    const { data: uid, error: e1 } = await sb.rpc("buscar_uid_por_email", { p_email: email });
    if(e1 || !uid){ mostrarToast("No se encontró ninguna cuenta con ese correo. Crea la cuenta primero en el panel de Supabase (Authentication → Add user).", "error"); return; }
    const { error: e2 } = await sb.from("perfiles").insert({ id: uid, rol, nombre_completo });
    if(e2){ mostrarToast("No se pudo vincular: " + e2.message, "error"); return; }
    await refrescarDatos();
    renderVistaConfig(document.getElementById("inventario-tecnologico-main"));
  });
}
