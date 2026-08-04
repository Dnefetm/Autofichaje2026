const fs = require('fs');
const pdfParse = require('pdf-parse');

async function parse() {
    const dataBuffer = fs.readFileSync('urrea.pdf');
    try {
        const data = await pdfParse(dataBuffer);
        console.log('--- PDF TEXT EXTRACTION ---');
        console.log('Number of pages:', data.numpages);
        console.log('Text length:', data.text.length);
        console.log('Preview:', data.text.substring(0, 1500));
    } catch (e) {
        console.error('Error parsing PDF:', e.message);
    }
}
parse();
