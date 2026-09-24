export const SUPABASE_URL = "https://tavyirvdfbetblprhtbo.supabase.co";

export const SUPABASE_KEY = "sb_publishable_-AXUgStuUjI8JENtt3BzUg_aDmlQPqX";

if(!window.supabase){
  const root = document.getElementById("inventario-tecnologico-app");
  if(root) root.innerHTML = `<div class="inventario-tecnologico-login-wrap"><div class="inventario-tecnologico-login-card">
    <div class="inventario-tecnologico-alert inventario-tecnologico-alert-error">No se pudo cargar la librería de Supabase desde cdn.jsdelivr.net.<br><br>Revisa tu conexión a internet, o si un bloqueador de anuncios / firewall está impidiendo la carga de ese dominio, y recarga la página.</div>
  </div></div>`;
  throw new Error("supabase-js no se cargó (revisa la etiqueta <script> de cdn.jsdelivr.net en index.html)");
}

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

export const DOMINIO_USUARIO_INTERNO = "@lukmar.local";

export const LOGO_MARK_SRC = "assets/img/logo-mark.png";

export const LOGO_FULL_SRC = "assets/img/logo-full.png";

export const ACCIONES = [
  { id:"ver_listado",      label:"Ver listado de activos" },
  { id:"ver_detalle",      label:"Ver detalle e historial de un activo" },
  { id:"crear_activo",     label:"Crear un nuevo activo" },
  { id:"editar_activo",    label:"Editar campos base de un activo" },
  { id:"cambiar_custodio", label:"Registrar cambio de custodio" },
  { id:"editar_historial", label:"Editar un tramo antiguo del historial" },
  { id:"dar_baja",         label:"Dar de baja un activo" },
  { id:"restaurar_baja",   label:"Restaurar un activo dado de baja" },
  { id:"ver_bajas",        label:"Consultar la bitácora de bajas" },
  // Mapa (migración 002). Crear/editar ubicaciones, equipos y enlaces no va
  // aquí: es solo del administrador (esAdmin() + RLS con es_admin()).
  { id:"ver_mapa",          label:"Ver el mapa de ubicaciones y radioenlaces" },
  { id:"asignar_ubicacion", label:"Asignar o mover activos entre ubicaciones" },
];

export const ROL_ADMIN = "administrador";
