"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { X, Search, Package, Save, RefreshCw, Plus, Trash2, Tag, Barcode, Info } from 'lucide-react';
import SugerenciaComparacion from './sugerencia-comparacion';
interface MappingModalProps {
listing: any;
onClose: () => void;
onSuccess: () => void;
sugerenciaInicial?: any;
}
function stringSimilarity(a: string, b: string): number {
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
if (count > 0) { bigrams.set(bi, count - 1); intersect++; }
}
return (2 * intersect) / ((al.length - 1) + (bl.length - 1));
}
function esDevolucion(cajaMadre: string | null | undefined): boolean {
if (!cajaMadre) return false;
const n = cajaMadre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
return n.includes('devolucion');
}
export default function MappingModal({ listing, onClose, onSuccess, sugerenciaInicial }: MappingModalProps) {
const [searchTerm, setSearchTerm] = useState('');
const [searchResults, setSearchResults] = useState<any[]>([]);
const [selectedSkus, setSelectedSkus] = useState<any[]>(() => {
if (sugerenciaInicial?.articulo_id) {
return [{
sku: sugerenciaInicial.articulo_id,
name: sugerenciaInicial.nombre || 'Sin nombre',
marca: sugerenciaInicial.marca || '',
modelo: sugerenciaInicial.modelo || '',
variante: '',
codigo_universal: sugerenciaInicial.codigo_universal || '',
caja_madre: sugerenciaInicial.caja_madre || '',
quantity: 1
}];
}
return [];
});
const [loading, setLoading] = useState(false);
const [saving, setSaving] = useState(false);
const [smartSuggestions, setSmartSuggestions] = useState<any[]>([]);
const [suggestionsLoading, setSuggestionsLoading] = useState(false);
const [siblings, setSiblings] = useState<any[]>([]);
const [siblingsLoading, setSiblingsLoading] = useState(false);
const [costMap, setCostMap] = useState<Map<string, boolean>>(new Map());
const [topSugerencia, setTopSugerencia] = useState<any>(null);
const pubSku = listing?.seller_custom_field || listing?.seller_sku || '';
const pubEan = listing?.ean || '';
const pubGtin = listing?.gtin || '';
const pubUpc = listing?.upc || '';
const pubModel = listing?.model || '';
const pubBrand = listing?.brand || '';
const pubTitle = listing?.titulo || '';
const isBlockedCatalog = listing?.tipo_publicacion === 'catalogo' && !!listing?.par_item_id;
useEffect(() => {
if (listing && !isBlockedCatalog) {
loadExistingMappings();
loadSmartSuggestions();
loadSiblings();
}
}, [listing]);

// Sugerencia automática server-side (motor de vinculación centralizado)
useEffect(() => {
if (!listing?.id || isBlockedCatalog) return;
let cancelled = false;
fetch(`/api/vinculacion/sugerencias?publicacion_id=${listing.id}`)
.then((r) => r.json())
.then((d) => {
if (cancelled || !d?.ok) return;
const top = d.sugerencias?.[0];
if (top && top.score >= 80) setTopSugerencia(top);
})
.catch(() => {});
return () => { cancelled = true; };
}, [listing?.id]);
async function loadExistingMappings() {
setLoading(true);
try {
const { data, error } = await supabase
.from('mapeo_publicacion_articulo')
.select(`
id,
cantidad_requerida,
articulo_id,
articulos (nombre, articulo_id, marca, modelo, variante, codigo_universal, caja_madre)
`)
.eq('publicacion_id', listing.id);
if (error) throw error;
if (data) {
const mapped = data.map((d: any) => ({
mapping_id: d.id,
sku: d.articulo_id,
name: d.articulos?.nombre || 'Producto Desconocido',
marca: d.articulos?.marca || '',
modelo: d.articulos?.modelo || '',
variante: d.articulos?.variante || '',
codigo_universal: d.articulos?.codigo_universal || '',
caja_madre: d.articulos?.caja_madre || '',
quantity: d.cantidad_requerida
}));
if (mapped.length > 0 || !sugerenciaInicial) setSelectedSkus(mapped);
}
} catch (error) {
console.error('Error cargando mapeos previos:', error);
} finally {
setLoading(false);
}
}
async function loadSmartSuggestions() {
setSuggestionsLoading(true);
try {
const allSkus = [listing?.seller_custom_field, listing?.seller_sku].filter(Boolean);
const allGtins = [listing?.gtin, listing?.ean, listing?.upc].filter(Boolean);
const allModels = [listing?.model].filter(Boolean);
const brand = listing?.brand || '';
const title = listing?.titulo || '';
const { data: varData } = await supabase
.from('publicaciones_externas')
.select('seller_sku, model, gtin, ean, upc')
.eq('external_item_id', listing.external_item_id)
.neq('external_variation_id', '0');
const varSkus = (varData || []).map((v: any) => v.seller_sku).filter(Boolean);
const varGtins = (varData || []).flatMap((v: any) => [v.gtin, v.ean, v.upc]).filter(Boolean);
const varModels = (varData || []).map((v: any) => v.model).filter(Boolean);
const combinedSkus = [...new Set([...allSkus, ...varSkus])];
const combinedGtins = [...new Set([...allGtins, ...varGtins])];
const combinedModels = [...new Set([...allModels, ...varModels])];
const exactParts: string[] = [];
for (const s of combinedSkus) {
exactParts.push(`articulo_id.eq.${s}`);
exactParts.push(`modelo.eq.${s}`);
const sNorm = s.replace(/\s+/g, '');
if (sNorm !== s) {
exactParts.push(`articulo_id.eq.${sNorm}`);
exactParts.push(`modelo.eq.${sNorm}`);
}
}
for (const m of combinedModels) {
exactParts.push(`modelo.eq.${m}`);
exactParts.push(`articulo_id.eq.${m}`);
const mNorm = m.replace(/\s+/g, '');
if (mNorm !== m) {
exactParts.push(`modelo.eq.${mNorm}`);
exactParts.push(`articulo_id.eq.${mNorm}`);
}
}
for (const g of combinedGtins) {
exactParts.push(`codigo_universal.eq.${g}`);
}
let exactResults: any[] = [];
if (exactParts.length > 0) {
const { data } = await supabase
.from('articulos')
.select('articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre')
.not('nombre', 'like', '%PLACEHOLDER%')
.or(exactParts.join(','))
.limit(20);
exactResults = data || [];
}
const partialParts: string[] = [];
for (const s of combinedSkus) {
partialParts.push(`articulo_id.ilike.%${s}%`);
partialParts.push(`modelo.ilike.%${s}%`);
partialParts.push(`codigo_universal.ilike.%${s}%`);
}
for (const m of combinedModels) {
partialParts.push(`modelo.ilike.%${m}%`);
partialParts.push(`articulo_id.ilike.%${m}%`);
}
for (const g of combinedGtins) {
partialParts.push(`codigo_universal.ilike.%${g}%`);
}
let partialResults: any[] = [];
if (partialParts.length > 0) {
const { data } = await supabase
.from('articulos')
.select('articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre')
.not('nombre', 'like', '%PLACEHOLDER%')
.or(partialParts.join(','))
.limit(30);
partialResults = data || [];
}
let brandResults: any[] = [];
if (brand) {
const { data } = await supabase
.from('articulos')
.select('articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre')
.not('nombre', 'like', '%PLACEHOLDER%')
.ilike('marca', `%${brand}%`)
.limit(20);
brandResults = data || [];
}
// === CAPA 4 (NUEVO): fallback por titulo tokenizado ===
// Cuando la publicacion no tiene sku/modelo/gtin/marca, el buscador de
// sugerencias quedaba vacio. Derivamos keywords limpias del titulo para
// mantener la busqueda util. Se ejecuta solo si las capas previas no dieron nada.
let titleResults: any[] = [];
const noStructuredData = combinedSkus.length === 0 && combinedModels.length === 0 && combinedGtins.length === 0 && !brand;
const hadResults = exactResults.length > 0 || partialResults.length > 0 || brandResults.length > 0;
if (title && (noStructuredData || !hadResults)) {
const stop = new Set(['de','del','la','el','los','las','para','con','por','y','a','un','una','cuadro','puntas','punta','pulg','pza','pzs','pieza','piezas','uso','pesado']);
const tokens = title
.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
.toLowerCase()
.replace(/[^\p{L}\p{N}\s]/gu, ' ')
.split(/\s+/)
.filter((t: string) => t.length >= 3 && !stop.has(t) && !/^\d+$/.test(t))
.slice(0, 3);
if (tokens.length > 0) {
const titleParts = tokens.map((t: string) => `nombre.ilike.%${t}%`);
const { data } = await supabase
.from('articulos')
.select('articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre')
.not('nombre', 'like', '%PLACEHOLDER%')
.or(titleParts.join(','))
.limit(30);
titleResults = data || [];
}
}
const mergedMap = new Map<string, any>();
for (const item of [...exactResults, ...partialResults, ...brandResults, ...titleResults]) {
if (!mergedMap.has(item.articulo_id)) {
mergedMap.set(item.articulo_id, item);
}
}
const allItems = Array.from(mergedMap.values());
if (allItems.length > 0) {
const scored = allItems.map(item => {
let score = 0;
const iId = (item.articulo_id || '').toLowerCase();
const iMod = (item.modelo || '').toLowerCase();
const iCod = (item.codigo_universal || '').toLowerCase();
const iMarca = (item.marca || '').toLowerCase();
for (const s of combinedSkus) {
const sl = s.toLowerCase();
if (iId === sl || iMod === sl) { score += 5; break; }
if (iId.includes(sl) || iMod.includes(sl)) { score += 3; break; }
}
for (const m of combinedModels) {
const ml = m.toLowerCase();
if (iMod === ml) { score += 4; break; }
if (iMod.includes(ml) || iId.includes(ml)) { score += 2; break; }
}
for (const g of combinedGtins) {
const gl = g.toLowerCase().replace(/^0+/, '');
const iCodClean = iCod.replace(/^0+/, '');
if (iCodClean === gl || iCod === g.toLowerCase()) { score += 3; break; }
if (iCodClean.includes(gl) || gl.includes(iCodClean)) { score += 2; break; }
}
if (brand && iMarca === brand.toLowerCase()) score += 1;
score += stringSimilarity(title, item.nombre || '') * 0.5;
return { ...item, _score: score };
});
scored.sort((a, b) => b._score - a._score);
// Umbral relajado cuando no hay datos estructurados: apoyarse en similitud de nombre.
const minScore = noStructuredData ? 0.15 : 0.5;
const finalScored = scored.filter(s => s._score > minScore && !esDevolucion(s.caja_madre));
setSmartSuggestions(finalScored);
const artIds = finalScored.map((s: any) => s.articulo_id);
if (artIds.length) {
const { data: costs } = await supabase
.from('costos_articulo')
.select('articulo_id')
.in('articulo_id', artIds)
.eq('vigente', true);
const m = new Map<string, boolean>();
(costs || []).forEach((c: any) => m.set(c.articulo_id, true));
setCostMap(m);
}
}
} catch (error) {
console.error('Error cargando sugerencias:', error);
} finally {
setSuggestionsLoading(false);
}
}
useEffect(() => {
const debounce = setTimeout(() => {
if (searchTerm.length >= 2) { searchPhysicalCatalog(); } else { setSearchResults([]); }
}, 300);
return () => clearTimeout(debounce);
}, [searchTerm]);
async function searchPhysicalCatalog() {
try {
const { data, error } = await supabase
.from('articulos')
.select('articulo_id, nombre, marca, modelo, variante, codigo_universal, caja_madre')
.not('nombre', 'like', '%PLACEHOLDER%')
.or(`articulo_id.ilike.%${searchTerm}%,nombre.ilike.%${searchTerm}%,marca.ilike.%${searchTerm}%,modelo.ilike.%${searchTerm}%,codigo_universal.ilike.%${searchTerm}%`)
.limit(10);
if (error) { console.error('Error buscando articulos:', error.message); setSearchResults([]); return; }
const ref = pubSku || pubEan || '';
if (ref && data) {
const scored = data.map(item => ({ ...item, _score: Math.max(stringSimilarity(ref, item.articulo_id || ''), stringSimilarity(ref, item.codigo_universal || '')) }));
scored.sort((a, b) => b._score - a._score);
setSearchResults(scored);
} else { setSearchResults(data || []); }
} catch (error) { console.error('Error buscando articulos fisicos:', error); setSearchResults([]); }
}
function handleAddSku(product: any) {
        if (selectedSkus.find(s => s.sku === product.articulo_id)) return;
        setSelectedSkus([{
            sku: product.articulo_id,
            name: product.nombre || 'Sin nombre',
            marca: product.marca || '',
            modelo: product.modelo || '',
            variante: product.variante || '',
            codigo_universal: product.codigo_universal || '',
            caja_madre: product.caja_madre || '',
            quantity: 1
        }, ...selectedSkus]);
        setSearchTerm('');
    }
function handleRemoveSku(sku: string) { setSelectedSkus(selectedSkus.filter(s => s.sku !== sku)); }
function handleQuantityChange(sku: string, qty: number) { if (qty < 1) return; setSelectedSkus(selectedSkus.map(s => s.sku === sku ? { ...s, quantity: qty } : s)); }
async function loadSiblings() {
setSiblingsLoading(true);
try {
let sibData: any[] = [];
if (listing?.id_producto_catalogo) {
const { data } = await supabase
.from('publicaciones_externas')
.select('id, titulo, external_item_id, tipo_publicacion')
.eq('id_producto_catalogo', listing.id_producto_catalogo)
.neq('id', listing.id)
.eq('external_variation_id', '0');
sibData = data || [];
}
const { data: catData } = await supabase
.from('publicaciones_externas')
.select('id, titulo, external_item_id, tipo_publicacion')
.eq('par_item_id', listing.external_item_id)
.in('tipo_publicacion', ['catalogo', 'catalogo_derivada'])
.eq('external_variation_id', '0');
const ids = new Set(sibData.map((s: any) => s.id));
const combined = [
...sibData,
...(catData || []).filter((c: any) => !ids.has(c.id)),
];
setSiblings(combined);
} finally {
setSiblingsLoading(false);
}
}
async function handleSave() {
setSaving(true);
try {
const { error: delError } = await supabase.from('mapeo_publicacion_articulo').delete().eq('publicacion_id', listing.id);
if (delError) throw delError;
if (selectedSkus.length === 0) {
await supabase.from('publicaciones_externas').update({ esta_mapeado: false }).eq('id', listing.id);
onSuccess();
onClose();
return;
}
const snapshotUpserts = selectedSkus.map(s => ({ sku: s.sku, physical_stock: 0, updated_at: new Date().toISOString() }));
await supabase.from('inventory_snapshot').upsert(snapshotUpserts, { onConflict: 'sku', ignoreDuplicates: true });
const inserts = selectedSkus.map(s => ({ publicacion_id: listing.id, articulo_id: s.sku, cantidad_requerida: s.quantity }));
const { error: insError } = await supabase.from('mapeo_publicacion_articulo').insert(inserts);
if (insError) throw insError;
await supabase.from('publicaciones_externas').update({ esta_mapeado: true }).eq('id', listing.id);
await supabase
.from('publicaciones_externas')
.update({ sync_disabled: false, sync_disabled_reason: null })
.eq('id', listing.id)
.eq('sync_disabled_reason', 'pricing_needs_manual_mapping');
await supabase.from('jobs').insert({
type: 'recalc_pricing_bundle',
payload: { publicacion_id: listing.id },
status: 'pending',
scheduled_at: new Date().toISOString(),
});
await supabase.from('jobs').insert({ type: 'sync_stock_mapped', payload: { publicacion_id: listing.id }, status: 'pending', scheduled_at: new Date().toISOString() });
const propagableSimlings = siblings.filter(s => s.id !== listing.id);
if (propagableSimlings.length > 0) {
const confirmed = window.confirm(
`Propagar este mapeo a ${propagableSimlings.length} publicacion(es) hermana(s) con el mismo producto de catalogo?\n\n` +
propagableSimlings.map(s => `- ${s.external_item_id} - ${s.titulo?.slice(0, 50)}`).join('\n')
);
if (confirmed) {
for (const sib of propagableSimlings) {
await supabase.from('mapeo_publicacion_articulo').delete().eq('publicacion_id', sib.id);
const sibInserts = selectedSkus.map(s => ({ publicacion_id: sib.id, articulo_id: s.sku, cantidad_requerida: s.quantity }));
await supabase.from('mapeo_publicacion_articulo').insert(sibInserts);
await supabase.from('publicaciones_externas').update({ esta_mapeado: true }).eq('id', sib.id);
await supabase
.from('publicaciones_externas')
.update({ sync_disabled: false, sync_disabled_reason: null })
.eq('id', sib.id)
.eq('sync_disabled_reason', 'pricing_needs_manual_mapping');
await supabase.from('jobs').insert({
type: 'recalc_pricing_bundle',
payload: { publicacion_id: sib.id },
status: 'pending',
scheduled_at: new Date().toISOString(),
});
await supabase.from('jobs').insert({ type: 'sync_stock_mapped', payload: { publicacion_id: sib.id }, status: 'pending', scheduled_at: new Date().toISOString() });
}
}
}
await dispatchWorker();
onSuccess();
onClose();
} catch (error) { console.error('Error guardando el mapeo:', error); alert('Ocurrio un error al guardar el mapeo.'); }
finally { setSaving(false); }
}
const filteredSuggestions = smartSuggestions.filter(s => !selectedSkus.find(sel => sel.sku === s.articulo_id));
    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-6xl h-[85dvh] max-h-[850px] overflow-hidden flex flex-col">
                
                {/* Header del Modal */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
                    <div>
                        <h2 className="text-base font-bold text-[var(--text)]">Mapear a Bodega Física</h2>
                        <p className="text-xs text-[var(--text-muted)]">Vincula esta vitrina con 1 o más productos reales.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                {/* T-LAYOUT TOP: Full Width Banner para la Vitrina */}
                <div className="border-b border-[var(--border)] bg-[var(--surface-2)]/30 shrink-0">
                    <div className="px-4 py-2 flex items-center gap-3">
                        {listing.thumbnail && (
                            <img src={listing.thumbnail} alt="Thumbnail" className="w-10 h-10 object-contain rounded-md bg-white border border-[var(--border)] shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold tracking-wider uppercase px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30">
                                    {listing.domain_id === 'MLM-CARS_AND_LIGHT_TRUCKS' ? 'Vehículo' : 'Publicación Venta'}
                                </span>
                                {listing.condition === 'new' && <span className="text-xs bg-[var(--surface-2)] text-[var(--text-muted)] px-2 py-0.5 rounded border border-[var(--border)]">Nuevo</span>}
                                <span className="text-[var(--text-muted)] font-mono text-xs ml-2">{listing.external_item_id}</span>
                            </div>
                            <h3 className="text-sm font-bold text-[var(--text)] leading-tight truncate mb-1" title={listing.titulo}>{listing.titulo}</h3>
                            <div className="flex flex-wrap gap-2 text-xs">
                                <span className="font-bold text-[var(--text)]">${listing.precio?.toLocaleString('es-MX')}</span>
                                {pubSku && <span className="text-[var(--text-muted)]">| SKU: <span className="font-mono">{pubSku}</span></span>}
                                {pubGtin && <span className="text-[var(--text-muted)]">| GTIN: <span className="font-mono">{pubGtin}</span></span>}
                            </div>
                        </div>
                    </div>
                    
                    {/* Alertas debajo del banner si existen */}
                    {(isBlockedCatalog || siblings.length > 0) && (
                        <div className="px-6 py-2 bg-[var(--surface-2)] flex flex-col gap-2 border-t border-[var(--border)]">
                            {isBlockedCatalog && (
                                <div className="text-[var(--warn)] text-xs flex items-center gap-1.5">
                                    <Info size={14} className="shrink-0" />
                                    <span><strong>Catálogo bloqueado (hereda stock).</strong> Mapea la publicación hermana {listing.par_item_id ? `(${listing.par_item_id})` : ''} para sincronizar stock correctamente.</span>
                                </div>
                            )}
                            {!isBlockedCatalog && siblings.length > 0 && (
                                <div className="text-[var(--accent)] text-xs flex items-center gap-1.5">
                                    <Info size={14} className="shrink-0" />
                                    <span>Al guardar, propagarás a <strong>{siblings.length}</strong> publicación hermana(s).</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* T-LAYOUT BODY: 2-Column Grid */}
                <div className="flex-1 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden bg-[var(--surface)]">
                    
                    {/* LEFT COLUMN: Search & Catalog (60%) */}
                    <div className="w-full md:w-[60%] shrink-0 flex flex-col md:border-r border-[var(--border)] overflow-hidden">
                        
                        {/* Sugerencia automática (server-side): comparación alineada */}
                        {topSugerencia && !searchTerm && (
                            <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)]/30 shrink-0">
                                <div className="flex items-center justify-between gap-3 mb-2">
                                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--ok)]">
                                        Coincidencia {topSugerencia.score}% · {topSugerencia.motivo}
                                    </p>
                                    <button
                                        onClick={() => handleAddSku(topSugerencia)}
                                        className="shrink-0 px-3 py-1.5 bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-semibold rounded-lg hover:brightness-110"
                                    >
                                        Añadir
                                    </button>
                                </div>

                                <SugerenciaComparacion
                                    pub={{
                                        titulo: pubTitle,
                                        brand: pubBrand,
                                        model: pubModel,
                                        sku: pubSku,
                                        codigo: pubGtin || pubEan || pubUpc,
                                    }}
                                    sug={topSugerencia}
                                />
                            </div>
                        )}
                        
                        {/* Search Input (Sticky Top of Column) */}
                        <div className="px-5 py-4 border-b border-[var(--border)] bg-[var(--surface)] shrink-0 shadow-sm relative z-10">
                            <label className="text-xs font-semibold text-[var(--text-muted)] mb-1.5 block">Buscar en Catálogo Real</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" size={16} />
                                <input
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2.5 bg-[var(--surface-2)] border border-[var(--border)] text-[var(--text)] rounded-lg focus:ring-2 focus:ring-[var(--accent)] focus:border-[var(--accent)] transition-all outline-none text-sm placeholder:text-[var(--text-faint)]"
                                    placeholder="Busca por nombre, marca, modelo, SKU, código universal..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        {/* Suggestions / Results (Scrollable Area) */}
                        <div className="flex-1 overflow-y-auto p-5 bg-[var(--surface)] space-y-4 max-h-[45vh] md:max-h-none">
                            {searchResults.length > 0 ? (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold text-[var(--text)] mb-2">Resultados de búsqueda</h4>
                                    {searchResults.map(res => (
                                        <button
                                            key={res.articulo_id}
                                            className="w-full text-left p-3 rounded-lg bg-[var(--surface-2)] hover:bg-[var(--accent)]/10 border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all flex items-center justify-between group"
                                            onClick={() => handleAddSku(res)}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-[var(--text)] truncate">{res.nombre}</p>
                                                <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                    {res.marca && <span className="text-xs text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">{res.marca}</span>}
                                                    {res.codigo_universal && (
                                                        <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                                                            Cod: {res.codigo_universal}
                                                        </span>
                                                    )}
                                                    {res.modelo && <span className="text-xs text-[var(--text-faint)]">Mod: {res.modelo}</span>}
                                                    {res.variante && <span className="text-xs text-[var(--text-faint)]">Var: {res.variante}</span>}
                                                    {res.caja_madre && <span className="text-xs font-bold text-[var(--warn)] bg-[var(--warn)]/10 px-1.5 py-0.5 rounded border border-[var(--warn)]/30">Caja madre: {res.caja_madre}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 ml-3">
                                                <span className="text-xs font-mono text-[var(--text-faint)]">{res.articulo_id}</span>
                                                <div className="w-9 h-9 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center group-hover:bg-[var(--accent)] group-hover:border-[var(--accent)] transition-colors">
                                                    <Plus size={12} className="text-[var(--text-muted)] group-hover:text-white" />
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (suggestionsLoading || filteredSuggestions.length > 0) ? (
                                <div className="space-y-2">
                                    <h4 className="text-xs font-bold text-[var(--text-muted)] flex items-center gap-1.5 mb-2">
                                        <RefreshCw size={12} className={suggestionsLoading ? 'animate-spin' : ''} />
                                        {suggestionsLoading ? 'Analizando similitudes...' : `${filteredSuggestions.length} sugerencias inteligentes`}
                                    </h4>
                                    {!suggestionsLoading && filteredSuggestions.map(res => (
                                        <button
                                            key={res.articulo_id}
                                            onClick={() => handleAddSku(res)}
                                            className="w-full text-left p-3 rounded-lg bg-[var(--surface-2)]/50 hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)]/50 transition-all flex items-center justify-between group"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-[var(--text)] truncate">{res.nombre}</p>
                                                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                                                    {res._score >= 3 && <span className="text-xs bg-[var(--ok)]/20 text-[var(--ok)] border border-[var(--ok)]/40 px-1.5 py-0.5 rounded-full font-bold">Match Alto</span>}
                                                    {res._score >= 1.5 && res._score < 3 && <span className="text-xs bg-[var(--warn)]/20 text-[var(--warn)] border border-[var(--warn)]/40 px-1.5 py-0.5 rounded-full font-semibold">Match Medio</span>}
                                                    {res.marca && <span className="text-xs text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">{res.marca}</span>}
                                                    {res.codigo_universal && (
                                                        <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded border border-[var(--border)]">
                                                            Cod: {res.codigo_universal}
                                                        </span>
                                                    )}
                                                    {res.caja_madre && <span className="text-xs font-bold text-[var(--warn)] bg-[var(--warn)]/10 px-1.5 py-0.5 rounded border border-[var(--warn)]/30">Caja madre: {res.caja_madre}</span>}
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-3 ml-3">
                                                {costMap.get(res.articulo_id) ? (
                                                    <span className="text-xs bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/20 px-1.5 py-0.5 rounded">Costo OK</span>
                                                ) : (
                                                    <span className="text-xs bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/20 px-1.5 py-0.5 rounded">Sin Costo</span>
                                                )}
                                                <div className="w-9 h-9 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center group-hover:bg-[var(--accent)] group-hover:border-[var(--accent)] transition-colors">
                                                    <Plus size={12} className="text-[var(--text-muted)] group-hover:text-white" />
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-10 text-[var(--text-faint)]">
                                    <Search size={32} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-sm">Usa el buscador para encontrar artículos en tu bodega.</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT COLUMN: Cart / Selected (40%) */}
                    <div className="w-full md:w-[40%] shrink-0 flex flex-col bg-[var(--surface-2)]/30 border-t md:border-t-0 md:border-l border-[var(--border)]">
                        <div className="p-5 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0 shadow-sm relative z-10">
                            <h4 className="text-sm font-bold text-[var(--text)] flex items-center gap-2">
                                <Package size={16} className="text-[var(--accent)]" /> 
                                Artículos del Ensamble
                                <span className="bg-[var(--accent)] text-[var(--accent-ink)] text-xs px-2 py-0.5 rounded-full ml-auto">
                                    {selectedSkus.length}
                                </span>
                            </h4>
                            <p className="text-xs text-[var(--text-muted)] mt-1">Estos productos se descontarán por cada venta.</p>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-3 relative max-h-[45vh] md:max-h-none">
                            {loading ? (
                                <div className="text-center py-10 text-[var(--text-faint)]">
                                    <RefreshCw size={24} className="mx-auto mb-3 animate-spin opacity-50" />
                                    <p className="text-sm">Cargando ensamble actual...</p>
                                </div>
                            ) : selectedSkus.length === 0 ? (
                                <div className="text-center py-12 text-[var(--text-faint)] border-2 border-dashed border-[var(--border)] rounded-xl bg-[var(--surface)]/50">
                                    <Package size={32} className="mx-auto mb-3 opacity-20" />
                                    <p className="text-sm px-4">No hay artículos vinculados.<br/>Selecciona productos desde el catálogo (izquierda).</p>
                                </div>
                            ) : (
                                selectedSkus.map(s => (
                                    <div key={s.sku} className="p-3 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-sm hover:border-[var(--accent)]/50 transition-colors relative group">
                                        <button onClick={() => handleRemoveSku(s.sku)} className="absolute top-2 right-2 p-1.5 text-[var(--text-faint)] hover:text-[var(--err)] hover:bg-[var(--err)]/10 rounded-md transition-colors" title="Quitar del ensamble">
                                            <X size={14} />
                                        </button>
                                        
                                        <p className="text-sm font-semibold text-[var(--text)] pr-6 leading-tight mb-2">{s.name}</p>
                                        
                                        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                                            <span className="text-xs font-mono text-[var(--text-muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded border border-[var(--border)]">{s.sku}</span>
                                            {s.marca && <span className="text-xs text-[var(--text-faint)]">Marca: {s.marca}</span>}
                                            {s.codigo_universal && <span className="text-xs font-mono text-[var(--text-faint)]">Cod: {s.codigo_universal}</span>}
                                            {s.caja_madre && <span className="text-xs font-bold text-[var(--warn)]">Caja madre: {s.caja_madre}</span>}
                                        </div>

                                        <div className="flex items-center justify-between mt-auto pt-3 border-t border-[var(--border)]">
                                            <span className="text-xs font-medium text-[var(--text-muted)]">Multiplicador</span>
                                            <div className="flex items-center border border-[var(--border)] bg-[var(--surface-2)] rounded-lg overflow-hidden h-7">
                                                <button onClick={() => handleQuantityChange(s.sku, s.quantity - 1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] font-bold transition-colors">-</button>
                                                <input type="number" value={s.quantity} onChange={(e) => handleQuantityChange(s.sku, parseInt(e.target.value) || 1)} className="w-12 h-full text-center text-xs font-bold bg-transparent border-none appearance-none p-0 focus:ring-0 text-[var(--text)]" />
                                                <button onClick={() => handleQuantityChange(s.sku, s.quantity + 1)} className="w-9 h-full flex items-center justify-center text-[var(--text)] hover:bg-[var(--surface)] font-bold transition-colors">+</button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>

                {/* Footer del Modal */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)] bg-[var(--surface)] shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-20">
                    <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-2)]/80 hover:text-[var(--text)] transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleSave} disabled={saving} className={`px-6 py-2.5 text-sm font-semibold rounded-lg hover:brightness-110 disabled:opacity-40 flex items-center gap-2 transition-all shadow-sm ${selectedSkus.length === 0 ? 'text-[var(--err)] bg-[var(--err)]/15 border border-[var(--err)]/30' : 'text-[var(--accent-ink)] bg-[var(--accent)]'}`}>
                        {saving ? (<><RefreshCw size={16} className="animate-spin" />Guardando...</>) : selectedSkus.length === 0 ? (<><Trash2 size={16} />Desvincular Todo</>) : (<><Save size={16} />Guardar Mapeo</>)}
                    </button>
                </div>
            </div>
        </div>
    );
}
