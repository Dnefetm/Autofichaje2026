// ============================================================
// PROCESADOR DE IMPORTACIONES - ENVIOS FULL
// ============================================================
// Flujo: ImportarEgresos -> Egresos + EnviosFull
// Menu: Envios Full > Procesar Importacion
// ============================================================




// ---- CONFIGURACION ----
const CONFIG = {
  SHEETS: {
    IMPORTAR: 'ImportarEgresos',
    ARTICULOS: 'Artículos',
    EGRESOS: 'Egresos',
    ENVIOS_FULL: 'EnviosFull'
  },
  // Columnas ImportarEgresos (0-indexed)
  COL_IMPORT: {
    GUIA: 0,                  // A - Guia
    CODIGO_ML: 1,             // B - CodigoML
    CODIGO_UNIVERSAL: 2,      // C - CodigoUniversal
    SKU_ML: 3,                // D - SKU_ML
    NOMBRE_ML: 4,             // E - NombreML
    UNIDADES: 5,              // F - Unidades
    IDENTIFICACION_ML: 6,     // G - Identificacion
    INSTRUCCIONES_PREP: 7,    // H - Instrucciones
    SKU_INVENTARIO: 8,        // I - SKU_Inventario
    ESTADO_VALIDACION: 9,     // J - EstadoValidacion
    ID_IMPORTACION: 10        // K - IDImportacion
  },
  // Columnas Articulos (0-indexed)
  COL_ARTICULOS: {
    ARTICULO_KEY: 0,          // A - #Articulo (KEY hex)
    MODELO_SKU: 1,            // B - Modelo (SKU)
    CODIGO_BARRAS_MELI: 12    // M - Codigo barras Meli
  },
  // Columnas Egresos (para utilidades internas, 0-indexed respecto a la hoja)
  // Estructura física:
  // A: ID Egreso
  // B: # egreso
  // C: Articulo
  // D: Cantidad
  // E: Guia
  // F: Transportista
  // G: Tipo de egreso
  // H: Nota
  // I: Fecha
  // J: Operador
  // K-M: Imagen 1-3
  // N-P: Largo, Ancho, Alto
  // Q: Peso
  // R: SalidasPeriodo
  // S: CodigoML
  // T: EdoReunido
  // U: FechaReunido          // FIX: documentar nueva columna FechaReunido
  // V: FechaPreparado        // FIX: documentar nueva columna FechaPreparado
  // W: ImportarEgreso (Ref a ImportarEgresos - IDImportacion)  // FIX: actualizar y documentar nueva posición de ImportarEgreso
  COL_EGRESOS: {
    ID_EGRESO: 0,       // Col A
    NUM_EGRESO: 1,      // Col B
    ARTICULO: 2,        // Col C
    IMPORTAR_EGRESO: 22 // Col W (0-indexed) // FIX: actualizar índice de ImportarEgreso de 20(U) a 22(W)
  },
  // Columnas EnviosFull (orden de escritura)
  COL_ENVIOS: {
    ID_ENVIO_FULL: 0,
    GUIA: 1,
    FECHA_CREACION: 2,
    EDO_GENERAL: 3
  },
  // Valor fijo para Tipo de egreso en Egresos
  TIPO_EGRESO_DEFAULT: 'Envío a Full'
};




// ============================================================
// MENU PERSONALIZADO
// ============================================================




function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Envios Full')
    .addItem('Procesar Importacion', 'procesarImportacionFull')
    .addItem('Reprocesar No Encontrados', 'reprocesarNoEncontrados')
    .addToUi();
}




// ============================================================
// FUNCION PRINCIPAL
// ============================================================




