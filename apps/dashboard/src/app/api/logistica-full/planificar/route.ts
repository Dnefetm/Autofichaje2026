import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// GET — lista envíos planificados (o uno por id)
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
        const { data: envio } = await supabaseAdmin
            .from('envios_planificados')
            .select('*')
            .eq('id', id)
            .maybeSingle();
        const { data: items } = await supabaseAdmin
            .from('envio_planificado_items')
            .select('*')
            .eq('envio_id', id)
            .order('inventory_id');
        return NextResponse.json({ success: true, envio, items: items || [] });
    }

    const { data: envios, error } = await supabaseAdmin
        .from('envios_planificados')
        .select('id, guia, estado, notas, fecha_creacion, fecha_confirmacion')
        .order('fecha_creacion', { ascending: false })
        .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, envios: envios || [] });
}

// POST — crea un borrador de envío planificado
// body: { marketplace_id?, notas?, items: [{ inventory_id, nombre?, cantidad, objetivo? }] }
export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { marketplace_id, notas, items } = body;

        const { data: envio, error } = await supabaseAdmin
            .from('envios_planificados')
            .insert({ estado: 'borrador', marketplace_id: marketplace_id ?? null, notas: notas ?? null })
            .select('id')
            .single();
        if (error) throw error;
        const envioId = envio.id;

        if (Array.isArray(items) && items.length > 0) {
            const rows = items.map((it: any) => ({
                envio_id: envioId,
                inventory_id: String(it.inventory_id),
                nombre: it.nombre ?? null,
                cantidad: Number(it.cantidad) || 0,
                objetivo: it.objetivo != null ? Number(it.objetivo) : null,
            }));
            const { error: insErr } = await supabaseAdmin.from('envio_planificado_items').insert(rows);
            if (insErr) throw insErr;
        }

        return NextResponse.json({ success: true, id: envioId });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error creando envío' }, { status: 500 });
    }
}

// PATCH — guardar items / confirmar / cerrar
// body: { id, accion: 'guardar'|'confirmar'|'cerrar', items?, notas? }
export async function PATCH(req: Request) {
    try {
        const body = await req.json();
        const { id, accion, items, notas } = body;
        if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });

        if (accion === 'guardar' && Array.isArray(items)) {
            // Reemplaza los items del envío (decisión del operario).
            await supabaseAdmin.from('envio_planificado_items').delete().eq('envio_id', id);
            const rows = items.map((it: any) => ({
                envio_id: id,
                inventory_id: String(it.inventory_id),
                nombre: it.nombre ?? null,
                cantidad: Number(it.cantidad) || 0,
                objetivo: it.objetivo != null ? Number(it.objetivo) : null,
            }));
            if (rows.length > 0) {
                const { error: insErr } = await supabaseAdmin.from('envio_planificado_items').insert(rows);
                if (insErr) throw insErr;
            }
            const upd: any = {};
            if (notas !== undefined) upd.notas = notas;
            await supabaseAdmin.from('envios_planificados').update(upd).eq('id', id);
            return NextResponse.json({ success: true });
        }

        if (accion === 'confirmar') {
            await supabaseAdmin
                .from('envios_planificados')
                .update({ estado: 'confirmado', fecha_confirmacion: new Date().toISOString() })
                .eq('id', id);
            return NextResponse.json({ success: true });
        }

        if (accion === 'cerrar') {
            await supabaseAdmin
                .from('envios_planificados')
                .update({ estado: 'cerrado', fecha_cierre: new Date().toISOString() })
                .eq('id', id);
            return NextResponse.json({ success: true });
        }

        return NextResponse.json({ error: 'accion desconocida' }, { status: 400 });
    } catch (err: any) {
        return NextResponse.json({ error: err.message || 'Error actualizando envío' }, { status: 500 });
    }
}

// DELETE — descarta un borrador
export async function DELETE(req: Request) {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 });
    const { error } = await supabaseAdmin.from('envios_planificados').delete().eq('id', id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
}
