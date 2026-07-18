const { createClient } = require('@supabase/supabase-js');
const u='https://ryxdqnzyvnrwalylqyvm.supabase.co';
require('dotenv').config({ path: 'apps/dashboard/.env.local' }); const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(u, k);


async function run() {
  const importaciones = [
      'cd267759-ebda-4bb4-a5c0-b1715f443853',
      '2784e654-cc84-4148-91db-a0314b06f6e4',
      '6cd4df37-f5c7-4fc8-97bb-5ad647a39e68',
      '79dbbd77-4e16-4e84-9f38-3f3251705d96'
  ];

  for (const id of importaciones) {
      console.log(`\nReprocesando importacion: ${id}`);
      // Clear existing costos_articulo for this import if any to ensure clean state
      await supabase.from('costos_articulo').delete().eq('importacion_id', id);

      const { data: result, error } = await supabase.rpc('fn_match_precios_chunk', {
          p_importacion_id: id,
          p_offset: 0,
          p_limit: 1000 // assuming max 99 rows per the logs
      });

      if (error) {
          console.error(`Error procesando ${id}:`, error);
      } else {
          console.log(`Exito para ${id}. Filas procesadas:`, result);
          
          // Verify
          const { count } = await supabase.from('costos_articulo').select('*', { count: 'exact', head: true }).eq('importacion_id', id);
          console.log(`Total en costos_articulo ahora: ${count}`);
      }
  }
}

run();
