import { DOMINIO_USUARIO_INTERNO, sb } from "./config.js";
import { render } from "../ui/render-raiz.js";

export const state = {
  sesion: null,       // { usuario, rol, nombre_completo }
  sesionUid: null,    // uuid de auth.users — para identificar "soy yo" en Configuración → Usuarios
  tiposActivo: [],        // filas de tipos_activo (nombre, icono_svg, color, campos_pertinentes, orden)
  propiedadOpciones: [],  // filas de propiedad_opciones (valor, etiqueta, orden, activo)
  estadoOpciones: [],     // filas de estado_opciones (valor, etiqueta, color_fg, color_bg, orden, activo)
  vista: "activos",   // activos | bajas | mapa | auditoria | config
  mapa: null,         // datos y selección de la pestaña Mapa; lo crea estadoMapa() (nucleo/datos-mapa.js) al abrirla
  configSubtab: "permisos",
  // null en tipo/propiedad/custodioClase = "sin filtrar" (equivale a todas las opciones marcadas).
  filtros: { texto:"", tipo:null, propiedad:null, custodioClase:null, marca:null, estado:null, colTag:"", colTipo:"", colMarca:"", colCustodio:"", colCargo:"", colPropiedad:"", colSerie:"", colSo:"", colProveedor:"", colFechaDesde:"", colFechaHasta:"", colModelo:"", colNombre:"" },
  orden: { campo:"id", dir:"asc" },
  columnasVisibles: new Set(["inventario-tecnologico-tag","tipo","marca","estado","custodio","propiedad","acciones"]), // debe coincidir con COLUMNAS_VISIBLES_DEFAULT más abajo
  modal: null,         // función que renderiza el modal actual, o null
};

export async function iniciarSesionGuardada(){
  const { data: { session } } = await sb.auth.getSession();
  if(!session) { state.sesion = null; return; }
  await cargarSesionDesdePerfil(session.user);
}

export async function cargarSesionDesdePerfil(user){
  const { data: perfil, error } = await sb.from("perfiles").select("rol, nombre_completo").eq("id", user.id).single();
  if(error || !perfil){ state.sesion = null; state.sesionUid = null; return; }
  state.sesionUid = user.id;
  state.sesion = {
    usuario: (user.email||"").replace(DOMINIO_USUARIO_INTERNO, ""),
    rol: perfil.rol,
    nombre_completo: perfil.nombre_completo || perfil.rol,
  };
}

export async function cerrarSesion(){
  await sb.auth.signOut();
  state.sesion = null;
  state.vista = "activos";
  render();
}
