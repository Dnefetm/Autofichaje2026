import { ProveedorWebAdapter, EnriquecimientoWeb } from './proveedor-web';
import { extraerProductoDai } from '@/lib/dai-extractor';

/** DAI — reusa el extractor existente de dai.com.mx (búsqueda por código DAI). */
export const daiWebAdapter: ProveedorWebAdapter = {
    nombre: 'DAI Autopartes',
    async buscar(p): Promise<EnriquecimientoWeb | null> {
        const producto = await extraerProductoDai(p.codigo);
        if (!producto) return null;
        return {
            imagen: producto.imagen,
            descripcionLarga: [producto.aplicacion, producto.linea].filter(Boolean).join('\n') || null,
            categoriaOficial: producto.linea || null,
            atributos: producto.oem ? { OEM: producto.oem } : undefined,
            urlFicha: null,
        };
    },
};
