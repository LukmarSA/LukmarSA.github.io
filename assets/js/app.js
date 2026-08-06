
/* ============================================================
   1. DATOS SEMILLA (activos.json embebido, v7) Y CONSTANTES
   ============================================================ */
const VERSION_ESQUEMA_ACTUAL = 8;
const CLAVE_ACTIVOS   = "lukmar_activos_tecnologicos";
const CLAVE_BAJAS     = "lukmar_activos_bajas";
const CLAVE_USUARIOS  = "lukmar_usuarios";
const CLAVE_PERMISOS  = "lukmar_permisos";
const CLAVE_SESION    = "lukmar_sesion";
const CLAVE_LOG       = "lukmar_log_auditoria";

// Logo real de Lukmar, como archivos en assets/img/ (no embebido en el JS).
const LOGO_MARK_SRC = "assets/img/logo-mark.png";
const LOGO_FULL_SRC = "assets/img/logo-full.png";


// DATOS_SEMILLA ahora vive en data.json (fetch en asegurarSemilla).

// Acciones controlables por la matriz de permisos.
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

// El rol "administrador" siempre tiene todo (evita que se bloquee a sí mismo
// editando mal la matriz). La matriz solo gobierna a los demás roles.
const ROL_ADMIN = "administrador";

const USUARIOS_SEMILLA = [
  { usuario:"admin",        password:"admin123",        rol:"administrador", nombre_completo:"Administrador" },
  { usuario:"registrador",  password:"registrador123",  rol:"registrador",   nombre_completo:"Registrador" },
  { usuario:"visitante",    password:"visitante123",    rol:"visitante",     nombre_completo:"Visitante" },
];

const PERMISOS_SEMILLA = {
  registrador: {
    ver_listado:true, ver_detalle:true, crear_activo:true, editar_activo:true,
    cambiar_custodio:true, editar_historial:false, dar_baja:false,
    restaurar_baja:false, ver_bajas:true,
  },
  visitante: {
    ver_listado:true, ver_detalle:true, crear_activo:false, editar_activo:false,
    cambiar_custodio:false, editar_historial:false, dar_baja:false,
    restaurar_baja:false, ver_bajas:false,
  },
};

/* ============================================================
   2. CAPA DE ACCESO A DATOS (LocalStorage + semilla remota)
   ============================================================ */
// Se ejecuta una sola vez al arrancar: si no hay datos guardados, o son de
// una versión de esquema distinta, trae la semilla desde data.json (fetch,
// funciona porque GitHub Pages sirve el sitio por HTTP) y la guarda en
// LocalStorage. A partir de ahí, cargarActivos()/guardarActivos() son síncronas.
async function asegurarSemilla(){
  const guardado = localStorage.getItem(CLAVE_ACTIVOS);
  if(guardado){
    try{
      const datos = JSON.parse(guardado);
      if(datos.version === VERSION_ESQUEMA_ACTUAL) return;
      // Versión distinta a la esperada: no asumir la forma vieja, reimportar semilla.
    }catch(e){ /* corrupto: reimportar */ }
  }
  const resp = await fetch("assets/data/data.json");
  if(!resp.ok) throw new Error("No se pudo cargar data.json (" + resp.status + ")");
  const datos = await resp.json();
  localStorage.setItem(CLAVE_ACTIVOS, JSON.stringify(datos));
}
function cargarActivos(){
  const guardado = localStorage.getItem(CLAVE_ACTIVOS);
  // asegurarSemilla() ya corrió en el arranque, así que esto siempre debería existir.
  return guardado ? JSON.parse(guardado) : { version:VERSION_ESQUEMA_ACTUAL, generado_en:null, activos:[] };
}
function guardarActivos(datos){
  datos.generado_en = new Date().toISOString();
  localStorage.setItem(CLAVE_ACTIVOS, JSON.stringify(datos));
}
function cargarBajas(){
  const g = localStorage.getItem(CLAVE_BAJAS);
  return g ? JSON.parse(g) : [];
}
function guardarBajas(lista){
  localStorage.setItem(CLAVE_BAJAS, JSON.stringify(lista));
}
function cargarUsuarios(){
  const g = localStorage.getItem(CLAVE_USUARIOS);
  if(g) return JSON.parse(g);
  localStorage.setItem(CLAVE_USUARIOS, JSON.stringify(USUARIOS_SEMILLA));
  return JSON.parse(JSON.stringify(USUARIOS_SEMILLA));
}
function guardarUsuarios(lista){
  localStorage.setItem(CLAVE_USUARIOS, JSON.stringify(lista));
}
function cargarPermisos(){
  const g = localStorage.getItem(CLAVE_PERMISOS);
  if(g) return JSON.parse(g);
  localStorage.setItem(CLAVE_PERMISOS, JSON.stringify(PERMISOS_SEMILLA));
  return JSON.parse(JSON.stringify(PERMISOS_SEMILLA));
}
function guardarPermisos(matriz){
  localStorage.setItem(CLAVE_PERMISOS, JSON.stringify(matriz));
}
function cargarLog(){
  const g = localStorage.getItem(CLAVE_LOG);
  return g ? JSON.parse(g) : [];
}
function registrarLog(accion, detalle){
  const log = cargarLog();
  log.unshift({
    fecha: new Date().toISOString(),
    usuario: state.sesion ? state.sesion.usuario : "(desconocido)",
    nombre_completo: state.sesion ? state.sesion.nombre_completo : "",
    accion, detalle,
  });
  localStorage.setItem(CLAVE_LOG, JSON.stringify(log.slice(0,500)));
}

/* ============================================================
   3. ESTADO EN MEMORIA
   ============================================================ */
const state = {
  sesion: null,       // { usuario, rol, nombre_completo }
  vista: "activos",   // activos | bajas | auditoria | config
  configSubtab: "permisos",
  // null en tipo/propiedad/custodioClase = "sin filtrar" (equivale a todas las opciones marcadas).
  filtros: { texto:"", tipo:null, propiedad:null, custodioClase:null, marca:null, colTag:"", colTipo:"", colMarca:"", colCustodio:"", colCargo:"", colPropiedad:"", colSerie:"", colSo:"", colProveedor:"", colFecha:"", colModelo:"", colNombre:"" },
  orden: { campo:"id", dir:"asc" },
  columnasVisibles: new Set(["tag","tipo","marca","custodio","propiedad","acciones"]),
  modal: null,         // función que renderiza el modal actual, o null
};

