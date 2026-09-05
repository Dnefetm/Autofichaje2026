// ============================================================
// MigrarArticulos.gs
// Migración: hoja 'Artículos' → tabla 'Artículos' en Supabase
// Mapeo basado en sesión de diseño previa
// ============================================================

const SUPABASE_URL = 'https://ryxdqnzyvnrwalylqyvm.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGRxbnp5dm5yd2FseWxxeXZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODQ4NjcwNywiZXhwIjoyMDg0MDYyNzA3fQ.wlQUbd48z0jH0rx1_2bzL0sWkU1TaA-4rpX9DAmvflw'; // pega aquí la service_role key
const HOJA_ARTICULOS = 'Artículos';
const BATCH_SIZE = 50; // registros por lote

// ─── HELPERS ─────────────────────────────────────────────────

function val(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toBool(v) {
  if (v === null || v === undefined) return false;
  return String(v).trim().toLowerCase() === 'sí' ||
         String(v).trim().toLowerCase() === 'si' ||
         String(v).trim() === '1' ||
         String(v).trim().toLowerCase() === 'true';
}

function parseDimension(rawStr) {
  // Formato esperado: "LxAxH cm" o "30x20x10" o valores numéricos directos
  if (!rawStr) return { largo: null, ancho: null, alto: null };
  const s = String(rawStr).trim().replace(/\s*cm\s*/gi, '');
  const partes = s.split(/[xX\*]/).map(p => {
    const n = parseFloat(p.trim());
    return isNaN(n) ? null : n;
  });
  return {
    largo: partes[0] || null,
    ancho: partes[1] || null,
    alto:  partes[2] || null
  };
}

function parseImagenes(v1, v2, v3) {
  return [v1, v2, v3]
    .map(v => val(v))
    .filter(v => v !== null);
}

function parseArrayVal(v) {
  const s = val(v);
  if (!s) return null;
  return [s];
}

// ─── MAPEO DE FILA A OBJETO ───────────────────────────────────
// Índices 0-based según mapeo acordado:
// A(0)=# Artículo, B(1)=Artículo, C(2)=Marca, D(3)=Modelo,
// E(4)=Variante, F(5)=Categoría, G(6)=Stock[NO], H(7)=?,
// I(8)=Ubicación[NO], J(9)=Caja madre, K(10)=atrib,
// L(11)=Código barras, M(12)=Código barras Meli,
// N(13)=Modificar Pub ML, O(14)=Ver publicación,
// P(15)=atrib, Q(16)=Nota, R(17)=NOM050,
// S(18)=Código SAT, T(19)=Dimensiones(texto),
// U(20)=Peso, V(21)=Imagen1, W(22)=Imagen2, X(23)=Imagen3,
// Y(24)=Full, Z(25)=Eliminable, AA(26)=atrib,
// AB(27)=Descripción, AC(28)=Largo cm, AD(29)=Ancho cm,
// AE(30)=Alto cm, AF(31)=atrib, AG(32)=Stock[NO],
// AH(33)=atrib, AI(34)=Dropshipping

function filaAObjeto(fila) {
  // Dimensiones: prioridad AC/AD/AE (cols 28,29,30) sobre T (col 19)
  let largo = null, ancho = null, alto = null;
  if (fila[28] !== '' && fila[28] !== null && fila[28] !== undefined) {
    largo = parseFloat(fila[28]) || null;
    ancho = parseFloat(fila[29]) || null;
    alto  = parseFloat(fila[30]) || null;
  } else if (fila[19] !== '' && fila[19] !== null) {
    const dim = parseDimension(fila[19]);
    largo = dim.largo;
    ancho = dim.ancho;
    alto  = dim.alto;
  }

  // NOM050: texto en col R(17); requiere_etiqueta_nom = true si no está vacío
  const nom050Val = val(fila[17]);
  const requiereNom = nom050Val !== null;

  // articulo_id: col A(0); si vacío → null (Supabase genera UUID)
  const articuloId = val(fila[0]);

  // SKU = articulo_id (mismo valor, es la PK de negocio)
  if (!articuloId) return null; // filas sin ID se omiten

  // atributos_especificos: cols K(10), P(15), AA(26), AF(31), AH(33)
  const atribs = {};
  if (val(fila[10])) atribs['col_k'] = val(fila[10]);
  if (val(fila[15])) atribs['col_p'] = val(fila[15]);
  if (val(fila[26])) atribs['col_aa'] = val(fila[26]);
  if (val(fila[31])) atribs['col_af'] = val(fila[31]);
  if (val(fila[33])) atribs['col_ah'] = val(fila[33]);

  const obj = {
    articulo_id:            articuloId,
    nombre:                 val(fila[1]),
    marca:                  val(fila[2]),
    modelo:                 val(fila[3]),
    variante:               val(fila[4]),
    categoria:              val(fila[5]),
    descripcion:            val(fila[27]),
    codigo_universal:       val(fila[11]),
    codigo_sat:             val(fila[18]),
    codigos_marketplace:    parseArrayVal(fila[12]),
    publicacion_ml:         val(fila[13]),
    url_producto:           val(fila[14]),
    notas:                  val(fila[16]),
    nom050:                 nom050Val,
    requiere_etiqueta_nom:  requiereNom,
    caja_madre:             val(fila[9]),
    largo_cm:               largo,
    ancho_cm:               ancho,
    alto_cm:                alto,
    peso_kg:                val(fila[20]) ? parseFloat(fila[20]) || null : null,
    imagenes:               parseImagenes(fila[21], fila[22], fila[23]),
    es_full:                toBool(fila[24]),
    es_obsoleto:            toBool(fila[25]),
    es_dropshipping:        toBool(fila[34]),
    atributos_especificos:  Object.keys(atribs).length > 0 ? atribs : null
  };

  // Limpiar nulls de arrays vacíos
  if (obj.imagenes && obj.imagenes.length === 0) obj.imagenes = null;
  if (obj.codigos_marketplace && obj.codigos_marketplace === null) delete obj.codigos_marketplace;

  return obj;
}

// ─── FUNCIÓN PRINCIPAL ────────────────────────────────────────

function migrarArticulosASupabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJA_ARTICULOS);

  if (!hoja) {
    Browser.msgBox('Error: No se encontró la hoja "' + HOJA_ARTICULOS + '"');
    return;
  }

  const lastRow = hoja.getLastRow();
  const lastCol = hoja.getLastColumn();
  Logger.log('Filas totales: ' + lastRow + ', Columnas: ' + lastCol);

  if (lastRow < 2) {
    Browser.msgBox('La hoja está vacía.');
    return;
  }

  // Leer todos los datos (sin encabezado)
  const datos = hoja.getRange(2, 1, lastRow - 1, Math.max(lastCol, 35)).getValues();

  let registros = [];
  let omitidos = 0;
  let erroresMapeo = [];

  for (let i = 0; i < datos.length; i++) {
    const fila = datos[i];
    // Omitir filas completamente vacías
    if (!fila[0] && !fila[1]) { omitidos++; continue; }
    try {
      const obj = filaAObjeto(fila);
      if (!obj) { omitidos++; continue; }
      registros.push(obj);
    } catch (e) {
      erroresMapeo.push('Fila ' + (i + 2) + ': ' + e.message);
    }
  }

  Logger.log('Registros a migrar: ' + registros.length);
  Logger.log('Omitidos: ' + omitidos);
  if (erroresMapeo.length > 0) Logger.log('Errores mapeo: ' + erroresMapeo.join('\n'));

  if (registros.length === 0) {
    Browser.msgBox('No hay registros válidos para migrar.');
    return;
  }

  // Enviar en lotes
  let insertados = 0;
  let erroresHTTP = [];

  for (let i = 0; i < registros.length; i += BATCH_SIZE) {
    const lote = registros.slice(i, i + BATCH_SIZE);
    const resultado = upsertLote(lote);
    if (resultado.ok) {
      insertados += lote.length;
      Logger.log('Lote ' + Math.floor(i/BATCH_SIZE + 1) + ' OK: ' + lote.length + ' registros');
    } else {
      erroresHTTP.push('Lote ' + Math.floor(i/BATCH_SIZE + 1) + ': ' + resultado.error);
      Logger.log('ERROR lote ' + Math.floor(i/BATCH_SIZE + 1) + ': ' + resultado.error);
      // CIRCUIT BREAKER (2026-07-04): backend caido (5xx/522) -> abortar el bucle.
      // Evita reintentar lote tras lote hasta agotar los 6 min (Exceeded max execution time).
      if (resultado.code >= 500) {
        Logger.log('CIRCUIT BREAKER: HTTP ' + resultado.code + ' - backend caido. Se aborta migrarArticulos.');
        break;
        }
    }
    Utilities.sleep(300); // evitar rate limiting
  }

  const msg = 'Migración completada.\n' +
    'Insertados/actualizados: ' + insertados + '\n' +
    'Omitidos: ' + omitidos + '\n' +
    (erroresHTTP.length > 0 ? 'ERRORES HTTP:\n' + erroresHTTP.join('\n') : 'Sin errores HTTP') + '\n' +
  Logger.log(msg);
  Browser.msgBox(msg);
}

