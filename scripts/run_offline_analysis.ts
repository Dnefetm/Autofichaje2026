import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import { analyzeDataLineageSql } from './validate_data_pipeline';

const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
const hintsPath = path.join(rootDir, 'docs', 'flow_hints.yaml');

if (!fs.existsSync(blueprintPath)) {
    console.error("No se encontro db_flow_blueprint.json");
    process.exit(1);
}

const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
const hints = fs.existsSync(hintsPath) ? yaml.parse(fs.readFileSync(hintsPath, 'utf8')) : {};
const declaredProcesses = hints.processes || {};

const diagnostics: any[] = [];

// 1. Semantic Join Validation (Data Lineage)
for (const [funcName, data] of Object.entries<any>(blueprint.functions)) {
    const lineageDiagnostics = analyzeDataLineageSql(data.source_sql, funcName, blueprint.tables);
    diagnostics.push(...lineageDiagnostics);
}

// 2. Data Cannibalization Detection
for (const [procName, proc] of Object.entries<any>(declaredProcesses)) {
    const steps = Array.isArray(proc.steps) ? proc.steps : [];
    const deletedTables = new Set<string>();

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.fn && blueprint.functions[step.fn]) {
            const sql = blueprint.functions[step.fn].source_sql;
            
            const selectRegex = /SELECT\s+[\s\S]*?\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            let m;
            while ((m = selectRegex.exec(sql)) !== null) {
                const tableRead = m[1];
                if (deletedTables.has(tableRead)) {
                    diagnostics.push({ 
                        scope: `processes.${procName}.cannibalization`, 
                        severity: 'error', 
                        code: 'DATA_CANNIBALIZATION', 
                        message: `Flujo roto: El Paso ${i+1} (${step.fn}) lee de la tabla '${tableRead}', pero un paso anterior ya vació esta tabla. El paso procesará 0 filas.`, 
                        hint: `Revisa la secuencia en flow_hints.yaml o quita el DELETE prematuro.`, 
                        evidence: { yaml: true } 
                    });
                }
            }

            const deleteRegex = /(?:DELETE\s+FROM|TRUNCATE\s+TABLE)\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            while ((m = deleteRegex.exec(sql)) !== null) {
                deletedTables.add(m[1]);
            }

            const insertRegex = /INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            while ((m = insertRegex.exec(sql)) !== null) {
                deletedTables.delete(m[1]);
            }
        }
    }
}

// Format and output
let md = `\n\n## 🚨 Nuevo Reporte de Diagnóstico Estructural (Blueprint 4.0)\n\n`;
const errors = diagnostics.filter(d => d.severity === 'error');
const warns = diagnostics.filter(d => d.severity === 'warn');

if (errors.length > 0) {
    md += `### ❌ ERRORES CRÍTICOS DETECTADOS\n\n`;
    errors.forEach(d => {
        md += `- **[${d.code}]** \`${d.scope}\`: ${d.message}\n`;
    });
    md += `\n`;
}

if (warns.length > 0) {
    md += `### ⚠️ ADVERTENCIAS\n\n`;
    warns.forEach(d => {
        md += `- **[${d.code}]** \`${d.scope}\`: ${d.message}\n`;
    });
    md += `\n`;
}

if (errors.length === 0 && warns.length === 0) {
    md += `No se encontraron problemas.\n`;
}

const outMdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
fs.appendFileSync(outMdPath, md);
console.log(`Diagnósticos anexados a ${outMdPath}`);
