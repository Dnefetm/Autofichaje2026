# Reposición Full — Diseño y estado (T1 Logística Full)

> Sustituye el módulo local basado en archivos por una versión server-side, multi-cuenta,
> conectada directo a la API de MeLi. La sugerencia de ML es **solo referencia** (no entra en cálculos).

## 1. Fuentes de datos (sin archivos)

| Dato | Fuente | Estado |
|---|---|---|
| Ventas históricas | `egresos` con `tipo_egreso='venta'` (fecha, cantidad) | ✅ en BD |
| Stock apto (disponible) | `GET /inventories/{id}/stock/fulfillment` → `available_quantity` | ✅ sincronizado a `stock_full` |
| Stock efectivo (aptas + tránsito + pendientes) | `GET /marketplace/fbm/user-products/{upid}/replenishment` → `stock.total_stock` | ⏳ requiere migración (columna `stock_full_total`) |
| Sugerencia ML (referencia) | `recommendation.suggested_quantity` | ⏳ requiere migración |
| Urgencia | `stock.shipping_urgency` (`URGENT`, `THIS_WEEK`, `NEXT_WEEK`, `IN_TWO_WEEKS`, `NO_URGENCY`, `EXCEDENT`) | ⏳ requiere migración |
| Ventas 30d nativas (ML) | `sales.sales_totals.units_sold[].full` | ⏳ requiere migración |

`user_product_id` se obtiene de `/items/{id}` → `user_product_id` (ej. `MLMU1015139142`).

## 2. Algoritmo de reposición

```
StockEfectivo = aptas + en transferencia + pendientes de ingreso   (= stock.total_stock)
DemandaDiaria = Demanda / 30
UnidadesRecomendadas = max(0, DemandaDiaria × CoberturaDeseada − StockEfectivo)
CoberturaActual   = StockEfectivo / DemandaDiaria   (días)
```

### Métodos de proyección de demanda (4, configurables)

| Método | Demanda | Uso |
|---|---|---|
| `ultimo_mes` | V30 (ventas últimos 30 días) | ver el pico crudo |
| `historico_promedio` | promedio 6 meses | diluir el pico |
| `historico_mediana` | mediana semanal × 4.33 | eliminar picos irregulares (conservador) |
| `hibrido` (default) | `min(V30, (V30 + promedio6m)/2)` | balanceado, limitado a V30 |

### Parámetros configurables

- **Cobertura deseada** (días, default 30; input en la página).
- **Método de proyección** (selector, default `hibrido`).

## 3. Señales visuales

- ✅ verde = mi cálculo coincide con ML (o sobre-stock → 0).
- ⚠️ amarillo = difiere de ML → mostrar ambas cifras.
- ❌ rojo = cobertura actual < cobertura deseada → riesgo de quiebre.
- Fila por urgencia (`URGENT`/`THIS_WEEK` rojo, `NEXT_WEEK`/`IN_TWO_WEEKS` naranja, resto verde).

## 4. Pantalla (orientada al usuario)

`/logistica-full`:
1. Selector de **cuenta** (pendiente de implementar; hoy el sync recorre todas las activas).
2. Botones: **Sincronizar stock** + **Exportar CSV**.
3. **Resumen**: artículos Full · requieren envío · total sugerido.
4. **Controles**: cobertura (input) + método (selector).
5. **Tabla de propuesta**: Artículo · Stock efectivo · Ventas 30d · Demanda · Cobertura · A enviar · ML (ref) · Urgencia.
6. **Workflow de envíos** (por `guia`): Pendiente → Reunido → Preparado, con botones por envío.

## 5. Workflow (reunir → preparar → salida)

- Egresos `tipo_egreso='envio_full'` agrupados por **`guia`** (número de envío de ML). `importacion_full_id` es único por egreso.
- Estados: `edo_reunido` = `NULL → 'Reunido' → 'Preparado'` (+ `fecha_reunido`, `fecha_preparado`).
- Avance vía RPC `web_upsert_egreso` (preserva campos, sincroniza a Sheets vía outbox).

## 6. Endpoints construidos

| Endpoint | Función |
|---|---|
| `POST /api/logistica-full/sync` | sincroniza stock Full + replenishment (por cuenta) |
| `GET /api/logistica-full/propuesta?cobertura=&metodo=` | propuesta de reposición |
| `GET /api/logistica-full/lotes` | envíos agrupados por `guia` |
| `GET/POST /api/logistica-full/envio` | detalle y avance de estado de un envío |

## 7. Migración pendiente (requiere aplicarla el usuario)

`supabase/migrations/20260915000000_reposicion_full.sql` agrega columnas:
`user_product_id`, `stock_full_total`, `replenishment_suggested`, `shipping_urgency`, `replenishment_deadline`, `sales_30d_full`, `replenishment_updated_at`.

## 8. Pendientes

1. **Aplicar migración** (usuario) → habilita stock efectivo real + sugerencia ML + urgencia.
2. **PDF → egresos** (importar): requiere definir el formato del PDF de ML.
3. **Automatización**: cron/worker para ejecutar el sync periódicamente (hoy es manual vía botón).
4. **Selector de cuenta** en la página (multi-cuenta explícito).
