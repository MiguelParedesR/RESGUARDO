document.addEventListener('DOMContentLoaded', async () => {
  try {
    const host = document.getElementById('app-header');
    if (!host) return;
    const resp = await fetch('/html/partials/app-header.html', { credentials: 'same-origin' });
    const html = await resp.text();
    host.innerHTML = html;
    // Title resolution
    const titleEl = document.getElementById('app-header-title');
    const explicit = host.getAttribute('data-page-title');
    let title = explicit || '';
    if (!title) {
      try {
        const role = sessionStorage.getItem('auth_role') || '';
        const emp = sessionStorage.getItem('auth_empresa') || '';
        const proper = (s) => s ? (s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()) : s;
        if (role.toUpperCase() === 'CUSTODIA') {
          title = emp ? `Custodia - ${emp}` : 'Custodia';
        } else if (role.toUpperCase() === 'ADMIN') {
          title = 'Admin';
        } else if (role.toUpperCase() === 'CONSULTA') {
          title = 'Consulta';
        } else {
          title = 'Resguardo';
        }
      } catch {}
    }
    if (titleEl) titleEl.textContent = title;

    // Actions
    const btnHome = document.getElementById('app-header-home');
    const btnLogout = document.getElementById('app-header-logout');
    btnHome?.setAttribute('href', '/index.html');
    btnLogout?.addEventListener('click', (e) => {
      e.preventDefault();
      try { if (window.guard?.logout) { window.guard.logout(); return; } } catch {}
      window.location.href = '/html/login/login.html';
    });
  } catch (e) {
    console.warn('[app-header] not loaded', e);
  }
});


