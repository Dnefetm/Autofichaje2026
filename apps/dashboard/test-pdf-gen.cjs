require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const { generarFichaPDF } = require('./packages/sync/pdf/generarFichaPDF.ts');
// Wait, generating PDF via TS file might require ts-node.
