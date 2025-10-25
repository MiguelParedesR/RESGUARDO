/* service-worker.js — precache + runtime cache + offline fallback (safe) */

const VERSION = "v1.0.7";
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const TILE_CACHE = `tiles-${VERSION}`;

const CORE_ASSETS = [
    "/",
    "/config.js",

    "/html/login/login.html",
    "/html/dashboard/dashboard-custodia.html",
    "/html/dashboard/dashboard-admin.html",
    "/html/dashboard/dashboard-consulta.html",
    "/html/dashboard/mapa-resguardo.html",

    "/css/login/login.css",
    "/css/dashboard/dashboard-custodia.css",
    "/css/dashboard/dashboard-admin.css",
    "/css/dashboard/dashboard-consulta.css",
    "/css/dashboard/mapa-resguardo.css",

    "/js/login/login.js",
    "/js/dashboard/dashboard-custodia.js",
    "/js/dashboard/dashboard-admin.js",
    "/js/dashboard/dashboard-consulta.js",
    "/js/mapa.js",
    "/js/pwa.js",
];

const OFFLINE_HTML = `
<!doctype html><html lang="es"><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Sin conexión</title>
<style>
  body{font-family:system-ui,Segoe UI,Roboto,Arial;background:#f5f7fa;margin:0;display:grid;place-items:center;height:100vh;color:#263238}
  .card{background:#fff;border-radius:14px;box-shadow:0 6px 18px rgba(0,0,0,.08);padding:24px;max-width:520px;margin:16px}
  h1{margin:0 0 8px;font-size:20px}
  p{opacity:.8}
  code{background:#f1f3f7;padding:2px 6px;border-radius:6px}
</style>
<div class="card">
<h1>Estás sin conexión</h1>
<p>No pudimos cargar la página solicitada. Revisa tu conexión e inténtalo de nuevo.</p>
<p>Los recursos básicos de la aplicación están disponibles offline gracias al modo PWA.</p>
<p><code>Monitoreo de Resguardos</code></p>
</div>
</html>`;

const isHttp = (url) => url.protocol === "http:" || url.protocol === "https:";
const isHTML = (request) =>
    request.destination === "document" ||
    (request.headers.get("accept") || "").includes("text/html");
const sameOrigin = (url) => url.origin === self.location.origin;

self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(STATIC_CACHE);
            await cache.addAll(CORE_ASSETS.map((p) => new Request(p, { cache: "reload" })));
            self.skipWaiting();
        })()
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        (async () => {
            const keys = await caches.keys();
            await Promise.all(
                keys
                    .filter((k) => ![STATIC_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(k))
                    .map((k) => caches.delete(k))
            );
            await self.clients.claim();
        })()
    );
});

self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;

    // Solo atender GET y http/https. Ignora chrome-extension:, blob:, data:, etc.
    if (req.method !== "GET") return;
    let url;
    try { url = new URL(req.url); } catch { return; }
    if (!isHttp(url)) return;

    // Navegaciones HTML: network-first con fallback
    if (isHTML(req)) {
        event.respondWith(
            (async () => {
                try {
                    const fresh = await fetch(req);
                    const cache = await caches.open(RUNTIME_CACHE);
                    if (fresh && fresh.ok) cache.put(req, fresh.clone());
                    return fresh;
                } catch {
                    const cache = await caches.open(RUNTIME_CACHE);
                    const cached = await cache.match(req);
                    return cached || new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
                }
            })()
        );
        return;
    }

    // Assets de mismo origen: cache-first
    if (sameOrigin(url)) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(STATIC_CACHE);
                const cached = await cache.match(req);
                if (cached) return cached;
                try {
                    const fresh = await fetch(req);
                    if (fresh && fresh.ok) cache.put(req, fresh.clone());
                    return fresh;
                } catch {
                    return cached || Response.error();
                }
            })()
        );
        return;
    }

    // Externos (tiles, CDNs, APIs): network-first con fallback a su cache
    event.respondWith(
        (async () => {
            const runtime = await caches.open(TILE_CACHE);
            try {
                const fresh = await fetch(req, { cache: "no-store" });
                if (fresh && fresh.ok) runtime.put(req, fresh.clone());
                trimCache(TILE_CACHE, 150);
                return fresh;
            } catch {
                const cached = await runtime.match(req);
                return cached || Response.error();
            }
        })()
    );
});

// Mantenimiento simple del tamaño del cache
async function trimCache(cacheName, maxItems) {
    try {
        const cache = await caches.open(cacheName);
        const keys = await cache.keys();
        if (keys.length <= maxItems) return;
        const excess = keys.length - maxItems;
        for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
    } catch { }
}
// End of service-worker.js
