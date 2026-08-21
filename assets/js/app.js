
/* ============================================================
   1. CONFIGURACIÓN DE SUPABASE Y CONSTANTES
   ============================================================ */
const SUPABASE_URL = "https://tavyirvdfbetblprhtbo.supabase.co";
const SUPABASE_KEY = "sb_publishable_-AXUgStuUjI8JENtt3BzUg_aDmlQPqX";
// Si esto falla (CDN caído, bloqueador de anuncios, firewall corporativo
// bloqueando cdn.jsdelivr.net, etc.), que se vea un mensaje claro en la
// página en vez de quedar todo en blanco sin ninguna pista.
if(!window.supabase){
  const root = document.getElementById("app");
  if(root) root.innerHTML = `<div class="login-wrap"><div class="login-card">
    <div class="alert alert-error">No se pudo cargar la librería de Supabase desde cdn.jsdelivr.net.<br><br>Revisa tu conexión a internet, o si un bloqueador de anuncios / firewall está impidiendo la carga de ese dominio, y recarga la página.</div>
  </div></div>`;
  throw new Error("supabase-js no se cargó (revisa la etiqueta <script> de cdn.jsdelivr.net en index.html)");
}
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// El login sigue pidiendo solo un "usuario" corto (admin/registrador/visitante,
// o los que se agreguen a futuro); por dentro se completa a un correo interno
// porque Supabase Auth identifica cuentas por email, no por username.
const DOMINIO_USUARIO_INTERNO = "@lukmar.local";

// Logo real de Lukmar, como archivos en assets/img/ (no embebido en el JS).
const LOGO_MARK_SRC = "assets/img/logo-mark.png";
const LOGO_FULL_SRC = "assets/img/logo-full.png";

// Acciones controlables por la matriz de permisos. Esta lista es solo para
// pintar la UI (Configuración → Permisos); la que de verdad se aplica vive en
// la tabla `permisos` de Postgres y se hace cumplir vía RLS — ver puede().
const ACCIONES = [
  { id:"ver_listado",      label:"Ver listado de activos" },
  { id:"ver_detalle",      label:"Ver detalle e historial de un activo" },
  { id:"crear_activo",     label:"Crear un nuevo activo" },
  { id:"editar_activo",    label:"Editar campos base de un activo" },
  { id:"cambiar_custodio", label:"Registrar cambio de custodio" },
  { id:"editar_historial", label:"Editar un tramo antiguo del historial" },
  { id:"dar_baja",         label:"Dar de baja un activo" },
  { id:"restaurar_baja",   label:"Restaurar un activo dado de baja" },
  { id:"ver_bajas",        label:"Consultar la bitácora de bajas" },
];

// El rol "administrador" siempre tiene todo — hardcoded aquí Y en Postgres
// (función es_admin()), para que nunca pueda bloquearse a sí mismo.
const ROL_ADMIN = "administrador";

/* ============================================================
   2. CAPA DE ACCESO A DATOS (Supabase — antes LocalStorage)
   ============================================================ */
// state.datos/state.bajas/state.permisos/state.log son un espejo en memoria
// de Supabase. cargarActivos()/cargarBajas()/cargarPermisos()/cargarLog()
// siguen siendo síncronas a propósito — leen ese espejo — para no tener que
// tocar las ~1600 líneas de renderizado que las llaman así. El espejo se
// llena con refrescarDatos() (async) al iniciar sesión y después de cada
// mutación, en vez de sembrarse una sola vez desde data.json.

async function refrescarDatos(){
  const [{ data: activosRaw, error: e1 }, { data: historialRaw, error: e2 }] = await Promise.all([
    sb.from("activos").select("*").order("id"),
    sb.from("historial_custodia").select("*").order("activo_id").order("orden"),
  ]);
  if(e1) throw e1;
  if(e2) throw e2;
  const historialPorActivo = {};
  (historialRaw||[]).forEach(t=>{
    (historialPorActivo[t.activo_id] ||= []).push({
      _id: t.id, tipo_custodio: t.tipo_custodio, nombre: t.nombre, cargo: t.cargo,
      desde: t.desde, hasta: t.hasta, tipo_devolucion: t.tipo_devolucion, tipo_entrega: t.tipo_entrega,
      observacion_entrega: t.observacion_entrega, observacion_devolucion: t.observacion_devolucion, orden: t.orden,
    });
  });
  const activos = (activosRaw||[]).map(a=>{
    const historial_custodia = historialPorActivo[a.id] || [];
    const vigente = historial_custodia.find(t=>t.hasta===null) || null;
    return {
      id: a.id, propiedad: a.propiedad, tipo: a.tipo, marca: a.marca, modelo: a.modelo,
      serie: a.serie, nombre_dispositivo: a.nombre_dispositivo, mac_wifi: a.mac_wifi,
      mac_ethernet: a.mac_ethernet, sistema_operativo: a.sistema_operativo,
      ram_gb: a.ram_gb, disco_gb: a.disco_gb, procesador: a.procesador,
      proveedor: a.proveedor, fecha_adquisicion: a.fecha_adquisicion,
      color: a.color, longitud_m: a.longitud_m,
      empresa: a.empresa, valor_compra: a.valor_compra, vida_util_anios: a.vida_util_anios,
      estado: a.estado,
      fotos: a.fotos || [],
      celular: (a.celular_gmail || a.celular_password) ? { gmail: a.celular_gmail, password: a.celular_password } : null,
      custodio: vigente ? { tipo_custodio: vigente.tipo_custodio, nombre: vigente.nombre, cargo: vigente.cargo } : null,
      historial_custodia,
      trazabilidad: a.trazabilidad,
    };
  });
  state.datos = { version: 8, generado_en: new Date().toISOString(), activos };

  const { data: bajasRaw, error: e3 } = await sb.from("bajas").select("*").order("fecha_baja", { ascending:false });
  if(e3) throw e3;
  state.bajas = (bajasRaw||[]).map(b=>({ id: b.id, activo: b.activo, fecha_baja: b.fecha_baja, motivo: b.motivo, dado_de_baja_por: b.dado_de_baja_por }));

  // TODOS los roles necesitan leer la matriz completa de permisos (no solo
  // la propia): puede() la usa para decidir qué botones mostrar, igual que
  // en la versión anterior con LocalStorage, donde tampoco había esa
  // restricción. La tabla permisos permite SELECT a cualquier autenticado
  // (ver política sel_permisos) — solo INSERT/UPDATE/DELETE quedan admin-only.
  const { data: permisosRaw } = await sb.from("permisos").select("*");
  const matriz = {};
  (permisosRaw||[]).forEach(p=>{ (matriz[p.rol] ||= {})[p.accion] = p.permitido; });
  state.permisos = matriz;

  if(state.sesion && state.sesion.rol === ROL_ADMIN){
    const { data: perfilesRaw } = await sb.from("perfiles").select("*");
    state.perfiles = perfilesRaw || [];
    const { data: logRaw } = await sb.from("auditoria").select("*").order("fecha", { ascending:false }).limit(500);
    state.log = (logRaw||[]).map(l=>({ fecha: l.fecha, usuario: l.usuario_id, nombre_completo: (state.perfiles.find(p=>p.id===l.usuario_id)||{}).nombre_completo || l.usuario_id, accion: l.accion, detalle: l.detalle }));
  }
}

function cargarActivos(){ return state.datos || { version:8, generado_en:null, activos:[] }; }
function cargarBajas(){ return state.bajas || []; }
function cargarPermisos(){ return state.permisos || {}; }
function cargarLog(){ return state.log || []; }
function cargarPerfiles(){ return state.perfiles || []; }

async function guardarPermisos(matriz){
  const filas = [];
  Object.keys(matriz).forEach(rol=>{
    Object.keys(matriz[rol]).forEach(accion=>{
      filas.push({ rol, accion, permitido: !!matriz[rol][accion] });
    });
  });
  const { error } = await sb.from("permisos").upsert(filas, { onConflict: "rol,accion" });
  if(error) throw error;
  await refrescarDatos();
}

/* ============================================================
   3. ESTADO EN MEMORIA
   ============================================================ */
const state = {
  sesion: null,       // { usuario, rol, nombre_completo }
  sesionUid: null,    // uuid de auth.users — para identificar "soy yo" en Configuración → Usuarios
  vista: "activos",   // activos | bajas | auditoria | config
  configSubtab: "permisos",
  // null en tipo/propiedad/custodioClase = "sin filtrar" (equivale a todas las opciones marcadas).
  filtros: { texto:"", tipo:null, propiedad:null, custodioClase:null, marca:null, empresa:null, estado:null, colTag:"", colTipo:"", colMarca:"", colCustodio:"", colCargo:"", colPropiedad:"", colSerie:"", colSo:"", colProveedor:"", colFechaDesde:"", colFechaHasta:"", colModelo:"", colNombre:"" },
  orden: { campo:"id", dir:"asc" },
  columnasVisibles: new Set(["tag","tipo","marca","estado","custodio","propiedad","acciones"]), // debe coincidir con COLUMNAS_VISIBLES_DEFAULT más abajo
  modal: null,         // función que renderiza el modal actual, o null
};

// Supabase Auth ya persiste su propia sesión (en su propia clave de
// LocalStorage, manejada por supabase-js) — esto solo reconstruye
// state.sesion = {usuario, rol, nombre_completo} a partir de esa sesión,
// leyendo el perfil (rol) desde la tabla perfiles.
async function iniciarSesionGuardada(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) { state.sesion = null; return; }
  await cargarSesionDesdePerfil(session.user);
}
async function cargarSesionDesdePerfil(user){
  const { data: perfil, error } = await sb.from("perfiles").select("rol, nombre_completo").eq("id", user.id).single();
  if(error || !perfil){ state.sesion = null; state.sesionUid = null; return; }
  state.sesionUid = user.id;
  state.sesion = {
    usuario: (user.email||"").replace(DOMINIO_USUARIO_INTERNO, ""),
    rol: perfil.rol,
    nombre_completo: perfil.nombre_completo || perfil.rol,
  };
}
async function cerrarSesion(){
  await sb.auth.signOut();
  state.sesion = null;
  state.vista = "activos";
  render();
}

/* ============================================================
   4. PERMISOS
   ============================================================ */
function puede(accion){
  if(!state.sesion) return false;
  if(state.sesion.rol === ROL_ADMIN) return true;
  const matriz = cargarPermisos();
  const rolPerm = matriz[state.sesion.rol];
  return !!(rolPerm && rolPerm[accion]);
}

/* ============================================================
   5. HELPERS DE DOMINIO
   ============================================================ */
