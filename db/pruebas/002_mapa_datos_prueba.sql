-- =====================================================================
-- Datos de prueba del mapa (migración 002), para verificar el flujo en el
-- navegador con datos reales. Se borran con 002_mapa_limpieza_prueba.sql.
--
-- Todo lleva el prefijo [PRUEBA] en el nombre. NO toca ninguna fila de
-- activos: solo vincula dos activos reales (por referencia) a ubicaciones de
-- prueba, lo que crea tramos en historial_ubicacion que la limpieza borra.
--
--   3 ubicaciones: 2 torres + 1 oficina (coordenadas de Guayaquil)
--   4 equipos:     PTP Cerro Azul ↔ PTP Santa Ana (punto a punto)
--                  AP Sector Norte (Cerro Azul) ↔ SM Oficina (punto-multipunto)
--   2 enlaces
--   2 activos reales: uno como radio de "SM Oficina" (el trigger lo ubica solo)
--                     y otro asignado directo a la Torre Cerro Azul.
-- =====================================================================
DO $$
DECLARE
  v_ca      bigint;
  v_sa      bigint;
  v_of      bigint;
  e_ca_ptp  bigint;
  e_ca_ap   bigint;
  e_sa_ptp  bigint;
  e_of_sm   bigint;
  v_radio   integer;
  v_otro    integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%') THEN
    RAISE EXCEPTION 'Ya hay datos [PRUEBA] en ubicaciones: corre primero 002_mapa_limpieza_prueba.sql.';
  END IF;

  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas)
  VALUES ('[PRUEBA] Torre Cerro Azul', 'torre', -2.1735, -79.9587, 'Dato de prueba del mapa: se borra al terminar.')
  RETURNING id INTO v_ca;
  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, notas)
  VALUES ('[PRUEBA] Torre Santa Ana', 'torre', -2.1839, -79.8756, 'Dato de prueba del mapa: se borra al terminar.')
  RETURNING id INTO v_sa;
  INSERT INTO public.ubicaciones (nombre, tipo, lat, lng, direccion, notas)
  VALUES ('[PRUEBA] Oficina Centro', 'oficina', -2.1894, -79.8891, 'Av. 9 de Octubre (referencia de prueba)', 'Dato de prueba del mapa: se borra al terminar.')
  RETURNING id INTO v_of;

  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_ca, '[PRUEBA] PTP CA-SA', 'Cambium PTP 550') RETURNING id INTO e_ca_ptp;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo, notas) VALUES (v_ca, '[PRUEBA] AP Sector Norte', 'Cambium ePMP 3000', 'Sector 90°') RETURNING id INTO e_ca_ap;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_sa, '[PRUEBA] PTP SA-CA', 'Cambium PTP 550') RETURNING id INTO e_sa_ptp;
  INSERT INTO public.equipos_radioenlace (ubicacion_id, nombre, modelo) VALUES (v_of, '[PRUEBA] SM Oficina', 'Cambium Force 300-25') RETURNING id INTO e_of_sm;

  INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id, banda, frecuencia_mhz, notas)
  VALUES (e_ca_ptp, e_sa_ptp, '5 GHz', 5745, '[PRUEBA] enlace punto a punto');
  INSERT INTO public.enlaces (equipo_origen_id, equipo_destino_id, banda, frecuencia_mhz, notas)
  VALUES (e_ca_ap, e_of_sm, '5 GHz', 5180, '[PRUEBA] enlace punto-multipunto');

  -- Activos reales usados solo como referencia (sin ubicación todavía):
  -- preferimos uno que parezca equipo de red para el radio.
  SELECT a.id INTO v_radio FROM public.activos a
   WHERE NOT EXISTS (SELECT 1 FROM public.historial_ubicacion h WHERE h.activo_id = a.id)
     AND (a.tipo ILIKE '%antena%' OR a.tipo ILIKE '%radio%' OR a.tipo ILIKE '%access%' OR a.tipo ILIKE '%router%' OR a.tipo ILIKE '%switch%')
   ORDER BY a.id LIMIT 1;
  IF v_radio IS NULL THEN
    SELECT min(a.id) INTO v_radio FROM public.activos a WHERE NOT EXISTS (SELECT 1 FROM public.historial_ubicacion h WHERE h.activo_id = a.id);
  END IF;
  SELECT max(a.id) INTO v_otro FROM public.activos a
   WHERE a.id <> v_radio AND NOT EXISTS (SELECT 1 FROM public.historial_ubicacion h WHERE h.activo_id = a.id);

  UPDATE public.equipos_radioenlace SET activo_id = v_radio WHERE id = e_of_sm;   -- el trigger crea su tramo en la oficina
  INSERT INTO public.historial_ubicacion (activo_id, ubicacion_id, notas) VALUES (v_otro, v_ca, '[PRUEBA] asignación directa');
END $$;

-- Resumen de lo creado
SELECT json_build_object(
  'ubicaciones', (SELECT json_agg(json_build_object('id', id, 'nombre', nombre, 'tipo', tipo) ORDER BY id) FROM public.ubicaciones WHERE nombre LIKE '[PRUEBA]%'),
  'equipos', (SELECT json_agg(json_build_object('id', e.id, 'nombre', e.nombre, 'ubicacion', u.nombre, 'activo_id', e.activo_id) ORDER BY e.id) FROM public.equipos_radioenlace e JOIN public.ubicaciones u ON u.id = e.ubicacion_id WHERE u.nombre LIKE '[PRUEBA]%'),
  'enlaces', (SELECT count(*) FROM public.enlaces l JOIN public.equipos_radioenlace e ON e.id = l.equipo_origen_id JOIN public.ubicaciones u ON u.id = e.ubicacion_id WHERE u.nombre LIKE '[PRUEBA]%'),
  'tramos', (SELECT json_agg(json_build_object('activo_id', h.activo_id, 'ubicacion', u.nombre, 'desde', h.desde, 'notas', h.notas) ORDER BY h.id) FROM public.historial_ubicacion h JOIN public.ubicaciones u ON u.id = h.ubicacion_id WHERE u.nombre LIKE '[PRUEBA]%')
) AS datos_prueba;
