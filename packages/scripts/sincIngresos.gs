// sincIngresos.gs — V2 (reescrito)
// Correcciones vs V1:
//   - Mapeo corregido: articulo_id de fila[2] (Col C), ingreso_id de fila[0] (Col A)
//   - UPSERT via ?on_conflict=ingreso_id + Prefer: resolution=merge-duplicates
//   - Hash MD5 calculado en JS (misma fórmula que compute_ingreso_hash en Supabase)
//   - Comparación de hash antes de enviar (skip si hash igual → no dispara triggers)
//   - sincIngresos_full() para resync completo sin filtro de fecha

const HOJA_INGRESOS_SINC = 'Ingresos';
const BATCH_SIZE_SINC_ING = 200;

// ─────────────────────────────────────────────────────────────────────
// MD5 en Apps Script (Utilities.computeDigest devuelve bytes → hex string)
// ─────────────────────────────────────────────────────────────────────
function md5(texto) {
  var rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    texto,
    Utilities.Charset.UTF_8
  );
  return rawBytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// Fórmula IDÉNTICA a compute_ingreso_hash en Supabase:
// MD5( articulo_id|cantidad|guia|transportista|tipo_ingreso|notas|fecha|operador_id )
function computeIngresoHash(articulo_id, cantidad, guia, transportista, tipo_ingreso, notas, fecha, operador_id) {
  var partes = [
    articulo_id   || '',
    String(cantidad !== null && cantidad !== undefined ? cantidad : ''),
    guia          || '',
    transportista || '',
    tipo_ingreso  || '',
    notas         || '',
    fecha         || '',
    operador_id   || ''
  ];
  return md5(partes.join('|'));
}

