// Jerarquía de radioenlaces (migración 003): quién es servidor de quién, qué
// líneas se dibujan y de qué clase, el rol de cada equipo, el camino hasta
// la raíz y la simulación de fallas.
//
// Lógica pura, como mapa-logica.js: no toca el DOM ni Supabase (todo llega
// por parámetro), así se prueba en Node (tests/mapa-unit.mjs).
//
// Conceptos
//   * servidor_id = servidor ACTIVO. NULL = raíz (entrada de internet).
//   * Medio del enlace con su servidor (migración 008: equipos_radioenlace.medio):
//     "cable", "fibra" o "inalambrico". Sin medio (NULL, o antes de la 008) se
//     deduce: en la misma ubicación, cable; en otra, inalámbrico.
//   * Un enlace por cable dentro de la torre no se dibuja y no cuenta para
//     decidir backbone o P2MP. Un cable o una fibra entre dos ubicaciones se
//     dibuja con su propio estilo (clase "cable" / "fibra"), tampoco cuenta.
//   * Clientes "remotos" de X = los que cuelgan de X por RADIO desde OTRA
//     ubicación. 1 remoto → el enlace es backbone (punto a punto); varios → P2MP.
//   * Más de UMBRAL_AGRUPAR_CLIENTES remotos → las líneas de ese servidor se
//     agrupan en un indicador ("AP · 23 clientes") hasta que se lo expande.
//   * Red de la finca (007): red_id. Con la 011 es la red PROPIA: sin ella el
//     equipo hereda la de su servidor principal (redesEfectivas); lo que se
//     muestra, colorea y filtra es la red efectiva (redEfectivaDe).
//   * Simulación: "caído" = se corta el enlace de subida del equipo (el equipo
//     sigue encendido). Cada equipo sin camino a una raíz pasa solo a su
//     respaldo de mejor prioridad (1 = primera opción) que tenga servicio; si
//     no hay ninguno, queda sin conectividad y su subárbol lo sigue (salvo los
//     clientes que tengan respaldo propio). Nada de esto se guarda.
import { azimutGrados, distanciaKm } from "./geo.js";

export const UMBRAL_AGRUPAR_CLIENTES = 8;

export const ROLES = [
  { id: "raiz",         etiqueta: "Raíz",         color: "#3E7D4F", ayuda: "Entrada de internet: no tiene servidor." },
  { id: "backbone",     etiqueta: "Backbone",     color: "#004DAB", ayuda: "Extremos de un enlace punto a punto y equipos de torre que alimentan a otros." },
  { id: "distribucion", etiqueta: "Distribución", color: "#007EB2", ayuda: "AP con varios clientes (punto-multipunto)." },
  { id: "cliente",      etiqueta: "Cliente",      color: "#57697C", ayuda: "Final de la cadena: no alimenta a nadie." },
];

export const ESTADOS_SIMULACION = [
  { id: "servicio",     etiqueta: "En servicio",      color: "#3E7D4F" },
  { id: "respaldo",     etiqueta: "Vía respaldo",     color: "#1E8A5A" },
  { id: "sin_conexion", etiqueta: "Sin conectividad", color: "#B3432D" },
  { id: "caido",        etiqueta: "Caídos",           color: "#8B1E12" },
];

export function infoRol(id){ return ROLES.find(r=>r.id === id) || ROLES[ROLES.length - 1]; }
export function infoEstado(id){ return ESTADOS_SIMULACION.find(e=>e.id === id) || ESTADOS_SIMULACION[0]; }

const tieneValor = v=>v !== null && v !== undefined;

export const MEDIOS = [
  { id: "cable",       etiqueta: "Cable",        badge: "cable" },
  { id: "fibra",       etiqueta: "Fibra óptica", badge: "fibra" },
  { id: "inalambrico", etiqueta: "Inalámbrico",  badge: "inalámbrico" },
];
const ID_MEDIOS = new Set(MEDIOS.map(m=>m.id));
export function esMedio(v){ return ID_MEDIOS.has(v); }
export function infoMedio(id){ return MEDIOS.find(m=>m.id === id) || MEDIOS[2]; }

// Medio del enlace cliente → servidor. El medio guardado vale solo para el
// servidor principal (servidor_id): un respaldo siempre se deduce por la
// ubicación.
export function medioDe(cliente, servidor){
  if(!cliente || !servidor) return null;
  if(esMedio(cliente.medio) && tieneValor(cliente.servidor_id) && Number(cliente.servidor_id) === Number(servidor.id)) return cliente.medio;
  return Number(cliente.ubicacion_id) === Number(servidor.ubicacion_id) ? "cable" : "inalambrico";
}

