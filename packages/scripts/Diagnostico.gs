function consultarColumnas() {
  const SUPABASE_URL = 'https://ryxdqnzynrwalylqyvm.supabase.co';
  const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGRxbnp5bnJ3YWx5bHF5dm0iLCJyb2xlIjoic2VydmljZV9yb2xlIiwiaWF0IjoxNzM5NDcxMDMzLCJleHAiOjIwNTUwNDcwMzN9.wlQUbd48z0jH0rx1_2bzL0sWkU1TaA-4rpX9DAmvflw';

  const query = "SELECT column_name FROM information_schema.columns WHERE table_name = 'articulos' AND column_name IN ('sku', 'articulo_id') AND table_schema = 'public'";

  const response = UrlFetchApp.fetch(SUPABASE_URL + '/rest/v1/rpc/ejecutar_sql', {
    method: 'post',
    headers: {
      'apikey': SERVICE_KEY,
      'Authorization': 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify({ query: query }),
    muteHttpExceptions: true
  });

  Logger.log('Status: ' + response.getResponseCode());
  Logger.log('Body: ' + response.getContentText());
}