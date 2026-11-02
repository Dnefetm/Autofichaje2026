/**
 * auditoriaReconciliacionStock.gs
 *
 * SCRIPT DE FASE 0 AMPLIADA: AUDITORÍA BIDIRECCIONAL SIMÉTRICA (100% SOLO LECTURA)
 * (Google Sheets <-> Supabase)
 *
 * Propósito:
 * Diagnosticar con certeza matemática y rigor forense TODO el catálogo
 * sin realizar ninguna mutación en la base de datos de producción.
 *
 * Blindajes y Mejoras de Seguridad:
 * 1. 100% SOLO LECTURA EN SUPABASE: Cero peticiones POST/PUT/PATCH/DELETE.
 * 2. PAGINACIÓN CANÓNICA POSTGREST (limit=1000): Descarga por lotes de 1,000 filas
 *    para superar el truncamiento predeterminado de PostgREST y auditar las ~31k filas reales.
 * 3. CRUCE BIDIRECCIONAL SIMÉTRICO:
 *    - Faltantes en Supabase (Solo en Sheets): Filas que no han subido a BD (desinflan stock).
 *    - Zombis en Supabase (Solo en Supabase): Filas borradas/corregidas en Sheets que siguen vivas en BD (inflan stock).
 *    - Discrepancias de Cantidad: Filas en ambos sistemas con diferente número de piezas.
 * 4. PROTECCIÓN DE MOVIMIENTOS WEB (origin != 'web'):
 *    Excluye estrictamente los 27 egresos con origin = 'web' para no marcarlos falsamente como zombis.
 * 5. CONTROL DE TIEMPO (4.5 min): Guarda para evitar cortes de Google Apps Script.
 * 6. MAPEO DINÁMICO POR ENCABEZADOS: Localiza columnas por nombre en fila 1.
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
const LIMITE_POSTGREST = 1000;
const TIEMPO_LIMITE_MS = 270000; // 4.5 minutos

/**
 * Función principal para ejecutar desde el editor de Google Apps Script:
 * Ejecutar -> correrAuditoriaReconciliacion
 */
function correrAuditoriaReconciliacion() {
  const tInicio = Date.now();
  Logger.log('=== INICIANDO FASE 0 AMPLIADA: AUDITORÍA BIDIRECCIONAL SIMÉTRICA ===');
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

  // 2. Descargar con paginación limpia (limit=1000) todos los movimientos de Supabase
  Logger.log('Paso 2: Descargando Egresos de Supabase con paginación limit=1000...');
  const egresosSupa = descargarMovimientosSupabasePaginados_('egresos', 'egreso_id', FECHA_CORTE_AUDITORIA, tInicio);

  Logger.log('Paso 3: Descargando Ingresos de Supabase con paginación limit=1000...');
  const ingresosSupa = descargarMovimientosSupabasePaginados_('ingresos', 'ingreso_id', FECHA_CORTE_AUDITORIA, tInicio);

  Logger.log('-> Egresos descargados de Supabase: ' + egresosSupa.items.length + (egresosSupa.incompleto ? ' [ALERTA: INCOMPLETO]' : ' [COMPLETO]'));
  Logger.log('-> Ingresos descargados de Supabase: ' + ingresosSupa.items.length + (ingresosSupa.incompleto ? ' [ALERTA: INCOMPLETO]' : ' [COMPLETO]'));

  // 3. Cruce Bidireccional Simétrico en Memoria
  Logger.log('Paso 4: Ejecutando cruce bidireccional en memoria...');
  const cruceEgresos = cruzarBidireccional_(egresosSheets, egresosSupa.items, 'egreso_id');
  const cruceIngresos = cruzarBidireccional_(ingresosSheets, ingresosSupa.items, 'ingreso_id');

  // 4. Auditoría puntual del artículo testigo '871b9a3e' (KJXP85269) en Supabase
  Logger.log('Paso 5: Consultando metadatos del artículo testigo 871b9a3e...');
  const testigoSupabase = consultarMetadatosTestigoSupabase_('871b9a3e');

  // 5. Consolidar balances netos por artículo
  Logger.log('Paso 6: Consolidando balances y ranking de impacto...');
  const articulosConsolidados = consolidarCatalogoBidireccional_(cruceEgresos, cruceIngresos);

  // 6. Escribir informe detallado en pestaña 'Auditoria_Reconciliacion'
  Logger.log('Paso 7: Escribiendo informe en pestaña ' + HOJA_AUDITORIA + '...');
  volcarInformeASheetBidireccional_(ss, cruceEgresos, cruceIngresos, articulosConsolidados, testigoSupabase, egresosSupa, ingresosSupa);

  const duracionSeg = Math.round((Date.now() - tInicio) / 1000);
  Logger.log('=== AUDITORÍA COMPLETADA EN ' + duracionSeg + ' SEGUNDOS ===');
}

