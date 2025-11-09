// pwa.js - registro del Service Worker y flujo de instalacion PWA
// @hu HU-AUDIO-GESTO
// @author Codex
// @date 2025-02-15
// @rationale Manejar beforeinstallprompt segun HU de audio/PWA.
// === BEGIN HU:HU-AUDIO-GESTO pwa install (no tocar fuera) ===
(() => {
  if (!("serviceWorker" in navigator)) return;

  const snackbar = () => document.getElementById("app-snackbar");
  const notify = (message) => {
    const sb = snackbar();
    try {
      if (sb && sb.MaterialSnackbar)
        sb.MaterialSnackbar.showSnackbar({ message });
      else console.log("[PWA]", message);
    } catch {
      console.log("[PWA]", message);
    }
  };

  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("/service-worker.js", {
        scope: "/",
      });
      console.log("[PWA] SW registrado:", reg.scope);

      // === BEGIN HU:HU-SW-UPDATE sw-refresh-cycle (NO TOCAR FUERA) ===
      const requestSkipWaiting = (worker) => {
        if (!worker || worker.state !== "installed") return;
        if (!navigator.serviceWorker.controller) return;
        if (worker.__huSkipWaitingRequested) return;
        worker.__huSkipWaitingRequested = true;
        notify("Nueva version lista. Actualizando...");
        console.log("[PWA] solicitando skipWaiting");
        worker.postMessage({ type: "SKIP_WAITING" });
      };

      const observeInstalling = (worker) => {
        if (!worker) return;
        if (worker.state === "installed") {
          requestSkipWaiting(worker);
          return;
        }
        const listener = () => requestSkipWaiting(worker);
        worker.addEventListener("statechange", listener);
      };

      if (reg.installing) observeInstalling(reg.installing);
      reg.addEventListener("updatefound", () => {
        observeInstalling(reg.installing);
      });
      if (reg.waiting) requestSkipWaiting(reg.waiting);
      // === END HU:HU-SW-UPDATE ===
    } catch (e) {
      console.warn("[PWA] Error al registrar SW", e);
    }
  });

  let installBtn = null;
  function showInstallButton() {
    if (installBtn || !document.body) return;
    installBtn = document.createElement("button");
    installBtn.id = "pwa-install-btn";
    installBtn.type = "button";
    installBtn.textContent = "Instalar app";
    installBtn.style.position = "fixed";
    installBtn.style.right = "16px";
    installBtn.style.bottom = "16px";
    installBtn.style.zIndex = "6000";
    installBtn.style.padding = "10px 20px";
    installBtn.style.borderRadius = "999px";
    installBtn.style.border = "none";
    installBtn.style.background = "#263238";
    installBtn.style.color = "#fff";
    installBtn.style.fontWeight = "600";
    installBtn.style.boxShadow = "0 8px 24px rgba(0,0,0,0.35)";
    installBtn.addEventListener("click", () => {
      window.installApp?.();
    });
    document.body.appendChild(installBtn);
  }

  function hideInstallButton() {
    if (!installBtn) return;
    try {
      installBtn.remove();
    } catch (_) {}
    installBtn = null;
  }

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    console.log("[PWA] beforeinstallprompt capturado");
    showInstallButton();
  });

  window.installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (_) {}
    deferredPrompt = null;
    hideInstallButton();
  };

  window.addEventListener("appinstalled", () => {
    hideInstallButton();
    deferredPrompt = null;
    notify("Aplicacion instalada correctamente.");
  });

  window.checkForSWUpdate = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    try {
      await reg?.update();
      notify("Buscando actualizaciones...");
    } catch (_) {}
  };
})();
// === END HU:HU-AUDIO-GESTO ===
