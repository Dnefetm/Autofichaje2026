/**
 * ai-guard.ts — Reglas anti-alucinación compartidas por la IA de publicación.
 *
 * El bloque ANTI_HALLUCINATION_BLOCK se antepone SIEMPRE al prompt editable
 * (no puede ser eliminado por el usuario). El guardAttributes es una segunda
 * barrera determinística que descarta valores que no están respaldados por
 * los datos de entrada.
 */

export const ANTI_HALLUCINATION_BLOCK = `REGLAS DE NO-ALUCINACIÓN (obligatorias e innegociables):
1. Usa EXCLUSIVAMENTE la información del apartado "Datos del producto".
2. Si un dato NO está en la entrada, OMÍTELO (devuélvelo como null o no lo menciones).
3. NO inventes marcas, modelos, medidas, pesos, materiales, colores, acabados, garantías ni especificaciones.
4. No uses conocimiento general del producto si no está explícito en los datos proporcionados.`;

/**
 * Normaliza un texto para comparación: minúsculas, sin espacios múltiples.
 */
function norm(s: unknown): string {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Segunda barrera anti-alucinación: para atributos de TEXTO LIBRE (value_name
 * sin value_id), descarta el valor si no aparece literalmente en el texto de
 * entrada. Los de lista cerrada (value_id) se conservan tal cual porque la
 * opción proviene de la lista permitida por MeLi.
 */
export function guardAttributes(
    attributes: Array<{ id: string; value_name?: string; value_id?: string }>,
    haystack: string,
): Array<{ id: string; value_name?: string; value_id?: string }> {
    const hay = norm(haystack);
    return attributes.filter((a) => {
        if (!a || !a.id) return false;
        if (a.value_id) return true; // selección de lista cerrada
        if (!a.value_name) return false;
        const v = norm(a.value_name);
        if (v.length < 2) return false;
        return hay.includes(v);
    });
}
