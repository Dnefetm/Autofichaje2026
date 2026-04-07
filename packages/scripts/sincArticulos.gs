// sincArticulos.gs — V2
// Cambios vs V1:
//   - Hash MD5 calculado con campos clave del artículo
//   - Comparación de hash antes de enviar (skip si hash igual → no quema cuota)
//   - Ahora se puede incluir en sincInventarioCompleto() sin desperdicio de recursos
//
// Columnas de la hoja "Artículos":
//   A (0)  = articulo_id         — PK, identificador único
//   B (1)  = nombre              — nombre completo del artículo
//   C (2)  = marca
//   D (3)  = modelo
//   E (4)  = variante
//   F (5)  = categoria
//   G (6)  = disponibles         — NO se sobreescribe si el artículo ya existe
//   H (7)  = hora_registro       — se ignora en sync
//   I (8)  = ubicacion           — se ignora
//   J (9)  = caja_madre
//   K (10) = reordenar_cuando    — se ignora
//   L (11) = codigo_universal    — código de barras principal
//   M (12) = codigo_barras_meli  — se ignora
//   N (13) = modificar_pub_ml    — se ignora
//   O (14) = ver_publicacion     — url_producto
//   P (15) = req_fotografia      — se ignora
//   Q (16) = nota                — notas
//   R (17) = nom050              — se ignora (nombre, no UUID)
//   S (18) = codigo_sat
//   T (19) = dimensiones_texto   — se ignora
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
//   AF(31) = precio_objetivo     — se ignora
//   AG(32) = stock_actual        — se ignora
//   AH(33) = stock_minimo        — se ignora
//   AI(34) = dropshipping        — es_dropshipping

const HOJA_ARTICULOS_SINC = 'Artículos';
const BATCH_SIZE_SINC_ART = 50; // conservador: rows tienen muchas columnas

// ─────────────────────────────────────────────────────────────────────
// MD5 helper (misma implementación que sincIngresos/sincEgresos)
// ─────────────────────────────────────────────────────────────────────
function md5Articulo(texto) {
  var rawBytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    texto,
    Utilities.Charset.UTF_8
  );
  return rawBytes.map(function(b) {
    return ('0' + (b & 0xFF).toString(16)).slice(-2);
  }).join('');
}

// Campos clave que detectan un cambio real en el artículo.
// Los campos que Supabase gestiona internamente (stock, disponibles, etc.) se excluyen.
function computeArticuloHash(articulo_id, nombre, marca, modelo, variante, categoria,
                              caja_madre, codigo_universal, codigo_sat, url_producto,
                              notas, peso_kg, es_full, es_dropshipping,
                              descripcion, largo_cm, ancho_cm, alto_cm,
                              imagen_1, imagen_2, imagen_3) {
  var partes = [
    articulo_id     || '',
    nombre          || '',
    marca           || '',
    modelo          || '',
    variante        || '',
    categoria       || '',
    caja_madre      || '',
    codigo_universal|| '',
    codigo_sat      || '',
    url_producto    || '',
    notas           || '',
    String(peso_kg  || ''),
    String(es_full  || false),
    String(es_dropshipping || false),
    descripcion     || '',
    String(largo_cm || ''),
    String(ancho_cm || ''),
    String(alto_cm  || ''),
    imagen_1        || '',
    imagen_2        || '',
    imagen_3        || ''
  ];
  return md5Articulo(partes.join('|'));
}

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
// Construir objeto registro + hash a partir de fila de Sheets
// (reutilizable por pushArticulos.gs)
// ─────────────────────────────────────────────────────────────────────
function buildRegistroArticulo(row) {
  var articuloId   = parseTextoArt(row[0]);
  if (!articuloId) return null;

  var nombre       = parseTextoArt(row[1])  || articuloId;
  var marca        = parseTextoArt(row[2]);
  var modelo       = parseTextoArt(row[3]);
  var variante     = parseTextoArt(row[4]);
  var categoria    = parseTextoArt(row[5]);
  var cajaMadre    = parseTextoArt(row[9]);
  var codigoUniv   = parseTextoArt(row[11]);
  var codigoSat    = parseTextoArt(row[18]);
  var urlProducto  = parseTextoArt(row[14]);
  var notas        = parseTextoArt(row[16]);
  var pesoKg       = parseNumeroArt(row[20]);
  var img1         = parseTextoArt(row[21]);
  var img2         = parseTextoArt(row[22]);
  var img3         = parseTextoArt(row[23]);
  var esFull       = parseBooleanoArt(row[24]);
  var descripcion  = parseTextoArt(row[27]);
  var largoCm      = parseNumeroArt(row[28]);
  var anchoCm      = parseNumeroArt(row[29]);
  var altoCm       = parseNumeroArt(row[30]);
  var esDropship   = parseBooleanoArt(row[34]);
  var imagenes     = parseImagenesArt(img1, img2, img3);

  var hash = computeArticuloHash(
    articuloId, nombre, marca, modelo, variante, categoria,
    cajaMadre, codigoUniv, codigoSat, urlProducto,
    notas, pesoKg, esFull, esDropship,
    descripcion, largoCm, anchoCm, altoCm,
    img1, img2, img3
  );

  var registro = {
    articulo_id:     articuloId,
    nombre:          nombre,
    marca:           marca,
    modelo:          modelo,
    variante:        variante,
    categoria:       categoria,
    caja_madre:      cajaMadre,
    codigo_universal:codigoUniv,
    codigo_sat:      codigoSat,
    url_producto:    urlProducto,
    notas:           notas,
    peso_kg:         pesoKg,
    imagenes:        imagenes,
    es_full:         esFull,
    es_dropshipping: esDropship,
    descripcion:     descripcion,
    largo_cm:        largoCm,
    ancho_cm:        anchoCm,
    alto_cm:         altoCm,
    activo:          true,
    actualizado_el:  new Date().toISOString(),
    sync_hash:       hash
  };

  // Limpiar nulls: no sobreescribir valores existentes en Supabase con null
  Object.keys(registro).forEach(function(k) {
    if (registro[k] === null) delete registro[k];
  });

  return registro;
}

