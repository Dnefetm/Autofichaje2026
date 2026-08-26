<!-- GENERADO AUTOMATICAMENTE - NO EDITAR A MANO -->
<!-- Fuente: docs/db_flow_blueprint.json | Contenido curado/politicas: docs/POLITICAS_FRONTEND.md -->

# DB Flow Blueprint & System Diagnostics

- **Generado:** `2026-08-26T04:28:57.764Z` (snapshot; datos de runtime caducan en 26h. Verificar en vivo: node scripts/live_audit.js)
- **Fuente de extraccion:** proyecto `ryxdqnzyvnrwalylqyvm` (aws-1-us-east-2.pooler.supabase.com) — identidad **VERIFICADA** contra expected_db_project_ref
- **Schema hash:** `2ffddd0c143e1b2d6a51d4405be82d3b8cc7f14b567e44bf9a7d45867c6308af`
- **Processes hash:** `18e13877931f175d88ca7f748785708cb485c1a8287d8bc152de05cdda401b85`
- **Tables:** 84 | **Triggers:** 32 | **Cron jobs:** 5 | **Edge fns:** 3 | **Queues:** 7

## 📊 Linaje de Datos (Excel -> BD)

Columnas extraídas en Frontend / Edge:
- `modelo`
- `marca`
- `codigo`
- `descripcion`
- `moneda`

## Maquinas de estado

### importacion (enum `estado_importacion_excel`)
- **Estados:** pendiente_mapeo, mapeando, procesando, en_revision, completado, error, cancelado, matching_completo
- **Recuperacion desde error ->** cancelado, completado, en_revision, mapeando, matching_completo, pendiente_mapeo, procesando
- **Transiciones:**
 - `pendiente_mapeo` -> cancelado, en_revision, error, mapeando, procesando
 - `mapeando` -> cancelado, completado, en_revision, error, matching_completo, pendiente_mapeo, procesando
 - `procesando` -> cancelado, completado, en_revision, error, matching_completo
 - `completado` -> cancelado, en_revision, mapeando
 - `error` -> cancelado, completado, en_revision, mapeando, matching_completo, pendiente_mapeo, procesando
 - `cancelado` -> pendiente_mapeo
 - `en_revision` -> cancelado, completado, error, procesando
 - `matching_completo` -> cancelado, completado, en_revision, error

## Colas (jobs)

> Conteos del snapshot `2026-08-26T04:28:57.764Z`. NO es estado en vivo; los 'failed' son acumulado historico (nunca se purgan). Verificar en vivo: `node scripts/live_audit.js`.

### sync_stock_mapped
- **Total:** 221 (failed=3, completed=218)
- **WARNING - Fallidos (acumulado historico):** 3 | **Fallidos ultimas 24h:** 0
- **Productores:** public.fn_encolar_sync_stock

### recalc_pricing_bundle
- **Total:** 53 (completed=53)
- **Productores:** public.trg_mapeo_publicacion_recalcular_async, public.trg_costos_articulo_recalcular_async, public.fn_tg_encolar_recalculo, public.fn_drain_costos_pendientes_sin_match

### process_sale
- **Total:** 2095 (failed=2, pending=5, completed=2088)
- **Pendientes:** 5
- **WARNING - Fallidos (acumulado historico):** 2 | **Fallidos ultimas 24h:** 0
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_mapeo_publicacion_recalcular_async, public.trg_costos_articulo_recalcular_async, public.fn_tg_encolar_recalculo, public.fn_drain_costos_pendientes_sin_match, public.fn_aprobar_precios_draft

### sync_account_catalog
- **Total:** 26 (completed=13, failed=13)
- **WARNING - Fallidos (acumulado historico):** 13 | **Fallidos ultimas 24h:** 3
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_mapeo_publicacion_recalcular_async, public.trg_costos_articulo_recalcular_async, public.fn_tg_encolar_recalculo, public.fn_drain_costos_pendientes_sin_match, public.fn_aprobar_precios_draft

### sync_stock
- **Total:** 5 (completed=5)
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_mapeo_publicacion_recalcular_async, public.trg_costos_articulo_recalcular_async, public.fn_tg_encolar_recalculo, public.fn_drain_costos_pendientes_sin_match, public.fn_aprobar_precios_draft

