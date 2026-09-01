# REPORTE TÉCNICO — Camino reverso (web → Supabase → Sheets)

> Fecha: 2026-09. Estado: listo para revisión y despliegue. Nada se ejecuta sin aprobación del dueño.
> Objetivo: que una edición hecha en la aplicación web (Next.js) quede en Supabase y, desde ahí, **baje automáticamente a Google Sheets** (el respaldo/backend de AppSheet).
> Alcance de este reporte: SOLO el camino reverso. El forward (Sheets→Supabase) ya está restaurado y operando.

---

## 1. Arquitectura (flujo completo)

```
Web (Next.js)
   │  POST /api/movimientos  { tipo, ...campos }
   ▼
API route (server-side, supabaseAdmin = service_role)
   │  supabaseAdmin.rpc('web_upsert_ingreso' | 'web_upsert_egreso' | 'web_upsert_articulo')
   ▼
Supabase: RPC SECURITY DEFINER
   │  - hace UPSERT por clave natural (on_conflict)
   │  - escribe origin = 'web'
   │  - NO escribe sync_hash
   ▼
Trigger AFTER INSERT/UPDATE (trg_outbox_*)
   │  - si NEW.origin = 'web' → INSERT en sync_outbox (tabla, clave, 'upsert')
   ▼
Apps Script: sincSupabaseASheets()  (trigger de tiempo)
   │  - lee sync_outbox (estado='pendiente', en lotes)
   │  - lee la fila de Supabase por clave natural
   │  - serializa y escribe en el Sheet (por clave natural, en LOTES)
   │  - marca el outbox como 'enviado'
   ▼
Google Sheets (actualizado)
```

---

## 2. Modelo de `origin` (3 estados — pieza central)

| `origin` | Quién lo escribe | ¿Se encola al outbox (baja a Sheets)? |
|---|---|---|
| `NULL` | worker / filas históricas | ❌ NO (queda nativo en Supabase) |
| `'sheets'` | el forward (desde el Sheet) | ❌ NO (ya vino de Sheets; evitar eco) |
| `'web'` | la web (vía `web_upsert_*`) | ✅ **SÍ** |

**Por qué 3 estados y no 2:** separa "lo que escribe el worker" (`NULL`) de "lo que escribe la web" (`'web'`). Así el reverso **solo** baja a Sheets lo que editas en la web, y **no** re-introduce en Sheets los egresos que el worker escribe directo en Supabase (el doble-egreso de MercadoLibre aún sin resolver).

---

## 3. Componentes (archivos en el repo)

| Componente | Ruta | Qué hace |
|---|---|---|
| SQL | `supabase/migrations/20260901000000_reverso_outbox_web_rpcs.sql` | crea `origin` en ingresos/articulos, `sync_outbox`, el trigger, y las RPC `web_upsert_*` |
| Apps Script | `packages/scripts/sincSupabaseASheets.gs` | el reverso: lee outbox y escribe en Sheets |
| API route | `apps/dashboard/src/app/api/movimientos/route.ts` | endpoint que la web usa para escribir |

---

## 4. SQL (fuente única: el archivo de migración)

El SQL vive **SOLO** en `supabase/migrations/20260901000000_reverso_outbox_web_rpcs.sql`. No se duplica aquí; para desplegar se copia y ejecuta **ese archivo** en el SQL Editor de Supabase.

**Validación justo después de ejecutarlo (solo lectura):**
```sql
SELECT column_name FROM information_schema.columns WHERE table_name='ingresos' AND column_name='origin';  -- 1 fila
SELECT column_name FROM information_schema.columns WHERE table_name='articulos' AND column_name='origin'; -- 1 fila
SELECT to_regclass('public.sync_outbox');                     -- 'sync_outbox'
SELECT proname FROM pg_proc WHERE proname LIKE 'web_upsert_%'; -- 3 RPC
SELECT count(*) FROM sync_outbox;                             -- 0
```

