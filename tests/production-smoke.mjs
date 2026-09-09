import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const backend = process.argv[2] || "webgpu";
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
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(`http://127.0.0.1:4175/?backend=${backend}`, {
  waitUntil: "networkidle",
});
await page.locator("#welcome:not(.hidden)").waitFor({ timeout: 60000 });
await page.locator('[data-action="play"]').click();
const snapshot = () =>
  page.evaluate(() => {
    const { frameTimes, ...s } = window.__leonida.snapshot();
    return s;
  });
const check = async (name) => {
  const s = await snapshot();
  checks.push({ name, ...s });
  console.log(name, JSON.stringify(s));
  return s;
};
await page.waitForFunction(
  () =>
    window.__leonida?.snapshot().simTime > 2 &&
    window.__leonida.snapshot().fps > 30,
  {},
  { timeout: 60000 },
);
await check("launch");
await page.keyboard.down("w");
await page.waitForTimeout(450);
await page.keyboard.up("w");
await page.waitForTimeout(100);
await page.keyboard.press("e");
await page.waitForFunction(
  () => !!window.__leonida.snapshot().vehicle,
  {},
  { timeout: 5000 },
);
await check("enter");
await page.keyboard.down("w");
await page.waitForTimeout(4200);
await page.keyboard.down("d");
await page.waitForTimeout(1100);
await page.keyboard.up("d");
await page.waitForTimeout(2000);
await page.keyboard.up("w");
await page.keyboard.down("Space");
await page.waitForTimeout(1300);
await page.keyboard.up("Space");
await check("drive-crash");
await page.screenshot({ path: `docs/evidence/${backend}-driving.png` });
await page.keyboard.press("g");
await page.waitForTimeout(350);
await page.keyboard.press("e");
await page.waitForTimeout(150);
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
await check("recover-exit-switch");
await page.keyboard.press("F2");
await page.locator('[data-change="wanted"]').selectOption("3");
await page.locator('[data-change="god"]').check();
await page.locator('[data-action="close"]').click();
await page.waitForTimeout(13000);
await check("three-star-pursuit");
await page.screenshot({ path: `docs/evidence/${backend}-pursuit.png` });
await page.keyboard.press("F2");
await page.locator('[data-action="save"]').click();
await page.locator('[data-change="time"]').fill("22");
await page.locator('[data-change="weather"]').selectOption("Rain");
await page.locator('[data-action="load"]').click();
await check("save-load");
await page.locator("#spawn-kind").selectOption("boat");
await page.locator('[data-action="spawn"]').click();
await page.locator('[data-action="close"]').click();
await page.keyboard.press("e");
await page.waitForTimeout(300);
await check("boat-enter");
await page.keyboard.down("w");
await page.waitForTimeout(3000);
await page.keyboard.up("w");
await check("boat-drive");
await page.screenshot({ path: `docs/evidence/${backend}-boat.png` });
await page.keyboard.press("F2");
await page.locator("#spawn-kind").selectOption("helicopter");
await page.locator('[data-action="spawn"]').click();
await page.locator('[data-action="close"]').click();
await page.keyboard.press("e");
await page.keyboard.down("Shift");
await page.waitForTimeout(7000);
await page.keyboard.up("Shift");
await check("helicopter-lift");
await page.screenshot({ path: `docs/evidence/${backend}-flight.png` });
const frames = await page.evaluate(
  () => window.__leonida.snapshot().frameTimes,
);
const sorted = frames.filter((n) => n > 0).sort((a, b) => a - b);
const result = {
  backend,
  browser: await browser.version(),
  checks,
  errors,
  performance: {
    samples: sorted.length,
    medianFps: 1000 / sorted[Math.floor(sorted.length * 0.5)],
    p99EquivalentFps: 1000 / sorted[Math.floor(sorted.length * 0.99)],
    onePercentLow:
      1000 /
      (sorted
        .slice(Math.floor(sorted.length * 0.99))
        .reduce((a, b) => a + b, 0) /
        sorted.slice(Math.floor(sorted.length * 0.99)).length),
    rawFramesMs: frames,
    maxFrameMs: sorted.at(-1),
    note: "Short mixed-control smoke under concurrent development/browser audits; not acceptance benchmark.",
  },
};
await fs.writeFile(
  `docs/evidence/${backend}-smoke.json`,
  JSON.stringify(result, null, 2),
);
console.log("RESULT", JSON.stringify(result.performance), errors);
await Promise.race([
  browser.close(),
  new Promise((resolve) => setTimeout(resolve, 5000)),
]);
process.exit(errors.length ? 1 : 0);
