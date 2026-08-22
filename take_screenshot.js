const { chromium } = require('playwright');
(async () => {
  try {
      const browser = await chromium.launch();
      const page = await browser.newPage();
      await page.goto('http://localhost:3000/catalog/external/e8f7265d-cc5a-47eb-b0e1-fe5b05002766');
      await page.waitForTimeout(3000);
      await page.screenshot({ path: '../.gemini/antigravity/brain/e5e73cd2-3401-489a-9f83-d20d8d924e52/artifacts/screenshot_ficha.png', fullPage: true });
      await browser.close();
      console.log('Done');
  } catch(e) {
      console.error(e);
      process.exit(1);
  }
})();
