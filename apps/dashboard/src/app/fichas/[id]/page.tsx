"use client";

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
    ArrowLeft, Loader2, AlertCircle, FileText, Link2, CheckCircle2,
    ExternalLink, Trash2, Edit2, Save, X, Tag, List, Sparkles,
    Upload, ChevronRight, Unlink, Search,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { PublishPanel } from '@/components/publish-panel';
import { PricesSection } from '@/components/prices-section';
import { FichaPublicadaView } from './FichaPublicadaView';

// --- Tipos --------------------------------------------------------------------

type Estado = 'borrador' | 'revision' | 'publicado';

interface Articulo {
    articulo_id: string; nombre: string; marca: string;
    modelo?: string; variante?: string; codigo_universal?: string;
    categoria?: string; peso_kg?: number;
    largo_cm?: number; ancho_cm?: number; alto_cm?: number;
}

interface FichaDetalle {
    id: string; estado: string; created_at: string;
    nombre_producto: string;
    descripcion?: string;
    descripcion_larga?: string;
    fabricante?: string;
    especificaciones?: string;
    ingredientes?: string;
    uso_recomendado?: string;
    precauciones?: string;
    bullet_points?: string[];
    palabras_clave?: string[];
    atributos_dinamicos?: Record<string, any>;
    atributos_categoria?: Record<string, any>;
    atributos_extras?: Record<string, any>;
    ficha_tecnica_data?: Record<string, any>;
    articulo_id?: string;
    articulos?: Articulo | null;
    // Columnas de identidad propias (v41a)
    marca?: string;
    modelo?: string;
    variante?: string;
    codigo_universal?: string;

    categoria?: string;
    peso_kg?: number;
    largo_cm?: number;
    ancho_cm?: number;
    alto_cm?: number;
    materiales?: string;
    pais_origen?: string;
    // Campos regulatorios (v46)
    informacion_normativa?: string;
    instrucciones_uso?: string;
    leyendas_precautorias?: string;
    indicaciones_almacenamiento?: string;
    ficha_extracciones?: Array<{
        id: string; extraccion_cruda: any; aplicada_a_ficha: boolean; created_at: string;
    }>;
}

type TipoCampo = 'texto' | 'lista' | 'jsonb';
type AccionCampo = 'agregar' | 'conflicto';

interface Discrepancia {
    campo: string; label: string; tipo: TipoCampo; accion: AccionCampo;
    valor_actual: any; valor_nuevo: any;
    // listas
    items_nuevos?: string[];
    // jsonb
    keys_nuevas?: Record<string, any>;
    keys_conflicto?: Record<string, { actual: any; nuevo: any }>;
}

// --- Helpers de UI ------------------------------------------------------------

