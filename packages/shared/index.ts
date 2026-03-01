export type MarketplaceAccount = 'meli' | 'amazon' | 'walmart' | 'coppel' | 'tiktok';

export interface Category {
    id: string;
    name: string;
    parent_id?: string;
    created_at: string;
}

export interface SKU {
    sku: string;
    name: string;
    brand?: string;
    category_id?: string;
    description?: string;
    images: string[];
    is_active: boolean;
    metadata: Record<string, any>; // Atributos dinámicos de AUTOFICHAS
    created_at: string;
    updated_at: string;
}

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
