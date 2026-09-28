-- =====================================================================
-- 008 — Medio de cada enlace (cable, fibra, inalámbrico) y nombres guardados
--       siempre al día
-- =====================================================================
--
-- Qué agrega
--   equipos_radioenlace.medio  Medio del enlace de un equipo con su servidor
--                      (servidor_id): 'cable', 'fibra' o 'inalambrico'.
--                      NULL = automático, como hasta ahora: cable si el
--                      servidor está en la misma ubicación, inalámbrico si
--                      está en otra. Sirve para un cable o una fibra entre
--                      dos ubicaciones (p. ej. una cámara en otro poste,
--                      cableada al switch de la torre): el mapa lo dibuja
--                      con su propio estilo y el nombre dice «conectada a
--                      Switch en Torre K». Los respaldos siguen deduciendo
--                      el medio por la ubicación.
--   recalcular_nombres_equipos()  Arma en SQL el mismo nombre automático que
--                      la app (assets/js/inventario-tecnologico/nucleo/
--                      mapa-nombres.js) y lo guarda en
--                      equipos_radioenlace.nombre. Corre sola, con triggers,
--                      cuando cambia algo de lo que depende un nombre:
--                        * de un equipo: tipo, referencia, servidor,
--                          ubicación, medio, o el nombre (el de un equipo sin
--                          tipo lo citan sus clientes); también al crear o
--                          borrar uno (la numeración «(2)» se corre);
--                        * el nombre de una ubicación;
--                        * la etiqueta, el género o el valor de un tipo.
--                      Así el detalle del activo («instalado como equipo…») y
--                      la auditoría muestran siempre el nombre actual.
--
-- Reglas del nombre (las mismas de la app):
--   «{tipo}{ (referencia)} en {ubicación}»
--   + « enlazado/a a {servidor}»    si el medio es inalámbrico
--   + « conectado/a a {servidor}»   si es cable o fibra
--   + « en {ubicación del servidor}» si el servidor está en otra ubicación
--   {servidor} = «{tipo}{ (referencia)}» del servidor, o su nombre guardado
--   si no tiene tipo. El género del tipo concuerda (enlazada, conectada).
--   Los equipos sin tipo conservan el nombre escrito a mano.
--   En una ubicación, si dos nombres coinciden (sin distinguir mayúsculas ni
--   espacios repetidos), el de id más alto se numera: «… (2)», «… (3)». Los
--   nombres de los equipos sin tipo cuentan como ocupados.
--
-- La app publicada antes de la 008 sigue funcionando: no conoce «medio»
-- (queda en NULL = automático) y el nombre que manda al guardar es el mismo
-- que calcula la base.
--
-- Cómo correrla: pegar TODO el archivo en el SQL Editor de Supabase y
-- ejecutar. Va en una sola transacción: si algo falla, no queda nada a medias.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.tipos_equipo_red') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 007 (public.tipos_equipo_red no existe).';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'equipos_radioenlace' AND column_name = 'medio') THEN
    RAISE EXCEPTION 'La migración 008 ya fue aplicada (equipos_radioenlace.medio existe).';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Medio del enlace con el servidor
-- ---------------------------------------------------------------------

ALTER TABLE public.equipos_radioenlace
  ADD COLUMN medio text CONSTRAINT equipos_radioenlace_medio_valido CHECK (medio IS NULL OR medio IN ('cable', 'fibra', 'inalambrico'));
COMMENT ON COLUMN public.equipos_radioenlace.medio IS 'Medio del enlace con su servidor (servidor_id): cable, fibra o inalambrico. NULL = automático: cable en la misma ubicación, inalámbrico en otra.';

-- ---------------------------------------------------------------------
-- 2. Nombre automático en SQL (igual que mapa-nombres.js)
-- ---------------------------------------------------------------------

