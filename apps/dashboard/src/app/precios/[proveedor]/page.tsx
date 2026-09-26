import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, History } from 'lucide-react';
import { CatalogoProveedorTable, HubItem, TierCol } from '@/components/precios/CatalogoProveedorTable';
import { CatalogoProveedorSearch } from '@/components/precios/CatalogoProveedorSearch';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const normalizeTier = (s: string) => (s || '').toLowerCase().trim();

// Lee los precios vigentes del lote (paginado) desde la tabla canónica.
// Si hay búsqueda, filtra del lado del servidor (SKU, marca o descripción).
async function fetchPrecios(importacionId: string, q: string): Promise<any[]> {
    const rows: any[] = [];
    let from = 0;
    while (true) {
        let query = supabaseAdmin
            .from('precios_proveedor')
            .select('sku_proveedor, marca, descripcion, tipo_costo, valor, columnas')
            .eq('importacion_id', importacionId)
            .eq('vigente', true);
        if (q) {
            const like = `%${q}%`;
            query = query.or(`sku_proveedor.ilike.${like},marca.ilike.${like},descripcion.ilike.${like}`);
        }
        const { data } = await query.range(from, from + 999);
        if (!data || data.length === 0) break;
        rows.push(...data);
        if (data.length < 1000) break;
        from += 1000;
    }
    return rows;
}

