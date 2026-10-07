import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseRestAvailabilitySummary } from "../scripts/sync-portal-oficial.js";

test("reads the current month's official FS and rest limits without changing their meaning", () => {
  const html = `<div>Grupos descanso: A / V&nbsp; FS: 3/10 mes | 7/10 año</div>
    <div>Octubre: min 5 / max 7 (7)</div>`;
  assert.deepEqual(parseRestAvailabilitySummary(html, new Date("2026-10-08T01:00:00+02:00")), {
    monthKey: "2026-10",
    group: "A / V",
    fsMonth: { used: 3, max: 10 },
    fsYear: { used: 7, max: 10 },
    monthName: "Octubre",
    restMonth: { min: 5, max: 7, requested: 7 }
  });
});

test("does not reuse a previous month's availability summary", () => {
  const text = "Grupos descanso: A / V FS: 3/10 mes | 7/10 año Octubre: min 5 / max 7 (7)";
  assert.equal(parseRestAvailabilitySummary(text, new Date("2026-11-02T12:00:00+01:00")), null);
  assert.equal(parseRestAvailabilitySummary("Grupos descanso: A / V", new Date("2026-10-08T12:00:00+02:00")), null);
});

test("availability is read from ViewNoray 17 and exceptions no longer link there", () => {
  const worker = readFileSync(new URL("../scripts/sync-portal-oficial.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(worker, /openRequestedNorayFrame\(page, 17, "\/descansos"\)/);
  assert.doesNotMatch(app, /ViewNoray,17"[^>]*>Gestionar excepciones/);
});

test("Sundays and configured holidays color only the rest-calendar day number", () => {
  const app = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(app, /date\.getDay\(\) === 0 \|\| Boolean\(holidayName\)/);
  assert.match(app, /<span className=\{isRedDayNumber \? "is-festive-number"/);
  assert.match(styles, /\.portal-day\.personal-rest-day > span\.is-festive-number/);
});
