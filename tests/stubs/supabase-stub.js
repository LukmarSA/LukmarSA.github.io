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
// función equipo_radio_de_activo; de la 006, la tabla del plano (se lee con
// ver_mapa, la escribe solo el admin, esquinas válidas, un solo plano activo);
// de la 007, tipos de equipo, redes y atajos (se leen con ver_mapa, los escribe
// el admin, nombres únicos, atajos con equipos que existen). Si el fixture no
// trae esas tablas, se comportan como una base SIN la 007 (tabla inexistente).
// De la 008 (fixture.m008): la columna "medio" y los nombres guardados al día
// (la base los recalcula después de cada cambio, como el trigger). De la 009:
// la tabla de piscinas (se lee con ver_mapa, la escribe el admin, nombre único
// y forma válida).
// Las reglas de la base en sí se prueban contra Supabase de verdad
// (db/pruebas/mapa_pruebas_reglas_rls.sql), no aquí.
(function(){
  const fixture = window.__FIXTURE__ || {};
  const DB = window.__DB__ = JSON.parse(JSON.stringify(fixture.tablas || {}));
  const fallas = window.__FALLAS__ = fixture.fallas || {};   // { tabla: { code, message } } → cualquier consulta a esa tabla falla
  const escrituras = window.__ESCRITURAS__ = [];
  const sesion = fixture.sesion || null;                       // { user: { id, email } }
  const hoy = fixture.hoy || new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
  const TABLAS_CON_ID = ["activos","historial_custodia","bajas","auditoria","ubicaciones","equipos_radioenlace","enlaces_respaldo","historial_ubicacion","planos_mapa","redes","atajos_simulacion","piscinas"];
  const TABLAS_007 = ["tipos_equipo_red", "redes", "atajos_simulacion"];
  const COLUMNAS_007 = ["tipo_equipo", "red_id", "referencia"];
  const hay007 = !!(fixture.tablas && "tipos_equipo_red" in fixture.tablas);
  const hay008 = !!fixture.m008;
  const hay009 = !!(fixture.tablas && "piscinas" in fixture.tablas);

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
  // RLS de lectura de la migración 004: la red (equipos y respaldos) solo con ver_mapa;
  // de la 006, el plano también. Y el plano solo lo escribe el administrador.
  const LECTURA_SOLO_MAPA = ["equipos_radioenlace", "enlaces_respaldo", "planos_mapa", "piscinas", ...TABLAS_007];
  const ESCRITURA_SOLO_ADMIN = ["planos_mapa", "piscinas", ...TABLAS_007];
  function esAdmin(){
    const perfil = sesion && tabla("perfiles").find(p=>p.id === sesion.user.id);
    return !!(perfil && perfil.rol === "administrador");
  }
  // CHECK planos_mapa_esquinas_validas (006): tres esquinas [lat, lng] en rango y no alineadas.
  function validarPlano(f){
    const ok = e=>{
      if(!e || typeof e !== "object") return false;
      const pts = ["no","ne","so"].map(k=>e[k]);
      if(!pts.every(p=>Array.isArray(p) && p.length === 2 && p.every(v=>typeof v === "number" && Number.isFinite(v)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) return false;
      return Math.abs((e.ne[1] - e.no[1]) * (e.so[0] - e.no[0]) - (e.ne[0] - e.no[0]) * (e.so[1] - e.no[1])) > 1e-12;
    };
    if(!ok(f.esquinas)) throw { code:"23514", message:'new row for relation "planos_mapa" violates check constraint "planos_mapa_esquinas_validas"' };
    if(!ok(f.esquinas_originales)) throw { code:"23514", message:'new row for relation "planos_mapa" violates check constraint "planos_mapa_originales_validas"' };
    if(f.activo !== false && tabla("planos_mapa").some(x=>x.id !== f.id && x.activo !== false)) throw { code:"23505", message:'duplicate key value violates unique constraint "planos_mapa_un_activo"' };
  }

  // --- imitación de la 007 ----------------------------------------------------
  const claveTexto = s=>String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  function validar007(t, f, idActual){
    if(t === "redes"){
      if(!claveTexto(f.nombre)) throw { code:"23514", message:'new row for relation "redes" violates check constraint "redes_nombre_valido"' };
      if(!/^#[0-9A-Fa-f]{6}$/.test(String(f.color))) throw { code:"23514", message:'new row for relation "redes" violates check constraint "redes_color_valido"' };
      if(tabla("redes").some(x=>x.id !== idActual && claveTexto(x.nombre) === claveTexto(f.nombre))) throw { code:"23505", message:'duplicate key value violates unique constraint "redes_nombre_unico"' };
    }
    if(t === "tipos_equipo_red"){
      if(tabla("tipos_equipo_red").some(x=>x.valor !== idActual && claveTexto(x.etiqueta) === claveTexto(f.etiqueta))) throw { code:"23505", message:'duplicate key value violates unique constraint "tipos_equipo_red_etiqueta_unica"' };
      if(idActual === null && tabla("tipos_equipo_red").some(x=>x.valor === f.valor)) throw { code:"23505", message:'duplicate key value violates unique constraint "tipos_equipo_red_pkey"' };
    }
    if(t === "atajos_simulacion"){
      if(!Array.isArray(f.equipos) || !f.equipos.length) throw { code:"23514", message:'new row for relation "atajos_simulacion" violates check constraint "atajos_simulacion_con_equipos"' };
      f.equipos = [...new Set(f.equipos.map(Number))].sort((a, b)=>a - b);
      const faltan = f.equipos.filter(id=>!tabla("equipos_radioenlace").some(e=>e.id === id));
      if(faltan.length) throw { code:"23503", message:`El atajo apunta a equipos que no existen: {${faltan.join(",")}}` };
      if(tabla("atajos_simulacion").some(x=>x.id !== idActual && claveTexto(x.nombre) === claveTexto(f.nombre))) throw { code:"23505", message:'duplicate key value violates unique constraint "atajos_simulacion_nombre_unico"' };
    }
    if(t === "equipos_radioenlace" && hay007){
      if(!vacio(f.tipo_equipo) && !tabla("tipos_equipo_red").some(x=>x.valor === f.tipo_equipo)) throw { code:"23503", message:'insert or update on table "equipos_radioenlace" violates foreign key constraint "equipos_radioenlace_tipo_fk"' };
      if(!vacio(f.referencia) && (!String(f.referencia).trim() || String(f.referencia).length > 60)) throw { code:"23514", message:'new row for relation "equipos_radioenlace" violates check constraint "equipos_radioenlace_referencia_valida"' };
    }
  }
  // --- imitación de la 008: nombres guardados al día (como recalcular_nombres_equipos) ---
  function recalcularNombres(){
    if(!hay008) return;
    const eqs = tabla("equipos_radioenlace");
    const ubic = new Map(tabla("ubicaciones").map(u=>[u.id, u]));
    const tipos = new Map(tabla("tipos_equipo_red").map(t=>[t.valor, t]));
    const porId = new Map(eqs.map(e=>[e.id, e]));
    const clave = t=>String(t ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
    const ref = r=>{ const x = String(r ?? "").trim(); return x ? ` (${x})` : ""; };
    const base = e=>{
      const t = e.tipo_equipo ? tipos.get(e.tipo_equipo) : null;
      if(!t) return null;
      const u = ubic.get(e.ubicacion_id);
      let n = `${t.etiqueta}${ref(e.referencia)} en ${u ? u.nombre : "?"}`;
      const sv = vacio(e.servidor_id) ? null : porId.get(e.servidor_id);
      if(sv){
        const misma = sv.ubicacion_id === e.ubicacion_id;
        const medio = ["cable", "fibra", "inalambrico"].includes(e.medio) ? e.medio : (misma ? "cable" : "inalambrico");
        const ts = sv.tipo_equipo ? tipos.get(sv.tipo_equipo) : null;
        const us = ubic.get(sv.ubicacion_id);
        n += ` ${medio === "inalambrico" ? "enlazad" : "conectad"}${t.genero === "f" ? "a" : "o"} a ${ts ? `${ts.etiqueta}${ref(sv.referencia)}` : sv.nombre}${misma ? "" : ` en ${us ? us.nombre : "?"}`}`;
      }
      return n;
    };
    const ocupados = new Map();
    const ocupar = (u, n)=>{ if(!ocupados.has(u)) ocupados.set(u, new Set()); ocupados.get(u).add(clave(n)); };
    const conTipo = [];
    for(const e of eqs){ const b = base(e); if(b === null) ocupar(e.ubicacion_id, e.nombre); else conTipo.push([e, b]); }
    conTipo.sort((a, b)=>a[0].id - b[0].id);
    const nuevos = conTipo.map(([e, b])=>{
      const usados = ocupados.get(e.ubicacion_id) || new Set();
      const num = k=>k <= 1 ? b : `${b} (${k})`;
      let k = 1;
      while(usados.has(clave(num(k)))) k++;
      ocupar(e.ubicacion_id, num(k));
      return [e, num(k)];
    });
    for(const [e, n] of nuevos) e.nombre = n;
  }
  function validar008(t, f){
    if(!hay008 || t !== "equipos_radioenlace") return;
    if(!vacio(f.medio) && !["cable", "fibra", "inalambrico"].includes(f.medio)) throw { code:"23514", message:'new row for relation "equipos_radioenlace" violates check constraint "equipos_radioenlace_medio_valido"' };
  }
  // --- imitación de la 009: piscinas ---
  function validarPiscina(f, idActual){
    if(!claveTexto(f.nombre) || String(f.nombre).length > 40) throw { code:"23514", message:'new row for relation "piscinas" violates check constraint "piscinas_nombre_valido"' };
    if(tabla("piscinas").some(x=>x.id !== idActual && claveTexto(x.nombre) === claveTexto(f.nombre))) throw { code:"23505", message:'duplicate key value violates unique constraint "piscinas_nombre_unico"' };
    const ok = Array.isArray(f.puntos) && f.puntos.length >= 3 && f.puntos.length <= 2000 && f.puntos.every(p=>Array.isArray(p) && p.length === 2 && p.every(v=>typeof v === "number" && Number.isFinite(v)) && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180);
    if(!ok) throw { code:"23514", message:'new row for relation "piscinas" violates check constraint "piscinas_geom_valida"' };
    if(!vacio(f.hectareas) && !(Number(f.hectareas) > 0)) throw { code:"23514", message:'new row for relation "piscinas" violates check constraint "piscinas_hectareas_validas"' };
  }

  function columnas007SinMigracion(t, datos){
    if(hay007 || t !== "equipos_radioenlace") return null;
    const filas = Array.isArray(datos) ? datos : [datos];
    const c = COLUMNAS_007.find(k=>filas.some(f=>f && k in f));
    return c ? { code:"PGRST204", message:`Could not find the '${c}' column of 'equipos_radioenlace' in the schema cache` } : null;
  }
  function columna008SinMigracion(t, datos){
    if(hay008 || t !== "equipos_radioenlace") return null;
    const filas = Array.isArray(datos) ? datos : [datos];
    return filas.some(f=>f && "medio" in f) ? { code:"PGRST204", message:"Could not find the 'medio' column of 'equipos_radioenlace' in the schema cache" } : null;
  }

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
      if(TABLAS_007.includes(this.t) && !hay007) return { data: null, error: { code:"PGRST205", message:`Could not find the table 'public.${this.t}' in the schema cache` }, count: null };
      if(this.t === "piscinas" && !hay009) return { data: null, error: { code:"PGRST205", message:"Could not find the table 'public.piscinas' in the schema cache" }, count: null };
      if(this.t === "equipos_radioenlace" && !hay008 && this.op === "select" && /\bmedio\b/.test(String(this.sel))) return { data: null, error: { code:"42703", message:"column equipos_radioenlace.medio does not exist" }, count: null };
      const sin007 = (this.op === "insert" || this.op === "update") ? (columnas007SinMigracion(this.t, this.datos) || columna008SinMigracion(this.t, this.datos)) : null;
      if(sin007) return { data: null, error: sin007, count: null };
      try{
        let resultado;
        if(this.op === "select"){
          resultado = LECTURA_SOLO_MAPA.includes(this.t) && !puede("ver_mapa") ? [] : this.filas();
          for(const [c, asc] of [...this.ordenes].reverse()) resultado = [...resultado].sort((a,b)=>(a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1));
          if(this.limite !== null) resultado = resultado.slice(0, this.limite);
          if(this.cabeza) return { data: null, error: null, count: resultado.length };
        } else if(this.op === "insert"){
          if(ESCRITURA_SOLO_ADMIN.includes(this.t) && !esAdmin()) throw { code:"42501", message:`new row violates row-level security policy for table "${this.t}"` };
          resultado = this.datos.map(f=>{
            const fila = copia(f);
            if(TABLAS_CON_ID.includes(this.t) && fila.id === undefined) fila.id = siguienteId(this.t);
            if(this.t === "ubicaciones"){ fila.fotos ||= []; if(fila.activa === undefined) fila.activa = true; }
            if(this.t === "historial_ubicacion"){ if(fila.hasta === undefined) fila.hasta = null; if(!fila.desde) fila.desde = hoy; antesDeInsertarTramo(fila); }
            if(this.t === "tipos_ubicacion" && fila.activo === undefined) fila.activo = true;
            if(this.t === "equipos_radioenlace"){ if(fila.servidor_id === undefined) fila.servidor_id = null; if(hay008 && fila.medio === undefined) fila.medio = null; validarJerarquia(fila); validar008(this.t, fila); }
            if(this.t === "piscinas"){ if(fila.activa === undefined) fila.activa = true; if(fila.orden === undefined) fila.orden = 0; if(fila.revisar === undefined) fila.revisar = false; if(fila.fuente === undefined) fila.fuente = "manual"; validarPiscina(fila, null); fila.actualizado_en = new Date().toISOString(); }
            if(this.t === "enlaces_respaldo"){ if(fila.prioridad === undefined) fila.prioridad = 1; validarRespaldo(fila, null); }
            if(this.t === "planos_mapa"){ if(fila.activo === undefined) fila.activo = true; fila.actualizado_en = new Date().toISOString(); validarPlano(fila); }
            if(this.t === "redes"){ if(fila.activa === undefined) fila.activa = true; if(fila.orden === undefined) fila.orden = 0; if(fila.color === undefined) fila.color = "#007EB2"; }
            if(this.t === "tipos_equipo_red"){ if(fila.activo === undefined) fila.activo = true; if(fila.orden === undefined) fila.orden = 0; if(fila.genero === undefined) fila.genero = "m"; }
            if(this.t === "atajos_simulacion" && fila.orden === undefined) fila.orden = 0;
            validar007(this.t, fila, null);
            tabla(this.t).push(fila);
            if(this.t === "equipos_radioenlace") sincronizarActivoDeEquipo(fila);
            return fila;
          });
          if(this.t === "equipos_radioenlace") recalcularNombres();
          escrituras.push({ tabla: this.t, op: "insert", filas: copia(resultado) });
        } else if(this.op === "update"){
          resultado = ESCRITURA_SOLO_ADMIN.includes(this.t) && !esAdmin() ? [] : this.filas(); // RLS: 0 filas, sin error
          for(const r of resultado){
            const nueva = { ...r, ...copia(this.datos) };
            if(this.t === "equipos_radioenlace" && "servidor_id" in this.datos) validarJerarquia(nueva);
            if(this.t === "enlaces_respaldo") validarRespaldo(nueva, r.id);
            if(this.t === "planos_mapa") validarPlano(nueva);
            if(this.t === "piscinas") validarPiscina(nueva, r.id);
            validar007(this.t, nueva, this.t === "tipos_equipo_red" ? r.valor : r.id);
            validar008(this.t, nueva);
            if(this.t === "atajos_simulacion") this.datos = { ...this.datos, equipos: nueva.equipos };
          }
          resultado.forEach(r=>{
            const servidorAntes = r.servidor_id;
            Object.assign(r, copia(this.datos));
            if(this.t === "planos_mapa" || this.t === "piscinas") r.actualizado_en = new Date().toISOString();
            if(this.t === "equipos_radioenlace"){
              sincronizarActivoDeEquipo(r);
              if(!vacio(r.servidor_id) && r.servidor_id !== servidorAntes) DB.enlaces_respaldo = tabla("enlaces_respaldo").filter(x=>!(x.equipo_id === r.id && x.servidor_alternativo_id === r.servidor_id));
            }
          });
          if(["equipos_radioenlace", "ubicaciones", "tipos_equipo_red"].includes(this.t)) recalcularNombres();
          escrituras.push({ tabla: this.t, op: "update", filas: copia(resultado), parche: copia(this.datos) });
        } else if(this.op === "delete"){
          resultado = ESCRITURA_SOLO_ADMIN.includes(this.t) && !esAdmin() ? [] : this.filas();
          if(this.t === "equipos_radioenlace"){
            const ids = resultado.map(r=>r.id);
            if(tabla("equipos_radioenlace").some(e=>!ids.includes(e.id) && ids.includes(e.servidor_id))) throw { code:"23503", message:'update or delete on table "equipos_radioenlace" violates foreign key constraint "equipos_radioenlace_servidor_fk" on table "equipos_radioenlace"' };
            DB.enlaces_respaldo = tabla("enlaces_respaldo").filter(x=>!ids.includes(x.equipo_id) && !ids.includes(x.servidor_alternativo_id));
            // 007: se los saca de los atajos (y se borra el atajo que queda vacío).
            if(hay007) DB.atajos_simulacion = tabla("atajos_simulacion").map(a=>({ ...a, equipos: a.equipos.filter(id=>!ids.includes(id)) })).filter(a=>a.equipos.length);
          }
          if(this.t === "redes"){
            const ids = resultado.map(r=>r.id);
            for(const e of tabla("equipos_radioenlace")) if(ids.includes(e.red_id)) e.red_id = null;
          }
          DB[this.t] = tabla(this.t).filter(r=>!resultado.includes(r));
          if(this.t === "equipos_radioenlace") recalcularNombres();
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
