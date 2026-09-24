// Punto de entrada único del módulo. Antes, toda la app vivía en un solo
// app.js sin imports/exports, con ~180 constantes y funciones sueltas
// colgando directo de window (cualquier otro script en la misma página
// podía pisarlas, o pisar las suyas, sin que nada avisara). Ahora cada
// archivo es un módulo ES real (import/export) y NADA queda expuesto en el
// scope global salvo este único punto de entrada — así la app se puede
// incrustar en otra página sin que sus nombres choquen con los de ese
// proyecto.
import { iniciar } from "./arranque.js";

// Único símbolo global que esta app expone. No hace falta para su propio
// funcionamiento (iniciar() se llama explícitamente más abajo) — existe
// para que, si algún día esto se integra en otro proyecto, ese proyecto
// tenga un punto de entrada claro y con nombre en vez de tener que adivinar
// funciones sueltas.
window.InventarioTecnologico = { iniciar };

iniciar();
