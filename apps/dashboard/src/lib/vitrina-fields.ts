/**
 * vitrina-fields.ts — Esquema declarativo de campos editables de una vidriera MeLi.
 *
 * Añadir un campo nuevo = añadir un objeto a VITRINA_FIELDS. El motor (vitrina-sync)
 * y la UI (InlineField) lo detectan automáticamente. No hay if/else disperso.
 *
 * `writeKind` es el mecanismo REAL de escritura en MeLi:
 *  - title/shipping/sku/pictures  → se fusionan en UN PUT /items/{id}
 *  - attribute                    → se acumula en attributes[] del PUT /items
 *  - saleTerm                     → se acumula en sale_terms[] del PUT /items
 *  - price/stock/status/listingType/description → llamada dedicada
 */

export type WriteKind =
    | 'title'
    | 'shipping'
    | 'sku'
    | 'pictures'
    | 'attribute'
    | 'saleTerm'
    | 'price'
    | 'stock'
    | 'status'
    | 'listingType'
    | 'description';

export type FieldType = 'text' | 'number' | 'select' | 'boolean' | 'textarea' | 'images';

export interface FieldContext {
    item: any;            // ítem MeLi (getItem) o su equivalente desde la BD
    description: string;  // descripción actual
    categoryAttributes: any[]; // metadatos de atributos de la categoría (características secundarias)
    isCatalog: boolean;   // catalog_listing === true (ficha la impone MeLi)
    soldQuantity: number;
    isUP: boolean;        // tiene family_name (User Products)
}

export interface FieldChange {
    field: string;
    value: any;
    valueId?: string | null; // value_id de MeLi para atributos enum (listas cerradas)
}

export interface EditableField {
    id: string;
    label: string;
    type: FieldType;
    writeKind: WriteKind;
    /** columnas en publicaciones_externas a actualizar (write-back) */
    dbColumns: string[];
    attributeId?: string;
    saleTermId?: string;
    options?: Array<{ value: string; label: string }>;
    maxLength?: number;
    canEdit(ctx: FieldContext): { ok: boolean; reason?: string };
    getValue(ctx: FieldContext): any;
    getValueId?(ctx: FieldContext): string | null;
    toMeliPatch(value: any, ctx: FieldContext, valueId?: string | null): any;
}

const yes = { ok: true };
const no = (reason: string) => ({ ok: false, reason });

function attrName(ctx: FieldContext, id: string): string {
    return (ctx.item.attributes || []).find((a: any) => a.id === id)?.value_name ?? '';
}
function saleTerm(ctx: FieldContext, id: string): string {
    return (ctx.item.sale_terms || []).find((s: any) => s.id === id)?.value_name ?? '';
}

