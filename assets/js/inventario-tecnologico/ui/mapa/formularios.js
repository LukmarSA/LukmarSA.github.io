// Modales del mapa: ubicación, equipo (con su servidor), respaldo, asignar
// activos y mover un activo. Usan el mismo sistema de modales de la app
// (abrirModal/cerrarModal) y, al guardar, avisan con mostrarToast y devuelven
// el control con alGuardar.
import { cargarActivos, hayCamposConfigurables } from "../../nucleo/datos.js";
import { cargarAtajos, cargarEquiposRadioenlace, cargarPiscinas, cargarRedes, cargarRespaldos, cargarTiposEquipo, cargarTiposUbicacion, cargarUbicaciones, datosNombres, estadoMapa, hayHerenciaRed, hayMedio, hayNombresConRed, hayRedFinca, indicesMapa, redMapa, refrescarDatosMapa } from "../../nucleo/datos-mapa.js";
import { GENEROS, nombreParaGuardar, nombresAutomaticos } from "../../nucleo/mapa-nombres.js";
import { azimutGrados, distanciaKm, fmtAzimut, fmtCoordenadas, fmtDistancia, parsearCoordenadas } from "../../nucleo/geo.js";
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { coincideActivo, hoyLocalISO, infoTipoUbicacion, ordenarUbicaciones, validarFechaMovimiento } from "../../nucleo/mapa-logica.js";
import { MEDIOS, candidatosRespaldo, candidatosServidor, describirConexion, esMedio, herederosDeRed, redEfectivaDe, redHeredadaDe, redesEfectivas, siguientePrioridad } from "../../nucleo/mapa-jerarquia.js";
import { opcionesVigentes } from "../../nucleo/opciones-configurables.js";
import { esAdmin } from "../../nucleo/permisos.js";
import { cuadradoAlrededor, sectorDeNombre } from "../../nucleo/piscinas.js";
import { medioSugerido, motivoMedioSugerido, opcionesServidor } from "../../nucleo/selector-servidor.js";
import { montarSelectorServidor } from "./selector-servidor.js";
import { htmlPin } from "./leaflet.js";
import { validarSvg } from "../../nucleo/svg-seguro.js";
import { ErrorValidacion, asignarActivosAUbicacion, asignarEnLote, crearAtajo, crearPiscina, editarPiscina, eliminarPiscina, crearEquipo, crearRed, crearRespaldo, crearTipoEquipo, crearTipoUbicacion, crearUbicacion, editarAtajo, editarEquipo, editarRed, editarRespaldo, editarTipoEquipo, editarTipoUbicacion, editarUbicacion, eliminarAtajo, eliminarRed } from "../../negocio/operaciones-mapa.js";
import { urlFoto } from "../../negocio/operaciones.js";
import { abrirModal, cerrarModal, mostrarToast } from "../render-raiz.js";

const P = "inventario-tecnologico-";

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

// d = { servidor, ubicacionServidor, medio, mismaUbicacion, distanciaKm, azimutIda, azimutVuelta }
// (sin medio: cable si es la misma ubicación, radio si es otra).
function textoConexion(d){
  if(!d) return "";
  const misma = d.mismaUbicacion ?? d.cable;
  const medio = d.medio || (misma ? "cable" : "inalambrico");
  const donde = `«${d.ubicacionServidor ? d.ubicacionServidor.nombre : "—"}»`;
  if(misma){
    if(medio === "inalambrico") return `Inalámbrico con «${d.servidor.nombre}», en la misma ubicación (no se dibuja línea).`;
    return `Por ${medio === "fibra" ? "fibra óptica" : "cable"}: «${d.servidor.nombre}» está en la misma ubicación (no se dibuja línea).`;
  }
  if(medio !== "inalambrico") return `Por ${medio === "fibra" ? "fibra óptica" : "cable"} hasta «${d.servidor.nombre}» en ${donde}: ${fmtDistancia(d.distanciaKm)}. En el mapa se dibuja como línea de ${medio === "fibra" ? "fibra" : "cable"}.`;
  return `Radioenlace con «${d.servidor.nombre}» en ${donde}: ${fmtDistancia(d.distanciaKm)} · azimut desde aquí ${fmtAzimut(d.azimutIda)} · desde allá ${fmtAzimut(d.azimutVuelta)}`;
}

