import { NextRequest, NextResponse } from 'next/server';
import { registrarAuditoria } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

/**
 * POST /api/catalog/external/[id]/audit-mark
 * Body: { ambito?: 'precio' | 'publicacion', accion?: string }
 * Marca manualmente una publicación como revisada (sin modificar nada en MeLi).
 */
export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const ambito = body.ambito === 'precio' ? 'precio' : 'publicacion';
    const accion = body.accion || 'revisada_ok';
    const detalle = (body.detalle && typeof body.detalle === 'object') ? body.detalle : {};

    await registrarAuditoria(id, ambito, accion, { manual: true, ...detalle });

    return NextResponse.json({ ok: true });
}
