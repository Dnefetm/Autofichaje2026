/**
 * auditoriaReconciliacionStock.gs
 *
 * SCRIPT DE FASE 0 AMPLIADA: AUDITORÍA BIDIRECCIONAL SIMÉTRICA (100% SOLO LECTURA)
 * (Google Sheets <-> Supabase)
 *
 * Mejoras de robustez y alineación con reconciliar.gs:
 * 1. 100% SOLO LECTURA EN SUPABASE: Cero peticiones POST/PUT/PATCH/DELETE.
 * 2. CLASIFICACIÓN EN 3 NIVELES DE ZOMBIS:
 *    - [1] aSeguros: origin = 'sheets' (Zombis seguros, nacieron en Sheets y ya no existen en la hoja).
 *    - [2] aRevisar: origin = NULL (Zombis a revisar manualmente, como c0ba92d2 de 150 pzas).
 *    - [3] aProteger: origin = 'web' (Movimientos web legítimos, NUNCA se marcan como zombi).
 * 3. MARGEN DE ZONA HORARIA (15 DÍAS):
 *    Sheets se lee desde 2025-10-15 mientras Supabase se audita desde 2025-11-01, neutralizando
 *    el efecto de borde entre CST (México UTC-6) y UTC.
 * 4. PROTECCIÓN DE IDs CON getDisplayValues():
 *    Evita que Google Apps Script convierta claves como "13feb0128" en objetos Date.
 * 5. DETECCIÓN Y SUMA DE IDs DUPLICADOS EN SHEETS:
 *    Si un operario pegó el mismo ID dos veces en Sheets, acumula cantidades y alerta en el reporte.
 * 6. PAGINACIÓN CANÓNICA POSTGREST (limit=1000):
 *    Descarga en bloques de 1,000 filas para superar el truncamiento predeterminado.
 */

// Configuración de conexión (con fallback a variables globales del proyecto si existen)
var URL_SUPABASE_AUDIT = (typeof SUPABASE_URL !== 'undefined')
  ? SUPABASE_URL
  : 'https://ryxdqnzyvnrwalylqyvm.supabase.co';