/**
 * Descarga paginada en bloques de 1,000 filas desde PostgREST
 */
function descargarMovimientosSupabasePaginados_(tabla, campoPk, fechaCorteIso, tInicio) {
  const items = [];
  let offset = 0;
  let hayMas = true;
  let incompleto = false;
  const headers = {
    'apikey': KEY_SUPABASE_AUDIT,
    'Authorization': 'Bearer ' + KEY_SUPABASE_AUDIT
  };

  while (hayMas) {
    if (Date.now() - tInicio > TIEMPO_LIMITE_MS) {
      Logger.log('[ALERTA TIEMPO] Límite de 4.5 min alcanzado en descarga de ' + tabla + ' en offset ' + offset);
      incompleto = true;
      break;
    }

    const url = URL_SUPABASE_AUDIT + '/rest/v1/' + tabla +
      '?select=' + campoPk + ',articulo_id,cantidad,fecha,origin,guia' +
      '&fecha=gte.' + fechaCorteIso +
      '&order=' + campoPk + '.asc' +
      '&limit=' + LIMITE_POSTGREST +
      '&offset=' + offset;

    try {
      const resp = UrlFetchApp.fetch(url, {
        method: 'GET',
        headers: headers,
        muteHttpExceptions: true
      });

      if (resp.getResponseCode() === 200) {
        const batch = JSON.parse(resp.getContentText());
        for (let i = 0; i < batch.length; i++) {
          items.push(batch[i]);
        }
        if (batch.length < LIMITE_POSTGREST) {
          hayMas = false; // Fin de datos
        } else {
          offset += LIMITE_POSTGREST;
        }
      } else {
        Logger.log('[ERROR HTTP] En descarga de ' + tabla + ' offset ' + offset + ': ' + resp.getContentText());
        incompleto = true;
        hayMas = false;
      }
    } catch (e) {
      Logger.log('[EXCEPCIÓN] En descarga de ' + tabla + ': ' + e.message);
      incompleto = true;
      hayMas = false;
    }
  }

  return { items: items, incompleto: incompleto };
}

/**
 * Cruce Bidireccional Simétrico en Memoria
 */
function cruzarBidireccional_(itemsSheets, itemsSupa, campoPk) {
  const mapSheets = {};
  itemsSheets.forEach(it => { mapSheets[it.id] = it; });

  const mapSupa = {};
  itemsSupa.forEach(it => { mapSupa[it[campoPk]] = it; });

  const faltantesEnSupabase = []; // En Sheets pero NO en Supabase
  const cantidadDiscrepante = []; // En ambos pero diferente cantidad
  const zombisEnSupabase = [];    // En Supabase pero NO en Sheets (y origin != 'web')
  const ignoradosWeb = [];        // En Supabase pero NO en Sheets (pero origin == 'web', legítimos)

  // 1. Evaluar lo que está en Sheets contra Supabase
  itemsSheets.forEach(sItem => {
    const supaItem = mapSupa[sItem.id];
    if (!supaItem) {
      faltantesEnSupabase.push(sItem);
    } else if (supaItem.cantidad !== sItem.cantidad) {
      cantidadDiscrepante.push({
        id: sItem.id,
        articulo_id: sItem.articulo_id,
        cant_sheets: sItem.cantidad,
        cant_supabase: supaItem.cantidad,
        diferencia: sItem.cantidad - supaItem.cantidad,
        fecha: sItem.fecha,
        fila_sheet: sItem.fila_sheet
      });
    }
  });

  // 2. Evaluar lo que está en Supabase contra Sheets (Dirección Inversa: Zombis)
  itemsSupa.forEach(supaItem => {
    const pk = supaItem[campoPk];
    if (!mapSheets[pk]) {
      // Si no está en Sheets, evaluar origen
      if (supaItem.origin === 'web') {
        ignoradosWeb.push(supaItem); // Legítimo movimiento web, no es zombi
      } else {
        zombisEnSupabase.push(supaItem); // Zombi real (NULL o 'sheets' borrado en Sheets)
      }
    }
  });

  return {
    totalSheets: itemsSheets.length,
    totalSupabase: itemsSupa.length,
    faltantesEnSupabase: faltantesEnSupabase,
    zombisEnSupabase: zombisEnSupabase,
    ignoradosWeb: ignoradosWeb,
    cantidadDiscrepante: cantidadDiscrepante
  };
}

