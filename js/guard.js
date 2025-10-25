// /js/guard.js
(function () {
    const LOGIN_URL = "/html/login/login.html";

    function goLogin() {
        try { sessionStorage.clear(); } catch { }
        if (location.pathname !== LOGIN_URL) location.replace(LOGIN_URL);
    }

    function hasAnyRole(roles) {
        try {
            const role = sessionStorage.getItem("auth_role");
            if (!role) return false;
            if (!roles || !roles.length) return true;
            return roles.includes(role.toUpperCase());
        } catch { return false; }
    }

    const guard = {
        require(roles) {
            // 1) debe existir rol en sesión
            if (!hasAnyRole(roles)) return goLogin();

            // 2) reglas extra por página
            const path = location.pathname;

            // mapa-resguardo: exige servicio activo
            if (path.endsWith("/mapa-resguardo.html")) {
                const sid = sessionStorage.getItem("servicio_id_actual");
                if (!sid) return goLogin();
            }
        },
        // utilidad opcional para cerrar sesión
        logout() { goLogin(); }
    };

    window.guard = guard;
})();
