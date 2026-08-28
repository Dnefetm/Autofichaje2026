/**
 * Algoritmo de Redondeo Mágico y Modificadores Financieros
 * Prioridad de dígitos estricta: 1 > 7 > 4 > 2 > 3 > 5 > 0 > 6 > 9 > 8
 */

export const DIGIT_PRIORITIES: Record<string, number> = {
    '1': 10,
    '7': 9,
    '4': 8,
    '2': 7,
    '3': 6,
    '5': 5,
    '0': 4,
    '6': 3,
    '9': 2,
    '8': 1
};

export interface MagicRoundingResult {
    subtotal: number;
    finalPrice: number;
    adjustmentAmount: number;
    adjustmentPct: number;
    bestScore: number;
    targetVal: number;
    minVal: number;
    maxVal: number;
}

export function getDigitScore(numStr: string): number {
    if (!numStr || numStr.length === 0) return 0;
    let score = 0;
    for (const char of numStr) {
        score += DIGIT_PRIORITIES[char] || 0;
    }
    return score / numStr.length;
}

/**
 * Aplica el redondeo estratégico y de marketing según la jerarquía de dígitos.
 * @param subtotal Precio de equilibrio calculado antes del redondeo
 * @param targetPct Porcentaje objetivo de reducción (default: -10%)
 * @param marginRange Rango de tolerancia permitido (default: min 9%, max 14%)
 */
export function applyMagicRounding(
    subtotal: number,
    targetPct: number = -10,
    marginRange: { min: number; max: number } = { min: 9, max: 14 }
): MagicRoundingResult {
    if (!subtotal || subtotal <= 1) {
        return {
            subtotal: subtotal || 0,
            finalPrice: subtotal || 0,
            adjustmentAmount: 0,
            adjustmentPct: 0,
            bestScore: 0,
            targetVal: subtotal || 0,
            minVal: subtotal || 0,
            maxVal: subtotal || 0
        };
    }

    const idealDecimal = 1 + (targetPct / 100);
    const minDecimal = 1 - (marginRange.max / 100);
    const maxDecimal = 1 - (marginRange.min / 100);

    const targetVal = Math.round(subtotal * idealDecimal);
    const minVal = Math.round(subtotal * minDecimal);
    const maxVal = Math.round(subtotal * maxDecimal);

    let bestNum = targetVal;
    let bestScore = -1;
    let bestDist = Infinity;

    for (let i = minVal; i <= maxVal; i++) {
        const numStr = Math.abs(i).toString();
        const score = getDigitScore(numStr);
        const distToIdeal = Math.abs(i - targetVal);

        if (score > bestScore) {
            bestScore = score;
            bestNum = i;
            bestDist = distToIdeal;
        } else if (score === bestScore && distToIdeal < bestDist) {
            bestScore = score;
            bestNum = i;
            bestDist = distToIdeal;
        }
    }

    const adjustmentAmount = Math.round((bestNum - subtotal) * 100) / 100;
    const adjustmentPct = Math.round(((bestNum - subtotal) / subtotal) * 10000) / 100;

    return {
        subtotal,
        finalPrice: bestNum,
        adjustmentAmount,
        adjustmentPct,
        bestScore,
        targetVal,
        minVal,
        maxVal
    };
}

export interface PricingModifiers {
    aplicar_margen?: boolean;
    margen_pct?: number;
    aplicar_comision?: boolean;
    comision_pct?: number;
    aplicar_envio?: boolean;
    shipping_cost_monto?: number;
    envio_fijo?: number;
    aplicar_retenciones?: boolean;
    retenciones_pct?: number;
    aplicar_redondeo_magico?: boolean;
    redondeo_target_pct?: number;
    redondeo_min_pct?: number;
    redondeo_max_pct?: number;
    redondeo_modo?: 'magic' | '00' | '99' | '5' | 'none';
}

export interface FullPriceBreakdown {
    costo_base: number;
    cost_basis: string;
    modifiers: {
        aplicar_margen: boolean;
        margen_pct: number;
        margen_monto: number;
        aplicar_comision: boolean;
        comision_pct: number;
        comision_fee: number;
        aplicar_envio: boolean;
        shipping_cost_monto: number;
        shipping_cost_final: number;
        aplicar_retenciones: boolean;
        retenciones_pct: number;
        withholding_fee: number;
        aplicar_redondeo_magico: boolean;
        redondeo_target_pct: number;
        redondeo_range: { min: number; max: number };
        subtotal_sin_redondeo: number;
        redondeo_ajuste: number;
        precio_final: number;
    };
    subtotal: number;
    precio_final: number;
    formula_humana: string;
}

