import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1000}});
const resp = await page.goto('https://miaoda.baidu.com/', {waitUntil:'domcontentloaded', timeout:60000});
console.log('status', resp && resp.status(), 'url', page.url(), 'title', await page.title());
await page.waitForTimeout(4000);
console.log((await page.locator('body').innerText()).slice(0,3000));
await page.screenshot({path:'qqcopy/miaoda.png'});
await browser.close();
