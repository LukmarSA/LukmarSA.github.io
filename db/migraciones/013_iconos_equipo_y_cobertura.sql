-- =====================================================================
-- 013 — Íconos de los tipos de equipo de red y cobertura de los AP (v15)
-- =====================================================================
--
-- Qué cambia
--   * tipos_equipo_red.icono_svg (text, nulo): el ícono del tipo en el
--     tooltip de las ubicaciones del mapa (pedido 3.10). NULL = el de fábrica
--     que trae la app para los 8 tipos de semilla o, para un tipo agregado
--     (Inyector POE, por ejemplo), el del tipo de activo que empareja o uno
--     genérico. Las mismas reglas que tipos_ubicacion.icono_svg (012): hasta
--     20 000 caracteres, empieza con <svg y sin scripts ni eventos.
--   * equipos_radioenlace.radio_cobertura_m (numeric, nulo): el radio de
--     cobertura del equipo en metros (pedido 3.9), de más de 0 a 20 000. La
--     app lo pide para los AP y lo dibuja como un círculo alrededor del AP.
--   * equipos_radioenlace.azimut_cobertura (numeric, nulo): hacia dónde
--     apunta el sector, en grados desde el norte (de 0 a menos de 360).
--   * equipos_radioenlace.apertura_cobertura (numeric, nulo): la apertura del
--     sector en grados (de más de 0 a 360). Con apertura menor que 360 se
--     dibuja una cuña en vez del círculo; sin apertura (o con 360), un círculo.
--   Reglas entre las tres: la dirección y la apertura van solo con un radio,
--   y un sector (apertura menor que 360) necesita su dirección.
--
-- No escribe datos: solo agrega columnas vacías. Las reglas de acceso (RLS),
-- los GRANT y la auditoría de las dos tablas siguen como estaban y valen
-- también para las columnas nuevas. Los nombres automáticos no cambian.
--
-- Sin esta migración la app (v15) funciona como el v14: se esconde lo que
-- falta. Y el v14 publicado sigue funcionando con ella aplicada.
--
-- Necesita la 012 (y con ella la 007). Cómo correrla: pegar TODO el archivo
-- en el SQL Editor de Supabase y ejecutar. Va en una sola transacción: si algo
-- falla, no queda nada a medias. Si ya fue aplicada, se niega sin tocar nada.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.campos_activo') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 012 (public.campos_activo no existe).';
  END IF;
  IF to_regclass('public.tipos_equipo_red') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 007 (public.tipos_equipo_red no existe).';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'equipos_radioenlace' AND column_name = 'radio_cobertura_m') THEN
    RAISE EXCEPTION 'La migración 013 ya fue aplicada (equipos_radioenlace.radio_cobertura_m existe).';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'tipos_equipo_red' AND column_name = 'icono_svg') THEN
    RAISE EXCEPTION 'tipos_equipo_red.icono_svg ya existe sin el resto de la 013: revisa el esquema antes de aplicarla.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Ícono de cada tipo de equipo de red (3.10)
-- ---------------------------------------------------------------------
-- Se muestra a todos: no puede traer scripts ni eventos (el navegador lee un
-- evento también pegado a una barra o a una comilla: «<path/onload=…»).
ALTER TABLE public.tipos_equipo_red
  ADD COLUMN icono_svg text
    CONSTRAINT tipos_equipo_red_icono_valido CHECK (icono_svg IS NULL OR (
      char_length(icono_svg) <= 20000 AND icono_svg ~* '^\s*<svg[\s>]'
      AND icono_svg !~* '<\s*script' AND icono_svg !~* 'javascript\s*:' AND icono_svg !~* '[\s/"'']on[a-z]+\s*=' AND icono_svg !~* '<\s*foreignObject'));
COMMENT ON COLUMN public.tipos_equipo_red.icono_svg IS 'Ícono del tipo en el tooltip de las ubicaciones del mapa (SVG con viewBox). NULL = el de fábrica de la app o el del tipo de activo que empareja (migración 013).';

-- ---------------------------------------------------------------------
-- 2. Cobertura de los AP (3.9): radio y, para un sector, dirección y apertura
-- ---------------------------------------------------------------------
ALTER TABLE public.equipos_radioenlace
  ADD COLUMN radio_cobertura_m numeric
    CONSTRAINT equipos_radioenlace_radio_cobertura_valido CHECK (radio_cobertura_m IS NULL OR (radio_cobertura_m > 0 AND radio_cobertura_m <= 20000)),
  ADD COLUMN azimut_cobertura numeric
    CONSTRAINT equipos_radioenlace_azimut_cobertura_valido CHECK (azimut_cobertura IS NULL OR (azimut_cobertura >= 0 AND azimut_cobertura < 360)),
  ADD COLUMN apertura_cobertura numeric
    CONSTRAINT equipos_radioenlace_apertura_cobertura_valida CHECK (apertura_cobertura IS NULL OR (apertura_cobertura > 0 AND apertura_cobertura <= 360)),
  ADD CONSTRAINT equipos_radioenlace_sector_con_radio CHECK (radio_cobertura_m IS NOT NULL OR (azimut_cobertura IS NULL AND apertura_cobertura IS NULL)),
  ADD CONSTRAINT equipos_radioenlace_sector_con_direccion CHECK (apertura_cobertura IS NULL OR apertura_cobertura = 360 OR azimut_cobertura IS NOT NULL);
COMMENT ON COLUMN public.equipos_radioenlace.radio_cobertura_m IS 'Radio de cobertura en metros (de más de 0 a 20 000). La app lo pide para los AP y lo dibuja alrededor del equipo (migración 013).';
COMMENT ON COLUMN public.equipos_radioenlace.azimut_cobertura IS 'Dirección del sector de cobertura, en grados desde el norte (0 a menos de 360). Solo con radio_cobertura_m (migración 013).';
COMMENT ON COLUMN public.equipos_radioenlace.apertura_cobertura IS 'Apertura del sector de cobertura en grados (más de 0 a 360). NULL o 360 = círculo; menor que 360 necesita azimut_cobertura (migración 013).';

COMMIT;
