import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import axios from 'axios';
import { decrypt } from '@gestor/shared';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/fix-seller-sku
 *
 * Corrige el SELLER_SKU en MeLi para las 2 publicaciones con bug UUID-prefix.
 * Obtiene el access_token desde marketplace_tokens (igual que MeliAdapter).
 *
 * Body: { dry_run?: boolean }
 */

const FIXES = [
    { external_item_id: 'MLM5147586196', marketplace_id: '709df7c0-e6b0-4773-a91c-0a6364b8437a', sku_correcto: 'JBCS9' },
    { external_item_id: 'MLM2848166379', marketplace_id: '897aa205-2c23-480e-bc4f-79fba69258da', sku_correcto: 'JBCS9' },
];

async function getAccessToken(marketplaceId: string): Promise<string> {
    // UUID completo → query directa a marketplace_tokens con .eq(), sin intermediarios.
    const { data: tokenRow, error } = await supabaseAdmin
        .from('marketplace_tokens')
        .select('access_token')
        .eq('marketplace_id', marketplaceId)
        .single();

    if (error || !tokenRow) throw new Error(`Token no encontrado para ${marketplaceId}: ${error?.message}`);

    return decrypt(tokenRow.access_token);
}

export async function POST(req: NextRequest) {
    const body = await req.json().catch(() => ({}));
    const dry_run = body.dry_run === true;

    const results: any[] = [];

    for (const fix of FIXES) {
        const result: any = {
            item: fix.external_item_id,
            marketplace_prefix: fix.marketplace_id,
            sku_correcto: fix.sku_correcto,
            dry_run,
        };

        try {
            const accessToken = await getAccessToken(fix.marketplace_id);
            result.token_ok = true;

            if (dry_run) {
                result.accion = 'DRY RUN — no se envió a MeLi';
                results.push(result);
                continue;
            }

            // PUT a MeLi
            const meliResp = await axios.put(
                `https://api.mercadolibre.com/items/${fix.external_item_id}`,
                { attributes: [{ id: 'SELLER_SKU', value_name: fix.sku_correcto }] },
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );

            result.meli_status = meliResp.status;
            result.meli_ok = true;

            // Actualizar en BD (por si no lo hizo Comet o para confirmar)
            const { error: dbErr } = await supabaseAdmin
                .from('publicaciones_externas')
                .update({ seller_sku: fix.sku_correcto })
                .eq('external_item_id', fix.external_item_id);

            result.db_updated = !dbErr;
            if (dbErr) result.db_error = dbErr.message;

        } catch (e: any) {
            result.error = e.response?.data || e.message;
            result.meli_ok = false;
        }

        results.push(result);
    }

    const allOk = results.every(r => r.meli_ok !== false);
    return NextResponse.json({ ok: allOk, dry_run, results });
}
