export type VinculacionCategoriaId =
    | 'triple'
    | 'solo_codigo'
    | 'marca_modelo'
    | 'ya_vinculado'
    | 'sin_match'
    | 'rechazado';

export interface MatchItem {
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
}

export interface VinculacionTotales {
    triple: number;
    solo_codigo: number;
    marca_modelo: number;
    ya_vinculado: number;
    sin_match: number;
    rechazado: number;
}

export const TOTALES_VACIOS: VinculacionTotales = {
    triple: 0,
    solo_codigo: 0,
    marca_modelo: 0,
    ya_vinculado: 0,
    sin_match: 0,
    rechazado: 0,
};
