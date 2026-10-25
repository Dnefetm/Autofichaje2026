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

## 2. Política Automática de Modelos (Ahorro y Eficiencia)
Por instrucción explícita del usuario, el agente principal DEBE optimizar el gasto de recursos mediante la herramienta `invoke_subagent`:

1. **Trabajo Pesado ➔ Subagentes Económicos (`Model: 'flash'` o `'flash_lite'`):**
   - Exploración masiva de código, búsqueda de archivos y consultas de diagnóstico a bases de datos.
   - Escritura de componentes UI, rutas CRUD, scripts y transformaciones repetitivas.
   - Ejecución de comandos de verificación y compilación (`tsc`, builds, tests).
2. **Control Arquitectónico ➔ Modelo Principal (`Model: 'pro'` / Argon):**
   - **Gate 1 (Aprobación del Plan):** Despedazar el plan del subagente buscando fallas de concurrencia, límites de PostgREST (>1,000 filas sin `.limit()`), timeouts de worker o rate-limits compartidos.
   - **Gate 2 (Aprobación de Diff):** Auditar el diff final antes del commit aplicando estrictamente el *Checklist de 9 puntos* de `docs/CRITERIOS_DESARROLLO.md`.

---

## 3. Protocolo de Ejecución de Tareas
Para cualquier cambio que toque datos, colas (`jobs`), workers, APIs externas o sincronizadores:
1. **Modo Lectura Primero:** Ningún agente toca código sin un plan validado contra código y datos reales.
2. **Reutilizar sobre Reescribir:** Reusar la infraestructura existente (`jobs`, `webhook_config`, adaptadores existentes).
3. **Validación con Evidencia Dura:** Prohibido afirmar "funciona" sin demostrarlo con salida de compilación o datos en vivo. No adular; buscar activamente fallos.
4. **Autorización Explícita:** Cambios de riesgo (DDL, migraciones, producción, datos reales) requieren autorización previa.
