-- Task #23 — Permite desactivar (en vez de borrar) un tipo de activo, una
-- opción de propiedad o una opción de estado, sin romper los activos que ya
-- la tengan asignada (ver opcionesVigentes() en
-- assets/js/inventario-tecnologico/nucleo/opciones-configurables.js: un
-- activo que ya tiene un valor inactivo asignado sigue mostrándolo con la
-- etiqueta "(inactivo)"; ese valor solo deja de ofrecerse para activos
-- NUEVOS o al reasignar).
--
-- propiedad_opciones y estado_opciones ya podrían tener esta columna (el
-- código de la app ya la lee desde hace tiempo), pero tipos_activo todavía
-- no. Se usa "ADD COLUMN IF NOT EXISTS" en las 3 tablas para que esta
-- migración se pueda ejecutar una sola vez, sin riesgo, sin importar cuál
-- de las 3 ya la tenía.
--
-- Cómo aplicar: pegar y ejecutar este archivo completo en el SQL Editor de
-- Supabase (proyecto de Lukmar). No borra ni modifica ninguna fila
-- existente — activo queda en TRUE (activo) para todo lo que ya existe.

ALTER TABLE public.tipos_activo
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

ALTER TABLE public.propiedad_opciones
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;

ALTER TABLE public.estado_opciones
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
