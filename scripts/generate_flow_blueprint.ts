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

interface Blueprint {
generated_at: string;
schema_hash: string | null;
roles: Record<string, any>;
external_limits: Record<string, number>;
functions: Record<string, BlueprintNode>;
tables: Record<string, any>;
triggers: any[];
cron_jobs: any[];
edge_functions: any[];
}

// Deduplica preservando orden
function dedup(arr: string[]): string[] {
return Array.from(new Set(arr));
}

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

// Roles config
const rolesRes = await client.query(`SELECT rolname, rolconfig FROM pg_roles WHERE rolname IN ('authenticated', 'anon', 'service_role')`);
const roles: Record<string, any> = {};
rolesRes.rows.forEach(r => { roles[r.rolname] = r.rolconfig; });

// Schema hash (usa fn_schema_hash si existe; fallback a hash local del catalogo)
let schema_hash: string | null = null;
try {
const hashRes = await client.query(`SELECT public.fn_schema_hash() AS h`);
schema_hash = hashRes.rows[0]?.h ?? null;
} catch (e) {
console.warn("[schema_hash] fn_schema_hash() no disponible, se calculara localmente.");
}

// Funciones (filtrando objetos de extension deptype='e')
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

// Triggers
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

// Tablas (columnas + rls)
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
tablesRes.rows.forEach(t => {
tables[`public.${t.table_name}`] = { rls_enabled: t.rls_enabled, columns: t.columns };
});

// Triggers (lista global deduplicada)
const triggers = triggersRes.rows.map(t => ({
trigger: t.tgname,
table: `public.${t.table_name}`,
target_function: `${t.target_schema}.${t.target_function}`
}));

// Cron jobs (pg_cron, si esta instalado)
let cron_jobs: any[] = [];
try {
const cronRes = await client.query(`SELECT jobid, schedule, command, active FROM cron.job`);
cron_jobs = cronRes.rows;
} catch(e) { console.warn("[cron] pg_cron no disponible o sin permisos."); }

// Edge functions (desde supabase/functions/*)
let edge_functions: any[] = [];
const edgeDir = path.join(rootDir, 'supabase', 'functions');
if (fs.existsSync(edgeDir)) {
edge_functions = fs.readdirSync(edgeDir, { withFileTypes: true })
.filter(d => d.isDirectory() && !d.name.startsWith('_'))
.map(d => ({ name: d.name, path: `supabase/functions/${d.name}` }));
}

const blueprint: Blueprint = {
generated_at: new Date().toISOString(),
schema_hash,
roles,
external_limits,
functions: {},
tables,
triggers,
cron_jobs,
edge_functions
};

const knownFunctions = new Set(funcsRes.rows.map(row => row.proname));

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

// Timings + timing_source (prioridad: live_stats > pg_stat_statements > yaml_hint > ast_estimator)
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

// Deteccion de llamadas a funciones de usuario
const allFuncCallsMatches = [...source.matchAll(/\b(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi)].map(m => m[1]);
allFuncCallsMatches.forEach(fn => { if (knownFunctions.has(fn)) calls_functions.add(`public.${fn}`); });

const insertMatches = [...source.matchAll(/INSERT\s+INTO\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
const updateMatches = [...source.matchAll(/UPDATE\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
const deleteMatches = [...source.matchAll(/DELETE\s+FROM\s+(?:public\.)?([a-zA-Z0-9_]+)/gi)].map(m => m[1]);
insertMatches.concat(updateMatches, deleteMatches).forEach(t => calls_tables.add(`public.${t}`));

// AST Complexity Estimator (fallback cuando no hay stats ni hints)
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

// Cascade de triggers sobre tablas tocadas
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

// Fallback local de schema_hash si la funcion SQL no existe
if (!blueprint.schema_hash) {
const catalog = Object.keys(blueprint.functions).sort().map(k => k + ':' + blueprint.functions[k].source_sql).join('\n');
const tablesCatalog = JSON.stringify(blueprint.tables);
blueprint.schema_hash = crypto.createHash('sha256').update(catalog + tablesCatalog).digest('hex');
}

// Escribir JSON
const outJsonPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
fs.writeFileSync(outJsonPath, JSON.stringify(blueprint, null, 2));
console.log(`Guardado JSON en: ${outJsonPath}`);

// Markdown resumen
let md = `# DB Flow Blueprint\n\n`;
md += `- **Schema hash:** \`${blueprint.schema_hash}\`\n`;
md += `- **Tables:** ${Object.keys(blueprint.tables).length} | **Triggers:** ${blueprint.triggers.length} | **Cron jobs:** ${blueprint.cron_jobs.length} | **Edge fns:** ${blueprint.edge_functions.length}\n\n`;
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
data.triggers_cascade.forEach(tc => { md += `  - \`${tc.table}\` -> \`${tc.target_function}\` (Trigger: ${tc.trigger})\n`; });
}
md += '\n';
}
const outMdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
fs.writeFileSync(outMdPath, md);
console.log(`Guardado MD en: ${outMdPath}`);

await client.end();
}

main().catch(err => { console.error(err); process.exit(1); });
