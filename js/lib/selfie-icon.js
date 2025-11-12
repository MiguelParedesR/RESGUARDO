// === BEGIN HU:HU-SELFIE-ICON (NO TOCAR FUERA) ===
(function (global) {
  "use strict";

  const instances = new WeakMap();
  const noop = () => {};

  function attach(trigger, options = {}) {
    if (!trigger) return null;
    if (!global.CustodiaCamera?.capture) {
      console.warn("[selfie-icon] CustodiaCamera no disponible");
    }
    const opts = {
      hintReady:
        options.hintReady || "Selfie lista. Puedes repetirla si lo deseas.",
      hintIdle: options.hintIdle || null,
      onCapture:
        typeof options.onCapture === "function" ? options.onCapture : noop,
      onError: typeof options.onError === "function" ? options.onError : noop,
      previewImg: options.previewImg || null,
      hintEl: options.hintEl || null,
      facingMode: options.facingMode || "user",
    };
    const state = { busy: false };

    const setBusy = (flag) => {
      state.busy = flag;
      trigger.classList.toggle("is-busy", flag);
    };

    const updateHint = (text) => {
      if (opts.hintEl && text) {
        opts.hintEl.textContent = text;
      }
    };

    if (opts.hintIdle) updateHint(opts.hintIdle);

    const handleClick = async () => {
      if (state.busy) return;
      if (!global.CustodiaCamera?.capture) {
        opts.onError(new Error("camera-unsupported"));
        updateHint("La cámara no está disponible en este dispositivo.");
        return;
      }
      setBusy(true);
      try {
        const permResult =
          (await global.PermHelper?.ensureCameraPermission()) || "unknown";
        if (permResult === "denied") {
          updateHint("Debes permitir el acceso a la cámara para continuar.");
          opts.onError(new Error("camera-denied"));
          return;
        }
        const result = await global.CustodiaCamera.capture({
          facingMode: opts.facingMode,
        });
        if (result?.dataUrl && opts.previewImg) {
          opts.previewImg.hidden = false;
          opts.previewImg.src = result.dataUrl;
        }
        if (result?.dataUrl) {
          updateHint(opts.hintReady);
          opts.onCapture(result);
        }
      } catch (err) {
        console.warn("[selfie-icon] capture fail", err);
        opts.onError(err);
      } finally {
        setBusy(false);
      }
    };

    trigger.addEventListener("click", handleClick);
    const destroy = () => {
      trigger.removeEventListener("click", handleClick);
    };
    instances.set(trigger, { destroy });
    return { destroy };
  }

  function detach(trigger) {
    const inst = instances.get(trigger);
    if (inst) {
      inst.destroy();
      instances.delete(trigger);
    }
  }

  global.CustodiaSelfie = {
    attach,
    detach,
  };
})(window);
// === END HU:HU-SELFIE-ICON ===
