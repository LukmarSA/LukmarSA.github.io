-- =====================================================================
-- Pruebas de la migración 002 contra la base REAL, sin dejar rastro.
-- =====================================================================
-- Todo corre dentro de un único bloque DO que termina con RAISE EXCEPTION:
-- el error revierte la transacción completa (datos de prueba, bajas,
-- restauraciones, filas de auditoría) y su mensaje ES el reporte: una lista
-- JSON de {t: prueba, ok: true/false, det: detalle}.
--
-- Lo único que no revierte un ROLLBACK son las secuencias (nextval). Antes
-- de correr esto, anota los valores de activos_id_seq / bajas_id_seq /
-- auditoria_id_seq / historial_custodia_id_seq y después corre
-- 002_pruebas_restaurar_secuencias.sql, o el próximo activo real saltaría
-- de número de tag.
--
-- Usa dos activos reales solo como referencia (el de id más bajo y el de id
-- más alto); como todo se revierte, no quedan modificados.
-- Simula usuarios con request.jwt.claims + role, igual que PostgREST.
-- =====================================================================
DO $$
DECLARE
  r        jsonb := '[]'::jsonb;
  v_hoy    date := (now() AT TIME ZONE 'America/Guayaquil')::date;
  v_admin  uuid;
  v_visit  uuid;
  v_x      integer;
  v_y      integer;
  v_x2     integer;
  v_y2     integer;
  v_a      bigint;
  v_b      bigint;
  v_c      bigint;
  e_a1     bigint;
  e_a2     bigint;
  e_b1     bigint;
  e_c1     bigint;
  v_baja   bigint;
  v_n      integer;
  v_m      integer;
  v_txt    text;
  v_json   jsonb;
  v_aud    bigint;
  v_hc     integer;
