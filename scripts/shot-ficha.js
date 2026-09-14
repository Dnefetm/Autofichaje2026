// Captura la FICHA de producto (con mapeos) a 392px para validar el header responsive.
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:3111';

(async () => {
  const env = fs.readFileSync('.env', 'utf8');
  const url = (env.match(/^SUPABASE_URL=(.+)$/m) || [])[1].trim();
  const key = (env.match(/^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m) || [])[1].trim();
  const r = await fetch(`${url}/rest/v1/mapeo_publicacion_articulo?select=publicacion_id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const arr = await r.json();
  const id = arr[0]?.publicacion_id;
  console.log('ficha:', id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 392, height: 735, deviceScaleFactor: 2.75 } });
  await page.goto(`${BASE}/catalog/external/${id}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: 'Capturas/ficha-local-392.png', fullPage: false });
  await browser.close();
  console.log('ok');
})().catch((e) => { console.error(e); process.exit(1); });
