import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/collected-cookies.json','utf8'));
const relevant = data.cookies.filter(c => c.name && c.value && /(^|\.)(miaoda\.cn|baidu\.com)$/.test(c.domain));
const cookies = relevant.map(c => ({name:c.name,value:c.value,domain:c.domain,path:c.path||'/',expires:typeof c.expirationDate==='number'?Math.round(c.expirationDate):-1,httpOnly:!!c.httpOnly,secure:!!c.secure,sameSite:['Strict','Lax','None'].includes(c.sameSite)?c.sameSite:'Lax'}));
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1200,height:900}});
await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto('https://www.miaoda.cn/device/activate?user_code=MDAO-YBFJ-6TVR',{waitUntil:'networkidle',timeout:60000});
const info = await page.evaluate(() => {
  const els = [...document.querySelectorAll('input,label,[role=checkbox],[role=radio]')];
  return els.map((e,i)=>({i,tag:e.tagName,type:e.type,role:e.getAttribute('role'),cls:e.className,text:(e.innerText||'').slice(0,40),checked:e.checked,outer:e.outerHTML.slice(0,300)}));
});
console.log(JSON.stringify(info,null,2));
await browser.close();
