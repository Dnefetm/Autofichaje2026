import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
    try {
        const { data: aliasData, error: aliasErr } = await supabase
            .from('proveedor_articulos_alias')
            .select('proveedor')
            .eq('locked', true);
        if (aliasErr) throw aliasErr;

        const uniqueProveedores = Array.from(new Set(aliasData.map((a: any) => a.proveedor).filter(Boolean)));
        const { data: configData, error: configErr } = await supabase
            .from('proveedor_configs')
            .select('*');
            
        if (configErr) {
            if (configErr.code === '42P01') {
                return NextResponse.json(uniqueProveedores.map(p => ({
                    proveedor: p,
                    tipo_costo_preferido: null,
                    aplica_regla_margen: true
                })));
            }
            throw configErr;
        }

        const configMap = configData.reduce((acc: any, curr: any) => {
            acc[curr.proveedor] = curr;
            return acc;
        }, {} as Record<string, any>);

        const result = uniqueProveedores.map(p => ({
            proveedor: p,
            tipo_costo_preferido: configMap[p]?.tipo_costo_preferido || null,
            aplica_regla_margen: configMap[p]?.aplica_regla_margen ?? true
        }));
        return NextResponse.json(result);
    } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

export async function PUT(req: Request) {
    try {
        const body = await req.json();
        const { proveedor, tipo_costo_preferido, aplica_regla_margen } = body;
        if (!proveedor) return NextResponse.json({ error: 'Proveedor is required' }, { status: 400 });

        const { data, error } = await supabase
            .from('proveedor_configs')
            .upsert({
                proveedor,
                tipo_costo_preferido,
                aplica_regla_margen,
                updated_at: new Date().toISOString()
            }, { onConflict: 'proveedor' })
            .select()
            .single();
        if (error) throw error;
        return NextResponse.json(data);
    } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 500 }); }
}

