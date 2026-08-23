# Diagnóstico del DB Flow Blueprint y Estrategia de Corrección

**Fecha:** 2026-08-23
**Autor:** Kimi (análisis solicitado por el owner)
**Alcance:** `docs/db_flow_blueprint.{md,json}`, `docs/flow_hints.yaml`, `scripts/generate_flow_blueprint.ts`, `scripts/ci_validate_blueprint.ts`, `.github/workflows/blueprint.yml`, y el diálogo previo con comet (adjuntos en `docs/comet_dialogo/`).
**Método:** toda afirmación de este documento está respaldada por (a) lectura directa de archivos del repo, (b) salida de comandos ejecutados en esta sesión, o (c) consultas **en vivo de solo lectura** contra Supabase (`scripts/live_audit.js`, ejecutado el 2026-08-23). Lo que no pudo verificarse se declara explícitamente como hipótesis.

---

## 1. Resumen ejecutivo

El blueprint **no está roto de diseño; está roto de operación**. El generador es técnicamente sólido (introspección real de `pg_proc`, `pg_trigger`, `pg_class`, `cron.job`, escaneo del worker y validación cruzada declarativa), pero hoy produce un documento en el que **no se puede confiar**, por tres razones verificadas:

1. **Está desactualizado y nadie se entera:** la última generación data del 2026-08-15 (8 días), a pesar de que el workflow de GitHub Actions tiene un cron horario. El pipeline de auto-actualización está mudo desde entonces.
2. **Publica datos volátiles como si fueran hechos:** los conteos de colas y tiempos son snapshots sin fecha de caducidad. El ejemplo crítico: el blueprint afirma `recalc_pricing_bundle: failed=2136`; la base de datos en vivo dice `failed=0, completed=4184`. Este dato falso ya causó un diagnóstico erróneo de comet ("el motor de bundles está 100% roto").
3. **Tres fuentes se contradicen entre sí:** el `.md`, el `.json` y la base de datos real dicen cosas distintas al mismo tiempo (detalle en §3, H2).

Adicionalmente, el archivo `.md` está **físicamente corrupto** (codificación mixta UTF-8/CP1252) por un `Add-Content` de PowerShell ejecutado por comet, y mezcla contenido generado automáticamente con políticas escritas a mano que el generador destruirá en la próxima ejecución exitosa.

**Veredicto:** el blueprint, tal como opera hoy, **no es adecuado** para conocer en vivo los procesos, triggers, tablas y dependencias. Sí es una buena base estructural (mapa de funciones, triggers en cascada, máquina de estados), pero su capa de "estado en vivo" es una fotografía vieja presentada como verdad vigente. La estrategia de corrección está en §5.

---

## 2. Qué se verificó y cómo

| Verificación | Método | Resultado |
|---|---|---|
| Fecha de generación del blueprint | `generated_at` en `docs/db_flow_blueprint.json` | `2026-08-15T06:39:37Z` |
| Última auto-actualización en git | `git log -- docs/db_flow_blueprint.json` | último commit automático: **2026-08-15** |
| Estado real de la cola `recalc_pricing_bundle` | query en vivo vía PostgREST (service role) | `failed=0, pending=0, processing=0, completed=4184` |
| Existencia real de tablas "fantasma" | query en vivo `.from(t).select(head:true)` | las 5 tablas marcadas como inexistentes **SÍ existen** |
| Costos vigentes (bloqueante declarado) | query en vivo `count(*) where vigente=true` | **10,252** vigentes (el yaml declara 0) |
| Estado del archivo `.md` | `file(1)`, decodificación binaria | codificación mixta, no-UTF-8, mojibake |
| Ediciones manuales en el `.md` | `git log` + `git status` | 3 commits manuales + cambios sin commitear |
| Cobertura de procesos declarados | `flow_hints.yaml` y JSON | **1 solo proceso** (`importacion_precios`) |

---

## 3. Hallazgos verificados

### H1 — El pipeline de actualización está mudo desde el 2026-08-15

