import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
    try {
        const headerList = headers();
        const token = headerList.get('authorization')?.split('Bearer ')[1];
        if (!token) {
            return NextResponse.json({ ok: false, error: 'No autorizado' }, { status: 401 });
        }
        
        const { data: { user }, error: userErr } = await supabaseAdmin.auth.getUser(token);
        if (userErr || !user) {
            return NextResponse.json({ ok: false, error: 'Usuario inválido' }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const proveedor = searchParams.get('proveedor');
        const marca = searchParams.get('marca');
        const modelo = searchParams.get('modelo');
        const limit = Number(searchParams.get('limit') || '50');
        const incluir_revertidos = searchParams.get('incluir_revertidos') === 'true';

        if (!proveedor) {
            return NextResponse.json({ ok: false, error: 'proveedor es requerido' }, { status: 400 });
        }

        let { data: filas, error: fetchErr } = await supabaseAdmin.rpc('fn_buscar_listas_raw', {
            p_proveedor: proveedor,
            p_marca: marca || null,
            p_modelo: modelo || null,
            p_limit: limit,
            p_incluir_revertidos: incluir_revertidos
        });

        if (fetchErr) {
            return NextResponse.json({ ok: false, error: fetchErr.message }, { status: 500 });
        }

        return NextResponse.json({ ok: true, filas });

    } catch (error: any) {
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
}
