/**
 * Motor de sugerencias de vinculación (vitrina/catálogo ↔ catálogo maestro).
 *
 * Centraliza el matching que antes vivía disperso en mapping-modal.tsx (cliente)
 * y en el pipeline de listas de precios (fn_match_precios_v2), replicando el
 * mismo orden de "olas" de confianza:
 *
 *   1. Hermana ya mapeada (mismo producto de catálogo)  → 98
 *   2. Alias aprendido (proveedor_articulos_alias)      → 97
 *   3. SKU exacto (seller_sku / seller_custom_field)    → 100
 *   4. Código de barras exacto (ean/gtin/upc)           → 100
 *   5. Marca + modelo exactos                           → 95
 *   6. Fuzzy (Dice bigram sobre título / marca+modelo)  → 40..90
 *
 * Solo se importa desde API routes (server-side): usa la service-role key.
 */
import { supabaseAdmin } from '@/lib/supabase';

export interface Sugerencia {
  articulo_id: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  variante: string | null;
  codigo_universal: string | null;
  caja_madre: string | null;
  score: number; // 0..100
  metodo: string; // 'hermana_mapeada' | 'alias' | 'sku_exacto' | 'codigo_exacto' | 'marca_modelo' | 'fuzzy'
  motivo: string; // texto legible para el operador
}

export interface PublicacionSugerible {
  id: string;
  external_item_id: string | null;
  seller_sku: string | null;
  seller_custom_field: string | null;
  ean: string | null;
  gtin: string | null;
  upc: string | null;
  model: string | null;
  brand: string | null;
  titulo: string | null;
  marketplace_id: string | null;
  id_producto_catalogo: string | null;
  par_item_id: string | null;
  tipo_publicacion: string | null;
}

const ARTICULO_COLS = 'articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre';

export function norm(s?: string | null): string {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeCode(s?: string | null): string {
  return (s || '').replace(/[^0-9a-z]/gi, '').toLowerCase();
}

/** True si la ubicación física es de devoluciones (no debe sugerirse). */
export function esDevolucion(cajaMadre: string | null | undefined): boolean {
  if (!cajaMadre) return false;
  const n = cajaMadre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return n.includes('devolucion');
}

/** Coeficiente de Dice sobre bigramas (igual que mapping-modal). */
export function stringSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  const al = a.toLowerCase().trim();
  const bl = b.toLowerCase().trim();
  if (al === bl) return 1;
  if (al.length < 2 || bl.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < al.length - 1; i++) {
    const bi = al.substring(i, i + 2);
    bigrams.set(bi, (bigrams.get(bi) || 0) + 1);
  }
  let intersect = 0;
  for (let i = 0; i < bl.length - 1; i++) {
    const bi = bl.substring(i, i + 2);
    const count = bigrams.get(bi) || 0;
    if (count > 0) {
      bigrams.set(bi, count - 1);
      intersect++;
    }
  }
  return (2 * intersect) / (al.length - 1 + (bl.length - 1));
}

export function scoreLabel(score: number): 'alta' | 'media' | 'baja' {
  if (score >= 98) return 'alta';
  if (score >= 60) return 'media';
  return 'baja';
}

function toSugerencia(
  a: any,
  score: number,
  metodo: string,
  motivo: string,
): Sugerencia {
  return {
    articulo_id: a.articulo_id,
    nombre: a.nombre ?? '',
    marca: a.marca ?? null,
    modelo: a.modelo ?? null,
    variante: a.variante ?? null,
    codigo_universal: a.codigo_universal ?? null,
    caja_madre: a.caja_madre ?? null,
    score: Math.max(0, Math.min(100, Math.round(score))),
    metodo,
    motivo,
  };
}