export const VITRINA_FIELDS: EditableField[] = [
    {
        id: 'title',
        label: 'Título',
        type: 'text',
        writeKind: 'title',
        dbColumns: ['titulo'],
        maxLength: 60,
        canEdit: (ctx) =>
            ctx.isCatalog
                ? no('El título lo impone el catálogo (no editable)')
                : ctx.soldQuantity > 0
                    ? no('No editable: ya tiene ventas (MeLi bloquea el título)')
                    : yes,
        getValue: (ctx) => ctx.item.family_name || ctx.item.title || '',
        toMeliPatch: (value, ctx) =>
            ctx.isUP
                ? { family_name: String(value).slice(0, 60) }
                : { title: String(value).slice(0, 60) },
    },
    {
        id: 'price',
        label: 'Precio (MXN)',
        type: 'number',
        writeKind: 'price',
        dbColumns: ['precio_venta'],
        canEdit: () => yes,
        getValue: (ctx) => ctx.item.price ?? 0,
        toMeliPatch: (value) => Number(value),
    },
    {
        id: 'stock',
        label: 'Stock disponible',
        type: 'number',
        writeKind: 'stock',
        dbColumns: ['stock_publicado'],
        canEdit: () => yes,
        getValue: (ctx) => ctx.item.available_quantity ?? 0,
        toMeliPatch: (value) => Math.max(0, Math.floor(Number(value))),
    },
    {
        id: 'status',
        label: 'Estado',
        type: 'select',
        writeKind: 'status',
        dbColumns: ['status_externo'],
        options: [
            { value: 'active', label: 'Activa' },
            { value: 'paused', label: 'Pausada' },
        ],
        canEdit: () => yes,
        getValue: (ctx) => ctx.item.status ?? 'active',
        toMeliPatch: (value) => String(value),
    },
    {
        id: 'free_shipping',
        label: 'Envío gratis',
        type: 'boolean',
        writeKind: 'shipping',
        dbColumns: ['free_shipping'],
        canEdit: () => yes,
        getValue: (ctx) => !!ctx.item.shipping?.free_shipping,
        toMeliPatch: (value, ctx) => {
            const shipping: Record<string, any> = { free_shipping: !!value };
            const mode = ctx.item.shipping?.mode;
            if (mode) shipping.mode = mode; // MeLi exige el modo actual al cambiar free_shipping
            return { shipping };
        },
    },
    {
        id: 'listing_type',
        label: 'Comisión',
        type: 'select',
        writeKind: 'listingType',
        dbColumns: ['listing_type_id'],
        options: [
            { value: 'gold_special', label: 'Clásica (~16%)' },
            { value: 'gold_pro', label: 'Premium (~32%)' },
            { value: 'free', label: 'Gratuita' },
        ],
        canEdit: (ctx) =>
            ctx.isCatalog ? no('La comisión de un ítem de catálogo no se cambia aquí') : yes,
        getValue: (ctx) => ctx.item.listing_type_id || '',
        toMeliPatch: (value) => String(value),
    },
    {
        id: 'description',
        label: 'Descripción',
        type: 'textarea',
        writeKind: 'description',
        dbColumns: ['description_plain'],
        maxLength: 50000,
        canEdit: (ctx) =>
            ctx.isCatalog ? no('La descripción la impone el catálogo (no editable)') : yes,
        getValue: (ctx) => ctx.description,
        toMeliPatch: (value) => String(value),
    },
    {
        id: 'brand',
        label: 'Marca',
        type: 'text',
        writeKind: 'attribute',
        attributeId: 'BRAND',
        dbColumns: ['brand'],
        canEdit: (ctx) =>
            ctx.isCatalog ? no('El catálogo aporta la marca (no editable)') : yes,
        getValue: (ctx) => attrName(ctx, 'BRAND'),
        toMeliPatch: (value) => ({ id: 'BRAND', value_name: String(value).trim() }),
    },
    {
        id: 'model',
        label: 'Modelo',
        type: 'text',
        writeKind: 'attribute',
        attributeId: 'MODEL',
        dbColumns: ['model'],
        canEdit: (ctx) =>
            ctx.isCatalog ? no('El catálogo aporta el modelo (no editable)') : yes,
        getValue: (ctx) => attrName(ctx, 'MODEL'),
        toMeliPatch: (value) => ({ id: 'MODEL', value_name: String(value).trim() }),
    },
    {
        id: 'sku',
        label: 'SKU',
        type: 'text',
        writeKind: 'sku',
        dbColumns: ['seller_custom_field', 'seller_sku'],
        canEdit: () => yes,
        getValue: (ctx) => ctx.item.seller_custom_field ?? '',
        toMeliPatch: (value) => ({ seller_custom_field: String(value).trim() }),
    },
    {
        id: 'gtin',
        label: 'Código universal',
        type: 'text',
        writeKind: 'attribute',
        attributeId: 'GTIN',
        dbColumns: ['gtin'],
        canEdit: (ctx) =>
            ctx.isCatalog ? no('El catálogo aporta el GTIN (no editable)') : yes,
        getValue: (ctx) => attrName(ctx, 'GTIN'),
        toMeliPatch: (value) => ({ id: 'GTIN', value_name: String(value).trim() }),
    },
    {
        id: 'warranty_type',
        label: 'Garantía (tipo)',
        type: 'text',
        writeKind: 'saleTerm',
        saleTermId: 'WARRANTY_TYPE',
        dbColumns: [],
        canEdit: () => yes,
        getValue: (ctx) => saleTerm(ctx, 'WARRANTY_TYPE'),
        toMeliPatch: (value) => ({ id: 'WARRANTY_TYPE', value_name: String(value).trim() }),
    },
    {
        id: 'warranty_time',
        label: 'Garantía (duración)',
        type: 'text',
        writeKind: 'saleTerm',
        saleTermId: 'WARRANTY_TIME',
        dbColumns: [],
        canEdit: () => yes,
        getValue: (ctx) => saleTerm(ctx, 'WARRANTY_TIME'),
        toMeliPatch: (value) => ({ id: 'WARRANTY_TIME', value_name: String(value).trim() }),
    },
    {
        id: 'pictures',
        label: 'Fotos',
        type: 'images',
        writeKind: 'pictures',
        dbColumns: [],
        canEdit: () => yes,
        getValue: (ctx) => (ctx.item.pictures || []).map((p: any) => p.secure_url || p.url).filter(Boolean),
        toMeliPatch: (value, ctx) => {
            const urls: string[] = Array.isArray(value) ? value : [];
            // Reutilizar el id de las fotos existentes (evita re-subir); subir solo URLs nuevas.
            const byUrl = new Map<string, any>();
            for (const p of (ctx.item.pictures || [])) {
                byUrl.set(p.secure_url || p.url, p);
            }
            return {
                pictures: urls.map((u: string) => {
                    const existing = byUrl.get(u);
                    return existing?.id ? { id: existing.id } : { source: u };
                }),
            };
        },
    },
];

