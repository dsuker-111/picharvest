import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1200,height:900}});
await page.goto('https://www.miaoda.cn/device/activate?user_code=MDAO-ML2C-TLLQ', {waitUntil:'networkidle', timeout:60000});
await page.waitForTimeout(2500);
console.log('URL', page.url());
console.log((await page.locator('body').innerText()).slice(0,3000));
await page.screenshot({path:'qqcopy/miaoda-device.png'});
await browser.close();
