import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1280,height:900}});
const page = await ctx.newPage();
try {
  const resp = await page.goto('https://github.com/', {waitUntil:'commit', timeout:30000});
  console.log('status', resp && resp.status(), 'url', page.url());
  await page.waitForTimeout(5000);
  console.log('title', await page.title());
  console.log((await page.locator('body').innerText()).slice(0,1000));
} catch(e) { console.log('ERR', e.message); console.log('url', page.url()); }
try { const r = await ctx.request.get('https://github.com/', {timeout:30000}); console.log('request', r.status()); } catch(e){ console.log('req err', e.message); }
await page.screenshot({path:'C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/github-load.png'});
await browser.close();
