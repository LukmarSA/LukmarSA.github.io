// Transiciones suaves para mostrar/ocultar partes de un formulario o de un
// panel sin que "salten": lo que sale se desvanece, lo que queda se desliza a
// su nuevo lugar (técnica FLIP), lo que entra aparece y el contenedor cambia
// de alto de a poco. Con prefers-reduced-motion (o sin Web Animations) el
// cambio es inmediato.

const EASE = "cubic-bezier(.2,.7,.2,1)";
const generaciones = new WeakMap();

export function sinMovimiento(){
  try{ return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch(e){ return false; }
}

function cancelar(el){
  if(el && typeof el.getAnimations === "function") el.getAnimations().forEach(a=>a.cancel());
}

// contenedor: el bloque que cambia de alto (se anima su height).
// condicionales: elementos que se muestran u ocultan (atributo hidden).
// debeVerse(el): true si el elemento tiene que quedar visible.
// moviles: todo lo que puede cambiar de lugar (incluye los condicionales).
// Devuelve una promesa que se cumple al terminar (o al ser reemplazada por
// otra transición del mismo contenedor).
export async function transicionarVisibilidad(contenedor, condicionales, debeVerse, { moviles = condicionales, duracionSalida = 130, duracion = 280 } = {}){
  const gen = (generaciones.get(contenedor) || 0) + 1;
  generaciones.set(contenedor, gen);
  // Si había otra transición a medias, se la termina de golpe.
  [contenedor, ...moviles].forEach(cancelar);
  contenedor.style.overflow = "";
  const salen = condicionales.filter(el=>!el.hidden && !debeVerse(el));
  const entran = condicionales.filter(el=>el.hidden && debeVerse(el));
  if(!salen.length && !entran.length) return;
  if(sinMovimiento() || typeof contenedor.animate !== "function"){
    salen.forEach(el=>{ el.hidden = true; });
    entran.forEach(el=>{ el.hidden = false; });
    return;
  }
  const quedan = moviles.filter(el=>!el.hidden && !salen.includes(el));
  const antes = new Map(quedan.map(el=>[el, el.getBoundingClientRect()]));
  const altoAntes = contenedor.getBoundingClientRect().height;

  // 1) Lo que sale se desvanece en su lugar.
  if(salen.length){
    await Promise.all(salen.map(el=>el.animate(
      [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.97)" }],
      { duration: duracionSalida, easing: "ease-in", fill: "forwards" }).finished.catch(()=>{})));
    if(generaciones.get(contenedor) !== gen) return;
  }
  // 2) Cambio real del contenido.
  salen.forEach(el=>{ cancelar(el); el.hidden = true; });
  entran.forEach(el=>{ el.hidden = false; });
  const altoDespues = contenedor.getBoundingClientRect().height;

  // 3) Lo que queda se desliza desde donde estaba; lo nuevo aparece; el alto acompaña.
  const animaciones = [];
  for(const el of quedan){
    const a = antes.get(el), b = el.getBoundingClientRect();
    const dx = a.left - b.left, dy = a.top - b.top;
    if(Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    animaciones.push(el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: duracion, easing: EASE }));
  }
  entran.forEach((el, i)=>{
    animaciones.push(el.animate(
      [{ opacity: 0, transform: "translateY(8px) scale(0.98)" }, { opacity: 1, transform: "none" }],
      { duration: duracion, delay: 50 + Math.min(i, 8) * 28, easing: EASE, fill: "backwards" }));
  });
  if(Math.abs(altoAntes - altoDespues) > 0.5){
    contenedor.style.overflow = "hidden";
    animaciones.push(contenedor.animate([{ height: `${altoAntes}px` }, { height: `${altoDespues}px` }], { duration: duracion, easing: EASE }));
  }
  await Promise.all(animaciones.map(a=>a.finished.catch(()=>{})));
  if(generaciones.get(contenedor) === gen) contenedor.style.overflow = "";
}

// Despliega un bloque (acordeón): alto 0 → natural, con fundido.
export function expandir(el, { duracion = 300 } = {}){
  if(!el || sinMovimiento() || typeof el.animate !== "function") return Promise.resolve();
  cancelar(el);
  const alto = el.getBoundingClientRect().height;
  const cs = getComputedStyle(el);
  el.style.overflow = "hidden";
  const a = el.animate(
    [{ height: "0px", marginTop: "0px", marginBottom: "0px", opacity: 0, transform: "translateY(-6px)" },
     { height: `${alto}px`, marginTop: cs.marginTop, marginBottom: cs.marginBottom, opacity: 1, transform: "none" }],
    { duration: duracion, easing: EASE });
  return a.finished.catch(()=>{}).then(()=>{ el.style.overflow = ""; });
}

// Pliega un bloque que ya no está en el DOM: pone en su lugar un "fantasma"
// con su alto y lo lleva a 0. alto = el alto que tenía el bloque.
export function plegarFantasma(ancla, alto, { duracion = 240, antes = true } = {}){
  if(!ancla || !alto || sinMovimiento() || typeof ancla.animate !== "function") return Promise.resolve();
  const f = document.createElement("div");
  f.setAttribute("aria-hidden", "true");
  f.style.height = `${alto}px`;
  f.style.overflow = "hidden";
  f.style.pointerEvents = "none";
  if(antes) ancla.before(f); else ancla.after(f);
  const a = f.animate([{ height: `${alto}px` }, { height: "0px" }], { duration: duracion, easing: EASE });
  return a.finished.catch(()=>{}).then(()=>f.remove());
}
