import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
    return {
        name: 'Gestor — Preparación Full',
        short_name: 'Gestor Full',
        description: 'Preparación de envíos Full (Mercado Libre) para operarios en bodega.',
        start_url: '/envios/preparacion',
        display: 'standalone',
        background_color: '#0a0a0a',
        theme_color: '#0a0a0a',
        icons: [
            { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
    };
}
