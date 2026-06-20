const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
const path = require('path');

(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  const url = 'file://' + path.resolve(__dirname, 'index.html');
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for boot overlay to disappear.
  await page.waitForFunction(() => !document.getElementById('boot'), { timeout: 8000 }).catch(() => errors.push('boot never finished'));

  // Checks
  const checks = {};
  checks.watchlistRows = await page.$$eval('.wl-row', els => els.length);
  checks.detailSym = await page.$eval('.dt-sym', el => el.textContent.trim());
  checks.cards = await page.$$eval('.card', els => els.length);
  checks.verdict = await page.$eval('.verdict-val', el => el.textContent.trim());
  checks.priceText = await page.$eval('.dt-price', el => el.textContent.trim());

  // Wait a couple ticks so prices update from '--'.
  await page.waitForTimeout(2800);
  checks.priceAfterTick = await page.$eval('.dt-price', el => el.textContent.trim());

  // Test switching via keyboard '3' (NKE).
  await page.keyboard.press('3');
  await page.waitForTimeout(300);
  checks.afterKey3 = await page.$eval('.dt-sym', el => el.textContent.trim());

  // Test command input.
  await page.click('#cmd-input');
  await page.type('#cmd-input', 'gev');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  checks.afterCmdGev = await page.$eval('.dt-sym', el => el.textContent.trim());

  // 'top' command should produce log lines.
  await page.type('#cmd-input', 'top');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  checks.logLines = await page.$$eval('.cmd-line', els => els.length);

  // full-update button is present in the header
  checks.updateBtn = await page.$$eval('#full-update', els => els.length);

  await page.screenshot({ path: 'preview.png', fullPage: false });
  await browser.close();

  console.log(JSON.stringify(checks, null, 2));
  if (errors.length) { console.log('\n--- ERRORS ---'); errors.forEach(e => console.log(e)); process.exit(1); }
  console.log('\nNO RUNTIME ERRORS ✓');
})();
