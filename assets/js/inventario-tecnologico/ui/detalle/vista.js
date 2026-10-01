import { eliminarTramoHistorial, urlFoto } from "../../negocio/operaciones.js";
import { ROL_ADMIN } from "../../nucleo/config.js";
import { cargarActivos } from "../../nucleo/datos.js";
import { state } from "../../nucleo/estado.js";
import { buscarActivo, esc, fmtFecha, fmtTag, fmtValorActualConPorcentaje, labelTipoDevolucion, labelTipoEntrega } from "../../nucleo/helpers.js";
import { camposDeTipo, colorTipo, iconoTipoTam, infoEstado, infoPropiedad } from "../../nucleo/opciones-configurables.js";
import { textoValor, valorCrudo } from "../../nucleo/campos-personalizados.js";
import { puede } from "../../nucleo/permisos.js";
import { estaEnPortapapeles, toggleEnPortapapeles } from "./acta.js";
import { abrirCambiarCustodio, abrirEditarTramo } from "./cambiar-custodio.js";
import { abrirConfirmarBaja } from "./confirmar-baja.js";
import { abrirFormActivo } from "./form-activo.js";
import { actualizarTablaYResumen, bloquePerfilCustodio, colorCustodioActual, gradienteCustodioActual, tarjetaBadge } from "../listado/tabla.js";
import { montarBloqueUbicacionActivo } from "../mapa/ubicacion-activo.js";
import { abrirCarruselFotos, abrirModal, confirmarAccion, mostrarToast } from "../render-raiz.js";

