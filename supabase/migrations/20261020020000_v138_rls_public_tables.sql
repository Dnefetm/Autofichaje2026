-- v138: Habilitar RLS en tablas públicas (mitigación crítica de seguridad).
--
-- Contexto: el Security Advisor de Supabase detectó `rls_disabled_in_public`.
-- 58 tablas tienen rowsecurity=false y el rol anon (llave pública del navegador)
-- tiene SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER sobre 116 tablas.
-- Con eso, cualquiera que extraiga la llave anon del bundle JS puede leer/escribir
-- toda la base sin autenticarse.
--
-- Estrategia (validada contra el código del dashboard):
--   - Crítica (1): marketplace_tokens expone tokens OAuth de MeLi a {public}.
--     Se eliminan sus políticas públicas y queda solo service_role.
--   - Grupo A (53 tablas): sin uso cliente (anon). ENABLE RLS sin políticas = DENY ALL
--     para anon/authenticated. El servidor Next.js y Apps Script usan service_role
--     (bypassa RLS), así que siguen funcionando.
--   - Grupo B (4 tablas): lectura desde el navegador con anon. ENABLE RLS +
--     política SELECT TO anon USING (true): bloquea escritura/borrado, preserva lectura.
--   - Caso especial (1): fichas_tecnicas YA tiene 9 políticas (authenticated +
--     public-con-auth.role()). Se le activa RLS y se añade UNA política SELECT para
--     anon (solo lectura) para no romper fichas/[id]/page.tsx (cliente con anon).
--   Total: 53 + 4 + 1 = 58 tablas sin RLS (verificado en pg_tables) + marketplace_tokens.
--
-- NOTA: este script NO revoca los GRANT de tabla de anon. Con RLS activo, Postgres
-- aplica DENY ALL por defecto cuando no hay política aplicable, lo cual es la
-- corrección estándar que también limpia la alerta del Security Advisor.
-- Es idempotente: ENABLE RLS y DROP POLICY IF EXISTS / CREATE POLICY son re-ejecutables.

-- ============================================================
-- 1. CRÍTICA: marketplace_tokens (fuga de tokens MeLi)
-- ============================================================
DROP POLICY IF EXISTS "Public read tokens"  ON public.marketplace_tokens;
DROP POLICY IF EXISTS "Public write tokens" ON public.marketplace_tokens;
ALTER TABLE public.marketplace_tokens ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. GRUPO A: 53 tablas sin uso cliente — DENY ALL para anon
-- ============================================================
ALTER TABLE public._val_precios_v116                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.avisos_movimientos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalogo_proveedor               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clientes                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.costos_pendientes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.egresos                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.egresos_backup_sin_id            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envio_planificado_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.envios_planificados              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ficha_auditoria                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historial_cambios_precio         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingresos                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingresos_backup_sin_id           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listas_precios_proveedor_backup  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mapeo_backup_897aa205            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_settlements          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meli_webhook_events              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_publicacion_sync_queue        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operadores                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orden_items_backup_897aa205      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orden_items_purge_897aa205       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedido_items                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pedidos                          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.politica_stock                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precio_recalc_queue              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precio_revisiones_manuales       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_proveedor_actual         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.precios_publicados               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_drafts_backup_897aa205   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_history_backup_897aa205  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rule_v3                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_articulos_alias        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_feeds_log              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedor_locks                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proveedores                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicacion_auditoria_log        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicaciones_externas_backup_897aa205 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publicaciones_externas_purge_897aa205  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rangos_descuento                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rangos_envio                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reglas_precio                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_metrics                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets_venta                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tipos_cambio                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usuarios                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendedores                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_diarias_ml                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vinculacion_clasificada          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vinculacion_rechazos             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_buffer                   ENABLE ROW LEVEL SECURITY;

-- webhook_config: el frontend NO lo consulta (solo lib/dispatch-worker.ts y
-- lib/webhook-config-cache.ts, ambos server con supabaseAdmin). Se cierra.
ALTER TABLE public.webhook_config                   ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 3. GRUPO B: 4 tablas de lectura cliente (anon) — solo lectura
-- ============================================================
-- costos_articulo: mapping-modal.tsx, vincular-vitrina-modal.tsx ("use client" + supabase)
ALTER TABLE public.costos_articulo ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS costos_articulo_select_anon ON public.costos_articulo;
CREATE POLICY costos_articulo_select_anon ON public.costos_articulo FOR SELECT TO anon USING (true);

-- publication_pricing_drafts: precios/auditoria/page.tsx ("use client" + supabase)
ALTER TABLE public.publication_pricing_drafts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS publication_pricing_drafts_select_anon ON public.publication_pricing_drafts;
CREATE POLICY publication_pricing_drafts_select_anon ON public.publication_pricing_drafts FOR SELECT TO anon USING (true);

-- importaciones_excel: progreso-importacion.tsx ("use client" + supabaseBrowser Realtime)
ALTER TABLE public.importaciones_excel ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS importaciones_excel_select_anon ON public.importaciones_excel;
CREATE POLICY importaciones_excel_select_anon ON public.importaciones_excel FOR SELECT TO anon USING (true);

-- ficha_extracciones: fichas/[id]/page.tsx la consulta vía select ANIDADO
-- (fichas_tecnicas → ficha_extracciones(...)). Con RLS y sin política para anon,
-- PostgREST devuelve [] y el "Historial de extracciones" desaparece de la UI.
ALTER TABLE public.ficha_extracciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ficha_extracciones_select_anon ON public.ficha_extracciones;
CREATE POLICY ficha_extracciones_select_anon ON public.ficha_extracciones FOR SELECT TO anon USING (true);

-- ============================================================
-- 4. CASO ESPECIAL: fichas_tecnicas (ya tiene 9 políticas)
-- ============================================================
-- Ya tiene políticas authenticated + public(con auth.role()='authenticated').
-- Al activar RLS, esas políticas entran en vigor. Se añade una política SELECT
-- para anon (solo lectura) porque fichas/[id]/page.tsx lee con anon (cliente).
ALTER TABLE public.fichas_tecnicas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fichas_tecnicas_select_anon ON public.fichas_tecnicas;
CREATE POLICY fichas_tecnicas_select_anon ON public.fichas_tecnicas FOR SELECT TO anon USING (true);
