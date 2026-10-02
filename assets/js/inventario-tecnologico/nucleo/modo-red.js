// Modo de red de los equipos y rangos IP de las redes (v17, migración 014;
// lo decidió la persona el 2-oct).
//
// El tipo dice qué es el equipo (AP, PtP, Estación, Switch…) y el modo, cómo
// trabaja en la red: router (capa 3) o bridge (capa 2). Un AP que enruta es
// tipo AP en modo router: sigue haciendo radio y teniendo cobertura.
//   * Cada tipo trae su modo de fábrica, editable en «Redes y tipos»: Router →
//     router; Switch → bridge; Cámara, NVR e Inyector POE → no aplica; el
//     resto, a elegir en cada equipo. Un equipo sin modo propio sigue el de
//     su tipo.
//   * Solo los routers definen red: lo que cuelga de ellos la hereda hasta el
//     siguiente router. Un bridge (o un equipo cuyo tipo no tiene modo)
//     siempre va en la red de su servidor. Los que todavía no tienen el modo
//     indicado («a elegir») pueden definir red, como antes de la 014, para que
//     nada de lo que ya estaba se rompa.
//   * Cada red puede llevar uno o varios rangos IPv4 en notación CIDR
//     (10.10.0.0/24). Si dos se cruzan, se avisa sin impedirlo: detrás de un
//     NAT es normal repetir 192.168.88.0/24.
// Además (pedido 4 del 2-oct), cada tipo dice si hace radio y si lleva
// cobertura; de fábrica, como antes: PtP, AP y Estación hacen radio y solo el
// AP lleva cobertura.
//
// Sin la 014 los tipos no traen esas columnas y todo sale de los valores de
// fábrica. Lógica pura: se prueba en Node (tests/mapa-unit.mjs).

export const MODOS_EQUIPO = Object.freeze([
  { id: "router", etiqueta: "Router (capa 3)", corta: "Router" },
  { id: "bridge", etiqueta: "Bridge (capa 2)", corta: "Bridge" },
]);
export const MODOS_TIPO = Object.freeze([
  { id: "router", etiqueta: "Router (capa 3)" },
  { id: "bridge", etiqueta: "Bridge (capa 2)" },
  { id: "elegir", etiqueta: "A elegir en cada equipo" },
  { id: "no_aplica", etiqueta: "No aplica" },
]);
export const MODO_DE_FABRICA = Object.freeze({ router: "router", switch: "bridge", camara: "no_aplica", nvr: "no_aplica", inyector_poe: "no_aplica" });
const RADIO_DE_FABRICA = new Set(["ptp", "ap", "estacion"]);
const COBERTURA_DE_FABRICA = new Set(["ap"]);

export const esModoEquipo = v=>v === "router" || v === "bridge";
export const esModoTipo = v=>MODOS_TIPO.some(m=>m.id === v);

// El modo de un tipo (la fila de tipos_equipo_red, o { valor }): el guardado
// (014) o el de fábrica. Sin tipo: a elegir.
export function modoDelTipo(tipo){
  if(!tipo) return "elegir";
  if(esModoTipo(tipo.modo_red)) return tipo.modo_red;
  return MODO_DE_FABRICA[tipo.valor] || "elegir";
}
// El modo con el que trabaja un equipo: el suyo o, si no tiene, el de su tipo.
export function modoEfectivo(e, tipo){
  return e && esModoEquipo(e.modo_red) ? e.modo_red : modoDelTipo(tipo);
}
// ¿Puede tener red propia (definir una red para lo que cuelga de él)?
export const defineRed = modo=>modo === "router" || modo === "elegir";
// La marca «Router» junto al equipo: si enruta, salvo que su tipo ya lo diga.
export function llevaMarcaRouter(e, tipo){
  return modoEfectivo(e, tipo) === "router" && !(tipo && tipo.valor === "router");
}