function procesarImportacionFull() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();


  // --- Confirmacion del usuario ---
  const respuesta = ui.alert(
    'Procesar Importacion Full',
    'Deseas procesar las filas pendientes en ImportarEgresos?',
    ui.ButtonSet.YES_NO
  );
  if (respuesta !== ui.Button.YES) return;


  try {
    // --- Obtener hojas ---
    const sheetImportar = ss.getSheetByName(CONFIG.SHEETS.IMPORTAR);
    const sheetArticulos = ss.getSheetByName(CONFIG.SHEETS.ARTICULOS);
    const sheetEgresos = ss.getSheetByName(CONFIG.SHEETS.EGRESOS);
    const sheetEnvios = ss.getSheetByName(CONFIG.SHEETS.ENVIOS_FULL);


    // Validar que todas las hojas existan
    const hojasNoEncontradas = [];
    if (!sheetImportar) hojasNoEncontradas.push('ImportarEgresos');
    if (!sheetArticulos) hojasNoEncontradas.push('Articulos');
    if (!sheetEgresos) hojasNoEncontradas.push('Egresos');
    if (!sheetEnvios) hojasNoEncontradas.push('EnviosFull');


    if (hojasNoEncontradas.length > 0) {
      ui.alert('Error: No se encontraron las hojas: ' + hojasNoEncontradas.join(', '));
      return;
    }


    // --- Construir índice de CODIGO_BARRAS_MELI para búsqueda "contiene" ---
    const codigoBarrasIndex = buildCodigoBarrasMap_(sheetArticulos);


    // --- Construir set de guias existentes en EnviosFull ---
    const guiasExistentes = buildGuiasSet_(sheetEnvios);


    // --- Obtener siguiente #egreso ---
    let siguienteNumEgreso = getNextNumEgreso_(sheetEgresos);


    // --- Leer filas de ImportarEgresos (sin header, solo A-K) ---
    const lastRow = sheetImportar.getLastRow();
    if (lastRow < 2) {
      ui.alert('No hay filas para procesar en ImportarEgresos.');
      return;
    }
    const totalColsImport = CONFIG.COL_IMPORT.ID_IMPORTACION + 1; // 11 columnas (A-K)
    const dataRange = sheetImportar.getRange(2, 1, lastRow - 1, totalColsImport);
    const data = dataRange.getValues();


    // --- Contadores ---
    let procesadas = 0;
    let noEncontradas = 0;
    let omitidas = 0;


    // --- Buffers de escritura batch ---
    const egresosNuevos = [];
    const enviosNuevos = [];
    const guiasCreadas = new Set();
    const estadoUpdates = [];       // [fila (1-based), valor]
    const idImportUpdates = [];     // [fila (1-based), idImportacion]


    const fechaHoy = new Date();


    // --- Procesar cada fila ---
    for (let i = 0; i < data.length; i++) {
      const fila = data[i];
      const estadoActual = String(fila[CONFIG.COL_IMPORT.ESTADO_VALIDACION] || '').trim();


      // Saltar filas ya procesadas o marcadas
      if (estadoActual === 'Procesado' || estadoActual === 'No encontrado') {
        omitidas++;
        continue;
      }


      const guia = String(fila[CONFIG.COL_IMPORT.GUIA] || '').trim();
      const codigoML = String(fila[CONFIG.COL_IMPORT.CODIGO_ML] || '').trim();
      const unidades = Number(fila[CONFIG.COL_IMPORT.UNIDADES]) || 1;


      // Validar datos minimos
      if (!guia || !codigoML) {
        estadoUpdates.push([i + 2, 'Error: datos vacios']);
        continue;
      }


      // Asegurar IDImportacion por fila (si está vacío, generarlo)
      let idImportacion = String(fila[CONFIG.COL_IMPORT.ID_IMPORTACION] || '').trim();
      if (!idImportacion) {
        idImportacion = Utilities.getUuid();
        idImportUpdates.push([i + 2, idImportacion]);
      }


      // Buscar articulos usando búsqueda "CONTIENE" en CODIGO_BARRAS_MELI (TODOS los matches)
      const articulosKeys = buscarArticulosPorCodigoML(codigoML, codigoBarrasIndex);


      if (articulosKeys.length > 0) {
        // MATCH - crear un egreso por cada artículo encontrado
        articulosKeys.forEach(articuloKey => {
          const idEgreso = Utilities.getUuid();
          const numEgreso = siguienteNumEgreso++;


          // Construir fila completa A–W (23 columnas) para Egresos, con ImportarEgreso en W
          egresosNuevos.push([
            // A: ID Egreso
            idEgreso,
            // B: # egreso
            numEgreso,
            // C: Articulo (SKU/Modelo)
            articuloKey,
            // D: Cantidad
            0, // Cantidad: 0 por defecto, operario determina la cantidad real
            // E: Guia
            guia,
            // F: Transportista
            '',
            // G: Tipo de egreso
            CONFIG.TIPO_EGRESO_DEFAULT,
            // H: Nota
            '',
            // I: Fecha
            fechaHoy,
            // J: Operador
            '',
            // K: Imagen 1
            '',
            // L: Imagen 2
            '',
            // M: Imagen 3
            '',
            // N: Largo
            '',
            // O: Ancho
            '',
            // P: Alto
            '',
            // Q: Peso
            '',
            // R: SalidasPeriodo
            '',
            // S: CodigoML
            codigoML,
            // T: EdoReunido
            'Pendiente',
            // U: FechaReunido
            '',              // FIX: nueva columna FechaReunido (U) creada vacía
            // V: FechaPreparado
            '',              // FIX: nueva columna FechaPreparado (V) creada vacía
            // W: ImportarEgreso (Ref a ImportarEgresos.IDImportacion)
            idImportacion    // FIX: desplazar ImportarEgreso a la nueva posición W
          ]);
        });


        estadoUpdates.push([i + 2, 'Procesado']);
        procesadas++;


        // Crear EnvioFull si la guia es nueva
        if (!guiasExistentes.has(guia) && !guiasCreadas.has(guia)) {
          const idEnvio = Utilities.getUuid();
          enviosNuevos.push([
            idEnvio,
            guia,
            fechaHoy,
            '',          // D - NombreEnvio (vacio)
            '',          // E - DescripcionEnvio (vacio)
            'Pendiente'
          ]);
          guiasCreadas.add(guia);
        }
      } else {
        // CODIGO_ML no encontrado en CODIGO_BARRAS_MELI
        estadoUpdates.push([i + 2, 'No encontrado']);
        noEncontradas++;
      }
    }


    // --- Escritura batch: Egresos ---
    if (egresosNuevos.length > 0) {
      const startRow = sheetEgresos.getLastRow() + 1;
      sheetEgresos
        .getRange(startRow, 1, egresosNuevos.length, egresosNuevos[0].length)
        .setValues(egresosNuevos);
    }


    // --- Escritura batch: EnviosFull ---
    if (enviosNuevos.length > 0) {
      const startRow = sheetEnvios.getLastRow() + 1;
      sheetEnvios
        .getRange(startRow, 1, enviosNuevos.length, enviosNuevos[0].length)
        .setValues(enviosNuevos);
    }


    // --- Escritura: EstadoValidacion en ImportarEgresos ---
    const colEstado = CONFIG.COL_IMPORT.ESTADO_VALIDACION + 1; // J
    estadoUpdates.forEach(([fila, valor]) => {
      sheetImportar.getRange(fila, colEstado).setValue(valor);
    });


    // --- Escritura: IDImportacion en ImportarEgresos ---
    if (idImportUpdates.length > 0) {
      const colIdImport = CONFIG.COL_IMPORT.ID_IMPORTACION + 1; // K
      idImportUpdates.forEach(([fila, valor]) => {
        sheetImportar.getRange(fila, colIdImport).setValue(valor);
      });
    }


    // --- Resultado ---
    ui.alert(
      'Importacion Completada',
      'Resultados:\n' +
      `- Procesadas: ${procesadas}\n` +
      `- No encontradas: ${noEncontradas}\n` +
      `- Omitidas (ya procesadas): ${omitidas}\n` +
      `- Envios Full creados: ${enviosNuevos.length}`,
      ui.ButtonSet.OK
    );


  } catch (error) {
    console.error('Error en procesarImportacionFull:', error);
    SpreadsheetApp.getUi().alert('Error', 'Ocurrio un error:\n' + error.message, SpreadsheetApp.getUi().ButtonSet.OK);
  }
}




