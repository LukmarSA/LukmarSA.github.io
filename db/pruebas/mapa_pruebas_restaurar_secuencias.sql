-- =====================================================================
-- Secuencias después de mapa_pruebas_reglas_rls.sql
-- =====================================================================
-- Las pruebas se revierten completas, salvo las secuencias: nextval no se
-- deshace con ROLLBACK, así que sin esto el próximo activo real saltaría de
-- número de tag (y lo mismo con bajas, auditoría, etc.).
--
-- Uso:
--   1. ANTES de las pruebas, corre esta consulta. No cambia nada: devuelve
--      una sola celda con el SQL que deja cada secuencia como está ahora.
--      Cópiala.
--   2. Corre mapa_pruebas_reglas_rls.sql.
--   3. Pega y corre el SQL que copiaste en el paso 1.
--
-- El SQL generado nunca baja una secuencia por debajo del id más alto de su
-- tabla (por si alguien guardó datos reales mientras corrían las pruebas).
-- =====================================================================
SELECT string_agg(
         format(
           'SELECT setval(%L, greatest(%s, x.m), CASE WHEN x.m > 0 AND x.m >= %s THEN true ELSE %s END) FROM (SELECT coalesce(max(id), 0) AS m FROM public.%I) x;',
           s.secuencia, q.last_value, q.last_value, CASE WHEN q.is_called THEN 'true' ELSE 'false' END, s.tabla),
         E'\n' ORDER BY s.tabla) AS pegar_despues_de_las_pruebas
  FROM (
    -- Las tablas de la 006/007/009 entran solo si la migración ya se corrió.
    SELECT t AS tabla, CASE WHEN to_regclass('public.' || t) IS NOT NULL THEN pg_get_serial_sequence('public.' || t, 'id') END AS secuencia
      FROM unnest(ARRAY['activos', 'bajas', 'auditoria', 'historial_custodia', 'ubicaciones',
                        'equipos_radioenlace', 'historial_ubicacion', 'enlaces_respaldo',
                        'planos_mapa', 'redes', 'atajos_simulacion', 'piscinas']) AS t
  ) s
  -- pg_sequences.last_value es NULL si la secuencia nunca se usó (el próximo valor es 1).
  CROSS JOIN LATERAL (
    SELECT ps.last_value FROM pg_sequences ps
     WHERE ps.schemaname || '.' || ps.sequencename = s.secuencia
        OR quote_ident(ps.schemaname) || '.' || quote_ident(ps.sequencename) = s.secuencia
  ) q0
  CROSS JOIN LATERAL (
    SELECT coalesce(q0.last_value, 1) AS last_value, q0.last_value IS NOT NULL AS is_called
  ) q
 WHERE s.secuencia IS NOT NULL;
