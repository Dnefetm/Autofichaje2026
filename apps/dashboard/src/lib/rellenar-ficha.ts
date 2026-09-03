/**
 * Mapeo de campos entre la ficha técnica (fichas_tecnicas) y el artículo del
 * catálogo maestro (articulos), para "rellenar desde ficha".
 *
 * - Determinista (0 tokens): compara y aplica el valor de la ficha.
 * - `sintetizable` habilita el botón de IA (síntesis) solo en campos de texto
 *   donde fusionar/mejorar tiene sentido. Identidad/numéricos solo aceptar/rechazar.
 */
export interface MapeoCampo {
  articulo: string;
  ficha: string;
  label: string;
  tipo: 'texto' | 'numero';
  sintetizable: boolean;
  fichaFallback?: string;
}

export const MAPEO_CAMPOS: MapeoCampo[] = [
  { articulo: 'nombre', ficha: 'nombre_producto', label: 'Nombre', tipo: 'texto', sintetizable: true },
  { articulo: 'marca', ficha: 'marca', label: 'Marca', tipo: 'texto', sintetizable: false },
  { articulo: 'modelo', ficha: 'modelo', label: 'Modelo', tipo: 'texto', sintetizable: false },
  { articulo: 'variante', ficha: 'variante', label: 'Variante', tipo: 'texto', sintetizable: true },
  { articulo: 'codigo_universal', ficha: 'codigo_universal', label: 'Código Universal (EAN/UPC)', tipo: 'texto', sintetizable: false },
  { articulo: 'categoria', ficha: 'categoria', label: 'Categoría', tipo: 'texto', sintetizable: true },
  { articulo: 'materiales', ficha: 'materiales', label: 'Materiales', tipo: 'texto', sintetizable: true },
  { articulo: 'pais_origen', ficha: 'pais_origen', label: 'País de Origen', tipo: 'texto', sintetizable: false },
  { articulo: 'peso_kg', ficha: 'peso_kg', label: 'Peso (kg)', tipo: 'numero', sintetizable: false },
  { articulo: 'descripcion', ficha: 'descripcion', label: 'Descripción', tipo: 'texto', sintetizable: true, fichaFallback: 'descripcion_larga' },
];

export const ARTICULO_COLS = 'articulo_id, nombre, marca, modelo, variante, codigo_universal, categoria, materiales, pais_origen, peso_kg, descripcion';
export const FICHA_COLS =
  'id, nombre_producto, estado, created_at, marca, modelo, variante, codigo_universal, categoria, materiales, pais_origen, peso_kg, descripcion, descripcion_larga';

export function isEmpty(v: any): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

/** Valor de ficha para un mapeo (respeta fichaFallback, ej. descripcion_larga → descripcion). */
export function valorFicha(ficha: any, m: MapeoCampo): any {
  if (m.fichaFallback) return ficha[m.fichaFallback] || ficha[m.ficha];
  return ficha[m.ficha];
}
