/**
 * vitrina-fields.ts — Esquema declarativo de campos editables de una vidriera MeLi.
 *
 * Añadir un campo nuevo = añadir un objeto a VITRINA_FIELDS. El motor (vitrina-sync)
 * y la UI (FieldEditor) lo detectan automáticamente. No hay if/else disperso.
 *
 * `endpoint` NO es el path HTTP; es el mecanismo real de escritura en MeLi:
 *  - updateItem        → PUT /items/{id}          (título, envío gratis)
 *  - updatePrice       → PUT /items/{id} {price}  (variante-aware)
 *  - updateStock       → PUT /items/{id} {available_quantity}
 *  - updateStatus      → PUT /items/{id} {status} (pausar/activar)
 *  - updateListingType → POST /items/{id}/listing_type (comisión)
 *  - updateDescription → PUT/POST /items/{id}/description
 */

export type FieldEndpoint =
    | 'updateItem'
    | 'updatePrice'
    | 'updateStock'
    | 'updateStatus'
    | 'updateListingType'
    | 'updateDescription';

export type FieldType = 'text' | 'number' | 'boolean' | 'select';

export interface FieldContext {
    item: any;            // ítem MeLi (getItem) o su equivalente desde la BD
    description: string;  // descripción actual
    isCatalog: boolean;   // catalog_listing === true (ficha la impone MeLi)
    soldQuantity: number;
    isUP: boolean;        // tiene family_name (User Products)
}

export interface FieldChange {
    field: string;
    value: any;
}

export interface EditableField {
    id: string;
    label: string;
    type: FieldType;
    options?: Array<{ value: string; label: string }>;
    endpoint: FieldEndpoint;
    /** columna en publicaciones_externas a actualizar ('' = no persistir) */
    dbColumn: string;
    /** longitud máxima (título 60, descripción 50000) */
    maxLength?: number;
    canEdit(ctx: FieldContext): { ok: boolean; reason?: string };
    getValue(ctx: FieldContext): any;
    toMeliPatch(value: any, ctx: FieldContext): any;
}

const yes = { ok: true };
const no = (reason: string) => ({ ok: false, reason });

export const VITRINA_FIELDS: EditableField[] = [
    {
        id: 'title',
        label: 'Título',
        type: 'text',
        endpoint: 'updateItem',
        dbColumn: 'titulo',
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
        endpoint: 'updatePrice',
        dbColumn: 'precio_venta',
        canEdit: () => yes,
        getValue: (ctx) => ctx.item.price ?? 0,
        toMeliPatch: (value) => Number(value),
    },
    {
        id: 'stock',
        label: 'Stock disponible',
        type: 'number',
        endpoint: 'updateStock',
        dbColumn: 'stock_publicado',
        canEdit: () => yes,
        getValue: (ctx) => ctx.item.available_quantity ?? 0,
        toMeliPatch: (value) => Math.max(0, Math.floor(Number(value))),
    },
    {
        id: 'status',
        label: 'Estado',
        type: 'select',
        endpoint: 'updateStatus',
        dbColumn: 'status_externo',
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
        endpoint: 'updateItem',
        dbColumn: 'free_shipping',
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
        label: 'Comisión (tipo de publicación)',
        type: 'select',
        endpoint: 'updateListingType',
        dbColumn: 'listing_type_id',
        options: [
            { value: 'gold_special', label: 'Clásica (~16%)' },
            { value: 'gold_pro', label: 'Premium (~32%)' },
            { value: 'free', label: 'Gratuita' },
        ],
        canEdit: (ctx) =>
            ctx.isCatalog
                ? no('La comisión de un ítem de catálogo no se cambia desde aquí')
                : yes,
        getValue: (ctx) => ctx.item.listing_type_id || '',
        toMeliPatch: (value) => String(value),
    },
    {
        id: 'description',
        label: 'Descripción',
        type: 'text',
        endpoint: 'updateDescription',
        dbColumn: 'description_plain',
        maxLength: 50000,
        canEdit: (ctx) =>
            ctx.isCatalog ? no('La descripción la impone el catálogo (no editable)') : yes,
        getValue: (ctx) => ctx.description,
        toMeliPatch: (value) => String(value),
    },
];

export function getField(id: string): EditableField | undefined {
    return VITRINA_FIELDS.find((f) => f.id === id);
}
