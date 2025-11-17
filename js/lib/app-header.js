document.addEventListener("DOMContentLoaded", async () => {
  try {
    const host = document.getElementById("app-header");
    if (!host) return;

    // CARGA DEL TEMPLATE
    const resp = await fetch("/html/partials/app-header.html", {
      credentials: "same-origin",
    });
    const html = await resp.text();
    host.innerHTML = html;

    // TITULO
    const titleEl = document.getElementById("app-header-title");
    const explicit = host.getAttribute("data-page-title");

    let title = explicit || "";

    if (!title) {
      const role = (sessionStorage.getItem("auth_role") || "").toUpperCase();
      const emp = sessionStorage.getItem("auth_empresa") || "";

      if (role === "ADMIN") title = "Admin";
      else if (role === "CONSULTA") title = "Consulta";
      else if (role === "CUSTODIA")
        title = emp ? `Custodia - ${emp}` : "Custodia";
      else title = "Resguardo";
    }

    if (titleEl) titleEl.textContent = title;

    // NAV DINÁMICO
    const nav = host.querySelector(".app-header-nav");
    const navScope = host.getAttribute("data-nav");

    setupNavigation(nav, navScope);

    // BOTONES HOME / LOGOUT
    const btnHome = document.getElementById("app-header-home");
    const btnLogout = document.getElementById("app-header-logout");

    btnHome?.setAttribute("href", "/html/index.html");

    btnLogout?.addEventListener("click", (e) => {
      e.preventDefault();

      try {
        if (window.guard?.logout) {
          window.guard.logout();
          return;
        }
      } catch {}

      window.location.href = "/html/login/login.html";
    });
  } catch (e) {
    console.warn("[app-header] not loaded", e);
  }

  /* =========================================================
     NAV ONLY FOR ADMIN
     ========================================================= */
  function setupNavigation(nav, scope) {
    if (!nav) return;

    // Si NO es admin -> ocultar todo el menú
    if (scope !== "admin") {
      nav.hidden = true;
      nav.setAttribute("aria-hidden", "true");
      return;
    }

    // Admin → mostrar navegación
    nav.hidden = false;
    nav.setAttribute("aria-hidden", "false");

    const links = nav.querySelectorAll("a[data-nav-key]");
    const path = window.location.pathname.toLowerCase();
    const activeKey = resolveNavKey(path);

    links.forEach((link) => {
      const key = link.getAttribute("data-nav-key");
      const isActive = key === activeKey;

      link.classList.toggle("is-active", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
    });
  }

  function resolveNavKey(pathname) {
    if (pathname.includes("dashboard-admin")) return "servicios";
    if (pathname.includes("admin-clientes-rutas")) return "rutas";
    if (pathname.includes("admin-custodias")) return "custodias";
    return "";
  }
});
