import { DocumentAnalysisClient, AzureKeyCredential } from '@azure/ai-form-recognizer';
import { OpenAI } from 'openai';
import { classifyProduct, getCategoryExtraFields } from './classifier';
import { isTextualMime, isHtmlMime, htmlToText, chunkText, formatComponentes, dedupComponentes } from './formats';

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
    // Piezas / componentes de un kit o juego (v48)
    componentes?: Array<{
        nombre: string;
        codigo?: string;
        cantidad?: string;
        medida?: string;
        material?: string;
        acabado?: string;
        descripcion?: string;
    }>;
    // Metadatos de calidad
    confidence: number;         // 0-1 global del LLM
    rawText: string;            // Texto OCR completo para auditoría
    // Storage
    storage_path?: string;      // Ruta en Supabase Storage si fue persistido
}

// --- Paso 1: OCR con Azure Document Intelligence ------------------------------

async function extractTextFromBuffer(
    buffer: Buffer,
    mimeType: string,
): Promise<{ text: string; confidence: number }> {
    // Texto plano / CSV / Markdown: extraer directamente, sin OCR.
    if (isTextualMime(mimeType)) {
        const text = buffer.toString('utf8');
        return { text, confidence: 1 };
    }

    // HTML: limpiar etiquetas y extraer el texto legible.
    if (isHtmlMime(mimeType)) {
        const text = htmlToText(buffer.toString('utf8'));
        return { text, confidence: 1 };
    }

    // PDF, imágenes y Office (DOCX/XLSX/PPTX/TIFF/BMP/HEIF): OCR con Azure.
    const endpoint = process.env.AZURE_DI_ENDPOINT || process.env.AZURE_CV_ENDPOINT;
    const apiKey   = process.env.AZURE_DI_KEY   || process.env.AZURE_CV_KEY;

    if (!endpoint || !apiKey) {
        throw new Error(
            'Credenciales Azure no configuradas. Agrega AZURE_DI_ENDPOINT y AZURE_DI_KEY ' +
            'en las variables de entorno de Vercel.'
        );
    }

    const client = new DocumentAnalysisClient(endpoint, new AzureKeyCredential(apiKey));
    const poller  = await client.beginAnalyzeDocument('prebuilt-layout', buffer);
    const result  = await poller.pollUntilDone();

    if (!result?.content) {
        throw new Error('Azure Document Intelligence no pudo extraer texto del documento.');
    }

    let extractedText = result.content;

    // Serializar tablas encontradas a Markdown
    if (result.tables && result.tables.length > 0) {
        extractedText += '\n\n--- TABLAS ESTRUCTURADAS ---\n\n';
        result.tables.forEach((table, tableIdx) => {
            // Etiquetar la tabla usando el contenido de la primera celda (si existe) para dar contexto
            let headerContext = '';
            if (table.cells && table.cells.length > 0) {
                const firstCell = table.cells.find(c => c.rowIndex === 0 && c.columnIndex === 0);
                if (firstCell && firstCell.content) {
                    headerContext = ` (Contexto: ${firstCell.content.replace(/\n/g, ' ').trim()})`;
                }
            }
            
            extractedText += `TABLA ${tableIdx + 1}${headerContext}:\n`;
            
            const numRows = table.rowCount;
            const numCols = table.columnCount;
            
            const grid: string[][] = Array.from({ length: numRows }, () => Array(numCols).fill(''));
            
            table.cells.forEach(cell => {
                // Rellenar la celda inicial
                grid[cell.rowIndex][cell.columnIndex] = cell.content.replace(/\n/g, ' ').trim();
                
                // Rellenar spans para no desalinear si una celda abarca múltiples columnas/filas
                const rSpan = cell.rowSpan || 1;
                const cSpan = cell.columnSpan || 1;
                
                for (let r = 0; r < rSpan; r++) {
                    for (let c = 0; c < cSpan; c++) {
                        if (r === 0 && c === 0) continue; // Ya rellenada
                        if (cell.rowIndex + r < numRows && cell.columnIndex + c < numCols) {
                            grid[cell.rowIndex + r][cell.columnIndex + c] = grid[cell.rowIndex][cell.columnIndex];
                        }
                    }
                }
            });
            
            grid.forEach((row, rowIdx) => {
                extractedText += '| ' + row.join(' | ') + ' |\n';
                if (rowIdx === 0) {
                    extractedText += '|' + Array(numCols).fill('---').join('|') + '|\n';
                }
            });
            extractedText += '\n';
        });
    }

    // Calcular confianza promedio de páginas
    const pages = result.pages ?? [];
    const textoReal = extractedText?.trim() ?? '';
    const avgConf = (textoReal.length >= 50 && pages.length > 0)
        ? pages.reduce((sum: number, p: any) =>
            sum + (p.words?.reduce((ws: number, w: any) => ws + (w.confidence ?? 1), 0) ?? 0) /
                   Math.max(p.words?.length ?? 1, 1), 0) / pages.length
        : 0;

    return { text: extractedText, confidence: Math.round(avgConf * 100) / 100 };
}

