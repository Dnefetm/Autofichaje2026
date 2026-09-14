# Backlog — Migración AppSheet → Supabase (tareas por aclarar)

> Regla: **nada se implementa hasta que la tarea quede "ACLARADA"**. Cada tarea se
> clarifica en el chat (interpretación + opciones), se actualiza aquí, y recién
> entonces se desarrolla.

> **Regla de doble modo:** todo lo construido debe funcionar **ahora (con sync Sheets↔Supabase activo)** y **después (sin sync, Supabase standalone)**. Verificado: el traspaso y las columnas nuevas (`danados`/`devoluciones`) son solo-Supabase (el trigger `fn_encolar_sync_outbox` solo encola `origin='web'`, y estos movimientos van con `origin=NULL`), por lo que no chocan con Sheets en ningún modo.

## Tareas pendientes

| # | Tarea | Prioridad | Estado |
|---|---|---|---|
| 1 | Logística Full (importar → reunir → preparar → salida) | **Alta** (>50% operaciones) | ✅ ACLARADA |
| 2 | Resurtir (existencias < salidas 60d) | Media | ✅ ACLARADA |
| 3 | Ubicaciones (validar existente + extender) | Media | ✅ ACLARADA |
| 4 | Auth + RLS + operadores/roles | Alta (prereq móvil) | ✅ ACLARADA |
| 5 | Captura móvil (PWA + escáner + offline) | Alta | ✅ ACLARADA |
| 6 | NOM-050 | Baja (diferida) | ✅ ACLARADA |
| 7 | Variantes (clonar artículo) | Baja | ✅ ACLARADA |
| 8 | Sincronización / corte (doble escritura + apagado) | Media | ✅ ACLARADA |

## Descartados / diferidos (confirmados por el usuario)

- ❌ Stock mínimo / `recomprar` / `ActualizarMínimo*` → se usa **resurtir**.
- ❌ Medidas y pesos → no vigente.
- ⏸️ Agenda y tareas → no urgente (diferida).
- ❌ Reportes programados → omitidos.
- ❌ Columnas muertas (`StockActual`, `StockMínimo`, `Dimensiones "NO USAR"`, `PrecioObjetivo "No modificar"`).

## Decisiones confirmadas (se llenan al aclarar cada tarea)

### Tarea 1 — Logística Full ✅ ACLARADA

**Flujo completo (de principio a fin):**
1. El sistema lee por API: stock en Full + ventas + planeación de envío.
2. El sistema **procesa la información** (las reglas) y **propone** una lista sugerida (qué y cuánto).
3. El **operario decide** sobre esa lista, con su criterio: puede quitar (no disponible / ya no se quiere enviar a Full), agregar (aunque la regla diga que no) o ajustar cantidades. **La decisión es del operario, nunca automática.**
4. El operario confirma la lista final.
5. El operario crea/edita el envío en el portal de ML (manual, no hay API), copiando la lista.
6. ML genera el PDF → se descarga y se sube → el sistema lo lee → crea los **egresos** (cantidad 0) con código Full → `articulos`.
7. El operario: pendientes → reunir → preparar → fijar cantidad → cerrar.
8. Los 4 avisos de ML se muestran al preparar.
9. Si se modifica el envío → PDF nuevo → se sube → el sistema marca ⚠️ qué cambió (nuevo / quitado / cantidad).

**Identificación de productos:**
- Código Full = `inventory_id`, sale de la API (`GET /items/{id}`). No se teclea.
- Match: `inventory_id` → `articulos`. Varias publicaciones pueden compartir el mismo código.

**Modificar egresos:** subir/bajar cantidad o quitar producto, hasta antes de "cerrar"; el cambio se marca "⚠️ CAMBIÓ" en "pendientes".

**Avisos del PDF (4 reglas de ML):** etiquetar, frágil (burbuja), vencimiento, peso/medidas. Se muestran al operario.

**Procesamiento del PDF:** descarga del portal (única acción manual) → sistema parsea → actualiza egresos → marca cambios → muestra avisos. No se teclea a mano.

**API (cuenta estándar México):**
- ✅ Stock en Full (`/inventories/{inventory_id}/stock/fulfillment`), ventas, `inventory_id`, planeación de envío (`/marketplace/fbm/user-products/{id}/replenishment` — por verificar contra la cuenta).
- ❌ Crear el envío físico (solo China) y el PDF de instrucciones (no existe endpoint).

### Tarea 2 — Resurtir ✅ ACLARADA

- El sistema muestra una **lista de productos que hay que reponer**: cuando el stock que queda es **menor** a lo vendido en los últimos 60 días.
- Fórmula: `resurtir = existencias < salidas_60d`.
- (Al implementar se detalla la definición exacta de "existencias" y "salidas 60d" según los datos reales.)

**Implementación:**
- `existencias` = `inventory_snapshot.physical_stock` (stock vendible real).
- `salidas_60d` = SUM de `egresos` con `tipo_egreso='venta'` en los últimos N días.
- API `/api/inventario/resurtir?dias=60` + página `/inventario/resurtir`.
- Validado contra datos reales: 105 artículos a resurtir en ventana de 60 días. Sin migración (solo lectura).

### Tarea 3 — Ubicaciones ✅ ACLARADA

- Ubicación = **caja física con nombre alfanumérico** (la posición está en el nombre, ej. "C3A8"). El operario la encuentra por su nombre.
- **No se modifica nada por ahora**: solo mantener el sistema de ubicación por producto (campo de ubicación en el artículo).
- **Dañados / devueltos (modelo nuevo, reemplaza el clonado de AppSheet):** NO se duplica la ficha. Un solo artículo con stock por **estado**: `disponible` / `dañado` / `devolución`. Un **movimiento de traspaso** con `motivo` (daño / devolución / merma) saca de `disponible` y mete en `dañado`/`devolución`, y registra la **ubicación destino** (la caja especial, ej. "CAJA DAÑADOS"). Las vidrieras publican solo `disponible`. Un movimiento final `desecho` / `devolución` cierra ese stock.

