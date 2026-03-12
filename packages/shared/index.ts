export type MarketplaceAccount = 'meli' | 'amazon' | 'walmart' | 'coppel' | 'tiktok';

export interface Articulo {
    articulo_id: string;
    nombre: string;
    marca?: string;
    modelo?: string;
    variante?: string;
    categoria?: string;
    descripcion?: string;
    codigo_universal?: string;
    codigo_sat?: string;
    imagenes: string[];
    activo: boolean;
    atributos_especificos: Record<string, any>;
    creado_el: string;
    actualizado_el: string;
    // Logística
    peso_kg?: number;
    largo_cm?: number;
    ancho_cm?: number;
    alto_cm?: number;
}

/** @deprecated Usa Articulo */
export type SKU = Articulo;

export interface InventorySnapshot {
    sku: string;
    physical_stock: number;
    dropship_stock: number;
    reserved_stock: number;
    total_stock: number;
    available_stock: number;
    updated_at: string;
}

export interface MarketplacePrice {
    sku: string;
    marketplace_id: string;
    base_price: number;
    sale_price: number;
    shipping_cost: number;
    currency: string;
}

export interface Job {
    id: string;
    type: 'sync_stock' | 'sync_price' | 'create_listing' | 'ocr_process';
    payload: any;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    attempts: number;
    max_attempts: number;
    scheduled_at: string;
    checkpoint?: any;
}

export interface MarketplaceConfig {
    id: string;
    marketplace: MarketplaceAccount;
    account_name: string;
    is_active: boolean;
    settings: any;
}

export * from './lib/crypto';
