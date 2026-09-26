// HTML del panel lateral del mapa. Solo arma strings a partir de un
// "contexto" (datos ya indexados, la red, la simulación y los permisos); los
// clics los atiende vista-mapa.js por delegación, leyendo data-accion / data-id.
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { fmtAzimut, fmtCoordenadas, fmtDistancia, urlGoogleMaps } from "../../nucleo/geo.js";
import { infoTipoUbicacion, ordenarUbicaciones } from "../../nucleo/mapa-logica.js";
import { caminoARaiz, describirConexion, infoEstado, infoRol, tramosDeCamino } from "../../nucleo/mapa-jerarquia.js";
import { atajosQueLoApagan } from "../../nucleo/mapa-nombres.js";
import { colorTipo, iconoTipoTam, tintarClaro } from "../../nucleo/opciones-configurables.js";
import { urlFoto } from "../../negocio/operaciones.js";
import { GLIFO_RADIO } from "./leaflet.js";

const P = "inventario-tecnologico-";
const MAX_CLIENTES_LISTA = 12;

// Símbolos del camino a la raíz: onda = enlace inalámbrico, enchufe = cable.
const ICONO_ONDA = `<svg viewBox="0 0 20 12" width="14" height="9" aria-hidden="true" focusable="false"><path d="M1 6c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
const ICONO_CABLE = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M5.5 1.5v3M10.5 1.5v3M3.5 4.5h9v3a4.5 4.5 0 0 1-9 0zM8 12v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function btn(accion, texto, { id = null, clase = "", titulo = "", pressed = null } = {}){
  return `<button type="button" class="${P}btn ${P}btn-sm ${clase}" data-accion="${accion}"${id !== null ? ` data-id="${id}"` : ""}${titulo ? ` title="${esc(titulo)}"` : ""}${pressed !== null ? ` aria-pressed="${pressed}"` : ""}>${texto}</button>`;
}

export function pillTipoUbicacion(tipos, valor){
  const i = infoTipoUbicacion(tipos, valor);
  return `<span class="${P}pill" style="background:${tintarClaro(i.color, 0.85)};color:${i.color};"><span class="${P}pill-dot"></span>${esc(i.etiqueta)}</span>`;
}

function pillRol(rol){
  const r = infoRol(rol);
  return `<span class="${P}mapa-rol" style="--rol-color:${r.color}" title="${esc(r.ayuda)}">${esc(r.etiqueta)}</span>`;
}

// Tipos de radio (inalámbricos): para ellos el rol calculado (backbone,
// distribución…) tiene sentido. Para el resto (switch, cámara, router…) se
// muestra su tipo.
const TIPOS_RADIO = new Set(["ptp", "ap", "estacion"]);
function pillRolOTipo(ctx, e){
  const t = ctx.red007 && e.tipo_equipo ? ctx.tipoPorValor.get(e.tipo_equipo) : null;
  if(t && !TIPOS_RADIO.has(e.tipo_equipo)) return `<span class="${P}mapa-rol ${P}mapa-rol-tipo" title="Tipo de equipo">${esc(t.etiqueta)}</span>`;
  return pillRol(ctx.red.rol.get(e.id));
}

// Dentro del panel de una ubicación, todos sus equipos están ahí: el nombre
// automático se muestra sin " en {esa ubicación}" (el completo queda en el
// title y en el detalle).
function nombreEnUbicacion(ctx, e, u){
  if(!ctx.red007 || !e.tipo_equipo || !u) return e.nombre;
  const s = ` en ${u.nombre}`;
  const i = e.nombre.indexOf(s);
  return i > 0 ? e.nombre.slice(0, i) + e.nombre.slice(i + s.length) : e.nombre;
}

// Red de la finca (007) de un equipo, como chip con su color.
function chipRed(ctx, e){
  const r = ctx.red007 && e.red_id !== null && e.red_id !== undefined ? ctx.redPorId.get(e.red_id) : null;
  return r ? `<span class="${P}mapa-red-chip" style="--red-color:${esc(r.color)}" title="Red ${esc(r.nombre)}">${esc(r.nombre)}</span>` : "";
}

function pillEstado(estado){
  const e = infoEstado(estado);
  return `<span class="${P}mapa-estado ${P}mapa-estado-${estado}" style="--estado-color:${e.color}">${esc(estado === "caido" ? "Caído" : e.etiqueta)}</span>`;
}

function contarEnUbicacion(ctx, ubicacionId){
  const equipos = (ctx.indices.equiposPorUbicacion.get(ubicacionId) || []).length;
  const activos = (ctx.indices.activosPorUbicacion.get(ubicacionId) || []).length;
  return { equipos, activos };
}

function plural(n, uno, varios){ return `${n} ${n === 1 ? uno : varios}`; }

function nombreEquipo(ctx, id){
  const e = ctx.red.equipoPorId.get(id);
  return e ? e.nombre : `equipo #${id}`;
}
function nombreUbicacionDe(ctx, id){
  const e = ctx.red.equipoPorId.get(id);
  const u = e ? ctx.red.ubicacionPorId.get(e.ubicacion_id) : null;
  return u ? u.nombre : "—";
}

