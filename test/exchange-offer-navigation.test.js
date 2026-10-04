import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { exchangeOfferFromHash, hashForExchangeOffer, tabFromHash } from "../src/navigation.js";

const offerId = "97361b0b-207a-4448-a193-42e2b36b2268";

test("el aviso conserva una ruta directa a la oferta en descansos o vacaciones", () => {
  for (const tab of ["descansos", "vacaciones"]) {
    const hash = hashForExchangeOffer(tab, offerId);
    assert.equal(hash, `#/${tab}/oferta/${offerId}`);
    assert.equal(tabFromHash(hash), tab);
    assert.deepEqual(exchangeOfferFromHash(hash), { tab, offerId });
  }
  assert.equal(hashForExchangeOffer("descansos", "no-es-un-uuid"), "#/descansos");
  assert.equal(exchangeOfferFromHash("#/descansos/oferta/no-es-un-uuid"), null);
});

test("la notificación usa la ruta de oferta y ambos tablones enfocan la tarjeta o la sección", async () => {
  const app = await fs.readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const rest = await fs.readFile(new URL("../src/RestExchangePanel.jsx", import.meta.url), "utf8");
  const vacation = await fs.readFile(new URL("../src/VacationExchangePanel.jsx", import.meta.url), "utf8");
  const focus = await fs.readFile(new URL("../src/useExchangeOfferFocus.js", import.meta.url), "utf8");
  assert.match(app, /window\.location\.hash = hashForExchangeOffer\(tab, item\.metadata\.offerId\)/);
  assert.match(app, /!exchangeOfferFromHash\(window\.location\.hash\)/);
  assert.match(rest, /useExchangeOfferFocus\("descansos"/);
  assert.match(vacation, /useExchangeOfferFocus\("vacaciones"/);
  assert.match(focus, /\(card \|\| panel\)\?\.scrollIntoView/);
});
