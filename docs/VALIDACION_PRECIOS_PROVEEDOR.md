# Validación — Módulo de Precios (modelo separado: precios autónomos + vinculación opcional)

Este documento permite validar externamente la corrección del módulo de Precios.

## 1. Modelo objetivo

- **Mundo 1 (Precios del proveedor)**: la lista de precios se procesa de forma autónoma
  e independiente del catálogo. Detecta cambios de precio, artículos nuevos (se crean
  dentro del módulo), descontinuación y vigencia.
- **Mundo 2 (Vinculación con catálogo)**: flujo separado y opcional, solo cuando el
  operador lo decide. No interviene en el procesamiento de la lista.

## 2. Cambios entregados

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260903000020_precios_proveedor.sql` | Tabla `precios_proveedor` + `fn_procesar_precios_proveedor` (append-only + rollback incluido) |
| `apps/dashboard/src/app/api/precios/importar/[id]/mapear/route.ts` | Ya NO ejecuta matching; ejecuta `fn_procesar_precios_proveedor` |
| `apps/dashboard/src/app/api/precios/importar/[id]/activar/route.ts` | Guard de activación verifica `precios_proveedor` (no `costos_articulo`) |
| `apps/dashboard/src/app/precios/[proveedor]/revisar/page.tsx` | Auditoría lee `precios_proveedor` (no `costos_articulo`) |
| `apps/dashboard/src/app/precios/[proveedor]/historial/[id]/resumen/page.tsx` | Resumen lee `precios_proveedor` (columnas mapeadas, no fijas) |
| `apps/dashboard/src/app/api/precios/[proveedor]/decisiones-batch/route.ts` | Decisiones de auditoría se persisten en `precios_proveedor.confirmado_por` |

## 3. Validación por triplicada

### Leg 1 — Código
- `npx tsc --noEmit -p apps/dashboard/tsconfig.json` → limpio
  (solo 2 errores preexistentes de `api/publish/route.ts` y `publish-panel.tsx`, ajenos al módulo).

### Leg 2 — Datos (probe de solo lectura)
Se ejecutó `scratch/validate_precios_proveedor.js` contra la base real.

Resultado para Urrea Herramientas (lote vigente `f93e4c8b-…`, "LISTA AGO 26"):

```
columna_modelo = CÓDIGO
precios = distribuidor | subdistribuidor | mayoreo | menudeo
RESULTADO ESPERADO: nuevos=15237  actualizados=0  sin_cambio=0  descontinuados=0
```

**Hallazgo verificado**: la importación anterior (`b3b4661a-…`) tiene `listas_precios_raw = 0`
(su crudo fue borrado en una sesión previa). Por eso la primera comparación arroja "todo nuevo"
y "0 descontinuados" — es correcto, no hay base anterior. La siguiente subida mensual SÍ tendrá
base válida (el lote AGO `f93e4c8b` conserva sus 15 369 filas crudas).

**Criterio de aceptación**: al aplicar la migración y ejecutar
`SELECT fn_procesar_precios_proveedor('f93e4c8b-4eee-4b03-8d2a-188cedae3c63')`,
debe devolver exactamente `nuevos=15237, actualizados=0, sin_cambio=0, descontinuados=0`.
Cualquier diferencia indica un bug y se detiene.

### Leg 3 — Comportamiento (caso de prueba end-to-end)
Subir un Excel de prueba con 3 productos respecto a la lista vigente:

| Producto | Caso | Resultado esperado |
|---|---|---|
| SKU-A | mismo código, precio distribuidor cambia | `actualizado` (Δ$) |
| SKU-B | código que no existía | `nuevo` (creado en el módulo) |
| SKU-C | estaba antes, ausente ahora | `descontinuado` (vigente=false) |

Pasos:
1. `/precios/[proveedor]/subir` → subir el Excel.
2. `/mapear` → confirmar columnas (modelo, marca, precios).
3. Verificar que `resumen_diff` en `importaciones_excel` muestre `nuevos=1, actualizados=1, descontinuados=1`.
4. `/revisar` → ver las 3 tarjetas (Cambio / Nuevo / Ausente) y aprobar/rechazar.
5. `resumen` → activar como vigente.

## 4. Rollback

Ejecutar el bloque comentado al final de `20260903000020_precios_proveedor.sql`:
`DROP TABLE precios_proveedor` + `DROP FUNCTION fn_procesar_precios_proveedor`.
No afecta ninguna tabla existente.

## 5. Pendientes conocidos (fuera del alcance de esta entrega)

- Flujo legacy `historial/[id]/confirmar` (lee `costos_articulo`) — queda huérfano/paralelo;
  debe deprecarse en una entrega posterior.
- `modo_carga` (parcial/full) se guarda pero no se consume; decidir si se implementa o se retira.
- Botón "Mantener vigente" para revertir una descontinuación (restaurar) — no implementado aún.