// --- Paso 2: Estructuración con GPT-4o-mini -----------------------------------

const PROMPT_SISTEMA_BASE = `Eres un experto en ferretería industrial (herramientas, fijaciones, seguridad, construcción, plomería, iluminación, automotriz).
Extrae los datos del producto desde el texto OCR dado y responde SOLO con JSON, sin markdown.

Campos a extraer (usa null si no está disponible):
- sku_detectado: código de referencia del producto (modelo, partno, SKU, código de artículo)
- nombre: nombre comercial completo del producto
- marca: fabricante o brand (nombre corto de la marca)
- fabricante: razón social completa del fabricante (ej: "Würth México S.A. de C.V."). Si no está, pon la marca.
- modelo: número de modelo, código de fabricante o número de parte (si es distinto del sku; frecuentemente alfanumérico al inicio de tablas)
- variante: variante del producto (tamaño, color, acabado, capacidad)
- descripcion: descripción técnica corta del producto (máx 500 caracteres)
- descripcion_larga: descripción técnica completa y extendida del producto (sin límite de caracteres). Si no hay una explícita, redacta un párrafo coherente uniendo las características principales y ventajas comerciales. NO uses listas con guiones aquí.
- especificaciones: especificaciones técnicas en texto LIMPIO y legible. Si el documento trae una TABLA de datos (ej. encabezados como "Ctd. embal.", "(A) mm", "(L1) mm"), NO copies encabezados y valores en bruto ni los concatenes; EMPAREJA cada encabezado/etiqueta con su valor y escribe cada par en su propia línea "- Etiqueta: valor". Si el documento es un catálogo (ej. código, descripción, piezas), extrae esos datos como "- Código: valor\n- Descripción: valor". Nunca devuelvas una fila de etiquetas seguida de una fila de números sueltos. Las medidas dimensionales tabuladas van además en atributos_tecnicos como pares clave-valor.
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
- bullet_points: array de strings con las características/beneficios principales o ventajas del producto (3-8 puntos)
- palabras_clave: array de strings con keywords para búsqueda en marketplaces (5-12 palabras)
- codigo_universal: EAN, UPC, GTIN o código de barras (13 dígitos preferentemente)
- codigo_sat: clave SAT de producto (7 dígitos, prefijos 22, 27, 31...)
- peso_kg: peso en kilogramos (número decimal)
- largo_cm: largo en centímetros (número decimal)
- ancho_cm: ancho en centímetros (número decimal)
- alto_cm: alto en centímetros (número decimal)
- materiales: materiales de fabricación (acero, aluminio, plástico ABS, Cr-V, etc.)
- pais_origen: país de fabricación
- atributos_tecnicos: objeto JSON con TODOS los datos técnicos adicionales que encuentres
  en el documento. DEBE ser un objeto JSON de pares clave-valor, NO texto con guiones.
  Usa keys descriptivas en español con mayúscula inicial (no snake_case).
  Incluye: contenido exacto del juego (lista de piezas y accesorios), TODAS las medidas de dados o herramientas incluidas (métricas y pulgadas), acabados, normas, capacidades, voltajes, presiones, rpm,
  temperaturas, torques, certificaciones, caudales, dimensiones clave.
  Ejemplo correcto: {"Apertura máxima": "1-3/8\"", "Material": "Cromo-Vanadio", "Dados métricos": "8mm a 21mm", "Dados pulgadas": "5/16\" a 1\"", "Accesorios": "Matraca, 2 extensiones, nudo universal", "Acabado": "Cromado"}
  Ejemplo incorrecto: "- Apertura máxima: 1-3/8\"\n- Material: Cromo-Vanadio"
  No filtres nada — extrae todo dato técnico, beneficio o característica que no haya sido capturado arriba.
  Si no hay datos adicionales, retorna objeto vacío {}.
- componentes: array de objetos SOLO si el documento describe un JUEGO/KIT/SET con varias piezas
  (brocas, dados, puntas, llaves, accesorios, etc.). Cada pieza como objeto:
  { "nombre": "...", "codigo": "...", "cantidad": "...", "medida": "...", "material": "...", "acabado": "...", "descripcion": "..." }.
  Lista CADA pieza por separado, con su medida y material individuales. NO resumas el kit en una sola línea.
  Si no es un kit o no hay lista de piezas, devuelve [].
- confidence: tu nivel de confianza en la extracción (0.0 a 1.0)`;

