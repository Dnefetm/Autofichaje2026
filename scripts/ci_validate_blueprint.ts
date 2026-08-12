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

// --- Validacion cruzada de PROCESOS: cada fn debe existir; cada estado debe existir en la state machine ---
const processes = blueprint.processes || {};
const functions = blueprint.functions || {};
const smStates = new Set<string>((blueprint.state_machines?.importacion?.states) || []);
const procErrors: string[] = [];
for (const procName of Object.keys(processes)) {
const proc = processes[procName] || {};
const steps = Array.isArray(proc.steps) ? proc.steps : [];
for (const step of steps) {
if (step.fn && !functions[step.fn]) {
procErrors.push(`[processes.${procName}] funcion inexistente en el blueprint: ${step.fn}`);
}
if (step.estado && smStates.size > 0 && !smStates.has(step.estado)) {
procErrors.push(`[processes.${procName}] estado inexistente en la state machine: ${step.estado}`);
}
}
if (proc.recovery?.rutas && smStates.size > 0) {
(proc.recovery.rutas as string[]).forEach(r => {
if (!smStates.has(r)) procErrors.push(`[processes.${procName}.recovery] estado de recuperacion inexistente: ${r}`);
});
}
}
if (procErrors.length > 0) {
console.error("\n[processes] Validacion cruzada FALLIDA. La capa declarativa esta desincronizada con la BD:");
procErrors.forEach(e => console.error("  - " + e));
process.exit(1);
}
console.log(`[processes] ${Object.keys(processes).length} proceso(s) OK contra ${Object.keys(functions).length} funciones y ${smStates.size} estados.`);

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
console.log("\nValidacion exitosa. Ningun flujo rompe los limites conocidos.");
process.exit(0);
}
}

main();
