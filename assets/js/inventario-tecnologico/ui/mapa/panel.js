// HTML del panel lateral del mapa. Solo arma strings a partir de un
// "contexto" (datos ya indexados, la red, la simulación y los permisos); los
// clics los atiende vista-mapa.js por delegación, leyendo data-accion / data-id.
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { fmtAzimut, fmtCoordenadas, fmtDistancia, urlGoogleMaps } from "../../nucleo/geo.js";
import { infoTipoUbicacion, ordenarUbicaciones } from "../../nucleo/mapa-logica.js";
import { caminoARaiz, describirConexion, infoEstado, infoMedio, infoRol, medioEnlace, redEfectivaDe, redHeredadaDe, tramosDeCamino } from "../../nucleo/mapa-jerarquia.js";
import { atajosQueLoApagan } from "../../nucleo/mapa-nombres.js";
import { colorTipo, iconoTipoTam, tintarClaro } from "../../nucleo/opciones-configurables.js";
import { urlFoto } from "../../negocio/operaciones.js";
import { GLIFO_RADIO } from "./leaflet.js";
import { normalizarCobertura, textoCobertura } from "../../nucleo/cobertura.js";
import { cargarTiposActivo } from "../../nucleo/datos.js";
import { iconoTipoEquipo } from "./iconos-equipo.js";
import { haceRadioTipo, llevaMarcaRouter, textoRangos } from "../../nucleo/modo-red.js";

const P = "inventario-tecnologico-";
const MAX_CLIENTES_LISTA = 12;

// Símbolos del camino a la raíz y del cableado: onda = enlace inalámbrico,
// enchufe = cable, punta con luz = fibra, globo = entrada de internet.
const ICONO_ONDA = `<svg viewBox="0 0 20 12" width="14" height="9" aria-hidden="true" focusable="false"><path d="M1 6c1.5-4 3-4 4.5 0s3 4 4.5 0 3-4 4.5 0 3 4 4.5 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>`;
const ICONO_CABLE = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M5.5 1.5v3M10.5 1.5v3M3.5 4.5h9v3a4.5 4.5 0 0 1-9 0zM8 12v2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONO_FIBRA = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M1.5 8h7.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="11" cy="8" r="2.3" fill="currentColor"/><path d="M11 2.4v1.4M11 12.2v1.4M14.6 8h-1.3M13.6 5.2l-.9.9M13.6 10.8l-.9-.9" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const ICONO_GLOBO = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M1.9 8h12.2M8 1.8c2.2 2.2 2.2 10.2 0 12.4M8 1.8c-2.2 2.2-2.2 10.2 0 12.4" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
const ICONO_CAJA = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path d="M2.5 4.8 8 2.2l5.5 2.6v6.4L8 13.8l-5.5-2.6zM2.5 4.8 8 7.4l5.5-2.6M8 7.4v6.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const ICONO_RAYO = `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false"><path d="M9.2 1.5 3.6 9h4l-1 5.5L12.4 7h-4z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const ICONO_MEDIO = { inalambrico: ICONO_ONDA, cable: ICONO_CABLE, fibra: ICONO_FIBRA };

const tieneValor = v=>v !== null && v !== undefined;

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
// muestra su tipo. De fábrica, PtP, AP y Estación; con la 014 lo dice cada
// tipo («Hace radio» en «Redes y tipos»).
function pillRolOTipo(ctx, e){
  const t = ctx.red007 && e.tipo_equipo ? ctx.tipoPorValor.get(e.tipo_equipo) : null;
  if(t && haceRadioTipo(t) === false) return `<span class="${P}mapa-rol ${P}mapa-rol-tipo" title="Tipo de equipo">${esc(t.etiqueta)}</span>`;
  return pillRol(ctx.red.rol.get(e.id));
}

