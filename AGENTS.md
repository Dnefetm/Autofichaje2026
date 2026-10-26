# Reglas y Gobernanza de Agentes — Autofichaje2026

## 1. Constitución del Proyecto
Todo agente que opere en este repositorio DEBE acatar incondicionalmente las 8 secciones y el Checklist de Aceptación de:
👉 `docs/CRITERIOS_DESARROLLO.md`

Principios rectores obligatorios:
1. **Agnóstico de servicio:** Contratos e interfaces genéricas; no atar la lógica de negocio a un proveedor específico.
2. **Triple horizonte (H1, H2, H3):** Debe funcionar con la infraestructura actual (H1), tras la migración/corte independiente (H2), y ser extensible a un segundo proveedor sin reescribir (H3).
3. **No regresión técnica ni funcional (Criterio Supremo):** Prohibido romper lo que ya funciona. Compilación limpia en entorno sano, verificación funcional en vivo y manejo de casos límite (poison pill, head-of-line blocking).
4. **Optimización responsable de recursos:** El costo es una palanca, no una religión (no se prohíbe pagar, se prohíbe desperdiciar). Toda aceleración debe mantener o reducir el consumo de recursos.
5. **Condición de parada explícita:** Toda tarea asíncrona, worker, carrusel o barrido DEBE tener una condición de parada demostrable (prohibidos bucles infinitos).

---

## 2. Política Automática Multi-Modelo (Antigravity + DeepSeek)
Por instrucción explícita del usuario, TODO agente debe optimizar recursos y proteger la integridad funcional dividiendo estrictamente el rol de **Arquitecto (`Gate 1` y `Gate 2`)** y el rol de **Ejecutor Operativo**:

### A. Matriz de Modelos por Entorno
| Rol | En Antigravity | En DeepSeek | Responsabilidad Exclusiva |
|---|---|---|---|
| **Arquitecto y Auditor (`Gate 1` y `Gate 2`)** | **Argon (`Model: 'pro'`)** | **`deepseek-reasoner`** *(Modo Thinking / R1)* | Diseño arquitectónico, cruce de casos borde antes de tocar código (`Gate 1`) y auditoría del diff + evidencia en vivo (`Gate 2`). **PROHIBIDO** gastar turnos del modelo pensante en barridos exploratorios o comandos repetitivos. |
| **Ejecutor Operativo (Fuerza Bruta y Consultas)** | **Flash High (`Model: 'flash'`, `TypeName: 'self'`)** *(PROHIBIDO `'flash_lite'`)* | **`deepseek-chat`** *(Modo V3 No-Thinking)* | Consultas SQL de diagnóstico a Supabase, búsqueda/lectura de archivos, escritura de migraciones y código TS/UI ya especificados, y ejecución de `tsc --noEmit` / builds. |

### B. Reglas Forzosas de Delegación y Ahorro de Tokens
1. **Prohibición de `flash_lite` (Candado `.agents/hooks.json`):** En Antigravity está estrictamente prohibido invocar subagentes con `Model: 'flash_lite'`. Siempre debe usarse `Model: 'flash'` (versión completa/high) con `TypeName: 'self'`.
2. **Agrupación de Consultas en 1 Solo Llamado (Batching / KV-Cache Hit):**
   - Prohibido lanzar 5 o 10 comandos `node -e` separados para diagnosticar la base de datos.
   - Todas las preguntas de lectura de `Gate 1` (`pg_get_functiondef`, conteos, cruces de mapeos) DEBEN consolidarse en **un único script de diagnóstico** y ejecutarse en **1 sola llamada** (maximizando el 90% de descuento de Context Caching en DeepSeek y reduciendo latencia en Flash).
3. **Cierre Inmediato de Subagentes (`Zero Zombie Policy`):**
   - Apenas un subagente entrega su respuesta en Antigravity, el agente principal DEBE ejecutar `manage_subagents(Action: 'kill_all')` en ese mismo turno. Prohibido dejar subagentes en `idle` o esperando prompts interactivos (como `git push` sin credenciales).
4. **Protocolo de Coexistencia entre Agentes:**
   - Cuando el usuario alterna validaciones entre Antigravity y DeepSeek, ninguno debe re-escanear tablas completas desde cero: debe verificar puntualmente la afirmación en vivo (`pg_get_functiondef` y filas afectadas).
   - Ningún cambio aplicado en vivo en Supabase puede quedarse fuera de `supabase/migrations/` en Git.

---

## 3. Protocolo Anti-Regresión en Producción (`Gate 1` y `Gate 2`)
Para cualquier cambio que toque costos, alias de proveedor (`proveedor_articulos_alias`), mapeos (`mapeo_publicacion_articulo`), colas (`jobs`), workers o vistas:
1. **Modo Lectura Primero (`Gate 1`):** Ningún agente toca código ni BD sin verificar antes en vivo:
   - Qué funciones/vistas existen hoy en Supabase (`pg_get_functiondef`).
   - **Verificación de Impacto en Vitrinas Activas:** Antes de mover un alias en `proveedor_articulos_alias` o restringir una función de costos (ej. por `variante`), es OBLIGATORIO consultar cuántas publicaciones activas están mapeadas al `articulo_id` origen (`mapeo_publicacion_articulo`) y comprobar que **ninguna** caiga en `missing_cost` (`NULL`) tras el cambio.
2. **Trazabilidad Reversible:** Prohibido desvincular o re-apuntar mapeos sin respaldar antes en `public.mapeo_desvinculados_log`.
3. **Validación con Evidencia Dura (`Gate 2`):** Prohibido afirmar "funciona" sin demostrarlo con salida de `tsc --noEmit` (`0` errores) y consulta en vivo post-aplicación. No adular; buscar activamente fallos.
4. **Autorización Explícita:** Cambios de riesgo (DDL, migraciones, producción, datos reales) requieren autorización previa.
5. **Firma de Auditoría Obligatoria:** Toda respuesta técnica que ejecute diagnósticos o cambios debe cerrar con la línea:
   `[Auditoría: Subagente <id/modelo> | Subagentes activos al cierre: 0 | Regresión vitrinas activas: 0]`
