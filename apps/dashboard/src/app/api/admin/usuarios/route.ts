import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

const ROLES = ['admin', 'vendedor_propio', 'vendedor_tercero', 'operador', 'cliente'] as const;

// GET: usuarios actuales + usuarios de auth + entidades para asignar rol.
export async function GET() {
  const [authRes, usuariosRes, operadoresRes, vendedoresRes, clientesRes] = await Promise.all([
    supabaseAdmin.auth.admin.listUsers(),
    supabaseAdmin.from('usuarios').select('*'),
    supabaseAdmin.from('operadores').select('id, nombre'),
    supabaseAdmin.from('vendedores').select('id, nombre'),
    supabaseAdmin.from('clientes').select('id, nombre'),
  ]);

  if (authRes.error) {
    return NextResponse.json({ error: authRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    roles: ROLES,
    authUsers: (authRes.data.users ?? []).map((u) => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
    })),
    usuarios: usuariosRes.data ?? [],
    operadores: operadoresRes.data ?? [],
    vendedores: vendedoresRes.data ?? [],
    clientes: clientesRes.data ?? [],
  });
}

// POST: asigna/actualiza un rol a un usuario de auth.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || !body.id || !body.rol) {
    return NextResponse.json({ error: 'id y rol son obligatorios' }, { status: 400 });
  }
  const { id, nombre, rol, operador_id, vendedor_id, cliente_id, activo } = body;
  if (!ROLES.includes(rol)) {
    return NextResponse.json({ error: 'rol inválido' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('usuarios')
    .upsert(
      {
        id,
        nombre: nombre ?? null,
        rol,
        operador_id: operador_id ?? null,
        vendedor_id: vendedor_id ?? null,
        cliente_id: cliente_id ?? null,
        activo: activo ?? true,
      },
      { onConflict: 'id' }
    )
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ usuario: data });
}
