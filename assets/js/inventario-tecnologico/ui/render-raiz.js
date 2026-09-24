import { DOMINIO_USUARIO_INTERNO, LOGO_FULL_SRC, LOGO_MARK_SRC, ROL_ADMIN, sb } from "../nucleo/config.js";
import { refrescarDatos } from "../nucleo/datos.js";
import { cargarSesionDesdePerfil, cerrarSesion, state } from "../nucleo/estado.js";
import { esc } from "../nucleo/helpers.js";
import { puede } from "../nucleo/permisos.js";
import { renderVistaConfig } from "./configuracion/permisos-usuarios.js";
import { abrirPanelPortapapeles, actualizarBadgePortapapeles } from "./detalle/acta.js";
import { renderVistaActivos } from "./listado/tabla.js";
import { renderVistaAuditoria } from "./vista-auditoria.js";
import { renderVistaBajas } from "./vista-bajas.js";
import { destruirVistaMapa, renderVistaMapa } from "./vista-mapa.js";

export const root = document.getElementById("inventario-tecnologico-app");

export function render(){
  if(!state.sesion){ renderLogin(); return; }
  renderAppShell();
}

export function renderLogin(errorMsg){
  root.innerHTML = `
    <div class="inventario-tecnologico-login-wrap">
      <div class="inventario-tecnologico-login-decor inventario-tecnologico-login-decor-1"></div>
      <div class="inventario-tecnologico-login-decor inventario-tecnologico-login-decor-2"></div>
      <div class="inventario-tecnologico-login-decor inventario-tecnologico-login-decor-3"></div>
      <div class="inventario-tecnologico-login-decor inventario-tecnologico-login-watermark" style="background-image:url(${LOGO_MARK_SRC})"></div>
      <img class="inventario-tecnologico-login-logo-hero" src="${LOGO_FULL_SRC}" alt="Lukmar">
      <div class="inventario-tecnologico-login-card">
        <div class="inventario-tecnologico-login-title">Inventario de Activos</div>
        <div class="inventario-tecnologico-login-sub">Ingresa con tu usuario para continuar.</div>
        ${errorMsg ? `<div class="inventario-tecnologico-alert inventario-tecnologico-alert-error">${esc(errorMsg)}</div>` : ""}
        <form id="inventario-tecnologico-form-login" method="post">
          <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-login-usuario">Usuario</label><input type="text" id="inventario-tecnologico-login-usuario" name="username" autocomplete="username" required></div>
          <div class="inventario-tecnologico-field"><label for="inventario-tecnologico-login-password">Contraseña</label><input type="password" id="inventario-tecnologico-login-password" name="password" autocomplete="current-password" required></div>
          <button type="submit" id="inventario-tecnologico-btn-login-submit" class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" style="width:100%;margin-top:6px;">Ingresar</button>
        </form>
        <div class="inventario-tecnologico-login-hint">
          Inicio de sesión real: tu contraseña viaja cifrada y se verifica en Supabase, no en este navegador.
        </div>
      </div>
    </div>`;
  document.getElementById("inventario-tecnologico-form-login").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const u = document.getElementById("inventario-tecnologico-login-usuario").value.trim();
    const p = document.getElementById("inventario-tecnologico-login-password").value;
    const btn = document.getElementById("inventario-tecnologico-btn-login-submit");
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
    document.getElementById("inventario-tecnologico-toast-guardar")?.remove();
    render();
  });
  // Si el navegador guarda usuario/contraseña, normalmente los autocompleta sin
  // necesitar foco en los campos. Enfocamos directo el botón "Ingresar" para
  // que, si ya están rellenos, baste con Enter — sin tocar el mouse ni el teclado
  // en los inputs. Si no hay nada guardado, Enter simplemente dispara la
  // validación nativa del formulario (pide completar los campos vacíos).
  document.getElementById("inventario-tecnologico-btn-login-submit").focus();
  mostrarToastGuardarPasswordSiCorresponde();
}

export const ICONO_CANDADO = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9" rx="1.6"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/><circle cx="12" cy="15" r="1.1" fill="currentColor" stroke="none"/></svg>`;