// ─────────────────────────────────────────────────────────────────────
// Parsers
// ─────────────────────────────────────────────────────────────────────
function parseFechaSincIngreso(valor) {
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

// ─────────────────────────────────────────────────────────────────────
// Mapeo de fila → objeto (MAPEO CORREGIDO)
// Col A [0]: ID ingreso         → ingreso_id
// Col B [1]: # ingreso          → (no se envía)
// Col C [2]: Artículo           → articulo_id ← CORREGIDO (antes era fila[0])
// Col D [3]: Cantidad           → cantidad
// Col E [4]: Guía               → guia
// Col F [5]: Transportista      → transportista
// Col G [6]: Tipo de ingreso    → tipo_ingreso
// Col H [7]: Nota               → notas
// Col I [8]: Fecha              → fecha
// Col J [9]: Operador           → operador_id
// Col K-M [10-12]: Imágenes     → imagenes[]
// ─────────────────────────────────────────────────────────────────────
function filaAObjetoSincIngreso(fila) {
  var ingresoId  = fila[0] ? String(fila[0]).trim() : '';
  var articuloId = fila[2] ? String(fila[2]).trim() : ''; // CORREGIDO: Col C
  if (!articuloId) return null; // rechazar solo si falta articulo_id

  var cant  = fila[3] !== '' && fila[3] !== null ? parseInt(fila[3], 10) : 0;
  var guia  = fila[4] ? String(fila[4]).trim() : null;
  var tr    = fila[5] ? String(fila[5]).trim() : null;
  var tipo  = fila[6] ? String(fila[6]).trim() : null;
  var notas = fila[7] ? String(fila[7]).trim() : null;
  var fecha = parseFechaSincIngreso(fila[8]);
  var op    = fila[9] ? String(fila[9]).trim() : null;
  var imgs  = [fila[10], fila[11], fila[12]]
    .map(function(x) { return x ? String(x).trim() : ''; })
    .filter(function(x) { return x !== ''; });

  var hash = computeIngresoHash(articuloId, isNaN(cant) ? 0 : cant, guia, tr, tipo, notas, fecha, op);

  return {
    ingreso_id:   ingresoId || null,
    articulo_id:  articuloId,
    cantidad:     isNaN(cant) ? 0 : cant,
    guia:         guia,
    transportista: tr,
    tipo_ingreso: tipo,
    notas:        notas,
    fecha:        fecha,
    operador_id:  op,
    imagenes:     imgs.length > 0 ? imgs : null,
    sync_hash:    hash
  };
}

// ─────────────────────────────────────────────────────────────────────
// Obtener hashes existentes en Supabase para un lote de ingreso_ids
// ─────────────────────────────────────────────────────────────────────
function getHashesExistentes(ingresoids) {
  var ids = ingresoids.filter(function(id) { return id; });
  if (ids.length === 0) return {};

  // PostgREST: ingreso_id=in.(id1,id2,...)
  var filtro = 'ingreso_id=in.(' + ids.map(function(id) { return encodeURIComponent(id); }).join(',') + ')';
  var url = SUPABASE_URL + '/rest/v1/ingresos?select=ingreso_id,sync_hash&' + filtro;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return {};
  var data = JSON.parse(resp.getContentText());
  var mapa = {};
  data.forEach(function(row) { mapa[row.ingreso_id] = row.sync_hash; });
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────
// UPSERT de un lote (INSERT o UPDATE si ingreso_id ya existe)
// ─────────────────────────────────────────────────────────────────────
function upsertLoteIngresos(lote) {
  var url = SUPABASE_URL + '/rest/v1/ingresos?on_conflict=ingreso_id';
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
// sincIngresos() — incremental (filtra por MAX fecha, skip si hash igual)
// ─────────────────────────────────────────────────────────────────────
function sincIngresos() {
  _sincIngresosPorFecha_(true);
}

// sincIngresos_full() — sin filtro de fecha, re-envía todo (para forzar resync manual)
function sincIngresos_full() {
  _sincIngresosPorFecha_(false);
}

function _sincIngresosPorFecha_(soloNuevos) {
  var maxFecha = null;
  if (soloNuevos) {
    var urlMax = SUPABASE_URL + '/rest/v1/ingresos?select=fecha&order=fecha.desc&limit=1';
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
  var hoja = ss.getSheetByName(HOJA_INGRESOS_SINC);
  if (!hoja) { Logger.log('Hoja "' + HOJA_INGRESOS_SINC + '" no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  var upsertados = 0, saltados = 0, filtrados = 0, omitidos = 0, errores = 0, primerError = '';

  var filaInicio = 2;
  while (filaInicio <= ultimaFila) {
    var filaFin = Math.min(filaInicio + BATCH_SIZE_SINC_ING - 1, ultimaFila);
    var datos = hoja.getRange(filaInicio, 1, filaFin - filaInicio + 1, 13).getValues();
    var candidatos = [];

    for (var i = 0; i < datos.length; i++) {
      var obj = filaAObjetoSincIngreso(datos[i]);
      if (!obj) { omitidos++; continue; }

      // FIX: solo filtrar por fecha si la fila NO tiene ingreso_id.
      // Filas CON ingreso_id: siempre pasan → el hash comparison decide si hay cambio.
      // Filas SIN ingreso_id: filtrar por fecha para evitar duplicados infinitos.
      // Sin esta distinción, ingresos retroactivos de Sheets eran ignorados permanentemente.
      if (soloNuevos && maxFecha && obj.fecha && !obj.ingreso_id) {
        if (new Date(obj.fecha) <= maxFecha) { filtrados++; continue; }
      }
      candidatos.push(obj);
    }

    // Comparar hashes: solo enviar los que cambiaron
    var lote = [];
    if (candidatos.length > 0) {
      var idsConId = candidatos.map(function(o) { return o.ingreso_id; });
      var hashesExistentes = getHashesExistentes(idsConId);

      candidatos.forEach(function(obj) {
        var hashActual = hashesExistentes[obj.ingreso_id];
        if (obj.ingreso_id && hashActual && hashActual === obj.sync_hash) {
          saltados++; // sin cambios, skip
        } else {
          lote.push(obj);
        }
      });
    }

    if (lote.length > 0) {
      var resp = upsertLoteIngresos(lote);
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

  Logger.log('=== sincIngresos' + (soloNuevos ? '' : '_full') + ' FINAL ===');
  Logger.log('Upsertados: ' + upsertados);
  Logger.log('Saltados (hash igual, sin cambios): ' + saltados);
  Logger.log('Filtrados (ya en Supabase por fecha): ' + filtrados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}