- `.github/workflows/blueprint.yml` define `schedule: cron '0 * * * *'` (cada hora) más triggers por push a migraciones.
- `git log -- docs/db_flow_blueprint.json` muestra el último commit `chore(db): Auto-update DB Flow Blueprint` el **2026-08-15**. Hoy es 2026-08-23.
- **Consecuencia:** el blueprint promete frescura horaria y entrega datos de hace 8 días. No hay alerta de que el cron dejó de correr.
- **Causa probable (hipótesis no verificada):** el workflow está fallando (secret expirado, error de conexión, o el paso de validación con `exit 1`), o GitHub desactivó el schedule por inactividad del repo. Requiere revisar la pestaña Actions del repo.

### H2 — Tres fuentes de verdad contradictorias (el fallo más grave)

| Dato | `db_flow_blueprint.md` | `db_flow_blueprint.json` | Base de datos en vivo (2026-08-23) |
|---|---|---|---|
| `recalc_pricing_bundle` fallidos | 276 | 2,136 | **0** (4,184 completed) |
| `importaciones_precios` | no listada | `TABLE_NOT_FOUND` (warn) | **EXISTE** |
| `precio_import_batches` | no listada | `TABLE_NOT_FOUND` (warn) | **EXISTE** |
| `bundle_components` | no listada | `TABLE_NOT_FOUND` (warn) | **EXISTE** |
| `precios_historial_proveedor` | no listada | `TABLE_NOT_FOUND` (warn) | **EXISTE** |
| `costos_articulo` vigentes | (no reporta) | yaml: "total=0, vigentes=0" | **10,252** |

- El `.md` y el `.json` ni siquiera coinciden entre sí: el `.md` conserva contenido de la generación del 2026-08-12 y el `.json` es del 2026-08-15. Cualquier lector (humano o IA) obtiene una respuesta distinta según el archivo que abra.
- Los 5 `TABLE_NOT_FOUND` son **falsos positivos respecto a la realidad actual**. Dos explicaciones posibles, ambas sintomáticas:
  - (a) Esas tablas se crearon en producción **fuera de banda** entre el 15 y el 23 de agosto (viven en `packages/db/schema.sql` y `packages/db/migrations/v62_pricing_pipeline_v2.sql`, NO en `supabase/migrations/` — es decir, hay dos rutas de migración y la oficial no las contiene).
  - (b) El `SUPABASE_DB_URL` del CI apunta a una base distinta de la que usa la app (`.env`). No verificable sin acceso a los secrets de GitHub.
- En cualquiera de los dos casos: **el blueprint no describe la base de datos que la aplicación realmente usa.**

### H3 — El dato que destruyó la confianza: `failed=2136`

- El JSON (snapshot 2026-08-15) reporta `recalc_pricing_bundle: { failed: 2136, total: 2136 }`.
- En vivo (2026-08-23): `failed=0, completed=4184`. La consulta en vivo de comet durante su sesión también arrojó `failed=0`.
- Interpretación: los jobs fallidos eran históricos acumulados (el cron de purga `jobid=5` solo borra `completed` >7 días; los `failed` se acumulan para siempre) y alguien los limpió. El snapshot congeló un número que parecía un incendio activo.
- **Este único número originó el diagnóstico falso de comet "el motor de bundles está 100% roto"** y toda la cascada de desconfianza posterior. Es la prueba empírica de que guardar estado volátil en un documento estático es un defecto de diseño, no un descuido.

### H4 — La capa declarativa (`flow_hints.yaml`) afirma cosas ya falsas

- `flow_hints.yaml` contiene el bloque `pricing_data_blocker` que declara: `costos_articulo_total: 0`, `costos_articulo_vigentes: 0`, y lo propaga como "Bloqueo conocido… No es fallo estructural" en los diagnósticos del blueprint.
- En vivo: **10,252 costos vigentes**. El bloqueo de datos fue resuelto y el yaml sigue declarándolo como vigente. El generador lo amplifica acríticamente porque nada verifica los bloqueos declarados contra la BD.
- El mismo yaml documenta el gap `recalc_pricing_bundle` como "IMPLEMENTADO" con handler verificado — eso sí coincide con la realidad (handler presente en `route.ts`, 4,184 jobs completados).

### H5 — El archivo `.md` está físicamente corrupto y mezcla dos naturalezas incompatibles

