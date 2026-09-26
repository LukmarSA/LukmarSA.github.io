// Segundo nivel de modal: se abre ENCIMA de un modal ya abierto sin borrarlo.
// abrirModal() (render-raiz.js) tiene un solo host y reemplaza lo que haya;
// esto lo usa "Nuevo activo" para crear un tipo o una propiedad sin perder lo
// que ya se escribió en el formulario de abajo.
//
// Teclado: Esc y Tab se atienden acá, en fase de captura, y no siguen. Así Esc
// cierra solo el submodal (no el formulario de abajo) y Tab queda atrapado
// adentro. Al cerrar, el foco vuelve al botón que lo abrió.

const P = "inventario-tecnologico-";
const SELECTOR_FOCO = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DURACION_SALIDA = 160;

let actual = null; // { host, origen, alTeclado, alCerrar }

export function haySubmodal(){ return !!actual; }

function sinMovimiento(){
  try{ return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch(e){ return false; }
}

// html = un .inventario-tecnologico-modal completo. Los botones con
// data-submodal-cerrar lo cierran. alMontar(host) cablea el contenido.
export function abrirSubmodal(html, { origen = null, alMontar = null, alCerrar = null } = {}){
  if(actual) cerrarSubmodal({ devolverFoco: false });
  // Uno que todavía se está desvaneciendo se quita ya: si no, sus campos
  // (con los mismos id) quedarían antes que los del nuevo en el documento.
  document.querySelectorAll(`.${P}submodal-saliendo`).forEach(h=>h.remove());
  const host = document.createElement("div");
  host.id = `${P}submodal-host`;
  host.className = `${P}submodal-host`;
  host.innerHTML = `<div class="${P}modal-backdrop ${P}submodal-backdrop">${html}</div>`;
  document.body.appendChild(host);
  const fondo = host.firstElementChild;
  fondo.addEventListener("mousedown", e=>{ if(e.target === fondo) cerrarSubmodal(); });
  host.querySelectorAll("[data-submodal-cerrar]").forEach(b=>b.addEventListener("click", ()=>cerrarSubmodal()));
  const alTeclado = e=>{
    if(!actual || actual.host !== host) return;
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cerrarSubmodal(); return; }
    if(e.key !== "Tab") return;
    e.stopPropagation(); // que no lo atrape también el modal de abajo
    const focos = [...host.querySelectorAll(SELECTOR_FOCO)].filter(el=>el.offsetParent !== null);
    if(!focos.length){ e.preventDefault(); return; }
    const primero = focos[0], ultimo = focos[focos.length - 1];
    const dentro = host.contains(document.activeElement);
    if(e.shiftKey){
      if(!dentro || document.activeElement === primero){ e.preventDefault(); ultimo.focus(); }
    } else if(!dentro || document.activeElement === ultimo){ e.preventDefault(); primero.focus(); }
  };
  window.addEventListener("keydown", alTeclado, true);
  actual = { host, origen, alTeclado, alCerrar };
  if(alMontar) alMontar(host);
  const campo = host.querySelector('input:not([disabled]):not([type="hidden"]):not([type="color"]), textarea:not([disabled])') || host.querySelector(SELECTOR_FOCO);
  if(campo) campo.focus();
  return host;
}

export function cerrarSubmodal({ devolverFoco = true } = {}){
  if(!actual) return;
  const { host, origen, alTeclado, alCerrar } = actual;
  actual = null;
  window.removeEventListener("keydown", alTeclado, true);
  // Sale con un desvanecido corto; el id se libera ya, por si se abre otro.
  host.removeAttribute("id");
  host.classList.add(`${P}submodal-saliendo`);
  host.style.pointerEvents = "none";
  setTimeout(()=>host.remove(), sinMovimiento() ? 0 : DURACION_SALIDA);
  if(devolverFoco && origen && origen.isConnected) origen.focus();
  if(alCerrar) alCerrar();
}
