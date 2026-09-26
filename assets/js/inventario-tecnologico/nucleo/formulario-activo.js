// Formulario "Nuevo activo" / "Editar" (datos base): qué campos se muestran
// según el tipo, qué se guarda y cómo se filtra y ordena la lista de tipos.
//
// Lógica pura: no toca el DOM ni Supabase (las listas de campos llegan por
// parámetro, desde nucleo/opciones-configurables.js), así se prueba en Node
// (tests/activo-unit.mjs).

// Campo del formulario (clave de campos_pertinentes) → clave en el objeto que
// reciben crearActivo()/editarActivoBase() (negocio/operaciones.js).
export const CLAVE_GUARDADO = {
  serie: "serie", so: "sistema_operativo", ram_gb: "ram_gb", disco_gb: "disco_gb",
  procesador: "procesador", mac_wifi: "mac_wifi", mac_ethernet: "mac_ethernet",
  color: "color", longitud_m: "longitud_m",
};

export const TIPO_CELULAR = "Celular";

// Campos opcionales que se ven para un tipo: los "de cómputo" que el tipo
// marca como pertinentes, los extra (color, longitud) que el tipo pide y el
// bloque de celular solo para Celular. Mismas reglas que el detalle
// (camposNoRelevantesParaDetalle / camposExtraParaTipo).
export function camposVisibles({ tipo = "", pertinentes = [], bloqueables = [], extras = [] } = {}){
  const visibles = new Set();
  for(const c of bloqueables) if(pertinentes.includes(c)) visibles.add(c);
  for(const c of extras) if(pertinentes.includes(c)) visibles.add(c);
  if(tipo === TIPO_CELULAR) visibles.add("celular");
  return visibles;
}

// Arma el objeto a guardar: los campos comunes siempre; los opcionales solo si
// se ven. Un campo oculto NO se envía: al editar, la base conserva su valor
// (vuelve a verse si se regresa al tipo anterior); en un activo nuevo queda
// vacío. valores = { campo: valor } leído del formulario.
export function camposParaGuardar(valores, visibles, { comunes = [] } = {}){
  const campos = {};
  for(const k of comunes) if(k in valores) campos[k] = valores[k];
  for(const [campo, clave] of Object.entries(CLAVE_GUARDADO)){
    if(visibles.has(campo) && clave in valores) campos[clave] = valores[clave];
  }
  if(visibles.has("celular")){
    if("gmail" in valores) campos.gmail = valores.gmail;
    if("password" in valores) campos.password = valores.password;
  }
  return campos;
}

// Sin tildes ni mayúsculas, para buscar "camara" y encontrar "Cámara IP".
export function normalizarBusqueda(texto){
  return String(texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const COMPARADOR = new Intl.Collator("es", { sensitivity: "base", numeric: true });

// opciones = [{ valor, etiqueta }]. La opción vacía ("— Selecciona —") no
// entra acá: la maneja el selector aparte, siempre primero.
export function filtrarYOrdenar(opciones, { texto = "", orden = "asc" } = {}){
  const q = normalizarBusqueda(texto);
  const lista = opciones.filter(o=>!q || normalizarBusqueda(o.etiqueta).includes(q));
  lista.sort((a, b)=>COMPARADOR.compare(a.etiqueta, b.etiqueta) || COMPARADOR.compare(a.valor, b.valor));
  if(orden === "desc") lista.reverse();
  return lista;
}

export function ordenSiguiente(orden){ return orden === "desc" ? "asc" : "desc"; }
