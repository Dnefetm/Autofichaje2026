import { supabaseAdmin } from '@/lib/supabase';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, FileText } from 'lucide-react';
import { ProgresoImportacion } from './progreso-importacion';

export const dynamic = 'force-dynamic';

export default async function DetalleImportacionPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const { data: imp, error } = await supabaseAdmin
    .from('importaciones_excel')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !imp) {
    return notFound();
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      <div>
        <Link 
          href="/precios/importaciones" 
          className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors mb-4 font-medium"
        >
          <ArrowLeft className="w-4 h-4" />
          Volver al panel
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)] flex items-center gap-2">
              <FileText className="w-6 h-6 text-[var(--accent)]" />
              {imp.nombre_archivo}
            </h1>
            <p className="text-[var(--text-muted)] mt-1">Proveedor: <span className="font-semibold text-[var(--text-muted)]">{imp.proveedor || 'No especificado'}</span></p>
          </div>
        </div>
      </div>

      <ProgresoImportacion id={id} initial={imp} />
    </div>
  );
}
