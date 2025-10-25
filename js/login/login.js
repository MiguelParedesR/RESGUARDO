/* login.js – Lógica mínima para 3 accesos (ADMIN / CUSTODIA / CONSULTA)
   - Admin y Consulta: solo CLAVE (sin usuario), validación en Supabase (función auth_check_pass)
   - Custodia: clave dinámica DDMM+EMPRESA con zona America/Lima
*/
document.addEventListener('DOMContentLoaded', () => {
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
        try {
            if (snackbar && snackbar.MaterialSnackbar) snackbar.MaterialSnackbar.showSnackbar({ message });
            else alert(message);
        } catch { alert(message); }
    };

    // -------- Helpers fecha / clave dinámica --------
    function todayDM_Lima() {
        const now = new Date();
        const fmt = new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima', day: '2-digit', month: '2-digit' });
        const parts = fmt.formatToParts(now);
        const dd = parts.find(p => p.type === 'day').value;
        const mm = parts.find(p => p.type === 'month').value;
        return dd + mm; // "DDMM"
    }
    function expectedCustodiaKey(empresa) {
        return todayDM_Lima() + String(empresa || '').toUpperCase().replace(/\s+/g, '');
    }

    // -------- Validación Supabase --------
    async function supabaseValidate(role, pass) {
        try {
            if (!window.sb) { console.warn('Supabase no inicializado'); return false; }
            const { data, error } = await window.sb.rpc('auth_check_pass', { p_role: role.toUpperCase(), p_pass: pass });
            if (error) { console.error('Supabase:', error.message); return false; }
            return data === true;
        } catch (e) { console.error(e); return false; }
    }

    // -------- Redirecciones centralizadas con fallback --------
    function goHomeOrFallback(role) {
        if (window.guard && typeof window.guard.goHome === 'function') {
            window.guard.goHome();
            return;
        }
        // Fallback por si guard.js no está en login
        role = String(role || '').toUpperCase();
        if (role === 'ADMIN') location.href = '/html/dashboard/dashboard-admin.html';
        else if (role === 'CUSTODIA') location.href = '/html/dashboard/dashboard-custodia.html';
        else if (role === 'CONSULTA') location.href = '/html/dashboard/dashboard-consulta.html';
        else location.href = '/html/login/login.html';
    }

    // ================= ADMINISTRADOR (solo clave) =================
    const adminForm = document.getElementById('admin-form');
    if (adminForm) {
        adminForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('admin-pass').value;
            const ok = await supabaseValidate('ADMIN', pass);
            if (!ok) return showMsg('Clave incorrecta o no registrada');

            sessionStorage.setItem('auth_role', 'ADMIN');
            sessionStorage.setItem('auth_user', 'ADMIN');
            goHomeOrFallback('ADMIN');
        });
    }

    // ================= CUSTODIA (DDMM+EMPRESA) =================
    const custodiaForm = document.getElementById('custodia-form');
    if (custodiaForm) {
        custodiaForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const empresa = document.getElementById('empresa').value;
            const input = String(document.getElementById('custodia-pass').value).toUpperCase().replace(/\s+/g, '');
            const expected = expectedCustodiaKey(empresa);
            if (input !== expected) return showMsg('Clave dinámica incorrecta');

            sessionStorage.setItem('auth_role', 'CUSTODIA');
            sessionStorage.setItem('auth_empresa', empresa);
            goHomeOrFallback('CUSTODIA');
        });
    }

    // ================= CONSULTA (solo clave) =================
    const consultaForm = document.getElementById('consulta-form');
    if (consultaForm) {
        consultaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('consulta-pass').value;
            const ok = await supabaseValidate('CONSULTA', pass);
            if (!ok) return showMsg('Clave incorrecta o no registrada');

            sessionStorage.setItem('auth_role', 'CONSULTA');
            sessionStorage.setItem('auth_user', 'CONSULTA');
            goHomeOrFallback('CONSULTA');
        });
    }
});
// /js/guard.js