function EstadoBadge({ estado }: { estado: string }) {
    const MAP: Record<string, string> = {
        borrador: 'bg-[var(--surface-2)] text-[var(--text-muted)]',
        revision: 'bg-amber-100 text-[var(--warn)]',
        publicado: 'bg-emerald-100 text-[var(--ok)]',
    };
    return (
        <span className={`text-xs font-bold px-3 py-1 rounded-full capitalize ${MAP[estado] ?? 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>
            {estado}
        </span>
    );
}

function Label({ children }: { children: React.ReactNode }) {
    return <p className="text-[10px] font-bold text-[var(--text-faint)] uppercase tracking-widest mb-0.5">{children}</p>;
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
    if (!value) return null;
    return (
        <div>
            <Label>{label}</Label>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed whitespace-pre-wrap">{value}</p>
        </div>
    );
}

/** Parsea texto "- Clave: valor\n- Clave2: valor2" a un objeto key-value */
function parseSpecsText(text: string): Record<string, string> | null {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result: Record<string, string> = {};
    let valid = 0;
    for (const line of lines) {
        const cleaned = line.replace(/^[-•*]\s*/, '');
        const colonIdx = cleaned.indexOf(':');
        if (colonIdx > 0 && colonIdx < cleaned.length - 1) {
            const k = cleaned.slice(0, colonIdx).trim();
            const v = cleaned.slice(colonIdx + 1).trim();
            if (k && v) { result[k] = v; valid++; }
        }
    }
    return valid >= 2 ? result : null;
}

function KVGrid({ data, label }: { data: Record<string, any>; label?: string }) {
    if (!data || Object.keys(data).length === 0) return null;
    return (
        <div>
            {label && <Label>{label}</Label>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1">
                {Object.entries(data).map(([k, v]) => (
                    <div key={k} className="flex gap-2 bg-[var(--bg)] rounded-lg px-3 py-2 text-xs">
                        <span className="font-medium text-[var(--text-muted)] shrink-0 min-w-0 break-words">{k}:</span>
                        <span className="text-[var(--text-muted)] break-words">{String(v ?? '')}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function EditField({ label, value, onChange, type = 'text' }: {
    label: string; value?: string; onChange: (v: string) => void; type?: 'text' | 'textarea';
}) {
    const cls = "w-full p-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none";
    return (
        <div className="space-y-1">
            <Label>{label}</Label>
            {type === 'textarea'
                ? <textarea className={`${cls} h-24 resize-none`} value={value ?? ''} onChange={e => onChange(e.target.value)} />
                : <input className={cls} value={value ?? ''} onChange={e => onChange(e.target.value)} />
            }
        </div>
    );
}

// --- Componente principal -----------------------------------------------------

const ESTADOS: Estado[] = ['borrador', 'revision', 'publicado'];

export default function FichaDetallePage() {
    const { id }  = useParams<{ id: string }>();
    const router  = useRouter();

    const [ficha, setFicha]       = useState<FichaDetalle | null>(null);
    const [loading, setLoading]   = useState(true);
    const [error, setError]       = useState('');
    const [saving, setSaving]     = useState(false);
    const [savedOk, setSavedOk]   = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Modo edición
    const [editMode, setEditMode]     = useState(false);
    const [draft, setDraft]           = useState<Partial<FichaDetalle>>({});
    const [patchSaving, setPatchSaving] = useState(false);
    const [patchError, setPatchError]   = useState('');

    // Panel de publicación
    const [publishOpen, setPublishOpen] = useState(false);

    // Enriquecimiento
    const [enrichOpen, setEnrichOpen]     = useState(false);
    const [enrichFile, setEnrichFile]     = useState<File | null>(null);
    const [enrichUrl, setEnrichUrl]       = useState('');
    const [enrichMode, setEnrichMode]     = useState<'file' | 'url'>('file');
    const [enrichLoading, setEnrichLoading] = useState(false);
    const [enrichError, setEnrichError]   = useState('');
    const enrichFileRef                   = useRef<HTMLInputElement>(null);
    // Grupos de campos seleccionables — todos pre-marcados por defecto
    const TODOS_CAMPOS_ENRICH = [
        { key: 'nombre_producto',              label: 'Nombre del producto',            grupo: 'Identidad' },
        { key: 'marca',                        label: 'Marca',                          grupo: 'Identidad' },
        { key: 'modelo',                       label: 'Modelo',                         grupo: 'Identidad' },
        { key: 'variante',                     label: 'Variante',                       grupo: 'Identidad' },
        { key: 'categoria',                    label: 'Categoría',                      grupo: 'Identidad' },
        { key: 'codigo_universal',             label: 'Código EAN/UPC',                 grupo: 'Identidad' },
        { key: 'descripcion',                  label: 'Descripción corta',              grupo: 'Descripción' },
        { key: 'descripcion_larga',            label: 'Descripción extendida',          grupo: 'Descripción' },
        { key: 'especificaciones',             label: 'Especificaciones',               grupo: 'Descripción' },
        { key: 'ingredientes',                 label: 'Ingredientes',                   grupo: 'Descripción' },
        { key: 'uso_recomendado',              label: 'Uso recomendado',                grupo: 'Uso y seguridad' },
        { key: 'precauciones',                 label: 'Precauciones',                  grupo: 'Uso y seguridad' },
        { key: 'informacion_normativa',        label: 'Información normativa',          grupo: 'Regulatorio' },
        { key: 'instrucciones_uso',            label: 'Instrucciones de uso',           grupo: 'Regulatorio' },
        { key: 'leyendas_precautorias',        label: 'Leyendas precautorias',         grupo: 'Regulatorio' },
        { key: 'indicaciones_almacenamiento',  label: 'Indicaciones de almacenamiento', grupo: 'Regulatorio' },
        { key: 'peso_kg',                      label: 'Peso (kg)',                      grupo: 'Logística' },
        { key: 'largo_cm',                     label: 'Largo (cm)',                     grupo: 'Logística' },
        { key: 'ancho_cm',                     label: 'Ancho (cm)',                     grupo: 'Logística' },
        { key: 'alto_cm',                      label: 'Alto (cm)',                      grupo: 'Logística' },
        { key: 'materiales',                   label: 'Materiales',                     grupo: 'Logística' },
        { key: 'pais_origen',                  label: 'País de origen',                grupo: 'Logística' },
        { key: 'bullet_points',               label: 'Puntos clave',                   grupo: 'Marketing' },
        { key: 'palabras_clave',              label: 'Palabras clave',                 grupo: 'Marketing' },
        { key: 'atributos_dinamicos',         label: 'Atributos técnicos',             grupo: 'Marketing' },
    ] as const;
    const [enrichCampos, setEnrichCampos] = useState<Set<string>>(
        () => new Set(TODOS_CAMPOS_ENRICH.map(c => c.key))
    );
    // Producto objetivo: para docs con varios productos (tabla comparativa, catálogo, etc.)
    const [enrichProductoObjetivo, setEnrichProductoObjetivo] = useState('');
    // Flujo de 2 etapas
    type EnrichStep = 'config' | 'discovering' | 'picking' | 'extracting';
    const [enrichStep, setEnrichStep]                         = useState<EnrichStep>('config');
    const [productosDescubiertos, setProductosDescubiertos]   = useState<Array<{nombre:string;codigo:string;descripcion_breve:string}>>([]);
    const [productoSeleccionado, setProductoSeleccionado]     = useState<string>('');
    // Buffer de archivo para reutilizar en etapa 2
    const enrichFileBufferRef = useRef<File | null>(null);

    // Modal comparación
    const [conflictos, setConflictos]         = useState<Discrepancia[]>([]);
    const [extraccionId, setExtraccionId]     = useState<string | null>(null);
    // seleccion: 'actual' | 'nuevo' | 'combinar'
    const [seleccion, setSeleccion]           = useState<Record<string, string>>({});
    // checkboxes para items de listas
    const [listChecks, setListChecks]         = useState<Record<string, Set<string>>>({});
    // valores combinados editables por campo
    const [combinados, setCombinados]         = useState<Record<string, string>>({});
    const [combinandoField, setCombinandoField] = useState<string | null>(null);
    const [applying, setApplying]             = useState(false);
    const [applyError, setApplyError]         = useState('');
    const [showModal, setShowModal]           = useState(false);
    const [enrichedMsg, setEnrichedMsg]       = useState('');

    // Vincular/Desvincular artículo
    const [vinculandoModal, setVinculandoModal] = useState(false);
    const [vinculandoQ, setVinculandoQ]         = useState('');
    const [vinculandoResults, setVinculandoResults] = useState<any[]>([]);
    const [vinculandoLoading, setVinculandoLoading] = useState(false);
    const [vinculandoError, setVinculandoError]   = useState('');

    // Imágenes de la ficha (tabla ficha_imagenes)
    const [imagenes, setImagenes]               = useState<any[]>([]);
    const [imagenesLoading, setImagenesLoading] = useState(false);
    const [imagenesError, setImagenesError]     = useState('');
    const [imgUrlInput, setImgUrlInput]         = useState('');
    const [imgUrlLoading, setImgUrlLoading]     = useState(false);
    const [imgExtractUrl, setImgExtractUrl]     = useState('');
    const [imgExtractLoading, setImgExtractLoading] = useState(false);
    const [imgExtractResults, setImgExtractResults] = useState<any[]>([]);
    const [imgExtractOpen, setImgExtractOpen]   = useState(false);
    const [imgExtractSelected, setImgExtractSelected] = useState<Set<string>>(new Set());
    const [imgSaving, setImgSaving]             = useState<Set<string>>(new Set());
    const imgFileRef                            = useRef<HTMLInputElement>(null);

    // Autocompletar campos vacíos
    const [autocompletarLoading, setAutocompletarLoading] = useState(false);
    const [autocompletarSugerencias, setAutocompletarSugerencias] = useState<Record<string,any> | null>(null);
    const [autocompletarChecks, setAutocompletarChecks] = useState<Set<string>>(new Set());
    const [autocompletarApplying, setAutocompletarApplying] = useState(false);
    const [autocompletarMsg, setAutocompletarMsg] = useState('');

    const [generandoPdf, setGenerandoPdf] = useState(false);
    async function generarPDF() {
        if (!ficha) return;
        setGenerandoPdf(true);
        try {
            const res = await fetch(`/api/fichas/${ficha.id}/pdf`, { method: 'POST' });
            const data = await res.json();
            if (data.ok && data.url) {
                const urlObj = new URL(data.url);
                urlObj.searchParams.set('t', Date.now().toString());
                window.open(urlObj.toString(), '_blank');
            } else {
                alert('Error al generar PDF: ' + (data.error || 'Desconocido'));
            }
        } catch (e: any) {
            alert('Error al generar PDF: ' + e.message);
        } finally {
            setGenerandoPdf(false);
        }
    }

    // Fetch datos
    useEffect(() => {
        if (!id) return;
        (async () => {
            setLoading(true);
            const { data, error: err } = await supabase
                .from('fichas_tecnicas')
                .select(`
                    id, estado, created_at,
                    nombre_producto, descripcion, descripcion_larga,
                    fabricante, especificaciones, ingredientes,
                    uso_recomendado, precauciones,
                    peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen,
                    informacion_normativa, instrucciones_uso, leyendas_precautorias, indicaciones_almacenamiento,
                    articulos ( articulo_id, nombre, marca, modelo, variante, codigo_universal, codigo_sat, categoria, peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen, descripcion, imagenes ),
                    ficha_extracciones ( id, extraccion_cruda, aplicada_a_ficha, created_at )
                `)
                .eq('id', id)
                .single();
            if (err) setError(err.message);
            else {
                setFicha(data as unknown as FichaDetalle);
                // Cargar imágenes de la ficha
                loadImagenes(id);
            }
            setLoading(false);
        })();
    }, [id]);

    async function compressImage(file: File): Promise<File> {
        return new Promise((resolve) => {
            if (!file || !file.type || !file.type.startsWith('image/')) return resolve(file);
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
            img.onload = () => {
                URL.revokeObjectURL(url);
                try {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    const max = 2000;
                    if (width > max || height > max) {
                        if (width > height) {
                            height = Math.round((height * max) / width);
                            width = max;
                        } else {
                            width = Math.round((width * max) / height);
                            height = max;
                        }
                    }
                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return resolve(file);
                    ctx.drawImage(img, 0, 0, width, height);
                    canvas.toBlob(blob => {
                        if (!blob) return resolve(file);
                        const safeName = file.name ? file.name.replace(/\.[^/.]+$/, "") + ".webp" : "imagen.webp";
                        resolve(new File([blob], safeName, {
                            type: 'image/webp',
                            lastModified: Date.now(),
                        }));
                    }, 'image/webp', 0.88);
                } catch (err) {
                    resolve(file);
                }
            };
            img.src = url;
        });
    }

    async function loadImagenes(fichaId: string) {
        setImagenesLoading(true);
        try {
            const res = await fetch(`/api/fichas/${fichaId}/imagenes`);
            const data = await res.json();
            if (data.ok) setImagenes(data.imagenes ?? []);
        } catch { /* silencioso */ }
        finally { setImagenesLoading(false); }
    }

    async function addImageFromUrl() {
        if (!ficha || !imgUrlInput.trim()) return;
        setImgUrlLoading(true); setImagenesError('');
        try {
            const res = await fetch(`/api/fichas/${ficha.id}/imagenes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: imgUrlInput.trim(), tipo: 'producto', fuente: 'url_directa' }),
            });
            let data;
            try { data = await res.json(); } catch { throw new Error(`Error de conexión (HTTP ${res.status})`); }
            if (!res.ok) throw new Error(data?.error || 'Error al guardar imagen');
            setImgUrlInput('');
            await loadImagenes(ficha.id);
        } catch (e: any) { setImagenesError(e.message); }
        finally { setImgUrlLoading(false); }
    }

    async function addImagesFromFiles(fileList: FileList | null) {
        if (!ficha || !fileList || fileList.length === 0) return;
        
        const files = Array.from(fileList);
        if (files.length > 10) {
            setImagenesError('Puedes subir un máximo de 10 imágenes a la vez.');
            return;
        }

        setImgUrlLoading(true); setImagenesError('');
        try {
            for (const file of files) {
                const compressedFile = await compressImage(file);
                const form = new FormData();
                form.append('file', compressedFile);
                form.append('tipo', 'producto');
                const res = await fetch(`/api/fichas/${ficha.id}/imagenes`, { method: 'POST', body: form });
                
                let data;
                try {
                    data = await res.json();
                } catch {
                    throw new Error(`Error del servidor (HTTP ${res.status}). La imagen podría ser muy pesada.`);
                }
                
                if (!res.ok) throw new Error(data?.error || 'Error al subir imagen');
            }
            await loadImagenes(ficha.id);
        } catch (e: any) { 
            setImagenesError(e.message); 
        } finally { 
            setImgUrlLoading(false); 
        }
    }

    async function deleteImagen(imagenId: string) {
        if (!ficha) return;
        setImgSaving(prev => new Set([...prev, imagenId]));
        try {
            await fetch(`/api/fichas/${ficha.id}/imagenes?imagen_id=${imagenId}`, { method: 'DELETE' });
            setImagenes(prev => prev.filter(i => i.id !== imagenId));
        } finally { setImgSaving(prev => { const s = new Set(prev); s.delete(imagenId); return s; }); }
    }

    async function reorderImagen(idx: number, dir: -1 | 1) {
        if (!ficha) return;
        const next = [...imagenes];
        const target = idx + dir;
        if (target < 0 || target >= next.length) return;
        [next[idx], next[target]] = [next[target], next[idx]];
        // Actualizar orden localmente primero (optimistic)
        setImagenes(next);
        // Sincronizar con BD
        const ordenes = next.map((img, i) => ({ id: img.id, orden: i }));
        await fetch(`/api/fichas/${ficha.id}/imagenes`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ordenes }),
        });
    }

    async function extractImagenesFromUrl() {
        if (!ficha || !imgExtractUrl.trim()) return;
        setImgExtractLoading(true); setImagenesError(''); setImgExtractResults([]);
        try {
            const res = await fetch(`/api/fichas/${ficha.id}/imagenes/extract-url`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: imgExtractUrl.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            const results = data.imagenes ?? [];
            setImgExtractResults(results);
            // Pre-seleccionar las que tienen confianza >= 70
            setImgExtractSelected(new Set(results.filter((i: any) => i.confianza >= 70).map((i: any) => i.url)));
            setImgExtractOpen(true);
        } catch (e: any) { setImagenesError(e.message); }
        finally { setImgExtractLoading(false); }
    }

    async function saveExtractedImages(urls: string[]) {
        if (!ficha) return;
        for (const url of urls) {
            await fetch(`/api/fichas/${ficha.id}/imagenes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, tipo: 'producto', fuente: 'extraccion_web', url_original: imgExtractUrl }),
            });
        }
        await loadImagenes(ficha.id);
        setImgExtractOpen(false);
        setImgExtractResults([]);
        setImgExtractUrl('');
    }

    // -- Autocompletar --------------------------------------------------------
    async function lanzarAutocompletar() {
        if (!ficha) return;
        setAutocompletarLoading(true); setAutocompletarSugerencias(null); setAutocompletarMsg('');
        try {
            const res = await fetch(`/api/fichas/${ficha.id}/autocompletar`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) { setAutocompletarMsg(data.error || 'Error'); return; }
            if (data.mensaje) { setAutocompletarMsg(data.mensaje); return; }
            if (!data.sugerencias || Object.keys(data.sugerencias).length === 0) {
                setAutocompletarMsg('No se encontraron datos adicionales en el texto existente.');
                return;
            }
            setAutocompletarSugerencias(data.sugerencias);
            // Pre-marcar todos los campos sugeridos
            setAutocompletarChecks(new Set(Object.keys(data.sugerencias)));
        } catch (e: any) { setAutocompletarMsg(e.message); }
        finally { setAutocompletarLoading(false); }
    }

    async function aplicarAutocompletar() {
        if (!ficha || !autocompletarSugerencias) return;
        const patch: Record<string, any> = {};
        for (const key of autocompletarChecks) {
            if (autocompletarSugerencias[key] !== undefined) patch[key] = autocompletarSugerencias[key];
        }
        if (Object.keys(patch).length === 0) return;
        setAutocompletarApplying(true);
        const res = await fetch(`/api/fichas/${ficha.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json().catch(() => ({}));
        setAutocompletarApplying(false);
        if (!res.ok) { setAutocompletarMsg(data.error || 'Error al guardar'); return; }
        // Actualizar estado local
        setFicha(prev => prev ? { ...prev, ...patch } : prev);
        setAutocompletarSugerencias(null);
        setAutocompletarChecks(new Set());
        setAutocompletarMsg(`✓ ${Object.keys(patch).length} campo(s) actualizados`);
        setTimeout(() => setAutocompletarMsg(''), 3000);
    }


    // -- Cambiar estado --------------------------------------------------------

    async function cambiarEstado(e: Estado) {
        if (!ficha) return;
        setSaving(true);
        try {
            const res = await fetch(`/api/fichas/${ficha.id}/estado`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ estado: e })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || 'Error al cambiar de estado');
            } else {
                setFicha(p => p ? { ...p, estado: e } : p);
                setSavedOk(true);
                setTimeout(() => setSavedOk(false), 2000);
            }
        } catch (err) {
            alert('Error de red al intentar cambiar estado');
        }
        setSaving(false);
    }

    // -- Eliminar --------------------------------------------------------------

    async function eliminarFicha() {
        if (!ficha) return;
        if (!window.confirm(`¿Eliminar "${ficha.nombre_producto}"?\nEsta acción no se puede deshacer.`)) return;
        setDeleting(true);
        const res  = await fetch(`/api/fichas/${ficha.id}`, { method: 'DELETE' });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setError(body?.error || 'Error al eliminar.'); setDeleting(false); return; }
        router.push('/fichas');
    }

    // -- Vincular / Desvincular artículo ---------------------------------------

    async function desvincularArticulo() {
        if (!ficha) return;
        const nombre = (ficha.articulos as any)?.nombre ?? ficha.articulo_id;
        if (!window.confirm(`¿Desvincular "${nombre}" de esta ficha?\nLa ficha quedará sin artículo (modo borrador).`)) return;
        const { data, error: err } = await supabase.rpc('desvincular_ficha_articulo', { p_ficha_id: ficha.id });
        if (err || !(data as any)?.ok) {
            setError((data as any)?.error || err?.message || 'Error al desvincular');
            return;
        }
        setFicha(prev => prev ? { ...prev, articulo_id: undefined, articulos: null } : prev);
    }

    async function buscarParaVincular() {
        if (vinculandoQ.trim().length < 2) return;
        setVinculandoLoading(true); setVinculandoError('');
        const { data, error: err } = await supabase
            .from('articulos')
            .select('articulo_id, nombre, marca, modelo, variante, codigo_universal')
            .or(`nombre.ilike.%${vinculandoQ}%,marca.ilike.%${vinculandoQ}%,articulo_id.ilike.%${vinculandoQ}%,modelo.ilike.%${vinculandoQ}%`)
            .limit(10);
        setVinculandoLoading(false);
        if (err) { setVinculandoError(err.message); return; }
        setVinculandoResults(data ?? []);
    }

    async function vincularArticulo(articuloId: string) {
        if (!ficha) return;
        const { data, error: err } = await supabase.rpc('vincular_ficha_articulo', {
            p_ficha_id:    ficha.id,
            p_articulo_id: articuloId,
        });
        if (err || !(data as any)?.ok) {
            setVinculandoError((data as any)?.error || err?.message || 'Error al vincular');
            return;
        }
        // Recargar ficha completa para tener el objeto articulos expandido
        try {
            const { data: updated } = await supabase
                .from('fichas_tecnicas')
                .select(`id, estado, created_at, nombre_producto, descripcion, descripcion_larga,
                    fabricante, especificaciones, ingredientes, uso_recomendado, precauciones,
                    bullet_points, palabras_clave, atributos_dinamicos, atributos_categoria,
                    atributos_extras, ficha_tecnica_data, articulo_id,
                    marca, modelo, variante, codigo_universal, categoria,
                    peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen,
                    articulos ( articulo_id, nombre, marca, modelo, variante, codigo_universal, codigo_sat, categoria, peso_kg, largo_cm, ancho_cm, alto_cm, materiales, pais_origen, descripcion ),
                    ficha_extracciones ( id, extraccion_cruda, aplicada_a_ficha, created_at )`)
                .eq('id', ficha.id).single();
            if (updated) setFicha(updated as unknown as FichaDetalle);
        } catch (e) {
            console.error('Error al recargar ficha tras vinculación');
        }
        setVinculandoModal(false); setVinculandoQ(''); setVinculandoResults([]);
    }

    // -- Edición ---------------------------------------------------------------

    function startEdit() {
        if (!ficha) return;
        const art = ficha.articulos as any;
        setDraft({
            // Campos de contenido — exactamente como antes
            nombre_producto:    ficha.nombre_producto,
            descripcion:        ficha.descripcion,
            descripcion_larga:  ficha.descripcion_larga,
            fabricante:         ficha.fabricante,
            especificaciones:   ficha.especificaciones,
            ingredientes:       ficha.ingredientes,
            uso_recomendado:    ficha.uso_recomendado,
            precauciones:       ficha.precauciones,
            bullet_points:      ficha.bullet_points  ? [...ficha.bullet_points]  : [],
            palabras_clave:     ficha.palabras_clave ? [...ficha.palabras_clave] : [],
            atributos_dinamicos: ficha.atributos_dinamicos ? { ...ficha.atributos_dinamicos } : {},
            atributos_categoria: ficha.atributos_categoria ? { ...ficha.atributos_categoria } : {},
            atributos_extras:    ficha.atributos_extras    ? { ...ficha.atributos_extras }    : {},
            // Identidad canónica — columna propia ?? fallback al artículo vinculado
            marca:              ficha.marca    ?? art?.marca    ?? '',
            modelo:             ficha.modelo   ?? art?.modelo   ?? '',
            variante:           ficha.variante ?? art?.variante ?? '',
            codigo_universal:   ficha.codigo_universal ?? art?.codigo_universal ?? '',

            categoria:          ficha.categoria ?? art?.categoria ?? '',
            materiales:         ficha.materiales ?? art?.materiales ?? '',
            pais_origen:        ficha.pais_origen ?? art?.pais_origen ?? '',
            peso_kg:            ficha.peso_kg  ?? art?.peso_kg  ?? undefined,
            largo_cm:           ficha.largo_cm ?? art?.largo_cm ?? undefined,
            ancho_cm:           ficha.ancho_cm ?? art?.ancho_cm ?? undefined,
            alto_cm:            ficha.alto_cm  ?? art?.alto_cm  ?? undefined,
            // Campos regulatorios (v46)
            informacion_normativa:       ficha.informacion_normativa,
            instrucciones_uso:           ficha.instrucciones_uso,
            leyendas_precautorias:       ficha.leyendas_precautorias,
            indicaciones_almacenamiento: ficha.indicaciones_almacenamiento,
        });
        setPatchError(''); setEditMode(true);
    }

    async function saveEdit() {
        if (!ficha) return;
        setPatchSaving(true); setPatchError('');
        const res = await fetch(`/api/fichas/${ficha.id}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setPatchError(body?.error || 'Error al guardar.'); setPatchSaving(false); return; }
        setFicha(p => p ? { ...p, ...body.ficha } : p);
        setEditMode(false); setDraft({}); setPatchSaving(false);
    }

    // -- Enriquecimiento -------------------------------------------------------

    async function lanzarEnriquecimiento() {
        if (!ficha) return;
        if (enrichMode === 'file' && !enrichFile) { setEnrichError('Selecciona un archivo.'); return; }
        if (enrichMode === 'url' && !enrichUrl.startsWith('http')) { setEnrichError('URL inválida.'); return; }
        if (enrichCampos.size === 0) { setEnrichError('Selecciona al menos un campo para enriquecer.'); return; }

        // -- Flujo de 2 etapas: solo cuando el usuario especificó un producto objetivo ----
        if (enrichProductoObjetivo.trim() && enrichMode === 'file' && enrichFile) {
            setEnrichError('');
            setEnrichStep('discovering');
            enrichFileBufferRef.current = enrichFile;
            const form = new FormData();
            form.append('file', enrichFile);
            const res = await fetch(`/api/fichas/${ficha.id}/descubrir-productos`, { method: 'POST', body: form });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.productos?.length) {
                // Fallback: no se pudo descubrir, ir directo a extracción con hint
                setEnrichStep('config');
                await lanzarExtraccionConProducto(enrichProductoObjetivo.trim());
                return;
            }
            setProductosDescubiertos(data.productos);
            // Pre-seleccionar el más cercano al hint del usuario
            const hint = enrichProductoObjetivo.trim().toLowerCase();
            const match = data.productos.find((p: any) =>
                p.nombre.toLowerCase().includes(hint) || p.codigo.toLowerCase().includes(hint)
            );
            setProductoSeleccionado(match
                ? `${match.nombre}${match.codigo ? ' ' + match.codigo : ''}`
                : '');
            setEnrichStep('picking');
            return;
        }

        // -- Flujo de URL con producto objetivo ------------------------------------------
        if (enrichProductoObjetivo.trim() && enrichMode === 'url') {
            setEnrichError('');
            setEnrichStep('discovering');
            const res = await fetch(`/api/fichas/${ficha.id}/descubrir-productos`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: enrichUrl }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.productos?.length) {
                setEnrichStep('config');
                await lanzarExtraccionConProducto(enrichProductoObjetivo.trim());
                return;
            }
            setProductosDescubiertos(data.productos);
            const hint = enrichProductoObjetivo.trim().toLowerCase();
            const match = data.productos.find((p: any) =>
                p.nombre.toLowerCase().includes(hint) || p.codigo.toLowerCase().includes(hint)
            );
            setProductoSeleccionado(match
                ? `${match.nombre}${match.codigo ? ' ' + match.codigo : ''}`
                : '');
            setEnrichStep('picking');
            return;
        }

        // -- Sin producto objetivo: ir directo ------------------------------------------
        await lanzarExtraccionConProducto(undefined);
    }

    async function lanzarExtraccionConProducto(productoFinal: string | undefined) {
        if (!ficha) return;
        setEnrichLoading(true); setEnrichError('');
        setEnrichStep('extracting');
        const camposArray = Array.from(enrichCampos);

        let res: Response;
        if (enrichMode === 'file' && (enrichFile || enrichFileBufferRef.current)) {
            const archivo = enrichFile ?? enrichFileBufferRef.current!;
            const form = new FormData();
            form.append('file', archivo);
            form.append('campos_solicitados', JSON.stringify(camposArray));
            if (productoFinal) form.append('producto_objetivo', productoFinal);
            res = await fetch(`/api/fichas/${ficha.id}/enriquecer`, { method: 'POST', body: form });
        } else {
            res = await fetch(`/api/fichas/${ficha.id}/enriquecer`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: enrichUrl,
                    campos_solicitados: camposArray,
                    producto_objetivo: productoFinal || undefined,
                }),
            });
        }

        const data = await res.json().catch(() => ({}));
        setEnrichLoading(false);
        setEnrichStep('config');
        setEnrichOpen(false); setEnrichFile(null); setEnrichUrl(''); enrichFileBufferRef.current = null;
        if (!res.ok) { setEnrichError(data?.error || 'Error al enriquecer.'); setEnrichOpen(true); return; }

        if (data.sin_cambios) {
            setEnrichedMsg('Sin cambios — el documento no aportó datos nuevos para los campos seleccionados.');
            return;
        }

        const sel: Record<string, string> = {};
        const checks: Record<string, Set<string>> = {};
        for (const d of (data.campos_para_revisar ?? [])) {
            if (d.tipo === 'lista') {
                sel[d.campo] = 'nuevo';
                checks[d.campo] = new Set(d.items_nuevos ?? []);
            } else if (d.accion === 'agregar') {
                sel[d.campo] = 'nuevo';
            } else {
                sel[d.campo] = 'actual';
            }
        }

        setConflictos(data.campos_para_revisar ?? []);
        setExtraccionId(data.extraccion_id);
        setSeleccion(sel);
        setListChecks(checks);
        setCombinados({});
        setEnrichProductoObjetivo('');
        setProductoSeleccionado('');
        setProductosDescubiertos([]);
        setEnrichedMsg(
            `${(data.campos_para_revisar ?? []).length} campo(s) para revisar. Aprueba los cambios antes de guardar.`
        );
        setShowModal(true);
    }

    async function enrichFromCatalog() {
        if (!ficha?.articulos) return;
        setEnrichedMsg('');
        const art = ficha.articulos as any;

        // Construir lista de todos los campos candidatos del catálogo
        // NUNCA se aplica nada automáticamente — todo pasa por el modal
        const LABEL_MAP: Record<string, string> = {
            nombre_producto: 'Nombre del producto', marca: 'Marca', modelo: 'Modelo',
            variante: 'Variante', codigo_universal: 'Código EAN/UPC', categoria: 'Categoría',
            materiales: 'Materiales', pais_origen: 'País de origen', descripcion: 'Descripción',
            peso_kg: 'Peso (kg)', largo_cm: 'Largo (cm)', ancho_cm: 'Ancho (cm)', alto_cm: 'Alto (cm)',
        };

        const todosParaRevisar: Discrepancia[] = [];

        // Campos de texto canónicos
        const mapTexto: Array<[keyof FichaDetalle, any, string]> = [
            ['nombre_producto', art.nombre,          'nombre_producto'],
            ['marca',           art.marca,           'marca'],
            ['modelo',          art.modelo,          'modelo'],
            ['variante',        art.variante,        'variante'],
            ['codigo_universal', art.codigo_universal, 'codigo_universal'],
            ['categoria',       art.categoria,       'categoria'],
            ['materiales',      art.materiales,      'materiales'],
            ['pais_origen',     art.pais_origen,     'pais_origen'],
            ['descripcion',     art.descripcion,     'descripcion'],
        ];
        for (const [fichaKey, artVal, campo] of mapTexto) {
            if (artVal == null || artVal === '') continue;
            const valorActual = ficha[fichaKey];
            if (!valorActual) {
                // Campo vacío en ficha — candidato a agregar
                todosParaRevisar.push({ campo, label: LABEL_MAP[campo] ?? campo,
                    tipo: 'texto', accion: 'agregar', valor_actual: null, valor_nuevo: artVal });
            } else if (String(valorActual) !== String(artVal)) {
                // Dato diferente — conflicto
                todosParaRevisar.push({ campo, label: LABEL_MAP[campo] ?? campo,
                    tipo: 'texto', accion: 'conflicto', valor_actual: valorActual, valor_nuevo: artVal });
            }
        }

        // Campos numéricos
        const mapNum: Array<[keyof FichaDetalle, number | undefined, string]> = [
            ['peso_kg',  art.peso_kg,  'peso_kg'],
            ['largo_cm', art.largo_cm, 'largo_cm'],
            ['ancho_cm', art.ancho_cm, 'ancho_cm'],
            ['alto_cm',  art.alto_cm,  'alto_cm'],
        ];
        for (const [fichaKey, artVal, campo] of mapNum) {
            if (artVal == null) continue;
            const valorActual = ficha[fichaKey] as number | null | undefined;
            if (valorActual == null) {
                todosParaRevisar.push({ campo, label: LABEL_MAP[campo] ?? campo,
                    tipo: 'texto', accion: 'agregar', valor_actual: null, valor_nuevo: artVal });
            } else if (Math.abs(Number(valorActual) - Number(artVal)) > 0.001) {
                todosParaRevisar.push({ campo, label: LABEL_MAP[campo] ?? campo,
                    tipo: 'texto', accion: 'conflicto', valor_actual: valorActual, valor_nuevo: artVal });
            }
        }

        // Atributos especiales (garantia, atributos_especificos)
        const candidatos: Array<{ key: string; label: string; valor: any }> = [];
        if (art.garantia) candidatos.push({ key: 'Garantía', label: 'Garantía', valor: art.garantia });
        if (art.atributos_especificos && typeof art.atributos_especificos === 'object') {
            for (const [k, v] of Object.entries(art.atributos_especificos as Record<string, any>)) {
                if (v != null && v !== '') candidatos.push({ key: k, label: k, valor: v });
            }
        }
        const actual = ficha.atributos_dinamicos ?? {};
        for (const { key, label, valor } of candidatos) {
            const campo = `atributos_dinamicos.${key}`;
            if (key in actual) {
                if (String(actual[key]) !== String(valor)) {
                    todosParaRevisar.push({ campo, label, tipo: 'texto', accion: 'conflicto',
                        valor_actual: actual[key], valor_nuevo: valor });
                }
            } else {
                todosParaRevisar.push({ campo, label, tipo: 'texto', accion: 'agregar',
                    valor_actual: null, valor_nuevo: valor });
            }
        }

        // Sin datos nuevos
        if (todosParaRevisar.length === 0) {
            setEnrichedMsg('El catálogo no aporta datos nuevos (todos ya estaban en la ficha o son idénticos).');
            return;
        }

        // Todos pasan por el modal — NINGUNO se aplica automáticamente
        const sel: Record<string, string> = {};
        for (const d of todosParaRevisar) {
            sel[d.campo] = d.accion === 'agregar' ? 'nuevo' : 'actual';
        }
        setConflictos(todosParaRevisar);
        setExtraccionId(null);
        setSeleccion(sel);
        setListChecks({});
        setCombinados({});
        setEnrichedMsg(`${todosParaRevisar.length} campo(s) del catálogo para revisar. Ninguno se guardará hasta que apruebes.`);
        setShowModal(true);
    }

    async function combinarConIA(d: Discrepancia) {
        setCombinandoField(d.campo);
        const res = await fetch(`/api/fichas/${ficha!.id}/combinar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ campo: d.campo, label: d.label, valor_actual: String(d.valor_actual ?? ''), valor_nuevo: String(d.valor_nuevo ?? '') }),
        });
        const body = await res.json().catch(() => ({}));
        setCombinandoField(null);
        if (body.valor_combinado) {
            setCombinados(c => ({ ...c, [d.campo]: body.valor_combinado }));
            setSeleccion(s => ({ ...s, [d.campo]: 'combinar' }));
        }
    }

    async function aplicarSeleccion() {
        if (!ficha) return;
        setApplying(true); setApplyError('');

        const campos_aceptados: Record<string, any> = {};
        for (const d of conflictos) {
            const sel = seleccion[d.campo];
            if (d.tipo === 'lista') {
                // Union: actual + items marcados en listChecks
                const checks = listChecks[d.campo] ?? new Set();
                const actual = d.valor_actual ?? [];
                const merged = [...actual, ...(d.items_nuevos ?? []).filter((i: string) => checks.has(i))];
                if (merged.length > actual.length) campos_aceptados[d.campo] = merged;
            } else if (d.tipo === 'jsonb') {
                // Construir objeto final: keys_nuevas filtradas por checkbox + keys_conflicto por selección
                const base = { ...(d.valor_actual ?? {}) };
                // Atributos nuevos: agrega solo los que tienen el check en 'yes'
                if (d.keys_nuevas) {
                    for (const k of Object.keys(d.keys_nuevas)) {
                        const checkKey = `${d.campo}::${k}`;
                        const checked = listChecks[checkKey] !== undefined
                            ? listChecks[checkKey].has('yes')
                            : true; // pre-marcado si no se tocó
                        if (checked) base[k] = d.keys_nuevas[k];
                    }
                }
                // Atributos en conflicto: honra la selección por clave
                let hasConflictChanges = false;
                if (d.keys_conflicto) {
                    for (const [k, vals] of Object.entries(d.keys_conflicto)) {
                        const conflictSel = seleccion[`${d.campo}::conflict::${k}`];
                        const picked = conflictSel === 'nuevo' ? (vals as any).nuevo : (vals as any).actual;
                        base[k] = picked;
                        if (picked !== (vals as any).actual) hasConflictChanges = true;
                    }
                }
                
                // Determinar si realmente hubo cambios (nuevos keys aceptados o conflictos resueltos a favor del nuevo)
                let hasNewKeysChecked = false;
                if (d.keys_nuevas) {
                    hasNewKeysChecked = Object.keys(d.keys_nuevas).some(k => {
                        const checkKey = `${d.campo}::${k}`;
                        return listChecks[checkKey] !== undefined ? listChecks[checkKey].has('yes') : true;
                    });
                }

                if (hasNewKeysChecked || hasConflictChanges) {
                    campos_aceptados[d.campo] = base;
                } else if (Object.keys(base).length > Object.keys(d.valor_actual ?? {}).length) {
                    campos_aceptados[d.campo] = base; // Fallback por si acaso
                }
            } else {
                if (sel === 'nuevo')    campos_aceptados[d.campo] = d.valor_nuevo;
                if (sel === 'combinar') campos_aceptados[d.campo] = combinados[d.campo] ?? d.valor_nuevo;
            }
        }

        if (Object.keys(campos_aceptados).length === 0) {
            setShowModal(false); setApplying(false); return;
        }

        const res = await fetch(`/api/fichas/${ficha.id}/aplicar`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ extraccion_id: extraccionId, campos_aceptados }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setApplyError(body?.error || 'Error al aplicar.'); setApplying(false); return; }

        const { data: updated } = await supabase
            .from('fichas_tecnicas').select('*, articulos(*), ficha_extracciones(*)')
            .eq('id', ficha.id).single();
        if (updated) setFicha(updated as unknown as FichaDetalle);
        setShowModal(false); setApplying(false);
    }

    function formatVal(v: any): string {
        if (Array.isArray(v)) return v.join(' · ') || '(vacío)';
        return v != null && v !== '' ? String(v) : '(vacío)';
    }

    // --- Guards ---------------------------------------------------------------

    if (loading) return <div className="flex items-center justify-center h-64 text-[var(--text-faint)]"><Loader2 className="w-6 h-6 animate-spin mr-2" />Cargando…</div>;
    if (error)   return <div className="flex gap-3 p-4 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl text-[var(--err)]"><AlertCircle className="w-5 h-5 shrink-0" />{error}</div>;
    if (!ficha)  return null;

    const art = ficha.articulos;
    const specsKV = ficha.especificaciones ? parseSpecsText(ficha.especificaciones) : null;
    const hasAtribDin = ficha.atributos_dinamicos && Object.keys(ficha.atributos_dinamicos).length > 0;
    const hasAtribCat = ficha.atributos_categoria && Object.keys(ficha.atributos_categoria).length > 0;
    const hasAtribExt = ficha.atributos_extras    && Object.keys(ficha.atributos_extras).length > 0;

    // Completitud
    const camposEval = [
        ficha.descripcion, ficha.descripcion_larga, ficha.fabricante,
        ficha.especificaciones, ficha.uso_recomendado, ficha.precauciones, ficha.ingredientes,
        // Campos regulatorios v46 — relevantes para venta en marketplaces
        ficha.informacion_normativa, ficha.instrucciones_uso,
        ficha.leyendas_precautorias, ficha.indicaciones_almacenamiento,
    ];
    const listasEval = [ficha.bullet_points?.length, ficha.palabras_clave?.length];
    const filled = camposEval.filter(Boolean).length + listasEval.filter(l => l && l > 0).length;
    const totalEval = camposEval.length + listasEval.length;
    const completitud = Math.round((filled / totalEval) * 100);
    const completitudColor = completitud >= 80 ? 'bg-[var(--ok)]/100' : completitud >= 50 ? 'bg-amber-400' : 'bg-rose-400';

    // --- JSX -----------------------------------------------------------------

    if (!editMode && ficha.estado === 'publicado') {
        return (
            <FichaPublicadaView 
                ficha={{ ...ficha, imagen_urls: imagenes.map(i => i.url) } as any} 
                onEdit={startEdit} 
                onGenerarPDF={generarPDF} 
                generandoPdf={generandoPdf} 
            />
        );
    }

    return (
        <div className="max-w-5xl mx-auto space-y-5 pb-12">

            {/* -- Header -- */}
            <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={() => router.back()} className="p-2 hover:bg-[var(--surface-2)] rounded-xl text-[var(--text-faint)] transition-colors">
                    <ArrowLeft className="w-5 h-5" />
                </button>
                <div className="flex-1 min-w-0">
                    {editMode
                        ? <input className="w-full text-2xl font-bold bg-[var(--bg)] border border-[var(--accent)]/30 rounded-xl px-3 py-1 focus:ring-1 focus:ring-indigo-400 outline-none" value={draft.nombre_producto ?? ''} onChange={e => setDraft(d => ({ ...d, nombre_producto: e.target.value }))} />
                        : <h1 className="text-2xl font-bold truncate">{ficha.nombre_producto || 'Ficha sin nombre'}</h1>
                    }
                    <p className="text-[var(--text-faint)] text-xs font-mono">{ficha.id}</p>
                </div>
                <EstadoBadge estado={ficha.estado} />
                {!editMode && (
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={generarPDF} disabled={generandoPdf}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl hover:border-[var(--accent)]/50 hover:text-indigo-700 transition-colors disabled:opacity-50">
                            {generandoPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
                        </button>
                        <button type="button" onClick={startEdit}
                            className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl hover:border-[var(--accent)]/50 hover:text-indigo-700 transition-colors">
                            <Edit2 className="w-4 h-4" /> Editar
                        </button>
                    </div>
                )}
            </div>

            {/* Banner edición */}
            {editMode && (
                <div className="flex items-center justify-between bg-[var(--accent)]/10 border border-[var(--accent)]/30 rounded-2xl px-5 py-3 gap-3 flex-wrap">
                    <p className="text-sm font-semibold text-indigo-700">Modo edición activo</p>
                    <div className="flex gap-2">
                        <button type="button" onClick={() => { setEditMode(false); setDraft({}); }}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-[var(--border)] rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg)]">
                            <X className="w-4 h-4" /> Cancelar
                        </button>
                        <button type="button" onClick={saveEdit} disabled={patchSaving}
                            className="flex items-center gap-1 px-3 py-1.5 text-sm font-semibold bg-[var(--accent)] text-[var(--accent-ink)] rounded-lg hover:brightness-110 disabled:opacity-60">
                            {patchSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
                        </button>
                    </div>
                </div>
            )}
            {patchError && <div className="flex gap-2 p-3 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl text-[var(--err)] text-sm"><AlertCircle className="w-4 h-4 shrink-0" />{patchError}</div>}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

                {/* -- Columna principal -- */}
                <div className="lg:col-span-2 space-y-4">

                    {/* NIVEL 1 — Identidad del producto */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">Identidad del producto</h2>
                            {ficha.articulo_id
                                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">Vinculado al catálogo</span>
                                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[var(--warn)]/10 text-[var(--warn)]">Sin artículo vinculado</span>
                            }
                        </div>
                        {(() => {
                            // Patrón ??:  columna propia de fichas_tecnicas → JOIN → null
                            // Funciona antes y después de v41a (cuando las columnas no existen, ?? cae al JOIN)
                            const sku      = art?.articulo_id ?? null;
                            const marca    = ficha.marca    ?? art?.marca    ?? null;
                            const modelo   = ficha.modelo   ?? art?.modelo   ?? null;
                            const variante = ficha.variante ?? art?.variante ?? null;
                            const ean      = ficha.codigo_universal ?? art?.codigo_universal ?? null;
                            const categ    = ficha.categoria ?? art?.categoria ?? null;
                            const pesoKg   = ficha.peso_kg  ?? art?.peso_kg  ?? null;
                            const largoCm  = ficha.largo_cm ?? art?.largo_cm ?? null;
                            const anchoCm  = ficha.ancho_cm ?? art?.ancho_cm ?? null;
                            const altoCm   = ficha.alto_cm  ?? art?.alto_cm  ?? null;
                            const mats     = ficha.materiales ?? null;
                            const pais     = ficha.pais_origen ?? null;
                            const inputCls = "w-full p-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none";
                            const numCls   = "w-full p-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none";
                            return (
                                <>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                                        {sku && <div><Label>SKU</Label><p className="font-mono font-bold text-[var(--text)]">{sku}</p></div>}

                                        {/* Marca */}
                                        <div>
                                            <Label>Marca</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.marca ?? ''} onChange={e => setDraft(d => ({ ...d, marca: e.target.value }))} />
                                                : <p className="font-semibold text-[var(--text)]">{marca ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>

                                        {/* Modelo */}
                                        <div>
                                            <Label>Modelo</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.modelo ?? ''} onChange={e => setDraft(d => ({ ...d, modelo: e.target.value }))} />
                                                : <p className="text-[var(--text-muted)]">{modelo ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>

                                        {/* Variante */}
                                        <div>
                                            <Label>Variante</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.variante ?? ''} onChange={e => setDraft(d => ({ ...d, variante: e.target.value }))} />
                                                : <p className="text-[var(--text-muted)]">{variante ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>

                                        {/* Fabricante */}
                                        {(ficha.fabricante || marca || editMode) && (
                                            <div className="col-span-2 sm:col-span-1">
                                                <Label>Fabricante</Label>
                                                {editMode
                                                    ? <input className={inputCls} value={draft.fabricante ?? ''} onChange={e => setDraft(d => ({ ...d, fabricante: e.target.value }))} />
                                                    : <p className="text-[var(--text-muted)]">{ficha.fabricante}</p>}
                                            </div>
                                        )}

                                        {/* EAN / Código Universal */}
                                        <div>
                                            <Label>Código de barras (EAN)</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.codigo_universal ?? ''} onChange={e => setDraft(d => ({ ...d, codigo_universal: e.target.value }))} placeholder="EAN / UPC / GTIN" />
                                                : <p className="font-mono text-[var(--text-muted)]">{ean ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>

                                        {/* Categoría */}
                                        <div>
                                            <Label>Categoría</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.categoria ?? ''} onChange={e => setDraft(d => ({ ...d, categoria: e.target.value }))} />
                                                : <p className="text-[var(--text-muted)]">{categ ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>

                                        {/* Materiales */}
                                        <div>
                                            <Label>Materiales</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.materiales ?? ''} onChange={e => setDraft(d => ({ ...d, materiales: e.target.value }))} />
                                                : <p className="text-[var(--text-muted)]">{mats ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>

                                        {/* País de origen */}
                                        <div>
                                            <Label>País de origen</Label>
                                            {editMode
                                                ? <input className={inputCls} value={draft.pais_origen ?? ''} onChange={e => setDraft(d => ({ ...d, pais_origen: e.target.value }))} />
                                                : <p className="text-[var(--text-muted)]">{pais ?? <span className="text-slate-300 italic text-xs">—</span>}</p>}
                                        </div>
                                    </div>

                                    {/* Dimensiones y peso */}
                                    {(pesoKg || largoCm || anchoCm || altoCm || editMode) && (
                                        <div className="border-t border-[var(--border)] pt-3">
                                            <Label>Dimensiones y peso</Label>
                                            {editMode ? (
                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
                                                    <div><label className="text-[10px] text-[var(--text-faint)]">Largo (cm)</label><input type="number" className={numCls} value={draft.largo_cm ?? ''} onChange={e => setDraft(d => ({ ...d, largo_cm: e.target.value === '' ? undefined : Number(e.target.value) }))} /></div>
                                                    <div><label className="text-[10px] text-[var(--text-faint)]">Ancho (cm)</label><input type="number" className={numCls} value={draft.ancho_cm ?? ''} onChange={e => setDraft(d => ({ ...d, ancho_cm: e.target.value === '' ? undefined : Number(e.target.value) }))} /></div>
                                                    <div><label className="text-[10px] text-[var(--text-faint)]">Alto (cm)</label><input type="number" className={numCls} value={draft.alto_cm ?? ''} onChange={e => setDraft(d => ({ ...d, alto_cm: e.target.value === '' ? undefined : Number(e.target.value) }))} /></div>
                                                    <div><label className="text-[10px] text-[var(--text-faint)]">Peso (kg)</label><input type="number" className={numCls} value={draft.peso_kg ?? ''} onChange={e => setDraft(d => ({ ...d, peso_kg: e.target.value === '' ? undefined : Number(e.target.value) }))} /></div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-wrap gap-4 mt-1 text-sm">
                                                    {largoCm && <span className="text-[var(--text-muted)]"><b>L:</b> {largoCm} cm</span>}
                                                    {anchoCm && <span className="text-[var(--text-muted)]"><b>A:</b> {anchoCm} cm</span>}
                                                    {altoCm  && <span className="text-[var(--text-muted)]"><b>H:</b> {altoCm} cm</span>}
                                                    {pesoKg  && <span className="text-[var(--text-muted)]"><b>Peso:</b> {pesoKg} kg</span>}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                        {art && (
                            <div className="border-t border-[var(--border)] pt-2 flex items-center gap-3 flex-wrap">
                                <Link href={`/catalog?q=${art.articulo_id}`} target="_blank"
                                    className="inline-flex items-center gap-1 text-[var(--accent)] hover:text-indigo-700 text-xs font-semibold">
                                    <Link2 className="w-3 h-3" /> Ver en catálogo <ExternalLink className="w-3 h-3" />
                                </Link>
                                <button type="button" onClick={() => { setVinculandoModal(true); setVinculandoQ(art.articulo_id); }}
                                    className="inline-flex items-center gap-1 text-amber-500 hover:text-[var(--warn)] text-xs font-semibold">
                                    <Link2 className="w-3 h-3" /> Cambiar artículo
                                </button>
                                <button type="button" onClick={desvincularArticulo}
                                    className="inline-flex items-center gap-1 text-rose-400 hover:text-[var(--err)] text-xs font-semibold">
                                    <Unlink className="w-3 h-3" /> Desvincular
                                </button>
                            </div>
                        )}
                        {!art && (
                            <div className="p-3 bg-[var(--warn)]/10 border border-[var(--warn)]/30 rounded-xl text-xs text-[var(--warn)] flex items-center justify-between gap-3">
                                <span>Sin artículo del catálogo vinculado.{' '}
                                    <Link href="/autoficha" className="underline font-semibold">Ir a Crear con IA</Link>
                                </span>
                                <button type="button" onClick={() => setVinculandoModal(true)}
                                    className="shrink-0 inline-flex items-center gap-1 px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold rounded-lg transition-colors">
                                    <Link2 className="w-3 h-3" /> Vincular artículo
                                </button>
                            </div>
                        )}
                    </div>


                    {/* NIVEL 2 — Descripción comercial */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-4">
                        <h2 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">Descripción comercial</h2>
                        {editMode ? (
                            <div className="space-y-3">
                                <EditField label="Descripción corta" value={draft.descripcion} onChange={v => setDraft(d => ({ ...d, descripcion: v }))} type="textarea" />
                                <EditField label="Descripción extendida" value={draft.descripcion_larga} onChange={v => setDraft(d => ({ ...d, descripcion_larga: v }))} type="textarea" />
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <TextBlock label="Descripción corta" value={ficha.descripcion} />
                                <TextBlock label="Descripción extendida" value={ficha.descripcion_larga} />
                            </div>
                        )}

                        {/* Bullet points */}
                        {(ficha.bullet_points?.length || editMode) ? (
                            <div>
                                <Label>Puntos clave</Label>
                                {editMode ? (
                                    <div className="space-y-1.5 mt-1">
                                        {(draft.bullet_points ?? []).map((bp, i) => (
                                            <div key={i} className="flex gap-2">
                                                <input value={bp} onChange={e => {
                                                    const arr = [...(draft.bullet_points ?? [])]; arr[i] = e.target.value;
                                                    setDraft(d => ({ ...d, bullet_points: arr }));
                                                }} className="flex-1 p-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none" />
                                                <button type="button" onClick={() => setDraft(d => ({ ...d, bullet_points: (d.bullet_points ?? []).filter((_, j) => j !== i) }))}
                                                    className="text-slate-300 hover:text-[var(--err)] shrink-0"><X className="w-4 h-4" /></button>
                                            </div>
                                        ))}
                                        <button type="button" onClick={() => setDraft(d => ({ ...d, bullet_points: [...(d.bullet_points ?? []), ''] }))}
                                            className="text-xs text-[var(--accent)] hover:text-indigo-700">+ Agregar punto</button>
                                    </div>
                                ) : (
                                    <ul className="mt-1 space-y-1">
                                        {(ficha.bullet_points ?? []).map((bp, i) => (
                                            <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
                                                <span className="text-indigo-400 shrink-0 mt-0.5">▸</span>{bp}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* NIVEL 3 — Especificaciones técnicas */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-4">
                        <h2 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">Especificaciones técnicas</h2>
                        {editMode ? (
                            <div className="space-y-4">
                                <EditField label="Especificaciones (texto)" value={draft.especificaciones} onChange={v => setDraft(d => ({ ...d, especificaciones: v }))} type="textarea" />
                                {/* Editor KV para cada JSONB */}
                                {(['atributos_dinamicos', 'atributos_categoria', 'atributos_extras'] as const).map(campo => {
                                    const LBL: Record<string, string> = { atributos_dinamicos: 'Atributos técnicos (IA)', atributos_categoria: 'Atributos de categoría', atributos_extras: 'Atributos adicionales' };
                                    const obj = (draft[campo] ?? {}) as Record<string, any>;
                                    return (
                                        <div key={campo}>
                                            <Label>{LBL[campo]}</Label>
                                            <div className="space-y-1.5 mt-1">
                                                {Object.entries(obj).map(([k, v]) => (
                                                    <div key={k} className="flex gap-1.5 items-center">
                                                        <input value={k.startsWith('__n_') ? '' : k} placeholder="Nombre del atributo" onChange={e => { const nk = e.target.value || k; const r: Record<string,any> = {}; for (const [ek,ev] of Object.entries((draft as Record<string,any>)[campo] ?? {})) r[ek === k ? nk : ek] = ev; setDraft(d => ({...d, [campo]: r})); }} className="w-2/5 p-1.5 text-xs border border-slate-300 rounded-lg focus:ring-1 focus:ring-indigo-400 outline-none text-[var(--text-muted)] placeholder-slate-300" />
                                                        <input value={String(v ?? '')} onChange={e => setDraft(d => ({ ...d, [campo]: { ...((d[campo] ?? {}) as object), [k]: e.target.value } }))} className="flex-1 p-1.5 text-xs bg-[var(--bg)] border border-[var(--border)] rounded-lg focus:ring-1 focus:ring-indigo-400 outline-none" />
                                                        <button type="button" onClick={() => {
                                                            const copy = { ...(draft[campo] as Record<string, any>) }; delete copy[k];
                                                            setDraft(d => ({ ...d, [campo]: copy }));
                                                        }} className="text-slate-300 hover:text-[var(--err)]"><X className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                ))}
                                                <button type="button" onClick={() => {
                                                    const key = `__n_${Date.now()}`;
                                                    setDraft(d => ({ ...d, [campo]: { ...((d[campo] ?? {}) as object), [key]: '' } }));
                                                }} className="text-xs text-[var(--accent)] hover:text-indigo-700">+ Agregar atributo</button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <>
                                {ficha.especificaciones && (
                                    specsKV
                                        ? <KVGrid data={specsKV} label="Especificaciones" />
                                        : <TextBlock label="Especificaciones" value={ficha.especificaciones} />
                                )}
                                {hasAtribCat && <KVGrid data={ficha.atributos_categoria!} label="Atributos de categoría" />}
                                {hasAtribDin && <KVGrid data={ficha.atributos_dinamicos!} label="Atributos técnicos (IA)" />}
                                {hasAtribExt && <KVGrid data={ficha.atributos_extras!}    label="Atributos adicionales" />}
                                {!ficha.especificaciones && !hasAtribDin && !hasAtribCat && !hasAtribExt && (
                                    <div className="flex flex-col items-center gap-2 py-4 border-2 border-dashed border-[var(--border)] rounded-xl text-center">
                                        <p className="text-xs text-[var(--text-faint)]">Sin especificaciones técnicas aún.</p>
                                        <p className="text-xs text-indigo-400 font-semibold">Usa "Enriquecer" para extraerlas de un documento.</p>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* NIVEL 4 — Información complementaria */}
                    {(ficha.uso_recomendado || ficha.precauciones || ficha.ingredientes || editMode) && (
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-4">
                            <h2 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">Información complementaria</h2>
                            {editMode ? (
                                <div className="space-y-3">
                                    <EditField label="Uso recomendado" value={draft.uso_recomendado} onChange={v => setDraft(d => ({ ...d, uso_recomendado: v }))} type="textarea" />
                                    <EditField label="Precauciones" value={draft.precauciones} onChange={v => setDraft(d => ({ ...d, precauciones: v }))} type="textarea" />
                                    <EditField label="Ingredientes / Composición" value={draft.ingredientes} onChange={v => setDraft(d => ({ ...d, ingredientes: v }))} type="textarea" />
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    <TextBlock label="Uso recomendado" value={ficha.uso_recomendado} />
                                    <TextBlock label="Precauciones" value={ficha.precauciones} />
                                    <TextBlock label="Ingredientes / Composición" value={ficha.ingredientes} />
                                </div>
                            )}
                        </div>
                    )}

                    {/* NIVEL 5 — Marketplace */}
                    {(ficha.palabras_clave?.length || editMode) ? (
                        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-3">
                            <h2 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-2">
                                <Tag className="w-4 h-4" /> Marketplace
                            </h2>
                            <div>
                                <Label>Palabras clave</Label>
                                {editMode ? (
                                    <div className="space-y-2 mt-1">
                                        <div className="flex flex-wrap gap-1.5">
                                            {(draft.palabras_clave ?? []).map((kw, i) => (
                                                <span key={i} className="flex items-center gap-1 bg-[var(--accent)]/10 text-indigo-700 text-xs px-2 py-1 rounded-full">
                                                    {kw}
                                                    <button type="button" onClick={() => setDraft(d => ({ ...d, palabras_clave: (d.palabras_clave ?? []).filter((_, j) => j !== i) }))}
                                                        className="hover:text-[var(--err)]"><X className="w-2.5 h-2.5" /></button>
                                                </span>
                                            ))}
                                        </div>
                                        <input placeholder="Agregar keyword y Enter" onKeyDown={e => {
                                            if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                setDraft(d => ({ ...d, palabras_clave: [...(d.palabras_clave ?? []), e.currentTarget.value.trim()] }));
                                                e.currentTarget.value = '';
                                            }
                                        }} className="w-full p-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:ring-1 focus:ring-[var(--accent)] outline-none" />
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-1.5 mt-1">
                                        {(ficha.palabras_clave ?? []).map((kw, i) => (
                                            <span key={i} className="bg-[var(--accent)]/10 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full">{kw}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : null}

                    {/* Historial de extracciones (colapsable) */}
                    {ficha.ficha_extracciones && ficha.ficha_extracciones.length > 0 && (
                        <details className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-sm">
                            <summary className="px-6 py-4 cursor-pointer text-sm font-bold text-[var(--text-muted)] flex items-center gap-2 list-none">
                                <FileText className="w-4 h-4 text-[var(--text-faint)]" />
                                Historial de extracciones ({ficha.ficha_extracciones.length})
                                <ChevronRight className="w-4 h-4 text-slate-300 ml-auto" />
                            </summary>
                            <div className="px-6 pb-5 space-y-2 border-t border-[var(--border)] pt-3">
                                {ficha.ficha_extracciones.map(e => (
                                    <div key={e.id} className="p-3 bg-[var(--bg)] rounded-xl text-xs space-y-1">
                                        <div className="flex items-center justify-between gap-2">
                                            <span className="font-mono text-[var(--text-faint)]">{e.id.slice(0, 8)}…</span>
                                            <div className="flex items-center gap-2">
                                                {e.aplicada_a_ficha
                                                    ? <span className="text-[var(--ok)] font-semibold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Aplicada</span>
                                                    : <span className="text-[var(--warn)] font-semibold">Pendiente</span>}
                                                <span className="text-[var(--text-faint)]">{new Date(e.created_at).toLocaleDateString('es-MX')}</span>
                                            </div>
                                        </div>
                                        {e.extraccion_cruda?.nombre && <p className="text-[var(--text-muted)]">Nombre: <strong>{String(e.extraccion_cruda.nombre)}</strong></p>}
                                        {e.extraccion_cruda?.confidence != null && <p className="text-[var(--text-faint)]">Confianza: {Math.round(Number(e.extraccion_cruda.confidence) * 100)}%</p>}
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}

                    {/* -- Imágenes del producto --------------------------------- */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 shadow-sm space-y-4">
                        <div className="flex items-center justify-between">
                            <h2 className="text-sm font-bold text-[var(--text-muted)] uppercase tracking-widest">Imágenes del producto</h2>
                            <div className="flex items-center gap-2">
                                {imagenesLoading && <Loader2 className="w-4 h-4 animate-spin text-slate-300" />}
                                <span className="text-xs text-[var(--text-faint)]">{imagenes.length} imagen{imagenes.length !== 1 ? 'es' : ''} • WebP</span>
                            </div>
                        </div>

                        {imagenesError && (
                            <p className="text-xs text-[var(--err)] font-medium">{imagenesError}</p>
                        )}

                        {/* Miniaturas con reordenamiento */}
                        {imagenes.length > 0 && (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                                {imagenes.map((img, idx) => (
                                    <div key={img.id} className="group relative aspect-square rounded-xl overflow-hidden border-2 border-[var(--border)] bg-[var(--bg)] hover:border-[var(--accent)]/50 transition-all">
                                        {/* Badge de orden */}
                                        <span className="absolute top-1.5 left-1.5 z-10 bg-[var(--surface-2)]/70 text-[var(--accent-ink)] text-[9px] font-bold px-1.5 py-0.5 rounded-md">
                                            #{idx + 1}
                                        </span>
                                        {/* Badge imagen principal */}
                                        {idx === 0 && (
                                            <span className="absolute top-1.5 right-1.5 z-10 bg-[var(--ok)]/100 text-[var(--accent-ink)] text-[8px] font-bold px-1 py-0.5 rounded">PRINCIPAL</span>
                                        )}
                                        <img src={img.url} alt={`Imagen ${idx + 1}`} className="w-full h-full object-cover" loading="lazy"
                                            onError={e => { (e.currentTarget as HTMLImageElement).src = ''; (e.currentTarget as HTMLImageElement).style.opacity = '0.3'; }} />
                                        {/* Overlay de controles */}
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100">
                                            <button type="button" onClick={() => reorderImagen(idx, -1)} disabled={idx === 0}
                                                className="p-1.5 bg-[var(--surface)]/90 hover:bg-[var(--surface)] rounded-lg disabled:opacity-30 transition-all" title="Mover adelante">
                                                <ArrowLeft className="w-3 h-3" />
                                            </button>
                                            <button type="button" onClick={() => reorderImagen(idx, 1)} disabled={idx === imagenes.length - 1}
                                                className="p-1.5 bg-[var(--surface)]/90 hover:bg-[var(--surface)] rounded-lg disabled:opacity-30 transition-all" title="Mover atrás">
                                                <ArrowLeft className="w-3 h-3 rotate-180" />
                                            </button>
                                            <button type="button" onClick={() => deleteImagen(img.id)} disabled={imgSaving.has(img.id)}
                                                className="p-1.5 bg-[var(--err)]/100 hover:bg-rose-600 text-[var(--accent-ink)] rounded-lg disabled:opacity-60 transition-all" title="Eliminar">
                                                {imgSaving.has(img.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Input URL directa */}
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Agregar por URL directa</label>
                            <div className="flex gap-2">
                                <input type="url" value={imgUrlInput}
                                    onChange={e => setImgUrlInput(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && addImageFromUrl()}
                                    placeholder="https://...imagen.jpg"
                                    className="flex-1 px-3 py-2 text-sm border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                                <button type="button" onClick={addImageFromUrl} disabled={!imgUrlInput.trim() || imgUrlLoading}
                                    className="px-4 py-2 bg-[var(--surface)] hover:bg-slate-700 text-[var(--accent-ink)] text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-2 transition-colors">
                                    {imgUrlLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                                    Agregar
                                </button>
                            </div>
                        </div>

                        {/* Upload archivo (Múltiple y Cámara) */}
                        <div className="space-y-3">
                            <label className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider">Subir desde dispositivo (máx 10)</label>
                            
                            <input id="img-upload-camera" type="file" accept="image/*" capture="environment" className="hidden"
                                onChange={async e => { 
                                    if (e.target.files && e.target.files.length > 0) {
                                        await addImagesFromFiles(e.target.files); 
                                    }
                                    e.target.value = ''; 
                                }} />
                                
                            <input id="img-upload-gallery" type="file" accept="image/*" multiple className="hidden"
                                onChange={async e => { 
                                    if (e.target.files && e.target.files.length > 0) {
                                        await addImagesFromFiles(e.target.files); 
                                    }
                                    e.target.value = ''; 
                                }} />
                            
                            <div className="grid grid-cols-2 gap-3">
                                <button type="button" onClick={() => document.getElementById('img-upload-camera')?.click()} disabled={imgUrlLoading}
                                    className="py-2.5 rounded-xl border-2 border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text-muted)] hover:border-[var(--accent)]/70 hover:text-[var(--accent)] transition-colors flex items-center justify-center gap-2 font-semibold">
                                    <Upload className="w-4 h-4" /> Tomar Foto
                                </button>
                                <button type="button" onClick={() => document.getElementById('img-upload-gallery')?.click()} disabled={imgUrlLoading}
                                    className="py-2.5 rounded-xl border-2 border-dashed border-slate-300 text-sm text-[var(--text-muted)] hover:border-[var(--accent)]/70 hover:text-[var(--accent)] transition-colors flex items-center justify-center gap-2">
                                    <Upload className="w-4 h-4" /> Elegir Galería
                                </button>
                            </div>
                            <p className="text-[10px] text-[var(--text-faint)] text-center">Se convierten y optimizan a WebP automáticamente al subir.</p>
                        </div>

                        {/* Extracción con IA desde URL de página */}
                        <details className="border border-[var(--border)] rounded-xl overflow-hidden">
                            <summary className="px-4 py-3 cursor-pointer text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider flex items-center gap-2 list-none hover:bg-[var(--bg)] transition-colors">
                                <Sparkles className="w-3.5 h-3.5 text-violet-500" />
                                Extraer imágenes desde página web con IA
                                <ChevronRight className="w-3.5 h-3.5 ml-auto text-slate-300" />
                            </summary>
                            <div className="px-4 pb-4 pt-3 space-y-3 border-t border-[var(--border)]">
                                <p className="text-[11px] text-[var(--text-faint)]">Pega la URL de una página de producto. La IA identificará las imágenes relevantes para que tú elijas cuáles guardar.</p>
                                <div className="flex gap-2">
                                    <input type="url" value={imgExtractUrl}
                                        onChange={e => setImgExtractUrl(e.target.value)}
                                        placeholder="https://prod.fabrica.com/producto"
                                        className="flex-1 px-3 py-2 text-sm border border-[var(--border)] rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-400" />
                                    <button type="button" onClick={extractImagenesFromUrl}
                                        disabled={!imgExtractUrl.trim() || imgExtractLoading}
                                        className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-[var(--accent-ink)] text-sm font-bold rounded-xl disabled:opacity-50 flex items-center gap-2 transition-colors">
                                        {imgExtractLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                                        Analizar
                                    </button>
                                </div>
                            </div>
                        </details>

                        {imagenes.length === 0 && !imagenesLoading && (
                            <div className="flex flex-col items-center gap-2 py-4 border-2 border-dashed border-[var(--border)] rounded-xl text-center">
                                <p className="text-xs text-[var(--text-faint)]">Sin imágenes aún.</p>
                                <p className="text-xs text-[var(--text-faint)]">La primera imagen será la imagen principal en MeLi.</p>
                            </div>
                        )}
                    </div>

                    {/* Precios y Publicación MeLi — visible solo si la ficha tiene artículo vinculado */}
                    {ficha.articulo_id && (
                        <>
                            <PricesSection
                                articulo_id={ficha.articulo_id}
                                modeloDefault={(ficha.articulos as any)?.modelo ?? null}
                            />
                            <PublishPanel
                                articulo_id={ficha.articulo_id}
                                nombreArticulo={ficha.nombre_producto || ficha.articulo_id}
                                ficha_id={ficha.id}
                                imagenesBase={(ficha.articulos as any)?.imagenes ?? []}
                            />
                        </>
                    )}

                </div>{/* fin columna principal */}

                {/* -- Sidebar -- */}
                <div className="space-y-4">

                    {/* Enriquecer */}
                    <div className="bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-5 text-[var(--accent-ink)] shadow-lg space-y-3">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5" />
                            <h3 className="text-sm font-bold">Enriquecer ficha</h3>
                        </div>
                        {enrichedMsg && (
                            <p className="text-xs bg-[var(--surface)]/20 rounded-lg px-3 py-2 text-[var(--accent-ink)]">{enrichedMsg}</p>
                        )}
                        {!enrichOpen ? (
                            <div className="space-y-2">
                                <button type="button" onClick={() => { setEnrichOpen(true); setEnrichedMsg(''); setEnrichError(''); }}
                                    className="w-full py-2.5 px-4 rounded-xl text-sm font-bold bg-[var(--surface)] text-indigo-700 hover:bg-[var(--accent)]/10 transition-colors flex items-center justify-center gap-2">
                                    <Upload className="w-4 h-4" /> Agregar documento
                                </button>
                                {ficha.articulos && (
                                    <button type="button" onClick={enrichFromCatalog}
                                        className="w-full py-2 px-4 rounded-xl text-xs font-semibold border border-[var(--accent)]/70 text-indigo-100 hover:bg-[var(--surface)]/10 transition-colors flex items-center justify-center gap-2">
                                        <Link2 className="w-3.5 h-3.5" /> Enriquecer desde catálogo
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {/* --- Campo: Producto objetivo --- */}
                                <div className="bg-[var(--surface)]/10 rounded-xl p-3 space-y-1.5">
                                    <label className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest flex items-center gap-1">
                                        🎯 Producto a extraer
                                        <span className="font-normal normal-case text-indigo-300 ml-1">(opcional)</span>
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="Ej: Würth 8890402, grasa multiuso..."
                                        value={enrichProductoObjetivo}
                                        onChange={e => setEnrichProductoObjetivo(e.target.value)}
                                        className="w-full p-2 rounded-lg bg-indigo-700/60 border border-[var(--accent)] text-xs text-[var(--accent-ink)] placeholder-indigo-300 focus:outline-none focus:ring-1 focus:ring-white/50"
                                    />
                                    <p className="text-[10px] text-indigo-300 leading-tight">
                                        Si el documento tiene varios productos (catálogo, tabla comparativa), indica nombre, modelo o SKU del que quieres extraer.
                                    </p>
                                </div>

                                {/* --- PASO 1: Selector de campos --- */}
                                <div className="bg-indigo-800/60 rounded-xl p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] font-bold text-indigo-200 uppercase tracking-widest">Campos a extraer</p>
                                        <div className="flex gap-2">
                                            <button type="button" onClick={() => setEnrichCampos(new Set(TODOS_CAMPOS_ENRICH.map(c => c.key)))}
                                                className="text-[10px] text-indigo-300 hover:text-[var(--accent-ink)]">Todos</button>
                                            <button type="button" onClick={() => setEnrichCampos(new Set())}
                                                className="text-[10px] text-indigo-300 hover:text-[var(--accent-ink)]">Ninguno</button>
                                        </div>
                                    </div>
                                    {(['Identidad','Descripción','Uso y seguridad','Regulatorio','Logística','Marketing'] as const).map(grupo => {
                                        const campos = TODOS_CAMPOS_ENRICH.filter(c => c.grupo === grupo);
                                        const todosGrupo = campos.every(c => enrichCampos.has(c.key));
                                        return (
                                            <div key={grupo}>
                                                <button type="button" onClick={() => {
                                                    setEnrichCampos(prev => {
                                                        const s = new Set(prev);
                                                        if (todosGrupo) campos.forEach(c => s.delete(c.key));
                                                        else campos.forEach(c => s.add(c.key));
                                                        return s;
                                                    });
                                                }} className="text-[10px] font-bold text-indigo-300 hover:text-[var(--accent-ink)] mb-1 flex items-center gap-1">
                                                    {todosGrupo ? '▾' : '▸'} {grupo}
                                                </button>
                                                <div className="grid grid-cols-1 gap-0.5 pl-3">
                                                    {campos.map(c => (
                                                        <label key={c.key} className="flex items-center gap-1.5 cursor-pointer">
                                                            <input type="checkbox" checked={enrichCampos.has(c.key)}
                                                                onChange={e => {
                                                                    setEnrichCampos(prev => {
                                                                        const s = new Set(prev);
                                                                        e.target.checked ? s.add(c.key) : s.delete(c.key);
                                                                        return s;
                                                                    });
                                                                }}
                                                                className="accent-indigo-400 w-3 h-3" />
                                                            <span className="text-[11px] text-indigo-100">{c.label}</span>
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                    {enrichCampos.size === 0 && (
                                        <p className="text-[10px] text-rose-300">Selecciona al menos un campo</p>
                                    )}
                                </div>

                                {/* --- PASO 2: Fuente del documento --- */}
                                <div className="flex gap-1">
                                    {(['file', 'url'] as const).map(m => (
                                        <button key={m} type="button" onClick={() => setEnrichMode(m)}
                                            className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-colors ${enrichMode === m ? 'bg-[var(--surface)] text-indigo-700' : 'text-indigo-200 hover:text-[var(--accent-ink)]'}`}>
                                            {m === 'file' ? '📄 Archivo' : '🔗 URL'}
                                        </button>
                                    ))}
                                </div>
                                {enrichMode === 'file' ? (
                                    <>
                                        <input ref={enrichFileRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" className="hidden"
                                            onChange={e => setEnrichFile(e.target.files?.[0] ?? null)} />
                                        <button type="button" onClick={() => enrichFileRef.current?.click()}
                                            className="w-full py-2 rounded-xl border-2 border-dashed border-[var(--accent)]/70 text-xs text-indigo-200 hover:border-white hover:text-[var(--accent-ink)] transition-colors">
                                            {enrichFile ? enrichFile.name : 'Seleccionar archivo…'}
                                        </button>
                                    </>
                                ) : (
                                    <input type="url" placeholder="https://…/ficha.pdf" value={enrichUrl}
                                        onChange={e => setEnrichUrl(e.target.value)}
                                        className="w-full p-2 rounded-xl bg-indigo-700 border border-[var(--accent)] text-xs text-[var(--accent-ink)] placeholder-indigo-300 focus:outline-none" />
                                )}
                                {enrichError && <p className="text-xs text-rose-200">{enrichError}</p>}
                                <div className="flex gap-2">
                                    <button type="button" onClick={() => { setEnrichOpen(false); setEnrichFile(null); setEnrichUrl(''); setEnrichError(''); }}
                                        className="flex-1 py-2 rounded-xl text-xs border border-[var(--accent)]/70 text-indigo-200 hover:text-[var(--accent-ink)] transition-colors">Cancelar</button>
                                    <button type="button" onClick={lanzarEnriquecimiento}
                                        disabled={enrichLoading || enrichCampos.size === 0}
                                        className="flex-1 py-2 rounded-xl text-xs font-bold bg-[var(--surface)] text-indigo-700 hover:bg-[var(--accent)]/10 transition-colors disabled:opacity-60 flex items-center justify-center gap-1">
                                        {enrichLoading ? <><Loader2 className="w-3 h-3 animate-spin" />Procesando…</> : `Extraer (${enrichCampos.size} campos)`}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Cambiar estado */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-3">
                        <h3 className="text-sm font-bold">Estado</h3>
                        <div className="space-y-2">
                            {ESTADOS.map(e => (
                                <button key={e} type="button" onClick={() => cambiarEstado(e)} disabled={saving || ficha.estado === e}
                                    className={`w-full py-2.5 px-4 rounded-xl text-sm font-semibold border transition-colors ${ficha.estado === e ? 'bg-[var(--accent)] text-[var(--accent-ink)] border-indigo-600' : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:border-[var(--accent)]/50'}`}>
                                    {e === 'borrador' ? '📝 Borrador' : e === 'revision' ? '🔍 En revisión' : '✅ Publicada'}
                                </button>
                            ))}
                        </div>
                        {savedOk && <p className="text-xs text-[var(--ok)] font-semibold text-center">✓ Estado actualizado</p>}
                    </div>

                    {/* Completitud */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-2">
                        <h3 className="text-sm font-bold">Completitud</h3>
                        <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                                <div className={`h-full rounded-full transition-all ${completitudColor}`} style={{ width: `${completitud}%` }} />
                            </div>
                            <span className="text-sm font-bold text-[var(--text-muted)]">{completitud}%</span>
                        </div>
                        <p className="text-xs text-[var(--text-faint)]">{filled} de {totalEval} campos de contenido llenos</p>
                    </div>

                    {/* Autocompletar campos vacíos */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-3">
                        <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-violet-500" />
                            <h3 className="text-sm font-bold">Autocompletar campos</h3>
                        </div>
                        {autocompletarMsg && (
                            <p className={`text-xs rounded-lg px-3 py-2 font-medium ${
                                autocompletarMsg.startsWith('✓')
                                    ? 'bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/30'
                                    : 'bg-[var(--warn)]/10 text-[var(--warn)] border border-[var(--warn)]/30'
                            }`}>{autocompletarMsg}</p>
                        )}
                        <p className="text-[11px] text-[var(--text-faint)] leading-relaxed">
                            Analiza el texto existente y sugiere valores para campos vacíos (materiales, regulatorio, etc.). Tú apruebas campo por campo.
                        </p>
                        <button type="button" onClick={lanzarAutocompletar}
                            disabled={autocompletarLoading || !ficha.descripcion_larga && !ficha.descripcion && !ficha.especificaciones}
                            className="w-full py-2.5 px-4 rounded-xl text-sm font-bold bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                            {autocompletarLoading
                                ? <><Loader2 className="w-4 h-4 animate-spin" />Analizando…</>
                                : <><Sparkles className="w-4 h-4" />Sugerir campos vacíos</>}
                        </button>
                    </div>

                    {/* Acciones */}
                    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-5 shadow-sm space-y-2">
                        <h3 className="text-sm font-bold">Acciones</h3>
                        <Link href="/fichas" className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] text-center transition-colors">
                            ← Listado de fichas
                        </Link>
                        <Link href="/autoficha" className="block w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-[var(--accent)]/10 text-indigo-700 border border-[var(--accent)]/30 hover:bg-[var(--accent)]/20 text-center transition-colors">
                            Nueva ficha con IA
                        </Link>
                        {ficha.estado !== 'publicado' && (
                            <button type="button" onClick={eliminarFicha} disabled={deleting}
                                className="w-full py-2.5 px-4 rounded-xl text-sm font-semibold bg-[var(--err)]/10 text-[var(--err)] border border-[var(--err)]/30 hover:bg-rose-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-60">
                                {deleting ? <><Loader2 className="w-4 h-4 animate-spin" />Eliminando…</> : <><Trash2 className="w-4 h-4" />Eliminar ficha</>}
                            </button>
                        )}
                    </div>

                    {/* Metadata */}
                    <div className="text-xs text-[var(--text-faint)] space-y-1 px-1">
                        <p>Creada: {new Date(ficha.created_at).toLocaleString('es-MX')}</p>
                    </div>
                </div>
            </div>

            {/* -- Overlay: Descubriendo productos (Etapa 1) -- */}
            {enrichStep === 'discovering' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-[var(--surface)] rounded-2xl shadow-2xl p-8 flex flex-col items-center gap-4 max-w-sm w-full">
                        <Loader2 className="w-10 h-10 animate-spin text-[var(--accent)]" />
                        <div className="text-center">
                            <p className="font-bold text-[var(--text-muted)]">Analizando el documento…</p>
                            <p className="text-xs text-[var(--text-faint)] mt-1">Identificando todos los productos para que puedas elegir el exacto.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* -- Modal: Elegir producto (Etapa 1.5) -- */}
            {enrichStep === 'picking' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-[var(--border)]">
                            <h2 className="text-lg font-bold">Elige el producto a extraer</h2>
                            <p className="text-xs text-[var(--text-faint)] mt-0.5">
                                Se encontraron {productosDescubiertos.length} producto(s) en el documento.
                                Selecciona el que quieres enriquecer en la ficha.
                            </p>
                        </div>

                        <div className="overflow-y-auto flex-1 p-4 space-y-2">
                            {/* Opción: escribir manualmente */}
                            <label className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] hover:border-[var(--accent)]/50 cursor-pointer transition-colors">
                                <input type="radio" name="producto_pick" value="__manual__"
                                    checked={!productosDescubiertos.some(p =>
                                        `${p.nombre}${p.codigo ? ' ' + p.codigo : ''}` === productoSeleccionado
                                    ) && productoSeleccionado !== ''}
                                    onChange={() => {}}
                                    className="accent-indigo-600 mt-0.5 shrink-0" />
                                <div className="flex-1">
                                    <p className="text-xs font-bold text-[var(--text-muted)] uppercase">Otro / Escribir manualmente</p>
                                    <input
                                        type="text"
                                        placeholder="Nombre o código del producto..."
                                        value={productosDescubiertos.some(p =>
                                            `${p.nombre}${p.codigo ? ' ' + p.codigo : ''}` === productoSeleccionado
                                        ) ? '' : productoSeleccionado}
                                        onChange={e => setProductoSeleccionado(e.target.value)}
                                        onClick={() => setProductoSeleccionado('')}
                                        className="mt-1 w-full p-2 text-sm border border-[var(--border)] rounded-lg focus:ring-1 focus:ring-indigo-400 outline-none"
                                    />
                                </div>
                            </label>

                            {/* Productos descubiertos */}
                            {productosDescubiertos.map((p, i) => {
                                const val = `${p.nombre}${p.codigo ? ' ' + p.codigo : ''}`;
                                return (
                                    <label key={i} onClick={() => setProductoSeleccionado(val)}
                                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${productoSeleccionado === val ? 'border-[var(--accent)]/70 bg-[var(--accent)]/10 ring-1 ring-indigo-400' : 'border-[var(--border)] hover:border-[var(--accent)]/30'}`}>
                                        <input type="radio" name="producto_pick" value={val}
                                            checked={productoSeleccionado === val}
                                            onChange={() => setProductoSeleccionado(val)}
                                            className="accent-indigo-600 mt-0.5 shrink-0" />
                                        <div>
                                            <p className="text-sm font-semibold text-[var(--text-muted)]">{p.nombre}</p>
                                            {p.codigo && <p className="text-xs font-mono text-[var(--accent)]">{p.codigo}</p>}
                                            {p.descripcion_breve && <p className="text-xs text-[var(--text-faint)] mt-0.5">{p.descripcion_breve}</p>}
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
                            <button type="button"
                                onClick={() => { setEnrichStep('config'); setProductosDescubiertos([]); setProductoSeleccionado(''); }}
                                className="flex-1 py-2.5 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]">
                                Cancelar
                            </button>
                            <button type="button"
                                disabled={!productoSeleccionado.trim() || enrichLoading}
                                onClick={() => lanzarExtraccionConProducto(productoSeleccionado.trim())}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
                                {enrichLoading
                                    ? <><Loader2 className="w-4 h-4 animate-spin" />Extrayendo…</>
                                    : <><Sparkles className="w-4 h-4" />Extraer este producto</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* -- Modal enriquecimiento v2 -- */}
            {showModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                            <div>
                                <h2 className="text-lg font-bold">Revisar datos extraídos</h2>
                                <p className="text-xs text-[var(--text-faint)]">
                                    {conflictos.filter(d => d.accion === 'agregar').length} campo(s) nuevos ·{' '}
                                    {conflictos.filter(d => d.accion === 'conflicto').length} conflicto(s).
                                    Nada se guarda hasta que apruebes.
                                </p>
                                {enrichedMsg && <p className="text-xs text-[var(--ok)] font-semibold mt-1">{enrichedMsg}</p>}
                            </div>
                            <button type="button" onClick={() => setShowModal(false)} className="text-[var(--text-faint)] hover:text-[var(--text-muted)]"><X className="w-5 h-5" /></button>
                        </div>

                        <div className="overflow-y-auto flex-1 p-6 space-y-5">
                            {conflictos.map(d => (
                                <div key={d.campo} className="border border-[var(--border)] rounded-xl overflow-hidden">
                                    <div className="px-4 py-2 bg-[var(--bg)] border-b border-[var(--border)] flex items-center justify-between">
                                        <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{d.label}</p>
                                        <div className="flex items-center gap-2">
                                            {d.accion === 'agregar'
                                                ? <span className="text-[10px] font-bold bg-emerald-100 text-[var(--ok)] px-2 py-0.5 rounded-full">Campo nuevo</span>
                                                : <span className="text-[10px] font-bold bg-amber-100 text-[var(--warn)] px-2 py-0.5 rounded-full">Conflicto</span>
                                            }
                                            <span className="text-[10px] text-[var(--text-faint)] bg-[var(--surface-2)] px-2 py-0.5 rounded-full">{d.tipo}</span>
                                        </div>
                                    </div>

                                    {/* LISTAS — checkboxes de items nuevos */}
                                    {d.tipo === 'lista' && (
                                        <div className="p-4 space-y-2">
                                            <p className="text-[10px] font-bold text-[var(--text-faint)] uppercase mb-2">Items actuales</p>
                                            {(d.valor_actual ?? []).map((item: string) => (
                                                <div key={item} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                                                    <span className="w-3 h-3 rounded border border-slate-300 bg-[var(--surface-2)] shrink-0" />{item}
                                                </div>
                                            ))}
                                            {d.items_nuevos && d.items_nuevos.length > 0 && (
                                                <>
                                                    <p className="text-[10px] font-bold text-[var(--ok)] uppercase mt-3 mb-2">Items nuevos — elige cuáles agregar</p>
                                                    {d.items_nuevos.map((item: string) => {
                                                        const checked = listChecks[d.campo]?.has(item) ?? true;
                                                        return (
                                                            <label key={item} className="flex items-center gap-2 text-xs text-[var(--text-muted)] cursor-pointer">
                                                                <input type="checkbox" checked={checked} onChange={e => {
                                                                    setListChecks(prev => {
                                                                        const s = new Set(prev[d.campo] ?? []);
                                                                        e.target.checked ? s.add(item) : s.delete(item);
                                                                        return { ...prev, [d.campo]: s };
                                                                    });
                                                                }} className="accent-indigo-600" />
                                                                <span className="text-[var(--ok)] font-medium">{item}</span>
                                                            </label>
                                                        );
                                                    })}
                                                </>
                                            )}
                                        </div>
                                    )}

                                    {/* TEXTO — 3 botones + combinar editable */}
                                    {d.tipo === 'texto' && (
                                        <div className="p-4 space-y-3">
                                            <div className="grid grid-cols-2 gap-2">
                                                <button type="button" onClick={() => setSeleccion(s => ({ ...s, [d.campo]: 'actual' }))}
                                                    className={`p-3 rounded-lg text-xs text-left border transition-colors ${seleccion[d.campo] === 'actual' ? 'border-[var(--accent)]/70 bg-[var(--accent)]/10 ring-1 ring-indigo-400' : 'border-[var(--border)] hover:bg-[var(--bg)]'}`}>
                                                    <p className={`font-bold mb-1 text-[10px] uppercase ${seleccion[d.campo] === 'actual' ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
                                                        {seleccion[d.campo] === 'actual' ? '✓ ' : ''}Mantener actual
                                                    </p>
                                                    <p className="text-[var(--text-muted)] line-clamp-3 whitespace-pre-wrap">{formatVal(d.valor_actual)}</p>
                                                </button>
                                                <button type="button" onClick={() => setSeleccion(s => ({ ...s, [d.campo]: 'nuevo' }))}
                                                    className={`p-3 rounded-lg text-xs text-left border transition-colors ${seleccion[d.campo] === 'nuevo' ? 'border-emerald-400 bg-[var(--ok)]/10 ring-1 ring-emerald-400' : 'border-[var(--border)] hover:bg-[var(--bg)]'}`}>
                                                    <p className={`font-bold mb-1 text-[10px] uppercase ${seleccion[d.campo] === 'nuevo' ? 'text-[var(--ok)]' : 'text-[var(--text-faint)]'}`}>
                                                        {seleccion[d.campo] === 'nuevo' ? '✓ ' : ''}Usar nuevo
                                                    </p>
                                                    <p className="text-[var(--text-muted)] line-clamp-3 whitespace-pre-wrap">{formatVal(d.valor_nuevo)}</p>
                                                </button>
                                            </div>
                                            {/* Combinar con IA */}
                                            <div className={`rounded-lg border p-3 space-y-2 transition-colors ${seleccion[d.campo] === 'combinar' ? 'border-violet-400 bg-violet-50' : 'border-[var(--border)]'}`}>
                                                <div className="flex items-center justify-between">
                                                    <p className={`text-[10px] font-bold uppercase ${seleccion[d.campo] === 'combinar' ? 'text-violet-600' : 'text-[var(--text-faint)]'}`}>
                                                        {seleccion[d.campo] === 'combinar' ? '✓ ' : ''}Combinar con IA
                                                    </p>
                                                    <button type="button" onClick={() => combinarConIA(d)} disabled={combinandoField === d.campo}
                                                        className="text-[10px] font-bold text-violet-600 hover:text-violet-800 disabled:opacity-50 flex items-center gap-1">
                                                        {combinandoField === d.campo ? <><Loader2 className="w-3 h-3 animate-spin" />Sintetizando…</> : <><Sparkles className="w-3 h-3" />Sintetizar</>}
                                                    </button>
                                                </div>
                                                {seleccion[d.campo] === 'combinar' && combinados[d.campo] && (
                                                    <textarea value={combinados[d.campo]}
                                                        onChange={e => setCombinados(c => ({ ...c, [d.campo]: e.target.value }))}
                                                        className="w-full p-2 text-xs bg-[var(--surface)] border border-violet-200 rounded-lg resize-none h-20 focus:ring-1 focus:ring-violet-400 outline-none"
                                                        placeholder="Resultado editable…" />
                                                )}
                                                {seleccion[d.campo] !== 'combinar' && !combinados[d.campo] && (
                                                    <p className="text-xs text-[var(--text-faint)]">Haz clic en Sintetizar para que la IA combine ambas versiones.</p>
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* JSONB — checkboxes por atributo */}
                                    {d.tipo === 'jsonb' && (
                                        <div className="p-4 space-y-3">
                                            {d.keys_nuevas && Object.keys(d.keys_nuevas).length > 0 && (
                                                <>
                                                    <p className="text-[10px] font-bold text-[var(--ok)] uppercase mb-2">Atributos nuevos — elige cuáles agregar</p>
                                                    {Object.entries(d.keys_nuevas).map(([k, v]) => {
                                                        const checkKey = `${d.campo}::${k}`;
                                                        const checked = listChecks[checkKey] !== undefined
                                                            ? listChecks[checkKey].has('yes')
                                                            : true; // pre-marcado
                                                        return (
                                                            <label key={k} className="flex items-start gap-2 cursor-pointer">
                                                                <input type="checkbox" checked={checked}
                                                                    onChange={e => {
                                                                        setListChecks(prev => {
                                                                            const s = new Set(prev[checkKey] ?? ['yes']);
                                                                            e.target.checked ? s.add('yes') : s.delete('yes');
                                                                            return { ...prev, [checkKey]: s };
                                                                        });
                                                                    }}
                                                                    className="accent-indigo-600 mt-0.5 shrink-0" />
                                                                <span className="text-xs">
                                                                    <span className="font-semibold text-[var(--text-muted)]">{k}:</span>{' '}
                                                                    <span className="text-[var(--ok)]">{String(v)}</span>
                                                                </span>
                                                            </label>
                                                        );
                                                    })}
                                                </>
                                            )}
                                            {d.keys_conflicto && Object.keys(d.keys_conflicto).length > 0 && (
                                                <>
                                                    <p className="text-[10px] font-bold text-[var(--warn)] uppercase mt-2">En conflicto — elige cuál conservar:</p>
                                                    {Object.entries(d.keys_conflicto).map(([k, vals]) => (
                                                        <div key={k} className="grid grid-cols-2 gap-2">
                                                            <button type="button" onClick={() => setSeleccion(s => ({ ...s, [`${d.campo}::conflict::${k}`]: 'actual' }))}
                                                                className={`p-2 rounded-lg text-xs text-left border ${seleccion[`${d.campo}::conflict::${k}`] !== 'nuevo' ? 'border-[var(--accent)]/70 bg-[var(--accent)]/10' : 'border-[var(--border)]'}`}>
                                                                <p className="text-[10px] text-[var(--text-faint)] font-bold">{k} (actual)</p>
                                                                <p className="text-[var(--text-muted)]">{String((vals as any).actual)}</p>
                                                            </button>
                                                            <button type="button" onClick={() => setSeleccion(s => ({ ...s, [`${d.campo}::conflict::${k}`]: 'nuevo' }))}
                                                                className={`p-2 rounded-lg text-xs text-left border ${seleccion[`${d.campo}::conflict::${k}`] === 'nuevo' ? 'border-emerald-400 bg-[var(--ok)]/10' : 'border-[var(--border)]'}`}>
                                                                <p className="text-[10px] text-[var(--text-faint)] font-bold">{k} (nuevo)</p>
                                                                <p className="text-[var(--text-muted)]">{String((vals as any).nuevo)}</p>
                                                            </button>
                                                        </div>
                                                    ))}
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {applyError && <div className="mx-6 mb-2 p-3 bg-[var(--err)]/10 border border-[var(--err)]/30 rounded-xl text-[var(--err)] text-xs">{applyError}</div>}
                        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
                            <button type="button" onClick={() => setShowModal(false)}
                                className="flex-1 py-2.5 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)]">Cancelar</button>
                            <button type="button" onClick={aplicarSeleccion} disabled={applying}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110 disabled:opacity-60 flex items-center justify-center gap-2">
                                {applying ? <><Loader2 className="w-4 h-4 animate-spin" />Aplicando…</> : <><CheckCircle2 className="w-4 h-4" />Aplicar</>}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* -- Modal Vincular / Cambiar artículo -- */}
            {vinculandoModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
                    <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
                            <div>
                                <h2 className="text-lg font-bold">
                                    {ficha?.articulos ? 'Cambiar artículo vinculado' : 'Vincular artículo del catálogo'}
                                </h2>
                                <p className="text-xs text-[var(--text-faint)]">Busca por nombre, marca, SKU o modelo.</p>
                            </div>
                            <button type="button" onClick={() => { setVinculandoModal(false); setVinculandoResults([]); setVinculandoQ(''); setVinculandoError(''); }}
                                className="text-[var(--text-faint)] hover:text-[var(--text-muted)]"><X className="w-5 h-5" /></button>
                        </div>

                        <div className="p-4 border-b border-[var(--border)]">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Ej: Llave ajustable, 710SI, Stanley…"
                                    value={vinculandoQ}
                                    onChange={e => setVinculandoQ(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && buscarParaVincular()}
                                    className="flex-1 p-2.5 text-sm bg-[var(--bg)] border border-[var(--border)] rounded-xl focus:ring-1 focus:ring-indigo-400 outline-none"
                                    autoFocus
                                />
                                <button type="button" onClick={buscarParaVincular} disabled={vinculandoLoading || vinculandoQ.trim().length < 2}
                                    className="px-4 py-2.5 bg-[var(--accent)] text-[var(--accent-ink)] text-sm font-semibold rounded-xl hover:brightness-110 disabled:opacity-60 flex items-center gap-1.5">
                                    {vinculandoLoading
                                        ? <><Loader2 className="w-4 h-4 animate-spin" />Buscando…</>
                                        : <><Search className="w-4 h-4" />Buscar</>}
                                </button>
                            </div>
                            {vinculandoError && <p className="text-xs text-[var(--err)] mt-2">{vinculandoError}</p>}
                        </div>

                        <div className="overflow-y-auto flex-1 p-4 space-y-2">
                            {vinculandoResults.length === 0 && !vinculandoLoading && (
                                <p className="text-xs text-center text-[var(--text-faint)] py-6">
                                    {vinculandoQ.length < 2 ? 'Escribe al menos 2 caracteres y haz clic en Buscar.' : 'Sin resultados — intenta otra búsqueda.'}
                                </p>
                            )}
                            {vinculandoResults.map(art => (
                                <button key={art.articulo_id} type="button" onClick={() => vincularArticulo(art.articulo_id)}
                                    className="w-full text-left p-3 rounded-xl border border-[var(--border)] hover:border-[var(--accent)]/50 hover:bg-[var(--accent)]/10 transition-colors space-y-0.5">
                                    <p className="text-sm font-semibold text-[var(--text)] leading-tight">{art.nombre}</p>
                                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[var(--text-muted)]">
                                        <span>SKU: <code className="text-[var(--text-muted)]">{art.articulo_id}</code></span>
                                        {art.marca    && <span>Marca: {art.marca}</span>}
                                        {art.modelo   && <span>Modelo: {art.modelo}</span>}
                                        {art.variante && <span>Variante: {art.variante}</span>}
                                        {art.codigo_universal && <span>EAN: {art.codigo_universal}</span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* -- Modal: Imágenes extraídas por IA ------------------------ */}
            {imgExtractOpen && imgExtractResults.length > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-[var(--border)]">
                            <h2 className="text-lg font-bold text-[var(--text)]">Imágenes encontradas</h2>
                            <p className="text-xs text-[var(--text-faint)] mt-0.5">
                                La IA encontró {imgExtractResults.length} imagen(es). Selecciona las que quieres guardar en la ficha.
                            </p>
                        </div>
                        <div className="overflow-y-auto flex-1 p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
                            {imgExtractResults.map((img, i) => {
                                const sel = imgExtractSelected.has(img.url);
                                return (
                                    <button key={i} type="button"
                                        onClick={() => setImgExtractSelected(prev => {
                                            const s = new Set(prev);
                                            sel ? s.delete(img.url) : s.add(img.url);
                                            return s;
                                        })}
                                        className={`relative aspect-square rounded-xl overflow-hidden border-2 transition-all ${sel ? 'border-[var(--accent)] ring-2 ring-indigo-300' : 'border-[var(--border)] hover:border-slate-300'}`}>
                                        <img src={img.url} alt={img.descripcion} className="w-full h-full object-cover"
                                            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                                        {sel && (
                                            <div className="absolute top-1.5 right-1.5 bg-[var(--accent)] rounded-full p-0.5">
                                                <CheckCircle2 className="w-3.5 h-3.5 text-[var(--accent-ink)]" />
                                            </div>
                                        )}
                                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                                            <p className="text-[9px] text-[var(--accent-ink)] font-semibold truncate">{img.descripcion}</p>
                                            <p className="text-[8px] text-[var(--accent-ink)]/70">{img.confianza}% confianza</p>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
                            <button type="button"
                                onClick={() => { setImgExtractOpen(false); setImgExtractResults([]); }}
                                className="flex-1 py-2.5 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] font-semibold transition-colors">
                                Cancelar
                            </button>
                            <button type="button"
                                disabled={imgExtractSelected.size === 0}
                                onClick={() => saveExtractedImages([...imgExtractSelected])}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-[var(--accent)] text-[var(--accent-ink)] hover:brightness-110 disabled:opacity-50 transition-colors">
                                Guardar {imgExtractSelected.size} imagen(es)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* -- Modal: Autocompletar — aprobar sugerencias ----------- */}
            {autocompletarSugerencias && Object.keys(autocompletarSugerencias).length > 0 && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-[var(--surface)] rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
                        <div className="px-6 py-4 border-b border-[var(--border)]">
                            <div className="flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-violet-600" />
                                <h2 className="text-lg font-bold text-[var(--text)]">Sugerencias de campos</h2>
                            </div>
                            <p className="text-xs text-[var(--text-faint)] mt-0.5">
                                La IA extrajo {Object.keys(autocompletarSugerencias).length} valor(es) del texto existente.
                                Marca los que quieres aplicar — nada se guarda sin tu aprobación.
                            </p>
                        </div>
                        <div className="overflow-y-auto flex-1 p-4 space-y-3">
                            {Object.entries(autocompletarSugerencias).map(([campo, valor]) => {
                                const LABELS: Record<string, string> = {
                                    descripcion:                  'Descripción corta',
                                    materiales:                   'Materiales',
                                    informacion_normativa:         'Información normativa',
                                    instrucciones_uso:             'Instrucciones de uso',
                                    leyendas_precautorias:         'Leyendas precautorias',
                                    indicaciones_almacenamiento:   'Indicaciones de almacenamiento',
                                    palabras_clave:               'Palabras clave',
                                };
                                const label = LABELS[campo] || campo;
                                const checked = autocompletarChecks.has(campo);
                                return (
                                    <label key={campo}
                                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${checked ? 'border-violet-400 bg-violet-50' : 'border-[var(--border)] hover:border-slate-300'}`}>
                                        <input type="checkbox" checked={checked}
                                            onChange={e => setAutocompletarChecks(prev => {
                                                const s = new Set(prev);
                                                e.target.checked ? s.add(campo) : s.delete(campo);
                                                return s;
                                            })}
                                            className="accent-violet-600 mt-0.5 shrink-0 w-4 h-4" />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wide">{label}</p>
                                            <p className="text-sm text-[var(--text)] mt-0.5 leading-snug">
                                                {Array.isArray(valor) ? valor.join(', ') : String(valor)}
                                            </p>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                        <div className="flex gap-3 px-6 py-4 border-t border-[var(--border)]">
                            <button type="button"
                                onClick={() => { setAutocompletarSugerencias(null); setAutocompletarChecks(new Set()); }}
                                className="flex-1 py-2.5 rounded-xl text-sm border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg)] font-semibold transition-colors">
                                Cancelar
                            </button>
                            <button type="button"
                                disabled={autocompletarChecks.size === 0 || autocompletarApplying}
                                onClick={aplicarAutocompletar}
                                className="flex-1 py-2.5 rounded-xl text-sm font-bold bg-violet-600 text-[var(--accent-ink)] hover:bg-violet-700 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors">
                                {autocompletarApplying
                                    ? <><Loader2 className="w-4 h-4 animate-spin" />Guardando…</>
                                    : `Aplicar ${autocompletarChecks.size} campo(s)`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
