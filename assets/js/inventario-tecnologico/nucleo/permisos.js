import { ROL_ADMIN } from "./config.js";
import { cargarPermisos } from "./datos.js";
import { state } from "./estado.js";

export function puede(accion){
  if(!state.sesion) return false;
  if(state.sesion.rol === ROL_ADMIN) return true;
  const matriz = cargarPermisos();
  const rolPerm = matriz[state.sesion.rol];
  return !!(rolPerm && rolPerm[accion]);
}

export function esAdmin(){
  return !!(state.sesion && state.sesion.rol === ROL_ADMIN);
}
