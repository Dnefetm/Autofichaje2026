// Captura el sitio DESPLEGADO en viewport movil para inspeccion visual.
const { chromium, devices } = require('playwright');

const BASE = process.argv[2] || 'https://autofichaje2026-dashboard-1img.vercel.app';
const TARGETS = [
  ['vitrinas', '/catalog/external'],
  ['pendientes', '/catalog/external/pendientes'],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ ...devices['iPhone 13'] });
  for (const [name, path] of TARGETS) {
    try {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(8000);
      await page.screenshot({ path: `Capturas/deploy-${name}-movil.png` });
      console.log('capturado:', name);
    } catch (e) {
      console.log('ERROR', name, e.message);
    }
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