function agregar(mapa, clave, valor){
  if(!mapa.has(clave)) mapa.set(clave, []);
  mapa.get(clave).push(valor);
}

function geometria(desde, hasta){
  if(!desde || !hasta) return { distanciaKm: null, azimutIda: null, azimutVuelta: null };
  return { distanciaKm: distanciaKm(desde, hasta), azimutIda: azimutGrados(desde, hasta), azimutVuelta: azimutGrados(hasta, desde) };
}

function calcularRol(e, red){
  const s = tieneValor(e.servidor_id) ? red.equipoPorId.get(e.servidor_id) : null;
  if(!s) return "raiz";
  const remotos = (red.clientesRemotos.get(e.id) || []).length;
  if(remotos > 1) return "distribucion";
  if(remotos === 1) return "backbone";
  if(medioDe(e, s) === "inalambrico" && s.ubicacion_id !== e.ubicacion_id) return (red.clientesRemotos.get(s.id) || []).length === 1 ? "backbone" : "cliente";
  return (red.clientes.get(e.id) || []).length ? "backbone" : "cliente";
}

// Índices de la red. Se recalcula entero cuando cambian los datos (es barato:
// decenas o pocos cientos de equipos).
export function analizarRed({ equipos = [], ubicaciones = [], respaldos = [] } = {}){
  const equipoPorId = new Map(equipos.map(e=>[e.id, e]));
  const ubicacionPorId = new Map(ubicaciones.map(u=>[u.id, u]));
  const servidorDe = e=>(tieneValor(e.servidor_id) ? equipoPorId.get(e.servidor_id) : null) || null;

  const clientes = new Map();
  const clientesRemotos = new Map();
  for(const e of equipos){
    const s = servidorDe(e);
    if(!s) continue;
    agregar(clientes, s.id, e);
    if(s.ubicacion_id !== e.ubicacion_id && medioDe(e, s) === "inalambrico") agregar(clientesRemotos, s.id, e);
  }
  const porNombre = (a, b)=>String(a.nombre).localeCompare(String(b.nombre), "es");
  for(const lista of clientes.values()) lista.sort(porNombre);
  for(const lista of clientesRemotos.values()) lista.sort(porNombre);

  // Respaldos por prioridad; en un empate, el registrado primero.
  const respaldosPorEquipo = new Map();
  const respaldadosPor = new Map();
  for(const r of [...respaldos].sort((a, b)=>(a.prioridad - b.prioridad) || (a.id - b.id))){
    if(!equipoPorId.has(r.equipo_id) || !equipoPorId.has(r.servidor_alternativo_id)) continue;
    agregar(respaldosPorEquipo, r.equipo_id, r);
    agregar(respaldadosPor, r.servidor_alternativo_id, r);
  }

  const agrupados = new Set([...clientesRemotos].filter(([, l])=>l.length > UMBRAL_AGRUPAR_CLIENTES).map(([id])=>id));

  // Una línea por equipo cuyo servidor está en otra ubicación: radioenlace
  // (backbone o P2MP) o, con la 008, cable/fibra entre sitios.
  const enlaces = [];
  const enlacePorCliente = new Map();
  for(const e of equipos){
    const s = servidorDe(e);
    if(!s || s.ubicacion_id === e.ubicacion_id) continue;
    const uCliente = ubicacionPorId.get(e.ubicacion_id), uServidor = ubicacionPorId.get(s.ubicacion_id);
    if(!uCliente || !uServidor) continue;
    const medio = medioDe(e, s);
    const radio = medio === "inalambrico";
    const l = {
      id: e.id, cliente: e, servidor: s, uCliente, uServidor, medio,
      clase: radio ? ((clientesRemotos.get(s.id) || []).length === 1 ? "backbone" : "p2mp") : medio,
      agrupado: radio && agrupados.has(s.id),
      banda: s.banda || e.banda || null,
      frecuencia: tieneValor(s.frecuencia_mhz) ? Number(s.frecuencia_mhz) : (tieneValor(e.frecuencia_mhz) ? Number(e.frecuencia_mhz) : null),
      ...geometria(uServidor, uCliente),
    };
    enlaces.push(l);
    enlacePorCliente.set(e.id, l);
  }

  const red = { equipoPorId, ubicacionPorId, clientes, clientesRemotos, respaldosPorEquipo, respaldadosPor, agrupados, enlaces, enlacePorCliente, rol: new Map() };
  for(const e of equipos) red.rol.set(e.id, calcularRol(e, red));
  return red;
}

export function servidorDe(red, equipoId){
  const e = red.equipoPorId.get(equipoId);
  return e && tieneValor(e.servidor_id) ? (red.equipoPorId.get(e.servidor_id) || null) : null;
}

