window.APP_CONFIG = {
  SUPABASE_URL: "https://yfofejsjuygpsaxjaqju.supabase.co",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlmb2ZlanNqdXlncHNheGphcWp1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjEyODIyODUsImV4cCI6MjA3Njg1ODI4NX0.HAYDqIdUhZ0wqyWbHpbTvk0LzJngRKfyu6ckpzXzCCk",
};

(function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.warn(
      "[config] Supabase JS no está cargado. Agrega el script CDN antes de config.js"
    );
    return;
  }
  window.sb = window.supabase.createClient(
    window.APP_CONFIG.SUPABASE_URL,
    window.APP_CONFIG.SUPABASE_ANON_KEY
  );
  console.log("[config] Cliente Supabase inicializado correctamente");

  // Salud del websocket de Realtime (CSP/firewall pueden bloquearlo)
  window.APP_CONFIG.REALTIME_OK = typeof WebSocket !== "undefined";
  window.APP_CONFIG.REALTIME_ERROR = null;

  function disableRealtime(reason, err) {
    if (window.APP_CONFIG.REALTIME_OK === false) return;
    window.APP_CONFIG.REALTIME_OK = false;
    window.APP_CONFIG.REALTIME_ERROR =
      reason || err?.message || err || "unknown";
    try {
      window.sb?.removeAllChannels?.();
    } catch {}
    try {
      window.sb?.realtime?.disconnect?.();
    } catch {}
    try {
      window.dispatchEvent(
        new CustomEvent("realtime:down", {
          detail: { reason, error: err?.message || err || null },
        })
      );
    } catch {}
    console.warn("[config][realtime] deshabilitado", {
      reason,
      error: err?.message || err,
    });
  }

  window.APP_CONFIG.canUseRealtime = () =>
    window.APP_CONFIG.REALTIME_OK !== false && Boolean(window.sb?.channel);

  const rt = window.sb?.realtime;
  if (rt?.onOpen) {
    rt.onOpen(() => {
      window.APP_CONFIG.REALTIME_OK = true;
      window.APP_CONFIG.REALTIME_ERROR = null;
    });
  }
  if (rt?.onError) {
    rt.onError((err) => disableRealtime("socket_error", err));
  }
  if (rt?.onClose) {
    rt.onClose((evt) => disableRealtime("closed", evt));
  }
})();

(async () => {
  if (!window.sb) {
    console.warn(
      "[config] Saltando prueba de conexi\u00f3n: cliente Supabase no inicializado"
    );
    return;
  }
  try {
    const { data, error } = await window.sb
      .from("usuario")
      .select("role")
      .limit(1);
    if (error) throw error;
    console.log("[Supabase conectado]", data);
  } catch (err) {
    console.error("[Supabase error]", err.message);
  }
})();
window.APP_CONFIG.LOCATIONIQ_KEY = "pk.445311e00b01a56c43097037fcf1e932";
window.APP_CONFIG.WEB_PUSH_PUBLIC_KEY = "";
window.APP_CONFIG.WEB_PUSH_PUBLIC_KEY = "BJW0TStupsZ-S30-N0pX-qdR4s2ad4sKXfSJU1EPFvXqk70fMOvhSTwBv2_xmw5IIj-rC9eMwuzxBSTeS3uKLFE";
