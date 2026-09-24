import { cargarLog } from "../nucleo/datos.js";
import { esc, fmtFechaHora } from "../nucleo/helpers.js";

export function renderVistaAuditoria(main){
  const log = cargarLog();
  main.innerHTML = `
    <div class="inventario-tecnologico-section-title" style="margin-top:0;">Registro de auditoría (últimas ${log.length} acciones)</div>
    <div class="inventario-tecnologico-tablewrap">
      <table>
        <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Detalle</th></tr></thead>
        <tbody>
          ${log.map(l=>`<tr>
            <td class="inventario-tecnologico-cell-muted inventario-tecnologico-mono" style="white-space:nowrap;">${fmtFechaHora(l.fecha)}</td>
            <td>${esc(l.nombre_completo||l.usuario)}</td>
            <td><span class="inventario-tecnologico-pill inventario-tecnologico-pill-persona">${esc(l.accion)}</span></td>
            <td class="inventario-tecnologico-cell-muted">${esc(l.detalle)}</td>
          </tr>`).join("")}
        </tbody>
      </table>
      ${log.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>Todavía no hay acciones registradas.</div>` : ""}
    </div>`;
}
