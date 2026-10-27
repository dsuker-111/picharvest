import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/collected-cookies.json','utf8'));
const relevant = data.cookies.filter(c => c.name && c.value && /(^|\.)(miaoda\.cn|miaoda\.online|baidu\.com|github\.com)$/.test(c.domain));
const cookies = relevant.map(c => ({
  name: c.name,
  value: c.value,
  domain: c.domain,
  path: c.path || '/',
  expires: typeof c.expirationDate === 'number' ? Math.round(c.expirationDate) : -1,
  httpOnly: !!c.httpOnly,
  secure: !!c.secure,
  sameSite: ['Strict','Lax','None'].includes(c.sameSite) ? c.sameSite : 'Lax'
}));
console.log('cookies', cookies.length, cookies.map(c=>`${c.domain}/${c.name}`).join(', '));
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:1000}});
await ctx.addCookies(cookies);
const page = await ctx.newPage();
await page.goto('https://www.miaoda.cn/projects',{waitUntil:'networkidle',timeout:60000});
await page.waitForTimeout(3000);
console.log('URL', page.url());
console.log((await page.locator('body').innerText()).slice(0,2500));
await page.screenshot({path:'C:/Users/lx/Documents/deepseek-harness/default-workspace/qqcopy/miaoda-auth-test.png'});
await browser.close();
