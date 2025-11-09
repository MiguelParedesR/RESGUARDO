(function (global) {
  const KEY = "custodia_session";
  const FOUR_HOURS = 4 * 60 * 60 * 1000;

  function load(options = {}) {
    try {
      const raw = global.localStorage.getItem(KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (
        !options.ignoreExpiry &&
        data?.exp_ts &&
        typeof data.exp_ts === "number" &&
        data.exp_ts < Date.now()
      ) {
        clear();
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  function save(payload, options = {}) {
    if (!payload || !payload.servicio_id || !payload.servicio_custodio_id) {
      return null;
    }
    const ttl = typeof options.ttlMs === "number" ? options.ttlMs : FOUR_HOURS;
    const data = {
      ...payload,
      exp_ts: Date.now() + ttl,
    };
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
    return data;
  }

  function clear() {
    try {
      global.localStorage.removeItem(KEY);
    } catch {}
  }

  function touch(extraMs) {
    const current = load({ ignoreExpiry: true });
    if (!current) return null;
    const ttl = typeof extraMs === "number" ? extraMs : FOUR_HOURS;
    current.exp_ts = Date.now() + ttl;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {}
    return current;
  }

  function isNombreValido(nombre) {
    if (!nombre) return false;
    const tokens = nombre
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return tokens.length >= 2;
  }

  global.custodiaSession = {
    load,
    save,
    clear,
    touch,
    isNombreValido,
    TTL_MS: FOUR_HOURS,
    KEY,
  };
})(window);