// ============================================================
// FUNCIONES AUXILIARES
// ============================================================




/**
 * Índice para búsqueda por "CONTIENE" en CODIGO_BARRAS_MELI.
 * Devuelve un array de objetos: [{ codigoBarrasCelda: string, articuloKey: string }, ...]
 */
function buildCodigoBarrasMap_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];


  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const colKey = CONFIG.COL_ARTICULOS.ARTICULO_KEY;
  const colCodigoBarras = CONFIG.COL_ARTICULOS.CODIGO_BARRAS_MELI;


  const index = [];


  data.forEach(row => {
    const codigoCelda = String(row[colCodigoBarras] || '').trim();
    const key = String(row[colKey] || '').trim();
    if (codigoCelda && key) {
      index.push({
        codigoBarrasCelda: codigoCelda,
        articuloKey: key
      });
    }
  });


  return index;
}


/**
 * Busca un artículo cuyo CODIGO_BARRAS_MELI CONTENGA el codigoML indicado.
 * Recibe:
 *  - codigoML: string (de ImportarEgresos)
 *  - index: array devuelto por buildCodigoBarrasMap_
 * Devuelve:
 *  - articuloKey (string) o null si no encuentra.
 *
 * NOTA: Se mantiene por compatibilidad; ahora usa la función múltiple y devuelve el primer match.
 */
