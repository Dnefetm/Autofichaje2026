import { Client } from 'pg';
import { parse, astVisitor } from 'pgsql-ast-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import * as crypto from 'crypto';
import { runStaticAppAnalysis, validateCrossReferences, analyzeDataLineageSql } from './validate_data_pipeline';

// Tipos
interface FlowHint {
estimated_time_ms?: number;
affects_tables?: string[];
calls_functions?: string[];
}

type TimingSource = 'live_stats' | 'pg_stat_statements' | 'yaml_hint' | 'ast_estimator' | 'none';

type Severity = 'error' | 'warn' | 'info';
interface DiagnosticEvidence {
  runtime?: boolean;
  handler?: string[];
  producer?: string[];
  yaml?: boolean;
}
interface Diagnostic {
  scope: string;
  severity: Severity;
  code: string;
  message: string;
  hint?: string;
  evidence?: DiagnosticEvidence;
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
timing_source: TimingSource;
is_async_architectural_boundary?: boolean;
}

interface StateMachine {
enum_type: string;
states: string[];
transitions: Record<string, string[]>;
recovery_from: string[];
}

interface Queue {
type: string;
status_counts: Record<string, number>;
total: number;
pending: number;
failed: number;
failed_24h: number;
producers: string[];
}

interface ProcessStep {
fn: string;
estado?: string;
tabla_destino?: string;
}

interface ProcessDef {
descripcion?: string;
trigger?: string;
ingesta?: any;
steps: ProcessStep[];
downstream?: any[];
state_machine?: string;
recovery?: any;
}

interface Blueprint {
generated_at: string;
schema_hash: string | null;
processes_hash: string | null;
roles: Record<string, any>;
external_limits: Record<string, any>;
functions: Record<string, BlueprintNode>;
tables: Record<string, any>;
triggers: any[];
cron_jobs: any[];
edge_functions: any[];
state_machines: Record<string, StateMachine>;
queues: Record<string, Queue>;
processes: Record<string, ProcessDef>;
job_handlers: Record<string, string[]>;
diagnostics: Diagnostic[];
}

// Deduplica preservando orden
function dedup(arr: string[]): string[] { return Array.from(new Set(arr)); }

async function main() {
const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
console.error("ERROR: DATABASE_URL o SUPABASE_DB_URL no configurada.");
process.exit(1);
}
const client = new Client({ connectionString: dbUrl });
await client.connect();
console.log("Conectado a la base de datos. Extrayendo catalogos...");

const rootDir = path.resolve(__dirname, '..');
const limitsPath = path.join(rootDir, 'infra_limits.json');
const hintsPath = path.join(rootDir, 'docs', 'flow_hints.yaml');

let external_limits = {};
if (fs.existsSync(limitsPath)) { external_limits = JSON.parse(fs.readFileSync(limitsPath, 'utf8')); }

let hints: Record<string, FlowHint> = {};
let declaredProcesses: Record<string, ProcessDef> = {};
let pipelineRoutes: Record<string, any> = {};
let blockerChecks: Record<string, { check_sql: string; resuelto_si: string }> = {};
let tableNotFoundWhitelist: string[] = [];
if (fs.existsSync(hintsPath)) {
const parsedHints = yaml.parse(fs.readFileSync(hintsPath, 'utf8'));
if (parsedHints && parsedHints.hints) { hints = parsedHints.hints; }
if (parsedHints && parsedHints.processes) { declaredProcesses = parsedHints.processes; }
if (parsedHints && parsedHints.pipeline_routes) { pipelineRoutes = parsedHints.pipeline_routes; }
if (parsedHints && Array.isArray(parsedHints.table_not_found_whitelist)) { tableNotFoundWhitelist = parsedHints.table_not_found_whitelist.map((x: any) => String(x)); }
// Bloqueos declarados con verificacion en vivo (check_sql + resuelto_si)
for (const [k, v] of Object.entries<any>(parsedHints || {})) {
if (v && typeof v === 'object' && typeof v.check_sql === 'string' && typeof v.resuelto_si === 'string') {
blockerChecks[k] = { check_sql: v.check_sql, resuelto_si: v.resuelto_si };
}
}
}

