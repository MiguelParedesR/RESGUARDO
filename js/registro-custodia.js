// === BEGIN HU:HU-REGISTRO-CUSTODIA onboarding (NO TOCAR FUERA) ===
(function () {
  "use strict";

  const SELECTORS = {
    form: "#registro-custodia-form",
    success: "#registro-success",
    successBtn: "#btn-volver-login",
    name: "#nombre-completo",
    dni: "#dni",
    empresa: "#empresa",
    empresaOtroGroup: "#campo-empresa-otro",
    empresaOtroInput: "#empresa-otra",
    selfieTrigger: "#selfie-trigger",
    selfiePreview: "#selfie-preview",
    selfiePreviewImg: "#selfie-preview-img",
    selfieHint: "#selfie-hint",
    submitBtn: "#btn-registrar",
  };

  const LOG_PREFIX = "[registro]";
  const API_PREFIX = "[api]";
  const CAMERA_PREFIX = "[camera]";
  const PERM_PREFIX = "[perm]";

  const state = {
    selfieBlob: null,
    loader: null,
    snackbar: null,
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const form = document.querySelector(SELECTORS.form);
    if (!form) return;

    state.snackbar = document.getElementById("app-snackbar");
    initLoader();
    bindEmpresaSelect();
    setupSelfieIcon();
    bindFormSubmit(form);
    bindSuccessButton();
    console.log(`${LOG_PREFIX} init ok`);
  }

  function initLoader() {
    const existing = document.getElementById("registro-loader");
    if (existing) {
      state.loader = existing;
      return;
    }
    const loader = document.createElement("div");
    loader.id = "registro-loader";
    loader.innerHTML = `
      <div class="loader-backdrop">
        <div class="loader-content">
          <div class="loader-spinner"></div>
          <p>Procesando registro...</p>
        </div>
      </div>
    `;
    loader.style.display = "none";
    document.body.appendChild(loader);
    injectLoaderStyles();
    state.loader = loader;
  }

  function injectLoaderStyles() {
    if (document.getElementById("registro-loader-style")) return;
    const style = document.createElement("style");
    style.id = "registro-loader-style";
    style.textContent = `
      #registro-loader {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(6, 4, 12, 0.7);
        backdrop-filter: blur(6px);
        z-index: 9999;
      }
      #registro-loader .loader-content {
        text-align: center;
        color: #f5f5f5;
        font-family: "Inter", "Roboto", system-ui, sans-serif;
      }
      #registro-loader .loader-spinner {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 4px solid rgba(255, 255, 255, 0.35);
        border-top-color: #ffffff;
        animation: spin 0.9s linear infinite;
        margin: 0 auto 12px;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);
  }

  function setLoaderVisible(visible, message) {
    if (!state.loader) return;
    if (message) {
      const label = state.loader.querySelector("p");
      if (label) label.textContent = message;
    }
    state.loader.style.display = visible ? "flex" : "none";
  }

  function bindEmpresaSelect() {
    const select = document.querySelector(SELECTORS.empresa);
    const group = document.querySelector(SELECTORS.empresaOtroGroup);
    const input = document.querySelector(SELECTORS.empresaOtroInput);
    if (!select || !group || !input) return;

    const toggle = () => {
      const isOther = select.value === "OTRA";
      group.hidden = !isOther;
      if (isOther) {
        input.focus();
      } else {
        input.value = "";
        group.classList.remove("is-invalid");
        group.removeAttribute("data-error");
      }
    };
    select.addEventListener("change", toggle);
  }

  function setupSelfieIcon() {
    const trigger = document.querySelector(SELECTORS.selfieTrigger);
    const previewImg = document.querySelector(SELECTORS.selfiePreviewImg);
    const hintEl = document.querySelector(SELECTORS.selfieHint);
    if (!trigger || !globalThis.CustodiaSelfie?.attach) return;
    globalThis.CustodiaSelfie.attach(trigger, {
      previewImg,
      hintEl,
      hintIdle: "Sin selfie registrada. Captura una antes de completar el registro.",
      hintReady: "Selfie lista. Puedes volver a capturar si deseas.",
      onCapture: ({ blob }) => {
        state.selfieBlob = blob;
      },
      onError: (err) => {
        console.warn(`${CAMERA_PREFIX} capture fail`, err);
        if (err?.name === "NotAllowedError") {
          console.warn(`${PERM_PREFIX} camera denied`);
          showMsg("Necesitas permitir el uso de la cámara para continuar.");
        } else if (err?.message !== "camera-cancelled") {
          showMsg("No se pudo tomar la selfie. Intenta nuevamente.");
        }
      },
    });
  }

  function bindFormSubmit(form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!window.sb) {
        console.error(`${API_PREFIX} Supabase no inicializado`);
        showMsg("Configura la conexión antes de registrar custodias.");
        return;
      }
      const payload = collectFormData();
      if (!payload) return;
      if (!state.selfieBlob) {
        showMsg("Captura una selfie para completar el registro.");
        return;
      }

      const submitBtn = document.querySelector(SELECTORS.submitBtn);
      setButtonLoading(submitBtn, true);
      setLoaderVisible(true, "Guardando tus datos...");

      try {
        const custodia = await insertCustodia(payload);
        await insertCustodiaLogin(custodia);
        await uploadCustodiaSelfie(custodia);
        console.log(`${LOG_PREFIX} registro completado`, custodia);
        showSuccess(custodia);
      } catch (err) {
        console.error(`${LOG_PREFIX} registro error`, err);
        const friendly =
          err?.code === "23505"
            ? "Ya existe un registro con ese DNI."
            : err?.message || "No se pudo completar el registro.";
        showMsg(friendly);
      } finally {
        setLoaderVisible(false);
        setButtonLoading(submitBtn, false);
      }
    });
  }

  function bindSuccessButton() {
    const btn = document.querySelector(SELECTORS.successBtn);
    if (!btn) return;
    btn.addEventListener("click", () => {
      window.location.href = "./login.html";
    });
  }

  function collectFormData() {
    const nameField = document.querySelector(SELECTORS.name).closest(".registro-field");
    const dniField = document.querySelector(SELECTORS.dni).closest(".registro-field");
    const empresaField = document.querySelector(SELECTORS.empresa).closest(".registro-field");
    const empresaOtroGroup = document.querySelector(SELECTORS.empresaOtroGroup);

    const nombreInput = document.querySelector(SELECTORS.name);
    const dniInput = document.querySelector(SELECTORS.dni);
    const empresaSelect = document.querySelector(SELECTORS.empresa);
    const empresaOtroInput = document.querySelector(SELECTORS.empresaOtroInput);

    clearInvalid(nameField);
    clearInvalid(dniField);
    clearInvalid(empresaField);
    clearInvalid(empresaOtroGroup);

    const nombre = (nombreInput?.value || "").trim();
    const dni = (dniInput?.value || "").trim();
    const empresa = empresaSelect?.value || "";
    const empresaOtro = (empresaOtroInput?.value || "").trim();

    if (!nombre || nombre.split(/\s+/).filter(Boolean).length < 2) {
      markInvalid(nameField, "Ingresa tu nombre completo (mínimo 2 palabras)");
      nombreInput?.focus();
      return null;
    }
    if (!/^[0-9]{8,}$/.test(dni)) {
      markInvalid(dniField, "El DNI debe tener al menos 8 dígitos");
      dniInput?.focus();
      return null;
    }
    if (!empresa) {
      markInvalid(empresaField, "Selecciona una empresa");
      empresaSelect?.focus();
      return null;
    }
    if (empresa === "OTRA") {
      if (!empresaOtro || empresaOtro.length < 3) {
        markInvalid(empresaOtroGroup, "Ingresa el nombre de la empresa");
        empresaOtroInput?.focus();
        return null;
      }
    }

    return {
      nombre,
      dni,
      empresa: empresa === "OTRA" ? null : empresa,
      empresa_otro: empresa === "OTRA" ? empresaOtro : null,
    };
  }

  async function insertCustodia(payload) {
    console.log(`${API_PREFIX} insert custodia`);
    const { data, error } = await window.sb
      .from("custodia")
      .insert(
        {
          nombre: payload.nombre,
          dni: payload.dni,
          empresa: payload.empresa,
          empresa_otro: payload.empresa_otro,
        },
        { returning: "representation" }
      )
      .select("id,dni_last4,nombre,empresa,empresa_otro")
      .single();
    if (error) throw error;
    return data;
  }

  async function insertCustodiaLogin(custodia) {
    console.log(`${API_PREFIX} insert custodia_login`);
    const { error } = await window.sb
      .from("custodia_login")
      .insert({
        custodia_id: custodia.id,
        pin_last4: custodia.dni_last4,
      });
    if (error) {
      const code = String(error.code || error.details?.code || "");
      const msg = (error.message || "").toLowerCase();
      const isDuplicate =
        code === "23505" ||
        msg.includes("duplicate key value") ||
        msg.includes("already exists");
      if (isDuplicate) {
        console.log(`${API_PREFIX} custodia_login existente, se omite`, {
          code,
        });
        return;
      }
      throw error;
    }
  }

  async function uploadCustodiaSelfie(custodia) {
    if (!state.selfieBlob) {
      throw new Error("Selfie requerida");
    }
    const mime = state.selfieBlob.type || "image/jpeg";
    const bytes = await blobToHex(state.selfieBlob);
    console.log(`${API_PREFIX} insert selfie`, { mime, size: state.selfieBlob.size });
    const { error } = await window.sb
      .from("selfie")
      .insert({
        custodia_id: custodia.id,
        servicio_custodio_id: null,
        mime_type: mime,
        bytes,
      });
    if (error) throw error;
  }

  async function blobToHex(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let hex = "";
    bytes.forEach((b) => {
      hex += b.toString(16).padStart(2, "0");
    });
    return "\\x" + hex;
  }

  function markInvalid(container, message) {
    if (!container) return;
    container.classList.add("is-invalid");
    container.setAttribute("data-error", message);
  }

  function clearInvalid(container) {
    if (!container) return;
    container.classList.remove("is-invalid");
    container.removeAttribute("data-error");
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("loading", loading);
    btn.disabled = loading;
  }

  function showMsg(message) {
    try {
      if (state.snackbar?.MaterialSnackbar) {
        state.snackbar.MaterialSnackbar.showSnackbar({ message });
      } else {
        alert(message);
      }
    } catch {
      alert(message);
    }
  }

  function showSuccess(custodia) {
    const form = document.querySelector(SELECTORS.form);
    const success = document.querySelector(SELECTORS.success);
    if (form) form.hidden = true;
    if (success) {
      success.hidden = false;
      const msg = success.querySelector("p");
      if (msg) {
        msg.innerHTML =
          "Tu PIN es siempre los <strong>últimos 4 dígitos</strong> de tu DNI (" +
          (custodia?.dni_last4 || "XXXX") +
          ").";
      }
    }
    showMsg("Registro completado. Tu PIN es los últimos 4 dígitos de tu DNI.");
  }
})();
// === END HU:HU-REGISTRO-CUSTODIA ===
