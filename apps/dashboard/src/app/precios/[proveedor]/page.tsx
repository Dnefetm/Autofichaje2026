import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Settings, History, Download, RefreshCw, Search } from 'lucide-react';
import { HubTableActions } from '@/components/precios/flow/HubTableActions';
import { CatalogoProveedorTable } from '@/components/precios/CatalogoProveedorTable';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HubProveedorPage(props: { params: Promise<{ proveedor: string }>, searchParams: Promise<any> }) {
    const params = await props.params;
    const searchParams = await props.searchParams;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const supa = supabaseAdmin;

    // 1. Obtener última lista vigente o más reciente
    const { data: activeLpp } = await supa.from('listas_precios_proveedor')
        .select('importacion_id, total_filas, creado_el')
        .eq('proveedor', proveedorDecoded)
        .eq('vigente', true)
        .order('creado_el', { ascending: false })
        .limit(1);

    let importacionId = activeLpp?.[0]?.importacion_id;
    let totalFilas = activeLpp?.[0]?.total_filas;
    let fechaAct = activeLpp?.[0]?.creado_el;

    if (!importacionId) {
        const { data: ultImp } = await supa.from('importaciones_excel')
            .select('id, total_filas, creado_el')
            .eq('proveedor', proveedorDecoded)
            .order('creado_el', { ascending: false })
            .limit(1);
        importacionId = ultImp?.[0]?.id;
        totalFilas = ultImp?.[0]?.total_filas;
        fechaAct = ultImp?.[0]?.creado_el;
    }

    // 2. Traer filas de listas_precios_raw para mostrar el catálogo completo
    let listado: any[] = [];
    if (importacionId) {
        let query = supa.from('listas_precios_raw')
            .select('id, fila_num, payload, created_at')
            .eq('importacion_id', importacionId)
            .order('fila_num', { ascending: true })
            .limit(200);

        const { data: rawRows } = await query;
        listado = rawRows || [];
    }

    // 3. Traer alias existentes para mapear estado de vinculación
    const { data: aliasList } = await supa
        .from('proveedor_articulos_alias')
        .select('codigo_excel, modelo_excel, marca_excel, articulo_id')
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
            precio_distribuidor: p['P.DIST (CON IVA)'] || p['P.DIST'] || p['PRECIO DISTRIBUIDOR'] || null,
            precio_subdistribuidor: p['PRECIO SUBDISTRIBUIDOR (CON IVA)'] || null,
            precio_mayoreo: p['PRECIO MAYORE (CON IVA)'] || null,
            precio_menudeo: p['PRECIO MENUDEO (CON IVA)'] || null,
            articulo_id_vinculado: articuloId
        };
    });

    // Filtrar si viene query 'q'
    const q = searchParams.q?.toLowerCase() || '';
    const itemsFiltrados = q ? itemsProcesados.filter(item => 
        item.modelo.toLowerCase().includes(q) ||
        item.codigo.toLowerCase().includes(q) ||
        item.descripcion.toLowerCase().includes(q)
    ) : itemsProcesados;

    return (
        <div className="flex flex-col h-full bg-white relative">
            <header className="flex items-center justify-between px-8 py-6 border-b border-slate-200">
                <div className="flex flex-col">
                    <div className="flex items-center justify-between w-full mb-1">
                        <div className="flex items-center text-sm text-slate-500">
                            <Link href="/precios" className="hover:text-indigo-600 transition flex items-center">
                                <ArrowLeft className="w-3 h-3 mr-1" /> Precios
                            </Link>
                            <span className="mx-2">/</span>
                            <span className="font-medium text-slate-700">{proveedorDecoded}</span>
                        </div>
                        <div className="flex items-center space-x-3 text-sm text-slate-500">
                            <Link href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial`} className="hover:text-indigo-600 flex items-center">
                                <History className="w-4 h-4 mr-1" /> Historial de Lotes
                            </Link>
                        </div>
                    </div>
                    <div className="flex justify-between items-end mt-2">
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900 tracking-tight">{proveedorDecoded}</h1>
                            <p className="text-sm text-slate-500 mt-1">
                                {totalFilas || itemsFiltrados.length} SKUs en catálogo · Última act. {fechaAct ? new Date(fechaAct).toLocaleDateString() : 'Hoy'}
                            </p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center">
                    <Link
                        href={`/precios/${encodeURIComponent(proveedorDecoded)}/subir`}
                        className="bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold shadow-sm hover:bg-indigo-700 transition-all flex items-center text-sm"
                    >
                        <span className="mr-2 text-lg">+</span> Actualizar lista de precios
                    </Link>
                </div>
            </header>

            <div className="flex-1 overflow-hidden flex flex-col bg-slate-50">
                <div className="p-4 bg-white border-b border-slate-200 flex items-center justify-between shrink-0 flex-wrap gap-4">
                    <form action={`/precios/${encodeURIComponent(proveedorDecoded)}`} method="GET" className="flex items-center gap-3 flex-1">
                        <div className="relative w-96">
                            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
                            <input 
                                type="text" 
                                name="q" 
                                placeholder="Buscar en catálogo del proveedor (código, clave, descripción)..." 
                                defaultValue={searchParams.q || ''}
                                className="pl-10 pr-4 py-2.5 w-full text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50/50" 
                            />
                        </div>
                        <button type="submit" className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-sm font-bold transition-colors">
                            Buscar
                        </button>
                    </form>
                </div>

                <div className="flex-1 overflow-auto p-6">
                    <CatalogoProveedorTable 
                        proveedor={proveedorDecoded} 
                        items={itemsFiltrados} 
                    />
                </div>
            </div>
        </div>
    );
}
