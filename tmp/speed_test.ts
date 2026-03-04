import { supabaseAdmin } from './apps/dashboard/src/lib/supabase';
import { MeliAdapter } from './packages/adapters/meli';
import dotenv from 'dotenv';
dotenv.config();

async function measureSpeed() {
    console.time('Tiempo Total de Extracción Meli');
    try {
        const { data: configs } = await supabaseAdmin.from('marketplace_configs').select('id, account_name').eq('is_active', true);
        if (!configs || configs.length === 0) return console.log('No configs');

        const meli = new MeliAdapter();

        for (const config of configs) {
            console.log(`\nEvaluando tienda: ${config.account_name} (${config.id})`);
            console.time(`Descarga Ids ${config.account_name}`);
            const itemIds = await meli.getAccountItems(config.id);
            console.timeEnd(`Descarga Ids ${config.account_name}`);
            console.log(`- Encontrados: ${itemIds.length} artículos.`);

            // Omitimos la DB UPSERT real, solo simulamos el fetch a Meli para ver la velocidad de red.
            console.time(`Fetch Meli Detail (Limit 50) ${config.account_name}`);
            const limit = Math.min(itemIds.length, 50); // Meli permite multiget hasta 50
            if (limit > 0) {
                console.log(`- Simulando fetch a Meli API details para los primeros ${limit}...`);
                // Just a dummy delay to represent getting 50 items (or use real if we want)
                await new Promise(r => setTimeout(r, 1000));
            }
            console.timeEnd(`Fetch Meli Detail (Limit 50) ${config.account_name}`);

            console.log("-------------------");
        }

    } catch (e) {
        console.error(e);
    }
    console.timeEnd('Tiempo Total de Extracción Meli');
    process.exit(0);
}

measureSpeed();
