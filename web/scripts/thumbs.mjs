#!/usr/bin/env node
// THUMBS — the index's pictures, drawn by the viewer itself.
//
//   node scripts/thumbs.mjs [site-dir]      (default ../site; run after publish.mjs)
//
// Reads <site>/cards.json, serves the site on a loopback port and, in a
// headless Chromium, writes per theme (light, dark):
//
//   <site>/thumbs/<file>-<theme>.webp  the featured proof's tree alone, in the
//                                      wide layout (stacked where wide is wider
//                                      than WIDE_MAX), cropped to its ink, at most
//                                      CARD_W pixels wide (2× a card)
//   <site>/thumbs/hero-<theme>.webp    the hero: demos/hero-<theme>.png where it
//                                      exists (a VS Code screenshot — the
//                                      extension is the product; dark falls back
//                                      to light), else the hero file's viewer
//
// Needs Playwright (`npm i -D playwright`, or NODE_PATH pointing at an install);
// the index works without the pictures — each card falls back to its title.
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.resolve(process.argv[2] ?? path.join(web, "../site"));
const THEMES = ["light", "dark"];
const STORE_KEY = "ramify-viewer-theme"; // viewerTheme.ts
const MAX = { w: 1800, h: 4000 }; // css px; a tree beyond this is cropped
const CARD_W = 640; // device px: a card is ~320 css px wide
const HERO_W = 2240;

/** A PNG screenshot → WebP at most `width` pixels wide, scaled in the page. */
async function webp(page, png, width, out) {
  const b64 = await page.evaluate(
    async ({ src, width }) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const k = Math.min(1, width / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/webp", 0.86).split(",")[1];
    },
    { src: `data:image/png;base64,${png.toString("base64")}`, width },
  );
  fs.writeFileSync(out, Buffer.from(b64, "base64"));
}

async function loadPlaywright() {
  const req = createRequire(path.join(web, "package.json"));
  const paths = [web, ...(process.env.NODE_PATH ?? "").split(path.delimiter).filter(Boolean)];
  try {
    return await import(pathToFileURL(req.resolve("playwright", { paths })).href);
  } catch {
    throw new Error("Playwright not found: `npm i -D playwright`, or set NODE_PATH to an install");
  }
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };
function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

/** The tree's ink in the scroll frame's content coordinates. */
const inkBox = () => {
  const f = document.querySelector("[data-ptw-scroll]");
  const fr = f.getBoundingClientRect();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const el of f.querySelectorAll("svg rect, svg path, svg text, svg foreignObject")) {
    if (el.getAttribute("fill") === "transparent") continue; // hit regions
    const b = el.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
    x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
  }
  return { x: x0 - fr.left + f.scrollLeft, y: y0 - fr.top + f.scrollTop, w: x1 - x0, h: y1 - y0 };
};

/** Wider than this, the wide layout reads as noise at card size and the
 stacked one is pictured instead. */
const WIDE_MAX = 1300;
const STACKED_MAX = 900;

async function treeShot(page, url, out) {
  await page.setViewportSize({ width: 1400, height: 1000 });
  await page.goto(`${url}&layout=wide`);
  await page.waitForSelector("[data-ptw-scroll] svg");
  await page.waitForTimeout(300);
  let wide = true;
  if ((await page.evaluate(inkBox)).w > WIDE_MAX) {
    wide = false;
    await page.goto("about:blank");
    await page.goto(url);
  }
  await page.waitForSelector("[data-ptw-scroll] svg");
  // Hide the source pane.
  if ((await page.getAttribute("button[aria-pressed]", "aria-pressed")) === "true")
    await page.click("button[aria-pressed]");
  await page.waitForTimeout(500);
  let bb = await page.evaluate(inkBox);
  // Stacked keeps its trunk on the left; past this the right is comment strips.
  const max = wide ? MAX : { ...MAX, w: STACKED_MAX };
  // A viewport the whole tree fits in, so nothing is clipped by the frame.
  await page.setViewportSize({
    width: Math.ceil(Math.min(bb.w, max.w)) + 240,
    height: Math.ceil(Math.min(bb.h, max.h)) + 320,
  });
  await page.waitForTimeout(500);
  bb = await page.evaluate(inkBox);
  const clip = await page.evaluate(
    ({ bb, pad, max, wide }) => {
      const st = document.createElement("style");
      st.textContent = "header{visibility:hidden}[data-ptw-scroll]~*,[data-ptw-scroll]>:not(svg){visibility:hidden!important}";
      document.head.append(st);
      const f = document.querySelector("[data-ptw-scroll]");
      const w = Math.min(bb.w, max.w) + 2 * pad;
      // Wider than the cap: keep where the trunk is (wide: the middle; stacked: the left).
      const skip = wide ? Math.max(0, (bb.w - max.w) / 2) : 0;
      f.scrollLeft = bb.x - pad + skip;
      f.scrollTop = bb.y - pad;
      const fr = f.getBoundingClientRect();
      const left = f.scrollLeft, top = f.scrollTop;
      return {
        x: fr.left + (bb.x - pad + skip - left),
        y: fr.top + (bb.y - pad - top),
        width: w,
        height: Math.min(bb.h, max.h) + 2 * pad,
      };
    },
    { bb, pad: 20, max, wide },
  );
  await page.waitForTimeout(200);
  await webp(page, await page.screenshot({ clip }), CARD_W, out);
}

/** The author's own hero picture for `theme`, if there is one. */
const HERO_DIR = path.join(web, "../demos");
function heroFile(theme) {
  for (const t of [theme, "light"]) {
    const f = path.join(HERO_DIR, `hero-${t}.png`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

async function heroShot(page, url, out, theme) {
  const own = heroFile(theme);
  if (own) {
    await webp(page, fs.readFileSync(own), HERO_W, out);
    return;
  }
  await page.setViewportSize({ width: 1200, height: 680 });
  await page.goto(url);
  await page.waitForSelector("[data-ptw-scroll] svg");
  await page.waitForTimeout(800);
  await webp(page, await page.screenshot(), HERO_W, out);
}

const pw = await loadPlaywright();
const { chromium } = pw.chromium ? pw : pw.default;
const { hero, cards } = JSON.parse(fs.readFileSync(path.join(site, "cards.json"), "utf8"));
fs.mkdirSync(path.join(site, "thumbs"), { recursive: true });
const server = await serve(site);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
try {
  for (const theme of THEMES) {
    const ctx = await browser.newContext({ deviceScaleFactor: 2, colorScheme: theme });
    await ctx.addInitScript(([k, t]) => {
      try { localStorage.setItem(k, t); } catch {}
    }, [STORE_KEY, theme]);
    // A fresh page per picture: a hash-only goto is a same-document navigation.
    const shoot = async (fn, url, out) => {
      const page = await ctx.newPage();
      try {
        await fn(page, url, out, theme);
      } finally {
        await page.close();
      }
    };
    const link = (c, extra = "") =>
      `${base}view.html#file=${encodeURIComponent(c.file)}&proof=${encodeURIComponent(c.proof)}${extra}`;
    await shoot(heroShot, link(hero), path.join(site, "thumbs", `hero-${theme}.webp`));
    for (const c of cards) {
      await shoot(treeShot, link(c), path.join(site, "thumbs", `${c.file}-${theme}.webp`));
      process.stdout.write(".");
    }
    await ctx.close();
  }
  console.log(`\nwrote ${path.relative(process.cwd(), path.join(site, "thumbs"))}/ (${cards.length * 2 + 2} pictures)`);
} finally {
  await browser.close();
  server.close();
}
