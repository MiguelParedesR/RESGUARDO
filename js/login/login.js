const CUSTODIA_PROFILE_KEY = "custodia_profile";
const CUSTODIA_SESSION_KEY = "auth_role";
const CUSTODIA_EXP_MS = 24 * 60 * 60 * 1000;
const ROUTES = {
  ADMIN: "/html/dashboard/dashboard-admin.html",
  CONSULTA: "/html/dashboard/dashboard-consulta.html",
  CUSTODIA: "/html/dashboard/custodia-registros.html",
};
const PIN_MIN = 4;
const PIN_MAX = 5;

/**
 * UI helper for snackbar fallback
 */
function showMsg(message) {
  const snackbar = document.getElementById("app-snackbar");
  try {
    if (snackbar && snackbar.MaterialSnackbar) {
      snackbar.MaterialSnackbar.showSnackbar({ message });
    } else {
      alert(message);
    }
  } catch (_) {
    alert(message);
  }
}

function ensureSupabase() {
  if (!window.sb) {
    console.error("[login] Supabase client not available");
    showMsg("Configura la conexion a Supabase antes de continuar.");
    return false;
  }
  return true;
}

function persistCustodiaProfile(profile) {
  const payload = {
    ...profile,
    saved_at: new Date().toISOString(),
    exp_ts: Date.now() + CUSTODIA_EXP_MS,
    isCustodia: true,
  };
  localStorage.setItem(CUSTODIA_PROFILE_KEY, JSON.stringify(payload));
}

function goHome(role) {
  try {
    if (window.guard?.goHome) {
      window.guard.goHome();
      return;
    }
  } catch (_) {}
  const target = ROUTES[role] || "/index.html";
  window.location.href = target;
}