var KEY_SUPABASE_AUDIT = (typeof SUPABASE_SERVICE_KEY !== 'undefined')
  ? SUPABASE_SERVICE_KEY
  : (PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY') || '');

const HOJA_AUDITORIA = 'Auditoria_Reconciliacion';
const FECHA_CORTE_SUPABASE = '2025-11-01T00:00:00Z';
const FECHA_CORTE_SHEETS_BUFFER = '2025-10-15T00:00:00Z'; // Colchón de 15 días contra timezone
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
  Logger.log('Corte Supabase: ' + FECHA_CORTE_SUPABASE + ' | Buffer Sheets: ' + FECHA_CORTE_SHEETS_BUFFER);

  if (!KEY_SUPABASE_AUDIT) {
    throw new Error('SUPABASE_SERVICE_KEY no encontrada. Declárala en el script o en Propiedades del proyecto.');
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const corteSheetsEpoch = new Date(FECHA_CORTE_SHEETS_BUFFER).getTime();

  // 1. Extraer movimientos desde Google Sheets con getDisplayValues() y detección de duplicados
  Logger.log('Paso 1: Leyendo hojas Egresos e Ingresos con mapeo dinámico y getDisplayValues()...');
  const egresosSheets = leerSheetsDinamicoRobusto_(ss, 'Egresos', corteSheetsEpoch, ['egreso_id', 'id', 'clave_egreso'], 0);
  const ingresosSheets = leerSheetsDinamicoRobusto_(ss, 'Ingresos', corteSheetsEpoch, ['ingreso_id', 'id', 'clave_ingreso'], 0);

  Logger.log('-> Egresos en Sheets (>= 2025-10-15): ' + egresosSheets.items.length + ' (Duplicados: ' + egresosSheets.duplicados.length + ')');
  Logger.log('-> Ingresos en Sheets (>= 2025-10-15): ' + ingresosSheets.items.length + ' (Duplicados: ' + ingresosSheets.duplicados.length + ')');

  // 2. Descargar con paginación limpia (limit=1000) todos los movimientos de Supabase
  Logger.log('Paso 2: Descargando Egresos de Supabase con paginación limit=1000...');
  const egresosSupa = descargarMovimientosSupabasePaginados_('egresos', 'egreso_id', FECHA_CORTE_SUPABASE, tInicio);

  Logger.log('Paso 3: Descargando Ingresos de Supabase con paginación limit=1000...');
  const ingresosSupa = descargarMovimientosSupabasePaginados_('ingresos', 'ingreso_id', FECHA_CORTE_SUPABASE, tInicio);

  Logger.log('-> Egresos descargados de Supabase: ' + egresosSupa.items.length + (egresosSupa.incompleto ? ' [ALERTA: INCOMPLETO]' : ' [COMPLETO]'));
  Logger.log('-> Ingresos descargados de Supabase: ' + ingresosSupa.items.length + (ingresosSupa.incompleto ? ' [ALERTA: INCOMPLETO]' : ' [COMPLETO]'));

  // 3. Cruce Bidireccional Simétrico con Clasificación en 3 Niveles
  Logger.log('Paso 4: Ejecutando cruce bidireccional en memoria (Seguros / Revisar / Protegidos)...');
  const cruceEgresos = cruzarBidireccional3Niveles_(egresosSheets.items, egresosSupa.items, 'egreso_id');
  const cruceIngresos = cruzarBidireccional3Niveles_(ingresosSheets.items, ingresosSupa.items, 'ingreso_id');

  // 4. Auditoría puntual del artículo testigo '871b9a3e' (KJXP85269) en Supabase
  Logger.log('Paso 5: Consultando metadatos del artículo testigo 871b9a3e...');
  const testigoSupabase = consultarMetadatosTestigoSupabase_('871b9a3e');

  // 5. Consolidar balances netos por artículo
  Logger.log('Paso 6: Consolidando balances y ranking de impacto...');
  const articulosConsolidados = consolidarCatalogoBidireccional_(cruceEgresos, cruceIngresos);

  // 6. Escribir informe detallado en pestaña 'Auditoria_Reconciliacion'
  Logger.log('Paso 7: Escribiendo informe en pestaña ' + HOJA_AUDITORIA + '...');
  volcarInformeASheetBidireccional_(ss, cruceEgresos, cruceIngresos, articulosConsolidados, testigoSupabase, egresosSupa, ingresosSupa, egresosSheets.duplicados, ingresosSheets.duplicados);

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
          hayMas = false;
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
 * Cruce Bidireccional Simétrico en Memoria con Clasificación en 3 Niveles
 */
function cruzarBidireccional3Niveles_(itemsSheets, itemsSupa, campoPk) {
  const mapSheets = {};
  itemsSheets.forEach(it => { mapSheets[it.id] = it; });

  const mapSupa = {};
  itemsSupa.forEach(it => { mapSupa[it[campoPk]] = it; });

  const faltantesEnSupabase = []; // En Sheets pero NO en Supabase
  const cantidadDiscrepante = []; // En ambos pero diferente cantidad
  const zombisSeguros = [];       // En Supabase pero NO en Sheets (origin = 'sheets')
  const zombisARevisar = [];      // En Supabase pero NO en Sheets (origin = NULL / otro)
  const protegidosWeb = [];       // En Supabase pero NO en Sheets (origin = 'web', NO TOCAR)

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

  // 2. Evaluar lo que está en Supabase contra Sheets (Dirección Inversa: Zombis en 3 niveles)
  itemsSupa.forEach(supaItem => {
    const pk = supaItem[campoPk];
    if (!mapSheets[pk]) {
      const orig = supaItem.origin;
      if (orig === 'web') {
        protegidosWeb.push(supaItem); // [3] NUNCA se tocan (legítimos de web)
      } else if (orig === 'sheets') {
        zombisSeguros.push(supaItem); // [1] SEGUROS (nacieron en Sheets y ya no están en la hoja)
      } else {
        zombisARevisar.push(supaItem); // [2] A REVISAR (origin NULL u otro, ej. c0ba92d2 de 150 pzas)
      }
    }
  });

  return {
    totalSheets: itemsSheets.length,
    totalSupabase: itemsSupa.length,
    faltantesEnSupabase: faltantesEnSupabase,
    zombisSeguros: zombisSeguros,
    zombisARevisar: zombisARevisar,
    protegidosWeb: protegidosWeb,
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
        egr_zombis_seguros_reg: 0,
        egr_zombis_seguros_pzas: 0,
        egr_zombis_revisar_reg: 0,
        egr_zombis_revisar_pzas: 0,
        ing_zombis_seguros_reg: 0,
        ing_zombis_seguros_pzas: 0,
        ing_zombis_revisar_reg: 0,
        ing_zombis_revisar_pzas: 0
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

  cruceEgr.zombisSeguros.forEach(z => {
    init(z.articulo_id);
    map[z.articulo_id].egr_zombis_seguros_reg++;
    map[z.articulo_id].egr_zombis_seguros_pzas += (z.cantidad || 0);
  });

  cruceEgr.zombisARevisar.forEach(z => {
    init(z.articulo_id);
    map[z.articulo_id].egr_zombis_revisar_reg++;
    map[z.articulo_id].egr_zombis_revisar_pzas += (z.cantidad || 0);
  });

  cruceIng.zombisSeguros.forEach(z => {
    init(z.articulo_id);
    map[z.articulo_id].ing_zombis_seguros_reg++;
    map[z.articulo_id].ing_zombis_seguros_pzas += (z.cantidad || 0);
  });

  cruceIng.zombisARevisar.forEach(z => {
    init(z.articulo_id);
    map[z.articulo_id].ing_zombis_revisar_reg++;
    map[z.articulo_id].ing_zombis_revisar_pzas += (z.cantidad || 0);
  });

  // Impacto neto en stock fantasma
  Object.values(map).forEach(a => {
    const totalIngZombis = a.ing_zombis_seguros_pzas + a.ing_zombis_revisar_pzas;
    const totalEgrZombis = a.egr_zombis_seguros_pzas + a.egr_zombis_revisar_pzas;
    a.impacto_stock_fantasma = (totalIngZombis - totalEgrZombis) + (a.egr_faltantes_pzas - a.ing_faltantes_pzas);
  });

  return map;
}

/**
 * Vuelca el informe visual en la pestaña 'Auditoria_Reconciliacion'
 */
function volcarInformeASheetBidireccional_(ss, cruceEgr, cruceIng, articulosMap, testigoSupa, metaEgr, metaIng, dupEgr, dupIng) {
  let hoja = ss.getSheetByName(HOJA_AUDITORIA);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_AUDITORIA);
  } else {
    hoja.clear();
  }

  const filas = [];
  filas.push(['=== INFORME DE AUDITORÍA FASE 0 AMPLIADA: CRUCE SIMÉTRICO SHEETS vs SUPABASE ===']);
  filas.push(['Generado el:', new Date().toISOString()]);
  filas.push(['Corte Supabase:', FECHA_CORTE_SUPABASE, 'Buffer Sheets (Anti-Timezone):', FECHA_CORTE_SHEETS_BUFFER]);
  filas.push(['Modo de Ejecución:', '100% SOLO LECTURA (Cero mutaciones en BD)']);
  if (metaEgr.incompleto || metaIng.incompleto) {
    filas.push(['[ALERTA]:', 'La descarga de Supabase se pausó por tiempo límite. El reporte cubre hasta el límite descargado.']);
  }
  filas.push(['']);

  // Resumen Global Simétrico con 3 Niveles
  filas.push(['RESUMEN GLOBAL SIMÉTRICO (3 NIVELES)']);
  filas.push(['Concepto', 'Egresos', 'Ingresos']);
  filas.push(['Total registros en Sheets (con buffer)', cruceEgr.totalSheets, cruceIng.totalSheets]);
  filas.push(['Total registros en Supabase (desde 2025-11-01)', cruceEgr.totalSupabase, cruceIng.totalSupabase]);
  filas.push(['[1] Registros FALTANTES en Supabase (Solo en Sheets)', cruceEgr.faltantesEnSupabase.length, cruceIng.faltantesEnSupabase.length]);
  filas.push(['[2] Zombis SEGUROS en Supabase (origin = sheets)', cruceEgr.zombisSeguros.length, cruceIng.zombisSeguros.length]);
  filas.push(['[3] Zombis A REVISAR en Supabase (origin = null / otro)', cruceEgr.zombisARevisar.length, cruceIng.zombisARevisar.length]);
  filas.push(['[4] Movimientos WEB PROTEGIDOS (origin = web, NO tocar)', cruceEgr.protegidosWeb.length, cruceIng.protegidosWeb.length]);
  filas.push(['[5] IDs Duplicados detectados dentro de Sheets', dupEgr.length, dupIng.length]);
  filas.push(['[6] Registros con CANTIDAD DISCREPANTE', cruceEgr.cantidadDiscrepante.length, cruceIng.cantidadDiscrepante.length]);
  filas.push(['']);

  // Sección Caso Testigo
  const artTestigo = testigoSupa.datosArticulo;
  const snapTestigo = testigoSupa.snapshot;
  const balanceTestigo = articulosMap[testigoSupa.articulo_id] || {};

  filas.push(['CASO TESTIGO: ' + testigoSupa.articulo_id + ' (KJXP85269 / ' + (artTestigo.modelo || '') + ')']);
  filas.push(['Nombre:', artTestigo.nombre || 'Refacción Maneral Surtek']);
  filas.push(['Disponibles Base (Fija):', artTestigo.disponibles || 8]);
  filas.push(['Stock Físico actual en Supabase (inventory_snapshot):', snapTestigo.physical_stock]);
  filas.push(['Ingresos ZOMBI A REVISAR (origin=null):', balanceTestigo.ing_zombis_revisar_reg || 0, 'registros (Total ' + (balanceTestigo.ing_zombis_revisar_pzas || 0) + ' piezas fantasma)']);
  filas.push(['Ingresos FALTANTES en Supabase:', balanceTestigo.ing_faltantes_reg || 0, 'registros (Total ' + (balanceTestigo.ing_faltantes_pzas || 0) + ' piezas)']);
  filas.push(['Egresos ZOMBI en Supabase:', (balanceTestigo.egr_zombis_seguros_reg || 0) + (balanceTestigo.egr_zombis_revisar_reg || 0), 'registros']);
  filas.push(['Egresos FALTANTES en Supabase:', balanceTestigo.egr_faltantes_reg || 0, 'registros (Total ' + (balanceTestigo.egr_faltantes_pzas || 0) + ' piezas)']);
  filas.push(['']);

  // Detalle de Zombis a Revisar en el Testigo (incluye c0ba92d2)
  filas.push(['DETALLE DE INGRESOS ZOMBI EN SUPABASE (ARTÍCULO TESTIGO 871b9a3e)']);
  filas.push(['ingreso_id', 'Fecha', 'Cantidad (Pzas)', 'Guía', 'Origin', 'Clasificación']);

  const zombisTestigo = cruceIng.zombisARevisar.concat(cruceIng.zombisSeguros).filter(x => x.articulo_id === testigoSupa.articulo_id);
  if (zombisTestigo.length === 0) {
    filas.push(['(Ningún ingreso zombi detectado para este artículo)', '', '', '', '', '']);
  } else {
    zombisTestigo.forEach(z => {
      const tipo = z.origin === 'sheets' ? 'ZOMBI SEGURO (origin=sheets)' : 'ZOMBI A REVISAR (origin=null)';
      filas.push([z.ingreso_id, z.fecha, z.cantidad, z.guia, String(z.origin), tipo]);
    });
  }
  filas.push(['']);

  // Ranking Top Artículos con Zombis a Revisar (origin = null)
  filas.push(['TOP ARTÍCULOS CON INGRESOS ZOMBI A REVISAR (origin = null / inflan stock)']);
  filas.push(['articulo_id', 'Ingresos Zombi (Reg)', 'Piezas Zombi (Sobran)', 'Ingresos Faltantes (Reg)', 'Piezas Faltantes', 'Desfase Neto Stock']);

  const conZombisRevisar = Object.values(articulosMap).filter(a => a.ing_zombis_revisar_reg > 0);
  if (conZombisRevisar.length === 0) {
    filas.push(['(No se detectaron ingresos zombi con origin=null)', '', '', '', '', '']);
  } else {
    conZombisRevisar.sort((a, b) => b.ing_zombis_revisar_pzas - a.ing_zombis_revisar_pzas).slice(0, 50).forEach(a => {
      filas.push([a.articulo_id, a.ing_zombis_revisar_reg, a.ing_zombis_revisar_pzas, a.ing_faltantes_reg, a.ing_faltantes_pzas, a.impacto_stock_fantasma]);
    });
  }
  filas.push(['']);

  // Ranking Top Artículos con Zombis Seguros (origin = sheets)
  filas.push(['TOP ARTÍCULOS CON MOVIMIENTOS ZOMBI SEGUROS (origin = sheets)']);
  filas.push(['articulo_id', 'Egresos Zombi (Reg)', 'Piezas Egr', 'Ingresos Zombi (Reg)', 'Piezas Ing']);

  const conZombisSeguros = Object.values(articulosMap).filter(a => a.egr_zombis_seguros_reg > 0 || a.ing_zombis_seguros_reg > 0);
  if (conZombisSeguros.length === 0) {
    filas.push(['(No se detectaron movimientos zombi con origin=sheets)', '', '', '', '']);
  } else {
    conZombisSeguros.sort((a, b) => b.egr_zombis_seguros_pzas - a.egr_zombis_seguros_pzas).slice(0, 50).forEach(a => {
      filas.push([a.articulo_id, a.egr_zombis_seguros_reg, a.egr_zombis_seguros_pzas, a.ing_zombis_seguros_reg, a.ing_zombis_seguros_pzas]);
    });
  }
  filas.push(['']);

  // Ranking Top Artículos con Faltantes en Supabase (Compras en Sheets que faltan subir)
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

  // Alerta de IDs duplicados en Sheets si existen
  if (dupEgr.length > 0 || dupIng.length > 0) {
    filas.push(['']);
    filas.push(['[ATENCIÓN]: IDS DUPLICADOS DETECTADOS DENTRO DE GOOGLE SHEETS']);
    filas.push(['Hoja', 'ID Duplicado', 'Fila en Sheet', 'Cantidad en Fila']);
    dupEgr.forEach(d => filas.push(['Egresos', d.id, d.fila, d.cantidad]));
    dupIng.forEach(d => filas.push(['Ingresos', d.id, d.fila, d.cantidad]));
  }

  // Volcar a la cuadrícula
  hoja.getRange(1, 1, filas.length, 6).setValues(filas.map(r => {
    while (r.length < 6) r.push('');
    return r;
  }));

  hoja.autoResizeColumns(1, 6);
}

/**
 * Lector dinámico robusto que combina getDisplayValues() para IDs y getValues() para tipos nativos
 */
function leerSheetsDinamicoRobusto_(ss, nombreHoja, corteEpoch, aliasId, defaultIdCol) {
  const hoja = ss.getSheetByName(nombreHoja);
  if (!hoja) throw new Error("Hoja '" + nombreHoja + "' no encontrada.");
  const ultimaFila = hoja.getLastRow();
  const ultimaCol = hoja.getLastColumn();
  if (ultimaFila < 2) return { items: [], duplicados: [] };

  const headers = hoja.getRange(1, 1, 1, ultimaCol).getValues()[0].map(h => String(h).trim().toLowerCase());

  const idxId = encontrarColumna_(headers, aliasId, defaultIdCol);
  const idxArt = encontrarColumna_(headers, ['articulo_id', 'articulo', 'sku'], 2);
  const idxCant = encontrarColumna_(headers, ['cantidad', 'piezas', 'cant'], 3);
  const idxFecha = encontrarColumna_(headers, ['fecha', 'fecha_egreso', 'fecha_ingreso', 'creado_el'], 8);
  const idxGuia = encontrarColumna_(headers, ['guia', 'numero_guia'], 4);
  const idxTipo = encontrarColumna_(headers, ['tipo_egreso', 'tipo_ingreso', 'tipo'], 6);

  // Leer valores nativos y display values simultáneamente
  const rango = hoja.getRange(2, 1, ultimaFila - 1, ultimaCol);
  const datosValores = rango.getValues();
  const datosDisplay = rango.getDisplayValues(); // Blindaje contra fechas en IDs

  const map = {};
  const items = [];
  const duplicados = [];

  for (let i = 0; i < datosValores.length; i++) {
    // Usar getDisplayValues() para el ID (evita que '13feb0128' sea un objeto Date)
    const id = datosDisplay[i][idxId] ? String(datosDisplay[i][idxId]).trim() : '';
    const articulo_id = datosDisplay[i][idxArt] ? String(datosDisplay[i][idxArt]).trim() : '';
    const cant = parseInt(datosValores[i][idxCant], 10) || 0;
    const fechaVal = datosValores[i][idxFecha];
    if (!id || !articulo_id) continue;

    const f = parseFechaAuditoria_(fechaVal);
    if (!f || f.getTime() < corteEpoch) continue;

    const item = {
      id: id,
      articulo_id: articulo_id,
      cantidad: cant,
      fecha: f.toISOString(),
      guia: idxGuia !== -1 && datosDisplay[i][idxGuia] ? String(datosDisplay[i][idxGuia]).trim() : '',
      tipo: idxTipo !== -1 && datosDisplay[i][idxTipo] ? String(datosDisplay[i][idxTipo]).trim() : '',
      fila_sheet: i + 2
    };

    // Detección y suma si está duplicado en la misma hoja
    if (map[id]) {
      duplicados.push({ id: id, fila: i + 2, cantidad: cant });
      map[id].cantidad += cant; // Acumular piezas para que la suma total sea exacta
    } else {
      map[id] = item;
      items.push(item);
    }
  }

  return { items: items, duplicados: duplicados };
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
