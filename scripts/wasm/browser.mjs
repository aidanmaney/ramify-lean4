// Headless Chromium run of worker.js: node browser.mjs <servedDir> <file.lean> [runs]
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const [dir, file, runs = "2"] = process.argv.slice(2);
const src = fs.readFileSync(file, "utf8");
fs.writeFileSync(`${dir}/index.html`, "<!doctype html><title>wasm lean</title>");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text()));
await page.goto("http://localhost:8137/index.html");
console.log("crossOriginIsolated:", await page.evaluate(() => self.crossOriginIsolated));
for (let i = 0; i < Number(runs); i++) {
  const r = await page.evaluate((src) => new Promise((ok) => {
    const w = new Worker("worker.js");
    w.onmessage = (e) => { ok(e.data); w.terminate(); };
    w.onerror = (e) => ok({ error: e.message });
    w.postMessage({ src });
  }), src);
  console.log(JSON.stringify(r, null, 1));
}
const m = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1e6 : null);
console.log("JS heap MB (page):", m);
await browser.close();