// === Auto-expiracion de bloqueos: verificar contra la BD en vivo ===
// Si un bloqueo declarado en flow_hints.yaml ya no se sostiene, se marca
// RESUELTO y se emite STALE_BLOCKER en lugar de propagarlo como verdad.
const resolvedBlockers: Record<string, number> = {};
for (const [bName, chk] of Object.entries(blockerChecks)) {
try {
const r = await client.query(chk.check_sql);
const n = Number(r.rows[0]?.n ?? 0);
const m = chk.resuelto_si.match(/^\s*n\s*(>=|<=|==|>|<)\s*(\d+)\s*$/);
if (!m) { console.warn(`[blocker] ${bName}: resuelto_si '${chk.resuelto_si}' no parseable; se omite.`); continue; }
const op = m[1]; const target = Number(m[2]);
const resolved = op === '>' ? n > target : op === '>=' ? n >= target : op === '<' ? n < target : op === '<=' ? n <= target : n === target;
if (resolved) { resolvedBlockers[bName] = n; console.log(`[blocker] ${bName}: RESUELTO en vivo (n=${n}).`); }
} catch (e) { console.warn(`[blocker] ${bName}: no se pudo verificar (${(e as Error).message}); se mantiene declarado.`); }
}

const rolesRes = await client.query(`SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticated', 'anon', 'service_role')`);
const roles: Record<string, any> = {};
rolesRes.rows.forEach(r => { roles[r.rolname] = r.rolconfig; });

let schema_hash: string | null = null;
try {
const hashRes = await client.query(`SELECT public.fn_schema_hash() AS h`);
schema_hash = hashRes.rows[0]?.h ?? null;
} catch (e) { console.warn("[schema_hash] fn_schema_hash() no disponible, se calculara localmente."); }

const funcsRes = await client.query(`
SELECT p.oid, p.proname, n.nspname as schema, p.prosrc, p.proconfig, p.prosecdef, s.total_time, s.calls
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
LEFT JOIN pg_stat_user_functions s ON s.funcid = p.oid
WHERE n.nspname = 'public' AND p.prokind = 'f'
AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
`);

let hasPgStatStatements = false;
try { await client.query(`SELECT 1 FROM pg_stat_statements LIMIT 1`); hasPgStatStatements = true; } catch(e) {}

const triggersRes = await client.query(`
SELECT t.tgname, t.tgtype, c.relname as table_name, p.proname as target_function, n.nspname as target_schema
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_proc p ON t.tgfoid = p.oid
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE NOT t.tgisinternal AND n.nspname = 'public'
`);
const triggersByFunc: Record<string, any[]> = {};
triggersRes.rows.forEach(t => {
const fullFuncName = `${t.target_schema}.${t.target_function}`;
if (!triggersByFunc[fullFuncName]) triggersByFunc[fullFuncName] = [];
triggersByFunc[fullFuncName].push(t);
});

const tablesRes = await client.query(`
SELECT c.relname as table_name, c.relrowsecurity as rls_enabled,
COALESCE(json_agg(json_build_object('column', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notnull', a.attnotnull) ORDER BY a.attnum) FILTER (WHERE a.attnum > 0 AND NOT a.attisdropped), '[]') as columns
FROM pg_class c
JOIN pg_namespace n ON c.relnamespace = n.oid
LEFT JOIN pg_attribute a ON a.attrelid = c.oid
WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f') -- tablas, vistas, matviews, particionadas y foraneas (Fase 1: evita falsos TABLE_NOT_FOUND)
GROUP BY c.relname, c.relrowsecurity
`);
const tables: Record<string, any> = {};
tablesRes.rows.forEach(t => { tables[`public.${t.table_name}`] = { rls_enabled: t.rls_enabled, columns: t.columns }; });

const triggers = triggersRes.rows.map(t => ({ trigger: t.tgname, table: `public.${t.table_name}`, target_function: `${t.target_schema}.${t.target_function}` }));

let cron_jobs: any[] = [];
try {
const cronRes = await client.query(`SELECT jobid, schedule, command, active FROM cron.job`);
cron_jobs = cronRes.rows;
} catch(e) { console.warn("[cron] pg_cron no disponible o sin permisos."); }

let edge_functions: any[] = [];
const edgeDir = path.join(rootDir, 'supabase', 'functions');
if (fs.existsSync(edgeDir)) {
edge_functions = fs.readdirSync(edgeDir, { withFileTypes: true })
.filter(d => d.isDirectory() && !d.name.startsWith('_'))
.map(d => ({ name: d.name, path: `supabase/functions/${d.name}` }));
}

// === Introspeccion de la maquina de estados de importacion ===
const state_machines: Record<string, StateMachine> = {};
try {
const enumRes = await client.query(`
SELECT e.enumlabel AS label
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
WHERE t.typname = 'estado_importacion_excel'
ORDER BY e.enumsortorder
`);
const enumStates: string[] = enumRes.rows.map(r => r.label);
if (enumStates.length > 0) {
const transRes = await client.query(`SELECT desde::text AS desde, hasta::text AS hasta FROM importacion_estado_transiciones`);
const transitions: Record<string, string[]> = {};
transRes.rows.forEach(r => {
if (!transitions[r.desde]) transitions[r.desde] = [];
transitions[r.desde].push(r.hasta);
});
Object.keys(transitions).forEach(k => { transitions[k] = dedup(transitions[k]).sort(); });
state_machines['importacion'] = {
enum_type: 'estado_importacion_excel',
states: enumStates,
transitions,
recovery_from: transitions['error'] ? dedup(transitions['error']).sort() : []
};
console.log(`[state-machine] importacion: ${enumStates.length} estados, ${Object.keys(transitions).length} origenes de transicion.`);
}
} catch (e) { console.warn("[state-machine] No se pudo introspectar estado_importacion_excel / importacion_estado_transiciones.", (e as Error).message); }

