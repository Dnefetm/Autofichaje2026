import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing environment variables");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function runTests() {
  console.log('====== EJECUTANDO TESTS DEL MATCHER V2 ======');

  // Test 1: MATCH FUERTE
  console.log('\n--- Test 1: Match Fuerte ---');
  let { data: f1, error: e1 } = await supabase.rpc('fn_match_articulo_proveedor', {
      p_modelo: '1214', p_marca: 'Urrea', p_codigo: 'NOT-EXIST' // Wait, the SQL prioritizes codigo, and only exact match
  });
  // If we just want a standard strong match testing unaccent:
  console.log('Testing Unaccent Fuerte (Marca y Modelo):');
  let { data: f2, error: e2 } = await supabase.rpc('fn_match_articulo_proveedor', {
      p_modelo: ' 1214 ', p_marca: 'urrÉa', p_codigo: null
  });
  console.log(e2 ? `ERROR: ${e2.message}` : `RESULTADO: ${JSON.stringify(f2?.[0])}`);

  // Test 2: CAMBIO_CODIGO_SUGERIDO
  console.log('\n--- Test 2: Cambio de Código Sugerido ---');
  let { data: m1, error: em1 } = await supabase.rpc('fn_match_articulo_proveedor', {
      p_modelo: '1214', p_marca: 'urrea', p_codigo: 'wrong-codigo'
  });
  console.log(em1 ? `ERROR: ${em1.message}` : `RESULTADO: ${JSON.stringify(m1?.[0])}`);

  // Test 3: AMBIGUO
  console.log('\n--- Test 3: Ambiguo (Fuzzy fallback) ---');
  let { data: am1, error: eam1 } = await supabase.rpc('fn_match_articulo_proveedor', {
      p_modelo: 'Juego de Herramienta', p_marca: 'Urres', p_codigo: null
  });
  console.log(eam1 ? `ERROR: ${eam1.message}` : `RESULTADO: ${am1?.length} candidatos fuzzy.`);

  console.log('\n====== FIN DE TESTS ======');
}

runTests().catch(console.error);
