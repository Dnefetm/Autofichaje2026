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

  useEffect(() => {
    if (idParam && idParam !== importacionId) {
      setImportacionId(idParam);
      setStep(1);
    }
  }, [idParam]);

  if (!importacionId) {
    return (
      <div className="p-10 text-center text-slate-500">
        <p>No se especificó un ID de importación.</p>
        <button className="mt-4 text-indigo-600 underline" onClick={() => router.push('/precios/importaciones')}>
          Volver a Importaciones
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-4">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Motor de Matching: Configuración de Proveedor</h1>
        <p className="text-sm text-slate-500 mt-1">Configura las columnas y asocia la lista cruda del proveedor contra tu catálogo interno.</p>
      </div>

      {step === 1 && (
        <PasoMapear importacionId={importacionId} onBack={() => {
           router.push('/precios/importaciones'); 
        }}
        onDone={(s) => { setMatchStats(s); setStep(2); }} />
      )}
      
      {step === 2 && matchStats && (
        <PasoRevisar importacionId={importacionId} statsInit={matchStats}
          onBack={() => setStep(1)} 
          onFinish={() => router.push('/precios/importaciones')} />
      )}
    </div>
  );
}

export default function MatchingPage() {
  return (
    <Suspense fallback={<div className="p-10"><Loader2 className="w-6 h-6 animate-spin mx-auto text-indigo-600" /></div>}>
      <MatchingPageInner />
    </Suspense>
  );
}