export function abrirDetalle(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const html = `
    <div class="inventario-tecnologico-modal inventario-tecnologico-modal-wide">
      <div class="inventario-tecnologico-modal-header">
        <h3><span class="inventario-tecnologico-tag inventario-tecnologico-tag-lg">${fmtTag(a)}</span></h3>
        <button class="inventario-tecnologico-modal-close">✕</button>
      </div>
      <div class="inventario-tecnologico-modal-body">
        <div class="inventario-tecnologico-detail-head-v2">
          <div class="inventario-tecnologico-detail-profile-card" style="background:${gradienteCustodioActual(a)};border-color:${colorCustodioActual(a)}40;">
            <div class="inventario-tecnologico-detail-icon-big" style="color:${colorTipo(a.tipo)}">${(a.fotos&&a.fotos.length>0) ? `<img src="${urlFoto(a.fotos[0])}" alt="Foto del activo" data-abrir-carrusel="0">` : iconoTipoTam(a.tipo, 40)}</div>
            ${bloquePerfilCustodio(a)}
          </div>
          <div class="inventario-tecnologico-detail-badges-grid">
            ${tarjetaBadge("Modelo", esc(a.modelo)||'—', "#004DAB")}
            ${tarjetaBadge("Nombre", esc(a.nombre_dispositivo)||'—', "#007EB2")}
            ${tarjetaBadge("Propiedad", `<span style="color:${infoPropiedad(a.propiedad).fg}">${esc(infoPropiedad(a.propiedad).label)}</span>`, infoPropiedad(a.propiedad).fg)}
            ${tarjetaBadge("Tipo", esc(a.tipo)||'—', colorTipo(a.tipo))}
            ${tarjetaBadge("Estado", `<span style="color:${infoEstado(a.estado).fg}">${esc(infoEstado(a.estado).label)}</span>`, infoEstado(a.estado).fg)}
          </div>
        </div>

        <div class="inventario-tecnologico-kv-grid">
          <div class="inventario-tecnologico-kv"><div class="inventario-tecnologico-k">Marca</div><div class="inventario-tecnologico-v">${esc(a.marca)||'—'}</div></div>
          ${camposDeTipo(a.tipo).map(d=>{
            const t = textoValor(d, valorCrudo(a, d));
            const clase = ["serie","mac_wifi","mac_ethernet"].includes(d.clave) ? " inventario-tecnologico-mono" : (d.tipo_dato === "texto_largo" ? " inventario-tecnologico-v-largo" : "");
            return `<div class="inventario-tecnologico-kv" data-kv-campo="${esc(d.clave)}"><div class="inventario-tecnologico-k">${esc(d.etiqueta)}</div><div class="inventario-tecnologico-v${clase}">${esc(t)||'—'}</div></div>`;
          }).join("")}
          <div class="inventario-tecnologico-kv"><div class="inventario-tecnologico-k">Proveedor</div><div class="inventario-tecnologico-v">${esc(a.proveedor)||'—'}</div></div>
          <div class="inventario-tecnologico-kv"><div class="inventario-tecnologico-k">Valor de compra</div><div class="inventario-tecnologico-v">${a.valor_compra?'$'+Number(a.valor_compra).toFixed(2):'—'}</div></div>
          <div class="inventario-tecnologico-kv"><div class="inventario-tecnologico-k">Valor actual</div><div class="inventario-tecnologico-v">${fmtValorActualConPorcentaje(a) || '—'}</div></div>
          <div class="inventario-tecnologico-kv"><div class="inventario-tecnologico-k">Fecha de adquisición</div><div class="inventario-tecnologico-v">${fmtFecha(a.fecha_adquisicion)}</div></div>
          ${a.celular ? `<div class="inventario-tecnologico-kv"><div class="inventario-tecnologico-k">Gmail asociado</div><div class="inventario-tecnologico-v inventario-tecnologico-mono">${esc(a.celular.gmail)||'—'}</div></div>` : ""}
        </div>

        <div class="inventario-tecnologico-section-title">Ubicación</div>
        <div class="inventario-tecnologico-ubicacion-activo" id="inventario-tecnologico-ubicacion-activo"><span class="inventario-tecnologico-cell-muted">Cargando ubicación…</span></div>

        ${(a.fotos&&a.fotos.length>0) ? `
        <div class="inventario-tecnologico-section-title">Fotos</div>
        <div class="inventario-tecnologico-fotos-grid">
          ${a.fotos.map((ruta,i)=>`<div class="inventario-tecnologico-foto-thumb"><img src="${urlFoto(ruta)}" alt="Foto del activo" data-abrir-carrusel="${i}"></div>`).join("")}
        </div>` : ""}

        <div class="inventario-tecnologico-section-title">Historial de custodia (más reciente primero)</div>
        <div class="inventario-tecnologico-timeline">
          ${renderTimelineHistorial(a) || '<div class="inventario-tecnologico-cell-muted">Sin historial registrado.</div>'}
        </div>
      </div>
      <div class="inventario-tecnologico-modal-footer">
        ${puede("editar_activo") ? `<button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-editar-activo">Editar datos base</button>` : ""}
        ${puede("cambiar_custodio") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-cambiar-custodio">Cambiar custodio</button>` : ""}
        ${a.custodio ? `<button class="inventario-tecnologico-btn ${estaEnPortapapeles(a.id)?'inventario-tecnologico-btn-primary':''}" id="inventario-tecnologico-btn-marcar-portapapeles">${estaEnPortapapeles(a.id)?'🔖 Marcado para acta':'🔖 Marcar para acta'}</button>` : ""}
        ${puede("dar_baja") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-danger" id="inventario-tecnologico-btn-dar-baja">Dar de baja</button>` : ""}
      </div>
    </div>`;
  abrirModal(html, ()=>{
    // Se llena solo cuando responde Supabase (tablas de la migración 002);
    // si fallan, el resto del detalle funciona igual.
    montarBloqueUbicacionActivo(document.getElementById("inventario-tecnologico-ubicacion-activo"), a.id);
    document.querySelectorAll("[data-abrir-carrusel]").forEach(img=>{
      img.addEventListener("click", ()=>abrirCarruselFotos(a.fotos.map(urlFoto), Number(img.dataset.abrirCarrusel), ()=>abrirDetalle(a.id)));
    });
    const be = document.getElementById("inventario-tecnologico-btn-editar-activo");
    if(be) be.addEventListener("click", ()=>abrirFormActivo(a.id));
    const bc = document.getElementById("inventario-tecnologico-btn-cambiar-custodio");
    if(bc) bc.addEventListener("click", ()=>abrirCambiarCustodio(a.id));
    const bm = document.getElementById("inventario-tecnologico-btn-marcar-portapapeles");
    if(bm) bm.addEventListener("click", ()=>{ toggleEnPortapapeles(a.id); actualizarTablaYResumen(); abrirDetalle(a.id); });
    const bb = document.getElementById("inventario-tecnologico-btn-dar-baja");
    if(bb) bb.addEventListener("click", ()=>abrirConfirmarBaja(a.id));
    document.querySelectorAll("[data-editar-tramo]").forEach(b=>{
      b.addEventListener("click", ()=>abrirEditarTramo(a.id, Number(b.dataset.editarTramo)));
    });
    document.querySelectorAll("[data-borrar-tramo]").forEach(b=>{
      b.addEventListener("click", async ()=>{
        const confirmado = await confirmarAccion("¿Borrar este registro del historial? Esta acción no se puede deshacer.", "Borrar");
        if(!confirmado){ abrirDetalle(a.id); return; }
        try{ await eliminarTramoHistorial(Number(b.dataset.borrarTramo)); }
        catch(err){ mostrarToast("No se pudo borrar: " + err.message, "error"); }
        abrirDetalle(a.id);
      });
    });
  });
}

export function renderTimelineHistorial(a){
  return a.historial_custodia.map((t,i)=>tramoHtml(a,t,i)).join("");
}

export function tramoHtml(a, t, i){
  const tipoLbl = t.tipo_custodio==="mantenimiento" ? "Mantenimiento" : (t.tipo_custodio==="area" ? "Área / departamento" : "Persona");
  const vigente = t.hasta===null; // el tramo activo de verdad — NO necesariamente i===0: si el
  // activo está disponible, el tramo más reciente (i===0) ya está cerrado y no es distinto
  // de cualquier otro tramo viejo para efectos de editar/borrar.
  return `<div class="inventario-tecnologico-titem ${vigente?'inventario-tecnologico-current':''}">
    <div class="inventario-tecnologico-titem-row">
      <div>
        <div class="inventario-tecnologico-titem-name">${esc(t.nombre)} <span class="inventario-tecnologico-pill ${t.tipo_custodio==='mantenimiento'?'inventario-tecnologico-pill-mantenimiento':(t.tipo_custodio==='area'?'inventario-tecnologico-pill-area':'inventario-tecnologico-pill-persona')}" style="margin-left:6px;">${tipoLbl}</span></div>
        <div class="inventario-tecnologico-titem-meta">${t.cargo?esc(t.cargo)+' · ':''}${fmtFecha(t.desde)} → ${t.hasta?fmtFecha(t.hasta):'presente'}</div>
      </div>
      <div class="inventario-tecnologico-titem-actions">
        ${puede("editar_historial") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-editar-tramo="${i}">Editar</button>` : ""}
        ${!vigente && state.sesion.rol===ROL_ADMIN ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm inventario-tecnologico-btn-danger" data-borrar-tramo="${t._id}">Borrar</button>` : ""}
      </div>
    </div>
    ${(t.tipo_entrega || t.observacion_entrega) ? `<div class="inventario-tecnologico-titem-observacion inventario-tecnologico-titem-obs-entrega"><span class="inventario-tecnologico-titem-obs-tag">Entrega</span>${t.tipo_entrega ? `<span class="inventario-tecnologico-titem-obs-tipo">${esc(labelTipoEntrega(t.tipo_entrega).split(' (')[0])}</span>` : ""}${t.observacion_entrega?esc(t.observacion_entrega):""}</div>` : ""}
    ${(t.tipo_devolucion || t.observacion_devolucion) ? `<div class="inventario-tecnologico-titem-observacion inventario-tecnologico-titem-obs-devolucion"><span class="inventario-tecnologico-titem-obs-tag">Devolución</span>${t.tipo_devolucion ? `<span class="inventario-tecnologico-titem-obs-tipo${t.tipo_devolucion==='desvinculada'?' inventario-tecnologico-titem-obs-tipo-peligro':''}">${esc(labelTipoDevolucion(t.tipo_devolucion).split(' (')[0])}</span>` : ""}${t.observacion_devolucion?esc(t.observacion_devolucion):""}</div>` : ""}
  </div>`;
}
