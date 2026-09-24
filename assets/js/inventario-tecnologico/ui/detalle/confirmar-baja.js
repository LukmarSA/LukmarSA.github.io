import { darDeBaja } from "../../negocio/operaciones.js";
import { cargarActivos } from "../../nucleo/datos.js";
import { buscarActivo, fmtTag } from "../../nucleo/helpers.js";
import { abrirModal, cerrarModal, renderMain } from "../render-raiz.js";

export function abrirConfirmarBaja(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  const html = `
    <div class="inventario-tecnologico-modal">
      <div class="inventario-tecnologico-modal-header"><h3>Dar de baja — ${fmtTag(a)}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
      <div class="inventario-tecnologico-modal-body">
        <div class="inventario-tecnologico-alert inventario-tecnologico-alert-error">Esta acción retira el activo del inventario activo. Queda archivado en la bitácora de bajas, desde donde se puede restaurar si es necesario.</div>
        <div class="inventario-tecnologico-field"><label>Motivo</label><textarea id="inventario-tecnologico-baja-motivo" placeholder="Ej: equipo dañado sin reparación posible, obsoleto, robado…"></textarea></div>
      </div>
      <div class="inventario-tecnologico-modal-footer">
        <button class="inventario-tecnologico-btn inventario-tecnologico-btn-danger" id="inventario-tecnologico-btn-confirmar-baja">Dar de baja</button>
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.getElementById("inventario-tecnologico-btn-confirmar-baja").addEventListener("click", async ()=>{
      await darDeBaja(id, document.getElementById("inventario-tecnologico-baja-motivo").value.trim());
      cerrarModal(); renderMain();
    });
  });
}
