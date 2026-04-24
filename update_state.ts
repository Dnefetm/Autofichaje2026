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
const supabaseUrl = envVars.NEXT_PUBLIC_SUPABASE_URL || envVars.SUPABASE_URL;
const supabaseKey = envVars.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing supabase credentials in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const importacionId = 'c790c817-f6f5-4273-94a4-9d0ae9586576';
  
  const { data: counts, error } = await supabase
    .from('costos_articulo')
    .select('estado_match')
    .eq('importacion_id', importacionId);
    
  if (error) {
    console.error("Error:", error);
    return;
  }
  
  const grouped = counts.reduce((acc, curr) => {
    acc[curr.estado_match] = (acc[curr.estado_match] || 0) + 1;
    return acc;
  }, {});
  
  console.log("Costos counts:", grouped);
}

main();