function iniciarSesionGuardada(){
  const g = localStorage.getItem(CLAVE_SESION);
  if(g){ try{ state.sesion = JSON.parse(g); }catch(e){ state.sesion=null; } }
}
function guardarSesion(sesion){
  state.sesion = sesion;
  localStorage.setItem(CLAVE_SESION, JSON.stringify(sesion));
}
function cerrarSesion(){
  state.sesion = null;
  localStorage.removeItem(CLAVE_SESION);
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
function fmtTag(id){ return "ACT-" + String(id).padStart(3,"0"); }
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
function siguienteId(datos){
  return datos.activos.reduce((max,a)=>Math.max(max,a.id),0) + 1;
}
function buscarActivo(datos, id){
  return datos.activos.find(a=>a.id===id);
}
const TIPOS_DEVOLUCION = [
  {v:"firmada", label:"Firmada (devolución normal con acta)"},
  {v:"desvinculada", label:"Desvinculada (el custodio dejó la empresa)"},
  {v:"perdida", label:"Perdida (no se recuperó el activo)"},
];
function labelTipoDevolucion(v){
  const f = TIPOS_DEVOLUCION.find(t=>t.v===v);
  return f ? f.label : "—";
}

/* ============================================================
   6. AGREGADOS (siempre calculados al vuelo, nunca guardados)
   ============================================================ */
function calcularAgregados(activos){
  const total = activos.length;
  const disponibles = activos.filter(a=>a.custodio===null).length;
  const asignadosPersona = activos.filter(a=>a.custodio && a.custodio.tipo_custodio==="persona").length;
  const asignadosArea = activos.filter(a=>a.custodio && a.custodio.tipo_custodio==="area").length;
  const porTipo = {};
  activos.forEach(a=>{ const t=a.tipo||"Sin tipo"; porTipo[t]=(porTipo[t]||0)+1; });
  return { total, disponibles, asignadosPersona, asignadosArea, porTipo };
}

/* ============================================================
   7. OPERACIONES DE NEGOCIO (mutan LocalStorage + registran auditoría)
   ============================================================ */
function crearActivo(campos){
  const datos = cargarActivos();
  const nuevo = {
    id: siguienteId(datos),
    propiedad: campos.propiedad,
    custodio: null,
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
    celular: (campos.tipo === "Celular" && (campos.gmail || campos.password))
      ? { gmail: campos.gmail || null, password: campos.password || null }
      : null,
    historial_custodia: [],
    trazabilidad: {
      categoria: null, custodio_texto: null, numero_original: null,
      estado_notas: null, seccion_origen: "Alta manual (app)", fila_excel: null,
      id_anterior: null,
    },
  };
  datos.activos.push(nuevo);
  guardarActivos(datos);
  registrarLog("crear_activo", `Se creó el activo ${fmtTag(nuevo.id)} (${nuevo.tipo||"?"} ${nuevo.marca||""}).`);
  return nuevo.id;
}

function editarActivoBase(id, campos){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const editables = ["propiedad","tipo","marca","modelo","serie","nombre_dispositivo",
    "mac_wifi","mac_ethernet","sistema_operativo","procesador","proveedor","fecha_adquisicion"];
  editables.forEach(k=>{ if(k in campos) a[k] = campos[k] || null; });
  if("ram_gb" in campos) a.ram_gb = campos.ram_gb ? Number(campos.ram_gb) : null;
  if("disco_gb" in campos) a.disco_gb = campos.disco_gb ? Number(campos.disco_gb) : null;
  if(a.tipo === "Celular"){
    if("gmail" in campos || "password" in campos){
      a.celular = { gmail: campos.gmail || (a.celular?a.celular.gmail:null) || null,
                    password: campos.password || (a.celular?a.celular.password:null) || null };
    }
  } else {
    a.celular = null;
  }
  guardarActivos(datos);
  registrarLog("editar_activo", `Se editaron datos base del activo ${fmtTag(id)}.`);
}

// Registrar cambio de custodio: cierra el tramo vigente (hasta/tipo_devolucion/
// observación de la entrega) y prepend-ea el nuevo tramo. custodio de nivel
// superior queda como espejo.
function cambiarCustodio(id, nuevoCustodio, tipoDevolucionSaliente, fechaHasta, observacionSaliente){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const fechaCambio = fechaHasta || hoyISO();
  if(a.historial_custodia.length > 0){
    a.historial_custodia[0].hasta = fechaCambio;
    a.historial_custodia[0].tipo_devolucion = tipoDevolucionSaliente || null;
    a.historial_custodia[0].observacion = observacionSaliente || null;
  }
  const tramoNuevo = {
    tipo_custodio: nuevoCustodio.tipo_custodio,
    nombre: nuevoCustodio.nombre,
    cargo: nuevoCustodio.cargo || null,
    desde: fechaCambio,
    hasta: null,
    tipo_devolucion: null,
    observacion: null,
  };
  a.historial_custodia.unshift(tramoNuevo);
  a.custodio = { tipo_custodio: tramoNuevo.tipo_custodio, nombre: tramoNuevo.nombre, cargo: tramoNuevo.cargo };
  guardarActivos(datos);
  registrarLog("cambiar_custodio", `Activo ${fmtTag(id)}: nuevo custodio "${nuevoCustodio.nombre}" (${nuevoCustodio.tipo_custodio}).`);
}

// Marcar el activo como disponible (sin custodio), cerrando el tramo vigente.
function liberarCustodio(id, tipoDevolucion, fechaHasta, observacion){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const fechaCambio = fechaHasta || hoyISO();
  if(a.historial_custodia.length > 0){
    a.historial_custodia[0].hasta = fechaCambio;
    a.historial_custodia[0].tipo_devolucion = tipoDevolucion || null;
    a.historial_custodia[0].observacion = observacion || null;
  }
  a.custodio = null;
  guardarActivos(datos);
  registrarLog("cambiar_custodio", `Activo ${fmtTag(id)}: quedó disponible (sin custodio).`);
}

function editarTramoHistorial(id, index, campos){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const tramo = a.historial_custodia[index];
  if(!tramo) return;
  ["tipo_custodio","nombre","cargo","desde","hasta","tipo_devolucion","observacion"].forEach(k=>{
    if(k in campos) tramo[k] = campos[k] || null;
  });
  if(index === 0){
    a.custodio = { tipo_custodio: tramo.tipo_custodio, nombre: tramo.nombre, cargo: tramo.cargo };
  }
  guardarActivos(datos);
  registrarLog("editar_historial", `Activo ${fmtTag(id)}: se corrigió el tramo #${index+1} del historial.`);
}

// Dar de baja: se elimina del arreglo activos y se archiva íntegro en la bitácora de bajas.
function darDeBaja(id, motivo){
  const datos = cargarActivos();
  const idx = datos.activos.findIndex(a=>a.id===id);
  if(idx === -1) return;
  const activo = datos.activos[idx];
  datos.activos.splice(idx,1);
  guardarActivos(datos);
  const bajas = cargarBajas();
  bajas.unshift({
    activo,
    fecha_baja: new Date().toISOString(),
    motivo: motivo || null,
    dado_de_baja_por: state.sesion ? state.sesion.usuario : null,
  });
  guardarBajas(bajas);
  registrarLog("dar_baja", `Activo ${fmtTag(id)} dado de baja. Motivo: ${motivo||"(sin especificar)"}.`);
}

function restaurarBaja(indexBaja){
  const bajas = cargarBajas();
  const registro = bajas[indexBaja];
  if(!registro) return;
  const datos = cargarActivos();
  const idOcupado = datos.activos.some(a=>a.id===registro.activo.id);
  if(idOcupado){
    // El id fue reasignado a otro activo nuevo mientras estaba de baja: se reinserta con id nuevo.
    registro.activo.id = siguienteId(datos);
  }
  datos.activos.push(registro.activo);
  guardarActivos(datos);
  bajas.splice(indexBaja,1);
  guardarBajas(bajas);
  registrarLog("restaurar_baja", `Se restauró el activo ${fmtTag(registro.activo.id)} desde la bitácora de bajas.`);
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
          Este inicio de sesión es solo para diferenciar roles dentro de la app (sin seguridad real; las contraseñas se guardan sin cifrar en este navegador).<br>
          Usuarios de prueba: <code>admin/admin123</code> · <code>registrador/registrador123</code> · <code>visitante/visitante123</code>
        </div>
      </div>
    </div>`;
  document.getElementById("form-login").addEventListener("submit", (e)=>{
    e.preventDefault();
    const u = document.getElementById("login-usuario").value.trim();
    const p = document.getElementById("login-password").value;
    const usuarios = cargarUsuarios();
    const encontrado = usuarios.find(x=>x.usuario===u && x.password===p);
    if(!encontrado){ renderLogin("Usuario o contraseña incorrectos."); return; }
    guardarSesion({ usuario:encontrado.usuario, rol:encontrado.rol, nombre_completo:encontrado.nombre_completo });
    registrarLog("iniciar_sesion", `Inicio de sesión de ${encontrado.usuario}.`);
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
        <div class="userchip">${esc(s.nombre_completo)} <span class="rolebadge rol-${s.rol}">${s.rol}</span></div>
        <button class="btn btn-ghost btn-sm" id="btn-logout">Cerrar sesión</button>
      </div>
    </div>
    <main id="main"></main>
  `;
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click", ()=>{
    state.vista = b.dataset.tab; renderMain();
  }));
  document.getElementById("btn-logout").addEventListener("click", cerrarSesion);
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
function abrirModal(html, onMount){
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
  // Foco directo en el primer campo editable, para poder navegar todo el
  // formulario con Tab sin tener que tocar el mouse primero.
  const primerCampo = host.querySelector("input, select, textarea");
  if(primerCampo) primerCampo.focus();
  // Esc cierra el modal — se registra un solo listener a la vez (por si un
  // modal abre otro sin pasar por cerrarModal primero).
  document.removeEventListener("keydown", escCierraModal);
  document.addEventListener("keydown", escCierraModal);
}
function escCierraModal(e){
  if(e.key === "Escape") cerrarModal();
}
function cerrarModal(){
  const host = document.getElementById("modal-host");
  if(host) host.innerHTML = "";
  document.removeEventListener("keydown", escCierraModal);
}

