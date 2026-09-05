function exportarHojaInventario() {
  
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const hojaDeInteres = "Artículos";
  const carpetaDestinoID = "1m82554EqrVKt2DmMcxJIqWPtIPl4c27E"; // Reemplaza con el ID de tu carpeta

  const hoja = spreadsheet.getSheetByName(hojaDeInteres);
  if (!hoja) {
    Browser.msgBox('Error: No se encontró la hoja llamada "' + hojaDeInteres + '".');
    return;
  }
  
  // 1. Crea una copia temporal de la hoja en un nuevo libro
  const tempSpreadsheet = SpreadsheetApp.create("Copia temporal para exportación");
  const tempSheet = hoja.copyTo(tempSpreadsheet);
  
 // Renombra la hoja copiada para que se llame 'Artículos'
  tempSheet.setName("Artículos");
  
  // 2. Pega solo los valores para evitar fórmulas
  const rango = tempSheet.getDataRange();
  const valores = rango.getValues();
  rango.clearContent();
  rango.setValues(valores);
  
  // 3. Genera el nombre del archivo con la fecha actual
  const hoy = new Date();
  const dia = hoy.getDate().toString().padStart(2, '0');
  const mes = (hoy.getMonth() + 1).toString().padStart(2, '0');
  const anio = hoy.getFullYear();
  const nombreArchivo = `INVENTARIO-${dia}-${mes}-${anio}.xlsx`;
  
 // 4. Guarda el archivo en la carpeta de destino de Google Drive
  try {
    const carpetaDestino = DriveApp.getFolderById(carpetaDestinoID);
    const tempSpreadsheetId = tempSpreadsheet.getId(); // Obtiene el ID del archivo temporal
    
    // Obtiene el token de autenticación para acceder a la API de Drive
    const token = ScriptApp.getOAuthToken();
    
    // URL de exportación para obtener un archivo de Excel (xlsx)
    const exportUrl = `https://docs.google.com/spreadsheets/d/${tempSpreadsheetId}/export?format=xlsx`;
    
    // Obtiene el archivo de Excel usando la URL de exportación
    const excelBlob = UrlFetchApp.fetch(exportUrl, {
      headers: {
        Authorization: 'Bearer ' + token,
      },
    }).getBlob().setName(nombreArchivo);
    
    carpetaDestino.createFile(excelBlob);
  } catch(e) {
    Browser.msgBox('Error al guardar el archivo: ' + e.message + '. El ID de la carpeta de destino podría ser incorrecto, o falta el permiso de la API de Drive. Por favor, habilita la API de Drive en tu proyecto.');
    return;
  }
  
  // 5. Borra la hoja de trabajo temporal de forma segura
  try {
    DriveApp.getFileById(tempSpreadsheet.getId()).setTrashed(true);
  } catch(e) {
    Browser.msgBox('Advertencia: El archivo temporal no pudo ser borrado. Borra el archivo llamado "Copia temporal para exportación" de tu Google Drive manualmente.');
  }
  
  // 6. Mensaje de éxito
  Browser.msgBox('Exportación completada. El archivo ' + nombreArchivo + ' ha sido creado en tu Google Drive.');
}