export function calculateFullPriceBreakdown(
    costoBase: number,
    costBasis: string,
    modifiers: PricingModifiers
): FullPriceBreakdown {
    const base = Number(costoBase) || 0;
    const aplicarMargen = modifiers.aplicar_margen !== false;
    const margenPct = aplicarMargen ? Number(modifiers.margen_pct || 0) : 0;
    const margenMonto = Math.round(base * (margenPct / 100) * 100) / 100;

    const aplicarEnvio = modifiers.aplicar_envio !== false;
    const envioReal = aplicarEnvio ? Number(modifiers.shipping_cost_monto || 0) : 0;
    const envioFijo = aplicarEnvio ? Number(modifiers.envio_fijo || 0) : 0;
    const shippingTotal = envioReal + envioFijo;

    const aplicarComision = modifiers.aplicar_comision !== false;
    const comisionPct = aplicarComision ? Number(modifiers.comision_pct || 0) : 0;

    const aplicarRetenciones = modifiers.aplicar_retenciones !== false;
    const retencionesPct = aplicarRetenciones ? Number(modifiers.retenciones_pct || 0) : 0;

    const numerador = (base * (1 + margenPct / 100)) + shippingTotal;
    const denominador = 1.0 - ((comisionPct + retencionesPct) / 100);

    const subtotal = denominador > 0 ? Math.round((numerador / denominador) * 100) / 100 : base;

    const comisionFee = Math.round(subtotal * (comisionPct / 100) * 100) / 100;
    const withholdingFee = Math.round(subtotal * (retencionesPct / 100) * 100) / 100;

    const targetPct = modifiers.redondeo_target_pct ?? -10;
    const minPct = modifiers.redondeo_min_pct ?? 9;
    const maxPct = modifiers.redondeo_max_pct ?? 14;

    let precioFinal = subtotal;
    let redondeoAjuste = 0;

    if (modifiers.aplicar_redondeo_magico !== false && modifiers.redondeo_modo !== 'none') {
        if (modifiers.redondeo_modo === '99') {
            precioFinal = Math.floor(subtotal / 10) * 10 + 9;
        } else if (modifiers.redondeo_modo === '00') {
            precioFinal = Math.round(subtotal / 10) * 10;
        } else if (modifiers.redondeo_modo === '5') {
            precioFinal = Math.round(subtotal / 5) * 5;
        } else {
            const magicRes = applyMagicRounding(subtotal, targetPct, { min: minPct, max: maxPct });
            precioFinal = magicRes.finalPrice;
        }
        redondeoAjuste = Math.round((precioFinal - subtotal) * 100) / 100;
    }

    const formulaHumana = `(($${base.toFixed(2)} × ${aplicarMargen ? (1 + margenPct/100).toFixed(2) : '1.00'}) + $${shippingTotal.toFixed(2)}) / (1 - ${((comisionPct + retencionesPct)/100).toFixed(2)}) = $${subtotal.toFixed(2)} ➔ Redondeo: $${precioFinal.toFixed(2)}`;

    return {
        costo_base: base,
        cost_basis: costBasis,
        modifiers: {
            aplicar_margen: aplicarMargen,
            margen_pct: margenPct,
            margen_monto: margenMonto,
            aplicar_comision: aplicarComision,
            comision_pct: comisionPct,
            comision_fee: comisionFee,
            aplicar_envio: aplicarEnvio,
            shipping_cost_monto: envioReal,
            shipping_cost_final: shippingTotal,
            aplicar_retenciones: aplicarRetenciones,
            retenciones_pct: retencionesPct,
            withholding_fee: withholdingFee,
            aplicar_redondeo_magico: modifiers.aplicar_redondeo_magico !== false,
            redondeo_target_pct: targetPct,
            redondeo_range: { min: minPct, max: maxPct },
            subtotal_sin_redondeo: subtotal,
            redondeo_ajuste: redondeoAjuste,
            precio_final: precioFinal
        },
        subtotal,
        precio_final: precioFinal,
        formula_humana: formulaHumana
    };
}
