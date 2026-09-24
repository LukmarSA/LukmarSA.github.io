// HTML del panel lateral del mapa. Solo arma strings a partir de un
// "contexto" (datos ya indexados + permisos); los clics los atiende
// vista-mapa.js por delegación, leyendo data-accion / data-id.
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { fmtAzimut, fmtCoordenadas, fmtDistancia, urlGoogleMaps } from "../../nucleo/geo.js";
import { enlacesDeEquipo, infoTipoUbicacion, ordenarUbicaciones } from "../../nucleo/mapa-logica.js";
import { colorTipo, iconoTipoTam, tintarClaro } from "../../nucleo/opciones-configurables.js";
import { urlFoto } from "../../negocio/operaciones.js";
import { GLIFO_RADIO } from "./leaflet.js";

const P = "inventario-tecnologico-";

function btn(accion, texto, { id = null, clase = "", titulo = "", pressed = null } = {}){
  return `<button type="button" class="${P}btn ${P}btn-sm ${clase}" data-accion="${accion}"${id !== null ? ` data-id="${id}"` : ""}${titulo ? ` title="${esc(titulo)}"` : ""}${pressed !== null ? ` aria-pressed="${pressed}"` : ""}>${texto}</button>`;
}

export function pillTipoUbicacion(tipos, valor){
  const i = infoTipoUbicacion(tipos, valor);
  return `<span class="${P}pill" style="background:${tintarClaro(i.color, 0.85)};color:${i.color};"><span class="${P}pill-dot"></span>${esc(i.etiqueta)}</span>`;
}

function contarEnUbicacion(ctx, ubicacionId){
  const equipos = (ctx.indices.equiposPorUbicacion.get(ubicacionId) || []).length;
  const activos = (ctx.indices.activosPorUbicacion.get(ubicacionId) || []).length;
  return { equipos, activos };
}

function plural(n, uno, varios){ return `${n} ${n === 1 ? uno : varios}`; }

// ---------------------------------------------------------------------------
// Sin selección: cifras + lista de ubicaciones (también sirve para llegar a
// una ubicación con teclado o cuando dos marcadores se tapan).
// ---------------------------------------------------------------------------
export function htmlPanelResumen(ctx){
  const r = ctx.resumen;
  const visibles = ordenarUbicaciones(ctx.ubicacionesVisibles, ctx.tipos);
  const filas = visibles.map(u=>{
    const c = contarEnUbicacion(ctx, u.id);
    const info = infoTipoUbicacion(ctx.tipos, u.tipo);
    const sub = [info.etiqueta, c.equipos ? plural(c.equipos, "equipo", "equipos") : "", c.activos ? plural(c.activos, "activo", "activos") : "", u.activa === false ? "archivada" : ""].filter(Boolean).join(" · ");
    return `<li><button type="button" class="${P}mapa-fila" data-accion="ver-ubicacion" data-id="${u.id}">
      <span class="${P}mapa-punto" style="background:${info.color}"></span>
      <span class="${P}mapa-fila-texto"><span class="${P}mapa-fila-titulo">${esc(u.nombre)}</span><span class="${P}mapa-fila-sub">${esc(sub)}</span></span>
    </button></li>`;
  }).join("");
  const ocultas = ctx.ubicacionesTotal - visibles.length;
  return `
    <div class="${P}mapa-panel-cabecera">
      <div class="${P}mapa-panel-titulo">Ubicaciones y radioenlaces</div>
      <div class="${P}mapa-panel-sub">Haz clic en un marcador para ver sus equipos y activos.${ctx.esAdmin ? " Clic derecho en el mapa para crear una ubicación ahí." : ""}</div>
    </div>
    <div class="${P}mapa-cifras">
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.ubicaciones}</span><span class="${P}mapa-cifra-lbl">${r.ubicaciones === 1 ? "ubicación" : "ubicaciones"}</span></div>
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.equipos}</span><span class="${P}mapa-cifra-lbl">equipos de radio</span></div>
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.enlaces}</span><span class="${P}mapa-cifra-lbl">${r.enlaces === 1 ? "enlace" : "enlaces"}</span></div>
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.activosUbicados}</span><span class="${P}mapa-cifra-lbl">activos ubicados</span></div>
    </div>
    ${r.activosSinUbicacion ? `<div class="${P}mapa-nota">${plural(r.activosSinUbicacion, "activo todavía no tiene", "activos todavía no tienen")} ubicación.${ctx.puedeAsignar ? " Se asignan desde el panel de cada ubicación (botón «+ Asignar»)." : ""}</div>` : ""}
    <div class="${P}section-title">Ubicaciones${ocultas > 0 ? ` <span class="${P}mapa-muted">(${ocultas} oculta${ocultas === 1 ? "" : "s"} por filtros)</span>` : ""}</div>
    ${filas ? `<ul class="${P}mapa-lista">${filas}</ul>` : `<div class="${P}mapa-vacio">${ctx.ubicacionesTotal ? "Ninguna ubicación coincide con los filtros." : `Todavía no hay ubicaciones.${ctx.esAdmin ? " Usa «+ Ubicación» o clic derecho en el mapa." : ""}`}</div>`}`;
}

