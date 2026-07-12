# Mapeo del Pipeline de Precios — Autofichaje2026

> Documento de referencia del flujo de datos de precios: desde la lista cruda del proveedor hasta el precio publicado en marketplace. Ultima verificacion en produccion: 2026-07-12.

## 1. Resumen del flujo (10 etapas)

```
[1] listas_precios_raw            (Excel crudo cargado)
        |
[2] precios_proveedor_actual      (precios crudos por codigo de proveedor)
        |
[3] importaciones_excel           (lote de importacion, estado=completado)
        |
[4] matching_jobs                 (trabajo de emparejar codigo -> articulo)
        |
[5] matching_decisiones           (decision codigo_proveedor -> articulo_id)
        |
[6] costos_pendientes             (staging de costos por resolver)
        |
[7] costos_articulo               (costos RESUELTOS con articulo_id)  <-- clave
        |
[8] listas_precios_proveedor      (control: cual lista esta vigente=true)
        |
[9] v_precio_vigente_sku          (VISTA: precio vigente por articulo)
        |
[10] precios_publicados           (precio final publicado a marketplace)
```

## 2. La relacion correcta NO es por codigo de texto

Error comun: intentar unir `precios_proveedor_actual.codigo` con `articulos.codigo_universal` o `articulos.codigos_marketplace`. Esto da 0 coincidencias y es lo esperado, porque son espacios de identificadores distintos:

- `precios_proveedor_actual.codigo` = numero de parte del fabricante (ej: `10552`, `347`, `CLR02`, `GAVA1`).
- `articulos.codigo_universal` = codigo de barras EAN-13 (ej: `660731917116`).
- `articulos.codigos_marketplace` = ARRAY de SKUs de marketplace (ej: `{ZCHW18929}`); NULL para muchos articulos Urrea.

La union real se hace por **`articulo_id`**: el codigo del proveedor se resuelve a un `articulo_id` durante el matching (etapas 4-5) y ese id viaja a `costos_articulo` (etapa 7), que SI se une a `articulos.articulo_id`.

## 3. Definicion de la vista de precio vigente

`v_precio_vigente_sku` une:
- `costos_articulo` (ca) JOIN `importaciones_excel` (ie) por `importacion_id`
- LEFT JOIN `articulos` (a) por `a.articulo_id = ca.articulo_id`
- JOIN a la lista vigente (CTE `lote_vigente` = `listas_precios_proveedor` WHERE `vigente=true`)
- Filtra `ie.estado='completado'` y `ca.articulo_id IS NOT NULL`.

Consecuencia: si `costos_articulo` esta vacio O no hay lista con `vigente=true`, la vista devuelve 0 filas aunque existan precios crudos.

## 4. Estado verificado en produccion (2026-07-12)

| Etapa | Tabla | Filas | Estado |
|---|---|---|---|
| 2 | precios_proveedor_actual | 15043 | OK |
| 3 | importaciones_excel (completado) | 3 | OK |
| 6 | costos_pendientes | 0 | vacio |
| 7 | costos_articulo | 0 | VACIO - causa raiz |
| 8 | listas_precios_proveedor (vigente=true) | 0 | VACIO - causa raiz |
| 9 | v_precio_vigente_sku | 0 | sin datos (consecuencia) |

## 5. Diagnostico

Llegaron 15,043 precios crudos, pero la cadena resuelta esta vacia: `costos_articulo` sin filas y ninguna lista marcada como vigente. Por eso no hay precios visibles por articulo, aunque el matching por codigo "parezca" fallar (no es el mecanismo real).

## 6. Acciones correctivas pendientes (requieren autorizacion para escribir datos)

1. Revisar por que las importaciones completadas no dejaron filas en `costos_articulo` (auditar `matching_decisiones` / `matching_resultados`).
2. Re-ejecutar la consolidacion (`fn_consolidar_matching_decisiones`, ya corregida) para poblar `costos_articulo`.
3. Marcar la lista correspondiente como `vigente=true` en `listas_precios_proveedor`.

## 7. Herramienta visual

El estado en vivo de estas 10 etapas se visualiza en el dashboard en la ruta `/pipeline` (pagina `apps/dashboard/src/app/pipeline/page.tsx`), pensada para supervisor y programador, sin necesidad de SQL.
