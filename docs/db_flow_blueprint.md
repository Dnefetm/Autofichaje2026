# DB Flow Blueprint

- **Schema hash:** `ed6cad46c06396f208f80f18fa4a25aada06efc535a6dd49ca58f37ce66dd558`
- **Processes hash:** `f3e0b11620c2b887fdd7bad6dfa8551ec00bba8baca8d9f0893955809d4d9a00`
- **Tables:** 69 | **Triggers:** 32 | **Cron jobs:** 3 | **Edge fns:** 3 | **Queues:** 6

## Maquinas de estado

### importacion (enum `estado_importacion_excel`)
- **Estados:** pendiente_mapeo, mapeando, procesando, en_revision, completado, error, cancelado, matching_completo
- **Recuperacion desde error ->** cancelado, completado, en_revision, mapeando, matching_completo, pendiente_mapeo, procesando
- **Transiciones:**
 - `pendiente_mapeo` -> cancelado, error, mapeando
 - `mapeando` -> cancelado, completado, en_revision, error, matching_completo, pendiente_mapeo, procesando
 - `procesando` -> cancelado, completado, en_revision, error, matching_completo
 - `completado` -> cancelado, en_revision, mapeando
 - `error` -> cancelado, completado, en_revision, mapeando, matching_completo, pendiente_mapeo, procesando
 - `cancelado` -> pendiente_mapeo
 - `en_revision` -> cancelado, completado, error
 - `matching_completo` -> cancelado, completado, en_revision, error

## Colas (jobs)

### sync_account_catalog
- **Total:** 31 (completed=18, failed=13)
- **WARNING - Fallidos:** 13
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_costos_articulo_recalcular_async, public.trg_mapeo_publicacion_recalcular_async

### sync_stock_mapped
- **Total:** 293 (completed=291, processing=2)
- **Productores:** public.fn_encolar_sync_stock

### sync_item
- **Total:** 7269 (processing=46, completed=7218, pending=5)
- **Pendientes:** 5
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_costos_articulo_recalcular_async, public.trg_mapeo_publicacion_recalcular_async

### sync_stock
- **Total:** 8 (completed=8)
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_costos_articulo_recalcular_async, public.trg_mapeo_publicacion_recalcular_async

### recalc_pricing_bundle
- **Total:** 276 (failed=276)
- **WARNING - Fallidos:** 276
- **Productores:** public.trg_costos_articulo_recalcular_async, public.trg_mapeo_publicacion_recalcular_async

### process_sale
- **Total:** 1983 (completed=1961, processing=22)
- **Productores:** public.fn_encolar_sync_price, public.fn_encolar_sync_price_marketplace, public.fn_encolar_sync_stock, public.trg_costos_articulo_recalcular_async, public.trg_mapeo_publicacion_recalcular_async

## Rutas de pricing (estado)

### v1_precio_recalc_queue — **DEAD**


### v2_marketplace_prices — **LEGACY**


### v3_publication_pricing — **ALIVE**


## Diagnosticos

### INFO

- [QUEUE_NO_RUNTIME] `processes.importacion_precios.downstream`: cola 'sync_price' sin filas observadas en public.jobs — Bloqueo conocido: pricing_data_blocker. No es fallo estructural.

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
  - job=`recalc_pricing_bundle` | handler=`apps/dashboard/src/app/api/worker/process/route.ts` | expect_runtime=`true`
  - fn=`public.fn_recalcular_precio_publicacion` | destino=`publication_pricing_history`
  - job=`sync_price` | handler=`apps/dashboard/src/app/api/worker/process/route.ts` | expect_runtime=`false` | blocked_by=`pricing_data_blocker`
- Recovery: desde `error` -> [`mapeando`, `procesando`, `completado`]

## Salud del blueprint

- Procesos declarados: 1
- Handlers de jobs detectados en worker: 9
- Diagnosticos error: 0
- Diagnosticos warn: 0
- Diagnosticos info: 1

## public.actualizar_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.obtener_ficha_publicada
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 25.00 ms (source: ast_estimator)

