// === BEGIN HU:HU-REGISTRO-CUSTODIA camera-modal (NO TOCAR FUERA) ===
(function (global) {
  "use strict";

  const state = {
    modal: null,
    overlay: null,
    video: null,
    canvas: null,
    captureBtn: null,
    closeBtn: null,
    stream: null,
    resolver: null,
    rejecter: null,
    options: {},
  };

  function ensureModal() {
    if (state.modal) return;
    const wrapper = document.createElement("div");
    wrapper.className = "camera-modal";
    wrapper.innerHTML = `
      <div class="camera-modal__backdrop" data-camera-close></div>
      <div class="camera-modal__dialog">
        <header class="camera-modal__header">
          <p>Selfie</p>
          <button type="button" class="camera-modal__close" data-camera-close aria-label="Cerrar">
            <span class="material-icons" aria-hidden="true">close</span>
          </button>
        </header>
        <div class="camera-modal__body">
          <video id="camera-modal-video" autoplay playsinline muted></video>
          <canvas id="camera-modal-canvas" hidden></canvas>
        </div>
        <div class="camera-modal__actions">
          <button type="button" class="camera-modal__capture" id="camera-modal-capture" aria-label="Tomar selfie">
            <span class="camera-modal__capture-ring">
              <span class="camera-modal__capture-dot"></span>
            </span>
            <span class="camera-modal__capture-label">Capturar</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);
    injectStyles();
    state.modal = wrapper;
    state.video = wrapper.querySelector("#camera-modal-video");
    state.canvas = wrapper.querySelector("#camera-modal-canvas");
    state.captureBtn = wrapper.querySelector("#camera-modal-capture");
    state.overlay = wrapper.querySelector(".camera-modal__backdrop");
    wrapper
      .querySelectorAll("[data-camera-close]")
      .forEach((btn) =>
        btn.addEventListener("click", () => rejectCapture("camera-cancelled"))
      );
    state.captureBtn?.addEventListener("click", handleCaptureClick);
  }

  function injectStyles() {
    if (document.getElementById("camera-modal-style")) return;
    const style = document.createElement("style");
    style.id = "camera-modal-style";
    style.textContent = `
      .camera-modal {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 9998;
      }
      .camera-modal.show {
        display: flex;
      }
      .camera-modal__backdrop {
        position: absolute;
        inset: 0;
        background: rgba(7, 7, 12, 0.75);
        backdrop-filter: blur(8px);
      }
      .camera-modal__dialog {
        position: relative;
        width: min(420px, 92vw);
        border-radius: 28px;
        background: rgba(10, 7, 18, 0.9);
        border: 1px solid rgba(255, 255, 255, 0.12);
        box-shadow: 0 30px 80px rgba(6, 3, 12, 0.7);
        padding: 18px 18px 28px;
        display: grid;
        gap: 18px;
      }
      .camera-modal__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #f8f8fb;
      }
      .camera-modal__header p {
        margin: 0;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        font-size: 0.85rem;
      }
      .camera-modal__close {
        border: none;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 999px;
        width: 32px;
        height: 32px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: #f8f8fb;
        cursor: pointer;
      }
      .camera-modal__body {
        position: relative;
        border-radius: 22px;
        overflow: hidden;
        background: rgba(255, 255, 255, 0.05);
        min-height: 320px;
      }
      .camera-modal__body video,
      .camera-modal__body canvas {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .camera-modal__actions {
        display: flex;
        justify-content: center;
      }
      .camera-modal__capture {
        border: none;
        background: transparent;
        display: grid;
        gap: 8px;
        justify-items: center;
        cursor: pointer;
        color: #f8f8fb;
      }
      .camera-modal__capture-ring {
        width: 72px;
        height: 72px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .camera-modal__capture-dot {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        background: linear-gradient(135deg, #ff4d67, #ff7e90);
        box-shadow: 0 0 20px rgba(255, 77, 103, 0.45);
      }
      .camera-modal__capture-label {
        font-size: 0.85rem;
        letter-spacing: 0.2em;
        text-transform: uppercase;
      }
      @media (max-width: 520px) {
        .camera-modal__dialog {
          width: min(480px, 96vw);
          padding: 16px;
        }
        .camera-modal__body {
          min-height: 260px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  async function startStream(options = {}) {
    const constraints = {
      video: {
        facingMode: options.facingMode || "user",
      },
      audio: false,
    };
    try {
      state.stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log("[camera] stream ready");
    } catch (err) {
      console.warn("[camera] stream error", err);
      throw err;
    }
    if (!state.video) throw new Error("video-element-missing");
    state.video.srcObject = state.stream;
    await new Promise((resolve) => {
      state.video.onloadedmetadata = () => {
        state.video.play().catch(() => {});
        resolve();
      };
    });
  }

  function stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_) {
          /* noop */
        }
      });
    }
    state.stream = null;
    if (state.video) {
      state.video.srcObject = null;
    }
  }

  function handleCaptureClick() {
    if (!state.video || !state.canvas) return;
    const width = state.video.videoWidth;
    const height = state.video.videoHeight;
    if (!width || !height) {
      console.warn("[camera] video metadata not ready");
      return;
    }
    state.canvas.width = width;
    state.canvas.height = height;
    const ctx = state.canvas.getContext("2d");
    ctx.drawImage(state.video, 0, 0, width, height);
    state.canvas.toBlob(
      async (blob) => {
        if (!blob) {
          rejectCapture("capture-failed");
          return;
        }
        const dataUrl = await blobToDataUrl(blob);
        resolveCapture({ blob, dataUrl });
      },
      "image/jpeg",
      0.9
    );
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  function resolveCapture(payload) {
    closeModal();
    state.resolver?.(payload);
    cleanupPending();
  }

  function rejectCapture(reason) {
    closeModal();
    if (reason instanceof Error) {
      state.rejecter?.(reason);
    } else {
      state.rejecter?.(new Error(reason));
    }
    cleanupPending();
  }

  function cleanupPending() {
    state.resolver = null;
    state.rejecter = null;
    state.options = {};
  }

  function closeModal() {
    stopStream();
    state.modal?.classList.remove("show");
  }

  function openModal() {
    state.modal?.classList.add("show");
  }

  async function capture(options = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("camera-unsupported");
    }
    ensureModal();
    if (state.resolver) {
      rejectCapture("camera-cancelled");
    }
    state.options = options || {};
    return new Promise(async (resolve, reject) => {
      state.resolver = resolve;
      state.rejecter = reject;
      try {
        await startStream(state.options);
        openModal();
      } catch (err) {
        cleanupPending();
        reject(err);
      }
    });
  }

  global.CustodiaCamera = {
    capture,
    close: closeModal,
  };
})(window);
// === END HU:HU-REGISTRO-CUSTODIA ===