// ---------------------------------------------------------------------------
// Ubicación seleccionada
// ---------------------------------------------------------------------------
export function htmlPanelUbicacion(ctx, u){
  const s = ctx.seleccion;
  const equipos = ctx.indices.equiposPorUbicacion.get(u.id) || [];
  const activos = ctx.indices.activosPorUbicacion.get(u.id) || [];
  const fotos = u.fotos || [];
  return `
    <div class="${P}mapa-panel-cabecera">
      <div class="${P}mapa-panel-nav">${btn("volver-resumen", "← Todas", { clase: `${P}btn-ghost` })}</div>
      <div class="${P}mapa-panel-titulo">${esc(u.nombre)}</div>
      <div class="${P}mapa-panel-meta">${pillTipoUbicacion(ctx.tipos, u.tipo)}${u.activa === false ? `<span class="${P}pill ${P}pill-persona">Archivada</span>` : ""}</div>
      <div class="${P}mapa-coords">
        <span class="${P}mono">${fmtCoordenadas(u.lat, u.lng)}</span>
        ${btn("copiar-coords", "Copiar", { titulo: "Copiar coordenadas" })}
        <a class="${P}btn ${P}btn-sm ${P}btn-ghost" href="${urlGoogleMaps(u.lat, u.lng)}" target="_blank" rel="noopener">Google Maps ↗</a>
      </div>
      ${u.direccion ? `<div class="${P}mapa-panel-texto">${esc(u.direccion)}</div>` : ""}
      ${u.notas ? `<div class="${P}mapa-panel-notas">${esc(u.notas)}</div>` : ""}
      ${fotos.length ? `<div class="${P}fotos-grid ${P}mapa-fotos">${fotos.map((ruta, i)=>`<div class="${P}foto-thumb"><img src="${urlFoto(ruta)}" alt="Foto de ${esc(u.nombre)}" data-accion="ver-foto" data-id="${i}"></div>`).join("")}</div>` : ""}
      ${ctx.esAdmin ? `<div class="${P}mapa-acciones">
        ${btn("editar-ubicacion", "Editar", { id: u.id })}
        ${btn("archivar-ubicacion", u.activa === false ? "Reactivar" : "Archivar", { id: u.id, titulo: u.activa === false ? "Volver a mostrarla en el mapa" : "Ocultarla del mapa sin perder su historial" })}
        ${btn("eliminar-ubicacion", "Eliminar", { id: u.id, clase: `${P}btn-danger` })}
      </div>` : ""}
    </div>

    <section class="${P}mapa-seccion" aria-label="Equipos de radioenlace">
      <div class="${P}mapa-seccion-cab">
        <span class="${P}section-title">Equipos de radioenlace (${equipos.length})</span>
        ${ctx.esAdmin ? btn("nuevo-equipo", "+ Equipo", { id: u.id }) : ""}
      </div>
      ${equipos.length
        ? `<ul class="${P}mapa-lista">${equipos.map(e=>htmlEquipo(ctx, e, s.equipoId === e.id)).join("")}</ul>`
        : `<div class="${P}mapa-vacio">Sin equipos de radioenlace.</div>`}
    </section>

    <section class="${P}mapa-seccion" aria-label="Activos en esta ubicación">
      <div class="${P}mapa-seccion-cab">
        <span class="${P}section-title">Activos en esta ubicación (${activos.length})</span>
        ${ctx.puedeAsignar && u.activa !== false ? btn("asignar-activos", "+ Asignar", { id: u.id, titulo: "Asignar o traer activos a esta ubicación" }) : ""}
      </div>
      ${activos.length
        ? `<ul class="${P}mapa-lista">${activos.map(a=>htmlActivo(ctx, a, u)).join("")}</ul>`
        : `<div class="${P}mapa-vacio">Ningún activo registrado aquí.</div>`}
    </section>`;
}

