import test from "node:test";
import assert from "node:assert/strict";
import { counterpartName, recentPersonalOffers } from "../src/exchangeDisplay.js";

test("Mis Ofertas conserva las ofertas abiertas y solo los cinco acuerdos más recientes", () => {
  const offers = [
    { id: "open", isOwn: true, status: "open" },
    { id: "other", status: "open" },
    ...Array.from({ length: 7 }, (_, index) => ({ id: `agreed-${index}`, status: "agreed", isOwn: true })),
    { id: "cancelled", isOwn: true, status: "cancelled" }
  ];
  const proposals = Array.from({ length: 7 }, (_, index) => ({
    offerId: `agreed-${index}`, status: "accepted", createdAt: `2026-09-${String(index + 1).padStart(2, "0")}`
  }));
  assert.deepEqual(recentPersonalOffers(offers, proposals).map((offer) => offer.id),
    ["open", "agreed-6", "agreed-5", "agreed-4", "agreed-3", "agreed-2"]);
});

test("el acuerdo muestra el nombre del otro participante para ambos", () => {
  assert.equal(counterpartName({ isOwn: true, ownerName: "Adrián" },
    { proposerName: "Jorge" }), "Jorge");
  assert.equal(counterpartName({ isOwn: false, ownerName: "Adrián" },
    { proposerName: "Jorge", isOwn: true }), "Adrián");
});
