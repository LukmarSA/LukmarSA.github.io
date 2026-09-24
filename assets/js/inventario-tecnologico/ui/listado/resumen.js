import { esc, hoyISO } from "../../nucleo/helpers.js";
import { fechaEnPalabras } from "../detalle/acta.js";
import { contarValorEnLista, labelOpcionFiltro, listaParaConteo, opcionesFiltroCache } from "./filtros.js";
import { abrirModal, mostrarToast } from "../render-raiz.js";

export const NOMBRE_COLUMNA_KPI = { tipo:"Tipo", marca:"Marca", custodioClase:"Custodio", propiedad:"Propiedad", estado:"Estado" };

export const CAMPOS_RESUMEN_GLOBAL = ["tipo","marca","propiedad"];

export function calcularResumenColumna(campo){
  const nombre = NOMBRE_COLUMNA_KPI[campo] || campo;
  const opciones = opcionesFiltroCache[campo] || [];
  const lista = listaParaConteo(campo);
  const filas = opciones
    .map(op=>({ label: labelOpcionFiltro(campo, op), n: contarValorEnLista(lista, campo, op) }))
    .sort((a,b)=>b.n-a.n);
  const totalConteo = filas.reduce((s,f)=>s+f.n,0);
  return { campo, nombre, filas, totalConteo };
}

export function copiarAlPortapapelesTexto(texto){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(texto);
  }
  return Promise.reject(new Error("El navegador no permite copiar al portapapeles en este contexto."));
}

