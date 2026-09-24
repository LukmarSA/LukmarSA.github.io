import { cargarActivos } from "../../nucleo/datos.js";
import { buscarActivo, esc, fmtTag, hoyISO } from "../../nucleo/helpers.js";
import { abrirModal, cerrarModal, mostrarToast, renderMain } from "../render-raiz.js";

export const MESES_ES = ["enero","febrero","marzo","abril","mayo","junio","julio",
  "agosto","septiembre","octubre","noviembre","diciembre"];

export function fechaEnPalabras(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-").map(Number);
  if(!y||!m||!d) return iso;
  return `${d} de ${MESES_ES[m-1]} de ${y}`;
}

export function fechaDDMMAAAA(iso){
  if(!iso) return "";
  const [y,m,d] = iso.split("-");
  if(!y||!m||!d) return iso;
  return `${d}-${m}-${y}`;
}

export function inicialMasApellido(nombreCompleto){
  const partes = (nombreCompleto || "").trim().split(/\s+/).filter(Boolean);
  if(partes.length === 0) return "";
  const inicial = partes[0].charAt(0).toUpperCase();
  const resto = partes.slice(1).join("").toUpperCase();
  return inicial + resto;
}

export function descripcionItemActa(a){
  const partes = [];
  const base = [a.tipo, a.marca].filter(Boolean).join(" ");
  if(base) partes.push(base);
  if(a.modelo) partes.push(`Modelo: ${a.modelo}`);
  if(a.serie) partes.push(`Número de serie: ${a.serie}`);
  return partes.join(" — ") || fmtTag(a);
}

export function observacionesActaItem(a, idx){
  const tramo = a.historial_custodia[idx];
  if(!tramo) return "";
  const partes = [];
  if(tramo.observacion_entrega) partes.push(`Entrega: ${tramo.observacion_entrega}`);
  if(tramo.observacion_devolucion) partes.push(`Devolución: ${tramo.observacion_devolucion}`);
  return partes.join(" | ");
}

export const CLAVE_PORTAPAPELES = "lukmar_portapapeles_acta";

export const MAX_PORTAPAPELES = 6;

export let seleccionCustodioActa = {};

export let soporteTecnicoEntrega = "OSCAR RAMIREZ V";

export let soporteTecnicoDevolucion = "OSCAR RAMIREZ V";

export function tramoSeleccionadoActa(a){
  const idx = (seleccionCustodioActa[a.id] === 1 && a.historial_custodia.length > 1) ? 1 : 0;
  return { idx, tramo: a.historial_custodia[idx] || null };
}

export function cargarPortapapeles(){
  try{ const g = JSON.parse(localStorage.getItem(CLAVE_PORTAPAPELES) || "[]"); return Array.isArray(g) ? g : []; }
  catch(e){ return []; }
}

export function guardarPortapapelesIds(ids){
  localStorage.setItem(CLAVE_PORTAPAPELES, JSON.stringify(ids));
}

export function estaEnPortapapeles(id){
  return cargarPortapapeles().includes(id);
}

export function toggleEnPortapapeles(id){
  const datos = cargarActivos();
  const a = buscarActivo(datos, id);
  if(!a) return;
  let ids = cargarPortapapeles();
  if(ids.includes(id)){
    ids = ids.filter(x=>x!==id);
  } else {
    if(!a.custodio){ mostrarToast("Solo se pueden marcar activos con custodio vigente.", "error"); return; }
    if(ids.length >= MAX_PORTAPAPELES){
      mostrarToast(`Ya tienes ${MAX_PORTAPAPELES} activos marcados — es el máximo por acta. Genera esta acta o quita alguno antes de agregar otro.`, "error");
      return;
    }
    ids.push(id);
  }
  guardarPortapapelesIds(ids);
  actualizarBadgePortapapeles();
}

export function vaciarPortapapeles(){
  guardarPortapapelesIds([]);
  seleccionCustodioActa = {};
  soporteTecnicoEntrega = "OSCAR RAMIREZ V";
  soporteTecnicoDevolucion = "OSCAR RAMIREZ V";
  actualizarBadgePortapapeles();
}

