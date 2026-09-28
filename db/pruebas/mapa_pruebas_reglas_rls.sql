-- =====================================================================
-- Pruebas de las reglas del mapa (migraciones 002 a 004, 006 a 009) contra la base
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
  v_plano  bigint;
  v_esq    jsonb;
  v_ur     bigint;
  e_r1     bigint;
  e_r2     bigint;
  e_r3     bigint;
  v_red1   bigint;
  v_red2   bigint;
  v_atajo  bigint;
  v_atajo2 bigint;
  v_arr    bigint[];
  v_us1    bigint;
  v_us2    bigint;
  s_1      bigint;
  s_2      bigint;
  s_3      bigint;
  s_4      bigint;
  s_5      bigint;
  s_6      bigint;
  s_7      bigint;
  s_8      bigint;
  s_9      bigint;
  v_t1     text;
  v_t2     text;
  v_pis    bigint;
  v_ts     timestamptz;
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
  -- Los dos activos de referencia arrancan sin ubicación y sin equipo de
  -- radio: en la base real ya pueden tener historial (y las pruebas de fechas
  -- chocarían con él). Como todo se revierte al final, no quedan tocados.
  UPDATE public.equipos_radioenlace SET activo_id = NULL WHERE activo_id IN (v_x, v_y);
  DELETE FROM public.historial_ubicacion WHERE activo_id IN (v_x, v_y);

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

  -- ================= P. Migración 006: capa Plano (planos_mapa) =================
  PERFORM set_config('role', 'postgres', true);
  IF to_regclass('public.planos_mapa') IS NULL THEN
    r := r || jsonb_build_object('t', 'P0 migración 006 aplicada (planos_mapa existe)', 'ok', false, 'det', 'falta correr db/migraciones/006_plano_mapa.sql');
  ELSE
    SELECT count(*), max(id) INTO v_n, v_plano FROM public.planos_mapa WHERE activo;
    SELECT esquinas INTO v_esq FROM public.planos_mapa WHERE id = v_plano;
    r := r || jsonb_build_object('t', 'P0 migración 006: hay exactamente un plano activo', 'ok', v_n = 1 AND v_esq IS NOT NULL, 'det', format('activos: %s', v_n));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      UPDATE public.planos_mapa SET esquinas = '{"no": [-2.3112, -79.7381], "ne": [-2.3111, -79.7003], "so": [-2.359, -79.7379]}' WHERE id = v_plano;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      SELECT count(*) INTO v_m FROM public.planos_mapa WHERE id = v_plano AND actualizado_por = v_admin AND (esquinas -> 'no' ->> 0)::float8 = -2.3112;
      r := r || jsonb_build_object('t', 'P1 el administrador guarda un ajuste del plano (y queda quién lo hizo)', 'ok', v_n = 1 AND v_m = 1, 'det', format('filas %s, con autor %s', v_n, v_m));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P1 el administrador guarda un ajuste del plano (y queda quién lo hizo)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.planos_mapa SET esquinas = '{"no": [-2.3, -79.7], "ne": [-2.3, -79.6]}' WHERE id = v_plano;
      r := r || jsonb_build_object('t', 'P2 esquinas incompletas rechazadas', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P2 esquinas incompletas rechazadas', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.planos_mapa SET esquinas = '{"no": [-2.3, -79.7], "ne": [-2.3, -79.6], "so": [-2.3, -79.5]}' WHERE id = v_plano;
      r := r || jsonb_build_object('t', 'P3 esquinas alineadas (plano sin alto) rechazadas', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P3 esquinas alineadas (plano sin alto) rechazadas', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.planos_mapa SET esquinas = '{"no": [-200, -79.7], "ne": [-2.3, -79.6], "so": [-2.4, -79.7]}' WHERE id = v_plano;
      r := r || jsonb_build_object('t', 'P4 latitud fuera de rango rechazada', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P4 latitud fuera de rango rechazada', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.planos_mapa SET esquinas = '{"no": ["-2.3", -79.7], "ne": [-2.3, -79.6], "so": [-2.4, -79.7]}' WHERE id = v_plano;
      r := r || jsonb_build_object('t', 'P5 coordenada que no es número rechazada (sin error de conversión)', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P5 coordenada que no es número rechazada (sin error de conversión)', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.planos_mapa (nombre, imagen, ancho_px, alto_px, esquinas, esquinas_originales) VALUES ('[TX] Otro plano', 'assets/img/mapa/otro.webp', 10, 10, v_esq, v_esq);
      r := r || jsonb_build_object('t', 'P6 un segundo plano activo rechazado', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P6 un segundo plano activo rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.planos_mapa (nombre, imagen, ancho_px, alto_px, esquinas, esquinas_originales, activo) VALUES ('[TX] Externo', 'https://otro.sitio/plano.png', 10, 10, v_esq, v_esq, false);
      r := r || jsonb_build_object('t', 'P7 la imagen tiene que ser un archivo de la app (no una URL externa)', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P7 la imagen tiene que ser un archivo de la app (no una URL externa)', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.planos_mapa (nombre, imagen, ancho_px, alto_px, esquinas, esquinas_originales, activo) VALUES ('[TX] Inactivo', 'assets/img/mapa/viejo.webp', 10, 10, v_esq, v_esq, false);
      r := r || jsonb_build_object('t', 'P7b un plano inactivo adicional sí se puede guardar', 'ok', true, 'det', '');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P7b un plano inactivo adicional sí se puede guardar', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;

    -- v_visit es registrador desde la sección K; su rol no tiene ver_mapa.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n FROM public.planos_mapa;
    UPDATE public.planos_mapa SET esquinas = v_esq WHERE id = v_plano;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    r := r || jsonb_build_object('t', 'P8 sin ver_mapa no se lee el plano ni se ajusta', 'ok', v_n = 0 AND v_m = 0, 'det', format('filas visibles %s, actualizadas %s', v_n, v_m));
    PERFORM set_config('role', 'postgres', true);
    UPDATE public.permisos SET permitido = true WHERE rol = 'registrador' AND accion = 'ver_mapa';
    PERFORM set_config('role', 'authenticated', true);
    SELECT count(*) INTO v_n FROM public.planos_mapa WHERE activo;
    UPDATE public.planos_mapa SET esquinas = v_esq WHERE id = v_plano;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    r := r || jsonb_build_object('t', 'P9 con ver_mapa se lee el plano, pero solo el administrador lo ajusta (0 filas)', 'ok', v_n = 1 AND v_m = 0, 'det', format('visibles %s, actualizadas %s', v_n, v_m));
    BEGIN
      INSERT INTO public.planos_mapa (nombre, imagen, ancho_px, alto_px, esquinas, esquinas_originales, activo) VALUES ('[TX] No admin', 'assets/img/mapa/x.webp', 10, 10, v_esq, v_esq, false);
      r := r || jsonb_build_object('t', 'P10 alguien que no es administrador no puede crear planos (RLS)', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'P10 alguien que no es administrador no puede crear planos (RLS)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO v_n FROM public.planos_mapa;
    r := r || jsonb_build_object('t', 'P11 anon (sin sesión) no ve el plano', 'ok', v_n = 0, 'det', format('filas %s', v_n));

    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO v_n FROM public.auditoria WHERE accion = 'UPDATE_planos_mapa' AND fecha >= now() - interval '1 minute';
    r := r || jsonb_build_object('t', 'P12 el ajuste del plano queda en auditoría', 'ok', v_n >= 1, 'det', format('filas de auditoría: %s', v_n));
    SELECT string_agg(rol || ':' || priv, ', ') INTO v_txt
      FROM (VALUES ('anon'), ('authenticated')) AS roles(rol)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privs(priv)
     WHERE NOT has_table_privilege(rol, 'public.planos_mapa', priv);
    r := r || jsonb_build_object('t', 'P13 planos_mapa tiene GRANT SELECT/INSERT/UPDATE/DELETE para anon y authenticated', 'ok', v_txt IS NULL, 'det', coalesce('faltan: ' || v_txt, 'completo'));
  END IF;

  -- ================= R. Migración 007: tipos de equipo, redes y atajos =================
  PERFORM set_config('role', 'postgres', true);
  IF to_regclass('public.tipos_equipo_red') IS NULL THEN
    r := r || jsonb_build_object('t', 'R0 migración 007 aplicada (tipos_equipo_red existe)', 'ok', false, 'det', 'falta correr db/migraciones/007_red_tipos_atajos.sql');
  ELSE
    SELECT count(*), count(*) FILTER (WHERE genero = 'f') INTO v_n, v_m FROM public.tipos_equipo_red WHERE valor IN ('router','switch','ptp','ap','estacion','camara','nvr','otro');
    r := r || jsonb_build_object('t', 'R0 migración 007: los 8 tipos de equipo de la semilla (Estación y Cámara en femenino)', 'ok', v_n = 8 AND v_m = 2, 'det', format('tipos %s, femeninos %s', v_n, v_m));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.redes (nombre, color, orden) VALUES ('[TX] Red Administrativa', '#004DAB', 10) RETURNING id INTO v_red1;
      INSERT INTO public.redes (nombre, color, orden) VALUES ('[TX] Red Cámaras', '#EC741D', 20) RETURNING id INTO v_red2;
      r := r || jsonb_build_object('t', 'R1 el administrador crea redes', 'ok', v_red1 IS NOT NULL AND v_red2 IS NOT NULL, 'det', format('ids %s,%s', v_red1, v_red2));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R1 el administrador crea redes', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.redes (nombre) VALUES ('  [tx] red administrativa ');
      r := r || jsonb_build_object('t', 'R2 red con nombre repetido (mayúsculas/espacios) rechazada', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R2 red con nombre repetido (mayúsculas/espacios) rechazada', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.redes (nombre, color) VALUES ('[TX] Color malo', 'rojo');
      r := r || jsonb_build_object('t', 'R3 color que no es #RRGGBB rechazado', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R3 color que no es #RRGGBB rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Torre R', 'torre', -2.2, -79.9) RETURNING id INTO v_ur;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id) VALUES (v_ur, '[TX] Router en Torre R', 'router', v_red1) RETURNING id INTO e_r1;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id, servidor_id) VALUES (v_ur, '[TX] Switch en Torre R conectado a Router', 'switch', v_red2, e_r1) RETURNING id INTO e_r2;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id, servidor_id, referencia) VALUES (v_ur, '[TX] Cámara (Norte) en Torre R conectada a Switch', 'camara', v_red2, e_r2, 'Norte') RETURNING id INTO e_r3;
      SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id IN (e_r1, e_r2, e_r3) AND tipo_equipo IS NOT NULL AND red_id IS NOT NULL;
      r := r || jsonb_build_object('t', 'R4 equipos con tipo, red y referencia (router ← switch ← cámara por cable)', 'ok', v_n = 3, 'det', format('filas %s', v_n));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R4 equipos con tipo, red y referencia (router ← switch ← cámara por cable)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET tipo_equipo = 'tostadora' WHERE id = e_r1;
      r := r || jsonb_build_object('t', 'R5 tipo de equipo inexistente rechazado (FK)', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R5 tipo de equipo inexistente rechazado (FK)', 'ok', SQLSTATE = '23503', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET referencia = '   ' WHERE id = e_r1;
      r := r || jsonb_build_object('t', 'R6 referencia vacía rechazada (se guarda NULL, no espacios)', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R6 referencia vacía rechazada (se guarda NULL, no espacios)', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.atajos_simulacion (nombre, equipos) VALUES ('[TX] Red Cámaras', ARRAY[e_r3, e_r2, e_r3]) RETURNING id, equipos INTO v_atajo, v_arr;
      r := r || jsonb_build_object('t', 'R7 atajo con dos equipos (sin repetidos, ordenados)', 'ok', v_arr = ARRAY[e_r2, e_r3], 'det', format('equipos %s', v_arr));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R7 atajo con dos equipos (sin repetidos, ordenados)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.atajos_simulacion (nombre, equipos) VALUES ('[TX] Fantasma', ARRAY[e_r1, -1]);
      r := r || jsonb_build_object('t', 'R8 atajo con un equipo que no existe rechazado', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R8 atajo con un equipo que no existe rechazado', 'ok', SQLSTATE = '23503', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.atajos_simulacion (nombre, equipos) VALUES ('[TX] Vacío', '{}'::bigint[]);
      r := r || jsonb_build_object('t', 'R9 atajo sin equipos rechazado', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R9 atajo sin equipos rechazado', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.atajos_simulacion (nombre, equipos) VALUES ('[tx] red cámaras', ARRAY[e_r1]);
      r := r || jsonb_build_object('t', 'R10 atajo con nombre repetido rechazado', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R10 atajo con nombre repetido rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.atajos_simulacion (nombre, equipos) VALUES ('[TX] Solo la cámara', ARRAY[e_r3]) RETURNING id INTO v_atajo2;
      DELETE FROM public.equipos_radioenlace WHERE id = e_r3;
      SELECT equipos INTO v_arr FROM public.atajos_simulacion WHERE id = v_atajo;
      SELECT count(*) INTO v_n FROM public.atajos_simulacion WHERE id = v_atajo2;
      r := r || jsonb_build_object('t', 'R11 borrar un equipo lo saca de los atajos (y borra el atajo que queda vacío)', 'ok', v_arr = ARRAY[e_r2] AND v_n = 0, 'det', format('equipos del atajo %s, atajo vacío quedó: %s', v_arr, v_n));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R11 borrar un equipo lo saca de los atajos (y borra el atajo que queda vacío)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      DELETE FROM public.redes WHERE id = v_red2;
      SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id = e_r2 AND red_id IS NULL;
      r := r || jsonb_build_object('t', 'R12 borrar una red deja a sus equipos sin red (no se borran)', 'ok', v_n = 1, 'det', format('filas %s', v_n));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R12 borrar una red deja a sus equipos sin red (no se borran)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.tipos_equipo_red SET valor = 'router_core' WHERE valor = 'router';
      SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE id = e_r1 AND tipo_equipo = 'router_core';
      r := r || jsonb_build_object('t', 'R13 cambiar la clave de un tipo arrastra a sus equipos (ON UPDATE CASCADE)', 'ok', v_n = 1, 'det', format('filas %s', v_n));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R13 cambiar la clave de un tipo arrastra a sus equipos (ON UPDATE CASCADE)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;

    -- v_visit es registrador (con ver_mapa desde la sección P, pero no administrador).
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n FROM public.tipos_equipo_red;
    SELECT count(*) INTO v_m FROM public.atajos_simulacion WHERE id = v_atajo;
    UPDATE public.redes SET nombre = '[TX] Cambiada' WHERE id = v_red1;
    GET DIAGNOSTICS v_resp = ROW_COUNT;
    r := r || jsonb_build_object('t', 'R14 con ver_mapa se leen tipos y atajos, pero solo el administrador edita (0 filas)', 'ok', v_n >= 8 AND v_m = 1 AND v_resp = 0, 'det', format('tipos %s, atajo %s, redes actualizadas %s', v_n, v_m, v_resp));
    BEGIN
      INSERT INTO public.atajos_simulacion (nombre, equipos) VALUES ('[TX] No admin', ARRAY[e_r1]);
      r := r || jsonb_build_object('t', 'R15 alguien que no es administrador no puede crear atajos (RLS)', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'R15 alguien que no es administrador no puede crear atajos (RLS)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
    SELECT (SELECT count(*) FROM public.tipos_equipo_red) + (SELECT count(*) FROM public.redes) + (SELECT count(*) FROM public.atajos_simulacion) INTO v_n;
    r := r || jsonb_build_object('t', 'R16 anon (sin sesión) no ve tipos, redes ni atajos', 'ok', v_n = 0, 'det', format('filas %s', v_n));

    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) FILTER (WHERE accion = 'INSERT_redes'), count(*) FILTER (WHERE accion IN ('INSERT_atajos_simulacion', 'UPDATE_atajos_simulacion', 'DELETE_atajos_simulacion'))
      INTO v_n, v_m FROM public.auditoria WHERE fecha >= now() - interval '1 minute';
    r := r || jsonb_build_object('t', 'R17 redes y atajos quedan en auditoría', 'ok', v_n >= 2 AND v_m >= 3, 'det', format('redes %s, atajos %s', v_n, v_m));
    SELECT string_agg(tabla || '/' || rol || ':' || priv, ', ') INTO v_txt
      FROM (VALUES ('public.tipos_equipo_red'), ('public.redes'), ('public.atajos_simulacion')) AS tablas(tabla)
      CROSS JOIN (VALUES ('anon'), ('authenticated')) AS roles(rol)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privs(priv)
     WHERE NOT has_table_privilege(rol, tabla, priv);
    r := r || jsonb_build_object('t', 'R18 tipos_equipo_red, redes y atajos_simulacion tienen GRANT completo para anon y authenticated', 'ok', v_txt IS NULL, 'det', coalesce('faltan: ' || v_txt, 'completo'));
  END IF;

  -- ================= S. Migración 008: medio del enlace y nombres guardados al día =================
  PERFORM set_config('role', 'postgres', true);
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'equipos_radioenlace' AND column_name = 'medio') THEN
    r := r || jsonb_build_object('t', 'S0 migración 008 aplicada (equipos_radioenlace.medio existe)', 'ok', false, 'det', 'falta correr db/migraciones/008_medio_y_nombres.sql');
  ELSE
    SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname IN ('trg_equipos_radioenlace_nombres_al_dia', 'trg_ubicaciones_nombres_equipos_al_dia', 'trg_tipos_equipo_red_nombres_al_dia') AND NOT tgisinternal;
    r := r || jsonb_build_object('t', 'S0 migración 008: columna medio y los 3 triggers de nombres', 'ok', v_n = 3, 'det', format('triggers %s', v_n));
    r := r || jsonb_build_object('t', 'S1 el recálculo de nombres solo lo llaman los triggers (sin EXECUTE para anon ni authenticated)',
      'ok', NOT has_function_privilege('anon', 'public.recalcular_nombres_equipos()', 'EXECUTE') AND NOT has_function_privilege('authenticated', 'public.recalcular_nombres_equipos()', 'EXECUTE'), 'det', '');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Torre S', 'torre', -2.21, -79.91) RETURNING id INTO v_us1;
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Poste S', 'torre', -2.2105, -79.9105) RETURNING id INTO v_us2;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo) VALUES (v_us1, '[TX] s1', 'ptp') RETURNING id INTO s_1;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id) VALUES (v_us1, '[TX] s2', 'switch', s_1) RETURNING id INTO s_2;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id, medio) VALUES (v_us2, '[TX] s3', 'camara', s_2, 'cable') RETURNING id INTO s_3;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id, referencia) VALUES (v_us2, '[TX] s4', 'camara', s_2, 'Norte') RETURNING id INTO s_4;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id, medio) VALUES (v_us1, '[TX] s5', 'ap', s_2, 'inalambrico') RETURNING id INTO s_5;
      SELECT string_agg(nombre, ' | ' ORDER BY id) INTO v_txt FROM public.equipos_radioenlace WHERE id IN (s_1, s_2, s_3, s_4, s_5);
      r := r || jsonb_build_object('t', 'S2 la base arma el nombre automático (cable a otra ubicación, radio automático, radio en la misma)',
        'ok', v_txt = 'Punto a Punto en [TX] Torre S | Switch en [TX] Torre S conectado a Punto a Punto | Cámara en [TX] Poste S conectada a Switch en [TX] Torre S | Cámara (Norte) en [TX] Poste S enlazada a Switch en [TX] Torre S | AP en [TX] Torre S enlazado a Switch', 'det', v_txt);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S2 la base arma el nombre automático (cable a otra ubicación, radio automático, radio en la misma)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET medio = 'satelital' WHERE id = s_3;
      r := r || jsonb_build_object('t', 'S3 un medio que no es cable, fibra ni inalámbrico se rechaza', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S3 un medio que no es cable, fibra ni inalámbrico se rechaza', 'ok', SQLSTATE = '23514' AND SQLERRM LIKE '%medio_valido%', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.ubicaciones SET nombre = '[TX] Torre S2' WHERE id = v_us1;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = s_2;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = s_3;
      r := r || jsonb_build_object('t', 'S4 renombrar una ubicación pone al día los nombres (los de ahí y los de sus clientes en otra)',
        'ok', v_t1 = 'Switch en [TX] Torre S2 conectado a Punto a Punto' AND v_t2 = 'Cámara en [TX] Poste S conectada a Switch en [TX] Torre S2', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S4 renombrar una ubicación pone al día los nombres (los de ahí y los de sus clientes en otra)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.tipos_equipo_red SET etiqueta = 'Cámara IP', genero = 'm' WHERE valor = 'camara';
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = s_3;
      UPDATE public.tipos_equipo_red SET etiqueta = 'Cámara', genero = 'f' WHERE valor = 'camara';
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = s_3;
      r := r || jsonb_build_object('t', 'S5 cambiar la etiqueta o el género de un tipo pone al día los nombres',
        'ok', v_t1 = 'Cámara IP en [TX] Poste S conectado a Switch en [TX] Torre S2' AND v_t2 = 'Cámara en [TX] Poste S conectada a Switch en [TX] Torre S2', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S5 cambiar la etiqueta o el género de un tipo pone al día los nombres', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id, medio) VALUES (v_us2, '[TX] s6', 'camara', s_2, 'cable') RETURNING id INTO s_6;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = s_6;
      DELETE FROM public.equipos_radioenlace WHERE id = s_3;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = s_6;
      r := r || jsonb_build_object('t', 'S6 dos iguales en la misma ubicación: el de id más alto va con (2); al borrar el primero, se corre la numeración',
        'ok', v_t1 = 'Cámara en [TX] Poste S conectada a Switch en [TX] Torre S2 (2)' AND v_t2 = 'Cámara en [TX] Poste S conectada a Switch en [TX] Torre S2', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S6 dos iguales en la misma ubicación: el de id más alto va con (2); al borrar el primero, se corre la numeración', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre) VALUES (v_us2, 'Estación en [TX] Poste S') RETURNING id INTO s_7;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo) VALUES (v_us2, '[TX] s8', 'estacion') RETURNING id INTO s_8;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = s_7;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = s_8;
      r := r || jsonb_build_object('t', 'S7 el nombre a mano de un equipo sin tipo se respeta y cuenta como ocupado',
        'ok', v_t1 = 'Estación en [TX] Poste S' AND v_t2 = 'Estación en [TX] Poste S (2)', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S7 el nombre a mano de un equipo sin tipo se respeta y cuenta como ocupado', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id) VALUES (v_us1, '[TX] s9', 'estacion', s_7) RETURNING id INTO s_9;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = s_9;
      UPDATE public.equipos_radioenlace SET nombre = '[TX] Radio viejo' WHERE id = s_7;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = s_9;
      r := r || jsonb_build_object('t', 'S8 un servidor sin tipo se nombra por su nombre guardado; si se lo renombra, su cliente lo sigue',
        'ok', v_t1 = 'Estación en [TX] Torre S2 enlazada a Estación en [TX] Poste S en [TX] Poste S' AND v_t2 = 'Estación en [TX] Torre S2 enlazada a [TX] Radio viejo en [TX] Poste S', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S8 un servidor sin tipo se nombra por su nombre guardado; si se lo renombra, su cliente lo sigue', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    -- Ciclo: dos equipos con los nombres cruzados (sin el trigger un momento) → el recálculo los devuelve.
    PERFORM set_config('role', 'postgres', true);
    BEGIN
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = s_4;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = s_6;
      ALTER TABLE public.equipos_radioenlace DISABLE TRIGGER trg_equipos_radioenlace_nombres_al_dia;
      UPDATE public.equipos_radioenlace SET nombre = '[TX] temporal' WHERE id = s_4;
      UPDATE public.equipos_radioenlace SET nombre = v_t1 WHERE id = s_6;
      UPDATE public.equipos_radioenlace SET nombre = v_t2 WHERE id = s_4;
      ALTER TABLE public.equipos_radioenlace ENABLE TRIGGER trg_equipos_radioenlace_nombres_al_dia;
      v_n := public.recalcular_nombres_equipos();
      SELECT count(*) INTO v_m FROM public.equipos_radioenlace WHERE (id = s_4 AND nombre = v_t1) OR (id = s_6 AND nombre = v_t2);
      r := r || jsonb_build_object('t', 'S9 nombres cruzados entre dos equipos (un ciclo): el recálculo los devuelve sin chocar con el índice único', 'ok', v_n = 2 AND v_m = 2, 'det', format('cambió %s, en su lugar %s', v_n, v_m));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S9 nombres cruzados entre dos equipos (un ciclo): el recálculo los devuelve sin chocar con el índice único', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE tipo_equipo IS NOT NULL AND nombre <> (SELECT x FROM (SELECT public.f_nombre_base_equipo(id) AS x) b) AND nombre NOT LIKE '% (_)';
    r := r || jsonb_build_object('t', 'S10 todos los equipos con tipo tienen guardado su nombre automático', 'ok', v_n = 0, 'det', format('distintos %s', v_n));
  END IF;

  -- ================= T. Migración 009: piscinas =================
  PERFORM set_config('role', 'postgres', true);
  IF to_regclass('public.piscinas') IS NULL THEN
    r := r || jsonb_build_object('t', 'T0 migración 009 aplicada (piscinas existe)', 'ok', false, 'det', 'falta correr db/migraciones/009_piscinas.sql');
  ELSE
    SELECT count(*), count(*) FILTER (WHERE revisar), count(DISTINCT lower(btrim(nombre))) INTO v_n, v_m, v_resp FROM public.piscinas;
    r := r || jsonb_build_object('t', 'T0 migración 009: tabla con las piscinas del plano (nombres únicos)', 'ok', v_n > 0 AND v_resp = v_n, 'det', format('piscinas %s, por revisar %s', v_n, v_m));
    SELECT count(*) INTO v_n FROM public.piscinas p
     WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p.puntos) q WHERE (q ->> 0)::float8 NOT BETWEEN -2.40 AND -2.28 OR (q ->> 1)::float8 NOT BETWEEN -79.76 AND -79.68)
       AND p.fuente <> 'manual';
    SELECT count(*) INTO v_m FROM public.piscinas WHERE fuente <> 'manual';
    r := r || jsonb_build_object('t', 'T1 las piscinas del plano caen todas en la camaronera (Taura)', 'ok', v_n = v_m, 'det', format('%s de %s', v_n, v_m));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.piscinas (nombre, sector, hectareas, puntos) VALUES ('[TX] P1', 'TX', 2.5, '[[-2.33,-79.72],[-2.33,-79.719],[-2.331,-79.719],[-2.331,-79.72]]') RETURNING id, actualizado_en INTO v_pis, v_ts;
      r := r || jsonb_build_object('t', 'T2 el administrador crea una piscina (fuente «manual» por defecto)', 'ok', v_pis IS NOT NULL AND (SELECT fuente FROM public.piscinas WHERE id = v_pis) = 'manual', 'det', format('id %s', v_pis));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'T2 el administrador crea una piscina (fuente «manual» por defecto)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.piscinas (nombre, puntos) VALUES ('  [tx] p1 ', '[[-2.33,-79.72],[-2.33,-79.719],[-2.331,-79.719]]');
      r := r || jsonb_build_object('t', 'T3 nombre repetido (mayúsculas/espacios) rechazado', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'T3 nombre repetido (mayúsculas/espacios) rechazado', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    v_n := 0;
    BEGIN
      INSERT INTO public.piscinas (nombre, puntos) VALUES ('[TX] Dos puntos', '[[-2.33,-79.72],[-2.33,-79.719]]');
    EXCEPTION WHEN others THEN IF SQLSTATE = '23514' AND SQLERRM LIKE '%piscinas_geom_valida%' THEN v_n := v_n + 1; END IF;
    END;
    BEGIN
      INSERT INTO public.piscinas (nombre, puntos) VALUES ('[TX] Fuera', '[[-2.33,-79.72],[-2.33,-79.719],[95,-79.7]]');
    EXCEPTION WHEN others THEN IF SQLSTATE = '23514' AND SQLERRM LIKE '%piscinas_geom_valida%' THEN v_n := v_n + 1; END IF;
    END;
    BEGIN
      INSERT INTO public.piscinas (nombre, puntos) VALUES ('[TX] Texto', '{"a": 1}');
    EXCEPTION WHEN others THEN IF SQLSTATE = '23514' AND SQLERRM LIKE '%piscinas_geom_valida%' THEN v_n := v_n + 1; END IF;
    END;
    BEGIN
      INSERT INTO public.piscinas (nombre, puntos) VALUES ('[TX] No numérico', '[[-2.33,-79.72],[-2.33,"x"],[-2.331,-79.719]]');
    EXCEPTION WHEN others THEN IF SQLSTATE = '23514' AND SQLERRM LIKE '%piscinas_geom_valida%' THEN v_n := v_n + 1; END IF;
    END;
    r := r || jsonb_build_object('t', 'T4 formas inválidas rechazadas (menos de 3 puntos, fuera de rango, no es lista, no numérico)', 'ok', v_n = 4, 'det', format('rechazadas %s de 4', v_n));
    BEGIN
      UPDATE public.piscinas SET hectareas = 0 WHERE id = v_pis;
      r := r || jsonb_build_object('t', 'T5 hectáreas en cero rechazadas', 'ok', false, 'det', 'se actualizó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'T5 hectáreas en cero rechazadas', 'ok', SQLSTATE = '23514', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.piscinas SET puntos = '[[-2.33,-79.72],[-2.33,-79.718],[-2.331,-79.718],[-2.331,-79.72]]', revisar = true WHERE id = v_pis;
      SELECT count(*) INTO v_n FROM public.piscinas WHERE id = v_pis AND actualizado_por = v_admin AND jsonb_array_length(puntos) = 4 AND revisar;
      r := r || jsonb_build_object('t', 'T6 editar la forma guarda quién la tocó', 'ok', v_n = 1, 'det', format('filas %s', v_n));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'T6 editar la forma guarda quién la tocó', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    -- v_visit es registrador con ver_mapa (sección P): lee, pero no escribe.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO v_n FROM public.piscinas;
    UPDATE public.piscinas SET nombre = '[TX] Cambiada' WHERE id = v_pis;
    GET DIAGNOSTICS v_resp = ROW_COUNT;
    DELETE FROM public.piscinas WHERE id = v_pis;
    GET DIAGNOSTICS v_m = ROW_COUNT;
    r := r || jsonb_build_object('t', 'T7 con ver_mapa se leen las piscinas, pero solo el administrador edita o borra (0 filas)', 'ok', v_n > 0 AND v_resp = 0 AND v_m = 0, 'det', format('leídas %s, editadas %s, borradas %s', v_n, v_resp, v_m));
    BEGIN
      INSERT INTO public.piscinas (nombre, puntos) VALUES ('[TX] No admin', '[[-2.33,-79.72],[-2.33,-79.719],[-2.331,-79.719]]');
      r := r || jsonb_build_object('t', 'T8 alguien que no es administrador no puede crear piscinas (RLS)', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'T8 alguien que no es administrador no puede crear piscinas (RLS)', 'ok', SQLSTATE = '42501', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO v_n FROM public.piscinas;
    r := r || jsonb_build_object('t', 'T9 anon (sin sesión) no ve piscinas', 'ok', v_n = 0, 'det', format('filas %s', v_n));
    PERFORM set_config('role', 'postgres', true);
    SELECT string_agg(rol || ':' || priv, ', ') INTO v_txt
      FROM (VALUES ('anon'), ('authenticated')) AS roles(rol)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privs(priv)
     WHERE NOT has_table_privilege(rol, 'public.piscinas', priv);
    r := r || jsonb_build_object('t', 'T10 piscinas tiene GRANT completo para anon y authenticated', 'ok', v_txt IS NULL, 'det', coalesce('faltan: ' || v_txt, 'completo'));
    SELECT count(*) INTO v_n FROM public.auditoria WHERE accion IN ('INSERT_piscinas', 'UPDATE_piscinas') AND fecha >= now() - interval '1 minute';
    r := r || jsonb_build_object('t', 'T11 los cambios de piscinas quedan en auditoría', 'ok', v_n >= 2, 'det', format('filas %s', v_n));
  END IF;

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
