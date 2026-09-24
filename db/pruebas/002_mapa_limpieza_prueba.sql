-- =====================================================================
-- Limpieza de los datos de prueba del mapa: todo lo que lleve el prefijo
-- [PRUEBA] (lo de 002_mapa_datos_prueba.sql y lo que se haya creado así
-- desde la interfaz durante la prueba), más los tipos de ubicación cuyo
-- valor empiece por "prueba".
--
-- Si un tramo de prueba había cerrado un tramo REAL de un activo (porque el
-- activo ya tenía ubicación real cuando se lo movió a una ubicación de
-- prueba), ese tramo real se reabre: el activo vuelve a donde estaba.
-- =====================================================================
DO $$
DECLARE
  v_ubic bigint[];
  v_eq   bigint[];
  v_n    integer;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_ubic FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%';
  SELECT coalesce(array_agg(id), '{}') INTO v_eq FROM public.equipos_radioenlace WHERE ubicacion_id = ANY(v_ubic) OR nombre LIKE '[PRUEBA]%';

  -- Tramos vigentes de prueba: de qué activo y desde cuándo (para reabrir el tramo real que cerraron).
  CREATE TEMP TABLE _tramos_prueba ON COMMIT DROP AS
    SELECT activo_id, desde FROM public.historial_ubicacion WHERE ubicacion_id = ANY(v_ubic) AND hasta IS NULL;

  DELETE FROM public.enlaces WHERE equipo_origen_id = ANY(v_eq) OR equipo_destino_id = ANY(v_eq);
  DELETE FROM public.equipos_radioenlace WHERE id = ANY(v_eq);
  DELETE FROM public.historial_ubicacion WHERE ubicacion_id = ANY(v_ubic);

  UPDATE public.historial_ubicacion h SET hasta = NULL
    FROM _tramos_prueba p
   WHERE h.activo_id = p.activo_id AND h.hasta = p.desde
     AND h.id = (SELECT max(x.id) FROM public.historial_ubicacion x WHERE x.activo_id = p.activo_id AND x.hasta = p.desde)
     AND NOT EXISTS (SELECT 1 FROM public.historial_ubicacion v WHERE v.activo_id = p.activo_id AND v.hasta IS NULL);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN RAISE NOTICE 'Se reabrieron % tramo(s) reales cerrados por la prueba.', v_n; END IF;

  DELETE FROM public.ubicaciones WHERE id = ANY(v_ubic);
  DELETE FROM public.tipos_ubicacion t WHERE t.valor LIKE 'prueba%'
    AND NOT EXISTS (SELECT 1 FROM public.ubicaciones u WHERE u.tipo = t.valor);
END $$;

-- Verificación: todo en cero. Si las cuatro tablas quedaron vacías (no hay
-- datos reales todavía), se reinician sus contadores de id para que los datos
-- reales empiecen en 1:
--   TRUNCATE public.enlaces, public.equipos_radioenlace, public.historial_ubicacion, public.ubicaciones RESTART IDENTITY;
SELECT json_build_object(
  'ubicaciones_prueba', (SELECT count(*) FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%'),
  'equipos_prueba', (SELECT count(*) FROM public.equipos_radioenlace WHERE nombre LIKE '[PRUEBA]%'),
  'tipos_prueba', (SELECT count(*) FROM public.tipos_ubicacion WHERE valor LIKE 'prueba%'),
  'total_ubicaciones', (SELECT count(*) FROM public.ubicaciones),
  'total_equipos', (SELECT count(*) FROM public.equipos_radioenlace),
  'total_enlaces', (SELECT count(*) FROM public.enlaces),
  'total_historial_ubicacion', (SELECT count(*) FROM public.historial_ubicacion)
) AS despues_de_limpiar;
