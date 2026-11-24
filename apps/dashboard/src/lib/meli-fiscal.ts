/**
 * Utilidades y constantes compartidas para los atributos fiscales SAT / CFDI de MeLi (MLM).
 * Módulo puro (client + server) sin dependencias de servidor.
 */

export const FISCAL_ATTR_IDS = new Set([
    'SAT_KEY',
    'MEASURE_UNIT_KEY',
    'MEASURE_UNIT_DESCRIPTION',
    'INVOICE_PRODUCT_NAME',
    'IVA_FOR_RESALE',
    'IEPS',
    'IMPORT_DECLARATION_NUMBER',
]);

export const IVA_VALUE_IDS: Record<string, string> = {
    '16%': '81861616',
    '0%': '81861613',
    'exento': '81861612',
};

export const IEPS_VALUE_IDS: Record<string, string> = {
    '0%': '82021095',
    '3%': '82021096',
    '6%': '82021097',
    '7%': '82021098',
    '8%': '82021099',
    '9%': '82021100',
    '25%': '82021101',
    '26.5%': '82021102',
    '30%': '82021103',
    '30.4%': '82021104',
    '50%': '82021105',
    '53%': '82021106',
    '160%': '82021107',
};

export const SAT_MEASURE_PRESETS = [
    { key: 'H87', desc: 'Pieza' },
    { key: 'KT', desc: 'Kit' },
    { key: 'XBX', desc: 'Caja' },
    { key: 'SET', desc: 'Juego' },
    { key: 'PR', desc: 'Par' },
    { key: 'LTR', desc: 'Litro' },
    { key: 'KGM', desc: 'Kilogramo' },
    { key: 'MTR', desc: 'Metro' },
];

export const IVA_OPTIONS = ['16%', '0%', 'Exento'];
export const IEPS_RATES = Object.keys(IEPS_VALUE_IDS);

export interface MeliFiscalAttributes {
    sat_key: string | null;
    measure_unit_key: string | null;
    measure_unit_description: string | null;
    invoice_product_name: string | null;
    iva_for_resale: string | null;
    ieps: string | null;
    import_declaration_number: string | null;
}

export function isValidSatKey(v: string | null | undefined): boolean {
    return /^\d{8}$/.test(String(v ?? '').trim());
}

export function extractFiscalFromMeliAttributes(
    attributes: any[] | null | undefined,
): MeliFiscalAttributes {
    const val = (id: string): string | null => {
        if (!Array.isArray(attributes)) return null;
        const found = attributes.find((a: any) => a?.id === id);
        if (!found) return null;
        const raw = found.value_name ?? found.values?.[0]?.name ?? null;
        const trimmed = raw != null ? String(raw).trim() : '';
        return trimmed ? trimmed : null;
    };

    return {
        sat_key: val('SAT_KEY'),
        measure_unit_key: val('MEASURE_UNIT_KEY'),
        measure_unit_description: val('MEASURE_UNIT_DESCRIPTION'),
        invoice_product_name: val('INVOICE_PRODUCT_NAME'),
        iva_for_resale: val('IVA_FOR_RESALE'),
        ieps: val('IEPS'),
        import_declaration_number: val('IMPORT_DECLARATION_NUMBER'),
    };
}

export function hasAnyFiscalData(
    f: Partial<MeliFiscalAttributes> | null | undefined,
): boolean {
    if (!f) return false;
    return Boolean(
        f.sat_key ||
        f.measure_unit_key ||
        f.measure_unit_description ||
        f.invoice_product_name ||
        f.iva_for_resale ||
        f.ieps ||
        f.import_declaration_number,
    );
}
