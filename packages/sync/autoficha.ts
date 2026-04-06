import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { OpenAI } from 'openai';
import { classifyProduct, getCategoryExtraFields } from './classifier';

export interface AutofichaResult {
    // Identificación
    sku_detectado: string;      // SKU tal como aparece en el documento
    articulo_id?: string;       // ID confirmado del catálogo (null hasta buscar en BD)
    nombre: string;
    marca: string;
    fabricante?: string;        // Razón social del fabricante (puede diferir de la marca)
    modelo?: string;
    variante?: string;
    categoria?: string;
    // Descripciones
    descripcion?: string;           // Descripción corta / técnica principal
    descripcion_larga?: string;     // Descripción completa extendida si el documento la tiene
    especificaciones?: string;      // Texto libre de especificaciones técnicas tabuladas
    ingredientes?: string;          // Para productos químicos/cosméticos
    uso_recomendado?: string;       // Instrucciones de uso / aplicación
    precauciones?: string;          // Advertencias de seguridad / precauciones (campo general)
    // Campos regulatorios / etiquetado obligatorio
    informacion_normativa?: string;     // Textos obligatorios por NOM/ley (registro, fabricante, contenido neto)
    instrucciones_uso?: string;         // Modo de empleo claro para el usuario final
    leyendas_precautorias?: string;     // Advertencias de riesgo/peligro de etiquetado (GHS, NOM-018-STPS, etc.)
    indicaciones_almacenamiento?: string; // Condiciones de conservación, temperatura, humedad, caducidad
    // Listas (JSONB en BD)
    bullet_points?: string[];       // Lista de características/beneficios principales
    palabras_clave?: string[];      // Keywords para búsqueda/marketplace
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
    // Atributos técnicos (modelo híbrido v4)
    atributos_tecnicos?: Record<string, any>;   // Todos los datos técnicos detectados por la IA
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
- marca: fabricante o brand (nombre corto de la marca)
- fabricante: razón social completa del fabricante (ej: "Würth México S.A. de C.V."). Si no está, pon la marca.
- modelo: número de modelo o referencia específica (si es distinto del sku)
- variante: variante del producto (tamaño, color, acabado, capacidad)
- descripcion: descripción técnica corta del producto (máx 500 caracteres)
- descripcion_larga: descripción técnica completa y extendida del producto (sin límite de caracteres)
- especificaciones: texto de especificaciones técnicas tal como aparece en el documento (tablas, listas)
- ingredientes: composición o ingredientes activos (para lubricantes, químicos, adhesivos, etc.)
- uso_recomendado: instrucciones de uso, aplicación o modo de empleo (campo general, puede solapar con instrucciones_uso)
- precauciones: advertencias de seguridad y precauciones generales (campo heredado, puede solapar con leyendas_precautorias)
- informacion_normativa: textos que el fabricante/importador está OBLIGADO a incluir por ley en el etiquetado:
  número de registro sanitario, NOM de producto aplicable (ej. NOM-003-SSA1, NOM-018-STPS, NOM-050-SCFI),
  denominación legal del producto, contenido neto, nombre y dirección del responsable.
  NO incluyas especificaciones técnicas ni claims de marketing. Pon null si el documento no lo contiene explícitamente.
- instrucciones_uso: pasos o modo de empleo dirigidos al usuario final ("Agitar antes de usar", "Aplicar en capa delgada",
  "Leer el instructivo antes de usar"). NO mezcles con advertencias de riesgo ni especificaciones técnicas.
  Pon null si no hay instrucciones claras para el usuario final.
- leyendas_precautorias: advertencias de riesgo/peligro del etiquetado obligatorio:
  "Manténgase fuera del alcance de los niños", "Evite contacto con ojos", frases H/P del sistema GHS,
  clasificación de riesgo NOM-018-STPS, pictogramas descritos en texto. Consolida sin inventar texto.
  NO la confundas con precauciones generales de uso. Pon null si el documento no las contiene.
- indicaciones_almacenamiento: condiciones de conservación del producto: temperatura máxima/mínima, humedad,
  exposición a luz, ventilación requerida, separación de incompatibles, fecha de caducidad o vida útil.
  Ejemplos: "Conservar en lugar fresco y seco", "No exponer a temperaturas superiores a 40°C", "Vida útil: 24 meses".
  Pon null si el documento no especifica condiciones de almacenamiento.

REGLA CRÍTICA DE SEPARACIÓN:
  - Almacenamiento NO va en especificaciones técnicas.
  - Leyendas de peligro NO van en precauciones generales.
  - Normativa obligatoria NO va en descripción ni atributos técnicos.
  - Instrucciones de uso NO van mezcladas con advertencias ni specs.
- bullet_points: array de strings con las características/beneficios principales del producto (3-8 puntos)
- palabras_clave: array de strings con keywords para búsqueda en marketplaces (5-12 palabras)
- codigo_universal: EAN, UPC, GTIN o código de barras (13 dígitos preferentemente)
- codigo_sat: clave SAT de producto (7 dígitos, prefijos 22, 27, 31...)
- peso_kg: peso en kilogramos (número decimal)
- largo_cm: largo en centímetros (número decimal)
- ancho_cm: ancho en centímetros (número decimal)
- alto_cm: alto en centímetros (número decimal)
- materiales: materiales de fabricación (acero, aluminio, plástico ABS, etc.)
- pais_origen: país de fabricación
- atributos_tecnicos: objeto JSON con TODOS los datos técnicos adicionales que encuentres
  en el documento. DEBE ser un objeto JSON de pares clave-valor, NO texto con guiones.
  Usa keys descriptivas en español con mayúscula inicial (no snake_case).
  Incluye: normas (NOM, ISO, ASTM), capacidades, voltajes, presiones, rpm, temperaturas,
  torques, resistencias, certificaciones, viscosidades, caudales, dimensiones clave.
  Ejemplo correcto: {"Apertura máxima": "1-3/8\"", "Material": "Cromo-Vanadio", "Norma": "NOM-116", "Longitud": "25.4 cm"}
  Ejemplo incorrecto: "- Apertura máxima: 1-3/8\"\n- Material: Cromo-Vanadio"
  No filtres nada — extrae todo dato técnico que no haya sido capturado arriba.
  Si no hay datos adicionales, retorna objeto vacío {}.
- confidence: tu nivel de confianza en la extracción (0.0 a 1.0)`;

// ─── Helper: normalización de campos regulatorios ─────────────────────────────
// Acepta CUALQUIER tipo que el LLM o Supabase JSONB pueda devolver:
//   - string   → trim directo
//   - array    → join con salto de línea (el LLM a veces devuelve listas)
//   - object   → join de valores (ej. { texto: "..." })
//   - número / booleano → String()
//   - null / undefined  → undefined real
// Así nunca lanza "trim is not a function" sin importar la fuente del dato.
function _normalizeReg(value: unknown): string | undefined {
    if (value == null) return undefined;

    let s: string;

    if (typeof value === 'string') {
        s = value.trim();
    } else if (Array.isArray(value)) {
        s = value
            .map(x => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
            .filter(Boolean)
            .join('\n');
    } else if (typeof value === 'object') {
        s = Object.values(value as Record<string, unknown>)
            .map(x => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
            .filter(Boolean)
            .join('\n');
    } else {
        s = String(value).trim();
    }

    if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return undefined;
    return s;
}

async function structureWithAI(
    rawText: string,
    category: string,
    camposHint?: string[], // Campos solicitados — si vienen, el LLM solo los extrae
): Promise<Omit<AutofichaResult, 'rawText' | 'storage_path'>> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Si el operador especificó qué campos extraer, añadir instruccion al final del prompt
    const promptFinal = camposHint?.length
        ? PROMPT_SISTEMA_BASE +
          `\n\nINSTRUCCIÓN DEL OPERADOR: Extrae ÚNICAMENTE estos campos: ${camposHint.join(', ')}.` +
          ` Para TODOS los demás campos devuelve null. No inventes ni rellenes datos que no estén en el documento.`
        : PROMPT_SISTEMA_BASE;

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            { role: 'system', content: promptFinal },
            { role: 'user',   content: `Texto OCR del documento:\n\n${rawText.slice(0, 100_000)}` },
        ],
    });

    const raw = JSON.parse(response.choices[0].message.content || '{}');

    // Asegurar que atributos_tecnicos sea siempre un objeto, nunca null/array
    const atributos_tecnicos: Record<string, any> =
        raw.atributos_tecnicos && typeof raw.atributos_tecnicos === 'object' && !Array.isArray(raw.atributos_tecnicos)
            ? raw.atributos_tecnicos
            : {};

    return {
        sku_detectado:    raw.sku_detectado  || `AUTO-${Date.now()}`,
        nombre:           raw.nombre         || 'Producto sin nombre',
        marca:            raw.marca          || '',
        fabricante:       raw.fabricante     || raw.marca || undefined,
        modelo:           raw.modelo         || undefined,
        variante:         raw.variante       || undefined,
        categoria:        category,
        descripcion:      raw.descripcion    || undefined,
        descripcion_larga: raw.descripcion_larga || undefined,
        especificaciones: raw.especificaciones || undefined,
        ingredientes:     raw.ingredientes   || undefined,
        uso_recomendado:  raw.uso_recomendado || undefined,
        precauciones:     raw.precauciones   || undefined,
        // ── Campos regulatorios — con normalización defensiva ─────────────────
        informacion_normativa:     _normalizeReg(raw.informacion_normativa),
        instrucciones_uso:         _normalizeReg(raw.instrucciones_uso),
        leyendas_precautorias:     _normalizeReg(
            // Si el LLM duplicó exactamente precauciones en leyendas_precautorias, vaciarlo
            // para que el operador diferencie manualmente
            raw.leyendas_precautorias === raw.precauciones
                ? undefined
                : raw.leyendas_precautorias
        ),
        indicaciones_almacenamiento: _normalizeReg(raw.indicaciones_almacenamiento),
        bullet_points:    Array.isArray(raw.bullet_points) ? raw.bullet_points.filter((x: any) => typeof x === 'string') : undefined,
        palabras_clave:   Array.isArray(raw.palabras_clave) ? raw.palabras_clave.filter((x: any) => typeof x === 'string') : undefined,
        codigo_universal: raw.codigo_universal || undefined,
        codigo_sat:       raw.codigo_sat     || undefined,
        peso_kg:          typeof raw.peso_kg === 'number' ? raw.peso_kg : (parseFloat(raw.peso_kg) || undefined),
        largo_cm:         typeof raw.largo_cm === 'number' ? raw.largo_cm : (parseFloat(raw.largo_cm) || undefined),
        ancho_cm:         typeof raw.ancho_cm === 'number' ? raw.ancho_cm : (parseFloat(raw.ancho_cm) || undefined),
        alto_cm:          typeof raw.alto_cm === 'number' ? raw.alto_cm : (parseFloat(raw.alto_cm) || undefined),
        materiales:       raw.materiales     || undefined,
        pais_origen:      raw.pais_origen    || undefined,
        atributos_tecnicos,
        confidence:       typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.7,
    };
}

// ─── Función principal: documento único ────────────────────────────────────────

export async function processProductDocument(
    fileBuffer: Buffer,
    fileName: string,
    mimeType = 'application/octet-stream',
    storagePath?: string,
    camposHint?: string[],  // Campos a extraer (undefined = todos)
    productoObjetivo?: string, // Texto libre: "extrae solo el producto WÜRTH 8890402"
): Promise<AutofichaResult> {
    const { text: rawText } = await extractTextFromBuffer(fileBuffer, mimeType);

    if (!rawText || rawText.trim().length < 50) {
        throw new Error(
            'El documento no contiene suficiente texto legible. ' +
            'Verifica que el PDF no esté protegido o que la imagen tenga buena resolución.'
        );
    }

    // Combinar camposHint y productoObjetivo en el hint al LLM
    const hintFinal = [
        ...(camposHint ?? []),
        productoObjetivo ? `PRODUCTO OBJETIVO: "${productoObjetivo}"` : '',
    ].filter(Boolean);

    const { category } = await classifyProduct(rawText);
    const structured    = await structureWithAI(rawText, category, hintFinal.length ? hintFinal : undefined);

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
    camposHint?: string[],
    productoObjetivo?: string,
): Promise<AutofichaResult> {
    if (docs.length === 0) throw new Error('Se requiere al menos un documento.');

    const ocrResults = await Promise.all(
        docs.map(d => extractTextFromBuffer(d.buffer, d.mimeType).catch(() => ({ text: '', confidence: 0 })))
    );

    const MAX_TOTAL   = 100_000;
    const perDocLimit = Math.floor(MAX_TOTAL / docs.length);

    const combinedText = ocrResults
        .map((r, i) =>
            `=== DOCUMENTO ${i + 1}: ${docs[i].fileName} ===\n${r.text.slice(0, perDocLimit)}`
        )
        .join('\n\n');

    const avgConfidence = ocrResults.reduce((s, r) => s + r.confidence, 0) / ocrResults.length;

    if (combinedText.trim().length < 50) {
        throw new Error('Ninguno de los documentos contiene texto legible suficiente.');
    }

    const { category } = await classifyProduct(combinedText);

    const hintFinal = [
        ...(camposHint ?? []),
        productoObjetivo ? `PRODUCTO OBJETIVO: "${productoObjetivo}"` : '',
    ].filter(Boolean);

    const structured = await structureWithAI(combinedText, category, hintFinal.length ? hintFinal : undefined);

    const primaryStoragePath = docs.find(d => d.storagePath)?.storagePath;

    return {
        ...structured,
        confidence: Math.round(Math.min(structured.confidence, avgConfidence) * 100) / 100,
        rawText:    combinedText,
        storage_path: primaryStoragePath,
    };
}
