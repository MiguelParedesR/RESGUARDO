/* service-worker.js — precache + runtime cache + offline fallback */

const VERSION = "v1.0.0";
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const TILE_CACHE = `tiles-${VERSION}`;

// Rutas core (solo mismo origen). Ajusta si cambias estructura.
const CORE_ASSETS = [
    "/", // si sirves index; si no, puedes quitarlo
    "/config.js",

    // HTML
    "/html/login/login.html",
    "/html/dashboard/dashboard-custodia.html",
    "/html/dashboard/dashboard-admin.html",
    "/html/dashboard/dashboard-consulta.html",
    "/html/dashboard/mapa-resguardo.html",

    // CSS
    "/css/login/login.css",
    "/css/dashboard/dashboard-custodia.css",
    "/css/dashboard/dashboard-admin.css",
    "/css/dashboard/dashboard-consulta.css",
    "/css/dashboard/mapa-resguardo.css",

    // JS (propios)
    "/js/login/login.js",
    "/js/dashboard/dashboard-custodia.js",
    "/js/dashboard/dashboard-admin.js",
    "/js/dashboard/dashboard-consulta.js",
    "/js/mapa.js",
    "/js/pwa.js",
];

// Respuesta offline básica (HTML inlined)
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

// Utilidades
function isHTML(request) {
    return request.destination === "document" ||
        (request.headers.get("accept") || "").includes("text/html");
}
function sameOrigin(url) {
    try { return new URL(url, self.location.href).origin === self.location.origin; }
    catch { return false; }
}

// Pre-cache install
self.addEventListener("install", (event) => {
    event.waitUntil(
        (async () => {
            const cache = await caches.open(STATIC_CACHE);
            await cache.addAll(CORE_ASSETS.map((p) => new Request(p, { cache: "reload" })));
            self.skipWaiting();
        })()
    );
});

// Activación: limpiar cachés viejas
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

// Mensajes desde la app (para saltar waiting)
self.addEventListener("message", (event) => {
    if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

// Política de caché por tipo de request
self.addEventListener("fetch", (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // Navegaciones (HTML): network-first con fallback a cache u offline
    if (isHTML(req)) {
        event.respondWith(
            (async () => {
                try {
                    const fresh = await fetch(req);
                    const cache = await caches.open(RUNTIME_CACHE);
                    cache.put(req, fresh.clone());
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

    // Assets de mismo origen (CSS/JS/imagenes): cache-first
    if (sameOrigin(url.href)) {
        event.respondWith(
            (async () => {
                const cache = await caches.open(STATIC_CACHE);
                const cached = await cache.match(req);
                if (cached) return cached;
                try {
                    const fresh = await fetch(req);
                    cache.put(req, fresh.clone());
                    return fresh;
                } catch {
                    return cached || Response.error();
                }
            })()
        );
        return;
    }

    // Tiles de mapas / librerías externas / APIs: network-first con fallback a cache
    // (p.ej. OSM tiles, Leaflet CDN, LocationIQ). *No* se precachean.
    event.respondWith(
        (async () => {
            const runtime = await caches.open(TILE_CACHE);
            try {
                const fresh = await fetch(req, { cache: "no-store" });
                // Guardamos solo si es 200
                if (fresh && fresh.status === 200) {
                    runtime.put(req, fresh.clone());
                    trimCache(TILE_CACHE, 150); // mantenimiento simple
                }
                return fresh;
            } catch {
                const cached = await runtime.match(req);
                return cached || Response.error();
            }
        })()
    );
});

// Limitar tamaño aproximado de un caché (FIFO best-effort)
async function trimCache(cacheName, maxItems) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxItems) return;
    const excess = keys.length - maxItems;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
}
// Fin service-worker.js