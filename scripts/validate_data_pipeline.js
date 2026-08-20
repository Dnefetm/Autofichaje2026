"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runStaticAppAnalysis = runStaticAppAnalysis;
exports.validateCrossReferences = validateCrossReferences;
exports.analyzeDataLineageSql = analyzeDataLineageSql;
var ts = require("typescript");
var fs = require("fs");
var path = require("path");
// Recorrer árbol AST buscando nodos específicos
function walkAst(node, visitor) {
    visitor(node);
    ts.forEachChild(node, function (child) { return walkAst(child, visitor); });
}
// Analizar un archivo TypeScript
function analyzeTsFile(filePath, result) {
    if (!fs.existsSync(filePath))
        return;
    var sourceCode = fs.readFileSync(filePath, 'utf8');
    var sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);
    // Detectar caracteres raros (mojibake)
    if (sourceCode.includes('─') || sourceCode.includes('\u2500') || sourceCode.includes('â€')) {
        result.diagnostics.push({
            scope: 'app.encoding',
            severity: 'error',
            code: 'BAD_ENCODING',
            message: 'Se detectó carácter no ASCII (mojibake) U+2500 o similar, causando corrupciones de compilación en Vercel.',
            file: filePath
        });
    }
    // Detectar faltas de Optional Chaining
    if (sourceCode.includes('pub.deal_ids.length')) {
        result.diagnostics.push({
            scope: 'app.runtime',
            severity: 'error',
            code: 'NULL_REFERENCE_RISK',
            message: 'Acceso inseguro a .length en pub.deal_ids sin optional chaining.',
            file: filePath
        });
    }
    if (sourceCode.match(/listingTypeConfig\[.*?\]\.label/)) {
        result.diagnostics.push({
            scope: 'app.runtime',
            severity: 'error',
            code: 'NULL_REFERENCE_RISK',
            message: 'Acceso inseguro a .label en diccionario listingTypeConfig sin verificación previa.',
            file: filePath
        });
    }
    if (sourceCode.match(/tipoPubConfig\[.*?\]\.label/)) {
        result.diagnostics.push({
            scope: 'app.runtime',
            severity: 'error',
            code: 'NULL_REFERENCE_RISK',
            message: 'Acceso inseguro a .label en diccionario tipoPubConfig sin verificación previa.',
            file: filePath
        });
    }
    // Detectar caracteres raros (mojibake)
    if (sourceCode.includes('─') || sourceCode.includes('\u2500') || sourceCode.includes('â€')) {
        result.diagnostics.push({
            scope: 'app.encoding',
            severity: 'error',
            code: 'BAD_ENCODING',
            message: 'Se detectó carácter no ASCII (mojibake) U+2500 o similar, causando corrupciones de compilación en Vercel.',
            file: filePath
        });
    }
    // Detectar faltas de Optional Chaining
    if (sourceCode.includes('pub.deal_ids.length')) {
        result.diagnostics.push({
            scope: 'app.runtime',
            severity: 'error',
            code: 'NULL_REFERENCE_RISK',
            message: 'Acceso inseguro a .length en pub.deal_ids sin optional chaining.',
            file: filePath
        });
    }
    if (sourceCode.match(/listingTypeConfig\[.*?\]\.label/)) {
        result.diagnostics.push({
            scope: 'app.runtime',
            severity: 'error',
            code: 'NULL_REFERENCE_RISK',
            message: 'Acceso inseguro a .label en diccionario listingTypeConfig sin verificación previa.',
            file: filePath
        });
    }
    if (sourceCode.match(/tipoPubConfig\[.*?\]\.label/)) {
        result.diagnostics.push({
            scope: 'app.runtime',
            severity: 'error',
            code: 'NULL_REFERENCE_RISK',
            message: 'Acceso inseguro a .label en diccionario tipoPubConfig sin verificación previa.',
            file: filePath
        });
    }
    walkAst(sourceFile, function (node) {
        if (ts.isCallExpression(node)) {
            var exp = node.expression;
            if (ts.isPropertyAccessExpression(exp)) {
                var propName = exp.name.text;
                var parentExp = exp.expression;
                if (ts.isPropertyAccessExpression(parentExp) || ts.isIdentifier(parentExp)) {
                    var text = parentExp.getText(sourceFile);
                    if (text.includes('supabase') || text.includes('supabaseAdmin')) {
                        // Detectar .rpc('...')
                        if (propName === 'rpc' && node.arguments.length > 0) {
                            var arg0 = node.arguments[0];
                            if (ts.isStringLiteral(arg0)) {
                                var rpcName = arg0.text;
                                var callerText = text.toLowerCase();
                                var clientType = (callerText.includes('admin') || callerText.includes('service')) ? 'admin' : 'anon';
                                var isNextApiRoute = filePath.includes(path.join('app', 'api')) || filePath.includes(path.join('pages', 'api'));
                                if (!result.calledRpcs.has(rpcName))
                                    result.calledRpcs.set(rpcName, []);
                                var existing = result.calledRpcs.get(rpcName);
                                if (!existing.some(function (c) { return c.filePath === filePath; })) {
                                    existing.push({ filePath: filePath, isNextApiRoute: isNextApiRoute, clientType: clientType });
                                }
                            }
                        }
                        // Detectar .from('...')
                        if (propName === 'from' && node.arguments.length > 0) {
                            var arg0 = node.arguments[0];
                            if (ts.isStringLiteral(arg0)) {
                                var tableName = arg0.text;
                                if (!result.touchedTables.has(tableName))
                                    result.touchedTables.set(tableName, []);
                                if (!result.touchedTables.get(tableName).includes(filePath)) {
                                    result.touchedTables.get(tableName).push(filePath);
                                }
                            }
                        }
                    }
                }
            }
        }
        // Detectar encolado de jobs
        // .insert({ type: 'job_name' })
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'insert') {
            var insertArgs = node.arguments;
            if (insertArgs.length > 0 && ts.isObjectLiteralExpression(insertArgs[0])) {
                var obj = insertArgs[0];
                obj.properties.forEach(function (p) {
                    if (ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'type') {
                        if (ts.isStringLiteral(p.initializer)) {
                            var jobType = p.initializer.text;
                            if (!result.enqueuedJobs.has(jobType))
                                result.enqueuedJobs.set(jobType, []);
                            if (!result.enqueuedJobs.get(jobType).includes(filePath)) {
                                result.enqueuedJobs.get(jobType).push(filePath);
                            }
                        }
                    }
                });
            }
        }
    });
    // Análisis de Mapeo de Columnas (Excel)
    if (filePath.includes('procesar-importacion') || filePath.includes('api\\precios')) {
        // Regex fallback para keys jsonb
        var regexCols = /m\.columna_([a-zA-Z0-9_]+)/g;
        var match = void 0;
        while ((match = regexCols.exec(sourceCode)) !== null) {
            var col = match[1];
            if (!result.dataLineage['mapeo_frontend'])
                result.dataLineage['mapeo_frontend'] = [];
            if (!result.dataLineage['mapeo_frontend'].includes(col))
                result.dataLineage['mapeo_frontend'].push(col);
        }
    }
}
// Analizar directorio completo
function analyzeDirectory(dirPath, result) {
    if (!fs.existsSync(dirPath))
        return;
    var entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
        var entry = entries_1[_i];
        var fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.next') {
                analyzeDirectory(fullPath, result);
            }
        }
        else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx'))) {
            analyzeTsFile(fullPath, result);
        }
    }
}
function runStaticAppAnalysis(rootDir) {
    var result = {
        calledRpcs: new Map(),
        touchedTables: new Map(),
        enqueuedJobs: new Map(),
        diagnostics: [],
        dataLineage: {}
    };
    var dashboardSrc = path.join(rootDir, 'apps', 'dashboard', 'src');
    var edgeFuncs = path.join(rootDir, 'supabase', 'functions');
    analyzeDirectory(dashboardSrc, result);
    analyzeDirectory(edgeFuncs, result);
    return result;
}
function validateCrossReferences(tsResult, dbFunctions, dbTables, workerHandlers) {
    var diagnostics = [];
    // Validar RPCs y Timeouts
    tsResult.calledRpcs.forEach(function (calls, rpcName) {
        var dbFunc = dbFunctions[rpcName] || dbFunctions["public.".concat(rpcName)];
        if (!dbFunc) {
            diagnostics.push({
                scope: "app.rpc.".concat(rpcName),
                severity: 'error',
                code: 'RPC_NOT_FOUND',
                message: "La aplicaci\u00F3n llama a un RPC inexistente '".concat(rpcName, "' en ").concat(calls.length, " archivo(s)."),
                file: calls[0].filePath
            });
        }
        else {
            calls.forEach(function (call) {
                // Regla 2: [TIMEOUT_RISK]
                if (call.isNextApiRoute && dbFunc.avg_time_ms && dbFunc.avg_time_ms > 10000) {
                    diagnostics.push({
                        scope: "app.rpc.".concat(rpcName),
                        severity: 'error',
                        code: 'TIMEOUT_RISK',
                        message: "Riesgo de Timeout: La ruta Next.js llama sincr\u00F3nicamente a '".concat(rpcName, "' con tiempo estimado de ").concat(dbFunc.avg_time_ms, "ms (excede l\u00EDmite de 10s de Vercel/Kong)."),
                        file: call.filePath
                    });
                }
                // Regla 3: [ARCH_VIOLATION]
                if (dbFunc.is_async_architectural_boundary && call.isNextApiRoute) {
                    diagnostics.push({
                        scope: "app.rpc.".concat(rpcName),
                        severity: 'error',
                        code: 'ARCH_VIOLATION',
                        message: "Violaci\u00F3n de Arquitectura: '".concat(rpcName, "' debe ser procesado as\u00EDncronamente mediante una cola, pero se invoca directamente de forma s\u00EDncrona en Next.js."),
                        file: call.filePath
                    });
                }
            });
        }
    });
    // Validar Tablas fantasma
    tsResult.touchedTables.forEach(function (files, tableName) {
        if (!dbTables[tableName] && !dbTables["public.".concat(tableName)] && tableName !== 'storage' && tableName !== 'auth' && !tableName.includes('v_')) {
            // storage no es una tabla en public. A veces llaman supabase.storage.from()
            diagnostics.push({
                scope: "app.table.".concat(tableName),
                severity: 'warn', // Warn for now to avoid false positive views
                code: 'TABLE_NOT_FOUND',
                message: "La app hace referencia a una tabla/vista '".concat(tableName, "' que no fue encontrada en la extracci\u00F3n de public."),
                file: files[0]
            });
        }
    });
    // Validar Colas huerfanas (jobs encolados pero no hay handler en el worker)
    tsResult.enqueuedJobs.forEach(function (files, jobType) {
        if (!workerHandlers.includes(jobType)) {
            diagnostics.push({
                scope: "app.queue.".concat(jobType),
                severity: 'error',
                code: 'ORPHAN_QUEUE',
                message: "La app encola un job tipo '".concat(jobType, "', pero NING\u00DAN worker lo procesa. Es un flujo sin salida."),
                file: files[0]
            });
        }
    });
    return diagnostics;
}
// Analizar SQL crudo buscando extracciones de JSONB (->> o jsonb_extract_path_text)
function analyzeDataLineageSql(sqlBody, functionName, dbTables) {
    var diagnostics = [];
    var keysExtracted = new Set();
    // Regex para ->> 'llave' o -> 'llave'
    var jsonbRegex = /->>\s*['"]([a-zA-Z0-9_]+)['"]/g;
    var match;
    while ((match = jsonbRegex.exec(sqlBody)) !== null) {
        keysExtracted.add(match[1]);
    }
    var jsonbFuncRegex = /jsonb_extract_path_text\([^,]+,\s*['"]([a-zA-Z0-9_]+)['"]/g;
    while ((match = jsonbFuncRegex.exec(sqlBody)) !== null) {
        keysExtracted.add(match[1]);
    }
    // Buscamos a dónde inserta esta función (muy básico: INSERT INTO nombre_tabla)
    var insertRegex = /INSERT INTO\s+([a-zA-Z0-9_]+)/g;
    var targetTables = new Set();
    while ((match = insertRegex.exec(sqlBody)) !== null) {
        targetTables.add(match[1]);
    }
    targetTables.forEach(function (table) {
        var tableMeta = dbTables[table];
        if (tableMeta && tableMeta.columns) {
            var tableCols_1 = tableMeta.columns;
            keysExtracted.forEach(function (key) {
                // Heuristica: Si la llave extraída parece una columna (no es id, user_id, etc) y no está en la tabla destino
                if (!tableCols_1.includes(key) && !tableCols_1.includes(key + '_excel') && !['payload', 'id'].includes(key)) {
                    // Generar un aviso o error
                    diagnostics.push({
                        scope: "lineage.sql.".concat(functionName),
                        severity: 'warn',
                        code: 'DATA_LINEAGE_MISMATCH',
                        message: "La funci\u00F3n extrae '".concat(key, "' del JSONB pero la tabla destino '").concat(table, "' no parece tener una columna hom\u00F3nima o mapeada. Posible p\u00E9rdida silenciosa.")
                    });
                }
            });
        }
    });
    // Validacion Semantica de Alias / Joins Cruzados
    // Busca patrones especificos donde se compara "codigo_excel" con "modelo_norm" o similares, ignorando paréntesis de funciones
    var semanticJoinRegex = /(?:[a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)[^=<>\.]*?(?:[=<>])\s*(?:[a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/g;
    var joinMatch;
    while ((joinMatch = semanticJoinRegex.exec(sqlBody)) !== null) {
        var leftCol = joinMatch[1]; // ej. codigo_excel
        var rightCol = joinMatch[2]; // ej. modelo_norm
        // Si comparamos codigo contra modelo (o modelo contra codigo)
        if ((leftCol.includes('codigo') && rightCol.includes('modelo')) ||
            (leftCol.includes('modelo') && rightCol.includes('codigo'))) {
            diagnostics.push({
                scope: "lineage.semantic.".concat(functionName),
                severity: 'error',
                code: 'SEMANTIC_JOIN_MISMATCH',
                message: "Violaci\u00F3n de sem\u00E1ntica de dominio detectada en JOIN: comparando '".concat(leftCol, "' de alias con '").concat(rightCol, "' del archivo crudo. Esto har\u00E1 que el matching falle en silencio.")
            });
        }
    }
    return diagnostics;
}
