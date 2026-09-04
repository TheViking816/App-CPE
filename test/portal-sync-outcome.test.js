import test from "node:test";
import assert from "node:assert/strict";
import { syncOutcome } from "../scripts/portal-sync-outcome.js";
test("mes reconocido vacio sin avisos es una sync correcta", () => {
  assert.equal(syncOutcome({inProgress:false,partial:false,warnings:[]}).failed,false);
});
test("clave de primas incorrecta no falla toda la sync", () => {
  const result=syncOutcome({partial:true,warnings:["primas no se pudo actualizar. La clave de seguridad de primas es incorrecta."]});
  assert.equal(result.failed,false);
  assert.match(result.message,/avisos/);
});
test("aviso de clave no oculta un fallo real en otra seccion", () => {
  assert.equal(syncOutcome({partial:true,warnings:["La clave de seguridad de primas es incorrecta.","descansos no se pudo actualizar"]}).failed,true);
});
test("sin resultado o aun en progreso no puede completarse", () => {
  assert.equal(syncOutcome(null).failed,true);
  assert.equal(syncOutcome({inProgress:true}).failed,true);
});
test("avisos separados conservan el motivo sin marcar failed", () => {
  const result=syncOutcome({partial:false,warnings:[],notices:["Clave de primas incorrecta"]});
  assert.equal(result.failed,false);
  assert.match(result.message,/Clave de primas incorrecta/);
});
