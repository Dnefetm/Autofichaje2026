import axios from 'axios';
import { OpenAI } from 'openai';
import { SKU } from '@gestor/shared';

export async function processProductDocument(fileBuffer: Buffer, fileName: string): Promise<Partial<SKU>> {
    // Instanciar OpenAI dentro de la función para evitar ejecución en build time
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 1. OCR (Placeholder - En producción usaría Azure Vision API)
    const rawText = `Texto extraido de ${fileName}: Destornillador de precisión Victorinox. Punta magnética. Mango ergonómico. Largo 150mm. Acero inoxidable.`;

    // 2. Estructuración con GPT-4o-mini
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: "Eres un experto en herramientas de ferretería. Extrae datos técnicos estructurados en JSON."
            },
            {
                role: "user",
                content: `Extrae los siguientes campos en JSON (sku, nombre, marca, material, dimensiones, descripcion) del texto: ${rawText}`
            }
        ],
        response_format: { type: "json_object" }
    });

    const structuredData = JSON.parse(response.choices[0].message.content || '{}');

    return {
        sku: structuredData.sku || `AUTO-${Date.now()}`,
        name: structuredData.nombre,
        brand: structuredData.marca,
        description: structuredData.descripcion,
        metadata: {
            material: structuredData.material,
            dimensions: structuredData.dimensiones,
        }
    };
}
