import assert from "node:assert/strict";
import test from "node:test";
import { createVersionMonitor } from "../src/versionMonitor.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      const current = listeners.get(type) || [];
      current.push(listener);
      listeners.set(type, current);
    },
    removeEventListener(type, listener) {
      listeners.set(type, (listeners.get(type) || []).filter((item) => item !== listener));
    },
    emit(type, event = {}) {
      for (const listener of listeners.get(type) || []) listener(event);
    }
  };
}

function harness(fetchVersion) {
  let reloads = 0;
  const values = new Map();
  const documentRef = Object.assign(eventTarget(), { visibilityState: "visible" });
  const windowRef = Object.assign(eventTarget(), {
    location: {
      href: "https://cpe-app-flax.vercel.app/",
      reload() { reloads += 1; }
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 2; },
    clearTimeout() {}
  });
  const storage = {
    getItem(key) { return values.get(key) || null; },
    setItem(key, value) { values.set(key, value); }
  };
  const monitor = createVersionMonitor({
    currentVersion: "old-build",
    baseUrl: "/",
    fetchVersion,
    documentRef,
    windowRef,
    storage,
    now: () => 100_000
  });
  return { documentRef, monitor, getReloads: () => reloads };
}

test("recarga automáticamente cuando el despliegue anuncia otra versión", async () => {
  const requests = [];
  const state = harness(async (url, options) => {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ version: "new-build" }) };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.getReloads(), 1);
  assert.equal(requests[0].options.cache, "no-store");
  assert.match(requests[0].url, /app-version\.json\?check=/);
  state.monitor.dispose();
});

test("aplaza la recarga mientras exista un texto sin enviar", async () => {
  let finishFetch;
  const state = harness(() => new Promise((resolve) => { finishFetch = resolve; }));
  const input = {
    value: "",
    defaultValue: "",
    isConnected: true,
    isContentEditable: false,
    closest() { return this; },
    matches() { return false; },
    hasAttribute() { return false; }
  };
  state.documentRef.emit("focusin", { target: input });
  input.value = "mensaje sin enviar";
  state.documentRef.emit("input", { target: input });
  finishFetch({ ok: true, json: async () => ({ version: "new-build" }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.getReloads(), 0);
  input.value = "";
  state.monitor.attemptReload();
  assert.equal(state.getReloads(), 1);
  state.monitor.dispose();
});

test("sin conexión conserva la versión actual y vuelve a comprobar al regresar", async () => {
  let available = false;
  const state = harness(async () => {
    if (!available) throw new Error("offline");
    return { ok: true, json: async () => ({ version: "new-build" }) };
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.getReloads(), 0);
  available = true;
  await state.monitor.check();
  assert.equal(state.getReloads(), 1);
  state.monitor.dispose();
});

test("sin sessionStorage marca la URL y evita un bucle de recargas", async () => {
  let redirects = 0;
  const documentRef = Object.assign(eventTarget(), { visibilityState: "visible" });
  const windowRef = Object.assign(eventTarget(), {
    location: {
      href: "https://cpe-app-flax.vercel.app/",
      replace(url) { redirects += 1; this.href = url; },
      reload() { throw new Error("No debe usar reload sin protección"); }
    },
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout() { return 2; },
    clearTimeout() {}
  });
  const options = {
    currentVersion: "old-build",
    baseUrl: "/",
    fetchVersion: async () => ({ ok: true, json: async () => ({ version: "new-build" }) }),
    documentRef,
    windowRef,
    storage: { getItem() { throw new Error("blocked"); } },
    now: () => 100_000
  };
  const first = createVersionMonitor(options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(redirects, 1);
  first.dispose();
  const second = createVersionMonitor(options);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(redirects, 1);
  second.dispose();
});
