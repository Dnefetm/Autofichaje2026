# Especificación — Módulo Masivo de Copia Multi-Cuenta (Replicación de Vitrinas)

> Documento de validación adicional. Consolida diagnóstico, escenarios operativos y riesgos críticos. Estado: **pendiente de autorización de Fase 1**.

---

## 1. Objetivo

Replicar publicaciones (tradicional + catálogo) desde una cuenta origen (Histofarma) hacia una cuenta destino (Mejorísimo), en bloques de 50, de forma **asíncrona, idempotente, monitoreable y reversible**.

---

## 2. Diagnóstico (causa raíz del fallo de catálogo)

Verificado en `apps/dashboard/src/app/api/publish/route.ts`:

1. **UI reescribe fotos a `-F.jpg`** → rompe el match de `picture_ids` en `sourceIdByUrl` → fuerza re-subida.
2. **MeLi crea la tradicional en `paused`** con sub-estado `picture_download_pending` mientras procesa imágenes.
3. **Sondeo local de 20s** (`maxEsperaMs = 20000`) expira antes de que MeLi active las imágenes (real: 25s–varios minutos).
4. **`optinCatalogListing()` sin `try/catch`** (línea ~1272): MeLi responde `400 "Item must be active to optin"` → **crash 500**.
5. **Impacto:** tradicional queda huérfana en MeLi, sin persistencia en `publicaciones_externas` ni `mapeo_publicacion_articulo`.

---

## 3. Universo de datos (conteos verificados en vivo)

| Métrica | Cuenta 1 (Histofarma) | Cuenta 2 (Mejorísimo) |
|---|---|---|
| Tradicional activa | 3,925 | 52 |
| Catálogo activa | 2,574 | 27 |
| Tradicional mapeada | 2,425 | — |
| **Candidatas netas a copiar** | **2,337** (1,746 con catálogo = 74.7%) | — |

Bloques de 50 → **19 bloques** (18×50 + 1×17).

---

## 4. Escenarios operativos (8, del diseño base)

1. **Optin de catálogo asíncrono:** persistir tradicional + mapeo aunque el optin falle; encolar reintento.
2. **409 conflict:** vincular publicación preexistente en destino (extraer ID de `cause.references`).
3. **Variaciones:** replicar `variations[]` y emparejar `variation_id` al catálogo.
4. **422 poison pill:** aislar el ítem sin tumbar el lote; badge "atributos faltantes".
5. **Reglas de precio entre cuentas:** política destino vs heredar origen, con advertencia de `sin_costo`.
6. **Stock Full vs local:** no inventar stock sobre inventario Full de otra cuenta.
7. **Selección persistente entre páginas:** `Set` global que no se vacía al paginar/filtrar.
8. **Idempotencia:** dedup + `ON CONFLICT DO NOTHING` + auditoría.

---

## 5. Riesgos críticos adicionales (7) y solución acordada

### 5.1 Sobreventa de stock físico (doble venta)
- **Aislamiento estricto de Full:** stock destino solo de bodega propia: `stock_destino = articulos.disponibles - unidades_en_full`.
- **Buffer anti-race:** stock=1 → solo cuenta principal; stock≥2 → ambas con decremento atómico.
- **Decremento atómico:** `SELECT ... FOR UPDATE` en `inventory_snapshot` dentro de la transacción del webhook.
- ⚠️ **Riesgo residual (no eliminable con esta arquitectura):** la latencia del webhook `orders_v2` (1–3s) deja una ventana de sobreventa. Solo se elimina por completo no compartiendo el mismo físico entre cuentas o particionando stock determinísticamente.

### 5.2 Rollback / deshacer lote
- `batch_id` UUID en publicaciones, mapeos y jobs.
- **Nivel 1 (pausa de emergencia):** `PUT /items/{id}` `{status:'paused'}` en <5s.
- **Nivel 2 (rollback completo):** `{status:'closed'}` + desvincular + respaldo en `mapeo_desvinculados_log` (motivo `rollback_lote_masivo`).

### 5.3 Rate limit 429
- Throttling `inter_item_delay = 250ms`.
- Interceptor 429: leer `Retry-After`; si no, backoff exponencial + jitter `base × 2^intento + random(100–500ms)`; máx 3 reintentos locales.

### 5.4 Expiración de token
- `getAccessToken()` ya renueva con margen 5 min (`marginMs`).
- 401: limpiar caché → `performRefresh(accountId)` → 1 reintento transparente; si persiste, detener lote y notificar.

### 5.5 Reintento de optin (backoff progresivo)
- 4 intentos: +60s → +3min → +8min → +20min.
- En cada intento: `GET /items/{id}`; si `active` → optin; si tras 20min sigue pausado → `failed` con motivo, tradicional viva.

### 5.6 Monitor de lote (panel, no toast)
- Drawer con: ID lote, destino, total, barra de progreso, badges (exitosas / esperando optin / 409 resueltos / errores), tabla por ítem con motivo, botones "Pausar Lote" / "Revertir Lote".

### 5.7 Llave de idempotencia correcta
- `idempotency_key = hash(articulo_id, target_marketplace_id)` (NO `source_pub_id`).
- `ON CONFLICT (articulo_id, target_marketplace_id) DO NOTHING`.

---

## 6. Plan por fases

- **Fase 1 (autorizable ya):** corrección quirúrgica de catálogo — `try/catch` en `optinCatalogListing`, persistencia de tradicional + mapeo, job de reintento de optin, preservar `id_producto_catalogo` y URLs crudas en `publish-panel.tsx`.
- **Fase 2:** RPC `fn_publicaciones_pendientes_replicar` (consulta asimétrica indexada).
- **Fase 3:** vista `/catalog/replicar` (bloques de 50, selección múltiple).
- **Fase 4:** endpoint `POST /api/catalog/replicar/batch` + worker con las 7 soluciones de §5.
- **Fase 5:** Gate 2 (tsc 0 errores + copia de prueba de 1 bloque real).

---

## 7. Checklist de aceptación (Gate 2)

- [ ] `tsc --noEmit`: 0 errores.
- [ ] Copia de 1 bloque real: tradicional + catálogo vinculados y activos en destino.
- [ ] Optin diferido funciona (job `catalog_optin` con backoff).
- [ ] 409 vincula preexistente sin duplicar.
- [ ] 422 aísla poison pill sin tumbar el lote.
- [ ] Monitor muestra estado y motivo por ítem.
- [ ] Rollback pausa/cierra el lote.
- [ ] Regresión vitrinas activas: 0.
