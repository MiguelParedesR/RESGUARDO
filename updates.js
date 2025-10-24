// /js/updates.js
const CURRENT_VERSION = '1.0.0';

async function checkForUpdates() {
  try {
    const res = await fetch('/version.json', { cache: 'no-store' });
    const { version } = await res.json();
    if (version && version !== CURRENT_VERSION) {
      if (confirm(`Nueva versión ${version} disponible. ¿Actualizar ahora?`)) {
        if ('caches' in window) {
          const names = await caches.keys();
          for (const n of names) await caches.delete(n);
        }
        location.reload(true);
      }
    }
  } catch (err) {
    console.warn('[updates] No se pudo verificar versión', err);
  }
}

// cada 5 minutos
setInterval(checkForUpdates, 5 * 60 * 1000);
checkForUpdates();