/* ============================================================
   9. VISTA: LISTADO DE ACTIVOS
   ============================================================ */
// Catálogo de columnas posibles. "core" = siempre visible (Tag y Acciones);
// el resto se puede mostrar/ocultar desde "Columnas". El peso determina el
// ancho relativo de cada columna, normalizado sobre las que estén activas
// (así la tabla se reparte bien sin importar cuántas columnas elijas).
const DEFINICION_COLUMNAS = [
  { key:"tag",       label:"Tag",             core:true,  weight:1.0, sortCampo:"id",       filterCampo:null,           campoTexto:"colTag",       placeholder:"Ej: 012" },
  { key:"tipo",       label:"Tipo",            core:false, weight:1.9, sortCampo:"tipo",     filterCampo:"tipo",         campoTexto:"colTipo",      placeholder:"Buscar tipo…" },
  { key:"marca",      label:"Marca",           core:false, weight:1.5, sortCampo:"marca",    filterCampo:"marca",        campoTexto:"colMarca",     placeholder:"Buscar marca…" },
  { key:"modelo",     label:"Modelo",          core:false, weight:1.6, sortCampo:"modelo",   filterCampo:null,           campoTexto:"colModelo",    placeholder:"Buscar modelo…" },
  { key:"nombre",     label:"Nombre equipo",   core:false, weight:1.6, sortCampo:"nombre",   filterCampo:null,           campoTexto:"colNombre",    placeholder:"Buscar nombre…" },
  { key:"custodio",   label:"Custodio",        core:false, weight:2.4, sortCampo:"custodio", filterCampo:"custodioClase",campoTexto:"colCustodio",  placeholder:"Buscar nombre…" },
  { key:"cargo",      label:"Cargo",           core:false, weight:1.5, sortCampo:"cargo",    filterCampo:null,           campoTexto:"colCargo",     placeholder:"Buscar cargo…" },
  { key:"propiedad",  label:"Propiedad",       core:false, weight:1.1, sortCampo:"propiedad",filterCampo:"propiedad",    campoTexto:"colPropiedad", placeholder:"Buscar propiedad…" },
  { key:"serie",      label:"Serie",           core:false, weight:1.4, sortCampo:"serie",    filterCampo:null,           campoTexto:"colSerie",     placeholder:"Buscar serie…" },
  { key:"so",         label:"Sist. operativo", core:false, weight:1.3, sortCampo:"so",       filterCampo:null,           campoTexto:"colSo",        placeholder:"Buscar SO…" },
  { key:"fecha",      label:"Adquisición",     core:false, weight:1.3, sortCampo:"fecha",    filterCampo:null,           campoTexto:"colFecha",     placeholder:"Buscar fecha…" },
  { key:"proveedor",  label:"Proveedor",       core:false, weight:1.3, sortCampo:"proveedor",filterCampo:null,           campoTexto:"colProveedor", placeholder:"Buscar proveedor…" },
  { key:"acciones",   label:"",                core:true,  weight:2.2, sortCampo:null,       filterCampo:null,           campoTexto:null,           placeholder:null },
];
const COLUMNAS_VISIBLES_DEFAULT = ["tag","tipo","marca","custodio","propiedad","acciones"];
const LIMITE_COLUMNAS_RECOMENDADO = 7;

