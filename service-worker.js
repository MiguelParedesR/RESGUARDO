/* service-worker.js — precache + runtime cache + offline fallback (safe) */

const VERSION = "v1.1.3";
const STATIC_CACHE = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
const TILE_CACHE = `tiles-${VERSION}`;

const CORE_ASSETS = [
    "/",
    "/config.js",
    "/js/guard.js",
    "/js/lib/app-header.js",
    "/js/lib/tracking-common.js",
    "/js/lib/tracking-store.js",
    "/js/lib/router-local.js",

    "/html/login/login.html",
    "/html/dashboard/dashboard-custodia.html",
    "/html/dashboard/custodia-registros.html",
    "/html/dashboard/dashboard-admin.html",
    "/html/dashboard/dashboard-consulta.html",
    "/html/dashboard/mapa-resguardo.html",
    "/html/partials/app-header.html",

    "/css/login/login.css",
    "/css/dashboard/dashboard-custodia.css",
    "/css/dashboard/custodia-registros.css",
    "/css/dashboard/dashboard-admin.css",
    "/css/dashboard/dashboard-consulta.css",
    "/css/dashboard/mapa-resguardo.css",

    "/js/login/login.js",
    "/js/dashboard/dashboard-custodia.js",
    "/js/dashboard/custodia-registros.js",
    "/js/dashboard/dashboard-admin.js",
    "/js/dashboard/dashboard-consulta.js",
    "/js/mapa.js",
    "/js/pwa.js",
    "/modules/alarma/alarma.js",
    "/modules/alarma/alarma.css",

    "/assets/icon-192.svg",
    "/assets/icon-512.svg",
    "/assets/icons/custodia-current.svg",
    "/assets/icons/pin-destination.svg",
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

// Re-define OFFLINE_HTML with proper UTF-8 accents to avoid mojibake
try { OFFLINE_HTML = `
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
</html>`; } catch {}

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

    // Externos: solo manejar tiles OSM. Dejar pasar CDNs/APIs para respetar CSP.
    const host = url.hostname || "";
    const isOSMTile = host.endsWith("tile.openstreetmap.org");

    if (!isOSMTile) {
        // No interceptamos otras peticiones cross‑origin (CDNs, Supabase, Google Fonts, etc.).
        return;
    }

    // Tiles de OpenStreetMap: network-first con fallback a cache local
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

self.addEventListener("push", (event) => {
    if (!event) return;
    const payload = parsePushData(event.data);
    if (!payload) return;
    event.waitUntil(
        (async () => {
            try {
                await self.registration.showNotification(payload.title, payload.options);
            } catch (err) {
                console.warn("[sw] showNotification falló", err);
            }
            await broadcastAlarma({ kind: "push", event: payload.type, payload: payload.options.data });
        })()
    );
});

self.addEventListener("notificationclick", (event) => {
    const data = event.notification?.data || {};
    const action = event.action || "open";
    event.notification?.close();
    const targetUrl = data.url || "/";
    event.waitUntil(
        (async () => {
            const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const origin = self.location.origin;
            const normalized = new URL(targetUrl, origin).href;
            let match = allClients.find((client) => client.url === normalized);
            if (!match) {
                match = allClients.find((client) => client.url.startsWith(normalized));
            }
            if (match) {
                await match.focus();
            } else {
                match = await self.clients.openWindow(normalized);
            }
            if (match) {
                match.postMessage({ channel: "alarma", kind: "notificationclick", action, payload: data });
            }
            if (action === "silence") {
                await broadcastAlarma({ kind: "notification-action", action: "silence", payload: data });
            }
        })()
    );
});

self.addEventListener("pushsubscriptionchange", () => {
    broadcastAlarma({ kind: "pushsubscriptionchange" });
});

function parsePushData(data) {
    if (!data) return null;
    try {
        const raw = data.json();
        const type = raw.type || raw.data?.type || null;
        const options = {
            body: raw.body || "",
            icon: raw.icon || "/assets/icon-192.svg",
            badge: raw.badge || raw.icon || "/assets/icon-192.svg",
            requireInteraction: raw.requireInteraction !== false,
            renotify: raw.renotify ?? true,
            vibrate: raw.vibrate || [220, 120, 220],
            tag: raw.tag || `alarma-${type || "alerta"}`,
            actions: raw.actions || [],
            data: {
                ...(raw.data || {}),
                url: raw.data?.url || raw.url || "/",
                type
            }
        };
        const title = raw.title || "Alerta";
        return { title, options, type };
    } catch (err) {
        console.warn("[sw] push payload inválido", err);
        return null;
    }
}

async function broadcastAlarma(message) {
    try {
        const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        for (const client of clientsList) {
            client.postMessage({ channel: "alarma", ...message });
        }
    } catch (err) {
        console.warn("[sw] no se pudo enviar mensaje a clientes", err);
    }
}
// End of service-worker.js
