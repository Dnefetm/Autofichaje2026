import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    
    // Parse the body to require the manual approval flag
    let body;
    try {
      body = await req.json();
    } catch (e) {
      body = {};
    }

    if (body.aprobado !== true) {
      return NextResponse.json({ ok: false, error: 'Falta validación humana. La variable aprobado debe ser true.' }, { status: 403 });
    }

    // Delegate to the secure Edge Function
    const { data, error: edgeErr } = await supabaseAdmin.functions.invoke('consolidar-importacion', {
      body: {
        importacion_id: id,
        aprobado: true
      }
    });

    if (edgeErr || (data && data.error)) {
      throw new Error(edgeErr?.message || data?.error || 'Error en Edge Function de consolidación');
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || 'Error al consolidar la importación' },
      { status: 500 }
    );
  }
}
