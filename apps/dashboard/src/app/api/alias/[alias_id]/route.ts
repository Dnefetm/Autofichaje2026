import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';

export async function PATCH(req: NextRequest, { params }: { params: { alias_id: string } }) {
  const supabase = createRouteHandlerClient({ cookies });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = await req.json();
  const updateData: any = {};
  
  if (body.locked !== undefined) {
    updateData.locked = body.locked;
    updateData.locked_at = body.locked ? new Date().toISOString() : null;
    updateData.locked_by = body.locked ? user.id : null;
  }
  if (body.articulo_id !== undefined) {
    updateData.articulo_id = body.articulo_id;
  }
  if (body.estado_proveedor !== undefined) {
    updateData.estado_proveedor = body.estado_proveedor;
  }

  const { data, error } = await supabase
    .from('proveedor_articulos_alias')
    .update(updateData)
    .eq('id', params.alias_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
