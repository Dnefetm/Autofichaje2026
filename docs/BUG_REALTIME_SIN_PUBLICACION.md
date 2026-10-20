# Bug preexistente: Realtime no emite eventos (publicación sin tablas)

## Diagnóstico (verificado en vivo)

El frontend se suscribe a cambios en tiempo real en 3 tablas:

| Archivo | Tabla | Evento |
|---|---|---|
| `monitor/page.tsx` | `jobs` | `*` (todos) |
| `precios/importaciones/[id]/progreso-importacion.tsx` | `importaciones_excel` | `UPDATE` |
| `precios/importaciones/[id]/progreso-importacion.tsx` | `importacion_eventos` | `INSERT` |

Los tres componentes usan `supabase`/`supabaseBrowser` (llave `anon`).

## Estado real de la infraestructura Realtime (catálogos de Postgres)

```
supabase_realtime: puballtables = false, 0 tablas en pg_publication_rel
```

`ALTER PUBLICATION supabase_realtime ADD TABLE ...` no se ha ejecutado para ninguna
de las 3 tablas. Con `puballtables=false`, Realtime **no transmite eventos** de
`postgres_changes` vía WAL para estas tablas.

**Consecuencia:** el monitor de `jobs` no se refresca en vivo, y la barra de
progreso + log de importaciones se quedan congelados durante el procesamiento.
Es un bug **preexistente**, independiente del trabajo de RLS.

## Agravante adicional

`importacion_eventos` tiene RLS activado (`rowsecurity=true`) pero **0 políticas**.
La lectura directa `supabase.from('importacion_eventos').select(...)` en
`progreso-importacion.tsx` (línea 21) ya devuelve `[]` para `anon`. El panel de
log en vivo está vacío por dos motivos: sin política RLS y sin publicación.

## Corrección (pendiente de autorización)

1. Agregar las tablas a la publicación:
   ```sql
   ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.importaciones_excel;
   ALTER PUBLICATION supabase_realtime ADD TABLE public.importacion_eventos;
   ```
2. Para `importacion_eventos` (si se quiere lectura en vivo por anon):
   ```sql
   ALTER TABLE public.importacion_eventos ENABLE ROW LEVEL SECURITY;
   CREATE POLICY importacion_eventos_select_anon ON public.importacion_eventos FOR SELECT TO anon USING (true);
   ```

Nota: `importacion_eventos` NO está en el script v138 (RLS ya activado), así que
esta política de lectura se gestiona aquí como parte del arreglo de Realtime.
