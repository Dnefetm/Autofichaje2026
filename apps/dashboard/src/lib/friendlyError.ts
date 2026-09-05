// H9 (POLITICAS_FRONTEND.md): traducir errores de BD a mensaje humano.
export function friendlyError(e: any): string {
    const code = e?.code;
    const msg = String(e?.message || '');
    if (code === '23503') return 'El artículo o registro relacionado ya no existe.';
    if (code === '23505') return 'Ese registro ya existe (¿lo intentaste dos veces?).';
    if (code === '22P02') return 'Formato de dato inválido.';
    if (code === '23502') return 'Falta un dato obligatorio.';
    if (/PGRST|duplicate key|foreign key/i.test(msg)) return 'No se pudo guardar: revisa que los datos estén completos y no duplicados.';
    return 'No se pudo completar la acción. Inténtalo de nuevo.';
}
