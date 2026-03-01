import { supabase } from '@gestor/shared/lib/supabase';
import logger from '@gestor/shared/lib/logger';
import dotenv from 'dotenv';
import path from 'path';

// Cargar variables de entorno
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

async function triggerSync() {
    // 1. Obtener la cuenta de MeLi configurada
    const { data: config, error } = await supabase
        .from('marketplace_configs')
        .select('id, account_name')
        .eq('marketplace', 'meli')
        .single();

    if (error || !config) {
        console.error('No se encontró una cuenta de MeLi configurada. Por favor vincúlala primero en el Dashboard.');
        return;
    }

    console.log(`Disparando sincronización para: ${config.account_name} (${config.id})`);

    // 2. Insertar el job de sincronización masiva
    const { error: jobError } = await supabase.from('jobs').insert({
        type: 'sync_account_catalog',
        payload: {
            marketplace_id: config.id
        },
        status: 'pending',
        scheduled_at: new Date().toISOString()
    });

    if (jobError) {
        console.error('Error al crear el job:', jobError);
    } else {
        console.log('--- JOB CREADO CON ÉXITO ---');
        console.log('El worker procesará tu catálogo en unos segundos.');
    }
}

triggerSync().catch(console.error);
