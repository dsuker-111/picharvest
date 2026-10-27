import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:1000},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0'});
const page = await ctx.newPage();
await page.goto('https://app.netlify.com/drop',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2500);
const input = page.locator('input[type=file]').first();
await input.setInputFiles('C:/Users/lx/Documents/deepseek-harness/default-workspace/picharvest/picharvest-site.zip');
console.log('uploaded');
for (let i=0;i<80;i++) {
  await page.waitForTimeout(2000);
  const text = await page.locator('body').innerText();
  if (i%5===0) console.log('T+'+(i*2)+'s:', text.slice(0,1200));
  const urls = await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(h=>/netlify\.app/.test(h) && !/app\.netlify\.com/.test(h)));
  if (urls.length) { console.log('URLS',urls); break; }
}
console.log('FINAL',page.url());
console.log((await page.locator('body').innerText()).slice(0,2500));
await page.screenshot({path:'C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/netlify-deployed.png'});
await browser.close();
