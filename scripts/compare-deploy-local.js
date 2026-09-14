// Compara DESPLEGADO vs LOCAL en el mismo viewport (392x735, dpr 2.75).
// Determina si el sitio desplegado realmente tiene el layout nuevo (cards) o el viejo (tabla).
const { chromium } = require('playwright');

const TARGETS = [
  ['desplegado', 'https://autofichaje2026-dashboard-1img.vercel.app/catalog/external'],
  ['local', 'http://localhost:3111/catalog/external'],
];
const VP = { width: 392, height: 735, deviceScaleFactor: 2.75 };

async function probe(page) {
  return page.evaluate(() => {
    const table = document.querySelector('table');
    // Links "Abrir Ficha" que NO estan dentro de una tabla => son de las cards
    const cardLinks = [...document.querySelectorAll('a')].filter(
      (a) => (a.textContent || '').includes('Abrir Ficha') && !a.closest('table')
    );
    const cardContainers = [...document.querySelectorAll('div')].filter((d) => {
      const c = String(d.className);
      return c.includes('divide-y') && (c.includes('md:hidden') || c.includes('lg:hidden'));
    });
    const main = document.querySelector('main');
    const cs = main ? getComputedStyle(main) : null;
    return {
      tableExists: !!table,
      tableDisplay: table ? getComputedStyle(table).display : null,
      cardContainers: cardContainers.length,
      cardContainerDisplay: cardContainers[0] ? getComputedStyle(cardContainers[0]).display : null,
      cardLinksCount: cardLinks.length,
      mainPadL: cs ? cs.paddingLeft : null,
      docScrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      // Marca de version: el HTML referencia bundles con hash
      bundleScripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).slice(0, 6),
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  for (const [name, url] of TARGETS) {
    const page = await browser.newPage({ viewport: VP });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      await page.waitForTimeout(8000);
      const r = await probe(page);
      console.log('### ' + name + ' (' + url.replace(/^https?:\/\//, '').slice(0, 40) + ')');
      console.log(JSON.stringify(r, null, 1));
      await page.screenshot({ path: `Capturas/cmp-${name}-392.png` });
    } catch (e) {
      console.log('### ' + name + ': ERROR ' + e.message);
    }
    await page.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
