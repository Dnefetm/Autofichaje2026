const { OpenAI } = require('openai');
require('dotenv').config({ path: '.env.local' });

const rawText = `USO:
Ideales para una amplia variedad de tareas mecánicas, 
de mantenimiento, armado y desarmado.JUEGO DE DADOS      
Y ACCESORIOS .
PIEZAS30
CUADRO MÉTRICO PULGADA FABRICADO EN Cr-VCROMO-VANADIO
PRÁCTICO ESTUCHE
plástico sobremoldeado.
CÓDIGO DESCRIPCIÓN PIEZAS
5401CD Juego de dados y accesorios 1/2" 30 26 4Estuche 
plástico1VENTAJAS
CARACTERÍSTICASPARA USO EN
múltiples tareas.INCLUYE
caja plástica.VARIEDAD DE
tamaños.EL ESTUCHE MANTIENE
la herramienta ordenada.
ACABADO
cromado.MATRACA CON
función reversible.MECANISMO DE
liberación rápida.BENEFICIOS
CONTENIDO
5/16"
3/8"
7/16"
1/2"
9/16"
5/8"
11/16"
3/4"
13/16"
7/8"
15/16"
1"8 mm
9 mm
10 mm
11 mm
12 mm
13 mm
14 mm
15 mm
16 mm
17 mm
18 mm
19 mm
20 mm
21 mmMÉTRICO PULGADADADOS 6 PUNTAS
ACCESORIOS
Matraca
3"Extensión
5"Extensión
Nudo universalMATRACA REVERSIBLE
quick release.`;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function test() {
    const prompt = `Extrae información estructurada sobre el producto del siguiente texto OCR extraído de su ficha técnica.
El texto puede contener saltos de línea erróneos, falta de espacios, o estar desordenado debido a la extracción de PDF.

Si no encuentras información para un campo, devuelve null. NO inventes datos.
Si un campo está implícito o mal formateado, arréglalo y extráelo de la mejor manera posible.

REGLAS DE FORMATO:
- descripcion_larga: Descripción detallada y comercial del producto. Si no hay una explícita, concatena las características principales formando párrafos coherentes. NO uses listas con guiones aquí.
- especificaciones: especificaciones técnicas en texto LIMPIO y legible. Si el documento trae una TABLA de datos, EMPAREJA cada encabezado/etiqueta con su valor correspondiente por posición y escribe cada par en su propia línea con el formato "- Etiqueta: valor".
- uso_recomendado: instrucciones de uso, aplicación o modo de empleo.
- bullet_points: array de strings con las características/beneficios principales del producto (3-8 puntos)
- peso_kg: peso en kilogramos (número decimal)
- materiales: materiales de fabricación (acero, aluminio, plástico ABS, etc.)
- atributos_tecnicos: objeto JSON con TODOS los datos técnicos adicionales que encuentres. Usa keys descriptivas en español con mayúscula inicial.

TEXTO OCR:
${rawText}`;

    const tools = [{
        type: "function",
        function: {
            name: "extract_product_data",
            description: "Extrae los datos técnicos del documento",
            parameters: {
                type: "object",
                properties: {
                    descripcion_larga: { type: "string" },
                    especificaciones: { type: "string" },
                    uso_recomendado: { type: "string" },
                    bullet_points: { type: "array", items: { type: "string" } },
                    peso_kg: { type: "number" },
                    materiales: { type: "string" },
                    atributos_tecnicos: { type: "object" }
                }
            }
        }
    }];

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [
                { role: 'system', content: 'Eres un analista de datos técnicos e ingeniería experto en extracción de catálogos industriales.' },
                { role: 'user', content: prompt }
            ],
            tools,
            tool_choice: { type: 'function', function: { name: 'extract_product_data' } },
            temperature: 0,
        });

        console.log(JSON.stringify(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments), null, 2));
    } catch (e) {
        console.error('Error:', e.message);
    }
}
test();
