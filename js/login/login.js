const CUSTODIA_PROFILE_KEY = "custodia_profile";
const CUSTODIA_SESSION_KEY = "auth_role";
const CUSTODIA_EXP_MS = 24 * 60 * 60 * 1000; // 24h
const ROUTES = {
  ADMIN: "/html/dashboard/dashboard-admin.html",
  CONSULTA: "/html/dashboard/dashboard-consulta.html",
  CUSTODIA: "/html/dashboard/custodia-registros.html",
};

document.addEventListener("DOMContentLoaded", () => {
  injectLoaderStyles();
  const state = {
    activeRole: "ADMIN",
    custodiaNeedsDni: false,
    custodiaCandidates: [],
    custodiaPin: null,
  };

  const loader = createLoader();
  const snackbar = document.getElementById("app-snackbar");
  const roleButtons = document.querySelectorAll("[data-role-tab]");
  const forms = document.querySelectorAll("[data-role-form]");

  const adminForm = document.getElementById("admin-form");
  const consultaForm = document.getElementById("consulta-form");
  const custodiaForm = document.getElementById("custodia-form");
  const custodiaDniField = document.getElementById("custodia-dni-field");
  const custodiaDniInput = document.getElementById("custodia-dni");
  const custodiaPinInput = document.getElementById("custodia-pin");
  const custodiaHint = document.getElementById("custodia-hint");

  /* ---------- UI Helpers ---------- */
  function createLoader() {
    const el = document.createElement("div");
    el.id = "app-loader";
    el.innerHTML = `
      <div class="loader-backdrop">
        <div class="loader-content">
          <div class="loader-spinner"></div>
          <p>Validando credenciales...</p>
        </div>
      </div>
    `;
    el.style.display = "none";
    document.body.appendChild(el);
    return el;
  }

  function injectLoaderStyles() {
    if (document.getElementById("login-loader-style")) return;
    const style = document.createElement("style");
    style.id = "login-loader-style";
    style.textContent = `
      #app-loader {
        position: fixed;
        inset: 0;
        display: none;
        align-items: center;
        justify-content: center;
        background: rgba(6, 4, 12, 0.65);
        backdrop-filter: blur(6px);
        z-index: 9999;
      }
      .loader-backdrop {
        padding: 24px;
      }
      .loader-content {
        text-align: center;
        color: #f5f5f5;
        font-family: "Inter", "Roboto", system-ui, sans-serif;
      }
      .loader-spinner {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        border: 4px solid rgba(255, 255, 255, 0.35);
        border-top-color: #ffffff;
        animation: spin 0.9s linear infinite;
        margin: 0 auto 12px;
      }
      #app-loader p {
        margin: 0;
        font-size: 0.95rem;
      }
    `;
    document.head.appendChild(style);
  }

  function setLoaderVisible(visible, message = "Validando credenciales...") {
    if (!loader) return;
    const msgEl = loader.querySelector("p");
    if (msgEl) msgEl.textContent = message;
    loader.style.display = visible ? "flex" : "none";
  }

  function showMsg(message) {
    try {
      if (snackbar?.MaterialSnackbar) {
        snackbar.MaterialSnackbar.showSnackbar({ message });
      } else {
        alert(message);
      }
    } catch {
      alert(message);
    }
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    btn.classList.toggle("loading", loading);
    btn.disabled = loading;
  }

  function markInvalid(field, message = "Dato inválido") {
    if (!field) return;
    field.classList.add("is-invalid");
    field.setAttribute("data-error", message);
  }

  function clearInvalid(field) {
    if (!field) return;
    field.classList.remove("is-invalid");
    field.removeAttribute("data-error");
  }

  function resetCustodiaDisambiguation() {
    state.custodiaNeedsDni = false;
    state.custodiaCandidates = [];
    state.custodiaPin = null;
    if (custodiaDniField) {
      custodiaDniField.hidden = true;
      custodiaDniField.removeAttribute("data-error");
      custodiaDniField.classList.remove("is-invalid");
    }
    if (custodiaDniInput) {
      custodiaDniInput.value = "";
      custodiaDniInput.removeAttribute("required");
    }
    if (custodiaHint) {
      custodiaHint.textContent =
        "Ingresa tu PIN y pulsa ingresar. Si es tu primera vez, regístrate para obtenerlo.";
    }
  }

  function requireCustodiaDni(candidates) {
    state.custodiaNeedsDni = true;
    state.custodiaCandidates = candidates;
    if (custodiaDniField) custodiaDniField.hidden = false;
    if (custodiaDniInput) custodiaDniInput.setAttribute("required", "required");
    if (custodiaHint) {
      custodiaHint.textContent =
        "Encontramos más de una custodia con este PIN. Ingresa tu DNI completo para continuar.";
    }
  }

  function attachClearOnInput(inputId, fieldId) {
    const input = document.getElementById(inputId);
    const field = document.getElementById(fieldId);
    if (input && field) {
      input.addEventListener("input", () => clearInvalid(field));
    }
  }

  function setActiveRole(role) {
    state.activeRole = role;
    roleButtons.forEach((btn) => {
      const isActive = btn.getAttribute("data-role-tab") === role;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    forms.forEach((form) => {
      const targetRole = form.getAttribute("data-role-form");
      form.classList.toggle("is-active", targetRole === role);
    });
    if (role !== "CUSTODIA") {
      resetCustodiaDisambiguation();
    }
    console.log("[login] role selected", role);
  }

  roleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const role = btn.getAttribute("data-role-tab");
      if (role) setActiveRole(role);
    });
  });

  setActiveRole(state.activeRole);

  attachClearOnInput("admin-pass", "admin-pass-field");
  attachClearOnInput("consulta-pass", "consulta-pass-field");
  attachClearOnInput("custodia-pin", "custodia-pin-field");
  attachClearOnInput("custodia-dni", "custodia-dni-field");

  /* ---------- Supabase helpers ---------- */
  function ensureSupabase() {
    if (!window.sb) {
      console.error("[login] Supabase client no disponible");
      showMsg("Configura la conexión a Supabase antes de iniciar sesión.");
      return false;
    }
    return true;
  }

  async function rpcAuth(role, pass) {
    console.log("[api] rpc auth_check_pass", { role });
    const { data, error } = await window.sb.rpc("auth_check_pass", {
      p_role: role.toUpperCase(),
      p_pass: pass,
    });
    if (error) throw error;
    return data === true;
  }

  async function queryCustodiaLoginsByPin(pin) {
    console.log("[api] GET custodia_login by pin", { pin });
    return window.sb
      .from("custodia_login")
      .select("custodia_id,pin_last4")
      .eq("pin_last4", pin);
  }

  async function queryCustodiaProfileById(custodiaId) {
    console.log("[api] GET custodia profile", { custodiaId });
    return window.sb
      .from("custodia")
      .select("id,nombre,empresa,empresa_otro,dni,dni_last4,is_active")
      .eq("id", custodiaId)
      .single();
  }

  async function queryCustodiaByDni(dni, candidateIds) {
    console.log("[api] GET custodia by dni", { dni, candidateIds });
    let query = window.sb
      .from("custodia")
      .select("id,nombre,empresa,empresa_otro,dni,dni_last4,is_active")
      .eq("dni", dni);
    if (candidateIds?.length) {
      query = query.in("id", candidateIds);
    }
    return query.maybeSingle();
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
    } catch {
      /* ignore */
    }
    const target = ROUTES[role] || "/index.html";
    window.location.href = target;
  }

  /* ---------- ADMIN ---------- */
  if (adminForm) {
    adminForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ensureSupabase()) return;
      const passField = document.getElementById("admin-pass-field");
      const passInput = document.getElementById("admin-pass");
      const btn = document.getElementById("admin-login");
      const pass = passInput.value.trim();
      if (!pass) {
        markInvalid(passField, "Ingresa la clave");
        passInput.focus();
        return;
      }
      setButtonLoading(btn, true);
      try {
        const ok = await rpcAuth("ADMIN", pass);
        if (!ok) {
          markInvalid(passField, "Clave incorrecta");
          showMsg("Clave incorrecta o no registrada.");
          return;
        }
        sessionStorage.setItem(CUSTODIA_SESSION_KEY, "ADMIN");
        showMsg("Bienvenido, Admin");
        goHome("ADMIN");
      } catch (error) {
        console.error("[login] admin login error", error);
        showMsg("No se pudo validar. Intenta nuevamente.");
      } finally {
        setButtonLoading(btn, false);
      }
    });
  }

  /* ---------- CONSULTA ---------- */
  if (consultaForm) {
    consultaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ensureSupabase()) return;
      const passField = document.getElementById("consulta-pass-field");
      const passInput = document.getElementById("consulta-pass");
      const btn = document.getElementById("consulta-login");
      const pass = passInput.value.trim();
      if (!pass) {
        markInvalid(passField, "Ingresa la clave");
        passInput.focus();
        return;
      }
      setButtonLoading(btn, true);
      try {
        const ok = await rpcAuth("CONSULTA", pass);
        if (!ok) {
          markInvalid(passField, "Clave incorrecta");
          showMsg("Clave incorrecta o no registrada.");
          return;
        }
        sessionStorage.setItem(CUSTODIA_SESSION_KEY, "CONSULTA");
        showMsg("Bienvenido, Consulta");
        goHome("CONSULTA");
      } catch (error) {
        console.error("[login] consulta login error", error);
        showMsg("No se pudo validar. Intenta nuevamente.");
      } finally {
        setButtonLoading(btn, false);
      }
    });
  }

  /* ---------- CUSTODIA ---------- */
  if (custodiaForm) {
    custodiaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!ensureSupabase()) return;

      const pinField = document.getElementById("custodia-pin-field");
      const btn = document.getElementById("custodia-login");
      const pin = custodiaPinInput.value.trim();

      if (!/^[0-9]{4}$/.test(pin)) {
        markInvalid(pinField, "El PIN debe tener 4 dígitos");
        custodiaPinInput.focus();
        return;
      }

      const needsDni = state.custodiaNeedsDni;
      const dniValue = custodiaDniInput?.value?.trim();
      if (needsDni) {
        if (!/^[0-9]{8,}$/.test(dniValue || "")) {
          markInvalid(custodiaDniField, "Ingresa tu DNI completo");
          custodiaDniInput.focus();
          return;
        }
      }

      setButtonLoading(btn, true);
      setLoaderVisible(true, "Validando PIN de custodia...");

      try {
        if (needsDni) {
          await handleCustodiaDniFlow(dniValue);
        } else {
          await handleCustodiaPinFlow(pin);
        }
      } catch (error) {
        console.error("[login] custodia login error", error);
        showMsg("No se pudo validar tu acceso. Inténtalo nuevamente.");
      } finally {
        setButtonLoading(btn, false);
        setLoaderVisible(false);
      }
    });
  }

  async function handleCustodiaPinFlow(pin) {
    const { data, error } = await queryCustodiaLoginsByPin(pin);
    if (error) throw error;
    if (!data?.length) {
      markInvalid(document.getElementById("custodia-pin-field"), "PIN no registrado");
      showMsg("PIN no encontrado. Verifica tus datos o regístrate.");
      return;
    }

    if (data.length > 1) {
      state.custodiaPin = pin;
      requireCustodiaDni(data.map((row) => row.custodia_id));
      showMsg("Ingresa tu DNI completo para continuar.");
      return;
    }

    const custodiaId = data[0].custodia_id;
    await finalizeCustodiaLoginById(custodiaId);
  }

  async function handleCustodiaDniFlow(dni) {
    const { data, error } = await queryCustodiaByDni(
      dni,
      state.custodiaCandidates
    );
    if (error) throw error;
    if (!data) {
      markInvalid(custodiaDniField, "DNI no coincide con el PIN");
      showMsg("No encontramos una custodia con ese DNI y PIN.");
      return;
    }
    await finalizeCustodiaLogin(data);
  }

  async function finalizeCustodiaLoginById(custodiaId) {
    const { data, error } = await queryCustodiaProfileById(custodiaId);
    if (error) throw error;
    await finalizeCustodiaLogin(data);
  }

  async function finalizeCustodiaLogin(profileResponse) {
    if (!profileResponse) {
      showMsg("No se pudo cargar el perfil de custodia.");
      return;
    }
    if (profileResponse.is_active === false) {
      showMsg("Tu perfil está inactivo. Contacta a un administrador.");
      return;
    }

    const profile = {
      id: profileResponse.id,
      nombre: profileResponse.nombre,
      empresa: profileResponse.empresa,
      empresa_otro: profileResponse.empresa_otro,
      dni: profileResponse.dni,
      dni_last4: profileResponse.dni_last4,
      empresa_label:
        profileResponse.empresa ||
        profileResponse.empresa_otro ||
        "Sin empresa",
    };

    persistCustodiaProfile(profile);
    sessionStorage.setItem(CUSTODIA_SESSION_KEY, "CUSTODIA");
    localStorage.setItem("custodia_is_logged", "true");
    console.log("[login] custodia profile ready", {
      id: profile.id,
      nombre: profile.nombre,
      empresa: profile.empresa_label,
    });

    resetCustodiaDisambiguation();
    showMsg("Bienvenido, custodia");
    goHome("CUSTODIA");
  }
});
