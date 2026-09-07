import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { MovementForm } from '@/components/movement-form';

export default function MovimientosPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Catálogo
        </Link>
      </div>

      <h1 className="text-lg font-bold text-[var(--text)]">Movimientos</h1>

      <MovementForm />
    </div>
  );
}