// ─────────────────────────────────────────────────────────────────────
// Obtener hashes existentes en Supabase para un lote de articulo_ids
// ─────────────────────────────────────────────────────────────────────
function getHashesExistentesArticulos(articuloIds) {
  var ids = articuloIds.filter(function(id) { return id; });
  if (ids.length === 0) return {};

  var filtro = 'articulo_id=in.(' + ids.map(function(id) { return encodeURIComponent(id); }).join(',') + ')';
  var url = SUPABASE_URL + '/rest/v1/articulos?select=articulo_id,sync_hash&' + filtro;
  var resp = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return {};
  var data = JSON.parse(resp.getContentText());
  var mapa = {};
  data.forEach(function(row) { mapa[row.articulo_id] = row.sync_hash; });
  return mapa;
}

// ─────────────────────────────────────────────────────────────────────
// sincArticulos() — V2: hash-based, skip si sin cambios
// Seguro para ejecutar en el timer de 15 min
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

  Logger.log('=== sincArticulos V2 START ' + new Date().toISOString() + ' ===');
  Logger.log('Total filas en hoja: ' + (ultimaFila - 1));

  var upsertados = 0, saltados = 0, omitidos = 0, errores = 0, primerError = '';
  var TOTAL_COLS = 35;

  for (var fila = 2; fila <= ultimaFila; fila += BATCH_SIZE_SINC_ART) {
    var filaFin = Math.min(fila + BATCH_SIZE_SINC_ART - 1, ultimaFila);
    var datos = hoja.getRange(fila, 1, filaFin - fila + 1, TOTAL_COLS).getValues();

    var candidatos = [];
    for (var i = 0; i < datos.length; i++) {
      var reg = buildRegistroArticulo(datos[i]);
      if (!reg) { omitidos++; continue; }
      candidatos.push(reg);
    }

    if (candidatos.length === 0) continue;

    // Comparar hashes: solo enviar los que cambiaron
    var ids = candidatos.map(function(r) { return r.articulo_id; });
    var hashesExistentes = getHashesExistentesArticulos(ids);

    var lote = [];
    candidatos.forEach(function(reg) {
      var hashActual = hashesExistentes[reg.articulo_id];
      if (hashActual && hashActual === reg.sync_hash) {
        saltados++; // sin cambios, no dispara triggers ni consume cuota
      } else {
        lote.push(reg);
      }
    });

    if (lote.length === 0) {
      Logger.log('Lote fila ' + fila + '-' + filaFin + ': 0 cambios (todos iguales)');
      continue;
    }

    // UPSERT batch via PostgREST
    var url = SUPABASE_URL + '/rest/v1/articulos?on_conflict=articulo_id';
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal,resolution=merge-duplicates',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(lote),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code >= 200 && code < 300) {
      upsertados += lote.length;
    } else {
      errores += lote.length;
      if (!primerError) {
        primerError = 'Fila ' + fila + ': HTTP ' + code + ' — ' + response.getContentText().slice(0, 300);
      }
      Logger.log('ERROR batch fila ' + fila + ': HTTP ' + code + ' — ' + response.getContentText().slice(0, 300));
    }

    Logger.log('Progreso: hasta fila ' + filaFin + '/' + ultimaFila +
      ' | Upsertados: ' + upsertados +
      ' | Saltados: ' + saltados +
      ' | Skip: ' + omitidos +
      ' | Err: ' + errores);

    Utilities.sleep(200); // 200ms entre batches
  }

  Logger.log('=== sincArticulos V2 END ' + new Date().toISOString() + ' ===');
  Logger.log('Upsertados (con cambios): ' + upsertados);
  Logger.log('Saltados (hash igual, sin cambios): ' + saltados);
  Logger.log('Omitidos (sin articulo_id): ' + omitidos);
  Logger.log('Errores HTTP: ' + errores);
  if (primerError) Logger.log('Primer error: ' + primerError);
}

