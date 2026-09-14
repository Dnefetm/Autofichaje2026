// Validador de UI (Playwright) — mide layout responsivo en viewport movil.
// Uso: node scripts/ui-validator.js [baseUrl]
const { chromium } = require('playwright');

const BASE = process.argv[2] || process.env.BASE_URL || 'http://localhost:3111';
const PAGES = ['/catalog/external', '/', '/ventas', '/precios'];
const VIEWPORT = { width: 390, height: 844 };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  const results = [];

  for (const path of PAGES) {
    try {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(4000);

      const m = await page.evaluate(() => {
        const de = document.documentElement;
        const out = {
          viewport: window.innerWidth,
          docScrollWidth: de.scrollWidth,
          docClientWidth: de.clientWidth,
          horizontalOverflow: de.scrollWidth > de.clientWidth,
        };
        const main = document.querySelector('main');
        if (main) {
          const cs = getComputedStyle(main);
          const r = main.getBoundingClientRect();
          out.main = { padL: cs.paddingLeft, padR: cs.paddingRight, width: Math.round(r.width) };
        }
        const small = [];
        document.querySelectorAll('button, a[href], input, select').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (r.height < 44) small.push({ tag: el.tagName, txt: (el.textContent || '').trim().slice(0, 24), h: Math.round(r.height) });
        });
        out.smallTargets = { count: small.length, sample: small.slice(0, 10) };

        const over = [];
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.right > window.innerWidth + 1) {
            over.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 50), right: Math.round(r.right) });
          }
        });
        out.overflowRight = { count: over.length, sample: over.slice(0, 8) };
        return out;
      });

      results.push({ path, ok: true, metrics: m });
    } catch (e) {
      results.push({ path, ok: false, error: e.message });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
