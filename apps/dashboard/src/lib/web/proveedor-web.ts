// Contrato reutilizable de enriquecimiento web por proveedor (doble horizonte).
// Cada proveedor implementa ProveedorWebAdapter y se registra; el llamador no cambia.

export interface ProductoParaBuscar {
    proveedor: string;
    /** SKU o código de lista (para DAI/Urrea es la clave; en Tuk es correlativo interno). */
    codigo: string;
    descripcion: string;
    /** Clasificación independiente 1 (ej. FAMILIA en Tuk, línea en DAI). */
    categoria1?: string | null;
    /** Clasificación independiente 2 (ej. TIPO/modelo en Tuk). */
    categoria2?: string | null;
    ean?: string | null;
}

export interface EnriquecimientoWeb {
    imagen?: string | null;
    imagenes?: string[];
    descripcionLarga?: string | null;
    categoriaOficial?: string | null;
    atributos?: Record<string, string>;
    urlFicha?: string | null;
}

export interface ProveedorWebAdapter {
    nombre: string;
    buscar(p: ProductoParaBuscar): Promise<EnriquecimientoWeb | null>;
}

// Registro global (mismo patrón que los adapters de archivo).
const registry: Record<string, ProveedorWebAdapter> = {};

export function registrarWebAdapter(adapter: ProveedorWebAdapter): void {
    registry[adapter.nombre] = adapter;
}

export function obtenerWebAdapter(nombre: string): ProveedorWebAdapter | undefined {
    if (registry[nombre]) return registry[nombre];
    const n = String(nombre ?? '').trim().toLowerCase();
    if (!n) return undefined;
    // exacto (case-insensitive)
    for (const key of Object.keys(registry)) {
        if (key.toLowerCase() === n) return registry[key];
    }
    // parcial: 'DAI' ⊂ 'DAI Autopartes', 'Urrea' ⊂ 'Urrea Herramientas'
    return Object.values(registry).find(
        (a) => a.nombre.toLowerCase().includes(n) || n.includes(a.nombre.toLowerCase()),
    );
}
