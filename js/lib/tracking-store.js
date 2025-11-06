// tracking-store.js
// Sugerencia: capa de suscripciÃ³n a datos (Supabase realtime + fallback polling)
// para que dashboard-admin (autoridad) y la vista de resguardo compartan el mismo flujo.

(function () {
  function createServicioStore(sb, servicioId, { pollMs = 10000 } = {}) {
    let lastPing = null;
    let listeners = new Set();
    let stopped = false;

    async function fetchLast() {
      try {
        const { data, error } = await sb
          .from("ubicacion")
          .select("id,lat,lng,captured_at")
          .eq("servicio_id", servicioId)
          .order("captured_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!error && data) {
          lastPing = data;
          emit();
        }
      } catch {}
    }

    function emit() {
      for (const cb of Array.from(listeners)) {
        try {
          cb(lastPing);
        } catch {}
      }
    }

    // Realtime por tabla (Supabase v2) + filtro por servicio
    let channel = null;
    try {
      channel = sb
        .channel(`ubicacion-svc-${servicioId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "ubicacion",
            filter: `servicio_id=eq.${servicioId}`,
          },
          (payload) => {
            // Solo refrescamos si llega algo; no asumimos orden
            fetchLast();
          }
        )
        .subscribe();
    } catch {}

    // Fallback a polling, Ãºtil offline o sin Realtime
    const timer = setInterval(() => {
      if (!stopped) fetchLast();
    }, pollMs);
    fetchLast();

    return {
      subscribe(cb) {
        listeners.add(cb);
        if (lastPing) {
          try {
            cb(lastPing);
          } catch {}
        }
        return () => listeners.delete(cb);
      },
      stop() {
        try {
          stopped = true;
          if (channel) sb.removeChannel(channel);
        } catch {}
        clearInterval(timer);
        listeners.clear();
      },
      getLast() {
        return lastPing;
      },
    };
  }

  window.trackingStore = { createServicioStore };
})();
