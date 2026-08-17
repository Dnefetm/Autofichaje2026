import 'dotenv/config';
import { Client } from 'pg';
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL || 'postgresql://postgres:postgres@localhost:54322/postgres' });
async function run() {
  await client.connect();
  try {
    const res = await client.query("INSERT INTO public.importaciones_excel (proveedor, archivo_nombre, estado, archivo_path) VALUES ('TEST', 'test.xlsx', 'pendiente_mapeo', 'test.xlsx') RETURNING id");
    console.log("Success:", res.rows[0]);
  } catch (e: any) {
    console.error("DB Error:", e.message);
  } finally {
    await client.end();
  }
}
run();