**Implementación (dañados/devoluciones):**
- Migración `supabase/migrations/20260914000000_danados_devoluciones.sql` (columnas `danados`/`devoluciones` + extiende CHECK `chk_tipo_egreso` + `fn_traspaso_stock`).
- Hallazgo: CHECK actual permite solo `venta, envio_full, otro, devolucion_proveedor`; se agregan `danado` y `devolucion`.
- Modelo de stock: `physical_stock = disponibles + ingresos − egresos` (con triggers). El egreso tipo `danado`/`devolucion` saca de venta; las columnas `danados`/`devoluciones` solo hacen tracking (sin doble conteo).
- API `/api/inventario/traspaso` + página `/inventario/traspaso`.

### Tarea 4 — Acceso y operadores ✅ ACLARADA

Roles y permisos:
- **Administrador:** todo — catálogo, precios, stock, usuarios, reportes, configuración.
- **Vendedor propio:** catálogo, precios, stock; registra ventas y **puede entregar productos** (toca inventario → egresos).
- **Vendedor tercero:** ve SU catálogo y SUS ventas; ve **precio menudeo** y **precio asignado a sus clientes**. No ve costos.
- **Operador de inventario:** captura movimientos (ingresos, egresos, traspasos, daños) y prepara envíos; no ve precios/costos ni administra.
- **Cliente:** ve catálogo, precio menudeo, SU precio asignado, **genera pedidos** y ve disponibilidad.

Implica: portal de cliente (login de clientes), concepto de **pedidos** y **precios asignados por cliente** (se detallan al implementar).

**Implementación (auth) — COMPLETA en código:**
- Páginas: `/login`, `/registro`, `/recuperar`, `/actualizar-contrasena`, `/logout`.
- `middleware.ts` con refresco de sesión + protección de `/admin/*` (rol `admin`).
- `/admin/usuarios` + API para asignar roles (5 roles).
- Migración `supabase/migrations/20260913151657_usuarios_roles.sql` (tabla `usuarios` + `current_rol()`).
- Admin bootstrap: `dnefetm@gmail.com` rol `admin`.
- Validado de punta a punta: crear usuario → login → `current_rol()` = "admin".
- Pendiente del usuario: deploy + Redirect URL `/actualizar-contrasena` en Supabase Auth.

### Tarea 5 — Captura móvil ✅ ACLARADA

- App móvil tipo **PWA** (instalable en celular, desde el navegador).
- **Escáner** de código de barras con la cámara.
- **Offline**: funciona sin internet y **sincroniza al reconectar** (detalle de conflictos al implementar).

### Tarea 6 — NOM-050 ✅ ACLARADA

- Cada producto tiene **normativas varias** (NOM-050 es un caso).
- NOM-050 exige que la información del producto + **fabricante/distribuidor/importador** se muestre en la **etiqueta** de cada producto.
- Por eso, **de cada producto debe estar registrada esa información** de etiquetado.
- Si el producto **se etiqueta** (ej. viene a granel), esa información se integra a la etiqueta.
- Debe poder **integrarse e imprimirse fácilmente en etiquetas térmicas**.

### Tarea 7 — Variantes (clonar artículo) ✅ ACLARADA

- "Clonar artículo" = copiar un artículo existente para crear uno nuevo (variante).
- La variante puede ser de **cualquier tipo** (color, medida, etc.): se copia todo y solo se cambia lo que difiere.

### Tarea 8 — Sincronización y corte ✅ ACLARADA

- Durante la migración conviven Sheets (viejo) y Supabase (nuevo).
- **Doble escritura bidireccional**: Sheets ↔ Supabase (los datos se escriben en ambos sentidos).
- **Corte:** lo decide el usuario, cuando pueda operar plenamente en Supabase (ahí se apaga Sheets).

## Esquema real de producción (validado por consulta directa a Supabase)

**NO existen en producción** (aunque v13 los declaraba): `ubicaciones`, `importar_egresos_full`, `tareas_recoleccion_full`, `stock_por_ubicacion`, `importadores`, `informacion_comercial`.

**Hechos reales (columnas confirmadas):**
- `articulos`: PK = `articulo_id` (no `sku`). Ya tiene `caja_madre` (texto), `disponibles`, `nom050`, `requiere_etiqueta_nom`, `pais_origen`, `importador_id`, `es_full`, `es_dropshipping`, `es_obsoleto`, `sync_hash`, `origin`.
- `egresos`: el flujo Full está **inline** — `codigo_ml`, `importacion_full_id`, `edo_reunido`, `fecha_reunido`, `fecha_preparado`, `salidas_periodo`, `ubicacion_id`, `tipo_egreso`.
- `ingresos`: `articulo_id`, `ubicacion_id`, `tipo_ingreso`, `operador_id`.
- `operadores`: `nombre, correo, celular, estatus` — SIN rol ni auth.
- `inventory_snapshot`: `sku` (= `articulo_id`), `physical_stock`, `dropship_stock`, `reserved_stock`.
- Ya existen: `clientes`, `vendedores`, `pedidos`, `pedido_items`, `tickets_venta`, `ordenes`, `orden_items`, `reservaciones_stock`.

**Impacto en el plan:**
- T3: ubicación = texto (no hay tabla).
- T1: extender `egresos`, no crear tablas nuevas.
- T6: ya hay columnas NOM-050 en `articulos`.
- T4: ✅ implementada (auth + roles + middleware). Pendiente: deploy y Redirect URL de recuperación.
