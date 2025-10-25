// /js/guard.js
// Protección centralizada de rutas + helpers de navegación y logout.

(() => {
    const LOGIN_URL = "/html/login/login.html";

    // Mapa: path -> roles requeridos (uppercase)
    // Puedes ajustar rutas si cambia tu estructura.
    const ROLE_BY_PATH = [
        { test: /\/html\/dashboard\/dashboard-admin\.html$/i, roles: ["ADMIN"] },
        { test: /\/html\/dashboard\/dashboard-custodia\.html$/i, roles: ["CUSTODIA"] },
        { test: /\/html\/dashboard\/mapa-resguardo\.html$/i, roles: ["CUSTODIA"], needsServicio: true },
        { test: /\/html\/dashboard\/dashboard-consulta\.html$/i, roles: ["CONSULTA"] },
    ];

    function pathForRole(role) {
        role = String(role || "").toUpperCase();
        if (role === "ADMIN") return "/html/dashboard/dashboard-admin.html";
        if (role === "CUSTODIA") return "/html/dashboard/dashboard-custodia.html";
        if (role === "CONSULTA") return "/html/dashboard/dashboard-consulta.html";
        return LOGIN_URL;
    }

    function goLogin() {
        try { sessionStorage.clear(); } catch { }
        if (location.pathname !== LOGIN_URL) location.replace(LOGIN_URL);
    }

    function hasRole(requiredRoles) {
        try {
            const r = (sessionStorage.getItem("auth_role") || "").toUpperCase();
            if (!r) return false;
            if (!requiredRoles || !requiredRoles.length) return true;
            return requiredRoles.includes(r);
        } catch { return false; }
    }

    function checkGuard() {
        const path = location.pathname;

        // Páginas no protegidas (login, index, 404) no hacen nada
        if (/\/html\/login\/login\.html$/i.test(path)) return;

        // Busca regla que aplique al path
        const rule = ROLE_BY_PATH.find(r => r.test.test(path));
        if (!rule) {
            // Si no hay regla, tratamos como pública (no bloqueamos).
            return;
        }

        // 1) Verificar rol
        if (!hasRole(rule.roles)) return goLogin();

        // 2) Reglas extra: mapa-resguardo exige servicio activo en sesión
        if (rule.needsServicio) {
            const sid = sessionStorage.getItem("servicio_id_actual");
            if (!sid) return goLogin();
        }
    }

    // Exponer helpers globales
    window.guard = {
        // Llama a esto si quieres forzar verificación manual (normalmente no hace falta)
        require: checkGuard,

        // Devuelve la ruta de inicio para un rol
        pathForRole,

        // Redirige a la home del rol actual (si no hay rol, al login)
        goHome() {
            const role = (sessionStorage.getItem("auth_role") || "").toUpperCase();
            location.href = pathForRole(role);
        },

        // Cierra sesión y va a login
        logout() { goLogin(); }
    };

    // Auto-guard al cargar
    document.addEventListener("DOMContentLoaded", checkGuard);
})();
// /service-worker.js