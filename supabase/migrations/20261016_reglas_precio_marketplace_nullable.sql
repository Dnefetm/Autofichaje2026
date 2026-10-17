-- 20261016: permitir regla "general" (sin marketplace) en reglas_precio
ALTER TABLE public.reglas_precio ALTER COLUMN marketplace_id DROP NOT NULL;
