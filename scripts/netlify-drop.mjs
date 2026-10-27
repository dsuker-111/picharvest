import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:1000},userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0'});
const page = await ctx.newPage();
try {
 const resp = await page.goto('https://app.netlify.com/drop',{waitUntil:'domcontentloaded',timeout:60000});
 console.log('status',resp&&resp.status(),'url',page.url(),'title',await page.title());
 await page.waitForTimeout(3000);
 console.log((await page.locator('body').innerText()).slice(0,2000));
 console.log('files',await page.locator('input[type=file]').count());
 await page.screenshot({path:'C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/netlify-drop.png'});
} catch(e){console.log('ERR',e.message)}
await browser.close();