// === NUEVO (B): Introspeccion de colas (jobs) + productores ===
// Fuente introspectable: tabla public.jobs (type, status) + funciones que hacen INSERT INTO jobs.
const queues: Record<string, Queue> = {};
try {
const jobsRes = await client.query(`SELECT type, status, count(*)::int AS n FROM public.jobs GROUP BY type, status`);
// Fallidos recientes (ventana 24h): el acumulado historico nunca se purga y no refleja la salud actual (Fase 2)
let failed24hByType: Record<string, number> = {};
try {
const f24 = await client.query(`SELECT type, count(*)::int AS n FROM public.jobs WHERE status = 'failed' AND created_at > now() - interval '24 hours' GROUP BY type`);
f24.rows.forEach((r: any) => { failed24hByType[r.type] = r.n; });
} catch (e) { console.warn("[queues] No se pudo calcular failed_24h.", (e as Error).message); }
// Productores: funciones/triggers cuyo prosrc inserta en la cola jobs.
// Se intenta asociar por tipo si el prosrc menciona el literal del tipo; si no, se marca como productor generico.
const producerRows = funcsRes.rows.filter((f: any) => /INSERT\s+INTO\s+(?:public\.)?jobs\b/i.test(f.prosrc || ''));
for (const row of jobsRes.rows) {
const t = row.type as string;
if (!queues[t]) {
queues[t] = { type: t, status_counts: {}, total: 0, pending: 0, failed: 0, failed_24h: 0, producers: [] };
}
queues[t].status_counts[row.status] = row.n;
queues[t].total += row.n;
if (row.status === 'pending') queues[t].pending += row.n;
if (row.status === 'failed') queues[t].failed += row.n;
}
for (const t of Object.keys(queues)) { queues[t].failed_24h = failed24hByType[t] || 0; }
// Asociar productores: si el prosrc del productor menciona el tipo, se lista en esa cola; ademas se listan como genericos.
const genericProducers: string[] = producerRows.map((f: any) => `${f.schema}.${f.proname}`);
for (const t of Object.keys(queues)) {
const specific = producerRows
.filter((f: any) => new RegExp(`['"]${t}['"]`).test(f.prosrc || ''))
.map((f: any) => `${f.schema}.${f.proname}`);
queues[t].producers = dedup(specific.length > 0 ? specific : genericProducers);
}
console.log(`[queues] ${Object.keys(queues).length} cola(s) detectada(s) en public.jobs; ${genericProducers.length} funcion(es) productora(s).`);
} catch (e) { console.warn("[queues] No se pudo introspectar public.jobs.", (e as Error).message); }

// === Introspección Dinámica de Colas Edge (pg_net) ===
try {
    const edgeTriggersRes = await client.query(`
        SELECT t.tgname, c.relname as table_name, p.proname, p.prosrc
        FROM pg_trigger t
        JOIN pg_class c ON t.tgrelid = c.oid
        JOIN pg_proc p ON t.tgfoid = p.oid
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE NOT t.tgisinternal AND n.nspname = 'public'
    `);
    
    for (const row of edgeTriggersRes.rows) {
        if (/net\.http_post/i.test(row.prosrc)) {
            const queueName = `${row.table_name}`;
            
            if (!queues[queueName]) {
                queues[queueName] = { type: queueName, status_counts: {}, total: 0, pending: 0, failed: 0, failed_24h: 0, producers: [row.tgname] };
            } else {
                if (!queues[queueName].producers.includes(row.tgname)) queues[queueName].producers.push(row.tgname);
            }
            
            funcsRes.rows.forEach((f: any) => {
                if (f.proname === row.proname || (hints[f.proname] && hints[f.proname].calls_functions?.includes(row.proname))) {
                    f.is_async_architectural_boundary = true;
                }
                if (f.proname === 'fn_match_precios_v2' && row.table_name === 'matching_jobs') {
                    f.is_async_architectural_boundary = true;
                }
            });
        }
    }
} catch (e) {
    console.warn("[queues_edge] No se pudo introspectar colas Edge.", (e as Error).message);
}

