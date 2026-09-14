import { cn } from '@/lib/utils';

/**
 * <Page> — contenedor estandar de pagina.
 * NO agrega padding horizontal: eso lo provee AppShell (una sola capa).
 * Solo limita el ancho, centra y da el espaciado vertical entre secciones.
 */
export function Page({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('w-full max-w-[1600px] mx-auto space-y-4 pb-8', className)}>{children}</div>;
}
