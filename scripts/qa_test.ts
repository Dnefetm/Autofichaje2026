import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import * as xlsx from 'xlsx';
import * as fs from 'fs';

// 1. Setup
dotenv.config({ path: path.resolve(__dirname, '../apps/dashboard/.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const BUCKET = 'excel-precios';
const DUMMY_PROVEEDOR = 'ProveedorQA';
const ROW_COUNT = 5000;
const API_URL = 'http://localhost:3000';

async function runTest() {
    console.log("=== INICIANDO PRUEBA QA E2E DEL PIPELINE DE PRECIOS ===");
    
    // 2. Generar archivo dummy pequeno en memoria
    console.log(`Generando archivo dummy con ${ROW_COUNT} filas...`);
    const data = [];
    data.push(['CODIGO', 'MARCA', 'MODELO', 'DESCRIPCION', 'PRECIO_COMPRA', 'PRECIO_VENTA']);
    for (let i = 1; i <= ROW_COUNT; i++) {
        data.push([
            `QA-COD-${i}`, 
            `MarcaQA`, 
            `Mod-${i}`, 
            `Producto QA ${i}`, 
            (Math.random() * 100).toFixed(2), 
            (Math.random() * 200).toFixed(2)
        ]);
    }
    const ws = xlsx.utils.aoa_to_sheet(data);
    const wb = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(wb, ws, 'Hoja1');
    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    
    const fileName = `qa_test_${Date.now()}.xlsx`;
    const filePath = `${DUMMY_PROVEEDOR}/${fileName}`;
    
    // 3. Subir a Storage
    console.log(`Subiendo archivo ${fileName} a Storage (${(buffer.length / 1024 / 1024).toFixed(2)} MB)...`);
    const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filePath, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        
    if (uploadError) {
        console.error("Fallo subida a storage:", uploadError);
        return;
    }
    
    // 4. Crear registro en BD
    console.log(`Creando registro en importaciones_excel...`);
    const { data: imp, error: dbErr } = await supabase
        .from('importaciones_excel')
        .insert({
            proveedor: DUMMY_PROVEEDOR,
            archivo_path: filePath,
            estado: 'pendiente_mapeo',
            usuario_id: null // Se asume puede ser nulo o usar service role
        })
        .select()
        .single();
        
    if (dbErr || !imp) {
        console.error("Error creando importacion:", dbErr);
        return;
    }
    
    const importId = imp.id;
    console.log(`ID Importacion: ${importId}`);
    
    // 5. Iniciar Parser vía API
    console.log(`Llamando API iniciar-parser...`);
    const resParser = await fetch(`${API_URL}/api/precios/importar/${importId}/iniciar-parser`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileName })
    });
    
    const jsonParser = await resParser.json();
    console.log(`Respuesta iniciar-parser:`, resParser.status, jsonParser);
    
    if (resParser.status !== 202) {
        console.error("Fallo iniciar-parser");
        return;
    }
    
    // 6. Polling hasta que estado sea 'mapeando'
    console.log(`Esperando a que parser termine (estado -> mapeando)...`);
    let parseOk = false;
    for (let i = 0; i < 30; i++) {
        const { data: current } = await supabase.from('importaciones_excel').select('estado').eq('id', importId).single();
        if (current?.estado === 'mapeando') {
            parseOk = true;
            break;
        } else if (current?.estado === 'error') {
            console.error("Error durante parseo");
            return;
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    
    if (!parseOk) {
        console.error("Timeout esperando parser");
        return;
    }
    console.log(`Parseo completado.`);
    
    // 7. Iniciar Mapeo y Matching vía API
    console.log(`Llamando API mapear...`);
    const resMapear = await fetch(`${API_URL}/api/precios/importar/${importId}/mapear`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            columna_codigo: 'CODIGO',
            columna_marca: 'MARCA',
            columna_modelo: 'MODELO',
            columna_descripcion: 'DESCRIPCION',
            precios: [
                { columna: 'PRECIO_COMPRA', tipo_costo: 'compra' },
                { columna: 'PRECIO_VENTA', tipo_costo: 'venta' }
            ]
        })
    });
    
    const jsonMapear = await resMapear.json();
    console.log(`Respuesta mapear:`, resMapear.status, jsonMapear);
    
    if (resMapear.status !== 202) {
        console.error("Fallo mapear");
        return;
    }
    
    // 8. Polling del matching job
    console.log(`Esperando a que la cola Edge termine el matching...`);
    let matchOk = false;
    for (let i = 0; i < 60; i++) {
        const { data: job } = await supabase.from('matching_jobs').select('estado, progreso, total_filas').eq('importacion_id', importId).single();
        if (job) {
            process.stdout.write(`\rJob estado: ${job.estado} | Progreso: ${job.progreso}/${job.total_filas}`);
            if (job.estado === 'completado') {
                matchOk = true;
                break;
            } else if (job.estado === 'error') {
                console.error("\nError en job de matching");
                return;
            }
        }
        await new Promise(r => setTimeout(r, 2000));
    }
    console.log("");
    
    if (!matchOk) {
        console.error("Timeout esperando matching job");
        return;
    }
    
    // 9. Verificar insercion de costos
    const { count: costosCount } = await supabase.from('costos_articulo').select('*', { count: 'exact', head: true }).eq('importacion_id', importId);
    console.log(`Costos mapeados correctamente: ${costosCount}`);
    
    console.log("=== PRUEBA QA EXITOSA ===");
}

runTest().catch(console.error);
