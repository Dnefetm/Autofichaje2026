import * as fs from 'fs';
import * as path from 'path';

function main() {
    const rootDir = path.resolve(__dirname, '..');
    const blueprintPath = path.join(rootDir, 'docs', 'db_flow_blueprint.json');
    const limitsPath = path.join(rootDir, 'infra_limits.json');

    if (!fs.existsSync(blueprintPath)) {
        console.error("Blueprint no encontrado. Ejecuta generate_flow_blueprint.ts primero.");
        process.exit(1);
    }

    const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
    const limits = fs.existsSync(limitsPath) ? JSON.parse(fs.readFileSync(limitsPath, 'utf8')) : {};
    
    // Limits
    const ROLE_LIMIT_MS = blueprint.roles?.authenticated?.statement_timeout_ms || 8000;
    const API_LIMIT_MS = limits.api_gateway_timeout_ms || 15000;
    const CRITICAL_LIMIT = Math.min(ROLE_LIMIT_MS, API_LIMIT_MS);

    console.log(`Validando contra límites: Rol (${ROLE_LIMIT_MS}ms) / API Gateway (${API_LIMIT_MS}ms). Límite estricto: ${CRITICAL_LIMIT}ms`);

    let hasErrors = false;

    // DFS para buscar la peor ruta
    function evaluateWorstPath(funcName: string, visited: Set<string>, depth: number): { time: number, path: string[] } {
        if (visited.has(funcName)) {
            // Ciclo detectado
            console.warn(`[WARN] Ciclo detectado en ${funcName}. Abortando rama.`);
            return { time: 0, path: [funcName + ' (CYCLE)'] };
        }

        const data = blueprint.functions[funcName];
        if (!data) return { time: 0, path: [funcName + ' (NOT FOUND)'] };

        visited.add(funcName);

        // Mi tiempo base
        const myTime = (data.p95_time_ms || data.avg_time_ms || 0);
        
        if (myTime === 0) {
            console.error(`\n❌ [ERROR CRÍTICO] La función ${funcName} no tiene métricas de tiempo (pg_stat_user_functions vacío) ni estimación manual en flow_hints.yaml.`);
            console.error(`  - El sistema no puede calcular la ruta crítica con latencia 0. Esto invalidaría la prueba matemática.`);
            console.error(`  - Acción Requerida: Habilita 'track_functions = pl' en Supabase, o añade un 'estimated_time_ms' para esta función en docs/flow_hints.yaml.`);
            process.exit(1);
        }

        let worstChildTime = 0;
        let worstChildPath: string[] = [];

        // Evaluar llamadas a otras funciones
        for (const childFunc of data.calls_functions || []) {
            const childRes = evaluateWorstPath(childFunc, new Set(visited), depth + 1);
            if (childRes.time > worstChildTime) {
                worstChildTime = childRes.time;
                worstChildPath = childRes.path;
            }
        }

        // Evaluar triggers en cascada
        for (const trigger of data.triggers_cascade || []) {
            const triggerFunc = trigger.target_function;
            const childRes = evaluateWorstPath(triggerFunc, new Set(visited), depth + 1);
            // Asumimos comportamiento síncrono por defecto en Postgres para triggers
            if (childRes.time > worstChildTime) {
                worstChildTime = childRes.time;
                worstChildPath = childRes.path;
            }
        }

        return {
            time: myTime + worstChildTime,
            path: [funcName, ...worstChildPath]
        };
    }

    // Validar todas las funciones
    for (const funcName of Object.keys(blueprint.functions)) {
        const { time, path } = evaluateWorstPath(funcName, new Set(), 0);
        
        if (time > CRITICAL_LIMIT) {
            hasErrors = true;
            console.error(`\n❌ [ERROR CRÍTICO] La función ${funcName} rompe los límites de ejecución.`);
            console.error(`  - Tiempo estimado peor caso: ${time.toFixed(0)}ms (Límite: ${CRITICAL_LIMIT}ms)`);
            console.error(`  - Ruta crítica de ejecución: \n      ${path.join('\n      -> ')}`);
        } else if (time > CRITICAL_LIMIT * 0.75) {
            console.warn(`\n⚠️ [WARNING] La función ${funcName} está al ${((time/CRITICAL_LIMIT)*100).toFixed(0)}% del límite.`);
        }
    }

    if (hasErrors) {
        console.error("\n💥 Validación fallida. Hay funciones que superarán los timeouts del rol o Gateway.");
        process.exit(1);
    } else {
        console.log("\n✅ Validación exitosa. Ningún flujo rompe los límites conocidos.");
        process.exit(0);
    }
}

main();
