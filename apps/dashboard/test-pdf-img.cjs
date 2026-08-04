const sharp = require('sharp');

async function toPdfDataUrl(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const png = await sharp(buf).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64').substring(0, 50)}...`;
  } catch (err) {
    console.error('Error in toPdfDataUrl:', err);
    return null;
  }
}

async function test() {
    const url = 'https://ryxdqnzyvnrwalylqyvm.supabase.co/storage/v1/object/public/ficha-imagenes/09ffde78/bccf083d-a3c8-455c-b8e8-a2fcb93c748e/0_1781800455930.webp';
    const result = await toPdfDataUrl(url);
    console.log('Result:', result);
}
test();