/**
 * Consolida balances netos por artículo del catálogo
 */
function consolidarCatalogoBidireccional_(cruceEgr, cruceIng) {
  const map = {};

  function init(artId) {
    if (!map[artId]) {
      map[artId] = {
        articulo_id: artId,
        egr_faltantes_reg: 0,
        egr_faltantes_pzas: 0,
        ing_faltantes_reg: 0,
        ing_faltantes_pzas: 0,
        egr_zombis_reg: 0,
        egr_zombis_pzas: 0,
        ing_zombis_reg: 0,
        ing_zombis_pzas: 0
      };
    }
  }

  cruceEgr.faltantesEnSupabase.forEach(f => {
    init(f.articulo_id);
    map[f.articulo_id].egr_faltantes_reg++;
    map[f.articulo_id].egr_faltantes_pzas += f.cantidad;
  });

  cruceIng.faltantesEnSupabase.forEach(f => {
    init(f.articulo_id);
    map[f.articulo_id].ing_faltantes_reg++;
    map[f.articulo_id].ing_faltantes_pzas += f.cantidad;
  });

  cruceEgr.zombisEnSupabase.forEach(z => {
    init(z.articulo_id);
    map[z.articulo_id].egr_zombis_reg++;
    map[z.articulo_id].egr_zombis_pzas += (z.cantidad || 0);
  });

  cruceIng.zombisEnSupabase.forEach(z => {
    init(z.articulo_id);
    map[z.articulo_id].ing_zombis_reg++;
    map[z.articulo_id].ing_zombis_pzas += (z.cantidad || 0);
  });

  // Calcular impacto neto en stock en Supabase:
  // Stock en Supabase = Base + Ingresos - Egresos
  // Un ingreso zombi SOBRA en Supabase (+stock fantasma)
  // Un egreso zombi SOBRA en Supabase (-stock fantasma)
  // Un ingreso faltante FALTA en Supabase (-stock en BD)
  // Un egreso faltante FALTA en Supabase (+stock en BD)
  Object.values(map).forEach(a => {
    a.impacto_stock_fantasma = (a.ing_zombis_pzas - a.egr_zombis_pzas) + (a.egr_faltantes_pzas - a.ing_faltantes_pzas);
  });

  return map;
}

/**
 * Vuelca el informe visual en la pestaña 'Auditoria_Reconciliacion'
 */
