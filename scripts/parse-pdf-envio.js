// Parsea el PDF de "preparación de envío Full" de MeLi.
// Extrae: guía, códigos ML (con SKU), y unidades — validando contra el encabezado.
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const FILE = process.argv[2] || 'docs/ReposiciónFull/Inbound-76468591-preparation-instructions (9).pdf';

(async () => {
  const buf = fs.readFileSync(FILE);
  const parser = new PDFParse({ data: buf });
  const result = await parser.getText();
  const text = result.text;

  const guia = (text.match(/Envío #(\d+)/) || [])[1];
  const tot = (text.match(/Productos del envío:\s*(\d+)\s*\|\s*Total de unidades:\s*(\d+)/) || []);
  console.log('guia:', guia, '| productos declarados:', tot[1], '| unidades declaradas:', tot[2]);

  // códigos ML en orden
  const codigos = [...text.matchAll(/Código ML:\s*(\S+)/g)].map(m => m[1]);

  // unidades: enteros "standalone" tras el encabezado de tabla por página
  const unidades = [];
  const pages = text.split(/--\s*\d+\s+of\s+\d+\s*--/);
  for (const page of pages) {
    const idx = page.indexOf('PRODUCTO UNIDADES');
    if (idx === -1) continue;
    const tabla = page.slice(idx);
    // líneas que empiezan con un entero (la columna UNIDADES) — también "30 • ..."
    const lines = tabla.split(/\r?\n/);
    for (const ln of lines) {
      const m = ln.match(/^\s*(\d{1,4})\b/);
      if (m && /^\s*\d{1,4}(\s|$)/.test(ln) && !/Código|SKU|PRODUCTO|UNIDADES|IDENTIFICACIÓN|INSTRUCCIONES/.test(ln)) {
        // evitar capturar "90" dentro de "mayor a 90 días" (no está al inicio de línea)
        if (/^\s*\d{1,4}(\s+[•·]|$)/.test(ln)) {
          unidades.push(parseInt(m[1], 10));
        }
      }
    }
  }

  console.log('códigos ML extraídos:', codigos.length, '| unidades extraídas:', unidades.length);
  console.log('suma unidades:', unidades.reduce((a, b) => a + b, 0));

  // zip y muestra
  const items = [];
  for (let i = 0; i < Math.min(codigos.length, unidades.length); i++) {
    items.push({ codigo_ml: codigos[i], unidades: unidades[i] });
  }
  console.log('=== muestra (primeros 12) ===');
  items.slice(0, 12).forEach(x => console.log(`  ${x.codigo_ml} = ${x.unidades}`));
})().catch(e => { console.error(e); process.exit(1); });
