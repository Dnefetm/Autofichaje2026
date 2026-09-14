// Valida el sitio DESPLEGADO: que layout renderiza en cada ancho + viewport meta.
const { chromium, devices } = require('playwright');

const URL = process.argv[2] || 'https://autofichaje2026-dashboard-1img.vercel.app/catalog/external';
const WIDTHS = [360, 390, 414, 768, 820, 980, 1280];

(async () => {
  const browser = await chromium.launch();

  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(6000);
      const m = await page.evaluate(() => {
        const vp = document.querySelector('meta[name="viewport"]');
        const table = document.querySelector('table');
        const cardsDiv = [...document.querySelectorAll('div')].find((d) =>
          String(d.className).includes('md:hidden')
        );
        const abrirFicha = [...document.querySelectorAll('a')].filter((a) =>
          (a.textContent || '').includes('Abrir Ficha')
        ).length;
        return {
          viewportMeta: vp ? vp.getAttribute('content') : '(NO EXISTE)',
          clientWidth: document.documentElement.clientWidth,
          tableVisible: table ? getComputedStyle(table).display !== 'none' : false,
          tableDisplay: table ? getComputedStyle(table).display : null,
          cardsContainerExists: !!cardsDiv,
          cardsVisible: cardsDiv ? getComputedStyle(cardsDiv).display !== 'none' : false,
          abrirFichaCount: abrirFicha,
          docScrollWidth: document.documentElement.scrollWidth,
        };
      });
      console.log('ANCHO ' + w + ': ' + JSON.stringify(m));
    } catch (e) {
      console.log('ANCHO ' + w + ': ERROR ' + e.message);
    }
    await page.close();
  }

  // Emulacion real de iPhone
  const ip = await browser.newPage({ ...devices['iPhone 13'] });
  try {
    await ip.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await ip.waitForTimeout(6000);
    const m = await ip.evaluate(() => {
      const vp = document.querySelector('meta[name="viewport"]');
      const table = document.querySelector('table');
      const cardsDiv = [...document.querySelectorAll('div')].find((d) => String(d.className).includes('md:hidden'));
      return {
        innerWidth: window.innerWidth,
        dpr: window.devicePixelRatio,
        viewportMeta: vp ? vp.getAttribute('content') : '(NO EXISTE)',
        tableVisible: table ? getComputedStyle(table).display !== 'none' : false,
        cardsVisible: cardsDiv ? getComputedStyle(cardsDiv).display !== 'none' : false,
      };
    });
    console.log('IPHONE 13: ' + JSON.stringify(m));
  } catch (e) {
    console.log('IPHONE 13: ERROR ' + e.message);
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
