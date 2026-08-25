import * as fs from 'fs';
import * as path from 'path';

function main() {
const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
const limitsPath = path.join(rootDir, 'infra_limits.json');
const hashStatePath = path.join(rootDir, 'docs', '.blueprint_schema_hash');
const procHashStatePath = path.join(rootDir, 'docs', '.blueprint_processes_hash');

if (!fs.existsSync(blueprintPath)) {
console.error("Blueprint no encontrado. Ejecuta generate_flow_blueprint.ts primero.");
process.exit(1);
}

const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
const limits = fs.existsSync(limitsPath) ? JSON.parse(fs.readFileSync(limitsPath, 'utf8')) : {};

// --- Identidad de la BD de origen (Fase 4, 2026-08-25) ---
// El artefacto debe declarar de que BD salio y debe coincidir con la esperada.
// Sin esto, un "CI verde" puede describir una base que NO es produccion.
const yaml = require('yaml');
const hintsForIdentityPath = path.join(rootDir, 'docs', 'flow_hints.yaml');
let expectedDbRef: string | null = null;
if (fs.existsSync(hintsForIdentityPath)) {
const parsedHints = yaml.parse(fs.readFileSync(hintsForIdentityPath, 'utf8'));
if (parsedHints && parsedHints.expected_db_project_ref) expectedDbRef = String(parsedHints.expected_db_project_ref);
}
const srcDb = blueprint.source_db;
if (!srcDb || !srcDb.project_ref) {
console.error("[DB-IDENTITY] El blueprint no declara su BD de origen (source_db). Artefacto viejo o corrupto: regenera con generate_flow_blueprint.ts.");
process.exit(1);
}
if (expectedDbRef && srcDb.project_ref !== expectedDbRef) {
console.error(`[DB-IDENTITY] El blueprint se extrajo del proyecto '${srcDb.project_ref}' (${srcDb.host}) pero se esperaba '${expectedDbRef}'.`);
console.error(" - Causa probable: el secret SUPABASE_DB_URL apunta a OTRA base de datos.");
console.error(" - Este blueprint NO describe tu produccion. Corrige el secret y regenera.");
process.exit(1);
}
console.log(`[db-identity] Artefacto extraido de '${srcDb.project_ref}' (${srcDb.host}) — coincide con expected_db_project_ref.`);

// --- Guardia de obsolescencia (Fase 1, 2026-08-23) ---
// Un blueprint con mas de 26h ya no es verdad vigente: los datos de runtime
// (colas, tiempos) son un snapshot viejo. Mejor fallar que diagnosticar con mentiras.
const STALE_LIMIT_MS = 26 * 60 * 60 * 1000;
const genAtMs = Date.parse(blueprint.generated_at || '');
if (Number.isNaN(genAtMs)) {
console.error("[STALE_BLUEPRINT] El blueprint no tiene generated_at valido. Regenera con generate_flow_blueprint.ts.");
process.exit(1);
}
const ageH = (Date.now() - genAtMs) / 3600000;
if (Date.now() - genAtMs > STALE_LIMIT_MS) {
console.error(`[STALE_BLUEPRINT] El blueprint tiene ${ageH.toFixed(1)}h de antiguedad (limite: 26h).`);
console.error(" - Los conteos de colas y tiempos son un snapshot viejo, NO el estado actual.");
console.error(" - Regenera: npx tsx scripts/generate_flow_blueprint.ts | En vivo: node scripts/live_audit.js");
process.exit(1);
}
console.log(`[stale-guard] Blueprint fresco (${ageH.toFixed(1)}h de antiguedad, limite 26h).`);

// --- Integridad del artefacto .md (Fase 3.14, 2026-08-25) ---
// El md es 100% generado: debe ser UTF-8 puro, llevar el encabezado GENERADO
// y estar sincronizado con el JSON (mismo generated_at). Una edicion manual
// (ej. Add-Content de PowerShell) corrompe la codificacion o desincroniza.
const mdPath = path.join(rootDir, 'docs', 'db_flow_blueprint.md');
if (!fs.existsSync(mdPath)) {
console.error("[MD_INTEGRITY] Falta docs/db_flow_blueprint.md. Regenera con generate_flow_blueprint.ts.");
process.exit(1);
}
const mdBuf = fs.readFileSync(mdPath);
try {
new TextDecoder('utf-8', { fatal: true }).decode(mdBuf);
} catch (e) {
console.error("[MD_INTEGRITY] db_flow_blueprint.md NO es UTF-8 valido (posible corrupcion por edicion manual/PowerShell).");
console.error(" - Reparar: node scripts/fase0_reparar_blueprint.py o regenerar con el CI.");
process.exit(1);
}
const mdText = mdBuf.toString('utf8');
if (!mdText.includes('GENERADO AUTOMATICAMENTE - NO EDITAR A MANO')) {
console.error("[MD_INTEGRITY] db_flow_blueprint.md no tiene el encabezado GENERADO; pudo ser editado a mano o reemplazado.");
process.exit(1);
}
if (blueprint.generated_at && !mdText.includes(blueprint.generated_at)) {
console.error("[MD_INTEGRITY] El md y el JSON estan desincronizados (generated_at distinto). Regenera ambos.");
process.exit(1);
}
console.log("[md-integrity] db_flow_blueprint.md integro: UTF-8 valido, encabezado presente, sincronizado con JSON.");

// --- Comprobacion de schema_hash (detecta obsolescencia) ---
const currentHash: string | null = blueprint.schema_hash || null;
if (currentHash) {
let lastHash: string | null = null;
if (fs.existsSync(hashStatePath)) {
lastHash = fs.readFileSync(hashStatePath, 'utf8').trim();
}
if (lastHash && lastHash !== currentHash) {
console.warn(`\n[schema-hash] El esquema cambio desde la ultima ejecucion.`);
console.warn(` - anterior: ${lastHash}`);
console.warn(` - actual:   ${currentHash}`);
console.warn(` - El blueprint fue regenerado correctamente para reflejar el nuevo esquema.`);
}
fs.writeFileSync(hashStatePath, currentHash + '\n');
console.log(`[schema-hash] ${currentHash}`);
} else {
console.warn("[schema-hash] Blueprint sin schema_hash; se omite comparacion.");
}

// --- Comprobacion de processes_hash (detecta drift de la capa declarativa) ---
const currentProcHash: string | null = blueprint.processes_hash || null;
if (currentProcHash) {
let lastProcHash: string | null = null;
if (fs.existsSync(procHashStatePath)) {
lastProcHash = fs.readFileSync(procHashStatePath, 'utf8').trim();
}
if (lastProcHash && lastProcHash !== currentProcHash) {
console.warn(`\n[processes-hash] La capa de procesos/state-machines cambio desde la ultima ejecucion.`);
console.warn(` - anterior: ${lastProcHash}`);
console.warn(` - actual:   ${currentProcHash}`);
}
fs.writeFileSync(procHashStatePath, currentProcHash + '\n');
console.log(`[processes-hash] ${currentProcHash}`);
} else {
console.warn("[processes-hash] Blueprint sin processes_hash; se omite comparacion.");
}

// --- Analisis de diagnosticos emitidos por el motor LDFB ---
const diagnostics = blueprint.diagnostics || [];
const errors = diagnostics.filter((d: any) => d.severity === 'error');
const warns = diagnostics.filter((d: any) => d.severity === 'warn');
const infos = diagnostics.filter((d: any) => d.severity === 'info');
const fmt = (d: any) => `  [${d.code}] ${d.scope}: ${d.message}`;

if (errors.length > 0) {
    console.error(`\n[ci-validator] Validacion cruzada FALLIDA. Se detectaron ${errors.length} errores estructurales:`);
    errors.forEach((e: any) => console.error(fmt(e)));
    process.exit(1);
}
if (warns.length > 0) {
    console.warn(`\n[ci-validator] ADVERTENCIAS (${warns.length}):`);
    warns.forEach((w: any) => console.warn(fmt(w)));
}
console.log(`[ci-validator] Capa declarativa OK. (0 errores, ${warns.length} warns, ${infos.length} infos).`);

// Limits
const ROLE_LIMIT_MS = blueprint.roles?.authenticated?.statement_timeout_ms || 8000;
const API_LIMIT_MS = limits.api_gateway_timeout_ms || blueprint.external_limits?.api_gateway_timeout_ms || 15000;
const CRITICAL_LIMIT = Math.min(ROLE_LIMIT_MS, API_LIMIT_MS);
console.log(`Validando contra limites: Rol (${ROLE_LIMIT_MS}ms) / API Gateway (${API_LIMIT_MS}ms). Limite estricto: ${CRITICAL_LIMIT}ms`);

let hasErrors = false;

// DFS para buscar la peor ruta
function evaluateWorstPath(funcName: string, visited: Set<string>, depth: number): { time: number, path: string[] } {
if (visited.has(funcName)) {
console.warn(`[WARN] Ciclo detectado en ${funcName}. Abortando rama.`);
return { time: 0, path: [funcName + ' (CYCLE)'] };
}
const data = blueprint.functions[funcName];
if (!data) return { time: 0, path: [funcName + ' (NOT FOUND)'] };
visited.add(funcName);
const myTime = (data.p95_time_ms || data.avg_time_ms || 0);
if (myTime === 0) {
console.error(`\n[ERROR] La funcion ${funcName} no tiene tiempo (timing_source=${data.timing_source || 'none'}).`);
console.error(` - Anade un 'estimated_time_ms' para esta funcion en docs/flow_hints.yaml.`);
process.exit(1);
}
let worstChildTime = 0;
let worstChildPath: string[] = [];
for (const childFunc of data.calls_functions || []) {
const childRes = evaluateWorstPath(childFunc, new Set(visited), depth + 1);
if (childRes.time > worstChildTime) { worstChildTime = childRes.time; worstChildPath = childRes.path; }
}
for (const trigger of data.triggers_cascade || []) {
const childRes = evaluateWorstPath(trigger.target_function, new Set(visited), depth + 1);
if (childRes.time > worstChildTime) { worstChildTime = childRes.time; worstChildPath = childRes.path; }
}
return { time: myTime + worstChildTime, path: [funcName, ...worstChildPath] };
}

// Reporte de cobertura de timing_source
const sourceCounts: Record<string, number> = {};
for (const fn of Object.keys(blueprint.functions)) {
const src = blueprint.functions[fn].timing_source || 'none';
sourceCounts[src] = (sourceCounts[src] || 0) + 1;
}
console.log('[timing-source] ' + JSON.stringify(sourceCounts));

// Validar todas las funciones
for (const funcName of Object.keys(blueprint.functions)) {
const { time, path } = evaluateWorstPath(funcName, new Set(), 0);
if (time > CRITICAL_LIMIT) {
hasErrors = true;
console.error(`\n[ERROR CRITICO] La funcion ${funcName} rompe los limites de ejecucion.`);
console.error(` - Tiempo estimado peor caso: ${time.toFixed(0)}ms (Limite: ${CRITICAL_LIMIT}ms)`);
console.error(` - Ruta critica: \n   ${path.join('\n   -> ')}`);
} else if (time > CRITICAL_LIMIT * 0.75) {
console.warn(`\n[WARNING] La funcion ${funcName} esta al ${((time/CRITICAL_LIMIT)*100).toFixed(0)}% del limite.`);
}
}

if (hasErrors) {
console.error("\nValidacion fallida. Hay funciones que superaran los timeouts del rol o Gateway.");
process.exit(1);
} else {
console.log("\nValidacion exitosa de tiempos de ejecucion. Ningun flujo rompe los limites conocidos.");
}

console.log(`\n[ci-validator] Iniciando validacion de codigo fuente (Frontend y Worker)...`);
try {
  const { execSync } = require('child_process');
  
  console.log(`[ci-validator] Typechecking apps/dashboard...`);
  execSync('npx tsc --noEmit', { stdio: 'inherit', cwd: path.join(rootDir, 'apps', 'dashboard') });
  
  console.log(`[ci-validator] Typechecking apps/worker...`);
  execSync('npx tsc --noEmit', { stdio: 'inherit', cwd: path.join(rootDir, 'apps', 'worker') });
  
  console.log(`\n[ci-validator] Typecheck del monorepo EXITOSO. El proyecto esta listo para Vercel.`);
  process.exit(0);
} catch (error) {
  console.error(`\n[ERROR CRITICO] Fallo la compilacion del codigo fuente. Vercel rechazara este build.`);
  process.exit(1);
}
}

main();
