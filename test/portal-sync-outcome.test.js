import test from "node:test";
import assert from "node:assert/strict";
import { syncOutcome, isExplicitSectionFailure } from "../scripts/portal-sync-outcome.js";
test("mes reconocido vacio sin avisos es una sync correcta", () => {
  assert.equal(syncOutcome({inProgress:false,partial:false,warnings:[]}).failed,false);
});
test("clave de primas incorrecta no falla toda la sync", () => {
  const result=syncOutcome({partial:true,warnings:["primas no se pudo actualizar. La clave de seguridad de primas es incorrecta."]});
  assert.equal(result.failed,false);
  assert.match(result.message,/avisos/);
});
test("aviso de clave no oculta un fallo real en otra seccion", () => {
  assert.equal(syncOutcome({partial:true,warnings:["La clave de seguridad de primas es incorrecta."],errors:["descansos: timeout"]}).failed,true);
});
test("72710: siete secciones cargadas y avisos de conservacion no son failed", () => {
  const result = syncOutcome({inProgress:false,partial:true,freshSections:7,warnings:[
    "contratacion actual no se pudo actualizar. No se pudo leer la contratacion actual.",
    "vacaciones no devolvio datos; se conserva la ultima lectura disponible."
  ],errors:[]});
  assert.equal(result.failed,false);
  assert.equal(result.message,"Portal sincronizado");
});
test("errores de transporte y cargas fallidas siguen siendo errores", () => {
  for (const message of ["Timeout 30000ms","HTTP 503","El portal no termino de cargar los dobles","El calendario no incluye el mes actual y el siguiente."]) {
    assert.equal(isExplicitSectionFailure(message),true);
    assert.equal(syncOutcome({errors:[message]}).failed,true);
  }
  assert.equal(isExplicitSectionFailure("La clave de seguridad de primas es incorrecta."),false);
  assert.equal(syncOutcome({failed:true,error:"No se pudo guardar"}).failed,true);
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
