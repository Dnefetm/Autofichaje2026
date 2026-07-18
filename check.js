const u='https://ryxdqnzyvnrwalylqyvm.supabase.co/rest/v1/v_lista_precios_proveedor';
require('dotenv').config({ path: 'apps/dashboard/.env.local' }); const k=process.env.SUPABASE_SERVICE_ROLE_KEY;
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