// Medio del enlace entre dos equipos de la red (ver medioDe).
export function medioEnlace(red, clienteId, servidorId){
  return medioDe(red.equipoPorId.get(clienteId), red.equipoPorId.get(servidorId));
}

// Cable o fibra (no radio).
export function esPorCable(red, clienteId, servidorId){
  const m = medioEnlace(red, clienteId, servidorId);
  return m === "cable" || m === "fibra";
}

// Lo que el panel muestra de la conexión de un equipo hacia un servidor (el
// principal o uno de respaldo), visto desde el equipo: "desde aquí" apunta
// al servidor.
export function describirConexion(red, equipoId, servidorId){
  const e = red.equipoPorId.get(equipoId), s = red.equipoPorId.get(servidorId);
  if(!e || !s) return null;
  const u = red.ubicacionPorId.get(e.ubicacion_id), us = red.ubicacionPorId.get(s.ubicacion_id);
  const medio = medioDe(e, s);
  const cable = medio !== "inalambrico";
  const mismaUbicacion = e.ubicacion_id === s.ubicacion_id;
  const g = mismaUbicacion ? { distanciaKm: null, azimutIda: null, azimutVuelta: null } : geometria(u, us);
  return {
    equipo: e, servidor: s, ubicacion: u || null, ubicacionServidor: us || null, cable, medio, mismaUbicacion,
    distanciaKm: g.distanciaKm, azimutIda: g.azimutIda, azimutVuelta: g.azimutVuelta,
    banda: s.banda || e.banda || null,
    frecuencia: tieneValor(s.frecuencia_mhz) ? Number(s.frecuencia_mhz) : (tieneValor(e.frecuencia_mhz) ? Number(e.frecuencia_mhz) : null),
  };
}

// Todos los que dependen de un equipo por la jerarquía principal (no incluye al equipo).
export function descendientes(red, equipoId){
  const out = new Set();
  const pila = [...(red.clientes.get(equipoId) || [])];
  while(pila.length){
    const e = pila.pop();
    if(out.has(e.id) || e.id === equipoId) continue;
    out.add(e.id);
    pila.push(...(red.clientes.get(e.id) || []));
  }
  return out;
}

// Servidores posibles para un equipo sin armar un ciclo (la base lo
// rechazaría igual: trigger de la 003). equipoId null = equipo nuevo.
export function candidatosServidor(red, equipoId = null){
  const excluir = equipoId === null ? new Set() : descendientes(red, equipoId);
  if(equipoId !== null) excluir.add(equipoId);
  return [...red.equipoPorId.values()].filter(e=>!excluir.has(e.id));
}

export function validarServidor(red, equipoId, servidorId){
  if(!tieneValor(servidorId) || servidorId === "") return null;
  const s = Number(servidorId);
  if(!red.equipoPorId.has(s)) return "Ese servidor ya no existe. Recarga el mapa.";
  if(equipoId !== null && equipoId !== undefined){
    if(s === equipoId) return "Un equipo no puede ser su propio servidor.";
    if(descendientes(red, equipoId).has(s)) return "Ese equipo depende de este (está en su subárbol): elegirlo armaría un ciclo.";
  }
  return null;
}

// Servidores alternativos posibles: ni el propio equipo, ni su servidor
// actual, ni los que ya son respaldo (salvo el que se está editando).
export function candidatosRespaldo(red, equipoId, idRespaldoActual = null){
  const e = red.equipoPorId.get(equipoId);
  if(!e) return [];
  const ya = new Set((red.respaldosPorEquipo.get(equipoId) || []).filter(r=>r.id !== idRespaldoActual).map(r=>r.servidor_alternativo_id));
  return [...red.equipoPorId.values()].filter(x=>x.id !== equipoId && x.id !== e.servidor_id && !ya.has(x.id));
}

export function validarRespaldo({ equipo_id, servidor_alternativo_id, prioridad } = {}, red, idActual = null){
  const errores = {};
  const e = red.equipoPorId.get(equipo_id);
  const s = tieneValor(servidor_alternativo_id) && servidor_alternativo_id !== "" ? Number(servidor_alternativo_id) : null;
  if(!e) errores.equipo_id = "Falta el equipo.";
  if(s === null) errores.servidor_alternativo_id = "Elige el servidor de respaldo.";
  else if(!red.equipoPorId.has(s)) errores.servidor_alternativo_id = "Ese servidor ya no existe. Recarga el mapa.";
  else if(e && s === e.id) errores.servidor_alternativo_id = "Un equipo no puede ser su propio respaldo.";
  else if(e && s === e.servidor_id) errores.servidor_alternativo_id = "Ese ya es su servidor principal: un respaldo tiene que ser otro.";
  else if(e && (red.respaldosPorEquipo.get(e.id) || []).some(r=>r.id !== idActual && r.servidor_alternativo_id === s)) errores.servidor_alternativo_id = "Ese servidor ya está entre sus respaldos.";
  const p = Number(prioridad);
  if(!Number.isInteger(p) || p < 1) errores.prioridad = "La prioridad es un número entero desde 1 (1 = primera opción).";
  return { ok: Object.keys(errores).length === 0, errores };
}

