-- =============================================================================
-- v103: Índice GIN para eliminar sequential scans en jobs.payload
-- =============================================================================
-- El webhook usa .contains('payload', { resource }) y .contains('payload', { external_item_id })
-- que traducen a `payload @> '{...}'::jsonb` en Postgres.
-- Sin este índice, cada invocación hace un full scan de la tabla jobs.
-- Con jsonb_path_ops: optimizado para operador @> (contains), más compacto que GIN default.
-- Partial index: solo indexa jobs pending, que es lo único que el webhook consulta.

CREATE INDEX IF NOT EXISTS idx_jobs_payload_gin_pending
ON jobs USING GIN (payload jsonb_path_ops)
WHERE status = 'pending';
