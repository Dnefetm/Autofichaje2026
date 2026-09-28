import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, History } from 'lucide-react';
import { CatalogoProveedorTable, HubItem, TierCol } from '@/components/precios/CatalogoProveedorTable';
import { CatalogoProveedorSearch } from '@/components/precios/CatalogoProveedorSearch';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const normalizeTier = (s: string) => (s || '').toLowerCase().trim();

// Lee los SKUs vigentes desde un RPC que agrupa/filtra/ordena/pagina en SQL.
// Sin búsqueda: devuelve la página actual (paginación determinística por SKU).
// Con búsqueda: devuelve todos los resultados coincidentes (filtro server-side).
async function fetchSkus(
    importacionId: string,
    q: string,
    page: number,
    pageSize: number
): Promise<{ rows: any[]; total: number }> {
    const { data, error } = await supabaseAdmin.rpc('fn_hub_precios_proveedor', {
        p_importacion_id: importacionId,
        p_busqueda: q || null,
        p_offset: q ? 0 : page * pageSize,
        p_limit: q ? 100000 : pageSize,
    });
    if (error) {
        console.error('fn_hub_precios_proveedor', error);
        return { rows: [], total: 0 };
    }
    return { rows: (data?.rows || []) as any[], total: data?.total || 0 };
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
    // Columnas extra a mostrar: las que el usuario eligió guardar (columnas_a_guardar),
    // menos las ya mostradas como columnas semánticas (modelo, código, marca, descripción, precios).
    const semanticCols = new Set<string>(
        [mapeo?.columna_modelo, mapeo?.columna_codigo, mapeo?.columna_marca, mapeo?.columna_descripcion,
         ...(mapeo?.precios || []).map((p: any) => p.columna)].filter(Boolean)
    );
    const extraCols: string[] = (mapeo?.columnas_a_guardar || []).filter((c: string) => !semanticCols.has(c));

    // 3. SKUs vigentes desde la vista agrupada (1 consulta + count, server-side)
    const { rows: skuRows, total: totalSkus } = importacionId
        ? await fetchSkus(importacionId, q, page, pageSize)
        : { rows: [], total: 0 };

    // 4. Alias de los SKUs visibles → vinculación + EAN por SKU (IN por lotes, sin paginar todo)
    const skus = skuRows.map(r => r.sku_proveedor).filter(Boolean);
    const aliasMap = new Map<string, string>();   // model:<sku> -> articulo_id ; code:<ean> -> articulo_id
    const aliasEanMap = new Map<string, string>(); // <sku> -> ean (codigo_excel)

    if (skus.length > 0) {
        for (let i = 0; i < skus.length; i += 500) {
            const batch = skus.slice(i, i + 500);
            const { data: chunk } = await supa
                .from('proveedor_articulos_alias')
                .select('codigo_excel, modelo_excel, articulo_id')
                .eq('proveedor', proveedorDecoded)
                .in('modelo_excel', batch);
            chunk?.forEach(a => {
                if (a.modelo_excel) {
                    aliasMap.set(`model:${a.modelo_excel}`, a.articulo_id);
                    aliasEanMap.set(a.modelo_excel, a.codigo_excel || '');
                }
                if (a.codigo_excel) aliasMap.set(`code:${a.codigo_excel}`, a.articulo_id);
            });
        }
        const eans = [...new Set([...aliasEanMap.values()].filter(Boolean))];
        for (let i = 0; i < eans.length; i += 500) {
            const batch = eans.slice(i, i + 500);
            const { data: chunk } = await supa
                .from('proveedor_articulos_alias')
                .select('codigo_excel, articulo_id')
                .eq('proveedor', proveedorDecoded)
                .in('codigo_excel', batch);
            chunk?.forEach(a => {
                if (a.codigo_excel) aliasMap.set(`code:${a.codigo_excel}`, a.articulo_id);
            });
        }
    }

    // 5. Construir items desde la vista (tiers y columnas ya vienen en JSONB)
    const items: HubItem[] = skuRows.map(r => {
        const ean = aliasEanMap.get(r.sku_proveedor) || '';
        const extra: Record<string, string> = {};
        const columnas = (r.columnas && typeof r.columnas === 'object') ? r.columnas as Record<string, unknown> : null;
        if (columnas) {
            for (const col of extraCols) {
                const v = columnas[col];
                if (v != null && String(v).trim() !== '') extra[col] = String(v);
            }
        }
        return {
            id: r.sku_proveedor,
            sku: r.sku_proveedor,
            codigo: ean,
            marca: r.marca || '',
            descripcion: r.descripcion || '',
            tiers: (r.tiers && typeof r.tiers === 'object') ? r.tiers as Record<string, number | null> : {},
            extra,
            articulo_id_vinculado:
                aliasMap.get(`model:${r.sku_proveedor}`) ||
                (ean ? aliasMap.get(`code:${ean}`) : null) ||
                null,
        };
    });

    // 6. Columnas de precio dinámicas desde el mapeo (orden del operador)
    const tierOrder: TierCol[] = (mapeo?.precios || [])
        .map((pr: any) => ({ key: normalizeTier(pr.tipo_costo), label: pr.tipo_costo }))
        .filter((t: TierCol) => !!t.key);

    // La paginación ya se hizo del lado del servidor.
    const paginated = items;
    const totalPaginas = q ? 1 : Math.ceil(totalSkus / pageSize);

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
