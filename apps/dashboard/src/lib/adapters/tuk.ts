import { FilaCanonica, ProveedorAdapter, ArchivoProveedor, limpiarSku, parseNumero } from '@/lib/proveedor-adapter';
import { leerXlsxFilas } from '@/lib/pdf-table';

/**
 * Tuk — "LISTA Catálogo y precios Tuk Agosto 2026.ods" (.ods se lee con SheetJS igual que xlsx).
 * Columnas reales (0-index):
 *  0 ORDEN | 1 CÓDIGO | 2 FAMILIA | 3 TIPO | 4 PRODUCTO | 5 DESCRIPCIÓN PRODUCTO |
 *  6 MEDIDA | 7 PZAS X CAJA | 8 $ MÍNIMO | 9 $ UNITARIO
 */
export const tukAdapter: ProveedorAdapter = {
    nombre: 'Tuk',
    normalizarSku: (raw) => limpiarSku(raw),
    async parse(archivo: ArchivoProveedor): Promise<FilaCanonica[]> {
        if (archivo.tipo !== 'xlsx') return [];
        const rows = await leerXlsxFilas(archivo.buffer, 0);

        // Header: col A = "ORDEN"
        let headerIdx = -1;
        for (let i = 0; i < Math.min(5, rows.length); i++) {
            if (String(rows[i][0] ?? '').trim().toUpperCase() === 'ORDEN') { headerIdx = i; break; }
        }
        if (headerIdx < 0) return [];

        const filas: FilaCanonica[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            const codigo = String(r[1] ?? '').trim();
            if (!codigo) continue;
            const familia = String(r[2] ?? '').trim();
            const tipo = String(r[3] ?? '').trim();
            const producto = String(r[4] ?? '').trim();
            const descripcion = String(r[5] ?? '').trim() || producto;
            const medida = String(r[6] ?? '').trim();
            filas.push({
                proveedor: 'Tuk',
                sku_proveedor: codigo,
                sku_norm: limpiarSku(codigo),
                descripcion: descripcion || null,
                multiplicador_venta: parseInt(String(r[7] ?? ''), 10) || null,
                precio_distribuidor: parseNumero(r[8]),
                precio_publico: parseNumero(r[9]),
                tipo_costo: 'publico',
                extra: { familia: familia || null, tipo: tipo || null, medida: medida || null },
            });
        }
        return filas;
    },
};
