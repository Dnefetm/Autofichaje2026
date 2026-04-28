require('dotenv').config();
const { Client } = require('pg');

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('--- DIAGNOSTICO DE COBERTURA ---');
  const resDiag = await client.query(`
    WITH unnested_costos AS (
      SELECT articulo_id, valor, tipo_costo, vigente
      FROM costos_articulo
      WHERE vigente = true
    ),
    best_costos AS (
      SELECT DISTINCT ON (articulo_id) articulo_id, valor
      FROM unnested_costos
      ORDER BY articulo_id, CASE WHEN tipo_costo ILIKE '%menudeo%' THEN 1 ELSE 2 END, valor DESC
    )
    SELECT 
      (SELECT count(*) FROM articulos) as total_articulos,
      (SELECT count(*) FROM best_costos) as articulos_con_costo,
      (SELECT count(*) FROM best_costos WHERE valor > 0) as articulos_con_costo_valido,
      (SELECT count(*) FROM marketplace_prices) as total_en_marketplace_prices,
      (SELECT count(DISTINCT articulo_id) FROM marketplace_prices) as articulos_en_marketplace_prices
  `);
  console.log(resDiag.rows[0]);

  console.log('--- RECALCULANDO BUNDLES P0 ---');
  await client.query(`
    DO $$
    DECLARE
        r RECORD;
    BEGIN
        FOR r IN (
            SELECT DISTINCT sku_articulo 
            FROM mapeo_publicacion_articulo 
            WHERE cantidad_requerida > 1
        ) LOOP
            PERFORM fn_recalcular_precio_marketplace(r.sku_articulo);
        END LOOP;
    END;
    $$;
  `);
  console.log('Recálculo de bundles completado.');

  const resCheck = await client.query(`
    SELECT count(*) FROM marketplace_prices;
  `);
  console.log('Total de precios en marketplace_prices ahora:', resCheck.rows[0].count);

  await client.end();
}
run().catch(console.error);
