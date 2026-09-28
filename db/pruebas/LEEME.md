# Pruebas del mapa (migraciones 002 a 011)

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
| `db/migraciones/008_medio_y_nombres.sql` | Después de la 007. Agrega `equipos_radioenlace.medio` (cable, fibra o inalámbrico; vacío = automático) y `recalcular_nombres_equipos()` con sus triggers: la base guarda siempre el nombre automático al día (cambie lo que cambie: tipo, referencia, servidor, ubicación, medio, nombre de una ubicación, etiqueta o género de un tipo). Es aditiva: la app anterior sigue funcionando. |
| `db/migraciones/009_piscinas.sql` | Cuando se quiera la capa «Piscinas». Crea `piscinas` (nombre, sector, hectáreas del plano, contorno `[[lat, lng], …]`) con las 127 piscinas del plano de lotes de agosto de 2026. Es aditiva: sin ella no aparece la capa. |
| `db/migraciones/010_red_en_nombres.sql` | Después de la 008 (mejor con la app v8 ya publicada). El nombre automático lleva la red entre paréntesis con la referencia: «Punto a Punto (Red Oficina · Apuntando al Intensivo) en Torre principal»; la red del servidor solo si es distinta. Los nombres se ponen al día también al cambiar la red de un equipo, al renombrar una red o al borrarla. Crea `version_nombres_equipos()` (= 2), que la app consulta para armar los nombres igual que la base; sin la 010 la app los arma sin la red, como la 008. |
| `db/migraciones/011_red_heredada.sql` | Después de la 010 (mejor con la app v9 ya publicada). `red_id` pasa a ser la red propia: sin ella, un equipo hereda la de su servidor principal, hasta la raíz; otra red propia en un equipo intermedio forma una red aparte con lo que cuelga de él. Una red propia igual a la heredada se deja vacía después de cada cambio (`normalizar_redes_equipos()`, que corre desde los triggers de nombres) y al aplicarla. `f_red_efectiva(id)` da la red efectiva; los nombres la usan. `version_nombres_equipos()` pasa a 3: la app hereda también en los colores, los filtros, el formulario y el lote; sin la 011 sigue como con la 010. |

## 1. Lógica pura (Node, sin navegador)

```
cd tests && npm install && npm run test:mapa
```

`tests/mapa-unit.mjs` cubre distancia/azimut, el parseo de coordenadas, los índices y el buscador del mapa, las validaciones, la traducción de errores de Supabase, la jerarquía (roles, backbone/P2MP, agrupación, camino a la raíz, simulación de fallas con conmutación por prioridad y plan de líneas) la capa Plano (esquinas, mover, agrandar sin deformar, girar, matriz CSS y el calce con la carretera) la red de la finca de la 007 (nombre automático con género, cable o radio, referencia y numeración; caídos efectivos de los atajos; validaciones de atajo, red y tipo), el medio de la 008 (cable/fibra entre sitios: clase propia, no cuenta para backbone/P2MP, nombre «conectada a … en …», filtro por red), las piscinas de la 009 (validación del contorno, área, centro, editor de vértices, formulario), la red en el nombre de la 010 (paréntesis, red del servidor solo si es distinta, sin la 010 como antes), la red heredada de la 011 (red efectiva, redes aparte, cuentas y filtro por red efectiva, a quiénes pasa la red de un equipo, nombres con la red heredada y sin la 011 como antes) el grosor de las líneas (factor, anchos y punteados) y el selector de servidor (`nucleo/selector-servidor.js`: activos ubicados como posibles servidores, búsqueda sin tildes, facetas con cuentas, orden, sugerencia de cable). `tests/activo-unit.mjs` cubre el formulario «Nuevo activo» (campos según el tipo, qué se guarda, búsqueda y orden de tipos).

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
- **v7:** el plano como capa superpuesta (sobre el mapa de carreteras o el satélite, recordada, y la base «Plano» de la v6 abre como satélite + plano); las secciones de la torre como tarjetas de colores; el cableado con conectores, entrada, salidas, rama de respaldo y marcas de la simulación; el medio de la 008 (campo, nombre, línea de fibra, sin la 008 no aparece); tipo y red en lote (con la 008 un solo UPDATE; sin ella, uno por equipo con su nombre); el filtro y los colores por red; la capa Piscinas de la 009 (clic, solo por revisar, editor de vértices con mouse y teclado, datos, nueva, eliminar, sin ser administrador y sin la 009).
- **v8, selector de servidor:** botón + panel con roles ARIA, teclado (flechas, Enter, Esc que pliega el filtro abierto antes de cerrar), búsqueda, filtros con casillas y cuentas (Todos / Ninguno / doble clic / «Quitar filtros»), orden recordado, el Router del Data Center (un activo ubicado que no es equipo de red) como servidor: al guardar se registra primero y el equipo queda colgado de él por cable; el mismo selector en el respaldo; la red en los nombres con la 010 (y renombrar una red los pone al día) y sin ella; en el celular cabe en la pantalla sin scroll horizontal.
- **v9, red heredada (011):** la base arranca normalizada, los chips REDES cuentan la red efectiva, la red propia va con borde lleno y la heredada punteada (con de quién la hereda), el formulario ofrece «Heredada del servidor: …» y explica a cuántos pasa la red, otra red en un equipo intermedio forma una red aparte (en la base, en los nombres y con su color al colorear por red), ocultar una red no oculta la red aparte que cuelga de ella, cambiar el servidor cambia la red heredada, el lote avisa cuántos cambian por herencia y «Redes y tipos» cuenta los que heredan; sin la 011, todo como en el v8.
- **v9, pantalla completa y grosor:** el grosor de las líneas (1× al empezar, engrosa anchos y punteados, se recuerda, «Normal»); el botón de pantalla completa debajo del zoom, el mapa cubre la ventana y las ventanas «Buscar, filtros y capas» y del detalle arrancan minimizadas, se muestran y minimizan (botón, doble clic, clic en el título), el título del detalle nombra la ubicación elegida y se ilumina si está minimizada, se arrastran sin salirse de la pantalla, la lista del buscador se ve entera, los modales quedan encima, Esc primero deselecciona y después sale, todo vuelve a su lugar (el panel con sus clics) y en el celular el detalle es una hoja abajo.
- **Inventario, «Nuevo activo»:** selector de Tipo con búsqueda y orden, campos según el tipo con transición, «+» en un submodal, lo que se guarda al crear y al editar.

