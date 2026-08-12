import { Client } from 'pg';
import { parse, astVisitor } from 'pgsql-ast-parser';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';
import * as crypto from 'crypto';

// Tipos
interface FlowHint {
estimated_time_ms?: number;
affects_tables?: string[];
calls_functions?: string[];
}

type TimingSource = 'live_stats' | 'pg_stat_statements' | 'yaml_hint' | 'ast_estimator' | 'none';

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
if (fs.existsSync(hintsPath)) {
const parsedHints = yaml.parse(fs.readFileSync(hintsPath, 'utf8'));
if (parsedHints && parsedHints.hints) { hints = parsedHints.hints; }
if (parsedHints && parsedHints.processes) { declaredProcesses = parsedHints.processes; }
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
WHERE n.nspname = 'public' AND c.relkind = 'r'
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
// Productores: funciones/triggers cuyo prosrc inserta en la cola jobs.
// Se intenta asociar por tipo si el prosrc menciona el literal del tipo; si no, se marca como productor generico.
const producerRows = funcsRes.rows.filter((f: any) => /INSERT\s+INTO\s+(?:public\.)?jobs\b/i.test(f.prosrc || ''));
for (const row of jobsRes.rows) {
const t = row.type as string;
if (!queues[t]) {
queues[t] = { type: t, status_counts: {}, total: 0, pending: 0, failed: 0, producers: [] };
}
queues[t].status_counts[row.status] = row.n;
queues[t].total += row.n;
if (row.status === 'pending') queues[t].pending += row.n;
if (row.status === 'failed') queues[t].failed += row.n;
}
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
processes: {}
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

if (!avg_time_ms && hints[fullFuncName]?.estimated_time_ms) {
avg_time_ms = hints[fullFuncName].estimated_time_ms!;
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
timing_source
};
}

// === Construccion + validacion cruzada de PROCESOS (capa declarativa) ===
const validationErrors: string[] = [];
const smStates = new Set<string>(state_machines['importacion']?.states || []);
for (const [procName, proc] of Object.entries(declaredProcesses)) {
const steps = Array.isArray(proc.steps) ? proc.steps : [];
for (const step of steps) {
if (step.fn && !blueprint.functions[step.fn]) {
validationErrors.push(`[processes.${procName}] funcion inexistente en la BD: ${step.fn}`);
}
if (step.estado && smStates.size > 0 && !smStates.has(step.estado)) {
validationErrors.push(`[processes.${procName}] estado inexistente en enum estado_importacion_excel: ${step.estado}`);
}
}
if (proc.recovery && proc.recovery.rutas && smStates.size > 0) {
(proc.recovery.rutas as string[]).forEach(r => {
if (!smStates.has(r)) validationErrors.push(`[processes.${procName}.recovery] estado de recuperacion inexistente: ${r}`);
});
}
// Validar que las colas referenciadas en downstream existan en la introspeccion de queues
if (Array.isArray(proc.downstream)) {
proc.downstream.forEach((d: any) => {
if (d && d.job && !queues[d.job]) {
validationErrors.push(`[processes.${procName}.downstream] cola inexistente en public.jobs: ${d.job}`);
}
});
}
blueprint.processes[procName] = proc;
}

if (validationErrors.length > 0) {
console.error("\n[processes] Validacion cruzada FALLIDA. El blueprint de procesos esta desincronizado con la BD:");
validationErrors.forEach(e => console.error(" - " + e));
await client.end();
process.exit(1);
}
console.log(`[processes] ${Object.keys(blueprint.processes).length} proceso(s) validado(s) contra funciones, estados y colas de la BD.`);

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

let md = `# DB Flow Blueprint\n\n`;
md += `- **Schema hash:** \`${blueprint.schema_hash}\`\n`;
md += `- **Processes hash:** \`${blueprint.processes_hash}\`\n`;
md += `- **Tables:** ${Object.keys(blueprint.tables).length} | **Triggers:** ${blueprint.triggers.length} | **Cron jobs:** ${blueprint.cron_jobs.length} | **Edge fns:** ${blueprint.edge_functions.length} | **Queues:** ${Object.keys(blueprint.queues).length}\n\n`;

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
for (const [qName, q] of Object.entries(blueprint.queues)) {
const counts = Object.entries(q.status_counts).map(([s, n]) => `${s}=${n}`).join(', ');
md += `### ${qName}\n`;
md += `- **Total:** ${q.total} (${counts})\n`;
if (q.pending > 0) md += `- **Pendientes:** ${q.pending}\n`;
if (q.failed > 0) md += `- **WARNING - Fallidos:** ${q.failed}\n`;
if (q.producers.length > 0) md += `- **Productores:** ${q.producers.join(', ')}\n`;
md += '\n';
}
}

if (Object.keys(blueprint.processes).length > 0) {
md += `## Procesos (pipelines)\n\n`;
for (const [procName, proc] of Object.entries(blueprint.processes)) {
md += `### ${procName}\n`;
if (proc.descripcion) md += `- ${proc.descripcion}\n`;
if (proc.trigger) md += `- **Trigger:** ${proc.trigger}\n`;
if (proc.state_machine) md += `- **State machine:** ${proc.state_machine}\n`;
md += `- **Pasos:**\n`;
(proc.steps || []).forEach((s, i) => {
const extra = s.estado ? ` (estado: ${s.estado})` : (s.tabla_destino ? ` (-> ${s.tabla_destino})` : '');
md += ` ${i + 1}. \`${s.fn}\`${extra}\n`;
});
if (proc.downstream && proc.downstream.length > 0) {
md += `- **Downstream (fronteras externas):**\n`;
proc.downstream.forEach((d: any) => {
const label = d.trigger ? `trigger ${d.trigger}` : (d.job ? `job ${d.job}` : (d.fn ? `fn ${d.fn}` : JSON.stringify(d)));
const target = d.consumidor ? ` -> ${d.consumidor}` : (d.destino ? ` -> ${d.destino}` : (d.tabla ? ` (${d.tabla})` : ''));
md += ` - ${label}${target}\n`;
});
}
if (proc.recovery) {
md += `- **Recuperacion:** desde \`${proc.recovery.desde}\` -> ${(proc.recovery.rutas || []).join(', ')}\n`;
}
md += '\n';
}
}

for (const [funcName, data] of Object.entries(blueprint.functions)) {
md += `## ${funcName}\n`;
md += `- **Security:** ${data.security}\n`;
md += `- **Timeout Override:** ${data.statement_timeout_override || 'None'}\n`;
md += `- **Avg Time:** ${data.avg_time_ms ? data.avg_time_ms.toFixed(2) + ' ms' : 'Unknown'} (source: ${data.timing_source})\n`;
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