// Opciones disponibles por columna filtrable, recalculadas cada vez que se
// entra a la vista. TODAS las opciones se recalculan desde los datos reales
// (no listas fijas): si se crea un activo con un tipo, marca o propiedad
// nuevos, aparecen solos como opción de filtro en el siguiente render — el
// mismo mecanismo que ya traía "tipo" desde el principio. Se guarda en un
// caché de módulo para que los manejadores de eventos (delegados a nivel de
// documento) sepan qué significa "seleccionar todo" para cada columna sin
// tener que releer el DOM.
let opcionesFiltroCache = { tipo:[], propiedad:[], custodioClase:[], marca:[] };
function recalcularOpcionesFiltro(datos){
  opcionesFiltroCache.tipo = [...new Set(datos.activos.map(a=>a.tipo).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.propiedad = [...new Set(datos.activos.map(a=>a.propiedad).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.custodioClase = [...new Set(datos.activos.map(a=>claseCustodio(a)))].sort((a,b)=>a.localeCompare(b,'es'));
  opcionesFiltroCache.marca = [...new Set(datos.activos.map(a=>a.marca).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
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
  return valor.charAt(0).toUpperCase() + valor.slice(1);
}
function capitalizar(s){ return s ? s.charAt(0).toUpperCase()+s.slice(1) : s; }
// Un color propio por tipo de propiedad, igual que ya existe para tipo de activo.
const COLOR_PROPIEDAD = {
  propio:  { fg:"#2E6B3D", bg:"#DCEFE0" },
  rentado: { fg:"#B35A17", bg:"#FCE3D0" },
  externo: { fg:"#4A3F73", bg:"#E9E4F3" },
};
function pillPropiedad(valor){
  const c = COLOR_PROPIEDAD[valor] || { fg:"#57697C", bg:"#EEF1F4" };
  return `<span class="pill" style="background:${c.bg};color:${c.fg};"><span class="pill-dot"></span>${esc(capitalizar(valor))}</span>`;
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
    return [a.tipo, a.custodio ? a.custodio.nombre : "Disponible"];
  }
  return [fmtTag(a.id), a.marca, a.modelo, a.serie, a.nombre_dispositivo,
    a.custodio?a.custodio.nombre:"Disponible", a.tipo, a.propiedad, a.sistema_operativo, a.proveedor];
}

function filtrarActivos(datos){
  const f = state.filtros;
  return datos.activos.filter(a=>{
    if(f.tipo !== null && a.tipo && !f.tipo.has(a.tipo)) return false;
    if(f.propiedad !== null && !f.propiedad.has(a.propiedad)) return false;
    if(f.custodioClase !== null && !f.custodioClase.has(claseCustodio(a))) return false;
    if(f.marca !== null && a.marca && !f.marca.has(a.marca)) return false;
    if(f.colTag && !fmtTag(a.id).toLowerCase().includes(f.colTag.toLowerCase())) return false;
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
    if(f.colFecha && !fmtFecha(a.fecha_adquisicion).toLowerCase().includes(f.colFecha.toLowerCase())) return false;
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
    case "tipo": va=a.tipo||""; vb=b.tipo||""; break;
    case "marca": va=((a.marca||"")+" "+(a.modelo||"")).trim(); vb=((b.marca||"")+" "+(b.modelo||"")).trim(); break;
    case "custodio": va=(a.custodio?a.custodio.nombre:"") ; vb=(b.custodio?b.custodio.nombre:""); break;
    case "cargo": va=(a.custodio&&a.custodio.cargo)?a.custodio.cargo:""; vb=(b.custodio&&b.custodio.cargo)?b.custodio.cargo:""; break;
    case "propiedad": va=a.propiedad||""; vb=b.propiedad||""; break;
    case "serie": va=a.serie||""; vb=b.serie||""; break;
    case "so": va=a.sistema_operativo||""; vb=b.sistema_operativo||""; break;
    case "proveedor": va=a.proveedor||""; vb=b.proveedor||""; break;
    case "fecha": va=a.fecha_adquisicion||""; vb=b.fecha_adquisicion||""; break;
    case "modelo": va=a.modelo||""; vb=b.modelo||""; break;
    case "nombre": va=a.nombre_dispositivo||""; vb=b.nombre_dispositivo||""; break;
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
  return { texto:"", tipo:null, propiedad:null, custodioClase:null, marca:null,
    colTag:"", colTipo:"", colMarca:"", colCustodio:"", colCargo:"", colPropiedad:"",
    colSerie:"", colSo:"", colProveedor:"", colFecha:"", colModelo:"", colNombre:"" };
}
function aplicarFiltroKpi(valor){
  if(valor === null){
    state.filtros = estadoInicialFiltros();
  } else {
    const actual = state.filtros.custodioClase;
    const yaActivo = actual && actual.size===1 && actual.has(valor);
    state.filtros.custodioClase = yaActivo ? null : new Set([valor]);
  }
  renderMain();
}
function claseKpiActiva(valor){
  if(valor === null) return !state.filtros.custodioClase ? "kpi-selected" : "";
  const actual = state.filtros.custodioClase;
  return (actual && actual.size===1 && actual.has(valor)) ? "kpi-selected" : "";
}

/* ---------- Gestor de columnas visibles ---------- */
function abrirGestorColumnas(){
  const opcionesNoCore = DEFINICION_COLUMNAS.filter(c=>!c.core);
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
    <div class="modal-footer"><button class="btn modal-close">Cerrar</button></div>
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
  });
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
const NOMBRE_COLUMNA_KPI = { tipo:"Tipo", marca:"Marca", custodioClase:"Custodio", propiedad:"Propiedad" };
function abrirModalKpiColumna(campo){
  const nombre = NOMBRE_COLUMNA_KPI[campo] || campo;
  const opciones = opcionesFiltroCache[campo] || [];
  const lista = listaParaConteo(campo);
  const filas = opciones
    .map(op=>({ op, n: contarValorEnLista(lista, campo, op) }))
    .sort((a,b)=>b.n-a.n);
  const max = Math.max(1, ...filas.map(f=>f.n));
  const totalConteo = filas.reduce((s,f)=>s+f.n,0);
  const html = `<div class="modal">
    <div class="modal-header"><h3>Resumen — ${esc(nombre)}</h3><button class="modal-close">✕</button></div>
    <div class="modal-body">
      <div class="field hint" style="margin-bottom:14px;">Sobre ${totalConteo} activos, considerando los demás filtros que tengas activos ahora.</div>
      <div class="kpi-breakdown">
        ${filas.map(f=>`
          <div class="kpi-breakdown-row">
            <div class="kpi-breakdown-label">${esc(labelOpcionFiltro(campo, f.op))}</div>
            <div class="kpi-breakdown-bar-track"><div class="kpi-breakdown-bar" style="width:${(f.n/max*100).toFixed(1)}%"></div></div>
            <div class="kpi-breakdown-num">${f.n}</div>
          </div>`).join("") || '<div class="empty-state"><div class="big">—</div>No hay datos para mostrar.</div>'}
      </div>
    </div>
    <div class="modal-footer"><button class="btn modal-close">Cerrar</button></div>
  </div>`;
  abrirModal(html);
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
      <button class="btn" id="btn-columnas">☰ Columnas</button>
      <button class="btn" id="btn-exportar">⭳ Exportar a Excel</button>
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
  actualizarTablaYResumen();

  document.getElementById("f-texto").addEventListener("input", e=>{
    state.filtros.texto = e.target.value;
    actualizarTablaYResumen();
  });
  const btnNuevo = document.getElementById("btn-nuevo");
  if(btnNuevo) btnNuevo.addEventListener("click", ()=>abrirFormActivo(null));
  document.getElementById("btn-exportar").addEventListener("click", exportarActivosCSV);
  document.getElementById("btn-columnas").addEventListener("click", abrirGestorColumnas);
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
      <div class="kpi-text"><div class="num">${agregadosKpi.disponibles}</div><div class="lbl">Disponibles (sin custodio)</div></div>
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
  return `<div class="filter-panel">
    <div class="filter-panel-card">
      <div class="filter-panel-titlebar">Filtrar ${esc(nombreCol)}</div>
      <div class="filter-panel-card-inner">
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
  const { sortCampo, filterCampo, label, ordenable, opcionesChecklist, campoTexto, placeholderTexto, colClass, widthPct } = o;
  const filaLabel = ordenable
    ? `<span class="th-label th-sortable" data-sort="${sortCampo}">${label}${flechaOrden(sortCampo)}</span>`
    : `<span class="th-label">${label}</span>`;
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
  const filaTexto = campoTexto
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
      campoTexto:c.campoTexto, placeholderTexto:c.placeholder,
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
    if(accion==="custodio") abrirCambioCustodio(id);
    if(accion==="baja") abrirConfirmarBaja(id);
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
function exportarActivosCSV(){
  const datos = cargarActivos();
  const lista = listaOrdenadaFiltrada(datos);
  const headers = ["Tag","Tipo","Marca","Modelo","Serie","Nombre dispositivo","Propiedad",
    "Custodio","Tipo de custodio","Cargo","Sistema operativo","RAM (GB)","Disco (GB)",
    "Procesador","Proveedor","Fecha adquisición","MAC WiFi","MAC Ethernet"];
  const filas = lista.map(a=>[
    fmtTag(a.id), a.tipo||"", a.marca||"", a.modelo||"", a.serie||"", a.nombre_dispositivo||"",
    a.propiedad||"", a.custodio?a.custodio.nombre:"Disponible", a.custodio?a.custodio.tipo_custodio:"",
    a.custodio?(a.custodio.cargo||""):"", a.sistema_operativo||"", a.ram_gb??"", a.disco_gb??"",
    a.procesador||"", a.proveedor||"", a.fecha_adquisicion||"", a.mac_wifi||"", a.mac_ethernet||"",
  ]);
  const csvEscape = v => { const s=String(v); return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s; };
  const lineas = [headers, ...filas].map(fila=>fila.map(csvEscape).join(","));
  const csv = "\uFEFF" + lineas.join("\r\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "activos_lukmar_" + hoyISO() + ".csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  registrarLog("exportar", `Se exportaron ${lista.length} activos (según filtros activos) a CSV/Excel.`);
}

// ---------- Iconos SVG por tipo de activo (línea, un color distintivo por tipo) ----------
const ICONOS_TIPO = {
  laptop: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.4"/><path d="M2 19h20"/></svg>`,
  // Desktop: monitor cuadrado sobre un cuello y una base ancha (silueta de "monitor con pie").
  desktop: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3.5" width="16" height="11" rx="1.3"/><path d="M10.3 14.5v3.3M13.7 14.5v3.3"/><path d="M8 20.3h8"/></svg>`,
  celular: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="6.5" y="2" width="11" height="20" rx="2"/><path d="M10 18h4"/></svg>`,
  impresora: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 9V3.5h11V9"/><rect x="4" y="9" width="16" height="7.5" rx="1"/><path d="M6.5 16.5V20h11v-3.5"/></svg>`,
  scanner: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="11" rx="1"/><path d="M3 10.5h18"/></svg>`,
  // Plotter: bandeja/base ancha con una línea de trazo en zigzag y la punta del lápiz marcada.
  plotter: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="14.5" width="18" height="5.5" rx="1"/><path d="M6 14.5l2.6-8.5h2.4l1.8 4.6 1.8-2.6h2.2"/><circle cx="17.8" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>`,
  // SmartTV: pantalla ancha y plana en un pie centrado delgado, con un triángulo de "play" — se distingue del monitor de Desktop.
  smarttv: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="2.3" y="4.7" width="19.4" height="10.3" rx="1.3"/><path d="M9 19.7h6M12 15v4.7"/><path d="M10.2 7.6l4 2.1-4 2.1z" fill="currentColor" stroke="none"/></svg>`,
  generico: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2.2"/><path d="M12 16.2v.01"/><path d="M9.6 9.4a2.4 2.4 0 1 1 3.6 2.1c-.7.5-1.2 1-1.2 2"/></svg>`,
};
// Un color propio por tipo, para que se distingan de un vistazo en la columna.
// Los tres tipos más comunes usan colores reales de la marca Lukmar.
const COLOR_TIPO = {
  laptop: "#57697C", desktop: "#004DAB", celular: "#007EB2", impresora: "#EC741D",
  scanner: "#74883D", plotter: "#5B4B8A", smarttv: "#2E93C7", generico: "#8B9AAA",
};
function claveTipo(tipo){
  return (tipo||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/\s+/g,"");
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
  if(a.custodio===null) return `<span class="pill pill-good"><span class="pill-dot"></span>Disponible</span>`;
  if(a.custodio.tipo_custodio==="area") return `<span class="pill pill-area"><span class="pill-dot"></span>${esc(a.custodio.nombre)}</span>`;
  return `<span class="pill pill-persona"><span class="pill-dot"></span>${esc(a.custodio.nombre)}</span>`;
}
function colorCustodioActual(a){
  if(a.custodio===null) return "#3E7D4F";
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
  const linea2 = a.custodio.cargo
    ? esc(a.custodio.cargo)
    : (esArea ? "Área / departamento sin especificar" : "Sin cargo registrado");
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
function celdaActivo(col, a){
  switch(col.key){
    case "tag": return `<span class="tag">${fmtTag(a.id)}</span>`;
    case "tipo": return `<span class="tipo-cell"><span class="tipo-icon" style="color:${colorTipo(a.tipo)}">${iconoTipo(a.tipo)}</span>${esc(a.tipo)||'<span class="cell-muted">—</span>'}</span>`;
    case "marca": return celdaTextoRecortado(a.marca);
    case "modelo": return celdaTextoRecortado(a.modelo);
    case "nombre": return celdaTextoRecortado(a.nombre_dispositivo);
    case "custodio": return pillCustodio(a);
    case "cargo": return celdaTextoRecortado(a.custodio ? a.custodio.cargo : null);
    case "propiedad": return pillPropiedad(a.propiedad);
    case "serie": return celdaTextoRecortado(a.serie, "mono");
    case "so": return celdaTextoRecortado(a.sistema_operativo);
    case "fecha": return a.fecha_adquisicion ? fmtFecha(a.fecha_adquisicion) : '<span class="cell-muted">—</span>';
    case "proveedor": return celdaTextoRecortado(a.proveedor);
    case "acciones": return `<div class="cell-actions">
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
  const html = `
    <div class="modal modal-wide">
      <div class="modal-header">
        <h3><span class="tag tag-lg">${fmtTag(a.id)}</span></h3>
        <button class="modal-close">✕</button>
      </div>
      <div class="modal-body">
        <div class="detail-head-v2">
          <div class="detail-profile-card" style="background:${gradienteCustodioActual(a)};border-color:${colorCustodioActual(a)}40;">
            <div class="detail-icon-big" style="color:${colorTipo(a.tipo)}">${iconoTipoTam(a.tipo, 40)}</div>
            ${bloquePerfilCustodio(a)}
          </div>
          <div class="detail-badges-grid">
            ${tarjetaBadge("Modelo", esc(a.modelo)||'—', "#004DAB")}
            ${tarjetaBadge("Nombre", esc(a.nombre_dispositivo)||'—', "#007EB2")}
            ${tarjetaBadge("Propiedad", `<span style="color:${(COLOR_PROPIEDAD[a.propiedad]||{fg:'#57697C'}).fg}">${esc(capitalizar(a.propiedad))}</span>`, (COLOR_PROPIEDAD[a.propiedad]||{fg:"#57697C"}).fg)}
            ${tarjetaBadge("Tipo", esc(a.tipo)||'—', colorTipo(a.tipo))}
          </div>
        </div>

        <div class="kv-grid">
          <div class="kv"><div class="k">Marca</div><div class="v">${esc(a.marca)||'—'}</div></div>
          <div class="kv"><div class="k">Serie</div><div class="v mono">${esc(a.serie)||'—'}</div></div>
          <div class="kv"><div class="k">Sistema operativo</div><div class="v">${esc(a.sistema_operativo)||'—'}</div></div>
          <div class="kv"><div class="k">RAM</div><div class="v">${a.ram_gb?a.ram_gb+' GB':'—'}</div></div>
          <div class="kv"><div class="k">Almacenamiento</div><div class="v">${a.disco_gb?a.disco_gb+' GB':'—'}</div></div>
          <div class="kv"><div class="k">Procesador</div><div class="v">${esc(a.procesador)||'—'}</div></div>
          <div class="kv"><div class="k">Proveedor</div><div class="v">${esc(a.proveedor)||'—'}</div></div>
          <div class="kv"><div class="k">MAC WiFi</div><div class="v mono">${esc(a.mac_wifi)||'—'}</div></div>
          <div class="kv"><div class="k">MAC Ethernet</div><div class="v mono">${esc(a.mac_ethernet)||'—'}</div></div>
          <div class="kv"><div class="k">Fecha de adquisición</div><div class="v">${fmtFecha(a.fecha_adquisicion)}</div></div>
          ${a.celular ? `<div class="kv"><div class="k">Gmail asociado</div><div class="v mono">${esc(a.celular.gmail)||'—'}</div></div>` : ""}
        </div>

        <div class="section-title">Historial de custodia (más reciente primero)</div>
        <div class="timeline">
          ${a.historial_custodia.map((t,i)=>tramoHtml(a,t,i)).join("") || '<div class="cell-muted">Sin historial registrado.</div>'}
        </div>
      </div>
      <div class="modal-footer">
        ${puede("editar_activo") ? `<button class="btn" id="btn-editar-activo">Editar datos base</button>` : ""}
        ${puede("cambiar_custodio") ? `<button class="btn btn-primary" id="btn-cambiar-custodio">Cambiar custodio</button>` : ""}
        ${puede("dar_baja") ? `<button class="btn btn-danger" id="btn-dar-baja">Dar de baja</button>` : ""}
      </div>
    </div>`;
  abrirModal(html, ()=>{
    const be = document.getElementById("btn-editar-activo");
    if(be) be.addEventListener("click", ()=>abrirFormActivo(a.id));
    const bc = document.getElementById("btn-cambiar-custodio");
    if(bc) bc.addEventListener("click", ()=>abrirCambioCustodio(a.id));
    const bb = document.getElementById("btn-dar-baja");
    if(bb) bb.addEventListener("click", ()=>abrirConfirmarBaja(a.id));
    document.querySelectorAll("[data-editar-tramo]").forEach(b=>{
      b.addEventListener("click", ()=>abrirEditarTramo(a.id, Number(b.dataset.editarTramo)));
    });
  });
}

function tramoHtml(a, t, i){
  const tipoLbl = t.tipo_custodio==="area" ? "Área / departamento" : "Persona";
  return `<div class="titem ${i===0?'current':''}">
    <div class="titem-row">
      <div>
        <div class="titem-name">${esc(t.nombre)} <span class="pill ${t.tipo_custodio==='area'?'pill-area':'pill-persona'}" style="margin-left:6px;">${tipoLbl}</span></div>
        <div class="titem-meta">${t.cargo?esc(t.cargo)+' · ':''}${fmtFecha(t.desde)} → ${t.hasta?fmtFecha(t.hasta):'presente'}${t.tipo_devolucion?' · '+labelTipoDevolucion(t.tipo_devolucion).split(' (')[0]:''}</div>
        ${t.observacion ? `<div class="titem-observacion">“${esc(t.observacion)}”</div>` : ""}
      </div>
      <div class="titem-actions">
        ${puede("editar_historial") ? `<button class="btn btn-sm" data-editar-tramo="${i}">Editar</button>` : ""}
      </div>
    </div>
  </div>`;
}

/* ---------- Formulario alta / edición de activo ---------- */
function abrirFormActivo(id){
  const datos = cargarActivos();
  const a = id ? buscarActivo(datos, id) : null;
  const esNuevo = !a;
  const html = `
    <div class="modal modal-wide">
      <div class="modal-header"><h3>${esNuevo?'Nuevo activo':'Editar ' + fmtTag(a.id)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <form id="form-activo">
          <div class="form-grid">
            <div class="field"><label>Tipo</label><input type="text" id="fa-tipo" value="${esc(a?a.tipo:'')}" placeholder="Laptop, Desktop, Celular…"></div>
            <div class="field"><label>Propiedad</label>
              <select id="fa-propiedad" required>
                <option value="propio" ${(!a||a.propiedad==='propio')?'selected':''}>Propio</option>
                <option value="rentado" ${a&&a.propiedad==='rentado'?'selected':''}>Rentado</option>
                <option value="externo" ${a&&a.propiedad==='externo'?'selected':''}>Externo</option>
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
            <div class="field"><label>Fecha de adquisición</label><input type="date" id="fa-fecha" value="${a&&a.fecha_adquisicion?a.fecha_adquisicion:''}"></div>
          </div>
          <fieldset style="margin-top:14px;" id="fs-celular">
            <legend>Datos de celular (solo si tipo = Celular)</legend>
            <div class="form-grid">
              <div class="field"><label>Gmail</label><input type="text" id="fa-gmail" class="mono" value="${a&&a.celular?esc(a.celular.gmail):''}"></div>
              <div class="field"><label>Password</label><input type="text" id="fa-password" class="mono" value="${a&&a.celular?esc(a.celular.password):''}"></div>
            </div>
          </fieldset>
          <div class="field hint" style="margin-top:10px;">
            ${esNuevo ? "El activo se crea sin custodio (disponible). Usa \"Cambiar custodio\" desde el detalle para asignarlo." : "Para cambiar el custodio, usa el botón \"Cambiar custodio\" del detalle — este formulario solo edita los datos base del equipo."}
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn modal-close">Cancelar</button>
        <button class="btn btn-primary" id="btn-guardar-activo">${esNuevo?'Crear activo':'Guardar cambios'}</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-guardar-activo").addEventListener("click", ()=>{
      const campos = {
        tipo: document.getElementById("fa-tipo").value.trim(),
        propiedad: document.getElementById("fa-propiedad").value,
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
        fecha_adquisicion: document.getElementById("fa-fecha").value,
        gmail: document.getElementById("fa-gmail").value.trim(),
        password: document.getElementById("fa-password").value.trim(),
      };
      if(esNuevo){
        const nuevoId = crearActivo(campos);
        cerrarModal(); renderMain(); abrirDetalle(nuevoId);
      } else {
        editarActivoBase(a.id, campos);
        cerrarModal(); renderMain(); abrirDetalle(a.id);
      }
    });
  });
}

/* ---------- Cambio de custodio ---------- */
function abrirCambioCustodio(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const tieneVigente = a.historial_custodia.length > 0;
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Cambiar custodio — ${fmtTag(a.id)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        ${tieneVigente ? `
          <div class="alert alert-info">Custodio actual: <strong>${esc(a.custodio?a.custodio.nombre:'Disponible')}</strong>. Al confirmar, este tramo se cierra hoy.</div>
          <div class="form-grid" style="margin-bottom:14px;">
            <div class="field"><label>Tipo de devolución del custodio saliente</label>
              <select id="cc-tipodev">
                <option value="">— Selecciona —</option>
                ${TIPOS_DEVOLUCION.map(t=>`<option value="${t.v}">${t.label}</option>`).join("")}
              </select>
            </div>
            <div class="field"><label>Fecha del cambio</label><input type="date" id="cc-fecha" value="${hoyISO()}"></div>
            <div class="field span-2"><label>Observación de la entrega (opcional)</label><textarea id="cc-observacion" placeholder="Ej: equipo entregado con un rayón en la tapa, cargador incluido…"></textarea></div>
          </div>
        ` : `
          <div class="form-grid" style="margin-bottom:14px;">
            <div class="field"><label>Fecha del cambio</label><input type="date" id="cc-fecha" value="${hoyISO()}"></div>
          </div>
        `}
        <fieldset>
          <legend>Nuevo custodio</legend>
          <div class="form-grid">
            <div class="field"><label>Tipo</label>
              <select id="cc-tipo">
                <option value="persona">Persona</option>
                <option value="area">Área / departamento</option>
              </select>
            </div>
            <div class="field"><label>Nombre</label><input type="text" id="cc-nombre" placeholder="Nombre de la persona o del área"></div>
            <div class="field span-2"><label>Cargo (opcional)</label><input type="text" id="cc-cargo"></div>
          </div>
        </fieldset>
        <div class="field hint" style="margin-top:10px;">Si el activo va a quedar sin custodio (disponible), déjalo así y usa el botón "Marcar disponible" en su lugar.</div>
      </div>
      <div class="modal-footer">
        ${tieneVigente ? `<button class="btn btn-danger" id="btn-liberar">Marcar disponible</button>` : ""}
        <button class="btn modal-close">Cancelar</button>
        <button class="btn btn-primary" id="btn-confirmar-custodio">Confirmar cambio</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-confirmar-custodio").addEventListener("click", ()=>{
      const nombre = document.getElementById("cc-nombre").value.trim();
      if(!nombre){ alert("Ingresa el nombre del nuevo custodio."); return; }
      const tipoDev = tieneVigente ? document.getElementById("cc-tipodev").value : null;
      if(tieneVigente && !tipoDev){ alert("Selecciona el tipo de devolución del custodio saliente."); return; }
      const fecha = document.getElementById("cc-fecha").value || hoyISO();
      const observacion = tieneVigente ? document.getElementById("cc-observacion").value.trim() : "";
      cambiarCustodio(id, {
        tipo_custodio: document.getElementById("cc-tipo").value,
        nombre, cargo: document.getElementById("cc-cargo").value.trim(),
      }, tipoDev, fecha, observacion);
      cerrarModal(); renderMain(); abrirDetalle(id);
    });
    const bl = document.getElementById("btn-liberar");
    if(bl) bl.addEventListener("click", ()=>{
      const tipoDev = document.getElementById("cc-tipodev").value;
      if(!tipoDev){ alert("Selecciona el tipo de devolución antes de marcar disponible."); return; }
      const fecha = document.getElementById("cc-fecha").value || hoyISO();
      const observacion = document.getElementById("cc-observacion").value.trim();
      liberarCustodio(id, tipoDev, fecha, observacion);
      cerrarModal(); renderMain(); abrirDetalle(id);
    });
  });
}

/* ---------- Editar tramo antiguo del historial ---------- */
function abrirEditarTramo(id, index){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  const t = a.historial_custodia[index];
  if(!t) return;
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Editar tramo #${index+1} — ${fmtTag(id)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field"><label>Tipo</label>
            <select id="et-tipo">
              <option value="persona" ${t.tipo_custodio==='persona'?'selected':''}>Persona</option>
              <option value="area" ${t.tipo_custodio==='area'?'selected':''}>Área / departamento</option>
            </select>
          </div>
          <div class="field"><label>Nombre</label><input type="text" id="et-nombre" value="${esc(t.nombre)}"></div>
          <div class="field"><label>Cargo</label><input type="text" id="et-cargo" value="${esc(t.cargo)}"></div>
          <div class="field"><label>Desde</label><input type="date" id="et-desde" value="${t.desde||''}"></div>
          <div class="field"><label>Hasta</label><input type="date" id="et-hasta" value="${t.hasta||''}" ${index===0?'disabled':''}></div>
          <div class="field"><label>Tipo de devolución</label>
            <select id="et-tipodev" ${index===0?'disabled':''}>
              <option value="">— Ninguno —</option>
              ${TIPOS_DEVOLUCION.map(x=>`<option value="${x.v}" ${t.tipo_devolucion===x.v?'selected':''}>${x.label}</option>`).join("")}
            </select>
          </div>
          <div class="field span-2"><label>Observación de la entrega</label><textarea id="et-observacion" ${index===0?'disabled':''} placeholder="${index===0?'Se habilita cuando este tramo se cierre':''}">${esc(t.observacion)}</textarea></div>
        </div>
        ${index===0 ? `<div class="field hint" style="margin-top:8px;">Este es el tramo vigente: "Hasta", "Tipo de devolución" y "Observación" quedan bloqueados porque aún no ha terminado.</div>` : ""}
      </div>
      <div class="modal-footer">
        <button class="btn modal-close">Cancelar</button>
        <button class="btn btn-primary" id="btn-guardar-tramo">Guardar</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-guardar-tramo").addEventListener("click", ()=>{
      editarTramoHistorial(id, index, {
        tipo_custodio: document.getElementById("et-tipo").value,
        nombre: document.getElementById("et-nombre").value.trim(),
        cargo: document.getElementById("et-cargo").value.trim(),
        desde: document.getElementById("et-desde").value,
        hasta: index===0 ? null : document.getElementById("et-hasta").value,
        tipo_devolucion: index===0 ? null : document.getElementById("et-tipodev").value,
        observacion: index===0 ? null : document.getElementById("et-observacion").value.trim(),
      });
      cerrarModal(); renderMain(); abrirDetalle(id);
    });
  });
}

