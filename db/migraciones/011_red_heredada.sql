-- =====================================================================
-- 011 — La red se hereda del servidor
-- =====================================================================
--
-- Qué cambia
--   equipos_radioenlace.red_id pasa a ser la red PROPIA del equipo. Un
--   equipo sin red propia hereda la de su servidor (el principal), y así
--   hacia arriba hasta la raíz: basta con ponerle la red a la raíz o a un
--   equipo intermedio para que la tengan todos los que cuelgan de él.
--   Un equipo que recibe otra red propia forma, con todos sus clientes,
--   una red aparte (sale con el color de esa red al colorear por red).
--
--   Una red propia igual a la que el equipo ya hereda no aporta nada: la
--   base la deja vacía (el equipo sigue en esa red, heredándola). Así,
--   si después cambia la red de la raíz, lo que cuelga de ella la sigue.
--   Esto se hace solo, después de cada cambio de equipos o de redes, y una
--   vez al aplicar esta migración.
--
--   El nombre automático usa la red efectiva (la propia o la heredada):
--     «Estación (CCTV) en Intensivo enlazada a Punto a Punto (Apuntando al
--      Intensivo) en Torre principal»
--   y la del servidor sigue yendo solo si es distinta:
--     «Switch (CCTV) en Torre K conectado a Router (Red Oficina) en Data Center».
--
--   version_nombres_equipos() devuelve 3: así la app sabe que la red se
--   hereda y arma los nombres, los colores y los filtros igual que la base.
--   Sin la 011 la app sigue como con la 010 (cada equipo, su red).
--
-- Necesita la 010. Cómo correrla: pegar TODO el archivo en el SQL Editor de
-- Supabase y ejecutar. Va en una sola transacción: si algo falla, no queda
-- nada a medias.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.version_nombres_equipos()') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 010 (public.version_nombres_equipos no existe).';
  END IF;
  IF to_regprocedure('public.f_red_efectiva(bigint)') IS NOT NULL THEN
    RAISE EXCEPTION 'La migración 011 ya fue aplicada (public.f_red_efectiva existe).';
  END IF;
END $$;

COMMENT ON COLUMN public.equipos_radioenlace.red_id IS 'Red propia del equipo. NULL = hereda la de su servidor principal (y así hacia arriba). Una red propia igual a la heredada se deja en NULL (migración 011).';

-- ---------------------------------------------------------------------
-- 1. Red efectiva de un equipo: la propia o, si no tiene, la de su
--    servidor, subiendo hasta la raíz. NULL si nadie en el camino tiene red.
--    (Los ciclos de servidores no existen: la 003 los rechaza. El tope de
--    niveles es solo una guarda.)
-- ---------------------------------------------------------------------

CREATE FUNCTION public.f_red_efectiva(p_id bigint)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH RECURSIVE sube (id, servidor_id, red_id, nivel) AS (
    SELECT e.id, e.servidor_id, e.red_id, 1
      FROM public.equipos_radioenlace e
     WHERE e.id = p_id
    UNION ALL
    SELECT s.id, s.servidor_id, s.red_id, u.nivel + 1
      FROM sube u
      JOIN public.equipos_radioenlace s ON s.id = u.servidor_id
     WHERE u.red_id IS NULL AND u.nivel < 500
  )
  SELECT red_id FROM sube WHERE red_id IS NOT NULL ORDER BY nivel LIMIT 1
$$;
COMMENT ON FUNCTION public.f_red_efectiva(bigint) IS 'Red efectiva de un equipo de red: la propia o la heredada de su servidor principal, subiendo hasta la raíz (migración 011).';

-- ---------------------------------------------------------------------
-- 2. Deja vacía la red propia que es igual a la heredada. Devuelve cuántos
--    equipos cambiaron. La red efectiva de nadie cambia (el equipo sigue en
--    la misma red, ahora heredada), así que tampoco cambia ningún nombre.
--    Es mantenimiento de la base (SECURITY DEFINER), como el recálculo de
--    los nombres: corre igual para quien haya hecho el cambio que lo disparó.
-- ---------------------------------------------------------------------

CREATE FUNCTION public.normalizar_redes_equipos()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.equipos_radioenlace e
     SET red_id = NULL
   WHERE e.red_id IS NOT NULL
     AND e.servidor_id IS NOT NULL
     AND e.red_id = public.f_red_efectiva(e.servidor_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.normalizar_redes_equipos() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Nombre armado de un equipo, sin numerar (reemplaza al de la 010):
--    igual que antes, pero con la red efectiva del equipo y del servidor.
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
    LEFT JOIN public.redes r ON r.id = public.f_red_efectiva(e.id)
    LEFT JOIN public.ubicaciones u ON u.id = e.ubicacion_id
    LEFT JOIN public.equipos_radioenlace s ON s.id = e.servidor_id
    LEFT JOIN public.tipos_equipo_red ts ON ts.valor = s.tipo_equipo
    LEFT JOIN public.redes rs ON rs.id = public.f_red_efectiva(s.id)
    LEFT JOIN public.ubicaciones us ON us.id = s.ubicacion_id
   WHERE e.id = p_id
$$;

-- ---------------------------------------------------------------------
-- 4. Después de cada cambio (los mismos triggers de la 008 y la 010):
--    primero se deja vacía la red propia repetida y después se ponen al
--    día los nombres. El UPDATE de la normalización queda un nivel más
--    adentro y no vuelve a disparar esto (la guarda de la 008).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.f_nombres_equipos_al_dia()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  PERFORM public.normalizar_redes_equipos();
  PERFORM public.recalcular_nombres_equipos();
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.f_nombres_equipos_al_dia() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Versión de las reglas del nombre, para la app (3 = la red se hereda).
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.version_nombres_equipos()
RETURNS integer
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$ SELECT 3 $$;
COMMENT ON FUNCTION public.version_nombres_equipos() IS 'Versión de las reglas del nombre automático de los equipos de red: 2 = con la red entre paréntesis (010); 3 = la red se hereda del servidor (011). La app la consulta para armar los nombres igual que la base.';

-- ---------------------------------------------------------------------
-- 6. Poner al día lo que ya está guardado: los nombres (ahora con la red
--    heredada) y las redes propias que repiten la heredada.
-- ---------------------------------------------------------------------

SELECT public.recalcular_nombres_equipos() AS nombres_actualizados;
SELECT public.normalizar_redes_equipos() AS redes_que_ahora_se_heredan;

COMMIT;
