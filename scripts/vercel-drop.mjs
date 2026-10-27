import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
try {
  const resp = await page.goto('https://vercel.com/drop',{waitUntil:'domcontentloaded',timeout:60000});
  console.log('status',resp && resp.status(),'url',page.url(),'title',await page.title());
  await page.waitForTimeout(4000);
  console.log((await page.locator('body').innerText()).slice(0,2500));
  console.log('file inputs',await page.locator('input[type=file]').count());
  await page.screenshot({path:'C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/vercel-drop.png'});
} catch(e){ console.log('ERR',e.message); }
await browser.close();
