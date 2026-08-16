import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTH_NETWORK_ERROR_MESSAGE,
  registerWithNetworkRecovery
} from "../src/authRecovery.js";

const noWait = async () => {};

test("el registro normal solo se envia una vez", async () => {
  let calls = 0;
  const result = await registerWithNetworkRecovery({
    register: async () => {
      calls += 1;
      return { token: "ok" };
    },
    login: async () => assert.fail("no debe iniciar sesion"),
    wait: noWait
  });

  assert.deepEqual(result, { token: "ok" });
  assert.equal(calls, 1);
});

test("reintenta una perdida transitoria de red", async () => {
  let calls = 0;
  const result = await registerWithNetworkRecovery({
    register: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      return { token: "recovered" };
    },
    login: async () => assert.fail("no debe iniciar sesion"),
    wait: noWait
  });

  assert.deepEqual(result, { token: "recovered" });
  assert.equal(calls, 2);
});

test("recupera la cuenta si el primer registro llego pero se perdio la respuesta", async () => {
  let calls = 0;
  const result = await registerWithNetworkRecovery({
    register: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("Failed to fetch");
      throw new Error("Esa chapa ya esta registrada");
    },
    login: async () => ({ token: "session" }),
    wait: noWait
  });

  assert.deepEqual(result, { token: "session" });
});

test("no reintenta los errores reales de validacion", async () => {
  let calls = 0;
  await assert.rejects(
    registerWithNetworkRecovery({
      register: async () => {
        calls += 1;
        throw new Error("Esta chapa no es valida");
      },
      login: async () => assert.fail("no debe iniciar sesion"),
      wait: noWait
    }),
    /Esta chapa no es valida/
  );
  assert.equal(calls, 1);
});

test("muestra un mensaje util si la conexion sigue fallando", async () => {
  await assert.rejects(
    registerWithNetworkRecovery({
      register: async () => { throw new TypeError("Failed to fetch"); },
      login: async () => { throw new TypeError("Failed to fetch"); },
      wait: noWait
    }),
    new RegExp(AUTH_NETWORK_ERROR_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});
