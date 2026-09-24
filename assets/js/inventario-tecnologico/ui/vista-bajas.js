import { restaurarBaja } from "../negocio/operaciones.js";
import { cargarBajas } from "../nucleo/datos.js";
import { esc, fmtFechaHora, fmtTag } from "../nucleo/helpers.js";
import { puede } from "../nucleo/permisos.js";

export function renderVistaBajas(main){
  const bajas = cargarBajas();
  main.innerHTML = `
    <div class="inventario-tecnologico-section-title" style="margin-top:0;">Bitácora de bajas (${bajas.length})</div>
    <div class="inventario-tecnologico-tablewrap">
      <table>
        <thead><tr><th>Tag</th><th>Tipo</th><th>Marca / Modelo</th><th>Fecha de baja</th><th>Motivo</th><th></th></tr></thead>
        <tbody>
          ${bajas.map((b,i)=>`
            <tr>
              <td><span class="inventario-tecnologico-tag inventario-tecnologico-tag-baja">${fmtTag(b.activo)}</span></td>
              <td>${esc(b.activo.tipo)||'—'}</td>
              <td>${esc(b.activo.marca)||''} ${esc(b.activo.modelo)||''}</td>
              <td class="inventario-tecnologico-cell-muted">${fmtFechaHora(b.fecha_baja)}</td>
              <td class="inventario-tecnologico-cell-muted">${esc(b.motivo)||'—'}</td>
              <td class="inventario-tecnologico-cell-actions">
                ${puede("restaurar_baja") ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" data-restaurar="${i}">Restaurar</button>` : ""}
              </td>
            </tr>`).join("")}
        </tbody>
      </table>
      ${bajas.length===0 ? `<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>No hay activos dados de baja.</div>` : ""}
    </div>`;
  main.querySelectorAll("[data-restaurar]").forEach(b=>{
    b.addEventListener("click", async ()=>{
      await restaurarBaja(Number(b.dataset.restaurar));
      renderVistaBajas(main);
    });
  });
}
