# Módulo de Precios — Flujo vigente

Este módulo procesa la lista de precios del proveedor de forma **AUTÓNOMA**, independiente
del catálogo. La vinculación con el catálogo es un **flujo separado y opcional**.

## Modelo (dos mundos separados)

- **Mundo 1 — Precios del proveedor**: subir → mapear → procesar (cambios de precio,
  artículos nuevos creados DENTRO del módulo, descontinuación, vigencia) → auditar → activar.
  Todo se guarda en `precios_proveedor`.
- **Mundo 2 — Vinculación con catálogo**: enlazar artículo-del-proveedor con
  artículo-del-catálogo. Separado y opcional; solo cuando el operador lo decida.

## Flujo vigente (Mundo 1 — procesamiento de precios)

1. `/precios` — Lista de proveedores.
2. `/precios/[proveedor]` — Hub: catálogo vigente + buscar + actualizar.
3. `/precios/[proveedor]/subir` — Subir Excel.
4. `/precios/[proveedor]/mapear` — Mapear columnas → ejecuta `fn_procesar_precios_proveedor`
   (clasifica nuevo/actualizado/sin_cambio/descontinuado contra la lista anterior, usando las columnas mapeadas).
5. `/precios/[proveedor]/historial` — Historial de lotes.
6. `/precios/[proveedor]/historial/[id]/resumen` — Resumen (nuevos/actualizados/descontinuados) + botón "Activar como Vigente".
7. `/precios/[proveedor]/revisar` — Auditoría viejo-vs-nuevo (Δ$ y Δ%), con aprobar/rechazar.
8. `/precios/[proveedor]/reglas` — Reglas de rentabilidad.

## Flujo separado (Mundo 2 — vinculación, OPCIONAL)

- `/precios/[proveedor]/historial/[id]/vinculacion` — Vincular con el catálogo (aceptar/ignorar/desvincular).
- El matching se dispara **solo desde aquí** (iniciar-matching), nunca automáticamente al procesar la lista.

## Deprecado

- `/precios/[proveedor]/aplicar` — DEPRECADO. Su trabajo lo cubre "Activar como Vigente".
- `PricingTimeline` — DEPRECADO (barra de pasos del flujo anterior).
- `/precios/[proveedor]/historial/[id]/confirmar` — LEGACY (lee `costos_articulo`); a deprecar en una entrega posterior.

## Distinción clave de entidades

- **Artículo del proveedor** (`sku_proveedor` en `precios_proveedor`): fila del Excel del
  proveedor. Acciones: procesar precio, crear (nuevo), descontinuar, marcar vigencia.
- **Artículo del catálogo** (`articulo_id`): artículo del catálogo maestro.
- **Vínculo** (`proveedor_articulos_alias`): enlace OPCIONAL entre el artículo del proveedor
  y el del catálogo. No participa en el procesamiento de la lista.

## Validación externa

Ver `docs/VALIDACION_PRECIOS_PROVEEDOR.md` (modelo antes/después, migración con rollback,
validación triplicada código+datos+comportamiento).
