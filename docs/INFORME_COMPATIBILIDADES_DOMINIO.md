# Informe de validación — Compatibilidades User Products (MLM): dominio inválido

**Fecha:** 2026-10-21
**Objeto:** Documentar el fallo `domain_id: invalid domain id` al enviar compatibilidades a una publicación User Products de México (MLM), y la corrección implementada.

---

## 1. Hechos de la publicación (verificados en base de datos)

| Campo | Valor |
|---|---|
| `external_item_id` | `MLM6424568876` |
| `user_product_id` | `MLMU5583377798` (la URL es `/up/MLMU5583377798`) |
| `domain_id` del ítem | `MLM-VEHICLE_GEARBOX_MOUNT_BRACKETS` |
| `category_id` | `MLM429553` |
| Modelo de publicación | **User Products (UP)** — el `tags` incluye `user_product_listing` |
| `tags` al publicar | `["good_quality_thumbnail", "incomplete_compatibilities", "user_product_listing", ...]` |

El artículo vinculado (`12012`) sí tiene compatibilidades guardadas en `atributos_especificos.compatibilidades` (TOYOTA HILUX 2019-2021, motor 2.8 DIESEL, OEM 12371-0L210).

---

## 2. Errores reales devueltos por MeLi (en orden)

1. `400` → `{"error":"bad_request","message":"This Item MLM6424568876 has User Product compatibilities. Use the corresponding User Product resources."}`
   - **Corregido:** el envío ahora usa `POST /user-products/{up_id}/compatibilities` (antes usaba `POST /items/{item_id}/compatibilities`, que es para legacy).

2. `400` → `{"details":["domain_id: invalid domain id"],"error":"bad_request","message":"Invalid arguments for specific request. Please check details to satisfy validations"}`
   - **Causa:** el `domain_id` enviado en `products_families` no era válido. Se probaron dos valores literales:
     - `MLM-CARS_AND_VANS_FOR_COMPATIBILITIES` → inválido.
     - `MLM-CARS_AND_VANS` → inválido.
   - **Corrección definitiva:** dejar de adivinar y obtener el `compatible_domain_id` real desde el dump oficial.

---

## 3. Fuente de verdad del dominio

El endpoint oficial `GET https://api.mercadolibre.com/catalog/dumps/domains/MLM/compatibilities` lista, por cada dominio de ítem, su `compatible_domain_id` (tipo `EXTENSION`). Es el único valor confiable para `products_families[].domain_id`.

Ejemplo de estructura documentada por MeLi (site Brasil, análogo para MLM):

```json
[
  [{
    "domain_id": "MLB-VEHICLE_ALTERNATOR_BRACKETS",
    "compatibilities": [
      { "compatible_domain_id": "MLB-CARS_AND_VANS", "type": "EXTENSION", ... }
    ]
  }]
]
```

---

## 4. Corrección implementada

1. Nuevo método `MeliAdapter.getCompatibleDomainId(accountId, itemDomainId)`: consulta el dump `GET /catalog/dumps/domains/MLM/compatibilities` con el token del vendedor, busca el dominio del ítem y devuelve su `compatible_domain_id` (de tipo `EXTENSION`). Si falla, devuelve `null`.

2. `resolveCompatibilityFamilies(accountId, aplicaciones, itemDomainId)` ahora resuelve el dominio dinámicamente (fallback `MLM-CARS_AND_VANS`).

3. El flujo de publicación (paso 12.5) y el endpoint `POST /api/catalog/external/[id]/apply-compatibilities` pasan el `domain_id` del ítem para que el resolutor consulte el dump.

4. Para la publicación existente, el `user_product_id` se obtiene al vuelo vía `GET /items/{item_id}` si no estaba guardado (publicaciones creadas antes de este fix).

---

## 5. Referencias

- [Compatibilidades entre ítems y productos de Autopartes](https://developers.mercadolibre.com.ar/es_ar/api-prediccion-categorias/compatibilidades-entre-items-y-productos)
- [Referencias de dominios, productos y atributos para Autopartes](https://developers.mercadolibre.com.sv/es_ar/categorias-y-publicaciones/referencias-de-dominios-productos-y-atributos-para-autopartes)
- [Compatibility between items and vehicle accessories (EN)](https://developers.mercadolibre.com.ar/en_us/listing-types-item-upgrades-tutorial/compatibility-between-items-and-vehicle-accessories)

---

## 6. Estado para validación externa

- Queda **pendiente de verificación end-to-end**: al re-aplicar, el resolutor debe consultar el dump y obtener el `compatible_domain_id` real (distinto de los dos literales que fallaron). Si con el dominio correcto MeLi acepta el `products_families`, la publicación debe perder el tag `incomplete_compatibilities`.
