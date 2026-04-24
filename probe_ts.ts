import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf8');
  const env: Record<string, string> = {};
  content.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      env[match[1]] = match[2] || '';
    }
  });
  return env;
}

const envVars = loadEnv();
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL || envVars.SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const importacionId = 'c790c817-f6f5-4273-94a4-9d0ae9586576';
  
  // We don't have the exact column name, so we'll just search the payload as text
  const { data: raw, error } = await supabase
    .from('listas_precios_raw')
    .select('payload')
    .eq('importacion_id', importacionId)
    .textSearch('payload', '13CP');
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  console.log("Payloads for 13CP:", JSON.stringify(raw, null, 2));
}
main();