// ===========================================================================
// Ubicación (crear / editar). "Elegir en el mapa" cierra el modal, deja
// hacer clic en el mapa y lo vuelve a abrir con lo ya escrito (borrador).
// ===========================================================================
export function abrirFormUbicacion({ id = null, borrador = null, lat = null, lng = null } = {}, { alGuardar, alElegirEnMapa, alCambiarTipo } = {}){
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
            ${esAdmin() ? `<button type="button" class="${P}btn ${P}btn-sm" id="${P}ubic-btn-mas-tipo" title="Nuevo tipo de ubicación" aria-label="Nuevo tipo de ubicación">+</button>
            <button type="button" class="${P}btn ${P}btn-sm" id="${P}ubic-btn-editar-tipo" title="Editar el tipo elegido" aria-label="Editar el tipo elegido">✎</button>` : ""}
          </div>
          <div class="${P}mapa-mini-form" id="${P}ubic-mini-tipo" hidden>
            <span class="${P}mapa-mini-titulo" id="${P}ubic-tipo-titulo">Nuevo tipo de ubicación</span>
            <input type="text" id="${P}ubic-tipo-etiqueta" maxlength="40" placeholder="Nombre del tipo (ej.: Repetidora)" aria-label="Nombre del tipo">
            <input type="color" id="${P}ubic-tipo-color" value="#5B4B8A" aria-label="Color del tipo">
            ${hayCamposConfigurables() ? `<div class="${P}mapa-mini-icono">
              <textarea id="${P}ubic-tipo-icono" class="${P}mono" rows="2" placeholder="Ícono SVG (opcional): pega el &lt;svg&gt;…&lt;/svg&gt;, con viewBox. Vacío = el dibujo de siempre." aria-label="Ícono SVG del tipo (opcional)"></textarea>
              <span class="${P}mapa-mini-vista" id="${P}ubic-tipo-vista" aria-hidden="true" title="Así se verá en la burbuja"></span>
            </div>` : ""}
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

    // "+" tipo de ubicación y "✎" (editar el elegido), solo admin, sin cerrar
    // el formulario: un mismo mini formulario, en modo crear o editar.
    const mas = $(`#${P}ubic-btn-mas-tipo`);
    if(mas){
      const mini = $(`#${P}ubic-mini-tipo`);
      const errorMini = $(`#${P}ubic-tipo-error`);
      const inEtiqueta = $(`#${P}ubic-tipo-etiqueta`);
      const inColor = $(`#${P}ubic-tipo-color`);
      const inIcono = $(`#${P}ubic-tipo-icono`);
      const vista = $(`#${P}ubic-tipo-vista`);
      const botonGuardar = $(`#${P}ubic-tipo-crear`);
      let editando = null; // valor del tipo que se edita, o null al crear
      const pintarVista = ()=>{
        if(!vista || !inIcono) return;
        const v = validarSvg(inIcono.value, { exigirViewBox: true });
        // La vista previa es el mismo pin del mapa (ui/mapa/leaflet.js).
        vista.innerHTML = htmlPin({ color: inColor.value, tipo: editando || "", icono: v.ok && v.svg ? v.svg : null });
        vista.classList.toggle(`${P}mapa-mini-vista-error`, !v.ok);
        vista.title = v.ok ? "Así se verá en la burbuja" : v.error;
      };
      const abrir = modo=>{
        errorMini.textContent = "";
        const t = modo === "editar" ? cargarTiposUbicacion().find(x=>x.valor === selTipo.value) : null;
        if(modo === "editar" && !t){ mostrarToast("Elige primero un tipo.", "error"); return; }
        editando = t ? t.valor : null;
        $(`#${P}ubic-tipo-titulo`).textContent = t ? `Editar el tipo «${t.etiqueta}»` : "Nuevo tipo de ubicación";
        inEtiqueta.value = t ? t.etiqueta : "";
        inColor.value = t ? (t.color || "#57697C") : "#5B4B8A";
        if(inIcono) inIcono.value = t && t.icono_svg ? t.icono_svg : "";
        botonGuardar.textContent = t ? "Guardar" : "Crear";
        mini.hidden = false;
        pintarVista();
        inEtiqueta.focus();
      };
      mas.addEventListener("click", ()=>{ if(!mini.hidden && editando === null){ mini.hidden = true; return; } abrir("crear"); });
      const lapiz = $(`#${P}ubic-btn-editar-tipo`);
      if(lapiz) lapiz.addEventListener("click", ()=>{ if(!mini.hidden && editando !== null && editando === selTipo.value){ mini.hidden = true; return; } abrir("editar"); });
      if(inIcono) inIcono.addEventListener("input", pintarVista);
      inColor.addEventListener("input", pintarVista);
      $(`#${P}ubic-tipo-cancelar`).addEventListener("click", ()=>{ mini.hidden = true; errorMini.textContent = ""; });
      botonGuardar.addEventListener("click", async e=>{
        errorMini.textContent = "";
        const etiqueta = inEtiqueta.value;
        const color = inColor.value;
        const icono = inIcono ? inIcono.value : undefined;
        try{
          if(editando === null){
            const valor = await conBotonOcupado(e.currentTarget, "Creando…", ()=>crearTipoUbicacion(etiqueta, color, icono));
            pintarTipos(valor);
            mostrarToast(`Tipo «${etiqueta.trim()}» creado.`, "success");
          } else {
            const valor = editando;
            await conBotonOcupado(e.currentTarget, "Guardando…", ()=>editarTipoUbicacion(valor, { etiqueta, color, icono_svg: icono }));
            pintarTipos(valor);
            mostrarToast(`Tipo «${etiqueta.trim()}» guardado.`, "success");
          }
          // El mapa de atrás se repinta ya (color e ícono de las burbujas de ese tipo).
          if(alCambiarTipo) alCambiarTipo();
          mini.hidden = true;
          inEtiqueta.value = "";
          if(inIcono) inIcono.value = "";
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
  // Se recalculan si al guardar se registra un activo como servidor (v8).
  let red = redMapa();
  let indicesVivos = indices;
  const servidorActual = actual && actual.servidor_id !== null && actual.servidor_id !== undefined ? actual.servidor_id : null;
  const clientesActuales = id ? (red.clientes.get(id) || []).length : 0;

  // Con la migración 007 el nombre no se escribe: se arma solo con el tipo, la
  // ubicación, el servidor y la referencia (y se ve en vivo abajo).
  const conRed = hayRedFinca();
  const tipos = conRed ? opcionesVigentes(cargarTiposEquipo(), actual ? actual.tipo_equipo : null, "valor") : [];
  const redes = conRed ? cargarRedes().filter(r=>r.activa !== false || (actual && r.id === actual.red_id)) : [];
  // 011: la red se hereda del servidor; aquí se elige solo la PROPIA (vacío = heredar).
  const herencia = conRed && hayHerenciaRed();
  const camposNombre = conRed ? `
        <div class="${P}field">
          <label for="${P}equipo-tipo">Tipo de equipo</label>
          <select id="${P}equipo-tipo">
            <option value="">— Elige el tipo —</option>
            ${tipos.map(x=>`<option value="${esc(x.valor)}" ${actual && actual.tipo_equipo === x.valor ? "selected" : ""}>${esc(x.etiqueta)}${x.activo === false ? " (inactivo)" : ""}</option>`).join("")}
          </select>
          <div class="${P}field-error" data-error="tipo_equipo"></div>
        </div>
        <div class="${P}field">
          <label for="${P}equipo-referencia">Referencia <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}equipo-referencia" maxlength="60" value="${esc(actual && actual.referencia || "")}" placeholder="Ej.: Norte, Bomba 2">
          <div class="${P}field-error" data-error="referencia"></div>
        </div>` : `
        <div class="${P}field">
          <label for="${P}equipo-nombre">Nombre</label>
          <input type="text" id="${P}equipo-nombre" maxlength="120" value="${esc(actual ? actual.nombre : "")}" placeholder="Ej.: PTP Cerro Azul → Santa Ana">
          <div class="${P}field-error" data-error="nombre"></div>
        </div>`;
  const campoRed = conRed ? `
        <div class="${P}field">
          <label for="${P}equipo-red">Red</label>
          <select id="${P}equipo-red"${herencia ? ` aria-describedby="${P}equipo-red-ayuda"` : ""}>
            <option value="">— Sin red —</option>
            ${redes.map(r=>`<option value="${r.id}" ${actual && actual.red_id === r.id ? "selected" : ""}>${esc(r.nombre)}${r.activa === false ? " (inactiva)" : ""}</option>`).join("")}
          </select>
          ${redes.length ? "" : `<div class="${P}hint">Todavía no hay redes: se crean en «Redes y tipos», en la barra del mapa.</div>`}
          ${herencia ? `<div class="${P}hint ${P}mapa-red-ayuda" id="${P}equipo-red-ayuda"></div>` : ""}
        </div>` : "";
  // 008: medio del enlace con el servidor (vacío = automático).
  const conMedio = hayMedio();
  const campoMedio = conMedio ? `
        <div class="${P}field" id="${P}equipo-medio-campo">
          <label for="${P}equipo-medio">Medio de la conexión</label>
          <select id="${P}equipo-medio">
            <option value="">Automático</option>
            ${MEDIOS.map(m=>`<option value="${m.id}" ${actual && actual.medio === m.id ? "selected" : ""}>${esc(m.etiqueta)}</option>`).join("")}
          </select>
          <div class="${P}hint" id="${P}equipo-medio-ayuda"></div>
        </div>` : "";
  const vistaNombre = conRed ? `
        <div class="${P}field ${P}span-2">
          <span class="${P}field-titulo">Nombre <span class="${P}mapa-muted">(automático)</span></span>
          <output class="${P}mapa-nombre-auto" id="${P}equipo-nombre-auto" aria-live="polite"></output>
          <div class="${P}hint">Se arma con el tipo, la ubicación y el servidor; la referencia distingue equipos iguales.${actual && !actual.tipo_equipo ? ` Nombre actual: «${esc(actual.nombre)}».` : ""}</div>
          <div class="${P}field-error" data-error="nombre"></div>
        </div>` : "";

  const html = `<div class="${P}modal">
    ${cabecera(id ? "Editar equipo de red" : "Nuevo equipo de red")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}form-grid">
        <div class="${P}field ${P}span-2">
          <label for="${P}equipo-ubicacion">Ubicación</label>
          <select id="${P}equipo-ubicacion">${opcionesUbicacion(ubicId)}</select>
          <div class="${P}field-error" data-error="ubicacion_id"></div>
        </div>
        ${camposNombre}
        <div class="${P}field ${P}span-2">
          <label for="${P}equipo-servidor">Servidor <span class="${P}mapa-muted">(de dónde recibe la conexión)</span></label>
          <select id="${P}equipo-servidor"></select>
          <div class="${P}hint" id="${P}equipo-servidor-calculo"></div>
          <div class="${P}field-error" data-error="servidor_id"></div>
        </div>
        ${campoMedio}
        ${campoRed}
        <div class="${P}field${conRed && !conMedio ? "" : ` ${P}span-2`}">
          <label for="${P}equipo-modelo">Modelo <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}equipo-modelo" maxlength="120" value="${esc(actual && actual.modelo || "")}" placeholder="Ej.: Cambium PTP 550">
        </div>
        ${vistaNombre}
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
    // los que dependen de él (armarían un ciclo; la base también lo rechaza),
    // más los activos del inventario ya ubicados cuyo tipo es de red (p. ej. el
    // Router del Data Center): se registran como equipo de red al guardar.
    // Selector con búsqueda, filtros y orden (ui/mapa/selector-servidor.js).
    const selServ = $(`#${P}equipo-servidor`);
    const calculoServ = $(`#${P}equipo-servidor-calculo`);
    const selTipo = $(`#${P}equipo-tipo`);
    const selRedEquipo = $(`#${P}equipo-red`);
    const nombreNuevoServidor = ({ tipo, ubicacion })=>nombreParaGuardar({ ubicacion_id: ubicacion.id, tipo_equipo: tipo, referencia: null, red_id: null, servidor_id: null }, datosNombres(), null)
      || `${(cargarTiposEquipo().find(x=>x.valor === tipo) || {}).etiqueta || tipo} en ${ubicacion.nombre}`;
    const selector = montarSelectorServidor(selServ, {
      id: `${P}equipo-servidor`,
      obtener: ()=>({ opciones: opcionesServidor({
        candidatos: candidatosServidor(red, id), ubicacionId: Number(selUbic.value), ubicacionPorId: indicesVivos.ubicacionPorId,
        tiposEquipo: conRed ? cargarTiposEquipo() : [], redes: conRed ? cargarRedes() : [],
        conActivos: conRed, activos: cargarActivos().activos, vigentePorActivo: indicesVivos.vigentePorActivo, equipoPorActivo: indicesVivos.equipoPorActivo,
        excluirActivos: [activoElegido], nombreNuevo: nombreNuevoServidor, tagActivo: fmtTag,
      }) }),
      ninguno: { texto: "Ninguno: es una raíz (entrada de internet)", meta: "No recibe la conexión de otro equipo de la red" },
      etiquetaDialogo: "Elegir el servidor del equipo",
      textoVacio: "Ningún equipo coincide con la búsqueda o los filtros.",
      ayudaVacio: conRed ? "¿No está? Regístralo en su ubicación («+ Equipo» en su panel), o asigna el activo del inventario a su ubicación y aparecerá aquí." : "",
    });
    if(servidorActual !== null) selector.elegir(String(servidorActual));
    const etiquetaServ = raiz.querySelector(`label[for="${P}equipo-servidor"]`);
    if(etiquetaServ) etiquetaServ.htmlFor = `${P}equipo-servidor-boton`;
    const selMedio = $(`#${P}equipo-medio`);
    const campoMedioEl = $(`#${P}equipo-medio-campo`);
    const ayudaMedio = $(`#${P}equipo-medio-ayuda`);
    const tipoCliente = ()=>selTipo ? (selTipo.value || null) : (actual && actual.tipo_equipo || null);
    // Si el servidor está en otra ubicación y un extremo no hace radio (un
    // Router, un Switch…), "Automático" diría inalámbrico: se propone Cable.
    // Solo al cambiar algo (no al abrir) y sin pisar un medio elegido a mano.
    let medioPuestoPorSugerencia = false;
    const aplicarSugerenciaMedio = ()=>{
      if(!selMedio) return;
      const op = selector.elegida();
      const sug = op ? medioSugerido({ clienteTipo: tipoCliente(), servidorTipo: op.tipo, misma: op.ubicacionId === Number(selUbic.value) }) : null;
      if(sug && (selMedio.value === "" || medioPuestoPorSugerencia)){ selMedio.value = sug; medioPuestoPorSugerencia = true; }
      else if(!sug && medioPuestoPorSugerencia){ selMedio.value = ""; medioPuestoPorSugerencia = false; }
    };
    const pintarCalculoServ = ()=>{
      const op = selector.elegida();
      if(campoMedioEl) campoMedioEl.hidden = !op;
      if(!op){ calculoServ.textContent = clientesActuales ? `Queda como raíz. Sus ${clientesActuales} cliente(s) siguen colgando de él.` : "Queda como raíz: punto de entrada de internet."; return; }
      const uA = indicesVivos.ubicacionPorId.get(Number(selUbic.value));
      const uS = indicesVivos.ubicacionPorId.get(op.ubicacionId);
      if(!uA || !uS){ calculoServ.textContent = ""; return; }
      const misma = uA.id === uS.id;
      const auto = misma ? "cable" : "inalambrico";
      const medio = selMedio && esMedio(selMedio.value) ? selMedio.value : auto;
      if(ayudaMedio){
        if(medioPuestoPorSugerencia && selMedio && selMedio.value){
          const motivo = motivoMedioSugerido({ clienteTipo: tipoCliente(), servidorTipo: op.tipo }, cargarTiposEquipo());
          ayudaMedio.innerHTML = `<span class="${P}mapa-medio-sugerido">Puesto en «${esc((MEDIOS.find(m=>m.id === selMedio.value) || {}).etiqueta || selMedio.value)}»</span>${motivo ? `: ${esc(motivo)}` : ""}. Cámbialo si la conexión es otra.`;
        }else ayudaMedio.textContent = selMedio && selMedio.value ? "" : `Automático: ${misma ? "cable (misma ubicación)" : "inalámbrico (otra ubicación)"}.`;
      }
      let texto = textoConexion({ servidor: { nombre: op.nombre }, ubicacionServidor: uS, medio, mismaUbicacion: misma, distanciaKm: distanciaKm(uA, uS), azimutIda: azimutGrados(uA, uS), azimutVuelta: azimutGrados(uS, uA) });
      if(op.origen === "activo") texto += ` Al guardar, el activo ${op.tag || ""} se registra como equipo de red de «${uS.nombre}» y queda como servidor.`;
      calculoServ.textContent = texto;
    };
    pintarCalculoServ();

    // Red (011): «Heredada del servidor: X» (vacío) o una red propia, que
    // hace de este equipo y lo que cuelga de él una red aparte. La misma red
    // que heredaría no se ofrece como propia (la base la dejaría vacía).
    const ayudaRed = $(`#${P}equipo-red-ayuda`);
    let redPropia = actual && actual.red_id !== null && actual.red_id !== undefined ? Number(actual.red_id) : null;
    const redDeLista = id=>cargarRedes().find(r=>r.id === id) || null;
    const heredable = ()=>{
      const op = selector.elegida();
      if(!op || op.origen !== "equipo") return { op, red: null, desde: null };
      const s = red.equipoPorId.get(op.id);
      const rid = redEfectivaDe(s);
      const desdeId = s ? (redHeredadaDe(s) ?? (rid !== null ? s.id : null)) : null;
      return { op, red: rid !== null ? redDeLista(rid) : null, desde: desdeId !== null ? red.equipoPorId.get(desdeId) || null : null };
    };
    function pintarRed(){
      if(!herencia || !selRedEquipo) return;
      const { op, red: rH, desde } = heredable();
      if(redPropia !== null && rH && redPropia === rH.id) redPropia = null;
      const vacia = op ? (rH ? `Heredada del servidor: ${rH.nombre}` : "Heredada del servidor (todavía sin red)") : "— Sin red —";
      selRedEquipo.innerHTML = `<option value="">${esc(vacia)}</option>`
        + redes.filter(r=>!rH || r.id !== rH.id).map(r=>`<option value="${r.id}">${esc(r.nombre)}${r.activa === false ? " (inactiva)" : ""}</option>`).join("");
      selRedEquipo.value = redPropia !== null ? String(redPropia) : "";
      if(!ayudaRed) return;
      const n = id ? herederosDeRed(red, id).length : 0;
      const cuelgan = n ? `${n === 1 ? "el equipo que cuelga" : `los ${n} equipos que cuelgan`} de él` : "";
      const propia = redPropia !== null ? redDeLista(redPropia) : null;
      if(propia){
        const aparte = rH ? `Red aparte de «${rH.nombre}», la de su servidor. ` : "";
        ayudaRed.textContent = aparte + (n ? `«${propia.nombre}» vale también para ${cuelgan} (los que tienen otra red propia la conservan).` : `Los equipos que cuelguen de él heredarán «${propia.nombre}».`);
      }else if(op && rH){
        ayudaRed.textContent = `La hereda de «${desde ? desde.nombre : op.nombre}»${n ? ` y la pasa a ${cuelgan}` : ""}. Si eliges otra, este equipo y lo que cuelga de él forman una red aparte.`;
      }else if(op){
        ayudaRed.textContent = "Su servidor todavía no tiene red: cuando la tenga, este equipo la hereda. También puedes darle una propia.";
      }else{
        ayudaRed.textContent = n ? `Sin red. Si le pones una, la heredan ${cuelgan} (salvo los que tienen otra propia).` : "Sin red. Si le pones una, la heredan los equipos que cuelguen de él.";
      }
    }
    pintarRed();
    selServ.addEventListener("change", ()=>{ aplicarSugerenciaMedio(); pintarCalculoServ(); pintarRed(); pintarNombre(); });

    // Nombre automático (007; con la red desde la 010), en vivo.
    const inputRef = $(`#${P}equipo-referencia`);
    const salidaNombre = $(`#${P}equipo-nombre-auto`);
    const filaNombre = ()=>{
      const op = selector.elegida();
      return {
        ubicacion_id: Number(selUbic.value), tipo_equipo: selTipo ? selTipo.value || null : null, referencia: inputRef ? inputRef.value : null,
        red_id: selRedEquipo && selRedEquipo.value ? Number(selRedEquipo.value) : null,
        servidor_id: op ? (op.origen === "activo" ? -1 : op.id) : null, medio: selMedio ? selMedio.value || null : null,
      };
    };
    // Un activo elegido como servidor todavía no es equipo: para armar el
    // nombre se lo suma como uno provisional (id -1) con el nombre que tendrá.
    const equiposParaNombre = ()=>{
      const op = selector.elegida();
      const base = cargarEquiposRadioenlace();
      return op && op.origen === "activo"
        ? [...base, { id: -1, ubicacion_id: op.ubicacionId, tipo_equipo: op.tipo, referencia: null, red_id: null, nombre: op.nombre, nombre_guardado: op.nombre, servidor_id: null }]
        : base;
    };
    const nombreAuto = ()=>nombreParaGuardar(filaNombre(), datosNombres(equiposParaNombre()), id);
    function pintarNombre(){
      if(!salidaNombre) return;
      // Elegido el tipo, se borra el aviso de "falta el tipo" de un intento anterior.
      const errorTipo = raiz.querySelector('[data-error="tipo_equipo"]');
      if(errorTipo && selTipo && selTipo.value) errorTipo.textContent = "";
      const n = nombreAuto();
      salidaNombre.textContent = n || "Elige el tipo de equipo para armar el nombre.";
      salidaNombre.classList.toggle(`${P}mapa-nombre-auto-vacio`, !n);
    }
    if(selTipo) selTipo.addEventListener("change", ()=>{ aplicarSugerenciaMedio(); pintarCalculoServ(); pintarNombre(); });
    if(inputRef) inputRef.addEventListener("input", pintarNombre);
    if(selRedEquipo) selRedEquipo.addEventListener("change", ()=>{
      if(herencia){ redPropia = selRedEquipo.value ? Number(selRedEquipo.value) : null; pintarRed(); }
      pintarNombre();
    });
    if(selMedio) selMedio.addEventListener("change", ()=>{ medioPuestoPorSugerencia = false; pintarCalculoServ(); pintarNombre(); });
    pintarNombre();

    pintarCandidatos();
    pintarAviso();
    filtro.addEventListener("input", pintarCandidatos);
    selUbic.addEventListener("change", ()=>{ pintarAviso(); selector.refrescar(); aplicarSugerenciaMedio(); pintarCalculoServ(); pintarNombre(); });
    sel.addEventListener("change", ()=>{
      activoElegido = sel.value ? Number(sel.value) : null;
      const modelo = $(`#${P}equipo-modelo`);
      const a = activoElegido !== null ? indices.activoPorId.get(activoElegido) : null;
      if(a && !modelo.value.trim()) modelo.value = [a.marca, a.modelo].filter(Boolean).join(" ");
      pintarAviso();
      // El activo vinculado a este equipo no puede ser también su servidor.
      selector.refrescar(); pintarCalculoServ(); pintarNombre();
    });

    $(`#${P}equipo-guardar`).addEventListener("click", async e=>{
      mostrarErrores(raiz, {}, "");
      const boton = e.currentTarget;
      if(conRed && !selTipo.value){ mostrarErrores(raiz, { tipo_equipo: "Elige el tipo de equipo: con él se arma el nombre." }, ""); selTipo.focus(); return; }
      // Servidor elegido entre los activos del inventario: primero se lo
      // registra como equipo de red en su ubicación (raíz, con su activo).
      const opServ = selector.elegida();
      let registrado = null;
      if(opServ && opServ.origen === "activo"){
        try{
          registrado = await conBotonOcupado(boton, "Registrando el servidor…", ()=>crearEquipo({
            ubicacion_id: opServ.ubicacionId, nombre: opServ.nombre, modelo: opServ.modelo, activo_id: opServ.activoId, notas: null, servidor_id: null,
            tipo_equipo: opServ.tipo, referencia: null, red_id: null, ...(conMedio ? { medio: null } : {}),
          }));
        }catch(err){
          mostrarErrores(raiz, { servidor_id: `No se pudo registrar «${opServ.nombre}» como equipo de red: ${err.message}` }, "");
          return;
        }
        // Desde aquí ya es un equipo de red: si lo que sigue falla, queda elegido como tal.
        red = redMapa();
        indicesVivos = indicesMapa();
        selector.refrescar();
        selector.elegir(String(registrado));
        pintarCalculoServ();
        pintarRed();
        pintarNombre();
      }
      const campos = {
        ubicacion_id: Number(selUbic.value),
        nombre: conRed ? (nombreAuto() || "") : $(`#${P}equipo-nombre`).value,
        modelo: $(`#${P}equipo-modelo`).value,
        activo_id: activoElegido,
        notas: $(`#${P}equipo-notas`).value,
        servidor_id: selServ.value ? Number(selServ.value) : null,
        // Banda y frecuencia ya no se piden (a la persona no le interesan):
        // no se envían, así lo que ya tenga guardado un equipo no se borra.
      };
      if(conRed){
        campos.tipo_equipo = selTipo.value || null;
        campos.referencia = inputRef.value;
        campos.red_id = selRedEquipo.value ? Number(selRedEquipo.value) : null;
      }
      if(conMedio) campos.medio = campos.servidor_id === null ? null : (selMedio.value || null);
      // Si el servidor elegido era uno de sus respaldos, la base lo quita de los respaldos.
      const promovido = id && campos.servidor_id !== null && campos.servidor_id !== servidorActual
        && cargarRespaldos().some(r=>r.equipo_id === id && r.servidor_alternativo_id === campos.servidor_id);
      try{
        const nuevoId = await conBotonOcupado(boton, "Guardando…", ()=>id ? editarEquipo(id, campos).then(()=>id) : crearEquipo(campos));
        cerrarModal();
        mostrarToast(id ? "Equipo actualizado." : `Equipo «${campos.nombre.trim()}» creado.`, "success");
        if(registrado !== null) mostrarToast(`«${opServ.nombre}» quedó registrado como equipo de red y es su servidor.`, "info");
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
  const candidatosResp = candidatosRespaldo(red, eqId, id);
  const opciones = candidatosResp.length > 0;
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
            ? `<select id="${P}respaldo-servidor"></select>`
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
    if(sel){
      const conRed = hayRedFinca();
      const selectorResp = montarSelectorServidor(sel, {
        id: `${P}respaldo-servidor`,
        obtener: ()=>({ opciones: opcionesServidor({ candidatos: candidatosResp, ubicacionId: equipo.ubicacion_id, ubicacionPorId: red.ubicacionPorId, tiposEquipo: conRed ? cargarTiposEquipo() : [], redes: conRed ? cargarRedes() : [] }) }),
        placeholder: "— Elige un equipo —",
        etiquetaDialogo: "Elegir el servidor de respaldo",
        etiquetaLista: "Posibles servidores de respaldo",
        textoVacio: "Ningún equipo coincide con la búsqueda o los filtros.",
      });
      if(actual) selectorResp.elegir(String(actual.servidor_alternativo_id));
      const etiqueta = raiz.querySelector(`label[for="${P}respaldo-servidor"]`);
      if(etiqueta) etiqueta.htmlFor = `${P}respaldo-servidor-boton`;
    }
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

// ===========================================================================
// Red de la finca (migración 007): atajos de simulación, redes y tipos.
// ===========================================================================
function nombreDeEquipo(id){
  const e = cargarEquiposRadioenlace().find(x=>x.id === id);
  return e ? e.nombre : `equipo #${id}`;
}
function listaEquiposHtml(ids, { quitar = false } = {}){
  if(!ids.length) return `<div class="${P}mapa-vacio">Sin equipos.</div>`;
  return `<ul class="${P}mapa-atajo-equipos">${ids.map(id=>`<li><span>${esc(nombreDeEquipo(id))}</span>${quitar ? `<button type="button" class="${P}btn ${P}btn-sm ${P}btn-ghost" data-quitar-equipo="${id}" aria-label="Quitar «${esc(nombreDeEquipo(id))}» del atajo">✕</button>` : ""}</li>`).join("")}</ul>`;
}

// Guarda los equipos caídos ahora (a mano + atajos encendidos) como un atajo con nombre.
export function abrirGuardarAtajo({ equipos = [] } = {}, { alGuardar } = {}){
  if(!equipos.length){ mostrarToast("No hay equipos caídos para guardar: marca alguno primero.", "info"); return; }
  const html = `<div class="${P}modal ${P}modal-angosto">
    ${cabecera("Guardar caídas como atajo")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}field">
        <label for="${P}atajo-nombre">Nombre del atajo</label>
        <input type="text" id="${P}atajo-nombre" maxlength="60" placeholder="Ej.: Red Cámaras, PtP Torre K" autocomplete="off">
        <div class="${P}field-error" data-error="nombre"></div>
      </div>
      <div class="${P}field">
        <span class="${P}field-titulo">Equipos que apaga (${equipos.length})</span>
        ${listaEquiposHtml(equipos)}
        <div class="${P}field-error" data-error="equipos"></div>
      </div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}atajo-guardar">Guardar atajo</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const raiz = raizModal();
    const nombre = raiz.querySelector(`#${P}atajo-nombre`);
    const guardar = async boton=>{
      mostrarErrores(raiz, {}, "");
      try{
        const id = await conBotonOcupado(boton, "Guardando…", ()=>crearAtajo({ nombre: nombre.value, equipos }));
        cerrarModal();
        mostrarToast(`Atajo «${nombre.value.trim()}» guardado.`, "success");
        if(alGuardar) alGuardar(id);
      }catch(err){ manejarErrorGuardado(raiz, err); }
    };
    const boton = raiz.querySelector(`#${P}atajo-guardar`);
    boton.addEventListener("click", ()=>guardar(boton));
    nombre.addEventListener("keydown", e=>{ if(e.key === "Enter"){ e.preventDefault(); guardar(boton); } });
  });
}

export function abrirEditarAtajo(id, { caidosActuales = [], alGuardar } = {}){
  const atajo = cargarAtajos().find(a=>a.id === id);
  if(!atajo){ mostrarToast("Ese atajo ya no existe. Recarga el mapa.", "error"); return; }
  let equipos = [...(atajo.equipos || [])];
  const html = `<div class="${P}modal ${P}modal-angosto">
    ${cabecera("Editar atajo")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}field">
        <label for="${P}atajo-nombre">Nombre del atajo</label>
        <input type="text" id="${P}atajo-nombre" maxlength="60" value="${esc(atajo.nombre)}" autocomplete="off">
        <div class="${P}field-error" data-error="nombre"></div>
      </div>
      <div class="${P}field">
        <span class="${P}field-titulo" id="${P}atajo-equipos-titulo"></span>
        <div id="${P}atajo-equipos"></div>
        ${caidosActuales.length ? `<button type="button" class="${P}btn ${P}btn-sm" id="${P}atajo-usar-caidas">Usar las caídas actuales (${caidosActuales.length})</button>` : ""}
        <div class="${P}field-error" data-error="equipos"></div>
      </div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}btn-danger" id="${P}atajo-eliminar">Eliminar</button>
      <span class="${P}fb-spacer"></span>
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}atajo-guardar">Guardar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const raiz = raizModal();
    const cont = raiz.querySelector(`#${P}atajo-equipos`);
    const pintar = ()=>{
      raiz.querySelector(`#${P}atajo-equipos-titulo`).textContent = `Equipos que apaga (${equipos.length})`;
      cont.innerHTML = listaEquiposHtml(equipos, { quitar: true });
      cont.querySelectorAll("[data-quitar-equipo]").forEach(b=>b.addEventListener("click", ()=>{ equipos = equipos.filter(x=>x !== Number(b.dataset.quitarEquipo)); pintar(); }));
    };
    pintar();
    const usar = raiz.querySelector(`#${P}atajo-usar-caidas`);
    if(usar) usar.addEventListener("click", ()=>{ equipos = [...caidosActuales]; pintar(); });
    raiz.querySelector(`#${P}atajo-guardar`).addEventListener("click", async e=>{
      mostrarErrores(raiz, {}, "");
      try{
        await conBotonOcupado(e.currentTarget, "Guardando…", ()=>editarAtajo(id, { nombre: raiz.querySelector(`#${P}atajo-nombre`).value, equipos }));
        cerrarModal();
        mostrarToast("Atajo actualizado.", "success");
        if(alGuardar) alGuardar(id);
      }catch(err){ manejarErrorGuardado(raiz, err); }
    });
    // Eliminar pide confirmación en el mismo botón (sin abrir otro modal encima).
    const eliminar = raiz.querySelector(`#${P}atajo-eliminar`);
    eliminar.addEventListener("click", async ()=>{
      if(eliminar.dataset.confirmar !== "1"){ eliminar.dataset.confirmar = "1"; eliminar.textContent = "¿Eliminar? Confirmar"; return; }
      try{
        await conBotonOcupado(eliminar, "Eliminando…", ()=>eliminarAtajo(id));
        const sim = estadoMapa().simulacion;
        sim.atajos = (sim.atajos || []).filter(x=>x !== id);
        cerrarModal();
        mostrarToast("Atajo eliminado.", "success");
        if(alGuardar) alGuardar(id);
      }catch(err){ manejarErrorGuardado(raiz, err); }
    });
  });
}

// Redes de la finca y tipos de equipo (solo administrador).
export function abrirRedesYTipos({ alCambiar } = {}){
  const equipos = cargarEquiposRadioenlace();
  const cuenta = pred=>equipos.filter(pred).length;
  // Con la 011 cuentan también los que la heredan; se aclara cuántos la tienen propia.
  const cuentaRed = r=>{
    const total = cuenta(e=>redEfectivaDe(e) === r.id);
    const propios = cuenta(e=>e.red_id === r.id);
    return plural(total, "equipo", "equipos") + (hayHerenciaRed() && total > propios ? ` (${propios} con la red propia)` : "");
  };
  const filaRed = r=>`<li class="${P}catalogo-fila" data-red-id="${r.id}">
      <input type="color" value="${esc(r.color)}" aria-label="Color de ${esc(r.nombre)}" data-campo="color">
      <input type="text" value="${esc(r.nombre)}" maxlength="60" aria-label="Nombre de la red" data-campo="nombre">
      <label class="${P}catalogo-check"><input type="checkbox" data-campo="activa"${r.activa !== false ? " checked" : ""}> Activa</label>
      <span class="${P}mapa-muted ${P}catalogo-cuenta">${cuentaRed(r)}</span>
      <button type="button" class="${P}btn ${P}btn-sm" data-cat="guardar-red">Guardar</button>
      <button type="button" class="${P}btn ${P}btn-sm ${P}btn-ghost" data-cat="eliminar-red" title="Eliminar la red (sus equipos quedan sin red)">Eliminar</button>
    </li>`;
  const filaTipo = x=>`<li class="${P}catalogo-fila" data-tipo-valor="${esc(x.valor)}">
      <input type="text" value="${esc(x.etiqueta)}" maxlength="40" aria-label="Nombre del tipo" data-campo="etiqueta">
      <select data-campo="genero" aria-label="Género del tipo">${GENEROS.map(g=>`<option value="${g.id}"${x.genero === g.id ? " selected" : ""}>${g.id === "f" ? "la" : "el"}</option>`).join("")}</select>
      <label class="${P}catalogo-check"><input type="checkbox" data-campo="activo"${x.activo !== false ? " checked" : ""}> Activo</label>
      <span class="${P}mapa-muted ${P}catalogo-cuenta">${plural(cuenta(e=>e.tipo_equipo === x.valor), "equipo", "equipos")}</span>
      <button type="button" class="${P}btn ${P}btn-sm" data-cat="guardar-tipo">Guardar</button>
    </li>`;
  const html = `<div class="${P}modal ${P}modal-wide">
    ${cabecera("Redes y tipos de equipo")}
    <div class="${P}modal-body">
      <section class="${P}catalogo" aria-label="Redes de la finca">
        <div class="${P}section-title">Redes de la finca</div>
        <div class="${P}hint">Cada equipo de red pertenece a una red. Para apagar una red entera en la simulación, guarda un atajo con su router.</div>
        <ul class="${P}catalogo-lista">${cargarRedes().map(filaRed).join("") || `<li class="${P}mapa-vacio">Todavía no hay redes.</li>`}</ul>
        <div class="${P}catalogo-fila ${P}catalogo-nueva">
          <input type="color" value="#007EB2" id="${P}red-nueva-color" aria-label="Color de la red nueva">
          <input type="text" id="${P}red-nueva-nombre" maxlength="60" placeholder="Nombre de la red nueva (ej.: Red Cámaras)">
          <button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" data-cat="crear-red">+ Agregar red</button>
        </div>
      </section>
      <section class="${P}catalogo" aria-label="Tipos de equipo">
        <div class="${P}section-title">Tipos de equipo</div>
        <div class="${P}hint">El nombre del tipo arma el nombre automático de cada equipo («Estación en Torre K enlazada a Punto a Punto en Torre L»); el género hace concordar «enlazado/enlazada».</div>
        <ul class="${P}catalogo-lista">${cargarTiposEquipo().map(filaTipo).join("")}</ul>
        <div class="${P}catalogo-fila ${P}catalogo-nueva">
          <input type="text" id="${P}tipo-nuevo-etiqueta" maxlength="40" placeholder="Tipo nuevo (ej.: Cámara PTZ)">
          <select id="${P}tipo-nuevo-genero" aria-label="Género del tipo nuevo">${GENEROS.map(g=>`<option value="${g.id}">${g.id === "f" ? "la" : "el"}</option>`).join("")}</select>
          <button type="button" class="${P}btn ${P}btn-sm ${P}btn-primary" data-cat="crear-tipo">+ Agregar tipo</button>
        </div>
      </section>
    </div>
    <div class="${P}modal-footer">
      ${equipos.length ? `<button type="button" class="${P}btn" data-cat="lote" title="Elegir el tipo y la red de varios equipos a la vez">Asignar a varios equipos…</button>` : ""}
      <span class="${P}fb-spacer"></span>
      <button type="button" class="${P}btn ${P}modal-close">Cerrar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const raiz = raizModal();
    // Enter en un campo de texto = su botón (agregar o guardar esa fila).
    raiz.addEventListener("keydown", e=>{
      if(e.key !== "Enter" || e.target.tagName !== "INPUT" || e.target.type !== "text") return;
      const fila = e.target.closest(`.${P}catalogo-fila`);
      const boton = fila && fila.querySelector('[data-cat="crear-red"], [data-cat="crear-tipo"], [data-cat="guardar-red"], [data-cat="guardar-tipo"]');
      if(boton){ e.preventDefault(); boton.click(); }
    });
    const valor = (fila, campo)=>{ const el = fila.querySelector(`[data-campo="${campo}"]`); return el.type === "checkbox" ? el.checked : el.value; };
    const hecho = mensaje=>{ mostrarToast(mensaje, "success"); if(alCambiar) alCambiar(); abrirRedesYTipos({ alCambiar }); };
    raiz.addEventListener("click", async e=>{
      const b = e.target.closest("[data-cat]");
      if(!b) return;
      const fila = b.closest(`.${P}catalogo-fila`);
      if(b.dataset.cat === "lote") return abrirAsignacionEnLote({ alGuardar: alCambiar });
      try{
        switch(b.dataset.cat){
          case "crear-red": {
            const nombre = raiz.querySelector(`#${P}red-nueva-nombre`).value;
            await conBotonOcupado(b, "Agregando…", ()=>crearRed({ nombre, color: raiz.querySelector(`#${P}red-nueva-color`).value }));
            return hecho(`Red «${nombre.trim()}» creada.`);
          }
          case "guardar-red":
            await conBotonOcupado(b, "Guardando…", ()=>editarRed(Number(fila.dataset.redId), { nombre: valor(fila, "nombre"), color: valor(fila, "color"), activa: valor(fila, "activa") }));
            return hecho("Red guardada.");
          case "eliminar-red":
            if(b.dataset.confirmar !== "1"){ b.dataset.confirmar = "1"; b.textContent = "¿Eliminar? Confirmar"; return; }
            await conBotonOcupado(b, "Eliminando…", ()=>eliminarRed(Number(fila.dataset.redId)));
            return hecho("Red eliminada: sus equipos quedaron sin red.");
          case "crear-tipo": {
            const etiqueta = raiz.querySelector(`#${P}tipo-nuevo-etiqueta`).value;
            await conBotonOcupado(b, "Agregando…", ()=>crearTipoEquipo({ etiqueta, genero: raiz.querySelector(`#${P}tipo-nuevo-genero`).value }));
            return hecho(`Tipo «${etiqueta.trim()}» creado.`);
          }
          case "guardar-tipo":
            await conBotonOcupado(b, "Guardando…", ()=>editarTipoEquipo(fila.dataset.tipoValor, { etiqueta: valor(fila, "etiqueta"), genero: valor(fila, "genero"), activo: valor(fila, "activo") }));
            return hecho("Tipo guardado: los nombres automáticos ya lo usan.");
        }
      }catch(err){
        mostrarToast(err instanceof ErrorValidacion ? Object.values(err.errores)[0] : (err.message || String(err)), "error");
      }
    });
  });
}

