// Selector de Tipo del formulario de activo: botón + panel con búsqueda por
// texto (sin tildes ni mayúsculas) y orden alfabético A–Z / Z–A.
//
// El <select> original queda oculto como fuente de verdad: el formulario lo
// sigue leyendo igual (.value) y cada elección dispara su evento "change".
// Si cambian sus <option> (por ejemplo, al crear un tipo nuevo), se llama a
// refrescar().
import { esc } from "../../nucleo/helpers.js";
import { colorTipo, iconoTipo } from "../../nucleo/opciones-configurables.js";
import { filtrarYOrdenar, normalizarBusqueda, ordenSiguiente } from "../../nucleo/formulario-activo.js";

const P = "inventario-tecnologico-";
const CLAVE_ORDEN = "inventario-tecnologico-orden-tipos";

function leerOrden(){
  try{ return localStorage.getItem(CLAVE_ORDEN) === "desc" ? "desc" : "asc"; } catch(e){ return "asc"; }
}
function guardarOrden(orden){
  try{ localStorage.setItem(CLAVE_ORDEN, orden); } catch(e){ /* sin almacenamiento: solo no se recuerda */ }
}

// Resalta la coincidencia de la búsqueda respetando tildes ("cám" en "Cámara").
function resaltar(etiqueta, texto){
  const q = normalizarBusqueda(texto);
  if(!q) return esc(etiqueta);
  const chars = [...etiqueta];
  const normal = chars.map(c=>normalizarBusqueda(c) || c.toLowerCase());
  const plano = normal.join("");
  const i = plano.indexOf(q);
  if(i < 0) return esc(etiqueta);
  let pos = 0, desde = -1, hasta = -1;
  for(let k = 0; k < chars.length; k++){
    if(desde < 0 && pos >= i) desde = k;
    pos += normal[k].length;
    if(pos >= i + q.length){ hasta = k + 1; break; }
  }
  if(desde < 0 || hasta < 0) return esc(etiqueta);
  return esc(chars.slice(0, desde).join("")) + `<mark>${esc(chars.slice(desde, hasta).join(""))}</mark>` + esc(chars.slice(hasta).join(""));
}