/** Busca artículos ya mapeados en publicaciones "hermanas" (mismo producto de catálogo). */
async function sugerirPorHermana(pub: PublicacionSugerible): Promise<Sugerencia[]> {
  const catalogKey = pub.id_producto_catalogo || pub.par_item_id;
  if (!catalogKey) return [];

  const { data: hermanas } = await supabaseAdmin
    .from('publicaciones_externas')
    .select('id, mapeo_publicacion_articulo(articulo_id)')
    .eq('external_variation_id', '0')
    .or(`id_producto_catalogo.eq.${catalogKey},par_item_id.eq.${catalogKey}`)
    .neq('id', pub.id)
    .limit(20);

  const articulosIds = new Set<string>();
  for (const h of hermanas || []) {
    const mapeos = Array.isArray(h.mapeo_publicacion_articulo)
      ? h.mapeo_publicacion_articulo
      : h.mapeo_publicacion_articulo
        ? [h.mapeo_publicacion_articulo]
        : [];
    for (const m of mapeos) {
      if (m?.articulo_id) articulosIds.add(m.articulo_id);
    }
  }

  if (articulosIds.size === 0) return [];

  const { data: arts } = await supabaseAdmin
    .from('articulos')
    .select(ARTICULO_COLS)
    .in('articulo_id', Array.from(articulosIds))
    .limit(10);

  return (arts || []).map((a) =>
    toSugerencia(a, 98, 'hermana_mapeada', 'Misma catalogación ya vinculada en otra publicación'),
  );
}

/** Busca en el diccionario de alias aprendido por el operador (listas de precios). */
async function sugerirPorAlias(pub: PublicacionSugerible): Promise<Sugerencia[]> {
  const codigos = [
    normalizeCode(pub.seller_sku),
    normalizeCode(pub.seller_custom_field),
    normalizeCode(pub.ean),
    normalizeCode(pub.gtin),
    normalizeCode(pub.upc),
  ].filter(Boolean);

  const { data: alias } = await supabaseAdmin
    .from('proveedor_articulos_alias')
    .select('articulo_id')
    .in('codigo_excel', codigos.length ? codigos : ['__none__'])
    .eq('estado_proveedor', 'activo')
    .limit(5);

  if (!alias || alias.length === 0) return [];

  const ids = Array.from(new Set((alias as any[]).map((x) => x.articulo_id).filter(Boolean)));
  const { data: arts } = await supabaseAdmin
    .from('articulos')
    .select(ARTICULO_COLS)
    .in('articulo_id', ids.length ? ids : ['__none__'])
    .limit(5);

  return (arts || []).map((a) =>
    toSugerencia(a, 97, 'alias', 'Alias confirmado previamente en listas de precios'),
  );
}

/** Coincidencia exacta por SKU, código de barras o marca+modelo. */
async function sugerirExacto(pub: PublicacionSugerible): Promise<Sugerencia[]> {
  const out: Sugerencia[] = [];
  const seen = new Set<string>();

  const push = (a: any, score: number, metodo: string, motivo: string) => {
    if (!a || seen.has(a.articulo_id)) return;
    seen.add(a.articulo_id);
    out.push(toSugerencia(a, score, metodo, motivo));
  };

  // 3. SKU exacto
  const skus = [norm(pub.seller_sku), norm(pub.seller_custom_field)].filter(Boolean);
  if (skus.length) {
    const parts = skus.flatMap((s) => [`articulo_id.eq.${s}`, `modelo.eq.${s}`]);
    const { data } = await supabaseAdmin
      .from('articulos')
      .select(ARTICULO_COLS)
      .not('nombre', 'like', '%PLACEHOLDER%')
      .or(parts.join(','))
      .limit(10);
    for (const a of data || []) push(a, 100, 'sku_exacto', 'SKU coincide exactamente');
  }

  // 4. Código de barras exacto
  const codigos = [normalizeCode(pub.ean), normalizeCode(pub.gtin), normalizeCode(pub.upc)].filter(Boolean);
  if (codigos.length) {
    const parts = codigos.map((c) => `codigo_universal.eq.${c}`);
    const { data } = await supabaseAdmin
      .from('articulos')
      .select(ARTICULO_COLS)
      .not('nombre', 'like', '%PLACEHOLDER%')
      .or(parts.join(','))
      .limit(10);
    for (const a of data || []) push(a, 100, 'codigo_exacto', 'Código de barras coincide exactamente');
  }

  // 5. Marca + modelo exactos
  if (norm(pub.model) && norm(pub.brand)) {
    const { data } = await supabaseAdmin
      .from('articulos')
      .select(ARTICULO_COLS)
      .not('nombre', 'like', '%PLACEHOLDER%')
      .eq('modelo', pub.model)
      .limit(30);
    const matches = (data || []).filter((a) => norm(a.marca) === norm(pub.brand));
    for (const a of matches) push(a, 95, 'marca_modelo', 'Marca y modelo coinciden exactamente');
  }

  return out;
}

