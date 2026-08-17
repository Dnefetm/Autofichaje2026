import 'dotenv/config';
import { Client } from 'pg';
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@localhost:54322/postgres' });
async function run() {
  await client.connect();
  try {
    const res = await client.query("SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'importaciones_excel'");
    console.table(res.rows);
  } finally {
    await client.end();
  }
}
run().catch(console.error);
