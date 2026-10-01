import { borrarFotoActivo, crearActivo, editarActivoBase, subirFotoActivo, urlFoto } from "../../negocio/operaciones.js";
import { cargarActivos, cargarCamposActivo } from "../../nucleo/datos.js";
import { buscarActivo, esc, fmtTag } from "../../nucleo/helpers.js";
import { camposDeTipo, configTipo, crearPropiedadOpcion, htmlOpcionesPropiedad, htmlOpcionesTipo, obligatoriosDeTipo, slugify } from "../../nucleo/opciones-configurables.js";
import { buscarRepetido, etiquetaConUnidad, normalizarValor, ordenarCampos, parchePersonalizados, valorCrudo } from "../../nucleo/campos-personalizados.js";
import { TIPO_CELULAR, camposParaGuardar } from "../../nucleo/formulario-activo.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { abrirCambiarCustodio } from "./cambiar-custodio.js";
import { montarSelectorTipo } from "./selector-tipo.js";
import { abrirDetalle } from "./vista.js";
import { guardarFormTipo, htmlFormTipo, montarFormTipo } from "../configuracion/form-tipo.js";
import { abrirModal, cerrarModal, mostrarToast, renderMain } from "../render-raiz.js";
import { abrirSubmodal, cerrarSubmodal } from "../submodal.js";
import { transicionarVisibilidad } from "../transiciones.js";

const P = "inventario-tecnologico-";

// Campos que se guardan siempre, sea cual sea el tipo.
const CAMPOS_COMUNES = ["tipo","propiedad","marca","modelo","nombre_dispositivo","proveedor","fecha_adquisicion","valor_compra","vida_util_anios"];

// Los campos que se eligen por tipo (v10): los 9 de siempre y los que se
// crean en Configuración, en un solo orden. data-campo = su clave.
// Los de siempre conservan los id de antes (fa-serie, fa-so, fa-proc…).
const ID_FIJO = { serie:"serie", so:"so", procesador:"proc", ram_gb:"ram", disco_gb:"disco", mac_wifi:"macwifi", mac_ethernet:"maceth", color:"color", longitud_m:"longitud" };
const MONO = new Set(["serie", "mac_wifi", "mac_ethernet"]);
export function idCampoFormulario(d){ return d.fijo ? `${P}fa-${ID_FIJO[d.clave] || d.clave}` : `${P}fa-c-${d.clave}`; }

function visiblesPara(tipo){
  const v = new Set(camposDeTipo(tipo).map(d=>d.clave));
  if(tipo === TIPO_CELULAR) v.add("celular");
  return v;
}

function controlCampo(d, valor){
  const id = idCampoFormulario(d);
  const v = valor === null || valor === undefined ? "" : valor;
  switch(d.tipo_dato){
    case "texto_largo":
      return `<textarea id="${id}" rows="2" maxlength="4000">${esc(v)}</textarea>`;
    case "numero":
      if(d.fijo) return `<input type="number" id="${id}"${d.clave === "longitud_m" ? ` step="0.1" min="0"` : ""} value="${esc(v)}">`;
      return `<input type="text" inputmode="decimal" id="${id}" value="${esc(v)}" autocomplete="off">`;
    case "fecha":
      return `<input type="date" id="${id}" value="${esc(v)}">`;
    case "si_no":
      return `<select id="${id}"><option value="">— Sin dato —</option><option value="si" ${v === true ? "selected" : ""}>Sí</option><option value="no" ${v === false ? "selected" : ""}>No</option></select>`;
    case "lista": {
      const ops = d.opciones.filter(o=>o.activo || o.valor === v);
      return `<select id="${id}"><option value="">— Selecciona —</option>${ops.map(o=>`<option value="${esc(o.valor)}" ${o.valor === v ? "selected" : ""}>${esc(o.etiqueta)}${o.activo ? "" : " (inactiva)"}</option>`).join("")}</select>`;
    }
    default: {
      const mono = MONO.has(d.clave) ? ` class="${P}mono"` : "";
      const ph = d.clave === "mac_wifi" || d.clave === "mac_ethernet" ? ` placeholder="AA:BB:CC:DD:EE:FF"` : "";
      return `<input type="text" id="${id}"${mono}${ph} maxlength="500" value="${esc(v)}">`;
    }
  }
}

function htmlCampoConfigurable(d, a, visibles){
  const ancho = d.tipo_dato === "texto_largo" ? ` ${P}span-2` : "";
  return `<div class="${P}field${ancho}" data-campo="${esc(d.clave)}"${visibles.has(d.clave) ? "" : " hidden"}><label for="${idCampoFormulario(d)}">${esc(etiquetaConUnidad(d))}<span class="${P}fa-obligatorio" aria-hidden="true" hidden> *</span></label>${controlCampo(d, a ? valorCrudo(a, d) : null)}</div>`;
}

// Los campos activos, en su orden (los desactivados no se muestran; sus
// valores quedan en la base).
function camposDelFormulario(){ return ordenarCampos(cargarCamposActivo().filter(d=>d.activo)); }