function htmlEquipo(ctx, e, seleccionado){
  const activo = e.activo_id !== null && e.activo_id !== undefined ? ctx.indices.activoPorId.get(e.activo_id) : null;
  const enlaces = enlacesDeEquipo(ctx.indices, e.id);
  const sub = [e.modelo, activo ? fmtTag(activo) : (e.activo_id ? `activo #${e.activo_id}` : "")].filter(Boolean).join(" · ");
  return `<li class="${P}mapa-equipo${seleccionado ? ` ${P}mapa-equipo-sel` : ""}" data-equipo-id="${e.id}">
    <button type="button" class="${P}mapa-fila" data-accion="seleccionar-equipo" data-id="${e.id}" aria-pressed="${seleccionado}" aria-expanded="${seleccionado}" title="${seleccionado ? "Ocultar sus enlaces" : "Ver sus enlaces en el mapa"}">
      <span class="${P}mapa-icono-radio">${GLIFO_RADIO}</span>
      <span class="${P}mapa-fila-texto"><span class="${P}mapa-fila-titulo">${esc(e.nombre)}</span>${sub ? `<span class="${P}mapa-fila-sub">${esc(sub)}</span>` : ""}</span>
      <span class="${P}mapa-contador" title="${plural(enlaces.length, "enlace", "enlaces")}">↔ ${enlaces.length}</span>
    </button>
    ${seleccionado ? `<div class="${P}mapa-equipo-detalle">
      ${enlaces.length
        ? enlaces.map(d=>htmlEnlace(ctx, d, ctx.seleccion.enlaceId === d.enlace.id)).join("")
        : `<div class="${P}mapa-vacio">Sin enlaces.${ctx.esAdmin ? " Usa «Enlazar con…» para unirlo con un equipo de otra ubicación." : ""}</div>`}
      ${e.notas ? `<div class="${P}mapa-panel-notas">${esc(e.notas)}</div>` : ""}
      <div class="${P}mapa-acciones">
        ${activo ? btn("ver-activo", `Ver activo ${esc(fmtTag(activo))}`, { id: activo.id }) : ""}
        ${ctx.esAdmin ? btn("nuevo-enlace", "Enlazar con…", { id: e.id }) + btn("editar-equipo", "Editar", { id: e.id }) + btn("eliminar-equipo", "Eliminar", { id: e.id, clase: `${P}btn-danger` }) : ""}
      </div>
    </div>` : ""}
  </li>`;
}