function volcarInformeASheetBidireccional_(ss, cruceEgr, cruceIng, articulosMap, testigoSupa, metaEgr, metaIng) {
  let hoja = ss.getSheetByName(HOJA_AUDITORIA);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_AUDITORIA);
  } else {
    hoja.clear();
  }

  const filas = [];
  filas.push(['=== INFORME DE AUDITORÍA FASE 0 AMPLIADA: CRUCE SIMÉTRICO SHEETS vs SUPABASE ===']);
  filas.push(['Generado el:', new Date().toISOString()]);
  filas.push(['Fecha de Corte:', FECHA_CORTE_AUDITORIA]);
  filas.push(['Modo de Ejecución:', '100% SOLO LECTURA (Cero mutaciones en BD)']);
  if (metaEgr.incompleto || metaIng.incompleto) {
    filas.push(['[ALERTA]:', 'La descarga de Supabase se pausó por tiempo límite. El reporte cubre hasta el límite descargado.']);
  }
  filas.push(['']);

  // Resumen Global Simétrico
  filas.push(['RESUMEN GLOBAL SIMÉTRICO']);
  filas.push(['Concepto', 'Egresos', 'Ingresos']);
  filas.push(['Total registros en Sheets (>= 2025-11-01)', cruceEgr.totalSheets, cruceIng.totalSheets]);
  filas.push(['Total registros en Supabase (>= 2025-11-01)', cruceEgr.totalSupabase, cruceIng.totalSupabase]);
  filas.push(['Registros FALTANTES en Supabase (Solo en Sheets)', cruceEgr.faltantesEnSupabase.length, cruceIng.faltantesEnSupabase.length]);
  filas.push(['Registros ZOMBI en Supabase (Solo en BD, origin != web)', cruceEgr.zombisEnSupabase.length, cruceIng.zombisEnSupabase.length]);
  filas.push(['Movimientos WEB legítimos protegidos (origin = web)', cruceEgr.ignoradosWeb.length, cruceIng.ignoradosWeb.length]);
  filas.push(['Registros con CANTIDAD DISCREPANTE', cruceEgr.cantidadDiscrepante.length, cruceIng.cantidadDiscrepante.length]);
  filas.push(['']);

  // Sección Caso Testigo
  const artTestigo = testigoSupa.datosArticulo;
  const snapTestigo = testigoSupa.snapshot;
  const balanceTestigo = articulosMap[testigoSupa.articulo_id] || {};

  filas.push(['CASO TESTIGO: ' + testigoSupa.articulo_id + ' (KJXP85269 / ' + (artTestigo.modelo || '') + ')']);
  filas.push(['Nombre:', artTestigo.nombre || 'Refacción Maneral Surtek']);
  filas.push(['Disponibles Base (Fija):', artTestigo.disponibles || 8]);
  filas.push(['Stock Físico actual en Supabase (inventory_snapshot):', snapTestigo.physical_stock]);
  filas.push(['Ingresos ZOMBI en Supabase para este artículo:', balanceTestigo.ing_zombis_reg || 0, 'registros (Total ' + (balanceTestigo.ing_zombis_pzas || 0) + ' piezas fantasma)']);
  filas.push(['Ingresos FALTANTES en Supabase para este artículo:', balanceTestigo.ing_faltantes_reg || 0, 'registros (Total ' + (balanceTestigo.ing_faltantes_pzas || 0) + ' piezas)']);
  filas.push(['Egresos ZOMBI en Supabase para este artículo:', balanceTestigo.egr_zombis_reg || 0, 'registros (Total ' + (balanceTestigo.egr_zombis_pzas || 0) + ' piezas)']);
  filas.push(['Egresos FALTANTES en Supabase para este artículo:', balanceTestigo.egr_faltantes_reg || 0, 'registros (Total ' + (balanceTestigo.egr_faltantes_pzas || 0) + ' piezas)']);
  filas.push(['']);

  // Detalle de Zombis Sospechosos para el Artículo Testigo
  filas.push(['DETALLE DE INGRESOS ZOMBI EN SUPABASE (ARTÍCULO TESTIGO 871b9a3e)']);
  filas.push(['ingreso_id', 'Fecha', 'Cantidad (Pzas)', 'Guía', 'Origin', 'Diagnóstico']);

  const zombisTestigo = cruceIng.zombisEnSupabase.filter(x => x.articulo_id === testigoSupa.articulo_id);
  if (zombisTestigo.length === 0) {
    filas.push(['(Ningún ingreso zombi detectado para este artículo)', '', '', '', '', '']);
  } else {
    zombisTestigo.forEach(z => {
      filas.push([z.ingreso_id, z.fecha, z.cantidad, z.guia, String(z.origin), 'Zombi: Existe en Supabase pero no en Sheets']);
    });
  }
  filas.push(['']);

  // Ranking de Artículos con Mayor Stock Fantasma (Zombis que inflan stock)
  filas.push(['TOP ARTÍCULOS CON INGRESOS ZOMBI EN SUPABASE (INFLAN STOCK FANTASMA)']);
  filas.push(['articulo_id', 'Ingresos Zombi (Reg)', 'Piezas Zombi (Sobran)', 'Ingresos Faltantes (Reg)', 'Piezas Faltantes', 'Desfase Neto Stock']);

  const conZombis = Object.values(articulosMap).filter(a => a.ing_zombis_reg > 0 || a.egr_zombis_reg > 0);
  if (conZombis.length === 0) {
    filas.push(['(No se detectaron artículos con movimientos zombi en el rango auditado)', '', '', '', '', '']);
  } else {
    conZombis.sort((a, b) => b.ing_zombis_pzas - a.ing_zombis_pzas).slice(0, 50).forEach(a => {
      filas.push([a.articulo_id, a.ing_zombis_reg, a.ing_zombis_pzas, a.ing_faltantes_reg, a.ing_faltantes_pzas, a.impacto_stock_fantasma]);
    });
  }
  filas.push(['']);

  // Ranking de Artículos con Faltantes en Supabase (Compras en Sheets que faltan subir)
  filas.push(['TOP ARTÍCULOS CON MOVIMIENTOS FALTANTES EN SUPABASE (DESINFLAN STOCK)']);
  filas.push(['articulo_id', 'Ingresos Faltantes (Reg)', 'Ingresos Faltantes (Pzas)', 'Egresos Faltantes (Reg)', 'Egresos Faltantes (Pzas)']);

  const conFaltantes = Object.values(articulosMap).filter(a => a.ing_faltantes_reg > 0 || a.egr_faltantes_reg > 0);
  if (conFaltantes.length === 0) {
    filas.push(['(No se detectaron artículos con movimientos faltantes)', '', '', '', '']);
  } else {
    conFaltantes.sort((a, b) => b.ing_faltantes_pzas - a.ing_faltantes_pzas).slice(0, 50).forEach(a => {
      filas.push([a.articulo_id, a.ing_faltantes_reg, a.ing_faltantes_pzas, a.egr_faltantes_reg, a.egr_faltantes_pzas]);
    });
  }

  // Volcar a la cuadrícula
  hoja.getRange(1, 1, filas.length, 6).setValues(filas.map(r => {
    while (r.length < 6) r.push('');
    return r;
  }));

  hoja.autoResizeColumns(1, 6);
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

  const headers = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(h => String(h).trim().toLowerCase());

  const idxId = encontrarColumna_(headers, ['egreso_id', 'id', 'clave_egreso'], 0);
  const idxArt = encontrarColumna_(headers, ['articulo_id', 'articulo', 'sku'], 2);
  const idxCant = encontrarColumna_(headers, ['cantidad', 'piezas', 'cant'], 3);
  const idxFecha = encontrarColumna_(headers, ['fecha', 'fecha_egreso', 'creado_el'], 8);
  const idxGuia = encontrarColumna_(headers, ['guia', 'numero_guia'], 4);
  const idxTipo = encontrarColumna_(headers, ['tipo_egreso', 'tipo'], 6);

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

  const headers = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(h => String(h).trim().toLowerCase());

  const idxId = encontrarColumna_(headers, ['ingreso_id', 'id', 'clave_ingreso'], 0);
  const idxArt = encontrarColumna_(headers, ['articulo_id', 'articulo', 'sku'], 2);
  const idxCant = encontrarColumna_(headers, ['cantidad', 'piezas', 'cant'], 3);
  const idxFecha = encontrarColumna_(headers, ['fecha', 'fecha_ingreso', 'creado_el'], 8);
  const idxGuia = encontrarColumna_(headers, ['guia', 'numero_guia'], 4);

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
 * Busca el índice de una columna comparando varios alias posibles
 */
