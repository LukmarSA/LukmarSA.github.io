// Datos de prueba (fixtures) para el arnés de pruebas (tests/run.mjs).
// Pensados para ejercitar, con datos de forma realista, las partes clave de
// la app: el split en módulos ES, el namespacing CSS/JS, el formateo de
// fechas (fmtFecha), la gestión de tipos/propiedad/estado (con una fila
// inactiva en cada tabla) y la búsqueda de historial por custodio (una
// misma persona en dos activos distintos, uno de ellos dado de baja).
export const TABLAS = {
  perfiles: [
    { id: "u-admin", rol: "administrador", nombre_completo: "Ana Admin" },
  ],
  permisos: [
    { rol: "operador", accion: "ver_listado", permitido: true },
    { rol: "operador", accion: "crear_activo", permitido: false },
  ],
  tipos_activo: [
    { id: 1, nombre: "Laptop", color: "#3A5068", icono_svg: null, campos_pertinentes: ["serie","so","ram_gb","disco_gb","procesador"], orden: 10, activo: true },
    { id: 2, nombre: "Monitor", color: "#8B9AAA", icono_svg: null, campos_pertinentes: [], orden: 20, activo: false },
  ],
  propiedad_opciones: [
    { id: 1, valor: "lukmar", etiqueta: "Lukmar", orden: 10, activo: true },
    { id: 2, valor: "rentado", etiqueta: "Rentado", orden: 20, activo: false },
  ],
  estado_opciones: [
    { id: 1, valor: "operativo", etiqueta: "Operativo", color_fg: "#1A7A4C", color_bg: "#DFF3E8", orden: 10, activo: true },
    { id: 2, valor: "danado", etiqueta: "Dañado", color_fg: "#B3432D", color_bg: "#FBE2DC", orden: 20, activo: false },
  ],
  activos: [
    {
      id: 1, propiedad: "lukmar", tipo: "Laptop", marca: "Dell", modelo: "Latitude 5420",
      serie: "SN-001", nombre_dispositivo: "LAPTOP-01", mac_wifi: null, mac_ethernet: null,
      sistema_operativo: "Windows 11", ram_gb: 16, disco_gb: 512, procesador: "i5-1135G7",
      proveedor: "CompuEcuador", fecha_adquisicion: "2024-01-15", color: null, longitud_m: null,
      valor_compra: 850, vida_util_anios: 3, estado: "operativo", fotos: [], celular_gmail: null, celular_password: null,
      trazabilidad: null,
    },
    {
      id: 2, propiedad: "lukmar", tipo: "Laptop", marca: "HP", modelo: "ProBook 440",
      serie: "SN-002", nombre_dispositivo: "LAPTOP-02", mac_wifi: null, mac_ethernet: null,
      sistema_operativo: "Windows 11", ram_gb: 8, disco_gb: 256, procesador: "i5-1235U",
      proveedor: "CompuEcuador", fecha_adquisicion: "2024-06-01", color: null, longitud_m: null,
      valor_compra: 700, vida_util_anios: 3, estado: "operativo", fotos: [], celular_gmail: null, celular_password: null,
      trazabilidad: null,
    },
  ],
  // activo_id 1: Juan Pérez tuvo el activo 1 hasta el 2026-09-08, luego pasó
  // a María López (vigente) — la entrega a María quedó pendiente de firmar,
  // para ejercitar los botones de acta del modal de Pendientes de firma.
  // activo_id 2: Juan Pérez es el custodio VIGENTE, entrega el 2026-09-09 —
  // regresión directa del bug de fmtFecha, que mostraba "8 de septiembre" en
  // vez de "9 de septiembre" en huso horario UTC-5. Buscar "Juan" en
  // Historial por custodio debe mostrar AMBOS activos con sus rangos de fecha.
  historial_custodia: [
    { id: 101, activo_id: 1, orden: 1, tipo_custodio: "persona", nombre: "Juan Pérez", cargo: "Contador", desde: "2024-01-15", hasta: "2026-09-08", tipo_entrega: "firmada", tipo_devolucion: "firmada", observacion_entrega: null, observacion_devolucion: null },
    { id: 102, activo_id: 1, orden: 2, tipo_custodio: "persona", nombre: "María López", cargo: "Contadora", desde: "2026-09-08", hasta: null, tipo_entrega: "pendiente_firma", tipo_devolucion: null, observacion_entrega: null, observacion_devolucion: null },
    { id: 103, activo_id: 2, orden: 1, tipo_custodio: "persona", nombre: "Juan Pérez", cargo: "Contador", desde: "2026-09-09", hasta: null, tipo_entrega: "firmada", tipo_devolucion: null, observacion_entrega: null, observacion_devolucion: null },
  ],
  bajas: [
    {
      id: 201, fecha_baja: "2025-03-01", motivo: "Robo", dado_de_baja_por: "u-admin",
      activo: {
        id: 3, tipo: "Laptop", marca: "Lenovo", modelo: "ThinkPad E14", propiedad: "lukmar",
        historial_custodia: [
          { id: 104, activo_id: 3, orden: 1, tipo_custodio: "persona", nombre: "Juan Pérez", cargo: "Contador", desde: "2023-05-01", hasta: "2025-03-01", tipo_entrega: "firmada", tipo_devolucion: "perdida", observacion_entrega: null, observacion_devolucion: "Denuncia adjunta." },
        ],
      },
    },
  ],
  auditoria: [
    { fecha: "2026-09-01T10:00:00Z", usuario_id: "u-admin", accion: "login", detalle: null },
  ],
};

