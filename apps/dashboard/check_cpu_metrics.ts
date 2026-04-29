import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Faltan credenciales de Supabase en .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log("=== REPORTE DE GASTO DE CPU Y EVENTOS DE WEBHOOK ===\n");
    
    // Obtener los eventos de las últimas 2 horas, agrupados por intervalos de 15 min
    const { data, error } = await supabase
        .from('meli_webhook_events')
        .select('created_at')
        .gte('created_at', new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false });

    if (error) {
        console.error("Error al obtener eventos:", error.message);
        return;
    }

    // Dividimos por intervalos de 15 minutos para ver la caída
    const intervals: Record<string, number> = {};
    const now = new Date();
    
    for (const evt of data || []) {
        const d = new Date(evt.created_at);
        const minutesAgo = Math.floor((now.getTime() - d.getTime()) / 60000);
        // Agrupar en buckets de 15 mins (0-15, 15-30, etc.)
        const bucket = Math.floor(minutesAgo / 15) * 15;
        const bucketLabel = `Hace ${bucket} a ${bucket + 15} minutos`;
        intervals[bucketLabel] = (intervals[bucketLabel] || 0) + 1;
    }

    console.log("Volumen de Webhooks de ML (últimas 2 horas):");
    console.table(intervals);

    // Revisar si hubo jobs procesados y su estado
    const { data: jobs } = await supabase
        .from('jobs')
        .select('status')
        .gte('created_at', new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString());
    
    const jobStats = (jobs || []).reduce((acc: any, j) => {
        acc[j.status] = (acc[j.status] || 0) + 1;
        return acc;
    }, {});

    console.log("\nEstado de Jobs en la última hora:");
    console.table(jobStats);

    console.log("\nNOTA: Si los eventos de los últimos 15 minutos bajaron drásticamente,");
    console.log("significa que el filtro de Redis ya está rechazando las ráfagas antes de");
    console.log("escribir a la base de datos.");
}

main();
