# Pruebas del mapa (migración 002)

Tres capas. Las dos primeras corren en local; la tercera corre en Supabase real
y siempre termina sin dejar datos de prueba.

## 1. Lógica pura (Node, sin navegador)

```
cd tests && npm install && npm run test:mapa
```

`tests/mapa-unit.mjs` cubre distancia/azimut, el parseo de coordenadas (Google Maps, enlaces, grados/minutos/segundos), los índices del mapa, el buscador, las validaciones y la traducción de errores de Supabase.

## 2. Navegador real con Supabase simulado

```
cd tests && npx playwright install chromium   # la primera vez
npm run smoke:mapa
```

`tests/mapa-smoke.mjs` sirve la app en local, reemplaza Supabase por `tests/stubs/supabase-stub.js` y hace clic de verdad:

- **Flujo principal:** torre → equipos → línea de vista → otro extremo.
- **Topologías:** punto a punto y punto-multipunto.
- **Formularios de administrador**, incluido «Elegir en el mapa».
- **Permisos por rol:** registrador sin `ver_mapa`, con `ver_mapa` y con `asignar_ubicacion`.
- **Casos de falla:** faltan las tablas, unpkg caído, vista de celular.

Las capturas quedan en `tests/capturas/`. Leaflet se sirve desde el paquete npm `leaflet@1.9.4`, que tiene los mismos bytes que unpkg, así que la prueba también valida los hashes SRI.

## 3. Base real (SQL Editor de Supabase)

| Paso | Archivo | Qué hace |
|---|---|---|
| a | `002_pruebas_reglas_rls.sql` | 40 pruebas de restricciones, triggers, RLS (admin / visitante / anon), GRANT, auditoría y baja/restauración, simulando usuarios con `request.jwt.claims`. Termina en `RAISE EXCEPTION`, así que **todo se revierte** y el mensaje de error es el reporte en JSON. |
| b | `002_pruebas_restaurar_secuencias.sql` | Devuelve las secuencias a su valor previo, porque `nextval` no se revierte con ROLLBACK. Antes de (a) hay que anotar los valores. |
| c | `002_mapa_datos_prueba.sql` | Crea datos `[PRUEBA]` para verificar el flujo en el navegador: 3 ubicaciones, 4 equipos, 2 enlaces y 2 activos reales vinculados por referencia. |
| d | (navegador) | Pestaña Mapa → clic en «[PRUEBA] Torre Cerro Azul» → clic en «[PRUEBA] PTP CA-SA» → se dibuja la línea hacia Santa Ana con distancia y azimut → clic en Santa Ana → pasa a su equipo con la línea dibujada. Abrir el detalle del activo vinculado → bloque «Ubicación» → «Ver en mapa». |
| e | `002_mapa_limpieza_prueba.sql` | Borra todo lo `[PRUEBA]` (lo del paso c y lo que se haya creado así desde la interfaz). Si la prueba cerró un tramo real de un activo, lo reabre. Si las tablas quedan vacías, reinicia los contadores con el `TRUNCATE … RESTART IDENTITY` que trae el archivo. |

Las pruebas dejan filas en `auditoria`: `registrar_auditoria` también registra los inserts y borrados de prueba. Es el comportamiento esperado de la bitácora.
