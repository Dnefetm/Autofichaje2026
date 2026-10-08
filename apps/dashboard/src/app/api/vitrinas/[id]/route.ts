import { NextRequest, NextResponse } from 'next/server';
import { applyVitrinaChanges } from '@/lib/vitrina-sync';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/vitrinas/[id]
 * Body: { changes: [{ field, value }, ...] }
 * Valida contra el esquema declarativo, sincroniza a MeLi (mecanismo real por
 * campo) y persiste localmente. Los fallos se reportan por campo.
 */
export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const changes = body?.changes;

    if (!Array.isArray(changes) || changes.length === 0) {
        return NextResponse.json({ ok: false, error: 'Se requiere changes: [{field, value}]' }, { status: 400 });
    }

    try {
        const result = await applyVitrinaChanges(id, changes);
        return NextResponse.json(result);
    } catch (err: any) {
        const msg =
            err?.response?.data?.message ||
            err?.response?.data?.error ||
            err?.message ||
            'Error al sincronizar';
        console.error('[PATCH /api/vitrinas/[id]]', msg);
        return NextResponse.json({ ok: false, error: typeof msg === 'string' ? msg : JSON.stringify(msg) }, { status: 500 });
    }
}
