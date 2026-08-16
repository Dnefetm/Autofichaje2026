import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase-server';
import { cookies } from 'next/headers';

export async function GET(req: NextRequest) {
  const supabase = await createRouteHandlerClient();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') || '';
  
  let query = supabase
    .from('proveedor_articulos_alias')
    .select('id, proveedor, codigo_excel, marca_excel, modelo_excel, articulo_id, locked, estado_proveedor')
    .neq('estado_proveedor', 'eliminado')
    .order('ultima_vez_visto', { ascending: false })
    .limit(50);
    
  if (q) {
    query = query.or(`proveedor.ilike.%${q}%,codigo_excel.ilike.%${q}%,marca_excel.ilike.%${q}%,modelo_excel.ilike.%${q}%,articulo_id.ilike.%${q}%`);
  }
  
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  
  return NextResponse.json(data);
}
