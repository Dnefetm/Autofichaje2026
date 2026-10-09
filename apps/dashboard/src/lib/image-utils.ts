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
 * Reescala en el SERVIDOR (sharp, Lanczos3) hasta cumplir el mínimo de MeLi.
 * Devuelve la URL de la imagen ampliada, o null si no se pudo.
 * NOTA: ampliar una imagen pequeña SIEMPRE pierde nitidez.
 */
export async function upscaleImage(url: string): Promise<string | null> {
    try {
        const resp = await fetch(url, { mode: 'cors' });
        if (!resp.ok) return null;
        const blob = await resp.blob();
        const form = new FormData();
        form.append('file', blob, 'imagen.jpg');
        const res = await fetch('/api/upscale-imagen', { method: 'POST', body: form });
        const data = await res.json();
        if (!res.ok || !data.ok) return null;
        return data.url;
    } catch {
        return null;
    }
}
