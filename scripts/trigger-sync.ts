import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';
import dotenv from 'dotenv';
import path from 'path';

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function triggerSync() {
    // 1. Obtener TODAS las cuentas de MeLi configuradas
    const { data: configs, error } = await supabase
        .from('marketplace_configs')
        .select('id, account_name')
        .eq('marketplace', 'meli');

    if (error || !configs || configs.length === 0) {
        console.error('No se encontraron cuentas de MeLi configuradas. Por favor vincúlalas primero en el Dashboard.');
        return;
    }

    console.log(`Encontradas ${configs.length} tiendas de Mercado Libre. Generando trabajos de sincronización...`);

    // 2. Insertar los jobs de sincronización masiva
    const jobsToInsert = configs.map(config => ({
        type: 'sync_account_catalog',
        payload: {
            marketplace_id: config.id
        },
        status: 'pending',
        scheduled_at: new Date().toISOString()
    }));

    const { error: jobError } = await supabase.from('jobs').insert(jobsToInsert);

    if (jobError) {
        console.error('Error al crear los jobs:', jobError);
    } else {
        console.log('--- JOBS CREADOS CON ÉXITO ---');
        console.log(`El worker procesará ${configs.length} tiendas en unos segundos.`);
    }
}

triggerSync().catch(console.error);
