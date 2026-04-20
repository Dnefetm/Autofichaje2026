// Fuente de verdad en TS, espejo 1:1 del ENUM de Postgres
export const IMPORTACION_ESTADOS = [
  'pendiente_mapeo', 'mapeando', 'procesando', 'completado', 'error', 'cancelado'
] as const;

export type ImportacionEstado = typeof IMPORTACION_ESTADOS[number];

// Helper para el cliente: saber qué estados son "terminales"
export const ESTADOS_TERMINALES: ImportacionEstado[] = ['completado','cancelado','error'];
export const ESTADOS_ACTIVOS: ImportacionEstado[] = 
  IMPORTACION_ESTADOS.filter(e => !ESTADOS_TERMINALES.includes(e));
