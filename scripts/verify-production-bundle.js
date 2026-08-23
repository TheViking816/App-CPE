import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const payrollSource = fs.readFileSync(path.join(rootDir, "src", "payroll.js"), "utf8");
const appSource = fs.readFileSync(path.join(rootDir, "src", "App.jsx"), "utf8");
const assetsDir = path.join(rootDir, "dist", "assets");
const mainBundles = fs.readdirSync(assetsDir)
  .filter((name) => /^index-[A-Za-z0-9_-]+\.js$/.test(name))
  .map((name) => ({ name, content: fs.readFileSync(path.join(assetsDir, name), "utf8") }));

const requiredSourceChecks = [
  [payrollSource.includes('row.produccionEstado === "paid" ? "paid"'), "el estado paid"],
  [payrollSource.includes("premiumRowsForMonth(premiumHistory, month)"), "el cruce mensual de primas"],
  [appSource.includes("premiumHistory"), "el histórico de primas enviado al resumen anual"]
];

for (const [valid, label] of requiredSourceChecks) {
  if (!valid) throw new Error(`Build bloqueado: falta ${label}.`);
}

if (!mainBundles.length || !mainBundles.some(({ content }) => content.includes('"paid"'))) {
  throw new Error("Build bloqueado: el bundle final no contiene el estado paid.");
}

console.log(`Bundle de primas verificado: ${mainBundles.map(({ name }) => name).join(", ")}.`);
