import { chromium } from "@playwright/test";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();
page.on("response", (r) => {
  if (r.status() >= 400) console.log("HTTP", r.status(), r.url());
});
page.on("requestfailed", (r) => console.log("FAILED", r.url(), r.failure()));
page.on("pageerror", (e) => console.log("ERROR", e.message));
await page.goto("http://127.0.0.1:4175/?backend=webgl", {
  waitUntil: "networkidle",
});
await page.locator('[data-action="play"]').waitFor();
await page.locator('[data-action="play"]').click();
await page.waitForTimeout(1500);
await browser.close();