`SOLO=plano node mapa-smoke.mjs` corre un solo escenario (admin, permisos, fallas, celular, plano, torre, red, medio, lote, redes, piscinas, servidor, herencia, pantalla o activo); `SOLO=admin,torre` corre varios. Si Playwright no encuentra su navegador, usar `CHROMIUM_PATH=/ruta/al/chrome`.

Las capturas quedan en `tests/capturas/`.

## 3. Base real (SQL Editor de Supabase)

| Paso | Archivo | Qué hace |
|---|---|---|
| a | `mapa_pruebas_restaurar_secuencias.sql` | Correr ANTES de (b): genera los `setval` para dejar las secuencias como estaban, porque `nextval` no se revierte con ROLLBACK. Guardar el resultado. |
| b | `mapa_pruebas_reglas_rls.sql` | 143 pruebas de restricciones, triggers (ciclos, respaldo promovido), RLS (admin / visitante / registrador / anon), `equipo_radio_de_activo`, cambio de custodio del registrador, fechas de Ecuador, la tabla del plano (sección P), la red de la finca (sección R: tipos, redes, atajos, limpieza al borrar un equipo o una red), el medio y los nombres al día (sección S: nombre armado en SQL, renombrar ubicación o tipo, numeración, nombres a mano, un ciclo de nombres cruzados), las piscinas (sección T: semilla, formas inválidas, RLS, GRANT, auditoría), la red en los nombres (sección U: paréntesis, red del servidor solo si es distinta, cambiar la red, renombrarla y borrarla, numeración, `version_nombres_equipos()` para anon), la red heredada (sección V: red efectiva hasta la raíz, red aparte, cambiar la red de la raíz, la propia igual a la heredada queda vacía, cambiar de servidor, borrar redes, y que en toda la tabla ninguna red propia repita la heredada), GRANT y auditoría, simulando usuarios con `request.jwt.claims`. Necesita la 004; la sección P necesita la 006, la R la 007, la S la 008, la T la 009, la U la 010 y la V la 011 (sin ellas, «P0»/«R0»/«S0»/«T0»/«U0»/«V0» salen en falla y avisan; la U espera los nombres de la 010 o, si ya está la 011, los de la red heredada). La S apaga un instante el trigger de nombres (ALTER TABLE, dentro de la misma transacción que se revierte). Termina en `RAISE EXCEPTION`, así que **todo se revierte** y el mensaje de error es el reporte en JSON. |
| c | (resultado de a) | Pegar y correr los `setval` generados en (a). |
| d | `mapa_datos_prueba.sql` | Crea una red `[PRUEBA]`: 17 ubicaciones, 25 equipos (2 raíces, backbone, un AP con 9 clientes) y 3 respaldos. |
| e | (navegador) | Pestaña Mapa: clic en «CPE Piscina 1» → se resalta su camino hasta la raíz. Activar «Simulación de fallas» y simular la caída de «CPE Piscina 1» (recupera vía AP Santa Ana), de «Router Cerro Azul» (conmuta por cable al PTP de la Torre Norte), de «PTP Santa Ana ← Cerro Azul» (su subárbol queda sin conectividad) y del «AP Cerro Azul» junto con el anterior (Piscina 1 pasa a su respaldo de prioridad 2). Probar los toggles y «Restablecer simulación». |
| f | `mapa_limpieza_prueba.sql` | Borra todo lo `[PRUEBA]`. Se niega a correr si algún equipo real tiene como servidor a uno de prueba. |

Las pruebas dejan filas en `auditoria`: `registrar_auditoria` también registra los inserts y borrados de prueba. Es el comportamiento esperado de la bitácora.
