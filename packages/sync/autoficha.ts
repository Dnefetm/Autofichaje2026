import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { OpenAI } from 'openai';
import { classifyProduct, getCategoryExtraFields } from './classifier';

export interface AutofichaResult {
    // Identificación
    sku_detectado: string;      // SKU tal como aparece en el documento
    articulo_id?: string;       // ID confirmado del catálogo (null hasta buscar en BD)
    nombre: string;
    marca: string;
    modelo?: string;
    variante?: string;
    categoria?: string;
    // Descripciones
    descripcion?: string;       // Un solo campo — no hay descripcion_corta en articulos
    // Códigos
    codigo_universal?: string;  // EAN / UPC / GTIN
    codigo_sat?: string;
    // Dimensiones
    peso_kg?: number;
    largo_cm?: number;
    ancho_cm?: number;
    alto_cm?: number;
    // Materiales
    materiales?: string;
    pais_origen?: string;
    // Metadatos de calidad
    confidence: number;         // 0-1 global del LLM
    rawText: string;            // Texto OCR completo para auditoría
    // Storage
    storage_path?: string;      // Ruta en Supabase Storage si fue persistido
}

// ─── Paso 1: OCR con Azure Document Intelligence ──────────────────────────────

async function extractTextFromBuffer(
    buffer: Buffer,
    mimeType: string,
): Promise<{ text: string; confidence: number }> {
    const endpoint = process.env.AZURE_DI_ENDPOINT || process.env.AZURE_CV_ENDPOINT;
    const apiKey   = process.env.AZURE_DI_KEY   || process.env.AZURE_CV_KEY;

    if (!endpoint || !apiKey) {
        throw new Error(
            'Credenciales Azure no configuradas. Agrega AZURE_DI_ENDPOINT y AZURE_DI_KEY ' +
            'en las variables de entorno de Vercel.'
        );
    }

    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
    const poller  = await client.beginAnalyzeDocument('prebuilt-read', buffer);
    const result  = await poller.pollUntilDone();

    if (!result?.content) {
        throw new Error('Azure Document Intelligence no pudo extraer texto del documento.');
    }

    // Calcular confianza promedio de páginas
    const pages = result.pages ?? [];
    const avgConf = pages.length > 0
        ? pages.reduce((sum: number, p: any) =>
            sum + (p.words?.reduce((ws: number, w: any) => ws + (w.confidence ?? 1), 0) ?? 0) /
                   Math.max(p.words?.length ?? 1, 1), 0) / pages.length
        : 0.9;

    return { text: result.content, confidence: Math.round(avgConf * 100) / 100 };
}

// ─── Paso 2: Estructuración con GPT-4o-mini ───────────────────────────────────

const PROMPT_SISTEMA_BASE = `Eres un experto en ferretería industrial (herramientas, fijaciones, seguridad, construcción, plomería, iluminación, automotriz).
Extrae los datos del producto desde el texto OCR dado y responde SOLO con JSON, sin markdown.

Campos a extraer (usa null si no está disponible):
- sku_detectado: código de referencia del producto (modelo, partno, SKU, código de artículo)
- nombre: nombre comercial completo del producto
- marca: fabricante o brand
- modelo: número de modelo o referencia específica (si es distinto del sku)
- variante: variante del producto (tamaño, color, acabado)
- descripcion: descripción técnica completa del producto
- codigo_universal: EAN, UPC, GTIN o código de barras (13 dígitos preferentemente)
- codigo_sat: clave SAT de producto (7 dígitos, prefijos 22, 27, 31...)
- peso_kg: peso en kilogramos (número decimal)
- largo_cm: largo en centímetros (número decimal)
- ancho_cm: ancho en centímetros (número decimal)
- alto_cm: alto en centímetros (número decimal)
- materiales: materiales de fabricación (acero, aluminio, plástico ABS, etc.)
- pais_origen: país de fabricación
- confidence: tu nivel de confianza en la extracción (0.0 a 1.0)`;

function buildPromptForCategory(category: string, extraFields: string): string {
    if (!extraFields) return PROMPT_SISTEMA_BASE;
    return `${PROMPT_SISTEMA_BASE}

Campos adicionales para la categoría "${category}" (extrae si están disponibles):
- ${extraFields.split(', ').join('\n- ')}`;
}

