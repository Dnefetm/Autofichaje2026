import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/prompt-profiles?scope=title|description
 * POST /api/prompt-profiles  -> { scope, name, system_prompt, temperature, max_chars, is_default }
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
    if (!body?.scope || !body?.name || !body?.system_prompt) {
        return NextResponse.json({ ok: false, error: 'Se requieren scope, name y system_prompt' }, { status: 400 });
    }
    if (!['title', 'description'].includes(body.scope)) {
        return NextResponse.json({ ok: false, error: 'scope debe ser title o description' }, { status: 400 });
    }
    try {
        const { data, error } = await supabaseAdmin
            .from('prompt_profiles')
            .upsert({
                name: body.name.trim(),
                scope: body.scope,
                system_prompt: body.system_prompt,
                temperature: Number(body.temperature ?? 0.3),
                max_chars: Number(body.max_chars ?? (body.scope === 'title' ? 60 : 2000)),
                is_default: body.is_default === true,
                is_active: body.is_active !== false,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'scope,name' })
            .select()
            .single();
        if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true, profile: data });
    } catch (e: any) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
    }
}
