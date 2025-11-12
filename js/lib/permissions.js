// === BEGIN HU:HU-PERMISOS helper (NO TOCAR FUERA) ===
(function (global) {
  "use strict";

  async function ensurePermission(name) {
    if (!global.navigator?.permissions?.query) return null;
    try {
      const status = await global.navigator.permissions.query({ name });
      return status.state;
    } catch {
      return null;
    }
  }

  async function ensureNotificationPermission(reason) {
    if (typeof global.Notification === "undefined") {
      console.warn("[perm] notifications unsupported");
      return null;
    }
    if (global.Notification.permission !== "default") {
      console.log("[perm] notifications:" + global.Notification.permission);
      return global.Notification.permission;
    }
    try {
      console.log("[perm] notifications:request", reason || "");
      const result = await global.Notification.requestPermission();
      console.log("[perm] notifications:result", result);
      return result;
    } catch (err) {
      console.warn("[perm] notifications error", err);
      return null;
    }
  }

  async function ensureCameraPermission() {
    const status = await ensurePermission("camera");
    if (status === "granted") return status;
    try {
      await global.navigator.mediaDevices?.getUserMedia({ video: true });
      return "granted";
    } catch (err) {
      console.warn("[perm] camera error", err);
      return "denied";
    }
  }

  async function ensureMicPermission() {
    const status = await ensurePermission("microphone");
    if (status === "granted") return status;
    try {
      await global.navigator.mediaDevices?.getUserMedia({ audio: true });
      return "granted";
    } catch (err) {
      console.warn("[perm] mic error", err);
      return "denied";
    }
  }

  async function ensureGeoPermission(options) {
    const status = await ensurePermission("geolocation");
    if (status === "granted") return status;
    return new Promise((resolve) => {
      if (!global.navigator?.geolocation) {
        resolve(null);
        return;
      }
      global.navigator.geolocation.getCurrentPosition(
        () => resolve("granted"),
        () => resolve("denied"),
        options || { timeout: 8000 }
      );
    });
  }

  global.PermHelper = {
    ensureNotificationPermission,
    ensureCameraPermission,
    ensureMicPermission,
    ensureGeoPermission,
  };
})(window);
// === END HU:HU-PERMISOS ===
