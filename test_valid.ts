import { validateCrossReferences } from './scripts/validate_data_pipeline.ts';
import fs from 'fs';

const blueprint = JSON.parse(fs.readFileSync('./docs/db_flow_blueprint.json', 'utf8'));
const tsResult: any = {
    calledRpcs: new Map(),
    touchedTables: new Map([['listas_precios_raw', ['dummy.ts']]]),
    enqueuedJobs: new Map(),
    diagnostics: [],
    dataLineage: {}
};

console.log('Empty dbTables:');
console.log(validateCrossReferences(tsResult, {}, {}, []));

console.log('\nWith dbTables:');
console.log(validateCrossReferences(tsResult, blueprint.functions, blueprint.tables, []));
