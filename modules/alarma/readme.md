# Módulo de Alarma

Módulo desacoplado (`modules/alarma/`) que provee UI y lógica compartida de alarmas, botón de pánico, check-ins y notificaciones push. Expone una API única (`window.Alarma`) reutilizable en las vistas de Custodia y Admin.

## API pública

```ts
Alarma.initCustodia(options?)
Alarma.initAdmin(options?)
Alarma.emit(tipo, payload)
Alarma.subscribe(handler)
Alarma.sirenaOn(options?)
Alarma.sirenaOff()
Alarma.tts(frase, options?)
Alarma.modalPanic(payload)
Alarma.registerPush(role, empresa?, metadata?)
Alarma.setLocation(lat, lng, extra?)
Alarma.reverseGeocode(lat, lng) -> Promise<string>
```

### Eventos generados en `subscribe`

- `highlight`: inicio de servicio (`type: start`).
- `panic`: botón de pánico presionado (`type: panic`).
- `panic-ack` / `panic-focus`: acciones desde el modal rojo.
- `emit`: resultado local de `Alarma.emit` (enviado/cola offline).
- `realtime`: inserciones recibidas vía Supabase Realtime.
- `sw-message`: mensajes reenviados por el Service Worker tras un `push`.
- `push-registered`: suscripción Web Push almacenada en Supabase.

## Integración en Custodia

1. Incluir `modules/alarma/alarma.css` y `modules/alarma/alarma.js` junto a `config.js`.
2. Llamar `Alarma.initCustodia()` durante `DOMContentLoaded`.
3. Registrar suscripciones push:
   ```js
   document.getElementById('btn-push-custodia')
     .addEventListener('click', () => {
       Alarma.registerPush('custodia', empresaActual, { origen: 'dashboard-custodia' });
     });
   ```
4. Al iniciar servicio (en el submit de `dashboard-custodia`):
   ```js
   await Alarma.emit('start', {
     servicio_id,
     empresa,
     cliente,
     placa,
     tipo,
     lat: userLat,
     lng: userLng,
     timestamp: new Date().toISOString()
   });
   ```
5. En el mapa (`mapa-resguardo`):
   - Actualizar la ubicación que usa el módulo con `Alarma.setLocation(lat, lng, { accuracy })` dentro del `watchPosition`.
   - Crear el botón fijo de pánico (`alarma-panic-btn`) que dispare `Alarma.emit('panic', payload)` tras confirmar doble toque.
   - Resolver dirección con `await Alarma.reverseGeocode(lat, lng)` antes de llamar a `emit`.

## Integración en Admin

1. Incluir `alarma.css` y `alarma.js` antes de `dashboard-admin.js`.
2. Ejecutar `Alarma.initAdmin()` al cargar la vista.
3. Registrar push:
   ```js
   btnPushAdmin.addEventListener('click', () => {
     Alarma.registerPush('admin', empresaSeleccionada, { origen: 'dashboard-admin' });
   });
   ```
4. Subscribirse a eventos para resaltar cards, centrar mapa y mostrar badges:
   ```js
   Alarma.subscribe((evt) => {
     if (evt.type === 'highlight') highlightCard(evt.record.servicio_id);
     if (evt.type === 'panic') showPanicBadge(evt.record.servicio_id);
     if (evt.type === 'panic-focus') focusOnService(evt.record.servicio_id);
   });
   ```
5. El módulo ya reproduce sirena, TTS y muestra el modal rojo con controles (Silenciar, Reconocer, Fijar foco). `Escape` también silencia.

## Push + Service Worker

1. Añadir `APP_CONFIG.WEB_PUSH_PUBLIC_KEY` (clave pública VAPID) en `config.js`.
2. Extender `service-worker.js`:
   - Manejar `push` → `registration.showNotification()` con `requireInteraction`, `vibrate` y `data`.
   - Manejar `notificationclick` para enfocar pestaña y enviar `clients.matchAll` + `client.postMessage({ channel: 'alarma', … })`.
   - Propagar `pushsubscriptionchange` para re-suscribir (opcional).
3. El front enviará los datos a Supabase con `Alarma.registerPush(...)`.

## Netlify Functions

Crear `/.netlify/functions`:

