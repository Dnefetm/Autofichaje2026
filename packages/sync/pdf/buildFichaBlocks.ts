import { FichaPDFData } from './FichaTecnicaPDF';

export function has(val: any): boolean {
  if (val == null) return false;
  if (typeof val === 'string' && val.trim() === '') return false;
  return true;
}

export function norm(s: any): string {
  if (!s || typeof s !== 'string') return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildFichaBlocks(ficha: FichaPDFData, metaImagenes?: string[]) {
  const atributosRows: Array<[string, any]> = ficha.atributos_dinamicos
    ? Object.entries(ficha.atributos_dinamicos).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])
    : [];

  const dims: Array<[string, any]> = [
    ['Peso (kg)', ficha.peso_kg],
    ['Largo (cm)', ficha.largo_cm],
    ['Ancho (cm)', ficha.ancho_cm],
    ['Alto (cm)', ficha.alto_cm],
  ].filter(([, v]) => has(v));

  const mostrarInstrucciones = has(ficha.instrucciones_uso) && norm(ficha.instrucciones_uso) !== norm(ficha.uso_recomendado);
  const mostrarPrecauciones = has(ficha.precauciones) && norm(ficha.precauciones) !== norm(ficha.leyendas_precautorias);

  const imagenes = (metaImagenes && metaImagenes.length > 0)
    ? metaImagenes
    : (ficha.imagen_urls || []).filter(Boolean);

  const tieneCumplimiento = has(ficha.informacion_normativa) || has(ficha.leyendas_precautorias) || mostrarPrecauciones || has(ficha.indicaciones_almacenamiento);

  return {
    atributosRows,
    dims,
    mostrarInstrucciones,
    mostrarPrecauciones,
    imagenes,
    tieneCumplimiento
  };
}
