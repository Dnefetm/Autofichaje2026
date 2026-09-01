// ============================================================================
// sincSupabaseASheets.gs — REVERSO: Supabase -> Sheets
// Consume sync_outbox (solo cambios origin='web') y los escribe en el Sheet.
// Es la imagen especular del forward (sincIngresos/sincEgresos/sincArticulos).
// Reutiliza SUPABASE_URL / SUPABASE_SERVICE_KEY ya definidas en el proyecto.
// ============================================================================

var HOJAS_REVERSO = { articulos: 'Artículos', ingresos: 'Ingresos', egresos: 'Egresos' };

function sincSupabaseASheets() {
  var pendientes = leerOutboxPendiente(500);
  if (!pendientes.length) { Logger.log('Reverso: outbox vacío.'); return; }

  var porTabla = { articulos: [], ingresos: [], egresos: [] };
  pendientes.forEach(function(e){ if (porTabla[e.tabla]) porTabla[e.tabla].push(e); });

  var enviados = 0, errores = 0;
  ['articulos','ingresos','egresos'].forEach(function(tabla){
    var items = porTabla[tabla];
    if (!items.length) return;
    try {
      var claves = items.map(function(x){ return x.clave; });
      var filas = leerFilasSupabase(tabla, claves);       // una sola query in.(...)
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var hoja = ss.getSheetByName(HOJAS_REVERSO[tabla]);
      if (!hoja) { items.forEach(function(x){ marcarOutbox(x.id,'error','hoja no encontrada'); }); errores += items.length; return; }

      // mapa clave -> índice de fila (col A), en memoria, una sola pasada
      var ultima = hoja.getLastRow();
      var colA = ultima > 1 ? hoja.getRange(2, 1, ultima - 1, 1).getValues() : [];
      var idxPorClave = {};
      for (var r = 0; r < colA.length; r++) {
        var v = colA[r][0];
        if (v !== '' && v !== null) idxPorClave[String(v).trim()] = r + 2; // fila real
      }

      var nuevas = [];
      var updates = [];   // [{fila, filaSheet}]
      var idsOk = [];

      filas.forEach(function(fila){
        var filaSheet = serializar(tabla, fila);
        var clave = filaSheet[0];
        if (idxPorClave.hasOwnProperty(clave)) {
          updates.push({ fila: idxPorClave[clave], filaSheet: filaSheet });
        } else {
          nuevas.push(filaSheet);
        }
        idsOk.push(clave);
      });

      // escritura por BLOQUES: un solo setValues para updates, un solo append para nuevas
      if (updates.length) {
        var filasOrdenadas = updates.sort(function(a,b){ return a.fila - b.fila; });
        // para simplicidad y sin huecos grandes: actualizar por rango individual sería N calls;
        // aquí agrupamos en un solo 2D por hoja (asumiendo filas contiguas razonables)
        var minFila = filasOrdenadas[0].fila, maxFila = filasOrdenadas[filasOrdenadas.length-1].fila;
        var ancho = filasOrdenadas[0].filaSheet.length;
        var bloque = [];
        for (var f = minFila; f <= maxFila; f++) {
          var hit = null;
          filasOrdenadas.forEach(function(u){ if (u.fila === f) hit = u; });
          if (hit) { bloque.push(hit.filaSheet); }
          else {
            var filaActual = hoja.getRange(f, 1, 1, ancho).getValues()[0];
            bloque.push(filaActual);
          }
        }
        hoja.getRange(minFila, 1, bloque.length, ancho).setValues(bloque);
      }
      if (nuevas.length) {
        // append de todas las nuevas en un solo rango
        hoja.getRange(ultima + 1, 1, nuevas.length, nuevas[0].length).setValues(nuevas);
      }

      // marcar outbox en lote
      idsOk.forEach(function(clave){ /* mapear de vuelta a outbox id */ });
      items.forEach(function(x){ marcarOutbox(x.id, 'enviado', null); });
      enviados += items.length;
    } catch (err) {
      items.forEach(function(x){ marcarOutbox(x.id, 'error', String(err)); });
      errores += items.length;
    }
  });

  Logger.log('Reverso: enviados=' + enviados + ' errores=' + errores);
}

// ---------------------------------------------------------------------------
// Lectura (PostgREST, service key)
// ---------------------------------------------------------------------------
function leerOutboxPendiente(limit) {
  var url = SUPABASE_URL + '/rest/v1/sync_outbox?estado=eq.pendiente&order=creado_el.asc&limit=' + limit;
  return fetchJson(url, 'get');
}

function leerFilasSupabase(tabla, claves) {
  var pk = { articulos: 'articulo_id', ingresos: 'ingreso_id', egresos: 'egreso_id' }[tabla];
  var filtro = pk + '=in.(' + claves.map(encodeURIComponent).join(',') + ')';
  var url = SUPABASE_URL + '/rest/v1/' + tabla + '?select=*&' + filtro + '&limit=' + claves.length;
  return fetchJson(url, 'get');
}

