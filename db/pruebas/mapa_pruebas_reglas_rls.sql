-- =====================================================================
-- Pruebas de las reglas del mapa y de los activos (migraciones 002 a 004, 006 a 012) contra la base
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
  v_uu     bigint;
  v_ru1    bigint;
  v_ru2    bigint;
  u_1      bigint;
  u_2      bigint;
  u_3      bigint;
  u_4      bigint;
  u_5      bigint;
  v_her    boolean;
  v_uv     bigint;
  v_uv2    bigint;
  v_rva    bigint;
  v_rvb    bigint;
  v_rvc    bigint;
  w_1      bigint;
  w_2      bigint;
  w_3      bigint;
  w_4      bigint;
  w_5      bigint;
  x_1      integer;
  x_2      integer;
  x_3      integer;
  x_baja   bigint;
  x_n      integer;
  x_txt    text;
  x_js     jsonb;
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
      -- La cámara, con otra red que la del switch: con la 011, una red propia
      -- igual a la que se hereda se deja vacía (y aquí se cuentan las propias).
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id, servidor_id, referencia) VALUES (v_ur, '[TX] Cámara (Norte) en Torre R conectada a Switch', 'camara', v_red1, e_r2, 'Norte') RETURNING id INTO e_r3;
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

    -- Los nombres que se esperan aquí (y en U y V) usan las etiquetas de
    -- fábrica de la 007. En la base real se pueden haber cambiado (al 30-sep,
    -- «PtP-E» y «PtP-R»): se ponen las de fábrica solo dentro de esta
    -- transacción, que se revierte entera al final.
    BEGIN
      UPDATE public.tipos_equipo_red t SET etiqueta = f.etiqueta, genero = f.genero
        FROM (VALUES ('router', 'Router', 'm'), ('switch', 'Switch', 'm'), ('ptp', 'Punto a Punto', 'm'), ('ap', 'AP', 'm'),
                     ('estacion', 'Estación', 'f'), ('camara', 'Cámara', 'f'), ('nvr', 'NVR', 'm'), ('otro', 'Equipo', 'm')) AS f(valor, etiqueta, genero)
       WHERE t.valor = f.valor AND (t.etiqueta IS DISTINCT FROM f.etiqueta OR t.genero IS DISTINCT FROM f.genero);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'S1b etiquetas de fábrica de los tipos de equipo (para comparar los nombres)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;

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

  -- ================= U. Migración 010: la red en el nombre automático =================
  PERFORM set_config('role', 'postgres', true);
  IF to_regprocedure('public.version_nombres_equipos()') IS NULL THEN
    r := r || jsonb_build_object('t', 'U0 migración 010 aplicada (version_nombres_equipos existe)', 'ok', false, 'det', 'falta correr db/migraciones/010_red_en_nombres.sql');
  ELSE
    -- Con la 011 (versión 3) la red se hereda: los equipos sin red propia
    -- llevan la de su servidor, y las expectativas cambian donde eso importa.
    v_her := public.version_nombres_equipos() >= 3;
    SELECT count(*) INTO v_n FROM pg_trigger WHERE tgname = 'trg_redes_nombres_equipos_al_dia' AND NOT tgisinternal;
    SELECT pg_get_triggerdef(oid) INTO v_txt FROM pg_trigger WHERE tgname = 'trg_equipos_radioenlace_nombres_al_dia' AND NOT tgisinternal;
    r := r || jsonb_build_object('t', 'U0 migración 010: versión 2 (o 3) de los nombres, trigger en redes y el de equipos también mira red_id',
      'ok', public.version_nombres_equipos() >= 2 AND v_n = 1 AND v_txt LIKE '%red_id%', 'det', format('versión %s, trigger en redes %s', public.version_nombres_equipos(), v_n));
    r := r || jsonb_build_object('t', 'U1 la app puede preguntar la versión de los nombres (EXECUTE para anon y authenticated)',
      'ok', has_function_privilege('anon', 'public.version_nombres_equipos()', 'EXECUTE') AND has_function_privilege('authenticated', 'public.version_nombres_equipos()', 'EXECUTE'), 'det', '');

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Torre U', 'torre', -2.22, -79.92) RETURNING id INTO v_uu;
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Poste U', 'torre', -2.2205, -79.9205) RETURNING id INTO v_us2;
      INSERT INTO public.redes (nombre, color) VALUES ('[TX] Red U1', '#004DAB') RETURNING id INTO v_ru1;
      INSERT INTO public.redes (nombre, color) VALUES (' [TX] Red U2 ', '#EC741D') RETURNING id INTO v_ru2;
      -- (La sección R cambia el valor de «router» a «router_core»: se lo busca por su etiqueta.)
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id)
        VALUES (v_uu, '[TX] u1', coalesce((SELECT valor FROM public.tipos_equipo_red WHERE etiqueta = 'Router' ORDER BY valor LIMIT 1), 'router'), v_ru1) RETURNING id INTO u_1;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id, servidor_id) VALUES (v_uu, '[TX] u2', 'switch', v_ru1, u_1) RETURNING id INTO u_2;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id, servidor_id, referencia, medio) VALUES (v_us2, '[TX] u3', 'camara', v_ru2, u_2, ' Norte ', 'cable') RETURNING id INTO u_3;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id) VALUES (v_uu, '[TX] u4', 'ap', u_2) RETURNING id INTO u_4;
      SELECT string_agg(nombre, ' | ' ORDER BY id) INTO v_txt FROM public.equipos_radioenlace WHERE id IN (u_1, u_2, u_3, u_4);
      r := r || jsonb_build_object('t', 'U2 la red va entre paréntesis con la referencia; la del servidor, solo si es distinta',
        'ok', v_txt = 'Router ([TX] Red U1) en [TX] Torre U | Switch ([TX] Red U1) en [TX] Torre U conectado a Router | Cámara ([TX] Red U2 · Norte) en [TX] Poste U conectada a Switch ([TX] Red U1) en [TX] Torre U | '
          || CASE WHEN v_her THEN 'AP ([TX] Red U1) en [TX] Torre U conectado a Switch' ELSE 'AP en [TX] Torre U conectado a Switch ([TX] Red U1)' END, 'det', v_txt);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'U2 la red va entre paréntesis con la referencia; la del servidor, solo si es distinta', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET red_id = v_ru2 WHERE id = u_2;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = u_2;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = u_3;
      r := r || jsonb_build_object('t', 'U3 cambiar la red de un equipo pone al día su nombre y el de sus clientes',
        'ok', v_t1 = 'Switch ([TX] Red U2) en [TX] Torre U conectado a Router ([TX] Red U1)' AND v_t2 = 'Cámara ([TX] Red U2 · Norte) en [TX] Poste U conectada a Switch en [TX] Torre U', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'U3 cambiar la red de un equipo pone al día su nombre y el de sus clientes', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.redes SET nombre = '[TX] Red U2b' WHERE id = v_ru2;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = u_3;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = u_4;
      r := r || jsonb_build_object('t', 'U4 renombrar una red pone al día los nombres',
        'ok', v_t1 = 'Cámara ([TX] Red U2b · Norte) en [TX] Poste U conectada a Switch en [TX] Torre U'
          AND v_t2 = CASE WHEN v_her THEN 'AP ([TX] Red U2b) en [TX] Torre U conectado a Switch' ELSE 'AP en [TX] Torre U conectado a Switch ([TX] Red U2b)' END, 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'U4 renombrar una red pone al día los nombres', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id, servidor_id, referencia, medio) VALUES (v_us2, '[TX] u5', 'camara', v_ru2, u_2, 'Norte', 'cable') RETURNING id INTO u_5;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = u_5;
      UPDATE public.equipos_radioenlace SET red_id = NULL WHERE id = u_5;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = u_5;
      -- Con la 011, sin red propia hereda la del switch: sigue en esa red y numerada.
      r := r || jsonb_build_object('t', 'U5 con la misma red se numera «(2)»; sin red ya no choca y se nombra la red del servidor (con la 011: la hereda)',
        'ok', v_t1 = 'Cámara ([TX] Red U2b · Norte) en [TX] Poste U conectada a Switch en [TX] Torre U (2)'
          AND v_t2 = CASE WHEN v_her THEN 'Cámara ([TX] Red U2b · Norte) en [TX] Poste U conectada a Switch en [TX] Torre U (2)' ELSE 'Cámara (Norte) en [TX] Poste U conectada a Switch ([TX] Red U2b) en [TX] Torre U' END, 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'U5 con la misma red se numera «(2)»; sin red ya no choca y se nombra la red del servidor (con la 011: la hereda)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      DELETE FROM public.redes WHERE id = v_ru1;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = u_1;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = u_2;
      r := r || jsonb_build_object('t', 'U6 borrar una red deja los nombres sin ella (aunque la FK la quita desde un trigger interno)',
        'ok', v_t1 = 'Router en [TX] Torre U' AND v_t2 = 'Switch ([TX] Red U2b) en [TX] Torre U conectado a Router', 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'U6 borrar una red deja los nombres sin ella (aunque la FK la quita desde un trigger interno)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace WHERE tipo_equipo IS NOT NULL AND nombre <> (SELECT x FROM (SELECT public.f_nombre_base_equipo(id) AS x) b) AND nombre NOT LIKE '% (_)';
    r := r || jsonb_build_object('t', 'U7 con la red en el nombre, todos los equipos con tipo siguen con su nombre automático guardado', 'ok', v_n = 0, 'det', format('distintos %s', v_n));
  END IF;

  -- ================= V. Migración 011: la red se hereda del servidor =================
  PERFORM set_config('role', 'postgres', true);
  IF to_regprocedure('public.f_red_efectiva(bigint)') IS NULL THEN
    r := r || jsonb_build_object('t', 'V0 migración 011 aplicada (f_red_efectiva existe)', 'ok', false, 'det', 'falta correr db/migraciones/011_red_heredada.sql');
  ELSE
    r := r || jsonb_build_object('t', 'V0 migración 011: versión 3 de los nombres; la normalización solo la corren los triggers (sin EXECUTE para anon ni authenticated)',
      'ok', public.version_nombres_equipos() = 3
        AND to_regprocedure('public.normalizar_redes_equipos()') IS NOT NULL
        AND NOT has_function_privilege('anon', 'public.normalizar_redes_equipos()', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.normalizar_redes_equipos()', 'EXECUTE'),
      'det', format('versión %s', public.version_nombres_equipos()));

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Torre V', 'torre', -2.23, -79.93) RETURNING id INTO v_uv;
      INSERT INTO public.ubicaciones (nombre, tipo, lat, lng) VALUES ('[TX] Caseta V', 'oficina', -2.2305, -79.9305) RETURNING id INTO v_uv2;
      INSERT INTO public.redes (nombre, color) VALUES ('[TX] Red VA', '#004DAB') RETURNING id INTO v_rva;
      INSERT INTO public.redes (nombre, color) VALUES ('[TX] Red VB', '#EC741D') RETURNING id INTO v_rvb;
      INSERT INTO public.redes (nombre, color) VALUES ('[TX] Red VC', '#2E8B57') RETURNING id INTO v_rvc;
      -- (La sección R cambia el valor de «router» a «router_core»: se lo busca por su etiqueta.)
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id)
        VALUES (v_uv, '[TX] w1', coalesce((SELECT valor FROM public.tipos_equipo_red WHERE etiqueta = 'Router' ORDER BY valor LIMIT 1), 'router'), v_rva) RETURNING id INTO w_1;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id) VALUES (v_uv, '[TX] w2', 'ptp', w_1) RETURNING id INTO w_2;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id) VALUES (v_uv2, '[TX] w3', 'estacion', w_2) RETURNING id INTO w_3;
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, servidor_id, red_id) VALUES (v_uv2, '[TX] w4', 'camara', w_3, v_rva) RETURNING id INTO w_4;
      SELECT red_id INTO v_n FROM public.equipos_radioenlace WHERE id = w_4;
      r := r || jsonb_build_object('t', 'V1 sin red propia se hereda la del servidor (hasta la raíz); una propia igual a la heredada queda vacía',
        'ok', public.f_red_efectiva(w_2) = v_rva AND public.f_red_efectiva(w_3) = v_rva AND public.f_red_efectiva(w_4) = v_rva AND v_n IS NULL,
        'det', format('efectivas %s/%s/%s, propia de la cámara %s', public.f_red_efectiva(w_2), public.f_red_efectiva(w_3), public.f_red_efectiva(w_4), coalesce(v_n::text, 'vacía')));
      SELECT string_agg(nombre, ' | ' ORDER BY id) INTO v_txt FROM public.equipos_radioenlace WHERE id IN (w_2, w_3, w_4);
      r := r || jsonb_build_object('t', 'V2 el nombre lleva la red heredada (y la del servidor solo si es distinta)',
        'ok', v_txt = 'Punto a Punto ([TX] Red VA) en [TX] Torre V conectado a Router | Estación ([TX] Red VA) en [TX] Caseta V enlazada a Punto a Punto en [TX] Torre V | Cámara ([TX] Red VA) en [TX] Caseta V conectada a Estación', 'det', v_txt);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V1 sin red propia se hereda la del servidor (hasta la raíz); una propia igual a la heredada queda vacía', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET red_id = v_rvb WHERE id = w_3;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = w_3;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = w_4;
      r := r || jsonb_build_object('t', 'V3 otra red en un equipo intermedio: él y lo que cuelga de él quedan en esa red',
        'ok', v_t1 = 'Estación ([TX] Red VB) en [TX] Caseta V enlazada a Punto a Punto ([TX] Red VA) en [TX] Torre V'
          AND v_t2 = 'Cámara ([TX] Red VB) en [TX] Caseta V conectada a Estación' AND public.f_red_efectiva(w_4) = v_rvb AND public.f_red_efectiva(w_2) = v_rva,
        'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V3 otra red en un equipo intermedio: él y lo que cuelga de él quedan en esa red', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET red_id = v_rvc WHERE id = w_1;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = w_2;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = w_3;
      SELECT nombre INTO v_txt FROM public.equipos_radioenlace WHERE id = w_4;
      r := r || jsonb_build_object('t', 'V4 cambiar la red de la raíz la cambia en lo que la hereda (no en la red aparte) y pone al día los nombres',
        'ok', v_t1 = 'Punto a Punto ([TX] Red VC) en [TX] Torre V conectado a Router'
          AND v_t2 = 'Estación ([TX] Red VB) en [TX] Caseta V enlazada a Punto a Punto ([TX] Red VC) en [TX] Torre V'
          AND v_txt = 'Cámara ([TX] Red VB) en [TX] Caseta V conectada a Estación',
        'det', v_t1 || ' / ' || v_t2 || ' / ' || v_txt);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V4 cambiar la red de la raíz la cambia en lo que la hereda (no en la red aparte) y pone al día los nombres', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.equipos_radioenlace SET red_id = v_rvc WHERE id = w_3;
      SELECT red_id INTO v_n FROM public.equipos_radioenlace WHERE id = w_3;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = w_3;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = w_4;
      r := r || jsonb_build_object('t', 'V5 ponerle a un equipo la misma red que hereda la deja vacía: vuelve a seguir a su servidor',
        'ok', v_n IS NULL AND v_t1 = 'Estación ([TX] Red VC) en [TX] Caseta V enlazada a Punto a Punto en [TX] Torre V' AND v_t2 = 'Cámara ([TX] Red VC) en [TX] Caseta V conectada a Estación',
        'det', coalesce(v_n::text, 'vacía') || ' / ' || v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V5 ponerle a un equipo la misma red que hereda la deja vacía: vuelve a seguir a su servidor', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, tipo_equipo, red_id)
        VALUES (v_uv2, '[TX] w5', coalesce((SELECT valor FROM public.tipos_equipo_red WHERE etiqueta = 'Router' ORDER BY valor LIMIT 1), 'router'), v_rvb) RETURNING id INTO w_5;
      UPDATE public.equipos_radioenlace SET servidor_id = w_5 WHERE id = w_4;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = w_4;
      r := r || jsonb_build_object('t', 'V6 al cambiarle el servidor, hereda la red del nuevo',
        'ok', v_t1 = 'Cámara ([TX] Red VB) en [TX] Caseta V conectada a Router' AND public.f_red_efectiva(w_4) = v_rvb, 'det', v_t1);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V6 al cambiarle el servidor, hereda la red del nuevo', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      DELETE FROM public.redes WHERE id = v_rvc;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = w_2;
      SELECT nombre INTO v_t2 FROM public.equipos_radioenlace WHERE id = w_3;
      r := r || jsonb_build_object('t', 'V7 borrar la red de la raíz la quita también de lo que la heredaba',
        'ok', v_t1 = 'Punto a Punto en [TX] Torre V conectado a Router' AND v_t2 = 'Estación en [TX] Caseta V enlazada a Punto a Punto en [TX] Torre V'
          AND public.f_red_efectiva(w_3) IS NULL, 'det', v_t1 || ' / ' || v_t2);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V7 borrar la red de la raíz la quita también de lo que la heredaba', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      -- Red aparte dentro de una red aparte: A ← B ← A. Al borrar B, la cámara
      -- queda con la misma red que heredaría y su red propia se deja vacía.
      UPDATE public.equipos_radioenlace SET red_id = v_rva WHERE id = w_2;
      UPDATE public.equipos_radioenlace SET red_id = v_rvb WHERE id = w_3;
      UPDATE public.equipos_radioenlace SET servidor_id = w_3, red_id = v_rva WHERE id = w_4;
      SELECT red_id INTO v_m FROM public.equipos_radioenlace WHERE id = w_4;
      DELETE FROM public.redes WHERE id = v_rvb;
      SELECT red_id INTO v_n FROM public.equipos_radioenlace WHERE id = w_4;
      SELECT nombre INTO v_t1 FROM public.equipos_radioenlace WHERE id = w_4;
      r := r || jsonb_build_object('t', 'V8 al borrar una red, lo que queda repetido con la heredada también se deja vacío',
        'ok', v_m = v_rva AND v_n IS NULL AND public.f_red_efectiva(w_4) = v_rva AND v_t1 = 'Cámara ([TX] Red VA) en [TX] Caseta V conectada a Estación',
        'det', format('antes %s, después %s: %s', v_m, coalesce(v_n::text, 'vacía'), v_t1));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'V8 al borrar una red, lo que queda repetido con la heredada también se deja vacío', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    PERFORM set_config('role', 'postgres', true);
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace e
     WHERE e.red_id IS NOT NULL AND e.servidor_id IS NOT NULL AND e.red_id = public.f_red_efectiva(e.servidor_id);
    SELECT count(*) INTO v_m FROM public.equipos_radioenlace WHERE tipo_equipo IS NOT NULL AND nombre <> (SELECT x FROM (SELECT public.f_nombre_base_equipo(id) AS x) b) AND nombre NOT LIKE '% (_)';
    r := r || jsonb_build_object('t', 'V9 en toda la tabla: ninguna red propia repite la heredada y todos los nombres con tipo están al día',
      'ok', v_n = 0 AND v_m = 0, 'det', format('redes repetidas %s, nombres distintos %s', v_n, v_m));
  END IF;

  -- ================= W. Migración 012: campos configurables de los activos =================
  PERFORM set_config('role', 'postgres', true);
  IF to_regclass('public.campos_activo') IS NULL THEN
    r := r || jsonb_build_object('t', 'W0 migración 012 aplicada (campos_activo existe)', 'ok', false, 'det', 'falta correr db/migraciones/012_campos_configurables.sql');
  ELSE
    SELECT count(*) INTO x_n FROM public.campos_activo WHERE fijo;
    r := r || jsonb_build_object('t', 'W0 migración 012: 9 campos fijos, columnas nuevas, renombrar solo para authenticated y las bajas copian personalizados',
      'ok', x_n = 9
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activos' AND column_name = 'personalizados' AND is_nullable = 'NO')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tipos_activo' AND column_name = 'campos_obligatorios')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tipos_ubicacion' AND column_name = 'icono_svg')
        AND has_function_privilege('authenticated', 'public.renombrar_tipo_activo(text, text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.renombrar_tipo_activo(text, text)', 'EXECUTE')
        AND position('personalizados' in pg_get_functiondef('public.f_dar_baja(integer, text)'::regprocedure)) > 0
        AND position('personalizados' in pg_get_functiondef('public.f_restaurar_baja(bigint)'::regprocedure)) > 0,
      'det', format('fijos %s', x_n));

    -- W1: quién lee y quién escribe las definiciones
    PERFORM set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO x_n FROM public.campos_activo;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato) VALUES ('tx_visita', '[TX] Visita', 'texto');
      r := r || jsonb_build_object('t', 'W1 cualquiera lee los campos; el visitante no los crea (solo el administrador)', 'ok', false, 'det', 'el visitante creó un campo');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W1 cualquiera lee los campos; el visitante no los crea (solo el administrador)', 'ok', SQLSTATE = '42501' AND x_n >= 9, 'det', format('anon lee %s; %s %s', x_n, SQLSTATE, SQLERRM));
    END;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    BEGIN
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, unico, en_acta, orden) VALUES ('tx_imei', '  [TX] IMEI ', 'texto', true, true, 1000);
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, unidad, orden) VALUES ('tx_capacidad', '[TX] Capacidad', 'numero', 'VA', 1010);
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, opciones, orden) VALUES ('tx_operadora', '[TX] Operadora', 'lista',
        '[{"valor":"claro","etiqueta":"Claro","activo":true},{"valor":"cnt","etiqueta":"CNT","activo":false}]', 1020);
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, orden) VALUES ('tx_garantia', '[TX] Garantía hasta', 'fecha', 1030);
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, orden) VALUES ('tx_propio', '[TX] ¿Propio?', 'si_no', 1040);
      SELECT etiqueta INTO x_txt FROM public.campos_activo WHERE clave = 'tx_imei';
      r := r || jsonb_build_object('t', 'W2 el administrador crea campos de cada tipo de dato (la etiqueta queda sin espacios de más)', 'ok', x_txt = '[TX] IMEI', 'det', x_txt);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W2 el administrador crea campos de cada tipo de dato (la etiqueta queda sin espacios de más)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;

    -- W3: reglas de las definiciones
    x_txt := '';
    BEGIN INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, fijo, columna) VALUES ('tx_fijo', '[TX] Fijo', 'texto', true, 'marca'); x_txt := x_txt || 'fijo-nuevo '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato) VALUES ('estado', '[TX] Estado', 'texto'); x_txt := x_txt || 'reservada '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato) VALUES ('tx_otro_imei', '[tx] imei', 'texto'); x_txt := x_txt || 'etiqueta-repetida '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN DELETE FROM public.campos_activo WHERE clave = 'serie'; IF FOUND THEN x_txt := x_txt || 'borro-fijo '; END IF; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.campos_activo SET tipo_dato = 'numero' WHERE clave = 'serie'; x_txt := x_txt || 'tipo-de-fijo '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.campos_activo SET activo = false WHERE clave = 'serie'; x_txt := x_txt || 'desactivo-fijo '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.campos_activo SET clave = 'tx_imei2' WHERE clave = 'tx_imei'; x_txt := x_txt || 'cambio-clave '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, opciones) VALUES ('tx_lista_mala', '[TX] Lista mala', 'lista', '[{"valor":"a","etiqueta":"A"},{"valor":"a","etiqueta":"Otra A"}]'); x_txt := x_txt || 'opcion-repetida '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, unico) VALUES ('tx_fecha_unica', '[TX] Fecha única', 'fecha', true); x_txt := x_txt || 'unico-en-fecha '; EXCEPTION WHEN others THEN NULL; END;
    UPDATE public.campos_activo SET etiqueta = '[TX] Número de serie', unico = false WHERE clave = 'serie';
    SELECT etiqueta INTO x_js FROM (SELECT to_jsonb(etiqueta) AS etiqueta FROM public.campos_activo WHERE clave = 'serie') q;
    r := r || jsonb_build_object('t', 'W3 los fijos no se borran, ni cambian de tipo, ni se desactivan (la etiqueta sí); claves reservadas, etiquetas y opciones repetidas y «único» en una fecha se rechazan',
      'ok', x_txt = '' AND x_js = to_jsonb('[TX] Número de serie'::text), 'det', coalesce(nullif(x_txt, ''), 'todo rechazado') || ' / ' || x_js::text);

    -- W4: personalizados se mezcla (lo oculto no se pierde; null borra) y se valida por tipo de dato
    BEGIN
      INSERT INTO public.activos (propiedad, tipo, marca, modelo, serie, personalizados)
        VALUES ('lukmar', 'Laptop', '[TX] W', 'A', '[TX]-W-1', '{"tx_imei": "35-111", "tx_capacidad": 1500}') RETURNING id INTO x_1;
      UPDATE public.activos SET personalizados = '{"tx_operadora": "claro", "tx_garantia": "2027-01-31", "tx_propio": true}' WHERE id = x_1;
      UPDATE public.activos SET personalizados = '{"tx_capacidad": null}', marca = '[TX] W2' WHERE id = x_1;
      SELECT personalizados INTO x_js FROM public.activos WHERE id = x_1;
      r := r || jsonb_build_object('t', 'W4 al guardar se mezcla con lo que había (lo que no llega se conserva) y un null quita el valor',
        'ok', x_js = '{"tx_imei": "35-111", "tx_operadora": "claro", "tx_garantia": "2027-01-31", "tx_propio": true}'::jsonb, 'det', x_js::text);
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W4 al guardar se mezcla con lo que había (lo que no llega se conserva) y un null quita el valor', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    x_txt := '';
    BEGIN UPDATE public.activos SET personalizados = '{"tx_capacidad": "mucha"}' WHERE id = x_1; x_txt := x_txt || 'numero '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '{"tx_operadora": "movistar"}' WHERE id = x_1; x_txt := x_txt || 'lista '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '{"tx_operadora": "cnt"}' WHERE id = x_1; x_txt := x_txt || 'opcion-inactiva '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '{"tx_garantia": "2027-02-30"}' WHERE id = x_1; x_txt := x_txt || 'fecha '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '{"tx_propio": "si"}' WHERE id = x_1; x_txt := x_txt || 'si_no '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '{"tx_no_existe": 1}' WHERE id = x_1; x_txt := x_txt || 'desconocido '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '{"serie": "X"}' WHERE id = x_1; x_txt := x_txt || 'fijo-en-json '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.activos SET personalizados = '[1, 2]' WHERE id = x_1; x_txt := x_txt || 'no-objeto '; EXCEPTION WHEN others THEN NULL; END;
    r := r || jsonb_build_object('t', 'W5 cada valor nuevo se valida: número, opción activa de la lista, fecha real, sí/no, campo que existe y que no sea de siempre, objeto',
      'ok', x_txt = '', 'det', coalesce(nullif(x_txt, ''), 'todo rechazado'));

    -- W6: único (sin mayúsculas ni espacios de más; números como números), también en un fijo
    BEGIN
      INSERT INTO public.activos (propiedad, tipo, marca, personalizados) VALUES ('lukmar', 'Laptop', '[TX] W3', '{"tx_imei": " 35-111 "}') RETURNING id INTO x_2;
      r := r || jsonb_build_object('t', 'W6 «único»: otro activo con el mismo valor se rechaza y el mensaje dice cuál', 'ok', false, 'det', 'se insertó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W6 «único»: otro activo con el mismo valor se rechaza y el mensaje dice cuál', 'ok', SQLSTATE = '23505' AND SQLERRM LIKE '%[TX] IMEI%' AND SQLERRM LIKE '%-' || CASE WHEN length(x_1::text) < 3 THEN lpad(x_1::text, 3, '0') ELSE x_1::text END || ')%', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      INSERT INTO public.activos (propiedad, tipo, marca, personalizados) VALUES ('lukmar', 'Laptop', '[TX] W3', '{"tx_imei": "35-222"}') RETURNING id INTO x_2;
      UPDATE public.activos SET marca = '[TX] W3b' WHERE id = x_2;
      UPDATE public.activos SET personalizados = '{"tx_imei": "35-222"}' WHERE id = x_2;
      r := r || jsonb_build_object('t', 'W7 «único» no traba otros cambios ni volver a guardar el mismo valor', 'ok', true, 'det', format('id %s', x_2));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W7 «único» no traba otros cambios ni volver a guardar el mismo valor', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.campos_activo SET unico = true WHERE clave = 'tx_capacidad';
      UPDATE public.activos SET personalizados = '{"tx_capacidad": 1500}' WHERE id = x_1;
      UPDATE public.activos SET personalizados = '{"tx_capacidad": 1500.00}' WHERE id = x_2;
      r := r || jsonb_build_object('t', 'W8 «único» en un número: 1500 y 1500.00 son el mismo valor', 'ok', false, 'det', 'se guardó el repetido');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W8 «único» en un número: 1500 y 1500.00 son el mismo valor', 'ok', SQLSTATE = '23505', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    BEGIN
      UPDATE public.activos SET modelo = '[TX] repetido' WHERE id IN (x_1, x_2);
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, orden) VALUES ('tx_tmp', '[TX] Tmp', 'texto', 1050);
      UPDATE public.activos SET personalizados = '{"tx_tmp": "igual"}' WHERE id IN (x_1, x_2);
      UPDATE public.campos_activo SET unico = true WHERE clave = 'tx_tmp';
      r := r || jsonb_build_object('t', 'W9 no se puede marcar «único» si ya hay valores repetidos', 'ok', false, 'det', 'se marcó');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W9 no se puede marcar «único» si ya hay valores repetidos', 'ok', SQLSTATE = '23505' AND SQLERRM LIKE '%repetido%', 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    -- (Con la longitud, que casi ningún activo real tiene: marcar la serie
    -- como única fallaría si en la base ya hay series repetidas.)
    BEGIN
      UPDATE public.activos SET longitud_m = 2.5 WHERE id = x_1;
      UPDATE public.campos_activo SET unico = true WHERE clave = 'longitud_m';
      UPDATE public.activos SET longitud_m = 2.50 WHERE id = x_2;
      r := r || jsonb_build_object('t', 'W10 «único» también en un campo de siempre (en su columna de activos)', 'ok', false, 'det', 'se guardó la longitud repetida');
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W10 «único» también en un campo de siempre (en su columna de activos)', 'ok', SQLSTATE = '23505' AND SQLERRM LIKE 'Ya hay otro activo con el mismo «Longitud»%', 'det', SQLSTATE || ' ' || SQLERRM);
    END;

    -- W11: baja y restauración conservan los valores (sin revalidarlos)
    BEGIN
      UPDATE public.campos_activo SET opciones = '[{"valor":"claro","etiqueta":"Claro","activo":false},{"valor":"cnt","etiqueta":"CNT","activo":true}]' WHERE clave = 'tx_operadora';
      PERFORM public.f_dar_baja(x_1, '[TX] baja W');
      SELECT id, activo -> 'personalizados' INTO x_baja, x_js FROM public.bajas WHERE (activo ->> 'id')::int = x_1 ORDER BY id DESC LIMIT 1;
      x_3 := public.f_restaurar_baja(x_baja);
      SELECT personalizados INTO x_js FROM public.activos WHERE id = x_3;
      r := r || jsonb_build_object('t', 'W11 dar de baja y restaurar conserva los valores de los campos nuevos (aunque una opción se haya desactivado)',
        'ok', x_js ->> 'tx_imei' = '35-111' AND x_js ->> 'tx_operadora' = 'claro' AND (x_js ->> 'tx_propio')::boolean, 'det', coalesce(x_js::text, 'sin valores'));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W11 dar de baja y restaurar conserva los valores de los campos nuevos (aunque una opción se haya desactivado)', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;

    -- W12: tipo de dato, opciones y borrado con valores
    x_txt := '';
    BEGIN UPDATE public.campos_activo SET tipo_dato = 'texto_largo' WHERE clave = 'tx_imei'; x_txt := x_txt || 'tipo-con-valores '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.campos_activo SET opciones = '[{"valor":"cnt","etiqueta":"CNT","activo":true}]' WHERE clave = 'tx_operadora'; x_txt := x_txt || 'quito-opcion-usada '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN DELETE FROM public.campos_activo WHERE clave = 'tx_imei'; IF FOUND THEN x_txt := x_txt || 'borro-con-valores '; END IF; EXCEPTION WHEN others THEN NULL; END;
    BEGIN
      INSERT INTO public.campos_activo (clave, etiqueta, tipo_dato, orden) VALUES ('tx_sin_uso', '[TX] Sin uso', 'texto', 1060);
      UPDATE public.campos_activo SET tipo_dato = 'lista', opciones = '[{"valor":"x","etiqueta":"X"}]' WHERE clave = 'tx_sin_uso';
      DELETE FROM public.campos_activo WHERE clave = 'tx_sin_uso';
    EXCEPTION WHEN others THEN x_txt := x_txt || 'sin-uso:' || SQLERRM || ' ';
    END;
    r := r || jsonb_build_object('t', 'W12 un campo con valores no cambia de tipo de dato ni se borra, ni pierde una opción que se usa; uno sin valores, sí',
      'ok', x_txt = '', 'det', coalesce(nullif(x_txt, ''), 'como se esperaba'));

    -- W13: renombrar un tipo de activo
    BEGIN
      INSERT INTO public.tipos_activo (nombre, icono_svg, color, campos_pertinentes, orden) VALUES ('[TX] Tipo W', '<svg viewBox="0 0 16 16" width="16" height="16"></svg>', '#004DAB', '["serie"]', 5000);
      UPDATE public.activos SET tipo = '[TX] Tipo W' WHERE id = x_2;
      PERFORM public.f_dar_baja(x_2, '[TX] baja W2');
      INSERT INTO public.activos (propiedad, tipo, marca) VALUES ('lukmar', '[TX] Tipo W', '[TX] W4') RETURNING id INTO x_2;
      x_n := public.renombrar_tipo_activo('[TX] Tipo W', '  [TX] Tipo W nuevo ');
      SELECT count(*) INTO x_1 FROM public.activos WHERE tipo = '[TX] Tipo W nuevo';
      SELECT count(*) INTO x_3 FROM public.bajas WHERE activo ->> 'tipo' = '[TX] Tipo W nuevo';
      r := r || jsonb_build_object('t', 'W13 renombrar un tipo: la FK lo lleva a los activos y la función a las copias de las bajas',
        'ok', x_n = 1 AND x_1 = 1 AND x_3 = 1 AND NOT EXISTS (SELECT 1 FROM public.tipos_activo WHERE nombre = '[TX] Tipo W'), 'det', format('devolvió %s; activos %s, bajas %s', x_n, x_1, x_3));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W13 renombrar un tipo: la FK lo lleva a los activos y la función a las copias de las bajas', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
    x_txt := '';
    BEGIN PERFORM public.renombrar_tipo_activo('Celular', '[TX] Teléfono'); x_txt := x_txt || 'celular '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN PERFORM public.renombrar_tipo_activo('[TX] Tipo W nuevo', 'laptop'); x_txt := x_txt || 'repetido '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN PERFORM public.renombrar_tipo_activo('[TX] Tipo W nuevo', '   '); x_txt := x_txt || 'vacio '; EXCEPTION WHEN others THEN NULL; END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_visit, 'role', 'authenticated')::text, true);
    BEGIN PERFORM public.renombrar_tipo_activo('[TX] Tipo W nuevo', '[TX] Otro'); x_txt := x_txt || 'visitante '; EXCEPTION WHEN others THEN NULL; END;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    r := r || jsonb_build_object('t', 'W14 no se renombra «Celular», ni a un nombre que ya existe o vacío, ni lo hace quien no es administrador',
      'ok', x_txt = '', 'det', coalesce(nullif(x_txt, ''), 'todo rechazado'));

    -- W15: íconos: los de ubicación se guardan; con scripts o eventos, no (tampoco en los tipos de activo)
    x_txt := '';
    BEGIN
      UPDATE public.tipos_ubicacion SET icono_svg = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="currentColor"/></svg>' WHERE valor = 'torre';
      IF NOT FOUND THEN x_txt := x_txt || 'no-guardo-el-bueno '; END IF;
    EXCEPTION WHEN others THEN x_txt := x_txt || 'rechazo-el-bueno:' || SQLERRM || ' ';
    END;
    BEGIN UPDATE public.tipos_ubicacion SET icono_svg = '<svg viewBox="0 0 16 16" onload="alert(1)"></svg>' WHERE valor = 'torre'; x_txt := x_txt || 'onload '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.tipos_ubicacion SET icono_svg = '<svg viewBox="0 0 16 16"><script>alert(1)</script></svg>' WHERE valor = 'torre'; x_txt := x_txt || 'script '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.tipos_ubicacion SET icono_svg = 'no es un svg' WHERE valor = 'torre'; x_txt := x_txt || 'texto '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.tipos_ubicacion SET icono_svg = '<svg viewBox="0 0 16 16"><path/onload="alert(1)" d="M0 0"/></svg>' WHERE valor = 'torre'; x_txt := x_txt || 'onload-tras-barra '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.tipos_ubicacion SET icono_svg = '<svg viewBox="0 0 16 16"><path d="M0 0"onload="alert(1)"/></svg>' WHERE valor = 'torre'; x_txt := x_txt || 'onload-tras-comilla '; EXCEPTION WHEN others THEN NULL; END;
    BEGIN UPDATE public.tipos_activo SET icono_svg = '<svg width="16" height="16"><a href="javascript:alert(1)"/></svg>' WHERE nombre = 'Laptop'; x_txt := x_txt || 'activo-javascript '; EXCEPTION WHEN others THEN NULL; END;
    r := r || jsonb_build_object('t', 'W15 ícono de un tipo de ubicación: se guarda uno bueno; con scripts, eventos o que no es SVG, no (tampoco en los tipos de activo)',
      'ok', x_txt = '', 'det', coalesce(nullif(x_txt, ''), 'como se esperaba'));

    -- W16: obligatorios por tipo (lista de claves) y auditoría de los campos
    BEGIN
      UPDATE public.tipos_activo SET campos_obligatorios = '["serie", "tx_imei"]' WHERE nombre = '[TX] Tipo W nuevo';
      BEGIN UPDATE public.tipos_activo SET campos_obligatorios = '{"serie": true}' WHERE nombre = '[TX] Tipo W nuevo'; x_txt := 'objeto-aceptado'; EXCEPTION WHEN others THEN x_txt := ''; END;
      PERFORM set_config('role', 'postgres', true);
      SELECT count(*) INTO x_n FROM public.auditoria WHERE accion LIKE '%_campos_activo' AND fecha >= now() - interval '1 minute';
      r := r || jsonb_build_object('t', 'W16 los obligatorios son una lista de claves por tipo, y los cambios de campos quedan en la auditoría',
        'ok', x_txt = '' AND x_n >= 5, 'det', format('%s filas de auditoría de campos', x_n));
    EXCEPTION WHEN others THEN
      r := r || jsonb_build_object('t', 'W16 los obligatorios son una lista de claves por tipo, y los cambios de campos quedan en la auditoría', 'ok', false, 'det', SQLSTATE || ' ' || SQLERRM);
    END;
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
  IF to_regclass('public.campos_activo') IS NOT NULL THEN
    SELECT string_agg(rol || ':' || priv, ', ') INTO v_txt
      FROM (VALUES ('anon'), ('authenticated')) AS roles(rol)
      CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) AS privs(priv)
     WHERE NOT has_table_privilege(rol, 'public.campos_activo', priv);
    r := r || jsonb_build_object('t', 'G3 campos_activo tiene GRANT SELECT/INSERT/UPDATE/DELETE para anon y authenticated', 'ok', v_txt IS NULL, 'det', coalesce('faltan: ' || v_txt, 'completo'));
  END IF;

  -- ================= D. Auditoría =================
  SELECT count(*) INTO v_n FROM public.auditoria
   WHERE accion IN ('INSERT_ubicaciones', 'INSERT_equipos_radioenlace', 'INSERT_historial_ubicacion', 'INSERT_enlaces_respaldo')
     AND fecha >= now() - interval '1 minute';
  SELECT count(*) INTO v_m FROM public.auditoria
   WHERE accion IN ('DELETE_enlaces_respaldo', 'UPDATE_equipos_radioenlace') AND fecha >= now() - interval '1 minute';
  r := r || jsonb_build_object('t', 'D1 los cambios del mapa (incluidos respaldos y jerarquía) quedan en auditoría', 'ok', v_n >= 12 AND v_m >= 5, 'det', format('inserts auditados: %s, cambios de jerarquía/respaldos auditados: %s', v_n, v_m));

  RAISE EXCEPTION 'RESULTADOS_MAPA:%', r::text;
END $$;
