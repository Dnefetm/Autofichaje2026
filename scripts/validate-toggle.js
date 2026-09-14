// Valida el toggle de "sincronizar stock" con emulacion tactil (pointer: coarse).
// Antes: la regla global min-height:44px lo deformaba (perilla arriba).
const { chromium, devices } = require('playwright');
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
  const id = arr && arr[0] ? arr[0].publicacion_id : null;
  console.log('publicacion con mapeo:', id);

  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  await page.goto(`${BASE}/catalog/external/${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);

  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const all = [...document.querySelectorAll('button')].map((b) => {
      const r = b.getBoundingClientRect();
      return { cls: String(b.className).slice(0, 70), txt: (b.textContent || '').trim().slice(0, 18), h: Math.round(r.height), w: Math.round(r.width) };
    });
    return {
      pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
      horizontalOverflow: de.scrollWidth > de.clientWidth,
      totalButtons: all.length,
      botonesAltosDe20: all.filter((b) => b.h > 30).slice(0, 12),
      posiblesToggles: all.filter((b) => /rounded-full/.test(b.cls)),
    };
  });

  console.log(JSON.stringify(m, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
