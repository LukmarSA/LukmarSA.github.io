import { LOGO_MARK_SRC, sb } from "./nucleo/config.js";
import { refrescarDatos } from "./nucleo/datos.js";
import { iniciarSesionGuardada, state } from "./nucleo/estado.js";
import { actualizarTablaYResumen } from "./ui/listado/tabla.js";
import { render, root } from "./ui/render-raiz.js";

export function inyectarDecoracionFondo(){
  if(document.getElementById("inventario-tecnologico-app-decor")) return;
  const decor = document.createElement("div");
  decor.id = "inventario-tecnologico-app-decor";
  decor.innerHTML = `<img src="${LOGO_MARK_SRC}" alt="">`;
  document.body.appendChild(decor);
}

export let resizeTimeout = null;

window.addEventListener("resize", ()=>{
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(()=>{
    if(state.sesion && state.vista === "activos" && state.filtros.texto) actualizarTablaYResumen();
  }, 200);
});

// Punto de entrada real de la app (antes una IIFE anónima autoejecutada al
// final del único app.js). Ahora es una función exportada de verdad porque
// entrada.js necesita poder llamarla explícitamente después de armar
// window.InventarioTecnologico — nada más cambia de comportamiento.
export async function iniciar(){
  root.innerHTML = `<div class="inventario-tecnologico-login-wrap"><div class="inventario-tecnologico-login-sub">Cargando inventario…</div></div>`;
  try{
    await iniciarSesionGuardada();
    if(state.sesion) await refrescarDatos();
  }catch(err){
    root.innerHTML = `<div class="inventario-tecnologico-login-wrap"><div class="inventario-tecnologico-login-card">
      <div class="inventario-tecnologico-alert inventario-tecnologico-alert-error">No se pudo conectar con la base de datos (Supabase). Revisa tu conexión a internet e intenta de nuevo.<br><br>Detalle: ${err.message}</div>
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
}
