import { supabaseAdmin } from '@/lib/supabase';
import Link from 'next/link';
import { ArrowLeft, Info } from 'lucide-react';
import { VinculacionClient } from '@/components/precios/VinculacionClient';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

const norm = (s?: string) => (s ?? '').normalize('NFC').trim().toLowerCase();

export default async function VinculacionPage(props: {
    params: Promise<{ proveedor: string; importacion_id: string }>;
}) {
    const params = await props.params;
    const proveedorDecoded = decodeURIComponent(params.proveedor);
    const importacionId = params.importacion_id;

    const { data: imp } = await supabaseAdmin
        .from('importaciones_excel')
        .select('id, nombre_archivo, total_filas, estado')
        .eq('id', importacionId)
        .single();

    // -- 1. Cargar todas las filas raw del lote --------------------------------
    
    async function fetchAll(table: string, select: string, eqColumn?: string, eqValue?: any) {
        const page = 1000;
        let from = 0;
        const rows = [];
        while (true) {
            let query = supabaseAdmin.from(table).select(select, { count: 'exact' });
            if (eqColumn && eqValue !== undefined) {
                query = query.eq(eqColumn, eqValue);
            }
            if (table === 'proveedor_articulos_alias') {
                query = query.eq('proveedor', proveedorDecoded).eq('locked', true);
            }
            const { data, error, count } = await query.range(from, from + page - 1);
            if (error) {
                console.error('[DIAG] PAGINATION ERROR:', error);
                throw error;
            }
            if (data) rows.push(...data);
            if (rows.length >= (count || 0) || !data || data.length < page) break;
            from += page;
        }
        return rows;
    }

    const allRaw = await fetchAll('listas_precios_raw', 'fila_num, payload', 'importacion_id', importacionId);

    // -- 2. Cargar todos los artículos activos ---------------------------------
    const allArts = await fetchAll('articulos', 'articulo_id, nombre, modelo, marca, codigo_universal', 'activo', true);

    // Mapas de artículos para búsqueda rápida
    const articulosPorCodigo = new Map<string, any>();
    const articulosPorModelo = new Map<string, any>();
    
    for (const a of allArts) {
        if (a.codigo_universal) {
            if (!articulosPorCodigo.has(a.codigo_universal)) {
                articulosPorCodigo.set(a.codigo_universal, a);
            }
        }
        if (a.modelo) {
            const marca = (a.marca || '').toLowerCase();
            const modelo = a.modelo.toLowerCase();
            articulosPorModelo.set(`${marca}|||${modelo}`, a);
            articulosPorModelo.set(`|||${modelo}`, a); // Fallback solo modelo
        }
    }

    // -- 3. Alias ya aprobados manualmente (locked=true) -----------------------
    
    const aliasExistentes = await fetchAll('proveedor_articulos_alias', 'codigo_excel, modelo_excel, marca_excel, articulo_id, locked');

    const aliasLockedPorCodigo = new Map<string, string>();
    const aliasLockedPorModelo = new Map<string, string>();
    for (const a of aliasExistentes) {
        if (a.codigo_excel) aliasLockedPorCodigo.set(norm(a.codigo_excel), a.articulo_id);
        if (a.marca_excel && a.modelo_excel) aliasLockedPorModelo.set(`${norm(a.marca_excel)}|||${norm(a.modelo_excel)}`, a.articulo_id);
    }

    // -- 4. Clasificar cada fila -----------------------------------------------
    type ItemMatch = {
        fila_num: number;
        sku_proveedor: string;
        codigo_barra: string;
        marca_proveedor: string;
        descripcion_proveedor: string;
        dist: number;
        menudeo: number;
        articulo_id: string;
        nombre_catalogo: string;
        marca_catalogo: string;
        modelo_catalogo: string;
        codigo_universal: string;
    };

    const catTriple: ItemMatch[] = [];
    const catSoloCodigo: ItemMatch[] = [];
    const catMarcaModelo: ItemMatch[] = [];
    const yaVinculados: ItemMatch[] = [];
    const sinMatch: ItemMatch[] = [];

    for (const r of allRaw) {
        const p = r.payload || {};
        const fila_num = r.fila_num;
        const clave = String(p['CLAVE'] || p['CÓDIGO'] || '').trim();
        const codigo_barra = String(p['CÓDIGO DE BARRA SIN CERO'] || '').trim();
        const marca = String(p['MARCA'] || '').trim();
        const descripcion = String(p['DESCRIPCIÓN LARGA'] || p['DESCRIPCION'] || '').trim();
        const dist = parseFloat(p['P.DIST (CON IVA)'] || '0') || 0;
        const menudeo = parseFloat(p['PRECIO MENUDEO (CON IVA)'] || '0') || 0;

        const claveLower = clave.toLowerCase();
        const marcaLower = marca.toLowerCase();

        // 1. Verificar si ya está vinculado manualmente (locked) usando normalización
        const lockedId = aliasLockedPorCodigo.get(norm(codigo_barra)) || aliasLockedPorModelo.get(`${norm(marca)}|||${norm(clave)}`);
        
        if (lockedId) {
            const art = allArts.find(a => a.articulo_id === lockedId);
            yaVinculados.push({
                fila_num, sku_proveedor: clave, codigo_barra, marca_proveedor: marca,
                descripcion_proveedor: descripcion, dist, menudeo,
                articulo_id: lockedId,
                nombre_catalogo: art?.nombre || '(Artículo no encontrado)',
                marca_catalogo: art?.marca || '',
                modelo_catalogo: art?.modelo || '',
                codigo_universal: art?.codigo_universal || ''
            });
            continue;
        }

        // 2. Buscar coincidencias en memoria
        const artPorCodigo = codigo_barra ? articulosPorCodigo.get(codigo_barra) : null;
        const artPorModelo = clave ? (articulosPorModelo.get(`${marcaLower}|||${claveLower}`) || articulosPorModelo.get(`|||${claveLower}`)) : null;

        if (artPorCodigo) {
            const marcaMatch = (artPorCodigo.marca || '').toLowerCase() === marcaLower;
            const modeloMatch = (artPorCodigo.modelo || '').toLowerCase() === claveLower;

            const item: ItemMatch = {
                fila_num, sku_proveedor: clave, codigo_barra, marca_proveedor: marca,
                descripcion_proveedor: descripcion, dist, menudeo,
                articulo_id: artPorCodigo.articulo_id,
                nombre_catalogo: artPorCodigo.nombre || '',
                marca_catalogo: artPorCodigo.marca || '',
                modelo_catalogo: artPorCodigo.modelo || '',
                codigo_universal: artPorCodigo.codigo_universal || ''
            };

            if (marcaMatch && modeloMatch) {
                catTriple.push(item);
            } else {
                catSoloCodigo.push(item);
            }
        } else if (artPorModelo) {
            catMarcaModelo.push({
                fila_num, sku_proveedor: clave, codigo_barra, marca_proveedor: marca,
                descripcion_proveedor: descripcion, dist, menudeo,
                articulo_id: artPorModelo.articulo_id,
                nombre_catalogo: artPorModelo.nombre || '',
                marca_catalogo: artPorModelo.marca || '',
                modelo_catalogo: artPorModelo.modelo || '',
                codigo_universal: artPorModelo.codigo_universal || ''
            });
        } else {
            sinMatch.push({
                fila_num, sku_proveedor: clave, codigo_barra, marca_proveedor: marca,
                descripcion_proveedor: descripcion, dist, menudeo,
                articulo_id: '', nombre_catalogo: '', marca_catalogo: '', modelo_catalogo: '', codigo_universal: ''
            });
        }
    }

    return (
        <div className="min-h-screen bg-slate-50">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-8 py-5">
                <Link
                    href={`/precios/${encodeURIComponent(proveedorDecoded)}/historial/${importacionId}/resumen`}
                    className="inline-flex items-center text-sm text-slate-500 hover:text-indigo-600 mb-3"
                >
                    <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Resumen del Lote
                </Link>
                <h1 className="text-2xl font-bold text-slate-900">Vinculación con Catálogo Interno</h1>
                <p className="text-sm text-slate-500 mt-1">
                    {imp?.nombre_archivo} · {imp?.total_filas?.toLocaleString()} SKUs del proveedor
                </p>

                <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5">
                    <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-400" />
                    <span>
                        Navega entre las pestañas para revisar las propuestas de vinculación, ver los artículos ya confirmados, o explorar los que no tuvieron coincidencia.
                    </span>
                </div>
            </header>

            {/* Client Component con Tabs */}
            <VinculacionClient
                proveedor={proveedorDecoded}
                catTriple={catTriple}
                catSoloCodigo={catSoloCodigo}
                catMarcaModelo={catMarcaModelo}
                yaVinculados={yaVinculados}
                sinMatch={sinMatch}
            />
        </div>
    );
}