// ¿Hace radioenlaces? (true / false; null sin tipo, como haceRadio de antes.)
export function haceRadioTipo(tipo){
  if(!tipo) return null;
  return typeof tipo.hace_radio === "boolean" ? tipo.hace_radio : RADIO_DE_FABRICA.has(tipo.valor);
}
// ¿Pide y dibuja la cobertura (radio, dirección y apertura)?
export function llevaCoberturaTipo(tipo){
  if(!tipo) return false;
  return typeof tipo.lleva_cobertura === "boolean" ? tipo.lleva_cobertura : COBERTURA_DE_FABRICA.has(tipo.valor);
}

export function etiquetaModo(modo){
  const m = MODOS_TIPO.find(x=>x.id === modo);
  return m ? m.etiqueta : "";
}
// La primera opción del selector del equipo (sin modo propio = el de su tipo).
export function textoModoDeSuTipo(tipo){
  const m = modoDelTipo(tipo);
  if(m === "router" || m === "bridge") return `El de su tipo: ${etiquetaModo(m)}`;
  if(m === "no_aplica") return "No aplica a su tipo";
  return "Sin indicar";
}

// ---------------------------------------------------------------------------
// Rangos IPv4 (CIDR)
// ---------------------------------------------------------------------------
export const RANGOS_MAXIMOS = 20;
const OCTETO = /^(0|[1-9]\d{0,2})$/;

function ipANumero(texto){
  const partes = String(texto).split(".");
  if(partes.length !== 4 || !partes.every(p=>OCTETO.test(p) && Number(p) <= 255)) return null;
  return partes.reduce((n, p)=>n * 256 + Number(p), 0);
}
function numeroAIp(n){
  return [24, 16, 8, 0].map(s=>Math.floor(n / 2 ** s) % 256).join(".");
}

// "10.10.0.0/24" → { ok, rango, base, fin, prefijo, corregido }. Con bits de
// host ("192.168.88.1/24") se guarda la red (192.168.88.0/24) y corregido dice
// lo que se escribió.
export function parsearRango(texto){
  const t = String(texto ?? "").trim();
  const ejemplo = "por ejemplo 10.10.0.0/24";
  if(!t) return { ok: false, error: "Rango vacío." };
  const [ip, pref, ...resto] = t.split("/");
  if(resto.length) return { ok: false, error: `«${t}» no es un rango IPv4 (${ejemplo}).` };
  const n = ipANumero(ip);
  if(n === null) return { ok: false, error: `«${t}» no es un rango IPv4 (${ejemplo}).` };
  if(pref === undefined) return { ok: false, error: `A «${t}» le falta la máscara: ${ejemplo}.` };
  if(!/^\d{1,2}$/.test(pref) || Number(pref) > 32) return { ok: false, error: `La máscara de «${t}» va de /0 a /32 (${ejemplo}).` };
  const prefijo = Number(pref);
  const tam = 2 ** (32 - prefijo);
  const base = Math.floor(n / tam) * tam;
  const rango = `${numeroAIp(base)}/${prefijo}`;
  return { ok: true, rango, base, fin: base + tam - 1, prefijo, corregido: base !== n ? t : null };
}

// Lo escrito en «Rangos IP» (separados por comas, espacios o líneas) → los
// rangos para guardar (sin repetir, en el orden escrito), los errores y los
// avisos (lo que se corrigió).
export function validarRangos(texto, { maximo = RANGOS_MAXIMOS } = {}){
  const partes = String(texto ?? "").split(/[\s,;]+/).map(x=>x.trim()).filter(Boolean);
  const rangos = [], errores = [], avisos = [];
  for(const p of partes){
    const r = parsearRango(p);
    if(!r.ok){ errores.push(r.error); continue; }
    if(r.corregido) avisos.push(`${r.corregido} se guarda como ${r.rango} (la red de ese rango).`);
    if(!rangos.includes(r.rango)) rangos.push(r.rango);
  }
  if(rangos.length > maximo) errores.push(`Como mucho ${maximo} rangos por red.`);
  return { ok: !errores.length, rangos, errores, avisos };
}

