# Pruebas del mapa (migraciones 002 a 007)

Tres capas. Las dos primeras corren en local; la tercera corre en Supabase real
y siempre termina sin dejar datos de prueba.

## Orden de las migraciones

| Archivo | Cuándo |
|---|---|
| `db/migraciones/002_mapa_ubicaciones_radioenlaces.sql` | Ya aplicada (parte 1). |
| `db/migraciones/003_jerarquia_radioenlaces.sql` | Antes de desplegar la app nueva. Es aditiva: la versión publicada sigue funcionando. |
| `db/migraciones/004_permisos_y_fechas.sql` | Antes de desplegar. La red (equipos) solo se lee con «Ver mapa» y el detalle del activo usa `equipo_radio_de_activo()`; el registrador puede cambiar y liberar custodios; la fecha por defecto es la de Ecuador. |
| `db/migraciones/005_quitar_tabla_enlaces.sql` | Después de desplegar. Borra la tabla `enlaces` de la 002 (solo si está vacía). |
| `db/migraciones/006_plano_mapa.sql` | Cuando se quiera guardar el ajuste del plano. Crea `planos_mapa` (el plano de la capa «Plano» y sus tres esquinas sobre el mapa). Es aditiva y la app funciona sin ella: sin la 006 la capa usa el calce que trae la app y solo no se puede guardar un ajuste. |
| `db/migraciones/007_red_tipos_atajos.sql` | Cuando se quiera la red de la finca. Crea `tipos_equipo_red` (8 tipos de semilla), `redes` y `atajos_simulacion`, y agrega `tipo_equipo`, `red_id` y `referencia` a `equipos_radioenlace`. Es aditiva y la app funciona sin ella: el nombre del equipo se sigue escribiendo a mano y no aparecen tipo, red, cableado por tipo ni atajos. |

## 1. Lógica pura (Node, sin navegador)

```
cd tests && npm install && npm run test:mapa
```

`tests/mapa-unit.mjs` cubre distancia/azimut, el parseo de coordenadas, los índices y el buscador del mapa, las validaciones, la traducción de errores de Supabase, la jerarquía (roles, backbone/P2MP, agrupación, camino a la raíz, simulación de fallas con conmutación por prioridad y plan de líneas) la capa Plano (esquinas, mover, agrandar sin deformar, girar, matriz CSS y el calce con la carretera) y la red de la finca de la 007 (nombre automático con género, cable o radio, referencia y numeración; caídos efectivos de los atajos; validaciones de atajo, red y tipo). `tests/activo-unit.mjs` cubre el formulario «Nuevo activo» (campos según el tipo, qué se guarda, búsqueda y orden de tipos).

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
- **Capa Plano:** la imagen en su lugar, «Ver plano», opacidad, y «Ajustar plano» (arrastrar, esquinas, flechas, giro, calce original, cancelar, guardar), sin la 006 y sin ser administrador.
- **Detalle de la torre:** casilla por equipo para simular la caída (también con teclado), conectores del camino con onda o enchufe y su badge, y el detalle que se despliega como acordeón.
- **Red de la finca (007):** nombres automáticos, red de cada equipo, cableado de la torre, atajos (encender, bloqueo de la casilla, guardar las caídas, editar, eliminar), formulario de equipo sin nombre a mano, «Redes y tipos», y un usuario con «Ver mapa» que no es administrador. Sin la 007 (el fixture por defecto) todo sigue como antes.
- **Inventario, «Nuevo activo»:** selector de Tipo con búsqueda y orden, campos según el tipo con transición, «+» en un submodal, lo que se guarda al crear y al editar.

`SOLO=plano node mapa-smoke.mjs` corre un solo escenario (admin, permisos, fallas, celular, plano, torre, red o activo). Si Playwright no encuentra su navegador, usar `CHROMIUM_PATH=/ruta/al/chrome`.

Las capturas quedan en `tests/capturas/`.

## 3. Base real (SQL Editor de Supabase)

| Paso | Archivo | Qué hace |
|---|---|---|
| a | `mapa_pruebas_restaurar_secuencias.sql` | Correr ANTES de (b): genera los `setval` para dejar las secuencias como estaban, porque `nextval` no se revierte con ROLLBACK. Guardar el resultado. |
| b | `mapa_pruebas_reglas_rls.sql` | 102 pruebas de restricciones, triggers (ciclos, respaldo promovido), RLS (admin / visitante / registrador / anon), `equipo_radio_de_activo`, cambio de custodio del registrador, fechas de Ecuador, la tabla del plano (sección P), la red de la finca (sección R: tipos, redes, atajos, limpieza al borrar un equipo o una red), GRANT y auditoría, simulando usuarios con `request.jwt.claims`. Necesita la 004; la sección P necesita la 006 y la R, la 007 (sin ellas, «P0»/«R0» salen en falla y avisan). Termina en `RAISE EXCEPTION`, así que **todo se revierte** y el mensaje de error es el reporte en JSON. |
| c | (resultado de a) | Pegar y correr los `setval` generados en (a). |
| d | `mapa_datos_prueba.sql` | Crea una red `[PRUEBA]`: 17 ubicaciones, 25 equipos (2 raíces, backbone, un AP con 9 clientes) y 3 respaldos. |
| e | (navegador) | Pestaña Mapa: clic en «CPE Piscina 1» → se resalta su camino hasta la raíz. Activar «Simulación de fallas» y simular la caída de «CPE Piscina 1» (recupera vía AP Santa Ana), de «Router Cerro Azul» (conmuta por cable al PTP de la Torre Norte), de «PTP Santa Ana ← Cerro Azul» (su subárbol queda sin conectividad) y del «AP Cerro Azul» junto con el anterior (Piscina 1 pasa a su respaldo de prioridad 2). Probar los toggles y «Restablecer simulación». |
| f | `mapa_limpieza_prueba.sql` | Borra todo lo `[PRUEBA]`. Se niega a correr si algún equipo real tiene como servidor a uno de prueba. |

Las pruebas dejan filas en `auditoria`: `registrar_auditoria` también registra los inserts y borrados de prueba. Es el comportamiento esperado de la bitácora.
