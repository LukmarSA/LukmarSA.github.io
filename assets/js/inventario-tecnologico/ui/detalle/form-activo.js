import { borrarFotoActivo, crearActivo, editarActivoBase, subirFotoActivo, urlFoto } from "../../negocio/operaciones.js";
import { cargarActivos } from "../../nucleo/datos.js";
import { buscarActivo, esc, fmtTag } from "../../nucleo/helpers.js";
import { CAMPOS_BLOQUEABLES, CAMPOS_EXTRA, LABEL_CAMPO, crearPropiedadOpcion, crearTipoActivo, htmlOpcionesPropiedad, htmlOpcionesTipo, slugify } from "../../nucleo/opciones-configurables.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { abrirCambiarCustodio } from "./cambiar-custodio.js";
import { abrirDetalle } from "./vista.js";
import { abrirModal, cerrarModal, mostrarToast, renderMain } from "../render-raiz.js";

export function abrirFormActivo(id){
  const datos = cargarActivos();
  const a = id ? buscarActivo(datos, id) : null;
  const esNuevo = !a;

  // Fotos ya NO tocan Supabase al hacer clic — quedan "pendientes" en memoria
  // (como cualquier otro campo del formulario) y solo se aplican al confirmar
  // "Guardar cambios", en el mismo paso que el resto de los datos base.
  // fotosABorrar: rutas existentes marcadas para borrar (con deshacer).
  // fotosNuevas: File[] seleccionados y todavía sin subir.
  let fotosABorrar = [];
  let fotosNuevas = [];

  function htmlGridFotos(){
    const existentes = (a&&a.fotos||[]).map(ruta=>{
      const marcada = fotosABorrar.includes(ruta);
      return `<div class="inventario-tecnologico-foto-thumb ${marcada?'inventario-tecnologico-foto-marcada-borrar':''}">
        <img src="${urlFoto(ruta)}" alt="Foto del activo">
        <button type="button" class="inventario-tecnologico-foto-borrar" data-toggle-borrar="${esc(ruta)}" title="${marcada?'Deshacer':'Quitar foto'}">${marcada?'↺':'✕'}</button>
      </div>`;
    }).join("");
    const nuevas = fotosNuevas.map((file,i)=>`<div class="inventario-tecnologico-foto-thumb inventario-tecnologico-foto-thumb-pendiente">
        <img src="${URL.createObjectURL(file)}" alt="Foto nueva, todavía sin guardar">
        <button type="button" class="inventario-tecnologico-foto-borrar" data-quitar-nueva="${i}" title="Quitar">✕</button>
        <span class="inventario-tecnologico-foto-pendiente-tag">Nueva</span>
      </div>`).join("");
    return existentes + nuevas + `<label class="inventario-tecnologico-foto-agregar"><span>+ Agregar</span><input type="file" accept="image/*" capture="environment" id="inventario-tecnologico-input-foto" style="display:none;"></label>`;
  }
  function wireGridFotos(){
    const inputFoto = document.getElementById("inventario-tecnologico-input-foto");
    if(inputFoto) inputFoto.addEventListener("change", ()=>{
      const archivo = inputFoto.files[0];
      if(!archivo) return;
      fotosNuevas.push(archivo);
      refrescarGridFotos();
    });
    document.querySelectorAll("[data-toggle-borrar]").forEach(b=>{
      b.addEventListener("click", ()=>{
        const ruta = b.dataset.toggleBorrar;
        const idx = fotosABorrar.indexOf(ruta);
        if(idx===-1) fotosABorrar.push(ruta); else fotosABorrar.splice(idx,1);
        refrescarGridFotos();
      });
    });
    document.querySelectorAll("[data-quitar-nueva]").forEach(b=>{
      b.addEventListener("click", ()=>{
        fotosNuevas.splice(Number(b.dataset.quitarNueva), 1);
        refrescarGridFotos();
      });
    });
  }
  function refrescarGridFotos(){
    const grid = document.getElementById("inventario-tecnologico-fotos-grid-form");
    if(!grid) return;
    grid.innerHTML = htmlGridFotos();
    wireGridFotos();
  }

  const html = `
    <div class="inventario-tecnologico-modal inventario-tecnologico-modal-wide">
      <div class="inventario-tecnologico-modal-header"><h3>${esNuevo?'Nuevo activo':'Editar ' + fmtTag(a)}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
      <div class="inventario-tecnologico-modal-body">
        <form id="inventario-tecnologico-form-activo">
          <div class="inventario-tecnologico-form-grid">
            <div class="inventario-tecnologico-field">
              <label>Tipo</label>
              <div style="display:flex;gap:6px;">
                <select id="inventario-tecnologico-fa-tipo" style="flex:1;">${htmlOpcionesTipo(a?a.tipo:'')}</select>
                ${esAdmin() ? `<button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-nuevo-tipo" title="Crear nuevo tipo de activo">+</button>` : ""}
              </div>
            </div>
            <div class="inventario-tecnologico-field">
              <label>Propiedad</label>
              <div style="display:flex;gap:6px;">
                <select id="inventario-tecnologico-fa-propiedad" required style="flex:1;">${htmlOpcionesPropiedad(a?a.propiedad:'lukmar')}</select>
                ${esAdmin() ? `<button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-nueva-propiedad" title="Crear nueva propiedad">+</button>` : ""}
              </div>
            </div>
            <div class="inventario-tecnologico-field"><label>Marca</label><input type="text" id="inventario-tecnologico-fa-marca" value="${esc(a?a.marca:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Modelo</label><input type="text" id="inventario-tecnologico-fa-modelo" value="${esc(a?a.modelo:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Serie</label><input type="text" id="inventario-tecnologico-fa-serie" class="inventario-tecnologico-mono" value="${esc(a?a.serie:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Nombre del dispositivo</label><input type="text" id="inventario-tecnologico-fa-nombre" value="${esc(a?a.nombre_dispositivo:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Sistema operativo</label><input type="text" id="inventario-tecnologico-fa-so" value="${esc(a?a.sistema_operativo:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Procesador</label><input type="text" id="inventario-tecnologico-fa-proc" value="${esc(a?a.procesador:'')}"></div>
            <div class="inventario-tecnologico-field"><label>RAM (GB)</label><input type="number" id="inventario-tecnologico-fa-ram" value="${a&&a.ram_gb?a.ram_gb:''}"></div>
            <div class="inventario-tecnologico-field"><label>Almacenamiento (GB)</label><input type="number" id="inventario-tecnologico-fa-disco" value="${a&&a.disco_gb?a.disco_gb:''}"></div>
            <div class="inventario-tecnologico-field"><label>MAC WiFi</label><input type="text" id="inventario-tecnologico-fa-macwifi" class="inventario-tecnologico-mono" value="${esc(a?a.mac_wifi:'')}" placeholder="AA:BB:CC:DD:EE:FF"></div>
            <div class="inventario-tecnologico-field"><label>MAC Ethernet</label><input type="text" id="inventario-tecnologico-fa-maceth" class="inventario-tecnologico-mono" value="${esc(a?a.mac_ethernet:'')}" placeholder="AA:BB:CC:DD:EE:FF"></div>
            <div class="inventario-tecnologico-field"><label>Proveedor</label><input type="text" id="inventario-tecnologico-fa-proveedor" value="${esc(a?a.proveedor:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Color</label><input type="text" id="inventario-tecnologico-fa-color" value="${esc(a?a.color:'')}"></div>
            <div class="inventario-tecnologico-field"><label>Longitud (m)</label><input type="number" step="0.1" min="0" id="inventario-tecnologico-fa-longitud" value="${a&&a.longitud_m?a.longitud_m:''}"></div>
            <div class="inventario-tecnologico-field"><label>Fecha de adquisición</label><input type="date" id="inventario-tecnologico-fa-fecha" value="${a&&a.fecha_adquisicion?a.fecha_adquisicion:''}"></div>
            <div class="inventario-tecnologico-field"><label>Valor de compra (USD)</label><input type="number" step="0.01" min="0" id="inventario-tecnologico-fa-valorcompra" value="${a&&a.valor_compra?a.valor_compra:''}"></div>
            <div class="inventario-tecnologico-field"><label>Vida útil (años)</label><input type="number" step="1" min="1" id="inventario-tecnologico-fa-vidautil" value="${a ? (a.vida_util_anios||'') : 3}"></div>
          </div>
          ${esAdmin() ? `
          <fieldset style="margin-top:14px;display:none;" id="inventario-tecnologico-fs-nuevo-tipo">
            <legend>Nuevo tipo de activo</legend>
            <div class="inventario-tecnologico-form-grid">
              <div class="inventario-tecnologico-field"><label>Nombre</label><input type="text" id="inventario-tecnologico-nt-nombre" placeholder="Ej: Cámara IP"></div>
              <div class="inventario-tecnologico-field"><label>Color</label><input type="color" id="inventario-tecnologico-nt-color" value="#57697C"></div>
              <div class="inventario-tecnologico-field inventario-tecnologico-span-2"><label>Ícono (SVG, opcional)</label><textarea id="inventario-tecnologico-nt-icono" class="inventario-tecnologico-mono" placeholder="Pega acá el &lt;svg&gt;...&lt;/svg&gt; de un ícono (ej. de icons.getbootstrap.com). Si se deja vacío, se usa un ícono genérico."></textarea></div>
              <div class="inventario-tecnologico-field inventario-tecnologico-span-2">
                <label>Campos pertinentes para este tipo</label>
                <div id="inventario-tecnologico-nt-campos" style="display:flex;flex-wrap:wrap;gap:8px 16px;">
                  ${CAMPOS_BLOQUEABLES.concat(CAMPOS_EXTRA).map(c=>`<label style="display:flex;align-items:center;gap:5px;font-weight:400;font-size:13px;"><input type="checkbox" value="${c}" ${CAMPOS_BLOQUEABLES.includes(c)?'checked':''}> ${LABEL_CAMPO[c]}</label>`).join("")}
                </div>
                <div class="inventario-tecnologico-hint">Marcados por defecto los campos "de cómputo" (serie, SO, RAM, etc.) — desmárcalos si no aplican a este tipo (ej. un cable o una fuente de alimentación).</div>
              </div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-primary inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-crear-tipo">Crear tipo</button>
              <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-cancelar-tipo">Cancelar</button>
            </div>
          </fieldset>
          <fieldset style="margin-top:14px;display:none;" id="inventario-tecnologico-fs-nueva-propiedad">
            <legend>Nueva propiedad</legend>
            <div class="inventario-tecnologico-form-grid">
              <div class="inventario-tecnologico-field"><label>Etiqueta</label><input type="text" id="inventario-tecnologico-np-etiqueta" placeholder="Ej: Comodato"></div>
            </div>
            <div style="display:flex;gap:8px;margin-top:10px;">
              <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-primary inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-crear-propiedad">Crear propiedad</button>
              <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-cancelar-propiedad">Cancelar</button>
            </div>
          </fieldset>` : ""}
          <fieldset style="margin-top:14px;" id="inventario-tecnologico-fs-celular">
            <legend>Datos de celular (solo si tipo = Celular)</legend>
            <div class="inventario-tecnologico-form-grid">
              <div class="inventario-tecnologico-field"><label>Gmail</label><input type="text" id="inventario-tecnologico-fa-gmail" class="inventario-tecnologico-mono" value="${a&&a.celular?esc(a.celular.gmail):''}"></div>
              <div class="inventario-tecnologico-field"><label>Password</label><input type="text" id="inventario-tecnologico-fa-password" class="inventario-tecnologico-mono" value="${a&&a.celular?esc(a.celular.password):''}"></div>
            </div>
          </fieldset>
          <div class="inventario-tecnologico-section-title" style="margin-top:14px;">Fotos</div>
          <div class="inventario-tecnologico-fotos-grid" id="inventario-tecnologico-fotos-grid-form">${htmlGridFotos()}</div>
          <div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-top:6px;">Los cambios de fotos (agregar, quitar) se guardan junto con el resto al presionar "${esNuevo?'Crear activo':'Guardar cambios'}" — no se aplican antes.</div>
          <div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-top:10px;">
            ${esNuevo ? "Al guardar, se te va a pedir asignar el primer custodio — un activo nunca queda sin uno." : "Para cambiar el custodio, usa el botón \"Cambiar custodio\" del detalle — este formulario solo edita los datos base del equipo."}
          </div>
        </form>
      </div>
      <div class="inventario-tecnologico-modal-footer">
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-activo">${esNuevo?'Crear activo':'Guardar cambios'}</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("inventario-tecnologico-form-activo").addEventListener("submit", e=>e.preventDefault());
    wireGridFotos();
    // ---------- "+ Nuevo tipo" / "+ Nueva propiedad" (botones solo admin) ----------
    // No cierran ni reabren el modal — así no se pierde el resto del
    // formulario que la persona ya haya llenado (marca, modelo, fotos…).
    // Solo actualizan el <select> correspondiente al terminar.
    const btnNuevoTipo = document.getElementById("inventario-tecnologico-btn-nuevo-tipo");
    if(btnNuevoTipo){
      const fsTipo = document.getElementById("inventario-tecnologico-fs-nuevo-tipo");
      btnNuevoTipo.addEventListener("click", ()=>{ fsTipo.style.display = fsTipo.style.display==="none" ? "" : "none"; });
      document.getElementById("inventario-tecnologico-btn-cancelar-tipo").addEventListener("click", ()=>{ fsTipo.style.display = "none"; });
      document.getElementById("inventario-tecnologico-btn-crear-tipo").addEventListener("click", async ()=>{
        const nombre = document.getElementById("inventario-tecnologico-nt-nombre").value.trim();
        if(!nombre){ mostrarToast("Ingresa el nombre del nuevo tipo.", "error"); return; }
        // La validación de duplicados vive en crearTipoActivo() (igual que
        // crearPropiedadOpcion/crearEstadoOpcion) — si ya existe, el catch de
        // abajo muestra el mismo mensaje.
        const iconoRaw = document.getElementById("inventario-tecnologico-nt-icono").value.trim();
        if(iconoRaw){
          if(!/^<svg[\s>]/i.test(iconoRaw)){
            mostrarToast("El ícono debe empezar con <svg — pega el markup completo o deja el campo vacío.", "error"); return;
          }
          // iconoTipoTam() agranda el ícono para la vista grande del detalle
          // reemplazando width="16" height="16" — si el SVG pegado no trae
          // esas medidas exactas (el tamaño de icons.getbootstrap.com, igual
          // que los 19 íconos ya migrados), el reemplazo no encuentra nada y
          // el ícono queda mal dimensionado ahí. Mejor avisar acá que
          // arrastrar un ícono roto silenciosamente.
          if(!/width="16"\s+height="16"/.test(iconoRaw)){
            mostrarToast('El SVG debe tener width="16" height="16" (mismo tamaño que los íconos existentes, ej. de icons.getbootstrap.com) para verse bien también en la vista grande del detalle.', "error"); return;
          }
        }
        const campos = Array.from(document.querySelectorAll("#inventario-tecnologico-nt-campos input:checked")).map(cb=>cb.value);
        const btn = document.getElementById("inventario-tecnologico-btn-crear-tipo");
        btn.disabled = true; btn.textContent = "Creando…";
        try{
          await crearTipoActivo({ nombre, color: document.getElementById("inventario-tecnologico-nt-color").value, icono_svg: iconoRaw, campos_pertinentes: campos });
          document.getElementById("inventario-tecnologico-fa-tipo").innerHTML = htmlOpcionesTipo(nombre);
          fsTipo.style.display = "none";
          document.getElementById("inventario-tecnologico-nt-nombre").value = "";
          document.getElementById("inventario-tecnologico-nt-icono").value = "";
          mostrarToast("Tipo creado.", "success");
        } catch(err){
          mostrarToast("No se pudo crear el tipo: " + err.message, "error");
        } finally {
          btn.disabled = false; btn.textContent = "Crear tipo";
        }
      });
    }
    const btnNuevaPropiedad = document.getElementById("inventario-tecnologico-btn-nueva-propiedad");
    if(btnNuevaPropiedad){
      const fsPropiedad = document.getElementById("inventario-tecnologico-fs-nueva-propiedad");
      btnNuevaPropiedad.addEventListener("click", ()=>{ fsPropiedad.style.display = fsPropiedad.style.display==="none" ? "" : "none"; });
      document.getElementById("inventario-tecnologico-btn-cancelar-propiedad").addEventListener("click", ()=>{ fsPropiedad.style.display = "none"; });
      document.getElementById("inventario-tecnologico-btn-crear-propiedad").addEventListener("click", async ()=>{
        const etiqueta = document.getElementById("inventario-tecnologico-np-etiqueta").value.trim();
        if(!etiqueta){ mostrarToast("Ingresa la etiqueta de la nueva propiedad.", "error"); return; }
        const btn = document.getElementById("inventario-tecnologico-btn-crear-propiedad");
        btn.disabled = true; btn.textContent = "Creando…";
        try{
          await crearPropiedadOpcion(etiqueta);
          document.getElementById("inventario-tecnologico-fa-propiedad").innerHTML = htmlOpcionesPropiedad(slugify(etiqueta));
          fsPropiedad.style.display = "none";
          document.getElementById("inventario-tecnologico-np-etiqueta").value = "";
          mostrarToast("Propiedad creada.", "success");
        } catch(err){
          mostrarToast("No se pudo crear la propiedad: " + err.message, "error");
        } finally {
          btn.disabled = false; btn.textContent = "Crear propiedad";
        }
      });
    }
    document.getElementById("inventario-tecnologico-btn-guardar-activo").addEventListener("click", async ()=>{
      const campos = {
        tipo: document.getElementById("inventario-tecnologico-fa-tipo").value.trim(),
        propiedad: document.getElementById("inventario-tecnologico-fa-propiedad").value,
        marca: document.getElementById("inventario-tecnologico-fa-marca").value.trim(),
        modelo: document.getElementById("inventario-tecnologico-fa-modelo").value.trim(),
        serie: document.getElementById("inventario-tecnologico-fa-serie").value.trim(),
        nombre_dispositivo: document.getElementById("inventario-tecnologico-fa-nombre").value.trim(),
        sistema_operativo: document.getElementById("inventario-tecnologico-fa-so").value.trim(),
        procesador: document.getElementById("inventario-tecnologico-fa-proc").value.trim(),
        ram_gb: document.getElementById("inventario-tecnologico-fa-ram").value,
        disco_gb: document.getElementById("inventario-tecnologico-fa-disco").value,
        mac_wifi: document.getElementById("inventario-tecnologico-fa-macwifi").value.trim(),
        mac_ethernet: document.getElementById("inventario-tecnologico-fa-maceth").value.trim(),
        proveedor: document.getElementById("inventario-tecnologico-fa-proveedor").value.trim(),
        color: document.getElementById("inventario-tecnologico-fa-color").value.trim(),
        longitud_m: document.getElementById("inventario-tecnologico-fa-longitud").value,
        fecha_adquisicion: document.getElementById("inventario-tecnologico-fa-fecha").value,
        valor_compra: document.getElementById("inventario-tecnologico-fa-valorcompra").value,
        vida_util_anios: document.getElementById("inventario-tecnologico-fa-vidautil").value,
        gmail: document.getElementById("inventario-tecnologico-fa-gmail").value.trim(),
        password: document.getElementById("inventario-tecnologico-fa-password").value.trim(),
      };
      const btn = document.getElementById("inventario-tecnologico-btn-guardar-activo");
      btn.disabled = true; btn.textContent = "Guardando…";
      try{
        let idActivo;
        if(esNuevo){
          idActivo = await crearActivo(campos);
        } else {
          idActivo = a.id;
          await editarActivoBase(idActivo, campos);
        }
        // Fotos pendientes recién ahora, en el mismo paso — si alguna falla,
        // los datos base ya quedaron guardados; se informa cuál falló en vez
        // de perder todo el trabajo ya hecho.
        for(const file of fotosNuevas) await subirFotoActivo(idActivo, file);
        for(const ruta of fotosABorrar) await borrarFotoActivo(idActivo, ruta);
        cerrarModal(); renderMain();
        // Un activo nuevo nace sin custodio en la base — nunca debe quedar
        // así en la práctica, así que el siguiente paso obligatorio es
        // asignarle uno, no ir directo al detalle.
        if(esNuevo) abrirCambiarCustodio(idActivo); else abrirDetalle(idActivo);
      } catch(err){
        btn.disabled = false; btn.textContent = esNuevo?'Crear activo':'Guardar cambios';
        mostrarToast("No se pudo guardar: " + err.message, "error");
      }
    });
  });
}
