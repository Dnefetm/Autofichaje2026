import { supabase } from './lib/supabase';
import logger from './lib/logger';

export class SKU_Service {
    /**
     * Calcula el stock disponible para un SKU, considerando si es un bundle.
     * Si es un bundle, el stock disponible es el mínimo posible basado en sus componentes.
     * Si es un producto simple, es su stock físico + dropship - reservado.
     */
    static async calculateAvailableStock(sku: string): Promise<number> {
        // 1. Verificar si es un bundle
        const { data: components, error: bundleError } = await supabase
            .from('bundle_components')
            .select('component_sku, quantity')
            .eq('bundle_sku', sku);

        if (bundleError) {
            logger.error({ sku, error: bundleError }, 'Error al consultar componentes del bundle');
            throw bundleError;
        }

        if (components && components.length > 0) {
            // Caso Bundle: recursión para cada componente
            let minAvailable = Infinity;

            for (const item of components) {
                const componentStock = await this.calculateAvailableStock(item.component_sku);
                const possiblePacks = Math.floor(componentStock / item.quantity);
                minAvailable = Math.min(minAvailable, possiblePacks);
            }

            return minAvailable === Infinity ? 0 : minAvailable;
        }

        // Caso Producto Simple: Stock Físico + Dropship - Reservado
        const { data: stockData, error: stockError } = await supabase
            .from('inventory_snapshot')
            .select('physical_stock, dropship_stock, reserved_stock')
            .eq('sku', sku)
            .single();

        if (stockError) {
            if (stockError.code === 'PGRST116') return 0; // No encontrado
            throw stockError;
        }

        return (stockData.physical_stock || 0) + (stockData.dropship_stock || 0) - (stockData.reserved_stock || 0);
    }

    static async createArticulo(data: any) {
        const articuloId = data.articulo_id || data.sku;
        logger.info({ articulo_id: articuloId }, 'Creando artículo con lógica unificada');
        const { error } = await supabase.from('articulos').insert({
            articulo_id: articuloId,
            nombre: data.nombre || data.name,
            marca: data.marca || data.brand,
            descripcion: data.descripcion || data.description,
            activo: true
        });
        if (error) throw error;

        await supabase.from('inventory_snapshot').insert({ sku: articuloId });
    }

    static async updateTechnicalSpecs(articuloId: string, specs: any) {
        await supabase.from('articulos').update({ atributos_especificos: specs }).eq('articulo_id', articuloId);
    }

    static async getInventory(sku: string) {
        // Consulta a view_available_stock
    }
}
