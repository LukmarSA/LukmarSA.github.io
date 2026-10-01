-- =====================================================================
-- Limpieza de la prueba en vivo de los campos configurables (v10, migración
-- 012): lo que se haya creado desde la interfaz con el prefijo [PRUEBA].
--
--   * activos con [PRUEBA] al principio de la marca, el modelo o el nombre
--     del dispositivo, y sus bajas (las copias con esa marca, modelo o
--     nombre); sus historiales de custodia y de ubicación se van con ellos
--     (ON DELETE CASCADE) y, si alguno era el activo de un equipo de red, el
--     equipo queda sin activo (ON DELETE SET NULL);
--   * tipos de activo cuyo nombre empiece por [PRUEBA];
--   * campos (no los de siempre) cuya etiqueta empiece por [PRUEBA]; antes
--     se quitan de los tipos reales que los hayan marcado;
--   * tipos de ubicación cuya etiqueta empiece por [PRUEBA] y que no use
--     ninguna ubicación.
--
-- Se detiene sin borrar nada si un activo real (o la baja de uno) usa un
-- tipo o un campo de prueba, y dice cuál. Todo va en una sola sentencia: o
-- se limpia todo, o nada. Al final muestra cuánto borró (aviso NOTICE).
-- =====================================================================
DO $$
DECLARE
  v_activos integer[];
  v_campos  text[];
  v_tipos   text[];
  v_real    text;
  v_c       integer;
  v_n       jsonb := '{}';
BEGIN
  IF to_regclass('public.campos_activo') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 012: no hay campos configurables que limpiar.';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_activos FROM public.activos
   WHERE marca LIKE '[PRUEBA]%' OR modelo LIKE '[PRUEBA]%' OR nombre_dispositivo LIKE '[PRUEBA]%';
  SELECT coalesce(array_agg(clave), '{}') INTO v_campos FROM public.campos_activo WHERE NOT fijo AND etiqueta LIKE '[PRUEBA]%';
  SELECT coalesce(array_agg(nombre), '{}') INTO v_tipos FROM public.tipos_activo WHERE nombre LIKE '[PRUEBA]%';

  -- Activos reales (y bajas de activos reales) que usan un tipo o un campo de prueba.
  SELECT string_agg(x, ', ') INTO v_real FROM (
    SELECT format('%s-%s', CASE WHEN a.propiedad = 'eq' THEN 'EQS' ELSE 'LKM' END, CASE WHEN length(a.id::text) < 3 THEN lpad(a.id::text, 3, '0') ELSE a.id::text END) AS x
      FROM public.activos a
     WHERE NOT (a.id = ANY (v_activos))
       AND (a.tipo = ANY (v_tipos) OR a.personalizados ?| v_campos)
    UNION ALL
    SELECT format('la baja %s', b.id)
      FROM public.bajas b
     WHERE NOT (coalesce(b.activo ->> 'marca', '') LIKE '[PRUEBA]%' OR coalesce(b.activo ->> 'modelo', '') LIKE '[PRUEBA]%' OR coalesce(b.activo ->> 'nombre_dispositivo', '') LIKE '[PRUEBA]%')
       AND ((b.activo ->> 'tipo') = ANY (v_tipos) OR coalesce(b.activo -> 'personalizados', '{}'::jsonb) ?| v_campos)
  ) r;
  IF v_real IS NOT NULL THEN
    RAISE EXCEPTION 'No se borró nada: estos activos reales usan un tipo o un campo de prueba: %. Cámbiales el tipo o vacía ese campo y vuelve a correr la limpieza.', v_real;
  END IF;

  DELETE FROM public.bajas b
   WHERE coalesce(b.activo ->> 'marca', '') LIKE '[PRUEBA]%' OR coalesce(b.activo ->> 'modelo', '') LIKE '[PRUEBA]%' OR coalesce(b.activo ->> 'nombre_dispositivo', '') LIKE '[PRUEBA]%';
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('bajas', v_c);

  DELETE FROM public.activos WHERE id = ANY (v_activos);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('activos', v_c);

  -- Los tipos reales que marcaron un campo de prueba lo dejan de usar.
  UPDATE public.tipos_activo t
     SET campos_pertinentes = (SELECT coalesce(jsonb_agg(x.value ORDER BY x.ord), '[]'::jsonb) FROM jsonb_array_elements(t.campos_pertinentes) WITH ORDINALITY x(value, ord) WHERE NOT ((x.value #>> '{}') = ANY (v_campos))),
         campos_obligatorios = (SELECT coalesce(jsonb_agg(x.value ORDER BY x.ord), '[]'::jsonb) FROM jsonb_array_elements(t.campos_obligatorios) WITH ORDINALITY x(value, ord) WHERE NOT ((x.value #>> '{}') = ANY (v_campos)))
   WHERE NOT (t.nombre = ANY (v_tipos)) AND (t.campos_pertinentes ?| v_campos OR t.campos_obligatorios ?| v_campos);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('tipos_reales_sin_campos_de_prueba', v_c);

  DELETE FROM public.tipos_activo WHERE nombre = ANY (v_tipos);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('tipos', v_c);

  DELETE FROM public.campos_activo WHERE clave = ANY (v_campos);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('campos', v_c);

  DELETE FROM public.tipos_ubicacion t
   WHERE t.etiqueta LIKE '[PRUEBA]%' AND NOT EXISTS (SELECT 1 FROM public.ubicaciones u WHERE u.tipo = t.valor);
  GET DIAGNOSTICS v_c = ROW_COUNT; v_n := v_n || jsonb_build_object('tipos_de_ubicacion', v_c);

  RAISE NOTICE 'Limpieza de la prueba de campos: %', v_n;
END $$;
