# Módulo de Precios — Fase 0

Este módulo implementa el flujo lineal y persistente de actualización de listas de precios del proveedor (Fase 0).

## Arquitectura de 3 Fases (Pipeline Global)
- **Fase 0:** Actualizar lista de precios del proveedor (Este módulo)
- **Fase 1:** Catálogo Maestro de productos
- **Fase 2:** Sincronización con Mercado Libre

## Rutas del Módulo
La arquitectura de rutas se diseñó para seguir un Diseño Orientado a Tareas con Fases en Orden Lógico. No hay pestañas paralelas ni menús ocultos.

- `/precios` - Lista global de proveedores
- `/precios/[proveedor]` - Hub del proveedor. Muestra la lista de precios vigente (los 4 tiers), la fecha de la última actualización, el IVA aplicable y permite el recálculo masivo o individual de las publicaciones relacionadas.
- `/precios/[proveedor]/subir` - **Paso 1:** Interfaz Dropzone para subir la última lista de precios del proveedor en Excel.
- `/precios/[proveedor]/revisar` - **Paso 2:** El corazón de la auditoría. Muestra las diferencias calculadas entre la lista vigente y la nueva lista subida. Agrupa los cambios por producto usando `<ProductDiffCard />` e implementa métricas exactas (Δ$, Δ%) para que el operador tome una decisión.
- `/precios/[proveedor]/aplicar` - **Paso 3:** Resumen pre-confirmación y ejecución final. Una vez confirmado, se actualiza el estado de las publicaciones (`vigente = true`) y se encola la sincronización asíncrona hacia Mercado Libre.
- `/precios/[proveedor]/historico` - Historial de lotes anteriores con opción de revertir a un punto de control.
- `/precios/[proveedor]/reglas` - Configuración de rentabilidad del proveedor (márgenes, retenciones, etc).

## Detalles Técnicos
1. **`<PricingTimeline />`:** Componente persistente inyectado en el Layout. Sus 3 nodos derivan estado automáticamente en SWR usando `/api/precios/flow-state`.
2. **`v_lista_precios_proveedor`:** Vista maestra que consolida los 4 tipos de costo en una fila por SKU.
3. Atajos de teclado del flujo de tareas (`1`, `2`, `3`) globales y excluyentes de campos editables.