export function mostrarToastGuardarPasswordSiCorresponde(){
  setTimeout(()=>{
    const u = document.getElementById("inventario-tecnologico-login-usuario");
    const p = document.getElementById("inventario-tecnologico-login-password");
    if(!u || !p) return; // ya se navegó a otra vista
    if(u.value || p.value) return; // el navegador ya autocompletó: no hace falta el aviso
    const toast = document.createElement("div");
    toast.className = "inventario-tecnologico-toast";
    toast.id = "inventario-tecnologico-toast-guardar";
    toast.innerHTML = `
      <span class="inventario-tecnologico-toast-icon">${ICONO_CANDADO}</span>
      <span class="inventario-tecnologico-toast-text">
        <span class="inventario-tecnologico-toast-title">Guarda tu acceso</span>
        <span class="inventario-tecnologico-toast-sub">Escribe tus datos e ingresa una vez — tu navegador puede ofrecer recordarlos, así la próxima vez solo presionas Enter.</span>
      </span>
      <button type="button" class="inventario-tecnologico-toast-close" aria-label="Cerrar">✕</button>`;
    document.body.appendChild(toast);
    const cerrar = ()=>{ toast.classList.add("inventario-tecnologico-toast-out"); setTimeout(()=>toast.remove(), 400); };
    toast.querySelector(".inventario-tecnologico-toast-close").addEventListener("click", cerrar);
    setTimeout(cerrar, 10000);
  }, 700);
}

export function renderAppShell(){
  const s = state.sesion;
  const tabs = [
    {id:"activos", label:"Activos", show:true},
    {id:"bajas", label:"Bajas", show:puede("ver_bajas")},
    {id:"mapa", label:"Mapa", show:puede("ver_mapa")},
    {id:"auditoria", label:"Auditoría", show:s.rol===ROL_ADMIN},
    {id:"config", label:"Configuración", show:s.rol===ROL_ADMIN},
  ].filter(t=>t.show);

  root.innerHTML = `
    <div class="inventario-tecnologico-topbar">
      <div class="inventario-tecnologico-topbar-left">
        <div class="inventario-tecnologico-brand"><img class="inventario-tecnologico-brand-mark-img" src="${LOGO_MARK_SRC}" alt="Lukmar">Inventario LUKMAR</div>
        <div class="inventario-tecnologico-tabs">
          ${tabs.map(t=>`<button class="inventario-tecnologico-tab-btn ${state.vista===t.id?'inventario-tecnologico-active':''}" data-tab="${t.id}">${t.label}</button>`).join("")}
        </div>
      </div>
      <div class="inventario-tecnologico-topbar-right">
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-ghost inventario-tecnologico-btn-sm" id="inventario-tecnologico-badge-portapapeles" title="Activos marcados para acta de entrega">🔖 0</button>
        <div class="inventario-tecnologico-userchip">${esc(s.nombre_completo)} <span class="inventario-tecnologico-rolebadge inventario-tecnologico-rol-${s.rol}">${s.rol}</span></div>
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-ghost inventario-tecnologico-btn-sm" id="inventario-tecnologico-btn-logout">Cerrar sesión</button>
      </div>
    </div>
    <main id="inventario-tecnologico-main"></main>
  `;
  document.getElementById("inventario-tecnologico-badge-portapapeles").addEventListener("click", abrirPanelPortapapeles);
  actualizarBadgePortapapeles();
  document.querySelectorAll("[data-tab]").forEach(b=>b.addEventListener("click", ()=>{
    state.vista = b.dataset.tab; renderMain();
  }));
  document.getElementById("inventario-tecnologico-btn-logout").addEventListener("click", cerrarSesion);
  // Cierra cualquier menú desplegable tipo "Exportar resúmenes" al hacer clic
  // fuera de él — se registra una sola vez aquí (no dentro de renderVistaActivos,
  // que se re-ejecuta con cada renderMain() y duplicaría el listener).
  document.addEventListener("click", ()=>{
    const menu = document.getElementById("inventario-tecnologico-menu-exportar-resumenes");
    if(menu) menu.hidden = true;
  });
  renderMain();
}

export function renderMain(){
  const main = document.getElementById("inventario-tecnologico-main");
  // El resaltado de la pestaña solo se pintaba al armar el shell, así que al
  // cambiar de pestaña (o al saltar al mapa desde "Ver en mapa") se quedaba
  // en la anterior. Se sincroniza aquí, que es por donde pasan todos los cambios.
  document.querySelectorAll("[data-tab]").forEach(b=>b.classList.toggle("inventario-tecnologico-active", b.dataset.tab===state.vista));
  // Leaflet deja listeners en window: se libera el mapa al salir de su pestaña.
  if(state.vista!=="mapa") destruirVistaMapa();
  main.classList.toggle("inventario-tecnologico-main-mapa", state.vista==="mapa");
  if(state.vista==="activos") return renderVistaActivos(main);
  if(state.vista==="bajas") return renderVistaBajas(main);
  if(state.vista==="mapa") return renderVistaMapa(main);
  if(state.vista==="auditoria") return renderVistaAuditoria(main);
  if(state.vista==="config") return renderVistaConfig(main);
}

