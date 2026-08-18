import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, History, Search } from 'lucide-react';
import { CatalogoProveedorTable } from '@/components/precios/CatalogoProveedorTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

    // 1. Obtener última lista vigente o más reciente
    const { data: activeLpp } = await supa
        .from('listas_precios_proveedor')
        .select('importacion_id, total_filas, creado_el')
        .eq('proveedor', proveedorDecoded)
        .eq('vigente', true)
        .order('creado_el', { ascending: false })
        .limit(1);

    let importacionId = activeLpp?.[0]?.importacion_id;
    let totalFilas = activeLpp?.[0]?.total_filas;
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
        totalFilas = ultImp?.[0]?.total_filas;
        fechaAct = ultImp?.[0]?.creado_el;
    }

    // 2. Traer filas del catálogo con búsqueda en BD
    let listado: any[] = [];
    let totalEncontrados = 0;

    if (importacionId) {
        let baseQuery = supa
            .from('listas_precios_raw')
            .select('id, fila_num, payload', { count: 'exact' })
            .eq('importacion_id', importacionId);

        if (q) {
            // Búsqueda en campos del JSONB directamente en PostgreSQL
            baseQuery = (baseQuery as any).textSearch('payload', q, { type: 'plain', config: 'spanish' });
        }

        const { data: rawRows, count } = await baseQuery
            .order('fila_num', { ascending: true })
            .range(page * pageSize, page * pageSize + pageSize - 1);

        listado = rawRows || [];
        totalEncontrados = count || 0;
    }

    // 3. Traer alias existentes
    const { data: aliasList } = await supa
        .from('proveedor_articulos_alias')
        .select('codigo_excel, modelo_excel, articulo_id')
        .eq('proveedor', proveedorDecoded);

    const aliasMap = new Map<string, string>();
    aliasList?.forEach(a => {
        if (a.codigo_excel) aliasMap.set(`code:${a.codigo_excel}`, a.articulo_id);
        if (a.modelo_excel) aliasMap.set(`model:${a.modelo_excel}`, a.articulo_id);
    });

    const itemsProcesados = listado.map(r => {
        const p = r.payload || {};
        const modelo = p['CLAVE'] || p['MODELO'] || p['Modelo'] || '';
        const codigo = p['CÓDIGO DE BARRA SIN CERO'] || p['CÓDIGO DE BARRA'] || p['CODIGO'] || p['Codigo'] || '';
        const articuloId = aliasMap.get(`code:${codigo}`) || aliasMap.get(`model:${modelo}`) || null;

        return {
            id: r.id,
            fila_num: r.fila_num,
            modelo,
            codigo,
            marca: p['MARCA'] || p['Marca'] || '',
            descripcion: p['DESCRIPCIÓN LARGA'] || p['DESCRIPCION'] || p['Descripcion'] || '',
            precio_distribuidor: p['P.DIST (CON IVA)'] || p['P.DIST'] || null,
            precio_subdistribuidor: p['PRECIO SUBDISTRIBUIDOR (CON IVA)'] || null,
            precio_mayoreo: p['PRECIO MAYORE (CON IVA)'] || null,
            precio_menudeo: p['PRECIO MENUDEO (CON IVA)'] || null,
            articulo_id_vinculado: articuloId
        };
    });

    const totalPaginas = Math.ceil((totalEncontrados || totalFilas || 0) / pageSize);

    return (
        <div className="flex flex-col h-full bg-white relative">
            <header className="flex items-center justify-between px-8 py-6 border-b border-slate-200">
                <div className="flex flex-col flex-1">
                    <div className="flex items-center text-sm text-slate-500 mb-2">
                        <Link href="/precios" className="hover:text-indigo-600 transition flex items-center">
                            <ArrowLeft className="w-3 h-3 mr-1" /> Precios
                        </Link>
                        <span className="mx-2">/</span>
                        <span className="font-medium text-slate-700">{proveedorDecoded}</span>
                        <span className="mx-3 text-slate-300">|</span>
                        <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`} className="hover:text-indigo-600 flex items-center gap-1">
                            <History className="w-3.5 h-3.5" /> Historial de Lotes
                        </Link>
                    </div>
                    <div className="flex items-end justify-between">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{proveedorDecoded}</h1>
                            <p className="text-sm text-slate-500 mt-1">
                                {(totalFilas || 0).toLocaleString()} SKUs en catálogo
                                {' · '}Última act. {fechaAct ? new Date(fechaAct).toLocaleDateString('es-MX') : '—'}
                                {' · '}
                                {estaVigente
                                    ? <span className="text-emerald-600 font-semibold">● Lista Vigente</span>
                                    : <span className="text-amber-600 font-semibold">⚠ Lista sin activar — ve al historial para activarla</span>
                                }
                            </p>
                        </div>
                        <Link
                            href={`/precios/${encodeURIComponent(proveedorDecoded)}/subir`}
                            className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-sm hover:bg-indigo-700 transition-all flex items-center text-sm"
                        >
                            <span className="mr-2 text-lg">+</span> Actualizar lista de precios
                        </Link>
                    </div>
                </div>
            </header>

            <div className="flex-1 overflow-hidden flex flex-col bg-slate-50">
                {/* Buscador */}
                <div className="p-4 bg-white border-b border-slate-200 flex items-center gap-3 shrink-0">
                    <form action={`/precios/${encodeURIComponent(proveedorDecoded)}`} method="GET" className="flex items-center gap-3 flex-1">
                        <div className="relative w-full max-w-xl">
                            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                            <input
                                type="text"
                                name="q"
                                placeholder="Buscar por clave, código de barras o descripción..."
                                defaultValue={searchParams.q || ''}
                                className="pl-10 pr-4 py-2.5 w-full text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50"
                            />
                        </div>
                        <button type="submit" className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold transition-colors">
                            Buscar
                        </button>
                        {q && (
                            <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}`} className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-sm font-medium transition-colors">
                                Limpiar
                            </Link>
                        )}
                    </form>
                    <span className="text-sm text-slate-400 shrink-0">
                        {q ? `${totalEncontrados.toLocaleString()} resultados` : `${(totalFilas || 0).toLocaleString()} productos · Página ${page + 1} de ${totalPaginas}`}
                    </span>
                </div>

                {/* Tabla */}
                <div className="flex-1 overflow-auto p-6">
                    <CatalogoProveedorTable
                        proveedor={proveedorDecoded}
                        items={itemsProcesados}
                    />
                </div>

                {/* Paginación */}
                {!q && totalPaginas > 1 && (
                    <div className="shrink-0 px-6 py-4 bg-white border-t border-slate-200 flex items-center justify-between text-sm">
                        <span className="text-slate-500">
                            Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalFilas || 0)} de {(totalFilas || 0).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-2">
                            {page > 0 && (
                                <Link
                                    href={`/precios/${encodeURIComponent(proveedorDecoded)}?page=${page - 1}`}
                                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-medium transition-colors"
                                >
                                    ← Anterior
                                </Link>
                            )}
                            {page < totalPaginas - 1 && (
                                <Link
                                    href={`/precios/${encodeURIComponent(proveedorDecoded)}?page=${page + 1}`}
                                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
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
