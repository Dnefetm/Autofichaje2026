import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// GET /api/ventas/menudeo?q=... — artículos con precio de menudeo, de DOS fuentes:
//   1) Catálogo (articulos + costos_articulo tipo='menudeo')  → con stock disponible
//   2) Lista de proveedor (vinculacion_clasificada, lote más reciente por proveedor)
//      con mapeo dinámico correcto: sku_proveedor=modelo, codigo_barra=GTIN,
//      marca_proveedor, descripcion_proveedor, menudeo.
//   Se deduplica: si un artículo de la lista ya está vinculado al catálogo y
//   aparece en los resultados del catálogo, no se repite como "proveedor".
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') || '').trim();

  // ── 1. Catálogo ────────────────────────────────────────────────
  const { data: costos, error: errCostos } = await supabaseAdmin
    .from('costos_articulo')
    .select('articulo_id, valor')
    .eq('tipo_costo', 'menudeo')
    .eq('vigente', true);
  if (errCostos) return NextResponse.json({ error: errCostos.message }, { status: 500 });

  const precioCat: Record<string, number> = {};
  for (const c of costos || []) precioCat[c.articulo_id] = Number(c.valor);

  let artQuery = supabaseAdmin
    .from('articulos')
    .select('articulo_id, nombre, marca, modelo');
  if (q) artQuery = artQuery.or(`nombre.ilike.%${q}%,marca.ilike.%${q}%,modelo.ilike.%${q}%,articulo_id.ilike.%${q}%`);
  const { data: articulos, error: errArt } = await artQuery.limit(50);
  if (errArt) return NextResponse.json({ error: errArt.message }, { status: 500 });

  // Stock disponible (físico - reservado) para la leyenda en el pedido
  const catIds = (articulos || []).map((a: any) => a.articulo_id);
  const disp: Record<string, number> = {};
  if (catIds.length) {
    const { data: snap } = await supabaseAdmin
      .from('inventory_snapshot')
      .select('sku, physical_stock, reserved_stock')
      .in('sku', catIds);
    for (const s of snap || []) {
      disp[s.sku] = Math.max(0, (Number(s.physical_stock) || 0) - (Number(s.reserved_stock) || 0));
    }
  }

  const itemsCatalogo = (articulos || []).map((a: any) => ({
    tipo: 'catalogo',
    articulo_id: a.articulo_id,
    nombre: a.nombre,
    marca: a.marca,
    modelo: a.modelo,
    precio_menudeo: precioCat[a.articulo_id] || 0,
    disponible: disp[a.articulo_id] ?? 0,
  }));

  // ── 2. Lista de proveedor (lote más reciente por proveedor) ────
  const { data: lotes, error: errLotes } = await supabaseAdmin
    .from('importaciones_excel')
    .select('id, proveedor')
    .order('creado_el', { ascending: false });
  if (errLotes) return NextResponse.json({ error: errLotes.message }, { status: 500 });

  const lotePorProveedor: Record<string, string> = {};
  for (const l of lotes || []) {
    if (!lotePorProveedor[l.proveedor]) lotePorProveedor[l.proveedor] = l.id;
  }
  const lotesIds = Object.values(lotePorProveedor);
  const proveedorPorLote: Record<string, string> = {};
  for (const l of lotes || []) proveedorPorLote[l.id] = l.proveedor;

  // Código corto del proveedor (tabla proveedores; puede estar vacía aún)
  const { data: provs } = await supabaseAdmin
    .from('proveedores')
    .select('nombre, codigo_corto');
  const cortoPorNombre: Record<string, string> = {};
  for (const p of provs || []) cortoPorNombre[p.nombre] = p.codigo_corto || '';

  let provQuery = supabaseAdmin
    .from('vinculacion_clasificada')
    .select('sku_proveedor, codigo_barra, marca_proveedor, descripcion_proveedor, menudeo, articulo_id, importacion_id')
    .in('importacion_id', lotesIds.length ? lotesIds : ['00000000-0000-0000-0000-000000000000']);
  if (q) provQuery = provQuery.or(`sku_proveedor.ilike.%${q}%,descripcion_proveedor.ilike.%${q}%,marca_proveedor.ilike.%${q}%,codigo_barra.ilike.%${q}%`);
  const { data: provItems, error: errProv } = await provQuery.limit(50);
  if (errProv) return NextResponse.json({ error: errProv.message }, { status: 500 });

  // Deduplicar: omitir items de proveedor cuyo articulo_id ya está en el catálogo
  const catIdsSet = new Set(catIds);
  const itemsProveedor = (provItems || [])
    .filter((p: any) => !p.articulo_id || !catIdsSet.has(p.articulo_id))
    .map((p: any) => {
      const nombreProv = proveedorPorLote[p.importacion_id] || '';
      return {
        tipo: 'proveedor',
        proveedor: nombreProv,
        proveedor_corto: cortoPorNombre[nombreProv] || nombreProv,
        modelo: p.sku_proveedor,          // referencia/N° parte (alfanumérico)
        gtin: p.codigo_barra,             // código universal (12-13 dígitos)
        marca: p.marca_proveedor,
        descripcion: p.descripcion_proveedor,
        precio_menudeo: Number(p.menudeo) || 0,
        articulo_id: p.articulo_id,       // si ya está vinculado al catálogo
        disponible: 0,                    // lista de proveedor → por surtir
      };
    });

  return NextResponse.json({ items: [...itemsCatalogo, ...itemsProveedor] });
}