// v17 (014): la marca «Router» junto al equipo que enruta (capa 3), salvo que
// su tipo ya sea Router. El nombre automático no cambia.
function marcaRouter(ctx, e){
  if(!ctx.modoRed014) return "";
  const t = e.tipo_equipo ? (ctx.tipoPorValor.get(e.tipo_equipo) || { valor: e.tipo_equipo }) : null;
  if(!llevaMarcaRouter(e, t)) return "";
  const propio = e.modo_red === "router";
  return `<span class="${P}mapa-marca-router" title="${esc(`Trabaja como router (capa 3)${propio ? "" : ", como su tipo"}: define una red para lo que cuelga de él`)}">Router</span>`;
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

// Red de la finca (007) de un equipo, como chip con su color. Con la 011, la
// heredada del servidor va con borde punteado y dice de quién la hereda; la
// propia (la que empieza una red o una red aparte), con borde lleno.
function chipRed(ctx, e){
  const id = ctx.red007 ? redEfectivaDe(e) : null;
  const r = id !== null ? ctx.redPorId.get(id) : null;
  if(!r) return "";
  const desde = redHeredadaDe(e);
  const origen = desde !== null ? ctx.red.equipoPorId.get(desde) : null;
  // 014: el title lleva también sus rangos IP.
  const rangos = ctx.modoRed014 && (r.rangos_ip || []).length ? ` · ${textoRangos(r.rangos_ip)}` : "";
  return desde !== null
    ? `<span class="${P}mapa-red-chip ${P}mapa-red-chip-heredada" style="--red-color:${esc(r.color)}" title="Red ${esc(r.nombre)}${esc(rangos)}, heredada${origen ? ` de «${esc(origen.nombre)}»` : " de su servidor"}">${esc(r.nombre)}</span>`
    : `<span class="${P}mapa-red-chip" style="--red-color:${esc(r.color)}" title="Red ${esc(r.nombre)}${esc(rangos)}">${esc(r.nombre)}</span>`;
}

// v17 (014): en el detalle de un equipo con red propia, la red que define y sus rangos.
function htmlDefineRed(ctx, e){
  if(!ctx.modoRed014 || e.red_id === null || e.red_id === undefined) return "";
  const r = ctx.redPorId.get(e.red_id);
  if(!r) return "";
  const rangos = (r.rangos_ip || []).filter(Boolean);
  return `<div class="${P}mapa-equipo-define-red" data-define-red="${r.id}"><span class="${P}mapa-muted">Define la red</span> <span class="${P}mapa-red-chip" style="--red-color:${esc(r.color)}">${esc(r.nombre)}</span> ${rangos.length ? `<span class="${P}mapa-rangos">${rangos.map(x=>`<code>${esc(x)}</code>`).join(" ")}</span>` : `<span class="${P}mapa-muted">sin rangos IP (se ponen en «Redes y tipos»)</span>`}</div>`;
}

// v16 (3.11): el color del marco del equipo abierto: el de su red efectiva
// (con la herencia), como su chip; sin red, el de acento.
const COLOR_EQUIPO_SIN_RED = "#007EB2";
function colorMarcoEquipo(ctx, e){
  const id = ctx.red007 ? redEfectivaDe(e) : null;
  const r = id !== null && id !== undefined ? ctx.redPorId.get(id) : null;
  return r && /^#[0-9A-Fa-f]{6}$/.test(r.color || "") ? r.color : COLOR_EQUIPO_SIN_RED;
}

// v16: el ícono de cada equipo en la torre es el de su tipo (el mismo del
// tooltip y de «Redes y tipos»: el propio de la 013, el de fábrica, el del
// tipo de activo o, sin tipo, el genérico de radio). Antes era siempre el
// genérico. Sin la 007 no hay tipos: el genérico, como antes.
function iconoEquipoFila(ctx, e){
  if(!ctx.red007 || !e.tipo_equipo) return { svg: GLIFO_RADIO, titulo: ctx.red007 ? "Sin tipo" : "" };
  const tipo = ctx.tipoPorValor.get(e.tipo_equipo) || { valor: e.tipo_equipo };
  return { svg: iconoTipoEquipo(tipo, { tiposEquipo: [...ctx.tipoPorValor.values()], tiposActivo: cargarTiposActivo() }), titulo: tipo.etiqueta || e.tipo_equipo };
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

// Sección del panel como tarjeta: cabecera con su color (ícono, título,
// cantidad y acción) y cuerpo. Cada sección de la ubicación tiene el suyo, así
// se distinguen de un vistazo.
function tarjeta({ tipo, icono, titulo, n = null, accion = "", cuerpo = "", ayuda = "" }){
  return `<section class="${P}mapa-seccion ${P}mapa-tarjeta ${P}mapa-tarjeta-${tipo}" aria-label="${esc(titulo)}">
    <div class="${P}mapa-tarjeta-cab">
      <span class="${P}mapa-tarjeta-icono" aria-hidden="true">${icono}</span>
      <span class="${P}mapa-tarjeta-titulo">${esc(titulo)}</span>
      ${n !== null ? `<span class="${P}mapa-tarjeta-n" title="${esc(plural(n, "elemento", "elementos"))}">${n}</span>` : ""}
      ${accion ? `<span class="${P}mapa-tarjeta-accion">${accion}</span>` : ""}
    </div>
    <div class="${P}mapa-tarjeta-cuerpo">${ayuda ? `<div class="${P}mapa-tarjeta-ayuda">${ayuda}</div>` : ""}${cuerpo}</div>
  </section>`;
}

// Texto del medio con la distancia (si el otro extremo está en otra ubicación).
function textoMedio(medio, distanciaKm){
  return `${infoMedio(medio).badge}${tieneValor(distanciaKm) ? ` · ${esc(fmtDistancia(distanciaKm))}` : ""}`;
}

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
// v16: «Todos los equipos»: una casilla para simular la caída de todos los
// equipos de la ubicación (con 2 o más), en la misma columna que las de cada
// equipo. Todos o ninguno: con algunos caídos se ve a medias; un clic tumba a
// todos y el siguiente los levanta. Los que tumba un atajo siguen caídos hasta
// que se apague el atajo (si todos están caídos por atajos, la casilla queda
// marcada y bloqueada, como la de un equipo).
function htmlCaidaTodos(ctx, u, equipos){
  if(!ctx.puedeSimular || equipos.length < 2) return "";
  const caidos = ctx.sim ? equipos.filter(e=>ctx.sim.caidos.has(e.id)) : [];
  const manuales = new Set(ctx.simEstado.caidos || []);
  const todos = caidos.length === equipos.length;
  const parcial = caidos.length > 0 && !todos;
  const soloAtajos = todos && caidos.every(e=>!manuales.has(e.id));
  const atajos = soloAtajos ? [...new Set(caidos.flatMap(e=>atajosQueLoApagan(e.id, { atajosActivos: ctx.simEstado.atajos, atajos: ctx.atajos }).map(a=>a.nombre)))] : [];
  const titulo = soloAtajos
    ? `Caídos por ${atajos.length === 1 ? "el atajo" : "los atajos"} ${atajos.map(n=>`«${n}»`).join(", ")}: apaga ${atajos.length === 1 ? "el atajo" : "los atajos"} para levantarlos`
    : (todos ? `Levantar todos los equipos de «${u.nombre}»`
      : (parcial ? `${plural(caidos.length, "caído", "caídos")} de ${equipos.length}: un clic tumba a todos`
        : `Simular la caída de todos los equipos de «${u.nombre}» (solo en esta pantalla)`));
  const id = `${P}caida-todos-${u.id}`;
  return `<div class="${P}mapa-caida-todos${todos ? ` ${P}mapa-caida-todos-on` : ""}${parcial ? ` ${P}mapa-caida-todos-parcial` : ""}" data-caida-todos="${u.id}">
      <label class="${P}mapa-caida-check${soloAtajos ? ` ${P}mapa-caida-bloqueada` : ""}" title="${esc(titulo)}">
        <input type="checkbox" id="${id}" data-accion="casilla-caida-ubicacion" data-id="${u.id}"${todos ? " checked" : ""}${parcial ? ` data-parcial="1"` : ""}${soloAtajos ? " disabled" : ""} aria-label="Simular la caída de todos los equipos de «${esc(u.nombre)}»">
        <span class="${P}mapa-caida-caja" aria-hidden="true"></span>
      </label>
      <label class="${P}mapa-caida-todos-texto" for="${id}" title="${esc(titulo)}">Todos los equipos <span class="${P}mapa-muted">(${equipos.length})</span>${caidos.length && !todos ? `<span class="${P}mapa-caida-todos-cuenta">· ${esc(plural(caidos.length, "caído", "caídos"))}</span>` : ""}</label>
    </div>`;
}

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
  return tarjeta({
    tipo: "atajos", icono: ICONO_RAYO, titulo: "Atajos de simulación", n: ctx.atajos.length,
    accion: ctx.esAdmin && hayCaidas ? btn("guardar-atajo", "Guardar caídas como atajo", { titulo: "Guarda los equipos caídos ahora como un atajo con nombre" }) : "",
    cuerpo: filas ? `<ul class="${P}mapa-atajos-lista">${filas}</ul>`
      : `<div class="${P}mapa-vacio">Sin atajos todavía.${ctx.esAdmin ? " Marca las caídas que quieras (casillas de cada torre) y usa «Guardar caídas como atajo»." : " Los crea el administrador."}</div>`,
  });
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
      : ` · <span class="${P}mapa-muted">sin respaldo propio: queda cortado</span>`;
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

    ${tarjeta({
      tipo: "equipos", icono: GLIFO_RADIO, titulo: "Equipos de red", n: equipos.length,
      accion: ctx.esAdmin ? btn("nuevo-equipo", "+ Equipo", { id: u.id }) : "",
      ayuda: equipos.length && ctx.puedeSimular ? (equipos.length > 1
        ? "Marca la casilla de un equipo para simular su caída, o «Todos los equipos» para la de todos (solo en esta pantalla, no se guarda)."
        : "Marca la casilla de un equipo para simular su caída (solo en esta pantalla, no se guarda).") : "",
      cuerpo: equipos.length
        ? `${htmlCaidaTodos(ctx, u, equipos)}<ul class="${P}mapa-lista">${equipos.map(e=>htmlEquipo(ctx, e, s.equipoId === e.id, u)).join("")}</ul>`
        : `<div class="${P}mapa-vacio">Sin equipos de red.</div>`,
    })}

    ${htmlCableado(ctx, u, equipos)}

    ${tarjeta({
      tipo: "activos", icono: ICONO_CAJA, titulo: "Activos en esta ubicación", n: activos.length,
      accion: ctx.puedeAsignar && u.activa !== false ? btn("asignar-activos", "+ Asignar", { id: u.id, titulo: "Asignar o traer activos a esta ubicación" }) : "",
      cuerpo: activos.length
        ? `<ul class="${P}mapa-lista">${activos.map(a=>htmlActivo(ctx, a, u)).join("")}</ul>`
        : `<div class="${P}mapa-vacio">Ningún activo registrado aquí.</div>`,
    })}`;
}

// Cableado dentro de la ubicación, dibujado como el camino a la raíz. Cada
// equipo que recibe la conexión desde afuera (o es raíz) encabeza un árbol:
//   * arriba, su ENTRADA: el símbolo del medio sobre la línea (onda, cable o
//     fibra) y al lado el badge («inalámbrico · 8,58 km») y de dónde viene;
//   * debajo, lo que cuelga de él dentro de la ubicación, cada rama con su
//     conector (símbolo + badge), igual que los tramos del camino;
//   * un respaldo dentro de la ubicación (p. ej. el router que también está
//     cableado al segundo enlace) es una rama punteada: «respaldo · prioridad 1»;
//   * cada equipo dice qué SALE de él hacia otras ubicaciones (por radio,
//     cable o fibra).
// Con la simulación, las ramas que no llevan servicio se marcan (cortado,
// sin servicio, sin uso) y el respaldo en uso se pinta en verde.
// Solo aparece si en la ubicación hay alguna conexión interna.
function htmlCableado(ctx, u, equipos){
  const red = ctx.red;
  const sim = ctx.sim;
  const aqui = new Set(equipos.map(e=>e.id));
  const servidorAqui = e=>tieneValor(e.servidor_id) && aqui.has(e.servidor_id);
  const hijos = new Map();
  for(const e of equipos) if(servidorAqui(e)){ if(!hijos.has(e.servidor_id)) hijos.set(e.servidor_id, []); hijos.get(e.servidor_id).push(e); }
  const respaldosAqui = new Map(); // servidor alternativo (aquí) → [{ equipo, respaldo }]
  for(const e of equipos){
    for(const r of red.respaldosPorEquipo.get(e.id) || []){
      if(!aqui.has(r.servidor_alternativo_id)) continue;
      if(!respaldosAqui.has(r.servidor_alternativo_id)) respaldosAqui.set(r.servidor_alternativo_id, []);
      respaldosAqui.get(r.servidor_alternativo_id).push({ equipo: e, respaldo: r });
    }
  }
  if(!hijos.size && !respaldosAqui.size) return "";
  const estadoDe = id=>sim ? sim.estado.get(id) : null;
  const conectado = id=>{ const st = estadoDe(id); return !sim || !!(st && st.conectado); };

  // Lo que sale de un equipo hacia otras ubicaciones.
  const salidas = e=>{
    const porMedio = new Map();
    for(const c of red.clientes.get(e.id) || []){
      if(c.ubicacion_id === e.ubicacion_id) continue;
      const m = medioEnlace(red, c.id, e.id);
      if(!porMedio.has(m)) porMedio.set(m, []);
      porMedio.get(m).push(c);
    }
    return [...porMedio].map(([m, lista])=>{
      const destino = lista.length === 1
        ? `→ <button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${lista[0].id}" title="${esc(lista[0].nombre)}">${esc(nombreUbicacionDe(ctx, lista[0].id))}</button>`
        : `${lista.length} ${m === "inalambrico" ? "clientes por radio" : `por ${infoMedio(m).badge}`}`;
      return `<span class="${P}mapa-cab-salida ${P}mapa-cab-medio-${m}" title="Sale ${m === "inalambrico" ? "por radio" : `por ${infoMedio(m).badge}`} hacia otra ubicación"><span class="${P}mapa-cab-salida-icono" aria-hidden="true">${ICONO_MEDIO[m]}</span>${destino}</span>`;
    }).join("");
  };

  const fila = (e, extraClase = "")=>{
    const st = estadoDe(e.id);
    const sal = salidas(e);
    return `<div class="${P}mapa-cab-nodo${st && st.estado !== "servicio" ? ` ${P}mapa-cab-nodo-${st.estado}` : ""}${extraClase}">
      <span class="${P}mapa-cab-punto" aria-hidden="true"></span>
      <div class="${P}mapa-cab-texto">
        <button type="button" class="${P}mapa-enlace-texto ${P}mapa-cab-nombre" data-accion="seleccionar-equipo-mapa" data-id="${e.id}" title="${esc(e.nombre)}">${esc(nombreEnUbicacion(ctx, e, u))}</button>
        <span class="${P}mapa-cab-meta">${pillRolOTipo(ctx, e)}${marcaRouter(ctx, e)}${st && st.estado !== "servicio" ? pillEstado(st.estado) : ""}${chipRed(ctx, e)}</span>
        ${sal ? `<span class="${P}mapa-cab-salidas">${sal}</span>` : ""}
      </div>
    </div>`;
  };

  // Conector de una rama (enlace interno principal): servidor p → cliente c.
  const conector = (p, c)=>{
    const m = medioEnlace(red, c.id, p.id);
    const st = estadoDe(c.id);
    let marca = "", clase = "";
    if(sim){
      const funciona = !!(st && st.conectado && st.via === p.id);
      if(st && st.caido){ marca = "cortado"; clase = "roto"; }
      else if(!funciona && st && st.conectado){ marca = "sin uso"; clase = "sin-uso"; }
      else if(!funciona) clase = "roto"; // el cable está bien: lo que falta es el servicio de más arriba
    }
    return `<div class="${P}mapa-cab-conector ${P}mapa-cab-medio-${m}${clase ? ` ${P}mapa-cab-${clase}` : ""}">
      <span class="${P}mapa-cab-simbolo" aria-hidden="true">${ICONO_MEDIO[m]}</span>
      <span class="${P}mapa-camino-medio">${textoMedio(m, null)}</span>${marca ? `<span class="${P}mapa-camino-marca ${P}mapa-cab-marca-${clase}">${marca}</span>` : ""}
    </div>`;
  };

  // Rama de respaldo: el equipo e puede conmutar al servidor alternativo p (aquí).
  const ramaRespaldo = ({ equipo: e, respaldo: r })=>{
    const st = estadoDe(e.id);
    const enUso = !!(st && st.conectado && st.respaldo && st.respaldo.id === r.id);
    const m = medioEnlace(red, e.id, r.servidor_alternativo_id);
    return `<li class="${P}mapa-cab-rama ${P}mapa-cab-rama-respaldo${enUso ? ` ${P}mapa-cab-en-uso` : ""}">
      <div class="${P}mapa-cab-conector ${P}mapa-cab-medio-${m}">
        <span class="${P}mapa-cab-simbolo" aria-hidden="true">${ICONO_MEDIO[m]}</span>
        <span class="${P}mapa-camino-medio">${textoMedio(m, null)} · respaldo</span><span class="${P}mapa-camino-marca ${enUso ? `${P}mapa-camino-respaldo` : ""}" title="Prioridad ${r.prioridad} (1 = primera opción)">${enUso ? "en uso" : `prioridad ${r.prioridad}`}</span>
      </div>
      <div class="${P}mapa-cab-nodo ${P}mapa-cab-nodo-ref">
        <span class="${P}mapa-cab-punto" aria-hidden="true"></span>
        <div class="${P}mapa-cab-texto"><span class="${P}mapa-muted">↺ respaldo de</span> <button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${e.id}" title="${esc(e.nombre)}">${esc(nombreEnUbicacion(ctx, e, u))}</button></div>
      </div>
    </li>`;
  };

  const vistos = new Set();
  const ramas = e=>{
    const lista = [
      ...(hijos.get(e.id) || []).filter(c=>!vistos.has(c.id)).map(c=>{
        vistos.add(c.id);
        const sub = ramas(c);
        return `<li class="${P}mapa-cab-rama${conectado(c.id) ? "" : ` ${P}mapa-cab-rama-sin`}">${conector(e, c)}${fila(c, sub ? ` ${P}mapa-cab-con-hijos` : "")}${sub}</li>`;
      }),
      ...(respaldosAqui.get(e.id) || []).map(ramaRespaldo),
    ];
    return lista.length ? `<ul class="${P}mapa-cab-hijos">${lista.join("")}</ul>` : "";
  };

  // Entrada de un árbol: de dónde recibe la conexión el equipo de arriba.
  const entrada = e=>{
    const s = tieneValor(e.servidor_id) ? red.equipoPorId.get(e.servidor_id) : null;
    if(!s) return `<div class="${P}mapa-cab-entrada ${P}mapa-cab-entrada-raiz">
        <span class="${P}mapa-cab-simbolo" aria-hidden="true">${ICONO_GLOBO}</span>
        <span class="${P}mapa-camino-medio">raíz · entrada de internet</span>
      </div>`;
    const d = describirConexion(red, e.id, s.id);
    const st = estadoDe(e.id);
    let marca = "", clase = "";
    if(sim){
      const funciona = !!(st && st.conectado && st.via === s.id);
      if(st && st.caido){ marca = st.conectado ? "cortado · recuperado vía respaldo" : "cortado"; clase = st.conectado ? "respaldo" : "roto"; }
      else if(!funciona && st && st.conectado){ marca = `vía respaldo → ${esc(nombreEquipo(ctx, st.via))}`; clase = "respaldo"; }
      else if(!funciona){ marca = "sin servicio"; clase = "roto"; }
    }
    return `<div class="${P}mapa-cab-entrada ${P}mapa-cab-medio-${d.medio}${clase ? ` ${P}mapa-cab-${clase}` : ""}">
      <span class="${P}mapa-cab-simbolo" aria-hidden="true">${ICONO_MEDIO[d.medio]}</span>
      <span class="${P}mapa-camino-medio">${textoMedio(d.medio, d.distanciaKm)}</span>${marca ? `<span class="${P}mapa-camino-marca ${P}mapa-cab-marca-${clase}">${marca}</span>` : ""}
      <button type="button" class="${P}mapa-enlace-texto ${P}mapa-cab-origen" data-accion="seleccionar-equipo-mapa" data-id="${s.id}" title="${esc(s.nombre)}"><span class="${P}mapa-muted">desde</span> ${esc(d.mismaUbicacion ? s.nombre : nombreEnUbicacion(ctx, s, d.ubicacionServidor))}${d.mismaUbicacion ? "" : `<span class="${P}mapa-muted"> · ${esc(d.ubicacionServidor ? d.ubicacionServidor.nombre : "otra ubicación")}</span>`}</button>
    </div>`;
  };

  const raices = equipos.filter(e=>!servidorAqui(e));
  const arboles = raices.map(e=>{
    vistos.add(e.id);
    const sub = ramas(e);
    return `<li class="${P}mapa-cab-arbol${conectado(e.id) ? "" : ` ${P}mapa-cab-arbol-sin`}">${entrada(e)}${fila(e, sub ? ` ${P}mapa-cab-con-hijos` : "")}${sub}</li>`;
  });
  const internos = equipos.filter(servidorAqui).length;
  return tarjeta({
    tipo: "cableado", icono: ICONO_CABLE, titulo: "Cableado en esta ubicación", n: internos,
    ayuda: "Arriba, por dónde entra la conexión; debajo, lo que cuelga por cable dentro de la ubicación.",
    cuerpo: `<ol class="${P}mapa-cab">${arboles.join("")}</ol>`,
  });
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
  const icono = iconoEquipoFila(ctx, e);
  // Abierto, la fila y su detalle van en una sola tarjeta del color de su red (v16, 3.11).
  const marco = seleccionado ? colorMarcoEquipo(ctx, e) : null;
  const estiloMarco = marco ? ` style="--equipo-color:${marco};--equipo-suave:${tintarClaro(marco, 0.93)};--equipo-borde:${tintarClaro(marco, 0.55)}"` : "";
  return `<li class="${P}mapa-equipo${seleccionado ? ` ${P}mapa-equipo-sel` : ""}${st && st.estado !== "servicio" ? ` ${P}mapa-equipo-${st.estado}` : ""}" data-equipo-id="${e.id}"${estiloMarco}>
    <div class="${P}mapa-equipo-fila">
      ${casilla}
      <button type="button" class="${P}mapa-fila" data-accion="seleccionar-equipo" data-id="${e.id}" aria-pressed="${seleccionado}" aria-expanded="${seleccionado}" title="${seleccionado ? "Plegar el detalle de este equipo" : "Desplegar su detalle y su camino hasta la raíz"}">
        <span class="${P}mapa-icono-radio"${icono.titulo ? ` title="${esc(icono.titulo)}"` : ""} data-icono-tipo="${esc(e.tipo_equipo || "")}">${icono.svg}</span>
        <span class="${P}mapa-fila-texto">
          <span class="${P}mapa-fila-titulo" title="${esc(e.nombre)}">${esc(nombreEnUbicacion(ctx, e, u))}</span>
          <span class="${P}mapa-fila-meta">${pillRolOTipo(ctx, e)}${marcaRouter(ctx, e)}${st ? pillEstado(st.estado) : ""}${red}${sub ? `<span class="${P}mapa-fila-sub">${esc(sub)}</span>` : ""}</span>
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
  const medio = t.medio || (t.cable ? "cable" : "inalambrico");
  const d = describirConexion(ctx.red, t.cliente, t.servidor);
  const roto = !!(ctx.sim && !t.funciona);
  const badges = [
    `<span class="${P}mapa-camino-medio">${textoMedio(medio, d && !d.mismaUbicacion ? d.distanciaKm : null)}</span>`,
    t.respaldo ? `<span class="${P}mapa-camino-marca ${P}mapa-camino-respaldo">vía respaldo</span>` : "",
    roto ? `<span class="${P}mapa-camino-marca ${P}mapa-camino-cortado">cortado</span>` : "",
  ].join("");
  return `<div class="${P}mapa-camino-conector ${P}mapa-camino-${medio}${t.respaldo ? ` ${P}mapa-camino-conector-respaldo` : ""}${roto ? ` ${P}mapa-camino-conector-roto` : ""}">
    <span class="${P}mapa-camino-simbolo" aria-hidden="true">${ICONO_MEDIO[medio]}</span>${badges}
  </div>`;
}

function htmlDatosConexion(d){
  const porQue = d.medio === "fibra" ? "Por fibra óptica" : "Por cable";
  if(d.cable && d.mismaUbicacion) return `<div class="${P}mapa-muted">${porQue} (misma ubicación).</div>`;
  if(d.cable) return `<div class="${P}mapa-muted">${porQue} · ${esc(fmtDistancia(d.distanciaKm))} hasta su servidor.</div>`;
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

// v16 (3.11): cada sección del detalle de un equipo (Servidor, Camino a la
// raíz, Clientes, Respaldos) va en su propia caja, con una barra de título con
// su ícono y su color (los de las líneas del mapa: backbone, camino, P2MP y
// respaldo), siempre abierta.
const ICONOS_BLOQUE = Object.freeze({
  servidor: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5"/></svg>`,
  camino: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="19" r="2.2"/><circle cx="18" cy="5" r="2.2"/><path d="M8.2 19H14a3.5 3.5 0 0 0 0-7h-4a3.5 3.5 0 0 1 0-7h5.8"/></svg>`,
  clientes: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="2.2"/><path d="M12 7.2V12M12 12 5 19M12 12l7 7M12 12v7"/></svg>`,
  respaldos: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5h14l-3.5-3.5M20 15.5H6l3.5 3.5"/></svg>`,
});
function bloqueDetalle(clase, { etiqueta, titulo, accion = "", cuerpo }){
  return `<section class="${P}mapa-bloque ${P}mapa-bloque-${clase}" aria-label="${esc(etiqueta)}">
      <div class="${P}mapa-bloque-cab">
        <span class="${P}mapa-bloque-icono" aria-hidden="true">${ICONOS_BLOQUE[clase]}</span>
        <span class="${P}mapa-bloque-titulo">${titulo}</span>
        ${accion ? `<span class="${P}mapa-bloque-accion">${accion}</span>` : ""}
      </div>
      <div class="${P}mapa-bloque-cuerpo">${cuerpo}</div>
    </section>`;
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

  const servidor = bloqueDetalle("servidor", { etiqueta: "Servidor", titulo: "Servidor", cuerpo: principal ? `<div class="${P}mapa-enlace${caido ? ` ${P}mapa-enlace-cortado` : ""}">
          <div class="${P}mapa-enlace-cab"><span class="${P}mapa-enlace-flecha">↑</span> <button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${principal.servidor.id}"><strong>${esc(principal.servidor.nombre)}</strong></button> <span class="${P}mapa-muted">en ${esc(principal.ubicacionServidor ? principal.ubicacionServidor.nombre : "—")}</span>${caido ? ` <span class="${P}mapa-estado ${P}mapa-estado-caido">cortado</span>` : ""}</div>
          ${htmlDatosConexion(principal)}
        </div>`
        : `<div class="${P}mapa-vacio">Raíz: punto de entrada de internet (no tiene servidor).</div>` });

  const pasos = camino.map((id, i)=>{
    const conector = i === 0 ? "" : htmlConectorCamino(ctx, tramos[i - 1]);
    const roto = ctx.sim && i > 0 && !tramos[i - 1].funciona;
    return `<li class="${P}mapa-camino-paso${roto ? ` ${P}mapa-camino-roto` : ""}">${conector}<div class="${P}mapa-camino-nodo"><span class="${P}mapa-camino-punto" aria-hidden="true"></span><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${id}"${id === e.id ? ` aria-current="true"` : ""}>${esc(nombreEquipo(ctx, id))}</button> <span class="${P}mapa-muted">${esc(nombreUbicacionDe(ctx, id))}</span>${i === camino.length - 1 && red.rol.get(id) === "raiz" ? ` ${pillRol("raiz")}` : ""}</div></li>`;
  }).join("");
  const caminoHtml = camino.length > 1 || principal ? bloqueDetalle("camino", {
      etiqueta: `Camino a la raíz${camino.length > 1 ? ` (${plural(camino.length - 1, "salto", "saltos")})` : ""}`,
      titulo: `Camino a la raíz ${camino.length > 1 ? `<span class="${P}mapa-muted">(${plural(camino.length - 1, "salto", "saltos")})</span>` : ""}`,
      cuerpo: `<ol class="${P}mapa-camino">${pasos}</ol>
      ${!raizAlcanzada ? `<div class="${P}mapa-sim-estado ${P}mapa-sim-estado-sin_conexion">El camino no llega a una raíz con servicio.</div>` : ""}` }) : "";

  const listaClientes = clientes.slice(0, MAX_CLIENTES_LISTA).map(c=>{
    const cst = ctx.sim ? ctx.sim.estado.get(c.id) : null;
    const m = medioEnlace(red, c.id, e.id);
    return `<li><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${c.id}">${esc(c.nombre)}</button> <span class="${P}mapa-muted">${esc(nombreUbicacionDe(ctx, c.id))}${m !== "inalambrico" ? ` · ${infoMedio(m).badge}` : ""}</span>${cst && cst.estado !== "servicio" ? ` ${pillEstado(cst.estado)}` : ""}</li>`;
  }).join("") + (clientes.length > MAX_CLIENTES_LISTA ? `<li class="${P}mapa-muted">y ${clientes.length - MAX_CLIENTES_LISTA} más</li>` : "");
  const clasePropia = remotos.length === 1 ? "backbone (punto a punto)" : (remotos.length > 1 ? "distribución P2MP" : "");
  const clientesHtml = bloqueDetalle("clientes", {
      etiqueta: `Clientes (${clientes.length})`,
      titulo: `Clientes (${clientes.length})${clasePropia ? ` <span class="${P}mapa-muted">· ${clasePropia}</span>` : ""}`,
      accion: agrupado ? btn("alternar-expandido", ctx.expandidos.has(e.id) ? "Agrupar líneas" : "Fijar sus líneas", { id: e.id, pressed: ctx.expandidos.has(e.id), titulo: ctx.expandidos.has(e.id) ? "Volver a mostrar solo el indicador de clientes" : "Mantener sus líneas en el mapa aunque selecciones otra cosa" }) : "",
      cuerpo: `${clientes.length ? `<ul class="${P}mapa-sublista">${listaClientes}</ul>` : `<div class="${P}mapa-vacio">No alimenta a ningún equipo.</div>`}
      ${agrupado ? `<div class="${P}mapa-muted">Tiene más de ${ctx.umbralAgrupar} clientes: en el mapa se muestra agrupado y sus líneas se ven al seleccionarlo.</div>` : ""}` });

  const filasRespaldo = respaldos.map(r=>{
    const d = describirConexion(red, e.id, r.servidor_alternativo_id);
    const enUso = !!(st && st.conectado && st.respaldo && st.respaldo.id === r.id);
    return `<li class="${P}mapa-respaldo${enUso ? ` ${P}mapa-respaldo-en-uso` : ""}" data-respaldo-id="${r.id}">
      <span class="${P}mapa-respaldo-prioridad" title="Prioridad ${r.prioridad} (1 = primera opción)">${r.prioridad}</span>
      <span class="${P}mapa-respaldo-texto"><button type="button" class="${P}mapa-enlace-texto" data-accion="seleccionar-equipo-mapa" data-id="${r.servidor_alternativo_id}">${esc(d ? d.servidor.nombre : nombreEquipo(ctx, r.servidor_alternativo_id))}</button>
        <span class="${P}mapa-muted">en ${esc(d && d.ubicacionServidor ? d.ubicacionServidor.nombre : "—")} · ${d && d.mismaUbicacion ? infoMedio(d.medio).badge : textoMedio(d ? d.medio : "inalambrico", d ? d.distanciaKm : null)}</span>
        ${enUso ? `<span class="${P}mapa-estado ${P}mapa-estado-respaldo">en uso</span>` : ""}
        ${r.notas ? `<span class="${P}mapa-respaldo-notas">${esc(r.notas)}</span>` : ""}</span>
      ${ctx.esAdmin ? `<span class="${P}mapa-respaldo-acciones">${btn("editar-respaldo", "Editar", { id: r.id })}${btn("eliminar-respaldo", "Quitar", { id: r.id, titulo: "Quitar este respaldo" })}</span>` : ""}
    </li>`;
  }).join("");
  const respaldosHtml = bloqueDetalle("respaldos", {
      etiqueta: `Respaldos (${respaldos.length})`,
      titulo: `Respaldos (${respaldos.length})`,
      accion: ctx.esAdmin ? btn("nuevo-respaldo", "+ Respaldo", { id: e.id, titulo: "Registrar a qué otro servidor puede conmutar" }) : "",
      cuerpo: respaldos.length ? `<ol class="${P}mapa-respaldos">${filasRespaldo}</ol>` : `<div class="${P}mapa-vacio">Sin respaldos: si pierde su servidor, queda sin conectividad.</div>` });

  return `<div class="${P}mapa-equipo-detalle">
      ${ctx.puedeSimular ? simulacion : ""}
      <div class="${P}mapa-equipo-meta">${pillRolOTipo(ctx, e)}${marcaRouter(ctx, e)}${ctx.red007 && e.tipo_equipo && ctx.tipoPorValor.get(e.tipo_equipo) ? `<span class="${P}mapa-muted">${esc(ctx.tipoPorValor.get(e.tipo_equipo).etiqueta)}${e.referencia ? ` · ${esc(e.referencia)}` : ""}</span>` : ""}${chipRed(ctx, e)}</div>
      ${htmlDefineRed(ctx, e)}
      ${ctx.cobertura013 && normalizarCobertura(e) ? `<div class="${P}mapa-equipo-cobertura" data-cobertura-equipo="${e.id}"><span class="${P}mapa-muted">Cobertura:</span> ${esc(textoCobertura(normalizarCobertura(e)))}</div>` : ""}
      ${servidor}
      ${caminoHtml}
      ${clientesHtml}
      ${respaldosHtml}
      ${e.notas ? `<div class="${P}mapa-panel-notas">${esc(e.notas)}</div>` : ""}
      <div class="${P}mapa-acciones ${P}mapa-equipo-acciones">
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
