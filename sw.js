/* sw.js — v5.1.0. Стратегия: HTML — сеть с запасом из кэша (офлайн-оболочка); статика — stale-while-revalidate.
   Запросы к Supabase / Edge Functions / чужим доменам НЕ кэшируются (авторизация и данные всегда живые). */
const VER = 'amoore-v5.1.0';
const SHELL = ['./', 'manifest.json'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VER).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VER).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then((res) => { const cp = res.clone(); caches.open(VER).then((c) => c.put(r, cp)); return res; })
      .catch(() => caches.match(r).then((m) => m || caches.match('./'))));
    return;
  }
  e.respondWith(caches.open(VER).then((c) => c.match(r).then((hit) => {
    const net = fetch(r).then((res) => { if (res.ok) c.put(r, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  })));
});

// ---- Web Push (v5.1): уведомление о новости. Тело приходит от Edge Function push-news как JSON {title, body, url, tag}.
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'amoore').slice(0, 120), {
    body: String(d.body || '').slice(0, 300),
    icon: 'android-chrome-192x192.png',
    badge: 'favicon-32x32.png',
    tag: d.tag || 'amoore-news',
    data: { url: typeof d.url === 'string' ? d.url : './#news' }
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let target; try { target = new URL((e.notification.data && e.notification.data.url) || './#news', self.registration.scope); } catch (_) { target = new URL('./#news', self.registration.scope); }
  if (target.origin !== location.origin) target = new URL('./#news', self.registration.scope);   // только свой домен
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.split('#')[0] === target.href.split('#')[0] && 'focus' in c) { c.navigate(target.href).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(target.href);
  }));
});