export function descargarArchivoTexto(nombreArchivo, contenido, tipoMime){
  const blob = new Blob([contenido], { type: tipoMime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = nombreArchivo;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function resumenATextoWhatsApp(secciones){
  return secciones.map(s=>{
    const cuerpo = s.filas.map(f=>{
      const pct = s.totalConteo ? Math.round(f.n/s.totalConteo*100) : 0;
      return `• ${f.label}: ${f.n} (${pct}%)`;
    }).join("\n");
    return `*Resumen: ${s.nombre}* (${s.totalConteo} activos)\n${cuerpo}`;
  }).join("\n\n");
}

export function resumenACSV(secciones){
  const filasCSV = [["Campo","Valor","Conteo"]];
  secciones.forEach(s=>{
    s.filas.forEach(f=>filasCSV.push([s.nombre, f.label, f.n]));
  });
  return filasCSV.map(fila=>fila.map(v=>{
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t;
  }).join(",")).join("\n");
}

export function resumenAHTML(secciones, titulo){
  const bloques = secciones.map(s=>{
    const max = Math.max(1, ...s.filas.map(f=>f.n));
    const filasHtml = s.filas.map(f=>`
      <div class="fila">
        <div class="etiqueta">${esc(f.label)}</div>
        <div class="pista"><div class="barra" style="width:${(f.n/max*100).toFixed(1)}%"></div></div>
        <div class="num">${f.n}</div>
      </div>`).join("");
    return `<section><h2>${esc(s.nombre)}</h2><p class="sub">${s.totalConteo} activos</p>${filasHtml}</section>`;
  }).join("");
  // Todo el tamaño (texto, relleno, alto de barra) usa clamp() — escala de
  // forma continua entre celular y TV sin depender de un puñado de breakpoints
  // fijos que dejarían huecos en los tamaños intermedios (tablet, laptop). La
  // cuadrícula de secciones usa auto-fit, así que se reorganiza sola en más
  // columnas cuando hay espacio, sin necesitar su propia media query.
  return `<!DOCTYPE html><html lang="es"><head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(titulo)}</title>
  <style>
    *{box-sizing:border-box;}
    body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f4f6f8;color:#1c2733;margin:0;padding:clamp(16px,4vw,40px);}
    .envoltorio{max-width:1400px;margin:0 auto;}
    h1{font-size:clamp(19px,2.6vw,28px);margin:0 0 4px;}
    .fecha{color:#6b7684;font-size:clamp(12px,1.4vw,15px);margin-bottom:clamp(16px,3vw,28px);}
    .secciones{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:clamp(12px,2vw,20px);}
    section{background:#fff;border:1px solid #e2e6ea;border-radius:12px;padding:clamp(16px,2.4vw,26px);min-width:0;}
    h2{font-size:clamp(15px,1.8vw,19px);margin:0 0 2px;color:#12324a;}
    .sub{font-size:clamp(11.5px,1.3vw,14px);color:#6b7684;margin:0 0 14px;}
    .fila{display:flex;align-items:center;gap:clamp(8px,1.4vw,14px);padding:clamp(4px,0.7vw,7px) 0;min-width:0;}
    .etiqueta{flex:0 1 40%;min-width:0;font-size:clamp(12px,1.3vw,15px);color:#334;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .pista{flex:1;min-width:24px;height:clamp(7px,1vw,12px);background:#eef1f4;border-radius:5px;overflow:hidden;}
    .barra{height:100%;background:#007EB2;border-radius:5px;}
    .num{flex:0 0 auto;min-width:2.4em;text-align:right;font-size:clamp(12px,1.3vw,15px);font-weight:600;color:#12324a;}
  </style></head><body>
    <div class="envoltorio">
      <h1>${esc(titulo)}</h1>
      <div class="fecha">Generado el ${fechaEnPalabras(hoyISO())}</div>
      <div class="secciones">${bloques}</div>
    </div>
  </body></html>`;
}

export function abrirModalKpiColumna(campo){
  const { nombre, filas, totalConteo } = calcularResumenColumna(campo);
  const max = Math.max(1, ...filas.map(f=>f.n));
  const html = `<div class="inventario-tecnologico-modal">
    <div class="inventario-tecnologico-modal-header"><h3>Resumen — ${esc(nombre)}</h3><button class="inventario-tecnologico-modal-close">✕</button></div>
    <div class="inventario-tecnologico-modal-body">
      <div class="inventario-tecnologico-field inventario-tecnologico-hint" style="margin-bottom:14px;">Sobre ${totalConteo} activos, considerando los demás filtros que tengas activos ahora.</div>
      <div class="inventario-tecnologico-kpi-breakdown">
        ${filas.map(f=>`
          <div class="inventario-tecnologico-kpi-breakdown-row">
            <div class="inventario-tecnologico-kpi-breakdown-label">${esc(f.label)}</div>
            <div class="inventario-tecnologico-kpi-breakdown-bar-track"><div class="inventario-tecnologico-kpi-breakdown-bar" style="width:${(f.n/max*100).toFixed(1)}%"></div></div>
            <div class="inventario-tecnologico-kpi-breakdown-num">${f.n}</div>
          </div>`).join("") || '<div class="inventario-tecnologico-empty-state"><div class="inventario-tecnologico-big">—</div>No hay datos para mostrar.</div>'}
      </div>
    </div>
    <div class="inventario-tecnologico-modal-footer">
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-kpi-export-wa">Copiar para WhatsApp</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-kpi-export-csv">Descargar CSV</button>
      <button class="inventario-tecnologico-btn inventario-tecnologico-btn-sm" id="inventario-tecnologico-kpi-export-html">Descargar HTML</button>
    </div>
  </div>`;
  abrirModal(html, ()=>{
    const seccion = [{ nombre, filas, totalConteo }];
    document.getElementById("inventario-tecnologico-kpi-export-wa").addEventListener("click", async ()=>{
      try{ await copiarAlPortapapelesTexto(resumenATextoWhatsApp(seccion)); mostrarToast("Copiado — pégalo directo en WhatsApp.", "success"); }
      catch(err){ mostrarToast("No se pudo copiar: " + err.message, "error"); }
    });
    document.getElementById("inventario-tecnologico-kpi-export-csv").addEventListener("click", ()=>{
      descargarArchivoTexto(`resumen_${campo}.csv`, resumenACSV(seccion), "text/csv");
    });
    document.getElementById("inventario-tecnologico-kpi-export-html").addEventListener("click", ()=>{
      descargarArchivoTexto(`resumen_${campo}.html`, resumenAHTML(seccion, `Resumen — ${nombre}`), "text/html");
    });
  });
}