function marcarOutbox(id, estado, error) {
  var body = { estado: estado };
  if (estado === 'enviado') body.enviado_el = new Date().toISOString();
  if (error) body.error = String(error).slice(0, 500);
  var url = SUPABASE_URL + '/rest/v1/sync_outbox?id=eq.' + id;
  var opts = {
    method: 'patch', contentType: 'application/json',
    headers: headersAuth(), payload: JSON.stringify(body), muteHttpExceptions: true
  };
  UrlFetchApp.fetch(url, opts);
}

function fetchJson(url, method) {
  var opts = { method: method, headers: headersAuth(), muteHttpExceptions: true };
  var resp = UrlFetchApp.fetch(url, opts);
  if (resp.getResponseCode() >= 300) throw new Error('HTTP ' + resp.getResponseCode() + ' ' + resp.getContentText().slice(0,300));
  return JSON.parse(resp.getContentText());
}

function headersAuth() {
  return { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY };
}

// ---------------------------------------------------------------------------
// Serializadores inversos (null -> celda vacía; bool -> 'sí'; fecha -> Date)
// ---------------------------------------------------------------------------
function serializar(tabla, f) {
  if (tabla === 'articulos') return serializarArticulo(f);
  if (tabla === 'ingresos') return serializarIngreso(f);
  return serializarEgreso(f);
}

function fFecha(v) { return v ? new Date(v) : ''; }
function fBool(v)  { return v === true ? 'sí' : ''; }

function serializarArticulo(f) {
  var img = f.imagenes || [];
  var row = new Array(35).fill('');
  row[0]  = f.articulo_id || '';   // A
  row[1]  = f.nombre || '';        // B
  row[2]  = f.marca || '';         // C
  row[3]  = f.modelo || '';        // D
  row[4]  = f.variante || '';      // E
  row[5]  = f.categoria || '';     // F
  row[9]  = f.caja_madre || '';    // J
  row[11] = f.codigo_universal || ''; // L
  row[14] = f.url_producto || '';  // O
  row[16] = f.notas || '';         // Q
  row[18] = f.codigo_sat || '';    // S
  row[20] = f.peso_kg != null ? f.peso_kg : ''; // U
  row[21] = img[0] || ''; row[22] = img[1] || ''; row[23] = img[2] || ''; // V/W/X
  row[24] = fBool(f.es_full);      // Y
  row[27] = f.descripcion || '';   // AB
  row[28] = f.largo_cm != null ? f.largo_cm : ''; // AC
  row[29] = f.ancho_cm != null ? f.ancho_cm : ''; // AD
  row[30] = f.alto_cm  != null ? f.alto_cm  : ''; // AE
  row[34] = fBool(f.es_dropshipping); // AI
  return row;
}

function serializarIngreso(f) {
  var img = f.imagenes || [];
  var row = new Array(13).fill('');
  row[0] = f.ingreso_id || '';     // A
  row[2] = f.articulo_id || '';    // C
  row[3] = f.cantidad != null ? f.cantidad : ''; // D
  row[4] = f.guia || '';           // E
  row[5] = f.transportista || '';  // F
  row[6] = f.tipo_ingreso || '';   // G
  row[7] = f.notas || '';          // H
  row[8] = fFecha(f.fecha);        // I
  row[9] = f.operador_id || '';    // J
  row[10] = img[0] || ''; row[11] = img[1] || ''; row[12] = img[2] || ''; // K/M
  return row;
}

function serializarEgreso(f) {
  var row = new Array(23).fill('');
  row[0]  = f.egreso_id || '';     // A
  row[2]  = f.articulo_id || '';   // C
  row[3]  = f.cantidad != null ? f.cantidad : ''; // D
  row[4]  = f.guia || '';          // E
  row[5]  = f.transportista || ''; // F
  row[6]  = f.tipo_egreso || '';   // G
  row[7]  = f.notas || '';         // H
  row[8]  = fFecha(f.fecha);       // I
  row[9]  = f.operador_id || '';   // J
  row[13] = f.largo != null ? f.largo : '';   // N
  row[14] = f.ancho != null ? f.ancho : '';   // O
  row[15] = f.alto  != null ? f.alto  : '';   // P
  row[16] = f.peso  != null ? f.peso  : '';   // Q
  row[17] = f.salidas_periodo != null ? f.salidas_periodo : ''; // R
  row[18] = f.codigo_ml || '';     // S
  row[19] = f.edo_reunido || '';   // T
  row[20] = fFecha(f.fecha_reunido);   // U
  row[21] = fFecha(f.fecha_preparado); // V
  return row;
}

// Llamar manualmente para probar: sincSupabaseASheets()
