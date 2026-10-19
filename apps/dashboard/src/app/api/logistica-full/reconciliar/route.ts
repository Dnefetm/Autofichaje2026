import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// CONGELADO (reversión "en camino" → MeLi).
// Antes este endpoint leía INBOUND_RECEPTION y marcaba egresos estado_envio='recibido'
// para sacarlos del "en camino" LOCAL. Ese "en camino" local ya no existe: ahora
// "en camino" = stock_full_total − stock_full (MeLi), que se apaga solo cuando MeLi
// recibe el camión. Se conserva la ruta para el futuro "cazador de reembolsos".
export async function POST(_req: Request) {
    return NextResponse.json({
        success: true,
        congelado: true,
        message: 'Reconciliación INBOUND_RECEPTION congelada: "en camino" ahora es dato nativo de MeLi (stock_full_total − stock_full).',
    });
}
