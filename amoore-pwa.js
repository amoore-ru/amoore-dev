/**
 * amoore-pwa.js — v5.3.0 · PWA: manifest, iOS meta, Service Worker, Телеграм Mini App, Web Push.
 * Побайтно одинаков во всех трёх сайтах. Подключение: <script src="amoore-pwa.js" defer></script>
 */
(function () {
  'use strict';
  if (window.__amoorePwa) return; window.__amoorePwa = true;
  var h = document.head;
  function meta(n, c) { if (!h.querySelector('meta[name="' + n + '"]')) { var m = document.createElement('meta'); m.name = n; m.content = c; h.appendChild(m); } }
  // «чёлка» и полоса жестов iPhone: страница рисуется под системными панелями (отступы — через env(safe-area-inset-*))
  var vp = h.querySelector('meta[name="viewport"]');
  if (vp && !/viewport-fit/.test(vp.content)) vp.content += ', viewport-fit=cover';
  if (!h.querySelector('link[rel="manifest"]')) { var l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.json'; h.appendChild(l); }
  meta('theme-color', '#070b16'); meta('mobile-web-app-capable', 'yes'); meta('apple-mobile-web-app-capable', 'yes');
  meta('apple-mobile-web-app-status-bar-style', 'black-translucent'); meta('apple-mobile-web-app-title', 'amoore');
  if (!h.querySelector('link[rel="apple-touch-icon"]')) { var a = document.createElement('link'); a.rel = 'apple-touch-icon'; a.href = 'android-chrome-192x192.png'; h.appendChild(a); }
  if (!document.getElementById('amoore-safe-css')) {
    var st = document.createElement('style'); st.id = 'amoore-safe-css';
    st.textContent = '@media (display-mode:standalone){body{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}}';
    h.appendChild(st);
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
  // Телеграм Mini App: раскрываем на весь экран и красим шапку
  var tg = window.Telegram && window.Telegram.WebApp;
  if (tg) { try { tg.ready(); tg.expand(); tg.setHeaderColor('#070b16'); tg.setBackgroundColor('#070b16'); document.documentElement.classList.add('in-telegram'); } catch (e) {} }

  // ---- Web Push API (v5.1). Публичный VAPID-ключ: window.AMOORE_VAPID_PUBLIC_KEY или <meta name="amoore-vapid-public-key">.
  function vapid() { return window.AMOORE_VAPID_PUBLIC_KEY || ((document.querySelector('meta[name="amoore-vapid-public-key"]') || {}).content || '').trim(); }
  function keyBytes(s) {
    var p = '='.repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), o = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o;
  }
  function reg() { return navigator.serviceWorker.getRegistration().then(function (r) { return r || navigator.serviceWorker.register('sw.js'); }).then(function (r) { return navigator.serviceWorker.ready.then(function () { return r; }); }); }
  window.amoorePush = {
    supported: function () { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:'; },
    configured: function () { return !!vapid(); },
    permission: function () { return 'Notification' in window ? Notification.permission : 'denied'; },
    isSubscribed: function () { if (!this.supported()) return Promise.resolve(false); return reg().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) { return !!s; }).catch(function () { return false; }); },
    // sb — клиент Supabase (amooreID.sb). Подписка сохраняется в push_subscriptions (RLS: только своя).
    enable: function (sb) {
      var self = this;
      if (!self.supported()) return Promise.reject(new Error('Этот браузер не поддерживает push (на iPhone: добавьте сайт на экран «Домой»)'));
      if (!self.configured()) return Promise.reject(new Error('Push ещё не настроен администратором (нет VAPID-ключа)'));
      return Notification.requestPermission().then(function (perm) {
        if (perm !== 'granted') throw new Error('Уведомления запрещены в настройках браузера');
        return reg();
      }).then(function (r) {
        return r.pushManager.getSubscription().then(function (s) { return s || r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid()) }); });
      }).then(function (sub) {
        var j = sub.toJSON(), k = j.keys || {};
        return sb.from('push_subscriptions').delete().eq('endpoint', j.endpoint).then(function () {
          return sb.from('push_subscriptions').insert({ endpoint: j.endpoint, p256dh: k.p256dh, auth: k.auth, user_agent: navigator.userAgent.slice(0, 300) });
        });
      }).then(function (r) { if (r && r.error) throw new Error(r.error.message); return true; });
    },
    disable: function (sb) {
      return reg().then(function (r) { return r.pushManager.getSubscription(); }).then(function (s) {
        if (!s) return true; var ep = s.endpoint;
        return s.unsubscribe().then(function () { return sb.from('push_subscriptions').delete().eq('endpoint', ep); }).then(function () { return true; });
      });
    }
  };
})();
