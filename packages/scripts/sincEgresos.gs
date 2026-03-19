// sincEgresos.gs — V2 (reescrito)
// Correcciones vs V1:
//   - Mapeo corregido: articulo_id de fila[2] (Col C), egreso_id de fila[0] (Col A)
//   - UPSERT via ?on_conflict=egreso_id + Prefer: resolution=merge-duplicates
//   - Hash MD5 calculado en JS (misma fórmula que compute_egreso_hash en Supabase)
//   - Comparación de hash antes de enviar (skip si hash igual)
//   - sincEgresos_full() para resync completo sin filtro de fecha

const HOJA_EGRESOS_SINC = 'Egresos';
const BATCH_SIZE_SINC_EGR = 200;

// ─────────────────────────────────────────────────────────────────────
// MD5 helper (misma implementación que sincIngresos.gs)
// ─────────────────────────────────────────────────────────────────────
function md5Egreso(texto) {
  var rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    texto,
    Utilities.Charset.UTF_8
  );
  return rawBytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// Fórmula IDÉNTICA a compute_egreso_hash en Supabase.
// NOTA: Comet agregó columna `fecha` a egresos (19-mar-2026) y actualizó compute_egreso_hash.
// `fecha` = fecha real del egreso desde Sheets (Col I).
// `creado_el` = timestamp automático del sistema, NO se sincroniza desde Sheets.
function computeEgresoHash(articulo_id, cantidad, tipo_egreso, importacion_full_id, guia,
                            transportista, operador_id, notas, largo, ancho, alto, peso,
                            salidas_periodo, codigo_ml, edo_reunido, fecha_reunido, fecha_preparado, fecha) {
  var partes = [
    articulo_id        || '',
    String(cantidad !== null && cantidad !== undefined ? cantidad : ''),
    tipo_egreso        || '',
    importacion_full_id|| '',
    guia               || '',
    transportista      || '',
    operador_id        || '',
    notas              || '',
    String(largo       || ''),
    String(ancho       || ''),
    String(alto        || ''),
    String(peso        || ''),
    String(salidas_periodo || ''),
    codigo_ml          || '',
    edo_reunido        || '',
    fecha_reunido      || '',
    fecha_preparado    || '',
    fecha              || ''  // campo nuevo agregado por Comet 19-mar-2026
  ];
  return md5Egreso(partes.join('|'));
}

// ─────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────
function parseFechaSincEgreso(valor) {
  if (!valor) return null;
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
  }
  var str = String(valor).trim();
  if (!str) return null;
  var partes = str.split(' ');
  var fp = partes[0].split('/');
  if (fp.length !== 3) return null;
  var d = new Date(
    fp[2] + '-' + fp[1].padStart(2, '0') + '-' + fp[0].padStart(2, '0') +
    'T' + (partes.length > 1 ? partes[1] : '00:00:00')
  );
  if (isNaN(d.getTime())) return null;
  return Utilities.formatDate(d, 'America/Mexico_City', "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function mapTipoEgresoSinc(valor) {
  if (!valor) return 'otro';
  var v = String(valor).trim().toLowerCase();
  if (v.indexOf('venta') !== -1) return 'venta';
  if (v.indexOf('full') !== -1 || v.indexOf('fulfillment') !== -1) return 'envio_full';
  if (v.indexOf('devolucion') !== -1 || v.indexOf('devolución') !== -1 ||
      v.indexOf('proveedor') !== -1) return 'devolucion_proveedor';
  return 'otro';
}

// ─────────────────────────────────────────────────────────────────────
// Mapeo de fila → objeto (MAPEO CORREGIDO)
// Col A [0]: ID Egreso          → egreso_id
// Col B [1]: # egreso           → (no se envía)
// Col C [2]: Artículo           → articulo_id ← CORREGIDO (antes era fila[0])
// Col D [3]: Cantidad           → cantidad
// Col E [4]: Guía               → guia
// Col F [5]: Transportista      → transportista
// Col G [6]: Tipo de egreso     → tipo_egreso (normalizado)
// Col H [7]: Nota               → notas
// Col I [8]: Fecha              → fecha (fecha real del egreso)
// Col J [9]: Operador           → operador_id
// Col K [10]: (varía según sheet)
// Col N [13]: Largo             → largo (hash)
// Col O [14]: Ancho             → ancho (hash)
// Col P [15]: Alto              → alto (hash)
// Col Q [16]: Peso              → peso (hash)
// Col R [17]: Salidas período  → salidas_periodo (hash)
// Col S [18]: Código ML        → codigo_ml (hash)
// Col T [19]: Estado reunido    → edo_reunido (hash)
// Col U [20]: Fecha reunido     → fecha_reunido (hash)
// Col V [21]: Fecha preparado   → fecha_preparado (hash)
// (Ajustar índices si la hoja real difiere)
// ──────────────────────────────────────────────────────────────────────
function filaAObjetoSincEgreso(fila) {
  var egresoId   = fila[0] ? String(fila[0]).trim() : '';
  var articuloId = fila[2] ? String(fila[2]).trim() : ''; // CORREGIDO: Col C
  if (!articuloId) return null;

  var cant  = fila[3] !== '' && fila[3] !== null ? parseInt(fila[3], 10) : 0;
  var guia  = fila[4] ? String(fila[4]).trim() : null;
  var tr    = fila[5] ? String(fila[5]).trim() : null;
  var tipo  = mapTipoEgresoSinc(fila[6]);
  var notas = fila[7] ? String(fila[7]).trim() : null;
  var fecha = parseFechaSincEgreso(fila[8]);
  var op    = fila[9] ? String(fila[9]).trim() : null;

  // FIX 1: Campos adicionales (cols N-V, índices 13-21) para hash completo
  var largo          = fila[13] || null;
  var ancho          = fila[14] || null;
  var alto           = fila[15] || null;
  var peso           = fila[16] || null;
  var salidasPeriodo = fila[17] || null;
  var codigoMl       = fila[18] ? String(fila[18]).trim() : null;
  var edoReunido     = fila[19] ? String(fila[19]).trim() : null;
  var fechaReunido   = parseFechaSincEgreso(fila[20]);
  var fechaPreparado = parseFechaSincEgreso(fila[21]);

  var hash = computeEgresoHash(
    articuloId, isNaN(cant) ? 0 : cant, tipo, null, guia,
    tr, op, notas,
    largo, ancho, alto, peso, salidasPeriodo, codigoMl,
    edoReunido, fechaReunido, fechaPreparado, fecha
  );

  return {
    egreso_id:    egresoId || null,
    articulo_id:  articuloId,
    cantidad:     isNaN(cant) ? 0 : cant,
    tipo_egreso:  tipo,
    guia:         guia,
    transportista: tr,
    notas:        notas,
    fecha:        fecha,
    operador_id:  op,
    sync_hash:    hash
  };
}