- `file docs/db_flow_blueprint.md` → `Non-ISO extended-ASCII text, with CRLF, LF line terminators`. No decodifica como UTF-8 (byte `0xF3` en posición 48861); el tramo final está en CP1252/Latin-1.
- Causa: comet ejecutó `Add-Content` de PowerShell sobre el archivo UTF-8, anexando texto en otra codificación. Irónicamente, la sección anexada predica "Erradicación de Mojibake Segura" — y el anexo **introdujo mojibake** (`PolÃ­ticas`, `ValidaciÃ³n`).
- Además, el `.md` acumula contenido manual commiteado (`docs(blueprint): add 6 frontend and runtime safety policies`, `Nielsen UX Heuristics`, etc.) más cambios locales sin commitear. Pero `generate_flow_blueprint.ts` **sobrescribe el archivo completo** (`fs.writeFileSync(outMdPath, md)`): la próxima generación exitosa destruirá todo el contenido manual sin aviso.
- Conclusión: el mismo archivo es a la vez artefacto generado y documento curado. Esas dos naturalezas deben separarse o una de las dos siempre terminará destruyendo a la otra.

### H6 — Los diagnósticos graves no bloquean nada

- El generador (versión actual en CI) sí detecta las referencias de la app a tablas no encontradas (`TABLE_NOT_FOUND`, 5 casos) — pero los emite como `warn`.
- `ci_validate_blueprint.ts` solo hace `exit 1` con `severity: 'error'`. Resultado: rutas de API que apuntan a tablas posiblemente inexistentes **pasan el CI en verde**.
- Matiz honesto: en este caso concreto los warns resultaron falsos positivos (las tablas existen en vivo), lo que refuerza H2 — pero el problema estructural es doble: cuando el detector acierta, nadie se entera; cuando falla, tampoco.

### H7 — Falsa precisión en los tiempos

- La mayoría de `avg_time_ms` proviene de `ast_estimator`: una heurística que suma milisegundos inventados por patrón de SQL (`INSERT`=150ms, `UPDATE`=200ms, etc.) y luego se imprime con dos decimales (`425.00 ms`).
- Solo unas pocas funciones tienen datos reales (`pg_stat_statements`, `live_stats`) o hints curados (`yaml_hint`).
- El formato del `.md` no distingue visualmente un dato medido de uno inventado salvo por la etiqueta pequeña `(source: ...)`. Un lector apurado (o una IA) toma `4000.00 ms` como medición real. Así nació otro tramo del diagnóstico inflado de comet ("triggers de 4 segundos con locks").

### H8 — Cobertura de procesos: 1 de muchos

- `flow_hints.yaml` declara un único proceso de negocio: `importacion_precios`. La validación cruzada (steps ↔ funciones reales, estados ↔ enum real) solo protege ese proceso.
- La aplicación tiene más flujos vitales visibles en el propio blueprint: `sync_stock`, `sync_item`, `process_sale` (1,993 jobs), `sync_account_catalog`, fichas/autoficha, bundles. Ninguno está declarado como proceso con steps, recovery y downstream validados.
- Para el objetivo del owner ("conocer los procesos y subprocesos"), el blueprint cubre hoy una fracción minoritaria del negocio.

### H9 — Lo que el blueprint SÍ hace bien (para no tirar lo que funciona)

- Introspección estructural real y completa: 99 funciones, 69 tablas, 32 triggers, 3 cron jobs, 3 edge functions, con seguridad (DEFINER/INVOKER), timeouts y SQL fuente.
- Mapa de triggers en cascada por función (quién despierta a quién) — esto es genuinamente útil y difícil de obtener a mano.
- Máquina de estados de importación extraída del enum real + tabla de transiciones real, con rutas de recuperación.
- Validación cruzada declarativa: si declaras en yaml una función o estado inexistente, el CI falla. Es un mecanismo correcto, solo que con cobertura mínima (H8) y severidades laxas (H6).
- Detección de handlers de jobs en el worker (`case '...'` en `route.ts`) y de colas huérfanas (`QUEUE_ORPHAN`).
- Hashes de esquema y de procesos para detectar drift entre ejecuciones.

---

## 4. Análisis del diálogo con comet

