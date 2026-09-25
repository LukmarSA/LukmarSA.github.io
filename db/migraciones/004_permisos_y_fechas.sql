-- =====================================================================
-- 004 — Permisos y fechas: la red solo con «Ver mapa», el registrador puede
--       cambiar de custodio y "hoy" en hora de Ecuador
-- =====================================================================
--
-- 1. La jerarquía de la red solo la ve quien ve el mapa
--    Con la 003, equipos_radioenlace guarda quién es servidor de quién
--    (servidor_id) y la banda/frecuencia de cada radio: es la topología que
--    en la 002 vivía en "enlaces", legible solo con puede('ver_mapa'). Pero la
--    tabla de equipos se leía también con 'ver_listado', así que un visitante
--    podía pedir la red completa por la API. Desde aquí la tabla se lee solo
--    con 'ver_mapa'.
--    El detalle de un activo (que ve quien tiene 'ver_listado') solo necesita
--    saber si ese activo es un radio y dónde está: lo pide a
--    equipo_radio_de_activo(), que devuelve id, nombre y ubicación de ESE
--    equipo, sin servidor ni datos de radio.
--    Mientras no se despliegue la app nueva, la publicada consulta la tabla
--    directamente: quien no tenga 'ver_mapa' no verá en el detalle la nota
--    «instalado como equipo de radioenlace» (no da error).
--
-- 2. El registrador puede cambiar y liberar custodios
--    La política upd_historial de historial_custodia no tenía WITH CHECK, y
--    sin él PostgreSQL vuelve a evaluar el USING sobre la fila ya modificada:
--    cerrar el tramo vigente (hasta pasa de NULL a una fecha) exigía
--    'editar_historial', así que f_cambiar_custodio y f_liberar_custodio
--    fallaban con "new row violates row-level security policy" para quien
--    solo tiene 'cambiar_custodio' (el rol registrador). El WITH CHECK nuevo
--    deja cerrar el tramo con 'cambiar_custodio' y mantiene que un tramo ya
--    cerrado solo lo edita quien tiene 'editar_historial' (el USING no cambia).
--
-- 3. "Hoy" en hora de Ecuador
--    f_cambiar_custodio y f_liberar_custodio usaban current_date cuando no
--    llegaba fecha: la base corre en UTC y después de las 19:00 en Guayaquil
--    eso ya es mañana. Ahora usan (now() AT TIME ZONE 'America/Guayaquil')::date,
--    como la 002. Se reemplazan con la MISMA firma y el mismo cuerpo (solo
--    cambia esa expresión); CREATE OR REPLACE conserva dueño y permisos. Si
--    alguna fue modificada después de escribir esta migración, se detiene sin
--    tocar nada, para no pisar ese cambio.
--    (En el navegador, hoyISO() también pasa a usar la hora de Ecuador.)
--
-- Se corre ANTES de desplegar la app nueva (su detalle de activos usa
-- equipo_radio_de_activo). Después de desplegar: 005_quitar_tabla_enlaces.sql.
--
-- Cómo correrla: pegar TODO el archivo en el SQL Editor de Supabase y
-- ejecutar. Va en una sola transacción: si algo falla, no queda nada a medias.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.enlaces_respaldo') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 003 (public.enlaces_respaldo no existe).';
  END IF;
  IF to_regprocedure('public.equipo_radio_de_activo(integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'La migración 004 ya fue aplicada (public.equipo_radio_de_activo existe).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'historial_custodia'
                   AND policyname = 'upd_historial' AND cmd = 'UPDATE' AND with_check IS NULL) THEN
    RAISE EXCEPTION 'La política upd_historial de historial_custodia no está como se esperaba (no existe o ya tiene WITH CHECK).';
  END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.f_cambiar_custodio(integer,text,text,text,date,text,text,text,text)')) IS DISTINCT FROM '94a885331d61c452f98dec610e15315e'
  OR (SELECT md5(prosrc) FROM pg_proc WHERE oid = to_regprocedure('public.f_liberar_custodio(integer,date,text,text)')) IS DISTINCT FROM '39c7445b860f20eac090a60a2b3c19da' THEN
    RAISE EXCEPTION 'f_cambiar_custodio o f_liberar_custodio no son las versiones esperadas (¿se modificaron?): no se reemplazan.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Topología: equipos_radioenlace solo con 'ver_mapa'
-- ---------------------------------------------------------------------

ALTER POLICY sel_equipos_radioenlace ON public.equipos_radioenlace
  USING (public.puede('ver_mapa'));

-- Para el detalle de un activo. SECURITY DEFINER: lee la tabla sin su RLS,
-- pero solo devuelve algo a quien ve el listado o el mapa, y solo del activo
-- pedido.
CREATE FUNCTION public.equipo_radio_de_activo(p_activo_id integer)
RETURNS TABLE (id bigint, nombre text, ubicacion_id bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT e.id, e.nombre, e.ubicacion_id
    FROM public.equipos_radioenlace e
   WHERE e.activo_id = p_activo_id
     AND (public.puede('ver_listado') OR public.puede('ver_mapa'));
$$;
COMMENT ON FUNCTION public.equipo_radio_de_activo(integer) IS 'Detalle de un activo: el equipo de radioenlace que es ese activo (id, nombre, ubicación), sin la jerarquía. Vacío sin ver_listado ni ver_mapa.';
REVOKE ALL ON FUNCTION public.equipo_radio_de_activo(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.equipo_radio_de_activo(integer) TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. historial_custodia: WITH CHECK explícito en upd_historial
-- ---------------------------------------------------------------------

ALTER POLICY upd_historial ON public.historial_custodia
  WITH CHECK (public.puede('cambiar_custodio') OR (hasta IS NOT NULL AND public.puede('editar_historial')));

-- ---------------------------------------------------------------------
-- 3. Fecha por defecto en hora de Ecuador (único cambio: current_date)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.f_cambiar_custodio(p_activo_id integer, p_tipo_custodio text, p_nombre text, p_cargo text, p_fecha date, p_tipo_devolucion text, p_observacion_entrega text, p_tipo_entrega text DEFAULT NULL::text, p_observacion_devolucion text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$ declare v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/Guayaquil')::date); v_min_orden int; begin update public.historial_custodia set hasta = v_fecha, tipo_devolucion = coalesce(p_tipo_devolucion, tipo_devolucion), observacion_devolucion = coalesce(p_observacion_devolucion, observacion_devolucion) where activo_id = p_activo_id and hasta is null; select coalesce(min(orden), 1) - 1 into v_min_orden from public.historial_custodia where activo_id = p_activo_id; insert into public.historial_custodia (activo_id, orden, tipo_custodio, nombre, cargo, desde, hasta, observacion_entrega, tipo_entrega) values (p_activo_id, v_min_orden, p_tipo_custodio, p_nombre, p_cargo, v_fecha, null, p_observacion_entrega, p_tipo_entrega); end; $function$;

CREATE OR REPLACE FUNCTION public.f_liberar_custodio(p_activo_id integer, p_fecha date, p_tipo_devolucion text, p_observacion text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$ declare v_fecha date := coalesce(p_fecha, (now() AT TIME ZONE 'America/Guayaquil')::date); begin update public.historial_custodia set hasta = v_fecha, tipo_devolucion = p_tipo_devolucion, observacion_devolucion = p_observacion where activo_id = p_activo_id and hasta is null; end; $function$;

COMMIT;
