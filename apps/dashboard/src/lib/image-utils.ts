// image-utils.ts — helpers de imagen en el navegador (medir + reescalar a mínimo MeLi).

export interface ImageSize {
    w: number;
    h: number;
}

/**
 * Convierte URLs de miniaturas del CDN de MercadoLibre (-I.jpg, -V.jpg, etc.)
 * a su versión en alta definición / Zoom completo (-F.jpg o -O.jpg).
 */
export function toHighResMeliUrl(url: string): string {
    if (!url || typeof url !== 'string') return url;
    if (url.includes('mlstatic.com')) {
        // Reemplaza miniaturas (-I, -V, -M) o versión base (-O) por la versión Full HD (-F) de MeLi
        return url.replace(/-[IVMCO]\.(jpg|jpeg|png|webp)$/i, '-F.$1');
    }
    return url;
}

/** Mide las dimensiones reales de una imagen por URL (eleva a alta resolución si es de MeLi). */
export async function measureImage(url: string): Promise<ImageSize | null> {
    const targetUrl = toHighResMeliUrl(url);
    try {
        const resp = await fetch(targetUrl, { mode: 'cors' });
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

/** MeLi exige: al menos un lado >= 500px y el otro >= 50px (para formatos verticales/horizontales). */
export function meetsMeliSize(size: ImageSize): boolean {
    return Math.max(size.w, size.h) >= 500 && Math.min(size.w, size.h) >= 50;
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
