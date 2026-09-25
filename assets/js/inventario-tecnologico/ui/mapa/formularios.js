// Modales del mapa: ubicación, equipo (con su servidor), respaldo, asignar
// activos y mover un activo. Usan el mismo sistema de modales de la app
// (abrirModal/cerrarModal) y, al guardar, avisan con mostrarToast y devuelven
// el control con alGuardar.
import { cargarActivos } from "../../nucleo/datos.js";
import { cargarEquiposRadioenlace, cargarRespaldos, cargarTiposUbicacion, cargarUbicaciones, estadoMapa, indicesMapa, redMapa, refrescarDatosMapa } from "../../nucleo/datos-mapa.js";
import { azimutGrados, distanciaKm, fmtAzimut, fmtCoordenadas, fmtDistancia, parsearCoordenadas } from "../../nucleo/geo.js";
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { coincideActivo, hoyLocalISO, infoTipoUbicacion, ordenarUbicaciones, validarFechaMovimiento } from "../../nucleo/mapa-logica.js";
import { candidatosRespaldo, candidatosServidor, describirConexion, siguientePrioridad } from "../../nucleo/mapa-jerarquia.js";
import { opcionesVigentes } from "../../nucleo/opciones-configurables.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { ErrorValidacion, asignarActivosAUbicacion, crearEquipo, crearRespaldo, crearTipoUbicacion, crearUbicacion, editarEquipo, editarRespaldo, editarUbicacion } from "../../negocio/operaciones-mapa.js";
import { urlFoto } from "../../negocio/operaciones.js";
import { abrirModal, cerrarModal, mostrarToast } from "../render-raiz.js";

const P = "inventario-tecnologico-";
const BANDAS_SUGERIDAS = ["900 MHz", "2.4 GHz", "3.65 GHz", "4.9 GHz", "5 GHz", "6 GHz", "11 GHz", "18 GHz", "24 GHz", "60 GHz", "80 GHz"];

function raizModal(){ return document.querySelector(`#${P}modal-host .${P}modal`); }

function mostrarErrores(raiz, errores = {}, general = ""){
  raiz.querySelectorAll("[data-error]").forEach(el=>{ el.textContent = errores[el.dataset.error] || ""; });
  const alerta = raiz.querySelector("[data-alerta]");
  if(alerta){ alerta.hidden = !general; alerta.textContent = general || ""; }
}

async function conBotonOcupado(boton, texto, fn){
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = texto;
  try{ return await fn(); }
  finally{ if(boton.isConnected){ boton.disabled = false; boton.textContent = original; } }
}

function manejarErrorGuardado(raiz, err){
  if(err instanceof ErrorValidacion) mostrarErrores(raiz, err.errores, "");
  else mostrarErrores(raiz, {}, err.message || String(err));
}

function cabecera(titulo){
  return `<div class="${P}modal-header"><h3>${esc(titulo)}</h3><button type="button" class="${P}modal-close" aria-label="Cerrar">✕</button></div>`;
}