function buscarArticuloPorCodigoML(codigoML, index) {
  const articulos = buscarArticulosPorCodigoML(codigoML, index);
  return articulos.length > 0 ? articulos[0] : null;
}


/**
 * Variante que devuelve TODOS los artículos cuyo CODIGO_BARRAS_MELI CONTENGA el codigoML indicado.
 * Recibe:
 *  - codigoML: string (de ImportarEgresos)
 *  - index: array devuelto por buildCodigoBarrasMap_
 * Devuelve:
 *  - array de articuloKey (puede ser vacío si no hay coincidencias).
 */
function buscarArticulosPorCodigoML(codigoML, index) {
  const needle = String(codigoML || '').trim();
  if (!needle) return [];


  const needleUpper = needle.toUpperCase();
  const resultados = [];


  for (let i = 0; i < index.length; i++) {
    const entry = index[i];
    const haystack = String(entry.codigoBarrasCelda || '');
    if (!haystack) continue;


    if (haystack.toUpperCase().indexOf(needleUpper) !== -1) {
      resultados.push(entry.articuloKey);
    }
  }


  return resultados;
}


/**
 * Set de guias ya registradas en EnviosFull.
 */
function buildGuiasSet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return new Set();


  const guias = sheet.getRange(2, CONFIG.COL_ENVIOS.GUIA + 1, lastRow - 1, 1).getValues();
  const set = new Set();
  guias.forEach(row => {
    const g = String(row[0]).trim();
    if (g) set.add(g);
  });
  return set;
}




/**
 * Siguiente #egreso secuencial (max + 1).
 */
function getNextNumEgreso_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;


  const nums = sheet
    .getRange(2, CONFIG.COL_EGRESOS.NUM_EGRESO + 1, lastRow - 1, 1)
    .getValues();


  let max = 0;
  nums.forEach(row => {
    const n = Number(row[0]) || 0;
    if (n > max) max = n;
  });


  return max + 1;
}




/**
 * Genera un ID hex aleatorio (placeholder; se conserva por compatibilidad).
 */
function generarHexId_() {
  const chars = 'abcdef0123456789';
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}




