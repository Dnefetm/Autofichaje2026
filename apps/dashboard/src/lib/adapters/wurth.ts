import { FilaCanonica, ProveedorAdapter, ArchivoProveedor, skuBaseWurth, parseNumero } from '@/lib/proveedor-adapter';
import { leerXlsxFilas, leerPdfTabla, leerPdfFilasPosicion } from '@/lib/pdf-table';

/**
 * Wurth — 3 archivos que se fusionan por sku_norm (código base):
 *  - xlsx precios: Código | Descripción | Precio Cant.Mínima | CantMín | Precio Distribuidor | CantMín | Precio Público | Multiplos
 *  - pdf existencias: SKU (prefijo 90/91) | DESCRIPCIÓN | STOCK
 *  - pdf SAT: Código | Descripción | CLAVE SAT
 */
export const wurthAdapter: ProveedorAdapter = {
    nombre: 'Wurth',
    normalizarSku: (raw) => skuBaseWurth(raw),
    async parse(archivo: ArchivoProveedor): Promise<FilaCanonica[]> {
        if (archivo.tipo === 'xlsx') return parsePrecios(archivo.buffer);
        if (archivo.tipo === 'pdf') {
            const nombre = archivo.nombre.toUpperCase();
            if (archivo.feed === 'existencias' || nombre.includes('EXISTENC')) return parseExistencias(archivo.buffer);
            if (archivo.feed === 'sat' || nombre.includes('SAT')) return parseSat(archivo.buffer);
        }
        return [];
    },
};

async function parsePrecios(buffer: Buffer): Promise<FilaCanonica[]> {
    const rows = await leerXlsxFilas(buffer, 0);
    let headerIdx = -1;
    for (let i = 0; i < Math.min(5, rows.length); i++) {
        if (String(rows[i][0] ?? '').trim().toUpperCase() === 'CÓDIGO' || String(rows[i][0] ?? '').trim().toUpperCase() === 'CODIGO') { headerIdx = i; break; }
    }
    if (headerIdx < 0) return [];
    const filas: FilaCanonica[] = [];
    // Desde la fila siguiente al header; las filas vacías o de sub-encabezado se saltan por `if (!codigo)`.
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const r = rows[i];
        const codigo = String(r[0] ?? '').trim();
        if (!codigo) continue;
        filas.push({
            proveedor: 'Wurth',
            sku_proveedor: codigo,
            sku_norm: skuBaseWurth(codigo),
            descripcion: String(r[1] ?? '').trim() || null,
            precio_cantidad_minima: parseNumero(r[2]),
            cantidad_minima: parseInt(String(r[3] ?? ''), 10) || null,
            precio_distribuidor: parseNumero(r[4]),
            precio_publico: parseNumero(r[6]),
            multiplicador_venta: parseInt(String(r[7] ?? ''), 10) || null,
            tipo_costo: 'distribuidor',
        });
    }
    return filas;
}

/**
 * El PDF de existencias intercala dos tipos de fila:
 *  - fila SKU (una sola celda, empieza con 90/91) — el código va a la izquierda;
 *  - fila DESCRIPCIÓN + STOCK (2 celdas) — la existencia va al final.
 * Cada fila SKU se empareja con la fila siguiente.
 */
async function parseExistencias(buffer: Buffer): Promise<FilaCanonica[]> {
    const rows = await leerPdfTabla(buffer);
    const filas: FilaCanonica[] = [];
    let lastSku: string | null = null;
    for (const r of rows) {
        if (r.length === 1 && /^9[01]\d/.test(r[0].replace(/\s+/g, ''))) {
            lastSku = r[0];
        } else if (r.length >= 2 && lastSku) {
            const stock = parseNumero(r[r.length - 1], true);
            const descripcion = r.slice(0, r.length - 1).join(' ').trim();
            if (stock != null) {
                filas.push({
                    proveedor: 'Wurth',
                    sku_proveedor: lastSku,
                    sku_norm: skuBaseWurth(lastSku),
                    descripcion: descripcion || null,
                    stock,
                });
            }
            lastSku = null;
        }
    }
    return filas;
}

/**
 * El PDF SAT intercala una fila "Código + Descripción" (el código puede ir dividido
 * en varias celdas, todas a x<100) y la fila siguiente con la CLAVE SAT (8 dígitos, x>=300).
 */
async function parseSat(buffer: Buffer): Promise<FilaCanonica[]> {
    const rows = await leerPdfFilasPosicion(buffer);
    const filas: FilaCanonica[] = [];
    let last: { code: string; desc: string } | null = null;
    for (const r of rows) {
        const codigo = r.filter((c) => c.x < 100).map((c) => c.texto).join(' ').trim();
        const desc = r.filter((c) => c.x >= 100 && c.x < 300).map((c) => c.texto).join(' ').trim();
        const sat = r.filter((c) => c.x >= 300).map((c) => c.texto).join('').trim();
        if (codigo && desc) {
            last = { code: codigo, desc };
        } else if (last && /^\d{8}$/.test(sat)) {
            filas.push({
                proveedor: 'Wurth',
                sku_proveedor: last.code,
                sku_norm: skuBaseWurth(last.code),
                descripcion: last.desc || null,
                codigo_sat: sat,
            });
            last = null;
        }
    }
    return filas;
}
