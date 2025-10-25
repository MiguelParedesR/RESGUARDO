window.APP_CONFIG = {
    SUPABASE_URL: 'https://yfofejsjuygpsaxjaqju.supabase.co',
    SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlmb2ZlanNqdXlncHNheGphcWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyODIyODUsImV4cCI6MjA3Njg1ODI4NX0.HAYDqIdUhZ0wqyWbHpbTvk0LzJngRKfyu6ckpzXzCCk'
};

(function () {
    if (!window.supabase || !window.supabase.createClient) {
        console.warn('[config] Supabase JS no está cargado. Agrega el script CDN antes de config.js');
        return;
    }
    window.sb = window.supabase.createClient(
        window.APP_CONFIG.SUPABASE_URL,
        window.APP_CONFIG.SUPABASE_ANON_KEY
    );
    console.log('[config] Cliente Supabase inicializado correctamente');
})();

(async () => {
    if (!window.sb) {
        console.warn('[config] Saltando prueba de conexi\u00f3n: cliente Supabase no inicializado');
        return;
    }
    try {
        const { data, error } = await window.sb.from('usuario').select('role').limit(1);
        if (error) throw error;
        console.log('[Supabase conectado]', data);
    } catch (err) {
        console.error('[Supabase error]', err.message);
    }
})();
window.APP_CONFIG.LOCATIONIQ_KEY = 'pk.445311e00b01a56c43097037fcf1e932';
