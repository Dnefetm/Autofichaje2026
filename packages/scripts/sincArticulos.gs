// sincArticulos.gs
// Sincroniza la hoja "Artículos" de Google Sheets a la tabla `articulos` de Supabase.
//
// Columnas de la hoja "Artículos" (validadas contra inventario_Artículos_muestra.csv):
//   A (0)  = articulo_id         — PK, identificador único
//   B (1)  = nombre              — nombre completo del artículo
//   C (2)  = marca
//   D (3)  = modelo
//   E (4)  = variante
//   F (5)  = categoria
//   G (6)  = disponibles         — stock base (NO se sobreescribe si ya existe en Supabase)
//   H (7)  = hora_registro       — se ignora en sync
//   I (8)  = ubicacion           — se ignora (manejado por ubicaciones)
//   J (9)  = caja_madre
//   K (10) = reordenar_cuando    — se ignora
//   L (11) = codigo_universal    — código de barras principal
//   M (12) = codigo_barras_meli  — seller_custom_field (se ignora en articulos)
//   N (13) = modificar_pub_ml    — se ignora
//   O (14) = ver_publicacion     — url_producto
//   P (15) = req_fotografia      — se ignora
//   Q (16) = nota                — notas
//   R (17) = nom050              — importador_id referencia (nombre, no UUID — se ignora)
//   S (18) = codigo_sat
//   T (19) = dimensiones_texto   — se ignora (usamos largo/ancho/alto separados)
//   U (20) = peso_kg
//   V (21) = imagen_1            — imagenes[0]
//   W (22) = imagen_2            — imagenes[1]
//   X (23) = imagen_3            — imagenes[2]
//   Y (24) = es_full
//   Z (25) = eliminable          — se ignora
//   AA(26) = obligatorio/embalaje — se ignora
//   AB(27) = descripcion
//   AC(28) = largo_cm
//   AD(29) = ancho_cm
//   AE(30) = alto_cm
//   AF(31) = precio_objetivo     — se ignora (manejado por informacion_comercial)
//   AG(32) = stock_actual        — se ignora (lo calcula fn_recalcular_stock)
//   AH(33) = stock_minimo        — se ignora
//   AI(34) = dropshipping        — es_dropshipping
//
// UPSERT por articulo_id (PK). No sobreescribe disponibles si el artículo ya existe.
// El trigger trg_auto_create_inventory_snapshot crea el snapshot al insertar artículo nuevo.
//
// Usa SUPABASE_URL y SUPABASE_SERVICE_KEY definidas en config.gs o globals.gs

const HOJA_ARTICULOS_SINC = 'Artículos';
const BATCH_SIZE_SINC_ART = 50; // Conservador: rows tienen muchas columnas

// ─────────────────────────────────────────────────────────────────────
// Parsers helpers
// ─────────────────────────────────────────────────────────────────────
function parseBooleanoArt(valor) {
  if (!valor) return false;
  var s = String(valor).trim().toLowerCase();
  return s === 'sí' || s === 'si' || s === 'yes' || s === 'true' || s === '1';
}

function parseNumeroArt(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  var n = parseFloat(String(valor).replace(',', '.'));
  return isNaN(n) ? null : n;
}

function parseTextoArt(valor) {
  if (valor === null || valor === undefined) return null;
  var s = String(valor).trim();
  return s === '' ? null : s;
}

function parseImagenesArt(img1, img2, img3) {
  var imgs = [img1, img2, img3]
    .map(function(v) { return parseTextoArt(v); })
    .filter(function(v) { return v !== null; });
  return imgs.length > 0 ? imgs : null;
}

