-- =====================================================================
-- Datos de prueba del mapa (jerarquía de la migración 003), para verificar
-- en el navegador con datos reales. Se borran con mapa_limpieza_prueba.sql.
--
-- Todo lleva el prefijo [PRUEBA] en el nombre. No toca ningún activo.
--
-- Red de prueba (Guayaquil; "cable" = servidor en la misma ubicación):
--
--   Oficina Matriz   Router Matriz (raíz) ─cable─ PTP Matriz → Cerro Azul
--   Torre Norte      Router LTE Norte (raíz) ─cable─ PTP Norte → Cerro Azul
--                                            └cable─ AP Norte → Piscinas 12-13
--   Torre Cerro Azul PTP CA ← Matriz (backbone) ─cable─ Router Cerro Azul
--                    PTP CA ← Norte (backbone, solo de respaldo)
--                    Router Cerro Azul: respaldo 1 = PTP CA ← Norte
--                      ├cable─ AP Cerro Azul → Piscinas 1-9 (9 clientes: se agrupa)
--                      └cable─ PTP CA → Santa Ana (backbone)
--   Torre Santa Ana  PTP SA ← Cerro Azul ─cable─ AP Santa Ana → Piscinas 10-11
--   Piscina 1        CPE con respaldo 1 = AP Santa Ana y respaldo 2 = AP Norte
--
-- Casos que cubre: backbone (1 cliente) y P2MP (varios), un AP con más de 8
-- clientes, dos raíces, un equipo con dos respaldos en orden de prioridad,
-- un respaldo por cable y un subárbol sin ningún respaldo (Santa Ana).
-- =====================================================================
DO $$
DECLARE
  u_mat bigint; u_nor bigint; u_ca bigint; u_sa bigint;
  u_p   bigint[] := '{}';
  r1 bigint; m1 bigint; r2 bigint; n1 bigint; n2 bigint;
  c1 bigint; c2 bigint; c3 bigint; c4 bigint; c5 bigint;
  s1 bigint; s2 bigint;
  p  bigint[] := '{}';
  v_id bigint;
  i integer;
  -- Piscinas: 1-9 al suroeste de Cerro Azul, 10-11 al sur de Santa Ana, 12-13 al norte.
  lat numeric[] := ARRAY[-2.2200, -2.2200, -2.2200, -2.2400, -2.2400, -2.2400, -2.2600, -2.2600, -2.2600, -2.2300, -2.2450, -2.0950, -2.0850];
  lng numeric[] := ARRAY[-79.9700, -80.0000, -80.0300, -79.9700, -80.0000, -80.0300, -79.9700, -80.0000, -80.0300, -79.8600, -79.8800, -79.9300, -79.8950];