export function montarSelectorTipo(select, { id = `${P}fa-tipo` } = {}){
  let orden = leerOrden();
  let abierto = false;
  let activo = -1;
  let items = []; // [{ valor, etiqueta, vacio? }] en el orden visible

  const raiz = document.createElement("div");
  raiz.className = `${P}combo`;
  raiz.innerHTML = `
    <button type="button" class="${P}combo-boton" id="${id}-boton" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-panel"></button>
    <div class="${P}combo-panel" id="${id}-panel" hidden>
      <div class="${P}combo-herramientas">
        <input type="text" class="${P}combo-filtro" id="${id}-filtro" placeholder="Buscar tipo…" autocomplete="off" spellcheck="false"
          role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="${id}-lista" aria-label="Buscar tipo">
        <button type="button" class="${P}combo-orden" id="${id}-orden"></button>
      </div>
      <ul class="${P}combo-lista" id="${id}-lista" role="listbox" aria-label="Tipos de activo"></ul>
      <div class="${P}combo-vacio" hidden></div>
    </div>`;
  select.hidden = true;
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.after(raiz);
  const boton = raiz.querySelector(`.${P}combo-boton`);
  const panel = raiz.querySelector(`.${P}combo-panel`);
  const filtro = raiz.querySelector(`.${P}combo-filtro`);
  const botonOrden = raiz.querySelector(`.${P}combo-orden`);
  const lista = raiz.querySelector(`.${P}combo-lista`);
  const vacio = raiz.querySelector(`.${P}combo-vacio`);

  const opcionesDelSelect = ()=>[...select.options].filter(o=>o.value !== "").map(o=>({ valor: o.value, etiqueta: o.textContent }));
  const textoVacio = ()=>{ const o = [...select.options].find(o=>o.value === ""); return o ? o.textContent : "— Selecciona —"; };

  function pintarBoton(){
    const valor = select.value;
    const op = [...select.options].find(o=>o.value === valor);
    boton.innerHTML = valor && op
      ? `<span class="${P}combo-icono" style="color:${esc(colorTipo(valor))}">${iconoTipo(valor)}</span><span class="${P}combo-texto">${esc(op.textContent)}</span><span class="${P}combo-flecha" aria-hidden="true"></span>`
      : `<span class="${P}combo-texto ${P}combo-placeholder">${esc(textoVacio())}</span><span class="${P}combo-flecha" aria-hidden="true"></span>`;
  }
  function pintarOrden(){
    botonOrden.textContent = orden === "asc" ? "A–Z" : "Z–A";
    const otro = orden === "asc" ? "Z a A" : "A a Z";
    botonOrden.title = `Ordenar de ${otro}`;
    botonOrden.setAttribute("aria-label", `Orden alfabético ${orden === "asc" ? "de A a Z" : "de Z a A"}. Cambiar a ${otro}`);
  }
  function pintarLista({ mantenerActivo = false } = {}){
    const texto = filtro.value;
    const visibles = filtrarYOrdenar(opcionesDelSelect(), { texto, orden });
    items = normalizarBusqueda(texto) ? visibles : [{ valor: "", etiqueta: "— Sin tipo —", vacio: true }, ...visibles];
    if(!mantenerActivo){
      const sel = items.findIndex(it=>it.valor === select.value);
      activo = normalizarBusqueda(texto) ? (items.length ? 0 : -1) : (sel >= 0 ? sel : 0);
    }
    if(activo >= items.length) activo = items.length - 1;
    lista.innerHTML = items.map((it, i)=>{
      const elegido = it.valor === select.value;
      return `<li role="option" id="${id}-op-${i}" class="${P}combo-opcion${i === activo ? ` ${P}combo-opcion-activa` : ""}${it.vacio ? ` ${P}combo-opcion-vacia` : ""}" data-indice="${i}" data-valor="${esc(it.valor)}" aria-selected="${elegido}">`
        + (it.vacio ? `<span class="${P}combo-icono"></span>` : `<span class="${P}combo-icono" style="color:${esc(colorTipo(it.valor))}">${iconoTipo(it.valor)}</span>`)
        + `<span class="${P}combo-texto">${it.vacio ? esc(it.etiqueta) : resaltar(it.etiqueta, texto)}</span>`
        + (elegido ? `<span class="${P}combo-check" aria-hidden="true">✓</span>` : "")
        + `</li>`;
    }).join("");
    vacio.hidden = items.length > 0;
    if(!items.length) vacio.textContent = `Ningún tipo coincide con «${texto.trim()}».`;
    filtro.setAttribute("aria-activedescendant", activo >= 0 ? `${id}-op-${activo}` : "");
    asegurarVisible(activo >= 0 ? lista.children[activo] : null);
  }
  // Desplaza solo la lista (no el modal) para que se vea la opción activa.
  function asegurarVisible(el){
    if(!el) return;
    const arriba = el.offsetTop, abajo = arriba + el.offsetHeight;
    if(arriba < lista.scrollTop) lista.scrollTop = arriba;
    else if(abajo > lista.scrollTop + lista.clientHeight) lista.scrollTop = abajo - lista.clientHeight;
  }
  function moverActivo(delta){
    if(!items.length) return;
    activo = Math.max(0, Math.min(items.length - 1, (activo < 0 ? 0 : activo + delta)));
    pintarLista({ mantenerActivo: true });
  }

  function alClicFuera(e){ if(!raiz.contains(e.target)) cerrar(); }
  function abrir(textoInicial = ""){
    if(abierto) return;
    abierto = true;
    filtro.value = textoInicial;
    pintarLista();
    panel.hidden = false;
    asegurarVisible(activo >= 0 ? lista.children[activo] : null);
    // Si el panel queda cortado al pie del modal, se desplaza lo justo.
    if(panel.scrollIntoView) panel.scrollIntoView({ block: "nearest" });
    boton.setAttribute("aria-expanded", "true");
    raiz.classList.add(`${P}combo-abierto`);
    document.addEventListener("mousedown", alClicFuera, true);
    filtro.focus();
    if(textoInicial) filtro.setSelectionRange(textoInicial.length, textoInicial.length);
  }
  function cerrar({ devolverFoco = false } = {}){
    if(!abierto) return;
    abierto = false;
    panel.hidden = true;
    boton.setAttribute("aria-expanded", "false");
    raiz.classList.remove(`${P}combo-abierto`);
    document.removeEventListener("mousedown", alClicFuera, true);
    if(devolverFoco) boton.focus();
  }
  function elegir(valor){
    const cambio = select.value !== valor;
    select.value = valor;
    pintarBoton();
    cerrar({ devolverFoco: true });
    if(cambio) select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  boton.addEventListener("click", ()=>{ if(abierto) cerrar({ devolverFoco: true }); else abrir(); });
  boton.addEventListener("keydown", e=>{
    if(["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)){ e.preventDefault(); abrir(); return; }
    // Escribir sobre el botón abre la búsqueda con esa letra.
    if(e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey){ e.preventDefault(); abrir(e.key); }
  });
  filtro.addEventListener("input", ()=>pintarLista());
  filtro.addEventListener("keydown", e=>{
    if(e.key === "ArrowDown"){ e.preventDefault(); moverActivo(1); }
    else if(e.key === "ArrowUp"){ e.preventDefault(); moverActivo(-1); }
    else if(e.key === "PageDown"){ e.preventDefault(); moverActivo(8); }
    else if(e.key === "PageUp"){ e.preventDefault(); moverActivo(-8); }
    else if(e.key === "Enter"){ e.preventDefault(); if(activo >= 0 && items[activo]) elegir(items[activo].valor); }
    else if(e.key === "Escape"){
      // Cierra solo la lista: el modal sigue abierto.
      e.preventDefault(); e.stopPropagation();
      cerrar({ devolverFoco: true });
    }
  });
  botonOrden.addEventListener("click", ()=>{
    orden = ordenSiguiente(orden);
    guardarOrden(orden);
    pintarOrden();
    pintarLista();
    filtro.focus();
  });
  botonOrden.addEventListener("keydown", e=>{
    if(e.key === "Escape"){ e.preventDefault(); e.stopPropagation(); cerrar({ devolverFoco: true }); }
  });
  lista.addEventListener("mousedown", e=>e.preventDefault()); // el foco sigue en la búsqueda
  lista.addEventListener("click", e=>{
    const li = e.target.closest("li[data-indice]");
    if(li) elegir(items[Number(li.dataset.indice)].valor);
  });
  lista.addEventListener("mousemove", e=>{
    const li = e.target.closest("li[data-indice]");
    if(!li) return;
    const i = Number(li.dataset.indice);
    if(i === activo) return;
    lista.children[activo]?.classList.remove(`${P}combo-opcion-activa`);
    activo = i;
    li.classList.add(`${P}combo-opcion-activa`);
    filtro.setAttribute("aria-activedescendant", `${id}-op-${i}`);
  });
  raiz.addEventListener("focusout", e=>{ if(abierto && e.relatedTarget && !raiz.contains(e.relatedTarget)) cerrar(); });

  pintarOrden();
  pintarBoton();
  return {
    boton,
    refrescar(){ pintarBoton(); if(abierto) pintarLista(); },
    abrir, cerrar,
  };
}
