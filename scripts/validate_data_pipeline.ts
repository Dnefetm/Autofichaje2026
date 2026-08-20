import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';

export interface AppDiagnostic {
    scope: string;
    severity: 'error' | 'warn' | 'info';
    code: string;
    message: string;
    file?: string;
}

export interface RpcCallContext {
    filePath: string;
    isNextApiRoute: boolean;
    clientType: 'admin' | 'anon' | 'unknown';
}

export interface TsAnalysisResult {
    calledRpcs: Map<string, RpcCallContext[]>; // rpc -> context[]
    touchedTables: Map<string, string[]>; // table -> files[]
    enqueuedJobs: Map<string, string[]>; // job_type -> files[]
    diagnostics: AppDiagnostic[];
    dataLineage: Record<string, string[]>; // excel mapped columns
}

// Recorrer árbol AST buscando nodos específicos
function walkAst(node: ts.Node, visitor: (node: ts.Node) => void) {
    visitor(node);
    ts.forEachChild(node, child => walkAst(child, visitor));
}

// Analizar un archivo TypeScript
function analyzeTsFile(filePath: string, result: TsAnalysisResult) {
    if (!fs.existsSync(filePath)) return;
    const sourceCode = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(filePath, sourceCode, ts.ScriptTarget.Latest, true);

    
    // Detectar caracteres raros (mojibake)
    if (sourceCode.includes('-') || sourceCode.includes('\u2500') || sourceCode.includes('â€')) {
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
    if (sourceCode.includes('-') || sourceCode.includes('\u2500') || sourceCode.includes('â€')) {
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
walkAst(sourceFile, (node) => {
        if (ts.isCallExpression(node)) {
            const exp = node.expression;
            if (ts.isPropertyAccessExpression(exp)) {
                const propName = exp.name.text;
                const parentExp = exp.expression;

                if (ts.isPropertyAccessExpression(parentExp) || ts.isIdentifier(parentExp)) {
                    const text = parentExp.getText(sourceFile);
                    if (text.includes('supabase') || text.includes('supabaseAdmin')) {
                        
                        // Detectar .rpc('...')
                        if (propName === 'rpc' && node.arguments.length > 0) {
                            const arg0 = node.arguments[0];
                            if (ts.isStringLiteral(arg0)) {
                                const rpcName = arg0.text;
                                const callerText = text.toLowerCase();
                                const clientType = (callerText.includes('admin') || callerText.includes('service')) ? 'admin' : 'anon';
                                const isNextApiRoute = filePath.includes(path.join('app', 'api')) || filePath.includes(path.join('pages', 'api'));

                                if (!result.calledRpcs.has(rpcName)) result.calledRpcs.set(rpcName, []);
                                
                                const existing = result.calledRpcs.get(rpcName)!;
                                if (!existing.some(c => c.filePath === filePath)) {
                                    existing.push({ filePath, isNextApiRoute, clientType });
                                }
                            }
                        }
                        
                        // Detectar .from('...')
                        if (propName === 'from' && node.arguments.length > 0) {
                            const arg0 = node.arguments[0];
                            if (ts.isStringLiteral(arg0)) {
                                const tableName = arg0.text;
                                if (!result.touchedTables.has(tableName)) result.touchedTables.set(tableName, []);
                                if (!result.touchedTables.get(tableName)!.includes(filePath)) {
                                    result.touchedTables.get(tableName)!.push(filePath);
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
            const insertArgs = node.arguments;
            if (insertArgs.length > 0 && ts.isObjectLiteralExpression(insertArgs[0])) {
                const obj = insertArgs[0];
                obj.properties.forEach(p => {
                    if (ts.isPropertyAssignment(p) && p.name.getText(sourceFile) === 'type') {
                        if (ts.isStringLiteral(p.initializer)) {
                            const jobType = p.initializer.text;
                            if (!result.enqueuedJobs.has(jobType)) result.enqueuedJobs.set(jobType, []);
                            if (!result.enqueuedJobs.get(jobType)!.includes(filePath)) {
                                result.enqueuedJobs.get(jobType)!.push(filePath);
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
        const regexCols = /m\.columna_([a-zA-Z0-9_]+)/g;
        let match;
        while ((match = regexCols.exec(sourceCode)) !== null) {
            const col = match[1];
            if (!result.dataLineage['mapeo_frontend']) result.dataLineage['mapeo_frontend'] = [];
            if (!result.dataLineage['mapeo_frontend'].includes(col)) result.dataLineage['mapeo_frontend'].push(col);
        }
    }
}

// Analizar directorio completo
function analyzeDirectory(dirPath: string, result: TsAnalysisResult) {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules' && entry.name !== '.next') {
                analyzeDirectory(fullPath, result);
            }
        } else if (entry.isFile() && (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx'))) {
            analyzeTsFile(fullPath, result);
        }
    }
}

export function runStaticAppAnalysis(rootDir: string): TsAnalysisResult {
    const result: TsAnalysisResult = {
        calledRpcs: new Map(),
        touchedTables: new Map(),
        enqueuedJobs: new Map(),
        diagnostics: [],
        dataLineage: {}
    };

    const dashboardSrc = path.join(rootDir, 'apps', 'dashboard', 'src');
    const edgeFuncs = path.join(rootDir, 'supabase', 'functions');

    analyzeDirectory(dashboardSrc, result);
    analyzeDirectory(edgeFuncs, result);

    return result;
}

export function validateCrossReferences(
    tsResult: TsAnalysisResult, 
    dbFunctions: Record<string, any>, 
    dbTables: Record<string, any>, 
    workerHandlers: string[]
): AppDiagnostic[] {
    const diagnostics: AppDiagnostic[] = [];

    // Validar RPCs y Timeouts
    tsResult.calledRpcs.forEach((calls, rpcName) => {
        const dbFunc = dbFunctions[rpcName] || dbFunctions[`public.${rpcName}`];
        if (!dbFunc) {
            diagnostics.push({
                scope: `app.rpc.${rpcName}`,
                severity: 'error',
                code: 'RPC_NOT_FOUND',
                message: `La aplicación llama a un RPC inexistente '${rpcName}' en ${calls.length} archivo(s).`,
                file: calls[0].filePath
            });
        } else {
            calls.forEach(call => {
                // Regla 2: [TIMEOUT_RISK]
                if (call.isNextApiRoute && dbFunc.avg_time_ms && dbFunc.avg_time_ms > 10000) {
                    diagnostics.push({
                        scope: `app.rpc.${rpcName}`,
                        severity: 'error',
                        code: 'TIMEOUT_RISK',
                        message: `Riesgo de Timeout: La ruta Next.js llama sincrónicamente a '${rpcName}' con tiempo estimado de ${dbFunc.avg_time_ms}ms (excede límite de 10s de Vercel/Kong).`,
                        file: call.filePath
                    });
                }

                // Regla 3: [ARCH_VIOLATION]
                if (dbFunc.is_async_architectural_boundary && call.isNextApiRoute) {
                    diagnostics.push({
                        scope: `app.rpc.${rpcName}`,
                        severity: 'error',
                        code: 'ARCH_VIOLATION',
                        message: `Violación de Arquitectura: '${rpcName}' debe ser procesado asíncronamente mediante una cola, pero se invoca directamente de forma síncrona en Next.js.`,
                        file: call.filePath
                    });
                }
            });
        }
    });

    // Validar Tablas fantasma
    tsResult.touchedTables.forEach((files, tableName) => {
        if (!dbTables[tableName] && !dbTables[`public.${tableName}`] && tableName !== 'storage' && tableName !== 'auth' && !tableName.includes('v_')) {
            // storage no es una tabla en public. A veces llaman supabase.storage.from()
            diagnostics.push({
                scope: `app.table.${tableName}`,
                severity: 'warn', // Warn for now to avoid false positive views
                code: 'TABLE_NOT_FOUND',
                message: `La app hace referencia a una tabla/vista '${tableName}' que no fue encontrada en la extracción de public.`,
                file: files[0]
            });
        }
    });

    // Validar Colas huerfanas (jobs encolados pero no hay handler en el worker)
    tsResult.enqueuedJobs.forEach((files, jobType) => {
        if (!workerHandlers.includes(jobType)) {
            diagnostics.push({
                scope: `app.queue.${jobType}`,
                severity: 'error',
                code: 'ORPHAN_QUEUE',
                message: `La app encola un job tipo '${jobType}', pero NINGÚN worker lo procesa. Es un flujo sin salida.`,
                file: files[0]
            });
        }
    });

    return diagnostics;
}

// Analizar SQL crudo buscando extracciones de JSONB (->> o jsonb_extract_path_text)
export function analyzeDataLineageSql(sqlBody: string, functionName: string, dbTables: Record<string, any>): AppDiagnostic[] {
    const diagnostics: AppDiagnostic[] = [];
    const keysExtracted = new Set<string>();
    
    // Regex para ->> 'llave' o -> 'llave'
    const jsonbRegex = /->>\s*['"]([a-zA-Z0-9_]+)['"]/g;
    let match;
    while ((match = jsonbRegex.exec(sqlBody)) !== null) {
        keysExtracted.add(match[1]);
    }

    const jsonbFuncRegex = /jsonb_extract_path_text\([^,]+,\s*['"]([a-zA-Z0-9_]+)['"]/g;
    while ((match = jsonbFuncRegex.exec(sqlBody)) !== null) {
        keysExtracted.add(match[1]);
    }

    // Buscamos a dónde inserta esta función (muy básico: INSERT INTO nombre_tabla)
    const insertRegex = /INSERT INTO\s+([a-zA-Z0-9_]+)/g;
    const targetTables = new Set<string>();
    while ((match = insertRegex.exec(sqlBody)) !== null) {
        targetTables.add(match[1]);
    }

    targetTables.forEach(table => {
        const tableMeta = dbTables[table];
        if (tableMeta && tableMeta.columns) {
            const tableCols = tableMeta.columns as string[];
            keysExtracted.forEach(key => {
                // Heuristica: Si la llave extraída parece una columna (no es id, user_id, etc) y no está en la tabla destino
                if (!tableCols.includes(key) && !tableCols.includes(key + '_excel') && !['payload', 'id'].includes(key)) {
                    // Generar un aviso o error
                    diagnostics.push({
                         scope: `lineage.sql.${functionName}`,
                         severity: 'warn',
                         code: 'DATA_LINEAGE_MISMATCH',
                         message: `La función extrae '${key}' del JSONB pero la tabla destino '${table}' no parece tener una columna homónima o mapeada. Posible pérdida silenciosa.`
                    });
                }
            });
        }
    });

    // Validacion Semantica de Alias / Joins Cruzados
    // Busca patrones especificos donde se compara "codigo_excel" con "modelo_norm" o similares, ignorando paréntesis de funciones
    const semanticJoinRegex = /(?:[a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)[^=<>\.]*?(?:[=<>])\s*(?:[a-zA-Z0-9_]+)\.([a-zA-Z0-9_]+)/g;
    let joinMatch;
    while ((joinMatch = semanticJoinRegex.exec(sqlBody)) !== null) {
        const leftCol = joinMatch[1]; // ej. codigo_excel
        const rightCol = joinMatch[2]; // ej. modelo_norm
        
        // Si comparamos codigo contra modelo (o modelo contra codigo)
        if ((leftCol.includes('codigo') && rightCol.includes('modelo')) || 
            (leftCol.includes('modelo') && rightCol.includes('codigo'))) {
            diagnostics.push({
                scope: `lineage.semantic.${functionName}`,
                severity: 'error',
                code: 'SEMANTIC_JOIN_MISMATCH',
                message: `Violación de semántica de dominio detectada en JOIN: comparando '${leftCol}' de alias con '${rightCol}' del archivo crudo. Esto hará que el matching falle en silencio.`
            });
        }
    }

    return diagnostics;
}
