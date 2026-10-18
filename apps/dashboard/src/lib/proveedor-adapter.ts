// Framework reutilizable de adapters de proveedores.
// Cada proveedor implementa ProveedorAdapter y se registra; el núcleo (merge/upsert) no cambia.

export interface FilaCanonica {
    proveedor: string;
    sku_proveedor: string;
    sku_norm: string;
    codigo_barra?: string | null;
    descripcion?: string | null;
    marca?: string | null;
    codigo_sat?: string | null;
    multiplicador_venta?: number | null;
    cantidad_minima?: number | null;
    precio_distribuidor?: number | null;
    precio_subdistribuidor?: number | null;
    precio_publico?: number | null;
    precio_cantidad_minima?: number | null;
    tipo_costo?: string | null;
    stock?: number | null;
    extra?: Record<string, any> | null;
}

export type TipoArchivo = 'xlsx' | 'pdf' | 'csv';

export interface ArchivoProveedor {
    nombre: string;
    buffer: Buffer;
    tipo: TipoArchivo;
}

export interface ProveedorAdapter {
    nombre: string;
    /** Normaliza un SKU crudo a la clave de merge (sku_norm), SIN alterar el original. */
    normalizarSku(raw: unknown): string;
    /** Parsea un archivo (según su tipo) y devuelve filas canónicas. */
    parse(archivo: ArchivoProveedor): Promise<FilaCanonica[]>;
}

// Registro global de adapters (doble horizonte: agregar proveedor = registrar un adapter).
const registry: Record<string, ProveedorAdapter> = {};

export function registrarAdapter(adapter: ProveedorAdapter): void {
    registry[adapter.nombre] = adapter;
}

export function obtenerAdapter(nombre: string): ProveedorAdapter | undefined {
    return registry[nombre];
}

// -- Helpers genéricos de normalización ---------------------------------------

/** Trim + colapsar espacios + quitar apóstrofe inicial + mayúsculas. */
export function limpiarSku(raw: unknown): string {
    return String(raw ?? '').trim().replace(/\s+/g, ' ').replace(/^'+/, '').toUpperCase();
}

/**
 * Canoniza el código base de Wurth: quita el prefijo de canal 90/91 y estandariza
 * a ceros a la izquierda. Ej. '90537 826 873' y '91537 826 873' → '00537826873'.
 */
export function skuBaseWurth(raw: unknown): string {
    let s = String(raw ?? '').trim().replace(/\s+/g, '');
    if (/^9[01]/.test(s)) s = '00' + s.slice(2);
    return s;
}

/** Colapsa espacios y quita apóstrofe, para el merge genérico. */
export function skuNormGenerico(raw: unknown): string {
    return String(raw ?? '').trim().replace(/\s+/g, '').replace(/^'+/, '').toUpperCase();
}

// -- Merge ---------------------------------------------------------------

/**
 * Une filas por (proveedor, sku_norm). Los campos no-nulos del archivo posterior
 * solo llenan lo que aún está vacío; el stock (existencia) se sobrescribe con el
 * valor más reciente. `extra` se acumula.
 */
export function mergeFilas(filas: FilaCanonica[]): Map<string, FilaCanonica> {
    const map = new Map<string, FilaCanonica>();
    for (const f of filas) {
        const key = `${f.proveedor}||${f.sku_norm}`;
        const prev = map.get(key);
        if (!prev) {
            map.set(key, { ...f, extra: f.extra ? { ...f.extra } : undefined });
            continue;
        }
        for (const [k, v] of Object.entries(f)) {
            if (k === 'stock' || k === 'extra' || k === 'sku_proveedor') continue;
            if (v != null && v !== '' && (prev as any)[k] == null) (prev as any)[k] = v;
        }
        if (f.stock != null) prev.stock = f.stock; // la existencia más reciente gana
        if (f.extra) prev.extra = { ...(prev.extra || {}), ...f.extra };
    }
    return map;
}

/** Parseo de números con separador de miles / decimales (ej. '8,045' → 8045, '1.247,74' → 1247.74). */
export function parseNumero(raw: unknown): number | null {
    if (raw == null) return null;
    let s = String(raw).trim();
    if (s === '' || s === '-') return null;
    s = s.replace(/[^\d.,-]/g, '');
    const tieneComa = s.includes(',');
    const tienePunto = s.includes('.');
    if (tieneComa && tienePunto) {
        // punto = miles, coma = decimal
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (tieneComa) {
        // coma = decimal (o miles si solo hay una coma y 3 dígitos después... asumimos decimal)
        s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
}
