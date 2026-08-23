# Politicas Frontend, UX y Gobernanza del Proyecto

> Documento CURADO (manual). Rescatado el 2026-08-23 desde db_flow_blueprint.md,
> que a partir de hoy es un artefacto 100% generado. Editar SOLO este archivo.

# Project Master Blueprint (Frontend & DB Flow)

Este documento es el **plano unificado** del proyecto Autofichaje2026. Integra las directrices de interfaz humana (basadas en las 10 Heurísticas de Jakob Nielsen) con los diagnósticos y flujos duros de la base de datos (Backend/Supabase).

## 1. UX/UI Core: Basado en las 10 Heurísticas de Usabilidad de Nielsen
El sistema gestiona operaciones masivas, pero su fin último es ser operado por humanos de forma rápida y sin fricción. Todo flujo debe subordinarse a estas reglas:

- **H1. Visibilidad del Estado (Cero Bloqueos):** Feedback asíncrono e inmediato. Botones con `Loader2`, mutaciones locales optimistas (estado `Set` en memoria) sin recargar la página entera.
- **H3. Control de Usuario:** Siempre debe existir una salida (ej. Desvincular, Revertir, Cancelar Importación) funcional y libre de fallas técnicas.
- **H4. Consistencia y Estándares (Colores):**
  - **Emerald:** Éxito, vinculado.
  - **Amber / Negritas:** Discrepancia, advertencia (Guía visual exclusiva para dirigir el ojo).
  - **Indigo:** Datos del proveedor/externos.
  - **Slate:** Datos neutros/ignorados.
- **H5. Prevención de Errores:** Las acciones de "Aceptar Todos" deben requerir doble confirmación y las filas procesadas deben bloquearse contra clics dobles. Paginación y memorización obligatoria en lotes >500 filas para evitar bloqueos del navegador.
- **H6. Reconocimiento vs Recuerdo (El Patrón Top/Bottom):** Prohibidas las vistas de comparación masiva horizontales o "lado a lado". Todo cruce de datos debe alinear columnas idénticas usando tablas HTML nativas (Fila Superior: Catálogo | Fila Inferior: Proveedor) para que el humano escanee verticalmente.
- **H9. Diagnóstico de Errores Legible:** Prohibido mostrar errores crudos SQL (ej. `42P10 Constraint Violation`). Traducirlos en los `catch` a mensajes humanos (ej. "Código ya vinculado").

## 2. Coherencia DB/Backend para la UI

- **Protección contra Referencias Nulas (Runtime Crashes):** Todo payload extraído de Supabase debe ser normalizado/saneado de forma centralizada en su carga (ej. `loadAll`). El renderizado JSX no debe confiar ciegamente en las propiedades. El acceso a diccionarios o longitudes de arreglos debe estar protegido con optional chaining (`?.`) y `??` para prevenir `TypeError` (ej. acceso a `pub.deal_ids?.length` o `listingTypeConfig[id]?.label`).
- **Codificación Segura y Cero Mojibake:** Está estrictamente prohibido usar caracteres de dibujo Unicode (como `─` U+2500) o guardar archivos con codificaciones locales. Los archivos de código deben usar codificación UTF-8 pura (con política enforce en `.gitattributes`) y comentarios ASCII estándar (`// ---`), para evitar corrupciones de compilación en Vercel que obliguen a hacer reverts destructivos.

- **In-Memory Joins vs URL Limits:** Las consultas Supabase `.in()` fallan por límites de URL con arreglos gigantes. Para cruzar >1000 filas, descargar catálogo filtrado y hacer *matching* en la capa Node.js del servidor antes de pasarlo al cliente.
- **Tolerancia a Índices Parciales:** En inserciones masivas complejas (ej. `proveedor_articulos_alias`), usar condicionales `SELECT` -> `INSERT/UPDATE` en lugar de `UPSERT ON CONFLICT`, ya que Postgres bloquea los UPSERTs sobre índices con `WHERE`.

---


---

## 📊 Linaje de Datos (Excel -> BD)

Columnas extraídas en Frontend / Edge:
- `modelo`
- `marca`
- `codigo`
- `descripcion`
- `moneda`


---

## Políticas de Seguridad Frontend y Runtime (Agregadas por Validación de QA)

1. **Normalización Obligatoria en Borde:** Todo payload de DB/API debe pasar por una función de normalización antes del setState o renderizado.
2. **Acceso Defensivo a Diccionarios:** Prohibido acceder a diccionarios sin opcionalidad. Se exige `config[key]?.label ?? fallback`.
3. **Primitivas Render-Safe:** Todo método (`.toLocaleString`, `.map`, `.toFixed`, etc.) llamado sobre un campo de payload externo debe usar `?.` y `??` fallback.
4. **Validación Estricta TypeScript:** Validación estricta garantizando que los objetos indexados dinámicamente (`noUncheckedIndexedAccess`) se traten como posibles `undefined`.
5. **Smoke Tests E2E:** Validación en runtime real. Un build exitoso no descarta crashes de cliente.
6. **Erradicación de Mojibake Segura:** Prohibido usar regex o índices para reemplazar caracteres Unicode. Usar exclusivamente `.split('─').join('-')` y verificar con build local.


## 4. Estrategia Arquitectónica de Escalabilidad y Gobierno (Validado)
El proyecto debe adherirse a los lineamientos de escalabilidad Backend (CQRS ligero, Server Actions, Error Boundaries, Edge Functions para Triggers pesados) y al Gobierno de Código (Capa de Acceso a Datos estricta y Type-Safety) detallados exhaustivamente en el reporte estratégico adjunto:

**Ver documento completo:** [Estrategia de Arquitectura DeepSeek](file:///C:/Users/dnefe/.gemini/antigravity/brain/e5e73cd2-3401-489a-9f83-d20d8d924e52/artifacts/arquitectura_estrategia_deepseek.md)
