import { cargarActivos } from "../../nucleo/datos.js";
import { fmtTag, hoyISO, valorActualActivo } from "../../nucleo/helpers.js";
import { camposNuevosActivos, configTipo, infoPropiedad } from "../../nucleo/opciones-configurables.js";
import { aplicaATipo, etiquetaConUnidad, ordenarCampos, valorCrudo, valorParaExcel } from "../../nucleo/campos-personalizados.js";
import { fechaEnPalabras } from "../detalle/acta.js";
import { listaOrdenadaFiltrada } from "./filtros.js";
import { celdaInline } from "./tabla.js";
import { mostrarToast } from "../render-raiz.js";

export const COLS_LISTADO_ACTIVOS = ["A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W"];

export const COLS_LISTADO_HISTORIAL = ["A","B","C","D","E","F","G"];

export const ESTILOS_LISTADO_ACTIVOS = [31,28,28,28,28,28,29,30,27,28,29,30,32,32,28,28,29,30,32,34,34,28,33];

export const ESTILOS_LISTADO_HISTORIAL = [45,42,43,44,46,47,48];

export function filaXML(fila, estilos, columnas, valores){
  const celdas = columnas.map((col,i)=>celdaInline(col, fila, estilos[i], valores[i])).join("");
  return `<row r="${fila}" spans="1:${columnas.length}" ht="18" customHeight="1" x14ac:dyDescent="0.25">${celdas}</row>`;
}

