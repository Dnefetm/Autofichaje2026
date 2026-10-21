import { MovementOperator } from '@/components/movement-operator';

// Acepta ?articulo=<id>&tipo=ingreso|egreso para pre-cargar desde la ficha del catálogo.
export default async function MovimientosPage({
  searchParams,
}: {
  searchParams: Promise<{ articulo?: string; tipo?: string }>;
}) {
  const sp = await searchParams;
  const tipo = sp.tipo === 'ingreso' || sp.tipo === 'egreso' ? sp.tipo : undefined;
  return <MovementOperator articuloId={sp.articulo ?? null} tipoInicial={tipo} />;
}
