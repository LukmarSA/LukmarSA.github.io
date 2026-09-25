-- =====================================================================
-- 005 — Quitar la tabla "enlaces" de la 002 (la reemplaza la jerarquía de la 003)
-- =====================================================================
--
-- Correrla DESPUÉS de desplegar la versión de la app que usa servidor_id y
-- enlaces_respaldo (y de la 004): la versión anterior lee "enlaces" y su
-- pestaña Mapa dejaría de cargar.
--
-- Solo borra si la tabla está vacía. Si tiene filas se detiene sin tocar
-- nada: en un enlace no se sabe cuál extremo es el servidor, así que hay que
-- pasarlas a mano a servidor_id (y la banda/frecuencia al equipo).
--
-- También quita la regla de la 002 "un equipo no puede mudarse a la ubicación
-- del otro extremo de su enlace", que lee esa tabla. Con la jerarquía, un
-- servidor en la misma ubicación es válido (conexión por cable).
--
-- Cómo correrla: pegar TODO el archivo en el SQL Editor y ejecutar.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_n bigint;
BEGIN
  IF to_regclass('public.enlaces_respaldo') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 003 (public.enlaces_respaldo no existe).';
  END IF;
  IF to_regprocedure('public.equipo_radio_de_activo(integer)') IS NULL THEN
    RAISE EXCEPTION 'Falta la migración 004 (public.equipo_radio_de_activo no existe).';
  END IF;
  IF to_regclass('public.enlaces') IS NULL THEN
    RAISE EXCEPTION 'La migración 005 ya fue aplicada (public.enlaces no existe).';
  END IF;
  SELECT count(*) INTO v_n FROM public.enlaces;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'La tabla enlaces tiene % fila(s): pásalas a servidor_id (y banda/frecuencia al equipo) antes de quitarla.', v_n;
  END IF;
END $$;

DROP TRIGGER trg_equipos_radioenlace_validar ON public.equipos_radioenlace;
DROP FUNCTION public.f_equipos_radioenlace_validar();

-- Con la tabla se van sus triggers (trg_enlaces_validar, audit_enlaces) y sus políticas.
DROP TABLE public.enlaces;
DROP FUNCTION public.f_enlaces_validar();

COMMIT;