// v10: los campos nuevos van como columnas extra desde la X (la 24), con su
// etiqueta en la fila 9, dentro de la misma Tabla de Excel (tblComputadores).
// Las 23 columnas de la plantilla no cambian.
export function letraColumna(n){
  let s = "";
  for(let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const escXml = t=>String(t ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
// Nombres de columna de la Tabla: únicos (sin distinguir mayúsculas), como exige Excel.
export function nombresColumnasExtra(etiquetas, existentes){
  const usados = new Set(existentes.map(x=>x.toLowerCase()));
  return etiquetas.map(e=>{
    let n = String(e).trim() || "Campo", k = 2;
    while(usados.has(n.toLowerCase())) n = `${String(e).trim()} (${k++})`;
    usados.add(n.toLowerCase());
    return n;
  });
}
// Ancho de las columnas nuevas (la plantilla trae anchos angostos desde la X).
export function ajustarAnchoColumnas(xml, desde, hasta, ancho = 18){
  if(hasta < desde) return xml;
  return xml.replace(/<cols>([\s\S]*?)<\/cols>/, (m, cuerpo)=>{
    const cols = [...cuerpo.matchAll(/<col\b([^>]*?)\/>/g)].map(x=>({ min: Number((/\bmin="(\d+)"/.exec(x[1]) || [])[1]), max: Number((/\bmax="(\d+)"/.exec(x[1]) || [])[1]), a: x[1] }));
    const out = [];
    for(const c of cols){
      if(!(c.min <= hasta && c.max >= desde)){ out.push(c); continue; }
      if(c.min < desde) out.push({ min: c.min, max: desde - 1, a: c.a.replace(/\bmax="\d+"/, `max="${desde - 1}"`) });
      if(c.max > hasta) out.push({ min: hasta + 1, max: c.max, a: c.a.replace(/\bmin="\d+"/, `min="${hasta + 1}"`) });
    }
    out.push({ min: desde, max: hasta, a: ` min="${desde}" max="${hasta}" width="${ancho}" style="8" customWidth="1"` });
    out.sort((x, y)=>x.min - y.min);
    return `<cols>${out.map(c=>`<col${c.a}/>`).join("")}</cols>`;
  });
}

export function etiquetaCustodioTipo(tipo){
  if(tipo==="area") return "Área / departamento";
  if(tipo==="mantenimiento") return "Mantenimiento";
  if(tipo==="persona") return "Persona";
  return "";
}

export async function exportarActivosExcel(){
  const datos = cargarActivos();
  const lista = listaOrdenadaFiltrada(datos);
  if(lista.length===0){ mostrarToast("No hay activos que coincidan con los filtros actuales.", "error"); return; }

  const resp = await fetch("assets/plantillas/ActivosTecnologicos.xlsx");
  if(!resp.ok) throw new Error("No se pudo cargar la plantilla (assets/plantillas/ActivosTecnologicos.xlsx).");
  const buf = await resp.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);

  // Hoja 1 "Computadores": un renglón por activo filtrado.
  let xml1 = await zip.file("xl/worksheets/sheet1.xml").async("string");
  // La fila 8 (nota amarilla "Fila de plantilla — no borrar…") es para quien
  // abra la plantilla en crudo, no para un reporte ya generado — se quita acá.
  xml1 = xml1.replace(/<row r="8"[^>]*>.*?<\/row>/s, "");
  const extras = ordenarCampos(camposNuevosActivos());
  const nCols = COLS_LISTADO_ACTIVOS.length + extras.length;
  const columnas = [...COLS_LISTADO_ACTIVOS, ...extras.map((_, i)=>letraColumna(COLS_LISTADO_ACTIVOS.length + 1 + i))];
  const estilos = [...ESTILOS_LISTADO_ACTIVOS, ...extras.map(()=>28)];
  const ultima = columnas[columnas.length - 1];
  const filas1 = lista.map((a,i)=>{
    const tipoCfg = configTipo(a.tipo);
    const valores = [
      fmtTag(a), a.propiedad==="eq"?"EQ Soluciones":"Lukmar", a.tipo||"", a.marca||"", a.modelo||"",
      a.serie||"", a.nombre_dispositivo||"", infoPropiedad(a.propiedad).label||"",
      a.custodio?a.custodio.nombre:"Disponible", a.custodio?etiquetaCustodioTipo(a.custodio.tipo_custodio):"",
      a.custodio?(a.custodio.cargo||""):"", a.sistema_operativo||"", a.ram_gb??"", a.disco_gb??"",
      a.procesador||"", a.mac_wifi||"", a.mac_ethernet||"", a.proveedor||"", a.fecha_adquisicion||"",
      a.valor_compra??"", valorActualActivo(a)??"", a.color||"", a.longitud_m??"",
      ...extras.map(d=>aplicaATipo(d, tipoCfg) ? valorParaExcel(d, valorCrudo(a, d)) : ""),
    ];
    return filaXML(10+i, estilos, columnas, valores);
  }).join("");
  xml1 = xml1.replace(/<row r="10"[^>]*>.*?<\/row>/s, filas1);
  xml1 = xml1.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${ultima}${9+lista.length}"/>`);
  let nombresExtra = [];
  if(extras.length){
    const tablaXml = await zip.file("xl/tables/table1.xml").async("string");
    const existentes = [...tablaXml.matchAll(/<tableColumn\b[^>]*\bname="([^"]*)"/g)].map(m=>m[1]);
    // Con la unidad, como las de la plantilla («Ram (GB)», «Longitud (m)»).
    nombresExtra = nombresColumnasExtra(extras.map(d=>etiquetaConUnidad(d)), existentes);
    // Encabezados en la fila 9 (texto en línea, como las celdas de datos).
    const encabezados = nombresExtra.map((n, i)=>celdaInline(columnas[COLS_LISTADO_ACTIVOS.length + i], 9, 25, n)).join("");
    xml1 = xml1.replace(/(<row r="9"[^>]*>)(.*?)(<\/row>)/s, (m, abre, cuerpo, cierra)=>abre.replace(/spans="[^"]*"/, `spans="1:${nCols}"`) + cuerpo + encabezados + cierra);
    xml1 = ajustarAnchoColumnas(xml1, COLS_LISTADO_ACTIVOS.length + 1, nCols);
  }
  zip.file("xl/worksheets/sheet1.xml", xml1);

  // tblComputadores es una Tabla real de Excel (no solo celdas con estilo):
  // su propio ref y el autoFilter que la acompaña también delimitan A9:W10
  // en la plantilla y hay que expandirlos junto con el <dimension> de la
  // hoja, o Excel abre el archivo con la Tabla encogida a la fila original.
  let tabla1 = await zip.file("xl/tables/table1.xml").async("string");
  tabla1 = tabla1.split('ref="A9:W10"').join(`ref="A9:${ultima}${9+lista.length}"`);
  if(extras.length){
    tabla1 = tabla1.replace(/<tableColumns count="\d+">/, `<tableColumns count="${nCols}">`);
    tabla1 = tabla1.replace("</tableColumns>", nombresExtra.map((n, i)=>`<tableColumn id="${COLS_LISTADO_ACTIVOS.length + 1 + i}" name="${escXml(n)}"/>`).join("") + "</tableColumns>");
  }
  zip.file("xl/tables/table1.xml", tabla1);

  // Hoja 2 "historial_custodia": un renglón por tramo de cada activo filtrado,
  // en orden cronológico (1 = más antiguo) — el array en memoria viene más
  // reciente primero, así que se invierte por activo antes de numerar.
  let xml2 = await zip.file("xl/worksheets/sheet2.xml").async("string");
  const filas2 = [];
  let filaActual = 4;
  lista.forEach(a=>{
    const cronologico = [...a.historial_custodia].reverse();
    cronologico.forEach((t,idx)=>{
      const valores = [fmtTag(a), t.nombre||"", etiquetaCustodioTipo(t.tipo_custodio), t.cargo||"", t.desde||"", t.hasta||"", idx+1];
      filas2.push(filaXML(filaActual, ESTILOS_LISTADO_HISTORIAL, COLS_LISTADO_HISTORIAL, valores));
      filaActual++;
    });
  });
  const totalFilasHist = filaActual - 4;
  xml2 = xml2.replace(/<row r="4"[^>]*>.*?<\/row>/s, filas2.join(""));
  xml2 = xml2.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:G${Math.max(4,3+totalFilasHist)}"/>`);
  zip.file("xl/worksheets/sheet2.xml", xml2);

  // Mismo motivo que tblComputadores: tblHistorialCustodia también es una
  // Tabla real (A3:G4 en la plantilla) y necesita su ref/autoFilter propios
  // expandidos, con el mismo piso mínimo que el dimension de la hoja.
  let tabla2 = await zip.file("xl/tables/table2.xml").async("string");
  tabla2 = tabla2.split('ref="A3:G4"').join(`ref="A3:G${Math.max(4,3+totalFilasHist)}"`);
  zip.file("xl/tables/table2.xml", tabla2);

  // {{FECHA_ACTUALIZACION}} es un marcador único (F7/G7), no uno que se
  // duplique por fila — este sí se puede reemplazar in-place en sharedStrings.xml.
  let shared = await zip.file("xl/sharedStrings.xml").async("string");
  shared = shared.split("{{FECHA_ACTUALIZACION}}").join(fechaEnPalabras(hoyISO()));
  zip.file("xl/sharedStrings.xml", shared);

  const salida = await zip.generateAsync({type:"blob"});
  const url = URL.createObjectURL(salida);
  const link = document.createElement("a");
  link.href = url; link.download = `Listado_Activos_${hoyISO()}.xlsx`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