document.addEventListener("DOMContentLoaded", () => {
  const pinInput = document.getElementById("pin-input");
  const pinDotsWrap = document.getElementById("pin-dots");
  const pinDots = Array.from(document.querySelectorAll("#pin-dots .pin-dot"));
  const pinCard = document.querySelector(".pin-card");
  const keypadButtons = document.querySelectorAll("[data-digit]");
  const deleteBtn = document.querySelector("[data-delete]");
  const statusEl = document.getElementById("pin-status");
  const helperEl = document.getElementById("pin-helper");

  let pinBuffer = "";
  let checkTimer = null;
  let checkId = 0;
  let checking = false;
  const DEBOUNCE_MS = { short: 140, long: 650 };

  if (pinInput) {
    setTimeout(() => {
      try {
        pinInput.focus();
      } catch (_) {}
    }, 50);
  }

  keypadButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const digit = btn.getAttribute("data-digit");
      if (!digit) return;
      appendDigit(digit);
    });
  });

  deleteBtn?.addEventListener("click", () => removeDigit());

  pinInput?.addEventListener("input", (evt) => {
    const value = evt.target.value || "";
    setPin(value);
  });

  document.addEventListener("keydown", (evt) => {
    if (evt.metaKey || evt.ctrlKey || evt.altKey) return;
    if (/^[0-9]$/.test(evt.key)) {
      appendDigit(evt.key);
      evt.preventDefault();
      return;
    }
    if (evt.key === "Backspace") {
      removeDigit();
      evt.preventDefault();
      return;
    }
    if (evt.key === "Enter") {
      if (pinBuffer.length >= PIN_MIN) runValidation(pinBuffer);
      evt.preventDefault();
    }
  });

  renderDots();
  setStatus("Listo para escribir.", "muted");

  function normalizePin(value) {
    return (value || "").replace(/\D/g, "").slice(0, PIN_MAX);
  }

  function setPin(value) {
    pinBuffer = normalizePin(value);
    if (pinInput && pinInput.value !== pinBuffer) pinInput.value = pinBuffer;
    renderDots();
    scheduleCheck();
  }

  function renderDots() {
    pinDots.forEach((dot, idx) => {
      dot.classList.toggle("filled", idx < pinBuffer.length);
    });
  }

  function appendDigit(digit) {
    if (pinBuffer.length >= PIN_MAX) return;
    setPin(pinBuffer + digit);
  }

  function removeDigit() {
    if (!pinBuffer.length) return;
    setPin(pinBuffer.slice(0, -1));
    setStatus("Listo para escribir.", "muted");
  }

  function clearPin() {
    setPin("");
  }

  function scheduleCheck() {
    if (checkTimer) clearTimeout(checkTimer);
    const len = pinBuffer.length;
    if (!len) {
      setStatus("Listo para escribir.", "muted");
      return;
    }
    if (len < PIN_MIN) {
      setStatus("El PIN necesita 4 o 5 digitos.", "muted");
      return;
    }
    const delay =
      len === 4 ? DEBOUNCE_MS.long : len >= PIN_MAX ? DEBOUNCE_MS.short : DEBOUNCE_MS.short;
    checkTimer = setTimeout(() => runValidation(pinBuffer), delay);
  }

  function runValidation(pin) {
    if (pin.length < PIN_MIN) return;
    const len = pin.length;
    const id = ++checkId;
    const busyMsg = len === 4 ? "Validando PIN de custodia..." : "Validando PIN de usuario...";
    setChecking(true, busyMsg);
    validatePin(pin, id).finally(() => {
      if (isCurrent(id)) setChecking(false);
    });
  }

  function setChecking(flag, message) {
    checking = flag;
    if (pinCard) pinCard.classList.toggle("is-busy", flag);
    if (message) setStatus(message, flag ? "info" : "muted");
  }

  function isCurrent(id) {
    return id === checkId;
  }

  function setStatus(text, tone = "muted") {
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.setAttribute("data-tone", tone);
    }
    if (helperEl && !text) {
      helperEl.textContent = "Ingresa tu PIN con el teclado numerico.";
    }
  }

  function shakeDots() {
    if (!pinDotsWrap) return;
    pinDotsWrap.classList.add("shake");
    setTimeout(() => pinDotsWrap.classList.remove("shake"), 360);
  }

  async function validatePin(pin, id) {
    if (!ensureSupabase()) {
      shakeDots();
      return;
    }
    try {
      if (pin.length === 4) {
        await validateCustodia(pin, id);
      } else if (pin.length === 5) {
        await validateUsuario(pin, id);
      }
    } catch (err) {
      console.error("[login] validation error", err);
      setStatus("No se pudo validar. Intenta de nuevo.", "error");
      showMsg("No se pudo validar tu acceso. Intenta nuevamente.");
    }
  }

  async function validateCustodia(pin, id) {
    setStatus("Validando PIN de custodia...", "info");
    const { data, error } = await window.sb
      .from("custodia_login")
      .select("custodia_id,pin_last4")
      .eq("pin_last4", pin);

    if (!isCurrent(id)) return;

    if (error) {
      console.error("[login] custodia pin", error);
      setStatus("No se pudo validar el PIN.", "error");
      showMsg("Error de conexion. Intenta nuevamente.");
      return;
    }

    if (!data || !data.length) {
      setStatus("PIN incorrecto o no registrado.", "error");
      shakeAndClear();
      return;
    }

    if (data.length > 1) {
      setStatus("PIN duplicado. Contacta a un administrador.", "error");
      shakeAndClear();
      return;
    }

    await finalizeCustodiaLoginById(data[0].custodia_id, id);
  }

  async function finalizeCustodiaLoginById(custodiaId, id) {
    const { data, error } = await window.sb
      .from("custodia")
      .select("id,nombre,empresa,empresa_otro,dni,dni_last4,is_active")
      .eq("id", custodiaId)
      .maybeSingle();

    if (!isCurrent(id)) return;

    if (error) {
      console.error("[login] custodia profile", error);
      setStatus("No se pudo cargar tu perfil.", "error");
      showMsg("No se pudo cargar tu perfil.");
      return;
    }

    if (!data) {
      setStatus("Perfil no encontrado.", "error");
      shakeAndClear();
      return;
    }

    if (data.is_active === false) {
      setStatus("Tu perfil esta inactivo.", "error");
      showMsg("Tu perfil esta inactivo. Contacta al administrador.");
      clearPin();
      return;
    }

    const profile = {
      id: data.id,
      nombre: data.nombre,
      empresa: data.empresa,
      empresa_otro: data.empresa_otro,
      dni: data.dni,
      dni_last4: data.dni_last4,
      empresa_label: data.empresa || data.empresa_otro || "Sin empresa",
    };

    persistCustodiaProfile(profile);
    sessionStorage.setItem(CUSTODIA_SESSION_KEY, "CUSTODIA");
    sessionStorage.setItem("auth_empresa", profile.empresa_label || "");
    localStorage.setItem("custodia_is_logged", "true");

    setStatus("PIN correcto, redirigiendo...", "success");
    showMsg("Bienvenido, custodia.");
    goHome("CUSTODIA");
  }

  async function validateUsuario(pin, id) {
    setStatus("Validando PIN de usuario...", "info");
    if (!/^[0-9]{5}$/.test(pin)) {
      setStatus("PIN invalido.", "error");
      shakeAndClear();
      return;
    }

    const { data, error } = await window.sb
      .from("usuario")
      .select("id, role, is_active, created_at")
      .eq("pin", pin)
      .in("role", ["ADMIN", "CONSULTA"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!isCurrent(id)) return;

    if (error) {
      console.error("[login] usuario pin", error);
      setStatus("No se pudo validar el PIN.", "error");
      showMsg("No se pudo validar. Intenta nuevamente.");
      return;
    }

    if (!data) {
      setStatus("PIN incorrecto o no registrado.", "error");
      shakeAndClear();
      return;
    }

    if (data.is_active === false) {
      setStatus("Cuenta inactiva. Contacta al administrador.", "error");
      showMsg("Tu usuario esta inactivo.");
      clearPin();
      return;
    }

    const role = (data.role || "").toUpperCase();
    if (!ROUTES[role]) {
      setStatus("Rol sin acceso configurado.", "error");
      shakeAndClear();
      return;
    }

    sessionStorage.setItem(CUSTODIA_SESSION_KEY, role);
    sessionStorage.setItem("auth_usuario_id", data.id || "");

    setStatus("PIN correcto, redirigiendo...", "success");
    showMsg(role === "ADMIN" ? "Bienvenido, Admin." : "Bienvenido.");
    goHome(role);
  }

  function shakeAndClear() {
    shakeDots();
    setTimeout(() => clearPin(), 240);
  }
});