// ─── UPSERT VÍA SUPABASE REST API ────────────────────────────

function upsertLote(lote) {
  const url = SUPABASE_URL + '/rest/v1/articulos';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(lote),
    muteHttpExceptions: true
  };

  try {
    const resp = UrlFetchApp.fetch(url, options);
    const code = resp.getResponseCode();
    if (code === 200 || code === 201) {
      return { ok: true };
    } else {
              return { ok: false, code: code, error: 'HTTP ' + code + ': ' +resp.getContentText().substring(0, 300) };
    }
          } catch (e) {
    return { ok: false, code: 599, error: 'NETWORK/TIMEOUT: ' + e.message };
  }
}


// ─── VERIFICACIÓN DE INTEGRIDAD (Paso 2.2) ──────────────────
// Toma 5 SKUs aleatorios de Supabase, los busca en el Sheet
// y compara campos clave campo por campo.

function verificarIntegridad() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJA_ARTICULOS);
  if (!hoja) { Logger.log('Hoja no encontrada'); return; }

  // SKUs a verificar (muestra de la query RANDOM en Supabase)
  const skusAVerificar = [
    '40d878da',
    '929f945b',
    '3cf283ca',
    'NAP-92581908',
    '33950eb9',
    'e273672d',
    '58d919d2',
    '58b09f17',
    'cbcccb8a'
  ];

  // Leer hoja completa
  const lastRow = hoja.getLastRow();
  const datos = hoja.getRange(2, 1, lastRow - 1, Math.max(hoja.getLastColumn(), 35)).getValues();

  // Indexar por SKU (col A = idx 0)
  const indice = {};
  for (let i = 0; i < datos.length; i++) {
    const id = val(datos[i][0]);
    if (id) indice[id] = datos[i];
  }

  // Obtener registros de Supabase para los mismos SKUs
  const filtro = skusAVerificar.map(s => '"' + s + '"').join(',');
  const url = SUPABASE_URL + '/rest/v1/articulos?articulo_id=in.(' + skusAVerificar.join(',') + ')&select=articulo_id,nombre,marca,modelo,categoria,caja_madre,peso_kg,es_full,es_obsoleto,es_dropshipping,requiere_etiqueta_nom,url_producto,imagenes';
  const resp = UrlFetchApp.fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY
    },
    muteHttpExceptions: true
  });

  if (resp.getResponseCode() !== 200) {
    Logger.log('Error Supabase: ' + resp.getContentText());
    return;
  }

  const registrosSupabase = JSON.parse(resp.getContentText());
  Logger.log('Registros encontrados en Supabase: ' + registrosSupabase.length);

  let reporte = '=== VERIFICACIÓN DE INTEGRIDAD ===\n';
  let errores = 0;
  let ok = 0;

  for (const reg of registrosSupabase) {
    const skuSB = reg.articulo_id;
    const filaSheet = indice[skuSB];
    reporte += '\n--- SKU: ' + skuSB + ' ---\n';

    if (!filaSheet) {
      reporte += '  ⚠️ NO ENCONTRADO en Sheet\n';
      errores++;
      continue;
    }

    // Mapeo: [campo_supabase, valor_supabase, indice_col_sheet, label]
    const checks = [
      ['nombre',   reg.nombre,   1, 'B-Artículo'],
      ['marca',    reg.marca,    2, 'C-Marca'],
      ['modelo',   reg.modelo,   3, 'D-Modelo'],
      ['categoria',reg.categoria,5, 'F-Categoría'],
      ['caja_madre',reg.caja_madre,9,'J-Caja madre'],
      ['es_full',  reg.es_full,  24,'Y-Full'],
      ['es_obsoleto',reg.es_obsoleto,25,'Z-Eliminable'],
      ['es_dropshipping',reg.es_dropshipping,34,'AI-Dropshipping'],
    ];

    let filaOk = true;
    for (const [campo, valSB, colIdx, label] of checks) {
      const valSheet = val(filaSheet[colIdx]);

      // Normalizar booleanos
      let valSBNorm = valSB;
      let valSheetNorm = valSheet;
      if (typeof valSB === 'boolean') {
        valSBNorm = valSB ? 'true' : 'false';
        valSheetNorm = toBool(valSheet) ? 'true' : 'false';
      } else {
        valSBNorm = valSB ? String(valSB).trim() : 'null';
        valSheetNorm = valSheet ? String(valSheet).trim() : 'null';
      }

      const coincide = valSBNorm === valSheetNorm;
      if (!coincide) {
        reporte += '  ❌ ' + label + ': Supabase=[' + valSBNorm + '] Sheet=[' + valSheetNorm + ']\n';
        filaOk = false;
        errores++;
      }
    }

    if (filaOk) {
      reporte += '  ✅ Todos los campos coinciden\n';
      ok++;
    }
  }

  reporte += '\n=== RESUMEN ===\n';
  reporte += 'Registros verificados: ' + registrosSupabase.length + '\n';
  reporte += 'OK: ' + ok + '\n';
  reporte += 'Con diferencias: ' + (registrosSupabase.length - ok) + '\n';
  reporte += 'Campos discrepantes: ' + errores + '\n';

  Logger.log(reporte);
  Browser.msgBox(reporte);
}
// ─── FUNCIÓN DE PRUEBA (1 fila) ───────────────────────────────

function testMigrarPrimeraFila() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const hoja = ss.getSheetByName(HOJA_ARTICULOS);
  if (!hoja) { Logger.log('Hoja no encontrada'); return; }

  const fila = hoja.getRange(2, 1, 1, Math.max(hoja.getLastColumn(), 35)).getValues()[0];
  const obj = filaAObjeto(fila);
  Logger.log('Objeto mapeado: ' + JSON.stringify(obj, null, 2));

  if (!obj) { Logger.log('Fila vacía o sin ID'); return; }

  const resultado = upsertLote([obj]);
  Logger.log('Resultado: ' + JSON.stringify(resultado));
}