BEGIN
  IF EXISTS (SELECT 1 FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%') THEN
    RAISE EXCEPTION 'Ya hay datos [PRUEBA] en ubicaciones: corre primero mapa_limpieza_prueba.sql.';
  END IF;

  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas) VALUES ('[PRUEBA] Oficina Matriz', 'oficina', -2.1894, -79.8891, 'Dato de prueba del mapa: se borra al terminar.') RETURNING id INTO u_mat;
  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas) VALUES ('[PRUEBA] Torre Norte', 'torre', -2.1180, -79.9050, 'Dato de prueba del mapa: se borra al terminar.') RETURNING id INTO u_nor;
  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas) VALUES ('[PRUEBA] Torre Cerro Azul', 'torre', -2.1735, -79.9587, 'Dato de prueba del mapa: se borra al terminar.') RETURNING id INTO u_ca;
  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas) VALUES ('[PRUEBA] Torre Santa Ana', 'torre', -2.1839, -79.8756, 'Dato de prueba del mapa: se borra al terminar.') RETURNING id INTO u_sa;
  FOR i IN 1..13 LOOP
    INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas)
    VALUES ('[PRUEBA] Piscina ' || i, 'otro', lat[i], lng[i], 'Dato de prueba del mapa: se borra al terminar.')
    RETURNING id INTO v_id;
    u_p := u_p || v_id;
  END LOOP;

  -- Raíces y backbone (los servidores se crean antes que sus clientes)
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (u_mat, '[PRUEBA] Router Matriz', 'MikroTik CCR2004') RETURNING id INTO r1;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_mat, '[PRUEBA] PTP Matriz → Cerro Azul', 'Cambium PTP 550', r1, '5 GHz', 5745) RETURNING id INTO m1;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (u_nor, '[PRUEBA] Router LTE Norte', 'MikroTik LtAP LTE') RETURNING id INTO r2;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_nor, '[PRUEBA] PTP Norte → Cerro Azul', 'Ubiquiti airFiber 5XHD', r2, '5 GHz', 5825) RETURNING id INTO n1;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_nor, '[PRUEBA] AP Norte', 'Cambium ePMP 3000', r2, '5 GHz', 5500) RETURNING id INTO n2;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_ca, '[PRUEBA] PTP Cerro Azul ← Matriz', 'Cambium PTP 550', m1, '5 GHz', 5745) RETURNING id INTO c1;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_ca, '[PRUEBA] PTP Cerro Azul ← Norte', 'Ubiquiti airFiber 5XHD', n1, '5 GHz', 5825) RETURNING id INTO c2;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, notas) VALUES (u_ca, '[PRUEBA] Router Cerro Azul', 'MikroTik RB5009', c1, 'Si cae el enlace de la Matriz conmuta al de la Torre Norte.') RETURNING id INTO c3;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz, notas) VALUES (u_ca, '[PRUEBA] AP Cerro Azul', 'Cambium ePMP 3000', c3, '5 GHz', 5180, 'Sector 120° hacia las piscinas.') RETURNING id INTO c4;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_ca, '[PRUEBA] PTP Cerro Azul → Santa Ana', 'Ubiquiti PowerBeam 5AC', c3, '5 GHz', 5300) RETURNING id INTO c5;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_sa, '[PRUEBA] PTP Santa Ana ← Cerro Azul', 'Ubiquiti PowerBeam 5AC', c5, '5 GHz', 5300) RETURNING id INTO s1;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz) VALUES (u_sa, '[PRUEBA] AP Santa Ana', 'Cambium ePMP 3000', s1, '5 GHz', 5220) RETURNING id INTO s2;

  -- Clientes en las piscinas
  FOR i IN 1..13 LOOP
    INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, servidor_id, banda, frecuencia_mhz)
    VALUES (u_p[i], '[PRUEBA] CPE Piscina ' || i, 'Cambium Force 300-25',
            CASE WHEN i <= 9 THEN c4 WHEN i <= 11 THEN s2 ELSE n2 END, '5 GHz',
            CASE WHEN i <= 9 THEN 5180 WHEN i <= 11 THEN 5220 ELSE 5500 END)
    RETURNING id INTO v_id;
    p := p || v_id;
  END LOOP;

  -- Respaldos
  INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad, notas) VALUES (c3, c2, 1, '[PRUEBA] por cable: sale por la Torre Norte');
  INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad, notas) VALUES (p[1], s2, 1, '[PRUEBA] AP de Santa Ana');
  INSERT INTO public.enlaces_respaldo (equipo_id, servidor_alternativo_id, prioridad, notas) VALUES (p[1], n2, 2, '[PRUEBA] AP de la Torre Norte');
END $$;

-- Resumen de lo creado
SELECT json_build_object(
  'ubicaciones', (SELECT count(*) FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%'),
  'equipos', (SELECT count(*) FROM public.equipos_radioenlace WHERE nombre LIKE '[PRUEBA]%'),
  'raices', (SELECT json_agg(nombre ORDER BY id) FROM public.equipos_radioenlace WHERE nombre LIKE '[PRUEBA]%' AND servidor_id IS NULL),
  'clientes_por_servidor', (SELECT json_object_agg(s.nombre, n) FROM (SELECT servidor_id, count(*) AS n FROM public.equipos_radioenlace WHERE nombre LIKE '[PRUEBA]%' AND servidor_id IS NOT NULL GROUP BY servidor_id) c JOIN public.equipos_radioenlace s ON s.id = c.servidor_id),
  'respaldos', (SELECT json_agg(json_build_object('equipo', e.nombre, 'respaldo', a.nombre, 'prioridad', r.prioridad) ORDER BY e.id, r.prioridad) FROM public.enlaces_respaldo r JOIN public.equipos_radioenlace e ON e.id = r.equipo_id JOIN public.equipos_radioenlace a ON a.id = r.servidor_alternativo_id WHERE e.nombre LIKE '[PRUEBA]%')
) AS datos_prueba;
