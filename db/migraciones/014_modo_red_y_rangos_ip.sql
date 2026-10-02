-- =====================================================================
-- 014 — Modo de red de los equipos, rangos IP de las redes y tipos
--       configurables (v17)
-- =====================================================================
--
-- Lo decidió la persona el 2-oct: el tipo dice qué es el equipo (AP, PtP,
-- Estación, Switch…) y el modo, cómo trabaja en la red: router (capa 3) o
-- bridge (capa 2). Un AP que enruta es tipo AP en modo router.
--
-- Qué cambia
--   * tipos_equipo_red.modo_red (text): el modo de fábrica del tipo:
--     'router', 'bridge', 'elegir' (se elige en cada equipo) o 'no_aplica'
--     (cámaras, NVR, inyectores). Se pone por el valor de cada tipo: Router →
--     router; Switch → bridge; Cámara, NVR e Inyector POE → no aplica; el
--     resto, a elegir. Los tipos nuevos nacen «a elegir».
--   * tipos_equipo_red.hace_radio y lleva_cobertura (boolean): si el tipo
--     hace radioenlaces y si pide la cobertura. Quedan como hasta ahora (lo
--     decidía la app): PtP, AP y Estación hacen radio; solo el AP lleva
--     cobertura. Los tipos nuevos nacen sin ninguna de las dos.
--   * equipos_radioenlace.modo_red (text, nulo): el modo propio del equipo,
--     'router' o 'bridge'. NULL = el de su tipo.
--   * Solo los routers definen red: un equipo cuyo modo (el propio o el de su
--     tipo) es bridge o no aplica no puede tener red propia (red_id): va en
--     la de su servidor. Los «a elegir» pueden tenerla, como hasta ahora. La
--     base lo revisa al guardar un equipo y al cambiar el modo de un tipo
--     (trigger, error 23514).
--   * redes.rangos_ip (cidr[]): los rangos IP de la red, de 0 a 20 (vacío por
--     ahora). La base revisa que estén bien escritos (cidr: la dirección de
--     la red, sin bits de host). Que dos redes se crucen no lo impide: la app
--     avisa (detrás de un NAT es normal repetir 192.168.88.0/24).
--
-- Escribe solo los valores de fábrica de las columnas nuevas de los tipos
-- (las tres, en los tipos que ya existen). No toca los equipos ni las redes, y
-- no cambia ningún nombre. Las reglas de acceso (RLS), los GRANT y la
-- auditoría siguen como estaban.
--
-- Se niega si falta la 013, si ya fue aplicada o si algún equipo de un tipo
-- que queda en bridge o «no aplica» tiene red propia (lo lista, para revisarlo
-- antes). Sin esta migración la app (v17) funciona como la v16.
--
-- Cómo correrla: pegar TODO el archivo en el SQL Editor de Supabase y
-- ejecutar. Va en una sola transacción: si algo falla, no queda nada a medias.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_lista text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'equipos_radioenlace' AND column_name = 'radio_cobertura_m') THEN
    RAISE EXCEPTION 'Falta la migración 013 (equipos_radioenlace.radio_cobertura_m no existe).';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'equipos_radioenlace' AND column_name = 'modo_red') THEN
    RAISE EXCEPTION 'La migración 014 ya fue aplicada (equipos_radioenlace.modo_red existe).';
  END IF;
  -- Con los modos de fábrica, un switch, una cámara, un NVR o un inyector no
  -- definen red: si alguno tiene red propia, mejor revisarlo antes.
  SELECT string_agg(format('%s (id %s)', e.nombre, e.id), ', ' ORDER BY e.id) INTO v_lista
    FROM public.equipos_radioenlace e
   WHERE e.red_id IS NOT NULL AND e.tipo_equipo IN ('switch', 'camara', 'nvr', 'inyector_poe');
  IF v_lista IS NOT NULL THEN
    RAISE EXCEPTION 'Estos equipos tienen red propia y su tipo queda en bridge o «no aplica» (no definen red): %. Quítales la red propia (heredan la de su servidor) o avisa a quien mantiene la app antes de aplicar la 014.', v_lista;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Los tipos: modo de fábrica, si hacen radio y si llevan cobertura
-- ---------------------------------------------------------------------
ALTER TABLE public.tipos_equipo_red
  ADD COLUMN modo_red text NOT NULL DEFAULT 'elegir'
    CONSTRAINT tipos_equipo_red_modo_valido CHECK (modo_red IN ('router', 'bridge', 'elegir', 'no_aplica')),
  ADD COLUMN hace_radio boolean NOT NULL DEFAULT false,
  ADD COLUMN lleva_cobertura boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.tipos_equipo_red.modo_red IS 'Modo de red de fábrica del tipo: router (capa 3), bridge (capa 2), elegir (en cada equipo) o no_aplica. Un equipo sin modo propio sigue el de su tipo (migración 014).';
