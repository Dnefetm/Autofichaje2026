-- =============================================================================
-- MIGRACIÓN v127: "voz de marca" para perfiles de prompts de publicación.
-- =============================================================================
-- Añade la capa SIMPLE sobre la que se compila el prompt en runtime:
--   instructions (lenguaje natural) + toggles (tono, longitud, qué incluir, idioma).
-- `system_prompt` se conserva como override de "modo experto" (si está, se usa tal cual).
-- El bloque anti-alucinación se antepone SIEMPRE en código (no editable).

ALTER TABLE prompt_profiles
    ADD COLUMN IF NOT EXISTS instructions    TEXT,
    ADD COLUMN IF NOT EXISTS tone            TEXT,
    ADD COLUMN IF NOT EXISTS length_pref     TEXT,
    ADD COLUMN IF NOT EXISTS include_measures  BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS include_brand     BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS include_model     BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS include_material  BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS language          TEXT DEFAULT 'es-MX';

-- =============================================================================
-- Herencia en cascada: override por cuenta o por categoría.
-- Resolución: exacta (cuenta+categoría) > categoría > cuenta > override global >
--             perfil default del scope.
-- =============================================================================
CREATE TABLE IF NOT EXISTS prompt_profile_overrides (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope          TEXT NOT NULL CHECK (scope IN ('title', 'description')),
    profile_id     UUID REFERENCES prompt_profiles(id) ON DELETE CASCADE,
    marketplace_id UUID REFERENCES marketplace_configs(id) ON DELETE CASCADE,
    categoria      TEXT,
    created_at     TIMESTAMPTZ DEFAULT now(),
    updated_at     TIMESTAMPTZ DEFAULT now()
);

-- Un solo override por (scope, cuenta, categoría). NULLs tratados con COALESCE
-- para que "global por scope" sea único.
CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_profile_overrides_uniq
    ON prompt_profile_overrides (scope, COALESCE(marketplace_id::text, ''), COALESCE(categoria, ''));

ALTER TABLE prompt_profile_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read prompt_profile_overrides" ON prompt_profile_overrides;
CREATE POLICY "Public read prompt_profile_overrides" ON prompt_profile_overrides
    FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Public write prompt_profile_overrides" ON prompt_profile_overrides;
CREATE POLICY "Public write prompt_profile_overrides" ON prompt_profile_overrides
    FOR ALL TO public USING (true) WITH CHECK (true);
