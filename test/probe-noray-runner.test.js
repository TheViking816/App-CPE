import test from "node:test";
import assert from "node:assert/strict";
import { isChallenge, pilotUrl } from "../scripts/probe-noray-runner.js";

const pilot = "https://norayweb.cpevalencia.com/jornales?cal=gwt&mode=PROD&req=login&usr=72683&rec=2611&pwd=" + "a".repeat(64);

test("solo admite el iframe piloto de Jornales para la chapa indicada", () => {
  assert.equal(pilotUrl(pilot).pathname, "/jornales");
  assert.throws(() => pilotUrl(pilot.replace("/jornales", "/chapero")), /Enlace piloto/);
  assert.throws(() => pilotUrl(pilot.replace("usr=72683", "usr=72684")), /Identidad piloto/);
  assert.throws(() => pilotUrl(pilot.replace("pwd=" + "a".repeat(64), "pwd=bad")), /Credencial piloto/);
});

test("detecta el desafío de Cloudflare sin publicar la respuesta", () => {
  assert.equal(isChallenge(new Headers({ "cf-mitigated": "challenge" })), true);
  assert.equal(isChallenge(new Headers(), "Just a moment"), true);
  assert.equal(isChallenge(new Headers(), "Jornales disponibles"), false);
});
