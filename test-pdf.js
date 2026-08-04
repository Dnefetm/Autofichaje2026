const fs = require('fs');
const pdfParse = require('pdf-parse');

async function parse() {
    console.log('Reading urrea.pdf...');
    const dataBuffer = fs.readFileSync('urrea.pdf');
    try {
        console.log('pdfParse keys:', Object.keys(pdfParse));
        const parseFunc = typeof pdfParse === 'function' ? pdfParse : (pdfParse.default || pdfParse.pdfParse);
        const data = await parseFunc(dataBuffer);
        console.log('--- PDF TEXT EXTRACTION ---');
        console.log('Number of pages:', data.numpages);
        console.log('Text length:', data.text.length);
        console.log('Preview:', data.text.substring(0, 3000));
    } catch (e) {
        console.error('Error parsing PDF:', e.message);
    }
}
parse();