export function siguientePrioridad(red, equipoId){
  const lista = red.respaldosPorEquipo.get(equipoId) || [];
  return lista.length ? Math.max(...lista.map(r=>r.prioridad)) + 1 : 1;
}

// ---------------------------------------------------------------------------
// Simulación de fallas (solo en el navegador)
// ---------------------------------------------------------------------------
// caidos: ids de equipos cuyo enlace de subida se corta. Devuelve, por equipo:
//   conectado    ¿tiene camino a una raíz?
//   via          por qué servidor sale (null si es raíz o si no tiene camino)
//   respaldo     la fila de enlaces_respaldo que usa (null si usa el principal)
//   caido        si está en la lista de caídos
//   rutaAlterna  conectado, pero su camino pasa por algún respaldo (suyo o de más arriba)
//   estado       "caido" | "respaldo" | "sin_conexion" | "servicio" (excluyentes, para filtrar)
//
// Cómo elige: primero se conectan las raíces que no cayeron; luego, en rondas,
// cada equipo se engancha al primer candidato (su principal, si no se cortó,
// y después sus respaldos por prioridad) que ya tenga servicio. Así ningún
// equipo sale por alguien que depende de él (no hay ciclos). Al final, un
// equipo que quedó en un respaldo peor se pasa a uno mejor si ese ya tiene
// servicio sin pasar por él. Resultado determinista: se recorre por id.
export function simularFallas(red, caidosLista = []){
  const caidos = new Set([...caidosLista].filter(id=>red.equipoPorId.has(id)));
  const ids = [...red.equipoPorId.keys()].sort((a, b)=>a - b);
  const candidatos = new Map();
  const raices = [];
  for(const id of ids){
    const e = red.equipoPorId.get(id);
    const principal = tieneValor(e.servidor_id) && red.equipoPorId.has(e.servidor_id) ? e.servidor_id : null;
    const lista = [];
    if(principal !== null && !caidos.has(id)) lista.push({ servidor: principal, respaldo: null });
    for(const r of red.respaldosPorEquipo.get(id) || []) lista.push({ servidor: r.servidor_alternativo_id, respaldo: r });
    candidatos.set(id, lista);
    if(principal === null && !caidos.has(id)) raices.push(id);
  }

  const eleccion = new Map(); // id → índice del candidato elegido; -1 = raíz
  for(const id of raices) eleccion.set(id, -1);
  let hubo = true;
  while(hubo){
    hubo = false;
    for(const id of ids){
      if(eleccion.has(id)) continue;
      const lista = candidatos.get(id);
      const k = lista.findIndex(c=>eleccion.has(c.servidor));
      if(k >= 0){ eleccion.set(id, k); hubo = true; }
    }
  }

  const siguiente = id=>{ const k = eleccion.get(id); return k === undefined || k < 0 ? null : candidatos.get(id)[k].servidor; };
  const pasaPor = (desde, objetivo)=>{
    let x = desde, pasos = 0;
    while(x !== null && pasos++ <= ids.length){ if(x === objetivo) return true; x = siguiente(x); }
    return false;
  };
  let mejoro = true;
  while(mejoro){
    mejoro = false;
    for(const id of ids){
      const k = eleccion.get(id);
      if(k === undefined || k <= 0) continue;
      const lista = candidatos.get(id);
      for(let j = 0; j < k; j++){
        const s = lista[j].servidor;
        if(eleccion.has(s) && !pasaPor(s, id)){ eleccion.set(id, j); mejoro = true; break; }
      }
    }
  }

  const estado = new Map();
  const cuentas = { servicio: 0, respaldo: 0, sin_conexion: 0, caido: 0 };
  const usaRespaldo = id=>{ const k = eleccion.get(id); return k !== undefined && k >= 0 && !!candidatos.get(id)[k].respaldo; };
  for(const id of ids){
    const k = eleccion.get(id);
    const conectado = k !== undefined;
    const c = conectado && k >= 0 ? candidatos.get(id)[k] : null;
    let rutaAlterna = false;
    if(conectado){ let x = id, pasos = 0; while(x !== null && pasos++ <= ids.length){ if(usaRespaldo(x)){ rutaAlterna = true; break; } x = siguiente(x); } }
    const caido = caidos.has(id);
    const e = caido ? "caido" : (!conectado ? "sin_conexion" : (c && c.respaldo ? "respaldo" : "servicio"));
    estado.set(id, { conectado, via: c ? c.servidor : null, respaldo: c ? c.respaldo : null, caido, rutaAlterna, estado: e });
    cuentas[e]++;
  }
  return { caidos, estado, cuentas };
}

