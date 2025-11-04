import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  WEB_PUSH_PUBLIC_KEY,
  WEB_PUSH_PRIVATE_KEY,
  WEB_PUSH_CONTACT
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn('[push-send] Faltan variables de Supabase');
}

if (WEB_PUSH_PUBLIC_KEY && WEB_PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(
    WEB_PUSH_CONTACT || 'mailto:soporte@tpp.com',
    WEB_PUSH_PUBLIC_KEY,
    WEB_PUSH_PRIVATE_KEY
  );
} else {
  console.warn('[push-send] VAPID keys no configuradas. No se podrán enviar notificaciones.');
}

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null;

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  if (!WEB_PUSH_PUBLIC_KEY || !WEB_PUSH_PRIVATE_KEY) {
    return json(500, { error: 'WEB_PUSH keys not configured' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { filter, subscriptionIds, endpoints, payload, type, options } = body;

  if (!supabase) {
    return json(500, { error: 'Supabase client not configured' });
  }

  let query = supabase.from('push_subscription').select('*');

  if (Array.isArray(subscriptionIds) && subscriptionIds.length) {
    query = query.in('id', subscriptionIds);
  } else if (Array.isArray(endpoints) && endpoints.length) {
    query = query.in('endpoint', endpoints);
  } else if (filter && typeof filter === 'object') {
    if (filter.role) query = query.eq('role', filter.role);
    if (filter.empresa) query = query.eq('empresa', filter.empresa);
  } else {
    return json(400, { error: 'Debe indicar filter, subscriptionIds o endpoints' });
  }

  const { data: subs, error: queryError } = await query;
  if (queryError) {
    return json(500, { error: queryError.message });
  }

  if (!subs || !subs.length) {
    return json(200, { delivered: 0, failures: 0, removed: 0 });
  }

  const pushPayload = buildPushPayload(type, payload);
  const sendOptions = buildSendOptions(options);

  const serialised = subs.map(toPushSubscription);

  const results = await Promise.allSettled(
    serialised.map((sub) => webpush.sendNotification(sub, JSON.stringify(pushPayload), sendOptions))
  );

  let failures = 0;
  let removed = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === 'rejected') {
      failures += 1;
      const res = result.reason?.statusCode || result.reason?.status;
      if (res === 404 || res === 410) {
        removed += 1;
        await supabase.from('push_subscription').delete().eq('endpoint', subs[i].endpoint);
      }
      console.warn('[push-send] fallo al enviar', res, result.reason?.body);
    }
  }

  return json(200, {
    delivered: subs.length - failures,
    failures,
    removed
  });
}

function buildPushPayload(type, payload = {}) {
  const title = payload.title || defaultTitle(type);
  const body = payload.body || defaultBody(type);
  const data = {
    ...payload.data,
    type,
    url: payload.url || '/html/dashboard/dashboard-admin.html'
  };
  return {
    title,
    body,
    icon: payload.icon || '/assets/icon-192.svg',
    badge: payload.badge || '/assets/icon-192.svg',
    requireInteraction: payload.requireInteraction ?? true,
    renotify: payload.renotify ?? true,
    vibrate: payload.vibrate || [220, 120, 220],
    tag: payload.tag || `alarma-${type || 'alerta'}`,
    data,
    actions: payload.actions || defaultActions(type)
  };
}

function buildSendOptions(options = {}) {
  const base = {};
  if (options.ttl) base.TTL = options.ttl;
  if (options.urgency) base.urgency = options.urgency;
  return base;
}

function defaultTitle(type) {
  if (type === 'panic') return 'Alerta de pánico';
  if (type === 'start') return 'Inicio de servicio';
  if (type === 'checkin_reminder') return 'Confirma tu estado';
  return 'Notificación de resguardo';
}

function defaultBody(type) {
  if (type === 'panic') return 'Se detectó botón de pánico. Abre el panel para atender.';
  if (type === 'start') return 'Nuevo servicio en curso.';
  if (type === 'checkin_reminder') return 'Han pasado 15 minutos sin check-in.';
  return 'Tienes una nueva alerta.';
}

function defaultActions(type) {
  const base = [{ action: 'open', title: 'Abrir' }];
  if (type === 'panic') {
    base.push({ action: 'silence', title: 'Silenciar' });
  }
  return base;
}

function toPushSubscription(row) {
  let keys = row.keys;
  if (typeof keys === 'string') {
    try { keys = JSON.parse(keys); } catch (err) { keys = {}; }
  }
  return {
    endpoint: row.endpoint,
    keys
  };
}
