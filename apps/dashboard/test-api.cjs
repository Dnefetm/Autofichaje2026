const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: 'apps/dashboard/.env.local' });

async function test() {
    const fetch = require('node-fetch'); // we can just use native fetch in Node 18+
    
    const fichaId = '0c9f9394-de52-4fcb-860a-f7b85efbd8a2'; 
    const payload = {
        extraccion_id: null,
        campos_aceptados: {
            "peso_kg": 1.23,
            "atributos_dinamicos": {
                "Dados métricos": "8mm a 21mm"
            }
        }
    };

    console.log('Sending payload to local API simulation...');
    // We can't call Next.js API easily from script without running the server.
    // Let's just simulate the EXACT logic from `route.ts`.

    const CAMPOS_TEXTO = new Set([
        'nombre_producto', 'descripcion', 'descripcion_larga', 'fabricante',
        'especificaciones', 'uso_recomendado', 'precauciones', 'ingredientes',
        'marca', 'modelo', 'variante', 'codigo_universal',
        'categoria', 'materiales', 'pais_origen',
        'informacion_normativa', 'instrucciones_uso',
        'leyendas_precautorias', 'indicaciones_almacenamiento',
    ]);
    const CAMPOS_JSONB = new Set([
        'bullet_points', 'palabras_clave', 'atributos_dinamicos',
        'atributos_categoria', 'atributos_extras',
    ]);
    const CAMPOS_NUM = new Set([
        'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm'
    ]);

    const update = {};
    for (const [campo, valor] of Object.entries(payload.campos_aceptados)) {
        if (CAMPOS_TEXTO.has(campo)) update[campo] = valor ?? null;
        else if (CAMPOS_JSONB.has(campo)) update[campo] = valor;
        else if (CAMPOS_NUM.has(campo)) update[campo] = valor === null || valor === '' ? null : Number(valor) || null;
    }

    console.log('Update payload generated:', update);

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    );

    const { data: ficha, error: updateErr } = await supabase
        .from('fichas_tecnicas')
        .update(update)
        .eq('id', fichaId)
        .select('id, nombre_producto, peso_kg, atributos_dinamicos')
        .single();

    if (updateErr) {
        console.error('Update error:', updateErr);
    } else {
        console.log('Update success! Returned data:', ficha);
    }
}
test();