function etiquetaActivo(a){
  return [fmtTag(a), a.tipo, [a.marca, a.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · ");
}

function opcionesUbicacion(seleccionada, { excluir = null } = {}){
  const tipos = cargarTiposUbicacion();
  const lista = ordenarUbicaciones(cargarUbicaciones().filter(u=>(u.activa !== false || u.id === seleccionada) && u.id !== excluir), tipos);
  return lista.map(u=>`<option value="${u.id}" ${u.id === seleccionada ? "selected" : ""}>${esc(u.nombre)} (${esc(infoTipoUbicacion(tipos, u.tipo).etiqueta)})${u.activa === false ? " — archivada" : ""}</option>`).join("");
}

// <optgroup> por ubicación con los equipos dados. La ubicación "local" (la del
// equipo) va primero: un servidor ahí es una conexión por cable.
function opcionesEquiposPorUbicacion(equipos, seleccionado, ubicacionLocal){
  const indices = indicesMapa();
  const tipos = cargarTiposUbicacion();
  const porUbicacion = new Map();
  for(const e of equipos){
    if(!porUbicacion.has(e.ubicacion_id)) porUbicacion.set(e.ubicacion_id, []);
    porUbicacion.get(e.ubicacion_id).push(e);
  }
  const ubics = ordenarUbicaciones([...porUbicacion.keys()].map(id=>indices.ubicacionPorId.get(id)).filter(Boolean), tipos)
    .sort((a, b)=>(a.id === ubicacionLocal ? -1 : 0) - (b.id === ubicacionLocal ? -1 : 0));
  return ubics.map(u=>{
    const lista = porUbicacion.get(u.id).sort((a, b)=>String(a.nombre).localeCompare(String(b.nombre), "es"));
    const local = u.id === ubicacionLocal;
    return `<optgroup label="${esc(u.nombre)}${local ? " — misma ubicación (por cable)" : ""}">${lista.map(e=>`<option value="${e.id}" ${e.id === seleccionado ? "selected" : ""}>${esc(e.nombre)}${e.modelo ? ` — ${esc(e.modelo)}` : ""}</option>`).join("")}</optgroup>`;
  }).join("");
}

function textoConexion(d){
  if(!d) return "";
  if(d.cable) return `Por cable: «${d.servidor.nombre}» está en la misma ubicación (no se dibuja línea).`;
  return `Radioenlace con «${d.servidor.nombre}» en «${d.ubicacionServidor ? d.ubicacionServidor.nombre : "—"}»: ${fmtDistancia(d.distanciaKm)} · azimut desde aquí ${fmtAzimut(d.azimutIda)} · desde allá ${fmtAzimut(d.azimutVuelta)}`;
}

// ===========================================================================
// Ubicación (crear / editar). "Elegir en el mapa" cierra el modal, deja
// hacer clic en el mapa y lo vuelve a abrir con lo ya escrito (borrador).
// ===========================================================================
export function abrirFormUbicacion({ id = null, borrador = null, lat = null, lng = null } = {}, { alGuardar, alElegirEnMapa } = {}){
  const actual = id ? cargarUbicaciones().find(u=>u.id === id) : null;
  if(id && !actual){ mostrarToast("Esa ubicación ya no existe. Recarga el mapa.", "error"); return; }
  const tipos = cargarTiposUbicacion();
  const tipoPorDefecto = (tipos.find(t=>t.activo !== false) || {}).valor || "";
  const b = borrador ? { ...borrador } : {
    nombre: actual ? actual.nombre : "",
    tipo: actual ? actual.tipo : tipoPorDefecto,
    coords: actual ? fmtCoordenadas(actual.lat, actual.lng) : "",
    direccion: actual && actual.direccion || "",
    notas: actual && actual.notas || "",
    fotosNuevas: [],
    fotosABorrar: [],
  };
  if(lat !== null && lng !== null) b.coords = fmtCoordenadas(lat, lng);
  const fotosGuardadas = actual ? (actual.fotos || []) : [];
  const urlsTemporales = [];

  const html = `<div class="${P}modal">
    ${cabecera(id ? "Editar ubicación" : "Nueva ubicación")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}form-grid">
        <div class="${P}field ${P}span-2">
          <label for="${P}ubic-nombre">Nombre</label>
          <input type="text" id="${P}ubic-nombre" maxlength="120" value="${esc(b.nombre)}" placeholder="Ej.: Torre Cerro Azul">
          <div class="${P}field-error" data-error="nombre"></div>
        </div>
        <div class="${P}field">
          <label for="${P}ubic-tipo">Tipo</label>
          <div class="${P}mapa-select-mas">
            <select id="${P}ubic-tipo"></select>
            ${esAdmin() ? `<button type="button" class="${P}btn ${P}btn-sm" id="${P}ubic-btn-mas-tipo" title="Nuevo tipo de ubicación" aria-label="Nuevo tipo de ubicación">+</button>` : ""}
          </div>
          <div class="${P}mapa-mini-form" id="${P}ubic-mini-tipo" hidden>
            <input type="text" id="${P}ubic-tipo-etiqueta" maxlength="40" placeholder="Nombre del tipo (ej.: Repetidora)" aria-label="Nombre del nuevo tipo">
            <input type="color" id="${P}ubic-tipo-color" value="#5B4B8A" aria-label="Color del nuevo tipo">
            <button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" id="${P}ubic-tipo-crear">Crear</button>
            <button type="button" class="${P}btn ${P}btn-sm" id="${P}ubic-tipo-cancelar">Cancelar</button>
            <div class="${P}field-error" id="${P}ubic-tipo-error"></div>
          </div>
          <div class="${P}field-error" data-error="tipo"></div>
        </div>
        <div class="${P}field">
          <label for="${P}ubic-coords">Coordenadas (latitud, longitud)</label>
          <div class="${P}mapa-coords-input">
            <input type="text" id="${P}ubic-coords" value="${esc(b.coords)}" placeholder="-2.189400, -79.889100" autocomplete="off" spellcheck="false">
            ${alElegirEnMapa ? `<button type="button" class="${P}btn ${P}btn-sm" id="${P}ubic-btn-elegir" title="Cerrar este formulario y hacer clic en el mapa">Elegir en el mapa</button>` : ""}
          </div>
          <div class="${P}hint" id="${P}ubic-coords-lectura">Pega lo que copia Google Maps (clic derecho sobre el punto), un enlace o grados/minutos/segundos.</div>
          <div class="${P}field-error" data-error="coordenadas"></div>
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}ubic-direccion">Dirección o referencia <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}ubic-direccion" maxlength="200" value="${esc(b.direccion)}">
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}ubic-notas">Notas <span class="${P}mapa-muted">(opcional)</span></label>
          <textarea id="${P}ubic-notas" maxlength="1000">${esc(b.notas)}</textarea>
        </div>
        <div class="${P}field ${P}span-2">
          <label>Fotos <span class="${P}mapa-muted">(opcional)</span></label>
          <div class="${P}fotos-grid" id="${P}ubic-fotos"></div>
          <input type="file" id="${P}ubic-fotos-input" accept="image/*" multiple hidden>
        </div>
      </div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}ubic-guardar">Guardar</button>
    </div>
  </div>`;

  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    const selTipo = $(`#${P}ubic-tipo`);
    const pintarTipos = seleccionado=>{
      selTipo.innerHTML = opcionesVigentes(cargarTiposUbicacion(), seleccionado)
        .map(t=>`<option value="${esc(t.valor)}" ${t.valor === seleccionado ? "selected" : ""}>${esc(t.etiqueta)}${t.activo === false ? " (inactivo)" : ""}</option>`).join("");
    };
    pintarTipos(b.tipo);

    const inputCoords = $(`#${P}ubic-coords`);
    const lectura = $(`#${P}ubic-coords-lectura`);
    const textoAyuda = lectura.textContent;
    const leerCoords = ()=>{
      const t = inputCoords.value.trim();
      if(!t){ lectura.textContent = textoAyuda; lectura.classList.remove(`${P}mapa-ok`); return; }
      const r = parsearCoordenadas(t);
      lectura.textContent = r.ok ? `✓ ${fmtCoordenadas(r.lat, r.lng)}` : r.error;
      lectura.classList.toggle(`${P}mapa-ok`, r.ok);
    };
    inputCoords.addEventListener("input", leerCoords);
    leerCoords();

    // Fotos: guardadas (se pueden marcar para borrar) + nuevas pendientes.
    const grid = $(`#${P}ubic-fotos`);
    const inputFotos = $(`#${P}ubic-fotos-input`);
    const pintarFotos = ()=>{
      urlsTemporales.splice(0).forEach(u=>URL.revokeObjectURL(u));
      const guardadas = fotosGuardadas.map((ruta, i)=>{
        const marcada = b.fotosABorrar.includes(ruta);
        return `<div class="${P}foto-thumb${marcada ? ` ${P}foto-marcada-borrar` : ""}"><img src="${urlFoto(ruta)}" alt="Foto ${i+1}"><button type="button" class="${P}foto-borrar" data-foto-guardada="${i}" title="${marcada ? "Conservar" : "Quitar al guardar"}">${marcada ? "↺" : "✕"}</button></div>`;
      });
      const nuevas = b.fotosNuevas.map((archivo, i)=>{
        const url = URL.createObjectURL(archivo);
        urlsTemporales.push(url);
        return `<div class="${P}foto-thumb ${P}foto-thumb-pendiente"><img src="${url}" alt="Foto nueva ${i+1}"><span class="${P}foto-pendiente-tag">Nueva</span><button type="button" class="${P}foto-borrar" data-foto-nueva="${i}" title="Descartar">✕</button></div>`;
      });
      grid.innerHTML = guardadas.join("") + nuevas.join("") + `<button type="button" class="${P}foto-agregar" id="${P}ubic-foto-agregar">+ Agregar</button>`;
    };
    pintarFotos();
    grid.addEventListener("click", e=>{
      const g = e.target.closest("[data-foto-guardada]");
      const n = e.target.closest("[data-foto-nueva]");
      if(g){
        const ruta = fotosGuardadas[Number(g.dataset.fotoGuardada)];
        b.fotosABorrar = b.fotosABorrar.includes(ruta) ? b.fotosABorrar.filter(r=>r !== ruta) : [...b.fotosABorrar, ruta];
        pintarFotos();
      } else if(n){
        b.fotosNuevas.splice(Number(n.dataset.fotoNueva), 1);
        pintarFotos();
      } else if(e.target.closest(`#${P}ubic-foto-agregar`)){
        inputFotos.click();
      }
    });
    inputFotos.addEventListener("change", ()=>{
      b.fotosNuevas.push(...Array.from(inputFotos.files || []).filter(f=>f.type.startsWith("image/")));
      inputFotos.value = "";
      pintarFotos();
    });

    const recogerBorrador = ()=>({
      ...b,
      nombre: $(`#${P}ubic-nombre`).value,
      tipo: selTipo.value,
      coords: inputCoords.value,
      direccion: $(`#${P}ubic-direccion`).value,
      notas: $(`#${P}ubic-notas`).value,
    });

    const botonElegir = $(`#${P}ubic-btn-elegir`);
    if(botonElegir) botonElegir.addEventListener("click", ()=>{
      const borradorActual = recogerBorrador();
      cerrarModal();
      alElegirEnMapa(borradorActual);
    });

    // "+" tipo de ubicación (solo admin), sin cerrar el formulario.
    const mas = $(`#${P}ubic-btn-mas-tipo`);
    if(mas){
      const mini = $(`#${P}ubic-mini-tipo`);
      const errorMini = $(`#${P}ubic-tipo-error`);
      mas.addEventListener("click", ()=>{ mini.hidden = !mini.hidden; if(!mini.hidden) $(`#${P}ubic-tipo-etiqueta`).focus(); });
      $(`#${P}ubic-tipo-cancelar`).addEventListener("click", ()=>{ mini.hidden = true; errorMini.textContent = ""; });
      $(`#${P}ubic-tipo-crear`).addEventListener("click", async e=>{
        errorMini.textContent = "";
        const etiqueta = $(`#${P}ubic-tipo-etiqueta`).value;
        const color = $(`#${P}ubic-tipo-color`).value;
        try{
          const valor = await conBotonOcupado(e.currentTarget, "Creando…", ()=>crearTipoUbicacion(etiqueta, color));
          pintarTipos(valor);
          mini.hidden = true;
          $(`#${P}ubic-tipo-etiqueta`).value = "";
          mostrarToast(`Tipo «${etiqueta.trim()}» creado.`, "success");
        }catch(err){
          errorMini.textContent = err.message;
        }
      });
    }

    $(`#${P}ubic-guardar`).addEventListener("click", async e=>{
      const datos = recogerBorrador();
      const coords = parsearCoordenadas(datos.coords);
      if(!coords.ok){ mostrarErrores(raiz, { coordenadas: coords.error }, ""); inputCoords.focus(); return; }
      mostrarErrores(raiz, {}, "");
      const campos = { nombre: datos.nombre, tipo: datos.tipo, lat: coords.lat, lng: coords.lng, direccion: datos.direccion, notas: datos.notas };
      try{
        const r = await conBotonOcupado(e.currentTarget, "Guardando…", ()=>id
          ? editarUbicacion(id, campos, { fotosNuevas: b.fotosNuevas, fotosABorrar: b.fotosABorrar })
          : crearUbicacion(campos, b.fotosNuevas));
        urlsTemporales.splice(0).forEach(u=>URL.revokeObjectURL(u));
        cerrarModal();
        mostrarToast(id ? "Ubicación actualizada." : `Ubicación «${campos.nombre.trim()}» creada.`, "success");
        if(r.erroresFotos && r.erroresFotos.length) mostrarToast(`No se subieron ${r.erroresFotos.length} foto(s): ${r.erroresFotos.join("; ")}`, "error");
        if(alGuardar) alGuardar(id || r.id);
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
  });
}

// ===========================================================================
// Equipo de radioenlace
// ===========================================================================
export function abrirFormEquipo({ id = null, ubicacionId = null } = {}, { alGuardar } = {}){
  const actual = id ? cargarEquiposRadioenlace().find(e=>e.id === id) : null;
  if(id && !actual){ mostrarToast("Ese equipo ya no existe. Recarga el mapa.", "error"); return; }
  const ubicId = actual ? actual.ubicacion_id : ubicacionId;
  const indices = indicesMapa();
  const ocupados = new Set(cargarEquiposRadioenlace().filter(e=>e.id !== id && e.activo_id !== null && e.activo_id !== undefined).map(e=>e.activo_id));
  const candidatos = cargarActivos().activos.filter(a=>!ocupados.has(a.id)).sort((a,b)=>a.id - b.id);
  const textoCandidato = a=>{
    const t = indices.vigentePorActivo.get(a.id);
    const u = t ? indices.ubicacionPorId.get(t.ubicacion_id) : null;
    return etiquetaActivo(a) + (u ? ` — en ${u.nombre}` : "");
  };
  let activoElegido = actual ? actual.activo_id : null;
  const red = redMapa();
  const posiblesServidores = candidatosServidor(red, id);
  const servidorActual = actual && actual.servidor_id !== null && actual.servidor_id !== undefined ? actual.servidor_id : null;
  const clientesActuales = id ? (red.clientes.get(id) || []).length : 0;

  const html = `<div class="${P}modal">
    ${cabecera(id ? "Editar equipo de radioenlace" : "Nuevo equipo de radioenlace")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}form-grid">
        <div class="${P}field ${P}span-2">
          <label for="${P}equipo-ubicacion">Ubicación</label>
          <select id="${P}equipo-ubicacion">${opcionesUbicacion(ubicId)}</select>
          <div class="${P}field-error" data-error="ubicacion_id"></div>
        </div>
        <div class="${P}field">
          <label for="${P}equipo-nombre">Nombre</label>
          <input type="text" id="${P}equipo-nombre" maxlength="120" value="${esc(actual ? actual.nombre : "")}" placeholder="Ej.: PTP Cerro Azul → Santa Ana">
          <div class="${P}field-error" data-error="nombre"></div>
        </div>
        <div class="${P}field">
          <label for="${P}equipo-modelo">Modelo <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}equipo-modelo" maxlength="120" value="${esc(actual && actual.modelo || "")}" placeholder="Ej.: Cambium PTP 550">
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}equipo-servidor">Servidor <span class="${P}mapa-muted">(de dónde recibe la conexión)</span></label>
          <select id="${P}equipo-servidor"></select>
          <div class="${P}hint" id="${P}equipo-servidor-calculo"></div>
          <div class="${P}field-error" data-error="servidor_id"></div>
        </div>
        <div class="${P}field">
          <label for="${P}equipo-banda">Banda <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}equipo-banda" list="${P}equipo-bandas" maxlength="40" value="${esc(actual && actual.banda || "")}" placeholder="Ej.: 5 GHz">
          <datalist id="${P}equipo-bandas">${BANDAS_SUGERIDAS.map(b=>`<option value="${b}">`).join("")}</datalist>
        </div>
        <div class="${P}field">
          <label for="${P}equipo-frecuencia">Frecuencia en MHz <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="number" id="${P}equipo-frecuencia" min="0" step="any" inputmode="decimal" value="${actual && actual.frecuencia_mhz !== null && actual.frecuencia_mhz !== undefined ? esc(Number(actual.frecuencia_mhz)) : ""}" placeholder="Ej.: 5745">
          <div class="${P}field-error" data-error="frecuencia_mhz"></div>
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}equipo-activo-filtro">Activo del inventario <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="search" id="${P}equipo-activo-filtro" placeholder="Filtrar por tag, tipo, marca, modelo…" autocomplete="off">
          <select id="${P}equipo-activo" size="6" aria-label="Activo vinculado"></select>
          <div class="${P}hint" id="${P}equipo-activo-aviso"></div>
          <div class="${P}field-error" data-error="activo_id"></div>
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}equipo-notas">Notas <span class="${P}mapa-muted">(opcional)</span></label>
          <textarea id="${P}equipo-notas" maxlength="1000" placeholder="IP de gestión, altura en la torre, azimut instalado…">${esc(actual && actual.notas || "")}</textarea>
        </div>
      </div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}equipo-guardar">Guardar</button>
    </div>
  </div>`;

  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    const sel = $(`#${P}equipo-activo`);
    const filtro = $(`#${P}equipo-activo-filtro`);
    const aviso = $(`#${P}equipo-activo-aviso`);
    const selUbic = $(`#${P}equipo-ubicacion`);
    const pintarCandidatos = ()=>{
      const visibles = candidatos.filter(a=>a.id === activoElegido || coincideActivo(a, filtro.value));
      sel.innerHTML = `<option value="" ${activoElegido === null ? "selected" : ""}>— Sin vincular a un activo —</option>`
        + visibles.map(a=>`<option value="${a.id}" ${a.id === activoElegido ? "selected" : ""}>${esc(textoCandidato(a))}</option>`).join("");
    };
    const pintarAviso = ()=>{
      if(activoElegido === null){ aviso.textContent = "Vincúlalo si el radio es un activo de Lukmar/EQ; si es del proveedor, déjalo sin vincular."; return; }
      const a = indices.activoPorId.get(activoElegido);
      const t = indices.vigentePorActivo.get(activoElegido);
      const destino = indices.ubicacionPorId.get(Number(selUbic.value));
      const origen = t ? indices.ubicacionPorId.get(t.ubicacion_id) : null;
      if(!a || !destino){ aviso.textContent = ""; return; }
      aviso.textContent = origen && origen.id !== destino.id
        ? `Al guardar, ${fmtTag(a)} pasará de «${origen.nombre}» a «${destino.nombre}» (queda registrado en su historial de ubicación).`
        : origen ? `${fmtTag(a)} ya está en «${destino.nombre}».` : `Al guardar, ${fmtTag(a)} quedará ubicado en «${destino.nombre}».`;
    };
    // Servidor: sin él es una raíz. Se ofrecen todos menos el propio equipo y
    // los que dependen de él (armarían un ciclo; la base también lo rechaza).
    const selServ = $(`#${P}equipo-servidor`);
    const calculoServ = $(`#${P}equipo-servidor-calculo`);
    let servidorElegido = servidorActual;
    const pintarServidores = ()=>{
      selServ.innerHTML = `<option value="" ${servidorElegido === null ? "selected" : ""}>— Ninguno: es una raíz (entrada de internet) —</option>`
        + opcionesEquiposPorUbicacion(posiblesServidores, servidorElegido, Number(selUbic.value));
    };
    const pintarCalculoServ = ()=>{
      const sid = selServ.value ? Number(selServ.value) : null;
      if(sid === null){ calculoServ.textContent = clientesActuales ? `Queda como raíz. Sus ${clientesActuales} cliente(s) siguen colgando de él.` : "Queda como raíz: punto de entrada de internet."; return; }
      const s2 = indices.equipoPorId.get(sid);
      const uA = indices.ubicacionPorId.get(Number(selUbic.value));
      const uS = s2 ? indices.ubicacionPorId.get(s2.ubicacion_id) : null;
      if(!s2 || !uA || !uS){ calculoServ.textContent = ""; return; }
      calculoServ.textContent = textoConexion({ servidor: s2, ubicacionServidor: uS, cable: uA.id === uS.id, distanciaKm: distanciaKm(uA, uS), azimutIda: azimutGrados(uA, uS), azimutVuelta: azimutGrados(uS, uA) });
    };
    pintarServidores();
    pintarCalculoServ();
    selServ.addEventListener("change", ()=>{ servidorElegido = selServ.value ? Number(selServ.value) : null; pintarCalculoServ(); });

    pintarCandidatos();
    pintarAviso();
    filtro.addEventListener("input", pintarCandidatos);
    selUbic.addEventListener("change", ()=>{ pintarAviso(); pintarServidores(); pintarCalculoServ(); });
    sel.addEventListener("change", ()=>{
      activoElegido = sel.value ? Number(sel.value) : null;
      const modelo = $(`#${P}equipo-modelo`);
      const a = activoElegido !== null ? indices.activoPorId.get(activoElegido) : null;
      if(a && !modelo.value.trim()) modelo.value = [a.marca, a.modelo].filter(Boolean).join(" ");
      pintarAviso();
    });

    $(`#${P}equipo-guardar`).addEventListener("click", async e=>{
      mostrarErrores(raiz, {}, "");
      const campos = {
        ubicacion_id: Number(selUbic.value),
        nombre: $(`#${P}equipo-nombre`).value,
        modelo: $(`#${P}equipo-modelo`).value,
        activo_id: activoElegido,
        notas: $(`#${P}equipo-notas`).value,
        servidor_id: selServ.value ? Number(selServ.value) : null,
        banda: $(`#${P}equipo-banda`).value,
        frecuencia_mhz: $(`#${P}equipo-frecuencia`).value,
      };
      // Si el servidor elegido era uno de sus respaldos, la base lo quita de los respaldos.
      const promovido = id && campos.servidor_id !== null && campos.servidor_id !== servidorActual
        && cargarRespaldos().some(r=>r.equipo_id === id && r.servidor_alternativo_id === campos.servidor_id);
      try{
        const nuevoId = await conBotonOcupado(e.currentTarget, "Guardando…", ()=>id ? editarEquipo(id, campos).then(()=>id) : crearEquipo(campos));
        cerrarModal();
        mostrarToast(id ? "Equipo actualizado." : `Equipo «${campos.nombre.trim()}» creado.`, "success");
        if(promovido) mostrarToast("Ese servidor era uno de sus respaldos: pasó a ser el principal y salió de la lista de respaldos.", "info");
        if(alGuardar) alGuardar(nuevoId);
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
  });
}

// ===========================================================================
// Respaldo: a qué otro servidor puede conmutar un equipo si pierde el suyo.
// ===========================================================================
export function abrirFormRespaldo({ id = null, equipoId = null } = {}, { alGuardar } = {}){
  const actual = id ? cargarRespaldos().find(r=>r.id === id) : null;
  if(id && !actual){ mostrarToast("Ese respaldo ya no existe. Recarga el mapa.", "error"); return; }
  const eqId = actual ? actual.equipo_id : equipoId;
  const red = redMapa();
  const equipo = red.equipoPorId.get(eqId);
  if(!equipo){ mostrarToast("No se encontró el equipo. Recarga el mapa.", "error"); return; }
  const u = red.ubicacionPorId.get(equipo.ubicacion_id);
  const principal = equipo.servidor_id !== null && equipo.servidor_id !== undefined ? red.equipoPorId.get(equipo.servidor_id) : null;
  const opciones = opcionesEquiposPorUbicacion(candidatosRespaldo(red, eqId, id), actual ? actual.servidor_alternativo_id : null, equipo.ubicacion_id);
  const prioridad = actual ? actual.prioridad : siguientePrioridad(red, eqId);

  const html = `<div class="${P}modal">
    ${cabecera(id ? "Editar respaldo" : "Nuevo respaldo")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}form-grid">
        <div class="${P}field ${P}span-2">
          <label>Equipo</label>
          <div class="${P}mapa-campo-fijo"><strong>${esc(equipo.nombre)}</strong> <span class="${P}mapa-muted">en ${esc(u ? u.nombre : "—")} · servidor actual: ${principal ? esc(principal.nombre) : "ninguno (es raíz)"}</span></div>
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}respaldo-servidor">Servidor de respaldo</label>
          ${opciones
            ? `<select id="${P}respaldo-servidor"><option value="">— Elige un equipo —</option>${opciones}</select>`
            : `<div class="${P}alert ${P}alert-info">No hay otros equipos que puedan ser respaldo (ya están todos registrados, o solo existe su servidor actual).</div>`}
          <div class="${P}hint" id="${P}respaldo-calculo"></div>
          <div class="${P}field-error" data-error="servidor_alternativo_id"></div>
        </div>
        <div class="${P}field">
          <label for="${P}respaldo-prioridad">Prioridad</label>
          <input type="number" id="${P}respaldo-prioridad" min="1" step="1" inputmode="numeric" value="${prioridad}">
          <div class="${P}hint">1 = primera opción. Al simular una caída se prueba en este orden.</div>
          <div class="${P}field-error" data-error="prioridad"></div>
        </div>
        <div class="${P}field">
          <label for="${P}respaldo-notas">Notas <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}respaldo-notas" maxlength="300" value="${esc(actual && actual.notas || "")}" placeholder="Ej.: requiere reapuntar la antena">
        </div>
      </div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}respaldo-guardar" ${opciones ? "" : "disabled"}>Guardar</button>
    </div>
  </div>`;

  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    const sel = $(`#${P}respaldo-servidor`);
    const calculo = $(`#${P}respaldo-calculo`);
    const pintarCalculo = ()=>{ calculo.textContent = sel && sel.value ? textoConexion(describirConexion(red, eqId, Number(sel.value))) : ""; };
    if(sel){ sel.addEventListener("change", pintarCalculo); pintarCalculo(); }
    $(`#${P}respaldo-guardar`).addEventListener("click", async e=>{
      mostrarErrores(raiz, {}, "");
      const campos = {
        equipo_id: eqId,
        servidor_alternativo_id: sel && sel.value ? Number(sel.value) : null,
        prioridad: $(`#${P}respaldo-prioridad`).value,
        notas: $(`#${P}respaldo-notas`).value,
      };
      try{
        const nuevoId = await conBotonOcupado(e.currentTarget, "Guardando…", ()=>id ? editarRespaldo(id, campos).then(()=>id) : crearRespaldo(campos));
        cerrarModal();
        mostrarToast(id ? "Respaldo actualizado." : "Respaldo registrado.", "success");
        if(alGuardar) alGuardar(nuevoId);
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
  });
}

// ===========================================================================
// Asignar varios activos a una ubicación
// ===========================================================================
export function abrirAsignarActivos(ubicacionId, { alGuardar } = {}){
  const indices = indicesMapa();
  const u = indices.ubicacionPorId.get(ubicacionId);
  if(!u){ mostrarToast("Esa ubicación ya no existe. Recarga el mapa.", "error"); return; }
  const activos = [...cargarActivos().activos].sort((a,b)=>a.id - b.id);
  const elegidos = new Set();
  let incluirUbicados = false;
  const hoy = hoyLocalISO();
  const bloqueo = a=>{
    const e = indices.equipoPorActivo.get(a.id);
    return e && e.ubicacion_id !== ubicacionId ? `equipo de radioenlace «${e.nombre}»` : "";
  };

  const html = `<div class="${P}modal ${P}modal-wide">
    ${cabecera(`Asignar activos a «${u.nombre}»`)}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}mapa-asignar-barra">
        <input type="search" id="${P}asignar-filtro" placeholder="Filtrar por tag, tipo, marca, modelo, serie o custodio…" autocomplete="off" aria-label="Filtrar activos">
        <label class="${P}mapa-check"><input type="checkbox" id="${P}asignar-incluir"> Incluir los que ya están en otra ubicación (se moverán)</label>
      </div>
      <div class="${P}mapa-asignar-acciones">
        <button type="button" class="${P}btn ${P}btn-sm" id="${P}asignar-todos">Marcar los visibles</button>
        <button type="button" class="${P}btn ${P}btn-sm" id="${P}asignar-ninguno">Desmarcar todo</button>
        <span class="${P}mapa-muted" id="${P}asignar-cuenta"></span>
      </div>
      <ul class="${P}mapa-asignar-lista" id="${P}asignar-lista" aria-label="Activos"></ul>
      <div class="${P}form-grid" style="margin-top:12px;">
        <div class="${P}field">
          <label for="${P}asignar-fecha">Fecha de llegada</label>
          <input type="date" id="${P}asignar-fecha" value="${hoy}" max="${hoy}">
        </div>
        <div class="${P}field">
          <label for="${P}asignar-notas">Notas <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}asignar-notas" maxlength="300" placeholder="Ej.: instalación inicial">
        </div>
      </div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}asignar-guardar" disabled>Asignar</button>
    </div>
  </div>`;

  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    const lista = $(`#${P}asignar-lista`);
    const filtro = $(`#${P}asignar-filtro`);
    const cuenta = $(`#${P}asignar-cuenta`);
    const guardar = $(`#${P}asignar-guardar`);
    let visibles = [];
    const pintar = ()=>{
      visibles = activos.filter(a=>{
        const t = indices.vigentePorActivo.get(a.id);
        if(t && t.ubicacion_id === ubicacionId) return false;
        if(t && !incluirUbicados && !elegidos.has(a.id)) return false;
        return coincideActivo(a, filtro.value);
      });
      lista.innerHTML = visibles.length ? visibles.map(a=>{
        const t = indices.vigentePorActivo.get(a.id);
        const donde = t ? indices.ubicacionPorId.get(t.ubicacion_id) : null;
        const bloqueado = bloqueo(a);
        return `<li><label class="${P}mapa-asignar-item${bloqueado ? ` ${P}mapa-asignar-bloqueado` : ""}">
          <input type="checkbox" value="${a.id}" ${elegidos.has(a.id) ? "checked" : ""} ${bloqueado ? "disabled" : ""}>
          <span class="${P}tag">${esc(fmtTag(a))}</span>
          <span class="${P}mapa-asignar-texto">${esc([a.tipo, [a.marca, a.modelo].filter(Boolean).join(" ")].filter(Boolean).join(" · "))}<span class="${P}mapa-muted">${a.custodio ? ` · ${esc(a.custodio.nombre)}` : ""}${donde ? ` · ahora en ${esc(donde.nombre)}` : ""}${bloqueado ? ` · ${esc(bloqueado)} (se mueve desde el equipo)` : ""}</span></span>
        </label></li>`;
      }).join("") : `<li class="${P}mapa-vacio">${incluirUbicados ? "Ningún activo coincide." : "Ningún activo sin ubicación coincide. Marca «Incluir los que ya están en otra ubicación» para moverlos aquí."}</li>`;
      cuenta.textContent = `${elegidos.size} marcado${elegidos.size === 1 ? "" : "s"} · ${visibles.length} en la lista`;
      guardar.disabled = elegidos.size === 0;
      guardar.textContent = elegidos.size ? `Asignar (${elegidos.size})` : "Asignar";
    };
    pintar();
    filtro.addEventListener("input", pintar);
    $(`#${P}asignar-incluir`).addEventListener("change", e=>{ incluirUbicados = e.target.checked; pintar(); });
    lista.addEventListener("change", e=>{
      if(e.target.type !== "checkbox") return;
      const id = Number(e.target.value);
      if(e.target.checked) elegidos.add(id); else elegidos.delete(id);
      cuenta.textContent = `${elegidos.size} marcado${elegidos.size === 1 ? "" : "s"} · ${visibles.length} en la lista`;
      guardar.disabled = elegidos.size === 0;
      guardar.textContent = elegidos.size ? `Asignar (${elegidos.size})` : "Asignar";
    });
    $(`#${P}asignar-todos`).addEventListener("click", ()=>{ visibles.filter(a=>!bloqueo(a)).forEach(a=>elegidos.add(a.id)); pintar(); });
    $(`#${P}asignar-ninguno`).addEventListener("click", ()=>{ elegidos.clear(); pintar(); });

    guardar.addEventListener("click", async e=>{
      const fecha = $(`#${P}asignar-fecha`).value;
      const errorFecha = validarFechaMovimiento(fecha, null);
      if(errorFecha){ mostrarErrores(raiz, {}, errorFecha); return; }
      mostrarErrores(raiz, {}, "");
      try{
        const r = await conBotonOcupado(e.currentTarget, "Asignando…", ()=>asignarActivosAUbicacion([...elegidos], ubicacionId, { fecha, notas: $(`#${P}asignar-notas`).value }));
        if(r.asignados === 0){
          mostrarErrores(raiz, {}, "No se asignó ninguno: " + r.omitidos.map(o=>`${fmtTag(indices.activoPorId.get(o.id) || { id: o.id })} ${o.motivo}`).join("; "));
          return;
        }
        cerrarModal();
        mostrarToast(`${r.asignados} activo${r.asignados === 1 ? "" : "s"} asignado${r.asignados === 1 ? "" : "s"} a «${u.nombre}».`, "success");
        if(r.omitidos.length) mostrarToast(`Omitidos: ${r.omitidos.map(o=>`${fmtTag(indices.activoPorId.get(o.id) || { id: o.id })} (${o.motivo})`).join("; ")}`, "info");
        if(alGuardar) alGuardar();
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
  });
}

// ===========================================================================
// Mover (o asignar por primera vez) un activo a otra ubicación.
// alCancelar permite volver a la vista de donde se abrió (p. ej. el detalle).
// ===========================================================================
export async function abrirMoverActivo(activoId, { alGuardar, alCancelar } = {}){
  try{
    if(!estadoMapa().cargado) await refrescarDatosMapa();
  }catch(err){
    mostrarToast("No se pudieron cargar las ubicaciones: " + err.message, "error");
    return;
  }
  const indices = indicesMapa();
  const a = indices.activoPorId.get(activoId);
  if(!a){ mostrarToast("No se encontró el activo.", "error"); return; }
  const equipo = indices.equipoPorActivo.get(activoId);
  const vigente = indices.vigentePorActivo.get(activoId);
  const actual = vigente ? indices.ubicacionPorId.get(vigente.ubicacion_id) : null;
  if(equipo){
    mostrarToast(`${fmtTag(a)} es el equipo de radioenlace «${equipo.nombre}»: se mueve editando ese equipo en el mapa.`, "info");
    return;
  }
  const opciones = opcionesUbicacion(null, { excluir: actual ? actual.id : null });
  const hoy = hoyLocalISO();

  // ✕ y Cancelar cierran como cualquier modal (abrirModal los conecta a
  // cerrarModal por su clase); si hay alCancelar, además se vuelve a donde
  // se abrió.
  const html = `<div class="${P}modal">
    <div class="${P}modal-header"><h3>${actual ? "Mover" : "Asignar ubicación a"} ${esc(fmtTag(a))}</h3><button type="button" class="${P}modal-close" data-cancelar aria-label="Cerrar">✕</button></div>
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}mapa-campo-fijo">${esc(etiquetaActivo(a))}<br><span class="${P}mapa-muted">${actual ? `Ahora en «${esc(actual.nombre)}» desde ${fmtFecha(vigente.desde)}` : "Sin ubicación asignada"}</span></div>
      ${opciones ? `<div class="${P}form-grid" style="margin-top:12px;">
        <div class="${P}field ${P}span-2">
          <label for="${P}mover-destino">${actual ? "Nueva ubicación" : "Ubicación"}</label>
          <select id="${P}mover-destino"><option value="">— Elige —</option>${opciones}</select>
        </div>
        <div class="${P}field">
          <label for="${P}mover-fecha">Fecha</label>
          <input type="date" id="${P}mover-fecha" value="${hoy}" max="${hoy}" ${vigente ? `min="${vigente.desde}"` : ""}>
        </div>
        <div class="${P}field">
          <label for="${P}mover-notas">Notas <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}mover-notas" maxlength="300">
        </div>
      </div>` : `<div class="${P}alert ${P}alert-info" style="margin-top:12px;">No hay otras ubicaciones activas. Un administrador puede crearlas desde la pestaña Mapa.</div>`}
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close" data-cancelar>Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}mover-guardar" ${opciones ? "" : "disabled"}>${actual ? "Mover" : "Asignar"}</button>
    </div>
  </div>`;

  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    if(alCancelar) raiz.querySelectorAll("[data-cancelar]").forEach(b=>b.addEventListener("click", ()=>alCancelar()));
    const guardar = $(`#${P}mover-guardar`);
    if(!opciones) return;
    guardar.addEventListener("click", async e=>{
      const destino = Number($(`#${P}mover-destino`).value);
      const fecha = $(`#${P}mover-fecha`).value;
      if(!destino){ mostrarErrores(raiz, {}, "Elige la ubicación de destino."); return; }
      const errorFecha = validarFechaMovimiento(fecha, vigente);
      if(errorFecha){ mostrarErrores(raiz, {}, errorFecha); return; }
      mostrarErrores(raiz, {}, "");
      try{
        const r = await conBotonOcupado(e.currentTarget, "Guardando…", ()=>asignarActivosAUbicacion([activoId], destino, { fecha, notas: $(`#${P}mover-notas`).value }));
        if(!r.asignados){ mostrarErrores(raiz, {}, r.omitidos.map(o=>o.motivo).join("; ") || "No se pudo mover."); return; }
        const u = indicesMapa().ubicacionPorId.get(destino);
        cerrarModal();
        mostrarToast(`${fmtTag(a)} ${actual ? "movido" : "asignado"} a «${u ? u.nombre : "la ubicación"}».`, "success");
        if(alGuardar) alGuardar(destino);
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
  });
}
