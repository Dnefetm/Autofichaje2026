'use client';
import { FichaPDFData } from '@gestor/sync/pdf/FichaTecnicaPDF';
import { buildFichaBlocks } from '@gestor/sync/pdf/buildFichaBlocks';
import { ArrowLeft, Edit2, FileText, Loader2, CheckCircle2 } from 'lucide-react';

export function FichaPublicadaView({
  ficha,
  onEdit,
  onGenerarPDF,
  generandoPdf
}: {
  ficha: FichaPDFData & { estado?: string };
  onEdit: () => void;
  onGenerarPDF: () => void;
  generandoPdf: boolean;
}) {
  const {
    atributosRows,
    dims,
    mostrarInstrucciones,
    mostrarPrecauciones,
    imagenes,
    tieneCumplimiento
  } = buildFichaBlocks(ficha);

  // Helper local para renderizar bloques de texto simple
  const TextBlock = ({ title, value }: { title: string, value: string | null | undefined }) => {
    if (!value) return null;
    return (
      <div className="bg-[var(--surface)] p-5 sm:p-8 rounded-2xl border border-[var(--border)] shadow-sm space-y-3">
        <h3 className="text-sm font-bold tracking-widest uppercase text-[var(--text-faint)]">{title}</h3>
        <div className="text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed">
          {value}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[var(--bg)]/50 pb-20">
      {/* Sticky Header / Toolbar */}
      <div className="sticky top-0 z-30 bg-[var(--surface)]/80 backdrop-blur-md border-b border-[var(--border)] shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => window.history.back()} className="p-2 -ml-2 text-[var(--text-faint)] hover:text-[var(--text-muted)] transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col">
              <h1 className="font-bold text-[var(--text)] line-clamp-1">{ficha.nombre_producto || 'Ficha Técnica'}</h1>
              <span className="text-xs font-mono text-[var(--text-faint)]">{ficha.id}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-[var(--ok)]/10 text-[var(--ok)] rounded-full text-xs font-bold border border-[var(--ok)]/30">
              <CheckCircle2 className="w-3.5 h-3.5" /> Publicado
            </div>
            <button type="button" onClick={onGenerarPDF} disabled={generandoPdf}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-xl hover:border-[var(--accent)]/50 hover:text-indigo-700 transition-colors disabled:opacity-50 shadow-sm">
                {generandoPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
            </button>
            <button type="button" onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-[var(--accent)] text-[var(--accent-ink)] rounded-xl hover:brightness-110 transition-colors shadow-sm">
                <Edit2 className="w-4 h-4" /> Editar
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 mt-6 sm:mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Main Column */}
        <div className="lg:col-span-8 space-y-6 sm:space-y-8">
          
          {/* Identity Block */}
          <div className="bg-[var(--surface)] p-5 sm:p-8 rounded-3xl border border-[var(--border)] shadow-sm">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              {ficha.marca && (
                <span className="px-3 py-1 bg-[var(--surface-2)] text-[var(--text-muted)] rounded-lg text-xs font-bold uppercase tracking-wider">
                  {ficha.marca}
                </span>
              )}
              {ficha.codigo_universal && (
                <span className="text-sm font-mono text-[var(--text-muted)]">EAN: {ficha.codigo_universal}</span>
              )}
              {ficha.modelo && (
                <span className="text-sm font-mono text-[var(--text-muted)]">Modelo: {ficha.modelo}</span>
              )}
            </div>
            
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[var(--text)] leading-tight mb-4">
              {ficha.nombre_producto}
            </h1>
            
            {ficha.descripcion && (
              <p className="text-lg text-[var(--text-muted)] leading-relaxed">
                {ficha.descripcion}
              </p>
            )}

            {/* Chips */}
            <div className="flex flex-wrap gap-2 mt-6">
              {ficha.categoria && <span className="px-3 py-1.5 bg-[var(--accent)]/10 text-indigo-700 rounded-xl text-sm font-medium border border-indigo-100">{ficha.categoria}</span>}
              {ficha.variante && <span className="px-3 py-1.5 bg-[var(--bg)] text-[var(--text-muted)] rounded-xl text-sm font-medium border border-[var(--border)]">Var: {ficha.variante}</span>}
              {ficha.fabricante && <span className="px-3 py-1.5 bg-[var(--bg)] text-[var(--text-muted)] rounded-xl text-sm font-medium border border-[var(--border)]">Fab: {ficha.fabricante}</span>}
            </div>
          </div>

          <TextBlock title="Descripción Detallada" value={ficha.descripcion_larga} />
          
          {ficha.bullet_points && ficha.bullet_points.length > 0 && (
            <div className="bg-[var(--surface)] p-5 sm:p-8 rounded-2xl border border-[var(--border)] shadow-sm space-y-4">
              <h3 className="text-sm font-bold tracking-widest uppercase text-[var(--text-faint)]">Puntos Clave</h3>
              <ul className="space-y-3">
                {ficha.bullet_points.map((bp: string, i: number) => (
                  <li key={i} className="flex gap-3 text-[var(--text-muted)] leading-relaxed">
                    <span className="text-[var(--accent)] mt-1 shrink-0">•</span>
                    <span>{bp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TextBlock title="Especificaciones Generales" value={ficha.especificaciones} />
          
          {/* Cumplimiento / Seguridad */}
          {tieneCumplimiento && (
            <div className="bg-[var(--warn)]/10 p-5 sm:p-8 rounded-2xl border border-[var(--warn)]/30 space-y-4">
              <h3 className="text-sm font-bold tracking-widest uppercase text-[var(--warn)]">Cumplimiento y Seguridad</h3>
              <div className="space-y-3 text-amber-900/80 whitespace-pre-wrap">
                {ficha.informacion_normativa && <p><strong className="text-amber-900">Normativa:</strong> {ficha.informacion_normativa}</p>}
                {ficha.leyendas_precautorias && <p><strong className="text-amber-900">Leyendas Precautorias:</strong> {ficha.leyendas_precautorias}</p>}
                {mostrarPrecauciones && <p><strong className="text-amber-900">Precauciones:</strong> {ficha.precauciones}</p>}
                {ficha.indicaciones_almacenamiento && <p><strong className="text-amber-900">Almacenamiento:</strong> {ficha.indicaciones_almacenamiento}</p>}
              </div>
            </div>
          )}
          
          <TextBlock title="Uso Recomendado" value={ficha.uso_recomendado} />
          {mostrarInstrucciones && <TextBlock title="Instrucciones de Uso" value={ficha.instrucciones_uso} />}
          <TextBlock title="Ingredientes / Composición" value={ficha.ingredientes} />
        </div>

        {/* Sidebar Column */}
        <div className="lg:col-span-4 space-y-6 sm:space-y-8">
          
          {/* Images Gallery */}
          {imagenes && imagenes.length > 0 && (
            <div className="bg-[var(--surface)] p-5 sm:p-6 rounded-3xl border border-[var(--border)] shadow-sm space-y-4">
              <h3 className="text-sm font-bold tracking-widest uppercase text-[var(--text-faint)] mb-4">Galería</h3>
              <div className="aspect-square w-full rounded-2xl overflow-hidden bg-[var(--bg)] border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagenes[0]} alt="Principal" className="w-full h-full object-contain" />
              </div>
              {imagenes.length > 1 && (
                <div className="grid grid-cols-3 gap-2">
                  {imagenes.slice(1, 4).map((img, i) => (
                    <div key={i} className="aspect-square rounded-xl overflow-hidden bg-[var(--bg)] border border-[var(--border)]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt={`Img ${i+1}`} className="w-full h-full object-contain" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Atributos Tecnicos */}
          {atributosRows.length > 0 && (
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5 bg-[var(--bg)]/80 border-b border-[var(--border)]">
                <h3 className="text-sm font-bold tracking-widest uppercase text-[var(--text-muted)]">Atributos Técnicos</h3>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {atributosRows.map(([k, v], i) => (
                  <div key={i} className="flex p-4 sm:p-5 text-sm">
                    <span className="w-1/2 text-[var(--text-muted)] font-medium">{k}</span>
                    <span className="w-1/2 text-[var(--text)] font-semibold whitespace-pre-wrap break-words">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dimensiones */}
          {dims.length > 0 && (
            <div className="bg-[var(--surface)] rounded-2xl border border-[var(--border)] shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5 bg-[var(--bg)]/80 border-b border-[var(--border)]">
                <h3 className="text-sm font-bold tracking-widest uppercase text-[var(--text-muted)]">Dimensiones</h3>
              </div>
              <div className="divide-y divide-[var(--border)]">
                {dims.map(([k, v], i) => (
                  <div key={i} className="flex p-4 sm:p-5 text-sm">
                    <span className="w-1/2 text-[var(--text-muted)] font-medium">{k}</span>
                    <span className="w-1/2 text-[var(--text)] font-semibold whitespace-pre-wrap break-words">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          
        </div>
      </div>
    </div>
  );
}
