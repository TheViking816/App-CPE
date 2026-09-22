import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { readAvailabilityDom } from "../scripts/portal-availability.js";

test("reads every colored state from independent month cards", { skip: !existsSync(chromium.executablePath()) }, async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const card = (title, count, codes) => `<section class="month-card"><h3>${title}</h3><div class="grid">${Array.from({ length: count }, (_, index) => {
      const day = index + 1;
      return `<div class="day"><span>${day}</span>${codes[day] ? `<small>${codes[day]}</small>` : ""}</div>`;
    }).join("")}</div></section>`;
    await page.setContent(card("Febrero 2026", 28, { 9: "FM", 14: "PA", 16: "DS", 19: "FH" })
      + card("Marzo 2026", 31, { 7: "DS", 10: "VA", 26: "SL", 29: "FS" }));
    const months = await page.evaluate(readAvailabilityDom);
    assert.deepEqual(months, [
      { year: 2026, month: 2, days: [{ day: 9, code: "FM" }, { day: 14, code: "PA" }, { day: 16, code: "DS" }, { day: 19, code: "FH" }] },
      { year: 2026, month: 3, days: [{ day: 7, code: "DS" }, { day: 10, code: "VA" }, { day: 26, code: "SL" }, { day: 29, code: "FS" }] }
    ]);
  } finally {
    await browser.close();
  }
});
