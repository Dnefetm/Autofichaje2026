'use client';
import { useState, useCallback, useRef } from 'react';
import { Upload, Loader2, FileSpreadsheet } from 'lucide-react';
import { useRouter, useParams } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function SubirPaso1() {
    const params = useParams();
    const proveedor = decodeURIComponent((params?.proveedor as string) || '');
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragging, setDragging] = useState(false);
    const [modo, setModo] = useState('parcial');
    const inputRef = useRef<HTMLInputElement>(null);

    function handleFile(f: File) {
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (!['xlsx', 'xls'].includes(ext ?? '')) { setError('Solo .xlsx o .xls'); return; }
        if (f.size > 50 * 1024 * 1024) { setError('Máximo 50 MB'); return; }
        setFile(f); setError(null);
    }

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault(); setDragging(false);
        const f = e.dataTransfer.files[0]; if (f) handleFile(f);
    }, []);

    async function submit() {
        if (!file) return;
        if (!proveedor || proveedor === 'undefined') {
            setError('Proveedor inválido o no encontrado en la URL.');
            return;
        }
        setLoading(true); setError(null);
        try {
            // Because full column mapping is complex, we redirect to the existing import wizard 
            // but pass it a flag so it eventually returns to /revisar. 
            // In a real refactor, we would move all the parsing logic to the backend.
            // For now, we just upload and redirect to the legacy importer but scoped.
            
            // 1) Signed URL
            const r1 = await fetch('/api/precios/importar/signed-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor: proveedor, fileName: file.name }),
            });
            const j1 = await r1.json();
            if (!j1.ok) throw new Error(j1.error);

            // 2) Upload
            const supabase = supabaseBrowser();
            const { error: upErr } = await supabase.storage.from(j1.bucket).uploadToSignedUrl(j1.path, j1.token, file);
            if (upErr) throw new Error(upErr.message);

            // 3) Register
            const r3 = await fetch('/api/precios/importar/registrar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proveedor: proveedor, fileName: file.name, storagePath: j1.path, bucket: j1.bucket, modo }),
            });
            
            const j3 = await r3.json();
            if (!r3.ok && r3.status !== 409) throw new Error(j3.error);

            const importacionId = j3.importacion_id || j3.importacion_activa?.id;
            if (!importacionId) throw new Error("No se recibió ID de importación del servidor");

            // 4) Ir a MAPEAR columnas (el usuario confirma; el parser se dispara DESPUÉS)
            router.push(`/precios/${encodeURIComponent(proveedor)}/mapear?importacion_id=${importacionId}`);
        } catch (e: any) {
            setError(e.message);
            setLoading(false);
        }
    }

    return (
        <div className="p-8 max-w-4xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-[var(--text)] mb-2">Subir Excel de Precios</h2>
                <p className="text-[var(--text-muted)]">Asegúrate de que el archivo contenga las columnas de código, modelo y precio.</p>
            </div>

            <div 
                className={`w-full max-w-2xl p-12 border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-colors cursor-pointer
                    ${dragging ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:bg-[var(--bg)] hover:border-[var(--border-strong)] bg-[var(--surface)]'}`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
            >
                <input type="file" className="hidden" ref={inputRef} accept=".xlsx, .xls" onChange={e => {
                    const f = e.target.files?.[0]; if (f) handleFile(f);
                }} />
                
                <div className="bg-[var(--accent)]/20 p-4 rounded-full mb-4">
                    <Upload className="w-8 h-8 text-[var(--accent)]" />
                </div>
                <h3 className="text-lg font-medium text-[var(--text)] mb-1">
                    {file ? file.name : "📄 Arrastra el Excel del proveedor o haz click para seleccionar"}
                </h3>
                {!file && <p className="text-sm text-[var(--text-muted)] mt-2">Último lote procesado: -</p>}
                {file && <p className="text-sm text-[var(--text-muted)] mb-4">{(file.size / 1024 / 1024).toFixed(2)} MB</p>}
                
                {error && <div className="mt-4 p-3 bg-[var(--err)]/10 text-[var(--err)] rounded-md text-sm text-center font-medium max-w-md">{error}</div>}
            </div>

            <div className="mt-8 flex flex-col items-center">
                <div className="w-full max-w-2xl bg-[var(--surface)] border border-[var(--border)] rounded-lg p-6 mb-6 shadow-sm">
                    <h4 className="text-sm font-semibold text-[var(--text)] mb-4">Modo de actualización</h4>
                    <div className="space-y-4">
                        <label className={`flex items-start p-3 border rounded-md cursor-pointer transition-colors ${modo === 'parcial' ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:bg-[var(--bg)]'}`}>
                            <input type="radio" name="modo" value="parcial" checked={modo === 'parcial'} onChange={() => setModo('parcial')} className="mt-0.5 text-[var(--accent)] focus:ring-[var(--accent)]" />
                            <div className="ml-3">
                                <span className="block text-sm font-medium text-[var(--text)]">Actualización parcial (merge) — recomendado</span>
                                <span className="block text-xs text-[var(--text-muted)] mt-1">Solo actualiza los SKUs presentes en el archivo. Los demás conservan su precio anterior y se marcan como desactualizados.</span>
                            </div>
                        </label>
                        <label className={`flex items-start p-3 border rounded-md cursor-pointer transition-colors ${modo === 'full' ? 'border-[var(--accent)] bg-[var(--accent)]/10' : 'border-[var(--border)] hover:bg-[var(--bg)]'}`}>
                            <input type="radio" name="modo" value="full" checked={modo === 'full'} onChange={() => setModo('full')} className="mt-0.5 text-[var(--accent)] focus:ring-[var(--accent)]" />
                            <div className="ml-3">
                                <span className="block text-sm font-medium text-[var(--text)]">Reemplazo total — solo si subes la lista maestra completa</span>
                                <span className="block text-xs text-[var(--text-muted)] mt-1">SKUs ausentes quedan sin precio vigente.</span>
                            </div>
                        </label>
                    </div>
                </div>

                <button 
                    onClick={submit}
                    disabled={!file || loading}
                    className="bg-[var(--accent)] text-[var(--accent-ink)] px-8 py-3 rounded-lg font-medium shadow-sm hover:brightness-110 disabled:opacity-50 flex items-center text-lg transition-all"
                >
                    {loading ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FileSpreadsheet className="w-5 h-5 mr-2" />}
                    Procesar archivo
                </button>
            </div>
        </div>
    );
}