### sync_item
- **Total:** 8137 (completed=8087, pending=31, failed=19)
- **Pendientes:** 31
- **WARNING - Fallidos (acumulado historico):** 19 | **Fallidos ultimas 24h:** 5
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_mapeo_publicacion_recalcular_async, public.trg_costos_articulo_recalcular_async, public.fn_tg_encolar_recalculo, public.fn_drain_costos_pendientes_sin_match, public.fn_aprobar_precios_draft

### importaciones_excel
- **Total:** 0 ()
- **Productores:** trg_disparar_worker_importacion

## Rutas de pricing (estado)

### v1_precio_recalc_queue — **DEAD**


### v2_marketplace_prices — **LEGACY**


### v3_publication_pricing — **ALIVE**


## Diagnosticos

### WARN

- [TABLE_NOT_FOUND] `app.table.bundle_components`: La app hace referencia a una tabla/vista 'bundle_components' que no fue encontrada en la extracción de public. — En archivo: /home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/lib/dashboard-service.ts (whitelisted en flow_hints.yaml: verificado en prod; retirar al corregir SUPABASE_DB_URL del CI)

### INFO

- [QUEUE_NO_RUNTIME] `processes.importacion_precios.downstream`: cola 'sync_price' sin filas observadas en public.jobs — La cola es valida pero aun no tiene trafico observado.
- [QUEUE_NO_RUNTIME] `processes.pricing_publicacion_v3.downstream`: cola 'sync_price' sin filas observadas en public.jobs — La cola es valida pero aun no tiene trafico observado.

## Procesos declarados

### importacion_precios

- Trigger: `POST /api/precios/importar/[id]/iniciar-parser`
- Steps:
  - fn=`public.fn_preparar_importacion_revision` | estado=`mapeando`
  - fn=`public.fn_match_precios_v2` | estado=`procesando`
  - fn=`public.fn_confirmar_matching_decisiones` | estado=`en_revision`
  - fn=`public.fn_consolidar_matching_decisiones` | estado=`matching_completo`
  - fn=`public.fn_resolver_y_poblar_costos` | tabla_destino=`costos_articulo`
  - fn=`public.fn_marcar_vigente` | estado=`completado`
- Downstream:
  - trigger=`trg_costos_articulo_recalcular_async` | tabla=`costos_articulo`
  - job=`recalc_pricing_bundle` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/app/api/catalog/external/[id]/pricing/route.ts`, `/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/components/mapping-modal.tsx` | expect_runtime=`true`
  - fn=`public.fn_recalcular_precio_publicacion` | destino=`publication_pricing_history`
  - job=`sync_price` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/app/api/worker/process/route.ts` | expect_runtime=`false`
- Recovery: desde `error` -> [`mapeando`, `procesando`, `completado`]

### sync_stock_inventario

- Trigger: `Cambios en ingresos/egresos (trg_stock_after_*) o en inventory_snapshot (trg_encolar_sync_stock)`
- Steps:
  - fn=`public.trg_fn_sync_stock`
  - fn=`public.fn_recalcular_stock` | tabla_destino=`inventory_snapshot`
  - fn=`public.fn_encolar_sync_stock` | tabla_destino=`jobs`
- Downstream:
  - job=`sync_stock` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/lib/dashboard-service.ts` | expect_runtime=`true`
  - job=`sync_stock_mapped` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/components/mapping-modal.tsx` | expect_runtime=`true`

### proceso_venta_meli

- Trigger: `Webhook MeLi (POST /api/webhooks/meli)`
- Steps:
  - fn=`public.decrement_stock_safe` | tabla_destino=`inventory_snapshot`
- Downstream:
  - job=`process_sale` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/app/api/webhooks/meli/route.ts` | expect_runtime=`true`
  - job=`sync_stock` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/lib/dashboard-service.ts` | expect_runtime=`true`

### pricing_publicacion_v3

- Trigger: `Cambios en publicaciones_externas (trg_recalcular_precio_publicacion) o job recalc_pricing_bundle`
- Steps:
  - fn=`public.fn_recalcular_precio_publicacion` | tabla_destino=`publication_pricing_history`
  - fn=`public.fn_resolver_regla_pricing`