// Obligatorios del tipo elegido: asterisco y aria-required.
function marcarObligatorios(form, tipo){
  const obl = obligatoriosDeTipo(tipo);
  form.querySelectorAll("[data-campo]").forEach(el=>{
    const req = obl.has(el.dataset.campo);
    const marca = el.querySelector(`.${P}fa-obligatorio`);
    if(marca) marca.hidden = !req;
    const control = el.querySelector("input, select, textarea");
    if(control){ if(req) control.setAttribute("aria-required", "true"); else control.removeAttribute("aria-required"); }
  });
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
                ${esAdmin() ? `<button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-nuevo-tipo" title="Crear nuevo tipo de activo" aria-label="Crear nuevo tipo de activo">+</button>
                <button type="button" class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-editar-tipo" title="Editar el tipo elegido (nombre, ícono y campos)" aria-label="Editar el tipo elegido"${a && a.tipo ? "" : " disabled"}>✎</button>` : ""}
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
            <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-fa-nombre">Nombre del dispositivo</label><input type="text" id="inventario-tecnologico-fa-nombre" value="${esc(a?a.nombre_dispositivo:'')}"></div>
            ${camposDelFormulario().map(d=>htmlCampoConfigurable(d, a, visibles)).join("")}
            <div class="inventario-tecnologico-field" data-fa-ancla-comunes><label for="inventario-tecnologico-fa-proveedor">Proveedor</label><input type="text" id="inventario-tecnologico-fa-proveedor" value="${esc(a?a.proveedor:'')}"></div>
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
    const grilla = document.getElementById("inventario-tecnologico-fa-grid");
    let condicionales = [...form.querySelectorAll("[data-campo]")];
    let moviles = [...form.querySelectorAll(".inventario-tecnologico-form-grid > .inventario-tecnologico-field, .inventario-tecnologico-fa-bloque")];
    const btnEditarTipo = document.getElementById("inventario-tecnologico-btn-editar-tipo");
    marcarObligatorios(form, selectTipo.value);
    selectTipo.addEventListener("change", ()=>{
      visibles = visiblesPara(selectTipo.value);
      marcarObligatorios(form, selectTipo.value);
      if(btnEditarTipo) btnEditarTipo.disabled = !configTipo(selectTipo.value);
      transicionarVisibilidad(form, condicionales, el=>visibles.has(el.dataset.campo), { moviles });
    });
    // Si en el submodal del tipo se creó un campo nuevo, se repintan los
    // campos configurables sin perder lo escrito.
    const repintarConfigurables = ()=>{
      const escritos = new Map();
      grilla.querySelectorAll("[data-campo]").forEach(el=>{ const c = el.querySelector("input, select, textarea"); if(c) escritos.set(c.id, c.value); el.remove(); });
      const ancla = grilla.querySelector("[data-fa-ancla-comunes]");
      ancla.insertAdjacentHTML("beforebegin", camposDelFormulario().map(d=>htmlCampoConfigurable(d, a, visibles)).join(""));
      grilla.querySelectorAll("[data-campo] input, [data-campo] select, [data-campo] textarea").forEach(c=>{ if(escritos.has(c.id)) c.value = escritos.get(c.id); });
      condicionales = [...form.querySelectorAll("[data-campo]")];
      moviles = [...form.querySelectorAll(".inventario-tecnologico-form-grid > .inventario-tecnologico-field, .inventario-tecnologico-fa-bloque")];
    };
    const trasTipo = nombre=>{
      const defsAntes = condicionales.filter(el=>el.closest("#inventario-tecnologico-fa-grid")).length;
      if(camposDelFormulario().length !== defsAntes) repintarConfigurables();
      selectTipo.innerHTML = htmlOpcionesTipo(nombre);
      selector.refrescar();
      selectTipo.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if(btnEditarTipo) btnEditarTipo.addEventListener("click", ()=>{
      const t = configTipo(selectTipo.value);
      if(t) abrirEditarTipo(btnEditarTipo, t, trasTipo);
    });

    // ---------- "+ Nuevo tipo" / "+ Nueva propiedad" (solo admin) ----------
    // Se abren en un modal aparte, ENCIMA del formulario: no lo cierran ni lo
    // reabren, así no se pierde lo que ya se llenó (marca, modelo, fotos…).
    // Al crear, el <select> correspondiente queda con la opción nueva elegida.
    const btnNuevoTipo = document.getElementById("inventario-tecnologico-btn-nuevo-tipo");
    if(btnNuevoTipo) btnNuevoTipo.addEventListener("click", ()=>abrirNuevoTipo(btnNuevoTipo, trasTipo));
    const btnNuevaPropiedad = document.getElementById("inventario-tecnologico-btn-nueva-propiedad");
    if(btnNuevaPropiedad) btnNuevaPropiedad.addEventListener("click", ()=>abrirNuevaPropiedad(btnNuevaPropiedad, etiqueta=>{
      document.getElementById("inventario-tecnologico-fa-propiedad").innerHTML = htmlOpcionesPropiedad(slugify(etiqueta));
    }));

    document.getElementById("inventario-tecnologico-btn-guardar-activo").addEventListener("click", async ()=>{
      const valor = (idCampo, recortar = true)=>{ const v = document.getElementById(`inventario-tecnologico-fa-${idCampo}`).value; return recortar ? v.trim() : v; };
      const tipo = selectTipo.value.trim();
      const valores = {
        tipo,
        propiedad: valor("propiedad", false),
        marca: valor("marca"),
        modelo: valor("modelo"),
        nombre_dispositivo: valor("nombre"),
        proveedor: valor("proveedor"),
        fecha_adquisicion: valor("fecha", false),
        valor_compra: valor("valorcompra", false),
        vida_util_anios: valor("vidautil", false),
        gmail: valor("gmail"),
        password: valor("password"),
      };
      // Los campos del tipo (los de siempre y los nuevos): se validan según su
      // tipo de dato, los obligatorios no pueden quedar vacíos y los únicos
      // no pueden repetir el valor de otro activo (la base también lo exige).
      const defsVisibles = camposDeTipo(tipo);
      const obligatorios = obligatoriosDeTipo(tipo);
      const valoresCampos = {};
      for(const d of defsVisibles){
        const el = document.getElementById(idCampoFormulario(d));
        if(!el) continue;
        const r = normalizarValor(d, el.value, { valorActual: a ? valorCrudo(a, d) : null });
        const fallar = msg=>{ mostrarToast(msg, "error"); el.focus(); };
        if(!r.ok){ fallar(r.error); return; }
        if(r.valor === null && obligatorios.has(d.clave)){ fallar(`Falta «${d.etiqueta}»: es obligatorio para ${tipo}.`); return; }
        if(d.unico && r.valor !== null){
          const repetido = buscarRepetido(d, r.valor, cargarActivos().activos, a ? a.id : null);
          if(repetido){ fallar(`Ya hay otro activo con ese «${d.etiqueta}»: ${fmtTag(repetido)}.`); return; }
        }
        valoresCampos[d.clave] = r.valor;
        if(d.fijo) valores[d.columna] = r.valor === null ? "" : r.valor;
      }
      // Solo lo que se ve: un campo oculto por el tipo no se envía (al editar,
      // la base conserva lo que tenía).
      const campos = camposParaGuardar(valores, visibles, { comunes: CAMPOS_COMUNES });
      const personalizados = parchePersonalizados(defsVisibles, valoresCampos);
      const btn = document.getElementById("inventario-tecnologico-btn-guardar-activo");
      btn.disabled = true; btn.textContent = "Guardando…";
      try{
        let idActivo;
        if(esNuevo){
          idActivo = await crearActivo(campos, { personalizados });
        } else {
          idActivo = a.id;
          await editarActivoBase(idActivo, campos, { personalizados });
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
  abrirSubmodalTipo(origen, null, alCrear);
}

function abrirEditarTipo(origen, t, alGuardar){
  abrirSubmodalTipo(origen, t, alGuardar);
}

// El mismo formulario que Configuración → Tipos y opciones (form-tipo.js),
// en un submodal encima del activo: crear («+») o editar («✎»).
function abrirSubmodalTipo(origen, t, alListo){
  const editando = !!t;
  const html = `
    <div class="${P}modal ${P}submodal" role="dialog" aria-modal="true" aria-labelledby="${P}nt-titulo">
      ${cabeceraSubmodal(`${P}nt-titulo`, editando ? `Editar el tipo «${esc(t.nombre)}»` : "Nuevo tipo de activo")}
      <form id="${P}form-nuevo-tipo" novalidate>
        <div class="${P}modal-body">
          ${htmlFormTipo("nt", t)}
        </div>
        <div class="${P}modal-footer">
          <button type="button" class="${P}btn" data-submodal-cerrar id="${P}btn-cancelar-tipo">Cancelar</button>
          <button type="submit" class="${P}btn ${P}btn-primary" id="${P}btn-${editando ? "guardar" : "crear"}-tipo">${editando ? "Guardar cambios" : "Crear tipo"}</button>
        </div>
      </form>
    </div>`;
  abrirSubmodal(html, { origen, alMontar: host=>{
    const formTipo = montarFormTipo(host, "nt", t);
    const form = host.querySelector(`#${P}form-nuevo-tipo`);
    form.addEventListener("submit", async e=>{
      e.preventDefault();
      let datos;
      try{ datos = formTipo.leer(); }
      catch(err){ mostrarToast(err.message, "error"); if(err.campo) err.campo.focus(); return; }
      const btn = host.querySelector(`#${P}btn-${editando ? "guardar" : "crear"}-tipo`);
      btn.disabled = true; btn.textContent = editando ? "Guardando…" : "Creando…";
      try{
        const nombre = await guardarFormTipo(t, datos);
        cerrarSubmodal();
        alListo(nombre);
        mostrarToast(editando ? (nombre !== t.nombre ? `Tipo renombrado a «${nombre}».` : "Tipo guardado.") : "Tipo creado.", "success");
      } catch(err){
        btn.disabled = false; btn.textContent = editando ? "Guardar cambios" : "Crear tipo";
        mostrarToast(`No se pudo ${editando ? "guardar" : "crear"} el tipo: ` + err.message, "error");
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
