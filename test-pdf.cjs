require('dotenv').config({ path: 'apps/dashboard/.env.local' });
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function testPdf() {
    console.log("Fetching images...");
    const { data: imgs } = await supabase
        .from('ficha_imagenes')
        .select('url')
        .eq('ficha_id', 'bccf083d-a3c8-455c-b8e8-a2fcb93c748e');
    
    console.log("Found images:", imgs?.length);
    
    const sharp = require('sharp');
    const urls = [];
    for (const r of imgs) {
        try {
            console.log("Converting", r.url);
            const res = await fetch(r.url);
            const buf = Buffer.from(await res.arrayBuffer());
            const png = await sharp(buf).png().toBuffer();
            urls.push(`data:image/png;base64,${png.toString('base64')}`);
            console.log("Converted OK");
        } catch (e) {
            console.error("Error converting", e);
        }
    }
    
    // Now call the actual react-pdf generation if possible, 
    // but react-pdf is JSX.
}
testPdf();
