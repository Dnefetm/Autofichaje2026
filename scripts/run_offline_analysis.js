"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var fs = require("fs");
var path = require("path");
var yaml = require("yaml");
var validate_data_pipeline_1 = require("./validate_data_pipeline");
var rootDir = path.resolve(__dirname, '..');
var blueprintPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
var hintsPath = path.join(rootDir, 'docs', 'flow_hints.yaml');
if (!fs.existsSync(blueprintPath)) {
    console.error("No se encontro db_flow_blueprint.json");
    process.exit(1);
}
var blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
var hints = fs.existsSync(hintsPath) ? yaml.parse(fs.readFileSync(hintsPath, 'utf8')) : {};
var declaredProcesses = hints.processes || {};
var diagnostics = [];
// 1. Semantic Join Validation (Data Lineage)
for (var _i = 0, _a = Object.entries(blueprint.functions); _i < _a.length; _i++) {
    var _b = _a[_i], funcName = _b[0], data = _b[1];
    var lineageDiagnostics = (0, validate_data_pipeline_1.analyzeDataLineageSql)(data.source_sql, funcName, blueprint.tables);
    diagnostics.push.apply(diagnostics, lineageDiagnostics);
}
// 2. Data Cannibalization Detection
for (var _c = 0, _d = Object.entries(declaredProcesses); _c < _d.length; _c++) {
    var _e = _d[_c], procName = _e[0], proc = _e[1];
    var steps = Array.isArray(proc.steps) ? proc.steps : [];
    var deletedTables = new Set();
    for (var i = 0; i < steps.length; i++) {
        var step = steps[i];
        if (step.fn && blueprint.functions[step.fn]) {
            var sql = blueprint.functions[step.fn].source_sql;
            var selectRegex = /SELECT\s+[\s\S]*?\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            var m = void 0;
            while ((m = selectRegex.exec(sql)) !== null) {
                var tableRead = m[1];
                if (deletedTables.has(tableRead)) {
                    diagnostics.push({
                        scope: "processes.".concat(procName, ".cannibalization"),
                        severity: 'error',
                        code: 'DATA_CANNIBALIZATION',
                        message: "Flujo roto: El Paso ".concat(i + 1, " (").concat(step.fn, ") lee de la tabla '").concat(tableRead, "', pero un paso anterior ya vaci\u00F3 esta tabla. El paso procesar\u00E1 0 filas."),
                        hint: "Revisa la secuencia en flow_hints.yaml o quita el DELETE prematuro.",
                        evidence: { yaml: true }
                    });
                }
            }
            var deleteRegex = /(?:DELETE\s+FROM|TRUNCATE\s+TABLE)\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            while ((m = deleteRegex.exec(sql)) !== null) {
                deletedTables.add(m[1]);
            }
            var insertRegex = /INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            while ((m = insertRegex.exec(sql)) !== null) {
                deletedTables.delete(m[1]);
            }
        }
    }
}
// Format and output
var md = "\n\n## \uD83D\uDEA8 Nuevo Reporte de Diagn\u00F3stico Estructural (Blueprint 4.0)\n\n";
var errors = diagnostics.filter(function (d) { return d.severity === 'error'; });
var warns = diagnostics.filter(function (d) { return d.severity === 'warn'; });
if (errors.length > 0) {
    md += "### \u274C ERRORES CR\u00CDTICOS DETECTADOS\n\n";
    errors.forEach(function (d) {
        md += "- **[".concat(d.code, "]** `").concat(d.scope, "`: ").concat(d.message, "\n");
    });
    md += "\n";
}
if (warns.length > 0) {
    md += "### \u26A0\uFE0F ADVERTENCIAS\n\n";
    warns.forEach(function (d) {
        md += "- **[".concat(d.code, "]** `").concat(d.scope, "`: ").concat(d.message, "\n");
    });
    md += "\n";
}
if (errors.length === 0 && warns.length === 0) {
    md += "No se encontraron problemas.\n";
}
var outMdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
fs.appendFileSync(outMdPath, md);
console.log("Diagn\u00F3sticos anexados a ".concat(outMdPath));
