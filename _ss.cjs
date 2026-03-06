const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0', timeout: 15000 });
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise(r => setTimeout(r, 1000));
  const icons = await page.$$('.lobby-icon-button');
  for (const icon of icons) {
    const text = await icon.evaluate(el => el.textContent);
    if (text.includes('Whack') || text.includes('두더지') || text.includes('Mole')) { await icon.click(); break; }
  }
  await new Promise(r => setTimeout(r, 500));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await new Promise(r => setTimeout(r, 300));
  let btns = await page.$$('button');
  for (const btn of btns) {
    const t = await btn.evaluate(el => el.textContent.trim());
    if (t.includes('Unlock') || t.includes('해금')) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  btns = await page.$$('button');
  for (const btn of btns) {
    const t = await btn.evaluate(el => el.textContent.trim());
    const v = await btn.evaluate(el => el.offsetParent !== null);
    if (v && (t.includes('Start') || t.includes('시작') || t.includes('Play') || t.includes('플레이'))) { await btn.click(); break; }
  }
  await new Promise(r => setTimeout(r, 5500));
  await page.screenshot({ path: '/tmp/dd-v2-1.png', fullPage: false });
  console.log('1. Game started');
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: '/tmp/dd-v2-2.png', fullPage: false });
  console.log('2. Moles visible');
  for (let i = 0; i < 10; i++) {
    const moles = await page.$$('.dunga-dunga-mole');
    for (const m of moles) {
      const box = await m.boundingBox();
      if (box) await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  await page.screenshot({ path: '/tmp/dd-v2-3.png', fullPage: false });
  console.log('3. After playing');
  await browser.close();
  console.log('Done');
})().catch(e => console.error(e));
