require('dotenv').config({path: 'apps/dashboard/.env.local'});
const { Client } = require('pg');

async function run() {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
        const sql = `
            INSERT INTO pricing_rules (marketplace_id, name, rule_type, value, ml_commission_percentage, tax_percentage, ml_fixed_fee)
            SELECT id, 'Regla Base ML', 'margin_percentage', 20, 15, 16, 25 
            FROM marketplace_configs 
            ON CONFLICT DO NOTHING;

            SELECT fn_recalcular_precio_marketplace(articulo_id) 
            FROM costos_articulo 
            WHERE vigente = true AND articulo_id IS NOT NULL;
        `;
        await client.query(sql);
        console.log("Éxito!");
    } catch(e) {
        console.error(e);
    } finally {
        await client.end();
    }
}
run();
