# Mapa Detallado del Flujo de Actualización de Precios (Fase 0 y Fase 1)

Este documento detalla el ciclo de vida completo de la importación y actualización de listas de precios de proveedores, mapeando la arquitectura del Backend (PostgreSQL, Supabase Edge Functions) con los puntos de control del Frontend (Next.js). Está estructurado como evidencia técnica y guía de validación para Comet.

---

## FASE 0: Ingesta, Procesamiento y Monitoreo del Excel

### 1. Ingesta y Parseo Eficiente (Edge Function)
**Responsable:** `supabase/functions/procesar-importacion/index.ts`
* **Trigger:** El usuario sube el Excel actualizado desde `/precios/importar`. Se crea un registro en `importaciones_excel` en estado `pendiente_mapeo` que luego transiciona a `mapeando`.
* **Procesamiento:** 
  * Se descarga el archivo en memoria (`Uint8Array`).
  * **Evidencia de optimización:** Se utiliza `dense: true` y opciones ligeras en SheetJS para evitar colapsar la memoria (Vercel CPU saturation rules).
  * **Filtros Anti-Basura:** Se aplica explícitamente `blankrows: false` en `sheet_to_json` y la regla estricta de código: `if (Object.keys(payload).length === 0) continue;`. Esto garantiza que archivos de 99 filas reales no arrastren "filas fantasma" debido a estilos remanentes del Excel.
  * **Cuarentena (Staging):** Las filas limpias se envían a la tabla temporal `listas_precios_raw_staging` mediante `flushChunk()`.
* **Cierre de fase:** Al terminar, la Edge Function invoca de forma atómica el RPC `fn_preparar_importacion_revision`.

### 2. Motor de Matching y Determinación de Vigencia (Base de Datos)
**Responsable:** `fn_match_precios_v2` (Desplegado en Migración V103)
* **Generación de Propuestas:** 
  * Convierte las filas crudas y genera cruces multinivel (0 a 5) desde exacto por código universal hasta uniones difusas (`fuzzy match` >= 55% similitud).
  * Los resultados de este cruce no tocan el catálogo final inmediatamente; se almacenan en `matching_decisiones` (para que el humano los revise).
* **Propagación al Catálogo y Vigencia:**
  * Se generan registros en `costos_articulo` con `articulo_id` nullable (para conservar la lista completa, incluso lo que no hace match).
  * **Punto de Quiebre (Fase 0):** Para mantener la historia sana, se actualizan todas las listas previas del proveedor a `vigente = false` estampando `fecha_vigor_hasta = now()`.
  * **Validación de Integridad:** Solo si la nueva lista generó al menos una decisión válida/candidato, se enciende la nueva lista como `vigente = true`.

---

## FASE 1: Interfaz Humana y Puntos de Control Frontend

El usuario controla toda esta infraestructura a través de un ecosistema Next.js completamente reestructurado para respetar el principio de **"Lista Sana Primero"**. El flujo obsoleto que encadenaba la importación con la revisión en un solo wizard (y causaba fallos JSON) ha sido extirpado de raíz.

### A. Motor de Importación: Mapeo de Columnas (Fase 0 - Final)
**Ruta:** `/precios/importar/page.tsx` y `/precios/matching/page.tsx`
**Rol:** Ingestión de datos crudos sin alterar el catálogo.
* **Proceso Estricto:** El wizard guía al usuario para mapear las columnas del Excel. Una vez finalizado y validadas las reglas de negocio, el flujo se detiene intencionalmente.
* **Confirmación "Lista Sana":** El sistema informa al usuario "Lista Guardada (Lista Sana)" y bloquea cualquier intento de vinculación automática. La información está resguardada en Postgres lista para la decisión humana. El usuario es redirigido al Centro de Mando del proveedor.

### B. El Centro de Mando: Listado Principal y Publicaciones
**Ruta:** `/precios/[proveedor]/page.tsx`
**Rol:** Muestra la realidad actual del catálogo (lo que es "Verdad" y está vigente).

