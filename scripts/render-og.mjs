import { chromium } from 'playwright';
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1200,height:630},deviceScaleFactor:1});
await page.goto('http://127.0.0.1:4173/og.html',{waitUntil:'networkidle'});
await page.waitForTimeout(400);
await page.screenshot({path:'site/assets/og.png'});
await browser.close();