// ---------------------------------------------------------------------------
// Sin selección: cifras + lista de ubicaciones (también sirve para llegar a
// una ubicación con teclado o cuando dos marcadores se tapan).
// ---------------------------------------------------------------------------
export function htmlPanelResumen(ctx){
  const r = ctx.resumen;
  const rr = ctx.resumenRed;
  const visibles = ordenarUbicaciones(ctx.ubicacionesVisibles, ctx.tipos);
  const filas = visibles.map(u=>{
    const c = contarEnUbicacion(ctx, u.id);
    const info = infoTipoUbicacion(ctx.tipos, u.tipo);
    const est = ctx.sim ? ctx.estadoUbicaciones.get(u.id) : null;
    const sub = [info.etiqueta, c.equipos ? plural(c.equipos, "equipo", "equipos") : "", c.activos ? plural(c.activos, "activo", "activos") : "", u.activa === false ? "archivada" : "", est && est.sinConexion ? `${est.sinConexion} sin conectividad` : ""].filter(Boolean).join(" · ");
    return `<li><button type="button" class="${P}mapa-fila" data-accion="ver-ubicacion" data-id="${u.id}">
      <span class="${P}mapa-punto" style="background:${info.color}"></span>
      <span class="${P}mapa-fila-texto"><span class="${P}mapa-fila-titulo">${esc(u.nombre)}</span><span class="${P}mapa-fila-sub">${esc(sub)}</span></span>
    </button></li>`;
  }).join("");
  const ocultas = ctx.ubicacionesTotal - visibles.length;
  return `
    <div class="${P}mapa-panel-cabecera">
      <div class="${P}mapa-panel-titulo">Ubicaciones y radioenlaces</div>
      <div class="${P}mapa-panel-sub">Haz clic en un marcador para ver sus equipos y activos, y en un equipo para ver su camino hasta la raíz.${ctx.esAdmin ? " Clic derecho en el mapa para crear una ubicación ahí." : ""}</div>
    </div>
    ${ctx.red007 && ctx.puedeSimular ? htmlAtajos(ctx) : ""}
    ${ctx.simActiva ? htmlResumenSimulacion(ctx) : ""}
    <div class="${P}mapa-cifras">
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.ubicaciones}</span><span class="${P}mapa-cifra-lbl">${r.ubicaciones === 1 ? "ubicación" : "ubicaciones"}</span></div>
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.equipos}</span><span class="${P}mapa-cifra-lbl">equipos de red</span></div>
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.enlaces}</span><span class="${P}mapa-cifra-lbl">${r.enlaces === 1 ? "radioenlace" : "radioenlaces"}</span></div>
      <div class="${P}mapa-cifra"><span class="${P}mapa-cifra-num">${r.activosUbicados}</span><span class="${P}mapa-cifra-lbl">activos ubicados</span></div>
    </div>
    ${r.equipos ? `<div class="${P}mapa-nota ${P}mapa-nota-red">${[plural(rr.raices, "raíz", "raíces"), plural(rr.backbone, "enlace backbone", "enlaces backbone"), plural(rr.p2mp, "enlace P2MP", "enlaces P2MP"), plural(rr.respaldos, "respaldo registrado", "respaldos registrados")].join(" · ")}</div>` : ""}
    ${r.activosSinUbicacion ? `<div class="${P}mapa-nota">${plural(r.activosSinUbicacion, "activo todavía no tiene", "activos todavía no tienen")} ubicación.${ctx.puedeAsignar ? " Se asignan desde el panel de cada ubicación (botón «+ Asignar»)." : ""}</div>` : ""}
    <div class="${P}section-title">Ubicaciones${ocultas > 0 ? ` <span class="${P}mapa-muted">(${ocultas} oculta${ocultas === 1 ? "" : "s"} por filtros)</span>` : ""}</div>
    ${filas ? `<ul class="${P}mapa-lista">${filas}</ul>` : `<div class="${P}mapa-vacio">${ctx.ubicacionesTotal ? "Ninguna ubicación coincide con los filtros." : `Todavía no hay ubicaciones.${ctx.esAdmin ? " Usa «+ Ubicación» o clic derecho en el mapa." : ""}`}</div>`}`;
}

