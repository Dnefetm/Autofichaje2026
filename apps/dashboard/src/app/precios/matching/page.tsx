'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { PasoMapear, PasoRevisar } from '../importar/page';

function MatchingPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const idParam = sp.get('importacion_id');

  const [step, setStep] = useState<1 | 2>(1);
  const [importacionId, setImportacionId] = useState<string | null>(idParam || null);
  const [matchStats, setMatchStats] = useState<{ total: number; con_match: number } | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(false);

  useEffect(() => {
    if (idParam && idParam !== importacionId) {
      setImportacionId(idParam);
      setStep(1);
    }
  }, [idParam]);

  useEffect(() => {
    if (!importacionId) return;
    setLoadingInitial(true);
    // Verificar si la importación sigue activa
    fetch(`/api/precios/importar/${importacionId}/progreso-matching`)
      .then(r => r.json())
      .then(d => {
        // We only care about ensuring the import exists. 
        // We no longer transition to Step 2 (PasoRevisar).
      })
      .catch(e => console.error("Error cargando estado inicial", e))
      .finally(() => setLoadingInitial(false));
  }, [importacionId]);

  if (!importacionId) {
    return (
      <div className="p-10 text-center text-[var(--text-muted)]">
        <p>No se especificó un ID de importación.</p>
        <button className="mt-4 text-[var(--accent)] underline" onClick={() => router.push('/precios/importaciones')}>
          Volver a Importaciones
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--text)]">Motor de Importación: Mapeo de Columnas</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">Configura las columnas de la lista cruda del proveedor para guardar la lista sana en tu base de datos.</p>
      </div>

      {loadingInitial ? (
        <div className="flex justify-center p-10"><Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]"/></div>
      ) : (
        <PasoMapear importacionId={importacionId} onBack={() => {
           router.push('/precios/importaciones'); 
        }}
        onDone={(s) => { 
            // The mapping component handles the redirect now.
        }} />
      )}
    </div>
  );
}

export default function MatchingPage() {
  return (
    <Suspense fallback={<div className="p-10"><Loader2 className="w-6 h-6 animate-spin mx-auto text-[var(--accent)]" /></div>}>
      <MatchingPageInner />
    </Suspense>
  );
}