/* ---------- Dar de baja ---------- */
function abrirConfirmarBaja(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const html = `
    <div class="modal">
      <div class="modal-header"><h3>Dar de baja — ${fmtTag(id)}</h3><button class="modal-close">✕</button></div>
      <div class="modal-body">
        <div class="alert alert-error">Esta acción retira el activo del inventario activo. Queda archivado en la bitácora de bajas, desde donde se puede restaurar si es necesario.</div>
        <div class="field"><label>Motivo</label><textarea id="baja-motivo" placeholder="Ej: equipo dañado sin reparación posible, obsoleto, robado…"></textarea></div>
      </div>
      <div class="modal-footer">
        <button class="btn modal-close">Cancelar</button>
        <button class="btn btn-danger" id="btn-confirmar-baja">Dar de baja</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("btn-confirmar-baja").addEventListener("click", ()=>{
      darDeBaja(id, document.getElementById("baja-motivo").value.trim());
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
              <td><span class="tag tag-baja">${fmtTag(b.activo.id)}</span></td>
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
    b.addEventListener("click", ()=>{
      restaurarBaja(Number(b.dataset.restaurar));
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
  document.getElementById("btn-guardar-permisos").addEventListener("click", ()=>{
    const nueva = {};
    roles.forEach(r=>{ nueva[r]={}; });
    content.querySelectorAll("input[type=checkbox]").forEach(cb=>{
      nueva[cb.dataset.rol][cb.dataset.accion] = cb.checked;
    });
    guardarPermisos(nueva);
    registrarLog("editar_permisos", "Se actualizó la matriz de permisos.");
    alert("Matriz de permisos guardada.");
  });
  document.getElementById("btn-agregar-rol").addEventListener("click", ()=>{
    const nombre = document.getElementById("nuevo-rol").value.trim().toLowerCase();
    if(!nombre){ return; }
    if(nombre===ROL_ADMIN || matriz[nombre]){ alert("Ese nombre de rol ya existe."); return; }
    matriz[nombre] = {}; ACCIONES.forEach(a=>matriz[nombre][a.id]=false);
    guardarPermisos(matriz);
    registrarLog("editar_permisos", `Se creó el rol "${nombre}".`);
    renderVistaConfig(document.getElementById("main"));
  });
}

function renderConfigUsuarios(content){
  const usuarios = cargarUsuarios();
  const matriz = cargarPermisos();
  const roles = [ROL_ADMIN, ...Object.keys(matriz)];
  content.innerHTML = `
    <div class="tablewrap" style="margin-bottom:14px;">
      <table>
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th></th></tr></thead>
        <tbody>
          ${usuarios.map((u,i)=>`<tr>
            <td class="mono">${esc(u.usuario)}</td>
            <td>${esc(u.nombre_completo)}</td>
            <td><span class="rolebadge rol-${esc(u.rol)}">${esc(u.rol)}</span></td>
            <td class="cell-actions">
              ${u.usuario!==state.sesion.usuario ? `<button class="btn btn-sm btn-danger" data-borrar-usuario="${i}">Eliminar</button>` : `<span class="cell-muted">(tú)</span>`}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <fieldset>
      <legend>Nuevo usuario</legend>
      <div class="form-grid">
        <div class="field"><label>Usuario</label><input type="text" id="nu-usuario"></div>
        <div class="field"><label>Contraseña</label><input type="text" id="nu-password"></div>
        <div class="field"><label>Nombre completo</label><input type="text" id="nu-nombre"></div>
        <div class="field"><label>Rol</label><select id="nu-rol">${roles.map(r=>`<option value="${esc(r)}">${esc(r)}</option>`).join("")}</select></div>
      </div>
      <button class="btn btn-primary" id="btn-crear-usuario" style="margin-top:10px;">Crear usuario</button>
    </fieldset>`;
  content.querySelectorAll("[data-borrar-usuario]").forEach(b=>{
    b.addEventListener("click", ()=>{
      const idx = Number(b.dataset.borrarUsuario);
      const lista = cargarUsuarios();
      const eliminado = lista.splice(idx,1)[0];
      guardarUsuarios(lista);
      registrarLog("editar_usuarios", `Se eliminó el usuario "${eliminado.usuario}".`);
      renderVistaConfig(document.getElementById("main"));
    });
  });
  document.getElementById("btn-crear-usuario").addEventListener("click", ()=>{
    const usuario = document.getElementById("nu-usuario").value.trim();
    const password = document.getElementById("nu-password").value.trim();
    const nombre_completo = document.getElementById("nu-nombre").value.trim();
    const rol = document.getElementById("nu-rol").value;
    if(!usuario || !password || !nombre_completo){ alert("Completa usuario, contraseña y nombre."); return; }
    const lista = cargarUsuarios();
    if(lista.some(u=>u.usuario===usuario)){ alert("Ese usuario ya existe."); return; }
    lista.push({usuario,password,rol,nombre_completo});
    guardarUsuarios(lista);
    registrarLog("editar_usuarios", `Se creó el usuario "${usuario}" con rol "${rol}".`);
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
    await asegurarSemilla();
  }catch(err){
    root.innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="alert alert-error">No se pudo cargar <code>data.json</code>. Si abriste este archivo con doble clic (file://), súbelo a un servidor o a GitHub Pages — los navegadores bloquean fetch() de archivos locales.<br><br>Detalle: ${err.message}</div>
    </div></div>`;
    return;
  }
  cargarUsuarios(); cargarPermisos();
  iniciarSesionGuardada();
  inyectarDecoracionFondo();
  render();
})();
