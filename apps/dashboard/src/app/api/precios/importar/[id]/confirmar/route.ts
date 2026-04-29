import { supabaseAdmin } from '@/lib/supabase';
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const { decisiones } = await req.json() as {
    decisiones: { id: string; articulo_id: string }[];
  };

  const { data, error } = await supabaseAdmin.rpc('fn_confirmar_matching_decisiones', {
    _importacion_id: id,
    _decisiones: decisiones,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  
  // Need to return pendientes_restantes for the UI
  const { count: pendientes } = await supabaseAdmin
    .from('matching_decisiones')
    .select('id', { count: 'exact', head: true })
    .eq('importacion_id', id)
    .is('confirmado_at', null);

  if (pendientes === 0) {
      await supabaseAdmin.from('importaciones_excel').update({ estado: 'completado' }).eq('id', id);
  }

  return NextResponse.json({ 
      ok: true, 
      confirmados: data?.[0]?.decisiones_confirmadas || 0,
      alias_aprendidos: data?.[0]?.alias_aprendidos || 0,
      pendientes_restantes: pendientes || 0 
  });
}