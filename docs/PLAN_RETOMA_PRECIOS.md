# Plan de Retoma: Módulo de Precios

Este documento consolida todas las validaciones, diagnósticos y tareas pendientes descubiertas en la sesión de depuración intensiva. Debe usarse como guía exacta para reanudar el trabajo una vez que los recursos de Supabase estén liberados.

## 1. Estado de Infraestructura (Bloqueo Actual)
- **Síntoma:** Timeouts constantes (`Connection terminated due to connection timeout`).
- **Causa Raíz:** La instancia Micro (Free Tier) de Supabase mantiene un 73% de consumo de memoria constante, saturando el pool de conexiones. El plan impone límites de uso que impiden procesar 15,300 filas de golpe.
- **Acción Pendiente:** Esperar a que la carga baje, limpiar conexiones colgadas, o hacer un upgrade a Pro (requiere autorización explícita). Check de arranque: `SELECT 1 AS ping;` debe responder inmediatamente.

## 2. Bug de Mapeo de Columnas (El "CÓDIGO" fantasma)
- **Síntoma:** El payload JSON de la tabla `listas_precios_raw` no contiene la clave para hacer match (ni `"CÓDIGO"`, ni `"L"`).
- **Causa Raíz:** El parser en `apps/dashboard/src/app/api/precios/importar/[id]/iniciar-parser/route.ts` usa una "whitelist" (`columnas_a_guardar`). Como el mapeo anterior tenía `"CÓDIGO"`, el parser descartó silenciosamente la columna `"L"` al no encontrarla en la lista permitida.
- **Solución (Ya detectada):** 
  - Actualizar `mapeo_columnas` del proveedor Urrea: `columna_modelo = "L"`, y asegurarse de que `"L"` esté en el arreglo `columnas_a_guardar`.
  - **Reprocesar** la importación desde cero, ya que los JSONs actuales en la base de datos están permanentemente incompletos.

## 3. Defecto Arquitectónico Crítico (La Colisión de Dos Motores)
Esta es la validación más profunda del código fuente. Actualmente, el sistema tiene dos motores de matching superpuestos que se sabotean mutuamente.

### Pipeline 1: El Preview Prematuro y Lento
- **Ruta:** `iniciar-parser` → `fn_preparar_importacion_revision` → `fn_resolver_y_poblar_costos`.
- **Problema A (Rendimiento):** `fn_resolver_y_poblar_costos` hace un `JOIN` con un `OR` sobre funciones de texto (`lower(f_unaccent_immutable)`). Esto impide el uso de índices y causa el timeout de 180s al cruzar 15,000 filas.
- **Problema B (Lógica):** Inserta datos definitivos en `costos_articulo` cuando en esta fase solo debería calcular el `resumen_diff` y llenar `costos_pendientes` para la UI.

### Pipeline 2: El Motor V2 Ciego
- **Ruta:** `iniciar-matching` → `fn_match_precios_v2`.
- **Problema:** Este motor está mejor optimizado (sin el `OR`), pero intenta leer los datos desde `listas_precios_raw_staging`. El problema es que el Pipeline 1 **ya vació el staging** (mediante un `DELETE`). Al encontrar 0 filas, falla lanzando el error `MATCHING_VACIO`.

### Solución Arquitectónica (DDL Pendiente)
1. **Refactorizar `fn_resolver_y_poblar_costos`:**
   - Quitar el `INSERT` a `costos_articulo`. Solo debe generar el preview.
   - Eliminar el `OR` del JOIN usando una pre-computación de alias en un CTE (Hash Join) para evitar el timeout.
2. **Ajustar `fn_match_precios_v2`:**
   - Cambiar su origen de datos: debe leer de `listas_precios_raw` (la tabla persistente), no de `staging`.
   - Eliminar su instrucción `DELETE FROM listas_precios_raw_staging`, ya que no le corresponde.

## 4. Plan de Acción (Paso a Paso)
1. **Ping a BD:** Confirmar que Supabase responde estable.
2. **Aplicar DDLs:** Desplegar las correcciones a las funciones SQL mencionadas en el punto 3 (solo cuando no haya incidente activo en Supabase).
3. **Corregir Mapeo:** Ejecutar el `UPDATE` en `importaciones_excel` para fijar la columna `"L"` de Urrea.
4. **Nueva Importación:** Subir de nuevo el Excel de Urrea (Julio 26) usando modo "Actualización parcial (MERGE)".
5. **Validación:** Comprobar que el parser guardó la `"L"` en el payload y que la fase de revisión se abre sin timeouts.
6. **Matching Final:** Ejecutar `iniciar-matching` y verificar que `costos_articulo` se pueble correctamente y se marquen como vigentes.

## 5. UI/UX del Módulo de Precios (Propuesta Validada)

### [YA EXISTE] (Falta pintar en el Frontend)
- **Vista previa del diff (Precios Nuevos vs Anteriores)**: La ruta `/costos` ya envía los precios viejos y nuevos emparejados. El Frontend debe usar esto para mostrar la tabla de comparación cuando el usuario haga clic en los contadores (NUEVOS/MODIFICADOS).
- **10 filas de ejemplo en Mapeo**: La ruta `/preview` ya extrae `dataRows` (10 filas de muestra). El Frontend debe pintarlas bajo los selectores de mapeo para validación visual.
- **Reintentar Parseo**: Reutilizar el endpoint `/iniciar-parser` desde la UI, ya que es idempotente y limpia el staging antes de procesar.

### [FALTA BACKEND] (Añadir a las rutas API)
- **Candado Anti "0 filas"**: Añadir validación estricta en `/iniciar-parser` para comparar los headers mapeados contra los reales y devolver HTTP 400 si falta alguno.
- **Timeline de Estados**: Crear endpoint `GET /eventos` que lea la tabla `importacion_eventos`.
- **Botón Cancelar**: Crear endpoint `POST /cancelar` que haga `UPDATE importaciones_excel SET estado = 'cancelado'`.

### [SOLO UI] (Lógica a implementar en React)
- **Bloqueo de Confirmación**: Deshabilitar "Confirmar Efectividad de Cambios" si hay columnas ausentes o excepciones críticas.
- **Umbral de Alerta Visual**: En la tabla de diffs, calcular el Δ% ( `(nuevo - viejo) / viejo * 100` ) y resaltarlo en rojo si supera el ±30%, para llamar la atención del humano.
