import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { decrypt } from '@gestor/shared';

export const maxDuration = 300; 
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
    try {
        console.log("Iniciando ingesta de comisiones...");
        
        const categories = new Set<string>();
        let validMarketplaceId = null;
        let from = 0;
        const step = 1000;
        let keepGoing = true;
        
        while (keepGoing) {
            const { data: catData, error: catError } = await supabaseAdmin
                .from('publicaciones_externas')
                .select('category_id, marketplace_id')
                .not('category_id', 'is', null)
                .range(from, from + step - 1);
                
            if (catError) throw catError;
            
            for (const row of catData) {
                categories.add(row.category_id);
                if (!validMarketplaceId && row.marketplace_id) {
                    validMarketplaceId = row.marketplace_id;
                }
            }
            
            if (catData.length < step) {
                keepGoing = false;
            } else {
                from += step;
            }
        }
        
        const catArray = Array.from(categories);
        console.log(`Se encontraron ${catArray.length} categorias unicas.`);
        
        if (!validMarketplaceId) {
            return NextResponse.json({ error: 'No se encontro un marketplace_id valido.' }, { status: 400 });
        }
        
        const { data: tokenRow } = await supabaseAdmin
            .from('marketplace_tokens')
            .select('access_token')
            .not('access_token', 'is', null)
            .order('expires_at', { ascending: false })
            .limit(1)
            .single();
            
        if (!tokenRow?.access_token) {
             return NextResponse.json({ error: 'No hay access token para este marketplace' }, { status: 400 });
        }
        const token = decrypt(tokenRow.access_token);
        
        const results = { procesadas: 0, errores: 0, creadas: 0 };
        const batchSize = 10;
        
        for (let i = 0; i < catArray.length; i += batchSize) {
            const batch = catArray.slice(i, i + batchSize);
            const promises = batch.map(async (categoryId) => {
                try {
                    const res = await fetch(`https://api.mercadolibre.com/sites/MLM/listing_prices?price=10000&category_id=${categoryId}`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    const response = await res.json();
                    
                    const rowsToInsert = [];
                    for (const priceObj of response || []) {
                        if (priceObj.listing_type_id === 'gold_pro' || priceObj.listing_type_id === 'gold_special') {
                            
                            // API de MercadoLibre moderna devuelve sale_fee_amount
                            const feeAmount = priceObj.sale_fee_amount;
                            
                            if (feeAmount != null) {
                                // price=10000, entonces fee=1250 significa 12.5%
                                const pct = feeAmount / 100;
                                rowsToInsert.push({
                                    category_id: categoryId,
                                    listing_type_id: priceObj.listing_type_id,
                                    commission_percentage: pct,
                                    commission_real: pct,
                                    commission_estimated: pct,
                                    withholding_real: null,
                                    withholding_estimated: 10.0,
                                    is_current: true
                                });
                            }
                        }
                    }
                    
                    if (rowsToInsert.length > 0) {
                        const { error: insErr } = await supabaseAdmin
                            .from('meli_category_commissions')
                            .upsert(rowsToInsert, { onConflict: 'category_id, listing_type_id, is_current' });
                        if (insErr) {
                            console.error(`Error DB para ${categoryId}:`, insErr.message);
                            results.errores++;
                        } else {
                            results.creadas += rowsToInsert.length;
                        }
                    }
                    results.procesadas++;
                } catch (err: any) {
                    console.error(`Error fetch para ${categoryId}:`, err?.message || err);
                    results.errores++;
                }
            });
            await Promise.all(promises);
        }
        
        console.log("Ingesta completada:", results);
        return NextResponse.json({ success: true, results });
    } catch (error: any) {
        console.error("Fatal:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
