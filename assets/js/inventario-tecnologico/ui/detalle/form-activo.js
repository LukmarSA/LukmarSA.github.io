import { borrarFotoActivo, crearActivo, editarActivoBase, subirFotoActivo, urlFoto } from "../../negocio/operaciones.js";
import { cargarActivos } from "../../nucleo/datos.js";
import { buscarActivo, esc, fmtTag } from "../../nucleo/helpers.js";
import { CAMPOS_BLOQUEABLES, CAMPOS_EXTRA, LABEL_CAMPO, camposPertinentesParaTipo, crearPropiedadOpcion, crearTipoActivo, htmlOpcionesPropiedad, htmlOpcionesTipo, slugify } from "../../nucleo/opciones-configurables.js";
import { camposParaGuardar, camposVisibles } from "../../nucleo/formulario-activo.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { abrirCambiarCustodio } from "./cambiar-custodio.js";
import { montarSelectorTipo } from "./selector-tipo.js";
import { abrirDetalle } from "./vista.js";
import { abrirModal, cerrarModal, mostrarToast, renderMain } from "../render-raiz.js";
import { abrirSubmodal, cerrarSubmodal } from "../submodal.js";
import { transicionarVisibilidad } from "../transiciones.js";

const P = "inventario-tecnologico-";

// Campos que se guardan siempre, sea cual sea el tipo.
const CAMPOS_COMUNES = ["tipo","propiedad","marca","modelo","nombre_dispositivo","proveedor","fecha_adquisicion","valor_compra","vida_util_anios"];

function visiblesPara(tipo){
  return camposVisibles({ tipo, pertinentes: camposPertinentesParaTipo(tipo), bloqueables: CAMPOS_BLOQUEABLES, extras: CAMPOS_EXTRA });
}

