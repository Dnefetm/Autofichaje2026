/**
 * attribute-fill.ts — Relleno DETERMINÍSTICO de características secundarias.
 *
 * Solo rellena un atributo si su valor se puede derivar de los datos del
 * producto. Si no hay respaldo, lo omite (nunca inventa). Es la forma más
 * segura de cumplir "no alucinar": sin IA, sin datos fabricados.
 */

export interface OptionalAttr {
    id: string;
    name: string;
    type?: string;
    values?: Array<{ id: string; name: string }>;
}

// Atributos fiscales/admin/sistema que NO son características del producto.
const SKIP_OPT_IDS = new Set([
    'SIZE_GRID_ID', 'EXCLUSIVE_CHANNEL', 'ITEM_CONDITION', 'SELLER_CUSTOM_FIELD',
    'SELLER_SKU', 'GTIN', 'EAN', 'UPC', 'BRAND', 'MODEL',
    'SAT_KEY', 'MEASURE_UNIT_KEY', 'MEASURE_UNIT_DESCRIPTION',
    'IMPORT_DECLARATION_NUMBER', 'INVOICE_PRODUCT_NAME',
    'IVA_FOR_RESALE', 'IEPS', 'SALE_FORMAT', 'UNITS_PER_PACK',
]);

/** Filtra los atributos opcionales crudos de MeLi a los rellenables. */
export function filterOptionalAttrs(attrs: any[]): OptionalAttr[] {
    const FILLABLE = new Set(['list', 'string', 'boolean', 'number', 'number_unit']);
    return (attrs || [])
        .filter((a: any) => a && FILLABLE.has(a.value_type) && !SKIP_OPT_IDS.has(a.id) && !(a.tags || {}).hidden)
        .slice(0, 40)
        .map((a: any) => ({
            id: a.id,
            name: a.name,
            type: a.value_type,
            values: (a.values || []).slice(0, 50).map((v: any) => ({ id: String(v.id), name: v.name })),
        }));
}

export interface ProductData {
    nombre: string;
    marca: string;
    modelo: string;
    variante?: string;
    descripcion?: string;
    materiales?: string;
    atributos_especificos?: any;
    peso_kg?: number;
    largo_cm?: number;
    ancho_cm?: number;
    alto_cm?: number;
}

function norm(s: unknown): string {
    return String(s ?? '').trim().toLowerCase();
}

/** Mapeo directo por id de atributo para valores libres/number_unit. */
function deriveByAttrId(attrId: string, d: ProductData): string | null {
    switch (attrId) {
        case 'MATERIAL':
            return d.materiales ? norm(d.materiales) : null;
        case 'LENGTH':
        case 'PACKAGE_LENGTH':
            return d.largo_cm != null ? `${Math.round(d.largo_cm)} cm` : null;
        case 'WIDTH':
        case 'PACKAGE_WIDTH':
            return d.ancho_cm != null ? `${Math.round(d.ancho_cm)} cm` : null;
        case 'HEIGHT':
        case 'PACKAGE_HEIGHT':
            return d.alto_cm != null ? `${Math.round(d.alto_cm)} cm` : null;
        case 'WEIGHT':
        case 'PACKAGE_WEIGHT':
            return d.peso_kg != null ? `${Math.round(d.peso_kg * 1000)} g` : null;
        default:
            return null;
    }
}

export function fillOptionalFromData(
    optionalAttrs: OptionalAttr[],
    data: ProductData,
): Array<{ id: string; value_name?: string; value_id?: string }> {
    const hay = [
        data.nombre, data.marca, data.modelo, data.variante, data.descripcion, data.materiales,
        data.atributos_especificos ? JSON.stringify(data.atributos_especificos) : '',
    ].join(' ').toLowerCase();

    const filled: Array<{ id: string; value_name?: string; value_id?: string }> = [];

    for (const attr of optionalAttrs) {
        if (!attr || !attr.id) continue;

        if (attr.values && attr.values.length > 0) {
            // Lista cerrada: rellenar SOLO si una opción aparece literalmente en los datos.
            const match = attr.values.find(v => {
                const vn = norm(v.name);
                return vn.length >= 2 && hay.includes(vn);
            });
            if (match) filled.push({ id: attr.id, value_id: match.id, value_name: match.name });
        } else {
            // Libre / number_unit: mapeo directo por id conocido.
            const derived = deriveByAttrId(attr.id, data);
            if (derived) filled.push({ id: attr.id, value_name: derived });
        }
    }

    return filled;
}