/**
 * Reprocesa un egreso no identificado después de que el usuario
 * haya seleccionado manualmente el artículo correcto.
 * Se llama desde AppSheet mediante webhook.
 * @param {string} idEgreso - ID del egreso a reprocesar
 * @param {string} articuloKey - # Artículo (KEY) seleccionado del catálogo
 * @return {Object} Resultado de la operación
 */
function reprocesarNoEncontrado(idEgreso, articuloKey) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetEgresos = ss.getSheetByName(CONFIG.SHEETS.EGRESOS);
  const sheetArticulos = ss.getSheetByName(CONFIG.SHEETS.ARTICULOS);


  if (!sheetEgresos || !sheetArticulos) {
    return { success: false, error: 'No se encontraron las hojas requeridas' };
  }


  try {
    // Buscar la fila del egreso por ID
    const datosEgresos = sheetEgresos.getDataRange().getValues();
    let filaEgreso = -1;


    for (let i = 1; i < datosEgresos.length; i++) {
      if (datosEgresos[i][CONFIG.COL_EGRESOS.ID_EGRESO] === idEgreso) {
        filaEgreso = i + 1; // +1 porque getDataRange es 0-indexed pero setValue usa 1-indexed en filas
        break;
      }
    }


    if (filaEgreso === -1) {
      return { success: false, error: 'No se encontró el egreso con ID: ' + idEgreso };
    }


    // Actualizar el campo Artículo en el egreso
    sheetEgresos
      .getRange(filaEgreso, CONFIG.COL_EGRESOS.ARTICULO + 1)
      .setValue(articuloKey);


    Logger.log('Egreso ' + idEgreso + ' actualizado con artículo ' + articuloKey);


    return {
      success: true,
      message: 'Egreso ' + idEgreso + ' vinculado al artículo ' + articuloKey,
      idEgreso: idEgreso,
      articulo: articuloKey
    };


  } catch (error) {
    Logger.log('Error en reprocesarNoEncontrado: ' + error.message);
    return { success: false, error: error.message };
  }
}




// ============================================================================
// FUNCION PARA REPROCESAR TODOS LOS NO ENCONTRADOS
// ============================================================================




