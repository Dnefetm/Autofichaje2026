import { supabaseAdmin } from '@/lib/supabase';
import { ProductDiffPanel } from './ProductDiffPanel';

export default async function RevisarPaso2(props: { params: Promise<{ proveedor: string }> }) {
  const params = await props.params;
  const proveedorDecoded = decodeURIComponent(params.proveedor);

  const { data: ultimas } = await supabaseAdmin
    .from('v_importaciones_historial')
    .select('*')
    .eq('proveedor', proveedorDecoded)
    .order('creado_el', { ascending: false })
    .limit(1);

  const latestBatch = ultimas?.[0];
  if (!latestBatch) {
    return (
      <div className="p-8 text-center text-[var(--text-muted)]">
        No hay importaciones recientes para revisar. Sube un archivo primero.
      </div>
    );
  }

  const { count: c } = await supabaseAdmin
    .from('v_importaciones_historial')
    .select('*', { count: 'exact', head: true })
    .eq('proveedor', proveedorDecoded)
    .lte('creado_el', latestBatch.creado_el);
  const loteNum = c || 1;

  // Los costos a revisar son los de este lote que NO fueron rechazados.
  // (El pipeline produce 'match_exacto'/'match_similitud'/'sugerido', no 'completado'.)
  const { data: costosNuevos, error } = await supabaseAdmin
    .from('costos_articulo')
    .select('*, articulo:articulo_id(nombre)')
    .eq('importacion_id', latestBatch.id)
    .neq('estado_match', 'rechazado')
    .order('actualizado_el', { ascending: false });

  // FIX v88: costos_articulo NO tiene columna 'proveedor'.
  // Filtrar costos vigentes previos via importaciones_excel del mismo proveedor.
  const { data: importsDelProveedor } = await supabaseAdmin
    .from('importaciones_excel')
    .select('id')
    .eq('proveedor', proveedorDecoded);
  const importIdsPrev = (importsDelProveedor || [])
    .map((i: any) => i.id)
    .filter((id: string) => id !== latestBatch.id);

  const { data: costosVigentes } = importIdsPrev.length
    ? await supabaseAdmin
        .from('costos_articulo')
        .select('*')
        .eq('vigente', true)
        .in('importacion_id', importIdsPrev)
    : { data: [] as any[] };

  const groupedMap = new Map<string, any>();
  const getOrCreateGroup = (articulo_id: string, refItem: any) => {
    if (!groupedMap.has(articulo_id)) {
      groupedMap.set(articulo_id, {
        articulo_id,
        codigo_universal: refItem.codigo_universal_excel || refItem.codigo_excel || '-',
        marca: refItem.marca_excel || '',
        modelo: refItem.modelo_excel || '',
        nombre: refItem.articulo?.nombre || refItem.nombre || '',
        row_class: 'sin_cambio',
        tiers: {
          distribuidor:    { vigente: null, nuevo: null, id_nuevo: null },
          subdistribuidor: { vigente: null, nuevo: null, id_nuevo: null },
          mayoreo:         { vigente: null, nuevo: null, id_nuevo: null },
          menudeo:         { vigente: null, nuevo: null, id_nuevo: null }
        }
      });
    }
    return groupedMap.get(articulo_id);
  };

  const tierKeyOf = (tipo: string): string | null => {
    const t = (tipo || '').toLowerCase();
    if (t.includes('subdistribuidor')) return 'subdistribuidor';
    if (t.includes('distribuidor')) return 'distribuidor';
    if (t.includes('mayoreo')) return 'mayoreo';
    if (t.includes('menudeo')) return 'menudeo';
    return null;
  };

  (costosVigentes || []).forEach((v: any) => {
    if (!v.articulo_id) return;
    const group = getOrCreateGroup(v.articulo_id, v);
    const k = tierKeyOf(v.tipo_costo);
    if (k) group.tiers[k].vigente = v.valor;
  });

  (costosNuevos || []).forEach((n: any) => {
    if (!n.articulo_id) return;
    const group = getOrCreateGroup(n.articulo_id, n);
    if (!group.codigo_universal || group.codigo_universal === '-')
      group.codigo_universal = n.codigo_universal_excel || n.codigo_excel || '-';
    if (!group.marca) group.marca = n.marca_excel;
    if (!group.modelo) group.modelo = n.modelo_excel;
    const k = tierKeyOf(n.tipo_costo);
    if (k) {
      group.tiers[k].nuevo = n.valor;
      group.tiers[k].id_nuevo = n.id;
      group.isConfirmado = n.confirmado_por !== null;
    }
  });

  const diffData = Array.from(groupedMap.values()).map((g: any) => {
    let isNuevo = true;
    let isAusente = true;
    let hasCambios = false;
    Object.keys(g.tiers).forEach((kk) => {
      const t = g.tiers[kk];
      if (t.vigente !== null) isNuevo = false;
      if (t.nuevo !== null) isAusente = false;
      if (t.vigente !== null && t.nuevo !== null) {
        t.delta_val = t.nuevo - t.vigente;
        t.delta_pct = (t.delta_val / t.vigente) * 100;
        if (Math.abs(t.delta_pct) > 0.01) hasCambios = true;
      }
    });
    if (isNuevo) g.row_class = 'nuevo';
    else if (isAusente) g.row_class = 'ausente';
    else if (hasCambios) g.row_class = 'cambio';
    else g.row_class = 'sin_cambio';
    g.decision = g.isConfirmado ? 'aprobado' : 'pendiente';
    return g;
  });

  return (
    <div className="flex flex-col h-full bg-[var(--bg)]">
      {error ? (
        <div className="p-8 text-[var(--err)]">Error: {error.message}</div>
      ) : (
        <ProductDiffPanel
          importacion={latestBatch}
          loteNum={loteNum}
          proveedor={proveedorDecoded}
          diffData={diffData}
        />
      )}
    </div>
  );
}
