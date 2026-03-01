import { SKU, InventorySnapshot, MarketplacePrice } from '@gestor/shared';

export interface MarketplaceCapabilities {
    supportsBulkStock: boolean;
    supportsBulkPrice: boolean;
    supportsWebhooks: boolean;
    maxStockUpdateRate: number; // req / seg
}

export interface MarketplaceAdapter {
    readonly capabilities: MarketplaceCapabilities;

    refreshToken(accountId: string): Promise<void>;

    updateStock(accountId: string, items: Array<{ itemId: string, variationId?: string, quantity: number }>): Promise<any>;

    updatePrice(accountId: string, items: Array<{ itemId: string, variationId?: string, price: number }>): Promise<any>;

    pauseListing(accountId: string, itemId: string): Promise<void>;

    activateListing(accountId: string, itemId: string): Promise<void>;

    getRecentOrders(accountId: string, since: Date): Promise<any[]>;

    getStock(accountId: string, itemId: string, variationId?: string): Promise<number>;

    // Mapping e IA (AUTOFICHAS)
    syncCatalogItem(accountId: string, itemId: string): Promise<void>;
}