// Atributos que NO son "características del producto" y no se exponen como editables.
const FIXED_ATTR_IDS = new Set([
    'BRAND', 'MODEL', 'GTIN', 'EAN', 'UPC', 'SELLER_SKU', 'SELLER_CUSTOM_FIELD',
    'ITEM_CONDITION', 'SIZE_GRID_ID', 'EXCLUSIVE_CHANNEL',
]);

/**
 * Construye los campos editables de las CARACTERÍSTICAS SECUNDARIAS (COLOR, MATERIAL,
 * ORIGIN_COUNTRY, etc.) desde los metadatos de la categoría. Enum (lista cerrada) → select
 * con value_id; libre → texto con value_name. Se identifican como `attr:<ID>`.
 */
export function buildSecondaryAttributeFields(ctx: FieldContext): EditableField[] {
    const itemAttrMap = new Map<string, any>();
    for (const a of (ctx.item.attributes || [])) itemAttrMap.set(a.id, a);
    return (ctx.categoryAttributes || [])
        .filter((a: any) => a && a.id && !FIXED_ATTR_IDS.has(a.id) && !(a.tags || {}).hidden)
        .map((a: any) => {
            const cur = itemAttrMap.get(a.id);
            const values: Array<{ value: string; label: string }> = (a.values || []).map((v: any) => ({ value: String(v.id), label: v.name }));
            const isEnum = values.length > 0;
            return {
                id: `attr:${a.id}`,
                label: a.name || a.id,
                type: isEnum ? 'select' : 'text',
                writeKind: 'attribute' as const,
                attributeId: a.id,
                dbColumns: [],
                options: isEnum ? values : undefined,
                canEdit: (c) => (c.isCatalog ? no('Los atributos los impone el catálogo') : yes),
                getValue: () => cur?.value_name ?? '',
                getValueId: () => cur?.value_id ?? null,
                toMeliPatch: (value, _c, valueId) => isEnum
                    ? (valueId ? { id: a.id, value_id: valueId, value_name: String(value) } : { id: a.id, value_name: String(value) })
                    : { id: a.id, value_name: String(value) },
            };
        });
}

export function getField(id: string): EditableField | undefined {
    return VITRINA_FIELDS.find((f) => f.id === id);
}
