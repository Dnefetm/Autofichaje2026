import fs from 'fs';

async function testFetch() {
    console.log('Fetching PDF from Urreanet...');
    const url = 'https://www.urreanet.com/urreanetnuevo/data/FichasTecnicasN/FTDOC3735.pdf';
    try {
        const resp = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (!resp.ok) {
            console.error('HTTP Error:', resp.status, resp.statusText);
            return;
        }
        const arrayBuffer = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        console.log('Success! Downloaded bytes:', buffer.length);
        fs.writeFileSync('urrea.pdf', buffer);
    } catch (err: any) {
        console.error('Fetch error:', err.message);
    }
}

testFetch();
