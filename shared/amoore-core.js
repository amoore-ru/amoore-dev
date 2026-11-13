/**
 * amoore-core.js — v5.1.0 «BUGFIX»
 * Единая версия экосистемы: window.AMOORE_VERSION (см. константу ниже). Файл ОБЯЗАН быть
 * побайтно одинаковым в amoore-ru, amoore-studio и amoore-dev/shared (проверяет run_qa.sh).
 *
 * Подключение:
 *   <script>window.AMOORE_SITE_ID = 'landing';</script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="amoore-core.js"></script>
 *
 * window.AMOORE_STATE — единый state (config, news, god)
 * window.AMOORE_CONFIG — alias на state.config
 * window.amooreCore — API (refresh, isChatEnabled, ...)
 */
(function () {
  'use strict';
  if (window.__amooreCoreLoaded) return;
  window.__amooreCoreLoaded = true;

  // Глобальная версия экосистемы: админка, лендинг и студия сверяются по ней.
  // Версия из кода — ФОЛЛБЭК. Живая версия тянется из БД (global_settings.changelog, последняя запись):
  // так версиями управляют из админки, не трогая код. База недоступна → остаётся v4.0.0.
  var AMOORE_VERSION = '5.1.0';
  window.AMOORE_VERSION = AMOORE_VERSION;
  var DEV_URL = 'https://amoore-dev.pages.dev/';
  var STUDIO_URL = 'https://amoore-studio.pages.dev/';

  var SITE_ID = window.AMOORE_SITE_ID || 'landing';
  (function networkNotice() {
    function update() {
      var n = document.getElementById('amoore-network-notice');
      if (!n) { n = document.createElement('div'); n.id = 'amoore-network-notice'; n.setAttribute('role', 'status'); n.setAttribute('aria-live', 'polite'); n.textContent = 'Нет связи с сервером. Проверьте интернет'; document.body.appendChild(n); }
      n.hidden = navigator.onLine;
    }
    window.addEventListener('online', update); window.addEventListener('offline', update);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', update); else update();
  })();
  var SB_URL  = window.AMOORE_SUPABASE_URL  || 'https://wogouiecoigzmxqccnsk.supabase.co';
  var SB_ANON = window.AMOORE_SUPABASE_ANON || 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';

  var GOD_KEY  = 'amoore_god';        // токен God Mode (этот домен)
  var AUTH_KEY = 'amoore_dev_auth';   // сессия админки (если админка на этом же домене)
  var VISIT_KEY = 'amoore_visit_' + SITE_ID;
  var TTL_MS = 6 * 60 * 60 * 1000;    // 6 часов
  var POLL_MS = 20 * 1000;

  var client = null;
  var cfg = null;          // строка ecosystem_sites для этого сайта
  var godToken = null;     // проверенный токен или null
  var godChecked = false;
  var newsCache = [];
  var botOnline = null; // null = unknown; only explicit false pauses the demo chat

  // Глобальный state экосистемы
  window.AMOORE_STATE = {
    siteId: SITE_ID,
    config: null,
    news: [],
    god: false,
    version: AMOORE_VERSION
  };
  function publishState() {
    window.AMOORE_STATE.config = cfg ? Object.assign({}, cfg) : null;
    window.AMOORE_STATE.news = newsCache.slice();
    window.AMOORE_STATE.god = !!godToken;
    window.AMOORE_CONFIG = cfg;
    try {
      window.dispatchEvent(new CustomEvent('amoore:state', { detail: window.AMOORE_STATE }));
      window.dispatchEvent(new CustomEvent('amoore:config', { detail: cfg }));
    } catch (e) {}
  }

  // ------------------------------------------------------------------ utils
  function ls(op, key, val) {
    try {
      if (op === 'get') return localStorage.getItem(key) || sessionStorage.getItem(key);
      if (op === 'set') { localStorage.setItem(key, val); try { sessionStorage.setItem(key, val); } catch (e) {} }
      if (op === 'del') { localStorage.removeItem(key); try { sessionStorage.removeItem(key); } catch (e) {} }
    } catch (e) {}
    return null;
  }
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }
  function styleOnce(id, css) {
    if (document.getElementById(id)) return;
    var s = document.createElement('style');
    s.id = id; s.setAttribute('data-amoore-core', '1');
    s.textContent = css;
    document.head.appendChild(s);
  }
  // Любой сетевой вызов обёрнут таймаутом: «зависший» запрос не должен блокировать страницу.
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; reject(new Error('timeout')); } }, ms);
      Promise.resolve(promise).then(
        function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
        function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } }
      );
    });
  }
  // Первый УСПЕШНЫЙ результат из списка промисов (аналог Promise.any, работает в старом Safari).
  function firstOk(list) {
    return new Promise(function (resolve, reject) {
      var left = list.length, lastErr = null;
      list.forEach(function (p) {
        Promise.resolve(p).then(resolve, function (e) { lastErr = e; if (--left === 0) reject(lastErr); });
      });
    });
  }
  // Заголовки REST. Новые ключи Supabase (sb_publishable_…) — НЕ JWT: класть их в Authorization нельзя
  // (шлюз отвечает 401), поэтому Bearer добавляем только для классического JWT-ключа (eyJ…).
  function restHeaders(extra) {
    var h = { 'apikey': SB_ANON, 'Accept': 'application/json' };
    if (/^eyJ/.test(SB_ANON)) h['Authorization'] = 'Bearer ' + SB_ANON;
    for (var k in (extra || {})) h[k] = extra[k];
    return h;
  }
  function restUrl(path) { return SB_URL.replace(/\/$/, '') + '/rest/v1/' + path; }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function fmtDate(n) {                       // display_date | published_at -> ДД.ММ.ГГГГ
    var v = n.display_date, m;
    if (v) {
      m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
      return m ? m[3] + '.' + m[2] + '.' + m[1] : String(v);
    }
    var d = new Date(n.published_at);
    return isNaN(d.getTime()) ? '' : pad2(d.getDate()) + '.' + pad2(d.getMonth() + 1) + '.' + d.getFullYear();
  }

  // ------------------------------------------------------------------ God Mode
  // ?god=ТОКЕН → сохраняем на 6 часов, чистим URL. Валидность проверяет сервер (rpc verify_god).
  function captureGodParam() {
    try {
      var params = new URLSearchParams(window.location.search);
      var t = params.get('god');
      if (!t) return;
      ls('set', GOD_KEY, JSON.stringify({ token: t, expires_at: Date.now() + TTL_MS }));
      params.delete('god');
      var q = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
    } catch (e) {}
  }
  function storedTokens() {
    var out = [];
    ['GOD', 'AUTH'].forEach(function (k) {
      try {
        var raw = ls('get', k === 'GOD' ? GOD_KEY : AUTH_KEY);
        if (!raw) return;
        var d = JSON.parse(raw);
        var t = k === 'GOD' ? d.token : d.access_token;
        if (t && (!d.expires_at || Date.now() < d.expires_at) && out.indexOf(t) < 0) out.push(t);
      } catch (e) {}
    });
    return out;
  }
  async function resolveGod() {
    if (godChecked) return godToken;
    var tokens = storedTokens();
    for (var i = 0; i < tokens.length; i++) {
      try {
        var r = await client.rpc('verify_god', { p_token: tokens[i] });
        if (r && r.data === true) { godToken = tokens[i]; break; }
      } catch (e) {}
    }
    if (!godToken) ls('del', GOD_KEY);       // токен неверный — забываем
    godChecked = true;
    return godToken;
  }

  // ------------------------------------------------------------------ lock screen
  var LOCK_CSS =
    'html.amoore-locked,html.amoore-locked body{overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;height:100%!important;height:100dvh!important;width:100%!important}' +
    '.amoore-lock-screen{position:fixed!important;top:0!important;right:0!important;bottom:0!important;left:0!important;width:100%!important;height:100vh!important;height:100dvh!important;z-index:2147483647!important;display:flex!important;align-items:center!important;justify-content:center!important;overflow:hidden!important;overscroll-behavior:none!important;touch-action:none!important;-webkit-user-select:none!important;user-select:none!important;padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)!important;box-sizing:border-box!important;font-family:Manrope,system-ui,-apple-system,sans-serif!important;background:#070b16!important;color:#e8ecf4!important;transform:translateZ(0)}' +
    '.amoore-lock-card{text-align:center;padding:44px 28px;max-width:420px;margin:16px;box-sizing:border-box}' +
    '.amoore-lock-icon{font-size:48px;line-height:1;margin-bottom:20px}' +
    '.amoore-lock-title{font-size:22px;font-weight:700;margin-bottom:12px;letter-spacing:-.02em}' +
    '.amoore-lock-text{font-size:16px;color:#8b95a8;line-height:1.55}' +
    '.amoore-lock-screen[data-type=maintenance]{background:#070b16 radial-gradient(ellipse at 50% 30%,rgba(212,175,55,.14),transparent 60%)!important}' +
    '.amoore-lock-screen[data-type=maintenance] .amoore-lock-card{background:rgba(16,24,48,.92);border:1px solid rgba(212,175,55,.28);border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.55);-webkit-backdrop-filter:blur(24px);backdrop-filter:blur(24px)}' +
    '.amoore-lock-screen[data-type=crash]{background:#0a0a0c!important;color:#f0f0f0!important}' +
    '.amoore-lock-screen[data-type=crash]::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,0,0,.03) 2px,rgba(255,0,0,.03) 4px);pointer-events:none;animation:amoore-scan 4s linear infinite}' +
    '@keyframes amoore-scan{to{transform:translateY(40px)}}' +
    '.amoore-glitch{font-size:24px;font-weight:800;margin-bottom:16px;animation:amoore-glitch 2.5s infinite}' +
    '@keyframes amoore-glitch{0%,90%,100%{text-shadow:none}92%{text-shadow:2px 0 #ff0040,-2px 0 #00e5ff}94%{text-shadow:-2px 0 #ff0040,2px 0 #00e5ff}}' +
    '.amoore-lock-screen[data-type=private]{background:#000!important;color:#fff!important}' +
    '.amoore-lock-screen[data-type=private] .amoore-lock-card{border:1px solid #333;border-radius:4px;max-width:380px}' +
    '.amoore-lock-screen[data-type=private] .amoore-lock-title{font-size:18px;font-weight:600;letter-spacing:.12em;text-transform:uppercase}' +
    '.amoore-lock-screen[data-type=private] .amoore-lock-text{font-size:13px;color:#888;letter-spacing:.04em}' +
    '.nx-lock-footer{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;padding:14px 0 calc(16px + env(safe-area-inset-bottom,0px))}' +
    '.nx-lock-btn{width:44px;height:44px;padding:0;font-size:18px;line-height:1;color:#d4af37;background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.3);border-radius:12px;cursor:pointer;-webkit-tap-highlight-color:transparent}' +
    '.nx-lock-btn:hover{border-color:rgba(212,175,55,.7)}' +
    '@media(max-width:768px){.amoore-lock-card{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}';

  var LOCK_HTML = {
    maintenance: '<div class="amoore-lock-card"><div class="amoore-lock-icon">⚙️</div><div class="amoore-lock-title">Технические работы</div><div class="amoore-lock-text">Мы проводим технические работы.<br>Скоро вернёмся.</div></div>',
    crash:       '<div class="amoore-lock-card"><div class="amoore-glitch">САЙТ УПАЛ</div><div class="amoore-lock-text">Мы уже чиним.<br>Пожалуйста, подождите.</div></div>',
    'private':   '<div class="amoore-lock-card"><div class="amoore-lock-icon">🔒</div><div class="amoore-lock-title">Доступ ограничен</div><div class="amoore-lock-text">Private access only</div></div>' +
                 '<footer class="nx-lock-footer"><button type="button" class="nx-lock-btn" data-act="private-login" aria-label="Вход для администратора" title="Вход для администратора">🔒</button></footer>'
  };

  function stopTouch(e) {
    try { if (e.target && e.target.closest && e.target.closest('.nx-login-overlay')) return; } catch (x) {}
    e.preventDefault();
  }
  var lockScreen = null;

  function showLock(type) {
    type = LOCK_HTML[type] ? type : 'maintenance';
    styleOnce('amoore-lock-css', LOCK_CSS);
    if (lockScreen) { lockScreen.setAttribute('data-type', type); lockScreen.innerHTML = LOCK_HTML[type]; wireLock(); return; }
    document.documentElement.classList.add('amoore-locked');
    document.body.classList.add('amoore-locked');
    lockScreen = el('div', 'amoore-lock-screen', LOCK_HTML[type]);
    lockScreen.setAttribute('data-type', type);
    lockScreen.setAttribute('role', 'dialog');
    lockScreen.setAttribute('aria-modal', 'true');
    // iOS rubber-band: гасим жесты на всём документе
    document.addEventListener('touchmove', stopTouch, { passive: false });
    lockScreen.addEventListener('wheel', stopTouch, { passive: false });
    Array.prototype.forEach.call(document.body.children, function (n) {
      if (n.tagName !== 'SCRIPT' && n.tagName !== 'STYLE') { n.setAttribute('inert', ''); n.setAttribute('data-amoore-inert', '1'); }
    });
    document.body.appendChild(lockScreen);
    wireLock();
  }
  function wireLock() {
    if (!lockScreen) return;
    var b = lockScreen.querySelector('[data-act=private-login]');
    if (b) b.addEventListener('click', openLoginModal);
  }
  function hideLock() {
    if (!lockScreen) return;
    document.removeEventListener('touchmove', stopTouch, { passive: false });
    document.documentElement.classList.remove('amoore-locked');
    document.body.classList.remove('amoore-locked');
    Array.prototype.forEach.call(document.querySelectorAll('[data-amoore-inert]'), function (n) {
      n.removeAttribute('inert'); n.removeAttribute('data-amoore-inert');
    });
    if (lockScreen.parentNode) lockScreen.parentNode.removeChild(lockScreen);
    lockScreen = null;
  }

  // ------------------------------------------------------------------ Private Login (🔒 в футере закрытого сайта)
  // Email + пароль (Supabase Auth) + токен из таблицы admins. Успех → сессия в localStorage на 6 часов
  // (тот же ключ amoore_dev_auth, что и у админки), перезагрузка страницы и плавающее меню Quick Admin.
  function authSession() {
    try {
      var raw = ls('get', AUTH_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.access_token) return null;
      if (d.expires_at && Date.now() > d.expires_at) return null;
      return d;
    } catch (e) { return null; }
  }
  async function privateLogin(email, password, token) {
    if (!client) throw new Error('Сервер недоступен. Попробуйте позже.');
    var r = await withTimeout(client.auth.signInWithPassword({ email: email, password: password }), 9000);
    if (r.error) throw new Error('Неверный email или пароль');
    var v = await withTimeout(client.rpc('verify_admin', { p_token: token }), 9000);
    var d = v && v.data;
    if (!d || v.error) { try { await client.auth.signOut(); } catch (e) {} throw new Error('Неверный токен или аккаунт не найден'); }
    if (d.role !== 'super_admin' && d.role !== 'admin') { try { await client.auth.signOut(); } catch (e) {} throw new Error('Недостаточно прав для просмотра закрытого сайта'); }
    ls('set', AUTH_KEY, JSON.stringify({
      admin_id: d.id, email: d.email, nickname: d.nickname, name: d.name, role: d.role,
      permissions: d.permissions || null, access_token: token, expires_at: Date.now() + TTL_MS
    }));
    try { await client.auth.signOut(); } catch (e) {}
  }
  function openLoginModal() {
    var ov = document.getElementById('nx-login');
    if (!ov) {
      ov = el('div', 'nx-cl-overlay nx-login-overlay',
        '<form class="nx-cl-card nx-login-card" novalidate>' +
        '<button type="button" class="nx-cl-close" data-act="close" aria-label="Закрыть">×</button>' +
        '<h2>Вход для администратора</h2>' +
        '<label class="nx-field"><span>Email</span><input type="email" name="email" autocomplete="username" autocapitalize="none" spellcheck="false" required></label>' +
        '<label class="nx-field"><span>Пароль</span><input type="password" name="password" autocomplete="current-password" required></label>' +
        '<label class="nx-field"><span>Токен</span><input type="password" name="token" autocomplete="off" autocapitalize="none" spellcheck="false" required></label>' +
        '<p class="nx-login-error" role="alert" hidden></p>' +
        '<button type="submit" class="nx-btn nx-login-submit">Войти</button>' +
        '</form>');
      ov.id = 'nx-login';
      var form = ov.querySelector('form'), err = ov.querySelector('.nx-login-error'), sub = ov.querySelector('.nx-login-submit');
      function shut() { ov.classList.remove('open'); }
      ov.addEventListener('click', function (e) { if (e.target === ov) shut(); });
      ov.querySelector('[data-act=close]').addEventListener('click', shut);
      ov.addEventListener('keydown', function (e) { if (e.key === 'Escape') shut(); });
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var em = form.email.value.trim(), pw = form.password.value, tk = form.token.value.trim();
        err.hidden = true;
        if (!em || !pw || !tk) { err.textContent = 'Заполните email, пароль и токен'; err.hidden = false; return; }
        sub.disabled = true; sub.textContent = 'Проверяем…';
        try {
          await privateLogin(em, pw, tk);
          location.reload();
        } catch (ex) {
          err.textContent = (ex && ex.message === 'timeout') ? 'Сервер не ответил. Попробуйте ещё раз.' : (ex && ex.message) || 'Не удалось войти';
          err.hidden = false; sub.disabled = false; sub.textContent = 'Войти';
        }
      });
      document.body.appendChild(ov);
    }
    ov.classList.add('open');
    var first = ov.querySelector('input[name=email]'); if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 30);
  }

  // ------------------------------------------------------------------ Quick Admin (плавающее меню)
  var ROLE_FALLBACK = { super_admin: 'Основатель', admin: 'Админ', moderator: 'Модератор' };
  var roleLabelsCache = null;
  async function fetchGlobalSetting(key) {
    try {
      if (client) {
        var r = await withTimeout(client.from('global_settings').select('value').eq('key', key).maybeSingle(), 6000);
        if (r && !r.error && r.data) return r.data.value;
      }
      var res = await withTimeout(fetch(restUrl('global_settings?select=value&key=eq.' + encodeURIComponent(key)), { headers: restHeaders() }), 6000);
      if (!res.ok) return null;
      var arr = await res.json();
      return arr && arr[0] ? arr[0].value : null;
    } catch (e) { return null; }
  }
  async function getRoleLabels() {
    if (roleLabelsCache) return roleLabelsCache;
    var v = await fetchGlobalSetting('role_labels');
    roleLabelsCache = Object.assign({}, ROLE_FALLBACK, v && typeof v === 'object' ? v : {});
    return roleLabelsCache;
  }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var QA_CSS =
    '.nx-qa{position:fixed;right:max(14px,env(safe-area-inset-right,0px));bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:2147482000;font-family:Manrope,system-ui,sans-serif;color:#eef0f7}' +
    '.nx-qa-fab{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 16px;font:700 13px Manrope,system-ui,sans-serif;color:#0a0e18;background:linear-gradient(135deg,#e8c96a,#d4af37 55%,#b8932a);border:0;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.4);cursor:pointer}' +
    '.nx-qa-panel{position:absolute;right:0;bottom:calc(100% + 10px);width:min(300px,calc(100vw - 28px));box-sizing:border-box;padding:14px;border-radius:18px;background:rgba(13,18,32,.9);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(212,175,55,.2);box-shadow:0 8px 32px rgba(0,0,0,.45)}' +
    '.nx-qa-panel[hidden]{display:none}' +
    '.nx-qa-user{font-size:13px;font-weight:700;margin:0 0 2px}.nx-qa-role{font-size:12px;color:#8b90a5;margin:0 0 10px}' +
    '.nx-qa-note{font-size:12px;color:#d4af37;margin:0 0 10px}' +
    '.nx-qa-online{margin:0 0 12px;padding:10px 0;border-top:1px solid rgba(212,175,55,.14);border-bottom:1px solid rgba(212,175,55,.14);font-size:12px;line-height:1.7;color:#c4c9d8}' +
    '.nx-qa-online b{display:block;margin-bottom:2px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8b90a5}' +
    '.nx-qa-dot{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:#5a6478}.nx-qa-dot.on{background:#34d399}' +
    '.nx-qa-actions{display:grid;gap:8px}' +
    '.nx-qa-btn{display:flex;align-items:center;justify-content:center;min-height:40px;padding:0 14px;box-sizing:border-box;font:700 13px Manrope,system-ui,sans-serif;color:#eef0f7;text-decoration:none;background:transparent;border:1px solid rgba(212,175,55,.3);border-radius:12px;cursor:pointer}' +
    '.nx-qa-btn:hover{color:#0a0e18;background:linear-gradient(135deg,#e8c96a,#d4af37 55%,#b8932a);border-color:transparent}';

  function adminLine(a, labels) { return '<span class="nx-qa-dot' + (a.online ? ' on' : '') + '"></span>' + esc(a.nickname || a.name || '—') + ' (' + (a.online ? 'в сети' : 'офлайн') + ')'; }

  async function showQuickAdmin(closed) {
    if (document.getElementById('amoore-god-bar')) return;
    styleOnce('amoore-qa-css', QA_CSS);
    var sess = authSession();
    var labels = await getRoleLabels();
    var root = el('div', 'nx-qa',
      '<div class="nx-qa-panel" hidden>' +
      '<p class="nx-qa-user"></p><p class="nx-qa-role"></p>' +
      (closed ? '<p class="nx-qa-note">Сайт закрыт для посетителей</p>' : '') +
      '<div class="nx-qa-online"><b>Админы в сети</b><div data-qa-list>Загрузка…</div></div>' +
      '<div class="nx-qa-actions">' +
      (closed ? '<button type="button" class="nx-qa-btn" data-act="open">Открыть сайт</button>' : '') +
      '<a class="nx-qa-btn" data-act="admin" href="' + DEV_URL + '" target="_blank" rel="noopener">Открыть Админку</a>' +
      (SITE_ID === 'studio' ? '' : '<a class="nx-qa-btn" data-act="edit" href="' + STUDIO_URL + '" target="_blank" rel="noopener">Редактировать</a>') +
      '<button type="button" class="nx-qa-btn" data-act="logout">Выйти</button>' +
      '</div></div>' +
      '<button type="button" class="nx-qa-fab" aria-expanded="false" aria-haspopup="true">⚡ Admin</button>');
    root.id = 'amoore-god-bar';
    var panel = root.querySelector('.nx-qa-panel'), fab = root.querySelector('.nx-qa-fab');
    root.querySelector('.nx-qa-user').textContent = (sess && (sess.nickname || sess.name || sess.email)) || 'Администратор';
    root.querySelector('.nx-qa-role').textContent = labels[sess && sess.role] || (sess && sess.role) || '';
    fab.addEventListener('click', function () {
      var open = panel.hidden; panel.hidden = !open; fab.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) refreshOnline();
    });
    root.querySelector('[data-act=logout]').addEventListener('click', function () {
      ls('del', AUTH_KEY); ls('del', GOD_KEY); location.reload();
    });
    var openBtn = root.querySelector('[data-act=open]');
    if (openBtn) openBtn.addEventListener('click', async function () {
      var btn = this; btn.disabled = true;
      try {
        var r = await client.rpc('god_open_site', { p_token: godToken, p_site: SITE_ID });
        if (r && r.data === true) { location.reload(); return; }
      } catch (e) {}
      btn.disabled = false; btn.textContent = 'Нет прав';
    });
    async function refreshOnline() {
      var box = root.querySelector('[data-qa-list]');
      try {
        if (client && godToken) client.rpc('touch_admin_by_token', { p_token: godToken }).then(function () {}, function () {});
        var r = await withTimeout(client.rpc('quick_admins', { p_token: godToken }), 6000);
        var list = r && r.data;
        if (list instanceof Array && list.length) box.innerHTML = list.map(function (a) { return '<div>' + adminLine(a, labels) + '</div>'; }).join('');
        else box.textContent = 'Нет данных';
      } catch (e) { box.textContent = 'Нет данных'; }
    }
    document.body.appendChild(root);
    setInterval(function () { if (!panel.hidden) refreshOnline(); }, 60000);
    if (client && godToken) { try { client.rpc('touch_admin_by_token', { p_token: godToken }).then(function () {}, function () {}); } catch (e) {} }
  }
  function hideGodBar() {
    var b = document.getElementById('amoore-god-bar');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }
  function showGodBar() { return showQuickAdmin(true); }

  // ------------------------------------------------------------------ site status
  async function applyStatus() {
    if (!cfg) return;
    if (cfg.status === 'open') {
      hideLock();
      if (storedTokens().length && await resolveGod()) showQuickAdmin(false); else hideGodBar();
      return;
    }
    if (await resolveGod()) { hideLock(); showQuickAdmin(true); }
    else { hideGodBar(); showLock(cfg.overlay_type); }
  }

  // ------------------------------------------------------------------ banner
  var BANNER_CSS =
    '.amoore-banner{position:relative;display:flex;align-items:center;justify-content:center;gap:10px;box-sizing:border-box;width:100%;padding:10px 16px;text-align:center;font:600 14px/1.4 Manrope,system-ui,sans-serif;color:#f3e3a6;background:linear-gradient(90deg,rgba(212,175,55,.16),rgba(212,175,55,.08));border-bottom:1px solid rgba(212,175,55,.35);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}' +
    '.amoore-banner-dot{flex:0 0 8px;width:8px;height:8px;border-radius:50%;background:#d4af37;box-shadow:0 0 10px #d4af37}' +
    '.amoore-banner-text{min-width:0;overflow-wrap:anywhere}' +
    '@media(max-width:768px){.amoore-banner{-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(40,32,10,.94)}}';

  function applyBanner() {
    var node = document.getElementById('amoore-banner');
    var text = cfg && cfg.banner_active === true && cfg.banner_text ? String(cfg.banner_text).trim() : '';
    if (!text) { if (node && node.parentNode) node.parentNode.removeChild(node); return; }
    styleOnce('amoore-banner-css', BANNER_CSS);
    if (!node) {
      node = el('div', 'amoore-banner', '<span class="amoore-banner-dot" aria-hidden="true"></span><span class="amoore-banner-text"></span>');
      node.id = 'amoore-banner';
      node.setAttribute('role', 'status');
      var header = document.querySelector('[data-amoore-header], header.topbar, body > header, header, .topbar');
      if (header && header.parentNode) header.parentNode.insertBefore(node, header.nextSibling);
      else document.body.insertBefore(node, document.body.firstChild);
    }
    node.querySelector('.amoore-banner-text').textContent = text;   // textContent — без XSS
  }

  // ------------------------------------------------------------------ chat / news visibility
  function applyVisibility() {
    styleOnce('amoore-hide-css', [
      '.amoore-hidden{display:none!important}',
      '.amoore-chat-offline #chat-input,.amoore-chat-offline #chat-send{opacity:.55}',
      '.amoore-news-paused .section-lead{opacity:.75}'
    ].join(''));

    var chatOff = (!!cfg && cfg.demo_chat_active === false) || botOnline === false;
    var newsOff = !!cfg && cfg.news_active === false;

    Array.prototype.forEach.call(document.querySelectorAll('a[href="#chat"]'), function (n) {
      n.classList.toggle('amoore-hidden', chatOff);
    });
    Array.prototype.forEach.call(document.querySelectorAll('a[href="#news"]'), function (n) {
      n.classList.toggle('amoore-hidden', newsOff);
    });

    var chatRoot = document.getElementById('chat') || document.querySelector('[data-amoore-chat]');
    if (chatRoot) {
      chatRoot.classList.toggle('amoore-chat-offline', chatOff);
      chatRoot.setAttribute('data-amoore-chat-enabled', chatOff ? '0' : '1');
      var chatInput = document.getElementById('chat-input');
      var chatSend = document.getElementById('chat-send');
      var chatLog = document.getElementById('chat-log');
      if (chatOff) {
        if (chatInput) { chatInput.disabled = true; chatInput.setAttribute('aria-disabled', 'true'); chatInput.placeholder = 'Чат на паузе'; }
        if (chatSend) { chatSend.disabled = true; chatSend.setAttribute('aria-disabled', 'true'); }
        if (chatLog && !chatLog.querySelector('[data-amoore-off]')) {
          var row = document.createElement('div');
          row.className = 'chat-bubble chat-bot';
          row.setAttribute('data-amoore-off', '1');
          var name = document.createElement('span'); name.className = 'chat-name'; name.textContent = 'amoore';
          var p = document.createElement('p');
          p.textContent = 'Я ушел на перезагрузку. Скоро вернусь!';
          row.appendChild(name); row.appendChild(p);
          chatLog.appendChild(row);
          try { chatLog.scrollTop = chatLog.scrollHeight; } catch (e) {}
        }
      } else {
        try { if (window.amooreDemoChat && typeof window.amooreDemoChat.rebind === 'function') window.amooreDemoChat.rebind(); } catch (e) {}
        if (chatInput) { chatInput.disabled = false; chatInput.removeAttribute('aria-disabled'); if (chatInput.placeholder === 'Чат на паузе') chatInput.placeholder = 'Напишите сообщение…'; }
        if (chatSend) { chatSend.disabled = false; chatSend.removeAttribute('aria-disabled'); }
        if (chatLog) {
          var off = chatLog.querySelector('[data-amoore-off]');
          if (off) off.remove();
        }
      }
    }

    var newsRoot = document.getElementById('news') || document.querySelector('[data-amoore-news-section]');
    if (newsRoot) {
      newsRoot.classList.toggle('amoore-news-paused', newsOff);
      newsRoot.setAttribute('data-amoore-news-enabled', newsOff ? '0' : '1');
    }
    publishState();
  }

  // ------------------------------------------------------------------ news
  // Конвейер новостей v3 (исправление «новости не отображаются»):
  //  1) рисуем из локального кэша мгновенно (stale-while-revalidate);
  //  2) параллельно спрашиваем supabase-js И чистый REST — берём первый успешный ответ;
  //  3) загрузка новостей НЕ ждёт конфиг/статус бота/список сайтов (раньше boot() был цепочкой await);
  //  4) запрос идёт только по опубликованным (is_published=true) — под частичный индекс news_pub_idx.
  var TYPE_LABEL = { news: 'Новость', patch: 'Патч', soon: 'Скоро', digest: 'Дайджест' };
  var NEWS_CACHE_KEY = 'amoore_news_v3';
  var NEWS_COLS = 'id,title,body,type,display_date,published_at';
  var newsSeq = 0;           // номер запроса: устаревший ответ не перетирает свежий
  var cfgPromise = null;     // промис загрузки конфига (новости ждут его не дольше 2.5 с)

  function readNewsCache() {
    try { var d = JSON.parse(ls('get', NEWS_CACHE_KEY) || 'null'); return d && d.items instanceof Array ? d.items : null; }
    catch (e) { return null; }
  }
  function writeNewsCache(items) { ls('set', NEWS_CACHE_KEY, JSON.stringify({ t: Date.now(), items: items.slice(0, 20) })); }

  function fetchNewsViaClient() {
    if (!client) return Promise.reject(new Error('no-client'));
    return withTimeout(client.from('news').select(NEWS_COLS)
      .eq('is_published', true).order('published_at', { ascending: false }).limit(20)
      .then(function (res) { if (res.error) throw res.error; return res.data || []; }), 7000);
  }
  function fetchNewsViaRest() {
    return withTimeout(fetch(restUrl('news?select=' + NEWS_COLS + '&is_published=eq.true&order=published_at.desc&limit=20'),
      { method: 'GET', headers: restHeaders() })
      .then(function (r) { if (!r.ok) throw new Error('http-' + r.status); return r.json(); }), 7000);
  }

  function newsTarget() { return document.querySelector('#news-list, [data-amoore-news]'); }

  function setNewsPlaceholder(target, msg, isError) {
    target.textContent = '';
    var item = document.createElement('div');
    item.className = 'news-item glass-card';
    item.setAttribute(isError ? 'data-amoore-news-error' : 'data-amoore-news-placeholder', '1');
    var span = document.createElement('span');
    span.textContent = msg;                                   // textContent — без XSS
    item.appendChild(span);
    if (isError) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn btn-ghost news-retry'; btn.textContent = 'Повторить';
      btn.addEventListener('click', function () { renderNews(); });
      item.appendChild(btn);
    }
    target.appendChild(item);
  }

  // Свежесть новости: дата, которую выбрал админ (display_date), иначе дата публикации; при равенстве — время публикации.
  // Это же правило использует любая вкладка-фильтр на лендинге: самое свежее всегда сверху.
  function newsFreshness(n) {
    var p = Date.parse(n.published_at) || 0;
    var m = n.display_date && String(n.display_date).match(/^(\d{4})-(\d{2})-(\d{2})/);
    var d = m ? Date.parse(m[1] + '-' + m[2] + '-' + m[3] + 'T12:00:00') : NaN;
    return [isNaN(d) ? p : d, p];
  }
  function sortNews(items) {
    return (items || []).slice().sort(function (a, b) {
      var x = newsFreshness(a), y = newsFreshness(b);
      return (y[0] - x[0]) || (y[1] - x[1]);
    });
  }

  function paintNews(target, items) {
    target.textContent = '';
    items = sortNews(items);
    if (!items.length) { setNewsPlaceholder(target, 'Здесь пока пусто. Новости появятся из панели amoore Dev.', false); try { document.dispatchEvent(new CustomEvent('amoore:news', { detail: { count: 0 } })); } catch (e) {} return; }
    var frag = document.createDocumentFragment();
    items.forEach(function (n) {
      var item = document.createElement('div');
      item.className = 'news-item glass-card' + (n.type === 'digest' ? ' news-item-digest' : '');
      item.setAttribute('data-type', n.type || 'news');
      var small = document.createElement('small');
      small.textContent = [TYPE_LABEL[n.type] || '', fmtDate(n)].filter(Boolean).join(' · ');
      var title = document.createElement('b'); title.textContent = n.title || '';
      var body = document.createElement('span'); body.textContent = n.body || '';
      item.appendChild(small); item.appendChild(title); item.appendChild(body);
      frag.appendChild(item);
    });
    target.appendChild(frag);
    try { document.dispatchEvent(new CustomEvent('amoore:news', { detail: { count: items.length } })); } catch (e) {}
  }

  async function renderNews() {
    var target = newsTarget();
    if (!target) return;
    var seq = ++newsSeq;

    // Мгновенная отрисовка из кэша (пока идёт сеть)
    var hasReal = !!target.querySelector('[data-type]');
    if (!hasReal) {
      var cached = readNewsCache();
      if (cached && cached.length) { paintNews(target, cached); hasReal = true; }
    }

    // Тумблер «Новости» выключен? Ждём конфиг, но не дольше 2.5 с — сеть для новостей стартует параллельно.
    if (cfgPromise) { try { await withTimeout(cfgPromise, 2500); } catch (e) {} }
    if (seq !== newsSeq) return;
    if (cfg && cfg.news_active === false) { setNewsPlaceholder(target, 'Редакция готовит материалы. Загляните позже', false); return; }

    try {
      var list = [fetchNewsViaRest()];
      if (client) list.push(fetchNewsViaClient());
      var items = await firstOk(list);
      if (seq !== newsSeq) return;
      newsCache = items || [];
      writeNewsCache(newsCache);
      publishState();
      paintNews(target, newsCache);
      applySeo();
    } catch (e) {
      if (seq !== newsSeq) return;
      try { console.warn('[amoore-core] news load failed', e); } catch (x) {}
      if (!target.querySelector('[data-type]')) {
        setNewsPlaceholder(target, (e && e.message === 'timeout')
          ? 'Сервер новостей не ответил. Попробуйте ещё раз.'
          : 'Не удалось загрузить новости. Проверьте соединение.', true);
      }
    }
  }

  // ------------------------------------------------------------------ leads (форма «Оставить заявку»)
  // Возвращает { ok:true } или { ok:false, status, message }. Клиент supabase-js сам ставит правильные заголовки;
  // если он недоступен — REST (только apikey). Тексты обрезаются под RLS-проверку длины в SQL.
  async function submitLead(lead) {
    var row = {
      name: String(lead && lead.name || '').trim().slice(0, 120),
      contact: String(lead && lead.contact || '').trim().slice(0, 200),
      message: String(lead && lead.message || '').trim().slice(0, 2000),
      status: 'new'
    };
    if (!row.name || !row.contact) return { ok: false, status: 0, message: 'empty' };
    var lastErr = null;
    if (client) {
      try {
        var r = await withTimeout(client.from('leads').insert(row), 9000);
        if (!r.error) return { ok: true };
        lastErr = { status: r.status || 0, message: r.error.message || 'error' };
      } catch (e) { lastErr = { status: 0, message: e && e.message || 'error' }; }
    }
    try {
      var res = await withTimeout(fetch(restUrl('leads'), {
        method: 'POST',
        headers: restHeaders({ 'Content-Type': 'application/json', 'Prefer': 'return=minimal' }),
        body: JSON.stringify(row)
      }), 9000);
      if (res.ok) return { ok: true };
      return { ok: false, status: res.status, message: 'http-' + res.status };
    } catch (e) { return { ok: false, status: 0, message: (lastErr && lastErr.message) || (e && e.message) || 'network' }; }
  }

  // changelog.json лежит рядом с сайтом: [{version, date, title, items:[...]}]
  async function fetchChangelog(url) {
    try {
      var r = await withTimeout(fetch(url || 'changelog.json', { cache: 'no-cache' }), 6000);
      if (!r.ok) return [];
      var d = await r.json();
      return d && d.versions instanceof Array ? d.versions : (d instanceof Array ? d : []);
    } catch (e) { return []; }
  }

  // ------------------------------------------------------------------ версия и Changelog из БД (v4.0)
  // Источник правды — global_settings.changelog ({versions:[...]}), редактируется в админке.
  // Нет БД → локальный changelog.json → жёсткий v4.0.0 из кода.
  var changelogList = null;
  function verKey(v) { return String(v || '').split('.').map(function (x) { return parseInt(x, 10) || 0; }); }
  function verCmp(a, b) { var x = verKey(a), y = verKey(b); for (var i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0); } return 0; }
  function sortVersions(list) {
    var arr = (list || []).filter(function (v) { return v && v.version; });
    var manual = arr.length > 0 && arr.every(function (v) { return typeof v.order === 'number'; });
    return arr.slice().sort(function (a, b) { return manual ? a.order - b.order : verCmp(a.version, b.version); });
  }
  function applyVersion(v) {
    if (!v) return;
    AMOORE_VERSION = String(v);
    window.AMOORE_VERSION = AMOORE_VERSION;
    window.AMOORE_STATE.version = AMOORE_VERSION;
    if (window.amooreCore) window.amooreCore.version = AMOORE_VERSION;
    Array.prototype.forEach.call(document.querySelectorAll('[data-amoore-version]'), function (n) { n.textContent = AMOORE_VERSION; });
    if (window.amooreUX) window.amooreUX.setVersion(AMOORE_VERSION);
    var chip = document.getElementById('nx-version-chip');
    if (chip && !chip.hasAttribute('data-ux-chip')) chip.textContent = 'v' + AMOORE_VERSION;
  }
  async function loadChangelogList() {
    if (changelogList) return changelogList;
    var list = null;
    var db = await fetchGlobalSetting('changelog');
    if (db && db.versions instanceof Array && db.versions.length) list = sortVersions(db.versions);
    if (!list || !list.length) {
      var local = await fetchChangelog('changelog.json');
      if (local && local.length) list = sortVersions(local);
    }
    changelogList = list && list.length ? list : [{ version: '5.1.0', title: 'BUGFIX', items: ['Исправлены мобильная вёрстка и бургер-меню, настроены права RLS.'] }];
    applyVersion(changelogList[0].version);
    return changelogList;
  }
  function renderChangelog(box, list) {
    box.textContent = '';
    if (!list.length) { var e = el('p', 'nx-cl-empty'); e.textContent = 'История пока пуста.'; box.appendChild(e); return; }
    list.forEach(function (v) {
      var sec = el('section', 'nx-cl-entry');
      var h = document.createElement('h3');
      h.appendChild(document.createTextNode('v' + v.version));
      if (v.title) { var sm = document.createElement('small'); sm.textContent = v.title; h.appendChild(sm); }
      if (v.date) { var dt = document.createElement('time'); dt.textContent = String(v.date).split('-').reverse().join('.'); h.appendChild(dt); }
      sec.appendChild(h);
      var ul = document.createElement('ul');
      (v.items || []).forEach(function (t) { var li = document.createElement('li'); li.textContent = t; ul.appendChild(li); });
      sec.appendChild(ul);
      box.appendChild(sec);
    });
  }
  var clLastFocus = null;
  async function openChangelog() {
    var ov = document.getElementById('nx-changelog');
    if (!ov) {
      ov = el('div', 'nx-cl-overlay',
        '<div class="nx-cl-card" role="dialog" aria-modal="true" aria-labelledby="nx-cl-title">' +
        '<button type="button" class="nx-cl-close" aria-label="Закрыть">×</button>' +
        '<h2 id="nx-cl-title">История обновлений</h2><div class="nx-cl-body"><p class="nx-cl-empty">Загрузка…</p></div></div>');
      ov.id = 'nx-changelog';
      function shut() { ov.classList.remove('open'); document.documentElement.classList.remove('nx-cl-open'); if (clLastFocus && clLastFocus.focus) { try { clLastFocus.focus(); } catch (e) {} } }
      ov.addEventListener('click', function (e) { if (e.target === ov) shut(); });
      ov.querySelector('.nx-cl-close').addEventListener('click', shut);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('open')) shut(); });
      document.body.appendChild(ov);
    }
    clLastFocus = document.activeElement;
    ov.classList.add('open');
    document.documentElement.classList.add('nx-cl-open');
    var btn = ov.querySelector('.nx-cl-close'); if (btn) btn.focus();
    renderChangelog(ov.querySelector('.nx-cl-body'), await loadChangelogList());
  }
  function mountVersionChip() {
    document.addEventListener('amoore:changelog', openChangelog);
    if (document.getElementById('nx-version-chip') || document.getElementById('version-chip')) return;
    var brand = document.querySelector('[data-amoore-brand], .brand, .topbar-brand');
    if (!brand || !brand.parentNode) return;
    var chip = el('button', 'nx-version-chip');
    chip.type = 'button'; chip.id = 'nx-version-chip';
    chip.setAttribute('aria-haspopup', 'dialog'); chip.setAttribute('aria-label', 'История обновлений');
    chip.textContent = 'v' + (window.amooreUX ? window.amooreUX.shortVer(AMOORE_VERSION) : AMOORE_VERSION);
    chip.addEventListener('click', openChangelog);
    brand.parentNode.insertBefore(chip, brand.nextSibling);
  }

  // ------------------------------------------------------------------ analytics
  function trackVisit() {
    try {
      if (sessionStorage.getItem(VISIT_KEY)) return;       // 1 визит на сессию вкладки
      if (storedTokens().length) return;                    // админов в статистику не пишем
      sessionStorage.setItem(VISIT_KEY, '1');
    } catch (e) {}
    var row = { site_id: SITE_ID, visitor_id: visitorId(), path: String(location.pathname || '/').slice(0, 200) };
    geoLookup().then(function (g) {
      if (g) { row.country_code = g.country_code || null; row.country = g.country || null; row.city = g.city || null; }
      try { client.from('site_visits').insert(row).then(function () {}, function () {}); } catch (e) {}
    });
  }
  // анонимный id посетителя (для «онлайн сейчас» и уникальных визитов); гео — Edge Function geo, IP не сохраняется
  function visitorId() {
    try { var k = 'amoore_vid', v = localStorage.getItem(k);
      if (!v) { v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Math.random().toString(36).slice(2) + Date.now().toString(36)); localStorage.setItem(k, v); }
      return v; } catch (e) { return null; }
  }
  function geoLookup() {
    try {
      var c = sessionStorage.getItem('amoore_geo'); if (c) return Promise.resolve(JSON.parse(c));
      var ctl = window.AbortController ? new AbortController() : null; if (ctl) setTimeout(function () { ctl.abort(); }, 2500);
      return fetch(SB_URL + '/functions/v1/geo', { headers: { apikey: SB_ANON }, signal: ctl ? ctl.signal : undefined })
        .then(function (r) { return r.json(); }).then(function (g) { try { sessionStorage.setItem('amoore_geo', JSON.stringify(g || {})); } catch (e) {} return g; })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }

  // ------------------------------------------------------------------ SEO
  function applySeo() {
    if (!cfg) return;
    try {
      var name = cfg.name || 'amoore';
      document.title = name + ' | AI companion';
      var desc = cfg.banner_text || '';
      if (desc) {
        var m = document.querySelector('meta[name="description"]');
        if (!m) {
          m = document.createElement('meta');
          m.setAttribute('name', 'description');
          document.head.appendChild(m);
        }
        m.setAttribute('content', String(desc).slice(0, 180));
      }
    } catch (e) {}
  }

  // ------------------------------------------------------------------ config + live
  // Конфиг сайта: только нужные поля, кэш в localStorage на 5 минут (CFG_TTL_MS).
  // Кэш читается лишь при загрузке страницы; Realtime и опрос раз в 20 с всегда идут в БД и обновляют кэш,
  // поэтому закрытие сайта из админки применяется сразу.
  var CFG_COLS = 'id,name,url,status,overlay_type,banner_active,banner_text,demo_chat_active,news_active';
  var CFG_KEY = 'amoore_cfg_' + SITE_ID;
  var CFG_TTL_MS = 5 * 60 * 1000;
  function readCfgCache() {
    try {
      var d = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
      return d && d.cfg && Date.now() - d.t < CFG_TTL_MS ? d.cfg : null;
    } catch (e) { return null; }
  }
  function writeCfgCache(c) { try { localStorage.setItem(CFG_KEY, JSON.stringify({ t: Date.now(), cfg: c })); } catch (e) {} }
  async function fetchConfig(useCache) {
    if (useCache) { var cached = readCfgCache(); if (cached) return cached; }
    try {
      if (client) {
        var r = await withTimeout(client.from('ecosystem_sites').select(CFG_COLS).eq('id', SITE_ID).maybeSingle(), 7000);
        if (r && !r.error && r.data) { writeCfgCache(r.data); return r.data; }
      }
      var url = SB_URL.replace(/\/$/, '') + '/rest/v1/ecosystem_sites?select=' + CFG_COLS + '&id=eq.' + encodeURIComponent(SITE_ID);
      var res = await withTimeout(fetch(url, { headers: restHeaders() }), 7000);
      if (!res.ok) return null;
      var arr = await res.json();
      if (arr && arr[0]) { writeCfgCache(arr[0]); return arr[0]; }
      return null;
    } catch (e) { return null; }
  }
  async function fetchBotStatus() {
    try {
      if (client) {
        var r = await withTimeout(client.from('bot_status').select('is_online').eq('id', 'main').maybeSingle(), 6000);
        if (r && !r.error && r.data) { botOnline = r.data.is_online !== false; return botOnline; }
      }
      var url = SB_URL.replace(/\/$/, '') + '/rest/v1/bot_status?select=is_online&id=eq.main';
      var res = await fetch(url, { headers: restHeaders(), signal: AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined });
      if (res.ok) { var rows = await res.json(); if (rows && rows[0]) botOnline = rows[0].is_online !== false; }
    } catch (e) { /* Keep last known status; do not falsely mark the bot offline on transient network loss. */ }
    return botOnline;
  }

  function applyConfig() {
    applyStatus();
    applyBanner();
    applyVisibility();
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }
  function startLive() {
    var refreshNews = debounce(renderNews, 300);
    var refreshCfg = async function () {
      var c = await fetchConfig();
      await fetchBotStatus();
      if (c) { cfg = c; publishState(); applyConfig(); applySeo(); renderNews(); }
      else applyVisibility();
    };
    try {
      if (client.channel) {
        client.channel('amoore-live-' + SITE_ID)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'news' }, refreshNews)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'ecosystem_sites', filter: 'id=eq.' + SITE_ID }, refreshCfg)
          .subscribe();
      }
    } catch (e) {}
    function tick() {
      if (document.visibilityState && document.visibilityState !== 'visible') return;
      refreshCfg(); // уже вызывает renderNews
    }
    setInterval(tick, POLL_MS);                     // страховка Realtime (20 с)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        renderNews();
        tick();
      }
    });
  }

  // Каждый шаг загрузки изолирован: сбой одного (например, bot_status) не останавливает остальные.
  async function safe(fn) { try { return await fn(); } catch (e) { try { console.warn('[amoore-core]', e); } catch (x) {} return null; } }

  async function boot() {
    captureGodParam();
    mountVersionChip();
    if (window.supabase && window.supabase.createClient) {
      client = window.supabase.createClient(SB_URL, SB_ANON, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } else {
      console.warn('[amoore-core] supabase-js не загружен — работаем через REST');
      client = null;
    }
    safe(trackVisit);
    safe(loadChangelogList);

    // Конфиг сайта грузим параллельно с новостями; новости не блокируются ничем.
    cfgPromise = safe(async function () {
      cfg = await fetchConfig(true);
      await fetchBotStatus();
      publishState(); applyConfig(); applySeo();
    });
    var newsPromise = safe(renderNews);
    await Promise.all([cfgPromise, newsPromise]);
    if (client) startLive();
    else {
      setInterval(function () {
        if (document.visibilityState && document.visibilityState !== 'visible') return;
        renderNews();
        fetchBotStatus().then(applyVisibility);
      }, POLL_MS);
    }
  }

  function publishConfig() {
    window.AMOORE_CONFIG = cfg;
  }

  window.amooreCore = {
    version: AMOORE_VERSION,
    siteId: SITE_ID,
    submitLead: submitLead,
    fetchChangelog: fetchChangelog,
    openChangelog: openChangelog,
    getChangelog: loadChangelogList,
    getRoleLabels: getRoleLabels,
    fetchGlobalSetting: fetchGlobalSetting,
    getConfig: function () { return cfg ? Object.assign({}, cfg) : null; },
    isChatEnabled: function () { return !(cfg && cfg.demo_chat_active === false) && botOnline !== false; },
    isNewsEnabled: function () { return !(cfg && cfg.news_active === false); },
    refresh: async function () {
      var c = await fetchConfig();
      await fetchBotStatus();
      if (c) { cfg = c; publishState(); applyConfig(); applySeo(); }
      else applyVisibility();
      publishState();
      return renderNews();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