-- Clave para comparar nombres: NFC, sin espacios en los bordes, espacios
-- repetidos como uno y en minúsculas (como clave() en la app).
CREATE FUNCTION public.f_nombre_clave(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT lower(regexp_replace(regexp_replace(normalize(coalesce(p, ''), NFC), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '[[:space:]]+', ' ', 'g'))
$$;

-- « (Norte)» o nada.
CREATE FUNCTION public.f_nombre_referencia(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN x <> '' THEN ' (' || x || ')' ELSE '' END
    FROM (SELECT regexp_replace(coalesce(p, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') AS x) r
$$;

-- Nombre armado de un equipo, sin numerar. NULL si no tiene tipo.
CREATE FUNCTION public.f_nombre_base_equipo(p_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT t.etiqueta || public.f_nombre_referencia(e.referencia) || ' en ' || coalesce(u.nombre, '?')
         || CASE WHEN s.id IS NULL THEN '' ELSE
              ' ' || CASE WHEN coalesce(e.medio, CASE WHEN s.ubicacion_id = e.ubicacion_id THEN 'cable' ELSE 'inalambrico' END) = 'inalambrico'
                          THEN 'enlazad' ELSE 'conectad' END
                  || CASE WHEN t.genero = 'f' THEN 'a' ELSE 'o' END
                  || ' a ' || coalesce(ts.etiqueta || public.f_nombre_referencia(s.referencia), s.nombre)
                  || CASE WHEN s.ubicacion_id = e.ubicacion_id THEN '' ELSE ' en ' || coalesce(us.nombre, '?') END
            END
    FROM public.equipos_radioenlace e
    JOIN public.tipos_equipo_red t ON t.valor = e.tipo_equipo
    LEFT JOIN public.ubicaciones u ON u.id = e.ubicacion_id
    LEFT JOIN public.equipos_radioenlace s ON s.id = e.servidor_id
    LEFT JOIN public.tipos_equipo_red ts ON ts.valor = s.tipo_equipo
    LEFT JOIN public.ubicaciones us ON us.id = s.ubicacion_id
   WHERE e.id = p_id
$$;

-- Recalcula y guarda los nombres de todos los equipos con tipo. Devuelve
-- cuántos cambiaron. Es mantenimiento de la base (SECURITY DEFINER): corre
-- igual para quien haya hecho el cambio que lo disparó.
--
-- Para no chocar con el índice único (ubicación + nombre), los cambios se
-- aplican en un orden en que cada nombre nuevo ya está libre; si dos equipos
-- quieren el nombre del otro (un ciclo), primero se les pone un nombre
-- provisional único a los que faltan y después el definitivo.
CREATE FUNCTION public.recalcular_nombres_equipos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ubic     bigint;
  v_ocupados text[];
  r          record;
  v_n        integer;
  v_cand     text;
  v_ids      bigint[]  := '{}';
  v_ubics    bigint[]  := '{}';
  v_nuevos   text[]    := '{}';
  v_hecho    boolean[] := '{}';
  v_pend     integer;
  v_progreso boolean;
  v_vueltas  integer := 0;
  v_cambios  integer := 0;
  i          integer;
BEGIN
  -- Un recálculo a la vez (dos personas editando a la par).
  PERFORM pg_advisory_xact_lock(hashtext('public.recalcular_nombres_equipos'));

  FOR v_ubic IN SELECT DISTINCT ubicacion_id FROM public.equipos_radioenlace WHERE tipo_equipo IS NOT NULL ORDER BY 1 LOOP
    SELECT coalesce(array_agg(public.f_nombre_clave(nombre)), '{}') INTO v_ocupados
      FROM public.equipos_radioenlace
     WHERE ubicacion_id = v_ubic AND tipo_equipo IS NULL;
    FOR r IN SELECT e.id, e.nombre, public.f_nombre_base_equipo(e.id) AS base
               FROM public.equipos_radioenlace e
              WHERE e.ubicacion_id = v_ubic AND e.tipo_equipo IS NOT NULL
              ORDER BY e.id
    LOOP
      CONTINUE WHEN r.base IS NULL;
      v_n := 1;
      v_cand := r.base;
      WHILE public.f_nombre_clave(v_cand) = ANY (v_ocupados) LOOP
        v_n := v_n + 1;
        v_cand := r.base || ' (' || v_n || ')';
      END LOOP;
      v_ocupados := v_ocupados || public.f_nombre_clave(v_cand);
      IF v_cand IS DISTINCT FROM r.nombre THEN
        v_ids := v_ids || r.id;
        v_ubics := v_ubics || v_ubic;
        v_nuevos := v_nuevos || v_cand;
        v_hecho := v_hecho || false;
      END IF;
    END LOOP;
  END LOOP;

  v_pend := coalesce(array_length(v_ids, 1), 0);
  WHILE v_pend > 0 LOOP
    v_vueltas := v_vueltas + 1;
    IF v_vueltas > 1000 THEN
      RAISE EXCEPTION 'No se pudieron poner al día los nombres de los equipos (quedaron % pendientes).', v_pend;
    END IF;
    v_progreso := false;
    FOR i IN 1 .. array_length(v_ids, 1) LOOP
      CONTINUE WHEN v_hecho[i];
      IF NOT EXISTS (
        SELECT 1 FROM public.equipos_radioenlace x
         WHERE x.ubicacion_id = v_ubics[i] AND x.id <> v_ids[i]
           AND lower(btrim(x.nombre)) = lower(btrim(v_nuevos[i]))
      ) THEN
        UPDATE public.equipos_radioenlace SET nombre = v_nuevos[i] WHERE id = v_ids[i];
        v_hecho[i] := true;
        v_pend := v_pend - 1;
        v_cambios := v_cambios + 1;
        v_progreso := true;
      END IF;
    END LOOP;
    IF NOT v_progreso THEN
      FOR i IN 1 .. array_length(v_ids, 1) LOOP
        CONTINUE WHEN v_hecho[i];
        UPDATE public.equipos_radioenlace SET nombre = nombre || ' ~' || id || '~' WHERE id = v_ids[i];
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_cambios;
END $$;

-- Trigger de sentencia: al terminar un INSERT/UPDATE/DELETE que pueda cambiar
-- nombres, los recalcula. Los UPDATE que hace el propio recálculo (y las
-- cascadas de las FK) quedan en un nivel más adentro y no lo vuelven a disparar.
CREATE FUNCTION public.f_nombres_equipos_al_dia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  PERFORM public.recalcular_nombres_equipos();
  RETURN NULL;
END $$;

CREATE TRIGGER trg_equipos_radioenlace_nombres_al_dia
  AFTER INSERT OR DELETE OR UPDATE OF nombre, tipo_equipo, referencia, servidor_id, ubicacion_id, medio ON public.equipos_radioenlace
  FOR EACH STATEMENT EXECUTE FUNCTION public.f_nombres_equipos_al_dia();
CREATE TRIGGER trg_ubicaciones_nombres_equipos_al_dia
  AFTER UPDATE OF nombre ON public.ubicaciones
  FOR EACH STATEMENT EXECUTE FUNCTION public.f_nombres_equipos_al_dia();
CREATE TRIGGER trg_tipos_equipo_red_nombres_al_dia
  AFTER UPDATE OF valor, etiqueta, genero ON public.tipos_equipo_red
  FOR EACH STATEMENT EXECUTE FUNCTION public.f_nombres_equipos_al_dia();

-- ---------------------------------------------------------------------
-- 3. Permisos. La columna nueva hereda las políticas y el GRANT de la
--    tabla. El recálculo solo lo llaman los triggers (las funciones de
--    trigger no necesitan EXECUTE para quien escribe).
-- ---------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.recalcular_nombres_equipos() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.f_nombres_equipos_al_dia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Poner al día los nombres que ya están guardados
-- ---------------------------------------------------------------------

SELECT public.recalcular_nombres_equipos() AS nombres_actualizados;

COMMIT;
