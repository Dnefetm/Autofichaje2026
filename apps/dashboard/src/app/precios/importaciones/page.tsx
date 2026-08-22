import { supabaseAdmin } from '@/lib/supabase';
import { ImportacionesTable } from './importaciones-table';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function PreciosImportacionesPage() {
  await supabaseAdmin.rpc('fn_recuperar_importaciones_colgadas');

  const { data: importaciones } = await supabaseAdmin
    .from('v_importaciones_panel')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-[var(--text)]">Importaciones</h1>
          <p className="text-[var(--text-muted)] mt-1">Histórico y estado en tiempo real de los reportes masivos</p>
        </div>
        <Link 
          href="/precios/importar" 
          className="bg-[var(--accent)] hover:brightness-110 text-[var(--accent-ink)] px-4 py-2 rounded-xl flex items-center gap-2 font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Nueva importación
        </Link>
      </div>

      <ImportacionesTable initial={importaciones || []} />
    </div>
  );
}
