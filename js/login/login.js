/* login.js – Accesos para ADMIN / CUSTODIA / CONSULTA
   -----------------------------------------------
   ADMIN y CONSULTA:
     - Solo clave (sin usuario)
     - Validación contra función Supabase: auth_check_pass(p_role, p_pass)
   CUSTODIA:
     - Clave dinámica = DDMM + EMPRESA
     - Zona horaria: America/Lima
   -----------------------------------------------
   Dependencias: config.js (window.sb), guard.js (opcional)
*/

document.addEventListener('DOMContentLoaded', () => {

    // ======= Crear loader global (overlay con spinner) =======
    const loader = document.createElement('div');
    loader.id = 'app-loader';
    loader.innerHTML = `
        <div class="loader-backdrop">
            <div class="loader-content">
                <div class="loader-spinner"></div>
                <p>Validando credenciales...</p>
            </div>
        </div>
    `;
    document.body.appendChild(loader);
    loader.style.display = 'none'; // oculto inicialmente

    const showLoader = (msg = 'Validando credenciales...') => {
        loader.querySelector('p').textContent = msg;
        loader.style.display = 'flex';
    };
    const hideLoader = () => {
        loader.style.display = 'none';
    };

    // ======= Snackbar helper (MDL) con fallback a alert() =======
    const snackbar = document.getElementById('app-snackbar');
    const showMsg = (message) => {
        try {
            if (snackbar?.MaterialSnackbar) snackbar.MaterialSnackbar.showSnackbar({ message });
            else alert(message);
        } catch { alert(message); }
    };

    // ======= Funciones helper de fecha / clave dinámica =======
    function todayDM_Lima() {
        const now = new Date();
        const fmt = new Intl.DateTimeFormat('es-PE', {
            timeZone: 'America/Lima',
            day: '2-digit',
            month: '2-digit'
        });
        const parts = fmt.formatToParts(now);
        const dd = parts.find(p => p.type === 'day')?.value || '00';
        const mm = parts.find(p => p.type === 'month')?.value || '00';
        return dd + mm; // "DDMM"
    }

    function expectedCustodiaKey(empresa) {
        return todayDM_Lima() + String(empresa || '').toUpperCase().replace(/\s+/g, '');
    }

    // ======= Validación en Supabase (auth_check_pass) =======
    async function supabaseValidate(role, pass) {
        try {
            if (!window.sb) {
                console.warn('[login.js] Supabase no inicializado. Revisa config.js');
                return false;
            }
            const { data, error } = await window.sb.rpc('auth_check_pass', {
                p_role: role.toUpperCase(),
                p_pass: pass
            });
            if (error) {
                console.error('[login.js] Supabase error:', error.message);
                return false;
            }
            return data === true;
        } catch (e) {
            console.error('[login.js] Validación falló:', e);
            return false;
        }
    }

    // ======= Redirección unificada post-login =======
    function goHomeOrFallback(role) {
        try {
            if (window.guard?.goHome) {
                window.guard.goHome();
                return;
            }
        } catch { /* fallback */ }

        role = String(role || '').toUpperCase();
        switch (role) {
            case 'ADMIN':
                location.href = '/html/dashboard/dashboard-admin.html';
                break;
            case 'CUSTODIA':
                location.href = '/html/dashboard/dashboard-custodia.html';
                break;
            case 'CONSULTA':
                location.href = '/html/dashboard/dashboard-consulta.html';
                break;
            default:
                location.href = '/html/login/login.html';
        }
    }

    // =========================================================
    // =================== LOGIN ADMINISTRADOR ==================
    // =========================================================
    const adminForm = document.getElementById('admin-form');
    if (adminForm) {
        adminForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('admin-pass').value.trim();
            if (!pass) return showMsg('Ingrese la clave de acceso');

            showLoader('Verificando acceso de administrador...');
            const ok = await supabaseValidate('ADMIN', pass);
            hideLoader();

            if (!ok) return showMsg('Clave incorrecta o no registrada');
            sessionStorage.setItem('auth_role', 'ADMIN');
            sessionStorage.setItem('auth_user', 'ADMIN');
            showLoader('Redirigiendo al panel...');
            setTimeout(() => goHomeOrFallback('ADMIN'), 800);
        });
    }

    // =========================================================
    // ====================== LOGIN CUSTODIA ====================
    // =========================================================
    const custodiaForm = document.getElementById('custodia-form');
    if (custodiaForm) {
        custodiaForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const empresa = document.getElementById('empresa').value.trim();
            const input = String(document.getElementById('custodia-pass').value)
                .toUpperCase()
                .replace(/\s+/g, '');
            const expected = expectedCustodiaKey(empresa);

            if (!empresa) return showMsg('Seleccione una empresa');
            showLoader('Validando clave dinámica...');
            setTimeout(() => {
                if (input !== expected) {
                    hideLoader();
                    return showMsg('Clave dinámica incorrecta');
                }

                sessionStorage.setItem('auth_role', 'CUSTODIA');
                sessionStorage.setItem('auth_empresa', empresa);
                showLoader('Redirigiendo al panel...');
                setTimeout(() => goHomeOrFallback('CUSTODIA'), 800);
            }, 600);
        });
    }

    // =========================================================
    // ====================== LOGIN CONSULTA ====================
    // =========================================================
    const consultaForm = document.getElementById('consulta-form');
    if (consultaForm) {
        consultaForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const pass = document.getElementById('consulta-pass').value.trim();
            if (!pass) return showMsg('Ingrese la clave de acceso');

            showLoader('Verificando acceso de consulta...');
            const ok = await supabaseValidate('CONSULTA', pass);
            hideLoader();

            if (!ok) return showMsg('Clave incorrecta o no registrada');
            sessionStorage.setItem('auth_role', 'CONSULTA');
            sessionStorage.setItem('auth_user', 'CONSULTA');
            showLoader('Redirigiendo al panel...');
            setTimeout(() => goHomeOrFallback('CONSULTA'), 800);
        });
    }

    // ======= Estilos inline para el loader =======
    const style = document.createElement('style');
    style.textContent = `
        #app-loader {
            position: fixed;
            inset: 0;
            background: rgba(255, 255, 255, 0.85);
            display: none;
            align-items: center;
            justify-content: center;
            z-index: 9999;
            backdrop-filter: blur(4px);
        }
        .loader-content {
            text-align: center;
            color: #37474f;
            font-family: "Roboto", system-ui, sans-serif;
        }
        .loader-spinner {
            width: 48px;
            height: 48px;
            border: 4px solid #ccc;
            border-top: 4px solid #2196f3;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 12px;
        }
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        #app-loader p {
            font-size: 15px;
            margin: 0;
            color: #37474f;
        }
    `;
    document.head.appendChild(style);
});
