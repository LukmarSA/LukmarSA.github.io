# Pruebas del mapa (migraciones 002 a 005)

Tres capas. Las dos primeras corren en local; la tercera corre en Supabase real
y siempre termina sin dejar datos de prueba.

## Orden de las migraciones

| Archivo | Cuándo |
|---|---|
| `db/migraciones/002_mapa_ubicaciones_radioenlaces.sql` | Ya aplicada (parte 1). |
| `db/migraciones/003_jerarquia_radioenlaces.sql` | Antes de desplegar la app nueva. Es aditiva: la versión publicada sigue funcionando. |
| `db/migraciones/004_permisos_y_fechas.sql` | Antes de desplegar. La red (equipos) solo se lee con «Ver mapa» y el detalle del activo usa `equipo_radio_de_activo()`; el registrador puede cambiar y liberar custodios; la fecha por defecto es la de Ecuador. |
| `db/migraciones/005_quitar_tabla_enlaces.sql` | Después de desplegar. Borra la tabla `enlaces` de la 002 (solo si está vacía). |

## 1. Lógica pura (Node, sin navegador)

```
cd tests && npm install && npm run test:mapa
```

`tests/mapa-unit.mjs` cubre distancia/azimut, el parseo de coordenadas, los índices y el buscador del mapa, las validaciones, la traducción de errores de Supabase y la jerarquía: roles, backbone/P2MP, agrupación, camino a la raíz, simulación de fallas con conmutación por prioridad y plan de líneas.

## 2. Navegador real con Supabase simulado

```
cd tests && npx playwright install chromium   # la primera vez
npm run smoke:mapa
```

`tests/mapa-smoke.mjs` sirve la app en local, reemplaza Supabase por `tests/stubs/supabase-stub.js` y hace clic de verdad:

- **Red:** líneas backbone y P2MP, AP agrupado y expandido, toggles de líneas, roles y estados.
- **Camino a la raíz:** resaltado de la cadena y atenuado del resto.
- **Simulación:** caída con respaldo (conmuta), sin respaldo (subárbol sin conectividad), restablecer y salir.
- **Formularios de administrador:** equipo con servidor y respaldos.
- **Permisos por rol** y **casos de falla** (faltan tablas, unpkg caído, vista de celular).

Las capturas quedan en `tests/capturas/`.

## 3. Base real (SQL Editor de Supabase)

| Paso | Archivo | Qué hace |
|---|---|---|
| a | `mapa_pruebas_restaurar_secuencias.sql` | Correr ANTES de (b): genera los `setval` para dejar las secuencias como estaban, porque `nextval` no se revierte con ROLLBACK. Guardar el resultado. |
| b | `mapa_pruebas_reglas_rls.sql` | 68 pruebas de restricciones, triggers (ciclos, respaldo promovido), RLS (admin / visitante / registrador / anon), `equipo_radio_de_activo`, cambio de custodio del registrador, fechas de Ecuador, GRANT y auditoría, simulando usuarios con `request.jwt.claims`. Necesita la 004. Termina en `RAISE EXCEPTION`, así que **todo se revierte** y el mensaje de error es el reporte en JSON. |
| c | (resultado de a) | Pegar y correr los `setval` generados en (a). |
| d | `mapa_datos_prueba.sql` | Crea una red `[PRUEBA]`: 17 ubicaciones, 25 equipos (2 raíces, backbone, un AP con 9 clientes) y 3 respaldos. |
| e | (navegador) | Pestaña Mapa: clic en «CPE Piscina 1» → se resalta su camino hasta la raíz. Activar «Simulación de fallas» y simular la caída de «CPE Piscina 1» (recupera vía AP Santa Ana), de «Router Cerro Azul» (conmuta por cable al PTP de la Torre Norte), de «PTP Santa Ana ← Cerro Azul» (su subárbol queda sin conectividad) y del «AP Cerro Azul» junto con el anterior (Piscina 1 pasa a su respaldo de prioridad 2). Probar los toggles y «Restablecer simulación». |
| f | `mapa_limpieza_prueba.sql` | Borra todo lo `[PRUEBA]`. Se niega a correr si algún equipo real tiene como servidor a uno de prueba. |

Las pruebas dejan filas en `auditoria`: `registrar_auditoria` también registra los inserts y borrados de prueba. Es el comportamiento esperado de la bitácora.
