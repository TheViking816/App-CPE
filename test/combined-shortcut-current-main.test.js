import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const runner = await readFile(new URL("../scripts/windows/run-combined-current-sync.ps1", import.meta.url), "utf8");
const installer = await readFile(new URL("../scripts/windows/install-combined-current-sync-shortcut.ps1", import.meta.url), "utf8");

test("el acceso Actualizar TODO verifica main antes de arrancar los lectores", () => {
  assert.match(installer, /-UpdateFromMain/);
  assert.match(runner, /git -C \$RepositoryPath fetch origin main/);
  assert.match(runner, /git -C \$RepositoryPath merge --ff-only origin\/main/);
  assert.ok(runner.indexOf("merge --ff-only origin/main") < runner.indexOf("run-operational-sync.ps1"));
  assert.match(runner, /run-operational-sync\.ps1/);
  assert.match(runner, /queue-all-portal-syncs\.ps1/);
});
