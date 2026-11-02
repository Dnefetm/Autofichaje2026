/**
 * auditoriaReconciliacionStock.gs
 *
 * SCRIPT DE FASE 0: AUDITORÍA BIDIRECCIONAL DE SOLO LECTURA
 * (Google Sheets <-> Supabase)
 *
 * Mejoras de robustez aplicadas tras auditoría forense:
 * 1. 100% AUTOCONTENIDO: Incluye fallback para SUPABASE_URL y SUPABASE_SERVICE_KEY
 *    si no están declaradas globalmente en el proyecto.
 * 2. DETECCIÓN DINÁMICA DE COLUMNAS: Lee la fila 1 (headers) para localizar
 *    los índices reales de 'egreso_id', 'articulo_id', 'cantidad', 'fecha', etc.,
 *    eliminando el riesgo de columnas desplazadas en la hoja.
 * 3. 100% SOLO LECTURA EN SUPABASE: Cero peticiones de escritura hacia la BD.
 * 4. AISLAMIENTO EN SHEETS: No toca las hojas 'Egresos' ni 'Ingresos'; solo
 *    vuelca su reporte en la pestaña aislada 'Auditoria_Reconciliacion'.
 */

// Configuración de conexión (con fallback a variables globales del proyecto si existen)
var URL_SUPABASE_AUDIT = (typeof SUPABASE_URL !== 'undefined')
  ? SUPABASE_URL
  : 'https://ryxdqnzyvnrwalylqyvm.supabase.co';

