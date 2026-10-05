// Headless Chromium: one worker-live.js, init once, then answer every line of a .jsonl.
// node browser-live.mjs <servedDir> <requests.jsonl>
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const [dir, reqFile, trim] = process.argv.slice(2);
const reqs = fs.readFileSync(reqFile, "utf8").split("\n").filter(Boolean);
fs.writeFileSync(`${dir}/index.html`, "<!doctype html><title>wasm lean</title>");
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", (m) => console.log("[page]", m.text().slice(0, 300)));
await page.goto("http://localhost:8137/index.html");
const t0 = Date.now();
const out = await page.evaluate(async ([reqs, trim]) => {
  const w = new Worker("worker-live.js");
  const ask = (msg) => new Promise((ok) => { w.onmessage = (e) => ok(e.data); w.postMessage(msg); });
  const res = [await ask({ init: { tar: "init.tar", trim } })];
  for (const r of reqs) res.push(await ask({ answer: r }));
  return res;
}, [reqs, trim === "trim"]);
for (const r of out) console.log(JSON.stringify(r));
console.log("total wall ms", Date.now() - t0);
if (process.env.HOLD_MS) await new Promise((r) => setTimeout(r, Number(process.env.HOLD_MS)));
const mem = await page.evaluate(() => performance.memory && { usedJSHeapMB: performance.memory.usedJSHeapSize / 1e6 });
console.log("page memory", JSON.stringify(mem));
await browser.close();