// ─────────────────────────────────────────────────────────────────────
// Obtener hashes existentes en Supabase para un lote de egreso_ids
// ─────────────────────────────────────────────────────────────────────
function getHashesExistentesEgresos(egresoIds) {
  var ids = egresoIds.filter(function(id) { return id; });
  if (ids.length === 0) return {};
  var filtro = 'egreso_id=in.(' + ids.map(function(id) { return encodeURIComponent(id); }).join(',') + ')';
  var url = SUPABASE_URL + '/rest/v1/egresos?select=egreso_id,sync_hash&' + filtro;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return {};
  var data = JSON.parse(resp.getContentText());
  var mapa = {};
  data.forEach(function(row) { mapa[row.egreso_id] = row.sync_hash; });
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────
// UPSERT de un lote
// ─────────────────────────────────────────────────────────────────────
function upsertLoteSincEgresos(lote) {
  var url = SUPABASE_URL + '/rest/v1/egresos?on_conflict=egreso_id';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'return=minimal,resolution=merge-duplicates'
    },
    payload: JSON.stringify(lote),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  return { code: response.getResponseCode(), body: response.getContentText() };
}

// ─────────────────────────────────────────────────────────────────────
// sincEgresos() — incremental | sincEgresos_full() — resync completo
// ─────────────────────────────────────────────────────────────────────
function sincEgresos() {
  _sincEgresosPorFecha_(true);
}

function sincEgresos_full() {
  _sincEgresosPorFecha_(false);
}

function _sincEgresosPorFecha_(soloNuevos) {
  var maxFecha = null;
  if (soloNuevos) {
    // FIX 2: filtrar por fecha (campo real) no por creado_el (timestamp del sistema)
    var urlMax = SUPABASE_URL + '/rest/v1/egresos?select=fecha&order=fecha.desc&limit=1';
    var rMax = UrlFetchApp.fetch(urlMax, {
      method: 'get',
      headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
      muteHttpExceptions: true
    });
    if (rMax.getResponseCode() === 200) {
      var dMax = JSON.parse(rMax.getContentText());
      if (dMax && dMax.length > 0) maxFecha = new Date(dMax[0].fecha);
    }
    Logger.log('Modo incremental. MAX fecha en Supabase: ' + (maxFecha ? maxFecha.toISOString() : 'ninguna'));
  } else {
    Logger.log('Modo FULL — re-enviando todos los registros');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_EGRESOS_SINC);
  if (!hoja) { Logger.log('Hoja "' + HOJA_EGRESOS_SINC + '" no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  var upsertados = 0, saltados = 0, filtrados = 0, omitidos = 0, errores = 0, primerError = '';

  var filaInicio = 2;
  while (filaInicio <= ultimaFila) {
    var filaFin = Math.min(filaInicio + BATCH_SIZE_SINC_EGR - 1, ultimaFila);
    // FIX 3: leer 23 columnas (A-W) para capturar largo/ancho/alto/peso/etc. en hash
    var datos = hoja.getRange(filaInicio, 1, filaFin - filaInicio + 1, 23).getValues();
    var candidatos = [];

    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincEgreso(datos[i]);
      if (!obj) { omitidos++; continue; }
      // FIX 2: comparar obj.fecha (no obj.creado_el que ya no existe)
      if (soloNuevos && maxFecha && obj.fecha) {
        if (new Date(obj.fecha) <= maxFecha) { filtrados++; continue; }
      }
      candidatos.push(obj);
    }

    var lote = [];
    if (candidatos.length > 0) {
      var ids = candidatos.map(function(o) { return o.egreso_id; });
      var hashesActuales = getHashesExistentesEgresos(ids);
      candidatos.forEach(function(obj) {
        var hashActual = hashesActuales[obj.egreso_id];
        if (obj.egreso_id && hashActual && hashActual === obj.sync_hash) {
          saltados++;
        } else {
          lote.push(obj);
        }
      });
    }

    if (lote.length > 0) {
      var resp = upsertLoteSincEgresos(lote);
      if (resp.code >= 300) {
        errores++;
        if (!primerError) primerError = 'Lote fila ' + filaInicio + ': HTTP ' + resp.code + ' — ' + resp.body.substring(0, 300);
      } else {
        upsertados += lote.length;
      }
    }

    Utilities.sleep(200);
    filaInicio = filaFin + 1;
  }

  Logger.log('=== sincEgresos' + (soloNuevos ? '' : '_full') + ' FINAL ===');
  Logger.log('Upsertados: ' + upsertados);
  Logger.log('Saltados (sin cambios): ' + saltados);
  Logger.log('Filtrados (ya en Supabase por fecha): ' + filtrados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}
