const XLSX = require('xlsx');

const headers = ['Marca', 'Modelo', 'Precio'];
const data = [];
data.push(headers);

// Generate 200,000 rows
for (let i = 0; i < 200000; i++) {
    data.push([
        'MarcaTest' + (i % 10),
        'Mod' + i,
        (Math.random() * 1000).toFixed(2)
    ]);
}

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(data);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");

const path = 'C:\\Users\\dnefe\\.gemini\\antigravity\\brain\\e5e73cd2-3401-489a-9f83-d20d8d924e52\\scratch\\large_dummy.xlsx';
XLSX.writeFile(wb, path);
console.log('File generated at:', path);
