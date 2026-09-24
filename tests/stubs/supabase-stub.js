// Supabase falso para las pruebas en navegador (mapa-smoke.mjs). Se inyecta en
// lugar de cdn.jsdelivr.net/npm/@supabase/supabase-js@2 y expone el mismo
// window.supabase.createClient() con una base en memoria.
//
// Implementa solo lo que la app usa: select/insert/update/delete/upsert con
// eq/is/in/order/limit/single/maybeSingle, conteos (count+head), un nivel de
// "embed" (alias:tabla(columnas)), auth y storage mínimos. También imita los
// triggers de la migración 002 que cambian lo que la UI muestra (cerrar el
// tramo vigente al mover un activo, ubicar el activo de un equipo y borrar en
// cascada los enlaces de un equipo), para que los flujos se vean como en la
// base real. Las reglas de la base en sí se prueban contra Supabase de verdad
// (db/pruebas/002_pruebas_reglas_rls.sql), no aquí.
(function(){
  const fixture = window.__FIXTURE__ || {};
  const DB = window.__DB__ = JSON.parse(JSON.stringify(fixture.tablas || {}));
  const fallas = window.__FALLAS__ = fixture.fallas || {};   // { tabla: { code, message } } → cualquier consulta a esa tabla falla
  const escrituras = window.__ESCRITURAS__ = [];
  const sesion = fixture.sesion || null;                       // { user: { id, email } }
  const hoy = fixture.hoy || new Date().toISOString().slice(0,10);
  const TABLAS_CON_ID = ["activos","historial_custodia","bajas","auditoria","ubicaciones","equipos_radioenlace","enlaces","historial_ubicacion"];

  const tabla = t=>(DB[t] ||= []);
  const siguienteId = t=>tabla(t).reduce((m, r)=>Math.max(m, Number(r.id) || 0), 0) + 1;
  const copia = o=>JSON.parse(JSON.stringify(o));

  // "id, nombre, ubicacion:ubicaciones(id, nombre)" → { columnas:["id","nombre"], embeds:[{alias,tabla,columnas}] }
  function parsearSeleccion(sel){
    const partes = []; let prof = 0, actual = "";
    for(const c of String(sel || "*")){
      if(c === "(") prof++;
      if(c === ")") prof--;
      if(c === "," && prof === 0){ partes.push(actual.trim()); actual = ""; } else actual += c;
    }
    if(actual.trim()) partes.push(actual.trim());
    const columnas = [], embeds = [];
    for(const p of partes){
      const m = p.match(/^(\w+):(\w+)\(([^)]*)\)$/);
      if(m) embeds.push({ alias: m[1], tabla: m[2], columnas: m[3].split(",").map(s=>s.trim()) });
      else columnas.push(p);
    }
    return { columnas, embeds };
  }
  function proyectar(fila, sel){
    const { columnas, embeds } = parsearSeleccion(sel);
    const out = columnas.includes("*") ? copia(fila) : Object.fromEntries(columnas.map(c=>[c, fila[c] === undefined ? null : fila[c]]));
    for(const e of embeds){
      const ref = tabla(e.tabla).find(r=>r.id === fila[`${e.alias}_id`]);
      out[e.alias] = ref ? Object.fromEntries(e.columnas.map(c=>[c, ref[c] === undefined ? null : ref[c]])) : null;
    }
    return out;
  }

  // --- imitación de los triggers de la 002 -----------------------------------
  function antesDeInsertarTramo(nuevo){
    if(nuevo.hasta) return;
    const vig = tabla("historial_ubicacion").find(t=>t.activo_id === nuevo.activo_id && (t.hasta === null || t.hasta === undefined));
    if(vig){
      if(vig.ubicacion_id === nuevo.ubicacion_id) throw { code:"23514", message:"El activo ya está en esa ubicación." };
      vig.hasta = nuevo.desde;
    }
  }
  function sincronizarActivoDeEquipo(equipo){
    if(equipo.activo_id === null || equipo.activo_id === undefined) return;
    const vig = tabla("historial_ubicacion").find(t=>t.activo_id === equipo.activo_id && (t.hasta === null || t.hasta === undefined));
    if(vig && vig.ubicacion_id === equipo.ubicacion_id) return;
    const tramo = { id: siguienteId("historial_ubicacion"), activo_id: equipo.activo_id, ubicacion_id: equipo.ubicacion_id, desde: hoy, hasta: null, notas: `Automático: instalado como equipo de radioenlace «${equipo.nombre}»` };
    antesDeInsertarTramo(tramo);
    tabla("historial_ubicacion").push(tramo);
  }

  class Consulta {
    constructor(t){ this.t = t; this.op = "select"; this.filtros = []; this.ordenes = []; this.sel = "*"; this.devolver = false; this.uno = false; this.quizas = false; this.cabeza = false; this.contar = false; this.limite = null; this.datos = null; }
    select(cols = "*", opciones = {}){
      if(this.op !== "select") this.devolver = true;
      this.sel = cols;
      if(opciones.count) this.contar = true;
      if(opciones.head) this.cabeza = true;
      return this;
    }
    insert(filas){ this.op = "insert"; this.datos = Array.isArray(filas) ? filas : [filas]; return this; }
    update(parche){ this.op = "update"; this.datos = parche; return this; }
    delete(){ this.op = "delete"; return this; }
    upsert(filas, opciones = {}){ this.op = "upsert"; this.datos = Array.isArray(filas) ? filas : [filas]; this.conflicto = (opciones.onConflict || "id").split(","); return this; }
    eq(c, v){ this.filtros.push(r=>r[c] === v || (r[c] !== null && r[c] !== undefined && v !== null && String(r[c]) === String(v))); return this; }
    is(c, v){ this.filtros.push(r=>v === null ? (r[c] === null || r[c] === undefined) : r[c] === v); return this; }
    in(c, vs){ this.filtros.push(r=>vs.includes(r[c])); return this; }
    order(c, o = {}){ this.ordenes.push([c, o.ascending !== false]); return this; }
    limit(n){ this.limite = n; return this; }
    single(){ this.uno = true; return this; }
    maybeSingle(){ this.quizas = true; return this; }
    then(ok, mal){ return Promise.resolve().then(()=>this.ejecutar()).then(ok, mal); }
    filas(){ return tabla(this.t).filter(r=>this.filtros.every(f=>f(r))); }
    ejecutar(){
      if(fallas[this.t]) return { data: null, error: fallas[this.t], count: null };
      try{
        let resultado;
        if(this.op === "select"){
          resultado = this.filas();
          for(const [c, asc] of [...this.ordenes].reverse()) resultado = [...resultado].sort((a,b)=>(a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
          if(this.limite !== null) resultado = resultado.slice(0, this.limite);
          if(this.cabeza) return { data: null, error: null, count: resultado.length };
        } else if(this.op === "insert"){
          resultado = this.datos.map(f=>{
            const fila = copia(f);
            if(TABLAS_CON_ID.includes(this.t) && fila.id === undefined) fila.id = siguienteId(this.t);
            if(this.t === "ubicaciones"){ fila.fotos ||= []; if(fila.activa === undefined) fila.activa = true; }
            if(this.t === "historial_ubicacion"){ if(fila.hasta === undefined) fila.hasta = null; if(!fila.desde) fila.desde = hoy; antesDeInsertarTramo(fila); }
            if(this.t === "tipos_ubicacion" && fila.activo === undefined) fila.activo = true;
            tabla(this.t).push(fila);
            if(this.t === "equipos_radioenlace") sincronizarActivoDeEquipo(fila);
            return fila;
          });
          escrituras.push({ tabla: this.t, op: "insert", filas: copia(resultado) });
        } else if(this.op === "update"){
          resultado = this.filas();
          resultado.forEach(r=>{
            Object.assign(r, copia(this.datos));
            if(this.t === "equipos_radioenlace") sincronizarActivoDeEquipo(r);
          });
          escrituras.push({ tabla: this.t, op: "update", filas: copia(resultado), parche: copia(this.datos) });
        } else if(this.op === "delete"){
          resultado = this.filas();
          DB[this.t] = tabla(this.t).filter(r=>!resultado.includes(r));
          if(this.t === "equipos_radioenlace"){
            const ids = resultado.map(r=>r.id);
            DB.enlaces = tabla("enlaces").filter(l=>!ids.includes(l.equipo_origen_id) && !ids.includes(l.equipo_destino_id));
          }
          escrituras.push({ tabla: this.t, op: "delete", filas: copia(resultado) });
        } else if(this.op === "upsert"){
          resultado = this.datos.map(f=>{
            const existente = tabla(this.t).find(r=>this.conflicto.every(c=>r[c] === f[c]));
            if(existente){ Object.assign(existente, f); return existente; }
            const fila = copia(f); tabla(this.t).push(fila); return fila;
          });
          escrituras.push({ tabla: this.t, op: "upsert", filas: copia(resultado) });
        }
        if(this.op !== "select" && !this.devolver) return { data: null, error: null, count: null };
        const datos = resultado.map(r=>proyectar(r, this.sel));
        if(this.uno){
          if(datos.length !== 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
          return { data: datos[0], error: null };
        }
        if(this.quizas) return { data: datos[0] || null, error: null };
        return { data: datos, error: null, count: this.contar ? datos.length : null };
      }catch(err){
        return { data: null, error: err && err.code ? err : { message: String(err && err.message || err) } };
      }
    }
  }

  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  function crearCliente(){
    return {
      from: t=>new Consulta(t),
      rpc: async (nombre, args)=>{ escrituras.push({ rpc: nombre, args }); return { data: null, error: null }; },
      auth: {
        getSession: async ()=>({ data: { session: sesion ? { user: sesion.user } : null }, error: null }),
        onAuthStateChange: ()=>({ data: { subscription: { unsubscribe(){} } } }),
        signInWithPassword: async ()=>({ data: { user: sesion ? sesion.user : null }, error: sesion ? null : { message: "Invalid login" } }),
        signOut: async ()=>({ error: null }),
      },
      storage: {
        from: ()=>({
          getPublicUrl: ()=>({ data: { publicUrl: PIXEL } }),
          upload: async (ruta)=>{ escrituras.push({ storage: "upload", ruta }); return { data: { path: ruta }, error: null }; },
          remove: async (rutas)=>{ escrituras.push({ storage: "remove", rutas }); return { data: null, error: null }; },
        }),
      },
    };
  }
  window.supabase = { createClient: crearCliente };
})();
