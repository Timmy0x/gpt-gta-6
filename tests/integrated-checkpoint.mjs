import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
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
page.on("pageerror", (e) => {
  errors.push(e.message);
  console.log("PAGEERROR", e.message);
});
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
const snapshot = () =>
  page.evaluate(() => {
    const { frameTimes, ...s } = window.__leonida.snapshot();
    const g = window.__leonida.game;
    return {
      ...s,
      ammo: [...g.combat.inventory.magazines],
      reserves: [...g.combat.inventory.reserves],
      held: g.combat.held.root?.isEnabled(),
      mounted: g.player.model.root.parent?.name || null,
      projectiles: g.combat.projectiles.grenades.length,
      ragdolls: g.combat.reactions.active.length,
      customProps: g.damage
        .serialize()
        .filter((p) => !p.id.startsWith("street-prop-")),
    };
  });
async function capture(name) {
  const s = await snapshot();
  checks.push({ name, ...s });
  console.log(
    name,
    JSON.stringify({
      ...s,
      customProps: s.customProps.map(({ vertices, ...p }) => p),
    }),
  );
  await page.screenshot({
    path: `docs/evidence/combined-${backend}-${name}.png`,
  });
  return s;
}
async function panel() {
  await page.keyboard.press("F2");
  await page.locator("#panel:not(.hidden)").waitFor();
}
async function close() {
  await page.locator('[data-action="close"]').click();
}
try {
  await page.goto(`http://127.0.0.1:4175/?backend=${backend}&test`, {
    waitUntil: "networkidle",
  });
  await page.locator("#welcome:not(.hidden)").waitFor({ timeout: 120000 });
  await page.locator('[data-action="play"]').click();
  await page.waitForTimeout(4000);
  await page.keyboard.down("w");
  await page.waitForTimeout(450);
  await page.keyboard.up("w");
  await page.keyboard.press("e");
  await page.waitForFunction(
    () => !!window.__leonida.snapshot().vehicle,
    {},
    { timeout: 5000 },
  );
  await page.waitForTimeout(900);
  let s = await capture("seated");
  assert.ok(s.mounted);
  assert.equal(s.held, false);
  await page.keyboard.down("w");
  await page.waitForTimeout(3500);
  await page.keyboard.up("w");
  s = await capture("drive");
  assert.ok(s.vehicle.speed > 8);
  await page.keyboard.down("Space");
  await page.keyboard.down("s");
  await page.waitForFunction(
    () => Math.abs(window.__leonida.snapshot().vehicle.speed) < 1,
    {},
    { timeout: 12000 },
  );
  await page.keyboard.up("s");
  await page.keyboard.up("Space");
  await page.keyboard.press("e");
  await page.waitForTimeout(500);
  s = await snapshot();
  assert.equal(s.vehicle, null);
  await page.keyboard.press("m");
  await page.locator("#location-search").fill("Palma");
  assert.equal(
    await page.locator("#locations .location-row:visible").count(),
    1,
  );
  await page
    .locator('[data-action="route"][data-value="palma-market"]')
    .click();
  assert.match(
    await page.locator("#activity").textContent(),
    /Mercado|Your city/,
  );
  await page.waitForTimeout(300);
  assert.match(await page.locator("#activity").textContent(), /Mercado/);
  await capture("route");
  await page.keyboard.press("m");
  await page.locator('[data-action="teleport"][data-value="race"]').click();
  await panel();
  await page.locator('[data-change="police"]').uncheck();
  await page.locator('[data-change="god"]').check();
  for (const name of ["peds", "traffic"]) {
    await page.locator(`[data-change="${name}"]`).fill("0");
    await page.locator(`[data-change="${name}"]`).dispatchEvent("change");
  }
  await page.locator("#prop-kind").selectOption("wood");
  await page.locator('[data-action="prop"]').click();
  await close();
  await page.waitForTimeout(1500);
  await capture("prop");
  await page.mouse.move(960, 540);
  await page.mouse.down({ button: "right" });
  await page.waitForTimeout(250);
  for (let n = 0; n < 3; n++) {
    await page.mouse.down({ button: "left" });
    await page.waitForTimeout(310);
    await page.mouse.up({ button: "left" });
    await page.waitForTimeout(50);
  }
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(500);
  s = await capture("fire");
  assert.ok(s.shots >= 3);
  assert.ok(s.ammo[0] < 12);
  assert.ok(s.held);
  await page.keyboard.press("Digit2");
  await page.waitForTimeout(200);
  await page.keyboard.press("Digit1");
  await page.waitForTimeout(200);
  assert.equal((await snapshot()).ammo[0], s.ammo[0]);
  await page.keyboard.press("Digit3");
  await page.waitForTimeout(250);
  await page.mouse.down({ button: "left" });
  await page.waitForTimeout(120);
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(600);
  s = await capture("grenade");
  assert.ok(s.projectiles > 0);
  await panel();
  await page.waitForTimeout(3200);
  assert.equal((await snapshot()).projectiles, 0, 'grenade fuse continues while creative panel is open');
  await close();
  await panel();
  await page.locator("#prop-kind").selectOption("fence");
  await page.locator('[data-action="prop"]').click();
  await page.locator('[data-action="ped"]').click();
  await page.locator('[data-action="save"]').click();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("leonida.sandbox.v1")),
  );
  assert.equal(saved.combat.magazines.length, 3);
  assert.ok(saved.civilians[0].id);
  assert.ok(saved.props.some((p) => p.kind === "fence"));
  await page.locator('[data-action="weapons"]').click();
  await page.locator('[data-action="load"]').click();
  await close();
  await page.waitForTimeout(600);
  s = await capture("save-restored");
  assert.deepEqual(s.ammo, saved.combat.magazines);
  assert.ok(s.customProps.some((p) => p.kind === "fence"));
  await panel();
  await page.locator('[data-change="weather"]').selectOption("Rain");
  await page.locator('[data-change="time"]').fill("23");
  await page.locator('[data-change="time"]').dispatchEvent("change");
  await close();
  await page.waitForTimeout(4000);
  s = await capture("night-rain");
  assert.ok(s.atmosphere.particles > 0);
  await panel();
  assert.equal(
    await page.locator('[data-change="weather"]').inputValue(),
    "Rain",
  );
  assert.equal(await page.locator('[data-change="god"]').isChecked(), true);
  await close();
  assert.equal(errors.length, 0);
} catch (e) {
  errors.push(e.stack || String(e));
  console.error(e);
  await page
    .screenshot({ path: `docs/evidence/combined-${backend}-failure.png` })
    .catch(() => {});
}
await fs.writeFile(
  `docs/evidence/combined-${backend}.json`,
  JSON.stringify({ errors, checks }, null, 2),
);
console.log("RESULT", JSON.stringify({ errors, checks: checks.length }));
await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 5000))]);
process.exit(errors.length ? 1 : 0);