/** Coincidencia difusa por tokens del título + marca/modelo. */
async function sugerirFuzzy(pub: PublicacionSugerible): Promise<Sugerencia[]> {
  const brand = norm(pub.brand);
  const model = norm(pub.model);
  const title = norm(pub.titulo);

  const orParts: string[] = [];
  if (model) orParts.push(`modelo.ilike.%${model}%`, `articulo_id.ilike.%${model}%`);
  if (brand) orParts.push(`marca.ilike.%${brand}%`);

  // Tokens del título (igual que mapping-modal)
  if (title && (orParts.length === 0 || true)) {
    const stop = new Set([
      'de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'por', 'y', 'a', 'un', 'una',
      'cuadro', 'puntas', 'punta', 'pulg', 'pza', 'pzs', 'pieza', 'piezas', 'uso', 'pesado',
    ]);
    const tokens = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t))
      .slice(0, 3);
    for (const t of tokens) orParts.push(`nombre.ilike.%${t}%`);
  }

  if (orParts.length === 0) return [];

  const { data } = await supabaseAdmin
    .from('articulos')
    .select(ARTICULO_COLS)
    .not('nombre', 'like', '%PLACEHOLDER%')
    .or(orParts.join(','))
    .limit(30);

  const scored = (data || []).map((a) => {
    let score = 0;
    const iMod = norm(a.modelo);
    const iCod = normalizeCode(a.codigo_universal);
    const iMarca = norm(a.marca);
    const iName = norm(a.nombre);

    if (model && (iMod === model || norm(a.articulo_id) === model)) score += 4;
    else if (model && (iMod.includes(model) || norm(a.articulo_id).includes(model))) score += 2;
    if (brand && iMarca === brand) score += 3;
    else if (brand && (iMarca.includes(brand) || brand.includes(iMarca))) score += 1;
    score += stringSimilarity(title, iName) * 40;
    if (title) score += stringSimilarity(title, `${iMarca} ${iMod}`) * 20;
    return { a, score };
  });

  scored.sort((x, y) => y.score - x.score);
  return scored
    .filter((s) => s.score >= 30)
    .slice(0, 5)
    .map((s) => toSugerencia(s.a, Math.round(s.score), 'fuzzy', 'Similitud de texto'));
}

/**
 * Devuelve las sugerencias ordenadas por confianza (deduplicadas), priorizando
 * las señales fuertes sobre las difusas.
 */
export async function sugerirArticulos(pub: PublicacionSugerible): Promise<Sugerencia[]> {
  const [porHermana, porAlias, exacto, fuzzy] = await Promise.all([
    sugerirPorHermana(pub).catch(() => [] as Sugerencia[]),
    sugerirPorAlias(pub).catch(() => [] as Sugerencia[]),
    sugerirExacto(pub).catch(() => [] as Sugerencia[]),
    sugerirFuzzy(pub).catch(() => [] as Sugerencia[]),
  ]);

  const map = new Map<string, Sugerencia>();
  for (const s of [...porHermana, ...exacto, ...porAlias, ...fuzzy]) {
    const prev = map.get(s.articulo_id);
    if (!prev || s.score > prev.score) map.set(s.articulo_id, s);
  }

  return Array.from(map.values())
    .filter((s) => !esDevolucion(s.caja_madre))
    .sort((a, b) => b.score - a.score);
}

export interface ArticuloSugerible {
  articulo_id: string;
  nombre: string;
  marca: string | null;
  modelo: string | null;
  codigo_universal: string | null;
}

export interface PublicacionSugerida {
  id: string;
  external_item_id: string | null;
  titulo: string | null;
  brand: string | null;
  model: string | null;
  seller_sku: string | null;
  precio_venta: number | null;
  ean: string | null;
  gtin: string | null;
  upc: string | null;
  tipo_publicacion: string | null;
  variation_attributes: any | null;
  score: number; // 0..100
  metodo: string; // 'sku_exacto' | 'codigo_exacto' | 'marca_modelo' | 'alias' | 'fuzzy'
  motivo: string;
}

const PUB_COLS =
  'id, external_item_id, titulo, brand, model, seller_sku, precio_venta, ean, gtin, upc, tipo_publicacion, variation_attributes';

/** True si el tipo de publicación es "tradicional" (prioridad del operador). */
function esTradicional(tipo: string | null | undefined): boolean {
  return tipo === 'tradicional' || tipo === 'tradicional_derivada';
}