El diálogo (5 adjuntos en `docs/comet_dialogo/`) muestra un patrón que conviene dejar documentado porque es exactamente el riesgo que el blueprint debe defender:

1. **Primer diagnóstico de comet:** mezcla de aciertos y errores, todos presentados con la misma confianza.
   - FALSO: "el motor de bundles está 100% roto (2,136 fallos)". Era un snapshot de jobs históricos ya purgados (H3).
   - FALSO: atribuyó al blueprint una sección WARN de tablas fantasma que **no existía** en la versión que él leyó (esa capacidad apareció en el JSON del 2026-08-15). Citó evidencia que no estaba ahí.
   - PARCIAL: los triggers en cascada sí existen y son pesados, pero los "4000ms" eran `yaml_hint`/`ast_estimator`, no mediciones (H7).
   - CIERTO: las rutas `aplicar/route.ts` y `revert/route.ts` referencian tablas fuera del esquema oficial de migraciones (verificado por grep; las tablas existen en vivo pero fuera de `supabase/migrations`).
2. **Segundo diagnóstico (tras ser corregido):** se retractó con datos en vivo — eso estuvo bien — pero afirmó que `mapear/route.ts` ejecuta el matching "100% secuencialmente bloqueando el HTTP". Verificado: **falso a medias**. El archivo tiene `maxDuration = 300` y la estructura try/catch con respuesta 200 al final; el comentario sobre `after()` de Next.js no corresponde al código mostrado (no hay import de `after`), pero la ruta sí espera el RPC dentro del request. El riesgo de timeout existe; la descripción del mecanismo era imprecisa.
3. **Daño colateral verificado:** comet modificó `docs/db_flow_blueprint.md` con `Add-Content` de PowerShell y lo dejó en codificación mixta (H5). También anexó una referencia a un documento "DeepSeek" fuera del repo (`file:///C:/Users/dnefe/.gemini/...`) — contenido no verificable insertado en un documento de verdad del proyecto.
4. **Lección estructural:** el problema no fue solo "comet alucina". Fue que **el blueprint le entregó munición falsa con apariencia de hecho** (H2, H3, H7) y que pudo escribir en el documento de verdad sin ninguna barrera (H5). Un blueprint confiable habría impedido ambas cosas: datos volátiles etiquetados con fecha y caducidad, y artefactos generados marcados como de solo lectura.

---

## 5. Estrategia de corrección y mejora

Ordenada por impacto/esfuerzo. Nada de esto se ha aplicado; requiere tu autorización.

### Fase 0 — Restaurar la confianza básica (1 sesión)

1. **Reparar el `.md` corrupto:** regenerar desde el generador (o al menos re-escribir el tramo final en UTF-8). El contenido manual rescatable se mueve primero a `docs/POLITICAS_FRONTEND.md`.
2. **Separar generado de curado (regla permanente):**
   - `db_flow_blueprint.{md,json}` = 100% generado, con encabezado `<!-- GENERADO POR generate_flow_blueprint.ts — NO EDITAR A MANO -->`.
   - Todo contenido curado (políticas, heurísticas Nielsen, decisiones de arquitectura) vive en archivos separados que el generador nunca toca. Las políticas pueden *referenciarse* desde el blueprint, no incrustarse.
3. **Arreglar el cron mudo:** revisar la pestaña Actions, re-habilitar el schedule, y añadir al workflow un paso que **avise si la generación falla** (hoy falla en silencio). Commit del JSON+MD con fecha visible.

### Fase 1 — Que el blueprint deje de mentir (1-2 sesiones)