BEGIN
  SELECT id INTO v_admin FROM public.perfiles WHERE rol = 'administrador' ORDER BY id LIMIT 1;
  SELECT id INTO v_visit FROM public.perfiles WHERE rol = 'visitante'     ORDER BY id LIMIT 1;
  SELECT min(id), max(id) INTO v_x, v_y FROM public.activos;
  SELECT count(*) INTO v_aud FROM public.auditoria;

  -- ================= A. Administrador (rol authenticated + JWT de un admin) =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  r := r || jsonb_build_object('t', 'A0 sesión simulada', 'ok', current_user = 'authenticated' AND public.es_admin(), 'det', current_user || ' es_admin=' || public.es_admin());

  -- A1: IDENTITY sin GRANT sobre la secuencia
  BEGIN
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Torre A', 'torre', -2.1735, -79.9587) RETURNING id INTO v_a;
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Torre B', 'torre', -2.1839, -79.8756) RETURNING id INTO v_b;
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Oficina C', 'oficina', -2.1894, -79.8891) RETURNING id INTO v_c;
    r := r || jsonb_build_object('t', 'A1 admin crea 3 ubicaciones (IDENTITY sin GRANT de secuencia)', 'ok', true, 'det', format('ids %s,%s,%s', v_a, v_b, v_c));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A1 admin crea 3 ubicaciones (IDENTITY sin GRANT de secuencia)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('  [tx] torre a ', 'torre', 0, 0);
    r := r || jsonb_build_object('t', 'A2 nombre duplicado (mayúsculas/espacios) rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A2 nombre duplicado (mayúsculas/espacios) rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Fuera de rango', 'torre', 95, 0);
    r := r || jsonb_build_object('t', 'A3 latitud fuera de rango rechazada', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A3 latitud fuera de rango rechazada', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Tipo raro', 'no_existe', 0, 0);
    r := r || jsonb_build_object('t', 'A4 tipo inexistente rechazado (FK)', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A4 tipo inexistente rechazado (FK)', 'ok', SQLSTATE = '23503', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_a, '[TX] PTP A-B', 'Cambium PTP 550') RETURNING id INTO e_a1;
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_a, '[TX] AP A', 'Cambium ePMP 3000') RETURNING id INTO e_a2;
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_b, '[TX] PTP B-A', 'Cambium PTP 550') RETURNING id INTO e_b1;
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_c, '[TX] SM C', 'Cambium Force 300') RETURNING id INTO e_c1;
    r := r || jsonb_build_object('t', 'A5 admin crea 4 equipos', 'ok', true, 'det', format('ids %s,%s,%s,%s', e_a1, e_a2, e_b1, e_c1));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A5 admin crea 4 equipos', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre) VALUES (v_a, '[tx] ptp a-b');
    r := r || jsonb_build_object('t', 'A6 equipo con nombre repetido en la misma ubicación rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A6 equipo con nombre repetido en la misma ubicación rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id, banda, frecuencia_mhz) VALUES (e_a1, e_b1, '5 GHz', 5745);
    r := r || jsonb_build_object('t', 'A7 enlace A↔B creado', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A7 enlace A↔B creado', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id) VALUES (e_b1, e_a1);
    r := r || jsonb_build_object('t', 'A8 enlace B↔A (el mismo par al revés) rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A8 enlace B↔A (el mismo par al revés) rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id) VALUES (e_a1, e_a2);
    r := r || jsonb_build_object('t', 'A9 enlace entre equipos de la misma ubicación rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A9 enlace entre equipos de la misma ubicación rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id) VALUES (e_a1, e_a1);
    r := r || jsonb_build_object('t', 'A10 enlace de un equipo consigo mismo rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A10 enlace de un equipo consigo mismo rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id, banda) VALUES (e_a2, e_c1, '5 GHz');
    r := r || jsonb_build_object('t', 'A11 segundo enlace desde A (PtMP) creado', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A11 segundo enlace desde A (PtMP) creado', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Vincular un activo al equipo lo ubica solo
  BEGIN
    UPDATE public.equipos_radioenlace SET activo_id = v_x WHERE id = e_c1;
    SELECT count(*) INTO v_n FROM public.historial_ubicacion WHERE activo_id = v_x AND hasta IS NULL AND ubicacion_id = v_c AND notas LIKE 'Automático:%';
    r := r || jsonb_build_object('t', 'A12 vincular activo a equipo lo ubica en esa ubicación (trigger)', 'ok', v_n = 1, 'det', format('tramos vigentes en C con nota automática: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A12 vincular activo a equipo lo ubica en esa ubicación (trigger)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET activo_id = v_x WHERE id = e_a2;
    r := r || jsonb_build_object('t', 'A13 el mismo activo en un segundo equipo rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A13 el mismo activo en un segundo equipo rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_x, v_b, v_hoy);
    r := r || jsonb_build_object('t', 'A14 mover "por fuera" un activo que es radio rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A14 mover "por fuera" un activo que es radio rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.historial_ubicacion SET hasta = v_hoy WHERE activo_id = v_x AND hasta IS NULL;
    r := r || jsonb_build_object('t', 'A15 sacar de su ubicación un activo que es radio rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A15 sacar de su ubicación un activo que es radio rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET ubicacion_id = v_b WHERE id = e_c1;
    SELECT count(*) INTO v_n FROM public.historial_ubicacion WHERE activo_id = v_x AND hasta IS NULL AND ubicacion_id = v_b;
    SELECT count(*) INTO v_m FROM public.historial_ubicacion WHERE activo_id = v_x AND ubicacion_id = v_c AND hasta = v_hoy;
    r := r || jsonb_build_object('t', 'A16 mover el equipo mueve su activo (C cerrado, B vigente)', 'ok', v_n = 1 AND v_m = 1, 'det', format('vigente en B: %s, C cerrado hoy: %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A16 mover el equipo mueve su activo (C cerrado, B vigente)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET ubicacion_id = v_a WHERE id = e_b1;
    r := r || jsonb_build_object('t', 'A17 mover un equipo junto al otro extremo de su enlace rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A17 mover un equipo junto al otro extremo de su enlace rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Historial de un activo común
  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y, v_c, v_hoy - 10);
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y, v_a, v_hoy - 5);
    SELECT count(*) INTO v_n FROM public.historial_ubicacion WHERE activo_id = v_y AND ubicacion_id = v_c AND hasta = v_hoy - 5;
    SELECT count(*) INTO v_m FROM public.historial_ubicacion WHERE activo_id = v_y AND ubicacion_id = v_a AND hasta IS NULL;
    r := r || jsonb_build_object('t', 'A18 mover = un INSERT; el trigger cierra el tramo anterior con la fecha nueva', 'ok', v_n = 1 AND v_m = 1, 'det', format('C cerrado el día del movimiento: %s, A vigente: %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A18 mover = un INSERT; el trigger cierra el tramo anterior con la fecha nueva', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y, v_a, v_hoy);
    r := r || jsonb_build_object('t', 'A19 mover a la misma ubicación rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A19 mover a la misma ubicación rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y, v_c, v_hoy - 20);
    r := r || jsonb_build_object('t', 'A20 movimiento con fecha anterior al tramo vigente rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A20 movimiento con fecha anterior al tramo vigente rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.historial_ubicacion SET hasta = v_hoy WHERE activo_id = v_y AND hasta IS NULL;
    SELECT count(*) INTO v_n FROM public.historial_ubicacion WHERE activo_id = v_y AND hasta IS NULL;
    r := r || jsonb_build_object('t', 'A21 quitar ubicación (cerrar tramo) deja al activo sin vigente', 'ok', v_n = 0, 'det', format('vigentes: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A21 quitar ubicación (cerrar tramo) deja al activo sin vigente', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    DELETE FROM public.ubicaciones WHERE id = v_c;
    r := r || jsonb_build_object('t', 'A22 borrar ubicación con historial rechazado (se archiva)', 'ok', false, 'det', 'se borró');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A22 borrar ubicación con historial rechazado (se archiva)', 'ok', SQLSTATE = '23503', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    DELETE FROM public.ubicaciones WHERE id = v_b;
    r := r || jsonb_build_object('t', 'A23 borrar ubicación con equipos rechazado', 'ok', false, 'det', 'se borró');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A23 borrar ubicación con equipos rechazado', 'ok', SQLSTATE = '23503', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Baja y restauración conservan el historial de ubicación
  BEGIN
    PERFORM public.f_dar_baja(v_y, '[TX] prueba 002');
    SELECT id, jsonb_array_length(activo->'historial_ubicacion') INTO v_baja, v_n FROM public.bajas WHERE (activo->>'id')::int = v_y ORDER BY id DESC LIMIT 1;
    SELECT count(*) INTO v_m FROM public.historial_ubicacion WHERE activo_id = v_y;
    r := r || jsonb_build_object('t', 'A24 f_dar_baja guarda el historial de ubicación en el snapshot', 'ok', v_n = 2 AND v_m = 0, 'det', format('tramos en snapshot: %s, filas que quedaron: %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A24 f_dar_baja guarda el historial de ubicación en el snapshot', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    v_y2 := public.f_restaurar_baja(v_baja);
    SELECT count(*) INTO v_n FROM public.historial_ubicacion WHERE activo_id = v_y2;
    SELECT count(*) INTO v_m FROM public.historial_ubicacion WHERE activo_id = v_y2 AND ((ubicacion_id = v_c AND desde = v_hoy - 10 AND hasta = v_hoy - 5) OR (ubicacion_id = v_a AND desde = v_hoy - 5 AND hasta = v_hoy));
    r := r || jsonb_build_object('t', 'A25 f_restaurar_baja reinserta los tramos con el id nuevo', 'ok', v_n = 2 AND v_m = 2, 'det', format('id nuevo %s, tramos %s, idénticos %s', v_y2, v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A25 f_restaurar_baja reinserta los tramos con el id nuevo', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    PERFORM public.f_dar_baja(v_x, '[TX] prueba 002 (radio)');
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id = e_c1 AND activo_id IS NULL;
    SELECT id INTO v_baja FROM public.bajas WHERE (activo->>'id')::int = v_x ORDER BY id DESC LIMIT 1;
    v_x2 := public.f_restaurar_baja(v_baja);
    SELECT count(*) INTO v_m FROM public.historial_ubicacion WHERE activo_id = v_x2 AND hasta IS NULL AND ubicacion_id = v_b;
    r := r || jsonb_build_object('t', 'A26 baja de un activo-radio: el equipo queda sin vincular y al restaurar vuelve a su ubicación', 'ok', v_n = 1 AND v_m = 1, 'det', format('equipo desvinculado: %s, restaurado vigente en B: %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A26 baja de un activo-radio: el equipo queda sin vincular y al restaurar vuelve a su ubicación', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ================= B. Visitante (ver_listado y ver_detalle; sin ver_mapa ni asignar_ubicacion) =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('t', 'B0 sesión simulada', 'ok', NOT coalesce(public.es_admin(), false) AND public.puede('ver_listado') AND NOT public.puede('ver_mapa'), 'det', 'visitante');

  SELECT count(*) INTO v_n FROM public.ubicaciones WHERE nombre LIKE '[TX]%';
  SELECT count(*) INTO v_m FROM public.enlaces;
  r := r || jsonb_build_object('t', 'B1 visitante lee ubicaciones (ver_listado) pero no enlaces (sin ver_mapa)', 'ok', v_n = 3 AND v_m = 0, 'det', format('ubicaciones %s, enlaces %s', v_n, v_m));

  BEGIN
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Del visitante', 'otro', 0, 0);
    r := r || jsonb_build_object('t', 'B2 visitante no puede crear ubicaciones (RLS)', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B2 visitante no puede crear ubicaciones (RLS)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y2, v_c, v_hoy);
    r := r || jsonb_build_object('t', 'B3 visitante sin asignar_ubicacion no puede mover activos (RLS)', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B3 visitante sin asignar_ubicacion no puede mover activos (RLS)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Se le da asignar_ubicacion (como postgres, solo dentro de esta transacción)
  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.permisos (rol, accion, permitido) VALUES ('visitante', 'asignar_ubicacion', true)
    ON CONFLICT (rol, accion) DO UPDATE SET permitido = true;
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y2, v_c, v_hoy);
    r := r || jsonb_build_object('t', 'B4 con asignar_ubicacion el visitante mueve un activo', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B4 con asignar_ubicacion el visitante mueve un activo', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.historial_ubicacion SET hasta = v_hoy WHERE activo_id = v_y2 AND hasta IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('t', 'B5 ... y quita la ubicación (cerrar tramo pasa el WITH CHECK explícito)', 'ok', v_n = 1, 'det', format('filas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B5 ... y quita la ubicación (cerrar tramo pasa el WITH CHECK explícito)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y2, v_a, v_hoy);
    UPDATE public.historial_ubicacion SET ubicacion_id = v_b WHERE activo_id = v_y2 AND hasta IS NULL;
    r := r || jsonb_build_object('t', 'B6 visitante no puede corregir la ubicación de un tramo (solo admin)', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B6 visitante no puede corregir la ubicación de un tramo (solo admin)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    DELETE FROM public.historial_ubicacion WHERE activo_id = v_y2 AND hasta IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('t', 'B7 visitante no puede borrar tramos (0 filas)', 'ok', v_n = 0, 'det', format('filas borradas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B7 visitante no puede borrar tramos (0 filas)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  PERFORM set_config('role', 'postgres', true);
  INSERT INTO public.permisos (rol, accion, permitido) VALUES ('visitante', 'ver_mapa', true)
    ON CONFLICT (rol, accion) DO UPDATE SET permitido = true;
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_m FROM public.enlaces;
  r := r || jsonb_build_object('t', 'B8 con ver_mapa el visitante ya ve los enlaces', 'ok', v_m = 2, 'det', format('enlaces %s', v_m));

  -- ================= C. anon (la clave publicable, sin sesión) =================
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  SELECT count(*) INTO v_n FROM public.tipos_ubicacion;
  SELECT count(*) INTO v_m FROM public.ubicaciones;
  r := r || jsonb_build_object('t', 'C1 anon: lee el catálogo de tipos (como tipos_activo) pero ninguna ubicación', 'ok', v_n = 4 AND v_m = 0, 'det', format('tipos %s, ubicaciones %s', v_n, v_m));
  SELECT count(*) INTO v_n FROM public.enlaces;
  SELECT count(*) INTO v_m FROM public.historial_ubicacion;
  r := r || jsonb_build_object('t', 'C2 anon: no ve enlaces ni historial', 'ok', v_n = 0 AND v_m = 0, 'det', format('enlaces %s, historial %s', v_n, v_m));
  BEGIN
    INSERT INTO public.tipos_ubicacion (valor, etiqueta) VALUES ('tx_anon', 'TX anon');
    r := r || jsonb_build_object('t', 'C3 anon no puede escribir', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'C3 anon no puede escribir', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ================= D. Auditoría =================
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_n FROM public.auditoria WHERE accion IN ('INSERT_ubicaciones', 'INSERT_equipos_radioenlace', 'INSERT_enlaces', 'INSERT_historial_ubicacion') AND id > 0 AND fecha >= now() - interval '1 minute';
  r := r || jsonb_build_object('t', 'D1 los cambios del mapa quedan en auditoría (registrar_auditoria)', 'ok', v_n >= 10, 'det', format('filas nuevas de auditoría del mapa: %s', v_n));

  -- ================= E. Hallazgo lateral: custodia con rol registrador =================
  -- La política upd_historial de historial_custodia no tiene WITH CHECK; se
  -- prueba si un registrador (cambiar_custodio=true, editar_historial=false)
  -- puede cerrar el tramo vigente al cambiar de custodio.
  UPDATE public.perfiles SET rol = 'registrador' WHERE id = v_visit;
  SELECT activo_id INTO v_hc FROM public.historial_custodia WHERE hasta IS NULL AND activo_id NOT IN (v_x, v_y) ORDER BY activo_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  BEGIN
    PERFORM public.f_cambiar_custodio(v_hc, 'persona', '[TX] Custodio de prueba', 'Prueba', v_hoy, 'simple', NULL, 'simple', NULL);
    r := r || jsonb_build_object('t', 'E1 [lateral] registrador puede cambiar de custodio', 'ok', true, 'det', format('activo %s: sin error', v_hc));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'E1 [lateral] registrador puede cambiar de custodio', 'ok', false, 'det', format('activo %s: ', v_hc) || SQLSTATE || ' ' || SQLERRM);
  END;
  PERFORM set_config('role', 'postgres', true);

  RAISE EXCEPTION 'RESULTADOS_002:%', r::text;
END $$;