/** Filtro base de publicaciones candidatas: sin mapear, sin kits, sin variaciones, sin catálogo-hermana. */
function publicacionesCandidatas(matchParts: string[], limit: number) {
  return supabaseAdmin
    .from('publicaciones_externas')
    .select(PUB_COLS)
    .or(
      `and(or(esta_mapeado.is.null,esta_mapeado.eq.false),not.and(tipo_publicacion.eq.catalogo,par_item_id.not.is.null),or(${matchParts.join(',')}))`,
    )
    .not('es_bundle', 'is', true)
    .not('tags', 'cs', '{bundle}')
    .eq('external_variation_id', '0')
    .limit(limit);
}

/**
 * Motor INVERSO de vinculación: dado un artículo del catálogo maestro, sugiere
 * publicaciones (vidrieras) sin mapear que coinciden. Refleja el mismo orden de
 * "olas" de confianza que `sugerirArticulos`, en sentido catálogo → vidriera:
 *
 *   1. SKU exacto (seller_sku / seller_custom_field)          → 100
 *   2. Código de barras exacto (ean/gtin/upc)                 → 100
 *   3. Marca + modelo exactos                                 → 95 (solo modelo → 80)
 *   4. Alias aprendido (proveedor_articulos_alias)            → 97
 *   5. Fuzzy (Dice bigram sobre título)                       → 40..90
 */
export async function sugerirPublicaciones(art: ArticuloSugerible): Promise<PublicacionSugerida[]> {
  const seen = new Set<string>();
  const out: PublicacionSugerida[] = [];

  const push = (p: any, score: number, metodo: string, motivo: string) => {
    if (!p || seen.has(p.id)) return;
    seen.add(p.id);
    out.push({
      id: p.id,
      external_item_id: p.external_item_id ?? null,
      titulo: p.titulo ?? null,
      brand: p.brand ?? null,
      model: p.model ?? null,
      seller_sku: p.seller_sku ?? null,
      precio_venta: p.precio_venta ?? null,
      ean: p.ean ?? null,
      gtin: p.gtin ?? null,
      upc: p.upc ?? null,
      tipo_publicacion: p.tipo_publicacion ?? null,
      variation_attributes: p.variation_attributes ?? null,
      score: Math.max(0, Math.min(100, Math.round(score))),
      metodo,
      motivo,
    });
  };

  const skus = [norm(art.articulo_id), norm(art.modelo)].filter(Boolean);
  const codigo = normalizeCode(art.codigo_universal);
  const modelo = norm(art.modelo);
  const marca = norm(art.marca);

  // 1. SKU exacto
  if (skus.length) {
    const parts = skus.flatMap((s) => [`seller_sku.eq.${s}`, `seller_custom_field.eq.${s}`]);
    const { data } = await publicacionesCandidatas(parts, 20);
    for (const p of data || []) push(p, 100, 'sku_exacto', 'SKU coincide exactamente');
  }

  // 2. Código de barras exacto
  if (codigo) {
    const parts = [`ean.eq.${codigo}`, `gtin.eq.${codigo}`, `upc.eq.${codigo}`];
    const { data } = await publicacionesCandidatas(parts, 20);
    for (const p of data || []) push(p, 100, 'codigo_exacto', 'Código de barras coincide exactamente');
  }

  // 3. Marca + modelo exactos (o solo modelo)
  if (modelo) {
    const { data } = await supabaseAdmin
      .from('publicaciones_externas')
      .select(PUB_COLS)
      .eq('external_variation_id', '0')
      .eq('model', art.modelo)
      .limit(30);
    for (const p of data || []) {
      if (marca && norm(p.brand) === marca) push(p, 95, 'marca_modelo', 'Marca y modelo coinciden exactamente');
      else if (!marca) push(p, 80, 'marca_modelo', 'Modelo coincide exactamente');
    }
  }

  // 4. Alias aprendido por el operador
  if (art.articulo_id) {
    const { data: alias } = await supabaseAdmin
      .from('proveedor_articulos_alias')
      .select('codigo_excel')
      .eq('articulo_id', art.articulo_id)
      .eq('estado_proveedor', 'activo')
      .limit(20);
    const cods = Array.from(new Set((alias || []).map((a: any) => normalizeCode(a.codigo_excel)).filter(Boolean)));
    if (cods.length) {
      const parts = cods.flatMap((c) => [
        `seller_sku.eq.${c}`,
        `seller_custom_field.eq.${c}`,
        `ean.eq.${c}`,
        `gtin.eq.${c}`,
        `upc.eq.${c}`,
      ]);
      const { data } = await publicacionesCandidatas(parts, 20);
      for (const p of data || []) push(p, 97, 'alias', 'Alias confirmado previamente en listas de precios');
    }
  }

  // 5. Fuzzy por tokens del título
  const title = norm(art.nombre);
  if (title) {
    const stop = new Set([
      'de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'por', 'y', 'a', 'un', 'una',
      'cuadro', 'puntas', 'punta', 'pulg', 'pza', 'pzs', 'pieza', 'piezas', 'uso', 'pesado',
    ]);
    const tokens = title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t))
      .slice(0, 3);
    if (tokens.length) {
      const parts = tokens.map((t) => `titulo.ilike.%${t}%`);
      const { data } = await supabaseAdmin
        .from('publicaciones_externas')
        .select(PUB_COLS)
        .eq('external_variation_id', '0')
        .not('es_bundle', 'is', true)
        .not('tags', 'cs', '{bundle}')
        .or(parts.join(','))
        .limit(30);
      const scored = (data || []).map((p) => {
        let score = 0;
        if (modelo && (norm(p.model) === modelo || norm(p.seller_sku) === modelo)) score += 4;
        if (marca && norm(p.brand) === marca) score += 3;
        score += stringSimilarity(title, norm(p.titulo)) * 40;
        return { p, score };
      });
      scored.sort((x, y) => y.score - x.score);
      for (const s of scored.filter((s) => s.score >= 30).slice(0, 5)) {
        push(s.p, s.score, 'fuzzy', 'Similitud de texto');
      }
    }
  }

  // Deduplicar (la señal más fuerte gana). Luego: tradicionales primero, y dentro de
  // cada grupo por confianza. El operador prefiere vincular publicaciones tradicionales.
  const map = new Map<string, PublicacionSugerida>();
  for (const p of out) {
    const prev = map.get(p.id);
    if (!prev || p.score > prev.score) map.set(p.id, p);
  }
  return Array.from(map.values()).sort((a, b) => {
    const ta = esTradicional(a.tipo_publicacion) ? 1 : 0;
    const tb = esTradicional(b.tipo_publicacion) ? 1 : 0;
    if (ta !== tb) return tb - ta;
    return b.score - a.score;
  });
}

