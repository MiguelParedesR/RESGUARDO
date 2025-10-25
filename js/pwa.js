// pwa.js — registra el Service Worker y maneja updates + instalación
(() => {
    if (!("serviceWorker" in navigator)) return;

    // Helpers para mostrar mensajes si existe el snackbar (MDL)
    const snackbar = () => document.getElementById("app-snackbar");
    const notify = (message) => {
        const sb = snackbar();
        try {
            if (sb && sb.MaterialSnackbar) sb.MaterialSnackbar.showSnackbar({ message });
            else console.log("[PWA]", message);
        } catch { console.log("[PWA]", message); }
    };

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing) return;
        refreshing = true;
        // Recargar la página cuando el SW actualizado toma el control
        location.reload();
    });

    // Registro
    window.addEventListener("load", async () => {
        try {
            const reg = await navigator.serviceWorker.register("/service-worker.js", { scope: "/" });
            console.log("[PWA] SW registrado:", reg.scope);

            // Detectar nuevas versiones
            if (reg.installing) {
                reg.installing.addEventListener("statechange", () => {
                    if (reg.installing.state === "installed" && navigator.serviceWorker.controller) {
                        notify("Nueva versión lista. Actualizando…");
                        reg.installing.postMessage({ type: "SKIP_WAITING" });
                    }
                });
            } else {
                reg.addEventListener("updatefound", () => {
                    const nw = reg.installing;
                    nw?.addEventListener("statechange", () => {
                        if (nw.state === "installed" && navigator.serviceWorker.controller) {
                            notify("Actualización disponible. Aplicando…");
                            nw.postMessage({ type: "SKIP_WAITING" });
                        }
                    });
                });
            }
        } catch (e) {
            console.warn("[PWA] Error al registrar SW", e);
        }
    });

    // Instalación A2HS (Add to Home Screen)
    let deferredPrompt = null;
    window.addEventListener("beforeinstallprompt", (e) => {
        e.preventDefault();
        deferredPrompt = e;
        console.log("[PWA] beforeinstallprompt capturado");
        // Ejemplo: mostrar un botón propio si lo necesitas:
        // document.getElementById('btn-install').style.display = 'inline-flex';
    });

    // Llama a esto desde un botón “Instalar” si agregas uno en la UI
    window.installApp = async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try { await deferredPrompt.userChoice; } catch { }
        deferredPrompt = null;
    };

    // Check manual de updates (si lo necesitas en algún botón)
    window.checkForSWUpdate = async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        try { await reg?.update(); notify("Buscando actualizaciones…"); } catch { }
    };
})();
