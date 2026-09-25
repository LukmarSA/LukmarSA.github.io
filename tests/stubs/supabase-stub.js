// Supabase falso para las pruebas en navegador (mapa-smoke.mjs). Se inyecta en
// lugar de cdn.jsdelivr.net/npm/@supabase/supabase-js@2 y expone el mismo
// window.supabase.createClient() con una base en memoria.
//
// Implementa solo lo que la app usa: select/insert/update/delete/upsert con
// eq/is/in/order/limit/single/maybeSingle, conteos (count+head), un nivel de
// "embed" (alias:tabla(columnas)), auth y storage mínimos. También imita las
// reglas de las migraciones 002/003 que cambian lo que la UI muestra o los
// errores que tiene que traducir: cerrar el tramo vigente al mover un activo,
// ubicar el activo de un equipo, ciclos en la jerarquía, no borrar un equipo
// que es servidor de otros, respaldos (únicos, distintos del principal, en
// cascada, promovidos) y, de la 004, que la red solo se lee con ver_mapa y la
// función equipo_radio_de_activo. Las reglas de la base en sí se prueban
// contra Supabase de verdad (db/pruebas/mapa_pruebas_reglas_rls.sql), no aquí.
(function(){
  const fixture = window.__FIXTURE__ || {};
  const DB = window.__DB__ = JSON.parse(JSON.stringify(fixture.tablas || {}));
  const fallas = window.__FALLAS__ = fixture.fallas || {};   // { tabla: { code, message } } → cualquier consulta a esa tabla falla
  const escrituras = window.__ESCRITURAS__ = [];
  const sesion = fixture.sesion || null;                       // { user: { id, email } }
  const hoy = fixture.hoy || new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const TABLAS_CON_ID = ["activos","historial_custodia","bajas","auditoria","ubicaciones","equipos_radioenlace","enlaces_respaldo","historial_ubicacion"];

  const tabla = t=>(DB[t] ||= []);
  const siguienteId = t=>tabla(t).reduce((m, r)=>Math.max(m, Number(r.id) || 0), 0) + 1;
  const copia = o=>JSON.parse(JSON.stringify(o));

  // puede() de la base, con el perfil de la sesión y la matriz de permisos del fixture.
  function puede(accion){
    const perfil = sesion && tabla("perfiles").find(p=>p.id === sesion.user.id);
    if(!perfil) return false;
    if(perfil.rol === "administrador") return true;
    const fila = tabla("permisos").find(p=>p.rol === perfil.rol && p.accion === accion);
    return !!(fila && fila.permitido);
  }
  // RLS de lectura de la migración 004: la red (equipos y respaldos) solo con ver_mapa.
  const LECTURA_SOLO_MAPA = ["equipos_radioenlace", "enlaces_respaldo"];

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

  // --- imitación de las reglas de la 003 -------------------------------------
  const vacio = v=>v === null || v === undefined;
  function validarJerarquia(equipo){
    if(vacio(equipo.servidor_id)) return;
    if(equipo.servidor_id === equipo.id) throw { code:"23514", message:"Un equipo no puede ser su propio servidor." };
    const porId = new Map(tabla("equipos_radioenlace").map(e=>[e.id, e]));
    let x = porId.get(equipo.servidor_id), pasos = 0;
    while(x && pasos++ < 10000){
      if(x.id === equipo.id) throw { code:"23514", message:`Ciclo en la jerarquía: «${equipo.nombre}» no puede tener como servidor a un equipo que depende de él.` };
      x = vacio(x.servidor_id) ? null : porId.get(x.servidor_id);
    }
  }
  function validarRespaldo(r, idActual){
    if(r.equipo_id === r.servidor_alternativo_id) throw { code:"23514", message:'new row for relation "enlaces_respaldo" violates check constraint "enlaces_respaldo_distintos"' };
    if(!(Number(r.prioridad) >= 1)) throw { code:"23514", message:'new row for relation "enlaces_respaldo" violates check constraint "enlaces_respaldo_prioridad_positiva"' };
    const e = tabla("equipos_radioenlace").find(x=>x.id === r.equipo_id);
    if(e && e.servidor_id === r.servidor_alternativo_id) throw { code:"23514", message:"Ese equipo ya es su servidor principal: un respaldo tiene que ser otro." };
    if(tabla("enlaces_respaldo").some(x=>x.id !== idActual && x.equipo_id === r.equipo_id && x.servidor_alternativo_id === r.servidor_alternativo_id)) throw { code:"23505", message:'duplicate key value violates unique constraint "enlaces_respaldo_par_unico"' };
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
          resultado = LECTURA_SOLO_MAPA.includes(this.t) && !puede("ver_mapa") ? [] : this.filas();
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
            if(this.t === "equipos_radioenlace"){ if(fila.servidor_id === undefined) fila.servidor_id = null; validarJerarquia(fila); }
            if(this.t === "enlaces_respaldo"){ if(fila.prioridad === undefined) fila.prioridad = 1; validarRespaldo(fila, null); }
            tabla(this.t).push(fila);
            if(this.t === "equipos_radioenlace") sincronizarActivoDeEquipo(fila);
            return fila;
          });
          escrituras.push({ tabla: this.t, op: "insert", filas: copia(resultado) });
        } else if(this.op === "update"){
          resultado = this.filas();
          for(const r of resultado){
            const nueva = { ...r, ...copia(this.datos) };
            if(this.t === "equipos_radioenlace" && "servidor_id" in this.datos) validarJerarquia(nueva);
            if(this.t === "enlaces_respaldo") validarRespaldo(nueva, r.id);
          }
          resultado.forEach(r=>{
            const servidorAntes = r.servidor_id;
            Object.assign(r, copia(this.datos));
            if(this.t === "equipos_radioenlace"){
              sincronizarActivoDeEquipo(r);
              if(!vacio(r.servidor_id) && r.servidor_id !== servidorAntes) DB.enlaces_respaldo = tabla("enlaces_respaldo").filter(x=>!(x.equipo_id === r.id && x.servidor_alternativo_id === r.servidor_id));
            }
          });
          escrituras.push({ tabla: this.t, op: "update", filas: copia(resultado), parche: copia(this.datos) });
        } else if(this.op === "delete"){
          resultado = this.filas();
          if(this.t === "equipos_radioenlace"){
            const ids = resultado.map(r=>r.id);
            if(tabla("equipos_radioenlace").some(e=>!ids.includes(e.id) && ids.includes(e.servidor_id))) throw { code:"23503", message:'update or delete on table "equipos_radioenlace" violates foreign key constraint "equipos_radioenlace_servidor_fk" on table "equipos_radioenlace"' };
            DB.enlaces_respaldo = tabla("enlaces_respaldo").filter(x=>!ids.includes(x.equipo_id) && !ids.includes(x.servidor_alternativo_id));
          }
          DB[this.t] = tabla(this.t).filter(r=>!resultado.includes(r));
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
      rpc: async (nombre, args)=>{
        if(fallas[`rpc:${nombre}`]) return { data: null, error: fallas[`rpc:${nombre}`] };
        // Solo lectura (migración 004): no se anota como escritura.
        if(nombre === "equipo_radio_de_activo"){
          const e = (puede("ver_listado") || puede("ver_mapa")) ? tabla("equipos_radioenlace").find(x=>x.activo_id === args.p_activo_id) : null;
          return { data: e ? [{ id: e.id, nombre: e.nombre, ubicacion_id: e.ubicacion_id }] : [], error: null };
        }
        escrituras.push({ rpc: nombre, args });
        return { data: null, error: null };
      },
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