function reprocesarNoEncontrados() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetImportar = ss.getSheetByName(CONFIG.SHEETS.IMPORTAR);


  if (!sheetImportar) {
    ui.alert('Error', 'No se encontró la hoja ImportarEgresos', ui.ButtonSet.OK);
    return;
  }


  const lastRow = sheetImportar.getLastRow();
  if (lastRow < 2) {
    ui.alert('Info', 'No hay datos para procesar', ui.ButtonSet.OK);
    return;
  }


  // Leer todos los datos (al menos hasta EstadoValidacion y CodigoML)
  const dataRange = sheetImportar.getRange(2, 1, lastRow - 1, CONFIG.COL_IMPORT.ID_IMPORTACION + 2); // A-L si existiera, se mantiene ancho amplio
  const data = dataRange.getValues();


  // Filtrar filas con EstadoValidación = 'No encontrado' (SIN requerir SKU_Inventario)
  const noEncontrados = [];
  data.forEach((row, index) => {
    const estado = String(row[CONFIG.COL_IMPORT.ESTADO_VALIDACION] || '').trim();
    if (estado === 'No encontrado') {
      noEncontrados.push({
        rowIndex: index + 2,
        codigoML: row[CONFIG.COL_IMPORT.CODIGO_ML],
        guia: row[CONFIG.COL_IMPORT.GUIA],
        unidades: row[CONFIG.COL_IMPORT.UNIDADES],
        idImportacion: row[CONFIG.COL_IMPORT.ID_IMPORTACION]
      });
    }
  });


  if (noEncontrados.length === 0) {
    ui.alert('Info', 'No hay registros con estado "No encontrado"', ui.ButtonSet.OK);
    return;
  }


  // Confirmar reprocesamiento
  const response = ui.alert(
    'Reprocesar No Encontrados',
    'Se encontraron ' + noEncontrados.length + ' registros con estado "No encontrado".\n\n' +
    '¿Desea reprocesarlos?',
    ui.ButtonSet.YES_NO
  );


  if (response !== ui.Button.YES) {
    return;
  }


  const sheetArticulos = ss.getSheetByName(CONFIG.SHEETS.ARTICULOS);
  const sheetEgresos = ss.getSheetByName(CONFIG.SHEETS.EGRESOS);


  if (!sheetArticulos || !sheetEgresos) {
    ui.alert('Error', 'No se encontraron hojas Artículos o Egresos', ui.ButtonSet.OK);
    return;
  }


  // Índice de códigos de barras para búsqueda "contiene"
  const codigoBarrasIndex = buildCodigoBarrasMap_(sheetArticulos);


  const egresosNuevos = [];


  // Obtener siguiente numero de egreso (buscar el maximo actual)
  const egresosData = sheetEgresos.getDataRange().getValues();
  let maxNumEgreso = 0;
  for (let i = 1; i < egresosData.length; i++) {
    const numEgreso = parseInt(egresosData[i][1]) || 0; // Columna B es # egreso
    if (numEgreso > maxNumEgreso) maxNumEgreso = numEgreso;
  }
  let siguienteNumEgreso = maxNumEgreso + 1;


  let procesados = 0;
  let encontrados = 0;
  let noEncontradosCount = 0;


  noEncontrados.forEach(item => {
    const codigoML = item.codigoML || '';
    const guia = item.guia || '';
    const fechaHoy = new Date();


    // Buscar TODOS los artículos para este CodigoML
    const articulosKeys = buscarArticulosPorCodigoML(codigoML, codigoBarrasIndex);


    if (articulosKeys.length > 0) {
      // Actualizar el registro en ImportarEgresos: marcar como Procesado
      sheetImportar
        .getRange(item.rowIndex, CONFIG.COL_IMPORT.ESTADO_VALIDACION + 1)
        .setValue('Procesado');


      // Crear un egreso por cada artículo encontrado
      articulosKeys.forEach(articuloKey => {
        const idEgreso = Utilities.getUuid();
        const numEgreso = siguienteNumEgreso++;


        const filaEgreso = [
          idEgreso,                    // A: ID Egreso (KEY)
          numEgreso,                  // B: # egreso
          articuloKey,                // C: Articulo (Ref)
          0,                          // D: Cantidad (0, operario define)
          guia,                       // E: Guia
          '',                         // F: Transportista
          CONFIG.TIPO_EGRESO_DEFAULT, // G: Tipo de egreso
          '',                         // H: Nota
          fechaHoy,                   // I: Fecha
          '',                         // J: Operador
          '', '', '',                 // K-M: Imagen 1, 2, 3
          '', '', '', '',             // N-Q: Largo, Ancho, Alto, Peso
          '',                         // R: SalidasPeriodo
          codigoML,                   // S: CodigoML
          'Pendiente',                // T: EdoReunido
          '',                         // U: FechaReunido (vacío en reprocesados)
          '',                         // V: FechaPreparado (vacío en reprocesados)
          item.idImportacion           // W: ImportarEgreso (IDImportacion)
        ];
        egresosNuevos.push(filaEgreso);
      });


      encontrados += articulosKeys.length;
    } else {
      // No se encontró match: se deja EstadoValidacion = 'No encontrado'
      noEncontradosCount++;
    }
    procesados++;
  });


  // Escribir egresos en batch si hay nuevos
  if (egresosNuevos.length > 0) {
    const startRow = sheetEgresos.getLastRow() + 1;
    sheetEgresos
      .getRange(startRow, 1, egresosNuevos.length, egresosNuevos[0].length)
      .setValues(egresosNuevos);
  }


  ui.alert(
    'Reprocesamiento Completado',
    'Resultados:\n\n' +
    '- Procesados: ' + procesados + '\n' +
    '- Egresos creados (artículos encontrados): ' + encontrados + '\n' +
    '- Aún no encontrados: ' + noEncontradosCount,
    ui.ButtonSet.OK
  );
}