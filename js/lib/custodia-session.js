(function (global) {
  const KEY = "custodia_session";
  const TTL_MS = 4 * 60 * 60 * 1000;

  function safeParse(raw) {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function load(opts) {
    const data = safeParse(global.localStorage.getItem(KEY));
    if (!data) return null;
    if (
      opts?.ignoreExpiry !== true &&
      data.exp_ts &&
      Date.now() > data.exp_ts
    ) {
      clear();
      return null;
    }
    return data;
  }

  function save(payload, opts) {
    if (!payload || !payload.servicio_id || !payload.servicio_custodio_id)
      return null;
    const ttl = typeof opts?.ttlMs === "number" ? opts.ttlMs : TTL_MS;
    const data = { ...payload, exp_ts: Date.now() + ttl };
    try {
      global.localStorage.setItem(KEY, JSON.stringify(data));
    } catch {}
    return data;
  }

  function touch(extraMs) {
    const current = load({ ignoreExpiry: true });
    if (!current) return null;
    const ttl = typeof extraMs === "number" ? extraMs : TTL_MS;
    current.exp_ts = Date.now() + ttl;
    try {
      global.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {}
    return current;
  }

  function clear() {
    try {
      global.localStorage.removeItem(KEY);
    } catch {}
  }

  function isNombreValido(nombre) {
    if (!nombre) return false;
    const tokens = nombre
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    return tokens.length >= 2;
  }

  global.CustodiaSession = {
    KEY,
    TTL_MS,
    load,
    save,
    touch,
    clear,
    isNombreValido,
  };
})(window);
