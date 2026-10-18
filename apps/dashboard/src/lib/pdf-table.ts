// Extracción de tablas de PDF (reutilizable) usando pdfjs-dist con posiciones.
// Reconstruye filas agrupando items de texto por su coordenada Y y ordenando por X.

export interface CeldaPdf {
    /** Posición X (izquierda→derecha) para separar columnas. */
    x: number;
    /** Texto de la celda, ya sin espacios sobrantes. */
    texto: string;
}

interface ItemRaw { x: number; str: string; }

/** Lee todas las páginas y devuelve filas (arriba→abajo) de celdas (izquierda→derecha). */
async function leerPdfPaginas(buffer: Uint8Array): Promise<ItemRaw[][]> {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const filas: ItemRaw[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p);
        const tc = await page.getTextContent();
        const byY = new Map<number, ItemRaw[]>();
        for (const item of tc.items as any[]) {
            if (!item?.str) continue;
            const x = item.transform[4];
            const y = Math.round(item.transform[5]);
            if (!byY.has(y)) byY.set(y, []);
            byY.get(y)!.push({ x, str: item.str.trim() });
        }
        const ys = [...byY.keys()].sort((a, b) => b - a); // de arriba hacia abajo
        for (const y of ys) {
            filas.push(byY.get(y)!.filter((c) => c.str !== '').sort((a, b) => a.x - b.x));
        }
    }
    return filas;
}

/** Filas como texto plano (sin posición). Útil para tablas donde la columna se infiere por orden. */
export async function leerPdfTabla(buffer: Uint8Array): Promise<string[][]> {
    const filas = await leerPdfPaginas(buffer);
    return filas.map((r) => r.map((c) => c.str));
}

/** Filas con posición X por celda. Útil para tablas donde el SKU se divide en varias celdas o hay que separar columnas por coordenada. */
export async function leerPdfFilasPosicion(buffer: Uint8Array): Promise<CeldaPdf[][]> {
    const filas = await leerPdfPaginas(buffer);
    return filas.map((r) => r.map((c) => ({ x: Math.round(c.x), texto: c.str })));
}

/** Añade un helper para leer XLSX a filas (header:1), reutilizable. */
export async function leerXlsxFilas(buffer: Uint8Array, hoja: number = 0): Promise<any[][]> {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[hoja]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][];
}
