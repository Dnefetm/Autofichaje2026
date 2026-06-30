# Plan de Resolucion - Logica de Precios de Proveedor (Importacion Excel)

**Fecha de diagnostico:** 2026-06-29  
**Estado:** Causa raiz identificada - Pendiente de implementacion  
**Proveedor afectado (caso testigo):** Urrea Herramientas  
**Importacion congelada:** `33a6ab00-c7c7-4451-baec-dec99fff6ef9` (15,360 filas)

---

## 1. Diagnostico (causa raiz)

Las importaciones grandes (~15K filas) **nunca pasan de la etapa STAGING**.
Evidencia medida en la importacion testigo:

| Metrica | Valor |
| --- | --- |
| Filas en `listas_precios_raw_staging` (cuarentena) | 15,360 (todas) |
| Filas promovidas a `listas_precios_raw` | 0 |
| `costos_articulo` poblados | 0 |
| `costos_pendientes` | 0 |
| Alias con articulo (Urrea) | 2,498 |

- Las importaciones chicas (99 filas) -> si llegan a `completado` / `en_revision`.
- Las grandes (15,343 / 15,360) -> quedan en `mapeando`, `cancelado` o `error`.
- El **tamano** es la variable que rompe el flujo.

**Mecanismo del fallo:**
`fn_preparar_importacion_revision` -> llama a `fn_resolver_y_poblar_costos`, que tiene `statement_timeout = 180s`. Esta funcion:

1. Hace match de alias con `lower(f_unaccent_immutable(trim(...)))` en **ambos lados del JOIN** -> no indexable -> normaliza fila por fila contra 2,498 alias.
2. Expande cada fila por columna de precio con `jsonb_array_elements` + regex numerica.

Con 15K filas excede 180s -> **rollback completo** -> todo queda en staging y el estado nunca avanza. El cron worker corre OK (200 OK ~13-15s); el problema NO es el worker.

---

## 2. Tareas en orden de prioridad

### T1 - Indice sobre modelo normalizado (impacto alto, riesgo bajo) -- PRIMERO

- [ ] Crear indice de expresion `lower(f_unaccent_immutable(trim(...)))` en `proveedor_articulos_alias` (campos `codigo_excel` y `modelo_excel`).
- [ ] Validar con EXPLAIN ANALYZE que el planner usa el indice en el JOIN de matching.
- [ ] Medir tiempo de `fn_resolver_y_poblar_costos` aislado sobre las 15,360 filas.
- **Resultado esperado:** el costeo entra dentro de 180s sin tocar la arquitectura.
- **Validacion / resultado real:** ___________

### T2 - Batching / chunking del costeo (impacto alto, riesgo medio)

- [ ] Refactorizar `fn_resolver_y_poblar_costos` (o el worker) para procesar en lotes (ej. 2,000 filas por corrida) en vez de todo en una sola transaccion.
- [ ] Hacer el paso idempotente y reanudable (cursor por `fila_num`).
- [ ] Verificar que el worker avanza el estado por lotes hasta `en_revision`.
- **Resultado esperado:** importaciones de cualquier tamano completan sin timeout.
- **Validacion / resultado real:** ___________

### T3 - Recuperar la importacion atorada actual (impacto inmediato)

- [ ] Con T1 (y/o T2) aplicado, re-disparar `fn_preparar_importacion_revision('33a6ab00-...','Urrea Herramientas')`.
- [ ] Confirmar: staging->raw promovido, `costos_articulo` poblado, estado `en_revision`.
- **Validacion / resultado real:** ___________

### T4 - Parche de contingencia: subir timeout (impacto bajo, fragil) -- SOLO SI URGE

- [ ] Subir temporalmente `statement_timeout` de `fn_resolver_y_poblar_costos`.
- **Nota:** parche temporal; volvera a tronar con listas mayores. Revertir tras T1/T2.
- **Validacion / resultado real:** ___________

### T5 - Higiene de datos (impacto medio, preventivo)

- [ ] Limpiar/cerrar importaciones viejas en `cancelado` / `error` (15,343 filas).
- [ ] Confirmar que no quedan filas huerfanas en `listas_precios_raw_staging`.
- **Validacion / resultado real:** ___________

---

## 3. Reglas de ejecucion

- Aplicar **un cambio a la vez** y validar de forma aislada antes del siguiente.
- No modificar arquitectura / infra sin autorizacion explicita.
- Cada tarea se tacha SOLO tras validar su resultado real (no asumido).

## 4. Bitacora de validacion

| Fecha | Tarea | Accion | Resultado medido |
| --- | --- | --- | --- |
|  |  |  |  |
