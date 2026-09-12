import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { compileProfilePrompt } from '@gestor/sync/prompt-profiles';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prompt-profiles?scope=title|description
 * POST /api/prompt-profiles
 *   -> { scope, name, system_prompt?, instructions?, tone?, length_pref?,
 *        include_measures?, include_brand?, include_model?, include_material?,
 *        language?, temperature?, max_chars?, is_default?, is_active?,
 *        marketplace_id?, categoria? }
 *
 * Si viene `system_prompt` se usa tal cual (modo experto). Si NO viene pero sí
 * `instructions`, se compila el prompt desde la capa simple.
 * Si viene `marketplace_id` o `categoria`, se crea/actualiza un override de herencia
 * apuntando al perfil (además de guardar el perfil).
 */
export async function GET(req: NextRequest) {
    const scope = req.nextUrl.searchParams.get('scope');
    try {
        let q = supabaseAdmin.from('prompt_profiles').select('*');
        if (scope) q = q.eq('scope', scope);
        const { data, error } = await q.order('scope', { ascending: true }).order('is_default', { ascending: false }).order('name', { ascending: true });
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, profiles: data || [] });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => null);
    if (!body?.scope || !body?.name || (!body?.system_prompt && !body?.instructions)) {
        return NextResponse.json({ ok: false, error: 'Se requieren scope, name y (system_prompt o instructions)' }, { status: 400 });
    }
    if (!['title', 'description'].includes(body.scope)) {
        return NextResponse.json({ ok: false, error: 'scope debe ser title o description' }, { status: 400 });
    }

    // Compilar la capa simple a system_prompt cuando no hay override experto.
    let system_prompt: string = (body.system_prompt || '').trim();
    if (!system_prompt && (body.instructions || '').trim()) {
        system_prompt = compileProfilePrompt(
            {
                instructions: body.instructions,
                tone: body.tone,
                length_pref: body.length_pref,
                include_measures: body.include_measures !== false,
                include_brand: body.include_brand !== false,
                include_model: body.include_model === true,
                include_material: body.include_material !== false,
                language: body.language || 'es-MX',
            },
            body.scope,
        );
    }

    try {
        const { data, error } = await supabaseAdmin
            .from('prompt_profiles')
            .upsert({
                name: body.name.trim(),
                scope: body.scope,
                system_prompt,
                instructions: body.instructions ?? null,
                tone: body.tone ?? null,
                length_pref: body.length_pref ?? null,
                include_measures: body.include_measures !== false,
                include_brand: body.include_brand !== false,
                include_model: body.include_model === true,
                include_material: body.include_material !== false,
                language: body.language || 'es-MX',
                temperature: Number(body.temperature ?? 0.3),
                max_chars: Number(body.max_chars ?? (body.scope === 'title' ? 60 : 2000)),
                is_default: body.is_default === true,
                is_active: body.is_active !== false,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'scope,name' })
            .select()
            .single();
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

        // Override de herencia (cuenta/categoría) si se indicó.
        if (data && (body.marketplace_id || body.categoria)) {
            const { error: ovErr } = await supabaseAdmin
                .from('prompt_profile_overrides')
                .upsert({
                    scope: data.scope,
                    profile_id: data.id,
                    marketplace_id: body.marketplace_id ?? null,
                    categoria: body.categoria ?? null,
                    updated_at: new Date().toISOString(),
                }, { onConflict: 'scope,marketplace_id,categoria' });
            if (ovErr) return NextResponse.json({ ok: false, error: ovErr.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, profile: data });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