export function abrirFormActivo(id){
  const datos = cargarActivos();
  const a = id ? buscarActivo(datos, id) : null;
  const esNuevo = !a;
  // Qué campos opcionales se ven ahora (cambia con el Tipo).
  let visibles = visiblesPara(a ? a.tipo : "");
  // Campo condicional: se oculta si el tipo no lo usa (data-campo = clave de campos_pertinentes).
  const cond = (campo)=>`data-campo="${campo}"${visibles.has(campo) ? "" : " hidden"}`;

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
        <form id="inventario-tecnologico-form-activo" class="inventario-tecnologico-form-activo">
          <div class="inventario-tecnologico-form-grid" id="inventario-tecnologico-fa-grid">
            <div class="inventario-tecnologico-field">
              <label for="inventario-tecnologico-fa-tipo-boton">Tipo</label>
              <div class="inventario-tecnologico-fa-fila">
                <select id="inventario-tecnologico-fa-tipo" style="flex:1;">${htmlOpcionesTipo(a?a.tipo:'')}</select>
                ${esAdmin() ? `<button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-nuevo-tipo" title="Crear nuevo tipo de activo" aria-label="Crear nuevo tipo de activo">+</button>` : ""}
              </div>
            </div>
            <div class="inventario-tecnologico-field">
              <label for="inventario-tecnologico-fa-propiedad">Propiedad</label>
              <div class="inventario-tecnologico-fa-fila">
                <select id="inventario-tecnologico-fa-propiedad" required style="flex:1;">${htmlOpcionesPropiedad(a?a.propiedad:'lukmar')}</select>
                ${esAdmin() ? `<button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-nueva-propiedad" title="Crear nueva propiedad" aria-label="Crear nueva propiedad">+</button>` : ""}
              </div>
            </div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-marca">Marca</label><input type="text" id="inventario-tecnologico-fa-marca" value="${esc(a?a.marca:'')}"></div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-modelo">Modelo</label><input type="text" id="inventario-tecnologico-fa-modelo" value="${esc(a?a.modelo:'')}"></div>
            <div class="inventario-tecnologico-field" ${cond("serie")}><label for="inventario-tecnologico-fa-serie">Serie</label><input type="text" id="inventario-tecnologico-fa-serie" class="inventario-tecnologico-mono" value="${esc(a?a.serie:'')}"></div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-nombre">Nombre del dispositivo</label><input type="text" id="inventario-tecnologico-fa-nombre" value="${esc(a?a.nombre_dispositivo:'')}"></div>
            <div class="inventario-tecnologico-field" ${cond("so")}><label for="inventario-tecnologico-fa-so">Sistema operativo</label><input type="text" id="inventario-tecnologico-fa-so" value="${esc(a?a.sistema_operativo:'')}"></div>
            <div class="inventario-tecnologico-field" ${cond("procesador")}><label for="inventario-tecnologico-fa-proc">Procesador</label><input type="text" id="inventario-tecnologico-fa-proc" value="${esc(a?a.procesador:'')}"></div>
            <div class="inventario-tecnologico-field" ${cond("ram_gb")}><label for="inventario-tecnologico-fa-ram">RAM (GB)</label><input type="number" id="inventario-tecnologico-fa-ram" value="${a&&a.ram_gb?a.ram_gb:''}"></div>
            <div class="inventario-tecnologico-field" ${cond("disco_gb")}><label for="inventario-tecnologico-fa-disco">Almacenamiento (GB)</label><input type="number" id="inventario-tecnologico-fa-disco" value="${a&&a.disco_gb?a.disco_gb:''}"></div>
            <div class="inventario-tecnologico-field" ${cond("mac_wifi")}><label for="inventario-tecnologico-fa-macwifi">MAC WiFi</label><input type="text" id="inventario-tecnologico-fa-macwifi" class="inventario-tecnologico-mono" value="${esc(a?a.mac_wifi:'')}" placeholder="AA:BB:CC:DD:EE:FF"></div>
            <div class="inventario-tecnologico-field" ${cond("mac_ethernet")}><label for="inventario-tecnologico-fa-maceth">MAC Ethernet</label><input type="text" id="inventario-tecnologico-fa-maceth" class="inventario-tecnologico-mono" value="${esc(a?a.mac_ethernet:'')}" placeholder="AA:BB:CC:DD:EE:FF"></div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-proveedor">Proveedor</label><input type="text" id="inventario-tecnologico-fa-proveedor" value="${esc(a?a.proveedor:'')}"></div>
            <div class="inventario-tecnologico-field" ${cond("color")}><label for="inventario-tecnologico-fa-color">Color</label><input type="text" id="inventario-tecnologico-fa-color" value="${esc(a?a.color:'')}"></div>
            <div class="inventario-tecnologico-field" ${cond("longitud_m")}><label for="inventario-tecnologico-fa-longitud">Longitud (m)</label><input type="number" step="0.1" min="0" id="inventario-tecnologico-fa-longitud" value="${a&&a.longitud_m?a.longitud_m:''}"></div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-fecha">Fecha de adquisición</label><input type="date" id="inventario-tecnologico-fa-fecha" value="${a&&a.fecha_adquisicion?a.fecha_adquisicion:''}"></div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-valorcompra">Valor de compra (USD)</label><input type="number" step="0.01" min="0" id="inventario-tecnologico-fa-valorcompra" value="${a&&a.valor_compra?a.valor_compra:''}"></div>
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-vidautil">Vida útil (años)</label><input type="number" step="1" min="1" id="inventario-tecnologico-fa-vidautil" value="${a ? (a.vida_util_anios||'') : 3}"></div>
          </div>
          <fieldset class="inventario-tecnologico-fa-bloque" id="inventario-tecnologico-fs-celular" ${cond("celular")}>
            <legend>Datos de celular</legend>
            <div class="inventario-tecnologico-form-grid">
              <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-gmail">Gmail</label><input type="text" id="inventario-tecnologico-fa-gmail" class="inventario-tecnologico-mono" value="${a&&a.celular?esc(a.celular.gmail):''}"></div>
              <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-password">Password</label><input type="text" id="inventario-tecnologico-fa-password" class="inventario-tecnologico-mono" value="${a&&a.celular?esc(a.celular.password):''}"></div>
            </div>
          </fieldset>
          <div class="inventario-tecnologico-section-title inventario-tecnologico-fa-bloque" style="margin-top:14px;">Fotos</div>
          <div class="inventario-tecnologico-fotos-grid inventario-tecnologico-fa-bloque" id="inventario-tecnologico-fotos-grid-form">${htmlGridFotos()}</div>
          <div class="inventario-tecnologico-field inventario-tecnologico-hint inventario-tecnologico-fa-bloque" style="margin-top:6px;">Los cambios de fotos (agregar, quitar) se guardan junto con el resto al presionar "${esNuevo?'Crear activo':'Guardar cambios'}" — no se aplican antes.</div>
          <div class="inventario-tecnologico-field inventario-tecnologico-hint inventario-tecnologico-fa-bloque" style="margin-top:10px;">
            ${esNuevo ? "Al guardar, se te va a pedir asignar el primer custodio — un activo nunca queda sin uno." : "Para cambiar el custodio, usa el botón \"Cambiar custodio\" del detalle — este formulario solo edita los datos base del equipo."}
          </div>
        </form>
      </div>
      <div class="inventario-tecnologico-modal-footer">
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-guardar-activo">${esNuevo?'Crear activo':'Guardar cambios'}</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    const form = document.getElementById("inventario-tecnologico-form-activo");
    form.addEventListener("submit", e=>e.preventDefault());
    wireGridFotos();

    // ---------- Tipo: selector con búsqueda y orden; los campos siguen al tipo ----------
    const selectTipo = document.getElementById("inventario-tecnologico-fa-tipo");
    const selector = montarSelectorTipo(selectTipo);
    const condicionales = [...form.querySelectorAll("[data-campo]")];
    const moviles = [...form.querySelectorAll(".inventario-tecnologico-form-grid > .inventario-tecnologico-field, .inventario-tecnologico-fa-bloque")];
    selectTipo.addEventListener("change", ()=>{
      visibles = visiblesPara(selectTipo.value);
      transicionarVisibilidad(form, condicionales, el=>visibles.has(el.dataset.campo), { moviles });
    });

    // ---------- "+ Nuevo tipo" / "+ Nueva propiedad" (solo admin) ----------
    // Se abren en un modal aparte, ENCIMA del formulario: no lo cierran ni lo
    // reabren, así no se pierde lo que ya se llenó (marca, modelo, fotos…).
    // Al crear, el <select> correspondiente queda con la opción nueva elegida.
    const btnNuevoTipo = document.getElementById("inventario-tecnologico-btn-nuevo-tipo");
    if(btnNuevoTipo) btnNuevoTipo.addEventListener("click", ()=>abrirNuevoTipo(btnNuevoTipo, nombre=>{
      selectTipo.innerHTML = htmlOpcionesTipo(nombre);
      selector.refrescar();
      selectTipo.dispatchEvent(new Event("change", { bubbles: true }));
    }));
    const btnNuevaPropiedad = document.getElementById("inventario-tecnologico-btn-nueva-propiedad");
    if(btnNuevaPropiedad) btnNuevaPropiedad.addEventListener("click", ()=>abrirNuevaPropiedad(btnNuevaPropiedad, etiqueta=>{
      document.getElementById("inventario-tecnologico-fa-propiedad").innerHTML = htmlOpcionesPropiedad(slugify(etiqueta));
    }));

    document.getElementById("inventario-tecnologico-btn-guardar-activo").addEventListener("click", async ()=>{
      const valor = (idCampo, recortar = true)=>{ const v = document.getElementById(`inventario-tecnologico-fa-${idCampo}`).value; return recortar ? v.trim() : v; };
      const valores = {
        tipo: selectTipo.value.trim(),
        propiedad: valor("propiedad", false),
        marca: valor("marca"),
        modelo: valor("modelo"),
        serie: valor("serie"),
        nombre_dispositivo: valor("nombre"),
        sistema_operativo: valor("so"),
        procesador: valor("proc"),
        ram_gb: valor("ram", false),
        disco_gb: valor("disco", false),
        mac_wifi: valor("macwifi"),
        mac_ethernet: valor("maceth"),
        proveedor: valor("proveedor"),
        color: valor("color"),
        longitud_m: valor("longitud", false),
        fecha_adquisicion: valor("fecha", false),
        valor_compra: valor("valorcompra", false),
        vida_util_anios: valor("vidautil", false),
        gmail: valor("gmail"),
        password: valor("password"),
      };
      // Solo lo que se ve: un campo oculto por el tipo no se envía (al editar,
      // la base conserva lo que tenía).
      const campos = camposParaGuardar(valores, visibles, { comunes: CAMPOS_COMUNES });
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

// ---------------------------------------------------------------------------
// Submodales de "+ Nuevo tipo" y "+ Nueva propiedad".
// ---------------------------------------------------------------------------

function cabeceraSubmodal(idTitulo, titulo){
  return `<div class="${P}modal-header"><h3 id="${idTitulo}">${titulo}</h3><button type="button" class="${P}modal-close" data-submodal-cerrar aria-label="Cerrar">✕</button></div>`;
}

function abrirNuevoTipo(origen, alCrear){
  const html = `
    <div class="${P}modal ${P}submodal" role="dialog" aria-modal="true" aria-labelledby="${P}nt-titulo">
      ${cabeceraSubmodal(`${P}nt-titulo`, "Nuevo tipo de activo")}
      <form id="${P}form-nuevo-tipo" novalidate>
        <div class="${P}modal-body">
          <div class="${P}form-grid">
            <div class="${P}field"><label for="${P}nt-nombre">Nombre</label><input type="text" id="${P}nt-nombre" placeholder="Ej: Cámara IP" autocomplete="off"></div>
            <div class="${P}field"><label for="${P}nt-color">Color</label><input type="color" id="${P}nt-color" value="#57697C"></div>
            <div class="${P}field ${P}span-2"><label for="${P}nt-icono">Ícono (SVG, opcional)</label><textarea id="${P}nt-icono" class="${P}mono" placeholder="Pega acá el &lt;svg&gt;...&lt;/svg&gt; de un ícono (ej. de icons.getbootstrap.com). Si se deja vacío, se usa un ícono genérico."></textarea></div>
            <div class="${P}field ${P}span-2">
              <span class="${P}field-titulo" id="${P}nt-campos-titulo">Campos pertinentes para este tipo</span>
              <div id="${P}nt-campos" class="${P}nt-campos" role="group" aria-labelledby="${P}nt-campos-titulo">
                ${CAMPOS_BLOQUEABLES.concat(CAMPOS_EXTRA).map(c=>`<label><input type="checkbox" value="${c}" ${CAMPOS_BLOQUEABLES.includes(c)?'checked':''}> ${LABEL_CAMPO[c]}</label>`).join("")}
              </div>
              <div class="${P}hint">Marcados por defecto los campos "de cómputo" (serie, SO, RAM, etc.) — desmárcalos si no aplican a este tipo (ej. un cable o una fuente de alimentación).</div>
            </div>
          </div>
        </div>
        <div class="${P}modal-footer">
          <button type="button" class="${P}btn" data-submodal-cerrar id="${P}btn-cancelar-tipo">Cancelar</button>
          <button type="submit" class="${P}btn ${P}btn-primary" id="${P}btn-crear-tipo">Crear tipo</button>
        </div>
      </form>
    </div>`;
  abrirSubmodal(html, { origen, alMontar: host=>{
    const form = host.querySelector(`#${P}form-nuevo-tipo`);
    form.addEventListener("submit", async e=>{
      e.preventDefault();
      const nombre = host.querySelector(`#${P}nt-nombre`).value.trim();
      if(!nombre){ mostrarToast("Ingresa el nombre del nuevo tipo.", "error"); host.querySelector(`#${P}nt-nombre`).focus(); return; }
      // La validación de duplicados vive en crearTipoActivo() (igual que
      // crearPropiedadOpcion/crearEstadoOpcion) — si ya existe, el catch de
      // abajo muestra el mismo mensaje.
      const iconoRaw = host.querySelector(`#${P}nt-icono`).value.trim();
      if(iconoRaw){
        if(!/^<svg[\s>]/i.test(iconoRaw)){
          mostrarToast("El ícono debe empezar con <svg — pega el markup completo o deja el campo vacío.", "error"); return;
        }
        // iconoTipoTam() agranda el ícono para la vista grande del detalle
        // reemplazando width="16" height="16" — si el SVG pegado no trae
        // esas medidas exactas (el tamaño de icons.getbootstrap.com, igual
        // que los íconos ya migrados), el reemplazo no encuentra nada y el
        // ícono queda mal dimensionado ahí. Mejor avisar acá.
        if(!/width="16"\s+height="16"/.test(iconoRaw)){
          mostrarToast('El SVG debe tener width="16" height="16" (mismo tamaño que los íconos existentes, ej. de icons.getbootstrap.com) para verse bien también en la vista grande del detalle.', "error"); return;
        }
      }
      const campos = [...host.querySelectorAll(`#${P}nt-campos input:checked`)].map(cb=>cb.value);
      const btn = host.querySelector(`#${P}btn-crear-tipo`);
      btn.disabled = true; btn.textContent = "Creando…";
      try{
        await crearTipoActivo({ nombre, color: host.querySelector(`#${P}nt-color`).value, icono_svg: iconoRaw, campos_pertinentes: campos });
        cerrarSubmodal();
        alCrear(nombre);
        mostrarToast("Tipo creado.", "success");
      } catch(err){
        btn.disabled = false; btn.textContent = "Crear tipo";
        mostrarToast("No se pudo crear el tipo: " + err.message, "error");
      }
    });
  } });
}

function abrirNuevaPropiedad(origen, alCrear){
  const html = `
    <div class="${P}modal ${P}submodal ${P}submodal-angosto" role="dialog" aria-modal="true" aria-labelledby="${P}np-titulo">
      ${cabeceraSubmodal(`${P}np-titulo`, "Nueva propiedad")}
      <form id="${P}form-nueva-propiedad" novalidate>
        <div class="${P}modal-body">
          <div class="${P}field"><label for="${P}np-etiqueta">Etiqueta</label><input type="text" id="${P}np-etiqueta" placeholder="Ej: Comodato" autocomplete="off"></div>
        </div>
        <div class="${P}modal-footer">
          <button type="button" class="${P}btn" data-submodal-cerrar id="${P}btn-cancelar-propiedad">Cancelar</button>
          <button type="submit" class="${P}btn ${P}btn-primary" id="${P}btn-crear-propiedad">Crear propiedad</button>
        </div>
      </form>
    </div>`;
  abrirSubmodal(html, { origen, alMontar: host=>{
    host.querySelector(`#${P}form-nueva-propiedad`).addEventListener("submit", async e=>{
      e.preventDefault();
      const etiqueta = host.querySelector(`#${P}np-etiqueta`).value.trim();
      if(!etiqueta){ mostrarToast("Ingresa la etiqueta de la nueva propiedad.", "error"); host.querySelector(`#${P}np-etiqueta`).focus(); return; }
      const btn = host.querySelector(`#${P}btn-crear-propiedad`);
      btn.disabled = true; btn.textContent = "Creando…";
      try{
        await crearPropiedadOpcion(etiqueta);
        cerrarSubmodal();
        alCrear(etiqueta);
        mostrarToast("Propiedad creada.", "success");
      } catch(err){
        btn.disabled = false; btn.textContent = "Crear propiedad";
        mostrarToast("No se pudo crear la propiedad: " + err.message, "error");
      }
    });
  } });
}
