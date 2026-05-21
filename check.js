const u='https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/v_lista_precios_proveedor';
const k='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ5eGRxbnp5dm5yd2FseWxxeXZtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2ODQ4NjcwNywiZXhwIjoyMDg0MDYyNzA3fQ.wlQUbd48z0jH0rx1_2bzL0sWkU1TaA-4rpX9DAmvflw';
async function run() {
  for(let i=0; i<16; i++) {
    const r = await fetch(u, {
      headers:{
        apikey:k, 
        Authorization:'Bearer '+k, 
        'Range-Unit': 'items', 
        'Range': `${i*1000}-${(i+1)*1000-1}`
      }
    });
    const d = await r.json();
    if(d.message) {
      console.log('Error at page', i, d.message);
      return;
    }
    console.log('Page', i, 'OK');
  }
}
run();