var KEY_SUPABASE_AUDIT = (typeof SUPABASE_SERVICE_KEY !== 'undefined')
  ? SUPABASE_SERVICE_KEY
  : (PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY') || '');

const HOJA_AUDITORIA = 'Auditoria_Reconciliacion';
const FECHA_CORTE_AUDITORIA = '2025-11-01T00:00:00Z';
const CHUNK_AUDITORIA = 40;
const TIEMPO_LIMITE_MS = 270000; // 4.5 minutos

/**
 * Función principal para ejecutar desde el editor de Google Apps Script:
 * Ejecutar -> correrAuditoriaReconciliacion
 */
function correrAuditoriaReconciliacion() {
  const tInicio = Date.now();
  Logger.log('=== INICIANDO FASE 0: AUDITORÍA BIDIRECCIONAL DE STOCK ===');
  Logger.log('Endpoint Supabase: ' + URL_SUPABASE_AUDIT);
  Logger.log('Fecha de corte: ' + FECHA_CORTE_AUDITORIA);

  if (!KEY_SUPABASE_AUDIT) {
    throw new Error('SUPABASE_SERVICE_KEY no encontrada. Declárala en el script o en Propiedades del proyecto.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const corteEpoch = new Date(FECHA_CORTE_AUDITORIA).getTime();

  // 1. Extraer movimientos candidatos desde Google Sheets (mapeo dinámico por header)
  Logger.log('Paso 1: Leyendo hojas Egresos e Ingresos con mapeo dinámico de cabeceras...');
  const egresosSheets = leerEgresosSheetsDinamico_(ss, corteEpoch);
  const ingresosSheets = leerIngresosSheetsDinamico_(ss, corteEpoch);

  Logger.log('-> Egresos en Sheets (>= 2025-11-01): ' + egresosSheets.length);
  Logger.log('-> Ingresos en Sheets (>= 2025-11-01): ' + ingresosSheets.length);

  // 2. Auditar Egresos contra Supabase
  Logger.log('Paso 2: Comparando Egresos contra Supabase...');
  const resEgresos = auditarTablaContraSupabase_('egresos', 'egreso_id', egresosSheets, tInicio);

  // 3. Auditar Ingresos contra Supabase
  Logger.log('Paso 3: Comparando Ingresos contra Supabase...');
  const resIngresos = auditarTablaContraSupabase_('ingresos', 'ingreso_id', ingresosSheets, tInicio);

  // 4. Auditoría puntual del artículo testigo '871b9a3e' (KJXP85269) en Supabase
  Logger.log('Paso 4: Consultando histórico completo en Supabase para artículo 871b9a3e...');
  const testigoSupabase = consultarMovimientosTestigoSupabase_('871b9a3e');

  // 5. Consolidar balances por artículo
  Logger.log('Paso 5: Consolidando balances y discrepancias...');
  const consolidado = consolidarBalances_(egresosSheets, ingresosSheets, resEgresos, resIngresos, testigoSupabase);

  // 6. Escribir informe en pestaña 'Auditoria_Reconciliacion'
  Logger.log('Paso 6: Escribiendo resultados en pestaña ' + HOJA_AUDITORIA + '...');
  volcarInformeASheet_(ss, consolidado, resEgresos, resIngresos, testigoSupabase);

  const duracionSeg = Math.round((Date.now() - tInicio) / 1000);
  Logger.log('=== AUDITORÍA COMPLETADA EN ' + duracionSeg + ' SEGUNDOS ===');
}

/**
 * Mapeo dinámico de columnas por encabezado para la hoja Egresos
 */
function leerEgresosSheetsDinamico_(ss, corteEpoch) {
  const hoja = ss.getSheetByName('Egresos');
  if (!hoja) throw new Error("Hoja 'Egresos' no encontrada.");
  const ultimaFila = hoja.getLastRow();
  const ultimaCol = hoja.getLastColumn();
  if (ultimaFila < 2) return [];

  // Leer encabezados de la fila 1
  const headers = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(h => String(h).trim().toLowerCase());

  const idxId = encontrarColumna_(headers, ['egreso_id', 'id', 'clave_egreso'], 0);
  const idxArt = encontrarColumna_(headers, ['articulo_id', 'articulo', 'sku'], 2);
  const idxCant = encontrarColumna_(headers, ['cantidad', 'piezas', 'cant'], 3);
  const idxFecha = encontrarColumna_(headers, ['fecha', 'fecha_egreso', 'creado_el'], 8);
  const idxGuia = encontrarColumna_(headers, ['guia', 'numero_guia'], 4);
  const idxTipo = encontrarColumna_(headers, ['tipo_egreso', 'tipo'], 6);

  Logger.log('[Mapeo Egresos] ID col: ' + idxId + ' | Articulo col: ' + idxArt + ' | Cantidad col: ' + idxCant + ' | Fecha col: ' + idxFecha);

  const datos = hoja.getRange(2, 1, ultimaFila - 1, ultimaCol).getValues();
  const resultados = [];

  for (let i = 0; i < datos.length; i++) {
    const fila = datos[i];
    const id = fila[idxId] ? String(fila[idxId]).trim() : '';
    const articulo_id = fila[idxArt] ? String(fila[idxArt]).trim() : '';
    const cant = parseInt(fila[idxCant], 10) || 0;
    const fechaVal = fila[idxFecha];
    if (!id || !articulo_id) continue;

    const f = parseFechaAuditoria_(fechaVal);
    if (!f || f.getTime() < corteEpoch) continue;

    resultados.push({
      id: id,
      articulo_id: articulo_id,
      cantidad: cant,
      fecha: f.toISOString(),
      guia: idxGuia !== -1 && fila[idxGuia] ? String(fila[idxGuia]).trim() : '',
      tipo: idxTipo !== -1 && fila[idxTipo] ? String(fila[idxTipo]).trim() : '',
      fila_sheet: i + 2
    });
  }
  return resultados;
}

/**
 * Mapeo dinámico de columnas por encabezado para la hoja Ingresos
 */
function leerIngresosSheetsDinamico_(ss, corteEpoch) {
  const hoja = ss.getSheetByName('Ingresos');
  if (!hoja) throw new Error("Hoja 'Ingresos' no encontrada.");
  const ultimaFila = hoja.getLastRow();
  const ultimaCol = hoja.getLastColumn();
  if (ultimaFila < 2) return [];

  // Leer encabezados de la fila 1
  const headers = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(h => String(h).trim().toLowerCase());

  const idxId = encontrarColumna_(headers, ['ingreso_id', 'id', 'clave_ingreso'], 0);
  const idxArt = encontrarColumna_(headers, ['articulo_id', 'articulo', 'sku'], 2);
  const idxCant = encontrarColumna_(headers, ['cantidad', 'piezas', 'cant'], 3);
  const idxFecha = encontrarColumna_(headers, ['fecha', 'fecha_ingreso', 'creado_el'], 8);
  const idxGuia = encontrarColumna_(headers, ['guia', 'numero_guia'], 4);

  Logger.log('[Mapeo Ingresos] ID col: ' + idxId + ' | Articulo col: ' + idxArt + ' | Cantidad col: ' + idxCant + ' | Fecha col: ' + idxFecha);

  const datos = hoja.getRange(2, 1, ultimaFila - 1, ultimaCol).getValues();
  const resultados = [];

  for (let i = 0; i < datos.length; i++) {
    const fila = datos[i];
    const id = fila[idxId] ? String(fila[idxId]).trim() : '';
    const articulo_id = fila[idxArt] ? String(fila[idxArt]).trim() : '';
    const cant = parseInt(fila[idxCant], 10) || 0;
    const fechaVal = fila[idxFecha];
    if (!id || !articulo_id) continue;

    const f = parseFechaAuditoria_(fechaVal);
    if (!f || f.getTime() < corteEpoch) continue;

    resultados.push({
      id: id,
      articulo_id: articulo_id,
      cantidad: cant,
      fecha: f.toISOString(),
      guia: idxGuia !== -1 && fila[idxGuia] ? String(fila[idxGuia]).trim() : '',
      fila_sheet: i + 2
    });
  }
  return resultados;
}

/**
 * Busca el índice de una columna comparando varios alias posibles,
 * con fallback a un índice por defecto si no encuentra coincidencia.
 */
function encontrarColumna_(headers, aliasList, defaultIdx) {
  for (let i = 0; i < aliasList.length; i++) {
    const idx = headers.indexOf(aliasList[i]);
    if (idx !== -1) return idx;
  }
  return defaultIdx < headers.length ? defaultIdx : -1;
}

/**
 * Compara los IDs de Sheets contra Supabase en lotes seguros de 40
 */
function auditarTablaContraSupabase_(tabla, campoPk, itemsSheets, tInicio) {
  const mapaSupabase = {};
  const erroresHttp = [];
  const total = itemsSheets.length;

  for (let c = 0; c < total; c += CHUNK_AUDITORIA) {
    if (Date.now() - tInicio > TIEMPO_LIMITE_MS) {
      Logger.log('[AVISO] Límite de tiempo alcanzado (4.5 min). Pausando en lote ' + c);
      break;
    }

    const chunk = itemsSheets.slice(c, c + CHUNK_AUDITORIA);
    const ids = chunk.map(x => '"' + x.id + '"').join(',');
    const url = URL_SUPABASE_AUDIT + '/rest/v1/' + tabla +
      '?select=' + campoPk + ',articulo_id,cantidad,fecha' +
      '&' + campoPk + '=in.(' + encodeURIComponent(ids) + ')';

    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'GET',
        headers: {
          'apikey': KEY_SUPABASE_AUDIT,
          'Authorization': 'Bearer ' + KEY_SUPABASE_AUDIT
        },
        muteHttpExceptions: true
      });

      if (resp.getResponseCode() === 200) {
        const filas = JSON.parse(resp.getContentText());
        for (let k = 0; k < filas.length; k++) {
          mapaSupabase[filas[k][campoPk]] = filas[k];
        }
      } else {
        erroresHttp.push({ lote: c, codigo: resp.getResponseCode(), error: resp.getContentText() });
      }
    } catch (e) {
      erroresHttp.push({ lote: c, error: e.message });
    }
  }

  const faltantesEnSupabase = [];
  const cantidadDiscrepante = [];
  const coincidentes = [];

  for (let i = 0; i < itemsSheets.length; i++) {
    const item = itemsSheets[i];
    const enSupa = mapaSupabase[item.id];

    if (!enSupa) {
      faltantesEnSupabase.push(item);
    } else if (enSupa.cantidad !== item.cantidad) {
      cantidadDiscrepante.push({
        id: item.id,
        articulo_id: item.articulo_id,
        cant_sheets: item.cantidad,
        cant_supabase: enSupa.cantidad,
        diferencia: item.cantidad - enSupa.cantidad,
        fecha: item.fecha,
        fila_sheet: item.fila_sheet
      });
    } else {
      coincidentes.push(item.id);
    }
  }

  return {
    totalSheets: total,
    encontradosSupa: Object.keys(mapaSupabase).length,
    faltantesEnSupabase: faltantesEnSupabase,
    cantidadDiscrepante: cantidadDiscrepante,
    erroresHttp: erroresHttp
  };
}

