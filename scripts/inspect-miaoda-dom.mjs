import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
const page = await ctx.newPage();
await page.goto('https://www.miaoda.cn/',{waitUntil:'networkidle',timeout:60000});
const info = await page.evaluate(() => ({
  editable: [...document.querySelectorAll('[contenteditable],textarea,input')].map(el => ({tag:el.tagName,type:el.type,ph:el.getAttribute('placeholder'),ce:el.getAttribute('contenteditable'),cls:el.className})).slice(0,20),
  body: document.body.innerText.slice(0,500),
  cookies: document.cookie,
  ls: Object.keys(localStorage).slice(0,30)
}));
console.log(JSON.stringify(info,null,2));
await browser.close();
