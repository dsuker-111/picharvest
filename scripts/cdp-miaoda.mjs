import { chromium } from 'playwright';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const contexts = browser.contexts();
console.log('contexts', contexts.length);
for (const ctx of contexts) {
  const pages = ctx.pages();
  console.log('pages', pages.length, pages.map(p=>p.url()));
  const page = pages[0] || await ctx.newPage();
  await page.goto('https://www.miaoda.cn/', {waitUntil:'domcontentloaded', timeout:60000});
  await page.waitForTimeout(3000);
  console.log('title', await page.title(), 'url', page.url());
  console.log((await page.locator('body').innerText()).slice(0,1000));
  await page.screenshot({path:'qqcopy/slb-miaoda.png'});
  break;
}
await browser.close();
