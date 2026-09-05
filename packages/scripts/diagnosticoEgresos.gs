function diagnosticoEgresos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var hoja = ss.getSheetByName('Egresos');
  var datos = hoja.getDataRange().getValues();
  var total = datos.length - 1;
  var conId = 0, sinIdConArt = 0, sinIdSinArt = 0, vacias = 0;
  var tiposSinId = {};
  var muestraSinId = [];
  
  for (var i = 1; i < datos.length; i++) {
    var idEgreso = datos[i][0] ? String(datos[i][0]).trim() : '';
    var articulo = datos[i][2] ? String(datos[i][2]).trim() : '';
    var tipo = datos[i][6] ? String(datos[i][6]).trim() : '';
    
    if (!articulo && !idEgreso) { vacias++; continue; }
    
    if (idEgreso) {
      conId++;
    } else {
      if (articulo) {
        sinIdConArt++;
        var t = tipo || 'SIN_TIPO';
        tiposSinId[t] = (tiposSinId[t] || 0) + 1;
        if (muestraSinId.length < 10) {
          muestraSinId.push('Fila ' + (i+1) + ': art=' + articulo.substring(0,12) + ' tipo=' + tipo + ' guia=' + (datos[i][4] || ''));
        }
      } else {
        sinIdSinArt++;
      }
    }
  }
  
  Logger.log('=== DIAGNOSTICO EGRESOS SHEETS ===');
  Logger.log('Total filas (sin header): ' + total);
  Logger.log('Filas vacias: ' + vacias);
  Logger.log('Con ID egreso: ' + conId);
  Logger.log('Sin ID pero con Articulo: ' + sinIdConArt);
  Logger.log('Sin ID sin Articulo: ' + sinIdSinArt);
  Logger.log('--- Tipos de egreso SIN ID ---');
  var keys = Object.keys(tiposSinId).sort(function(a,b) { return tiposSinId[b] - tiposSinId[a]; });
  for (var k = 0; k < keys.length; k++) {
    Logger.log('  ' + keys[k] + ': ' + tiposSinId[keys[k]]);
  }
  Logger.log('--- Muestra de filas sin ID ---');
  for (var m = 0; m < muestraSinId.length; m++) {
    Logger.log('  ' + muestraSinId[m]);
  }
}