## public.update_actualizado_el_column
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_set_marketplace_prices_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.crear_version_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 215.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.buscar_fichas_por_atributo
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 55.00 ms (source: ast_estimator)

## public.obtener_atributos_baja_confianza
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 55.00 ms (source: ast_estimator)

## public.validar_ficha_atributos
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 75.00 ms (source: ast_estimator)

## public.aplicar_extraccion_a_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 615.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas, public.ficha_extracciones
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.calcular_completitud_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 75.00 ms (source: ast_estimator)

## public.trigger_auditoria_ficha
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 305.00 ms (source: ast_estimator)
- **Touches Tables:** public.ficha_auditoria

## public.trigger_historial_precio
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 155.00 ms (source: ast_estimator)
- **Touches Tables:** public.historial_precios

## public.trigger_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_sync_sku_from_articulo_id
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_encolar_sync_price
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 175.00 ms (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.update_updated_at_column
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.decrement_stock_safe
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 375.00 ms (source: ast_estimator)
- **Touches Tables:** public.inventory_transactions, public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.actualizar_estado_mapeo_publicacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 425.00 ms (source: ast_estimator)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.fn_auto_create_inventory_snapshot
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 155.00 ms (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.fn_ensure_snapshot_on_mapping
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 155.00 ms (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.purge_old_failed_jobs
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 105.00 ms (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_encolar_sync_price_marketplace
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 155.00 ms (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_recalcular_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 265.00 ms (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.compute_ingreso_hash
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_encolar_sync_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 225.00 ms (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_sync_reserved_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 445.00 ms (source: ast_estimator)
- **Touches Tables:** public.inventory_snapshot
- **Cascading Triggers:**
 - `inventory_snapshot` -> `public.fn_encolar_sync_stock` (Trigger: trg_encolar_sync_stock)
 - `inventory_snapshot` -> `public.update_updated_at_column` (Trigger: update_inventory_snapshot_updated_at)

## public.update_fecha_modificacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.trg_fn_sync_stock
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)
- **Calls Functions:** public.fn_recalcular_stock

## public.trg_extraer_campos_regulatorios
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_limpiar_publicacion_ml_en_cierre
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 475.00 ms (source: ast_estimator)
- **Touches Tables:** public.articulos
- **Cascading Triggers:**
 - `articulos` -> `public.fn_auto_create_inventory_snapshot` (Trigger: trg_auto_create_inventory_snapshot)
 - `articulos` -> `public.update_actualizado_el_column` (Trigger: set_actualizado_el)

## public.compute_egreso_hash
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.check_missing_snapshots
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 65.00 ms (source: ast_estimator)

## public.release_zombie_jobs
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.92 ms (source: pg_stat_statements)
- **Touches Tables:** public.jobs

## public.update_borradores_updated_at
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_backfill_ingreso_ids
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 635.00 ms (source: ast_estimator)
- **Touches Tables:** public.ingresos
- **Cascading Triggers:**
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_ingreso)

## public.buscar_publicaciones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 45.00 ms (source: ast_estimator)

## public.fn_pop_matching_job
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 6.00 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.matching_jobs

## public.fn_buscar_listas_raw
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 65.00 ms (source: ast_estimator)

## public.fn_recuperar_importaciones_colgadas
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 205.00 ms (source: ast_estimator)
- **Touches Tables:** public.importaciones_excel
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_eliminar_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 325.00 ms (source: ast_estimator)
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
- **Avg Time:** 205.00 ms (source: ast_estimator)
- **Touches Tables:** public.importaciones_excel
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_claim_next_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 425.00 ms (source: ast_estimator)
- **Touches Tables:** public.importaciones_excel, public.SKIP
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.fn_recalcular_precio_marketplace_all
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 175.00 ms (source: ast_estimator)
- **Calls Functions:** public.fn_recalcular_precio_marketplace

## public.fn_watchdog_matching
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 525.00 ms (source: ast_estimator)
- **Touches Tables:** public.importacion_eventos, public.matching_jobs

## public.fn_match_articulo_proveedor
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 65.00 ms (source: ast_estimator)

## public.fn_disparar_edge_procesar_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 45.00 ms (source: ast_estimator)

## public.trg_costos_articulo_recalcular_async
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 175.00 ms (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.trg_mapeo_publicacion_recalcular_async
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 305.00 ms (source: ast_estimator)
- **Touches Tables:** public.jobs

## public.fn_poblar_matching_decisiones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 275.00 ms (source: ast_estimator)
- **Touches Tables:** public.matching_decisiones

## public.f_unaccent_immutable
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 4847.59 ms (source: pg_stat_statements)

## public.fn_consolidar_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 1595.00 ms (source: ast_estimator)
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
- **Avg Time:** 5.00 ms (source: ast_estimator)
- **Calls Functions:** public.fn_recalcular_precio_marketplace

## public.fn_recalcular_precio_marketplace
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 565.00 ms (source: ast_estimator)
- **Touches Tables:** public.marketplace_prices, public.SET
- **Cascading Triggers:**
 - `marketplace_prices` -> `public.fn_set_marketplace_prices_updated_at` (Trigger: trg_marketplace_prices_updated_at)

## public.fn_actualizar_comisiones_reales
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 355.00 ms (source: ast_estimator)
- **Touches Tables:** public.meli_category_commissions, public.SET

## public.fn_resolver_regla_pricing
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 125.00 ms (source: ast_estimator)

## public.trg_recalcular_precio_publicacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 0.29 ms (source: pg_stat_statements)
- **Calls Functions:** public.fn_recalcular_precio_publicacion

## public.fn_recalcular_precio_publicacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 164.34 ms (source: pg_stat_statements)
- **Touches Tables:** public.publication_pricing_history, public.publicaciones_externas
- **Calls Functions:** public.fn_resolver_regla_pricing
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.fn_parse_precio
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 53.98 ms (source: pg_stat_statements)

## public.fn_tg_promote_pendientes
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 575.00 ms (source: ast_estimator)
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
- **Avg Time:** 215.00 ms (source: ast_estimator)

## public.update_actualizado_el
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 5.00 ms (source: ast_estimator)

## public.fn_guard_completado_importacion
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 25.00 ms (source: ast_estimator)

## public.fn_resolver_y_poblar_costos
- **Security:** DEFINER
- **Timeout Override:** statement_timeout=180s
- **Avg Time:** 196689.53 ms (source: pg_stat_statements)
- **Touches Tables:** public.costos_articulo, public.costos_pendientes, public.SET
- **Calls Functions:** public.f_unaccent_immutable
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_consolidar_revision_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 1735.00 ms (source: ast_estimator)
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
- **Avg Time:** 20541.45 ms (source: pg_stat_statements)
- **Touches Tables:** public.costos_articulo, public.costos_pendientes, public.matching_jobs, public.SET, public.proveedor_articulos_alias, public.importaciones_excel, public.listas_precios_raw_staging
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
- **Avg Time:** 25.00 ms (source: ast_estimator)

## public.recalcular_par_item_id
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 177.98 ms (source: pg_stat_statements)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.recalcular_catalog_count
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 52.55 ms (source: pg_stat_statements)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.recalcular_associated_count
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 52.19 ms (source: pg_stat_statements)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.vincular_ficha
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 245.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.desvincular_ficha
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 225.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.eliminar_ficha_completa
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 225.00 ms (source: ast_estimator)
- **Touches Tables:** public.ficha_extracciones, public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.desvincular_ficha_articulo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 225.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.upsert_ingreso
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 355.00 ms (source: ast_estimator)
- **Touches Tables:** public.ingresos, public.SET
- **Cascading Triggers:**
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_ingreso)
 - `ingresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_ingreso)

## public.actualizar_campos_regulatorios
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 205.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.fn_validar_transicion_estado_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 25.00 ms (source: ast_estimator)

## public.eliminar_ficha_borrador
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 225.00 ms (source: ast_estimator)
- **Touches Tables:** public.ficha_extracciones, public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.vincular_ficha_articulo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 245.00 ms (source: ast_estimator)
- **Touches Tables:** public.fichas_tecnicas
- **Cascading Triggers:**
 - `fichas_tecnicas` -> `public.trigger_auditoria_ficha` (Trigger: trigger_ficha_auditoria)
 - `fichas_tecnicas` -> `public.update_fecha_modificacion` (Trigger: trigger_update_fecha_modificacion)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_campos_regulatorios)
 - `fichas_tecnicas` -> `public.trg_extraer_campos_regulatorios` (Trigger: trg_extraer_campos_regulatorios)

## public.fix_par_item_id_faltantes
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 205.00 ms (source: ast_estimator)
- **Touches Tables:** public.publicaciones_externas
- **Cascading Triggers:**
 - `publicaciones_externas` -> `public.trg_recalcular_precio_publicacion` (Trigger: trg_recalcular_precio_publicacion)
 - `publicaciones_externas` -> `public.fn_limpiar_publicacion_ml_en_cierre` (Trigger: trg_limpiar_publicacion_ml)

## public.guardar_ficha_autoficha
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 1275.00 ms (source: ast_estimator)
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
- **Avg Time:** 415.00 ms (source: ast_estimator)
- **Touches Tables:** public.egresos
- **Cascading Triggers:**
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_egreso)

## public.fn_resumen_matching
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 25.00 ms (source: ast_estimator)

## public.fn_watchdog_importaciones
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 925.00 ms (source: ast_estimator)
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
- **Avg Time:** 605.00 ms (source: ast_estimator)
- **Touches Tables:** public.matching_decisiones, public.costos_articulo
- **Cascading Triggers:**
 - `costos_articulo` -> `public.fn_tg_encolar_recalculo` (Trigger: tg_encolar_recalculo)
 - `costos_articulo` -> `public.update_actualizado_el` (Trigger: trg_costos_articulo_actualizado_el)
 - `costos_articulo` -> `public.trg_costos_articulo_recalcular_async` (Trigger: trigger_recalcular_precios_async)

## public.fn_tg_encolar_recalculo
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 155.00 ms (source: ast_estimator)
- **Touches Tables:** public.precio_recalc_queue

## public.fn_revertir_importacion
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 815.00 ms (source: ast_estimator)
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
- **Avg Time:** 53.98 ms (source: pg_stat_statements)
- **Touches Tables:** public.listas_precios_proveedor

## public.upsert_egreso
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 355.00 ms (source: ast_estimator)
- **Touches Tables:** public.egresos, public.SET
- **Cascading Triggers:**
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_update_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_insert_egreso)
 - `egresos` -> `public.trg_fn_sync_stock` (Trigger: trg_stock_after_delete_egreso)

## public.claim_precio_recalc
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 445.00 ms (source: ast_estimator)
- **Touches Tables:** public.SKIP, public.precio_recalc_queue

## public.claim_jobs
- **Security:** INVOKER
- **Timeout Override:** None
- **Avg Time:** 8.62 ms (source: pg_stat_statements)
- **Touches Tables:** public.SKIP, public.jobs

## public.fn_recalcular_lote
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 22.75 ms (source: pg_stat_statements)
- **Touches Tables:** public.precios_publicados, public.ml_publicacion_sync_queue, public.SET

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
- **Avg Time:** 56.38 ms (source: pg_stat_statements)
- **Touches Tables:** public.listas_precios_raw, public.listas_precios_proveedor, public.importaciones_excel, public.listas_precios_raw_staging
- **Calls Functions:** public.fn_resolver_y_poblar_costos
- **Cascading Triggers:**
 - `importaciones_excel` -> `public.fn_validar_transicion_estado_importacion` (Trigger: trg_validar_transicion_importacion)
 - `importaciones_excel` -> `public.fn_guard_completado_importacion` (Trigger: trg_guard_completado_importacion)
 - `importaciones_excel` -> `public.fn_disparar_edge_procesar_importacion` (Trigger: trg_disparar_worker_importacion)

## public.procesar_import_job
- **Security:** DEFINER
- **Timeout Override:** None
- **Avg Time:** 17.85 ms (source: pg_stat_statements)
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
- **Avg Time:** 22.75 ms (source: pg_stat_statements)
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