**Vistas y Controles:**
* **Tab 1: Listado Principal (Precios Base)**
  * **Qué consume:** Vista materializada/SQL `v_lista_precios_proveedor`.
  * **Lo que ve el usuario:** Las columnas maestras de la Lista Sana que acaba de procesar.
  * **Control de Excepciones:** Identificador visual de *SKUs Huérfanos* (`row.huerfano = true`) informando al usuario qué artículos de la lista *no* tienen cruce en el catálogo y requieren ser llevados a la "Sala de Operaciones de Matching".
* **Tab 2: Publicaciones Vinculadas (Conexión Mercado Libre)**
  * **Qué consume:** Cruce directo en servidor: `costos_articulo` ↔ `mapeo_publicacion_articulo` ↔ `marketplace_prices` ↔ `precios_publicacion`.
  * **Lo que ve el usuario:** Solo las filas que tienen salida al e-commerce, frente a frente el **Precio Sugerido** vs el **Precio Actual** (token de ML en tiempo real).
  * **Control:** Botón "Aplicar nuevo precio" que invoca al worker de Mercado Libre para sincronizar la plataforma final.

### C. Sala de Operaciones de Matching (Vinculación Humana)
**Ruta:** `/precios/[proveedor]/matching/page.tsx`
**Rol:** La interfaz "Human-in-the-loop" DESACOPLADA del wizard inicial, exclusiva para gestionar falsos positivos o empates antes de dañar el catálogo maestro.

**Vistas y Controles:**
* **Qué consume:** `matching_decisiones WHERE estado='pendiente'`.
* **Lo que ve el usuario:** Una lista limpia de artículos huérfanos comparados contra el `cand_articulo_id` sugerido y su porcentaje de confianza (`pct`).
* **Controles:**
  * Selección por Checkboxes.
  * Botones de Acción Rápida: "Confirmar selección", "Confirmar todos", "Confirmar siguiente lote de 200".
  * **Evidencia en BD:** Estos botones llaman a la RPC estricta `fn_confirmar_decisiones_masivo(p_ids, p_accion)` la cual:
    1. Marca el estado como `confirmado` en `matching_decisiones`.
    2. Hace el "UPDATE" final en `costos_articulo` asignando el verdadero `articulo_id`.

### D. Panel de Monitoreo y Auditoría (Historial y Rollback)
**Ruta:** `/precios/[proveedor]/historial/page.tsx`
**Rol:** Gobernar la línea de tiempo de importaciones y recuperarse de desastres.

**Vistas y Controles:**
* **Qué consume:** Vista de base de datos ya existente `v_importaciones_historial` y cruce con el lote activo.
* **Lo que ve el usuario:** Cada importación procesada, su fecha, estado (`completado`, `error`, `cancelado`), y si está **Vigente**.
* **Control:** Botón "Restaurar lote anterior". Este botón permite correr la mecánica exacta de desvinculación o rollback (equivalente a la transacción SQL de contingencia que se ejecutó directamente el 29 de abril) para retroceder listas con sobreprecios masivos de manera autónoma.

---

## Resumen de Estabilidad y Certidumbre

1. **Flujo Categórico Desacoplado:** El frontend y el backend ahora respetan la directiva "Lista Sana Primero". No se hacen vinculaciones de catálogo dentro del mismo bloque de memoria ni contexto de red de la ingesta del Excel, erradicando los `ReferenceError` y fallos `JSON`.
2. **Eficiencia en Costos:** No hay triggers en cadena infinitos; el pipeline delega al motor SQL (`fn_match_precios_v2` / `fn_confirmar_decisiones_masivo`) todo el trabajo pesado a través de las migraciones recientemente empujadas a producción (`v103`).
3. **Defensividad de Datos:** El catálogo base (`articulos`) nunca es sobrescrito por un Excel basura; los resultados quedan en `costos_articulo` (tabla puente transaccional).
4. **Visibilidad Total:** El frontend está conectado exclusivamente a vistas directas de solo-lectura, garantizando que el usuario ve *exactamente* la verdad matemática que vive en Postgres de forma asíncrona.