// Camino desde un equipo hasta su raíz: [equipo, servidor, …, raíz].
// Con simulación sigue el camino simulado; si el equipo quedó sin conexión,
// sigue su jerarquía principal hasta donde se corta (para mostrar dónde).
export function caminoARaiz(red, equipoId, sim = null){
  const camino = [];
  const vistos = new Set();
  let x = equipoId;
  while(x !== null && x !== undefined && red.equipoPorId.has(x) && !vistos.has(x)){
    camino.push(x);
    vistos.add(x);
    const st = sim ? sim.estado.get(x) : null;
    if(st && st.conectado) x = st.via;
    else if(st && st.caido) x = null;
    else { const e = red.equipoPorId.get(x); x = tieneValor(e.servidor_id) ? e.servidor_id : null; }
  }
  return camino;
}

// Tramos consecutivos de un camino, con si funcionan (en simulación) y si
// son por cable o por un respaldo.
export function tramosDeCamino(red, camino, sim = null){
  const tramos = [];
  for(let i = 0; i + 1 < camino.length; i++){
    const cliente = camino[i], servidor = camino[i + 1];
    const st = sim ? sim.estado.get(cliente) : null;
    const respaldo = st && st.conectado && st.via === servidor ? st.respaldo : null;
    const medio = medioEnlace(red, cliente, servidor);
    tramos.push({ cliente, servidor, respaldo, medio, cable: medio !== "inalambrico", funciona: !sim || !!(st && st.conectado && st.via === servidor) });
  }
  return tramos;
}

// ---------------------------------------------------------------------------
// Red heredada (migración 011): red_id es la red PROPIA del equipo; sin ella
// hereda la de su servidor principal, y así hacia arriba hasta la raíz. Un
// equipo con otra red propia forma, con lo que cuelga de él, una red aparte.
// Devuelve Map id → { redId, desdeId }: desdeId = el equipo que tiene la red
// propia (él mismo o un antecesor); los dos null si nadie en el camino tiene.
// ---------------------------------------------------------------------------
const redPropia = e=>tieneValor(e.red_id) && e.red_id !== "" ? Number(e.red_id) : null;
export function redesEfectivas(equipos = []){
  const porId = new Map(equipos.map(e=>[Number(e.id), e]));
  const memo = new Map();
  const SIN = { redId: null, desdeId: null };
  for(const e of equipos){
    const camino = [];
    const vistos = new Set();
    let x = e, res = null;
    while(x){
      const id = Number(x.id);
      if(memo.has(id)){ res = memo.get(id); break; }
      if(vistos.has(id)) break; // un ciclo (la base no los deja): sin red
      vistos.add(id);
      const propia = redPropia(x);
      if(propia !== null){ res = { redId: propia, desdeId: id }; memo.set(id, res); break; }
      camino.push(id);
      x = tieneValor(x.servidor_id) ? porId.get(Number(x.servidor_id)) : null;
    }
    for(const id of camino) memo.set(id, res || SIN);
  }
  return memo;
}

// Deja en cada fila red_efectiva y red_desde (con la 011), o las quita (sin
// ella, cada equipo tiene solo su red). No se envían nunca a la base.
export function anotarRedesEfectivas(equipos = [], herencia = false){
  if(!herencia){
    for(const e of equipos){ delete e.red_efectiva; delete e.red_desde; }
    return;
  }
  const ef = redesEfectivas(equipos);
  for(const e of equipos){
    const r = ef.get(Number(e.id)) || { redId: null, desdeId: null };
    e.red_efectiva = r.redId;
    e.red_desde = r.desdeId;
  }
}

// Red con la que se muestra, colorea y filtra un equipo: la efectiva si se
// anotó (011), si no la propia.
export function redEfectivaDe(e){
  if(!e) return null;
  if(e.red_efectiva !== undefined) return e.red_efectiva;
  return redPropia(e);
}
// Id del equipo del que hereda su red, o null si la red es propia (o no tiene).
export function redHeredadaDe(e){
  return e && e.red_efectiva !== undefined && e.red_efectiva !== null && tieneValor(e.red_desde) && Number(e.red_desde) !== Number(e.id)
    ? Number(e.red_desde) : null;
}

