-- =====================================================================
-- Acompaña a 002_pruebas_reglas_rls.sql (y a cualquier prueba que haga
-- ROLLBACK después de insertar): nextval() no se revierte, así que las
-- secuencias quedan adelantadas y el próximo activo real saltaría de tag.
--
-- 1) ANTES de las pruebas, anota los valores:
--      select 'activos', last_value from public.activos_id_seq
--      union all select 'bajas', last_value from public.bajas_id_seq
--      union all select 'auditoria', last_value from public.auditoria_id_seq
--      union all select 'historial_custodia', last_value from public.historial_custodia_id_seq;
-- 2) DESPUÉS, reemplaza los números de abajo por esos valores y corre esto.
--    greatest(...) protege si alguien creó un registro real mientras tanto.
--
-- Valores de la corrida del 24/09/2026: 133 / 17 / 690 / 190.
-- =====================================================================
select
  setval('public.activos_id_seq',            greatest(133, (select coalesce(max(id), 0) from public.activos)),            true) as activos,
  setval('public.bajas_id_seq',              greatest(17,  (select coalesce(max(id), 0) from public.bajas)),              true) as bajas,
  setval('public.auditoria_id_seq',          greatest(690, (select coalesce(max(id), 0) from public.auditoria)),          true) as auditoria,
  setval('public.historial_custodia_id_seq', greatest(190, (select coalesce(max(id), 0) from public.historial_custodia)), true) as historial_custodia;