// --- Helper: normalización de campos regulatorios -----------------------------
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
    productoObjetivo?: string, // Producto específico a extraer en doc multi-producto
): Promise<Omit<AutofichaResult, 'rawText' | 'storage_path'>> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Construir instrucciones adicionales según lo que el operador especificó
    const extras: string[] = [];

    if (camposHint?.length) {
        extras.push(
            `\n\nINSTRUCCIÓN DE CAMPOS: Extrae ÚNICAMENTE estos campos: ${camposHint.join(', ')}.` +
            ` Para TODOS los demás campos devuelve null. No inventes ni rellenes datos que no estén en el documento.`
        );
    }

    if (productoObjetivo) {
        extras.push(
            `\n\nINSTRUCCIÓN DE PRODUCTO OBJETIVO: El documento puede contener información de varios productos` +
            ` (tabla comparativa, lista de precios, catálogo multi-producto).` +
            ` DEBES extraer EXCLUSIVAMENTE los datos del producto: "${productoObjetivo}".` +
            `\n\nREGLAS PARA TABLAS:` +
            `\n- Si el documento es una tabla/matriz con columnas por producto, localiza la COLUMNA que corresponde a "${productoObjetivo}" y lee SOLO esa columna.` +
            `\n- NO mezcles valores de columnas de otros productos aunque estén en la misma fila.` +
            `\n- Si hay sub-columnas (ej: 6 puntas / 12 puntas), elige la que corresponda al modelo exacto solicitado.` +
            `\n- Si el código del producto aparece en una columna de "CÓDIGO" o "MODELO", úsalo para localizar su fila/columna.` +
            `\n- Si el producto no aparece en el documento, devuelve confidence: 0.1 y todos los campos null.` +
            `\n- No asumas valores: si un dato no está explícitamente en la columna del producto objetivo, devuelve null para ese campo.`
        );
    }

    const promptFinal = PROMPT_SISTEMA_BASE + extras.join('');

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1, // Más determinista para tablas
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
        sku_detectado:    raw.sku_detectado  || '',
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
        // -- Campos regulatorios — con normalización defensiva -----------------
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
        componentes:      Array.isArray(raw.componentes) ? raw.componentes.filter((c: any) => c && typeof c === 'object' && c?.nombre) : undefined,
        confidence:       typeof raw.confidence === 'number' ? Math.min(1, Math.max(0, raw.confidence)) : 0.7,
    };
}

