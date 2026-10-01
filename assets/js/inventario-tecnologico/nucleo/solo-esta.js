// «Solo esta» (v12, pedido 3.5 de la persona): en cualquier filtro con
// casillas (el mapa, los filtros de columna de la tabla de activos y las
// facetas del selector de servidor), el doble clic en una opción, su botón
// «solo» o Mayús+Enter dejan solo esa opción. Si ya era la única, vuelven
// todas. Lógica pura: la usan las tres vistas y se prueba en Node.

// todos: los valores posibles; activos: los marcados ahora (cualquier
// iterable); valor: la opción elegida. Devuelve los que quedan marcados.
export function soloEsta(todos, activos, valor){
  const marcados = [...(activos || [])];
  if(marcados.length === 1 && marcados[0] === valor) return [...(todos || [])];
  return [valor];
}

// Lo mismo para los filtros que guardan lo OCULTO (los del mapa): devuelve la
// lista nueva de ocultos.
export function soloEstaOcultos(todos, ocultos, valor){
  const lista = [...(todos || [])];
  const fuera = new Set(ocultos || []);
  const visibles = lista.filter(v=>!fuera.has(v));
  const quedan = new Set(soloEsta(lista, visibles, valor));
  return lista.filter(v=>!quedan.has(v));
}

// La ayuda que llevan las opciones y el texto del botón.
export const AYUDA_SOLO = "Doble clic, «solo» o Mayús+Enter: deja solo esa opción (otra vez: vuelven todas).";
export function tituloSolo(etiqueta){ return `Dejar solo «${etiqueta}» (Mayús+Enter). Si ya es la única, vuelven todas.`; }

// ¿Es Mayús+Enter? (sin Ctrl, Alt ni Cmd, para no pisar atajos del navegador)
export function esMayusEnter(e){ return !!(e && e.key === "Enter" && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey); }