// ===========================================================================
// Tipo y red en lote (007): elegir varios equipos (con filtros) y ponerles el
// mismo tipo y/o la misma red. Muestra cómo quedan los nombres automáticos
// antes de aplicar.
// ===========================================================================
const NO_CAMBIAR = "__igual";
export function abrirAsignacionEnLote({ alGuardar, seleccion = [] } = {}){
  const equipos = cargarEquiposRadioenlace();
  const ubicaciones = cargarUbicaciones();
  const tiposUbic = cargarTiposUbicacion();
  const tipos = cargarTiposEquipo();
  const redes = cargarRedes();
  const ubicPorId = new Map(ubicaciones.map(u=>[u.id, u]));
  const tipoPorValor = new Map(tipos.map(t=>[t.valor, t]));
  const redPorId = new Map(redes.map(r=>[r.id, r]));
  const elegidos = new Set(seleccion.filter(id=>equipos.some(e=>e.id === id)));
  const conEquipos = ordenarUbicaciones(ubicaciones.filter(u=>equipos.some(e=>e.ubicacion_id === u.id)), tiposUbic);
  // 011: la red se hereda del servidor. «Quitar» deja que la herede, y
  // ponerle una red a un equipo la pasa a lo que cuelga de él.
  const herencia = hayHerenciaRed();
  const porIdEq = new Map(equipos.map(e=>[e.id, e]));
  const html = `<div class="${P}modal ${P}modal-wide">
    ${cabecera("Tipo y red en lote")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}hint">Marca los equipos y elige qué ponerles. Lo que dejes en «No cambiar» queda como está.</div>
      <div class="${P}lote-filtros">
        <input type="search" id="${P}lote-buscar" placeholder="Filtrar por nombre, modelo o ubicación…" autocomplete="off" aria-label="Filtrar equipos">
        <select id="${P}lote-ubicacion" aria-label="Ubicación"><option value="">Todas las ubicaciones</option>${conEquipos.map(u=>`<option value="${u.id}">${esc(u.nombre)}</option>`).join("")}</select>
        <label class="${P}mapa-check"><input type="checkbox" id="${P}lote-sin-tipo"> Solo sin tipo</label>
        <label class="${P}mapa-check"><input type="checkbox" id="${P}lote-sin-red"> Solo sin red</label>
      </div>
      <div class="${P}lote-tabla">
        <table>
          <thead><tr>
            <th class="${P}lote-col-check"><input type="checkbox" id="${P}lote-todos" aria-label="Marcar todos los que se ven"></th>
            <th>Equipo</th><th>Ubicación</th><th>Tipo</th><th>Red</th>
          </tr></thead>
          <tbody id="${P}lote-filas"></tbody>
        </table>
      </div>
      <div class="${P}form-grid ${P}lote-cambios">
        <div class="${P}field">
          <label for="${P}lote-tipo">Tipo</label>
          <select id="${P}lote-tipo"><option value="${NO_CAMBIAR}">— No cambiar —</option>${tipos.filter(t=>t.activo !== false).map(t=>`<option value="${esc(t.valor)}">${esc(t.etiqueta)}</option>`).join("")}</select>
        </div>
        <div class="${P}field">
          <label for="${P}lote-red">Red</label>
          <select id="${P}lote-red"><option value="${NO_CAMBIAR}">— No cambiar —</option><option value="">${herencia ? "— Quitar la propia (hereda la del servidor) —" : "— Quitar la red —"}</option>${redes.filter(r=>r.activa !== false).map(r=>`<option value="${r.id}">${esc(r.nombre)}</option>`).join("")}</select>
          ${redes.length ? "" : `<div class="${P}hint">Todavía no hay redes: se crean en «Redes y tipos».</div>`}
          ${herencia && redes.length ? `<div class="${P}hint">Basta con ponérsela a la raíz o al primer equipo de una red: los que cuelgan de él la heredan.</div>` : ""}
        </div>
      </div>
      <div class="${P}lote-vista" id="${P}lote-vista" aria-live="polite"></div>
    </div>
    <div class="${P}modal-footer">
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}lote-aplicar" disabled>Aplicar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    const buscar = $(`#${P}lote-buscar`), selUbic = $(`#${P}lote-ubicacion`), sinTipo = $(`#${P}lote-sin-tipo`), sinRed = $(`#${P}lote-sin-red`);
    const todos = $(`#${P}lote-todos`), cuerpo = $(`#${P}lote-filas`), selTipo = $(`#${P}lote-tipo`), selRed = $(`#${P}lote-red`);
    const vista = $(`#${P}lote-vista`), aplicar = $(`#${P}lote-aplicar`);
    const clave = t=>String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const visibles = ()=>{
      const q = clave(buscar.value.trim());
      const u = selUbic.value ? Number(selUbic.value) : null;
      return equipos.filter(e=>(u === null || e.ubicacion_id === u)
        && (!sinTipo.checked || !e.tipo_equipo)
        && (!sinRed.checked || redEfectivaDe(e) === null)
        && (!q || clave([e.nombre, e.modelo, (ubicPorId.get(e.ubicacion_id) || {}).nombre].join(" ")).includes(q)));
    };
    const pintarFilas = ()=>{
      const lista = visibles();
      cuerpo.innerHTML = lista.length ? lista.map(e=>{
        const t = e.tipo_equipo ? tipoPorValor.get(e.tipo_equipo) : null;
        const rid = redEfectivaDe(e);
        const r = rid !== null ? redPorId.get(rid) : null;
        const desde = redHeredadaDe(e);
        const origen = desde !== null ? porIdEq.get(desde) : null;
        const u = ubicPorId.get(e.ubicacion_id);
        return `<tr class="${elegidos.has(e.id) ? `${P}lote-elegido` : ""}" data-id="${e.id}">
          <td class="${P}lote-col-check"><input type="checkbox" data-lote-id="${e.id}"${elegidos.has(e.id) ? " checked" : ""} aria-label="Elegir «${esc(e.nombre)}»"></td>
          <td>${esc(e.nombre)}${e.modelo ? `<div class="${P}mapa-muted">${esc(e.modelo)}</div>` : ""}</td>
          <td>${esc(u ? u.nombre : "—")}</td>
          <td>${t ? esc(t.etiqueta) : `<span class="${P}mapa-muted">sin tipo</span>`}</td>
          <td>${r ? `<span class="${P}mapa-red-chip${desde !== null ? ` ${P}mapa-red-chip-heredada` : ""}" style="--red-color:${esc(r.color)}"${desde !== null ? ` title="Heredada${origen ? ` de «${esc(origen.nombre)}»` : ""}"` : ""}>${esc(r.nombre)}</span>${desde !== null ? `<div class="${P}mapa-muted">heredada</div>` : ""}` : `<span class="${P}mapa-muted">sin red</span>`}</td>
        </tr>`;
      }).join("") : `<tr><td colspan="5" class="${P}mapa-vacio">Ningún equipo coincide con el filtro.</td></tr>`;
      const marcados = lista.filter(e=>elegidos.has(e.id)).length;
      todos.checked = !!lista.length && marcados === lista.length;
      todos.indeterminate = marcados > 0 && marcados < lista.length;
    };
    const cambios = ()=>{
      const c = {};
      if(selTipo.value !== NO_CAMBIAR) c.tipo_equipo = selTipo.value;
      if(selRed.value !== NO_CAMBIAR) c.red_id = selRed.value ? Number(selRed.value) : null;
      return c;
    };
    const pintarVista = ()=>{
      const n = elegidos.size;
      const c = cambios();
      const hayCambio = Object.keys(c).length > 0;
      aplicar.disabled = !n || !hayCambio;
      aplicar.textContent = n ? `Aplicar a ${plural(n, "equipo", "equipos")}` : "Aplicar";
      if(!n){ vista.innerHTML = `<span class="${P}mapa-muted">Marca uno o más equipos.</span>`; return; }
      const partes = [`<strong>${plural(n, "equipo elegido", "equipos elegidos")}</strong>`];
      if("red_id" in c) partes.push(c.red_id === null ? (herencia ? "heredarán la red de su servidor" : "quedarán sin red") : `pasarán a la red «${esc(redPorId.get(c.red_id).nombre)}»`);
      // Con la 011, lo que cuelga de ellos (y no tiene red propia) también cambia de red.
      let porHerencia = "";
      if("red_id" in c && herencia){
        const antes = redesEfectivas(equipos);
        const despues = redesEfectivas(equipos.map(e=>elegidos.has(e.id) ? { ...e, red_id: c.red_id } : e));
        const arrastrados = equipos.filter(e=>!elegidos.has(e.id) && (antes.get(e.id) || {}).redId !== (despues.get(e.id) || {}).redId);
        if(arrastrados.length) porHerencia = `<div class="${P}mapa-muted">Por herencia también cambian de red ${plural(arrastrados.length, "equipo que cuelga", "equipos que cuelgan")} de ellos.</div>`;
      }
      let lista = "";
      if("tipo_equipo" in c) partes.push(`serán «${esc(tipoPorValor.get(c.tipo_equipo).etiqueta)}»`);
      // Con la 010 la red también está en el nombre.
      if("tipo_equipo" in c || ("red_id" in c && hayNombresConRed())){
        // Cómo quedan los nombres automáticos (los de los demás también pueden correrse en la numeración).
        const cambio = { ...("tipo_equipo" in c ? { tipo_equipo: c.tipo_equipo } : {}), ...("red_id" in c ? { red_id: c.red_id } : {}) };
        const copia = equipos.map(e=>({ ...e, nombre: e.nombre_guardado ?? e.nombre, ...(elegidos.has(e.id) ? cambio : {}) }));
        const nuevos = nombresAutomaticos(datosNombres(copia));
        const cambian = equipos.filter(e=>nuevos.get(e.id) !== e.nombre);
        lista = cambian.length ? `<div class="${P}mapa-muted">Nombres que cambian:</div><ul class="${P}lote-nombres">${cambian.slice(0, 8).map(e=>`<li><span class="${P}lote-antes">${esc(e.nombre)}</span> → <strong>${esc(nuevos.get(e.id))}</strong></li>`).join("")}${cambian.length > 8 ? `<li class="${P}mapa-muted">y ${cambian.length - 8} más</li>` : ""}</ul>` : `<div class="${P}mapa-muted">Ningún nombre cambia.</div>`;
      }
      vista.innerHTML = `<div>${partes.join(" · ")}${hayCambio ? "" : ` · <span class="${P}mapa-muted">elige el tipo, la red o los dos</span>`}</div>${porHerencia}${lista}`;
    };
    const repintar = ()=>{ pintarFilas(); pintarVista(); };
    buscar.addEventListener("input", pintarFilas);
    [selUbic, sinTipo, sinRed].forEach(el=>el.addEventListener("change", pintarFilas));
    [selTipo, selRed].forEach(el=>el.addEventListener("change", pintarVista));
    cuerpo.addEventListener("change", e=>{
      const c = e.target.closest("[data-lote-id]");
      if(!c) return;
      const id = Number(c.dataset.loteId);
      if(c.checked) elegidos.add(id); else elegidos.delete(id);
      c.closest("tr").classList.toggle(`${P}lote-elegido`, c.checked);
      const lista = visibles();
      const marcados = lista.filter(x=>elegidos.has(x.id)).length;
      todos.checked = !!lista.length && marcados === lista.length;
      todos.indeterminate = marcados > 0 && marcados < lista.length;
      pintarVista();
    });
    todos.addEventListener("change", ()=>{
      for(const e of visibles()){ if(todos.checked) elegidos.add(e.id); else elegidos.delete(e.id); }
      repintar();
    });
    aplicar.addEventListener("click", async e=>{
      mostrarErrores(raiz, {}, "");
      try{
        const n = await conBotonOcupado(e.currentTarget, "Aplicando…", ()=>asignarEnLote([...elegidos], cambios()));
        cerrarModal();
        mostrarToast(`Listo: ${plural(n, "equipo actualizado", "equipos actualizados")}.`, "success");
        if(alGuardar) alGuardar();
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
    repintar();
    buscar.focus();
  });
}

// ===========================================================================
// Piscina (009): datos (nombre, sector, hectáreas del plano, notas, «por
// revisar»). Nueva: se crea como un cuadrado con sus hectáreas en el centro
// del mapa y alGuardar(id, { nueva: true }) abre el editor de la forma.
// ===========================================================================
export function abrirFormPiscina({ id = null, centro = null } = {}, { alGuardar, alEliminar } = {}){
  const actual = id ? cargarPiscinas().find(p=>p.id === id) : null;
  if(id && !actual){ mostrarToast("Esa piscina ya no existe. Recarga el mapa.", "error"); return; }
  const html = `<div class="${P}modal ${P}modal-angosto">
    ${cabecera(actual ? `Piscina ${actual.nombre}` : "Nueva piscina")}
    <div class="${P}modal-body">
      <div class="${P}alert ${P}alert-error" data-alerta hidden></div>
      <div class="${P}form-grid">
        <div class="${P}field">
          <label for="${P}piscina-nombre">Nombre</label>
          <input type="text" id="${P}piscina-nombre" maxlength="40" value="${esc(actual ? actual.nombre : "")}" placeholder="Ej.: L29" autocomplete="off">
          <div class="${P}field-error" data-error="nombre"></div>
        </div>
        <div class="${P}field">
          <label for="${P}piscina-sector">Sector <span class="${P}mapa-muted">(opcional)</span></label>
          <input type="text" id="${P}piscina-sector" maxlength="40" value="${esc(actual && actual.sector || "")}" placeholder="Se toma del nombre">
          <div class="${P}field-error" data-error="sector"></div>
        </div>
        <div class="${P}field">
          <label for="${P}piscina-hectareas">Hectáreas <span class="${P}mapa-muted">(del plano)</span></label>
          <input type="text" inputmode="decimal" id="${P}piscina-hectareas" value="${actual && actual.hectareas !== null && actual.hectareas !== undefined ? esc(String(actual.hectareas).replace(".", ",")) : ""}" placeholder="Ej.: 4,7">
          <div class="${P}field-error" data-error="hectareas"></div>
        </div>
        <div class="${P}field">
          <span class="${P}field-titulo">Revisión</span>
          <label class="${P}mapa-check"><input type="checkbox" id="${P}piscina-revisar"${actual && actual.revisar ? " checked" : ""}> Por revisar</label>
        </div>
        <div class="${P}field ${P}span-2">
          <label for="${P}piscina-notas">Notas <span class="${P}mapa-muted">(opcional)</span></label>
          <textarea id="${P}piscina-notas" maxlength="1000" placeholder="Estado, uso, observaciones…">${esc(actual && actual.notas || "")}</textarea>
        </div>
      </div>
      ${actual ? "" : `<div class="${P}hint">Se crea como un cuadrado ${centro ? "en el centro del mapa" : ""} con esas hectáreas (1 si no pones); después ajustas su forma arrastrando los puntos.</div>`}
    </div>
    <div class="${P}modal-footer">
      ${actual ? `<button type="button" class="${P}btn ${P}btn-danger" id="${P}piscina-eliminar">Eliminar</button><span class="${P}fb-spacer"></span>` : ""}
      <button type="button" class="${P}btn ${P}modal-close">Cancelar</button>
      <button type="button" class="${P}btn ${P}btn-primary" id="${P}piscina-guardar">${actual ? "Guardar" : "Crear y dibujar"}</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const raiz = raizModal();
    const $ = sel=>raiz.querySelector(sel);
    const nombre = $(`#${P}piscina-nombre`), sector = $(`#${P}piscina-sector`);
    nombre.addEventListener("input", ()=>{ sector.placeholder = sectorDeNombre(nombre.value) || "Se toma del nombre"; });
    raiz.addEventListener("keydown", e=>{ if(e.key === "Enter" && e.target.tagName === "INPUT"){ e.preventDefault(); $(`#${P}piscina-guardar`).click(); } });
    $(`#${P}piscina-guardar`).addEventListener("click", async e=>{
      mostrarErrores(raiz, {}, "");
      const campos = {
        nombre: nombre.value,
        sector: sector.value.trim() || sectorDeNombre(nombre.value),
        hectareas: $(`#${P}piscina-hectareas`).value,
        notas: $(`#${P}piscina-notas`).value,
        revisar: $(`#${P}piscina-revisar`).checked,
      };
      try{
        if(actual){
          await conBotonOcupado(e.currentTarget, "Guardando…", ()=>editarPiscina(id, campos));
          cerrarModal();
          mostrarToast(`Piscina ${campos.nombre.trim()} guardada.`, "success");
          if(alGuardar) alGuardar(id, { nueva: false });
        } else {
          const ha = Number(String(campos.hectareas).replace(",", ".")) || 1;
          const nuevoId = await conBotonOcupado(e.currentTarget, "Creando…", ()=>crearPiscina({ ...campos, puntos: cuadradoAlrededor(centro || [0, 0], ha) }));
          cerrarModal();
          mostrarToast(`Piscina ${campos.nombre.trim()} creada: ajusta su forma y guarda.`, "success");
          if(alGuardar) alGuardar(nuevoId, { nueva: true });
        }
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
    const botonEliminar = $(`#${P}piscina-eliminar`);
    if(botonEliminar) botonEliminar.addEventListener("click", async e=>{
      if(botonEliminar.dataset.confirmar !== "1"){ botonEliminar.dataset.confirmar = "1"; botonEliminar.textContent = "¿Eliminar? Confirmar"; return; }
      try{
        await conBotonOcupado(e.currentTarget, "Eliminando…", ()=>eliminarPiscina(id));
        cerrarModal();
        mostrarToast(`Piscina ${actual.nombre} eliminada.`, "success");
        if(alEliminar) alEliminar(id);
      }catch(err){
        manejarErrorGuardado(raiz, err);
      }
    });
    nombre.focus();
  });
}

function plural(n, uno, varios){ return `${n} ${n === 1 ? uno : varios}`; }