**Prueba del fix del trigger (confirma que no crashea con columnas de otra tabla):**
```sql
INSERT INTO ingresos (ingreso_id, articulo_id, cantidad, origin)
VALUES ('TEST-TRIGGER-1', '8abb5360', 1, 'web')
ON CONFLICT (ingreso_id) DO UPDATE SET origin='web';
SELECT * FROM sync_outbox WHERE tabla='ingresos' AND clave='TEST-TRIGGER-1'; -- 1 fila 'pendiente'
DELETE FROM sync_outbox WHERE clave='TEST-TRIGGER-1';
DELETE FROM ingresos WHERE ingreso_id='TEST-TRIGGER-1';
```

---

## 5. Apps Script reverso (archivo: `packages/scripts/sincSupabaseASheets.gs`)

Se copia **íntegro** en el proyecto Apps Script "Exportación de Inventario" (mismo proyecto que el forward), para reutilizar `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` ya definidos.

### 5.1 Mapeo de columnas (CRÍTICO — validar contra el Sheet real)

El serializador inverso usa **el mismo mapeo que el forward del repo**. **ADVERTENCIA OBLIGATORIA:** el código desplegado difiere del repo, así que antes de desplegar hay que **cotejar estos índices contra los parsers del forward desplegado** (`filaAObjetoSincEgreso`, `filaAObjetoSincIngreso`, `buildRegistroArticulo` en `sincEgresos.gs`/`sincIngresos.gs`/`sincArticulos.gs` desplegados). Si el Sheet real tiene columnas extra o en otro orden, ajustar los índices.

**Artículos (35 columnas):**
| Col | Campo | | Col | Campo |
|---|---|---|---|---|
| A(0) | articulo_id | | Q(16) | notas |
| B(1) | nombre | | S(18) | codigo_sat |
| C(2) | marca | | U(20) | peso_kg |
| D(3) | modelo | | V/W/X(21-23) | imagenes[0..2] |
| E(4) | variante | | Y(24) | es_full (bool→'sí') |
| F(5) | categoria | | AB(27) | descripcion |
| J(9) | caja_madre | | AC/AD/AE(28-30) | largo/ancho/alto |
| L(11) | codigo_universal | | AI(34) | es_dropshipping (bool→'sí') |
| O(14) | url_producto | | | |

**Ingresos (13 columnas):** A(0)=ingreso_id, C(2)=articulo_id, D(3)=cantidad, E(4)=guia, F(5)=transportista, G(6)=tipo_ingreso, H(7)=notas, I(8)=fecha, J(9)=operador_id, K-M(10-12)=imagenes.

**Egresos (23 columnas):** A(0)=egreso_id, C(2)=articulo_id, D(3)=cantidad, E(4)=guia, F(5)=transportista, G(6)=tipo_egreso, H(7)=notas, I(8)=fecha, J(9)=operador_id, N(13)=largo, O(14)=ancho, P(15)=alto, Q(16)=peso, R(17)=salidas_periodo, S(18)=codigo_ml, T(19)=edo_reunido, U(20)=fecha_reunido, V(21)=fecha_preparado.

**Reglas de formato:** `null`→celda vacía; booleanos→`'sí'`/`''`; fechas→objeto `Date` (para que el parser forward las lea); arrays→columnas de imagen.

### 5.2 Despliegue del Apps Script
1. Pegar el archivo `sincSupabaseASheets.gs` en el proyecto (nuevo archivo).
2. Crear trigger de tiempo: `sincSupabaseASheets` → temporizador → cada 15 minutos (o cada 1 minuto si se quiere menos latencia).
3. Ejecutar `sincSupabaseASheets()` manual una vez.

**Validación del Apps Script:**
- Ejecución manual → log debe decir `Reverso: outbox vacío.` (sin errores HTTP).

---

## 6. API route (archivo: `apps/dashboard/src/app/api/movimientos/route.ts`)

Endpoint `POST /api/movimientos`. Recibe `{ tipo: 'ingreso'|'egreso'|'articulo', ...campos }` y llama al RPC correspondiente con `supabaseAdmin.rpc(...)`.

**Validación del API route (tras desplegar la web a Vercel):**
```bash
curl -X POST https://<tu-dominio>/api/movimientos \
  -H 'Content-Type: application/json' \
  -d '{"tipo":"ingreso","ingreso_id":"TEST-0001","articulo_id":"<id-real>","cantidad":1,"fecha":"2026-09-01T12:00:00-06:00"}'
```
Esperado: `{"ok":true}`.

---