export function actualizarBadgePortapapeles(){
  const badge = document.getElementById("inventario-tecnologico-badge-portapapeles");
  if(!badge) return;
  const n = cargarPortapapeles().length;
  badge.textContent = `🔖 ${n}`;
  badge.classList.toggle("inventario-tecnologico-badge-activo", n>0);
}

export function abrirPanelPortapapeles(){
  const ids = cargarPortapapeles();
  const datos = cargarActivos();
  const items = ids.map(id=>buscarActivo(datos, id)).filter(Boolean);
  // Cada activo resuelve a un tramo puntual del historial (actual o
  // anterior, según lo elegido — ver tramoSeleccionadoActa). La validación
  // de "un solo custodio por acta" y el propio generador trabajan sobre
  // ese tramo resuelto, no sobre el custodio vigente crudo del activo —
  // así dos activos con custodio ACTUAL distinto pueden igual entrar en
  // la misma acta si uno de ellos elige documentar a su custodio anterior.
  const resoluciones = items.map(a=>({ activo:a, ...tramoSeleccionadoActa(a) }));
  const nombresDistintos = [...new Set(resoluciones.map(r=>r.tramo && r.tramo.nombre).filter(Boolean))];
  const hayAlternativa = resoluciones.some(r=>r.activo.historial_custodia.length > 1);
  const html = `
    <div class="inventario-tecnologico-modal">
      <div class="inventario-tecnologico-modal-header"><h3>Activos marcados para acta de entrega</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
      <div class="inventario-tecnologico-modal-body">
        ${items.length===0 ? `
          <div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">🔖</div>No has marcado ningún activo todavía.<br>Márcalos desde la tabla o desde la ficha de detalle — hasta ${MAX_PORTAPAPELES} por acta.</div>
        ` : `
        ${hayAlternativa ? `<div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-bottom:10px;">Por defecto se documenta el custodio actual de cada activo. Si necesitas el acta a nombre de quien lo tuvo justo antes (p.ej. para completar un traspaso pendiente), cambia el selector de esa fila.</div>` : ""}
        <div class="inventario-tecnologico-tablewrap">
          <table>
            <thead><tr><th>Tag</th><th>Tipo</th><th>Marca / Modelo</th><th>Custodio del acta</th><th></th></tr></thead>
            <tbody>
              ${resoluciones.map(({activo:a, idx, tramo})=>{
                const tieneAnterior = a.historial_custodia.length > 1;
                return `<tr>
                <td class="inventario-tecnologico-mono">${fmtTag(a)}</td>
                <td>${esc(a.tipo)||'<span class="inventario-tecnologico-cell-muted">—</span>'}</td>
                <td>${esc([a.marca,a.modelo].filter(Boolean).join(" "))||'<span class="inventario-tecnologico-cell-muted">—</span>'}</td>
                <td>${tieneAnterior ? `
                  <select data-select-custodio-acta="${a.id}">
                    <option value="0" ${idx===0?"selected":""}>${esc(a.historial_custodia[0].nombre)} (actual)</option>
                    <option value="1" ${idx===1?"selected":""}>${esc(a.historial_custodia[1].nombre)} (anterior)</option>
                  </select>
                ` : esc(tramo ? tramo.nombre : "—")}</td>
                <td class="inventario-tecnologico-cell-actions"><button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm inventario-tecnologico-btn-danger" data-quitar-portapapeles="${a.id}">Quitar</button></td>
              </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        ${nombresDistintos.length > 1 ? `<div class="inventario-tecnologico-alert inventario-tecnologico-alert-error" style="margin-top:10px;">Los custodios elegidos no coinciden (${nombresDistintos.map(esc).join(", ")}). Un acta es para un solo custodio — ajusta el selector de cada fila o quita las que no correspondan.</div>` : ""}
        <div style="display:flex;gap:10px;margin-top:14px;">
          <div class="inventario-tecnologico-field" style="flex:1;"><label>Soporte técnico — Entrega</label><input type="text" id="inventario-tecnologico-pp-soporte-entrega" value="${esc(soporteTecnicoEntrega)}"></div>
          <div class="inventario-tecnologico-field" style="flex:1;"><label>Soporte técnico — Devolución</label><input type="text" id="inventario-tecnologico-pp-soporte-devolucion" value="${esc(soporteTecnicoDevolucion)}"></div>
        </div>
        `}
      </div>
      <div class="inventario-tecnologico-modal-footer">
        ${items.length>0 ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-danger" id="inventario-tecnologico-btn-vaciar-portapapeles">Vaciar</button>` : ""}
        <button class="inventario-tecnologico-btn inventario-tecnologico-modal-close">Cerrar</button>
        ${items.length>0 ? `<button class="inventario-tecnologico-btn inventario-tecnologico-btn-primary" id="inventario-tecnologico-btn-generar-acta-multiple" ${nombresDistintos.length>1?"disabled":""}>Generar acta unificada</button>` : ""}
      </div>
    </div>`;
  abrirModal(html, ()=>{
    document.querySelectorAll("[data-quitar-portapapeles]").forEach(b=>{
      b.addEventListener("click", ()=>{
        toggleEnPortapapeles(Number(b.dataset.quitarPortapapeles));
        renderMain();
        cerrarModal(); abrirPanelPortapapeles();
      });
    });
    document.querySelectorAll("[data-select-custodio-acta]").forEach(sel=>{
      sel.addEventListener("change", ()=>{
        seleccionCustodioActa[Number(sel.dataset.selectCustodioActa)] = Number(sel.value);
        cerrarModal(); abrirPanelPortapapeles();
      });
    });
    // Estos dos, a diferencia del resto del modal, NO reabren el panel al
    // cambiar — no afectan ninguna otra parte de lo que se ve acá, así que
    // un re-render por cada tecla solo cortaría el foco mientras se escribe.
    const inEntrega = document.getElementById("inventario-tecnologico-pp-soporte-entrega");
    if(inEntrega) inEntrega.addEventListener("input", ()=>{ soporteTecnicoEntrega = inEntrega.value; });
    const inDevolucion = document.getElementById("inventario-tecnologico-pp-soporte-devolucion");
    if(inDevolucion) inDevolucion.addEventListener("input", ()=>{ soporteTecnicoDevolucion = inDevolucion.value; });
    const bv = document.getElementById("inventario-tecnologico-btn-vaciar-portapapeles");
    if(bv) bv.addEventListener("click", ()=>{
      vaciarPortapapeles(); renderMain(); cerrarModal(); abrirPanelPortapapeles();
    });
    const bg = document.getElementById("inventario-tecnologico-btn-generar-acta-multiple");
    if(bg) bg.addEventListener("click", async ()=>{
      if(!soporteTecnicoEntrega.trim() || !soporteTecnicoDevolucion.trim()){
        mostrarToast("Completa el nombre de soporte técnico (entrega y devolución).", "error");
        return;
      }
      bg.disabled = true; const txt = bg.textContent; bg.textContent = "Generando…";
      try{
        await generarActaEntregaDesdeLista(resoluciones);
        vaciarPortapapeles();
        renderMain();
        cerrarModal();
      } catch(err){ mostrarToast("No se pudo generar el acta: " + err.message, "error"); }
      finally{ bg.disabled = false; bg.textContent = txt; }
    });
  });
}

export async function generarActaEntregaDesdeLista(resoluciones){
  if(!resoluciones || resoluciones.length === 0) throw new Error("No hay ningún activo para generar el acta.");
  if(resoluciones.length > 6) throw new Error("Un acta admite hasta 6 activos — genera dos actas separadas.");
  const sinTramo = resoluciones.find(r=>!r.tramo);
  if(sinTramo) throw new Error(`El activo ${fmtTag(sinTramo.activo)} no tiene un custodio para documentar en el acta.`);
  const nombreRef = resoluciones[0].tramo.nombre;
  const distinto = resoluciones.find(r=>r.tramo.nombre !== nombreRef);
  if(distinto) throw new Error(`Los custodios elegidos no coinciden ("${nombreRef}" vs "${distinto.tramo.nombre}"). Un acta es para un solo custodio — ajusta el selector de cada activo o separa en dos actas.`);
  const cargoRef = resoluciones[0].tramo.cargo;
  const fecha = fechaEnPalabras(hoyISO());
  // FECHA (arriba, M8) es la de generación del acta — siempre hoy, el día
  // que se imprime/firma este papel.
  // FECHA_FIRMA (B37) es otra cosa: la fecha REAL en que se entregaron los
  // equipos (historial_custodia.desde de cada tramo documentado), no la de
  // generación — para el caso de un custodio anterior, "hoy" puede ser
  // semanas o meses después de la entrega real. Si los activos de esta
  // acta no comparten la misma fecha de entrega, se muestra el rango
  // (la más antigua - la más reciente) en vez de elegir una sola.
  const fechasEntregaUnicas = [...new Set(resoluciones.map(r=>r.tramo.desde).filter(Boolean))].sort();
  const fechaEntregaTexto = fechasEntregaUnicas.length <= 1
    ? fechaEnPalabras(fechasEntregaUnicas[0])
    : `${fechaEnPalabras(fechasEntregaUnicas[0])} - ${fechaEnPalabras(fechasEntregaUnicas[fechasEntregaUnicas.length-1])}`;
  // FECHA_DEVOLUCION (H37): mismo criterio de rango que la entrega, con una
  // vuelta extra — acá cada activo puede tener un tramo vigente (sin
  // devolver, "pendiente") o uno cerrado (con fecha real), mezclados en la
  // misma acta, porque el actual/anterior se elige por activo. "pendiente"
  // se trata como lo más reciente de todas (un tramo abierto siempre queda
  // "después" de uno ya cerrado), así que una acta con activos mixtos
  // muestra "<fecha más antigua> - pendiente" en vez de perder el dato de
  // que algunos ya se devolvieron y otros no.
  const hastaValores = resoluciones.map(r=>r.tramo.hasta); // ISO string o null, uno por activo
  const hastaUnicos = [...new Set(hastaValores)];
  let fechaDevolucionTexto;
  if(hastaUnicos.length === 1){
    fechaDevolucionTexto = hastaUnicos[0] ? fechaEnPalabras(hastaUnicos[0]) : "pendiente";
  } else {
    const hastaConocidas = hastaUnicos.filter(h=>h!==null).sort();
    const masReciente = hastaUnicos.includes(null) ? "pendiente" : fechaEnPalabras(hastaConocidas[hastaConocidas.length-1]);
    fechaDevolucionTexto = `${fechaEnPalabras(hastaConocidas[0])} - ${masReciente}`;
  }

  const valores = {
    FECHA: fecha,
    NOMBRE: nombreRef || "",
    CARGO: cargoRef || "",
    FIRMA_USUARIO: `Usuario Responsable: ${nombreRef || ""}`,
    FECHA_FIRMA: `Fecha: ${fechaEntregaTexto}`,
    FECHA_DEVOLUCION: `Fecha: ${fechaDevolucionTexto}`,
    SOPORTE_ENTREGA: `Soporte técnico: ${soporteTecnicoEntrega.trim()}`,
    SOPORTE_DEVOLUCION: `Soporte técnico: ${soporteTecnicoDevolucion.trim()}`,
  };
  for(let i=1; i<=6; i++){
    const r = resoluciones[i-1];
    valores["ITEM"+i] = r ? descripcionItemActa(r.activo) : "";
    valores["OBS"+i] = r ? observacionesActaItem(r.activo, r.idx) : "";
  }

  const resp = await fetch("assets/plantillas/TIC-FRM-003.xlsx");
  if(!resp.ok) throw new Error("No se pudo cargar la plantilla (assets/plantillas/TIC-FRM-003.xlsx).");
  const buf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  const rutaHoja = "xl/worksheets/sheet1.xml";
  const archivoHoja = zip.file(rutaHoja);
  if(!archivoHoja) throw new Error("La plantilla no tiene la hoja esperada (" + rutaHoja + ").");
  let xml = await archivoHoja.async("string");
  for(const [marcador, valor] of Object.entries(valores)){
    const escapado = String(valor)
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    xml = xml.split(`<t>{{${marcador}}}</t>`).join(`<t xml:space="preserve">${escapado}</t>`);
  }
  zip.file(rutaHoja, xml);
  const salida = await zip.generateAsync({type:"blob"});
  const url = URL.createObjectURL(salida);
  const link = document.createElement("a");
  const nombreArchivo = `TIC-FRM-003-${inicialMasApellido(nombreRef)}-${fechaDDMMAAAA(resoluciones[0].tramo.desde)}.xlsx`;
  link.href = url; link.download = nombreArchivo;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
