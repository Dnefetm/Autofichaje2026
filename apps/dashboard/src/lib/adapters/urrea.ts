import { FilaCanonica, ProveedorAdapter, ArchivoProveedor, limpiarSku, parseNumero } from '@/lib/proveedor-adapter';
import { leerXlsxFilas } from '@/lib/pdf-table';

/**
 * Urrea — "Reporte Disponibilidad AdministracionXXXX.xlsx".
 * Header dinámico (fila con "SKU" en la columna A). Columnas:
 * 0 SKU | 1 Nombre Corto | 2 EAN UPC | 5 Marca | 6 Multiplo Venta | 7 Disponibilidad | 11 Precio Sub-Distribuidor
 */
export const urreaAdapter: ProveedorAdapter = {
    nombre: 'Urrea Herramientas',
    normalizarSku: (raw) => limpiarSku(raw),
    async parse(archivo: ArchivoProveedor): Promise<FilaCanonica[]> {
        if (archivo.tipo !== 'xlsx') return [];
        const rows = await leerXlsxFilas(archivo.buffer);

        // header-agnóstico: buscar fila cuya col A (trim, upper) sea "SKU"
        let headerIdx = -1;
        for (let i = 0; i < Math.min(20, rows.length); i++) {
            if (String(rows[i][0] ?? '').trim().toUpperCase() === 'SKU') { headerIdx = i; break; }
        }
        if (headerIdx < 0) return [];

        const filas: FilaCanonica[] = [];
        for (let i = headerIdx + 1; i < rows.length; i++) {
            const r = rows[i];
            const sku = String(r[0] ?? '').trim();
            if (!sku) continue;
            const descripcion = String(r[1] ?? '').trim();
            const ean = String(r[2] ?? '').trim();
            const marca = String(r[5] ?? '').trim();
            const multiplo = parseInt(String(r[6] ?? ''), 10);
            const stock = parseInt(String(r[7] ?? ''), 10);
            const precio = parseNumero(r[11]);
            filas.push({
                proveedor: 'Urrea Herramientas',
                sku_proveedor: sku,
                sku_norm: limpiarSku(sku),
                descripcion: descripcion || null,
                codigo_barra: ean || null,
                marca: marca || null,
                multiplicador_venta: isNaN(multiplo) ? null : multiplo,
                stock: isNaN(stock) ? null : stock,
                precio_subdistribuidor: precio,
                tipo_costo: 'subdistribuidor',
                extra: { disp_descuento_bo_y_surt: String(r[10] ?? '').trim() || null },
            });
        }
        return filas;
    },
};