// Atajos de simulación (007): cada uno apaga uno o más equipos con un toggle.
function htmlAtajos(ctx){
  const activos = new Set(ctx.simEstado.atajos || []);
  const hayCaidas = !!(ctx.sim && ctx.sim.caidos.size);
  const filas = ctx.atajos.map(a=>{
    const on = activos.has(a.id);
    const n = (a.equipos || []).filter(id=>ctx.red.equipoPorId.has(id)).length;
    return `<li class="${P}mapa-atajo${on ? ` ${P}mapa-atajo-on` : ""}">
      <button type="button" class="${P}mapa-atajo-switch" role="switch" aria-checked="${on}" data-accion="alternar-atajo" data-id="${a.id}" title="${on ? "Levantar" : "Simular la caída de"} ${esc(plural(n, "equipo", "equipos"))}">
        <span class="${P}mapa-switch" aria-hidden="true"></span>
        <span class="${P}mapa-atajo-nombre">${esc(a.nombre)}</span>
        <span class="${P}mapa-muted">${plural(n, "equipo", "equipos")}</span>
      </button>
      ${ctx.esAdmin ? btn("editar-atajo", "Editar", { id: a.id, clase: `${P}btn-ghost`, titulo: `Editar el atajo «${a.nombre}»` }) : ""}
    </li>`;
  }).join("");
  return `<section class="${P}mapa-atajos" aria-label="Atajos de simulación">
    <div class="${P}mapa-seccion-cab">
      <span class="${P}section-title">Atajos de simulación</span>
      ${ctx.esAdmin && hayCaidas ? btn("guardar-atajo", "Guardar caídas como atajo", { titulo: "Guarda los equipos caídos ahora como un atajo con nombre" }) : ""}
    </div>
    ${filas ? `<ul class="${P}mapa-atajos-lista">${filas}</ul>`
      : `<div class="${P}mapa-vacio">Sin atajos todavía.${ctx.esAdmin ? " Marca las caídas que quieras (casillas de cada torre) y usa «Guardar caídas como atajo»." : " Los crea el administrador."}</div>`}
  </section>`;
}

