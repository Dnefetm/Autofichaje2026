export type EstadoMatch = 'match' | 'duda' | 'sin_match';

export interface Candidato {
  articulo_id: string;
  nombre: string;
  marca: string;
  modelo: string;
  codigo_universal?: string;
  puntaje_match: number;
}

// Representa a un "Costo" que viene de la API `api/precios/importar/[id]/costos`
export interface Costo {
  id: string;
  modelo_excel?: string;
  marca_excel?: string;
  codigo_universal_excel?: string;
  descripcion_excel?: string;
  valor: number;
  moneda: string;
  tipo_costo: string;
  
  articulo_sugerido_id: string | null;
  puntaje_match: number | null;
  estado_match: string; // 'sin_match' | 'sugerido' | 'confirmado' | 'rechazado'
  articulo_sugerido: Candidato | null;
  
  // Nueva columna
  candidatos_jsonb: Candidato[] | null;
}

export interface FilaMapeada {
  costo_id: string;
  costo: Costo;
  candidatos: Candidato[];
  seleccionado: string | null; // El articulo_id seleccionado (puede ser null si es "Sin Asignar")
  estado: EstadoMatch;
}

export interface Stats {
  sin_match: number;
  sugerido: number;
  confirmado: number;
  rechazado: number;
}
