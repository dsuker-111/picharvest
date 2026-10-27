import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
await page.goto('https://vercel.com/drop',{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForTimeout(2000);
await page.locator('input[type=file]').setInputFiles('C:/Users/lx/Documents/deepseek-harness/default-workspace/picharvest/picharvest-site.zip');
console.log('uploaded');
for (let i=0;i<60;i++) {
  await page.waitForTimeout(2000);
  const text = await page.locator('body').innerText();
  if (/vercel\.app|Claim|claim|live/i.test(text) && i%5===0) console.log('T+'+i*2+'s:', text.slice(0,1500));
  const urls = await page.locator('a').evaluateAll(as=>as.map(a=>a.href).filter(h=>/\.vercel\.app/.test(h)));
  if (urls.length) { console.log('URLS', urls); break; }
}
console.log('FINAL URL', page.url());
console.log((await page.locator('body').innerText()).slice(0,3000));
await page.screenshot({path:'C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/vercel-deployed.png'});
await browser.close();