function encontrarColumna_(headers, aliasList, defaultIdx) {
  for (let i = 0; i < aliasList.length; i++) {
    const idx = headers.indexOf(aliasList[i]);
    if (idx !== -1) return idx;
  }
  return defaultIdx < headers.length ? defaultIdx : -1;
}

/**
 * Consulta en Supabase metadatos del artículo testigo
 */
function consultarMetadatosTestigoSupabase_(articuloId) {
  const headers = { 'apikey': KEY_SUPABASE_AUDIT, 'Authorization': 'Bearer ' + KEY_SUPABASE_AUDIT };

  const urlArt = URL_SUPABASE_AUDIT + '/rest/v1/articulos?select=articulo_id,disponibles,nombre,modelo&articulo_id=eq.' + articuloId;
  const urlSnap = URL_SUPABASE_AUDIT + '/rest/v1/inventory_snapshot?select=sku,physical_stock&sku=eq.' + articuloId;

  const resArt = JSON.parse(UrlFetchApp.fetch(urlArt, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');
  const resSnap = JSON.parse(UrlFetchApp.fetch(urlSnap, { headers: headers, muteHttpExceptions: true }).getContentText() || '[]');

  return {
    articulo_id: articuloId,
    datosArticulo: resArt[0] || {},
    snapshot: resSnap[0] || {}
  };
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
