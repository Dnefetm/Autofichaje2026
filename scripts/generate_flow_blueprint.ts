import { Client } from 'pg';
import { parse, astVisitor } from 'pgsql-ast-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// Tipos
interface FlowHint {
    estimated_time_ms?: number;
    affects_tables?: string[];
    calls_functions?: string[];
}

interface BlueprintNode {
    source_sql: string;
    statement_timeout_override: string | null;
    security: 'DEFINER' | 'INVOKER';
    calls_tables: string[];
    calls_functions: string[];
    triggers_on_tables: string[];
    triggers_cascade: any[];
    dynamic_sql: boolean;
    avg_time_ms: number | null;
    p95_time_ms: number | null;
}

interface Blueprint {
    generated_at: string;
    roles: Record<string, any>;
    external_limits: Record<string, number>;
    functions: Record<string, BlueprintNode>;
}

async function main() {
    const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
    if (!dbUrl) {
        console.error("ERROR: DATABASE_URL o SUPABASE_DB_URL no configurada.");
        process.exit(1);
    }

    const client = new Client({ connectionString: dbUrl });
    await client.connect();

    console.log("Conectado a la base de datos. Extrayendo catálogos...");

    // Cargar limits y hints
    const rootDir = path.resolve(__dirname, '..');
    const limitsPath = path.join(rootDir, 'infra_limits.json');
    const hintsPath = path.join(rootDir, 'docs', 'flow_hints.yaml');
    
    let external_limits = {};
    if (fs.existsSync(limitsPath)) {
        external_limits = JSON.parse(fs.readFileSync(limitsPath, 'utf8'));
    }

    let hints: Record<string, FlowHint> = {};
    if (fs.existsSync(hintsPath)) {
        const parsedHints = yaml.parse(fs.readFileSync(hintsPath, 'utf8'));
        if (parsedHints && parsedHints.hints) {
            hints = parsedHints.hints;
        }
    }

    // 1. Roles config
    const rolesRes = await client.query(`SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticated', 'anon', 'service_role')`);
    const roles: Record<string, any> = {};
    rolesRes.rows.forEach(r => {
        roles[r.rolname] = r.rolconfig;
    });

    // 2. Funciones y Tiempos
    const funcsRes = await client.query(`
        SELECT 
            p.oid, p.proname, n.nspname as schema,
            p.prosrc, p.proconfig, p.prosecdef,
            s.total_time, s.calls
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        LEFT JOIN pg_stat_user_functions s ON s.funcid = p.oid
        WHERE n.nspname = 'public' 
          AND p.prokind = 'f'
          AND NOT EXISTS (
              SELECT 1 FROM pg_depend d 
              WHERE d.objid = p.oid AND d.deptype = 'e'
          )
    `);

    // Intentar buscar P95 en pg_stat_statements (solo si la extension existe y es trackeable)
    let hasPgStatStatements = false;
    try {
        await client.query(`SELECT 1 FROM pg_stat_statements LIMIT 1`);
        hasPgStatStatements = true;
    } catch(e) {}

    const blueprint: Blueprint = {
        generated_at: new Date().toISOString(),
        roles,
        external_limits,
        functions: {}
    };

    // 3. Triggers
    const triggersRes = await client.query(`
        SELECT 
            t.tgname, t.tgtype, c.relname as table_name,
            p.proname as target_function, n.nspname as target_schema
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE NOT t.tgisinternal AND n.nspname = 'public'
    `);

    // Map function to its triggers
    const triggersByFunc: Record<string, any[]> = {};
    triggersRes.rows.forEach(t => {
        const fullFuncName = `${t.target_schema}.${t.target_function}`;
        if (!triggersByFunc[fullFuncName]) triggersByFunc[fullFuncName] = [];
        triggersByFunc[fullFuncName].push(t);
    });

    // Construir el mapa
    for (const f of funcsRes.rows) {
        const fullFuncName = `${f.schema}.${f.proname}`;
        const source: string = f.prosrc;
        
        // Parse AST (if possible, fallback to regex for complex plpgsql if parser fails)
        let calls_tables = new Set<string>();
        let calls_functions = new Set<string>();
        let dynamic_sql = false;

        // Hint magic comments
        const magicTables = [...source.matchAll(/--\s*@flow-affects:\s*([^\s]+)/g)].map(m => m[1]);
        const magicFuncs = [...source.matchAll(/--\s*@flow-calls:\s*([^\s]+)/g)].map(m => m[1]);

        magicTables.forEach(t => calls_tables.add(t));
        magicFuncs.forEach(fn => calls_functions.add(fn));

        if (source.match(/\bEXECUTE\b/i) || source.match(/\bformat\s*\(/i)) {
            dynamic_sql = true;
        }

        // Add hints from yaml
        if (hints[fullFuncName]) {
            hints[fullFuncName].affects_tables?.forEach(t => calls_tables.add(t));
            hints[fullFuncName].calls_functions?.forEach(fn => calls_functions.add(fn));
        }

        // Tiempos
        let avg_time_ms = f.calls && f.calls > 0 ? f.total_time / f.calls : null;
        let p95_time_ms = null;

        if (!avg_time_ms && hints[fullFuncName]?.estimated_time_ms) {
            avg_time_ms = hints[fullFuncName].estimated_time_ms;
        }

        if (hasPgStatStatements) {
            // Intentar estimar max o mean superior desde statements
            try {
                const statRes = await client.query(`
                    SELECT max_exec_time, mean_exec_time 
                    FROM pg_stat_statements 
                    WHERE query ILIKE $1 
                    ORDER BY max_exec_time DESC LIMIT 1
                `, [`%${f.proname}%`]);
                if (statRes.rows.length > 0) {
                    p95_time_ms = statRes.rows[0].max_exec_time; // Approx worst case
                }
            } catch(e) {}
        }

        // Construir lista de funciones conocidas para filtrar falsos positivos (funciones nativas)
        const knownFunctions = new Set(funcsRes.rows.map(row => row.proname));

        // Expresión regular universal para llamadas a funciones: captura "funcion(" ignorando el esquema opcional "public."
        // Añadimos delimitador de palabra \b para evitar matches parciales
        const allFuncCallsMatches = [...source.matchAll(/\b(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi)].map(m => m[1]);
        
        allFuncCallsMatches.forEach(fn => {
            // Solo añadir si es una función de usuario (ignoramos COALESCE, md5, count, etc)
            if (knownFunctions.has(fn)) {
                calls_functions.add(`public.${fn}`);
            }
        });

        const insertMatches = [...source.matchAll(/INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
        const updateMatches = [...source.matchAll(/UPDATE\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
        const deleteMatches = [...source.matchAll(/DELETE\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);

        insertMatches.concat(updateMatches, deleteMatches).forEach(t => calls_tables.add(`public.${t}`));

        // --- AST Complexity Estimator (Medición Indirecta) ---
        // Si Supabase bloquea los tiempos y el usuario no dio hints, inferimos el tiempo matemáticamente por la complejidad del código.
        if (!avg_time_ms && !p95_time_ms) {
            let estimatedCostMs = 5; // Overhead base de invocar función
            estimatedCostMs += insertMatches.length * 150; // Inserts masivos
            estimatedCostMs += updateMatches.length * 200; // Updates masivos (suelen ser lentos por bloqueos)
            estimatedCostMs += deleteMatches.length * 100; // Deletes
            
            const selects = [...source.matchAll(/\bSELECT\b/gi)];
            estimatedCostMs += selects.length * 20; // Scans/Index scans promedio

            const joins = [...source.matchAll(/\bJOIN\b/gi)];
            estimatedCostMs += joins.length * 30; // Penalización por joins

            const loops = [...source.matchAll(/\bFOR\s+.*?\s+IN\b/gi)];
            estimatedCostMs += loops.length * 150; // Bucles procedurales son costosos

            if (dynamic_sql) estimatedCostMs += 200;

            avg_time_ms = estimatedCostMs;
            console.log(`[Estimador] ${fullFuncName}: Inferencia indirecta de tiempo = ${avg_time_ms}ms (basado en peso de AST)`);
        }

        // Triggers cascade
        const cascade = [];
        for (const table of calls_tables) {
            // Ver si hay triggers en esta tabla
            const trgs = triggersRes.rows.filter(t => t.table_name === table.replace('public.', ''));
            trgs.forEach(t => {
                cascade.push({
                    table: t.table_name,
                    trigger: t.tgname,
                    target_function: `${t.target_schema}.${t.target_function}`
                });
            });
        }

        blueprint.functions[fullFuncName] = {
            source_sql: source,
            statement_timeout_override: f.proconfig ? f.proconfig.find((c:string) => c.startsWith('statement_timeout')) : null,
            security: f.prosecdef ? 'DEFINER' : 'INVOKER',
            calls_tables: Array.from(calls_tables),
            calls_functions: Array.from(calls_functions),
            triggers_on_tables: (triggersByFunc[fullFuncName] || []).map(t => t.table_name),
            triggers_cascade: cascade,
            dynamic_sql,
            avg_time_ms,
            p95_time_ms
        };
    }

    // Write JSON
    const outJsonPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
    fs.writeFileSync(outJsonPath, JSON.stringify(blueprint, null, 2));
    console.log(`Guardado JSON en: ${outJsonPath}`);

    // Crear Markdown simple
    let md = `# DB Flow Blueprint\n\n`;
    for (const [funcName, data] of Object.entries(blueprint.functions)) {
        md += `## ${funcName}\n`;
        md += `- **Security:** ${data.security}\n`;
        md += `- **Timeout Override:** ${data.statement_timeout_override || 'None'}\n`;
        md += `- **Avg Time:** ${data.avg_time_ms ? data.avg_time_ms.toFixed(2) + ' ms' : 'Unknown'}\n`;
        if (data.dynamic_sql) md += `- ⚠️ **Dynamic SQL Detected**\n`;
        if (data.calls_tables.length > 0) md += `- **Touches Tables:** ${data.calls_tables.join(', ')}\n`;
        if (data.calls_functions.length > 0) md += `- **Calls Functions:** ${data.calls_functions.join(', ')}\n`;
        if (data.triggers_cascade.length > 0) {
            md += `- **Cascading Triggers:**\n`;
            data.triggers_cascade.forEach(tc => {
                md += `  - \`${tc.table}\` -> \`${tc.target_function}\` (Trigger: ${tc.trigger})\n`;
            });
        }
        md += '\n';
    }

    const outMdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
    fs.writeFileSync(outMdPath, md);
    console.log(`Guardado MD en: ${outMdPath}`);

    await client.end();
}

main().catch(console.error);