// Antes devolvía "ACT-XXX" para todos. Ahora el prefijo depende de la
// empresa dueña del activo (Lukmar vs. EQ Soluciones) — el id de fondo en
// Supabase sigue siendo puramente numérico y no cambia, esto es solo la
// etiqueta visual. Acepta el objeto activo completo (no solo el id) para
// poder leer `.empresa`; si llega un id suelto por error, no rompe —
// simplemente no puede mostrar el prefijo correcto y usa LKM por defecto.
function fmtTag(a){
  if(a===null || typeof a!=="object") a = {id:a};
  const prefijo = a.empresa==="eq" ? "EQS" : "LKM";
  return prefijo + "-" + String(a.id).padStart(3,"0");
}
// Depreciación en línea recta, valor residual $0 (igual al ejemplo típico
// del SRI para equipos de cómputo: 33%/3 años). Requiere valor_compra,
// fecha_adquisicion y vida_util_anios — si falta cualquiera, no se puede
// calcular y se devuelve null (la ficha de detalle muestra "—" en ese caso).
function valorActualActivo(a){
  if(!a.valor_compra || !a.fecha_adquisicion || !a.vida_util_anios) return null;
  const mesesTranscurridos = (Date.now() - new Date(a.fecha_adquisicion).getTime()) / (1000*60*60*24*30.44);
  const mesesVidaUtil = a.vida_util_anios * 12;
  const fraccionRestante = Math.max(0, 1 - (mesesTranscurridos / mesesVidaUtil));
  return Math.round(a.valor_compra * fraccionRestante * 100) / 100;
}
// "Valor actual" siempre se muestra junto al % que representa sobre el valor
// de compra (ej. "$126.42 (14%)"), para leer de un vistazo qué tan depreciado
// está el equipo — usado tanto en la tabla como en el detalle.
function fmtValorActualConPorcentaje(a){
  const actual = valorActualActivo(a);
  if(actual===null) return null;
  const pct = Math.round((actual / a.valor_compra) * 100);
  return `$${actual.toFixed(2)} (${pct}%)`;
}
function fmtFecha(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return iso;
  return d.toLocaleDateString('es-EC', {year:'numeric', month:'short', day:'2-digit'});
}
function fmtFechaHora(iso){
  if(!iso) return "—";
  const d = new Date(iso);
  if(isNaN(d)) return iso;
  return d.toLocaleString('es-EC', {year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'});
}
function hoyISO(){ return new Date().toISOString().slice(0,10); }
function esc(s){
  if(s===null||s===undefined) return "";
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function buscarActivo(datos, id){
  return datos.activos.find(a=>a.id===id);
}
const TIPOS_DEVOLUCION = [
  {v:"firmada", label:"Firmada (devolución normal con acta)"},
  {v:"desvinculada", label:"Desvinculada (el custodio dejó la empresa)"},
  {v:"perdida", label:"Perdida (no se recuperó el activo)"},
  {v:"simple", label:"Simple (no aplica firmar)"},
];
function labelTipoDevolucion(v){
  const f = TIPOS_DEVOLUCION.find(t=>t.v===v);
  return f ? f.label : "—";
}
const TIPOS_ENTREGA = [
  {v:"firmada", label:"Firmada (entrega normal con acta)"},
  {v:"simple", label:"Simple (no aplica firmar)"},
];
function labelTipoEntrega(v){
  const f = TIPOS_ENTREGA.find(t=>t.v===v);
  return f ? f.label : "—";
}

/* ============================================================
   6. AGREGADOS (siempre calculados al vuelo, nunca guardados)
   ============================================================ */
function calcularAgregados(activos){
  const total = activos.length;
  const disponibles = activos.filter(a=>a.estado==="disponible").length;
  const asignadosPersona = activos.filter(a=>a.custodio && a.custodio.tipo_custodio==="persona").length;
  const asignadosArea = activos.filter(a=>a.custodio && a.custodio.tipo_custodio==="area").length;
  const porTipo = {};
  activos.forEach(a=>{ const t=a.tipo||"Sin tipo"; porTipo[t]=(porTipo[t]||0)+1; });
  return { total, disponibles, asignadosPersona, asignadosArea, porTipo };
}

/* ============================================================
   7. OPERACIONES DE NEGOCIO (Supabase — antes LocalStorage)
   ============================================================ */
// La auditoría ya no se registra desde aquí: un trigger en Postgres
// (registrar_auditoria()) escribe en la tabla auditoria automáticamente en
// cada INSERT/UPDATE/DELETE — no se puede falsificar desde el navegador,
// a diferencia del log anterior en LocalStorage.

async function crearActivo(campos){
  const esCelular = campos.tipo === "Celular" && (campos.gmail || campos.password);
  const { data, error } = await sb.from("activos").insert({
    propiedad: campos.propiedad,
    tipo: campos.tipo || null,
    marca: campos.marca || null,
    modelo: campos.modelo || null,
    serie: campos.serie || null,
    nombre_dispositivo: campos.nombre_dispositivo || null,
    mac_wifi: campos.mac_wifi || null,
    mac_ethernet: campos.mac_ethernet || null,
    sistema_operativo: campos.sistema_operativo || null,
    ram_gb: campos.ram_gb ? Number(campos.ram_gb) : null,
    disco_gb: campos.disco_gb ? Number(campos.disco_gb) : null,
    procesador: campos.procesador || null,
    proveedor: campos.proveedor || null,
    fecha_adquisicion: campos.fecha_adquisicion || null,
    color: campos.color || null,
    longitud_m: campos.longitud_m ? Number(campos.longitud_m) : null,
    empresa: campos.empresa || "lukmar",
    valor_compra: campos.valor_compra ? Number(campos.valor_compra) : null,
    vida_util_anios: campos.vida_util_anios ? Number(campos.vida_util_anios) : null,
    estado: "disponible",
    celular_gmail: esCelular ? (campos.gmail || null) : null,
    celular_password: esCelular ? (campos.password || null) : null,
    trazabilidad: { categoria:null, custodio_texto:null, numero_original:null, estado_notas:null, seccion_origen:"Alta manual (app)", fila_excel:null, id_anterior:null },
  }).select("id").single();
  if(error) throw error;
  await refrescarDatos();
  return data.id;
}

async function editarActivoBase(id, campos){
  const patch = {};
  const editables = ["propiedad","tipo","marca","modelo","serie","nombre_dispositivo",
    "mac_wifi","mac_ethernet","sistema_operativo","procesador","proveedor","fecha_adquisicion","color","empresa"];
  editables.forEach(k=>{ if(k in campos) patch[k] = campos[k] || null; });
  if("ram_gb" in campos) patch.ram_gb = campos.ram_gb ? Number(campos.ram_gb) : null;
  if("disco_gb" in campos) patch.disco_gb = campos.disco_gb ? Number(campos.disco_gb) : null;
  if("longitud_m" in campos) patch.longitud_m = campos.longitud_m ? Number(campos.longitud_m) : null;
  if("valor_compra" in campos) patch.valor_compra = campos.valor_compra ? Number(campos.valor_compra) : null;
  if("vida_util_anios" in campos) patch.vida_util_anios = campos.vida_util_anios ? Number(campos.vida_util_anios) : null;
  const esCelular = (campos.tipo || (buscarActivo(cargarActivos(), id)||{}).tipo) === "Celular";
  if(esCelular){
    if("gmail" in campos) patch.celular_gmail = campos.gmail || null;
    if("password" in campos) patch.celular_password = campos.password || null;
  } else {
    patch.celular_gmail = null; patch.celular_password = null;
  }
  const { error } = await sb.from("activos").update(patch).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

// Registrar cambio de custodio: vía RPC (cierra el tramo vigente + abre uno
// nuevo en una sola transacción atómica en Postgres — ver f_cambiar_custodio).
async function cambiarCustodio(id, nuevoCustodio, tipoDevolucionSaliente, fechaHasta, observacionDevolucionSaliente, tipoEntrega, nuevoEstado, observacionEntrega){
  const { error } = await sb.rpc("f_cambiar_custodio", {
    p_activo_id: id, p_tipo_custodio: nuevoCustodio.tipo_custodio, p_nombre: nuevoCustodio.nombre,
    p_cargo: nuevoCustodio.cargo || null, p_fecha: fechaHasta || hoyISO(),
    p_tipo_devolucion: tipoDevolucionSaliente || null, p_observacion_entrega: observacionEntrega || null,
    p_tipo_entrega: tipoEntrega || null, p_observacion_devolucion: observacionDevolucionSaliente || null,
  });
  if(error) throw error;
  // Estado ya no se infiere — viene explícito del dropdown de
  // abrirCambiarCustodio (siempre obligatorio ahí).
  if(nuevoEstado){
    const { error: errorEstado } = await sb.from("activos").update({ estado: nuevoEstado }).eq("id", id);
    if(errorEstado) throw errorEstado;
  }
  await refrescarDatos();
}

// ---------- Fotos de activos (Supabase Storage, bucket "fotos-activos") ----------
// Varias fotos por activo (ej. laptop abierta/cerrada) — se guardan como un
// array de rutas en activos.fotos, no en una tabla aparte, porque no hace
// falta metadata extra por foto todavía. El bucket es público para lectura,
// así que la URL pública sirve directo en un <img>, sin URLs firmadas que
// expiren. Redimensiona en el navegador antes de subir porque el plan free
// de Supabase Storage no incluye transformación de imágenes — sin esto,
// una foto de celular sin comprimir (5-10 MB) se comería el GB gratis rápido.
function redimensionarImagen(archivo, maxDim, calidad){
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(archivo);
    const img = new Image();
    img.onload = ()=>{
      let w = img.width, h = img.height;
      if(w > maxDim || h > maxDim){
        if(w > h){ h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      canvas.toBlob(blob=>{
        URL.revokeObjectURL(url);
        blob ? resolve(blob) : reject(new Error("No se pudo procesar la imagen."));
      }, "image/jpeg", calidad);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("No se pudo leer el archivo como imagen.")); };
    img.src = url;
  });
}
function urlFoto(ruta){
  return sb.storage.from("fotos-activos").getPublicUrl(ruta).data.publicUrl;
}
async function subirFotoActivo(id, archivo){
  const blob = await redimensionarImagen(archivo, 1600, 0.82);
  const ruta = `${id}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
  const { error } = await sb.storage.from("fotos-activos").upload(ruta, blob, { contentType: "image/jpeg" });
  if(error) throw error;
  const a = buscarActivo(cargarActivos(), id);
  const fotos = [...(a.fotos||[]), ruta];
  const { error: e2 } = await sb.from("activos").update({ fotos }).eq("id", id);
  if(e2) throw e2;
  await refrescarDatos();
}
async function borrarFotoActivo(id, ruta){
  await sb.storage.from("fotos-activos").remove([ruta]);
  const a = buscarActivo(cargarActivos(), id);
  const fotos = (a.fotos||[]).filter(r=>r!==ruta);
  const { error } = await sb.from("activos").update({ fotos }).eq("id", id);
  if(error) throw error;
  await refrescarDatos();
}

async function editarTramoHistorial(id, index, campos){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const tramo = a.historial_custodia[index];
  if(!tramo || !tramo._id) return;
  const patch = {};
  ["tipo_custodio","nombre","cargo","desde","hasta","tipo_devolucion","tipo_entrega","observacion_entrega","observacion_devolucion"].forEach(k=>{
    if(k in campos) patch[k] = campos[k] || null;
  });
  const { error } = await sb.from("historial_custodia").update(patch).eq("id", tramo._id);
  if(error) throw error;
  await refrescarDatos();
}

// Borrar un tramo del historial que se considere erróneo. Solo administrador
// (la política RLS lo exige del lado del servidor, no solo aquí), y nunca el
// tramo vigente (hasta is null) — eso se hace con "Marcar disponible" o
// "Cambiar custodio", nunca borrándolo.
async function eliminarTramoHistorial(tramoId){
  const { error } = await sb.from("historial_custodia").delete().eq("id", tramoId);
  if(error) throw error;
  await refrescarDatos();
}

// Dar de baja: vía RPC (f_dar_baja) — archiva el snapshot completo y borra el
// activo en una sola transacción atómica.
async function darDeBaja(id, motivo){
  const { error } = await sb.rpc("f_dar_baja", { p_activo_id: id, p_motivo: motivo || null });
  if(error) throw error;
  await refrescarDatos();
}

async function restaurarBaja(indexBaja){
  const bajas = cargarBajas();
  const registro = bajas[indexBaja];
  if(!registro) return;
  const { error } = await sb.rpc("f_restaurar_baja", { p_baja_id: registro.id });
  if(error) throw error;
  await refrescarDatos();
}

/* ============================================================
   8. RENDER — RAÍZ
   ============================================================ */
const root = document.getElementById("app");

function render(){
  if(!state.sesion){ renderLogin(); return; }
  renderAppShell();
}

function renderLogin(errorMsg){
  root.innerHTML = `
    <div class="login-wrap">
      <div class="login-decor login-decor-1"></div>
      <div class="login-decor login-decor-2"></div>
      <div class="login-decor login-decor-3"></div>
      <div class="login-decor login-watermark" style="background-image:url(${LOGO_MARK_SRC})"></div>
      <img class="login-logo-hero" src="${LOGO_FULL_SRC}" alt="Lukmar">
      <div class="login-card">
        <div class="login-title">Inventario de Activos</div>
        <div class="login-sub">Ingresa con tu usuario para continuar.</div>
        ${errorMsg ? `<div class="alert alert-error">${esc(errorMsg)}</div>` : ""}
        <form id="form-login" method="post">
          <div class="field"><label for="login-usuario">Usuario</label><input type="text" id="login-usuario" name="username" autocomplete="username" required></div>
          <div class="field"><label for="login-password">Contraseña</label><input type="password" id="login-password" name="password" autocomplete="current-password" required></div>
          <button type="submit" id="btn-login-submit" class="btn btn-primary" style="width:100%;margin-top:6px;">Ingresar</button>
        </form>
        <div class="login-hint">
          Inicio de sesión real: tu contraseña viaja cifrada y se verifica en Supabase, no en este navegador.
        </div>
      </div>
    </div>`;
  document.getElementById("form-login").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const u = document.getElementById("login-usuario").value.trim();
    const p = document.getElementById("login-password").value;
    const btn = document.getElementById("btn-login-submit");
    btn.disabled = true; btn.textContent = "Ingresando…";
    const { data, error } = await sb.auth.signInWithPassword({
      email: u.includes("@") ? u : u + DOMINIO_USUARIO_INTERNO,
      password: p,
    });
    if(error || !data.user){ renderLogin("Usuario o contraseña incorrectos."); return; }
    await cargarSesionDesdePerfil(data.user);
    if(!state.sesion){ await sb.auth.signOut(); renderLogin("Tu cuenta no tiene un perfil asignado. Contacta a un administrador."); return; }
    await refrescarDatos();
    // El toast vive fuera de #app (se agrega directo a document.body), así que
    // render() no lo reemplaza solo — hay que quitarlo explícitamente al entrar,
    // o se queda flotando encima de la app ya autenticada.
    document.getElementById("toast-guardar")?.remove();
    render();
  });
  // Si el navegador guarda usuario/contraseña, normalmente los autocompleta sin
  // necesitar foco en los campos. Enfocamos directo el botón "Ingresar" para
  // que, si ya están rellenos, baste con Enter — sin tocar el mouse ni el teclado
  // en los inputs. Si no hay nada guardado, Enter simplemente dispara la
  // validación nativa del formulario (pide completar los campos vacíos).
  document.getElementById("btn-login-submit").focus();
  mostrarToastGuardarPasswordSiCorresponde();
}

const ICONO_CANDADO = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9" rx="1.6"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/></svg>`;
// Solo tiene sentido mostrar esto si el navegador NO autorrellenó el usuario/
// contraseña — si ya lo hizo, el aviso no aplica y no se muestra. Se revisa
// después de un pequeño margen para darle tiempo al autocompletado del
// navegador (que a veces llega unos milisegundos después del render).
function mostrarToastGuardarPasswordSiCorresponde(){
  setTimeout(()=>{
    const u = document.getElementById("login-usuario");
    const p = document.getElementById("login-password");
    if(!u || !p) return; // ya se navegó a otra vista
    if(u.value || p.value) return; // el navegador ya autocompletó: no hace falta el aviso
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.id = "toast-guardar";
    toast.innerHTML = `
      <span class="toast-icon">${ICONO_CANDADO}</span>
      <span class="toast-text">
        <span class="toast-title">Guarda tu acceso</span>
        <span class="toast-sub">Escribe tus datos e ingresa una vez — tu navegador puede ofrecer recordarlos, así la próxima vez solo presionas Enter.</span>
      </span>
      <button type="button" class="toast-close" aria-label="Cerrar">✕</button>`;
    document.body.appendChild(toast);
    const cerrar = ()=>{ toast.classList.add("toast-out"); setTimeout(()=>toast.remove(), 400); };
    toast.querySelector(".toast-close").addEventListener("click", cerrar);
    setTimeout(cerrar, 10000);
  }, 700);
}

function renderAppShell(){
  const s = state.sesion;
  const tabs = [
    {id:"activos", label:"Activos", show:true},
    {id:"bajas", label:"Bajas", show:puede("ver_bajas")},
    {id:"auditoria", label:"Auditoría", show:s.rol===ROL_ADMIN},
    {id:"config", label:"Configuración", show:s.rol===ROL_ADMIN},
  ].filter(t=>t.show);

  root.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <div class="brand"><img class="brand-mark-img" src="${LOGO_MARK_SRC}" alt="Lukmar">Inventario LUKMAR</div>
        <div class="tabs">
          ${tabs.map(t=>`<button class="tab-btn ${state.vista===t.id?'active':''}" data-tab="${t.id}">${t.label}</button>`).join("")}
        </div>
      </div>
      <div class="topbar-right">
        <button class="btn btn-ghost btn-sm" id="badge-portapapeles" title="Activos marcados para acta de entrega">🔖 0</button>
        <div class="userchip">${esc(s.nombre_completo)} <span class="rolebadge rol-${s.rol}">${s.rol}</span></div>
        <button class="btn btn-ghost btn-sm" id="btn-logout">Cerrar sesión</button>
      </div>
    </div>
    <main id="main"></main>
  `;
  document.getElementById("badge-portapapeles").addEventListener("click", abrirPanelPortapapeles);
  actualizarBadgePortapapeles();
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click", ()=>{
    state.vista = b.dataset.tab; renderMain();
  }));
  document.getElementById("btn-logout").addEventListener("click", cerrarSesion);
  // Cierra cualquier menú desplegable tipo "Exportar resúmenes" al hacer clic
  // fuera de él — se registra una sola vez aquí (no dentro de renderVistaActivos,
  // que se re-ejecuta con cada renderMain() y duplicaría el listener).
  document.addEventListener("click", ()=>{
    const menu = document.getElementById("menu-exportar-resumenes");
    if(menu) menu.hidden = true;
  });
  renderMain();
}

function renderMain(){
  const main = document.getElementById("main");
  if(state.vista==="activos") return renderVistaActivos(main);
  if(state.vista==="bajas") return renderVistaBajas(main);
  if(state.vista==="auditoria") return renderVistaAuditoria(main);
  if(state.vista==="config") return renderVistaConfig(main);
}

/* ---------- Modal genérico ---------- */
// Selector estándar de "elementos focuseables" — se usa tanto para enfocar
// el primero al abrir el modal como para que Tab/Shift+Tab ciclen dentro de
// él sin escaparse al contenido de fondo.
const SELECTOR_FOCUSABLE_MODAL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function obtenerFocusablesModal(){
  const host = document.getElementById("modal-host");
  if(!host) return [];
  // offsetParent === null descarta elementos con display:none (p.ej. un
  // campo que un fieldset condicional no llegó a mostrar).
  return Array.from(host.querySelectorAll(SELECTOR_FOCUSABLE_MODAL)).filter(el => el.offsetParent !== null);
}
// A dónde va el foco automático al abrir: se prioriza el primer campo de
// formulario real (como ya hacía la app, para poder escribir de inmediato
// sin tocar el mouse) — el botón "✕" de cerrar suele quedar primero en el
// DOM, pero enfocarlo a él en vez del campo no ayudaría a la eficiencia que
// se busca. Si el modal no tiene ningún campo (uno de solo confirmación,
// por ejemplo), se cae al primer elemento focuseable que exista.
function primerFocoDelModal(){
  const host = document.getElementById("modal-host");
  if(!host) return null;
  const campo = host.querySelector('input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])');
  if(campo && campo.offsetParent !== null) return campo;
  const focusables = obtenerFocusablesModal();
  return focusables.length ? focusables[0] : null;
}
// Normalmente cerrarModal() vacía el host y listo. El carrusel de fotos es la
// única excepción: quiere "volver" a la pantalla que lo abrió (detalle o
// formulario) en vez de cerrarse a secas, sin importar si el cierre vino del
// botón ✕, del backdrop o de Esc — los tres caminos pasan por cerrarModal().
// abrirModal() lo resetea siempre a null primero; quien quiera ese
// comportamiento lo asigna DESPUÉS de llamar a abrirModal (ver abrirCarruselFotos).
let modalVolver = null;
function abrirModal(html, onMount){
  modalVolver = null;
  let host = document.getElementById("modal-host");
  if(!host){
    host = document.createElement("div");
    host.id = "modal-host";
    document.body.appendChild(host);
  }
  host.innerHTML = `<div class="modal-backdrop" id="modal-backdrop">${html}</div>`;
  document.getElementById("modal-backdrop").addEventListener("mousedown", (e)=>{
    if(e.target.id==="modal-backdrop") cerrarModal();
  });
  document.querySelectorAll(".modal-close").forEach(b=>b.addEventListener("click", cerrarModal));
  if(onMount) onMount();
  // Foco directo en el primer campo real del formulario (o, si no hay
  // ninguno, en el primer elemento focuseable que exista) — para que quien
  // trabaja solo con teclado pueda empezar a escribir sin tocar el mouse.
  const primerFoco = primerFocoDelModal();
  if(primerFoco) primerFoco.focus();
  // Esc cierra el modal, y Tab/Shift+Tab quedan atrapados dentro de él — los
  // dos pares se registran uno a la vez (por si un modal abre otro sin pasar
  // por cerrarModal primero).
  document.removeEventListener("keydown", escCierraModal);
  document.addEventListener("keydown", escCierraModal);
  document.removeEventListener("keydown", atraparTabModal);
  document.addEventListener("keydown", atraparTabModal);
}
function escCierraModal(e){
  if(e.key === "Escape") cerrarModal();
}
// Ciclar el foco dentro del modal: Tab en el último elemento vuelve al
// primero, Shift+Tab en el primero salta al último. Si por algún motivo el
// foco queda fuera del modal (p.ej. no había ningún focuseable al abrir), lo
// trae de vuelta al primer elemento en vez de dejarlo escapar al fondo.
function atraparTabModal(e){
  if(e.key !== "Tab") return;
  const focusables = obtenerFocusablesModal();
  if(!focusables.length) return;
  const primero = focusables[0];
  const ultimo = focusables[focusables.length - 1];
  const dentroDelModal = focusables.includes(document.activeElement);
  if(e.shiftKey){
    if(!dentroDelModal || document.activeElement === primero){ e.preventDefault(); ultimo.focus(); }
  } else {
    if(!dentroDelModal || document.activeElement === ultimo){ e.preventDefault(); primero.focus(); }
  }
}
function cerrarModal(){
  document.removeEventListener("keydown", navegarCarruselTeclado);
  if(modalVolver){ const volver = modalVolver; modalVolver = null; volver(); return; }
  const host = document.getElementById("modal-host");
  if(host) host.innerHTML = "";
  document.removeEventListener("keydown", escCierraModal);
  document.removeEventListener("keydown", atraparTabModal);
}

/* ---------- Carrusel de fotos (modal grande, con flechas/contador/teclado) ---------- */
// `fotos` ya son URLs resueltas (urlFoto ya aplicado por quien llama).
// `alCerrar` es a dónde "volver" al cerrar este modal (típicamente
// ()=>abrirDetalle(id) o ()=>abrirFormActivo(id)) — ver modalVolver.
function abrirCarruselFotos(fotos, indiceInicial, alCerrar){
  const varias = fotos.length > 1;
  const html = `<div class="modal modal-carrusel">
    <div class="modal-header"><h3>Fotos del activo</h3><button class="modal-close">✕</button></div>
    <div class="modal-body carrusel-body">
      <button class="carrusel-flecha" data-carrusel-nav="-1" aria-label="Foto anterior" ${varias?'':'disabled'}>‹</button>
      <img class="carrusel-img" data-carrusel-modal-img data-fotos='${esc(JSON.stringify(fotos))}' data-indice="${indiceInicial}" src="${fotos[indiceInicial]}" alt="Foto del activo">
      <button class="carrusel-flecha" data-carrusel-nav="1" aria-label="Foto siguiente" ${varias?'':'disabled'}>›</button>
    </div>
    <div class="modal-footer carrusel-footer">
      <span class="carrusel-contador" data-carrusel-contador>${indiceInicial+1} / ${fotos.length}</span>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const img = document.querySelector("[data-carrusel-modal-img]");
    document.querySelectorAll("[data-carrusel-nav]").forEach(btn=>{
      btn.addEventListener("click", ()=>avanzarCarrusel(img, Number(btn.dataset.carruselNav)));
    });
    document.removeEventListener("keydown", navegarCarruselTeclado);
    document.addEventListener("keydown", navegarCarruselTeclado);
  });
  modalVolver = alCerrar;
}
function avanzarCarrusel(img, delta){
  const fotos = JSON.parse(img.dataset.fotos);
  const total = fotos.length;
  if(total < 2) return;
  const nuevo = ((Number(img.dataset.indice) + delta) % total + total) % total;
  img.src = fotos[nuevo];
  img.dataset.indice = nuevo;
  const contador = document.querySelector("[data-carrusel-contador]");
  if(contador) contador.textContent = `${nuevo+1} / ${total}`;
}
function navegarCarruselTeclado(e){
  const img = document.querySelector("[data-carrusel-modal-img]");
  if(!img) return;
  if(e.key==="ArrowLeft") avanzarCarrusel(img, -1);
  else if(e.key==="ArrowRight") avanzarCarrusel(img, 1);
}

/* ============================================================
   9. VISTA: LISTADO DE ACTIVOS
   ============================================================ */
// Catálogo de columnas posibles. "core" = siempre visible (Tag y Acciones);
// el resto se puede mostrar/ocultar desde "Columnas". El peso determina el
// ancho relativo de cada columna, normalizado sobre las que estén activas
// (así la tabla se reparte bien sin importar cuántas columnas elijas).
const DEFINICION_COLUMNAS = [
  { key:"tag",        label:"Tag",             core:true,  weight:1.0, sortCampo:"id",       filterCampo:null,           campoTexto:"colTag",       placeholder:"Ej: 012" },
  { key:"empresa",    label:"Empresa",         core:false, weight:1.3, sortCampo:"empresa",  filterCampo:"empresa",      campoTexto:null,           placeholder:null },
  { key:"tipo",       label:"Tipo",            core:false, weight:1.9, sortCampo:"tipo",     filterCampo:"tipo",         campoTexto:"colTipo",      placeholder:"Buscar tipo…" },
  { key:"marca",      label:"Marca",           core:false, weight:1.5, sortCampo:"marca",    filterCampo:"marca",        campoTexto:"colMarca",     placeholder:"Buscar marca…" },
  { key:"modelo",     label:"Modelo",          core:false, weight:1.6, sortCampo:"modelo",   filterCampo:null,           campoTexto:"colModelo",    placeholder:"Buscar modelo…" },
  { key:"nombre",     label:"Nombre equipo",   core:false, weight:1.6, sortCampo:"nombre",   filterCampo:null,           campoTexto:"colNombre",    placeholder:"Buscar nombre…" },
  { key:"estado",     label:"Estado",          core:false, weight:1.2, sortCampo:"estado",   filterCampo:"estado",       campoTexto:null,           placeholder:null },
  { key:"custodio",   label:"Custodio",        core:false, weight:2.4, sortCampo:"custodio", filterCampo:"custodioClase",campoTexto:"colCustodio",  placeholder:"Buscar nombre…" },
  { key:"cargo",      label:"Cargo",           core:false, weight:1.5, sortCampo:"cargo",    filterCampo:null,           campoTexto:"colCargo",     placeholder:"Buscar cargo…" },
  { key:"propiedad",  label:"Propiedad",       core:false, weight:1.1, sortCampo:"propiedad",filterCampo:"propiedad",    campoTexto:"colPropiedad", placeholder:"Buscar propiedad…" },
  { key:"serie",      label:"Serie",           core:false, weight:1.4, sortCampo:"serie",    filterCampo:null,           campoTexto:"colSerie",     placeholder:"Buscar serie…" },
  { key:"so",         label:"Sist. operativo", core:false, weight:1.3, sortCampo:"so",       filterCampo:null,           campoTexto:"colSo",        placeholder:"Buscar SO…" },
  { key:"ram",        label:"RAM (GB)",        core:false, weight:0.8, sortCampo:"ram",      filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"disco",      label:"Disco (GB)",      core:false, weight:0.8, sortCampo:"disco",    filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"procesador", label:"Procesador",      core:false, weight:1.5, sortCampo:"procesador",filterCampo:null,          campoTexto:null,           placeholder:null },
  { key:"macwifi",    label:"MAC WiFi",        core:false, weight:1.4, sortCampo:"macwifi",  filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"maceth",     label:"MAC Ethernet",    core:false, weight:1.4, sortCampo:"maceth",   filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"fecha",      label:"Adquisición",     core:false, weight:1.6, sortCampo:"fecha",    filterCampo:null,           campoTexto:null,           placeholder:null, filtroFecha:true },
  { key:"proveedor",  label:"Proveedor",       core:false, weight:1.3, sortCampo:"proveedor",filterCampo:null,           campoTexto:"colProveedor", placeholder:"Buscar proveedor…" },
  { key:"valorcompra",label:"Valor compra",    core:false, weight:1.1, sortCampo:"valorcompra",filterCampo:null,         campoTexto:null,           placeholder:null },
  { key:"valoractual",label:"Valor actual",    core:false, weight:1.3, sortCampo:"valoractual",filterCampo:null,         campoTexto:null,           placeholder:null },
  { key:"vidautil",   label:"Vida útil",       core:false, weight:0.8, sortCampo:"vidautil", filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"color",      label:"Color",           core:false, weight:0.8, sortCampo:"color",    filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"longitud",   label:"Longitud (m)",    core:false, weight:0.8, sortCampo:"longitud", filterCampo:null,           campoTexto:null,           placeholder:null },
  { key:"acciones",   label:"",                core:true,  weight:2.2, sortCampo:null,       filterCampo:null,           campoTexto:null,           placeholder:null },
];
const COLUMNAS_VISIBLES_DEFAULT = ["tag","tipo","marca","estado","custodio","propiedad","acciones"]; // debe coincidir con state.columnasVisibles más abajo (valor inicial) y con abrirGestorColumnas (botón "Restablecer")
const LIMITE_COLUMNAS_RECOMENDADO = 7;

// Opciones disponibles por columna filtrable, recalculadas cada vez que se
// entra a la vista. TODAS las opciones se recalculan desde los datos reales
// (no listas fijas): si se crea un activo con un tipo, marca o propiedad
// nuevos, aparecen solos como opción de filtro en el siguiente render — el
// mismo mecanismo que ya traía "tipo" desde el principio. Se guarda en un
// caché de módulo para que los manejadores de eventos (delegados a nivel de
// documento) sepan qué significa "seleccionar todo" para cada columna sin
// tener que releer el DOM.
let opcionesFiltroCache = { tipo:[], propiedad:[], custodioClase:[], marca:[], empresa:[], estado:[] };
function recalcularOpcionesFiltro(datos){
  opcionesFiltroCache.tipo = [...new Set(datos.activos.map(a=>a.tipo).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.propiedad = [...new Set(datos.activos.map(a=>a.propiedad).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.custodioClase = [...new Set(datos.activos.map(a=>claseCustodio(a)))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.marca = [...new Set(datos.activos.map(a=>a.marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.empresa = [...new Set(datos.activos.map(a=>a.empresa).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.estado = [...new Set(datos.activos.map(a=>a.estado).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
}
// Cuántos activos (del total, sin aplicar otros filtros) tienen ese valor en
// esa columna — es la info que se muestra junto a cada opción del checklist.
function contarValorEnLista(lista, filterCampo, valor){
  return lista.filter(a=>{
    if(filterCampo==="custodioClase") return claseCustodio(a)===valor;
    return a[filterCampo]===valor;
  }).length;
}
// Lista para contar las opciones de "campoExcluir": aplica todos los filtros
// activos EXCEPTO el de esa misma columna — así el conteo de cada casilla
// responde a "cuántos quedarían si elijo esto, dado lo demás que ya filtré",
// en vez de un número fijo sobre el total de los 91 activos.
function listaParaConteo(campoExcluir){
  const anterior = state.filtros[campoExcluir];
  state.filtros[campoExcluir] = null;
  const lista = filtrarActivos(cargarActivos());
  state.filtros[campoExcluir] = anterior;
  return lista;
}
// Recalcula solo los números dentro de los paneles de filtro ya presentes en
// el DOM (sin reconstruir checkboxes ni inputs), para que los conteos se
// mantengan al día mientras se escribe en cualquier buscador, sin robarle el
// foco a lo que se está escribiendo.
function actualizarConteosFiltros(){
  const porCampo = {};
  document.querySelectorAll(".filter-opt").forEach(opt=>{
    const campo = opt.dataset.filtroOptCampo;
    const valor = opt.dataset.filtroOptValor;
    if(!porCampo[campo]) porCampo[campo] = listaParaConteo(campo);
    const span = opt.querySelector(".filter-opt-count");
    if(span) span.textContent = contarValorEnLista(porCampo[campo], campo, valor);
  });
}

function claseCustodio(a){ return a.custodio===null ? "disponible" : a.custodio.tipo_custodio; }
function labelOpcionFiltro(campo, valor){
  if(campo==="custodioClase"){
    return { disponible:"Disponible", persona:"Persona", area:"Área / depto." }[valor] || valor;
  }
  if(campo==="empresa"){
    return { lukmar:"Lukmar", eq:"EQ Soluciones" }[valor] || valor;
  }
  if(campo==="estado"){
    return infoEstado(valor).label;
  }
  return valor.charAt(0).toUpperCase() + valor.slice(1);
}
function capitalizar(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
// Un color propio por tipo de propiedad, igual que ya existe para tipo de activo.
const COLOR_PROPIEDAD = {
  propio:  { fg:"#2E6B3D", bg:"#DCEFE0" },
  rentado: { fg:"#B35A17", bg:"#FCE3D0" },
  externo: { fg:"#4A3F73", bg:"#E9E4F3" },
};
// eq usa el "Marino" real de la paleta de marca EQ Soluciones (Logos_EQ_LUKMAR_v1.zip/LEEME.txt).
const COLOR_EMPRESA = {
  lukmar: { fg:"#3A5068", bg:"#E7ECF1" },
  eq:     { fg:"#1A3756", bg:"#DCE6EC" },
};
function pillPropiedad(valor){
  const c = COLOR_PROPIEDAD[valor] || { fg:"#57697C", bg:"#EEF1F4" };
  return `<span class="pill" style="background:${c.bg};color:${c.fg};"><span class="pill-dot"></span>${esc(capitalizar(valor))}</span>`;
}
function pillEmpresa(valor){
  const c = COLOR_EMPRESA[valor] || COLOR_EMPRESA.lukmar;
  return `<span class="pill" style="background:${c.bg};color:${c.fg};"><span class="pill-dot"></span>${valor==='eq'?'EQ Soluciones':'Lukmar'}</span>`;
}
// Estado del activo: disponible / en mantenimiento / en uso — INDEPENDIENTE
// de custodio. Un activo puede estar disponible y aun así tener custodio
// (ej. en bodega, a cargo de un área) o estar en mantenimiento sin perder el
// custodio al que hay que devolvérselo. Una sola fuente de verdad para el
// color/etiqueta de cada valor, usada tanto por el pill de tabla como por el
// selector editable del detalle — así no pueden desincronizarse entre sí.
const ESTADO_INFO = {
  disponible:    { label:"Disponible",       fg:"#2E6B3D", bg:"#DCEFE0" },
  mantenimiento: { label:"En mantenimiento",  fg:"#8A5A0F", bg:"#F5E6C8" },
  uso:           { label:"En uso",            fg:"#004DAB", bg:"#DCE8F7" },
};
function infoEstado(valor){ return ESTADO_INFO[valor] || { label: valor || "—", fg:"#57697C", bg:"#EEF1F4" }; }
function pillEstado(valor){
  const i = infoEstado(valor);
  return `<span class="pill" style="background:${i.bg};color:${i.fg};"><span class="pill-dot"></span>${esc(i.label)}</span>`;
}
// Selección efectiva para una columna: null significa "todavía no se tocó
// el filtro", lo que equivale a "todas las opciones seleccionadas" (sin filtrar).
function seleccionActiva(campo){
  if(state.filtros[campo] === null) return new Set(opcionesFiltroCache[campo]);
  return state.filtros[campo];
}

// En celular, la tabla colapsa a Tipo + Custodio (ver CSS, breakpoint 720px):
// la búsqueda general debe reflejar exactamente eso, para no confundir con
// resultados que coinciden por una columna que ni se está mostrando.
const MEDIA_COLAPSADA = "(max-width:720px)";
function columnasColapsadas(){
  return window.matchMedia && window.matchMedia(MEDIA_COLAPSADA).matches;
}
function camposBusquedaGeneral(a){
  if(columnasColapsadas()){
    return [a.tipo, a.custodio ? a.custodio.nombre : "Disponible", infoEstado(a.estado).label];
  }
  return [fmtTag(a), a.marca, a.modelo, a.serie, a.nombre_dispositivo,
    a.custodio?a.custodio.nombre:"Disponible", a.tipo, a.propiedad, a.sistema_operativo, a.proveedor, infoEstado(a.estado).label];
}

function filtrarActivos(datos){
  const f = state.filtros;
  return datos.activos.filter(a=>{
    if(f.tipo !== null && a.tipo && !f.tipo.has(a.tipo)) return false;
    if(f.propiedad !== null && !f.propiedad.has(a.propiedad)) return false;
    if(f.custodioClase !== null && !f.custodioClase.has(claseCustodio(a))) return false;
    if(f.marca !== null && a.marca && !f.marca.has(a.marca)) return false;
    if(f.empresa !== null && !f.empresa.has(a.empresa)) return false;
    if(f.estado !== null && !f.estado.has(a.estado)) return false;
    if(f.colTag && !fmtTag(a).toLowerCase().includes(f.colTag.toLowerCase())) return false;
    if(f.colTipo && !(a.tipo||"").toLowerCase().includes(f.colTipo.toLowerCase())) return false;
    if(f.colMarca){
      const t = f.colMarca.toLowerCase();
      if(!(a.marca||"").toLowerCase().includes(t)) return false;
    }
    if(f.colCustodio){
      const t = f.colCustodio.toLowerCase();
      const nombre = (a.custodio ? a.custodio.nombre : "Disponible").toLowerCase();
      if(!nombre.includes(t)) return false;
    }
    if(f.colCargo){
      const t = f.colCargo.toLowerCase();
      const cargo = (a.custodio && a.custodio.cargo ? a.custodio.cargo : "").toLowerCase();
      if(!cargo.includes(t)) return false;
    }
    if(f.colPropiedad && !(a.propiedad||"").toLowerCase().includes(f.colPropiedad.toLowerCase())) return false;
    if(f.colSerie && !(a.serie||"").toLowerCase().includes(f.colSerie.toLowerCase())) return false;
    if(f.colSo && !(a.sistema_operativo||"").toLowerCase().includes(f.colSo.toLowerCase())) return false;
    if(f.colProveedor && !(a.proveedor||"").toLowerCase().includes(f.colProveedor.toLowerCase())) return false;
    if(f.colFechaDesde && (!a.fecha_adquisicion || a.fecha_adquisicion < f.colFechaDesde)) return false;
    if(f.colFechaHasta && (!a.fecha_adquisicion || a.fecha_adquisicion > f.colFechaHasta)) return false;
    if(f.colModelo && !(a.modelo||"").toLowerCase().includes(f.colModelo.toLowerCase())) return false;
    if(f.colNombre && !(a.nombre_dispositivo||"").toLowerCase().includes(f.colNombre.toLowerCase())) return false;
    if(f.texto){
      const t = f.texto.toLowerCase();
      const campos = camposBusquedaGeneral(a).filter(Boolean).join(" ").toLowerCase();
      if(!campos.includes(t)) return false;
    }
    return true;
  });
}

function compararActivos(a,b,campo,dir){
  let va, vb;
  switch(campo){
    case "id": va=a.id; vb=b.id; break;
    case "empresa": va=a.empresa||""; vb=b.empresa||""; break;
    case "tipo": va=a.tipo||""; vb=b.tipo||""; break;
    case "marca": va=((a.marca||"")+" "+(a.modelo||"")).trim(); vb=((b.marca||"")+" "+(b.modelo||"")).trim(); break;
    case "custodio": va=(a.custodio?a.custodio.nombre:"") ; vb=(b.custodio?b.custodio.nombre:""); break;
    case "cargo": va=(a.custodio&&a.custodio.cargo)?a.custodio.cargo:""; vb=(b.custodio&&b.custodio.cargo)?b.custodio.cargo:""; break;
    case "propiedad": va=a.propiedad||""; vb=b.propiedad||""; break;
    case "serie": va=a.serie||""; vb=b.serie||""; break;
    case "so": va=a.sistema_operativo||""; vb=b.sistema_operativo||""; break;
    case "ram": va=a.ram_gb??0; vb=b.ram_gb??0; break;
    case "disco": va=a.disco_gb??0; vb=b.disco_gb??0; break;
    case "procesador": va=a.procesador||""; vb=b.procesador||""; break;
    case "macwifi": va=a.mac_wifi||""; vb=b.mac_wifi||""; break;
    case "maceth": va=a.mac_ethernet||""; vb=b.mac_ethernet||""; break;
    case "proveedor": va=a.proveedor||""; vb=b.proveedor||""; break;
    case "fecha": va=a.fecha_adquisicion||""; vb=b.fecha_adquisicion||""; break;
    case "modelo": va=a.modelo||""; vb=b.modelo||""; break;
    case "nombre": va=a.nombre_dispositivo||""; vb=b.nombre_dispositivo||""; break;
    case "estado": va=a.estado||""; vb=b.estado||""; break;
    case "valorcompra": va=a.valor_compra??0; vb=b.valor_compra??0; break;
    case "valoractual": va=valorActualActivo(a)??0; vb=valorActualActivo(b)??0; break;
    case "vidautil": va=a.vida_util_anios??0; vb=b.vida_util_anios??0; break;
    case "color": va=a.color||""; vb=b.color||""; break;
    case "longitud": va=a.longitud_m??0; vb=b.longitud_m??0; break;
    default: va=a.id; vb=b.id;
  }
  let cmp = (typeof va === "number" && typeof vb === "number") ? (va-vb) : String(va).localeCompare(String(vb),'es',{sensitivity:'base'});
  return dir==="asc" ? cmp : -cmp;
}
function listaOrdenadaFiltrada(datos){
  const lista = filtrarActivos(datos);
  lista.sort((a,b)=>compararActivos(a,b,state.orden.campo,state.orden.dir));
  return lista;
}

/* ---------- Filtro rápido: los KPI de arriba también son botones ---------- */
function estadoInicialFiltros(){
  return { texto:"", tipo:null, propiedad:null, custodioClase:null, marca:null, empresa:null, estado:null,
    colTag:"", colTipo:"", colMarca:"", colCustodio:"", colCargo:"", colPropiedad:"",
    colSerie:"", colSo:"", colProveedor:"", colFechaDesde:"", colFechaHasta:"", colModelo:"", colNombre:"" };
}
// Checklist (tipo/propiedad/custodioClase/marca/empresa/estado): null = sin
// filtrar. Texto (todo lo demás, incluida la búsqueda general): "" = sin
// filtrar. Cualquier otra cosa cuenta como "hay un filtro puesto".
function hayFiltrosActivos(){
  const f = state.filtros;
  if(["tipo","propiedad","custodioClase","marca","empresa","estado"].some(k=>f[k]!==null)) return true;
  return ["texto","colTag","colTipo","colMarca","colCustodio","colCargo","colPropiedad",
    "colSerie","colSo","colProveedor","colFechaDesde","colFechaHasta","colModelo","colNombre"].some(k=>f[k]);
}
// "Disponible" ahora es Estado, no Custodio — "Persona"/"Área" siguen
// siendo Custodio como siempre. Las tres tarjetas se excluyen mutuamente
// (activar una limpia la otra), para que el click siga sintiéndose como un
// solo interruptor aunque por debajo escriban en dos campos distintos.
const CAMPO_FILTRO_KPI = { disponible:"estado", persona:"custodioClase", area:"custodioClase" };
function aplicarFiltroKpi(valor){
  if(valor === null){
    state.filtros = estadoInicialFiltros();
  } else {
    const campo = CAMPO_FILTRO_KPI[valor];
    const otroCampo = campo === "estado" ? "custodioClase" : "estado";
    const actual = state.filtros[campo];
    const yaActivo = actual && actual.size===1 && actual.has(valor);
    state.filtros[campo] = yaActivo ? null : new Set([valor]);
    state.filtros[otroCampo] = null;
  }
  renderMain();
}
function claseKpiActiva(valor){
  if(valor === null) return (!state.filtros.custodioClase && !state.filtros.estado) ? "kpi-selected" : "";
  const campo = CAMPO_FILTRO_KPI[valor];
  const actual = state.filtros[campo];
  return (actual && actual.size===1 && actual.has(valor)) ? "kpi-selected" : "";
}

/* ---------- Gestor de columnas visibles ---------- */
function abrirGestorColumnas(){
  // Orden alfabético SOLO para cómo se listan los checkboxes acá — el orden
  // real de las columnas en la tabla lo sigue decidiendo
  // columnasVisiblesOrdenadas(), que usa el orden de DEFINICION_COLUMNAS
  // (Tag primero, Acciones al final), no este.
  const opcionesNoCore = DEFINICION_COLUMNAS.filter(c=>!c.core)
    .sort((a,b)=>a.label.localeCompare(b.label,'es'));
  const html = `<div class="modal">
    <div class="modal-header"><h3>Columnas visibles</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="field hint" style="margin-bottom:10px;">Tag y Acciones siempre se muestran. Elige qué otras columnas ver en la tabla — en celular, de todos modos solo se muestran Tipo y Custodio.</div>
      <div id="aviso-columnas"></div>
      <div class="filter-panel-list" style="max-height:none;">
        ${opcionesNoCore.map(c=>`
          <label class="filter-opt" data-col-opt="${c.key}">
            <input type="checkbox" data-col-toggle="${c.key}" ${state.columnasVisibles.has(c.key)?"checked":""}>
            <span class="filter-opt-label">${esc(c.label)}</span>
          </label>`).join("")}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn" id="btn-restablecer-columnas">↺ Restablecer columnas por defecto</button>
      <button class="btn modal-close">Cerrar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    actualizarAvisoColumnas();
    document.querySelectorAll("[data-col-toggle]").forEach(cb=>{
      cb.addEventListener("change", ()=>{
        const key = cb.dataset.colToggle;
        if(cb.checked) state.columnasVisibles.add(key); else state.columnasVisibles.delete(key);
        actualizarAvisoColumnas();
        renderMain(); // cambia el ancho de todas las columnas: hace falta rehacer el thead completo
      });
    });
    document.getElementById("btn-restablecer-columnas").addEventListener("click", ()=>{
      restablecerColumnasPorDefecto();
      cerrarModal(); renderMain(); abrirGestorColumnas();
    });
  });
}
// Vuelve a las columnas por defecto Y limpia cualquier filtro que hubiera
// quedado puesto en una columna que deja de ser visible — dejar un filtro
// "escondido" activo confundiría más que ayudar (la tabla se ve corta y no
// hay ninguna pista de por qué, si la columna filtrada ya no está a la vista).
function restablecerColumnasPorDefecto(){
  DEFINICION_COLUMNAS
    .filter(c => state.columnasVisibles.has(c.key) && !COLUMNAS_VISIBLES_DEFAULT.includes(c.key))
    .forEach(c=>{
      if(c.filterCampo) state.filtros[c.filterCampo] = null;
      if(c.campoTexto) state.filtros[c.campoTexto] = "";
      if(c.filtroFecha){ state.filtros.colFechaDesde = ""; state.filtros.colFechaHasta = ""; }
    });
  state.columnasVisibles = new Set(COLUMNAS_VISIBLES_DEFAULT);
}
function actualizarAvisoColumnas(){
  const holder = document.getElementById("aviso-columnas");
  if(!holder) return;
  const total = state.columnasVisibles.size;
  holder.innerHTML = total > LIMITE_COLUMNAS_RECOMENDADO
    ? `<div class="alert alert-error" style="margin-bottom:10px;">Tienes ${total} columnas visibles. Recomendamos no pasar de ${LIMITE_COLUMNAS_RECOMENDADO} para que la tabla se siga leyendo bien en pantallas medianas — pero si te sirve así, puedes dejarlo.</div>`
    : "";
}

/* ---------- Modal "Visualizar KPIs": el mismo desglose del filtro, con barras ---------- */
const NOMBRE_COLUMNA_KPI = { tipo:"Tipo", marca:"Marca", custodioClase:"Custodio", propiedad:"Propiedad", empresa:"Empresa", estado:"Estado" };
// Columnas que entran en el resumen GLOBAL (todas las categóricas menos
// Custodio, que queda fuera a propósito por decisión explícita).
const CAMPOS_RESUMEN_GLOBAL = ["tipo","marca","propiedad"];

// Cálculo reutilizable: lo mismo que ya hacía abrirModalKpiColumna, factorizado
// para que tanto el modal de una columna como el export global lo compartan.
function calcularResumenColumna(campo){
  const nombre = NOMBRE_COLUMNA_KPI[campo] || campo;
  const opciones = opcionesFiltroCache[campo] || [];
  const lista = listaParaConteo(campo);
  const filas = opciones
    .map(op=>({ label: labelOpcionFiltro(campo, op), n: contarValorEnLista(lista, campo, op) }))
    .sort((a,b)=>b.n-a.n);
  const totalConteo = filas.reduce((s,f)=>s+f.n,0);
  return { campo, nombre, filas, totalConteo };
}

function copiarAlPortapapelesTexto(texto){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(texto);
  }
  return Promise.reject(new Error("El navegador no permite copiar al portapapeles en este contexto."));
}
function descargarArchivoTexto(nombreArchivo, contenido, tipoMime){
  const blob = new Blob([contenido], { type: tipoMime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = nombreArchivo;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// --- Formatos de exportación: reciben SIEMPRE un arreglo de secciones
// ({nombre, filas, totalConteo}), así el mismo formateador sirve para un
// resumen individual (una sección) y para el global (varias).
function resumenATextoWhatsApp(secciones){
  return secciones.map(s=>{
    const cuerpo = s.filas.map(f=>{
      const pct = s.totalConteo ? Math.round(f.n/s.totalConteo*100) : 0;
      return `• ${f.label}: ${f.n} (${pct}%)`;
    }).join("\n");
    return `*Resumen: ${s.nombre}* (${s.totalConteo} activos)\n${cuerpo}`;
  }).join("\n\n");
}
function resumenACSV(secciones){
  const filasCSV = [["Campo","Valor","Conteo"]];
  secciones.forEach(s=>{
    s.filas.forEach(f=>filasCSV.push([s.nombre, f.label, f.n]));
  });
  return filasCSV.map(fila=>fila.map(v=>{
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t;
  }).join(",")).join("\n");
}
function resumenAHTML(secciones, titulo){
  const bloques = secciones.map(s=>{
    const max = Math.max(1, ...s.filas.map(f=>f.n));
    const filasHtml = s.filas.map(f=>`
      <div class="fila">
        <div class="etiqueta">${esc(f.label)}</div>
        <div class="pista"><div class="barra" style="width:${(f.n/max*100).toFixed(1)}%"></div></div>
        <div class="num">${f.n}</div>
      </div>`).join("");
    return `<section><h2>${esc(s.nombre)}</h2><p class="sub">${s.totalConteo} activos</p>${filasHtml}</section>`;
  }).join("");
  // Todo el tamaño (texto, relleno, alto de barra) usa clamp() — escala de
  // forma continua entre celular y TV sin depender de un puñado de breakpoints
  // fijos que dejarían huecos en los tamaños intermedios (tablet, laptop). La
  // cuadrícula de secciones usa auto-fit, así que se reorganiza sola en más
  // columnas cuando hay espacio, sin necesitar su propia media query.
  return `<!DOCTYPE html><html lang="es"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titulo)}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;color:#1c2733;margin:0;padding:clamp(16px,4vw,40px);}
    .envoltorio{max-width:1400px;margin:0 auto;}
    h1{font-size:clamp(19px,2.6vw,28px);margin:0 0 4px;}
    .fecha{color:#6b7684;font-size:clamp(12px,1.4vw,15px);margin-bottom:clamp(16px,3vw,28px);}
    .secciones{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:clamp(12px,2vw,20px);}
    section{background:#fff;border:1px solid #e2e6ea;border-radius:12px;padding:clamp(16px,2.4vw,26px);min-width:0;}
    h2{font-size:clamp(15px,1.8vw,19px);margin:0 0 2px;color:#12324a;}
    .sub{font-size:clamp(11.5px,1.3vw,14px);color:#6b7684;margin:0 0 14px;}
    .fila{display:flex;align-items:center;gap:clamp(8px,1.4vw,14px);padding:clamp(4px,0.7vw,7px) 0;min-width:0;}
    .etiqueta{flex:0 1 40%;min-width:0;font-size:clamp(12px,1.3vw,15px);color:#334;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .pista{flex:1;min-width:24px;height:clamp(7px,1vw,12px);background:#eef1f4;border-radius:5px;overflow:hidden;}
    .barra{height:100%;background:#007EB2;border-radius:5px;}
    .num{flex:0 0 auto;min-width:2.4em;text-align:right;font-size:clamp(12px,1.3vw,15px);font-weight:600;color:#12324a;}
  </style></head><body>
    <div class="envoltorio">
      <h1>${esc(titulo)}</h1>
      <div class="fecha">Generado el ${fechaEnPalabras(hoyISO())}</div>
      <div class="secciones">${bloques}</div>
    </div>
  </body></html>`;
}

function abrirModalKpiColumna(campo){
  const { nombre, filas, totalConteo } = calcularResumenColumna(campo);
  const max = Math.max(1, ...filas.map(f=>f.n));
  const html = `<div class="modal">
    <div class="modal-header"><h3>Resumen — ${esc(nombre)}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="field hint" style="margin-bottom:14px;">Sobre ${totalConteo} activos, considerando los demás filtros que tengas activos ahora.</div>
      <div class="kpi-breakdown">
        ${filas.map(f=>`
          <div class="kpi-breakdown-row">
            <div class="kpi-breakdown-label">${esc(f.label)}</div>
            <div class="kpi-breakdown-bar-track"><div class="kpi-breakdown-bar" style="width:${(f.n/max*100).toFixed(1)}%"></div></div>
            <div class="kpi-breakdown-num">${f.n}</div>
          </div>`).join("") || '<div class="empty-state"><div class="big">—</div>No hay datos para mostrar.</div>'}
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-sm" id="kpi-export-wa">Copiar para WhatsApp</button>
      <button class="btn btn-sm" id="kpi-export-csv">Descargar CSV</button>
      <button class="btn btn-sm" id="kpi-export-html">Descargar HTML</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const seccion = [{ nombre, filas, totalConteo }];
    document.getElementById("kpi-export-wa").addEventListener("click", async ()=>{
      try{ await copiarAlPortapapelesTexto(resumenATextoWhatsApp(seccion)); alert("Copiado — pégalo directo en WhatsApp."); }
      catch(err){ alert("No se pudo copiar: " + err.message); }
    });
    document.getElementById("kpi-export-csv").addEventListener("click", ()=>{
      descargarArchivoTexto(`resumen_${campo}.csv`, resumenACSV(seccion), "text/csv");
    });
    document.getElementById("kpi-export-html").addEventListener("click", ()=>{
      descargarArchivoTexto(`resumen_${campo}.html`, resumenAHTML(seccion, `Resumen — ${nombre}`), "text/html");
    });
  });
}


function renderVistaActivos(main){
  const datos = cargarActivos();
  recalcularOpcionesFiltro(datos);
  const lista = listaOrdenadaFiltrada(datos);
  const agregados = calcularAgregados(lista);

  main.innerHTML = `
    <div class="summary-row" id="resumen-cards"></div>
    <div class="filterbar">
      <input type="text" id="f-texto" placeholder="Buscar por tag, marca, serie, custodio…" value="${esc(state.filtros.texto)}">
      <div class="fb-spacer"></div>
      <button class="btn" id="btn-limpiar-filtros" ${hayFiltrosActivos()?"":"disabled"} title="Quitar todos los filtros aplicados">✕ Quitar filtros</button>
      <button class="btn" id="btn-columnas">☰ Columnas</button>
      <button class="btn" id="btn-exportar">⭳ Exportar a Excel</button>
      <div class="dropdown-wrap" id="dropdown-resumenes">
        <button class="btn" id="btn-exportar-resumenes">📊 Exportar resúmenes ▾</button>
        <div class="dropdown-menu" id="menu-exportar-resumenes" hidden>
          <button type="button" class="dropdown-item" data-formato-global="wa">Copiar para WhatsApp</button>
          <button type="button" class="dropdown-item" data-formato-global="csv">Descargar CSV</button>
          <button type="button" class="dropdown-item" data-formato-global="html">Descargar HTML</button>
        </div>
      </div>
      ${puede("crear_activo") ? `<button class="btn btn-primary" id="btn-nuevo">+ Nuevo activo</button>` : ""}
    </div>
    <div class="tablewrap tablewrap-activos">
      <table>
        <thead><tr id="fila-encabezados"></tr></thead>
        <tbody id="tbody-activos"></tbody>
      </table>
      <div id="empty-state-holder"></div>
    </div>
  `;
  document.getElementById("fila-encabezados").innerHTML = filaEncabezados();
  document.querySelectorAll(".th-text-filter").forEach(inp=>{
    inp.addEventListener("input", e=>{
      state.filtros[e.target.dataset.colTexto] = e.target.value;
      actualizarTablaYResumen();
    });
  });
  document.querySelectorAll(".th-date-filter").forEach(inp=>{
    inp.addEventListener("input", e=>{
      state.filtros[e.target.dataset.colFecha] = e.target.value;
      actualizarTablaYResumen();
    });
  });
  actualizarTablaYResumen();

  document.getElementById("f-texto").addEventListener("input", e=>{
    state.filtros.texto = e.target.value;
    actualizarTablaYResumen();
  });
  const btnNuevo = document.getElementById("btn-nuevo");
  if(btnNuevo) btnNuevo.addEventListener("click", ()=>abrirFormActivo(null));
  document.getElementById("btn-exportar").addEventListener("click", async ()=>{
    try{ await exportarActivosExcel(); }
    catch(err){ alert("No se pudo generar el Excel: " + err.message); }
  });
  document.getElementById("btn-limpiar-filtros").addEventListener("click", ()=>{
    state.filtros = estadoInicialFiltros();
    renderMain();
  });
  document.getElementById("btn-columnas").addEventListener("click", abrirGestorColumnas);
  document.getElementById("btn-exportar-resumenes").addEventListener("click", (e)=>{
    e.stopPropagation();
    document.getElementById("menu-exportar-resumenes").hidden = !document.getElementById("menu-exportar-resumenes").hidden;
  });
  document.querySelectorAll("[data-formato-global]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      document.getElementById("menu-exportar-resumenes").hidden = true;
      const secciones = CAMPOS_RESUMEN_GLOBAL.map(calcularResumenColumna);
      const formato = b.dataset.formatoGlobal;
      if(formato==="wa"){
        try{ await copiarAlPortapapelesTexto(resumenATextoWhatsApp(secciones)); alert("Copiado — pégalo directo en WhatsApp."); }
        catch(err){ alert("No se pudo copiar: " + err.message); }
      } else if(formato==="csv"){
        descargarArchivoTexto("resumenes_activos.csv", resumenACSV(secciones), "text/csv");
      } else if(formato==="html"){
        descargarArchivoTexto("resumenes_activos.html", resumenAHTML(secciones, "Resúmenes de activos"), "text/html");
      }
    });
  });
}

// Repinta solo las tarjetas de resumen y el cuerpo de la tabla — nunca el
// input de búsqueda ni los paneles de filtro — para que escribir o marcar
// checkboxes no pierda el foco ni cierre nada que esté abierto por hover.
// Para los KPI de arriba, el conteo de cada categoría de custodio debe verse
// completo (respetando los demás filtros activos, pero NO el filtro de
// custodio en sí) — si no, al hacer clic en "Disponibles" las otras 3
// tarjetas colapsarían al mismo número y se perdería la vista general.
function agregadosParaKpis(datos){
  const anterior = state.filtros.custodioClase;
  state.filtros.custodioClase = null;
  const lista = filtrarActivos(datos);
  state.filtros.custodioClase = anterior;
  return calcularAgregados(lista);
}

function actualizarTablaYResumen(){
  const main = document.getElementById("main");
  if(!main || state.vista !== "activos") return;
  const btnLimpiar = document.getElementById("btn-limpiar-filtros");
  if(btnLimpiar) btnLimpiar.disabled = !hayFiltrosActivos();
  // Cualquier cambio de filtro puede achicar la tabla (menos filas, o incluso
  // 0). Sin esto, el navegador puede "clampear" el scroll hacia arriba al
  // reducirse la altura de la página, moviendo el header bajo el cursor y
  // cerrando el menú de filtro que estaba abierto por hover.
  const scrollXAntes = window.scrollX, scrollYAntes = window.scrollY;
  const datos = cargarActivos();
  const lista = listaOrdenadaFiltrada(datos);
  const agregadosKpi = agregadosParaKpis(datos);
  const resumen = document.getElementById("resumen-cards");
  if(resumen) resumen.innerHTML = `
    <div class="summary-card kpi-total ${claseKpiActiva(null)}" data-kpi="total" tabindex="0" role="button" aria-label="Ver todos">
      <div class="kpi-icon">${ICONO_KPI_TOTAL}</div>
      <div class="kpi-text"><div class="num">${agregadosKpi.total}</div><div class="lbl">Total (según filtros)</div></div>
    </div>
    <div class="summary-card kpi-disponible ${claseKpiActiva("disponible")}" data-kpi="disponible" tabindex="0" role="button" aria-label="Filtrar disponibles">
      <div class="kpi-icon">${ICONO_KPI_DISPONIBLE}</div>
      <div class="kpi-text"><div class="num">${agregadosKpi.disponibles}</div><div class="lbl">Disponibles (por estado)</div></div>
    </div>
    <div class="summary-card kpi-persona ${claseKpiActiva("persona")}" data-kpi="persona" tabindex="0" role="button" aria-label="Filtrar asignados a persona">
      <div class="kpi-icon">${ICONO_KPI_PERSONA}</div>
      <div class="kpi-text"><div class="num">${agregadosKpi.asignadosPersona}</div><div class="lbl">Asignados a persona</div></div>
    </div>
    <div class="summary-card kpi-area ${claseKpiActiva("area")}" data-kpi="area" tabindex="0" role="button" aria-label="Filtrar asignados a área">
      <div class="kpi-icon">${ICONO_KPI_AREA}</div>
      <div class="kpi-text"><div class="num">${agregadosKpi.asignadosArea}</div><div class="lbl">Asignados a área/depto.</div></div>
    </div>
  `;
  const tbody = document.getElementById("tbody-activos");
  if(tbody){
    tbody.innerHTML = lista.map(a=>filaActivo(a)).join("");
    tbody.querySelectorAll("tr[data-id]").forEach(tr=>{
      tr.addEventListener("click", (e)=>{
        if(e.target.closest("[data-stop]")) return;
        abrirDetalle(Number(tr.dataset.id));
      });
    });
  }
  const holder = document.getElementById("empty-state-holder");
  if(holder) holder.innerHTML = lista.length===0 ? `<div class="empty-state"><div class="big">—</div>Ningún activo coincide con estos filtros.</div>` : "";
  actualizarConteosFiltros();
  if(window.scrollX !== scrollXAntes || window.scrollY !== scrollYAntes){
    window.scrollTo(scrollXAntes, scrollYAntes);
  }
}

/* ---------- Encabezados: orden + filtro por checklist en hover ---------- */
function flechaOrden(campo){
  if(state.orden.campo !== campo) return `<span class="th-arrow"></span>`;
  return `<span class="th-arrow th-arrow-active">${state.orden.dir==="asc"?"▲":"▼"}</span>`;
}
function panelFiltroHtml(campo, opciones){
  const seleccion = seleccionActiva(campo);
  const lista = listaParaConteo(campo);
  const nombreCol = NOMBRE_COLUMNA_KPI[campo] || campo;
  const conBuscador = campo === "tipo" || campo === "marca";
  return `<div class="filter-panel">
    <div class="filter-panel-card">
      <div class="filter-panel-titlebar">Filtrar ${esc(nombreCol)}</div>
      <div class="filter-panel-card-inner">
        ${conBuscador ? `<input type="text" class="filter-panel-search" data-filtro-buscar="${campo}" placeholder="Buscar ${esc(nombreCol.toLowerCase())}…">` : ""}
        <div class="filter-panel-actions">
          <button type="button" class="btn btn-sm" data-filtro-todos="${campo}">Todos</button>
          <button type="button" class="btn btn-sm" data-filtro-ninguno="${campo}">Ninguno</button>
        </div>
        <div class="filter-panel-list">
          ${opciones.map(op=>`
            <label class="filter-opt" data-filtro-opt-campo="${campo}" data-filtro-opt-valor="${esc(op)}">
              <input type="checkbox" data-filtro-campo="${campo}" data-filtro-valor="${esc(op)}" ${seleccion.has(op)?"checked":""}>
              <span class="filter-opt-label">${esc(labelOpcionFiltro(campo, op))}</span>
              <span class="filter-opt-count">${contarValorEnLista(lista, campo, op)}</span>
            </label>`).join("")}
        </div>
        <div class="filter-panel-hint">Doble clic en una opción para seleccionar solo esa.</div>
        <button type="button" class="btn btn-sm filter-panel-kpi-btn" data-ver-kpis="${campo}">📊 Ver resumen</button>
      </div>
    </div>
  </div>`;
}
// Contenido del botón-barra de filtro: un ícono neutro cuando no hay filtro
// activo, o el conteo "seleccionadas/total" (o "0" en rojo) cuando sí lo hay.
function contenidoBotonFiltro(campo, opciones){
  const seleccion = seleccionActiva(campo);
  const total = opciones.length;
  if(seleccion.size === total){
    return `<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/></svg>`;
  }
  if(seleccion.size === 0) return "0";
  return `${seleccion.size}/${total}`;
}
function thColumna(o){
  const { sortCampo, filterCampo, label, ordenable, opcionesChecklist, campoTexto, placeholderTexto, filtroFecha, colClass, widthPct } = o;
  const filaLabel = ordenable
    ? `<span class="th-label th-sortable" data-sort="${sortCampo}"><span class="th-label-text">${label}</span>${flechaOrden(sortCampo)}</span>`
    : `<span class="th-label"><span class="th-label-text">${label}</span></span>`;
  let filtroBtn = "";
  if(opcionesChecklist){
    const seleccion = seleccionActiva(filterCampo);
    const activo = seleccion.size < opcionesChecklist.length;
    const vacio = seleccion.size === 0;
    filtroBtn = `<div class="th-filter">
      <button type="button" class="th-filter-btn ${activo?'active':''} ${vacio?'empty':''}" data-filtro-btn="${filterCampo}" tabindex="0" aria-label="Filtrar ${label}">${contenidoBotonFiltro(filterCampo, opcionesChecklist)}</button>
      ${panelFiltroHtml(filterCampo, opcionesChecklist)}
    </div>`;
  }
  const filaTexto = filtroFecha
    ? `<div class="th-row2 th-row2-fecha">
        <input type="date" class="th-date-filter" data-col-fecha="colFechaDesde" title="Desde" value="${esc(state.filtros.colFechaDesde||'')}">
        <input type="date" class="th-date-filter" data-col-fecha="colFechaHasta" title="Hasta" value="${esc(state.filtros.colFechaHasta||'')}">
      </div>`
    : campoTexto
    ? `<div class="th-row2"><input type="text" class="th-text-filter" data-col-texto="${campoTexto}" placeholder="${esc(placeholderTexto||'Buscar…')}" value="${esc(state.filtros[campoTexto]||'')}"></div>`
    : "";
  const estilo = widthPct ? ` style="width:${widthPct}"` : "";
  return `<th class="${colClass||''}"${estilo}><div class="th-inner"><div class="th-row1">${filaLabel}${filtroBtn}</div>${filaTexto}</div></th>`;
}
// Reparte el ancho entre las columnas actualmente visibles según su "weight"
// relativo, así la tabla se ve bien sin importar cuántas/cuáles columnas
// haya elegido el usuario en "Columnas".
function columnasVisiblesOrdenadas(){
  return DEFINICION_COLUMNAS.filter(c=>state.columnasVisibles.has(c.key));
}
function filaEncabezados(){
  const cols = columnasVisiblesOrdenadas();
  const pesoTotal = cols.reduce((s,c)=>s+c.weight,0);
  return cols.map(c=>{
    const widthPct = ((c.weight/pesoTotal)*100).toFixed(2)+"%";
    if(c.key==="acciones") return `<th class="col-acciones" style="width:${widthPct}"></th>`;
    return thColumna({
      sortCampo:c.sortCampo, filterCampo:c.filterCampo, label:c.label,
      ordenable:!!c.sortCampo,
      opcionesChecklist:c.filterCampo ? opcionesFiltroCache[c.filterCampo] : null,
      campoTexto:c.campoTexto, placeholderTexto:c.placeholder, filtroFecha:c.filtroFecha,
      colClass:`col-${c.key}`, widthPct,
    });
  }).join("");
}
function marcarCheckboxesPanel(campo, seleccion){
  document.querySelectorAll(`input[data-filtro-campo="${campo}"]`).forEach(cb=>{
    cb.checked = seleccion.has(cb.dataset.filtroValor);
  });
}
function actualizarBotonFiltroActivo(campo){
  const opciones = opcionesFiltroCache[campo];
  const seleccion = seleccionActiva(campo);
  const btn = document.querySelector(`[data-filtro-btn="${campo}"]`);
  if(!btn) return;
  btn.classList.toggle("active", seleccion.size < opciones.length);
  btn.classList.toggle("empty", seleccion.size === 0);
  btn.innerHTML = contenidoBotonFiltro(campo, opciones);
}
function actualizarFlechasOrden(){
  document.querySelectorAll(".th-label.th-sortable").forEach(el=>{
    const campo = el.dataset.sort;
    const arrow = el.querySelector(".th-arrow");
    if(!arrow) return;
    if(state.orden.campo===campo){ arrow.className="th-arrow th-arrow-active"; arrow.textContent = state.orden.dir==="asc"?"▲":"▼"; }
    else { arrow.className="th-arrow"; arrow.textContent=""; }
  });
}

// Delegación global: clicks (ordenar, todos/ninguno, botones de fila), cambios
// de checkbox (filtrar) y doble clic (aislar una opción). Todo dispara solo
// actualizarTablaYResumen(), nunca un renderVistaActivos() completo, para no
// destruir el panel de filtro que el usuario tiene abierto con el mouse encima.
document.addEventListener("keydown", (e)=>{
  if(e.key !== "Enter" && e.key !== " ") return;
  const kpi = e.target.closest && e.target.closest("[data-kpi]");
  if(kpi){ e.preventDefault(); kpi.click(); }
});
document.addEventListener("click", (e)=>{
  const kpi = e.target.closest("[data-kpi]");
  if(kpi){
    const valor = kpi.dataset.kpi;
    aplicarFiltroKpi(valor==="total" ? null : valor);
    return;
  }
  const verKpis = e.target.closest("[data-ver-kpis]");
  if(verKpis){
    abrirModalKpiColumna(verKpis.dataset.verKpis);
    return;
  }
  const btn = e.target.closest("[data-action]");
  if(btn){
    const id = Number(btn.dataset.id);
    const accion = btn.dataset.action;
    if(accion==="custodio") abrirCambiarCustodio(id);
    if(accion==="baja") abrirConfirmarBaja(id);
    if(accion==="marcar"){ toggleEnPortapapeles(id); actualizarTablaYResumen(); return; }
    return;
  }
  const sortLabel = e.target.closest("[data-sort]");
  if(sortLabel){
    const campo = sortLabel.dataset.sort;
    if(state.orden.campo===campo) state.orden.dir = state.orden.dir==="asc"?"desc":"asc";
    else { state.orden.campo = campo; state.orden.dir = "asc"; }
    actualizarFlechasOrden();
    actualizarTablaYResumen();
    return;
  }
  const btnTodos = e.target.closest("[data-filtro-todos]");
  if(btnTodos){
    const campo = btnTodos.dataset.filtroTodos;
    state.filtros[campo] = new Set(opcionesFiltroCache[campo]);
    marcarCheckboxesPanel(campo, state.filtros[campo]);
    actualizarBotonFiltroActivo(campo);
    actualizarTablaYResumen();
    return;
  }
  const btnNinguno = e.target.closest("[data-filtro-ninguno]");
  if(btnNinguno){
    const campo = btnNinguno.dataset.filtroNinguno;
    state.filtros[campo] = new Set();
    marcarCheckboxesPanel(campo, state.filtros[campo]);
    actualizarBotonFiltroActivo(campo);
    actualizarTablaYResumen();
    return;
  }
});
document.addEventListener("input", (e)=>{
  const buscador = e.target.closest("[data-filtro-buscar]");
  if(!buscador) return;
  const campo = buscador.dataset.filtroBuscar;
  const q = buscador.value.trim().toLowerCase();
  document.querySelectorAll(`.filter-opt[data-filtro-opt-campo="${campo}"]`).forEach(opt=>{
    const texto = opt.querySelector(".filter-opt-label").textContent.toLowerCase();
    opt.style.display = texto.includes(q) ? "" : "none";
  });
});
document.addEventListener("change", (e)=>{
  const cb = e.target.closest("input[data-filtro-campo]");
  if(!cb) return;
  const campo = cb.dataset.filtroCampo;
  if(state.filtros[campo] === null) state.filtros[campo] = new Set(opcionesFiltroCache[campo]);
  const set = state.filtros[campo];
  if(cb.checked) set.add(cb.dataset.filtroValor); else set.delete(cb.dataset.filtroValor);
  actualizarBotonFiltroActivo(campo);
  actualizarTablaYResumen();
});
document.addEventListener("dblclick", (e)=>{
  const opt = e.target.closest(".filter-opt");
  if(!opt) return;
  e.preventDefault();
  const campo = opt.dataset.filtroOptCampo;
  const valor = opt.dataset.filtroOptValor;
  state.filtros[campo] = new Set([valor]);
  marcarCheckboxesPanel(campo, state.filtros[campo]);
  actualizarBotonFiltroActivo(campo);
  actualizarTablaYResumen();
});

/* ---------- Exportar a Excel (CSV compatible, con BOM para acentos) ---------- */
// ---------- Exportar listado filtrado a Excel real (plantilla + filas duplicadas) ----------
// A diferencia del acta (que tiene 6 juegos de marcadores fijos, ITEM1..ITEM6),
// aquí el número de filas es variable (tantas como activos pasen el filtro),
// así que hay que construir renglones <row> nuevos en vez de solo reemplazar
// texto en marcadores existentes. Los marcadores de ActivosTecnologicos.xlsx
// viven en xl/sharedStrings.xml y ADEMÁS se comparten entre hoja 1 y hoja 2
// (mismo índice de shared string para CUSTODIO_NOMBRE/TIPO/CARGO en ambas) —
// por eso cada celda inyectada usa un inline string (t="inlineStr") propio en
// vez de reutilizar/editar el shared string original: si se reusara, todas
// las filas duplicadas (y las de la otra hoja) quedarían con el mismo valor.
function celdaInline(colLetra, fila, styleIdx, valor){
  const texto = (valor===null||valor===undefined||valor==="") ? "" :
    String(valor).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  return `<c r="${colLetra}${fila}" s="${styleIdx}" t="inlineStr"><is><t xml:space="preserve">${texto}</t></is></c>`;
}
const COLS_LISTADO_ACTIVOS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W"];
const COLS_LISTADO_HISTORIAL = ["A","B","C","D","E","F","G"];
// Estilo real (índice de cellXfs) de cada columna en la fila de plantilla de
// la Tabla — NO es uniforme: centra RAM/Disco/Fecha/Longitud y alinea a la
// derecha Valor Compra/Valor Actual, tal como está definido en
// ActivosTecnologicos.xlsx (verificado leyendo xl/worksheets/sheet1.xml
// fila 10 y sheet2.xml fila 4 directamente).
const ESTILOS_LISTADO_ACTIVOS = [31,28,28,28,28,28,29,30,27,28,29,30,32,32,28,28,29,30,32,34,34,28,33];
const ESTILOS_LISTADO_HISTORIAL = [45,42,43,44,46,47,48];
function filaXML(fila, estilos, columnas, valores){
  const celdas = columnas.map((col,i)=>celdaInline(col, fila, estilos[i], valores[i])).join("");
  return `<row r="${fila}" spans="1:${columnas.length}" ht="18" customHeight="1" x14ac:dyDescent="0.25">${celdas}</row>`;
}
function etiquetaCustodioTipo(tipo){
  if(tipo==="area") return "Área / departamento";
  if(tipo==="mantenimiento") return "Mantenimiento";
  if(tipo==="persona") return "Persona";
  return "";
}

async function exportarActivosExcel(){
  const datos = cargarActivos();
  const lista = listaOrdenadaFiltrada(datos);
  if(lista.length===0){ alert("No hay activos que coincidan con los filtros actuales."); return; }

  const resp = await fetch("assets/plantillas/ActivosTecnologicos.xlsx");
  if(!resp.ok) throw new Error("No se pudo cargar la plantilla (assets/plantillas/ActivosTecnologicos.xlsx).");
  const buf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Hoja 1 "Computadores": un renglón por activo filtrado.
  let xml1 = await zip.file("xl/worksheets/sheet1.xml").async("string");
  // La fila 8 (nota amarilla "Fila de plantilla — no borrar…") es para quien
  // abra la plantilla en crudo, no para un reporte ya generado — se quita acá.
  xml1 = xml1.replace(/<row r="8"[^>]*>.*?<\/row>/s, "");
  const filas1 = lista.map((a,i)=>{
    const valores = [
      fmtTag(a), a.empresa==="eq"?"EQ Soluciones":"Lukmar", a.tipo||"", a.marca||"", a.modelo||"",
      a.serie||"", a.nombre_dispositivo||"", capitalizar(a.propiedad)||"",
      a.custodio?a.custodio.nombre:"Disponible", a.custodio?etiquetaCustodioTipo(a.custodio.tipo_custodio):"",
      a.custodio?(a.custodio.cargo||""):"", a.sistema_operativo||"", a.ram_gb??"", a.disco_gb??"",
      a.procesador||"", a.mac_wifi||"", a.mac_ethernet||"", a.proveedor||"", a.fecha_adquisicion||"",
      a.valor_compra??"", valorActualActivo(a)??"", a.color||"", a.longitud_m??"",
    ];
    return filaXML(10+i, ESTILOS_LISTADO_ACTIVOS, COLS_LISTADO_ACTIVOS, valores);
  }).join("");
  xml1 = xml1.replace(/<row r="10"[^>]*>.*?<\/row>/s, filas1);
  xml1 = xml1.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:W${9+lista.length}"/>`);
  zip.file("xl/worksheets/sheet1.xml", xml1);

  // tblComputadores es una Tabla real de Excel (no solo celdas con estilo):
  // su propio ref y el autoFilter que la acompaña también delimitan A9:W10
  // en la plantilla y hay que expandirlos junto con el <dimension> de la
  // hoja, o Excel abre el archivo con la Tabla encogida a la fila original.
  let tabla1 = await zip.file("xl/tables/table1.xml").async("string");
  tabla1 = tabla1.split('ref="A9:W10"').join(`ref="A9:W${9+lista.length}"`);
  zip.file("xl/tables/table1.xml", tabla1);

  // Hoja 2 "historial_custodia": un renglón por tramo de cada activo filtrado,
  // en orden cronológico (1 = más antiguo) — el array en memoria viene más
  // reciente primero, así que se invierte por activo antes de numerar.
  let xml2 = await zip.file("xl/worksheets/sheet2.xml").async("string");
  const filas2 = [];
  let filaActual = 4;
  lista.forEach(a=>{
    const cronologico = [...a.historial_custodia].reverse();
    cronologico.forEach((t,idx)=>{
      const valores = [fmtTag(a), t.nombre||"", etiquetaCustodioTipo(t.tipo_custodio), t.cargo||"", t.desde||"", t.hasta||"", idx+1];
      filas2.push(filaXML(filaActual, ESTILOS_LISTADO_HISTORIAL, COLS_LISTADO_HISTORIAL, valores));
      filaActual++;
    });
  });
  const totalFilasHist = filaActual - 4;
  xml2 = xml2.replace(/<row r="4"[^>]*>.*?<\/row>/s, filas2.join(""));
  xml2 = xml2.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:G${Math.max(4,3+totalFilasHist)}"/>`);
  zip.file("xl/worksheets/sheet2.xml", xml2);

  // Mismo motivo que tblComputadores: tblHistorialCustodia también es una
  // Tabla real (A3:G4 en la plantilla) y necesita su ref/autoFilter propios
  // expandidos, con el mismo piso mínimo que el dimension de la hoja.
  let tabla2 = await zip.file("xl/tables/table2.xml").async("string");
  tabla2 = tabla2.split('ref="A3:G4"').join(`ref="A3:G${Math.max(4,3+totalFilasHist)}"`);
  zip.file("xl/tables/table2.xml", tabla2);

  // {{FECHA_ACTUALIZACION}} es un marcador único (F7/G7), no uno que se
  // duplique por fila — este sí se puede reemplazar in-place en sharedStrings.xml.
  let shared = await zip.file("xl/sharedStrings.xml").async("string");
  shared = shared.split("{{FECHA_ACTUALIZACION}}").join(fechaEnPalabras(hoyISO()));
  zip.file("xl/sharedStrings.xml", shared);

  const salida = await zip.generateAsync({type:"blob"});
  const url = URL.createObjectURL(salida);
  const link = document.createElement("a");
  link.href = url; link.download = `Listado_Activos_${hoyISO()}.xlsx`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ---------- Iconos SVG por tipo de activo ----------
// Reemplazados por los SVG reales de Bootstrap Icons (twbs/icons, MIT
// license) a pedido explícito — bajados directo del repo de GitHub, sin
// modificar los `path`. Todos usan fill="currentColor" (relleno, no trazo)
// y viewBox nativo 16x16 — quedan consistentes ENTRE ELLOS, aunque distinto
// del estilo de línea fina que tenía este set antes.
// "plotter" es la única excepción: Bootstrap Icons no tiene un ícono de
// plotter/impresora de gran formato, así que se dejó el diseño original.
const ICONOS_TIPO = {
  laptop: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M13.5 3a.5.5 0 0 1 .5.5V11H2V3.5a.5.5 0 0 1 .5-.5zm-11-1A1.5 1.5 0 0 0 1 3.5V12h14V3.5A1.5 1.5 0 0 0 13.5 2zM0 12.5h16a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 0 12.5"/></svg>`,
  // Desktop: bi-pc-display (torre + pantalla, el ícono canónico de "PC de escritorio" en Bootstrap Icons).
  desktop: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1zm1 13.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0m2 0a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0M9.5 1a.5.5 0 0 0 0 1h5a.5.5 0 0 0 0-1zM9 3.5a.5.5 0 0 0 .5.5h5a.5.5 0 0 0 0-1h-5a.5.5 0 0 0-.5.5M1.5 2A1.5 1.5 0 0 0 0 3.5v7A1.5 1.5 0 0 0 1.5 12H6v2h-.5a.5.5 0 0 0 0 1H7v-4H1.5a.5.5 0 0 1-.5-.5v-7a.5.5 0 0 1 .5-.5H7V2z"/></svg>`,
  celular: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M11 1a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM5 0a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z"/><path d="M8 14a1 1 0 1 0 0-2 1 1 0 0 0 0 2"/></svg>`,
  impresora: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2.5 8a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1"/><path d="M5 1a2 2 0 0 0-2 2v2H2a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1V3a2 2 0 0 0-2-2zM4 3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2H4zm1 5a2 2 0 0 0-2 2v1H2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v-1a2 2 0 0 0-2-2zm7 2v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1"/></svg>`,
  // Scanner: bi-upc-scan — Bootstrap Icons no tiene un escáner plano/documental, este es el más cercano (escáner de código de barras).
  scanner: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M1.5 1a.5.5 0 0 0-.5.5v3a.5.5 0 0 1-1 0v-3A1.5 1.5 0 0 1 1.5 0h3a.5.5 0 0 1 0 1zM11 .5a.5.5 0 0 1 .5-.5h3A1.5 1.5 0 0 1 16 1.5v3a.5.5 0 0 1-1 0v-3a.5.5 0 0 0-.5-.5h-3a.5.5 0 0 1-.5-.5M.5 11a.5.5 0 0 1 .5.5v3a.5.5 0 0 0 .5.5h3a.5.5 0 0 1 0 1h-3A1.5 1.5 0 0 1 0 14.5v-3a.5.5 0 0 1 .5-.5m15 0a.5.5 0 0 1 .5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a.5.5 0 0 1 0-1h3a.5.5 0 0 0 .5-.5v-3a.5.5 0 0 1 .5-.5M3 4.5a.5.5 0 0 1 1 0v7a.5.5 0 0 1-1 0zm2 0a.5.5 0 0 1 1 0v7a.5.5 0 0 1-1 0zm2 0a.5.5 0 0 1 1 0v7a.5.5 0 0 1-1 0zm2 0a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5h-1a.5.5 0 0 1-.5-.5zm3 0a.5.5 0 0 1 1 0v7a.5.5 0 0 1-1 0z"/></svg>`,
  // Plotter: sin equivalente en Bootstrap Icons — se conserva el diseño original (bandeja + trazo en zigzag + punta del lápiz).
  plotter: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="14.5" width="18" height="5.5" rx="1"/><path d="M6 14.5l2.6-8.5h2.4l1.8 4.6 1.8-2.6h2.2"/><circle cx="17.8" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  smarttv: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2.5 13.5A.5.5 0 0 1 3 13h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5M13.991 3l.024.001a1.5 1.5 0 0 1 .538.143.76.76 0 0 1 .302.254c.067.1.145.277.145.602v5.991l-.001.024a1.5 1.5 0 0 1-.143.538.76.76 0 0 1-.254.302c-.1.067-.277.145-.602.145H2.009l-.024-.001a1.5 1.5 0 0 1-.538-.143.76.76 0 0 1-.302-.254C1.078 10.502 1 10.325 1 10V4.009l.001-.024a1.5 1.5 0 0 1 .143-.538.76.76 0 0 1 .254-.302C1.498 3.078 1.675 3 2 3zM14 2H2C0 2 0 4 0 4v6c0 2 2 2 2 2h12c2 0 2-2 2-2V4c0-2-2-2-2-2"/></svg>`,
  monitor: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 4s0-2 2-2h12s2 0 2 2v6s0 2-2 2h-4q0 1 .25 1.5H11a.5.5 0 0 1 0 1H5a.5.5 0 0 1 0-1h.75Q6 13 6 12H2s-2 0-2-2zm1.398-.855a.76.76 0 0 0-.254.302A1.5 1.5 0 0 0 1 4.01V10c0 .325.078.502.145.602q.105.156.302.254a1.5 1.5 0 0 0 .538.143L2.01 11H14c.325 0 .502-.078.602-.145a.76.76 0 0 0 .254-.302 1.5 1.5 0 0 0 .143-.538L15 9.99V4c0-.325-.078-.502-.145-.602a.76.76 0 0 0-.302-.254A1.5 1.5 0 0 0 13.99 3H2c-.325 0-.502.078-.602.145"/></svg>`,
  mouse: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 3a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0v-2A.5.5 0 0 1 8 3m4 8a4 4 0 0 1-8 0V5a4 4 0 1 1 8 0zM8 0a5 5 0 0 0-5 5v6a5 5 0 0 0 10 0V5a5 5 0 0 0-5-5"/></svg>`,
  // Fuente de alimentación: bi-plug — reemplaza el rectángulo con clavijas dibujado a mano.
  fuentedealimentacion: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6 0a.5.5 0 0 1 .5.5V3h3V.5a.5.5 0 0 1 1 0V3h1a.5.5 0 0 1 .5.5v3A3.5 3.5 0 0 1 8.5 10c-.002.434-.01.845-.04 1.22-.041.514-.126 1.003-.317 1.424a2.08 2.08 0 0 1-.97 1.028C6.725 13.9 6.169 14 5.5 14c-.998 0-1.61.33-1.974.718A1.92 1.92 0 0 0 3 16H2c0-.616.232-1.367.797-1.968C3.374 13.42 4.261 13 5.5 13c.581 0 .962-.088 1.218-.219.241-.123.4-.3.514-.55.121-.266.193-.621.23-1.09.027-.34.035-.718.037-1.141A3.5 3.5 0 0 1 4 6.5v-3a.5.5 0 0 1 .5-.5h1V.5A.5.5 0 0 1 6 0M5 4v2.5A2.5 2.5 0 0 0 7.5 9h1A2.5 2.5 0 0 0 11 6.5V4z"/></svg>`,
  teclado: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M14 5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM2 4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M13 10.25a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm0-2a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm-5 0A.25.25 0 0 1 8.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 8 8.75zm2 0a.25.25 0 0 1 .25-.25h1.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-1.5a.25.25 0 0 1-.25-.25zm1 2a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm-5-2A.25.25 0 0 1 6.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 6 8.75zm-2 0A.25.25 0 0 1 4.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 4 8.75zm-2 0A.25.25 0 0 1 2.25 8h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 2 8.75zm11-2a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm-2 0a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm-2 0A.25.25 0 0 1 9.25 6h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 9 6.75zm-2 0A.25.25 0 0 1 7.25 6h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 7 6.75zm-2 0A.25.25 0 0 1 5.25 6h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5A.25.25 0 0 1 5 6.75zm-3 0A.25.25 0 0 1 2.25 6h1.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-1.5A.25.25 0 0 1 2 6.75zm0 4a.25.25 0 0 1 .25-.25h.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-.5a.25.25 0 0 1-.25-.25zm2 0a.25.25 0 0 1 .25-.25h5.5a.25.25 0 0 1 .25.25v.5a.25.25 0 0 1-.25.25h-5.5a.25.25 0 0 1-.25-.25z"/></svg>`,
  ap: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M15.384 6.115a.485.485 0 0 0-.047-.736A12.44 12.44 0 0 0 8 3C5.259 3 2.723 3.882.663 5.379a.485.485 0 0 0-.048.736.52.52 0 0 0 .668.05A11.45 11.45 0 0 1 8 4c2.507 0 4.827.802 6.716 2.164.205.148.49.13.668-.049"/><path d="M13.229 8.271a.482.482 0 0 0-.063-.745A9.46 9.46 0 0 0 8 6c-1.905 0-3.68.56-5.166 1.526a.48.48 0 0 0-.063.745.525.525 0 0 0 .652.065A8.46 8.46 0 0 1 8 7a8.46 8.46 0 0 1 4.576 1.336c.206.132.48.108.653-.065m-2.183 2.183c.226-.226.185-.605-.1-.75A6.5 6.5 0 0 0 8 9c-1.06 0-2.062.254-2.946.704-.285.145-.326.524-.1.75l.015.015c.16.16.407.19.611.09A5.5 5.5 0 0 1 8 10c.868 0 1.69.201 2.42.56.203.1.45.07.61-.091zM9.06 12.44c.196-.196.198-.52-.04-.66A2 2 0 0 0 8 11.5a2 2 0 0 0-1.02.28c-.238.14-.236.464-.04.66l.706.706a.5.5 0 0 0 .707 0l.707-.707z"/></svg>`,
  // Cable HDMI: bi-hdmi — reemplaza toda la exploración anterior (culebra/bolita, punta de 3 piezas, etc.) por el conector real de Bootstrap Icons.
  cablehdmi: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2.5 7a.5.5 0 0 0 0 1h11a.5.5 0 0 0 0-1z"/><path d="M1 5a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h.293l.707.707a1 1 0 0 0 .707.293h10.586a1 1 0 0 0 .707-.293l.707-.707H15a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1zm0 1h14v3h-.293a1 1 0 0 0-.707.293l-.707.707H2.707L2 9.293A1 1 0 0 0 1.293 9H1z"/></svg>`,
  // Biométrico: huella dactilar de Bootstrap Icons (bi-fingerprint), a pedido explícito.
  biometrico: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8.06 6.5a.5.5 0 0 1 .5.5v.776a11.5 11.5 0 0 1-.552 3.519l-1.331 4.14a.5.5 0 0 1-.952-.305l1.33-4.141a10.5 10.5 0 0 0 .504-3.213V7a.5.5 0 0 1 .5-.5Z"/><path d="M6.06 7a2 2 0 1 1 4 0 .5.5 0 1 1-1 0 1 1 0 1 0-2 0v.332q0 .613-.066 1.221A.5.5 0 0 1 6 8.447q.06-.555.06-1.115zm3.509 1a.5.5 0 0 1 .487.513 11.5 11.5 0 0 1-.587 3.339l-1.266 3.8a.5.5 0 0 1-.949-.317l1.267-3.8a10.5 10.5 0 0 0 .535-3.048A.5.5 0 0 1 9.569 8m-3.356 2.115a.5.5 0 0 1 .33.626L5.24 14.939a.5.5 0 1 1-.955-.296l1.303-4.199a.5.5 0 0 1 .625-.329"/><path d="M4.759 5.833A3.501 3.501 0 0 1 11.559 7a.5.5 0 0 1-1 0 2.5 2.5 0 0 0-4.857-.833.5.5 0 1 1-.943-.334m.3 1.67a.5.5 0 0 1 .449.546 10.7 10.7 0 0 1-.4 2.031l-1.222 4.072a.5.5 0 1 1-.958-.287L4.15 9.793a9.7 9.7 0 0 0 .363-1.842.5.5 0 0 1 .546-.449Zm6 .647a.5.5 0 0 1 .5.5c0 1.28-.213 2.552-.632 3.762l-1.09 3.145a.5.5 0 0 1-.944-.327l1.089-3.145c.382-1.105.578-2.266.578-3.435a.5.5 0 0 1 .5-.5Z"/><path d="M3.902 4.222a5 5 0 0 1 5.202-2.113.5.5 0 0 1-.208.979 4 4 0 0 0-4.163 1.69.5.5 0 0 1-.831-.556m6.72-.955a.5.5 0 0 1 .705-.052A4.99 4.99 0 0 1 13.059 7v1.5a.5.5 0 1 1-1 0V7a3.99 3.99 0 0 0-1.386-3.028.5.5 0 0 1-.051-.705M3.68 5.842a.5.5 0 0 1 .422.568q-.044.289-.044.59c0 .71-.1 1.417-.298 2.1l-1.14 3.923a.5.5 0 1 1-.96-.279L2.8 8.821A6.5 6.5 0 0 0 3.058 7q0-.375.054-.736a.5.5 0 0 1 .568-.422m8.882 3.66a.5.5 0 0 1 .456.54c-.084 1-.298 1.986-.64 2.934l-.744 2.068a.5.5 0 0 1-.941-.338l.745-2.07a10.5 10.5 0 0 0 .584-2.678.5.5 0 0 1 .54-.456"/><path d="M4.81 1.37A6.5 6.5 0 0 1 14.56 7a.5.5 0 1 1-1 0 5.5 5.5 0 0 0-8.25-4.765.5.5 0 0 1-.5-.865m-.89 1.257a.5.5 0 0 1 .04.706A5.48 5.48 0 0 0 2.56 7a.5.5 0 0 1-1 0c0-1.664.626-3.184 1.655-4.333a.5.5 0 0 1 .706-.04ZM1.915 8.02a.5.5 0 0 1 .346.616l-.779 2.767a.5.5 0 1 1-.962-.27l.778-2.767a.5.5 0 0 1 .617-.346m12.15.481a.5.5 0 0 1 .49.51c-.03 1.499-.161 3.025-.727 4.533l-.07.187a.5.5 0 0 1-.936-.351l.07-.187c.506-1.35.634-2.74.663-4.202a.5.5 0 0 1 .51-.49"/></svg>`,
  // Cable USB: bi-usb-plug.
  cableusb: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6 .5a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v4H6zM7 1v1h1V1zm2 0v1h1V1zM6 5a1 1 0 0 0-1 1v4.394c0 .494.146.976.42 1.387l1.038 1.558c.354.53.542 1.152.542 1.789 0 .481.39.872.872.872h1.256c.481 0 .872-.39.872-.872 0-.637.188-1.26.541-1.789l1.04-1.558A2.5 2.5 0 0 0 12 10.394V6a1 1 0 0 0-1-1zm0 1h5v4.394a1.5 1.5 0 0 1-.252.832L9.71 12.784A4.2 4.2 0 0 0 9.002 15H7.998a4.2 4.2 0 0 0-.707-2.216l-1.04-1.558A1.5 1.5 0 0 1 6 10.394z"/></svg>`,
  // Router: bi-router — reemplaza la caja+antenas dibujada a mano.
  router: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M5.525 3.025a3.5 3.5 0 0 1 4.95 0 .5.5 0 1 0 .707-.707 4.5 4.5 0 0 0-6.364 0 .5.5 0 0 0 .707.707"/><path d="M6.94 4.44a1.5 1.5 0 0 1 2.12 0 .5.5 0 0 0 .708-.708 2.5 2.5 0 0 0-3.536 0 .5.5 0 0 0 .707.707ZM2.5 11a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1m4.5-.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0m2.5.5a.5.5 0 1 1 0-1 .5.5 0 0 1 0 1m1.5-.5a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0m2 0a.5.5 0 1 0 1 0 .5.5 0 0 0-1 0"/><path d="M2.974 2.342a.5.5 0 1 0-.948.316L3.806 8H1.5A1.5 1.5 0 0 0 0 9.5v2A1.5 1.5 0 0 0 1.5 13H2a.5.5 0 0 0 .5.5h2A.5.5 0 0 0 5 13h6a.5.5 0 0 0 .5.5h2a.5.5 0 0 0 .5-.5h.5a1.5 1.5 0 0 0 1.5-1.5v-2A1.5 1.5 0 0 0 14.5 8h-2.306l1.78-5.342a.5.5 0 1 0-.948-.316L11.14 8H4.86zM14.5 9a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-2a.5.5 0 0 1 .5-.5z"/><path d="M8.5 5.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0"/></svg>`,
  // Switch de red: bi-hdd-network — Bootstrap Icons no tiene un ícono
  // dedicado a "switch"; este es el más cercano semánticamente (hardware de
  // red genérico), bajado sin modificar de icons.getbootstrap.com.
  switch: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.5 5a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1M3 4.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0"/><path d="M0 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2H8.5v3a1.5 1.5 0 0 1 1.5 1.5h5.5a.5.5 0 0 1 0 1H10A1.5 1.5 0 0 1 8.5 14h-1A1.5 1.5 0 0 1 6 12.5H.5a.5.5 0 0 1 0-1H6A1.5 1.5 0 0 1 7.5 10V7H2a2 2 0 0 1-2-2zm1 0v1a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1m6 7.5v1a.5.5 0 0 0 .5.5h1a.5.5 0 0 0 .5-.5v-1a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5"/></svg>`,
  // UPS (batería de respaldo): bi-battery-charging, sin modificar.
  ups: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M9.585 2.568a.5.5 0 0 1 .226.58L8.677 6.832h1.99a.5.5 0 0 1 .364.843l-5.334 5.667a.5.5 0 0 1-.842-.49L5.99 9.167H4a.5.5 0 0 1-.364-.843l5.333-5.667a.5.5 0 0 1 .616-.09z"/><path d="M2 4h4.332l-.94 1H2a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.38l-.308 1H2a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2"/><path d="M2 6h2.45L2.908 7.639A1.5 1.5 0 0 0 3.313 10H2zm8.595-2-.308 1H12a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H9.276l-.942 1H12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><path d="M12 10h-1.783l1.542-1.639q.146-.156.241-.34zm0-3.354V6h-.646a1.5 1.5 0 0 1 .646.646M16 8a1.5 1.5 0 0 1-1.5 1.5v-3A1.5 1.5 0 0 1 16 8"/></svg>`,
  generico: `<svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5zM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24zM7.5 14.762V6.838L1 4.239v7.923zM7.443.184a1.5 1.5 0 0 1 1.114 0l7.129 2.852A.5.5 0 0 1 16 3.5v8.662a1 1 0 0 1-.629.928l-7.185 2.874a.5.5 0 0 1-.372 0L.63 13.09a1 1 0 0 1-.63-.928V3.5a.5.5 0 0 1 .314-.464z"/></svg>`,
};
// Un color propio por tipo, para que se distingan de un vistazo en la columna.
// Los tres tipos más comunes usan colores reales de la marca Lukmar.
const COLOR_TIPO = {
  laptop: "#57697C", desktop: "#004DAB", celular: "#007EB2", impresora: "#EC741D",
  scanner: "#74883D", plotter: "#5B4B8A", smarttv: "#2E93C7",
  monitor: "#1F6FA8", mouse: "#8A6D3B", fuentedealimentacion: "#B0651C", ap: "#2E7D5B", teclado: "#6B7C93",
  cablehdmi: "#B23A6B",
  biometrico: "#1F8C7A", cableusb: "#4A5A9E", router: "#A67C27",
  switch: "#3E5C6B", ups: "#D4A017",
  generico: "#8B9AAA",
};
function claveTipo(tipo){
  return (tipo||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"");
}
// Qué campos NO son relevantes para cada tipo — la ficha de detalle
// (abrirDetalle) usa esto para no mostrar "MAC WiFi: —" en un mouse, y la
// tabla (celdaActivo, vía columnaAplicaATipo) para mostrar "n/a" en vez del
// valor. Es la misma lista para ambas vistas a propósito: si un campo no
// aplica en el detalle, tampoco debería fingir que aplica en la tabla.
// Solo cubre tipos NUEVOS sin datos históricos en riesgo — los tipos ya
// existentes (laptop/desktop/impresora/etc.) siguen mostrando todo, porque
// hay activos reales con datos en esos campos (ej. MAC en impresoras).
const CAMPOS_NO_RELEVANTES_DETALLE = {
  mouse:               ["so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"],
  teclado:             ["so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"],
  monitor:             ["so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"],
  fuentedealimentacion:["so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"],
  ap:                  ["so","procesador","ram_gb","disco_gb"], // sí conserva las MAC — un AP real las usa
  router:              ["so","procesador","ram_gb","disco_gb"], // mismo criterio que AP — MAC sí, cómputo no
  cablehdmi:           ["serie","so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"],
  cableusb:            ["serie","so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"],
  biometrico:          ["so","procesador","ram_gb","disco_gb"], // sí conserva las MAC, igual que AP — se conecta a red para sincronizar asistencia
  switch:              ["so","procesador","ram_gb","disco_gb","mac_wifi"], // mismo criterio que AP/router, pero sin wifi — un switch no tiene radio
  ups:                 ["so","procesador","ram_gb","disco_gb","mac_wifi","mac_ethernet"], // mismo criterio que fuentedealimentacion — solo batería, sin cómputo ni red
};
function camposNoRelevantesParaDetalle(tipo){
  return CAMPOS_NO_RELEVANTES_DETALLE[claveTipo(tipo)] || [];
}
// Lo opuesto de lo anterior: campos que NO son genéricos (no existen para
// casi ningún tipo) y que solo se muestran — en el detalle, y como columna
// de tabla — para los tipos que sí los usan (vía columnaAplicaATipo). Se
// parte de "nada visible" en vez de "todo visible, se oculta lo que no
// aplica", porque son campos de nicho (cables), no la mayoría de los tipos.
const CAMPOS_EXTRA_TIPO = {
  cablehdmi: ["color","longitud_m"],
  cableusb: ["color","longitud_m"],
};
function camposExtraParaTipo(tipo){
  return CAMPOS_EXTRA_TIPO[claveTipo(tipo)] || [];
}
// Qué campo de CAMPOS_NO_RELEVANTES_DETALLE / CAMPOS_EXTRA_TIPO corresponde a
// cada columna de la TABLA — los nombres no siempre coinciden 1:1 (ram_gb en
// la base de datos, "ram" como key de columna). Configurable acá, no
// estructural en la base de datos: agregar/sacar un tipo de estas listas ya
// alcanza para que la tabla (y el detalle, que usa las mismas listas) lo
// reflejen — no hace falta ninguna columna nueva en Supabase para esto.
const CAMPO_BLOQUEADO_POR_COLUMNA = {
  serie:"serie", so:"so", ram:"ram_gb", disco:"disco_gb",
  procesador:"procesador", macwifi:"mac_wifi", maceth:"mac_ethernet",
};
const CAMPO_EXTRA_POR_COLUMNA = { color:"color", longitud:"longitud_m" };
function columnaAplicaATipo(colKey, tipo){
  const bloqueado = CAMPO_BLOQUEADO_POR_COLUMNA[colKey];
  if(bloqueado) return !camposNoRelevantesParaDetalle(tipo).includes(bloqueado);
  const extra = CAMPO_EXTRA_POR_COLUMNA[colKey];
  if(extra) return camposExtraParaTipo(tipo).includes(extra);
  return true; // columnas que no dependen del tipo de activo (tag, marca, valor de compra, etc.)
}
function iconoTipo(tipo){
  const key = claveTipo(tipo);
  return ICONOS_TIPO[key] || ICONOS_TIPO.generico;
}
// Mismo ícono que en la tabla, pero a cualquier tamaño (se usa grande en el
// resumen del detalle). Los paths del SVG son iguales; solo cambia el
// viewport de dibujo.
function iconoTipoTam(tipo, tam){
  return iconoTipo(tipo).replace(/width="16" height="16"/, `width="${tam}" height="${tam}"`);
}
function colorTipo(tipo){
  const key = claveTipo(tipo);
  return COLOR_TIPO[key] || COLOR_TIPO.generico;
}

// ---------- Iconos de las tarjetas KPI ----------
const ICONO_KPI_TOTAL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="7.5" height="7.5" rx="1.2"/><rect x="13" y="4" width="7.5" height="7.5" rx="1.2"/><rect x="3.5" y="13.5" width="7.5" height="7.5" rx="1.2"/><rect x="13" y="13.5" width="7.5" height="7.5" rx="1.2"/></svg>`;
const ICONO_KPI_DISPONIBLE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.3 12.3l2.4 2.4 5-5.4"/></svg>`;
const ICONO_KPI_PERSONA = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M4.8 19.5c1-3.3 4-5 7.2-5s6.2 1.7 7.2 5"/></svg>`;
const ICONO_KPI_AREA = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10.5L12 4l8 6.5V20"/><path d="M9.5 20v-6h5v6"/></svg>`;

function pillCustodio(a){
  if(a.custodio===null) return `<span class="pill pill-cell pill-good"><span class="pill-dot"></span>Disponible</span>`;
  if(a.custodio.tipo_custodio==="mantenimiento") return `<span class="pill pill-cell pill-mantenimiento"><span class="pill-dot"></span><span class="cell-clip">${esc(a.custodio.nombre)}</span></span>`;
  if(a.custodio.tipo_custodio==="area") return `<span class="pill pill-cell pill-area"><span class="pill-dot"></span><span class="cell-clip">${esc(a.custodio.nombre)}</span></span>`;
  return `<span class="pill pill-cell pill-persona"><span class="pill-dot"></span><span class="cell-clip">${esc(a.custodio.nombre)}</span></span>`;
}
function colorCustodioActual(a){
  if(a.custodio===null) return "#3E7D4F";
  if(a.custodio.tipo_custodio==="mantenimiento") return "#A6710B";
  if(a.custodio.tipo_custodio==="area") return "#5B4B8A";
  return "#004DAB";
}
function gradienteCustodioActual(a){
  const c = colorCustodioActual(a);
  return `linear-gradient(135deg, ${c}1F 0%, ${c}08 100%)`;
}
// Bloque de "quién lo tiene": nombre grande + cargo (o el equivalente que
// aplique) debajo, sin badge de pill — el color ya lo lleva toda la tarjeta
// (ver gradienteCustodioActual), así no se confunde con el pill que sigue
// usando esta misma información en la tabla.
function bloquePerfilCustodio(a){
  if(a.custodio===null){
    return `<div class="detail-profile-info">
      <div class="detail-profile-name">Disponible</div>
      <div class="detail-profile-cargo">Sin custodio asignado</div>
    </div>`;
  }
  const esArea = a.custodio.tipo_custodio==="area";
  const esMantenimiento = a.custodio.tipo_custodio==="mantenimiento";
  const linea2 = a.custodio.cargo
    ? esc(a.custodio.cargo)
    : (esMantenimiento ? "En mantenimiento" : (esArea ? "Área / departamento sin especificar" : "Sin cargo registrado"));
  return `<div class="detail-profile-info">
    <div class="detail-profile-name">${esc(a.custodio.nombre)}</div>
    <div class="detail-profile-cargo">${linea2}</div>
  </div>`;
}
// Tarjeta con badge de color para el resumen del detalle de un activo.
function tarjetaBadge(label, valorHtml, color){
  return `<div class="detail-badge-card" style="border-left-color:${color};background:linear-gradient(135deg, ${color}17 0%, var(--surface-2) 75%);">
    <span class="detail-badge" style="background:${color}22;color:${color};">${esc(label)}</span>
    <div class="detail-badge-value">${valorHtml}</div>
  </div>`;
}
function celdaTextoRecortado(valor, claseExtra){
  if(!valor) return '<span class="cell-muted">—</span>';
  const v = esc(valor);
  return `<span class="cell-clip ${claseExtra||''}" title="${v}">${v}</span>`;
}
function celdaMoneda(valor){
  return (valor===null||valor===undefined) ? '<span class="cell-muted">—</span>' : '$'+Number(valor).toFixed(2);
}
function celdaNumeroUnidad(valor, unidad){
  return (valor===null||valor===undefined||valor==="") ? '<span class="cell-muted">—</span>' : `${valor} ${unidad}`;
}
function celdaActivo(col, a){
  if(!columnaAplicaATipo(col.key, a.tipo)) return '<span class="cell-na" title="No aplica para este tipo de activo">n/a</span>';
  switch(col.key){
    case "tag": return `<span class="tag">${fmtTag(a)}</span>`;
    case "empresa": return pillEmpresa(a.empresa);
    case "tipo": return `<span class="tipo-cell"><span class="tipo-icon" style="color:${colorTipo(a.tipo)}">${iconoTipo(a.tipo)}</span><span class="cell-clip">${esc(a.tipo)||'<span class="cell-muted">—</span>'}</span></span>`;
    case "marca": return celdaTextoRecortado(a.marca);
    case "modelo": return celdaTextoRecortado(a.modelo);
    case "nombre": return celdaTextoRecortado(a.nombre_dispositivo);
    case "estado": return pillEstado(a.estado);
    case "custodio": return pillCustodio(a);
    case "cargo": return celdaTextoRecortado(a.custodio ? a.custodio.cargo : null);
    case "propiedad": return pillPropiedad(a.propiedad);
    case "serie": return celdaTextoRecortado(a.serie, "mono");
    case "so": return celdaTextoRecortado(a.sistema_operativo);
    case "ram": return celdaNumeroUnidad(a.ram_gb, "GB");
    case "disco": return celdaNumeroUnidad(a.disco_gb, "GB");
    case "procesador": return celdaTextoRecortado(a.procesador);
    case "macwifi": return celdaTextoRecortado(a.mac_wifi, "mono");
    case "maceth": return celdaTextoRecortado(a.mac_ethernet, "mono");
    case "fecha": return a.fecha_adquisicion ? fmtFecha(a.fecha_adquisicion) : '<span class="cell-muted">—</span>';
    case "proveedor": return celdaTextoRecortado(a.proveedor);
    case "valorcompra": return celdaMoneda(a.valor_compra);
    case "valoractual": return fmtValorActualConPorcentaje(a) || '<span class="cell-muted">—</span>';
    case "vidautil": return celdaNumeroUnidad(a.vida_util_anios, a.vida_util_anios===1?"año":"años");
    case "color": return celdaTextoRecortado(a.color);
    case "longitud": return celdaNumeroUnidad(a.longitud_m, "m");
    case "acciones": return `<div class="cell-actions">
      ${a.custodio ? `<button class="btn btn-sm ${estaEnPortapapeles(a.id)?'btn-primary':''}" data-action="marcar" data-id="${a.id}" title="Marcar para acta de entrega unificada">${estaEnPortapapeles(a.id)?'🔖 Marcado':'🔖'}</button>` : ""}
      ${puede("cambiar_custodio") ? `<button class="btn btn-sm" data-action="custodio" data-id="${a.id}">Custodio</button>`:""}
      ${puede("dar_baja") ? `<button class="btn btn-sm btn-danger" data-action="baja" data-id="${a.id}">Baja</button>`:""}
    </div>`;
    default: return "";
  }
}
function filaActivo(a){
  const celdas = columnasVisiblesOrdenadas().map(c=>{
    const stop = c.key==="acciones" ? " data-stop" : "";
    return `<td class="col-${c.key}"${stop}>${celdaActivo(c, a)}</td>`;
  }).join("");
  return `<tr class="rowclick" data-id="${a.id}">${celdas}</tr>`;
}


/* ============================================================
   10. DETALLE DE ACTIVO + HISTORIAL
   ============================================================ */
function abrirDetalle(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const camposNoRelevantes = camposNoRelevantesParaDetalle(a.tipo);
  const html = `
    <div class="modal modal-wide">
      <div class="modal-header">
        <h3><span class="tag tag-lg">${fmtTag(a)}</span></h3>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-head-v2">
          <div class="detail-profile-card" style="background:${gradienteCustodioActual(a)};border-color:${colorCustodioActual(a)}40;">
            <div class="detail-icon-big" style="color:${colorTipo(a.tipo)}">${(a.fotos&&a.fotos.length>0) ? `<img src="${urlFoto(a.fotos[0])}" alt="Foto del activo" data-abrir-carrusel="0">` : iconoTipoTam(a.tipo, 40)}</div>
            ${bloquePerfilCustodio(a)}
          </div>
          <div class="detail-badges-grid">
            ${tarjetaBadge("Modelo", esc(a.modelo)||'—', "#004DAB")}
            ${tarjetaBadge("Nombre", esc(a.nombre_dispositivo)||'—', "#007EB2")}
            ${tarjetaBadge("Propiedad", `<span style="color:${(COLOR_PROPIEDAD[a.propiedad]||{fg:'#57697C'}).fg}">${esc(capitalizar(a.propiedad))}</span>`, (COLOR_PROPIEDAD[a.propiedad]||{fg:"#57697C"}).fg)}
            ${tarjetaBadge("Empresa", `<span style="color:${(COLOR_EMPRESA[a.empresa]||COLOR_EMPRESA.lukmar).fg}">${a.empresa==='eq'?'EQ Soluciones':'Lukmar'}</span>`, (COLOR_EMPRESA[a.empresa]||COLOR_EMPRESA.lukmar).fg)}
            ${tarjetaBadge("Tipo", esc(a.tipo)||'—', colorTipo(a.tipo))}
            ${tarjetaBadge("Estado", `<span style="color:${infoEstado(a.estado).fg}">${esc(infoEstado(a.estado).label)}</span>`, infoEstado(a.estado).fg)}
          </div>
        </div>

        <div class="kv-grid">
          <div class="kv"><div class="k">Marca</div><div class="v">${esc(a.marca)||'—'}</div></div>
          ${!camposNoRelevantes.includes("serie") ? `<div class="kv"><div class="k">Serie</div><div class="v mono">${esc(a.serie)||'—'}</div></div>` : ""}
          ${!camposNoRelevantes.includes("so") ? `<div class="kv"><div class="k">Sistema operativo</div><div class="v">${esc(a.sistema_operativo)||'—'}</div></div>` : ""}
          ${!camposNoRelevantes.includes("ram_gb") ? `<div class="kv"><div class="k">RAM</div><div class="v">${a.ram_gb?a.ram_gb+' GB':'—'}</div></div>` : ""}
          ${!camposNoRelevantes.includes("disco_gb") ? `<div class="kv"><div class="k">Almacenamiento</div><div class="v">${a.disco_gb?a.disco_gb+' GB':'—'}</div></div>` : ""}
          ${!camposNoRelevantes.includes("procesador") ? `<div class="kv"><div class="k">Procesador</div><div class="v">${esc(a.procesador)||'—'}</div></div>` : ""}
          <div class="kv"><div class="k">Proveedor</div><div class="v">${esc(a.proveedor)||'—'}</div></div>
          <div class="kv"><div class="k">Valor de compra</div><div class="v">${a.valor_compra?'$'+Number(a.valor_compra).toFixed(2):'—'}</div></div>
          <div class="kv"><div class="k">Valor actual</div><div class="v">${fmtValorActualConPorcentaje(a) || '—'}</div></div>
          ${camposExtraParaTipo(a.tipo).includes("color") ? `<div class="kv"><div class="k">Color</div><div class="v">${esc(a.color)||'—'}</div></div>` : ""}
          ${camposExtraParaTipo(a.tipo).includes("longitud_m") ? `<div class="kv"><div class="k">Longitud</div><div class="v">${a.longitud_m?a.longitud_m+' m':'—'}</div></div>` : ""}
          ${!camposNoRelevantes.includes("mac_wifi") ? `<div class="kv"><div class="k">MAC WiFi</div><div class="v mono">${esc(a.mac_wifi)||'—'}</div></div>` : ""}
          ${!camposNoRelevantes.includes("mac_ethernet") ? `<div class="kv"><div class="k">MAC Ethernet</div><div class="v mono">${esc(a.mac_ethernet)||'—'}</div></div>` : ""}
          <div class="kv"><div class="k">Fecha de adquisición</div><div class="v">${fmtFecha(a.fecha_adquisicion)}</div></div>
          ${a.celular ? `<div class="kv"><div class="k">Gmail asociado</div><div class="v mono">${esc(a.celular.gmail)||'—'}</div></div>` : ""}
        </div>

        ${(a.fotos&&a.fotos.length>0) ? `
        <div class="section-title">Fotos</div>
        <div class="fotos-grid">
          ${a.fotos.map((ruta,i)=>`<div class="foto-thumb"><img src="${urlFoto(ruta)}" alt="Foto del activo" data-abrir-carrusel="${i}"></div>`).join("")}
        </div>` : ""}

        <div class="section-title">Historial de custodia (más reciente primero)</div>
        <div class="timeline">
          ${renderTimelineHistorial(a) || '<div class="cell-muted">Sin historial registrado.</div>'}
        </div>
      </div>
      <div class="modal-footer">
        ${puede("editar_activo") ? `<button class="btn" id="btn-editar-activo">Editar datos base</button>` : ""}
        ${puede("cambiar_custodio") ? `<button class="btn btn-primary" id="btn-cambiar-custodio">Cambiar custodio</button>` : ""}
        ${a.custodio ? `<button class="btn ${estaEnPortapapeles(a.id)?'btn-primary':''}" id="btn-marcar-portapapeles">${estaEnPortapapeles(a.id)?'🔖 Marcado para acta':'🔖 Marcar para acta'}</button>` : ""}
        ${puede("dar_baja") ? `<button class="btn btn-danger" id="btn-dar-baja">Dar de baja</button>` : ""}
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.querySelectorAll("[data-abrir-carrusel]").forEach(img=>{
      img.addEventListener("click", ()=>abrirCarruselFotos(a.fotos.map(urlFoto), Number(img.dataset.abrirCarrusel), ()=>abrirDetalle(a.id)));
    });
    const be = document.getElementById("btn-editar-activo");
    if(be) be.addEventListener("click", ()=>abrirFormActivo(a.id));
    const bc = document.getElementById("btn-cambiar-custodio");
    if(bc) bc.addEventListener("click", ()=>abrirCambiarCustodio(a.id));
    const bm = document.getElementById("btn-marcar-portapapeles");
    if(bm) bm.addEventListener("click", ()=>{ toggleEnPortapapeles(a.id); actualizarTablaYResumen(); abrirDetalle(a.id); });
    const bb = document.getElementById("btn-dar-baja");
    if(bb) bb.addEventListener("click", ()=>abrirConfirmarBaja(a.id));
    document.querySelectorAll("[data-editar-tramo]").forEach(b=>{
      b.addEventListener("click", ()=>abrirEditarTramo(a.id, Number(b.dataset.editarTramo)));
    });
    document.querySelectorAll("[data-borrar-tramo]").forEach(b=>{
      b.addEventListener("click", async ()=>{
        if(!confirm("¿Borrar este registro del historial? Esta acción no se puede deshacer.")) return;
        try{ await eliminarTramoHistorial(Number(b.dataset.borrarTramo)); cerrarModal(); abrirDetalle(a.id); }
        catch(err){ alert("No se pudo borrar: " + err.message); }
      });
    });
  });
}

// Cada tramo muestra su propia observación en su propia tarjeta. Antes se
// pintaba como un "conector" usando la observación del tramo siguiente —
// eso significaba que la observación de un tramo era invisible hasta que
// existiera un tramo MÁS NUEVO después de él: quedaba oculta mientras el
// activo estuviera "disponible" sin custodio nuevo todavía, y de entrada
// nunca aparecía en la primerísima entrega de un activo recién creado (que
// no tiene ningún tramo "siguiente" posible). f_cambiar_custodio/
// f_liberar_custodio ya guardan la observación correctamente en todos los
// casos (verificado contra las funciones reales en Supabase) — esto era
// puramente un bug de visualización, no de datos.
function renderTimelineHistorial(a){
  return a.historial_custodia.map((t,i)=>tramoHtml(a,t,i)).join("");
}
function tramoHtml(a, t, i){
  const tipoLbl = t.tipo_custodio==="mantenimiento" ? "Mantenimiento" : (t.tipo_custodio==="area" ? "Área / departamento" : "Persona");
  const vigente = t.hasta===null; // el tramo activo de verdad — NO necesariamente i===0: si el
  // activo está disponible, el tramo más reciente (i===0) ya está cerrado y no es distinto
  // de cualquier otro tramo viejo para efectos de editar/borrar.
  return `<div class="titem ${vigente?'current':''}">
    <div class="titem-row">
      <div>
        <div class="titem-name">${esc(t.nombre)} <span class="pill ${t.tipo_custodio==='mantenimiento'?'pill-mantenimiento':(t.tipo_custodio==='area'?'pill-area':'pill-persona')}" style="margin-left:6px;">${tipoLbl}</span></div>
        <div class="titem-meta">${t.cargo?esc(t.cargo)+' · ':''}${fmtFecha(t.desde)} → ${t.hasta?fmtFecha(t.hasta):'presente'}${t.tipo_entrega?' · Entrega: '+labelTipoEntrega(t.tipo_entrega).split(' (')[0]:''}${t.tipo_devolucion?' · Devolución: '+labelTipoDevolucion(t.tipo_devolucion).split(' (')[0]:''}</div>
      </div>
      <div class="titem-actions">
        ${puede("editar_historial") ? `<button class="btn btn-sm" data-editar-tramo="${i}">Editar</button>` : ""}
        ${!vigente && state.sesion.rol===ROL_ADMIN ? `<button class="btn btn-sm btn-danger" data-borrar-tramo="${t._id}">Borrar</button>` : ""}
      </div>
    </div>
    ${t.observacion_entrega ? `<div class="titem-observacion titem-obs-entrega"><span class="titem-obs-tag">Entrega</span>${esc(t.observacion_entrega)}</div>` : ""}
    ${t.observacion_devolucion ? `<div class="titem-observacion titem-obs-devolucion"><span class="titem-obs-tag">Devolución</span>${esc(t.observacion_devolucion)}</div>` : ""}
  </div>`;
}

/* ---------- Formulario alta / edición de activo ---------- */
function abrirFormActivo(id){
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
      return `<div class="foto-thumb ${marcada?'foto-marcada-borrar':''}">
        <img src="${urlFoto(ruta)}" alt="Foto del activo">
        <button type="button" class="foto-borrar" data-toggle-borrar="${esc(ruta)}" title="${marcada?'Deshacer':'Quitar foto'}">${marcada?'↺':'✕'}</button>
      </div>`;
    }).join("");
    const nuevas = fotosNuevas.map((file,i)=>`<div class="foto-thumb foto-thumb-pendiente">
        <img src="${URL.createObjectURL(file)}" alt="Foto nueva, todavía sin guardar">
        <button type="button" class="foto-borrar" data-quitar-nueva="${i}" title="Quitar">✕</button>
        <span class="foto-pendiente-tag">Nueva</span>
      </div>`).join("");
    return existentes + nuevas + `<label class="foto-agregar"><span>+ Agregar</span><input type="file" accept="image/*" capture="environment" id="input-foto" style="display:none;"></label>`;
  }
  function wireGridFotos(){
    const inputFoto = document.getElementById("input-foto");
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
    const grid = document.getElementById("fotos-grid-form");
    if(!grid) return;
    grid.innerHTML = htmlGridFotos();
    wireGridFotos();
  }

  const html = `
    <div class="modal modal-wide">
      <div class="modal-header"><h3>${esNuevo?'Nuevo activo':'Editar ' + fmtTag(a)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <form id="form-activo">
          <div class="form-grid">
            <div class="field"><label>Tipo</label><input type="text" id="fa-tipo" value="${esc(a?a.tipo:'')}" placeholder="Laptop, Desktop, Celular, Mouse, Monitor, Fuente de alimentación, Cable HDMI, Cable USB, Biométrico, Router, AP, Switch, UPS…"></div>
            <div class="field"><label>Propiedad</label>
              <select id="fa-propiedad" required>
                <option value="propio" ${(!a||a.propiedad==='propio')?'selected':''}>Propio</option>
                <option value="rentado" ${a&&a.propiedad==='rentado'?'selected':''}>Rentado</option>
                <option value="externo" ${a&&a.propiedad==='externo'?'selected':''}>Externo</option>
              </select>
            </div>
            <div class="field"><label>Empresa</label>
              <select id="fa-empresa">
                <option value="lukmar" ${(!a||!a.empresa||a.empresa==='lukmar')?'selected':''}>Lukmar</option>
                <option value="eq" ${a&&a.empresa==='eq'?'selected':''}>EQ Soluciones</option>
              </select>
            </div>
            <div class="field"><label>Marca</label><input type="text" id="fa-marca" value="${esc(a?a.marca:'')}"></div>
            <div class="field"><label>Modelo</label><input type="text" id="fa-modelo" value="${esc(a?a.modelo:'')}"></div>
            <div class="field"><label>Serie</label><input type="text" id="fa-serie" class="mono" value="${esc(a?a.serie:'')}"></div>
            <div class="field"><label>Nombre del dispositivo</label><input type="text" id="fa-nombre" value="${esc(a?a.nombre_dispositivo:'')}"></div>
            <div class="field"><label>Sistema operativo</label><input type="text" id="fa-so" value="${esc(a?a.sistema_operativo:'')}"></div>
            <div class="field"><label>Procesador</label><input type="text" id="fa-proc" value="${esc(a?a.procesador:'')}"></div>
            <div class="field"><label>RAM (GB)</label><input type="number" id="fa-ram" value="${a&&a.ram_gb?a.ram_gb:''}"></div>
            <div class="field"><label>Almacenamiento (GB)</label><input type="number" id="fa-disco" value="${a&&a.disco_gb?a.disco_gb:''}"></div>
            <div class="field"><label>MAC WiFi</label><input type="text" id="fa-macwifi" class="mono" value="${esc(a?a.mac_wifi:'')}" placeholder="AA:BB:CC:DD:EE:FF"></div>
            <div class="field"><label>MAC Ethernet</label><input type="text" id="fa-maceth" class="mono" value="${esc(a?a.mac_ethernet:'')}" placeholder="AA:BB:CC:DD:EE:FF"></div>
            <div class="field"><label>Proveedor</label><input type="text" id="fa-proveedor" value="${esc(a?a.proveedor:'')}"></div>
            <div class="field"><label>Color</label><input type="text" id="fa-color" value="${esc(a?a.color:'')}"></div>
            <div class="field"><label>Longitud (m)</label><input type="number" step="0.1" min="0" id="fa-longitud" value="${a&&a.longitud_m?a.longitud_m:''}"></div>
            <div class="field"><label>Fecha de adquisición</label><input type="date" id="fa-fecha" value="${a&&a.fecha_adquisicion?a.fecha_adquisicion:''}"></div>
            <div class="field"><label>Valor de compra (USD)</label><input type="number" step="0.01" min="0" id="fa-valorcompra" value="${a&&a.valor_compra?a.valor_compra:''}"></div>
            <div class="field"><label>Vida útil (años)</label><input type="number" step="1" min="1" id="fa-vidautil" value="${a ? (a.vida_util_anios||'') : 3}"></div>
          </div>
          <fieldset style="margin-top:14px;" id="fs-celular">
            <legend>Datos de celular (solo si tipo = Celular)</legend>
            <div class="form-grid">
              <div class="field"><label>Gmail</label><input type="text" id="fa-gmail" class="mono" value="${a&&a.celular?esc(a.celular.gmail):''}"></div>
              <div class="field"><label>Password</label><input type="text" id="fa-password" class="mono" value="${a&&a.celular?esc(a.celular.password):''}"></div>
            </div>
          </fieldset>
          <div class="section-title" style="margin-top:14px;">Fotos</div>
          <div class="fotos-grid" id="fotos-grid-form">${htmlGridFotos()}</div>
          <div class="field hint" style="margin-top:6px;">Los cambios de fotos (agregar, quitar) se guardan junto con el resto al presionar "${esNuevo?'Crear activo':'Guardar cambios'}" — no se aplican antes.</div>
          <div class="field hint" style="margin-top:10px;">
            ${esNuevo ? "Al guardar, se te va a pedir asignar el primer custodio — un activo nunca queda sin uno." : "Para cambiar el custodio, usa el botón \"Cambiar custodio\" del detalle — este formulario solo edita los datos base del equipo."}
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-guardar-activo">${esNuevo?'Crear activo':'Guardar cambios'}</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("form-activo").addEventListener("submit", e=>e.preventDefault());
    wireGridFotos();
    document.getElementById("btn-guardar-activo").addEventListener("click", async ()=>{
      const campos = {
        tipo: document.getElementById("fa-tipo").value.trim(),
        propiedad: document.getElementById("fa-propiedad").value,
        empresa: document.getElementById("fa-empresa").value,
        marca: document.getElementById("fa-marca").value.trim(),
        modelo: document.getElementById("fa-modelo").value.trim(),
        serie: document.getElementById("fa-serie").value.trim(),
        nombre_dispositivo: document.getElementById("fa-nombre").value.trim(),
        sistema_operativo: document.getElementById("fa-so").value.trim(),
        procesador: document.getElementById("fa-proc").value.trim(),
        ram_gb: document.getElementById("fa-ram").value,
        disco_gb: document.getElementById("fa-disco").value,
        mac_wifi: document.getElementById("fa-macwifi").value.trim(),
        mac_ethernet: document.getElementById("fa-maceth").value.trim(),
        proveedor: document.getElementById("fa-proveedor").value.trim(),
        color: document.getElementById("fa-color").value.trim(),
        longitud_m: document.getElementById("fa-longitud").value,
        fecha_adquisicion: document.getElementById("fa-fecha").value,
        valor_compra: document.getElementById("fa-valorcompra").value,
        vida_util_anios: document.getElementById("fa-vidautil").value,
        gmail: document.getElementById("fa-gmail").value.trim(),
        password: document.getElementById("fa-password").value.trim(),
      };
      const btn = document.getElementById("btn-guardar-activo");
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
        alert("No se pudo guardar: " + err.message);
      }
    });
  });
}

/* ---------- Cambio de custodio ---------- */
// Ya no existe una transferencia directa de un custodio a otro: primero hay
// que marcar disponible (con observación obligatoria — cómo/por qué se
// devolvió) y, en un paso separado, asignar el nuevo custodio. Reemplaza a
// la vieja abrirCambioCustodio, que permitía saltarse el paso intermedio.
// Cambio de procedimiento: los equipos NUNCA quedan sin custodio — siempre
// hay trazabilidad de quién es responsable (persona o área), esté en uso,
// disponible o en mantenimiento. Por eso ya no hay dos pantallas separadas
// ("marcar disponible" que dejaba custodio=null, y "asignar" que solo
// corría desde ahí) — es un único flujo que siempre cierra el tramo
// vigente (si existe) Y abre uno nuevo con custodio obligatorio, en la
// misma acción. Estado ya no se infiere — se elige acá explícitamente.
function abrirCambiarCustodio(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const tieneVigente = a.custodio !== null;
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Cambiar custodio — ${fmtTag(a)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <div class="alert alert-info">${tieneVigente
          ? `Custodio actual: <strong>${esc(a.custodio.nombre)}</strong>. Al confirmar, este tramo se cierra hoy y se abre uno nuevo.`
          : `Este activo todavía no tiene custodio — es obligatorio asignarle uno.`}</div>
        ${tieneVigente ? `
        <fieldset style="margin-bottom:14px;">
          <legend>Cierre del tramo actual</legend>
          <div class="form-grid">
            <div class="field"><label>Tipo de devolución</label>
              <select id="cc-tipodev">
                <option value="">— Selecciona —</option>
                ${TIPOS_DEVOLUCION.map(t=>`<option value="${t.v}">${t.label}</option>`).join("")}
              </select>
            </div>
            <div class="field span-2"><label>Observación de la devolución</label><textarea id="cc-observaciondev" placeholder="Ej: equipo devuelto con un rayón en la tapa, cargador incluido…"></textarea></div>
          </div>
        </fieldset>` : ""}
        <fieldset style="margin-bottom:14px;">
          <legend>Nuevo tramo</legend>
          <div class="form-grid">
            <div class="field"><label>Fecha</label><input type="date" id="cc-fecha" value="${hoyISO()}"></div>
            <div class="field"><label>Estado resultante</label>
              <select id="cc-estado">
                <option value="">— Selecciona —</option>
                ${Object.entries(ESTADO_INFO).map(([v,info])=>`<option value="${v}">${esc(info.label)}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Tipo de entrega</label>
              <select id="cc-tipoentrega">
                <option value="">— Selecciona —</option>
                ${TIPOS_ENTREGA.map(t=>`<option value="${t.v}">${t.label}</option>`).join("")}
              </select>
            </div>
            <div class="field span-2"><label>Observación de la entrega (opcional)</label><textarea id="cc-observacionentrega" placeholder="Ej: se entrega con cargador original y funda…"></textarea></div>
          </div>
        </fieldset>
        <fieldset>
          <legend>Custodio</legend>
          <div class="form-grid">
            <div class="field"><label>Tipo</label>
              <select id="cc-tipo">
                <option value="persona">Persona</option>
                <option value="area">Área / departamento</option>
              </select>
            </div>
            <div class="field"><label>Nombre</label><input type="text" id="cc-nombre" placeholder="Nombre de la persona o del área — ej. Bodega General si queda disponible"></div>
            <div class="field span-2"><label>Cargo (opcional)</label><input type="text" id="cc-cargo"></div>
          </div>
        </fieldset>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-confirmar-cambiar">Confirmar</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-confirmar-cambiar").addEventListener("click", async ()=>{
      const nombre = document.getElementById("cc-nombre").value.trim();
      if(!nombre){ alert("Ingresa el nombre del custodio — es obligatorio, el activo no puede quedar sin uno."); return; }
      const nuevoEstado = document.getElementById("cc-estado").value;
      if(!nuevoEstado){ alert("Selecciona el estado resultante."); return; }
      const tipoEntrega = document.getElementById("cc-tipoentrega").value;
      if(!tipoEntrega){ alert("Selecciona el tipo de entrega."); return; }
      let tipoDev = null, observacionDev = "";
      if(tieneVigente){
        tipoDev = document.getElementById("cc-tipodev").value;
        if(!tipoDev){ alert("Selecciona el tipo de devolución del tramo que se cierra."); return; }
        observacionDev = document.getElementById("cc-observaciondev").value.trim();
        if(!observacionDev){ alert("La observación de la devolución es obligatoria."); return; }
      }
      const fecha = document.getElementById("cc-fecha").value || hoyISO();
      const observacionEntrega = document.getElementById("cc-observacionentrega").value.trim();
      try{
        await cambiarCustodio(id, {
          tipo_custodio: document.getElementById("cc-tipo").value,
          nombre, cargo: document.getElementById("cc-cargo").value.trim(),
        }, tipoDev, fecha, observacionDev, tipoEntrega, nuevoEstado, observacionEntrega);
        cerrarModal(); renderMain(); abrirDetalle(id);
      } catch(err){ alert("No se pudo cambiar el custodio: " + err.message); }
    });
  });
}

/* ---------- Editar tramo antiguo del historial ---------- */
function abrirEditarTramo(id, index){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  const t = a.historial_custodia[index];
  if(!t) return;
  const vigente = t.hasta===null; // igual que en tramoHtml: NO es lo mismo que index===0
  // cuando el activo está disponible (ahí el tramo más reciente ya está cerrado).
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Editar tramo #${index+1} — ${fmtTag(a)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field"><label>Tipo</label>
            <select id="et-tipo">
              <option value="persona" ${t.tipo_custodio==='persona'?'selected':''}>Persona</option>
              <option value="area" ${t.tipo_custodio==='area'?'selected':''}>Área / departamento</option>
              ${t.tipo_custodio==='mantenimiento' ? `<option value="mantenimiento" selected>Mantenimiento (heredado)</option>` : ''}
            </select>
          </div>
          <div class="field"><label>Nombre</label><input type="text" id="et-nombre" value="${esc(t.nombre)}"></div>
          <div class="field"><label>Cargo</label><input type="text" id="et-cargo" value="${esc(t.cargo)}"></div>
          <div class="field"><label>Desde</label><input type="date" id="et-desde" value="${t.desde||''}"></div>
          <div class="field"><label>Tipo de entrega</label>
            <select id="et-tipoentrega">
              <option value="">— Ninguno —</option>
              ${TIPOS_ENTREGA.map(x=>`<option value="${x.v}" ${t.tipo_entrega===x.v?'selected':''}>${x.label}</option>`).join("")}
            </select>
          </div>
          <div class="field"><label>Hasta</label><input type="date" id="et-hasta" value="${t.hasta||''}" ${vigente?'disabled':''}></div>
          <div class="field"><label>Tipo de devolución</label>
            <select id="et-tipodev" ${vigente?'disabled':''}>
              <option value="">— Ninguno —</option>
              ${TIPOS_DEVOLUCION.map(x=>`<option value="${x.v}" ${t.tipo_devolucion===x.v?'selected':''}>${x.label}</option>`).join("")}
            </select>
          </div>
          <div class="field span-2"><label>Observación de la entrega</label><textarea id="et-observacion-entrega" placeholder="Ej: se entrega con cargador original…">${esc(t.observacion_entrega)}</textarea></div>
          <div class="field span-2"><label>Observación de la devolución</label><textarea id="et-observacion-devolucion" ${vigente?'disabled':''} placeholder="${vigente?'Se habilita cuando este tramo se cierre':'Ej: se devuelve con la pantalla rayada…'}">${esc(t.observacion_devolucion)}</textarea></div>
        </div>
        ${vigente ? `<div class="field hint" style="margin-top:8px;">Este es el tramo vigente: "Hasta", "Tipo de devolución" y "Observación de la devolución" quedan bloqueados porque aún no ha terminado. La observación de la entrega sí se puede editar.</div>` : ""}
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="btn-guardar-tramo">Guardar</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-guardar-tramo").addEventListener("click", async ()=>{
      await editarTramoHistorial(id, index, {
        tipo_custodio: document.getElementById("et-tipo").value,
        nombre: document.getElementById("et-nombre").value.trim(),
        cargo: document.getElementById("et-cargo").value.trim(),
        desde: document.getElementById("et-desde").value,
        tipo_entrega: document.getElementById("et-tipoentrega").value,
        hasta: vigente ? null : document.getElementById("et-hasta").value,
        tipo_devolucion: vigente ? null : document.getElementById("et-tipodev").value,
        observacion_entrega: document.getElementById("et-observacion-entrega").value.trim(),
        observacion_devolucion: vigente ? null : document.getElementById("et-observacion-devolucion").value.trim(),
      });
      cerrarModal(); renderMain(); abrirDetalle(id);
    });
  });
}

/* ---------- Generar acta de entrega (TIC-FRM-003) ---------- */
// Rellena la plantilla oficial real reemplazando marcadores de texto
// ({{FECHA}}, {{NOMBRE}}, etc.) directamente en el XML interno del .xlsx —
// a propósito NO se usa una librería que reconstruya el archivo completo
// (como SheetJS leyendo+regrabando el libro), porque eso reemplaza la fuente
// original (Helvetica) y pierde negrillas como la de "OBSERVACIONES". Al
// tocar solo el texto entre <t>...</t>, el estilo de cada celda —que vive en
// un atributo separado— nunca se toca. Verificado con un archivo real: 27
// celdas combinadas y la fuente/negrilla originales sobreviven intactas.
const MESES_ES = ["enero","febrero","marzo","abril","mayo","junio","julio",
  "agosto","septiembre","octubre","noviembre","diciembre"];
function fechaEnPalabras(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  if(!y||!m||!d) return iso;
  return `${d} de ${MESES_ES[m-1]} de ${y}`;
}
function descripcionItemActa(a){
  const partes = [];
  const base = [a.tipo, a.marca].filter(Boolean).join(" ");
  if(base) partes.push(base);
  if(a.modelo) partes.push(`Modelo: ${a.modelo}`);
  if(a.serie) partes.push(`Número de serie: ${a.serie}`);
  return partes.join(" — ") || fmtTag(a);
}
/* ---------- Portapapeles de activos (para actas de entrega unificadas) ---------- */
// Solamente frontend, respaldado en localStorage para que sobreviva recargas
// mientras se van marcando activos dispersos entre distintos filtros/vistas.
const CLAVE_PORTAPAPELES = "lukmar_portapapeles_acta";
const MAX_PORTAPAPELES = 6; // igual al máximo de ítems que admite la plantilla TIC-FRM-003
function cargarPortapapeles(){
  try{ const g = JSON.parse(localStorage.getItem(CLAVE_PORTAPAPELES) || "[]"); return Array.isArray(g) ? g : []; }
  catch(e){ return []; }
}
function guardarPortapapelesIds(ids){
  localStorage.setItem(CLAVE_PORTAPAPELES, JSON.stringify(ids));
}
function estaEnPortapapeles(id){
  return cargarPortapapeles().includes(id);
}
function toggleEnPortapapeles(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  let ids = cargarPortapapeles();
  if(ids.includes(id)){
    ids = ids.filter(x=>x!==id);
  } else {
    if(!a.custodio){ alert("Solo se pueden marcar activos con custodio vigente."); return; }
    if(ids.length >= MAX_PORTAPAPELES){
      alert(`Ya tienes ${MAX_PORTAPAPELES} activos marcados — es el máximo por acta. Genera esta acta o quita alguno antes de agregar otro.`);
      return;
    }
    ids.push(id);
  }
  guardarPortapapelesIds(ids);
  actualizarBadgePortapapeles();
}
function vaciarPortapapeles(){
  guardarPortapapelesIds([]);
  actualizarBadgePortapapeles();
}
function actualizarBadgePortapapeles(){
  const badge = document.getElementById("badge-portapapeles");
  if(!badge) return;
  const n = cargarPortapapeles().length;
  badge.textContent = `🔖 ${n}`;
  badge.classList.toggle("badge-activo", n>0);
}
function abrirPanelPortapapeles(){
  const ids = cargarPortapapeles();
  const datos = cargarActivos();
  const items = ids.map(id=>buscarActivo(datos, id)).filter(Boolean);
  const nombresDistintos = [...new Set(items.map(a=>a.custodio && a.custodio.nombre).filter(Boolean))];
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Activos marcados para acta de entrega</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        ${items.length===0 ? `
          <div class="empty-state"><div class="big">🔖</div>No has marcado ningún activo todavía.<br>Márcalos desde la tabla o desde la ficha de detalle — hasta ${MAX_PORTAPAPELES} por acta.</div>
        ` : `
        <div class="tablewrap">
          <table>
            <thead><tr><th>Tag</th><th>Tipo</th><th>Marca / Modelo</th><th>Custodio</th><th></th></tr></thead>
            <tbody>
              ${items.map(a=>`<tr>
                <td class="mono">${fmtTag(a)}</td>
                <td>${esc(a.tipo)||'<span class="cell-muted">—</span>'}</td>
                <td>${esc([a.marca,a.modelo].filter(Boolean).join(" "))||'<span class="cell-muted">—</span>'}</td>
                <td>${esc(a.custodio ? a.custodio.nombre : "—")}</td>
                <td class="cell-actions"><button class="btn btn-sm btn-danger" data-quitar-portapapeles="${a.id}">Quitar</button></td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>
        ${nombresDistintos.length > 1 ? `<div class="alert alert-error" style="margin-top:10px;">Los activos marcados no tienen todos el mismo custodio (${nombresDistintos.map(esc).join(", ")}). Un acta es para un solo custodio — quita los que no correspondan o genera actas separadas.</div>` : ""}
        `}
      </div>
      <div class="modal-footer">
        ${items.length>0 ? `<button class="btn btn-danger" id="btn-vaciar-portapapeles">Vaciar</button>` : ""}
        <button class="btn modal-close">Cerrar</button>
        ${items.length>0 ? `<button class="btn btn-primary" id="btn-generar-acta-multiple" ${nombresDistintos.length>1?"disabled":""}>Generar acta unificada</button>` : ""}
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.querySelectorAll("[data-quitar-portapapeles]").forEach(b=>{
      b.addEventListener("click", ()=>{
        toggleEnPortapapeles(Number(b.dataset.quitarPortapapeles));
        renderMain();
        cerrarModal(); abrirPanelPortapapeles();
      });
    });
    const bv = document.getElementById("btn-vaciar-portapapeles");
    if(bv) bv.addEventListener("click", ()=>{
      vaciarPortapapeles(); renderMain(); cerrarModal(); abrirPanelPortapapeles();
    });
    const bg = document.getElementById("btn-generar-acta-multiple");
    if(bg) bg.addEventListener("click", async ()=>{
      bg.disabled = true; const txt = bg.textContent; bg.textContent = "Generando…";
      try{
        await generarActaEntregaDesdeLista(items);
        vaciarPortapapeles();
        renderMain();
        cerrarModal();
      } catch(err){ alert("No se pudo generar el acta: " + err.message); }
      finally{ bg.disabled = false; bg.textContent = txt; }
    });
  });
}


async function generarActaEntregaDesdeLista(activos){
  if(!activos || activos.length === 0) throw new Error("No hay ningún activo para generar el acta.");
  if(activos.length > 6) throw new Error("Un acta admite hasta 6 activos — genera dos actas separadas.");
  const sinCustodio = activos.find(a=>!a.custodio);
  if(sinCustodio) throw new Error(`El activo ${fmtTag(sinCustodio)} no tiene custodio vigente.`);
  const nombreRef = activos[0].custodio.nombre;
  const distinto = activos.find(a=>a.custodio.nombre !== nombreRef);
  if(distinto) throw new Error(`No todos los activos marcados tienen el mismo custodio ("${nombreRef}" vs "${distinto.custodio.nombre}"). Un acta es para un solo custodio — separa en dos actas.`);
  const cargoRef = activos[0].custodio.cargo;
  const fecha = fechaEnPalabras(hoyISO());

  const valores = {
    FECHA: fecha,
    NOMBRE: nombreRef || "",
    CARGO: cargoRef || "",
    FIRMA_USUARIO: `Usuario Responsable: ${nombreRef || ""}`,
    FECHA_FIRMA: `Fecha: ${fecha}`,
  };
  for(let i=1; i<=6; i++){
    const a = activos[i-1];
    const anterior = a ? a.historial_custodia[1] : null;
    valores["ITEM"+i] = a ? descripcionItemActa(a) : "";
    valores["OBS"+i] = (anterior && anterior.observacion_devolucion) || "";
  }

  const resp = await fetch("assets/plantillas/TIC-FRM-003.xlsx");
  if(!resp.ok) throw new Error("No se pudo cargar la plantilla (assets/plantillas/TIC-FRM-003.xlsx).");
  const buf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const rutaHoja = "xl/worksheets/sheet1.xml";
  const archivoHoja = zip.file(rutaHoja);
  if(!archivoHoja) throw new Error("La plantilla no tiene la hoja esperada (" + rutaHoja + ").");
  let xml = await archivoHoja.async("string");
  for(const [marcador, valor] of Object.entries(valores)){
    const escapado = String(valor)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    xml = xml.split(`<t>{{${marcador}}}</t>`).join(`<t xml:space="preserve">${escapado}</t>`);
  }
  zip.file(rutaHoja, xml);
  const salida = await zip.generateAsync({type:"blob"});
  const url = URL.createObjectURL(salida);
  const link = document.createElement("a");
  const sufijoTags = activos.map(a=>fmtTag(a)).join("-");
  const nombreArchivo = `Acta_Entrega_${(nombreRef||"").replace(/[^a-zA-Z0-9]+/g,"_")}_${sufijoTags}.xlsx`;
  link.href = url; link.download = nombreArchivo;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}


/* ---------- Dar de baja ---------- */
function abrirConfirmarBaja(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Dar de baja — ${fmtTag(a)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <div class="alert alert-error">Esta acción retira el activo del inventario activo. Queda archivado en la bitácora de bajas, desde donde se puede restaurar si es necesario.</div>
        <div class="field"><label>Motivo</label><textarea id="baja-motivo" placeholder="Ej: equipo dañado sin reparación posible, obsoleto, robado…"></textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" id="btn-confirmar-baja">Dar de baja</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-confirmar-baja").addEventListener("click", async ()=>{
      await darDeBaja(id, document.getElementById("baja-motivo").value.trim());
      cerrarModal(); renderMain();
    });
  });
}

/* ============================================================
   11. VISTA: BAJAS
   ============================================================ */
function renderVistaBajas(main){
  const bajas = cargarBajas();
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Bitácora de bajas (${bajas.length})</div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Tag</th><th>Tipo</th><th>Marca / Modelo</th><th>Fecha de baja</th><th>Motivo</th><th></th></tr></thead>
        <tbody>
          ${bajas.map((b,i)=>`
            <tr>
              <td><span class="tag tag-baja">${fmtTag(b.activo)}</span></td>
              <td>${esc(b.activo.tipo)||'—'}</td>
              <td>${esc(b.activo.marca)||''} ${esc(b.activo.modelo)||''}</td>
              <td class="cell-muted">${fmtFechaHora(b.fecha_baja)}</td>
              <td class="cell-muted">${esc(b.motivo)||'—'}</td>
              <td class="cell-actions">
                ${puede("restaurar_baja") ? `<button class="btn btn-sm" data-restaurar="${i}">Restaurar</button>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${bajas.length===0 ? `<div class="empty-state"><div class="big">—</div>No hay activos dados de baja.</div>` : ""}
    </div>`;
  main.querySelectorAll("[data-restaurar]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      await restaurarBaja(Number(b.dataset.restaurar));
      renderVistaBajas(main);
    });
  });
}

/* ============================================================
   12. VISTA: AUDITORÍA
   ============================================================ */
function renderVistaAuditoria(main){
  const log = cargarLog();
  main.innerHTML = `
    <div class="section-title" style="margin-top:0;">Registro de auditoría (últimas ${log.length} acciones)</div>
    <div class="tablewrap">
      <table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          ${log.map(l=>`<tr>
            <td class="cell-muted mono" style="white-space:nowrap;">${fmtFechaHora(l.fecha)}</td>
            <td>${esc(l.nombre_completo||l.usuario)}</td>
            <td><span class="pill pill-persona">${esc(l.accion)}</span></td>
            <td class="cell-muted">${esc(l.detalle)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${log.length===0 ? `<div class="empty-state"><div class="big">—</div>Todavía no hay acciones registradas.</div>` : ""}
    </div>`;
}

/* ============================================================
   13. VISTA: CONFIGURACIÓN (permisos + usuarios)
   ============================================================ */
function renderVistaConfig(main){
  main.innerHTML = `
    <div class="subtabs">
      <button class="subtab-btn ${state.configSubtab==='permisos'?'active':''}" data-subtab="permisos">Permisos</button>
      <button class="subtab-btn ${state.configSubtab==='usuarios'?'active':''}" data-subtab="usuarios">Usuarios</button>
    </div>
    <div id="config-content"></div>`;
  main.querySelectorAll("[data-subtab]").forEach(b=>b.addEventListener("click", ()=>{
    state.configSubtab = b.dataset.subtab; renderVistaConfig(main);
  }));
  const content = document.getElementById("config-content");
  if(state.configSubtab==="permisos") renderConfigPermisos(content);
  else renderConfigUsuarios(content);
}

function renderConfigPermisos(content){
  const matriz = cargarPermisos();
  const roles = Object.keys(matriz);
  content.innerHTML = `
    <div class="alert alert-info">El rol <strong>administrador</strong> siempre tiene todos los permisos y no aparece aquí, para evitar que quede bloqueado por un error de configuración.</div>
    <div class="tablewrap" style="margin-bottom:14px;">
      <table class="matrix-table">
        <thead><tr><th>Acción</th>${roles.map(r=>`<th>${esc(r)}</th>`).join("")}</tr></thead>
        <tbody>
          ${ACCIONES.map(acc=>`<tr>
            <td>${acc.label}</td>
            ${roles.map(r=>`<td><input type="checkbox" data-rol="${esc(r)}" data-accion="${acc.id}" ${matriz[r][acc.id]?'checked':''}></td>`).join("")}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
      <input type="text" id="nuevo-rol" placeholder="Nombre del nuevo rol (ej: soporte)" style="border:1px solid var(--border-strong);border-radius:6px;padding:7px 10px;">
      <button class="btn" id="btn-agregar-rol">+ Agregar rol</button>
      <div class="fb-spacer"></div>
      <button class="btn btn-primary" id="btn-guardar-permisos">Guardar matriz de permisos</button>
    </div>`;
  document.getElementById("btn-guardar-permisos").addEventListener("click", async ()=>{
    const nueva = {};
    roles.forEach(r=>{ nueva[r]={}; });
    content.querySelectorAll("input[type=checkbox]").forEach(cb=>{
      nueva[cb.dataset.rol][cb.dataset.accion] = cb.checked;
    });
    await guardarPermisos(nueva);
    alert("Matriz de permisos guardada.");
  });
  document.getElementById("btn-agregar-rol").addEventListener("click", async ()=>{
    const nombre = document.getElementById("nuevo-rol").value.trim().toLowerCase();
    if(!nombre){ return; }
    if(nombre===ROL_ADMIN || matriz[nombre]){ alert("Ese nombre de rol ya existe."); return; }
    matriz[nombre] = {}; ACCIONES.forEach(a=>matriz[nombre][a.id]=false);
    await guardarPermisos(matriz);
    renderVistaConfig(document.getElementById("main"));
  });
}

// A diferencia del resto de la app, aquí NO se puede recrear el flujo
// original de "crear usuario con clave" desde el navegador: eso requeriría
// una clave de servicio de Supabase, que nunca debe vivir en código de
// cliente (le daría a cualquiera acceso total, sin RLS). El flujo real queda
// en dos pasos: (1) crear la cuenta en el panel de Supabase → Authentication
// → Add user, con su correo; (2) vincularla aquí a un rol por ese mismo
// correo (usa la función buscar_uid_por_email, que sí puede vivir en el
// cliente porque solo devuelve un id, nunca la lista completa de cuentas).
function renderConfigUsuarios(content){
  const perfiles = cargarPerfiles();
  const matriz = cargarPermisos();
  const roles = [ROL_ADMIN, ...Object.keys(matriz)];
  content.innerHTML = `
    <div class="tablewrap" style="margin-bottom:14px;">
      <table>
        <thead><tr><th>Nombre</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          ${perfiles.map(p=>`<tr>
            <td>${esc(p.nombre_completo)}</td>
            <td>
              ${p.id===state.sesionUid ? `<span class="rolebadge rol-${esc(p.rol)}">${esc(p.rol)}</span>` : `
              <select data-cambiar-rol="${esc(p.id)}">${roles.map(r=>`<option value="${esc(r)}" ${r===p.rol?'selected':''}>${esc(r)}</option>`).join("")}</select>`}
            </td>
            <td class="cell-actions">${p.id===state.sesionUid ? `<span class="cell-muted">(tú)</span>` : ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div class="alert alert-info">
      Para dar acceso a alguien nuevo: primero créale la cuenta en el panel de Supabase (Authentication → Add user, con su correo y una contraseña), y luego vincúlala aquí abajo con su rol. Esta pantalla nunca puede crear cuentas de acceso por sí sola — eso es intencional, por seguridad.
    </div>
    <fieldset>
      <legend>Vincular usuario existente</legend>
      <div class="form-grid">
        <div class="field"><label>Correo (el mismo con el que se creó en Supabase)</label><input type="email" id="nu-email"></div>
        <div class="field"><label>Nombre completo</label><input type="text" id="nu-nombre"></div>
        <div class="field"><label>Rol</label><select id="nu-rol">${roles.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("")}</select></div>
      </div>
      <button class="btn btn-primary" id="btn-vincular-usuario" style="margin-top:10px;">Vincular</button>
    </fieldset>`;
  content.querySelectorAll("[data-cambiar-rol]").forEach(sel=>{
    sel.addEventListener("change", async ()=>{
      const { error } = await sb.from("perfiles").update({ rol: sel.value }).eq("id", sel.dataset.cambiarRol);
      if(error){ alert("No se pudo cambiar el rol: " + error.message); return; }
      await refrescarDatos();
      renderVistaConfig(document.getElementById("main"));
    });
  });
  document.getElementById("btn-vincular-usuario").addEventListener("click", async ()=>{
    const email = document.getElementById("nu-email").value.trim();
    const nombre_completo = document.getElementById("nu-nombre").value.trim();
    const rol = document.getElementById("nu-rol").value;
    if(!email || !nombre_completo){ alert("Completa correo y nombre."); return; }
    const { data: uid, error: e1 } = await sb.rpc("buscar_uid_por_email", { p_email: email });
    if(e1 || !uid){ alert("No se encontró ninguna cuenta con ese correo. Crea la cuenta primero en el panel de Supabase (Authentication → Add user)."); return; }
    const { error: e2 } = await sb.from("perfiles").insert({ id: uid, rol, nombre_completo });
    if(e2){ alert("No se pudo vincular: " + e2.message); return; }
    await refrescarDatos();
    renderVistaConfig(document.getElementById("main"));
  });
}

/* ============================================================
   14. ARRANQUE
   ============================================================ */
// Decoración de fondo persistente: vive fuera de #app (nunca la borra un
// render()) y se coloca detrás de todo con z-index negativo + posición fija.
function inyectarDecoracionFondo(){
  if(document.getElementById("app-decor")) return;
  const decor = document.createElement("div");
  decor.id = "app-decor";
  decor.innerHTML = `<img src="${LOGO_MARK_SRC}" alt="">`;
  document.body.appendChild(decor);
}

// Si la ventana cruza el punto de quiebre móvil mientras hay texto en la
// búsqueda general, sus resultados deben reflejar el nuevo alcance (todas
// las columnas, o solo Tipo+Custodio) sin que el usuario tenga que retocar
// el campo.
let resizeTimeout = null;
window.addEventListener("resize", ()=>{
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(()=>{
    if(state.sesion && state.vista === "activos" && state.filtros.texto) actualizarTablaYResumen();
  }, 200);
});

(async function iniciar(){
  const root = document.getElementById("app");
  root.innerHTML = `<div class="login-wrap"><div class="login-sub">Cargando inventario…</div></div>`;
  try{
    await iniciarSesionGuardada();
    if(state.sesion) await refrescarDatos();
  }catch(err){
    root.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="alert alert-error">No se pudo conectar con la base de datos (Supabase). Revisa tu conexión a internet e intenta de nuevo.<br><br>Detalle: ${err.message}</div>
    </div></div>`;
    return;
  }
  inyectarDecoracionFondo();
  render();
  // Si la sesión cambia en otra pestaña (o expira), refleja el cambio aquí
  // también — sin esto, esta pestaña seguiría mostrando la app ya cerrada la
  // sesión en otra parte hasta el siguiente refresco manual.
  sb.auth.onAuthStateChange((_evento, session)=>{
    if(!session && state.sesion){ state.sesion = null; state.vista = "activos"; render(); }
  });
})();