- Downstream:
  - job=`recalc_pricing_bundle` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/app/api/catalog/external/[id]/pricing/route.ts`, `/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/components/mapping-modal.tsx` | expect_runtime=`true`
  - job=`sync_price` | handler=`/home/runner/work/Autofichaje2026/Autofichaje2026/apps/dashboard/src/app/api/worker/process/route.ts` | expect_runtime=`false`

### autoficha_fichas

- Trigger: `UI de autoficha (guardar/editar ficha)`
- Steps:
  - fn=`public.guardar_ficha_autoficha` | tabla_destino=`fichas_tecnicas`
  - fn=`public.trigger_auditoria_ficha` | tabla_destino=`ficha_auditoria`
  - fn=`public.crear_version_ficha` | tabla_destino=`fichas_tecnicas`

## Salud del blueprint

- Procesos declarados: 5
- Handlers de jobs detectados en worker: 11
- Diagnosticos error: 0
- Diagnosticos warn: 1
- Diagnosticos info: 2

## public.actualizar_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.obtener_ficha_publicada
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~25 ms (estimado) (source: ast_estimator)

## public.update_actualizado_el_column
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_set_marketplace_prices_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.crear_version_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~215 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.buscar_fichas_por_atributo
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~55 ms (estimado) (source: ast_estimator)

## public.obtener_atributos_baja_confianza
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~55 ms (estimado) (source: ast_estimator)

## public.validar_ficha_atributos
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~75 ms (estimado) (source: ast_estimator)

## public.aplicar_extraccion_a_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~615 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas, public.ficha_extracciones
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.calcular_completitud_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~75 ms (estimado) (source: ast_estimator)

## public.trigger_auditoria_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~305 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.ficha_auditoria

## public.trigger_historial_precio
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~155 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.historial_precios

## public.trigger_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_sync_sku_from_articulo_id
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_encolar_sync_price
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~175 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.update_updated_at_column
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.decrement_stock_safe
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~375 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.inventory_transactions, public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.actualizar_estado_mapeo_publicacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~425 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.fn_auto_create_inventory_snapshot
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~155 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.fn_ensure_snapshot_on_mapping
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~155 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.purge_old_failed_jobs
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~105 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_encolar_sync_price_marketplace
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~155 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_recalcular_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~265 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.compute_ingreso_hash
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_encolar_sync_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~225 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_sync_reserved_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~445 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.update_fecha_modificacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.trg_fn_sync_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)
- **Calls Functions:** public.fn_recalcular_stock

## public.trg_extraer_campos_regulatorios
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_limpiar_publicacion_ml_en_cierre
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~475 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.articulos
- **Cascading Triggers:**
 - `articulos` -> `public.fn_auto_create_inventory_snapshot` (Trigger: trg_auto_create_inventory_snapshot)
 - `articulos` -> `public.update_actualizado_el_column` (Trigger: set_actualizado_el)

## public.compute_egreso_hash
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.check_missing_snapshots
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~65 ms (estimado) (source: ast_estimator)

## public.release_zombie_jobs
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 119.92 ms (source: pg_stat_statements)
- **Touches Tables:** public.jobs

## public.update_borradores_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_backfill_ingreso_ids
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~635 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.ingresos
- **Cascading Triggers:**
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_ingreso)

## public.buscar_publicaciones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 268.35 ms (source: pg_stat_statements)

## public.fn_pop_matching_job
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 14.54 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.matching_jobs

## public.fn_buscar_listas_raw
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~65 ms (estimado) (source: ast_estimator)

## public.fn_recuperar_importaciones_colgadas
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~205 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.importaciones_excel
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_eliminar_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~325 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.costos_articulo, public.listas_precios_raw, public.importaciones_excel
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_cancelar_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~205 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.importaciones_excel
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_claim_next_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~425 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.importaciones_excel, public.SKIP
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_recalcular_precio_marketplace_all
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~175 ms (estimado) (source: ast_estimator)
- **Calls Functions:** public.fn_recalcular_precio_marketplace

## public.fn_watchdog_matching
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~525 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.importacion_eventos, public.matching_jobs

## public.fn_match_articulo_proveedor
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~65 ms (estimado) (source: ast_estimator)

## public.fn_disparar_edge_procesar_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~45 ms (estimado) (source: ast_estimator)

## public.trg_mapeo_publicacion_recalcular_async
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~305 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_poblar_matching_decisiones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~275 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.matching_decisiones

## public.trg_costos_articulo_recalcular_async
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 3.95 ms (source: pg_stat_statements)
- **Touches Tables:** public.jobs

## public.f_unaccent_immutable
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: yaml_hint)

## public.fn_consolidar_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~1595 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.listas_precios_raw, public.listas_precios_proveedor, public.importacion_eventos, public.status, public.importaciones_excel, public.costos_articulo, public.listas_precios_raw_staging
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.trg_costos_articulo_recalcular
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 3.95 ms (source: pg_stat_statements)
- **Calls Functions:** public.fn_recalcular_precio_marketplace

## public.fn_recalcular_precio_marketplace
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~565 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.marketplace_prices, public.SET
- **Cascading Triggers:**
 - `marketplace_prices` -> `public.fn_set_marketplace_prices_updated_at` (Trigger: trg_marketplace_prices_updated_at)

## public.fn_actualizar_comisiones_reales
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~355 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.meli_category_commissions, public.SET

## public.trg_recalcular_precio_publicacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 0.29 ms (source: pg_stat_statements)
- **Calls Functions:** public.fn_recalcular_precio_publicacion

## public.fn_resolver_regla_pricing
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 42.14 ms (source: pg_stat_statements)

## public.fn_parse_precio
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 83.71 ms (source: pg_stat_statements)

## public.fn_tg_promote_pendientes
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~575 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.costos_articulo, public.SET, public.costos_pendientes
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_confirmar_matching_decisiones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 1500.00 ms (source: yaml_hint)
- **Touches Tables:** public.matching_decisiones
- **Calls Functions:** public.fn_consolidar_matching_decisiones

## public.fn_calcular_precio_publico
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~215 ms (estimado) (source: ast_estimator)

## public.update_actualizado_el
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~5 ms (estimado) (source: ast_estimator)

## public.fn_guard_completado_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~25 ms (estimado) (source: ast_estimator)

## public.fn_resolver_y_poblar_costos
- **Security:** DEFINER
- **Timeout Override:** statement_timeout=180s
- **Avg Time:** 3500.00 ms (source: yaml_hint)
- **Touches Tables:** public.costos_articulo, public.precio_recalc_queue, public.costos_pendientes, public.SET
- **Calls Functions:** public.f_unaccent_immutable
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_consolidar_revision_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~1735 ms (estimado) (source: ast_estimator)
- WARNING: **Dynamic SQL Detected**
- **Touches Tables:** public.precios_proveedor_actual, public.listas_precios_proveedor, public.importacion_eventos, public.SET, public.costos_articulo, public.importaciones_excel
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_match_precios_v2
- **Security:** DEFINER
- **Timeout Override:** statement_timeout=180s
- **Avg Time:** 4000.00 ms (source: yaml_hint)
- **Touches Tables:** public.costos_articulo, public.costos_pendientes, public.matching_jobs, public.SET, public.proveedor_articulos_alias, public.importaciones_excel
- **Calls Functions:** public.f_unaccent_immutable, public.fn_parse_precio, public.fn_marcar_vigente
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)
 - `proveedor_articulos_alias` -> `public.fn_tg_promote_pendientes` (Trigger: tg_promote_pendientes)
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_app_config_get
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~25 ms (estimado) (source: ast_estimator)

## public.recalcular_par_item_id
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 12.56 ms (source: pg_stat_statements)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.recalcular_catalog_count
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 5.50 ms (source: pg_stat_statements)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.recalcular_associated_count
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 3.40 ms (source: pg_stat_statements)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.vincular_ficha
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~245 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.desvincular_ficha
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~225 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.eliminar_ficha_completa
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~225 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.ficha_extracciones, public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.desvincular_ficha_articulo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~225 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.upsert_ingreso
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~355 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.ingresos, public.SET
- **Cascading Triggers:**
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_ingreso)

## public.actualizar_campos_regulatorios
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~205 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.fn_validar_transicion_estado_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~25 ms (estimado) (source: ast_estimator)

## public.eliminar_ficha_borrador
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~225 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.ficha_extracciones, public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.vincular_ficha_articulo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~245 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.fix_par_item_id_faltantes
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~205 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.guardar_ficha_autoficha
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~1275 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.fuentes_documento, public.articulos, public.inventory_snapshot, public.fichas_tecnicas, public.ficha_extracciones, public.SET
- **Cascading Triggers:**
 - `articulos` -> `public.fn_auto_create_inventory_snapshot` (Trigger: trg_auto_create_inventory_snapshot)
 - `articulos` -> `public.update_actualizado_el_column` (Trigger: set_actualizado_el)
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.fn_backfill_egreso_ids
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~415 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.egresos
- **Cascading Triggers:**
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_egreso)

## public.fn_resumen_matching
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~25 ms (estimado) (source: ast_estimator)

## public.fn_watchdog_importaciones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~925 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.importacion_eventos, public.importaciones_excel, public.listas_precios_raw, public.listas_precios_raw_staging, public.costos_articulo, public.matching_jobs
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_confirmar_decisiones_masivo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~605 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.matching_decisiones, public.costos_articulo
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_revertir_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~815 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.precio_recalc_queue, public.listas_precios_proveedor, public.importaciones_excel, public.costos_articulo, public.costos_pendientes
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_marcar_vigente
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 500.00 ms (source: yaml_hint)
- **Touches Tables:** public.listas_precios_proveedor

## public.fn_tg_encolar_recalculo
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 3.30 ms (source: pg_stat_statements)
- **Touches Tables:** public.jobs, public.precio_recalc_orphans_log

## public.upsert_egreso
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** ~355 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.egresos, public.SET
- **Cascading Triggers:**
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_egreso)

## public.claim_precio_recalc
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** ~445 ms (estimado) (source: ast_estimator)
- **Touches Tables:** public.SKIP, public.precio_recalc_queue

## public.claim_jobs
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 9.80 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.jobs

## public.fn_recalcular_lote
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 22.75 ms (source: pg_stat_statements)
- **Touches Tables:** public.precios_publicados, public.ml_publicacion_sync_queue, public.SET

## public.procesar_import_job
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 20.10 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.import_jobs, public.importaciones_excel
- **Calls Functions:** public.fn_preparar_importacion_revision
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.estado_import_job
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 110.59 ms (source: pg_stat_statements)

## public.procesar_precio_recalc_queue
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 897.03 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.precio_recalc_queue
- **Calls Functions:** public.fn_recalcular_lote

## public.encolar_import_job
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 21.05 ms (source: pg_stat_statements)
- **Touches Tables:** public.import_jobs, public.importaciones_excel
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.tmp_run_diff_dacb722a
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 56.38 ms (source: pg_stat_statements)
- **Touches Tables:** public.importaciones_excel
- **Calls Functions:** public.fn_preparar_importacion_revision
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_procesar_precio_recalc_queue
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 897.03 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.precio_recalc_queue
- **Calls Functions:** public.fn_recalcular_precio_publicacion

## public.fn_drain_costos_pendientes_sin_match
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 150.00 ms (source: yaml_hint)
- **Touches Tables:** public.costos_articulo, public.jobs, public.SET, public.costos_pendientes
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_consolidar_matching_decisiones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 2000.00 ms (source: yaml_hint)
- **Touches Tables:** public.proveedor_articulos_alias, public.costos_articulo, public.SET
- **Cascading Triggers:**
 - `proveedor_articulos_alias` -> `public.fn_tg_promote_pendientes` (Trigger: tg_promote_pendientes)
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_preparar_importacion_revision
- **Security:** DEFINER
- **Timeout Override:** statement_timeout=180s
- **Avg Time:** 2500.00 ms (source: yaml_hint)
- **Touches Tables:** public.listas_precios_raw, public.listas_precios_proveedor, public.importaciones_excel, public.listas_precios_raw_staging
- **Calls Functions:** public.fn_resolver_y_poblar_costos
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_aprobar_precios_draft
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 15.20 ms (source: pg_stat_statements)
- **Touches Tables:** public.jobs, public.publicaciones_externas, public.publication_pricing_drafts
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.fn_vincular_lote
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 36.09 ms (source: pg_stat_statements)
- **Touches Tables:** public.proveedor_articulos_alias
- **Cascading Triggers:**
 - `proveedor_articulos_alias` -> `public.fn_tg_promote_pendientes` (Trigger: tg_promote_pendientes)

## public.fn_recalcular_precio_publicacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 39.32 ms (source: pg_stat_statements)
- **Touches Tables:** public.publication_pricing_drafts, public.SET
- **Calls Functions:** public.fn_resolver_regla_pricing

## public.fn_validar_matching_completo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 31.43 ms (source: pg_stat_statements)

