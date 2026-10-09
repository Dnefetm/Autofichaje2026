// image-utils.ts — helpers de imagen en el navegador (medir + reescalar a mínimo MeLi).

export interface ImageSize {
    w: number;
    h: number;
}

/** Mide las dimensiones reales de una imagen por URL. */
export async function measureImage(url: string): Promise<ImageSize | null> {
    try {
        const resp = await fetch(url, { mode: 'cors' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('no carga'));
            i.src = objUrl;
        });
        const size = { w: img.naturalWidth, h: img.naturalHeight };
        URL.revokeObjectURL(objUrl);
        return size;
    } catch {
        return null;
    }
}

/** MeLi exige: un lado >= 500px y el otro >= 250px. */
export function meetsMeliSize(size: ImageSize): boolean {
    return Math.max(size.w, size.h) >= 500 && Math.min(size.w, size.h) >= 250;
}

/**
 * Reescala en el navegador (Canvas) hasta cumplir el mínimo de MeLi.
 * Devuelve un Blob JPEG con lado mayor >= 600px y menor >= 250px, o null si no
 * es necesario o no se pudo procesar.
 */
export async function upscaleImage(url: string): Promise<Blob | null> {
    try {
        const resp = await fetch(url, { mode: 'cors' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        const objUrl = URL.createObjectURL(blob);
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const i = new Image();
            i.onload = () => resolve(i);
            i.onerror = () => reject(new Error('no carga'));
            i.src = objUrl;
        });
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const scale = Math.max(600 / Math.max(w, h), 250 / Math.min(w, h), 1);
        if (scale <= 1) {
            URL.revokeObjectURL(objUrl);
            return null;
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            URL.revokeObjectURL(objUrl);
            return null;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(objUrl);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
    } catch {
        return null;
    }
}