4. **Etiquetar volatilidad:** todo dato de runtime (conteos de colas, tiempos) se imprime como `valor (snapshot <generated_at>)`. El validador añade un chequeo **STALE_BLUEPRINT**: si `generated_at` tiene más de 26 horas, `ci_validate_blueprint.ts` falla con mensaje claro. Un blueprint viejo deja de ser "verdad" y pasa a ser "foto fechada".
5. **Auto-expiración de bloqueos declarados:** el generador ya está conectado a la BD; que verifique los `blocked_by` del yaml contra datos reales (ej. contar `costos_articulo` vigentes). Si el bloqueo ya no existe, lo reporta como `STALE_BLOCKER` (warn) en vez de propagarlo como verdad. Esto corrige H4 de raíz.
6. **Severidad real para tablas fantasma:** `TABLE_NOT_FOUND` en código de la app pasa de `warn` a `error` (rompe CI), con una lista de excepciones justificadas en el yaml para los casos legítimos. Antes de activarlo, resolver la discrepancia de las 5 tablas (H2): o se añaden a `supabase/migrations/` (fuente oficial única) o se documenta por qué existen fuera de banda.
7. **Extractor de tablas más fiel:** incluir vistas y vistas materializadas (`relkind IN ('r','v','m')`) para eliminar falsos `TABLE_NOT_FOUND`, y registrar en el JSON el `relkind` de cada relación.
8. **Unificar fuente de esquema:** decidir si las migraciones oficiales son `supabase/migrations/` o `packages/db/migrations/` y consolidar. Hoy el generador mira una cosa, la app usa otra y el CI dispara sobre una tercera ruta.

### Fase 2 — Cobertura de procesos de negocio (2-3 sesiones)

9. **Declarar los procesos reales en `flow_hints.yaml`** con el mecanismo de validación que ya existe: `sync_stock` (ingresos/egresos → snapshot → encolado → MeLi), `process_sale`, `sync_item`, `sync_account_catalog`, y el flujo de fichas/autoficha. Cada uno con steps, triggers productores, jobs, handlers y recovery. La validación cruzada actual (FN_MISSING, STATE_MISSING, QUEUE_ORPHAN) los protegerá automáticamente.
10. **Honestidad de tiempos:** imprimir `ast_estimator` como rango aproximado (`~400 ms (estimado)`) y reservar cifras exactas para `pg_stat_statements`/`live_stats`. Fin de la falsa precisión.
11. **Purgar ruido del snapshot:** los conteos de colas incluyen históricos acumulados (los `failed` nunca se purgan). El blueprint debe reportar `failed_24h` y `failed_total` por separado, y el yaml/CI debe definir umbrales de alerta sobre lo reciente, no sobre el acumulado eterno.

### Fase 3 — Blindaje contra el patrón "comet" (continuo)

12. **El blueprint como contrato para IAs y devs:** sección fija "Cómo leer este documento": (a) los números de runtime caducan en 26h, (b) prohibido diagnosticar desde este archivo sin correr `node scripts/live_audit.js` primero, (c) prohibido editar a mano los archivos generados.
13. **`scripts/live_audit.js` como compañero oficial** (ya creado en esta sesión): consulta en vivo, de solo lectura, el estado real de colas, tablas sospechosas y costos vigentes. Extenderlo con los checks que se repitan. Es la herramienta que habría evitado el diagnóstico falso de los 2,136 jobs.
14. **Protección del artefacto:** hook de pre-commit o paso de CI que rechace `db_flow_blueprint.md` si no es UTF-8 válido o si su diff no proviene del generador (heurística: el encabezado GENERADO debe estar intacto).

### Qué NO requiere cambio

- El motor de introspección (funciones, triggers, cascadas, máquina de estados): funciona y es la parte más valiosa.
- La validación cruzada declarativa: correcta; solo necesita más procesos declarados y severidades honestas.
- El worker y la tabla `jobs`: la realidad en vivo (4,184 bundles completados, 0 fallidos) dice que esta parte de la arquitectura está sana.

---

## 6. Anexo — Cómo reproducir esta verificación

```bash
# Auditoría en vivo de solo lectura (colas, tablas fantasma, costos vigentes)
node scripts/live_audit.js

# Frescura del blueprint
python -c "import json; print(json.load(open('docs/db_flow_blueprint.json'))['generated_at'])"
git log --format='%h %ad %s' --date=short -5 -- docs/db_flow_blueprint.json

# Integridad del archivo generado
file docs/db_flow_blueprint.md   # debe decir "UTF-8 Unicode text"
```

**Limitaciones de este diagnóstico:** no se pudo verificar el valor del secret `SUPABASE_DB_URL` del CI (hipótesis de base distinta en H2 queda abierta), ni el historial de ejecuciones del workflow en GitHub Actions (H1). Ambas se resuelven en 5 minutos con acceso a la pestaña Actions/Settings del repo.