// --- Paso 2c: extracción de detalles técnicos por chunks (map-reduce) ---------
// Para documentos largos (>100K chars) el corte del prompt principal pierde las
// tablas finales (p. ej. la lista de brocas de un kit). Esta pasada barre el texto
// completo en ventanas y consolida atributos_tecnicos + componentes.

const CHUNK_SIZE = 60_000;
const CHUNK_OVERLAP = 2_000;

const DETAILS_PROMPT = `Eres un experto en ferretería industrial. Analiza un FRAGMENTO de un documento técnico.
Extrae SOLO datos técnicos. Responde SOLO con JSON sin markdown:
{
  "atributos_tecnicos": { ...pares clave-valor... },
  "componentes": [ { "nombre": "...", "codigo": "...", "cantidad": "...", "medida": "...", "material": "...", "acabado": "...", "descripcion": "..." } ]
}
- atributos_tecnicos: objeto JSON con TODOS los datos técnicos del fragmento (medidas, materiales, acabados, normas, capacidades, voltajes, presiones, rpm, torques, etc.). Usa keys descriptivas en español. Si no hay, {}.
- componentes: si el fragmento lista piezas de un JUEGO/KIT/SET (brocas, dados, puntas, llaves, accesorios), devuelve CADA pieza como objeto con su medida y material individuales. Si no hay piezas, [].
NO inventes datos. No incluyas marketing.`;

async function extractTechnicalDetails(rawText: string): Promise<{ atributos_tecnicos: Record<string, any>; componentes: any[] }> {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const chunks = chunkText(rawText, CHUNK_SIZE, CHUNK_OVERLAP);
    const mergedAttr: Record<string, any> = {};
    const mergedComp: any[] = [];

    for (const chunk of chunks) {
        try {
            const resp = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.1,
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: DETAILS_PROMPT },
                    { role: 'user', content: `Fragmento del documento:\n\n${chunk}` },
                ],
            });
            const raw = JSON.parse(resp.choices[0].message.content || '{}');
            if (raw.atributos_tecnicos && typeof raw.atributos_tecnicos === 'object' && !Array.isArray(raw.atributos_tecnicos)) {
                Object.assign(mergedAttr, raw.atributos_tecnicos);
            }
            if (Array.isArray(raw.componentes)) {
                for (const c of raw.componentes) {
                    if (c && typeof c === 'object' && c?.nombre) mergedComp.push(c);
                }
            }
        } catch (err: any) {
            console.error('[autoficha] fallo en chunk de detalles técnicos:', err?.message);
        }
    }

    return { atributos_tecnicos: mergedAttr, componentes: mergedComp };
}

// --- Descubrimiento de productos (Etapa 1 del flujo 2-etapas) -----------------
// Se usa cuando el usuario indica que el doc tiene varios productos y quiere elegir uno.
// Costo: ~400 tokens. Latencia: ~1-2 segundos.

export interface ProductoDescubierto {
    nombre:            string;
    codigo:            string;  // Código de parte, modelo, SKU — vacío si no aplica
    descripcion_breve: string;  // ≤80 chars
}

