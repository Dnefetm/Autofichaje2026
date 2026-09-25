-- =============================================================================
-- MIGRACIÓN v125: Perfiles de prompts para IA de publicación
-- =============================================================================
-- Permite editar el prompt de generación de TÍTULO y de DESCRIPCIÓN por separado,
-- con perfiles globales. El bloque anti-alucinación se antepone SIEMPRE en código
-- (no es editable) — aquí solo vive la parte editable (fórmula/estilo).

CREATE TABLE IF NOT EXISTS prompt_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    scope TEXT NOT NULL CHECK (scope IN ('title', 'description')),
    system_prompt TEXT NOT NULL,
    temperature NUMERIC(3,2) NOT NULL DEFAULT 0.3,
    max_chars INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (scope, name)
);

-- RLS: lectura pública (patrón del proyecto) + escritura desde el dashboard
ALTER TABLE prompt_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read prompt_profiles" ON prompt_profiles;
CREATE POLICY "Public read prompt_profiles" ON prompt_profiles
    FOR SELECT TO public USING (true);
DROP POLICY IF EXISTS "Public write prompt_profiles" ON prompt_profiles;
CREATE POLICY "Public write prompt_profiles" ON prompt_profiles
    FOR ALL TO public USING (true) WITH CHECK (true);

-- Seed: perfiles por defecto (título y descripción)
INSERT INTO prompt_profiles (name, scope, system_prompt, temperature, max_chars, is_active, is_default)
VALUES
  (
    'Título por defecto',
    'title',
    'Eres un redactor experto en títulos para MercadoLibre México (ferretería/herramientas).
Genera un "title" de MÁXIMO 60 caracteres INCLUYENDO ESPACIOS, con esta fórmula EXACTA:
nombre del producto + características principales en orden de prioridad (tipo, medida, material, acabado) + marca.
NO uses el modelo. Usa el máximo de caracteres sin pasarte de 60.
Responde SOLO JSON: { "title": "..." }',
    0.3, 60, true, true
  ),
  (
    'Descripción por defecto',
    'description',
    'Eres un redactor experto en descripciones de venta para MercadoLibre México (ferretería/herramientas).
Genera una "description" en texto plano con 4-8 bullets "•" de beneficios/características REALES y, al final, una línea de ficha técnica (medidas, peso, material, país de origen SOLO si existen en los datos de entrada).
NO inventes datos que no estén en la entrada.
Responde SOLO JSON: { "description": "..." }',
    0.3, 2000, true, true
  )
ON CONFLICT (scope, name) DO NOTHING;