export function seCruzan(a, b){
  const x = typeof a === "string" ? parsearRango(a) : a;
  const y = typeof b === "string" ? parsearRango(b) : b;
  return !!(x && y && x.ok && y.ok && x.base <= y.fin && y.base <= x.fin);
}

// Los cruces entre los rangos de las redes (también dentro de una misma red):
// [{ red, rango, otra, otroRango }], cada par una vez. redes = [{ id, nombre,
// rangos_ip }].
export function crucesDeRangos(redes = []){
  const todos = [];
  for(const r of redes) for(const texto of r.rangos_ip || []){
    const p = parsearRango(texto);
    if(p.ok) todos.push({ red: r, rango: p.rango, p });
  }
  const out = [];
  for(let i = 0; i < todos.length; i++) for(let j = i + 1; j < todos.length; j++){
    if(seCruzan(todos[i].p, todos[j].p)) out.push({ red: todos[i].red, rango: todos[i].rango, otra: todos[j].red, otroRango: todos[j].rango });
  }
  return out;
}
// Los avisos de cruce de una red con las demás (y consigo misma), para «Redes
// y tipos»: «10.10.0.0/16 se cruza con 10.10.5.0/24, de «AQ1».»
export function avisosDeCruce(redId, redes = []){
  const avisos = [];
  for(const c of crucesDeRangos(redes)){
    let mio, otroRango, otraRed;
    if(c.red.id === redId){ mio = c.rango; otroRango = c.otroRango; otraRed = c.otra; }
    else if(c.otra.id === redId){ mio = c.otroRango; otroRango = c.rango; otraRed = c.red; }
    else continue;
    avisos.push(otraRed.id === redId ? `${mio} se cruza con ${otroRango}, de esta misma red.` : `${mio} se cruza con ${otroRango}, de «${otraRed.nombre}».`);
  }
  return avisos;
}

export function textoRangos(rangos){
  return (rangos || []).filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Cambio en lote con la regla «solo los routers definen red»
// ---------------------------------------------------------------------------
// equipos = filas de equipos_radioenlace; ids = los elegidos; parche = { tipo_equipo?,
// red_id?, modo_red? } (lo que se cambia a todos); tipos = filas de tipos_equipo_red.
// Un equipo que queda como bridge (o con un tipo sin modo) no se queda con red
// propia: no se le pone la red pedida y, si tenía una, se le quita (va en la de
// su servidor). Devuelve los grupos de ids con el mismo parche (un UPDATE cada
// uno), a quiénes no se les pone la red pedida (sinLaRed), quiénes pierden su
// red propia (dejanRed) y a quiénes no les cambia nada (sinCambio).
export function planLote(equipos = [], ids = [], parche = {}, tipos = []){
  const porId = new Map(equipos.map(e=>[e.id, e]));
  const tipoDe = v=>v ? (tipos.find(t=>t.valor === v) || { valor: v }) : null;
  const tiene = v=>v !== null && v !== undefined;
  const pedida = "red_id" in parche && tiene(parche.red_id);
  const grupos = new Map(), sinLaRed = [], dejanRed = [], sinCambio = [];
  for(const id of ids){
    const e = porId.get(id);
    if(!e) continue;
    const p = { ...parche };
    const despues = { ...e, ...p };
    if(tiene(despues.red_id) && !defineRed(modoEfectivo(despues, tipoDe(despues.tipo_equipo)))){
      delete p.red_id;
      if(pedida) sinLaRed.push(id);
      if(tiene(e.red_id)){ p.red_id = null; dejanRed.push(id); }
    }
    if(!Object.keys(p).length){ sinCambio.push(id); continue; }
    const k = JSON.stringify(Object.keys(p).sort().map(x=>[x, p[x]]));
    if(!grupos.has(k)) grupos.set(k, { ids: [], parche: p });
    grupos.get(k).ids.push(id);
  }
  return { grupos: [...grupos.values()], sinLaRed, dejanRed, sinCambio };
}
