"use client";
import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { dispatchWorker } from '@/lib/dispatch-worker';
import { X, Search, Package, Save, RefreshCw, Plus, Trash2, Tag, Barcode, Info } from 'lucide-react';
interface MappingModalProps {
listing: any;
onClose: () => void;
onSuccess: () => void;
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
export default function MappingModal({ listing, onClose, onSuccess }: MappingModalProps) {
const [searchTerm, setSearchTerm] = useState('');
const [searchResults, setSearchResults] = useState<any[]>([]);
const [selectedSkus, setSelectedSkus] = useState<any[]>([]);
const [loading, setLoading] = useState(false);
const [saving, setSaving] = useState(false);
const [smartSuggestions, setSmartSuggestions] = useState<any[]>([]);
const [suggestionsLoading, setSuggestionsLoading] = useState(false);
const [siblings, setSiblings] = useState<any[]>([]);
const [siblingsLoading, setSiblingsLoading] = useState(false);
const [costMap, setCostMap] = useState<Map<string, boolean>>(new Map());
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
setSelectedSkus(mapped);
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
const finalScored = scored.filter(s => s._score > minScore);
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
setSelectedSkus([{ sku: product.articulo_id, }, ...selectedSkus]);
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
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header del Modal */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)] bg-[var(--surface-2)]">
                    <div>
                        <h2 className="text-lg font-bold text-[var(--text)]">Mapear a Bodega Física</h2>
                        <p className="text-xs text-[var(--text-muted)]">Vincula esta vitrina con 1 o más productos reales.</p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg transition-colors">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
                    {/* Tarjeta de Publicación MeLi */}
                    <div className="bg-[var(--surface-2)]/70 rounded-xl p-4 border border-[var(--border)]">
                        <div className="flex gap-4">
                            {listing.url_imagen && (
                                <img src={listing.url_imagen} alt="Producto" className="w-20 h-20 object-contain rounded-lg bg-[var(--surface)] border border-[var(--border)] flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className="text-xs font-bold text-[var(--accent)] bg-[var(--accent)]/15 px-2.5 py-0.5 rounded-full border border-[var(--accent)]/30">
                                        Publicación Venta
                                    </span>
                                    {listing.condition && (
                                        <span className="text-xs text-[var(--text-muted)] bg-[var(--surface)] px-2 py-0.5 rounded border border-[var(--border)]">
                                            {listing.condition === 'new' ? 'Nuevo' : 'Usado'}
                                        </span>
                                    )}
                                </div>
                                <h3 className="font-semibold text-base text-[var(--text)] leading-tight truncate">{listing.titulo}</h3>
                                <p className="text-xs text-[var(--text-muted)] mt-1 font-mono">{listing.external_item_id} — <strong className="text-[var(--text)]">${listing.precio_venta}</strong></p>
                                
                                <div className="flex flex-wrap gap-1.5 mt-2.5">
                                    {pubSku && (
                                        <span className="inline-flex items-center gap-1 text-xs bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30 px-2 py-0.5 rounded-md font-mono">
                                            <Tag size={12} /> SKU: {pubSku}
                                        </span>
                                    )}
                                    {pubEan && (
                                        <span className="inline-flex items-center gap-1 text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] px-2 py-0.5 rounded-md font-mono">
                                            <Barcode size={12} /> EAN: {pubEan}
                                        </span>
                                    )}
                                    {pubGtin && pubGtin !== pubEan && (
                                        <span className="inline-flex items-center gap-1 text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] px-2 py-0.5 rounded-md font-mono">
                                            <Barcode size={12} /> GTIN: {pubGtin}
                                        </span>
                                    )}
                                    {pubUpc && pubUpc !== pubEan && pubUpc !== pubGtin && (
                                        <span className="text-xs bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] px-2 py-0.5 rounded-md font-mono">
                                            UPC: {pubUpc}
                                        </span>
                                    )}
                                    <span className={`text-xs px-2 py-0.5 rounded-md border ${pubBrand ? 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]' : 'bg-[var(--err)]/10 text-[var(--err)] border-[var(--err)]/30'}`}>
                                        Marca: {pubBrand || '⚠️ Ausente en ML'}
                                    </span>
                                    <span className={`text-xs px-2 py-0.5 rounded-md border ${pubModel ? 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)]' : 'bg-[var(--err)]/10 text-[var(--err)] border-[var(--err)]/30'}`}>
                                        Modelo: {pubModel || '⚠️ Ausente en ML'}
                                    </span>
                                    {listing.domain_id && (
                                        <span className="text-xs bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)] px-2 py-0.5 rounded-md">
                                            {listing.domain_id}
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {isBlockedCatalog && (
                        <div className="bg-[var(--warn)]/10 border border-[var(--warn)]/40 rounded-xl p-4 flex gap-3 text-[var(--text)]">
                            <Info size={18} className="text-[var(--warn)] shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-bold text-[var(--warn)]">Este catálogo hereda el stock de su publicación tradicional</p>
                                <p className="text-xs text-[var(--text-muted)] mt-1">
                                    Para que el stock se sincronice correctamente, mapea la publicación <strong>tradicional hermana</strong>
                                    {listing.par_item_id ? ` (${listing.par_item_id})` : ''} - este catálogo se actualizará automáticamente.
                                </p>
                            </div>
                        </div>
                    )}

                    {!isBlockedCatalog && siblings.length > 0 && (
                        <div className="bg-[var(--accent)]/15 border border-[var(--accent)]/40 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-[var(--text)]">
                            <Info size={14} className="shrink-0 text-[var(--accent)]" />
                            <span>Al guardar, podrás propagar el mapeo a <strong className="text-[var(--accent)]">{siblings.length}</strong> publicación{siblings.length !== 1 ? 'es' : ''} hermana{siblings.length !== 1 ? 's' : ''} con el mismo producto de catálogo.</span>
                        </div>
                    )}

                    {/* Artículos Seleccionados (Ensamble) */}
                    <div>
                        <h4 className="text-xs font-bold text-[var(--text-muted)] flex items-center gap-1.5 mb-2">
                            <Package size={14} /> Artículos que se descontarán por cada venta (Ensamble)
                        </h4>
                        {loading ? (
                            <div className="text-center py-4 text-sm text-[var(--text-faint)]">
                                <RefreshCw size={16} className="inline animate-spin mr-2" />Cargando mapeos previos...
                            </div>
                        ) : selectedSkus.length === 0 ? (
                            <div className="text-center py-6 text-sm text-[var(--text-faint)] bg-[var(--surface-2)]/40 rounded-lg border-2 border-dashed border-[var(--border)]">
                                No has agregado artículos reales. Usa el buscador o las sugerencias.
                            </div>
                        ) : (
                            selectedSkus.map(s => (
                                <div key={s.sku} className="flex items-center gap-3 p-3 bg-[var(--surface-2)]/60 border border-[var(--border)] rounded-lg mb-2 hover:border-[var(--accent)]/40 transition-colors">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-[var(--text)] truncate">{s.name}</p>
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                            {s.marca && <span className="text-xs text-[var(--text-muted)] bg-[var(--surface)] px-1.5 py-0.5 rounded">{s.marca}</span>}
                                            {s.modelo && <span className="text-xs text-[var(--text-faint)]">Mod: {s.modelo}</span>}
                                            {s.variante && <span className="text-xs text-[var(--text-faint)]">Var: {s.variante}</span>}
                                            {s.caja_madre && <span className="text-xs text-[var(--text-faint)]">Caja: {s.caja_madre}</span>}
                                            {s.codigo_universal && (
                                                <span className="text-xs font-mono text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded border border-[var(--accent)]/20">
                                                    Cod: {s.codigo_universal}
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-xs font-mono text-[var(--text-faint)] mt-1 block">{s.sku}</span>
                                    </div>
                                    <button onClick={() => handleRemoveSku(s.sku)} className="p-2 text-[var(--err)] hover:bg-[var(--err)]/15 rounded-lg transition-colors" title="Eliminar">
                                        <Trash2 size={16} />
                                    </button>
                                    <div className="text-center">
                                        <span className="text-xs text-[var(--text-faint)] block mb-1">Cantidad</span>
                                        <div className="flex items-center border border-[var(--border)] bg-[var(--surface)] rounded-lg overflow-hidden">
                                            <button onClick={() => handleQuantityChange(s.sku, s.quantity - 1)} className="px-2.5 py-1 text-[var(--text)] hover:bg-[var(--surface-2)] font-bold transition-colors">-</button>
                                            <input type="number" value={s.quantity} onChange={(e) => handleQuantityChange(s.sku, parseInt(e.target.value) || 1)} className="w-12 text-center text-sm font-semibold bg-transparent border-none appearance-none p-0 focus:ring-0 text-[var(--text)]" />
                                            <button onClick={() => handleQuantityChange(s.sku, s.quantity + 1)} className="px-2.5 py-1 text-[var(--text)] hover:bg-[var(--surface-2)] font-bold transition-colors">+</button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    {/* Sugerencias Inteligentes */}
                    {(suggestionsLoading || filteredSuggestions.length > 0) && (
                        <div className="bg-[var(--surface-2)]/80 border border-[var(--border)] rounded-xl p-3.5 space-y-2">
                            <h4 className="text-xs font-bold text-[var(--text)] flex items-center gap-1.5 mb-2">
                                <RefreshCw size={12} className={suggestionsLoading ? 'animate-spin text-[var(--accent)]' : 'text-[var(--accent)]'} />
                                {suggestionsLoading ? 'Buscando coincidencias...' : `${filteredSuggestions.length} sugerencia${filteredSuggestions.length !== 1 ? 's' : ''} por similitud`}
                            </h4>

                            {!suggestionsLoading && filteredSuggestions.slice(0, 15).map(res => (
                                <button
                                    key={res.articulo_id}
                                    onClick={() => handleAddSku(res)}
                                    className="w-full text-left p-2.5 rounded-lg bg-[var(--surface)] hover:bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)] transition-all flex items-center justify-between group"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-medium text-[var(--text)] truncate">{res.nombre}</p>
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                            {res.marca && <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">{res.marca}</span>}
                                            {res.codigo_universal && (
                                                <span className="text-xs font-mono text-[var(--accent)] bg-[var(--accent)]/10 border border-[var(--accent)]/20 px-1.5 py-0.5 rounded">
                                                    Cod: {res.codigo_universal}
                                                </span>
                                            )}
                                            {res.modelo && <span className="text-xs text-[var(--text-faint)]">Mod: {res.modelo}</span>}
                                            {res.variante && <span className="text-xs text-[var(--text-faint)]">Var: {res.variante}</span>}
                                            {res.caja_madre && <span className="text-xs text-[var(--text-faint)]">Caja: {res.caja_madre}</span>}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 ml-3">
                                        {res._score >= 3 && <span className="text-xs bg-[var(--ok)]/20 text-[var(--ok)] border border-[var(--ok)]/40 px-2 py-0.5 rounded-full font-bold">Alta</span>}
                                        {res._score >= 1.5 && res._score < 3 && <span className="text-xs bg-[var(--warn)]/20 text-[var(--warn)] border border-[var(--warn)]/40 px-2 py-0.5 rounded-full font-semibold">Media</span>}
                                        {res._score < 1.5 && <span className="text-xs bg-[var(--surface-2)] text-[var(--text-muted)] border border-[var(--border)] px-2 py-0.5 rounded-full">Baja</span>}
                                        {costMap.get(res.articulo_id) ? (
                                            <span className="inline-block px-2 py-0.5 text-xs rounded bg-[var(--ok)]/15 text-[var(--ok)] border border-[var(--ok)]/30 font-semibold">
                                                costo vigente
                                            </span>
                                        ) : (
                                            <span className="inline-block px-2 py-0.5 text-xs rounded bg-[var(--err)]/15 text-[var(--err)] border border-[var(--err)]/30 font-semibold" title="El articulo no tiene costo vigente.">
                                                sin costo
                                            </span>
                                        )}
                                        <span className="text-xs font-mono text-[var(--text-faint)]">{res.articulo_id}</span>
                                        <Plus size={16} className="text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity ml-1" />
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Buscador en Catálogo Interno */}
                    <div>
                        <label className="text-xs font-semibold text-[var(--text-muted)] mb-1.5 block">Buscar en tu Bodega (Catálogo Real)</label>
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
                        {searchResults.length > 0 && (
                            <div className="mt-2 border border-[var(--border)] rounded-lg bg-[var(--surface)] shadow-xl max-h-48 overflow-y-auto">
                                {searchResults.map(res => (
                                    <button
                                        key={res.articulo_id}
                                        className="w-full text-left px-3 py-2.5 hover:bg-[var(--accent)]/10 border-b border-[var(--border)] last:border-0 transition-colors flex items-center justify-between group"
                                        onClick={() => handleAddSku(res)}
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium text-[var(--text)] truncate">{res.nombre}</p>
                                            <div className="flex flex-wrap gap-1.5 mt-1">
                                                {res.marca && <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-2)] px-1.5 py-0.5 rounded">{res.marca}</span>}
                                                {res.codigo_universal && (
                                                    <span className="text-xs font-mono text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded border border-[var(--accent)]/20">
                                                        Cod: {res.codigo_universal}
                                                    </span>
                                                )}
                                                {res.modelo && <span className="text-xs text-[var(--text-faint)]">Mod: {res.modelo}</span>}
                                                {res.variante && <span className="text-xs text-[var(--text-faint)]">Var: {res.variante}</span>}
                                                {res.caja_madre && <span className="text-xs text-[var(--text-faint)]">Caja: {res.caja_madre}</span>}
                                            </div>
                                        </div>
                                        <span className="text-xs font-mono text-[var(--text-faint)] ml-2 flex-shrink-0">{res.articulo_id}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>


                </div>

                {/* Footer del Modal */}
                <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[var(--border)] bg-[var(--surface-2)]">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--text-muted)] bg-[var(--surface)] border border-[var(--border)] rounded-lg hover:bg-[var(--surface-2)] hover:text-[var(--text)] transition-colors">
                        Cancelar
                    </button>
                    <button onClick={handleSave} disabled={saving} className={`px-5 py-2 text-sm font-semibold rounded-lg hover:brightness-110 disabled:opacity-40 flex items-center gap-2 transition-all shadow-sm ${selectedSkus.length === 0 ? 'text-[var(--err)] bg-[var(--err)]/15 border border-[var(--err)]/30' : 'text-[var(--accent-ink)] bg-[var(--accent)]'}`}>
                        {saving ? (<><RefreshCw size={14} className="animate-spin" />Guardando...</>) : selectedSkus.length === 0 ? (<><Trash2 size={14} />Desvincular Todo</>) : (<><Save size={14} />Guardar y Enlazar</>)}
                    </button>
                </div>
            </div>
        </div>
    );
}
