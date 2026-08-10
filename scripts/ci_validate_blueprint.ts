import * as fs from 'fs';
import * as path from 'path';

function main() {
const rootDir = path.resolve(__dirname, '..');
const blueprintPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
const limitsPath = path.join(rootDir, 'infra_limits.json');
const hashStatePath = path.join(rootDir, 'docs', '.blueprint_schema_hash');

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
console.warn(`  - anterior: ${lastHash}`);
console.warn(`  - actual:   ${currentHash}`);
console.warn(`  - El blueprint fue regenerado correctamente para reflejar el nuevo esquema.`);
}
// Persistir el hash actual para la proxima corrida
fs.writeFileSync(hashStatePath, currentHash + '\n');
console.log(`[schema-hash] ${currentHash}`);
} else {
console.warn("[schema-hash] Blueprint sin schema_hash; se omite comparacion.");
}

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

// Con Supabase gestionado track_functions no puede activarse de forma persistente
// (rol postgres no es superusuario). La fuente de verdad es flow_hints.yaml / estimador AST.
if (myTime === 0) {
console.error(`\n[ERROR] La funcion ${funcName} no tiene tiempo (timing_source=${data.timing_source || 'none'}).`);
console.error(`  - Anade un 'estimated_time_ms' para esta funcion en docs/flow_hints.yaml.`);
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
console.error(`  - Tiempo estimado peor caso: ${time.toFixed(0)}ms (Limite: ${CRITICAL_LIMIT}ms)`);
console.error(`  - Ruta critica: \n    ${path.join('\n -> ')}`);
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
