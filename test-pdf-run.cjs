require('dotenv').config({ path: 'apps/dashboard/.env.local' });
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs' } });
const { generarFichaPDF } = require('./packages/sync/pdf/generarFichaPDF.ts');

async function testPdf() {
    try {
        console.log("Generando PDF...");
        const result = await generarFichaPDF('bccf083d-a3c8-455c-b8e8-a2fcb93c748e', 'http://localhost:3000');
        console.log("PDF Result:", result);
    } catch (e) {
        console.error("Error:", e);
    }
}
testPdf();
