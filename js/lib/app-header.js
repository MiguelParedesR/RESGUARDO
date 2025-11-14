document.addEventListener("DOMContentLoaded", async () => {
  try {
    const host = document.getElementById("app-header");
    if (!host) return;
    const resp = await fetch("/html/partials/app-header.html", {
      credentials: "same-origin",
    });
    const html = await resp.text();
    host.innerHTML = html;
    const titleEl = document.getElementById("app-header-title");
    const explicit = host.getAttribute("data-page-title");
    let title = explicit || "";
    if (!title) {
      try {
        const role = sessionStorage.getItem("auth_role") || "";
        const emp = sessionStorage.getItem("auth_empresa") || "";
        const proper = (s) =>
          s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
        if (role.toUpperCase() === "CUSTODIA") {
          title = emp ? `Custodia - ${emp}` : "Custodia";
        } else if (role.toUpperCase() === "ADMIN") {
          title = "Admin";
        } else if (role.toUpperCase() === "CONSULTA") {
          title = "Consulta";
        } else {
          title = "Resguardo";
        }
      } catch {}
    }
    if (titleEl) titleEl.textContent = title;

    const navScope = host.getAttribute("data-nav");
    const nav = document.querySelector(".app-header-nav");
    setupNavigation(nav, navScope);

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

  function setupNavigation(nav, scope) {
    if (!nav) return;
    if (scope !== "admin") {
      nav.hidden = true;
      nav.setAttribute("aria-hidden", "true");
      return;
    }
    nav.hidden = false;
    nav.setAttribute("aria-hidden", "false");
    const links = nav.querySelectorAll("a[data-nav-key]");
    if (!links.length) return;
    const pathname = window.location.pathname.toLowerCase();
    const activeKey = resolveNavKey(pathname);
    links.forEach((link) => {
      const key = link.getAttribute("data-nav-key");
      const isActive = key === activeKey;
      link.classList.toggle("is-active", isActive);
      if (isActive) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function resolveNavKey(pathname) {
    if (pathname.includes("admin-clientes-rutas")) return "rutas";
    if (pathname.includes("admin-custodias")) return "custodias";
    if (pathname.includes("dashboard-admin")) return "servicios";
    return "";
  }
});
