export type EstadoMatch = 'match' | 'duda' | 'sin_match';

export type Candidato = {
  articulo_id: string;
  nombre: string;
  marca: string;
  modelo: string;
  codigo_universal?: string;
  puntaje_match: number;
  metodo_match?: string; // 'exacto_triple', 'codigo_exacto_incompleto', 'fuzzy_trgm', 'manual'
  caja_madre: string | null;
};

export interface Costo {
  id: string;
  articulo_sugerido_id: string | null;
  modelo_excel: string | null;
  marca_excel: string | null;
  codigo_universal_excel: string | null;
  descripcion_excel: string | null;
  tipo_costo: string;
  valor: number;
  moneda: string;
  puntaje_match: number | null;
  estado_match: string;
  articulo_sugerido: { articulo_id: string; nombre: string; marca: string; modelo: string; codigo_universal?: string } | null;
  candidatos_jsonb?: Candidato[];
}

export type FilaMapeada = {
  costo_id: string;
  costo: Costo;
  candidatos: Candidato[];
  seleccionado: string | null;
  estado: EstadoMatch;
};

/**
 * Utilitario centralizado para clasificar el estado visual de una coincidencia en base al puntaje numérico.
 */
export function clasificarEstado(puntaje: number | null): EstadoMatch {
  if (puntaje === null) return 'sin_match';
  if (puntaje === 100) return 'match';
  if (puntaje >= 70 && puntaje < 100) return 'duda';
  return 'sin_match';
}

export interface Stats {
  sin_match: number;
  sugerido: number;
  confirmado: number;
  rechazado: number;
}
