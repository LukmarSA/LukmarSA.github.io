// Bloque "Ubicación" del detalle de un activo: ubicación actual, botón
// "Ver en mapa", historial de movimientos (desplegable, dentro del mismo
// modal) y, con permiso "asignar_ubicacion", "Mover…"/"Asignar…".
// Se llena de forma asíncrona: el detalle se abre al instante y este bloque
// aparece cuando llega la respuesta; si las tablas del mapa fallan, solo este
// bloque muestra el error.
import { obtenerHistorialUbicacionActivo, obtenerUbicacionDeActivo } from "../../nucleo/datos-mapa.js";
import { esc, fmtFecha } from "../../nucleo/helpers.js";
import { infoTipoUbicacion, traducirErrorMapa } from "../../nucleo/mapa-logica.js";
import { puede } from "../../nucleo/permisos.js";
import { abrirDetalle } from "../detalle/vista.js";
import { irAlMapa } from "../vista-mapa.js";
import { abrirMoverActivo } from "./formularios.js";

const P = "inventario-tecnologico-";

export async function montarBloqueUbicacionActivo(contenedor, activoId){
  if(!contenedor) return;
  let info;
  try{
    info = await obtenerUbicacionDeActivo(activoId);
  }catch(err){
    if(contenedor.isConnected) contenedor.innerHTML = `<span class="${P}cell-muted">No se pudo cargar la ubicación: ${esc(traducirErrorMapa(err))}</span>`;
    return;
  }
  if(!contenedor.isConnected) return;
  const { vigente, equipo, totalTramos, tipos } = info;
  const u = vigente && vigente.ubicacion;
  const tipo = u ? infoTipoUbicacion(tipos, u.tipo) : null;
  const esRadioAqui = !!(equipo && u && equipo.ubicacion_id === u.id);
  const botones = [
    u && puede("ver_mapa") ? `<button type="button" class="${P}btn ${P}btn-sm" data-ubic-accion="ver-en-mapa">Ver en mapa</button>` : "",
    totalTramos ? `<button type="button" class="${P}btn ${P}btn-sm" data-ubic-accion="historial" aria-expanded="false">Historial (${totalTramos})</button>` : "",
    puede("asignar_ubicacion") && !equipo ? `<button type="button" class="${P}btn ${P}btn-sm" data-ubic-accion="mover">${u ? "Mover…" : "Asignar…"}</button>` : "",
  ].join("");
  contenedor.innerHTML = `
    <div class="${P}ubicacion-activo-fila">
      ${u ? `<span class="${P}mapa-punto" style="background:${tipo.color}"></span>` : ""}
      <div class="${P}ubicacion-activo-texto">
        ${u
          ? `<div class="${P}ubicacion-activo-nombre">${esc(u.nombre)}${u.activa === false ? ` <span class="${P}mapa-muted">(archivada)</span>` : ""}</div>
             <div class="${P}ubicacion-activo-meta">${esc(tipo.etiqueta)} · desde ${fmtFecha(vigente.desde)}${esRadioAqui ? ` · instalado como equipo de radioenlace «${esc(equipo.nombre)}»` : ""}</div>`
          : `<div class="${P}cell-muted">Sin ubicación asignada.</div>`}
      </div>
      ${botones ? `<div class="${P}ubicacion-activo-acciones">${botones}</div>` : ""}
    </div>
    <div class="${P}ubicacion-activo-historial" hidden></div>`;

  const ver = contenedor.querySelector('[data-ubic-accion="ver-en-mapa"]');
  if(ver) ver.addEventListener("click", ()=>irAlMapa({ ubicacionId: u.id, activoId, equipoId: esRadioAqui ? equipo.id : null }));

  const mover = contenedor.querySelector('[data-ubic-accion="mover"]');
  if(mover) mover.addEventListener("click", ()=>abrirMoverActivo(activoId, { alGuardar: ()=>abrirDetalle(activoId), alCancelar: ()=>abrirDetalle(activoId) }));

  const hist = contenedor.querySelector('[data-ubic-accion="historial"]');
  if(hist) hist.addEventListener("click", async ()=>{
    const caja = contenedor.querySelector(`.${P}ubicacion-activo-historial`);
    const abrir = caja.hidden;
    caja.hidden = !abrir;
    hist.setAttribute("aria-expanded", String(abrir));
    if(!abrir || caja.dataset.cargado) return;
    caja.innerHTML = `<span class="${P}cell-muted">Cargando historial…</span>`;
    try{
      const tramos = await obtenerHistorialUbicacionActivo(activoId);
      caja.dataset.cargado = "1";
      caja.innerHTML = `<div class="${P}timeline">${tramos.map(t=>`
        <div class="${P}titem${t.hasta === null ? ` ${P}current` : ""}">
          <div class="${P}titem-name">${esc(t.ubicacion ? t.ubicacion.nombre : "Ubicación eliminada")}</div>
          <div class="${P}titem-meta">${t.ubicacion ? esc(infoTipoUbicacion(tipos, t.ubicacion.tipo).etiqueta) + " · " : ""}${fmtFecha(t.desde)} → ${t.hasta ? fmtFecha(t.hasta) : "presente"}</div>
          ${t.notas ? `<div class="${P}titem-observacion">${esc(t.notas)}</div>` : ""}
        </div>`).join("")}</div>`;
    }catch(err){
      caja.innerHTML = `<span class="${P}cell-muted">No se pudo cargar el historial: ${esc(traducirErrorMapa(err))}</span>`;
    }
  });
}