COMMENT ON COLUMN public.tipos_equipo_red.hace_radio IS 'El tipo hace radioenlaces: su rol (backbone, distribución) tiene sentido y, si no, el enlace con otra ubicación va por cable (migración 014).';
COMMENT ON COLUMN public.tipos_equipo_red.lleva_cobertura IS 'El tipo pide la cobertura (radio, dirección y apertura) en el formulario del equipo (migración 014).';

UPDATE public.tipos_equipo_red
   SET modo_red = CASE valor WHEN 'router' THEN 'router' WHEN 'switch' THEN 'bridge'
                             WHEN 'camara' THEN 'no_aplica' WHEN 'nvr' THEN 'no_aplica' WHEN 'inyector_poe' THEN 'no_aplica'
                             ELSE 'elegir' END,
       hace_radio = valor IN ('ptp', 'ap', 'estacion'),
       lleva_cobertura = valor = 'ap';

-- ---------------------------------------------------------------------
-- 2. El modo propio de cada equipo (NULL = el de su tipo)
-- ---------------------------------------------------------------------
ALTER TABLE public.equipos_radioenlace
  ADD COLUMN modo_red text
    CONSTRAINT equipos_radioenlace_modo_valido CHECK (modo_red IS NULL OR modo_red IN ('router', 'bridge'));
COMMENT ON COLUMN public.equipos_radioenlace.modo_red IS 'Modo de red propio del equipo: router (capa 3) o bridge (capa 2). NULL = el de su tipo. Solo los routers (y los de tipo «a elegir» sin modo) tienen red propia (migración 014).';

-- ---------------------------------------------------------------------
-- 3. Solo los routers definen red
-- ---------------------------------------------------------------------
-- El modo con el que trabaja un equipo: el propio o el de su tipo ('elegir'
-- si no tiene tipo).
CREATE FUNCTION public.f_modo_red_efectivo(p_modo text, p_tipo text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT coalesce(p_modo, (SELECT t.modo_red FROM public.tipos_equipo_red t WHERE t.valor = p_tipo), 'elegir')
$$;
COMMENT ON FUNCTION public.f_modo_red_efectivo(text, text) IS 'Modo de red con el que trabaja un equipo: el propio o el de su tipo (migración 014).';

CREATE FUNCTION public.f_equipos_red_solo_routers()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.red_id IS NOT NULL AND public.f_modo_red_efectivo(NEW.modo_red, NEW.tipo_equipo) IN ('bridge', 'no_aplica') THEN
    RAISE EXCEPTION 'equipos_radioenlace_red_solo_routers: «%» no define red (trabaja como bridge o su tipo no tiene modo de red): va en la red de su servidor. Para darle otra red, ponlo en modo router.', NEW.nombre
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_equipos_radioenlace_red_solo_routers
  BEFORE INSERT OR UPDATE OF red_id, modo_red, tipo_equipo ON public.equipos_radioenlace
  FOR EACH ROW EXECUTE FUNCTION public.f_equipos_red_solo_routers();

-- Pasar un tipo a bridge o «no aplica» no puede dejar equipos suyos (sin modo
-- propio) con red propia.
CREATE FUNCTION public.f_tipos_equipo_red_modo_con_redes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_n integer;
BEGIN
  IF NEW.modo_red IN ('bridge', 'no_aplica') AND NEW.modo_red IS DISTINCT FROM OLD.modo_red THEN
    SELECT count(*) INTO v_n FROM public.equipos_radioenlace e
     WHERE e.tipo_equipo = NEW.valor AND e.modo_red IS NULL AND e.red_id IS NOT NULL;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'tipos_equipo_red_modo_con_redes: % equipo(s) de tipo «%» tienen red propia: ponlos en modo router o quítales la red antes de pasar el tipo a %.', v_n, NEW.etiqueta, NEW.modo_red
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_tipos_equipo_red_modo_con_redes
  BEFORE UPDATE OF modo_red ON public.tipos_equipo_red
  FOR EACH ROW EXECUTE FUNCTION public.f_tipos_equipo_red_modo_con_redes();

-- ---------------------------------------------------------------------
-- 4. Los rangos IP de cada red
-- ---------------------------------------------------------------------
ALTER TABLE public.redes
  ADD COLUMN rangos_ip cidr[] NOT NULL DEFAULT '{}'
    CONSTRAINT redes_rangos_ip_validos CHECK (cardinality(rangos_ip) <= 20 AND array_position(rangos_ip, NULL) IS NULL);
COMMENT ON COLUMN public.redes.rangos_ip IS 'Rangos IP de la red (CIDR, de 0 a 20). Los routers que la definen reparten esos rangos a lo que cuelga de ellos (migración 014).';

COMMIT;