export async function discoverProducts(
    fileBuffer: Buffer,
    mimeType = 'application/octet-stream',
): Promise<ProductoDescubierto[]> {
    const { text: rawText } = await extractTextFromBuffer(fileBuffer, mimeType);
    if (!rawText || rawText.trim().length < 30) return [];

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content:
                    'Eres un extractor de inventario. Analiza el texto OCR e identifica TODOS los productos distintos del documento.\n' +
                    'El documento puede ser: tabla de precios, catálogo, lista de materiales, ficha técnica multi-producto.\n' +
                    'Devuelve SOLO un JSON con la clave "productos" (array). Cada elemento:\n' +
                    '  { "nombre": string, "codigo": string, "descripcion_breve": string (≤80 chars) }\n' +
                    'Si el documento tiene UN SOLO producto, devuelve ese en el array.\n' +
                    'Si hay más de 40 productos, devuelve solo los primeros 40.\n' +
                    'Si un campo no aplica, usa string vacío. NUNCA inventes datos.',
            },
            {
                role: 'user',
                content: `Texto OCR:\n\n${rawText.slice(0, 60_000)}`,
            },
        ],
    });

    try {
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
        const arr = Array.isArray(parsed.productos) ? parsed.productos : [];
        return arr
            .filter((p: any) => typeof p === 'object' && p !== null)
            .map((p: any) => ({
                nombre:            String(p.nombre           ?? '').trim(),
                codigo:            String(p.codigo            ?? '').trim(),
                descripcion_breve: String(p.descripcion_breve ?? '').trim().slice(0, 100),
            }))
            .filter((p: ProductoDescubierto) => p.nombre.length > 0);
    } catch {
        return [];
    }
}

// --- Función principal: documento único ----------------------------------------

export async function processProductDocument(
    fileBuffer: Buffer,
    fileName: string,
    mimeType = 'application/octet-stream',
    storagePath?: string,
    camposHint?: string[],  // Campos a extraer (undefined = todos)
    productoObjetivo?: string, // Texto libre: "extrae solo el producto WÜRTH 8890402"
): Promise<AutofichaResult> {
    const { text: rawText, confidence } = await extractTextFromBuffer(fileBuffer, mimeType);

    // GUARDA DURA: OCR vacío = error, nunca extracción muda con confidence alto
    if (!rawText || rawText.trim().length < 50 || confidence === 0) {
        throw new Error(
            'OCR no extrajo texto del documento (posible PDF de solo-imagen, escaneo de baja calidad o archivo corrupto). ' +
            'No se guardó ninguna extracción para evitar fichas mudas.'
        );
    }

    // Combinar camposHint y productoObjetivo — pasarlos por separado a structureWithAI
    const { category } = await classifyProduct(rawText);
    const structured    = await structureWithAI(rawText, category,
        camposHint?.length ? camposHint : undefined,
        productoObjetivo || undefined);

    // Documentos largos: barrer el texto completo en chunks para no perder las tablas
    // finales (p. ej. las características de las brocas de un kit).
    let componentes = structured.componentes ?? [];
    if (rawText.length > 100_000) {
        const tech = await extractTechnicalDetails(rawText);
        structured.atributos_tecnicos = { ...(structured.atributos_tecnicos ?? {}), ...tech.atributos_tecnicos };
        componentes = [...componentes, ...tech.componentes];
    }
    componentes = dedupComponentes(componentes);
    if (componentes.length > 0) {
        (structured.atributos_tecnicos ??= {})['Componentes del juego'] = formatComponentes(componentes);
    }

    return { ...structured, componentes, rawText, storage_path: storagePath };
}

// --- Función principal: múltiples documentos (merge inteligente) ---------------

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

    const structured = await structureWithAI(combinedText, category,
        camposHint?.length ? camposHint : undefined,
        productoObjetivo || undefined);

    let componentes = structured.componentes ?? [];
    if (combinedText.length > 100_000) {
        const tech = await extractTechnicalDetails(combinedText);
        structured.atributos_tecnicos = { ...(structured.atributos_tecnicos ?? {}), ...tech.atributos_tecnicos };
        componentes = [...componentes, ...tech.componentes];
    }
    componentes = dedupComponentes(componentes);
    if (componentes.length > 0) {
        (structured.atributos_tecnicos ??= {})['Componentes del juego'] = formatComponentes(componentes);
    }

    const primaryStoragePath = docs.find(d => d.storagePath)?.storagePath;

    return {
        ...structured,
        componentes,
        confidence: Math.round(Math.min(structured.confidence, avgConfidence) * 100) / 100,
        rawText:    combinedText,
        storage_path: primaryStoragePath,
    };
}