export const SESION_FAKE = { user: { id: "u-admin", email: "ana@lukmar.local" } };

// Cliente Supabase de mentira: soporta el mismo encadenamiento que usa la
// app (select/order/eq/limit/single, insert, update().eq(), upsert) y es
// "thenable" (implementa then) para que un simple `await sb.from(x).select()`
// sin `.single()` también funcione, igual que con el cliente real.
export function crearClienteFake(tablas, sesionFake){
  function construirQuery(nombreTabla){
    let filas = (tablas[nombreTabla] || []).slice();
    let limiteN = null;
    const builder = {
      select(){ return builder; },
      order(campo, opts){
        const asc = !(opts && opts.ascending === false);
        filas = [...filas].sort((a,b)=>{
          const va = a[campo], vb = b[campo];
          if(va===vb) return 0;
          return (va>vb?1:-1) * (asc?1:-1);
        });
        return builder;
      },
      eq(campo, valor){ filas = filas.filter(f=>f[campo]===valor); return builder; },
      limit(n){ limiteN = n; return builder; },
      single: async ()=>{
        const lista = limiteN!==null ? filas.slice(0,limiteN) : filas;
        return lista.length ? {data:lista[0], error:null} : {data:null, error:{message:"No rows found"}};
      },
      insert: async (obj)=>{
        const nuevo = Array.isArray(obj) ? obj : [obj];
        nuevo.forEach(o=>{ (tablas[nombreTabla] ||= []).push({ id: Math.max(0,...tablas[nombreTabla].map(r=>r.id||0))+1, activo:true, ...o }); });
        return { data:null, error:null };
      },
      update(campos){
        const idsFiltrados = filas.map(f=>f.id);
        return {
          eq: async (campo, valor)=>{
            (tablas[nombreTabla]||[]).forEach(fila=>{
              if(idsFiltrados.includes(fila.id) && fila[campo]===valor) Object.assign(fila, campos);
            });
            return { data:null, error:null };
          },
        };
      },
      upsert: async ()=>({data:null, error:null}),
      delete(){ return builder; },
      then(resolve){
        const lista = limiteN!==null ? filas.slice(0,limiteN) : filas;
        resolve({data: lista, error:null});
      },
    };
    return builder;
  }
  return {
    auth: {
      getSession: async ()=>({data:{session: sesionFake}}),
      onAuthStateChange(){ return { data:{ subscription:{ unsubscribe(){} } } }; },
      signOut: async ()=>({}),
      signInWithPassword: async ()=>({data:{user:null}, error:{message:"stub"}}),
    },
    from(tabla){ return construirQuery(tabla); },
    rpc: async ()=>({data:null, error:null}),
    storage: { from(){ return { getPublicUrl(){return{data:{publicUrl:""}};}, upload: async()=>({error:null}), remove: async()=>({}) }; } },
  };
}