- `push-send.js`: envía Web Push a un conjunto filtrado de suscripciones (`push_subscription`). Parámetros esperados: `filter`, `subscriptionIds` o `endpoints`, y `payload`.
- `push-broadcast.js`: wrapper para enviar a roles/empresa (ej. `{ role: 'admin', empresa, type: 'panic' }`). Internamente llama a Supabase y usa `web-push`.
- `push-cron-checkin.js`: función programada cada 15 min (`netlify.toml` → `[functions."push-cron-checkin"] schedule = "*/15 * * * *"`). Consulta custodias activas con `last_checkin_at` desfasado y genera:
  1. Notificación Web Push `type: 'checkin-reminder'` (título `Confirma tu estado`, vibración `[200,80,200]`, `requireInteraction: true`).
  2. Inserción `alarm_event` con `type='checkin_reminder'`.

### Variables de entorno esperadas

```
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
WEB_PUSH_PUBLIC_KEY=...
WEB_PUSH_PRIVATE_KEY=...
WEB_PUSH_CONTACT=mailto:soporte@tpp.com
```

Las funciones usan `@supabase/supabase-js` y `web-push`, registrar dependencias en `package.json`:

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "web-push": "^3.5.0",
    "cross-fetch": "^4.0.0"
  }
}
```

## Supabase

Tablas sugeridas (`sql/alarma.sql` o migración):

```sql
create table public.alarm_event (
  id bigint generated always as identity primary key,
  type text not null check (char_length(type) <= 32),
  servicio_id bigint references public.servicio(id) on delete set null,
  empresa text,
  cliente text,
  placa text,
  rol_source text,
  lat numeric,
  lng numeric,
  direccion text,
  timestamp timestamptz default now(),
  meta jsonb,
  created_at timestamptz default now()
);

create table public.push_subscription (
  id bigint generated always as identity primary key,
  endpoint text unique not null,
  keys jsonb not null,
  role text not null,
  empresa text,
  metadata jsonb,
  user_agent text,
  platform text,
  timezone text,
  created_at timestamptz default now()
);
```

**RLS**:

```sql
alter table public.alarm_event enable row level security;
alter table public.push_subscription enable row level security;

create policy "custodia-create-own-alarms"
  on public.alarm_event for insert
  using (auth.role() = 'custodia')
  with check (auth.uid() = current_setting('request.jwt.claim.sub', true)::uuid);

create policy "admin-read-alarms"
  on public.alarm_event for select
  using (auth.role() = 'admin');

create policy "custodia-read-own-alarms"
  on public.alarm_event for select
  using (auth.role() = 'custodia' and servicio_id in (
    select sc.servicio_id from servicio_custodio sc where sc.custodio_uid = auth.uid()
  ));

create policy "push-insert-own"
  on public.push_subscription for insert
  with check (auth.role() in ('custodia','admin'));

create policy "push-select-by-role"
  on public.push_subscription for select
  using (auth.role() = 'admin' or (auth.role() = role and empresa = coalesce(current_setting('request.jwt.claim.empresa', true), empresa)));
```

Realtime:

- `alarm_event` (insert).
- `servicio` (insert/update).
- `ubicacion` (insert).

Registrar canales en Supabase Realtime y añadir al `dashboard-admin`.

## CSP (`_headers`)

Agregar:

```
connect-src ... https://<project>.supabase.co wss://<project>.supabase.co /.netlify/functions/*;
worker-src 'self';
```

Mantener las fuentes existentes (sin CDN nuevos).

## Pruebas sugeridas

- **Chrome/Android**: iniciar servicio → Admin recibe resaltado + sirena; botón de pánico → modal rojo, TTS, vibración; check-in vía voz.
- **iOS Safari**: botón de pánico → fallback manual para silenciar; check-in con texto (sin SpeechRecognition).
- **Cron 15 min**: simular `last_checkin_at` desfasado, confirmar recepción push y evento `checkin_reminder`.
- **Realtime < 1s**: insertar `panic` mediante SQL → Administrador recibe evento en tiempo real.
- **Sin red**: disparar `panic` offline → el evento queda en cola y se sincroniza al volver la conectividad (`Alarma.queueLength`).

---

> **Nota:** la UI generada por el módulo usa únicamente estilos locales (`alarma.css`). En caso de personalizar el tema, extender los tokens desde esta hoja para no afectar componentes existentes.