/**
 * Sugerencia "rápida" en lote para una cola de trabajo: solo señales fuertes
 * (hermana mapeada, SKU/código exacto, marca+modelo), sin fuzzy. Permite el
 * "aceptar todas" con alta confianza sin disparar decenas de queries difusas.
 */
export async function sugerirExactoEnLote(
  pubs: PublicacionSugerible[],
): Promise<Map<string, Sugerencia | null>> {
  const result = new Map<string, Sugerencia | null>();

  // 1. Hermanas mapeadas (consulta por producto de catálogo y por par_item_id)
  const catalogKeys = pubs.map((p) => p.id_producto_catalogo).filter(Boolean);
  const parKeys = pubs.map((p) => p.par_item_id).filter(Boolean);
  const mapeosPorPub = new Map<string, Set<string>>();
  if (catalogKeys.length || parKeys.length) {
    const hermanas: any[] = [];
    if (catalogKeys.length) {
      const { data } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('id_producto_catalogo, par_item_id, mapeo_publicacion_articulo(articulo_id)')
        .in('id_producto_catalogo', catalogKeys)
        .limit(1000);
      hermanas.push(...(data || []));
    }
    if (parKeys.length) {
      const { data } = await supabaseAdmin
        .from('publicaciones_externas')
        .select('id_producto_catalogo, par_item_id, mapeo_publicacion_articulo(articulo_id)')
        .in('par_item_id', parKeys)
        .limit(1000);
      hermanas.push(...(data || []));
    }
    for (const h of hermanas) {
      const key = h.id_producto_catalogo || h.par_item_id;
      const arts = (Array.isArray(h.mapeo_publicacion_articulo)
        ? h.mapeo_publicacion_articulo
        : h.mapeo_publicacion_articulo
          ? [h.mapeo_publicacion_articulo]
          : []
      ).map((m: any) => m?.articulo_id).filter(Boolean);
      if (!mapeosPorPub.has(key)) mapeosPorPub.set(key, new Set());
      for (const a of arts) mapeosPorPub.get(key)!.add(a);
    }
  }

  // 2. Candidatos exactos por SKU/código/modelo (queries por lote)
  const allSkus = new Set<string>();
  const allCodigos = new Set<string>();
  const allModelos = new Set<string>();
  for (const p of pubs) {
    for (const s of [norm(p.seller_sku), norm(p.seller_custom_field)]) if (s) allSkus.add(s);
    for (const c of [normalizeCode(p.ean), normalizeCode(p.gtin), normalizeCode(p.upc)]) if (c) allCodigos.add(c);
    if (norm(p.model)) allModelos.add(norm(p.model));
  }

  const skuArts = new Map<string, any>();
  const codigoArts = new Map<string, any>();
  const modeloArts = new Map<string, any>();

  if (allSkus.size) {
    const parts = Array.from(allSkus).flatMap((s) => [`articulo_id.eq.${s}`, `modelo.eq.${s}`]);
    const { data } = await supabaseAdmin
      .from('articulos')
      .select(ARTICULO_COLS)
      .not('nombre', 'like', '%PLACEHOLDER%')
      .or(parts.join(','))
      .limit(1000);
    for (const a of data || []) {
      if (allSkus.has(norm(a.articulo_id))) skuArts.set(norm(a.articulo_id), a);
      if (allSkus.has(norm(a.modelo))) skuArts.set(norm(a.modelo), a);
    }
  }
  if (allCodigos.size) {
    const parts = Array.from(allCodigos).map((c) => `codigo_universal.eq.${c}`);
    const { data } = await supabaseAdmin
      .from('articulos')
      .select(ARTICULO_COLS)
      .not('nombre', 'like', '%PLACEHOLDER%')
      .or(parts.join(','))
      .limit(1000);
    for (const a of data || []) codigoArts.set(normalizeCode(a.codigo_universal), a);
  }
  if (allModelos.size) {
    const parts = Array.from(allModelos).map((m) => `modelo.eq.${m}`);
    const { data } = await supabaseAdmin
      .from('articulos')
      .select(ARTICULO_COLS)
      .not('nombre', 'like', '%PLACEHOLDER%')
      .or(parts.join(','))
      .limit(1000);
    for (const a of data || []) modeloArts.set(norm(a.modelo), a);
  }

  for (const p of pubs) {
    const key = p.id_producto_catalogo || p.par_item_id;
    const heredadas = key ? mapeosPorPub.get(key) : undefined;
    const heredada = heredadas && heredadas.size ? Array.from(heredadas)[0] : null;

    let best: Sugerencia | null = null;
    if (heredada) {
      // resuelve el artículo heredado
      const { data } = await supabaseAdmin
        .from('articulos')
        .select(ARTICULO_COLS)
        .eq('articulo_id', heredada)
        .limit(1);
      if (data && data[0]) best = toSugerencia(data[0], 98, 'hermana_mapeada', 'Misma catalogación ya vinculada');
    }

    if (!best) {
      const sku = norm(p.seller_sku) || norm(p.seller_custom_field);
      if (sku && skuArts.has(sku)) best = toSugerencia(skuArts.get(sku), 100, 'sku_exacto', 'SKU coincide exactamente');
    }
    if (!best) {
      const c = [normalizeCode(p.ean), normalizeCode(p.gtin), normalizeCode(p.upc)].find((x) => x && codigoArts.has(x));
      if (c) best = toSugerencia(codigoArts.get(c)!, 100, 'codigo_exacto', 'Código de barras coincide exactamente');
    }
    if (!best) {
      const m = norm(p.model);
      if (m && modeloArts.has(m)) {
        const a = modeloArts.get(m);
        if (norm(p.brand) && norm(a.marca) === norm(p.brand)) {
          best = toSugerencia(a, 95, 'marca_modelo', 'Marca y modelo coinciden exactamente');
        } else if (!norm(p.brand)) {
          best = toSugerencia(a, 80, 'marca_modelo', 'Modelo coincide exactamente');
        }
      }
    }

    if (best && esDevolucion(best.caja_madre)) best = null;

    result.set(p.id, best);
  }

  return result;
}
