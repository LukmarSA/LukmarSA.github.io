import { cargarActivos } from "../../nucleo/datos.js";
import { esc, fmtFecha, fmtTag } from "../../nucleo/helpers.js";
import { MAX_PORTAPAPELES, abrirPanelPortapapeles, cargarPortapapeles, estaEnPortapapeles, toggleEnPortapapeles } from "../detalle/acta.js";
import { abrirDetalle } from "../detalle/vista.js";
import { abrirModal, cerrarModal, mostrarToast } from "../render-raiz.js";

export function listaPendientesFirma(datos){
  const filas = [];
  datos.activos.forEach(a=>{
    a.historial_custodia.forEach(t=>{
      if(t.tipo_entrega === "pendiente_firma") filas.push({ activo:a, tramo:t, vigente: t.hasta===null });
    });
  });
  // Ordenado por nombre de custodio (y luego fecha) para que "ver todas las
  // personas con firmas pendientes" se lea de un vistazo, agrupado por persona.
  filas.sort((x,y)=> (x.tramo.nombre||"").localeCompare(y.tramo.nombre||"",'es') || (x.tramo.desde||"").localeCompare(y.tramo.desde||""));
  return filas;
}

export function abrirPendientesFirma(){
  const filas = listaPendientesFirma(cargarActivos());
  // Marcar todos / Generar acta (Task #31): igual que en la tabla principal,
  // solo se puede marcar un activo con custodio VIGENTE (toggleEnPortapapeles
  // lo exige) — un activo cuyo tramo pendiente de firma ya quedó atrás (hay
  // uno más nuevo encima) simplemente no se puede marcar desde acá, igual
  // que tampoco se podría desde la tabla.
  const html = `<div class="inventario-tecnologico-modal inventario-tecnologico-modal-wide">
    <div class="inventario-tecnologico-modal-header"><h3>Pendientes de firma (${filas.length})</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-bottom:12px;">Entregas ya realizadas cuya acta todavía no se ha firmado — incluye tramos históricos, no solo el custodio actual de cada activo. Para resolver una, abre el activo y edita ese tramo (cambia el tipo de entrega una vez firmada). Para generar el acta ya firmada, marca los activos con 🔖 y usa "Generar acta de entrega".</div>
      ${filas.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>No hay ninguna entrega pendiente de firma.</div>` : `
      <div class="inventario-tecnologico-tablewrap">
        <table>
          <thead><tr><th>Custodio</th><th>Cargo</th><th>Tag</th><th>Tipo</th><th>Fecha entrega</th><th>Tramo</th><th></th></tr></thead>
          <tbody>
            ${filas.map(({activo:a, tramo:t, vigente})=>{
              const marcado = estaEnPortapapeles(a.id);
              return `<tr>
                <td>${esc(t.nombre)}</td>
                <td class="inventario-tecnologico-cell-muted">${esc(t.cargo)||'—'}</td>
                <td class="inventario-tecnologico-mono">${fmtTag(a)}</td>
                <td>${esc(a.tipo)||'—'}</td>
                <td>${fmtFecha(t.desde)}</td>
                <td>${vigente ? '<span class="inventario-tecnologico-pill inventario-tecnologico-pill-persona">Vigente</span>' : '<span class="inventario-tecnologico-pill inventario-tecnologico-pill-mantenimiento">Histórico</span>'}</td>
                <td class="inventario-tecnologico-cell-actions">
                  ${a.custodio ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm ${marcado?'inventario-tecnologico-btn-primary':''}" data-marcar-pendiente="${a.id}" aria-pressed="${marcado}" title="${marcado?'Marcado para acta — clic para quitar':'Marcar para acta de entrega unificada'}">🔖</button>` : ""}
                  <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-ver-pendiente="${a.id}">Ver activo</button>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>`}
    </div>
    <div class="inventario-tecnologico-modal-footer">
      ${filas.length>0 ? `<button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-marcar-todos-pendientes">🔖 Marcar todos para acta unificada</button>` : ""}
      <button class="inventario-tecnologico-btn" id="inventario-tecnologico-btn-generar-acta-pendientes">Generar acta de entrega</button>
      <div class="inventario-tecnologico-fb-spacer"></div>
      <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cerrar</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    document.querySelectorAll("[data-ver-pendiente]").forEach(b=>{
      b.addEventListener("click", ()=>abrirDetalle(Number(b.dataset.verPendiente)));
    });
    document.querySelectorAll("[data-marcar-pendiente]").forEach(b=>{
      b.addEventListener("click", ()=>{
        toggleEnPortapapeles(Number(b.dataset.marcarPendiente));
        cerrarModal(); abrirPendientesFirma();
      });
    });
    const btnMarcarTodos = document.getElementById("inventario-tecnologico-btn-marcar-todos-pendientes");
    if(btnMarcarTodos) btnMarcarTodos.addEventListener("click", ()=>{
      const idsUnicos = [...new Set(filas.map(f=>f.activo.id))];
      let marcados = 0, sinCustodio = 0, porLimite = 0;
      for(const id of idsUnicos){
        if(estaEnPortapapeles(id)) continue;
        const fila = filas.find(f=>f.activo.id===id);
        if(!fila.activo.custodio){ sinCustodio++; continue; }
        if(cargarPortapapeles().length >= MAX_PORTAPAPELES){ porLimite++; continue; }
        toggleEnPortapapeles(id);
        marcados++;
      }
      let msg = marcados>0 ? `${marcados} activo(s) marcado(s) para la acta unificada.` : "No se marcó ningún activo nuevo.";
      if(sinCustodio) msg += ` ${sinCustodio} sin custodio vigente no se pudieron marcar.`;
      if(porLimite) msg += ` ${porLimite} más no entraron (máximo ${MAX_PORTAPAPELES} por acta).`;
      mostrarToast(msg, marcados>0 ? "success" : "error");
      cerrarModal(); abrirPendientesFirma();
    });
    document.getElementById("inventario-tecnologico-btn-generar-acta-pendientes").addEventListener("click", ()=>{
      cerrarModal(); abrirPanelPortapapeles();
    });
  });
}