// ─────────────────────────────────────────────────────────────────────
// sincArticulos_full() — resync completo ignorando hash (para forzar manualmente)
// ─────────────────────────────────────────────────────────────────────
function sincArticulos_full() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName(HOJA_ARTICULOS_SINC);
  if (!hoja) { Logger.log('Hoja no encontrada.'); return; }

  var ultimaFila = hoja.getLastRow();
  if (ultimaFila < 2) { Logger.log('Hoja vacía.'); return; }

  Logger.log('=== sincArticulos_full START — IGNORANDO HASH ' + new Date().toISOString() + ' ===');
  Logger.log('Total filas: ' + (ultimaFila - 1));

  var upsertados = 0, omitidos = 0, errores = 0, primerError = '';
  var TOTAL_COLS = 35;

  for (var fila = 2; fila <= ultimaFila; fila += BATCH_SIZE_SINC_ART) {
    var filaFin = Math.min(fila + BATCH_SIZE_SINC_ART - 1, ultimaFila);
    var datos = hoja.getRange(fila, 1, filaFin - fila + 1, TOTAL_COLS).getValues();
    var lote = [];

    for (var i = 0; i < datos.length; i++) {
      var reg = buildRegistroArticulo(datos[i]);
      if (!reg) { omitidos++; continue; }
      lote.push(reg);
    }

    if (lote.length === 0) continue;

    var url = SUPABASE_URL + '/rest/v1/articulos?on_conflict=articulo_id';
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Prefer': 'return=minimal,resolution=merge-duplicates',
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(lote),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    var code = response.getResponseCode();

    if (code >= 200 && code < 300) {
      upsertados += lote.length;
    } else {
      errores += lote.length;
      if (!primerError) primerError = 'HTTP ' + code + ': ' + response.getContentText().slice(0, 300);
      Logger.log('ERROR: HTTP ' + code + ' — ' + response.getContentText().slice(0, 300));
    }

    Logger.log('Lote ' + fila + '-' + filaFin + ': OK');
    Utilities.sleep(200);
  }

  Logger.log('=== sincArticulos_full END ===');
  Logger.log('Upsertados: ' + upsertados + ' | Omitidos: ' + omitidos + ' | Errores: ' + errores);
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
  var reg = buildRegistroArticulo(row);
  if (!reg) { Logger.log('SKIP: fila 2 sin articulo_id válido'); return; }

  Logger.log('articulo_id: ' + reg.articulo_id);
  Logger.log('nombre: ' + reg.nombre);
  Logger.log('marca: ' + reg.marca);
  Logger.log('sync_hash: ' + reg.sync_hash);
  Logger.log('es_full: ' + reg.es_full);
  Logger.log('es_dropshipping: ' + reg.es_dropshipping);

  // Verificar hash existente en Supabase
  var hashes = getHashesExistentesArticulos([reg.articulo_id]);
  var hashSupa = hashes[reg.articulo_id];
  Logger.log('hash en Supabase: ' + (hashSupa || '(no encontrado — artículo nuevo o sin sync_hash)'));
  Logger.log('¿Necesita UPSERT?: ' + (hashSupa !== reg.sync_hash ? 'SÍ' : 'NO (sin cambios)'));
}
