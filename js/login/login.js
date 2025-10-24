/* login.js – Lógica mínima para 3 accesos (ADMIN / CUSTODIA / CONSULTA)
   - Admin y Consulta: solo CLAVE (sin usuario), validación en Supabase (función auth_check_pass)
   - Custodia: clave dinámica DDMM+EMPRESA con zona America/Lima
*/

document.addEventListener('DOMContentLoaded', () => {
    // Snackbar helper (MDL) con fallback a alert
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
        try {
            if (snackbar && snackbar.MaterialSnackbar) {
                snackbar.MaterialSnackbar.showSnackbar({ message });
            } else {
                alert(message);
            }
        } catch {
            alert(message);
        }
    };

    // -------- Helpers de fecha y clave dinámica --------
    function todayDM_Lima() {
        const now = new Date();
        const fmt = new Intl.DateTimeFormat('es-PE', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit'
        });
        const parts = fmt.formatToParts(now);
        const dd = parts.find(p => p.type === 'day').value;
        const mm = parts.find(p => p.type === 'month').value;
        return dd + mm; // "DDMM"
    }

    function expectedCustodiaKey(empresa) {
        return todayDM_Lima() + String(empresa || '')
            .toUpperCase()
            .replace(/\s+/g, '');
    }

    // -------- Validación con Supabase --------
    async function supabaseValidate(role, pass) {
        try {
            if (!window.sb) {
                console.warn('Supabase no inicializado. Revisa config.js');
                return false;
            }
            const { data, error } = await window.sb.rpc('auth_check_pass', {
                p_role: role.toUpperCase(),
                p_pass: pass
            });
            if (error) {
                console.error('Error Supabase:', error.message);
                return false;
            }
            return data === true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    // ================= ADMINISTRADOR (solo clave) =================
    const adminForm = document.getElementById('admin-form');
    if (adminForm) {
        adminForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('admin-pass').value;

            const ok = await supabaseValidate('ADMIN', pass);
            if (!ok) {
                showMsg('Clave incorrecta o no registrada');
                return;
            }

            sessionStorage.setItem('auth_role', 'ADMIN');
            sessionStorage.setItem('auth_user', 'ADMIN');
            location.href = '/html/dashboard/dashboard-admin.html';
        });
    }

    // ================= CUSTODIA (DDMM+EMPRESA) =================
    const custodiaForm = document.getElementById('custodia-form');
    if (custodiaForm) {
        custodiaForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const empresa = document.getElementById('empresa').value;
            const input = String(document.getElementById('custodia-pass').value)
                .toUpperCase()
                .replace(/\s+/g, '');
            const expected = expectedCustodiaKey(empresa);

            if (input !== expected) {
                showMsg('Clave dinámica incorrecta');
                return;
            }

            sessionStorage.setItem('auth_role', 'CUSTODIA');
            sessionStorage.setItem('auth_empresa', empresa);
            location.href = '/html/dashboard/dasboard-custodia.html';
        });
    }

    // ================= CONSULTA CUSTODIA (solo clave) =================
    const consultaForm = document.getElementById('consulta-form');
    if (consultaForm) {
        consultaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('consulta-pass').value;

            const ok = await supabaseValidate('CONSULTA', pass);
            if (!ok) {
                showMsg('Clave incorrecta o no registrada');
                return;
            }

            sessionStorage.setItem('auth_role', 'CONSULTA');
            sessionStorage.setItem('auth_user', 'CONSULTA');
            location.href = '/html/dashboard/dashboard-consulta.html';
        });
    }
});
