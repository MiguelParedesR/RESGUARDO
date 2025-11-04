import { handler as sendHandler } from './push-send.js';

const json = (statusCode, payload) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload)
});

export async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method Not Allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return json(400, { error: 'Invalid JSON body' });
  }

  const { role, empresa, type, payload, event: eventData, options } = body;
  if (!role && !empresa) {
    return json(400, { error: 'Debe indicar role y/o empresa' });
  }
  if (!type) {
    return json(400, { error: 'Debe indicar type' });
  }

  const filter = {};
  if (role) filter.role = role;
  if (empresa) filter.empresa = empresa;

  const mergedPayload = {
    title: payload?.title,
    body: payload?.body,
    data: {
      ...(payload?.data || {}),
      event: eventData || null
    },
    icon: payload?.icon,
    badge: payload?.badge,
    tag: payload?.tag,
    vibrate: payload?.vibrate,
    requireInteraction: payload?.requireInteraction,
    renotify: payload?.renotify,
    url: payload?.url,
    actions: payload?.actions
  };

  const response = await sendHandler({
    httpMethod: 'POST',
    body: JSON.stringify({
      filter,
      type,
      payload: mergedPayload,
      options
    })
  });

  return response;
}