export const SELECTOR_FOCUSABLE_MODAL = 'a[href], button:not([disabled]), input:not([disabled]):not([type="inventario-tecnologico-hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function obtenerFocusablesModal(){
  const host = document.getElementById("inventario-tecnologico-modal-host");
  if(!host) return [];
  // offsetParent === null descarta elementos con display:none (p.ej. un
  // campo que un fieldset condicional no llegó a mostrar).
  return Array.from(host.querySelectorAll(SELECTOR_FOCUSABLE_MODAL)).filter(el => el.offsetParent !== null);
}

export function primerFocoDelModal(){
  const host = document.getElementById("inventario-tecnologico-modal-host");
  if(!host) return null;
  const campo = host.querySelector('input:not([disabled]):not([type="inventario-tecnologico-hidden"]), select:not([disabled]), textarea:not([disabled])');
  if(campo && campo.offsetParent !== null) return campo;
  const focusables = obtenerFocusablesModal();
  return focusables.length ? focusables[0] : null;
}

export let modalVolver = null;

export function abrirModal(html, onMount){
  modalVolver = null;
  let host = document.getElementById("inventario-tecnologico-modal-host");
  if(!host){
    host = document.createElement("div");
    host.id = "inventario-tecnologico-modal-host";
    document.body.appendChild(host);
  }
  host.innerHTML = `<div class="inventario-tecnologico-modal-backdrop" id="inventario-tecnologico-modal-backdrop">${html}</div>`;
  document.getElementById("inventario-tecnologico-modal-backdrop").addEventListener("mousedown", (e)=>{
    if(e.target.id==="inventario-tecnologico-modal-backdrop") cerrarModal();
  });
  document.querySelectorAll(".inventario-tecnologico-modal-close").forEach(b=>b.addEventListener("click", cerrarModal));
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

export function escCierraModal(e){
  if(e.key === "Escape") cerrarModal();
}

export function atraparTabModal(e){
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

export function cerrarModal(){
  document.removeEventListener("keydown", navegarCarruselTeclado);
  if(modalVolver){ const volver = modalVolver; modalVolver = null; volver(); return; }
  const host = document.getElementById("inventario-tecnologico-modal-host");
  if(host) host.innerHTML = "";
  document.removeEventListener("keydown", escCierraModal);
  document.removeEventListener("keydown", atraparTabModal);
}

export const DURACION_TOAST = { success:4000, info:5500, error:7000 };

export const ICONOS_TOAST = {
  success: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.3 12.3l2.4 2.4 5-5.4"/></svg>`,
  error: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.7"/><circle cx="12" cy="16.3" r="0.9" fill="currentColor" stroke="none"/></svg>`,
  info: `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.3"/><circle cx="12" cy="7.3" r="0.9" fill="currentColor" stroke="none"/></svg>`,
};

export function contenedorToasts(){
  let cont = document.getElementById("inventario-tecnologico-toast-stack");
  if(!cont){
    cont = document.createElement("div");
    cont.id = "inventario-tecnologico-toast-stack";
    cont.className = "inventario-tecnologico-toast-stack";
    document.body.appendChild(cont);
  }
  return cont;
}

export function mostrarToast(mensaje, tipo){
  tipo = (tipo==="success" || tipo==="error") ? tipo : "info";
  const duracion = DURACION_TOAST[tipo];
  const cont = contenedorToasts();
  const el = document.createElement("div");
  el.className = `inventario-tecnologico-toast-notif inventario-tecnologico-toast-notif-${tipo}`;
  el.setAttribute("role", tipo==="error" ? "inventario-tecnologico-alert" : "status");
  el.innerHTML = `
    <span class="inventario-tecnologico-toast-notif-icon">${ICONOS_TOAST[tipo]}</span>
    <span class="inventario-tecnologico-toast-notif-msg">${esc(mensaje)}</span>
    <button type="button" class="inventario-tecnologico-toast-notif-close" aria-label="Cerrar">✕</button>
    <span class="inventario-tecnologico-toast-notif-bar" style="animation-duration:${duracion}ms"></span>`;
  cont.appendChild(el);
  let cerrado = false;
  const cerrar = ()=>{
    if(cerrado) return;
    cerrado = true;
    el.classList.add("inventario-tecnologico-toast-notif-out");
    setTimeout(()=>el.remove(), 300);
  };
  let restante = duracion, inicio = Date.now();
  let temporizador = setTimeout(cerrar, restante);
  const barra = el.querySelector(".inventario-tecnologico-toast-notif-bar");
  el.addEventListener("mouseenter", ()=>{
    clearTimeout(temporizador);
    restante -= (Date.now() - inicio);
    barra.style.animationPlayState = "paused";
  });
  el.addEventListener("mouseleave", ()=>{
    inicio = Date.now();
    temporizador = setTimeout(cerrar, Math.max(300, restante));
    barra.style.animationPlayState = "running";
  });
  el.querySelector(".inventario-tecnologico-toast-notif-close").addEventListener("click", cerrar);
}

export function confirmarAccion(mensaje, textoConfirmar){
  return new Promise((resolve)=>{
    let resuelto = false;
    const resolverUnaVez = (valor)=>{
      if(resuelto) return;
      resuelto = true;
      resolve(valor);
    };
    const html = `<div class="inventario-tecnologico-modal">
      <div class="inventario-tecnologico-modal-header"><h3>Confirmar</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
      <div class="inventario-tecnologico-modal-body"><div class="inventario-tecnologico-alert inventario-tecnologico-alert-error">${esc(mensaje)}</div></div>
      <div class="inventario-tecnologico-modal-footer">
        <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cancelar</button>
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-danger" id="inventario-tecnologico-btn-confirmar-si">${esc(textoConfirmar || "Confirmar")}</button>
      </div>
    </div>`;
    abrirModal(html, ()=>{
      document.getElementById("inventario-tecnologico-btn-confirmar-si").addEventListener("click", ()=>{
        resolverUnaVez(true);
        cerrarModal();
      });
    });
    // Asignado DESPUÉS de abrirModal, como pide su propio contrato (que
    // acaba de resetear modalVolver a null). Cubre ✕/backdrop/Esc, que
    // llaman a cerrarModal() directo sin pasar por el botón de arriba.
    modalVolver = ()=>{
      resolverUnaVez(false);
      const host = document.getElementById("inventario-tecnologico-modal-host");
      if(host) host.innerHTML = "";
      document.removeEventListener("keydown", escCierraModal);
      document.removeEventListener("keydown", atraparTabModal);
    };
  });
}

export function abrirCarruselFotos(fotos, indiceInicial, alCerrar){
  const varias = fotos.length > 1;
  const html = `<div class="inventario-tecnologico-modal inventario-tecnologico-modal-carrusel">
    <div class="inventario-tecnologico-modal-header"><h3>Fotos del activo</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body inventario-tecnologico-carrusel-body">
      <button class="inventario-tecnologico-carrusel-flecha" data-carrusel-nav="-1" aria-label="Foto anterior" ${varias?'':'disabled'}>‹</button>
      <img class="inventario-tecnologico-carrusel-img" data-carrusel-modal-img data-fotos='${esc(JSON.stringify(fotos))}' data-indice="${indiceInicial}" src="${fotos[indiceInicial]}" alt="Foto del activo">
      <button class="inventario-tecnologico-carrusel-flecha" data-carrusel-nav="1" aria-label="Foto siguiente" ${varias?'':'disabled'}>›</button>
    </div>
    <div class="inventario-tecnologico-modal-footer inventario-tecnologico-carrusel-footer">
      <span class="inventario-tecnologico-carrusel-contador" data-carrusel-contador>${indiceInicial+1} / ${fotos.length}</span>
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

export function avanzarCarrusel(img, delta){
  const fotos = JSON.parse(img.dataset.fotos);
  const total = fotos.length;
  if(total < 2) return;
  const nuevo = ((Number(img.dataset.indice) + delta) % total + total) % total;
  img.src = fotos[nuevo];
  img.dataset.indice = nuevo;
  const contador = document.querySelector("[data-carrusel-contador]");
  if(contador) contador.textContent = `${nuevo+1} / ${total}`;
}

export function navegarCarruselTeclado(e){
  const img = document.querySelector("[data-carrusel-modal-img]");
  if(!img) return;
  if(e.key==="ArrowLeft") avanzarCarrusel(img, -1);
  else if(e.key==="ArrowRight") avanzarCarrusel(img, 1);
}
