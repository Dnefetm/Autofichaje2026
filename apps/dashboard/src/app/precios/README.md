# Módulo de Precios — Flujo vigente

Este módulo actualiza las listas de precios del proveedor y las vincula con el catálogo maestro.

## Flujo vigente (Flujo B)

1. `/precios` — Lista de proveedores.
2. `/precios/[proveedor]` — Hub: catálogo vigente + buscar + actualizar.
3. `/precios/[proveedor]/subir` — Subir Excel.
4. `/precios/[proveedor]/mapear` — Mapear columnas.
5. `/precios/[proveedor]/matching` — Motor de matching.
6. `/precios/[proveedor]/historial` — Historial de lotes (activar/restaurar/eliminar).
7. `/precios/[proveedor]/historial/[id]/resumen` — Resumen del lote (nuevos/actualizados/descontinuados) + botón "Auditar cambios".
8. `/precios/[proveedor]/historial/[id]/vinculacion` — Vincular con catálogo (aceptar/ignorar/desvincular).
9. `/precios/[proveedor]/revisar` — Auditoría detallada de diferencias de precio (viejo vs nuevo, Δ$ y Δ%).
10. `/precios/[proveedor]/reglas` — Reglas de rentabilidad.

## Deprecado

- `/precios/[proveedor]/aplicar` — DEPRECADO. Su trabajo lo cubren "Activar como Vigente" (resumen) y el trigger que marca precios vigentes al vincular. Usaba un estado inválido (`'aplicado'`).
- `PricingTimeline` — DEPRECADO. La barrita de pasos del flujo anterior no se monta en ningún layout.

## Distinción clave de entidades

- **Producto de la lista de precios** (`importacion_id` + `fila_num`): fila del Excel del proveedor. Acciones: vincular, ignorar, desvincular.
- **Producto del catálogo** (`articulo_id`): artículo del catálogo maestro. Acciones: precio/costo, activo/descontinuado.
- *Vincular/ignorar/desvincular* actúan sobre el **vínculo** entre ambos, no borran el artículo ni su precio.
