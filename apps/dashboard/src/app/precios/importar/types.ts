export type EstadoMatch = 'match_exacto' | 'match_similitud' | 'sin_match' | 'confirmado' | 'descartado' | 'rechazado' | 'pendiente' | 'actualizado' | 'codigo_cambiado' | 'sugerido' | 'nuevo';

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

export type TipoCosto = 'distribuidor' | 'subdistribuidor' | 'menudeo' | 'mayoreo' | 'otro' | string;

export interface GrupoCostoFila {
  clave: string;
  excel: {
    modelo: string;
    marca: string;
    codigo_universal: string | null;
    descripcion: string | null;
  };
  catalogo_sugerido: Candidato | null;
  candidatos_jsonb: Candidato[];
  precios_nuevos: Record<TipoCosto, { costo_id: string; valor: number; moneda: string; tipo_costo: string } | null>;
  precios_anteriores: Record<TipoCosto, { valor: number; moneda: string } | null>;
  estado_grupo: EstadoMatch;
  articulo_id_final?: string | null;
  matching_decision_id?: string | null;
}

export function clasificarEstado(puntaje: number | null, nivel_match?: string): EstadoMatch {
  if (nivel_match === 'actualizado_fuerte' || nivel_match === 'match_exacto') return 'match_exacto';
  if (nivel_match === 'cambio_codigo_sugerido' || nivel_match === 'match_similitud' || nivel_match === 'ambiguo') return 'match_similitud';
  if (puntaje === null) return 'sin_match';
  if (puntaje === 100) return 'match_exacto';
  if (puntaje >= 70 && puntaje < 100) return 'match_similitud';
  return 'sin_match';
}

export interface Stats {
  sin_match: number;
  sugerido: number;
  confirmado: number;
  rechazado: number;
}
