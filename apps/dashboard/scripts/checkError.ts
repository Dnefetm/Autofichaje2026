import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://vtzoyyewhhnoxhhnvmyi.supabase.co'; // using typical fallback or reading .env
import * as dotenv from 'dotenv';
dotenv.config({ path: '../../.env' });
console.log(process.env.NEXT_PUBLIC_SUPABASE_URL);

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const { data, error } = await sb.from('importaciones_excel').select('id, estado, error_mensaje, creado_el').eq('estado', 'error').order('creado_el', { ascending: false }).limit(2);
  console.log(data);
}
run();
