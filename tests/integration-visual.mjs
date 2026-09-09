import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto("http://127.0.0.1:5174/?backend=webgpu&test", {
  waitUntil: "networkidle",
});
await page.locator("#welcome:not(.hidden)").waitFor({ timeout: 90000 });
await page.locator('[data-action="play"]').click();
await page.waitForTimeout(7000);
const snapshots = [];
async function capture(name) {
  const result = await page.evaluate(() => {
    const { frameTimes, ...rest } = window.__leonida.snapshot();
    return rest;
  });
  snapshots.push({ name, ...result });
  console.log(name, JSON.stringify(result));
  await page.screenshot({ path: `docs/evidence/integration-${name}.png` });
}
await capture("spawn");
await page.keyboard.down("w");
await page.waitForTimeout(450);
await page.keyboard.up("w");
await page.keyboard.press("e");
await page.waitForFunction(
  () => !!window.__leonida.snapshot().vehicle,
  {},
  { timeout: 5000 },
);
await page.waitForTimeout(1500);
await capture("seated");
await page.keyboard.down("w");
await page.waitForTimeout(2500);
await page.keyboard.up("w");
await page.keyboard.down("Space");
await page.waitForTimeout(1500);
await page.keyboard.up("Space");
await capture("drive");
await page.keyboard.press("F2");
await page.locator('[data-change="weather"]').selectOption("Rain");
await page.locator('[data-action="close"]').click();
await page.waitForTimeout(4000);
await capture("rain");
await page.keyboard.press("F2");
await page.locator('[data-change="time"]').fill("23");
await page.locator('[data-change="time"]').dispatchEvent("change");
await page.locator('[data-action="close"]').click();
await page.waitForTimeout(2000);
await capture("night");
await fs.writeFile(
  "docs/evidence/integration-visual.json",
  JSON.stringify({ errors, snapshots }, null, 2),
);
console.log("ERRORS", errors);
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(errors.length ? 1 : 0);
