// Chequeo rápido de sintaxis: recorre todos los .js de
// assets/js/inventario-tecnologico y corre `node --check` sobre cada uno.
// No necesita jsdom — sirve como primer filtro, antes de "npm test", para
// aislar un error de sintaxis de uno de wiring/render.
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const RAIZ = new URL("../assets/js/inventario-tecnologico", import.meta.url).pathname;

function listarJs(dir){
  let out = [];
  for(const nombre of readdirSync(dir)){
    const ruta = join(dir, nombre);
    if(statSync(ruta).isDirectory()) out = out.concat(listarJs(ruta));
    else if(nombre.endsWith(".js")) out.push(ruta);
  }
  return out;
}

const archivos = listarJs(RAIZ);
let fallos = 0;
for(const f of archivos){
  try{ execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); console.log("OK:", f); }
  catch(err){ fallos++; console.log("FALLO:", f, "\n", err.stderr?.toString() || err.message); }
}
console.log(`\n=== ${archivos.length-fallos}/${archivos.length} archivos con sintaxis válida ===`);
process.exit(fallos>0 ? 1 : 0);