// ─────────────────────────────────────────────────────────────────────
// sincArticulos — sincronización incremental (upsert, no borra)
// Llama fromRow=2 para toda la hoja. Filtra filas sin articulo_id.
// ─────────────────────────────────────────────────────────────────────
function sincArticulos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_ARTICULOS_SINC);
  if (!hoja) {
    Logger.log('ERROR: Hoja "' + HOJA_ARTICULOS_SINC + '" no encontrada. Verifica el nombre exacto.');
    return;
  }

  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) {
    Logger.log('Hoja vacía (sin datos). Nada que sincronizar.');
    return;
  }

  Logger.log('=== sincArticulos START ' + new Date().toISOString() + ' ===');
  Logger.log('Total filas en hoja: ' + (ultimaFila - 1));

  var insertados = 0, actualizados = 0, omitidos = 0, errores = 0, primerError = '';

  // Total de columnas a leer: AI = col 35 (índice 34), leemos cols A-AI
  var TOTAL_COLS = 35;

  for (var fila = 2; fila <= ultimaFila; fila += BATCH_SIZE_SINC_ART) {
    var filaFin = Math.min(fila + BATCH_SIZE_SINC_ART - 1, ultimaFila);
    var datos = hoja.getRange(fila, 1, filaFin - fila + 1, TOTAL_COLS).getValues();

    var registros = [];

    for (var i = 0; i < datos.length; i++) {
      var row = datos[i];
      var articuloId = parseTextoArt(row[0]);

      if (!articuloId) { omitidos++; continue; }

      var imagenes = parseImagenesArt(row[21], row[22], row[23]);

      var registro = {
        articulo_id:    articuloId,
        nombre:         parseTextoArt(row[1])   || articuloId,
        marca:          parseTextoArt(row[2]),
        modelo:         parseTextoArt(row[3]),
        variante:       parseTextoArt(row[4]),
        categoria:      parseTextoArt(row[5]),
        caja_madre:     parseTextoArt(row[9]),
        codigo_universal: parseTextoArt(row[11]),
        codigo_sat:     parseTextoArt(row[18]),
        url_producto:   parseTextoArt(row[14]),
        notas:          parseTextoArt(row[16]),
        peso_kg:        parseNumeroArt(row[20]),
        imagenes:       imagenes,
        es_full:        parseBooleanoArt(row[24]),
        es_dropshipping: parseBooleanoArt(row[34]),
        descripcion:    parseTextoArt(row[27]),
        largo_cm:       parseNumeroArt(row[28]),
        ancho_cm:       parseNumeroArt(row[29]),
        alto_cm:        parseNumeroArt(row[30]),
        activo:         true,
        actualizado_el: new Date().toISOString()
      };

      // Limpiar nulls para no sobreescribir valores existentes con null
      Object.keys(registro).forEach(function(k) {
        if (registro[k] === null) delete registro[k];
      });

      registros.push(registro);
    }

    if (registros.length === 0) continue;

    // UPSERT batch via PostgREST
    var url = SUPABASE_URL + '/rest/v1/articulos?on_conflict=articulo_id';
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'resolution=merge-duplicates,return=representation',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(registros),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code >= 200 && code < 300) {
      // Contar insertados vs actualizados aproximadamente
      actualizados += registros.length;
    } else {
      errores += registros.length;
      if (!primerError) {
        primerError = 'Fila ' + fila + ': HTTP ' + code + ' — ' + response.getContentText().slice(0, 300);
      }
      Logger.log('ERROR batch fila ' + fila + ': HTTP ' + code + ' — ' + response.getContentText().slice(0, 300));
    }

    Logger.log('Progreso: hasta fila ' + filaFin + '/' + ultimaFila +
      ' | Upserted: ' + actualizados +
      ' | Skip: ' + omitidos +
      ' | Err: ' + errores);

    Utilities.sleep(200); // 200ms entre batches para no saturar
  }

  Logger.log('=== sincArticulos END ' + new Date().toISOString() + ' ===');
  Logger.log('Upserted: ' + actualizados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}

// ─────────────────────────────────────────────────────────────────────
// Test para una sola fila antes de ejecutar el sync completo
// ─────────────────────────────────────────────────────────────────────
function testSincArticulosFila2() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_ARTICULOS_SINC);
  if (!hoja) { Logger.log('Hoja no encontrada'); return; }

  var row = hoja.getRange(2, 1, 1, 35).getValues()[0];
  var articuloId = parseTextoArt(row[0]);
  Logger.log('articulo_id: ' + articuloId);
  Logger.log('nombre: ' + parseTextoArt(row[1]));
  Logger.log('marca: ' + parseTextoArt(row[2]));
  Logger.log('es_full: ' + parseBooleanoArt(row[24]));
  Logger.log('es_dropshipping: ' + parseBooleanoArt(row[34]));

  if (!articuloId) { Logger.log('SKIP: sin articulo_id'); return; }

  var registro = { articulo_id: articuloId, nombre: parseTextoArt(row[1]) || articuloId, activo: true, actualizado_el: new Date().toISOString() };
  var url = SUPABASE_URL + '/rest/v1/articulos?on_conflict=articulo_id';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates,return=representation'
    },
    payload: JSON.stringify([registro]),
    muteHttpExceptions: true
  };
  var r = UrlFetchApp.fetch(url, options);
  Logger.log('HTTP ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 500));
}
