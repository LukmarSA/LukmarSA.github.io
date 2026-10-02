// Buscador de las listas de casillas (v13, pedido de la persona el 1-oct):
// en los desplegables del mapa (Ubicaciones, Redes y Tipos de equipo) y en
// los filtros de columna de la tabla de activos (Tipo y Marca), lo escrito
// deja a la vista solo las opciones cuyo nombre coincide, sin distinguir
// mayúsculas ni tildes, y con las palabras en cualquier orden («cam ip»
// encuentra «Cámara IP»). Solo cambia lo que se ve en la lista: no filtra el
// mapa ni la tabla. Lógica pura: se prueba en Node (tests/mapa-unit.mjs).

// «  Cámara   IP » → «camara ip».
export function normalizarOpcion(texto){
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

// ¿La opción coincide con lo escrito? Cada palabra escrita tiene que estar en
// el nombre. Sin nada escrito, coinciden todas.
export function coincideOpcion(etiqueta, consulta){
  const palabras = normalizarOpcion(consulta).split(" ").filter(Boolean);
  if(!palabras.length) return true;
  const nombre = normalizarOpcion(etiqueta);
  return palabras.every(p=>nombre.includes(p));
}

// Las opciones que coinciden, en su orden. `etiquetaDe` saca el nombre de
// cada opción (por defecto, su `etiqueta`, o la opción misma si es texto).
export function filtrarOpciones(opciones, consulta, etiquetaDe = o=>(o && typeof o === "object" ? o.etiqueta : o)){
  return [...(opciones || [])].filter(o=>coincideOpcion(etiquetaDe(o), consulta));
}

// El aviso cuando no queda ninguna.
export function textoSinCoincidencias(consulta){
  return `Ninguna coincide con «${String(consulta ?? "").replace(/\s+/g, " ").trim()}».`;
}

// La ayuda del buscador de los desplegables del mapa (en su título). «Todas»
// y «Ninguna» siguen aplicando a todas las opciones, como en la tabla.
export const AYUDA_BUSCAR_OPCION = "Escribe para encontrar una opción (sin importar mayúsculas ni tildes). Si queda una sola: Enter la marca o desmarca y Mayús+Enter la deja sola. Flecha abajo: a la lista. Esc: borra lo escrito.";
