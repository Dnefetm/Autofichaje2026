import { FilaCanonica, ProveedorAdapter, ArchivoProveedor, limpiarSku, parseNumero } from '@/lib/proveedor-adapter';
import { leerXlsxFilas } from '@/lib/pdf-table';

/**
 * Tuk (Industrias Tuck) — lista de precios xlsx.
 * Formato esperado (propuesta F4): sku | descripción | precio.
 * Header-agnóstico (busca la fila cuyo encabezado de columna A sea SKU/CÓDIGO/CLAVE).
 *
 * ⚠️ VALIDAR contra el archivo real: si el xlsx usa otro orden de columnas
 * (o precio en otra posición), ajustar el mapeo aquí. Hoy no hay archivo de muestra.
 */
export const tukAdapter: ProveedorAdapter = {
    nombre: 'Tuk',
    normalizarSku: (raw) => limpiarSku(raw),
    async parse(archivo: ArchivoProveedor): Promise<FilaCanonica[]> {
        if (archivo.tipo !== 'xlsx') return [];
        const rows = await leerXlsxFilas(archivo.buffer, 0);

        // header-agnóstico: fila cuya col A sea un encabezado de código
        let headerIdx = -1;
        const headers = ['SKU', 'CODIGO', 'CÓDIGO', 'CLAVE', 'MODELO', 'NO', 'N°', 'NUMERO', 'NUM', 'CVE', 'CLAVE PRODUCTO'];
        for (let i = 0; i < Math.min(20, rows.length); i++) {
            const c = String(rows[i][0] ?? '').trim().toUpperCase();
            if (headers.includes(c)) { headerIdx = i; break; }
        }
        if (headerIdx < 0) return [];

        const filas: FilaCanonica[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            const sku = String(r[0] ?? '').trim();
            if (!sku) continue;
            // supuesto: col 1 = descripción, col 2 = precio público
            filas.push({
                proveedor: 'Tuk',
                sku_proveedor: sku,
                sku_norm: limpiarSku(sku),
                descripcion: String(r[1] ?? '').trim() || null,
                precio_publico: parseNumero(r[2]),
                tipo_costo: 'publico',
            });
        }
        return filas;
    },
};