## 7. Prueba end-to-end (la que cierra el circuito)

**Caso 1 — Crear un ingreso desde la web y verlo en Sheets:**
1. `POST /api/movimientos` con un ingreso de prueba (`ingreso_id = 'TEST-0001'`).
2. En Supabase: `SELECT ingreso_id, articulo_id, cantidad, origin FROM ingresos WHERE ingreso_id='TEST-0001';` → debe devolver la fila con `origin='web'`.
3. En Supabase: `SELECT * FROM sync_outbox WHERE tabla='ingresos' AND clave='TEST-0001';` → debe haber 1 entrada `estado='pendiente'`.
4. Ejecutar `sincSupabaseASheets()` (o esperar el trigger).
5. En el Sheet "Ingresos", buscar `TEST-0001` → **debe aparecer la fila**.
6. En Supabase: la entrada del outbox debe pasar a `estado='enviado'`.

**Caso 2 — Editar un egreso existente:**
1. `POST /api/movimientos` con `tipo='egreso'` y un `egreso_id` ya existente, cambiando `cantidad`.
2. Verificar en Supabase `origin='web'` y en el Sheet el valor de cantidad actualizado.

**Doble validación (por duplicado):**
- Vía 1 (datos): `SELECT count(*), max(fecha) FROM ingresos;` antes y después, y comparar el Sheet.
- Vía 2 (log): el log de `sincSupabaseASheets` (`enviados=N, errores=0`).

---

## 8. Rollback (cómo deshacer cada paso)

| Paso | Rollback |
|---|---|
| SQL | `DROP TRIGGER IF EXISTS trg_outbox_* ON ...; DROP FUNCTION IF EXISTS fn_encolar_sync_outbox(); DROP TABLE IF EXISTS sync_outbox; DROP FUNCTION IF EXISTS web_upsert_*;` (las columnas `origin` se pueden dejar o `DROP COLUMN`) |
| Apps Script | borrar el trigger y el archivo `sincSupabaseASheets.gs` |
| API route | borrar `route.ts` y re-desplegar |

Nada de esto toca `egresos`/`ingresos`/`articulos` salvo la columna aditiva `origin` (inocua).

---

## 9. Riesgos y advertencias críticas

1. **Índices de columna (repo vs desplegado).** El serializador inverso usa el mapeo del repo. El desplegado puede diferir. **Verificar antes de desplegar** contra `filaAObjetoSinc*` del código desplegado. Es el riesgo #1.
2. **El forward puede re-etiquetar `'web'`→`'sheets'`.** Tras empujar el reverso, el forward (hash-skip) puede re-sincronizar la fila con `origin='sheets'`. Es idempotente y no corrompe datos, pero la marca `'web'` se pierde. Fix definitivo (no bloqueante): forward condicional `WHERE origin='sheets'`.
3. **Edición simultánea del mismo registro** (web + AppSheet) es "último en escribir gana". Regla operativa: no editar lo mismo en ambos lados a la vez.
4. **Seguridad.** La `SUPABASE_SERVICE_KEY` sigue hardcodeada en el Apps Script (deuda pendiente: `PropertiesService` + rotación). El RPC es `SECURITY DEFINER`; exponerlo vía el API route server-side, **nunca** al navegador.
5. **RLS sobre-permisivo.** `articulos`/`inventory_snapshot` tienen políticas `public ALL true`; `ingresos`/`egresos` RLS deshabilitado. Cerrar antes de exponer más escritura. (Frente separado.)
6. **El forward debe seguir marcando `'sheets'`** para que sus escrituras no se encolen (ya lo hace en egresos; falta confirmar en ingresos).

---

## 10. Checklist de aceptación (todo debe pasar las dos vías)

- [ ] SQL desplegado y verificado (queries de §4).
- [ ] Apps Script desplegado + trigger + `Reverso: outbox vacío`.
- [ ] API route desplegada + `POST` responde `{ok:true}`.
- [ ] Caso 1 (crear ingreso) → aparece en Supabase `origin='web'` **y** en Sheets.
- [ ] Caso 2 (editar egreso) → cantidad actualizada en Supabase **y** en Sheets.
- [ ] Outbox drena a 0 (`SELECT count(*) FROM sync_outbox WHERE estado='pendiente'` → 0).