export default async function HubProveedorPage(props: {
    params: Promise<{ proveedor: string }>;
    searchParams: Promise<any>;
}) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const supa = supabaseAdmin;
    const q = (searchParams.q || '').trim();
    const page = parseInt(searchParams.page || '0', 10);
    const pageSize = 200;

    // 1. Última lista vigente o más reciente
    const { data: activeLpp } = await supa
        .from('listas_precios_proveedor')
        .select('importacion_id, total_filas, creado_el')
        .eq('proveedor', proveedorDecoded)
        .eq('vigente', true)
        .order('creado_el', { ascending: false })
        .limit(1);

    let importacionId = activeLpp?.[0]?.importacion_id;
    let fechaAct = activeLpp?.[0]?.creado_el;
    const estaVigente = !!activeLpp?.[0];

    if (!importacionId) {
        const { data: ultImp } = await supa
            .from('importaciones_excel')
            .select('id, total_filas, creado_el, estado')
            .eq('proveedor', proveedorDecoded)
            .order('creado_el', { ascending: false })
            .limit(1);
        importacionId = ultImp?.[0]?.id;
        fechaAct = ultImp?.[0]?.creado_el;
    }

    // 2. Mapeo de columnas → orden de los tipos de costo (columnas de precio dinámicas)
    let mapeo: any = null;
    if (importacionId) {
        const { data: impMapeo } = await supa
            .from('importaciones_excel')
            .select('mapeo_columnas')
            .eq('id', importacionId)
            .single();
        mapeo = impMapeo?.mapeo_columnas || null;
    }
    const mapeoOrder = (mapeo?.precios || []).map((pr: any) => normalizeTier(pr.tipo_costo)).filter(Boolean);

    // Columnas extra a mostrar: las que el usuario eligió guardar (columnas_a_guardar),
    // menos las ya mostradas como columnas semánticas (modelo, código, marca, descripción, precios).
    const semanticCols = new Set<string>(
        [mapeo?.columna_modelo, mapeo?.columna_codigo, mapeo?.columna_marca, mapeo?.columna_descripcion,
         ...(mapeo?.precios || []).map((p: any) => p.columna)].filter(Boolean)
    );
    const extraCols: string[] = (mapeo?.columnas_a_guardar || []).filter((c: string) => !semanticCols.has(c));

    // 3. Precios vigentes desde la tabla canónica (precios_proveedor), agrupados por SKU
    const precios = importacionId ? await fetchPrecios(importacionId, q) : [];

    const grouped = new Map<string, { sku: string; marca: string; descripcion: string; tiers: Record<string, number | null>; columnas: Record<string, string> | null }>();
    const tierLabels = new Map<string, string>();

    for (const r of precios) {
        const sku = r.sku_proveedor;
        if (!sku) continue;
        let g = grouped.get(sku);
        if (!g) {
            g = {
                sku,
                marca: r.marca || '',
                descripcion: r.descripcion || '',
                tiers: {},
                columnas: (r.columnas && typeof r.columnas === 'object') ? r.columnas : null,
            };
            grouped.set(sku, g);
        }
        const k = normalizeTier(r.tipo_costo);
        if (!k) continue;
        if (r.valor != null) g.tiers[k] = Number(r.valor);
        if (!tierLabels.has(k)) tierLabels.set(k, r.tipo_costo || k);
    }

    // 4. Alias existentes (paginado) → vinculación + EAN por SKU
    const aliasMap = new Map<string, string>();   // model:<sku> -> articulo_id ; code:<ean> -> articulo_id
    const aliasEanMap = new Map<string, string>(); // <sku> -> ean (codigo_excel)
    let aliasOffset = 0;
    while (true) {
        const { data: aliasChunk } = await supa
            .from('proveedor_articulos_alias')
            .select('codigo_excel, modelo_excel, articulo_id')
            .eq('proveedor', proveedorDecoded)
            .order('id', { ascending: true })
            .range(aliasOffset, aliasOffset + 999);
        if (!aliasChunk || aliasChunk.length === 0) break;
        aliasChunk.forEach(a => {
            if (a.modelo_excel) {
                aliasMap.set(`model:${a.modelo_excel}`, a.articulo_id);
                aliasEanMap.set(a.modelo_excel, a.codigo_excel || '');
            }
            if (a.codigo_excel) aliasMap.set(`code:${a.codigo_excel}`, a.articulo_id);
        });
        aliasOffset += 1000;
        if (aliasChunk.length < 1000) break;
    }

    // 5. Construir items con tiers dinámicos + columnas extra elegidas en el mapeo
    let items: HubItem[] = [...grouped.values()].map(g => {
        const ean = aliasEanMap.get(g.sku) || '';
        const extra: Record<string, string> = {};
        if (g.columnas) {
            for (const col of extraCols) {
                const v = g.columnas[col];
                if (v != null && String(v).trim() !== '') extra[col] = String(v);
            }
        }
        return {
            id: g.sku,
            sku: g.sku,
            codigo: ean,
            marca: g.marca,
            descripcion: g.descripcion,
            tiers: g.tiers,
            extra,
            articulo_id_vinculado:
                aliasMap.get(`model:${g.sku}`) ||
                (ean ? aliasMap.get(`code:${ean}`) : null) ||
                null,
        };
    });

    // 6. Orden estable por SKU (la búsqueda ya se aplicó del lado del servidor)
    items.sort((a, b) => a.sku.localeCompare(b.sku, 'es', { numeric: true }));

    const totalSkus = items.length;

    // 8. Columnas de precio dinámicas (orden del mapeo + resto ordenado)
    const tierOrder: TierCol[] = [];
    for (const k of mapeoOrder) {
        if (tierLabels.has(k) && !tierOrder.some(t => t.key === k)) {
            tierOrder.push({ key: k, label: tierLabels.get(k)! });
        }
    }
    for (const k of [...tierLabels.keys()].sort()) {
        if (!tierOrder.some(t => t.key === k)) tierOrder.push({ key: k, label: tierLabels.get(k)! });
    }

    const paginated = items.slice(page * pageSize, page * pageSize + pageSize);
    const totalPaginas = Math.ceil(totalSkus / pageSize);

    return (
        <div className="flex flex-col h-full bg-[var(--surface)] relative">
            <header className="px-4 py-2 border-b border-[var(--border)] shrink-0">
                <div className="flex flex-col flex-1">
                    <div className="flex items-center text-xs text-[var(--text-muted)] mb-0.5">
                        <Link href="/precios" className="hover:text-[var(--accent)] transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> Precios
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-[var(--text-muted)]">{proveedorDecoded}</span>
                        <span className="mx-3 text-[var(--text-faint)]">|</span>
                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`} className="hover:text-[var(--accent)] flex items-center gap-1">
                            <History className="w-3.5 h-3.5" /> Historial de Lotes
                        </Link>
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="min-w-0">
                            <h1 className="text-base font-bold text-[var(--text)] leading-tight truncate">{proveedorDecoded}</h1>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                                {totalSkus.toLocaleString()} SKUs
                                {' · '}Última act. {fechaAct ? new Date(fechaAct).toLocaleDateString('es-MX') : '—'}
                                {' · '}
                                {estaVigente
                                    ? <span className="text-[var(--ok)] font-semibold">● Lista Vigente</span>
                                    : <span className="text-[var(--warn)] font-semibold">⚠ Lista sin activar</span>
                                }
                            </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Link
                                href={`/precios/${encodeURIComponent(proveedorDecoded)}/revisar`}
                                className="bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text)] px-4 py-2 rounded-lg font-bold shadow-sm transition-all flex items-center text-sm"
                            >
                                Auditar cambios
                            </Link>
                            <Link
                                href={`/precios/${encodeURIComponent(proveedorDecoded)}/subir`}
                                className="bg-[var(--accent)] text-[var(--accent-ink)] px-4 py-2 rounded-lg font-bold shadow-sm hover:brightness-110 transition-all flex items-center text-sm"
                            >
                                <span className="mr-1.5 text-base">+</span> Actualizar lista
                            </Link>
                        </div>
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-hidden flex flex-col bg-[var(--bg)]">
                {/* Buscador (automático e inmediato) */}
                <div className="p-4 bg-[var(--surface)] border-b border-[var(--border)] flex flex-col sm:flex-row sm:items-center gap-3 shrink-0">
                    <div className="flex-1">
                        <CatalogoProveedorSearch proveedor={proveedorDecoded} initialQ={q} />
                    </div>
                    <span className="text-sm text-[var(--text-faint)] shrink-0">
                        {q ? `${totalSkus.toLocaleString()} resultados` : `${totalSkus.toLocaleString()} productos · Página ${page + 1} de ${totalPaginas}`}
                    </span>
                </div>

                {/* Tabla */}
                <div className="flex-1 overflow-auto p-6">
                    <CatalogoProveedorTable
                        proveedor={proveedorDecoded}
                        items={paginated}
                        tiers={tierOrder}
                        extraCols={extraCols}
                    />
                </div>

                {/* Paginación */}
                {!q && totalPaginas > 1 && (
                    <div className="shrink-0 px-6 py-4 bg-[var(--surface)] border-t border-[var(--border)] flex items-center justify-between text-sm">
                        <span className="text-[var(--text-muted)]">
                            Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalSkus)} de {totalSkus.toLocaleString()}
                        </span>
                        <div className="flex items-center gap-2">
                            {page > 0 && (
                                <Link
                                    href={`/precios/${encodeURIComponent(proveedorDecoded)}?page=${page - 1}`}
                                    className="px-4 py-2 bg-[var(--surface-2)] hover:bg-[var(--bg)] text-[var(--text-muted)] rounded-lg font-medium transition-colors"
                                >
                                    ← Anterior
                                </Link>
                            )}
                            {page < totalPaginas - 1 && (
                                <Link
                                    href={`/precios/${encodeURIComponent(proveedorDecoded)}?page=${page + 1}`}
                                    className="px-4 py-2 bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] rounded-lg font-medium transition-colors"
                                >
                                    Siguiente →
                                </Link>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
