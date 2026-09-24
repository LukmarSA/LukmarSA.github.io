// Task #26 — Búsqueda dedicada de activos por custodio histórico.
//
// El filtro de la columna "Custodio" (ver colCustodio en filtros.js) YA
// encuentra activos por cualquier custodio pasado, pero solo entrega una
// lista de ACTIVOS que coinciden — para ver cuándo y con qué activo(s)
// tuvo relación una persona hay que abrir cada uno y leer su línea de
// tiempo por separado. Esta pantalla invierte esa vista: dado un nombre,
// junta TODOS los tramos de custodia de TODOS los activos (vigentes y
// dados de baja) donde ese nombre aparece, y los muestra ya ordenados por
// fecha — la persona como punto de partida, no el activo.
import { cargarActivos, cargarBajas } from "../../nucleo/datos.js";
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { abrirDetalle } from "../detalle/vista.js";
import { abrirModal } from "../render-raiz.js";

// Junta el historial_custodia de todos los activos vigentes + el de cada
// activo dado de baja (b.activo, si el registro de baja lo trae) en una
// sola lista plana de segmentos {activo, tramo} — así una persona aparece
// una sola vez sin importar en cuántos activos o bajas haya estado.
function segmentosGlobales(){
  const vigentes = cargarActivos().activos || [];
  const idsVigentes = new Set(vigentes.map(a=>a.id));
  const deBaja = cargarBajas().map(b=>b.activo).filter(a=>a && !idsVigentes.has(a.id));
  const segmentos = [];
  for(const a of [...vigentes, ...deBaja]){
    for(const t of (a.historial_custodia||[])){
      segmentos.push({ activo:a, tramo:t, deBaja: !idsVigentes.has(a.id) });
    }
  }
  return segmentos;
}

function agruparPorNombre(segmentos, texto){
  const t = texto.trim().toLowerCase();
  if(t.length < 2) return null;
  const grupos = new Map();
  for(const s of segmentos){
    const nombre = s.tramo.nombre || "";
    if(!nombre.toLowerCase().includes(t)) continue;
    if(!grupos.has(nombre)) grupos.set(nombre, []);
    grupos.get(nombre).push(s);
  }
  for(const lista of grupos.values()){
    lista.sort((x,y)=> (y.tramo.desde||"").localeCompare(x.tramo.desde||""));
  }
  return [...grupos.entries()].sort((a,b)=>a[0].localeCompare(b[0],'es'));
}

const ETIQUETA_TIPO_CUSTODIO = { persona:"Persona", area:"Área / depto.", mantenimiento:"Mantenimiento" };

export function abrirHistorialCustodio(){
  const segmentos = segmentosGlobales();
  const html = `<div class="inventario-tecnologico-modal inventario-tecnologico-modal-wide">
    <div class="inventario-tecnologico-modal-header"><h3>Historial por custodio</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-field">
        <input type="text" id="inventario-tecnologico-hc-buscar" placeholder="Nombre de una persona, área o cuadrilla de mantenimiento (mín. 2 letras)…" autocomplete="off">
      </div>
      <div id="inventario-tecnologico-hc-resultados" style="margin-top:14px;"></div>
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cerrar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const input = document.getElementById("inventario-tecnologico-hc-buscar");
    const resultados = document.getElementById("inventario-tecnologico-hc-resultados");
    const pintar = ()=>{
      const grupos = agruparPorNombre(segmentos, input.value);
      if(grupos===null){
        resultados.innerHTML = `<div class="inventario-tecnologico-hint">Escribe al menos 2 letras para buscar en todo el historial de custodia (activos vigentes y dados de baja).</div>`;
        return;
      }
      if(grupos.length===0){
        resultados.innerHTML = `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Nadie con ese nombre aparece en el historial de custodia.</div>`;
        return;
      }
      resultados.innerHTML = grupos.map(([nombre, lista])=>`
        <div class="inventario-tecnologico-section-title" style="margin-top:16px;">${esc(nombre)} <span class="inventario-tecnologico-cell-muted" style="font-weight:400;">(${lista.length} ${lista.length===1?'tramo':'tramos'})</span></div>
        <div class="inventario-tecnologico-tablewrap" style="margin-top:8px;">
          <table>
            <thead><tr><th>Activo</th><th>Tipo</th><th>Marca / Modelo</th><th>Rol</th><th>Cargo</th><th>Desde</th><th>Hasta</th><th></th></tr></thead>
            <tbody>
              ${lista.map(({activo:a, tramo:t, deBaja})=>`<tr>
                <td><span class="inventario-tecnologico-tag${deBaja?' inventario-tecnologico-tag-baja':''}">${fmtTag(a)}</span></td>
                <td>${esc(a.tipo)||'—'}</td>
                <td>${esc(a.marca)||''} ${esc(a.modelo)||''}</td>
                <td class="inventario-tecnologico-cell-muted">${ETIQUETA_TIPO_CUSTODIO[t.tipo_custodio]||'—'}</td>
                <td class="inventario-tecnologico-cell-muted">${esc(t.cargo)||'—'}</td>
                <td class="inventario-tecnologico-cell-muted">${fmtFecha(t.desde)}</td>
                <td class="inventario-tecnologico-cell-muted">${t.hasta?fmtFecha(t.hasta):'<span style="color:var(--good);">Presente</span>'}</td>
                <td class="inventario-tecnologico-cell-actions">${deBaja?`<span class="inventario-tecnologico-cell-muted">De baja</span>`:`<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-hc-ver="${a.id}">Ver</button>`}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>`).join("");
      resultados.querySelectorAll("[data-hc-ver]").forEach(b=>{
        b.addEventListener("click", ()=>abrirDetalle(Number(b.dataset.hcVer)));
      });
    };
    input.addEventListener("input", pintar);
    pintar();
  });
}