function htmlEnlace(ctx, d, destacado){
  const l = d.enlace;
  return `<div class="${P}mapa-enlace${destacado ? ` ${P}mapa-enlace-destacado` : ""}" data-enlace-id="${l.id}">
    <div class="${P}mapa-enlace-cab"><span class="${P}mapa-enlace-flecha">↔</span> <strong>${esc(d.otro.nombre)}</strong> <span class="${P}mapa-muted">en ${esc(d.otraUbicacion.nombre)}</span></div>
    <dl class="${P}mapa-enlace-datos">
      <div><dt>Distancia</dt><dd>${fmtDistancia(d.distanciaKm)}</dd></div>
      <div><dt>Azimut desde aquí</dt><dd>${fmtAzimut(d.azimutIda)}</dd></div>
      <div><dt>Azimut desde allá</dt><dd>${fmtAzimut(d.azimutVuelta)}</dd></div>
      ${l.banda ? `<div><dt>Banda</dt><dd>${esc(l.banda)}</dd></div>` : ""}
      ${l.frecuencia_mhz ? `<div><dt>Frecuencia</dt><dd>${esc(Number(l.frecuencia_mhz))} MHz</dd></div>` : ""}
    </dl>
    ${l.notas ? `<div class="${P}mapa-panel-notas">${esc(l.notas)}</div>` : ""}
    <div class="${P}mapa-acciones">
      ${btn("ir-extremo", "Ir al otro extremo", { id: l.id })}
      ${ctx.esAdmin ? btn("editar-enlace", "Editar", { id: l.id }) + btn("eliminar-enlace", "Eliminar", { id: l.id, clase: `${P}btn-danger` }) : ""}
    </div>
  </div>`;
}

function htmlActivo(ctx, a, u){
  const tramo = ctx.indices.vigentePorActivo.get(a.id);
  const equipo = ctx.indices.equipoPorActivo.get(a.id);
  const radioAqui = equipo && equipo.ubicacion_id === u.id;
  const descripcion = [a.marca, a.modelo].filter(Boolean).join(" ") || a.tipo || "";
  const sub = [a.custodio ? a.custodio.nombre : "Sin custodio", tramo && tramo.desde ? `desde ${fmtFecha(tramo.desde)}` : ""].filter(Boolean).join(" · ");
  return `<li class="${P}mapa-activo${ctx.seleccion.activoId === a.id ? ` ${P}mapa-activo-destacado` : ""}" data-activo-id="${a.id}">
    <button type="button" class="${P}mapa-fila" data-accion="ver-activo" data-id="${a.id}" title="Abrir el detalle del activo">
      <span class="${P}mapa-icono-tipo" style="color:${colorTipo(a.tipo)}">${iconoTipoTam(a.tipo, 16)}</span>
      <span class="${P}mapa-fila-texto">
        <span class="${P}mapa-fila-titulo"><span class="${P}tag">${esc(fmtTag(a))}</span> ${esc(descripcion)}</span>
        <span class="${P}mapa-fila-sub">${esc(sub)}</span>
      </span>
    </button>
    ${radioAqui
      ? `<span class="${P}mapa-insignia-radio" title="Se ubica a través de su equipo de radioenlace">Radio: ${esc(equipo.nombre)}</span>`
      : (ctx.puedeAsignar ? `<span class="${P}mapa-activo-acciones">${btn("mover-activo", "Mover", { id: a.id })}${btn("quitar-activo", "Quitar", { id: a.id, titulo: "Dejarlo sin ubicación" })}</span>` : "")}
  </li>`;
}

export function htmlPanelCargando(){
  return `<div class="${P}mapa-panel-cabecera"><div class="${P}mapa-panel-sub">Cargando ubicaciones…</div></div>`;
}

export function htmlPanelError(mensaje){
  return `<div class="${P}mapa-panel-cabecera">
    <div class="${P}alert ${P}alert-error">No se pudieron cargar los datos del mapa.<br>${esc(mensaje)}</div>
    ${btn("reintentar", "Reintentar")}
  </div>`;
}
