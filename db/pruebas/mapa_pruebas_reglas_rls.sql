-- =====================================================================
-- Pruebas de las reglas del mapa (migraciones 002, 003 y 004) contra la base
-- REAL, sin dejar rastro. Sirven antes y después de correr la 005.
-- =====================================================================
-- Todo corre dentro de un único bloque DO que termina con RAISE EXCEPTION:
-- el error revierte la transacción completa (datos de prueba, bajas,
-- restauraciones, permisos cambiados, filas de auditoría) y su mensaje ES el
-- reporte: una lista JSON de {t: prueba, ok: true/false, det: detalle}.
--
-- Lo único que no revierte un ROLLBACK son las secuencias (nextval). Antes
-- de correr esto, anota sus valores con la consulta del encabezado de
-- mapa_pruebas_restaurar_secuencias.sql y después corre ese archivo, o el
-- próximo activo real saltaría de número de tag.
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
  e_c2     bigint;
  e_d1     bigint;
  e_d2     bigint;
  v_baja   bigint;
  v_n      integer;
  v_m      integer;
  v_resp   integer;
  v_txt    text;
  v_hc     integer;
BEGIN
  IF to_regprocedure('public.equipo_radio_de_activo(integer)') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 004 (public.equipo_radio_de_activo no existe): aplícala antes de correr estas pruebas.';
  END IF;
  SELECT id INTO v_admin FROM public.perfiles WHERE rol = 'administrador' ORDER BY id LIMIT 1;
  SELECT id INTO v_visit FROM public.perfiles WHERE rol = 'visitante'     ORDER BY id LIMIT 1;
  IF v_admin IS NULL OR v_visit IS NULL THEN
    RAISE EXCEPTION 'Hace falta al menos un perfil administrador y uno visitante para correr las pruebas.';
  END IF;
  SELECT min(id), max(id) INTO v_x, v_y FROM public.activos;

  -- Permisos fijos para la prueba (se revierten con todo lo demás): el
  -- visitante ve el listado, pero no el mapa ni puede asignar ubicaciones; el
  -- registrador (sección K) cambia custodios pero no edita el historial.
  INSERT INTO public.permisos (rol, accion, permitido) VALUES
    ('visitante', 'ver_listado', true), ('visitante', 'ver_mapa', false), ('visitante', 'asignar_ubicacion', false),
    ('registrador', 'ver_listado', true), ('registrador', 'ver_mapa', false), ('registrador', 'cambiar_custodio', true), ('registrador', 'editar_historial', false)
  ON CONFLICT (rol, accion) DO UPDATE SET permitido = EXCLUDED.permitido;

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
    r := r || jsonb_build_object('t', 'A5 admin crea 4 equipos (sin servidor: raíces)', 'ok', true, 'det', format('ids %s,%s,%s,%s', e_a1, e_a2, e_b1, e_c1));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A5 admin crea 4 equipos (sin servidor: raíces)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre) VALUES (v_a, '[tx] ptp a-b');
    r := r || jsonb_build_object('t', 'A6 equipo con nombre repetido en la misma ubicación rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A6 equipo con nombre repetido en la misma ubicación rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ================= J. Jerarquía (servidor_id) y respaldos — migración 003 =================
  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_a1, banda = '5 GHz', frecuencia_mhz = 5745 WHERE id = e_b1;
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id = e_b1 AND servidor_id = e_a1 AND frecuencia_mhz = 5745;
    r := r || jsonb_build_object('t', 'J1 servidor en otra ubicación (radioenlace B ← A) con banda y frecuencia', 'ok', v_n = 1, 'det', format('filas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J1 servidor en otra ubicación (radioenlace B ← A) con banda y frecuencia', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_a1 WHERE id = e_a2;
    r := r || jsonb_build_object('t', 'J2 servidor en la misma ubicación (conexión por cable) permitido', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J2 servidor en la misma ubicación (conexión por cable) permitido', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_a2, banda = '5 GHz', frecuencia_mhz = 5180 WHERE id = e_c1;
    r := r || jsonb_build_object('t', 'J3 cliente de un AP (C ← AP A)', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J3 cliente de un AP (C ← AP A)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_a1 WHERE id = e_a1;
    r := r || jsonb_build_object('t', 'J4 un equipo como su propio servidor rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J4 un equipo como su propio servidor rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_b1 WHERE id = e_a1;
    r := r || jsonb_build_object('t', 'J5 ciclo de 2 (A → B cuando B → A) rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J5 ciclo de 2 (A → B cuando B → A) rechazado', 'ok', SQLSTATE = '23514' AND SQLERRM LIKE 'Ciclo%', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_c1 WHERE id = e_a1;
    r := r || jsonb_build_object('t', 'J6 ciclo de 3 (A → C → AP A → A) rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J6 ciclo de 3 (A → C → AP A → A) rechazado', 'ok', SQLSTATE = '23514' AND SQLERRM LIKE 'Ciclo%', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    -- Dos filas en una sola sentencia: la segunda ve el cambio de la primera y detecta el ciclo.
    UPDATE public.equipos_radioenlace
       SET servidor_id = CASE WHEN id = e_b1 THEN e_c1 ELSE e_b1 END
     WHERE id IN (e_b1, e_c1);
    r := r || jsonb_build_object('t', 'J7 ciclo armado en una sola sentencia de dos filas rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J7 ciclo armado en una sola sentencia de dos filas rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET frecuencia_mhz = -5 WHERE id = e_c1;
    r := r || jsonb_build_object('t', 'J8 frecuencia no positiva rechazada', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J8 frecuencia no positiva rechazada', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, servidor_id) VALUES (v_c, '[TX] Cámara C', e_c1) RETURNING id INTO e_c2;
    r := r || jsonb_build_object('t', 'J9 crear un equipo ya con servidor (INSERT pasa por el trigger)', 'ok', e_c2 IS NOT NULL, 'det', format('id %s', e_c2));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J9 crear un equipo ya con servidor (INSERT pasa por el trigger)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    DELETE FROM public.equipos_radioenlace WHERE id = e_a1;
    r := r || jsonb_build_object('t', 'J10 borrar un equipo que es servidor de otros rechazado', 'ok', false, 'det', 'se borró');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J10 borrar un equipo que es servidor de otros rechazado', 'ok', SQLSTATE = '23503', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, servidor_id) VALUES (v_b, '[TX] Servidor temporal', e_b1) RETURNING id INTO e_d1;
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, servidor_id) VALUES (v_c, '[TX] Cliente temporal', e_d1) RETURNING id INTO e_d2;
    DELETE FROM public.equipos_radioenlace WHERE id IN (e_d1, e_d2);
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id IN (e_d1, e_d2);
    r := r || jsonb_build_object('t', 'J11 borrar un servidor junto con su cliente en la misma sentencia (NO ACTION)', 'ok', v_n = 0, 'det', format('quedan: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J11 borrar un servidor junto con su cliente en la misma sentencia (NO ACTION)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad, notas) VALUES (e_c1, e_b1, 1, '[TX] respaldo 1');
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad) VALUES (e_c1, e_a1, 2);
    SELECT count(*) INTO v_n FROM public.enlaces_respaldo WHERE equipo_id = e_c1;
    r := r || jsonb_build_object('t', 'J12 admin registra 2 respaldos con prioridad', 'ok', v_n = 2, 'det', format('respaldos: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J12 admin registra 2 respaldos con prioridad', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad) VALUES (e_c1, e_b1, 3);
    r := r || jsonb_build_object('t', 'J13 el mismo respaldo dos veces rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J13 el mismo respaldo dos veces rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id) VALUES (e_c1, e_c1);
    r := r || jsonb_build_object('t', 'J14 un equipo como su propio respaldo rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J14 un equipo como su propio respaldo rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id) VALUES (e_c1, e_a2);
    r := r || jsonb_build_object('t', 'J15 su servidor actual como respaldo rechazado', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J15 su servidor actual como respaldo rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad) VALUES (e_b1, e_a2, 0);
    r := r || jsonb_build_object('t', 'J16 prioridad 0 rechazada (1 = primera opción)', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J16 prioridad 0 rechazada (1 = primera opción)', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = e_b1 WHERE id = e_c1;
    SELECT count(*), max(servidor_alternativo_id) INTO v_n, v_m FROM public.enlaces_respaldo WHERE equipo_id = e_c1;
    r := r || jsonb_build_object('t', 'J17 promover un respaldo a servidor principal borra su fila de respaldo', 'ok', v_n = 1 AND v_m = e_a1, 'det', format('respaldos que quedan: %s (servidor %s)', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J17 promover un respaldo a servidor principal borra su fila de respaldo', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.enlaces_respaldo SET servidor_alternativo_id = e_b1 WHERE equipo_id = e_c1 AND servidor_alternativo_id = e_a1;
    r := r || jsonb_build_object('t', 'J18 editar un respaldo para que sea el servidor principal rechazado', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J18 editar un respaldo para que sea el servidor principal rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad) VALUES (e_b1, e_c2, 1);
    DELETE FROM public.equipos_radioenlace WHERE id = e_c2;
    SELECT count(*) INTO v_n FROM public.enlaces_respaldo WHERE servidor_alternativo_id = e_c2 OR equipo_id = e_c2;
    r := r || jsonb_build_object('t', 'J19 borrar el servidor alternativo borra sus respaldos (CASCADE)', 'ok', v_n = 0, 'det', format('respaldos que quedan apuntando a él: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J19 borrar el servidor alternativo borra sus respaldos (CASCADE)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.equipos_radioenlace SET ubicacion_id = v_a WHERE id = e_b1;
    UPDATE public.equipos_radioenlace SET ubicacion_id = v_b WHERE id = e_b1;
    r := r || jsonb_build_object('t', 'J20 mover un equipo a la ubicación de su servidor (queda por cable) permitido', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'J20 mover un equipo a la ubicación de su servidor (queda por cable) permitido', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;
  SELECT count(*) INTO v_resp FROM public.enlaces_respaldo e JOIN public.equipos_radioenlace q ON q.id = e.equipo_id WHERE q.nombre LIKE '[TX]%';

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
    PERFORM public.f_dar_baja(v_y, '[TX] prueba mapa');
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
    PERFORM public.f_dar_baja(v_x, '[TX] prueba mapa (radio)');
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id = e_c1 AND activo_id IS NULL AND servidor_id = e_b1;
    SELECT id INTO v_baja FROM public.bajas WHERE (activo->>'id')::int = v_x ORDER BY id DESC LIMIT 1;
    v_x2 := public.f_restaurar_baja(v_baja);
    SELECT count(*) INTO v_m FROM public.historial_ubicacion WHERE activo_id = v_x2 AND hasta IS NULL AND ubicacion_id = v_b;
    r := r || jsonb_build_object('t', 'A26 baja de un activo-radio: el equipo queda sin vincular (y con su servidor) y al restaurar vuelve a su ubicación', 'ok', v_n = 1 AND v_m = 1, 'det', format('equipo desvinculado: %s, restaurado vigente en B: %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'A26 baja de un activo-radio: el equipo queda sin vincular (y con su servidor) y al restaurar vuelve a su ubicación', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- El activo restaurado vuelve a ser el radio del equipo C (que quedó en B): para B1b.
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.equipos_radioenlace SET activo_id = v_x2 WHERE id = e_c1;
  PERFORM set_config('role', 'authenticated', true);

  -- ================= B. Visitante (ver_listado y ver_detalle; sin ver_mapa ni asignar_ubicacion) =================
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
  r := r || jsonb_build_object('t', 'B0 sesión simulada', 'ok', NOT coalesce(public.es_admin(), false) AND public.puede('ver_listado') AND NOT public.puede('ver_mapa'), 'det', 'visitante');

  SELECT count(*) INTO v_n FROM public.ubicaciones WHERE nombre LIKE '[TX]%';
  SELECT count(*) INTO v_m FROM public.equipos_radioenlace WHERE nombre LIKE '[TX]%';
  SELECT count(*) INTO v_resp FROM public.enlaces_respaldo;
  r := r || jsonb_build_object('t', 'B1 visitante lee ubicaciones (ver_listado) pero no los equipos ni los respaldos: la red es solo con ver_mapa (004)', 'ok', v_n = 3 AND v_m = 0 AND v_resp = 0, 'det', format('ubicaciones %s, equipos %s, respaldos %s', v_n, v_m, v_resp));

  BEGIN
    SELECT count(*), max(id) INTO v_n, v_resp FROM public.equipo_radio_de_activo(v_x2);
    SELECT count(*) INTO v_m FROM public.equipo_radio_de_activo(v_y2);
    SELECT nombre INTO v_txt FROM public.equipo_radio_de_activo(v_x2);
    r := r || jsonb_build_object('t', 'B1b el detalle del activo sí sabe (equipo_radio_de_activo) si el activo es un radio y cuál', 'ok', v_n = 1 AND v_resp = e_c1 AND v_txt = '[TX] SM C' AND v_m = 0, 'det', format('radio: %s fila(s), id %s, «%s»; activo común: %s fila(s)', v_n, v_resp, v_txt, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B1b el detalle del activo sí sabe (equipo_radio_de_activo) si el activo es un radio y cuál', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

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

  BEGIN
    UPDATE public.equipos_radioenlace SET servidor_id = NULL WHERE id = e_b1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('t', 'B4 visitante no puede cambiar el servidor de un equipo (0 filas)', 'ok', v_n = 0, 'det', format('filas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B4 visitante no puede cambiar el servidor de un equipo (0 filas)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- Se le da asignar_ubicacion (como postgres, solo dentro de esta transacción)
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.permisos SET permitido = true WHERE rol = 'visitante' AND accion = 'asignar_ubicacion';
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y2, v_c, v_hoy);
    r := r || jsonb_build_object('t', 'B5 con asignar_ubicacion el visitante mueve un activo', 'ok', true, 'det', '');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B5 con asignar_ubicacion el visitante mueve un activo', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.historial_ubicacion SET hasta = v_hoy WHERE activo_id = v_y2 AND hasta IS NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('t', 'B6 ... y quita la ubicación (cerrar tramo pasa el WITH CHECK explícito)', 'ok', v_n = 1, 'det', format('filas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B6 ... y quita la ubicación (cerrar tramo pasa el WITH CHECK explícito)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, desde) VALUES (v_y2, v_a, v_hoy);
    UPDATE public.historial_ubicacion SET ubicacion_id = v_b WHERE activo_id = v_y2 AND hasta IS NULL;
    r := r || jsonb_build_object('t', 'B7 visitante no puede corregir la ubicación de un tramo (solo admin)', 'ok', false, 'det', 'se actualizó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B7 visitante no puede corregir la ubicación de un tramo (solo admin)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    DELETE FROM public.historial_ubicacion WHERE activo_id = v_y2 AND hasta IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('t', 'B8 visitante no puede borrar tramos (0 filas)', 'ok', v_n = 0, 'det', format('filas borradas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B8 visitante no puede borrar tramos (0 filas)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  PERFORM set_config('role', 'postgres', true);
  UPDATE public.permisos SET permitido = true WHERE rol = 'visitante' AND accion = 'ver_mapa';
  SELECT count(*) INTO v_m FROM public.enlaces_respaldo e JOIN public.equipos_radioenlace q ON q.id = e.equipo_id WHERE q.nombre LIKE '[TX]%';
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_n FROM public.enlaces_respaldo e JOIN public.equipos_radioenlace q ON q.id = e.equipo_id WHERE q.nombre LIKE '[TX]%';
  r := r || jsonb_build_object('t', 'B9 con ver_mapa el visitante ya ve los respaldos', 'ok', v_n = v_m AND v_n >= 1, 'det', format('ve %s de %s', v_n, v_m));
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_m FROM public.equipos_radioenlace WHERE nombre LIKE '[TX]%' AND servidor_id IS NOT NULL;
  PERFORM set_config('role', 'authenticated', true);
  SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE nombre LIKE '[TX]%' AND servidor_id IS NOT NULL;
  r := r || jsonb_build_object('t', 'B12 con ver_mapa el visitante ve los equipos y quién es servidor de quién', 'ok', v_n = v_m AND v_n >= 3, 'det', format('ve %s de %s equipos con servidor', v_n, v_m));

  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad) VALUES (e_b1, e_a2, 5);
    r := r || jsonb_build_object('t', 'B10 visitante no puede crear respaldos (solo admin)', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B10 visitante no puede crear respaldos (solo admin)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  BEGIN
    UPDATE public.enlaces_respaldo SET prioridad = 9 WHERE equipo_id = e_c1;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    DELETE FROM public.enlaces_respaldo WHERE equipo_id = e_c1;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    r := r || jsonb_build_object('t', 'B11 visitante no puede editar ni borrar respaldos (0 filas)', 'ok', v_n = 0 AND v_m = 0, 'det', format('editadas %s, borradas %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'B11 visitante no puede editar ni borrar respaldos (0 filas)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ================= C. anon (la clave publicable, sin sesión) =================
  PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  PERFORM set_config('role', 'anon', true);
  SELECT count(*) INTO v_n FROM public.tipos_ubicacion;
  SELECT count(*) INTO v_m FROM public.ubicaciones;
  r := r || jsonb_build_object('t', 'C1 anon: lee el catálogo de tipos (como tipos_activo) pero ninguna ubicación', 'ok', v_n >= 4 AND v_m = 0, 'det', format('tipos %s, ubicaciones %s', v_n, v_m));
  SELECT count(*) INTO v_n FROM public.equipos_radioenlace;
  SELECT count(*) INTO v_m FROM public.enlaces_respaldo;
  SELECT count(*) INTO v_resp FROM public.historial_ubicacion;
  r := r || jsonb_build_object('t', 'C2 anon: no ve equipos (jerarquía), respaldos ni historial', 'ok', v_n = 0 AND v_m = 0 AND v_resp = 0, 'det', format('equipos %s, respaldos %s, historial %s', v_n, v_m, v_resp));
  BEGIN
    INSERT INTO public.tipos_ubicacion (valor, etiqueta) VALUES ('tx_anon', 'TX anon');
    r := r || jsonb_build_object('t', 'C3 anon no puede escribir tipos', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'C3 anon no puede escribir tipos', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id) VALUES (e_b1, e_a2);
    r := r || jsonb_build_object('t', 'C4 anon no puede crear respaldos', 'ok', false, 'det', 'se insertó');
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'C4 anon no puede crear respaldos', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    SELECT count(*) INTO v_n FROM public.equipo_radio_de_activo(v_x2);
    r := r || jsonb_build_object('t', 'C5 anon: equipo_radio_de_activo no le devuelve nada', 'ok', v_n = 0, 'det', format('filas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'C5 anon: equipo_radio_de_activo no le devuelve nada', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;

  -- ================= K. Migración 004: el registrador cambia custodios y "hoy" es la fecha de Ecuador =================
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.perfiles SET rol = 'registrador' WHERE id = v_visit;
  SELECT activo_id INTO v_hc FROM public.historial_custodia
   WHERE hasta IS NULL AND activo_id NOT IN (coalesce(v_x2, 0), coalesce(v_y2, 0)) ORDER BY activo_id LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
  r := r || jsonb_build_object('t', 'K0 sesión simulada (registrador: cambiar_custodio sin editar_historial)', 'ok', NOT coalesce(public.es_admin(), false) AND public.puede('cambiar_custodio') AND NOT public.puede('editar_historial') AND v_hc IS NOT NULL, 'det', format('activo con custodio vigente: %s', v_hc));
  BEGIN
    SELECT id INTO v_resp FROM public.historial_custodia WHERE activo_id = v_hc AND hasta IS NULL;
    PERFORM public.f_cambiar_custodio(v_hc, 'persona', '[TX] Custodio de prueba', 'Prueba', v_hoy, 'simple', NULL, 'simple', NULL);
    SELECT count(*) INTO v_n FROM public.historial_custodia WHERE activo_id = v_hc AND hasta IS NULL AND nombre = '[TX] Custodio de prueba' AND desde = v_hoy;
    SELECT count(*) INTO v_m FROM public.historial_custodia WHERE id = v_resp AND hasta = v_hoy;
    r := r || jsonb_build_object('t', 'K1 el registrador cambia de custodio: cierra el tramo vigente (WITH CHECK de upd_historial)', 'ok', v_n = 1 AND v_m = 1, 'det', format('activo %s: vigente nuevo %s, anterior cerrado hoy %s', v_hc, v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'K1 el registrador cambia de custodio: cierra el tramo vigente (WITH CHECK de upd_historial)', 'ok', false, 'det', format('activo %s: ', v_hc) || SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    PERFORM public.f_liberar_custodio(v_hc, NULL, 'simple', '[TX] sin fecha');
    SELECT count(*) INTO v_n FROM public.historial_custodia WHERE activo_id = v_hc AND hasta IS NULL;
    SELECT count(*) INTO v_m FROM public.historial_custodia WHERE activo_id = v_hc AND nombre = '[TX] Custodio de prueba' AND hasta = (now() AT TIME ZONE 'America/Guayaquil')::date;
    r := r || jsonb_build_object('t', 'K2 el registrador libera el custodio; sin fecha se usa el día de hoy en Ecuador', 'ok', v_n = 0 AND v_m = 1, 'det', format('vigentes %s, cerrado con la fecha de Guayaquil %s', v_n, v_m));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'K2 el registrador libera el custodio; sin fecha se usa el día de hoy en Ecuador', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
  END;
  BEGIN
    UPDATE public.historial_custodia SET observacion_devolucion = '[TX] editado' WHERE activo_id = v_hc AND hasta IS NOT NULL;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    r := r || jsonb_build_object('t', 'K3 sin editar_historial el registrador sigue sin poder editar tramos cerrados (0 filas)', 'ok', v_n = 0, 'det', format('filas: %s', v_n));
  EXCEPTION WHEN others THEN
    r := r || jsonb_build_object('t', 'K3 sin editar_historial el registrador sigue sin poder editar tramos cerrados (0 filas)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
  END;
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_n FROM pg_proc
   WHERE pronamespace = 'public'::regnamespace AND proname IN ('f_cambiar_custodio', 'f_liberar_custodio') AND prosrc ILIKE '%current_date%';
  r := r || jsonb_build_object('t', 'K4 f_cambiar_custodio y f_liberar_custodio ya no usan current_date (UTC)', 'ok', v_n = 0, 'det', format('funciones con current_date: %s', v_n));

  -- ================= G. GRANT explícito (sin él, la API responde "permission denied") =================
  PERFORM set_config('role', 'postgres', true);
  SELECT string_agg(rol || ':' || priv, ', ') INTO v_txt
    FROM (VALUES ('anon'), ('authenticated')) AS roles(rol)
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privs(priv)
   WHERE NOT has_table_privilege(rol, 'public.enlaces_respaldo', priv);
  r := r || jsonb_build_object('t', 'G1 enlaces_respaldo tiene GRANT SELECT/INSERT/UPDATE/DELETE para anon y authenticated', 'ok', v_txt IS NULL, 'det', coalesce('faltan: ' || v_txt, 'completo'));
  r := r || jsonb_build_object('t', 'G2 equipo_radio_de_activo se puede llamar desde la API (EXECUTE para anon y authenticated)',
    'ok', has_function_privilege('anon', 'public.equipo_radio_de_activo(integer)', 'EXECUTE') AND has_function_privilege('authenticated', 'public.equipo_radio_de_activo(integer)', 'EXECUTE'), 'det', '');

  -- ================= D. Auditoría =================
  SELECT count(*) INTO v_n FROM public.auditoria
   WHERE accion IN ('INSERT_ubicaciones', 'INSERT_equipos_radioenlace', 'INSERT_historial_ubicacion', 'INSERT_enlaces_respaldo')
     AND fecha >= now() - interval '1 minute';
  SELECT count(*) INTO v_m FROM public.auditoria
   WHERE accion IN ('DELETE_enlaces_respaldo', 'UPDATE_equipos_radioenlace') AND fecha >= now() - interval '1 minute';
  r := r || jsonb_build_object('t', 'D1 los cambios del mapa (incluidos respaldos y jerarquía) quedan en auditoría', 'ok', v_n >= 12 AND v_m >= 5, 'det', format('inserts auditados: %s, cambios de jerarquía/respaldos auditados: %s', v_n, v_m));

  RAISE EXCEPTION 'RESULTADOS_MAPA:%', r::text;
END $$;