/**
 * Consulta en Supabase todos los movimientos del artículo testigo
 */
function consultarMovimientosTestigoSupabase_(articuloId) {
  const headers = { 'apikey': KEY_SUPABASE_AUDIT, 'Authorization': 'Bearer ' + KEY_SUPABASE_AUDIT };

  const urlEgr = URL_SUPABASE_AUDIT + '/rest/v1/egresos?select=egreso_id,cantidad,fecha,tipo_egreso,guia&articulo_id=eq.' + articuloId;
  const urlIng = URL_SUPABASE_AUDIT + '/rest/v1/ingresos?select=ingreso_id,cantidad,fecha&articulo_id=eq.' + articuloId;
  const urlArt = URL_SUPABASE_AUDIT + '/rest/v1/articulos?select=articulo_id,disponibles,nombre,modelo&articulo_id=eq.' + articuloId;
  const urlSnap = URL_SUPABASE_AUDIT + '/rest/v1/inventory_snapshot?select=sku,physical_stock&sku=eq.' + articuloId;

  const resEgr = JSON.parse(UrlFetchApp.fetch(urlEgr, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  const resIng = JSON.parse(UrlFetchApp.fetch(urlIng, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  const resArt = JSON.parse(UrlFetchApp.fetch(urlArt, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  const resSnap = JSON.parse(UrlFetchApp.fetch(urlSnap, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');

  return {
    articulo_id: articuloId,
    datosArticulo: resArt[0] || {},
    snapshot: resSnap[0] || {},
    egresos: resEgr,
    ingresos: resIng
  };
}

/**
 * Consolida balances por artículo
 */
function consolidarBalances_(egresosSheets, ingresosSheets, resEgr, resIng, testigoSupa) {
  const articulosMap = {};

  function initArt(artId) {
    if (!articulosMap[artId]) {
      articulosMap[artId] = {
        articulo_id: artId,
        egr_sheets_cant: 0,
        ing_sheets_cant: 0,
        egr_faltantes_pzas: 0,
        ing_faltantes_pzas: 0,
        egr_faltantes_reg: 0,
        ing_faltantes_reg: 0,
        cant_discrepante_diff: 0
      };
    }
  }

  egresosSheets.forEach(e => { initArt(e.articulo_id); articulosMap[e.articulo_id].egr_sheets_cant += e.cantidad; });
  ingresosSheets.forEach(i => { initArt(i.articulo_id); articulosMap[i.articulo_id].ing_sheets_cant += i.cantidad; });

  resEgr.faltantesEnSupabase.forEach(f => {
    initArt(f.articulo_id);
    articulosMap[f.articulo_id].egr_faltantes_pzas += f.cantidad;
    articulosMap[f.articulo_id].egr_faltantes_reg++;
  });

  resIng.faltantesEnSupabase.forEach(f => {
    initArt(f.articulo_id);
    articulosMap[f.articulo_id].ing_faltantes_pzas += f.cantidad;
    articulosMap[f.articulo_id].ing_faltantes_reg++;
  });

  resEgr.cantidadDiscrepante.forEach(d => {
    initArt(d.articulo_id);
    articulosMap[d.articulo_id].cant_discrepante_diff += d.diferencia;
  });

  return articulosMap;
}

/**
 * Vuelca el informe visual en la pestaña 'Auditoria_Reconciliacion'
 */
function volcarInformeASheet_(ss, consolidado, resEgr, resIng, testigoSupa) {
  let hoja = ss.getSheetByName(HOJA_AUDITORIA);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_AUDITORIA);
  } else {
    hoja.clear();
  }

  const filas = [];
  filas.push(['=== INFORME DE AUDITORÍA FASE 0: RECONCILIACIÓN SHEETS vs SUPABASE ===']);
  filas.push(['Generado el:', new Date().toISOString()]);
  filas.push(['Fecha de Corte:', FECHA_CORTE_AUDITORIA]);
  filas.push(['']);

  // Resumen Global
  filas.push(['RESUMEN GLOBAL']);
  filas.push(['Concepto', 'Egresos', 'Ingresos']);
  filas.push(['Total registros en Sheets (>= 2025-11-01)', resEgr.totalSheets, resIng.totalSheets]);
  filas.push(['Registros existentes en Supabase', resEgr.encontradosSupa, resIng.encontradosSupa]);
  filas.push(['Registros FALTANTES en Supabase (Solo en Sheets)', resEgr.faltantesEnSupabase.length, resIng.faltantesEnSupabase.length]);
  filas.push(['Registros con CANTIDAD DISCREPANTE', resEgr.cantidadDiscrepante.length, resIng.cantidadDiscrepante.length]);
  filas.push(['Errores HTTP durante la auditoría', resEgr.erroresHttp.length, resIng.erroresHttp.length]);
  filas.push(['']);

  // Sección Caso Testigo
  const artTestigo = testigoSupa.datosArticulo;
  const snapTestigo = testigoSupa.snapshot;
  const balanceTestigo = consolidado[testigoSupa.articulo_id] || {};

  filas.push(['CASO TESTIGO: ' + testigoSupa.articulo_id + ' (KJXP85269 / ' + (artTestigo.modelo || '') + ')']);
  filas.push(['Nombre:', artTestigo.nombre || 'Refacción Maneral Surtek']);
  filas.push(['Disponibles Base (Fija):', artTestigo.disponibles || 8]);
  filas.push(['Stock Físico actual en Supabase (inventory_snapshot):', snapTestigo.physical_stock]);
  filas.push(['Egresos Faltantes en Supabase para este artículo:', balanceTestigo.egr_faltantes_reg || 0, 'registros (Total ' + (balanceTestigo.egr_faltantes_pzas || 0) + ' piezas)']);
  filas.push(['Ingresos Faltantes en Supabase para este artículo:', balanceTestigo.ing_faltantes_reg || 0, 'registros (Total ' + (balanceTestigo.ing_faltantes_pzas || 0) + ' piezas)']);
  filas.push(['']);

  // Detalle de Egresos Faltantes en Testigo
  filas.push(['DETALLE DE EGRESOS FALTANTES EN SUPABASE (ARTÍCULO TESTIGO 871b9a3e)']);
  filas.push(['egreso_id', 'Fila en Sheet', 'Fecha', 'Cantidad (Pzas)', 'Guía', 'Tipo Egreso']);

  const faltantesTestigo = resEgr.faltantesEnSupabase.filter(x => x.articulo_id === testigoSupa.articulo_id);
  if (faltantesTestigo.length === 0) {
    filas.push(['(Ningún egreso faltante detectado para este artículo)', '', '', '', '', '']);
  } else {
    faltantesTestigo.forEach(f => {
      filas.push([f.id, f.fila_sheet, f.fecha, f.cantidad, f.guia, f.tipo]);
    });
  }
  filas.push(['']);

  // Tabla General de Artículos con Discrepancias
  filas.push(['TOP ARTÍCULOS CON MOVIMIENTOS FALTANTES EN SUPABASE']);
  filas.push(['articulo_id', 'Egresos Faltantes (Reg)', 'Egresos Faltantes (Pzas)', 'Ingresos Faltantes (Reg)', 'Ingresos Faltantes (Pzas)', 'Diferencia Cantidad (Pzas)']);

  const artConDiff = Object.values(consolidado).filter(a => a.egr_faltantes_reg > 0 || a.ing_faltantes_reg > 0 || a.cant_discrepante_diff !== 0);
  if (artConDiff.length === 0) {
    filas.push(['(No se detectaron discrepancias en los artículos auditados)', '', '', '', '', '']);
  } else {
    artConDiff.sort((a, b) => b.egr_faltantes_pzas - a.egr_faltantes_pzas).slice(0, 50).forEach(a => {
      filas.push([a.articulo_id, a.egr_faltantes_reg, a.egr_faltantes_pzas, a.ing_faltantes_reg, a.ing_faltantes_pzas, a.cant_discrepante_diff]);
    });
  }

  // Volcar a la hoja
  hoja.getRange(1, 1, filas.length, 6).setValues(filas.map(r => {
    while (r.length < 6) r.push('');
    return r;
  }));

  hoja.autoResizeColumns(1, 6);
}

/**
 * Parser de fecha seguro
 */
function parseFechaAuditoria_(val) {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}
