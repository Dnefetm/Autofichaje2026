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

export type TipoCosto = 'distribuidor' | 'subdistribuidor' | 'lista' | 'mayoreo' | 'otro' | string;

export interface GrupoCostoFila {
  clave: string;
  excel: {
    modelo: string;
    marca: string;
    codigo_universal: string | null;
    nombre: string | null;
  };
  catalogo_sugerido: Candidato | null;
  candidatos_jsonb: Candidato[];
  precios_nuevos: Record<TipoCosto, { costo_id: string; valor: number; moneda: string; tipo_costo: string } | null>;
  precios_anteriores: Record<TipoCosto, { valor: number; moneda: string } | null>;
  estado_grupo: EstadoMatch;
}

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