async function structureWithAI(
    rawText: string,
    category: string,
): Promise<Omit<AutofichaResult, 'rawText' | 'storage_path'>> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const extraFields = getCategoryExtraFields(category);
    const systemPrompt = buildPromptForCategory(category, extraFields);

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: `Texto OCR del documento:\n\n${rawText.slice(0, 100_000)}` },
        ],
    });

    const raw = JSON.parse(response.choices[0].message.content || '{}');

    return {
        sku_detectado:    raw.sku_detectado  || `AUTO-${Date.now()}`,
        nombre:           raw.nombre         || 'Producto sin nombre',
        marca:            raw.marca          || '',
        modelo:           raw.modelo         || undefined,
        variante:         raw.variante       || undefined,
        categoria:        category,           // usa la categoría detectada por el clasificador
        descripcion:      raw.descripcion    || undefined,
        codigo_universal: raw.codigo_universal || undefined,
        codigo_sat:       raw.codigo_sat     || undefined,
        peso_kg:          typeof raw.peso_kg === 'number' ? raw.peso_kg : (parseFloat(raw.peso_kg) || undefined),
        largo_cm:         typeof raw.largo_cm === 'number' ? raw.largo_cm : (parseFloat(raw.largo_cm) || undefined),
        ancho_cm:         typeof raw.ancho_cm === 'number' ? raw.ancho_cm : (parseFloat(raw.ancho_cm) || undefined),
        alto_cm:          typeof raw.alto_cm === 'number' ? raw.alto_cm : (parseFloat(raw.alto_cm) || undefined),
        materiales:       raw.materiales     || undefined,
        pais_origen:      raw.pais_origen    || undefined,
        confidence:       typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.7,
    };
}

// ─── Función principal: documento único ────────────────────────────────────────

export async function processProductDocument(
    fileBuffer: Buffer,
    fileName: string,
    mimeType = 'application/octet-stream',
    storagePath?: string,
): Promise<AutofichaResult> {
    const { text: rawText } = await extractTextFromBuffer(fileBuffer, mimeType);

    if (!rawText || rawText.trim().length < 50) {
        throw new Error(
            'El documento no contiene suficiente texto legible. ' +
            'Verifica que el PDF no esté protegido o que la imagen tenga buena resolución.'
        );
    }

    const { category } = await classifyProduct(rawText);
    const structured    = await structureWithAI(rawText, category);

    return { ...structured, rawText, storage_path: storagePath };
}

// ─── Función principal: múltiples documentos (merge inteligente) ───────────────

export interface MultiDocInput {
    buffer:   Buffer;
    fileName: string;
    mimeType: string;
    storagePath?: string;
}

/**
 * Procesa N documentos en paralelo con OCR y luego consolida todo
 * en una única ficha usando un solo call a GPT-4o-mini.
 * Mucho más eficiente que N llamadas separadas.
 */
export async function processMultipleDocuments(
    docs: MultiDocInput[],
): Promise<AutofichaResult> {
    if (docs.length === 0) throw new Error('Se requiere al menos un documento.');

    // 1. OCR en paralelo para todos los archivos
    const ocrResults = await Promise.all(
        docs.map(d => extractTextFromBuffer(d.buffer, d.mimeType).catch(() => ({ text: '', confidence: 0 })))
    );

    // 2. Concatenar textos con separadores claros
    const combinedText = ocrResults
        .map((r, i) => `=== DOCUMENTO ${i + 1}: ${docs[i].fileName} ===\n${r.text}`)
        .join('\n\n');

    const avgConfidence = ocrResults.reduce((s, r) => s + r.confidence, 0) / ocrResults.length;

    if (combinedText.trim().length < 50) {
        throw new Error('Ninguno de los documentos contiene texto legible suficiente.');
    }

    // 3. Clasificar una sola vez con el texto combinado
    const { category } = await classifyProduct(combinedText);

    // 4. Estructurar con prompt especializado — GPT consolida automáticamente
    const structured = await structureWithAI(combinedText, category);

    // El storage_path apunta al primer archivo subido
    const primaryStoragePath = docs.find(d => d.storagePath)?.storagePath;

    return {
        ...structured,
        confidence: Math.round(Math.min(structured.confidence, avgConfidence) * 100) / 100,
        rawText:    combinedText,
        storage_path: primaryStoragePath,
    };
}
