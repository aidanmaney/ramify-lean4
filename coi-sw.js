// Cross-origin isolation WITHOUT server headers (docs/viewer.md "Live Lean").
//
// Live Lean's threads need SharedArrayBuffer, i.e. a cross-origin-isolated page
// (COOP: same-origin + COEP: require-corp). A static host such as GitHub Pages
// sends neither, so this service worker re-serves the PLAYGROUND page with them.
// It is registered only when the reader asks for live Lean (playgroundLive.ts
// `isolateAndReload`); a reader who never asks never gets it.
//
// Only the playground's own navigation gains COOP/COEP — the other pages in this
// scope (the index, the viewer) pass through untouched, so nothing they embed
// is held to require-corp. Same-origin subresources gain CORP: same-origin,
// harmless anywhere and what require-corp asks of them. Cross-origin requests
// are not touched.
const ISOLATED_PAGE = /\/playground(\.html)?$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // a Chrome quirk: this mode on a non-same-origin request throws in fetch()
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const page = req.mode === "navigate";
  if (page && !ISOLATED_PAGE.test(url.pathname)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.status === 0 || res.type === "opaque" || res.type === "opaqueredirect") return res;
      const headers = new Headers(res.headers);
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      if (page || req.destination === "worker" || req.destination === "sharedworker") {
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      }
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    }),
  );
});
