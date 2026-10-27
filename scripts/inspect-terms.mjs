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
  const all = [...document.querySelectorAll('*')];
  const e = all.find(x => (x.textContent||'').trim().startsWith('我已阅读并同意秒哒') && !x.children.length);
  if(!e) return null;
  let arr=[]; let n=e;
  for(let i=0;i<5&&n;i++){arr.push({tag:n.tagName,cls:n.className,html:n.outerHTML.slice(0,500)}); n=n.parentElement;}
  return arr;
});
console.log(JSON.stringify(info,null,2));
await browser.close();
