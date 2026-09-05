// MigrarEgresos.gs - Paso 4.2 + 4.3
const HOJA_EGRESOS = 'Egresos';
const HOJA_IMPORTAR = 'ImportarEgresos';
const BATCH_SIZE_EGR = 200;

function parseFechaEgreso(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  var str = String(valor).trim();
  if (!str) return null;
  var partes = str.split(' ');
  var fp = partes[0].split('/');
  if (fp.length !== 3) return null;
  var d = new Date(fp[2] + '-' + fp[1].padStart(2,'0') + '-' + fp[0].padStart(2,'0') + 'T' + (partes.length > 1 ? partes[1] : '00:00:00'));
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mapTipoEgreso(valor) {
  if (!valor) return null;
  var v = String(valor).trim().toLowerCase();
  if (v === 'venta' || v.indexOf('venta') >= 0) return 'venta';
  if (v.indexOf('full') >= 0 || v.indexOf('envio') >= 0 || v.indexOf('env\u00edo') >= 0) return 'envio_full';
  if (v.indexOf('devol') >= 0) return 'devolucion_proveedor';
  return 'otro';
}

function filaAObjetoEgreso(fila) {
  var art = fila[2] ? String(fila[2]).trim() : '';
  var cant = fila[3] ? parseInt(fila[3], 10) : 0;
  if (!art && cant === 0) return null;
  var guia = fila[4] ? String(fila[4]).trim() : null;
  var transp = fila[5] ? String(fila[5]).trim() : null;
  var tipo = mapTipoEgreso(fila[6]);
  var nota = fila[7] ? String(fila[7]).trim() : null;
  var fecha = parseFechaEgreso(fila[8]);
  var operador = fila[9] ? String(fila[9]).trim() : null;
  var imgs = [fila[10], fila[11], fila[12]].map(function(x) {
    return x ? String(x).trim() : '';
  }).filter(function(x) { return x !== ''; });
  var largo = fila[13] ? parseFloat(fila[13]) : null;
  var ancho = fila[14] ? parseFloat(fila[14]) : null;
  var alto = fila[15] ? parseFloat(fila[15]) : null;
  var peso = fila[16] ? parseFloat(fila[16]) : null;
  var salidas = fila[17] ? parseInt(fila[17], 10) : null;
  var codigoMl = fila[18] ? String(fila[18]).trim() : null;
  var edoReunido = fila[19] ? String(fila[19]).trim() : null;
  var fechaReunido = parseFechaEgreso(fila[20]);
  var fechaPreparado = parseFechaEgreso(fila[21]);
  var importarEgreso = fila[22] ? String(fila[22]).trim() : null;
  return {
    articulo_id: art || null,
    cantidad: cant || 0,
    tipo_egreso: tipo || 'otro',
    guia: guia,
    transportista: transp,
    notas: nota,
    creado_el: fecha,
    operador_id: operador,
    imagenes: imgs.length > 0 ? imgs : null,
    largo: largo,
    ancho: ancho,
    alto: alto,
    peso: peso,
    salidas_periodo: salidas,
    codigo_ml: codigoMl,
    edo_reunido: edoReunido,
    fecha_reunido: fechaReunido,
    fecha_preparado: fechaPreparado,
    importacion_full_id: importarEgreso,
    origin: 'sheets'
  };
}

function insertLoteEgresos(lote) {
  var url = SUPABASE_URL + '/rest/v1/egresos';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(lote),
    muteHttpExceptions: true
  };
  return UrlFetchApp.fetch(url, options);
}

function migrarEgresosASupabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS);
  if (!hoja) { Logger.log('No se encontro hoja ' + HOJA_EGRESOS); return; }
  var datos = hoja.getDataRange().getValues();
  var filas = datos.slice(1);
  Logger.log('Egresos: ' + filas.length + ' filas encontradas');
  var lote = [], insertados = 0, omitidos = 0, erroresHTTP = [];
  for (var i = 0; i < filas.length; i++) {
    var obj = filaAObjetoEgreso(filas[i]);
    if (!obj) { omitidos++; continue; }
    lote.push(obj);
    if (lote.length >= BATCH_SIZE_EGR) {
      var resp = insertLoteEgresos(lote);
      if (resp.getResponseCode() >= 300) {
        erroresHTTP.push('Lote ' + Math.floor(i / BATCH_SIZE_EGR) + ': ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
        // CIRCUIT BREAKER (2026-07-04): backend caido (5xx/522) -> abortar el bucle.
if (resp.getResponseCode() >= 500) {
Logger.log('CIRCUIT BREAKER: HTTP ' + resp.getResponseCode() + ' - backend caido. Se aborta migrarEgresos.');
break;
} 
      } else { insertados += lote.length; }
      lote = [];
    }
  }
  if (lote.length > 0) {
    var resp = insertLoteEgresos(lote);
    if (resp.getResponseCode() >= 300) {
      erroresHTTP.push('Ultimo: ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
    } else { insertados += lote.length; }
  }
  var msg = 'Egresos manuales completado.\nInsertados: ' + insertados + '\nOmitidos: ' + omitidos + '\n' + (erroresHTTP.length > 0 ? 'ERRORES:\n' + erroresHTTP.join('\n') : '0 errores HTTP');
  Logger.log(msg);
  Browser.msgBox(msg);
}

// --- Paso 4.2: ImportarEgresos ---
function migrarImportarEgresosASupabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_IMPORTAR);
  if (!hoja) { Logger.log('No se encontro hoja ' + HOJA_IMPORTAR); return; }
  var datos = hoja.getDataRange().getValues();
  var headers = datos[0];
  var filas = datos.slice(1);
  Logger.log('ImportarEgresos: ' + filas.length + ' filas, headers: ' + headers.join(', '));
  var colMap = {};
  for (var h = 0; h < headers.length; h++) { colMap[String(headers[h]).trim()] = h; }
  var lote = [], insertados = 0, omitidos = 0, erroresHTTP = [];
  for (var i = 0; i < filas.length; i++) {
    var f = filas[i];
    var guia = colMap['Guia'] !== undefined ? (f[colMap['Guia']] ? String(f[colMap['Guia']]).trim() : null) : null;
    var cant = colMap['Unidades'] !== undefined ? (f[colMap['Unidades']] ? parseInt(f[colMap['Unidades']], 10) : 0) : 0;
    var fecha = colMap['Fecha'] !== undefined ? parseFechaEgreso(f[colMap['Fecha']]) : null;
    var codigoML = colMap['CodigoML'] !== undefined ? (f[colMap['CodigoML']] ? String(f[colMap['CodigoML']]).trim() : null) : null;
    var skuML = colMap['SKU_ML'] !== undefined ? (f[colMap['SKU_ML']] ? String(f[colMap['SKU_ML']]).trim() : null) : null;
    var skuInv = colMap['SKU_Inventario'] !== undefined ? (f[colMap['SKU_Inventario']] ? String(f[colMap['SKU_Inventario']]).trim() : null) : null;
    var idImp = colMap['IDImportacion'] !== undefined ? (f[colMap['IDImportacion']] ? String(f[colMap['IDImportacion']]).trim() : null) : null;
    var articulo = skuInv || codigoML || skuML || null;
    if (!articulo && cant === 0) { omitidos++; continue; }
    var obj = {
      articulo_id: articulo,
      cantidad: cant || 0,
      tipo_egreso: 'venta_ml',
      guia: guia,
      creado_el: fecha,
      codigo_ml: codigoML,
      importacion_full_id: idImp
    };
    lote.push(obj);
    if (lote.length >= BATCH_SIZE_EGR) {
      var resp = insertLoteEgresos(lote);
      if (resp.getResponseCode() >= 300) {
        erroresHTTP.push('Lote ' + Math.floor(i / BATCH_SIZE_EGR) + ': ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
      } else { insertados += lote.length; }
      lote = [];
    }
  }
  if (lote.length > 0) {
    var resp = insertLoteEgresos(lote);
    if (resp.getResponseCode() >= 300) {
      erroresHTTP.push('Ultimo: ' + resp.getResponseCode() + ' ' + resp.getContentText().substring(0, 200));
    } else { insertados += lote.length; }
  }
  var msg = 'ImportarEgresos completado.\nInsertados: ' + insertados + '\nOmitidos: ' + omitidos + '\n' + (erroresHTTP.length > 0 ? 'ERRORES:\n' + erroresHTTP.join('\n') : '0 errores HTTP');
  Logger.log(msg);
  Browser.msgBox(msg);
}