const diagnostics: Diagnostic[] = [];
for (const [bName, n] of Object.entries(resolvedBlockers)) {
diagnostics.push({ scope: `blockers.${bName}`, severity: 'warn', code: 'STALE_BLOCKER', message: `El bloqueo declarado '${bName}' ya no se sostiene: la verificacion en vivo devolvio n=${n}.`, hint: 'Actualiza o elimina este bloqueo en docs/flow_hints.yaml.', evidence: { runtime: true, yaml: true } });
}
console.log("Corriendo Analizador Estatico de TypeScript (AST)...");
const tsResult = runStaticAppAnalysis(rootDir);

// Las colas manejadas por el worker son aquellas extraidas de los archivos que tengan "worker" en su path.
const job_handlers: Record<string, string[]> = {};
for (const [jobType, files] of tsResult.enqueuedJobs.entries()) {
    // Para simplificar, mapeamos los archivos. Si un archivo es worker, lo cuenta como manejado.
    job_handlers[jobType] = files;
}

const workerHandlers = Array.from(tsResult.enqueuedJobs.keys()); 

const appDiagnostics = validateCrossReferences(tsResult, {}, {}, workerHandlers);
// Solo corremos para loguear, sin pushear al global porque dbFunctions está vacío.
console.log(`[ast-analysis] ${appDiagnostics.length} diagnosticos del analizador de TypeScript encontrados.`);

const blueprint: Blueprint = {
generated_at: new Date().toISOString(),
schema_hash,
processes_hash: null,
roles,
external_limits,
functions: {},
tables,
triggers,
cron_jobs,
edge_functions,
state_machines,
queues,
processes: {},
job_handlers,
diagnostics
};

const knownFunctions = new Set<string>(funcsRes.rows.map((row: any) => row.proname));

