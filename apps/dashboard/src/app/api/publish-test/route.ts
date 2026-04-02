/**
 * POST /api/publish-test
 *
 * Endpoint TEMPORAL de diagnóstico para publicar 1 artículo en MeLi.
 * Propósito: validar el flujo completo paso a paso con datos reales.
 * Cada paso retorna su resultado en el objeto de respuesta para inspección.
 *
 * NO usar en producción. Reemplazar por el job 'publish_item' cuando el flujo esté validado.
 *
 * Body esperado:
 * {
 *   articulo_id: string,           // UUID del artículo en tabla articulos
 *   marketplace_id: string,        // ID de la cuenta MeLi (marketplace_configs.id)
 *   pictures: string[],            // URLs públicas de imágenes (provistos manualmente por ahora)
 *   category_id?: string,          // Opcional: si ya se conoce la categoría MeLi
 *   listing_type_id?: string,      // Opcional: default "gold_special"
 *   dry_run?: boolean              // Si true, construye el body pero NO envía a MeLi
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { MeliAdapter } from '@gestor/adapters/meli';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
    const startTime = Date.now();
    const trace: Record<string, any> = {}; // "tubo transparente" — cada paso deja su huella aquí

    try {
        // ── 0. Validar body ───────────────────────────────────────────────────
        const body = await req.json().catch(() => null);
        if (!body || !body.articulo_id || !body.marketplace_id) {
            return NextResponse.json({
                ok: false,
                error: 'Se requieren articulo_id y marketplace_id en el body',
            }, { status: 400 });
        }

        const {
            articulo_id,
            marketplace_id,
            pictures = [],
            category_id: category_id_override,
            listing_type_id = 'gold_special',
            dry_run = false,
        } = body;

        trace.input = { articulo_id, marketplace_id, pictures_count: pictures.length, listing_type_id, dry_run };

        // ── 1. Leer artículo de BD ────────────────────────────────────────────
        const { data: articulo, error: artErr } = await supabaseAdmin
            .from('articulos')
            .select(`
                articulo_id, nombre, marca, modelo, variante,
                categoria, descripcion, codigo_universal,
                pais_origen, peso_kg, largo_cm, ancho_cm, alto_cm,
                activo, es_obsoleto, publicacion_ml, sku
            `)
            .eq('articulo_id', articulo_id)
            .single();

        if (artErr || !articulo) {
            return NextResponse.json({
                ok: false,
                error: `Artículo no encontrado: ${artErr?.message}`,
                trace,
            }, { status: 404 });
        }

        trace.paso_1_articulo = {
            nombre: articulo.nombre,
            marca: articulo.marca,
            modelo: articulo.modelo,
            variante: articulo.variante,
            categoria: articulo.categoria,
            codigo_universal: articulo.codigo_universal,
            sku: articulo.sku,
            activo: articulo.activo,
            es_obsoleto: articulo.es_obsoleto,
            publicacion_ml_existente: articulo.publicacion_ml,
        };

        // Verificar publicabilidad básica
        if (!articulo.activo) {
            return NextResponse.json({ ok: false, error: 'El artículo no está activo', trace }, { status: 422 });
        }
        if (articulo.es_obsoleto) {
            return NextResponse.json({ ok: false, error: 'El artículo está marcado como obsoleto', trace }, { status: 422 });
        }
        if (articulo.publicacion_ml) {
            trace.paso_1_articulo.advertencia = `Ya tiene publicacion_ml: ${articulo.publicacion_ml}. Continuando de todas formas (puede ser cuenta distinta).`;
        }

        // ── 2. Detectar modelo del seller ────────────────────────────────────
        const meli = new MeliAdapter();
        const sellerInfo = await (meli as any).detectSellerModel(marketplace_id);
        trace.paso_2_seller_model = sellerInfo;

        // ── 3. Obtener precio de marketplace_prices ───────────────────────────
        let precio_data: any = null;
        if (articulo.sku) {
            const { data: precio } = await supabaseAdmin
                .from('marketplace_prices')
                .select('sale_price, base_price, currency')
                .eq('sku', articulo.sku)
                .eq('marketplace_id', marketplace_id)
                .maybeSingle();
            precio_data = precio;
        }

        // Si no hay precio en marketplace_prices, intentar sin filtro de cuenta
        if (!precio_data && articulo.sku) {
            const { data: precioGeneral } = await supabaseAdmin
                .from('marketplace_prices')
                .select('sale_price, base_price, currency')
                .eq('sku', articulo.sku)
                .limit(1)
                .maybeSingle();
            precio_data = precioGeneral;
        }

        trace.paso_3_precio = precio_data
            ? { sale_price: precio_data.sale_price, base_price: precio_data.base_price, currency: precio_data.currency }
            : { advertencia: 'No se encontró precio en marketplace_prices. Se usará 0 — CORREGIR antes de publicar en producción.', sale_price: 0 };

        const price = precio_data?.sale_price || 0;

        // ── 4. Calcular stock disponible ──────────────────────────────────────
        let stock = 0;
        try {
            const { SKU_Service } = await import('@gestor/shared/sku-service');
            const identifier = articulo.sku || articulo.articulo_id;
            stock = await SKU_Service.calculateAvailableStock(identifier);
        } catch (stockErr: any) {
            trace.paso_4_stock = { advertencia: `No se pudo calcular stock: ${stockErr.message}. Se usará 1 para prueba.` };
            stock = 1; // mínimo para poder publicar en prueba
        }
        trace.paso_4_stock = { ...trace.paso_4_stock, available_quantity: stock };

        // ── 5. Predecir o usar categoría ──────────────────────────────────────
        let category_id = category_id_override;
        let category_info: any = null;

        if (!category_id) {
            const query = [articulo.nombre, articulo.marca, articulo.modelo].filter(Boolean).join(' ');
            category_info = await (meli as any).predictCategory(marketplace_id, query);
            category_id = category_info.category_id;
        }

        trace.paso_5_categoria = {
            category_id,
            category_name: category_info?.category_name || '(provisto manualmente)',
            domain_id: category_info?.domain_id || null,
            alternativas: category_info?.raw?.slice(0, 3).map((r: any) => ({
                category_id: r.category_id,
                domain_id: r.domain_id,
                category_name: r.category_name || r.domain_name,
            })) || [],
        };

        // ── 6. Obtener atributos requeridos de la categoría ───────────────────
        const attrInfo = await (meli as any).getCategoryAttributes(marketplace_id, category_id);
        trace.paso_6_atributos = {
            total: attrInfo.raw.length,
            required_ids: attrInfo.required.map((a: any) => a.id),
            parent_pk_ids: attrInfo.parent_pk.map((a: any) => a.id),
            child_pk_ids: attrInfo.child_pk.map((a: any) => a.id),
            required_detail: attrInfo.required.map((a: any) => ({
                id: a.id,
                name: a.name,
                type: a.value_type,
                values: a.values?.slice(0, 5).map((v: any) => ({ id: v.id, name: v.name })) || [],
            })),
        };

        // ── 7. Construir attributes[] a partir del artículo ───────────────────
        const attributes: Array<{ id: string; value_name?: string; value_id?: string }> = [];

        if (articulo.marca)            attributes.push({ id: 'BRAND',  value_name: articulo.marca });
        if (articulo.modelo)           attributes.push({ id: 'MODEL',  value_name: articulo.modelo });
        if (articulo.codigo_universal) attributes.push({ id: 'GTIN',   value_name: articulo.codigo_universal });
        if (articulo.sku)              attributes.push({ id: 'SELLER_SKU', value_name: articulo.sku });
        if (articulo.pais_origen)      attributes.push({ id: 'ORIGIN_COUNTRY', value_name: articulo.pais_origen });
        if (articulo.variante)         attributes.push({ id: 'COLOR',  value_name: articulo.variante }); // asume variante=color; ajustar según categoría

        // ITEM_CONDITION: 2230284 = Nuevo
        attributes.push({ id: 'ITEM_CONDITION', value_id: '2230284' });

        trace.paso_7_attributes = attributes;

        // Atributos requeridos que NO pudimos mapear automáticamente
        const mappedIds = new Set(attributes.map(a => a.id));
        trace.paso_7_atributos_faltantes = attrInfo.required
            .filter((a: any) => !mappedIds.has(a.id))
            .map((a: any) => ({ id: a.id, name: a.name }));

        // ── 8. Construir el body del POST /items ─────────────────────────────
        const family_name = [articulo.nombre, articulo.marca, articulo.modelo]
            .filter(Boolean).join(' ').slice(0, 120); // max_title_length típico de MeLi

        const itemBody: any = {
            family_name,
            category_id,
            price,
            currency_id: precio_data?.currency || 'MXN',
            available_quantity: Math.max(stock, 1), // al menos 1 para publicar
            buying_mode: 'buy_it_now',
            listing_type_id,
            sale_terms: [
                { id: 'WARRANTY_TYPE', value_name: 'Garantía del vendedor' },
                { id: 'WARRANTY_TIME', value_name: '1 mes' },
            ],
            pictures: pictures.map((url: string) => ({ source: url })),
            attributes,
        };

        // Dimensiones si están disponibles
        if (articulo.peso_kg || articulo.largo_cm) {
            itemBody.shipping = {
                dimensions: {
                    weight: articulo.peso_kg ? { value: articulo.peso_kg, unit: 'kg' } : undefined,
                    length: articulo.largo_cm ? { value: articulo.largo_cm, unit: 'cm' } : undefined,
                    width:  articulo.ancho_cm ? { value: articulo.ancho_cm, unit: 'cm' } : undefined,
                    height: articulo.alto_cm  ? { value: articulo.alto_cm,  unit: 'cm' } : undefined,
                }
            };
        }

        trace.paso_8_body = itemBody;
        trace.paso_8_advertencias = [];
        if (pictures.length === 0) trace.paso_8_advertencias.push('Sin imágenes — MeLi puede rechazar la publicación');
        if (price === 0)           trace.paso_8_advertencias.push('Precio = 0 — MeLi rechazará la publicación');
        if (trace.paso_7_atributos_faltantes.length > 0) {
            trace.paso_8_advertencias.push(
                `Atributos requeridos faltantes: ${trace.paso_7_atributos_faltantes.map((a: any) => a.id).join(', ')}`
            );
        }

        // ── 9. DRY RUN — retornar sin publicar ───────────────────────────────
        if (dry_run) {
            return NextResponse.json({
                ok: true,
                dry_run: true,
                mensaje: 'Simulación completada. Para publicar envía dry_run: false.',
                duracion_ms: Date.now() - startTime,
                trace,
            });
        }

        // ── 10. Publicar en MeLi ──────────────────────────────────────────────
        const created = await (meli as any).createItem(marketplace_id, itemBody);
        trace.paso_10_meli_create = {
            item_id:         created.item_id,
            user_product_id: created.user_product_id,
            family_id:       created.family_id,
            permalink:       created.permalink,
            title_generado:  created.title,
            status:          created.status,
        };
        trace.paso_10_meli_raw = created.raw; // respuesta completa para inspección

        // ── 11. Agregar descripción ───────────────────────────────────────────
        let descResult: any = null;
        if (articulo.descripcion) {
            descResult = await (meli as any).addDescription(marketplace_id, created.item_id, articulo.descripcion);
            trace.paso_11_descripcion = { ok: descResult.ok };
        } else {
            trace.paso_11_descripcion = { omitido: 'El artículo no tiene descripción' };
        }

        // ── 12. Guardar en BD: publicaciones_externas ─────────────────────────
        const { data: pubInserted, error: pubErr } = await supabaseAdmin
            .from('publicaciones_externas')
            .upsert({
                marketplace_id,
                external_item_id:     created.item_id,
                external_variation_id: '0',
                titulo:               created.title,
                precio_venta:         price,
                stock_publicado:      Math.max(stock, 1),
                status_externo:       created.status,
                permalink:            created.permalink,
                listing_type_id,
                category_id,
                tipo_publicacion:     'tradicional',
                es_fuente_stock:      true,
                actualizado_el:       new Date().toISOString(),
                // Campos del nuevo modelo UP
                ...(created.user_product_id ? { seller_sku: articulo.sku || null } : {}),
            }, { onConflict: 'marketplace_id,external_item_id,external_variation_id' })
            .select('id')
            .single();

        trace.paso_12_publicaciones_externas = pubErr
            ? { error: pubErr.message }
            : { publicacion_id: pubInserted?.id };

        // ── 13. Guardar en BD: mapeo_publicacion_articulo ─────────────────────
        if (pubInserted?.id) {
            const { error: mapErr } = await supabaseAdmin
                .from('mapeo_publicacion_articulo')
                .upsert({
                    publicacion_id:    pubInserted.id,
                    articulo_id:       articulo_id,
                    cantidad_requerida: 1,
                }, { onConflict: 'publicacion_id,articulo_id' });

            trace.paso_13_mapeo = mapErr ? { error: mapErr.message } : { ok: true };

            // ── 14. Actualizar articulos.publicacion_ml ───────────────────────
            const { error: artUpdateErr } = await supabaseAdmin
                .from('articulos')
                .update({ publicacion_ml: created.item_id })
                .eq('articulo_id', articulo_id);

            trace.paso_14_articulo_update = artUpdateErr
                ? { error: artUpdateErr.message }
                : { publicacion_ml: created.item_id };
        }

        // ── Respuesta final ───────────────────────────────────────────────────
        return NextResponse.json({
            ok: true,
            item_id:         created.item_id,
            user_product_id: created.user_product_id,
            permalink:       created.permalink,
            title:           created.title,
            seller_model:    sellerInfo.model,
            duracion_ms:     Date.now() - startTime,
            trace,
        });

    } catch (err: any) {
        return NextResponse.json({
            ok: false,
            error: err.message,
            duracion_ms: Date.now() - startTime,
            trace,
        }, { status: 500 });
    }
}
