-- =====================================================================
-- Limpieza de los datos de prueba del mapa: todo lo que lleve el prefijo
-- [PRUEBA] (lo de mapa_datos_prueba.sql y lo que se haya creado así desde
-- la interfaz durante la prueba), más los tipos de ubicación cuyo valor
-- empiece por "prueba" y, con la 007, los atajos, redes y tipos de equipo
-- que empiecen por [PRUEBA] y, con la 009, las piscinas [PRUEBA]. Sirve antes y
-- después de las migraciones 005, 007 y 009.
--
-- * Los respaldos se van con sus equipos (ON DELETE CASCADE), también los
--   que un equipo real tuviera apuntando a uno de prueba.
-- * Los equipos se borran en una sola sentencia, así un servidor y sus
--   clientes de prueba se van juntos. Si un equipo REAL quedó como cliente de
--   uno de prueba, se detiene sin borrar nada y dice cuál es.
-- * Si un tramo de prueba había cerrado un tramo REAL de un activo (porque el
--   activo ya tenía ubicación real cuando se lo movió a una de prueba), ese
--   tramo real se reabre: el activo vuelve a donde estaba.
-- =====================================================================
DO $$
DECLARE
  v_ubic bigint[];
  v_eq   bigint[];
  v_real text;
  v_n    integer;
BEGIN
  SELECT coalesce(array_agg(id), '{}') INTO v_ubic FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%';
  SELECT coalesce(array_agg(id), '{}') INTO v_eq FROM public.equipos_radioenlace WHERE ubicacion_id = ANY(v_ubic) OR nombre LIKE '[PRUEBA]%';

  SELECT string_agg(format('«%s» (id %s)', e.nombre, e.id), ', ') INTO v_real
    FROM public.equipos_radioenlace e
   WHERE NOT (e.id = ANY(v_eq)) AND e.servidor_id = ANY(v_eq);
  IF v_real IS NOT NULL THEN
    RAISE EXCEPTION 'No se borró nada: estos equipos reales tienen como servidor a un equipo de prueba: %. Cámbiales el servidor y vuelve a correr la limpieza.', v_real;
  END IF;

  -- Tramos vigentes de prueba: de qué activo y desde cuándo (para reabrir el tramo real que cerraron).
  CREATE TEMP TABLE _tramos_prueba ON COMMIT DROP AS
    SELECT activo_id, desde FROM public.historial_ubicacion WHERE ubicacion_id = ANY(v_ubic) AND hasta IS NULL;

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

  -- 007 (si ya se corrió): atajos, redes y tipos de equipo de prueba. Los
  -- atajos que apuntaban a equipos de prueba ya se limpiaron solos (trigger).
  IF to_regclass('public.atajos_simulacion') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.atajos_simulacion WHERE nombre LIKE ''[PRUEBA]%''';
    EXECUTE 'DELETE FROM public.redes WHERE nombre LIKE ''[PRUEBA]%''';
    EXECUTE 'DELETE FROM public.tipos_equipo_red t WHERE t.etiqueta LIKE ''[PRUEBA]%'' AND NOT EXISTS (SELECT 1 FROM public.equipos_radioenlace e WHERE e.tipo_equipo = t.valor)';
  END IF;
  -- 009 (si ya se corrió): piscinas de prueba.
  IF to_regclass('public.piscinas') IS NOT NULL THEN
    EXECUTE 'DELETE FROM public.piscinas WHERE nombre LIKE ''[PRUEBA]%''';
  END IF;
END $$;

-- Verificación: todo lo de prueba en cero. Si las tablas quedaron vacías (no
-- hay datos reales todavía) y quieres que los ids reales empiecen en 1:
--   TRUNCATE public.enlaces_respaldo, public.equipos_radioenlace, public.historial_ubicacion, public.ubicaciones RESTART IDENTITY;
SELECT json_build_object(
  'ubicaciones_prueba', (SELECT count(*) FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%'),
  'equipos_prueba', (SELECT count(*) FROM public.equipos_radioenlace WHERE nombre LIKE '[PRUEBA]%'),
  'respaldos_prueba', (SELECT count(*) FROM public.enlaces_respaldo WHERE notas LIKE '[PRUEBA]%'),
  'tipos_prueba', (SELECT count(*) FROM public.tipos_ubicacion WHERE valor LIKE 'prueba%'),
  'total_ubicaciones', (SELECT count(*) FROM public.ubicaciones),
  'total_equipos', (SELECT count(*) FROM public.equipos_radioenlace),
  'total_respaldos', (SELECT count(*) FROM public.enlaces_respaldo),
  'total_historial_ubicacion', (SELECT count(*) FROM public.historial_ubicacion)
) AS despues_de_limpiar;
