import * as fs from 'fs';
import fetch from 'node-fetch';
import { processProductDocument } from './packages/sync/autoficha';

async function testExtraccion() {
    try {
        console.log('Descargando PDF de Urrea...');
        const res = await fetch('https://www.urreanet.com/urreanetnuevo/data/FichasTecnicasN/FTDOC3735.pdf');
        const buffer = await res.buffer();

        console.log('Procesando PDF con Autoficha (esto usará el nuevo prebuilt-layout)...');
        const result = await processProductDocument(buffer, 'FTDOC3735.pdf', 'application/pdf');
        
        console.log('--- RESULTADO ---');
        console.log('Materiales:', result.materiales);
        console.log('Garantía (en attrs/bullet):', result.atributos_tecnicos, result.bullet_points);
        console.log('Código detectado:', result.sku_detectado);
        console.log('Especificaciones/Atributos:', JSON.stringify(result.atributos_tecnicos, null, 2));
        console.log('Accesorios (en attrs/specs/bullets):', result.especificaciones, result.bullet_points);
        
        fs.writeFileSync('urrea-resultado.json', JSON.stringify(result, null, 2));
        console.log('Resultado completo guardado en urrea-resultado.json');
    } catch (e) {
        console.error('Error:', e);
    }
}

testExtraccion();