function htmlResumenSimulacion(ctx){
  const c = ctx.sim.cuentas;
  const caidos = [...ctx.sim.caidos];
  const sinConexion = [...ctx.sim.estado].filter(([, st])=>st.estado === "sin_conexion").map(([id])=>id);
  const lista = (ids, max = 8, extra = ()=>"")=>ids.slice(0, max).map(id=>`<li><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${id}">${esc(nombreEquipo(ctx, id))}</button> <span class="${P}mapa-muted">en ${esc(nombreUbicacionDe(ctx, id))}</span>${extra(id)}</li>`).join("") + (ids.length > max ? `<li class="${P}mapa-muted">y ${ids.length - max} más</li>` : "");
  // A dónde conmutó cada caído (o que quedó sin salida).
  const destinoCaido = id=>{
    const st = ctx.sim.estado.get(id);
    return st && st.conectado
      ? ` · <span class="${P}mapa-sim-recuperado">↺ recuperado vía respaldo → ${esc(nombreEquipo(ctx, st.via))}</span>`
      : ` · <span class="${P}mapa-muted">sin conectividad</span>`;
  };
  return `<section class="${P}mapa-sim-resumen" aria-label="Simulación de fallas">
    <div class="${P}mapa-sim-titulo">Simulación de fallas <span class="${P}mapa-muted">(solo en esta pantalla, no se guarda)</span></div>
    ${caidos.length ? `
      <div class="${P}mapa-sim-cifras">
        <span>${pillEstado("caido")} ${c.caido}</span>
        <span>${pillEstado("respaldo")} ${c.respaldo}</span>
        <span>${pillEstado("sin_conexion")} ${c.sin_conexion}</span>
      </div>
      <div class="${P}mapa-sim-sub">Caídos</div><ul class="${P}mapa-sim-lista">${lista(caidos, 8, destinoCaido)}</ul>
      ${sinConexion.length ? `<div class="${P}mapa-sim-sub">Sin conectividad</div><ul class="${P}mapa-sim-lista">${lista(sinConexion)}</ul>` : ""}
      <div class="${P}mapa-acciones">${btn("restablecer-simulacion", "Restablecer simulación")}</div>`
      : `<div class="${P}mapa-panel-sub">Selecciona un equipo y usa «Simular caída de este equipo»: se corta su enlace de subida y el mapa muestra a qué respaldo conmuta y qué queda sin conectividad.</div>`}
  </section>`;
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
    ${ctx.simActiva ? htmlResumenSimulacionCorto(ctx) : ""}

    <section class="${P}mapa-seccion" aria-label="Equipos de red">
      <div class="${P}mapa-seccion-cab">
        <span class="${P}section-title">Equipos de red (${equipos.length})</span>
        ${ctx.esAdmin ? btn("nuevo-equipo", "+ Equipo", { id: u.id }) : ""}
      </div>
      ${equipos.length && ctx.puedeSimular ? `<div class="${P}mapa-ayuda-caida">Marca la casilla de un equipo para simular su caída (solo en esta pantalla, no se guarda).</div>` : ""}
      ${equipos.length
        ? `<ul class="${P}mapa-lista">${equipos.map(e=>htmlEquipo(ctx, e, s.equipoId === e.id, u)).join("")}</ul>`
        : `<div class="${P}mapa-vacio">Sin equipos de red.</div>`}
    </section>

    ${htmlCableado(ctx, u, equipos)}

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

// Diagrama del cableado dentro de la ubicación: un árbol por cada equipo que
// recibe la conexión de afuera (o es raíz), con sus equipos por cable debajo
// (switches, cámaras…). Solo aparece si en la ubicación hay alguna conexión
// por cable.
function htmlCableado(ctx, u, equipos){
  const aqui = new Set(equipos.map(e=>e.id));
  const hijos = new Map();
  for(const e of equipos){
    if(e.servidor_id !== null && e.servidor_id !== undefined && aqui.has(e.servidor_id)){
      if(!hijos.has(e.servidor_id)) hijos.set(e.servidor_id, []);
      hijos.get(e.servidor_id).push(e);
    }
  }
  if(!hijos.size) return "";
  const raices = equipos.filter(e=>!(e.servidor_id !== null && e.servidor_id !== undefined && aqui.has(e.servidor_id)));
  const nodo = (e, profundidad)=>{
    const st = ctx.sim ? ctx.sim.estado.get(e.id) : null;
    const s = e.servidor_id !== null && e.servidor_id !== undefined ? ctx.red.equipoPorId.get(e.servidor_id) : null;
    const us = s ? ctx.red.ubicacionPorId.get(s.ubicacion_id) : null;
    const subida = profundidad === 0
      ? (s ? `<span class="${P}mapa-cableado-subida">${ICONO_ONDA} de ${esc(us ? us.nombre : "otra ubicación")}</span>` : `<span class="${P}mapa-cableado-subida">raíz</span>`)
      : "";
    const lista = (hijos.get(e.id) || []).map(h=>nodo(h, profundidad + 1)).join("");
    return `<li class="${P}mapa-cableado-nodo${st && st.estado !== "servicio" ? ` ${P}mapa-cableado-${st.estado}` : ""}">
      <div class="${P}mapa-cableado-fila">
        ${profundidad > 0 ? `<span class="${P}mapa-cableado-simbolo" aria-label="por cable">${ICONO_CABLE}</span>` : ""}
        <button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${e.id}" title="${esc(e.nombre)}">${esc(nombreEnUbicacion(ctx, e, u))}</button>
        ${chipRed(ctx, e)}${st && st.estado !== "servicio" ? pillEstado(st.estado) : ""}${subida}
      </div>
      ${lista ? `<ul class="${P}mapa-cableado-hijos">${lista}</ul>` : ""}
    </li>`;
  };
  return `<section class="${P}mapa-seccion ${P}mapa-cableado" aria-label="Cableado en esta ubicación">
    <div class="${P}mapa-seccion-cab"><span class="${P}section-title">Cableado en esta ubicación</span></div>
    <ul class="${P}mapa-cableado-arbol">${raices.map(e=>nodo(e, 0)).join("")}</ul>
  </section>`;
}

function htmlResumenSimulacionCorto(ctx){
  const c = ctx.sim.cuentas;
  return `<div class="${P}mapa-sim-barra">
    <span class="${P}mapa-sim-titulo">Simulación</span>
    <span>${pillEstado("caido")} ${c.caido}</span><span>${pillEstado("respaldo")} ${c.respaldo}</span><span>${pillEstado("sin_conexion")} ${c.sin_conexion}</span>
    ${ctx.sim.caidos.size ? btn("restablecer-simulacion", "Restablecer", { titulo: "Restablecer simulación" }) : ""}
  </div>`;
}

function htmlEquipo(ctx, e, seleccionado, u = null){
  const activo = e.activo_id !== null && e.activo_id !== undefined ? ctx.indices.activoPorId.get(e.activo_id) : null;
  const clientes = ctx.red.clientes.get(e.id) || [];
  const st = ctx.sim ? ctx.sim.estado.get(e.id) : null;
  const sub = [e.modelo, activo ? fmtTag(activo) : (e.activo_id ? `activo #${e.activo_id}` : "")].filter(Boolean).join(" · ");
  const caido = !!(ctx.sim && ctx.sim.caidos.has(e.id));
  // Caído solo por un atajo encendido: la casilla se ve marcada y bloqueada
  // (se levanta apagando el atajo).
  const porAtajo = caido && !(ctx.simEstado.caidos || []).includes(e.id) ? atajosQueLoApagan(e.id, { atajosActivos: ctx.simEstado.atajos, atajos: ctx.atajos }) : [];
  const tituloCasilla = porAtajo.length
    ? `Caído por el atajo ${porAtajo.map(a=>`«${a.nombre}»`).join(", ")}: apágalo para levantarlo`
    : (caido ? "Quitar la caída simulada" : "Simular la caída de este equipo (solo en esta pantalla)");
  // Casilla para simular la caída sin abrir el detalle (va fuera del botón de
  // la fila: un control no puede ir dentro de otro).
  const casilla = ctx.puedeSimular
    ? `<label class="${P}mapa-caida-check${porAtajo.length ? ` ${P}mapa-caida-bloqueada` : ""}" title="${esc(tituloCasilla)}">
        <input type="checkbox" data-accion="casilla-caida" data-id="${e.id}"${caido ? " checked" : ""}${porAtajo.length ? " disabled" : ""} aria-label="Simular caída de «${esc(e.nombre)}»">
        <span class="${P}mapa-caida-caja" aria-hidden="true"></span>
      </label>`
    : "";
  const red = chipRed(ctx, e);
  return `<li class="${P}mapa-equipo${seleccionado ? ` ${P}mapa-equipo-sel` : ""}${st && st.estado !== "servicio" ? ` ${P}mapa-equipo-${st.estado}` : ""}" data-equipo-id="${e.id}">
    <div class="${P}mapa-equipo-fila">
      ${casilla}
      <button type="button" class="${P}mapa-fila" data-accion="seleccionar-equipo" data-id="${e.id}" aria-pressed="${seleccionado}" aria-expanded="${seleccionado}" title="${seleccionado ? "Plegar el detalle de este equipo" : "Desplegar su detalle y su camino hasta la raíz"}">
        <span class="${P}mapa-icono-radio">${GLIFO_RADIO}</span>
        <span class="${P}mapa-fila-texto">
          <span class="${P}mapa-fila-titulo" title="${esc(e.nombre)}">${esc(nombreEnUbicacion(ctx, e, u))}</span>
          <span class="${P}mapa-fila-meta">${pillRolOTipo(ctx, e)}${st ? pillEstado(st.estado) : ""}${red}${sub ? `<span class="${P}mapa-fila-sub">${esc(sub)}</span>` : ""}</span>
        </span>
        <span class="${P}mapa-contador" title="${plural(clientes.length, "cliente", "clientes")}">↓ ${clientes.length}</span>
        <span class="${P}mapa-chevron" aria-hidden="true"></span>
      </button>
    </div>
    ${seleccionado ? htmlEquipoDetalle(ctx, e, activo) : ""}
  </li>`;
}

// Tramo entre dos puntos del camino: la línea separadora lleva el símbolo del
// medio (onda o cable) y, junto a ella, el badge «inalámbrico» / «cable»
// (más «vía respaldo» o «cortado» en la simulación y la distancia si es radio).
function htmlConectorCamino(ctx, t){
  const medio = t.cable ? "cable" : "inalambrico";
  const d = t.cable ? null : describirConexion(ctx.red, t.cliente, t.servidor);
  const roto = !!(ctx.sim && !t.funciona);
  const badges = [
    `<span class="${P}mapa-camino-medio">${t.cable ? "cable" : "inalámbrico"}${d && d.distanciaKm !== null && d.distanciaKm !== undefined ? ` · ${esc(fmtDistancia(d.distanciaKm))}` : ""}</span>`,
    t.respaldo ? `<span class="${P}mapa-camino-marca ${P}mapa-camino-respaldo">vía respaldo</span>` : "",
    roto ? `<span class="${P}mapa-camino-marca ${P}mapa-camino-cortado">cortado</span>` : "",
  ].join("");
  return `<div class="${P}mapa-camino-conector ${P}mapa-camino-${medio}${t.respaldo ? ` ${P}mapa-camino-conector-respaldo` : ""}${roto ? ` ${P}mapa-camino-conector-roto` : ""}">
    <span class="${P}mapa-camino-simbolo" aria-hidden="true">${t.cable ? ICONO_CABLE : ICONO_ONDA}</span>${badges}
  </div>`;
}

function htmlDatosConexion(d){
  if(d.cable) return `<div class="${P}mapa-muted">Por cable (misma ubicación).</div>`;
  return `<dl class="${P}mapa-enlace-datos">
      <div><dt>Distancia</dt><dd>${fmtDistancia(d.distanciaKm)}</dd></div>
      <div><dt>Azimut desde aquí</dt><dd>${fmtAzimut(d.azimutIda)}</dd></div>
      <div><dt>Azimut desde allá</dt><dd>${fmtAzimut(d.azimutVuelta)}</dd></div>
    </dl>`;
}

function textoSimulacion(ctx, e, st){
  if(!st) return "";
  const destino = st.via !== null ? `«${esc(nombreEquipo(ctx, st.via))}» en «${esc(nombreUbicacionDe(ctx, st.via))}»` : "";
  const prioridad = st.respaldo ? ` (prioridad ${st.respaldo.prioridad})` : "";
  if(st.caido && st.conectado) return `<strong>Caído:</strong> se cortó su enlace de subida. <strong>Recuperado vía respaldo</strong> → ${destino}${prioridad}.`;
  if(st.caido) return `<strong>Caído y sin conectividad:</strong> se cortó su enlace de subida y no tiene ningún respaldo con servicio. Todo su subárbol que no tenga respaldo propio queda sin conectividad.`;
  if(st.estado === "respaldo") return `<strong>Vía respaldo:</strong> su servidor perdió el servicio y conmutó a ${destino}${prioridad}.`;
  if(st.estado === "sin_conexion") return `<strong>Sin conectividad:</strong> su camino a la raíz está cortado${(ctx.red.respaldosPorEquipo.get(e.id) || []).length ? " y ninguno de sus respaldos tiene servicio" : " y no tiene respaldos registrados"}.`;
  if(st.rutaAlterna) return `En servicio, pero por un camino de respaldo más arriba en la cadena.`;
  return `En servicio por su camino normal.`;
}

function htmlEquipoDetalle(ctx, e, activo){
  const red = ctx.red;
  const st = ctx.sim ? ctx.sim.estado.get(e.id) : null;
  const caido = !!(ctx.sim && ctx.sim.caidos.has(e.id));
  const principal = e.servidor_id !== null && e.servidor_id !== undefined ? describirConexion(red, e.id, e.servidor_id) : null;
  const camino = caminoARaiz(red, e.id, ctx.sim);
  const tramos = tramosDeCamino(red, camino, ctx.sim);
  const clientes = red.clientes.get(e.id) || [];
  const remotos = red.clientesRemotos.get(e.id) || [];
  const agrupado = red.agrupados.has(e.id);
  const respaldos = red.respaldosPorEquipo.get(e.id) || [];
  const raizAlcanzada = camino.length && red.rol.get(camino[camino.length - 1]) === "raiz" && (!ctx.sim || (ctx.sim.estado.get(camino[camino.length - 1]) || {}).conectado);

  const simulacion = `<div class="${P}mapa-sim-control">
      ${btn("simular-caida", caido ? "✓ Simulando caída — quitar" : "Simular caída de este equipo", { id: e.id, pressed: caido, clase: `${P}mapa-btn-simular`, titulo: "Corta su enlace de subida solo en esta pantalla (no se guarda)" })}
      ${ctx.sim && ctx.sim.caidos.size ? btn("restablecer-simulacion", "Restablecer simulación") : ""}
    </div>
    ${st ? `<div class="${P}mapa-sim-estado ${P}mapa-sim-estado-${st.estado}">${textoSimulacion(ctx, e, st)}</div>` : ""}`;

  const servidor = `<div class="${P}mapa-bloque">
      <div class="${P}mapa-bloque-titulo">Servidor</div>
      ${principal ? `<div class="${P}mapa-enlace${caido ? ` ${P}mapa-enlace-cortado` : ""}">
          <div class="${P}mapa-enlace-cab"><span class="${P}mapa-enlace-flecha">↑</span> <button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${principal.servidor.id}"><strong>${esc(principal.servidor.nombre)}</strong></button> <span class="${P}mapa-muted">en ${esc(principal.ubicacionServidor ? principal.ubicacionServidor.nombre : "—")}</span>${caido ? ` <span class="${P}mapa-estado ${P}mapa-estado-caido">cortado</span>` : ""}</div>
          ${htmlDatosConexion(principal)}
        </div>`
        : `<div class="${P}mapa-vacio">Raíz: punto de entrada de internet (no tiene servidor).</div>`}
    </div>`;

  const pasos = camino.map((id, i)=>{
    const conector = i === 0 ? "" : htmlConectorCamino(ctx, tramos[i - 1]);
    const roto = ctx.sim && i > 0 && !tramos[i - 1].funciona;
    return `<li class="${P}mapa-camino-paso${roto ? ` ${P}mapa-camino-roto` : ""}">${conector}<div class="${P}mapa-camino-nodo"><span class="${P}mapa-camino-punto" aria-hidden="true"></span><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${id}"${id === e.id ? ` aria-current="true"` : ""}>${esc(nombreEquipo(ctx, id))}</button> <span class="${P}mapa-muted">${esc(nombreUbicacionDe(ctx, id))}</span>${i === camino.length - 1 && red.rol.get(id) === "raiz" ? ` ${pillRol("raiz")}` : ""}</div></li>`;
  }).join("");
  const caminoHtml = camino.length > 1 || principal ? `<div class="${P}mapa-bloque">
      <div class="${P}mapa-bloque-titulo">Camino a la raíz ${camino.length > 1 ? `<span class="${P}mapa-muted">(${plural(camino.length - 1, "salto", "saltos")})</span>` : ""}</div>
      <ol class="${P}mapa-camino">${pasos}</ol>
      ${!raizAlcanzada ? `<div class="${P}mapa-sim-estado ${P}mapa-sim-estado-sin_conexion">El camino no llega a una raíz con servicio.</div>` : ""}
    </div>` : "";

  const listaClientes = clientes.slice(0, MAX_CLIENTES_LISTA).map(c=>{
    const cst = ctx.sim ? ctx.sim.estado.get(c.id) : null;
    const cable = c.ubicacion_id === e.ubicacion_id;
    return `<li><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${c.id}">${esc(c.nombre)}</button> <span class="${P}mapa-muted">${esc(nombreUbicacionDe(ctx, c.id))}${cable ? " · cable" : ""}</span>${cst && cst.estado !== "servicio" ? ` ${pillEstado(cst.estado)}` : ""}</li>`;
  }).join("") + (clientes.length > MAX_CLIENTES_LISTA ? `<li class="${P}mapa-muted">y ${clientes.length - MAX_CLIENTES_LISTA} más</li>` : "");
  const clasePropia = remotos.length === 1 ? "backbone (punto a punto)" : (remotos.length > 1 ? "distribución P2MP" : "");
  const clientesHtml = `<div class="${P}mapa-bloque">
      <div class="${P}mapa-bloque-cab">
        <span class="${P}mapa-bloque-titulo">Clientes (${clientes.length})${clasePropia ? ` <span class="${P}mapa-muted">· ${clasePropia}</span>` : ""}</span>
        ${agrupado ? btn("alternar-expandido", ctx.expandidos.has(e.id) ? "Agrupar líneas" : "Fijar sus líneas", { id: e.id, pressed: ctx.expandidos.has(e.id), titulo: ctx.expandidos.has(e.id) ? "Volver a mostrar solo el indicador de clientes" : "Mantener sus líneas en el mapa aunque selecciones otra cosa" }) : ""}
      </div>
      ${clientes.length ? `<ul class="${P}mapa-sublista">${listaClientes}</ul>` : `<div class="${P}mapa-vacio">No alimenta a ningún equipo.</div>`}
      ${agrupado ? `<div class="${P}mapa-muted">Tiene más de ${ctx.umbralAgrupar} clientes: en el mapa se muestra agrupado y sus líneas se ven al seleccionarlo.</div>` : ""}
    </div>`;

  const filasRespaldo = respaldos.map(r=>{
    const d = describirConexion(red, e.id, r.servidor_alternativo_id);
    const enUso = !!(st && st.conectado && st.respaldo && st.respaldo.id === r.id);
    return `<li class="${P}mapa-respaldo${enUso ? ` ${P}mapa-respaldo-en-uso` : ""}" data-respaldo-id="${r.id}">
      <span class="${P}mapa-respaldo-prioridad" title="Prioridad ${r.prioridad} (1 = primera opción)">${r.prioridad}</span>
      <span class="${P}mapa-respaldo-texto"><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${r.servidor_alternativo_id}">${esc(d ? d.servidor.nombre : nombreEquipo(ctx, r.servidor_alternativo_id))}</button>
        <span class="${P}mapa-muted">en ${esc(d && d.ubicacionServidor ? d.ubicacionServidor.nombre : "—")} · ${d && d.cable ? "cable" : fmtDistancia(d ? d.distanciaKm : null)}</span>
        ${enUso ? `<span class="${P}mapa-estado ${P}mapa-estado-respaldo">en uso</span>` : ""}
        ${r.notas ? `<span class="${P}mapa-respaldo-notas">${esc(r.notas)}</span>` : ""}</span>
      ${ctx.esAdmin ? `<span class="${P}mapa-respaldo-acciones">${btn("editar-respaldo", "Editar", { id: r.id })}${btn("eliminar-respaldo", "Quitar", { id: r.id, titulo: "Quitar este respaldo" })}</span>` : ""}
    </li>`;
  }).join("");
  const respaldosHtml = `<div class="${P}mapa-bloque">
      <div class="${P}mapa-bloque-cab">
        <span class="${P}mapa-bloque-titulo">Respaldos (${respaldos.length})</span>
        ${ctx.esAdmin ? btn("nuevo-respaldo", "+ Respaldo", { id: e.id, titulo: "Registrar a qué otro servidor puede conmutar" }) : ""}
      </div>
      ${respaldos.length ? `<ol class="${P}mapa-respaldos">${filasRespaldo}</ol>` : `<div class="${P}mapa-vacio">Sin respaldos: si pierde su servidor, queda sin conectividad.</div>`}
    </div>`;

  return `<div class="${P}mapa-equipo-detalle">
      ${ctx.puedeSimular ? simulacion : ""}
      <div class="${P}mapa-equipo-meta">${pillRolOTipo(ctx, e)}${ctx.red007 && e.tipo_equipo && ctx.tipoPorValor.get(e.tipo_equipo) ? `<span class="${P}mapa-muted">${esc(ctx.tipoPorValor.get(e.tipo_equipo).etiqueta)}${e.referencia ? ` · ${esc(e.referencia)}` : ""}</span>` : ""}${chipRed(ctx, e)}</div>
      ${servidor}
      ${caminoHtml}
      ${clientesHtml}
      ${respaldosHtml}
      ${e.notas ? `<div class="${P}mapa-panel-notas">${esc(e.notas)}</div>` : ""}
      <div class="${P}mapa-acciones">
        ${activo ? btn("ver-activo", `Ver activo ${esc(fmtTag(activo))}`, { id: activo.id }) : ""}
        ${ctx.esAdmin ? btn("editar-equipo", "Editar", { id: e.id }) + btn("eliminar-equipo", "Eliminar", { id: e.id, clase: `${P}btn-danger` }) : ""}
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