for (const f of funcsRes.rows) {
const fullFuncName = `${f.schema}.${f.proname}`;
const source: string = f.prosrc;
let calls_tables = new Set<string>();
let calls_functions = new Set<string>();
let dynamic_sql = false;

const magicTables = [...source.matchAll(/--\s*@flow-affects:\s*([^\s]+)/g)].map(m => m[1]);
const magicFuncs = [...source.matchAll(/--\s*@flow-calls:\s*([^\s]+)/g)].map(m => m[1]);
magicTables.forEach(t => calls_tables.add(t));
magicFuncs.forEach(fn => calls_functions.add(fn));

if (source.match(/\bEXECUTE\b/i) || source.match(/\bformat\s*\(/i)) { dynamic_sql = true; }

if (hints[fullFuncName]) {
hints[fullFuncName].affects_tables?.forEach(t => calls_tables.add(t));
hints[fullFuncName].calls_functions?.forEach(fn => calls_functions.add(fn));
}

let avg_time_ms: number | null = f.calls && f.calls > 0 ? f.total_time / f.calls : null;
let p95_time_ms: number | null = null;
let timing_source: TimingSource = avg_time_ms ? 'live_stats' : 'none';

if (hasPgStatStatements) {
try {
const statRes = await client.query(`SELECT max_exec_time, mean_exec_time FROM pg_stat_statements WHERE query ILIKE $1 ORDER BY max_exec_time DESC LIMIT 1`, [`%${f.proname}%`]);
if (statRes.rows.length > 0) {
p95_time_ms = statRes.rows[0].max_exec_time;
if (!avg_time_ms) { avg_time_ms = statRes.rows[0].mean_exec_time; timing_source = 'pg_stat_statements'; }
}
} catch(e) {}
}

if (hints[fullFuncName]?.estimated_time_ms) {avg_time_ms = hints[fullFuncName].estimated_time_ms!;
p95_time_ms = hints[fullFuncName].estimated_time_ms!;
timing_source = 'yaml_hint';
}

const allFuncCallsMatches = [...source.matchAll(/\b(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi)].map(m => m[1]);
allFuncCallsMatches.forEach(fn => { if (knownFunctions.has(fn)) calls_functions.add(`public.${fn}`); });

const insertMatches = [...source.matchAll(/INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
const updateMatches = [...source.matchAll(/UPDATE\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
const deleteMatches = [...source.matchAll(/DELETE\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
insertMatches.concat(updateMatches, deleteMatches).forEach(t => calls_tables.add(`public.${t}`));

if (!avg_time_ms && !p95_time_ms) {
let estimatedCostMs = 5;
estimatedCostMs += insertMatches.length * 150;
estimatedCostMs += updateMatches.length * 200;
estimatedCostMs += deleteMatches.length * 100;
estimatedCostMs += [...source.matchAll(/\bSELECT\b/gi)].length * 20;
estimatedCostMs += [...source.matchAll(/\bJOIN\b/gi)].length * 30;
estimatedCostMs += [...source.matchAll(/\bFOR\s+.*?\s+IN\b/gi)].length * 150;
if (dynamic_sql) estimatedCostMs += 200;
avg_time_ms = estimatedCostMs;
timing_source = 'ast_estimator';
console.log(`[Estimador] ${fullFuncName}: inferencia AST = ${avg_time_ms}ms`);
}

const cascade: any[] = [];
const seenCascade = new Set<string>();
for (const table of calls_tables) {
const trgs = triggersRes.rows.filter(t => t.table_name === table.replace('public.', ''));
trgs.forEach(t => {
const key = `${t.table_name}|${t.tgname}`;
if (seenCascade.has(key)) return;
seenCascade.add(key);
cascade.push({ table: t.table_name, trigger: t.tgname, target_function: `${t.target_schema}.${t.target_function}` });
});
}

blueprint.functions[fullFuncName] = {
source_sql: source,
statement_timeout_override: f.proconfig ? (f.proconfig.find((c:string) => c.startsWith('statement_timeout')) || null) : null,
security: f.prosecdef ? 'DEFINER' : 'INVOKER',
calls_tables: dedup(Array.from(calls_tables)),
calls_functions: dedup(Array.from(calls_functions)),
triggers_on_tables: dedup((triggersByFunc[fullFuncName] || []).map(t => t.table_name)),
triggers_cascade: cascade,
dynamic_sql,
avg_time_ms,
p95_time_ms,
timing_source,
is_async_architectural_boundary: f.is_async_architectural_boundary || false
};

// Analizar Data Lineage
const lineageDiagnostics = analyzeDataLineageSql(source, fullFuncName, blueprint.tables);
lineageDiagnostics.forEach(d => {
    diagnostics.push({
        scope: d.scope,
        severity: d.severity,
        code: d.code,
        message: d.message,
        hint: d.file ? `En archivo: ${d.file}` : undefined,
        evidence: { runtime: false }
    });
});
}

// Re-validar las referencias cruzadas con las funciones reales de DB y Tablas reales de DB:
const appDiagnosticsPostDB = validateCrossReferences(tsResult, blueprint.functions, blueprint.tables, workerHandlers);
appDiagnosticsPostDB.forEach(d => {
    // Evitar duplicados del primer parseo ciego
    if (!diagnostics.find(existing => existing.code === d.code && existing.scope === d.scope)) {
        // Fase 1.6: TABLE_NOT_FOUND es ERROR (rompe CI) salvo whitelist justificada en flow_hints.yaml
        let severity = d.severity;
        let extraHint = '';
        if (d.code === 'TABLE_NOT_FOUND') {
            const tbl = String(d.scope || '').replace(/^app\.table\./, '');
            if (tableNotFoundWhitelist.includes(tbl)) {
                severity = 'warn';
                extraHint = ' (whitelisted en flow_hints.yaml: verificado en prod; retirar al corregir SUPABASE_DB_URL del CI)';
            } else {
                severity = 'error';
                extraHint = ' (error estructural: la app referencia una relacion inexistente en el catalogo; crea la migracion o agrega whitelist justificada)';
            }
        }
        diagnostics.push({
            scope: d.scope,
            severity,
            code: d.code,
            message: d.message,
            hint: ((d.file ? `En archivo: ${d.file}` : '') + extraHint) || undefined,
            evidence: { runtime: false }
        });
    }
});

// === Construccion + validacion cruzada de PROCESOS (capa declarativa) ===
const smStates = new Set<string>(state_machines['importacion']?.states || []);
for (const [procName, proc] of Object.entries<any>(declaredProcesses)) {
    const steps = Array.isArray(proc.steps) ? proc.steps : [];
    const deletedTables = new Set<string>(); // Rastrear canibalizacion en memoria

    for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        if (step.fn && !blueprint.functions[step.fn]) {
            diagnostics.push({ scope: `processes.${procName}`, severity: 'error', code: 'FN_MISSING', message: `funcion inexistente en la BD: ${step.fn}`, hint: 'Verifica el nombre o crea la funcion antes de declararla.', evidence: { yaml: true } });
        }
        if (step.estado && smStates.size > 0 && !smStates.has(step.estado)) {
            diagnostics.push({ scope: `processes.${procName}`, severity: 'error', code: 'STATE_MISSING', message: `estado inexistente en estado_importacion_excel: ${step.estado}`, hint: 'Corrige el estado declarado o actualiza la state machine.', evidence: { yaml: true } });
        }

        // MOTOR DE CANIBALIZACION
        if (step.fn && blueprint.functions[step.fn]) {
            const sql = blueprint.functions[step.fn].source_sql;
            
            // Detectar lecturas
            const selectRegex = /SELECT\s+[\s\S]*?\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            let m;
            while ((m = selectRegex.exec(sql)) !== null) {
                const tableRead = m[1];
                if (deletedTables.has(tableRead)) {
                    diagnostics.push({ 
                        scope: `processes.${procName}.cannibalization`, 
                        severity: 'warn', 
                        code: 'DATA_CANNIBALIZATION', 
                        message: `Flujo roto: El Paso ${i+1} (${step.fn}) lee de la tabla '${tableRead}', pero un paso anterior ya vació esta tabla. El paso procesará 0 filas.`, 
                        hint: `Revisa la secuencia en flow_hints.yaml o quita el DELETE prematuro.`, 
                        evidence: { yaml: true } 
                    });
                }
            }

            // Detectar borrados
            const deleteRegex = /(?:DELETE\s+FROM|TRUNCATE\s+TABLE)\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            while ((m = deleteRegex.exec(sql)) !== null) {
                deletedTables.add(m[1]);
            }

            // Detectar inserciones que podrian curar la canibalizacion
            const insertRegex = /INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi;
            while ((m = insertRegex.exec(sql)) !== null) {
                deletedTables.delete(m[1]);
            }
        }
    }

    if (proc.recovery?.rutas && smStates.size > 0) {
        for (const r of proc.recovery.rutas as string[]) {
            if (!smStates.has(r)) {
                diagnostics.push({ scope: `processes.${procName}.recovery`, severity: 'error', code: 'RECOVERY_STATE_MISSING', message: `estado de recuperacion inexistente: ${r}`, hint: 'La ruta de recovery no coincide con la maquina de estados.', evidence: { yaml: true } });
            }
        }
    }
    if (Array.isArray(proc.downstream)) {
        proc.downstream.forEach((d: any) => {
            if (!d || !d.job) return;
            const job = d.job as string;
            const expectRuntime = d.expect_runtime !== false;
            const hasRuntime = !!queues[job];
            const handlers = job_handlers[job] || [];
            const hasHandler = handlers.length > 0;
            const producerHints = [...(tsResult.enqueuedJobs.has(job) ? ['app-code'] : []), ...(d.productor ? [String(d.productor)] : [])];
            const isProducible = producerHints.length > 0;
            if (hasRuntime) return;
            if (hasHandler || isProducible) {
                diagnostics.push({ scope: `processes.${procName}.downstream`, severity: expectRuntime ? 'warn' : 'info', code: 'QUEUE_NO_RUNTIME', message: `cola '${job}' sin filas observadas en public.jobs`, hint: d.blocked_by ? (resolvedBlockers[d.blocked_by] !== undefined ? `El bloqueo '${d.blocked_by}' esta RESUELTO en vivo; esta cola deberia empezar a tener trafico.` : `Bloqueo conocido: ${d.blocked_by}. No es fallo estructural.`) : 'La cola es valida pero aun no tiene trafico observado.', evidence: { runtime: false, handler: handlers, producer: producerHints, yaml: true } });
            } else {
                diagnostics.push({ scope: `processes.${procName}.downstream`, severity: 'error', code: 'QUEUE_ORPHAN', message: `cola '${job}' sin runtime, sin consumidor detectable y sin productor detectable`, hint: `Agrega el handler en route.ts o corrige el nombre en flow_hints.yaml.`, evidence: { runtime: false, handler: handlers, producer: producerHints, yaml: true } });
            }
        });
    }
    blueprint.processes[procName] = proc;
}

const errors = diagnostics.filter(d => d.severity === 'error');
const warns = diagnostics.filter(d => d.severity === 'warn');
const infos = diagnostics.filter(d => d.severity === 'info');
const fmt = (d: Diagnostic) => `  [${d.code}] ${d.scope}: ${d.message}${d.hint ? `\n      -> ${d.hint}` : ''}`;
if (errors.length) { console.error(`\n[processes] ${errors.length} ERROR(es):`); errors.forEach(d => console.error(fmt(d))); }
if (warns.length) { console.warn(`\n[processes] ${warns.length} ADVERTENCIA(s):`); warns.forEach(d => console.warn(fmt(d))); }
if (infos.length) { console.log(`\n[processes] ${infos.length} nota(s) informativa(s):`); infos.forEach(d => console.log(fmt(d))); }
if (errors.length > 0) { await client.end(); process.exit(1); }
console.log(`\n[processes] ${Object.keys(blueprint.processes).length} proceso(s) validados: ${errors.length} error, ${warns.length} warn, ${infos.length} info.`);

if (!blueprint.schema_hash) {
const catalog = Object.keys(blueprint.functions).sort().map(k => k + ':' + blueprint.functions[k].source_sql).join('\n');
const tablesCatalog = JSON.stringify(blueprint.tables);
blueprint.schema_hash = crypto.createHash('sha256').update(catalog + tablesCatalog).digest('hex');
}

// processes_hash: detecta drift de la capa declarativa + state machines + queues
const processesCatalog = JSON.stringify(blueprint.processes) + JSON.stringify(blueprint.state_machines) + JSON.stringify(blueprint.queues);
blueprint.processes_hash = crypto.createHash('sha256').update(processesCatalog).digest('hex');

const outJsonPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
fs.writeFileSync(outJsonPath, JSON.stringify(blueprint, null, 2));
console.log(`Guardado JSON en: ${outJsonPath}`);

let md = `<!-- GENERADO AUTOMATICAMENTE - NO EDITAR A MANO -->\n`;
md += `<!-- Fuente: docs/db_flow_blueprint.json | Contenido curado/politicas: docs/POLITICAS_FRONTEND.md -->\n\n`;
md += `# DB Flow Blueprint & System Diagnostics\n\n`;
md += `- **Generado:** \`${blueprint.generated_at}\` (snapshot; datos de runtime caducan en 26h. Verificar en vivo: node scripts/live_audit.js)\n`;
md += `- **Schema hash:** \`${blueprint.schema_hash}\`\n`;
md += `- **Processes hash:** \`${blueprint.processes_hash}\`\n`;
md += `- **Tables:** ${Object.keys(blueprint.tables).length} | **Triggers:** ${blueprint.triggers.length} | **Cron jobs:** ${blueprint.cron_jobs.length} | **Edge fns:** ${blueprint.edge_functions.length} | **Queues:** ${Object.keys(blueprint.queues).length}\n\n`;

if (tsResult.dataLineage && tsResult.dataLineage['mapeo_frontend']) {
md += `## 📊 Linaje de Datos (Excel -> BD)\n\n`;
md += `Columnas extraídas en Frontend / Edge:\n`;
tsResult.dataLineage['mapeo_frontend'].forEach(col => {
    md += `- \`${col}\`\n`;
});
md += `\n`;
}

if (Object.keys(blueprint.state_machines).length > 0) {
md += `## Maquinas de estado\n\n`;
for (const [smName, sm] of Object.entries(blueprint.state_machines)) {
md += `### ${smName} (enum \`${sm.enum_type}\`)\n`;
md += `- **Estados:** ${sm.states.join(', ')}\n`;
if (sm.recovery_from.length > 0) md += `- **Recuperacion desde error ->** ${sm.recovery_from.join(', ')}\n`;
md += `- **Transiciones:**\n`;
Object.entries(sm.transitions).forEach(([desde, hasta]) => {
md += ` - \`${desde}\` -> ${hasta.join(', ')}\n`;
});
md += '\n';
}
}

if (Object.keys(blueprint.queues).length > 0) {
md += `## Colas (jobs)\n\n`;
md += `> Conteos del snapshot \`${blueprint.generated_at}\`. NO es estado en vivo; los 'failed' son acumulado historico (nunca se purgan). Verificar en vivo: \`node scripts/live_audit.js\`.\n\n`;
for (const [qName, q] of Object.entries(blueprint.queues)) {
const counts = Object.entries(q.status_counts).map(([s, n]) => `${s}=${n}`).join(', ');
md += `### ${qName}\n`;
md += `- **Total:** ${q.total} (${counts})\n`;
if (q.pending > 0) md += `- **Pendientes:** ${q.pending}\n`;
if (q.failed > 0) md += `- **WARNING - Fallidos (acumulado historico):** ${q.failed} | **Fallidos ultimas 24h:** ${q.failed_24h ?? 0}\n`;
if (q.producers.length > 0) md += `- **Productores:** ${q.producers.join(', ')}\n`;
md += '\n';
}
}

if (Object.keys(pipelineRoutes).length > 0) {
    md += `## Rutas de pricing (estado)\n\n`;
    for (const [name, r] of Object.entries<any>(pipelineRoutes)) {
        md += `### ${name} — **${(r.status || 'unknown').toUpperCase()}**\n\n`;
        if (r.description) md += `${r.description}\n\n`;
        if (r.path) md += `- Path: \`${r.path}\`\n`;
        if (r.producer) md += `- Producer: \`${r.producer}\`\n`;
        if (r.consumer) md += `- Consumer: \`${r.consumer}\`\n`;
        if (r.notes) md += `- Notes: ${r.notes}\n`;
        md += `\n`;
    }
}

if (blueprint.diagnostics.length > 0) {
    md += `## Diagnosticos\n\n`;
    const grouped = {
        error: blueprint.diagnostics.filter(d => d.severity === 'error'),
        warn:  blueprint.diagnostics.filter(d => d.severity === 'warn'),
        info:  blueprint.diagnostics.filter(d => d.severity === 'info'),
    };
    for (const sev of ['error', 'warn', 'info'] as const) {
        const items = grouped[sev];
        if (!items.length) continue;
        md += `### ${sev.toUpperCase()}\n\n`;
        for (const d of items) {
            md += `- [${d.code}] \`${d.scope}\`: ${d.message}`;
            if (d.hint) md += ` — ${d.hint}`;
            md += `\n`;
        }
        md += `\n`;
    }
}

if (Object.keys(blueprint.processes || {}).length > 0) {
    md += `## Procesos declarados\n\n`;
    for (const [procName, proc] of Object.entries<any>(blueprint.processes)) {
        md += `### ${procName}\n\n`;
        if (proc.trigger) md += `- Trigger: \`${proc.trigger}\`\n`;
        if (Array.isArray(proc.steps) && proc.steps.length) {
            md += `- Steps:\n`;
            for (const s of proc.steps) {
                const bits = [];
                if (s.fn) bits.push(`fn=\`${s.fn}\``);
                if (s.estado) bits.push(`estado=\`${s.estado}\``);
                if (s.tabla_destino) bits.push(`tabla_destino=\`${s.tabla_destino}\``);
                if (s.destino) bits.push(`destino=\`${s.destino}\``);
                md += `  - ${bits.join(' | ')}\n`;
            }
        }
        if (Array.isArray(proc.downstream) && proc.downstream.length) {
            md += `- Downstream:\n`;
            for (const d of proc.downstream) {
                if (d.trigger) {
                    md += `  - trigger=\`${d.trigger}\`${d.tabla ? ` | tabla=\`${d.tabla}\`` : ''}\n`;
                    continue;
                }
                if (d.fn) {
                    md += `  - fn=\`${d.fn}\`${d.destino ? ` | destino=\`${d.destino}\`` : ''}\n`;
                    continue;
                }
                if (d.job) {
                    const handlers = blueprint.job_handlers?.[d.job] || [];
                    const handlerText = handlers.length ? handlers.map(h => `\`${h}\``).join(', ') : '`no detectado`';
                    md += `  - job=\`${d.job}\` | handler=${handlerText} | expect_runtime=\`${d.expect_runtime !== false}\``;
                    if (d.blocked_by) md += ` | blocked_by=\`${d.blocked_by}\``;
                    md += `\n`;
                }
            }
        }
        if (proc.recovery) {
            md += `- Recovery: desde \`${proc.recovery.desde}\``;
            if (Array.isArray(proc.recovery.rutas)) {
                md += ` -> [${proc.recovery.rutas.map((r: string) => `\`${r}\``).join(', ')}]`;
            }
            md += `\n`;
        }
        md += `\n`;
    }
}

const diagCounts = {
  error: blueprint.diagnostics.filter(d => d.severity === 'error').length,
  warn: blueprint.diagnostics.filter(d => d.severity === 'warn').length,
  info: blueprint.diagnostics.filter(d => d.severity === 'info').length,
};

md += `## Salud del blueprint\n\n`;
md += `- Procesos declarados: ${Object.keys(blueprint.processes || {}).length}\n`;
md += `- Handlers de jobs detectados en worker: ${Object.keys(blueprint.job_handlers || {}).length}\n`;
md += `- Diagnosticos error: ${diagCounts.error}\n`;
md += `- Diagnosticos warn: ${diagCounts.warn}\n`;
md += `- Diagnosticos info: ${diagCounts.info}\n\n`;

for (const [funcName, data] of Object.entries(blueprint.functions)) {
md += `## ${funcName}\n`;
md += `- **Security:** ${data.security}\n`;
md += `- **Timeout Override:** ${data.statement_timeout_override || 'None'}\n`;
md += `- **Avg Time:** ${data.avg_time_ms ? (data.timing_source === 'ast_estimator' ? `~${Math.round(data.avg_time_ms)} ms (estimado)` : `${data.avg_time_ms.toFixed(2)} ms`) : 'Unknown'} (source: ${data.timing_source})\n`;
if (data.dynamic_sql) md += `- WARNING: **Dynamic SQL Detected**\n`;
if (data.calls_tables.length > 0) md += `- **Touches Tables:** ${data.calls_tables.join(', ')}\n`;
if (data.calls_functions.length > 0) md += `- **Calls Functions:** ${data.calls_functions.join(', ')}\n`;
if (data.triggers_cascade.length > 0) {
md += `- **Cascading Triggers:**\n`;
data.triggers_cascade.forEach(tc => {
md += ` - \`${tc.table}\` -> \`${tc.target_function}\` (Trigger: ${tc.trigger})\n`;
});
}
md += '\n';
}

const outMdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
fs.writeFileSync(outMdPath, md);
console.log(`Guardado MD en: ${outMdPath}`);

await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
