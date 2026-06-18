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
      <div className="bg-white p-5 sm:p-8 rounded-2xl border border-slate-100 shadow-sm space-y-3">
        <h3 className="text-sm font-bold tracking-widest uppercase text-slate-400">{title}</h3>
        <div className="text-slate-700 whitespace-pre-wrap leading-relaxed">
          {value}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      {/* Sticky Header / Toolbar */}
      <div className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => window.history.back()} className="p-2 -ml-2 text-slate-400 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col">
              <h1 className="font-bold text-slate-800 line-clamp-1">{ficha.nombre_producto || 'Ficha Técnica'}</h1>
              <span className="text-xs font-mono text-slate-400">{ficha.id}</span>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-200">
              <CheckCircle2 className="w-3.5 h-3.5" /> Publicado
            </div>
            <button type="button" onClick={onGenerarPDF} disabled={generandoPdf}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-white border border-slate-200 text-slate-600 rounded-xl hover:border-indigo-300 hover:text-indigo-700 transition-colors disabled:opacity-50 shadow-sm">
                {generandoPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} PDF
            </button>
            <button type="button" onClick={onEdit}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-semibold bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
                <Edit2 className="w-4 h-4" /> Editar
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 mt-6 sm:mt-10 grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Main Column */}
        <div className="lg:col-span-8 space-y-6 sm:space-y-8">
          
          {/* Identity Block */}
          <div className="bg-white p-5 sm:p-8 rounded-3xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-3 mb-6 flex-wrap">
              {ficha.marca && (
                <span className="px-3 py-1 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold uppercase tracking-wider">
                  {ficha.marca}
                </span>
              )}
              {ficha.codigo_universal && (
                <span className="text-sm font-mono text-slate-500">EAN: {ficha.codigo_universal}</span>
              )}
              {ficha.modelo && (
                <span className="text-sm font-mono text-slate-500">Modelo: {ficha.modelo}</span>
              )}
            </div>
            
            <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 leading-tight mb-4">
              {ficha.nombre_producto}
            </h1>
            
            {ficha.descripcion && (
              <p className="text-lg text-slate-600 leading-relaxed">
                {ficha.descripcion}
              </p>
            )}

            {/* Chips */}
            <div className="flex flex-wrap gap-2 mt-6">
              {ficha.categoria && <span className="px-3 py-1.5 bg-indigo-50 text-indigo-700 rounded-xl text-sm font-medium border border-indigo-100">{ficha.categoria}</span>}
              {ficha.variante && <span className="px-3 py-1.5 bg-slate-50 text-slate-700 rounded-xl text-sm font-medium border border-slate-200">Var: {ficha.variante}</span>}
              {ficha.fabricante && <span className="px-3 py-1.5 bg-slate-50 text-slate-700 rounded-xl text-sm font-medium border border-slate-200">Fab: {ficha.fabricante}</span>}
            </div>
          </div>

          <TextBlock title="Descripción Detallada" value={ficha.descripcion_larga} />
          
          {ficha.bullet_points && ficha.bullet_points.length > 0 && (
            <div className="bg-white p-5 sm:p-8 rounded-2xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-sm font-bold tracking-widest uppercase text-slate-400">Puntos Clave</h3>
              <ul className="space-y-3">
                {ficha.bullet_points.map((bp: string, i: number) => (
                  <li key={i} className="flex gap-3 text-slate-700 leading-relaxed">
                    <span className="text-indigo-500 mt-1 shrink-0">•</span>
                    <span>{bp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <TextBlock title="Especificaciones Generales" value={ficha.especificaciones} />
          
          {/* Cumplimiento / Seguridad */}
          {tieneCumplimiento && (
            <div className="bg-amber-50 p-5 sm:p-8 rounded-2xl border border-amber-200 space-y-4">
              <h3 className="text-sm font-bold tracking-widest uppercase text-amber-600">Cumplimiento y Seguridad</h3>
              <div className="space-y-3 text-amber-900/80">
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
            <div className="bg-white p-5 sm:p-6 rounded-3xl border border-slate-100 shadow-sm space-y-4">
              <h3 className="text-sm font-bold tracking-widest uppercase text-slate-400 mb-4">Galería</h3>
              <div className="aspect-square w-full rounded-2xl overflow-hidden bg-slate-50 border border-slate-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagenes[0]} alt="Principal" className="w-full h-full object-contain" />
              </div>
              {imagenes.length > 1 && (
                <div className="grid grid-cols-3 gap-2">
                  {imagenes.slice(1, 4).map((img, i) => (
                    <div key={i} className="aspect-square rounded-xl overflow-hidden bg-slate-50 border border-slate-100">
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
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-100">
                <h3 className="text-sm font-bold tracking-widest uppercase text-slate-500">Atributos Técnicos</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {atributosRows.map(([k, v], i) => (
                  <div key={i} className="flex p-4 sm:p-5 text-sm">
                    <span className="w-1/2 text-slate-500 font-medium">{k}</span>
                    <span className="w-1/2 text-slate-900 font-semibold">{v}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dimensiones */}
          {dims.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              <div className="p-4 sm:p-5 bg-slate-50/80 border-b border-slate-100">
                <h3 className="text-sm font-bold tracking-widest uppercase text-slate-500">Dimensiones</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {dims.map(([k, v], i) => (
                  <div key={i} className="flex p-4 sm:p-5 text-sm">
                    <span className="w-1/2 text-slate-500 font-medium">{k}</span>
                    <span className="w-1/2 text-slate-900 font-semibold">{v}</span>
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
