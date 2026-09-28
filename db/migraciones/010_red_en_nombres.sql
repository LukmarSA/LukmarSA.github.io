-- =====================================================================
-- 010 — La red en el nombre automático de los equipos de red
-- =====================================================================
--
-- Qué cambia
--   El nombre automático de la 008 ahora lleva la red del equipo entre
--   paréntesis, junto a la referencia:
--     «Punto a Punto (Red Oficina · Apuntando al Intensivo) en Torre principal»
--     «Estación (Red Oficina) en Intensivo enlazada a Punto a Punto
--      (Apuntando al Intensivo) en Torre principal»
--   En el nombre del servidor, su red va solo si es distinta de la del
--   equipo: «Switch (Red Cámaras) en Torre K conectado a Router (Red Oficina)».
--   Los nombres guardados se ponen al día solos también cuando cambia la red
--   de un equipo, cuando se renombra una red o cuando se borra una.
--   version_nombres_equipos() devuelve 2: así la app sabe que la base ya arma
--   los nombres con la red. Sin la 010 los arma sin ella, como antes, y la
--   app hace lo mismo.
--
-- Reglas del nombre (las mismas de la app, nucleo/mapa-nombres.js):
--   «{tipo}{ (red · referencia)} en {ubicación}»
--   + « enlazado/a a {servidor}»    si el medio es inalámbrico
--   + « conectado/a a {servidor}»   si es cable o fibra
--   + « en {ubicación del servidor}» si el servidor está en otra ubicación
--   {servidor} = «{tipo}{ (red si es distinta · referencia)}» del servidor, o
--   su nombre guardado si no tiene tipo.
--   Paréntesis: « (Red · Referencia)», « (Red)», « (Referencia)» o nada.
--   Lo demás (género, numeración «(2)», equipos sin tipo) sigue igual.
--
-- Necesita la 008. Cómo correrla: pegar TODO el archivo en el SQL Editor de
-- Supabase y ejecutar. Va en una sola transacción: si algo falla, no queda
-- nada a medias.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.recalcular_nombres_equipos()') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 008 (public.recalcular_nombres_equipos no existe).';
  END IF;
  IF to_regprocedure('public.version_nombres_equipos()') IS NOT NULL THEN
    RAISE EXCEPTION 'La migración 010 ya fue aplicada (public.version_nombres_equipos existe).';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Paréntesis del nombre: « (Red Oficina · Norte)», « (Red Oficina)»,
--    « (Norte)» o nada (sin espacios en los bordes de cada parte).
-- ---------------------------------------------------------------------

CREATE FUNCTION public.f_nombre_parentesis(p_red text, p_ref text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE WHEN x = '' THEN '' ELSE ' (' || x || ')' END
    FROM (SELECT concat_ws(' · ',
                   nullif(regexp_replace(coalesce(p_red, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''),
                   nullif(regexp_replace(coalesce(p_ref, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g'), '')) AS x) r
$$;

-- ---------------------------------------------------------------------
-- 2. Nombre armado de un equipo, sin numerar (reemplaza al de la 008).
--    NULL si no tiene tipo. La red del servidor entra solo si es distinta
--    de la del equipo (también si el equipo no tiene red).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.f_nombre_base_equipo(p_id bigint)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT t.etiqueta || public.f_nombre_parentesis(r.nombre, e.referencia) || ' en ' || coalesce(u.nombre, '?')
         || CASE WHEN s.id IS NULL THEN '' ELSE
              ' ' || CASE WHEN coalesce(e.medio, CASE WHEN s.ubicacion_id = e.ubicacion_id THEN 'cable' ELSE 'inalambrico' END) = 'inalambrico'
                          THEN 'enlazad' ELSE 'conectad' END
                  || CASE WHEN t.genero = 'f' THEN 'a' ELSE 'o' END
                  || ' a ' || coalesce(ts.etiqueta || public.f_nombre_parentesis(CASE WHEN rs.id IS DISTINCT FROM r.id THEN rs.nombre END, s.referencia), s.nombre)
                  || CASE WHEN s.ubicacion_id = e.ubicacion_id THEN '' ELSE ' en ' || coalesce(us.nombre, '?') END
            END
    FROM public.equipos_radioenlace e
    JOIN public.tipos_equipo_red t ON t.valor = e.tipo_equipo
    LEFT JOIN public.redes r ON r.id = e.red_id
    LEFT JOIN public.ubicaciones u ON u.id = e.ubicacion_id
    LEFT JOIN public.equipos_radioenlace s ON s.id = e.servidor_id
    LEFT JOIN public.tipos_equipo_red ts ON ts.valor = s.tipo_equipo
    LEFT JOIN public.redes rs ON rs.id = s.red_id
    LEFT JOIN public.ubicaciones us ON us.id = s.ubicacion_id
   WHERE e.id = p_id
$$;

-- ---------------------------------------------------------------------
-- 3. Cuándo se recalculan: además de lo de la 008, al cambiar la red de un
--    equipo, al renombrar una red y al borrarla. (Al borrar una red, la FK
--    deja red_id en NULL desde un trigger interno, un nivel más adentro, y
--    ahí el recálculo no corre: por eso se engancha también al DELETE de la
--    red, que termina después.)
-- ---------------------------------------------------------------------

DROP TRIGGER trg_equipos_radioenlace_nombres_al_dia ON public.equipos_radioenlace;
CREATE TRIGGER trg_equipos_radioenlace_nombres_al_dia
  AFTER INSERT OR DELETE OR UPDATE OF nombre, tipo_equipo, referencia, servidor_id, ubicacion_id, medio, red_id ON public.equipos_radioenlace
  FOR EACH STATEMENT EXECUTE FUNCTION public.f_nombres_equipos_al_dia();
CREATE TRIGGER trg_redes_nombres_equipos_al_dia
  AFTER UPDATE OF nombre OR DELETE ON public.redes
  FOR EACH STATEMENT EXECUTE FUNCTION public.f_nombres_equipos_al_dia();

-- ---------------------------------------------------------------------
-- 4. Versión de las reglas del nombre, para la app (1 = 008, 2 = con la red).
-- ---------------------------------------------------------------------

CREATE FUNCTION public.version_nombres_equipos()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT 2 $$;
COMMENT ON FUNCTION public.version_nombres_equipos() IS 'Versión de las reglas del nombre automático de los equipos de red: 2 = con la red entre paréntesis (migración 010). La app la consulta para armar los nombres igual que la base.';
REVOKE ALL ON FUNCTION public.version_nombres_equipos() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.version_nombres_equipos() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Poner al día los nombres que ya están guardados
-- ---------------------------------------------------------------------

SELECT public.recalcular_nombres_equipos() AS nombres_actualizados;

COMMIT;