// Equipos que cuelgan de equipoId (servidor principal, a cualquier
// profundidad) y siguen su red: los que no tienen red propia, sin entrar en
// las redes aparte. red = analizarRed(…).
export function herederosDeRed(red, equipoId){
  const out = [];
  const pila = [...(red.clientes.get(equipoId) || [])];
  const vistos = new Set([equipoId]);
  while(pila.length){
    const c = pila.pop();
    if(vistos.has(c.id)) continue;
    vistos.add(c.id);
    if(redPropia(c) !== null) continue;
    out.push(c);
    pila.push(...(red.clientes.get(c.id) || []));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Grosor de las líneas de conexión (v9; desde 0 en el v11): un factor para
// todas (0× a 3×, de a 0,25). Se aplica al ancho y a los trazos punteados,
// para que conserven su forma. En 0 no se dibuja ninguna línea, salvo el
// camino resaltado del equipo elegido, que va al mínimo visible (0,5×). Lo
// recuerda cada navegador (ui/mapa/leaflet.js).
// ---------------------------------------------------------------------------
export const GROSOR_LINEAS = { min: 0, max: 3, paso: 0.25, porDefecto: 1 };
export const GROSOR_MINIMO_VISIBLE = 0.5;
export function normalizarGrosor(k){
  // Lo que falta o no es un número vuelve al de por defecto. Ojo: Number("")
  // y Number(null) dan 0, que ahora es un valor válido («sin líneas»).
  if(k === null || k === undefined || typeof k === "boolean" || (typeof k === "string" && !k.trim())) return GROSOR_LINEAS.porDefecto;
  const n = Number(k);
  if(!Number.isFinite(n) || n < 0) return GROSOR_LINEAS.porDefecto;
  const redondeado = Math.round(n / GROSOR_LINEAS.paso) * GROSOR_LINEAS.paso;
  return Math.min(GROSOR_LINEAS.max, Math.max(GROSOR_LINEAS.min, redondeado)) || 0;
}
// El factor con que se dibuja una línea: el elegido. En 0, solo el camino
// resaltado (enCadena), al mínimo visible; 0 = la línea no se dibuja.
export function grosorDeLinea(k, { enCadena = false } = {}){
  const f = normalizarGrosor(k);
  if(f > 0) return f;
  return enCadena ? GROSOR_MINIMO_VISIBLE : 0;
}
export function conGrosor(estilo, k = 1){
  const f = normalizarGrosor(k);
  if(!estilo) return estilo;
  // En 0 la línea no se dibuja: con un dashArray «0 0» se vería continua.
  if(f === 0) return null;
  if(f === 1) return estilo;
  const escalar = x=>Math.round(x * f * 100) / 100;
  const out = { ...estilo, weight: escalar(estilo.weight) };
  if(estilo.dashArray) out.dashArray = String(estilo.dashArray).trim().split(/[\s,]+/).map(x=>escalar(Number(x))).join(" ");
  return out;
}
// «1×», «1,5×», «0,75×»; en 0, «0× (sin líneas)».
export function textoGrosor(k){
  const f = normalizarGrosor(k);
  return f === 0 ? "0× (sin líneas)" : `${String(f).replace(".", ",")}×`;
}

// Filtro (c): tipo = rol calculado; estado = el de la simulación (solo si está activa).
// Filtro por red (007): "sin" = equipos sin red (con la 011, sin red efectiva).
// Filtro por tipo de equipo (v12, 3.4): el `tipo_equipo` de la 007; los que no
// tienen tipo van en TIPO_EQUIPO_SIN. Las ubicaciones sin ningún equipo de red
// tienen su propia opción, UBICACION_SIN_EQUIPOS. Las dos claves llevan un
// guion, que un valor de tipos_equipo_red no puede tener (^[a-z0-9_]+$).
export const TIPO_EQUIPO_SIN = "-sin-tipo";
export const UBICACION_SIN_EQUIPOS = "-sin-equipos";
export function claveRed(e){ const r = redEfectivaDe(e); return r !== null ? String(r) : "sin"; }
export function claveTipoEquipo(e){ return (e && e.tipo_equipo) || TIPO_EQUIPO_SIN; }
export function equipoVisible(red, equipoId, { rolesOcultos = [], estadosOcultos = [], redesOcultas = [], tiposEquipoOcultos = [] } = {}, sim = null){
  if(rolesOcultos.includes(red.rol.get(equipoId))) return false;
  if(redesOcultas.length && redesOcultas.includes(claveRed(red.equipoPorId.get(equipoId)))) return false;
  if(tiposEquipoOcultos.length && tiposEquipoOcultos.includes(claveTipoEquipo(red.equipoPorId.get(equipoId)))) return false;
  if(sim && estadosOcultos.includes((sim.estado.get(equipoId) || {}).estado)) return false;
  return true;
}
// v11 (3.6): una ubicación sin equipos de red cuenta como «Sin red» y se
// oculta con ese chip apagado, aunque tenga activos. v12 (3.4): también con
// «Sin equipos» apagado en «Tipos de equipo». Con equipos, se ve mientras
// alguno de ellos se vea (los roles y la simulación no tocan a las vacías).
// La seleccionada y las del camino las resuelve quien llama.
export function ubicacionVisiblePorEquipos(equipos, { redesOcultas = [], tiposEquipoOcultos = [] } = {}, visibleEquipo = ()=>true){
  if(!equipos || !equipos.length) return !redesOcultas.includes("sin") && !tiposEquipoOcultos.includes(UBICACION_SIN_EQUIPOS);
  return equipos.some(e=>visibleEquipo(e.id));
}
// Las ubicaciones sin ningún equipo de red (las activas; también las
// archivadas si se están viendo): las que «Sin red» oculta además de sus equipos.
export function ubicacionesSinEquipos(ubicaciones, equiposPorUbicacion, { verArchivadas = false } = {}){
  return (ubicaciones || []).filter(u=>(verArchivadas || u.activa !== false) && !((equiposPorUbicacion && equiposPorUbicacion.get(u.id)) || []).length);
}
// La ayuda (title) del chip «Sin red»: qué oculta o muestra, con cuántos son.
export function tituloSinRed(visible, equipos, vacias){
  const accion = visible ? "Ocultar" : "Mostrar";
  if(!vacias) return `${accion} los equipos de «Sin red»`;
  const ubic = `${vacias === 1 ? "la ubicación" : `las ${vacias} ubicaciones`} sin equipos de red`;
  if(!equipos) return `${accion} ${ubic}`;
  return `${accion} ${equipos === 1 ? "el equipo" : `los ${equipos} equipos`} sin red y ${ubic}`;
}

export function contarRoles(red){
  const n = Object.fromEntries(ROLES.map(r=>[r.id, 0]));
  for(const r of red.rol.values()) n[r] = (n[r] || 0) + 1;
  return n;
}

export function resumenRed(red){
  let respaldos = 0;
  for(const l of red.respaldosPorEquipo.values()) respaldos += l.length;
  return {
    raices: [...red.rol.values()].filter(r=>r === "raiz").length,
    backbone: red.enlaces.filter(l=>l.clase === "backbone").length,
    p2mp: red.enlaces.filter(l=>l.clase === "p2mp").length,
    cable: red.enlaces.filter(l=>l.clase === "cable" || l.clase === "fibra").length,
    respaldos,
    agrupados: red.agrupados.size,
  };
}

// Por ubicación: cuántos equipos tiene y cómo quedaron en la simulación.
export function estadoPorUbicacion(red, sim = null){
  const out = new Map();
  for(const e of red.equipoPorId.values()){
    if(!out.has(e.ubicacion_id)) out.set(e.ubicacion_id, { total: 0, sinConexion: 0, caidos: 0, respaldo: 0 });
    const c = out.get(e.ubicacion_id);
    c.total++;
    const st = sim ? sim.estado.get(e.id) : null;
    if(st){
      if(!st.conectado) c.sinConexion++;
      if(st.caido) c.caidos++;
      if(st.estado === "respaldo") c.respaldo++;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Qué dibujar: líneas (con su estilo) e indicadores de servidores agrupados.
// La vista solo traduce esto a Leaflet.
// ---------------------------------------------------------------------------
// opciones:
//   lineas          { backbone, p2mp, cable, respaldos } (toggles; "cable" = cable y fibra entre sitios)
//   visibleEquipo   id → bool (filtros de rol/estado)
//   visibleUbicacion id → bool (filtros de tipo/archivadas)
//   sim             resultado de simularFallas, o null
//   seleccionId     equipo seleccionado (resalta su camino y atenúa el resto)
//   expandidos      Set de servidores agrupados que el usuario expandió
//
// estilo: "backbone" | "p2mp" | "cable" | "fibra" | "cadena" | "cadenaRespaldo" | "cadenaRota" |
//         "cortado" | "sinConexion" | "respaldo" | "recuperado"
export function planDeLineas(red, { lineas = { backbone: true, p2mp: true, cable: true, respaldos: false }, visibleEquipo = ()=>true, visibleUbicacion = ()=>true, sim = null, seleccionId = null, expandidos = new Set() } = {}){
  const out = [];
  const camino = seleccionId !== null && red.equipoPorId.has(seleccionId) ? caminoARaiz(red, seleccionId, sim) : [];
  const tramos = tramosDeCamino(red, camino, sim);
  const enCadena = new Set(tramos.map(t=>`${t.cliente}>${t.servidor}`));
  const clientesDirectos = new Set(seleccionId !== null ? (red.clientes.get(seleccionId) || []).map(c=>c.id) : []);
  const hayCadena = camino.length > 0;
  const expandido = sid=>expandidos.has(sid) || sid === seleccionId;
  const punto = u=>({ lat: u.lat, lng: u.lng });

  for(const l of red.enlaces){
    const c = l.cliente.id, s = l.servidor.id;
    const cadena = enCadena.has(`${c}>${s}`);
    const st = sim ? sim.estado.get(c) : null;
    const funciona = !sim || !!(st && st.conectado && st.via === s);
    // La línea del equipo seleccionado se ve siempre (aunque su servidor esté agrupado o filtrado).
    if(!cadena && c !== seleccionId){
      if(!lineas[l.clase === "fibra" ? "cable" : l.clase]) continue;
      if(!visibleEquipo(c) || !visibleEquipo(s)) continue;
      if(!visibleUbicacion(l.uCliente.id) || !visibleUbicacion(l.uServidor.id)) continue;
      if(l.agrupado && !expandido(s)) continue;
    }
    let estilo = l.clase;
    if(sim){
      if(st && st.caido) estilo = "cortado";
      else if(!funciona) estilo = "sinConexion";
    }
    if(cadena) estilo = funciona ? "cadena" : "cadenaRota";
    out.push({
      clave: `p:${c}`, tipo: "principal", estilo, clase: l.clase, medio: l.medio, clienteId: c, servidorId: s,
      desde: punto(l.uServidor), hasta: punto(l.uCliente), distanciaKm: l.distanciaKm, banda: l.banda,
      enCadena: cadena, atenuada: hayCadena && !cadena && c !== seleccionId && !(s === seleccionId && clientesDirectos.has(c)),
    });
  }

  // Respaldos: el que está en uso en la simulación se dibuja siempre (recuperado);
  // los demás, solo con el toggle "Respaldos" (ni siquiera los del equipo
  // seleccionado: su lista está en el panel).
  for(const [equipoId, filas] of red.respaldosPorEquipo){
    const e = red.equipoPorId.get(equipoId);
    const st = sim ? sim.estado.get(equipoId) : null;
    for(const r of filas){
      const s = red.equipoPorId.get(r.servidor_alternativo_id);
      if(!s || s.ubicacion_id === e.ubicacion_id) continue; // por cable: no hay línea
      const u = red.ubicacionPorId.get(e.ubicacion_id), us = red.ubicacionPorId.get(s.ubicacion_id);
      if(!u || !us) continue;
      const enUso = !!(st && st.conectado && st.respaldo && st.respaldo.id === r.id);
      const cadena = enCadena.has(`${equipoId}>${s.id}`);
      if(!enUso && !cadena){
        if(!lineas.respaldos) continue;
        if(!visibleEquipo(equipoId) || !visibleEquipo(s.id)) continue;
        if(!visibleUbicacion(u.id) || !visibleUbicacion(us.id)) continue;
      }
      out.push({
        clave: `r:${r.id}`, tipo: "respaldo", estilo: cadena ? "cadenaRespaldo" : (enUso ? "recuperado" : "respaldo"),
        clienteId: equipoId, servidorId: s.id, respaldoId: r.id, prioridad: r.prioridad,
        desde: punto(us), hasta: punto(u), distanciaKm: distanciaKm(us, u), banda: s.banda || e.banda || null,
        enCadena: cadena, enUso, atenuada: hayCadena && !cadena && equipoId !== seleccionId && s.id !== seleccionId,
        ubicacionRespaldo: us.nombre,
      });
    }
  }
  return out;
}

// Indicadores de servidores con muchos clientes ("AP · 23 clientes"), por ubicación.
export function planDeAgrupados(red, { sim = null, expandidos = new Set(), seleccionId = null } = {}){
  const out = [];
  for(const sid of red.agrupados){
    const s = red.equipoPorId.get(sid);
    const clientes = red.clientesRemotos.get(sid) || [];
    const st = sim ? sim.estado.get(sid) : null;
    const sinConexion = sim ? clientes.filter(c=>!(sim.estado.get(c.id) || {}).conectado).length : 0;
    out.push({
      servidorId: sid, ubicacionId: s.ubicacion_id, nombre: s.nombre, clientes: clientes.length,
      expandido: expandidos.has(sid) || sid === seleccionId,
      servidorSinConexion: !!(st && !st.conectado), clientesSinConexion: sinConexion,
    });
  }
  return out.sort((a, b)=>String(a.nombre).localeCompare(String(b.nombre), "es"));
}
