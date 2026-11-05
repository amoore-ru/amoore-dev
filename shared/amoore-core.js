/**
 * amoore-core.js — v9.0.0 (Global Update v2.0 Evolve)
 * Подключение:
 *   <script>window.AMOORE_SITE_ID = 'landing';</script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="amoore-core.js"></script>
 *
 * window.AMOORE_STATE — единый state (config, news, sites, god)
 * window.AMOORE_CONFIG — alias на state.config
 * window.amooreCore — API (refresh, isChatEnabled, ...)
 */
(function () {
  'use strict';
  if (window.__amooreCoreLoaded) return;
  window.__amooreCoreLoaded = true;

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
  var sitesCache = [];
  var botOnline = null; // null = unknown; only explicit false pauses the demo chat

  // Глобальный state экосистемы
  window.AMOORE_STATE = {
    siteId: SITE_ID,
    config: null,
    news: [],
    sites: [],
    god: false,
    version: '9.0.0'
  };
  function publishState() {
    window.AMOORE_STATE.config = cfg ? Object.assign({}, cfg) : null;
    window.AMOORE_STATE.news = newsCache.slice();
    window.AMOORE_STATE.sites = sitesCache.slice();
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
    '@media(max-width:768px){.amoore-lock-card{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}}';

  var LOCK_HTML = {
    maintenance: '<div class="amoore-lock-card"><div class="amoore-lock-icon">⚙️</div><div class="amoore-lock-title">Технические работы</div><div class="amoore-lock-text">Мы проводим технические работы.<br>Скоро вернёмся.</div></div>',
    crash:       '<div class="amoore-lock-card"><div class="amoore-glitch">САЙТ УПАЛ</div><div class="amoore-lock-text">Мы уже чиним.<br>Пожалуйста, подождите.</div></div>',
    'private':   '<div class="amoore-lock-card"><div class="amoore-lock-icon">🔒</div><div class="amoore-lock-title">Доступ ограничен</div><div class="amoore-lock-text">Private access only</div></div>'
  };

  function stopTouch(e) { e.preventDefault(); }
  var lockScreen = null;

  function showLock(type) {
    type = LOCK_HTML[type] ? type : 'maintenance';
    styleOnce('amoore-lock-css', LOCK_CSS);
    if (lockScreen) { lockScreen.setAttribute('data-type', type); lockScreen.innerHTML = LOCK_HTML[type]; return; }
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

  // ------------------------------------------------------------------ God bar
  var GOD_CSS =
    '.amoore-god-bar{position:relative!important;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;width:100%;box-sizing:border-box;z-index:999998;padding:10px 16px;padding-top:calc(10px + env(safe-area-inset-top,0px));background:linear-gradient(90deg,#1a1508,#2a220c);border-bottom:1px solid #d4af37;font-family:Manrope,system-ui,sans-serif;font-size:14px;color:#e8c96a}' +
    '.amoore-god-btn{padding:8px 14px;min-height:40px;background:#d4af37;color:#0a0e18;border:0;border-radius:8px;font:700 13px Manrope,system-ui,sans-serif;cursor:pointer}' +
    '.amoore-god-btn:active{transform:scale(.97)}';

  function showGodBar() {
    if (document.getElementById('amoore-god-bar')) return;
    styleOnce('amoore-god-css', GOD_CSS +
      '.amoore-god-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}' +
      '.amoore-god-btn-ghost{padding:8px 14px;min-height:40px;background:transparent;color:#e8c96a;border:1px solid rgba(212,175,55,.45);border-radius:8px;font:600 13px Manrope,system-ui,sans-serif;cursor:pointer;text-decoration:none}');
    var bar = el('div', 'amoore-god-bar',
      '<span><strong>God Mode:</strong> сайт закрыт для посетителей</span>' +
      '<div class="amoore-god-actions">' +
      '<button class="amoore-god-btn" type="button" data-act="open">Открыть сайт</button>' +
      '<a class="amoore-god-btn-ghost" href="https://amoore-dev.pages.dev/" target="_blank" rel="noopener">В админку</a>' +
      '</div>');
    bar.id = 'amoore-god-bar';
    bar.querySelector('[data-act=open]').addEventListener('click', async function () {
      var btn = this; btn.disabled = true;
      try {
        var r = await client.rpc('god_open_site', { p_token: godToken, p_site: SITE_ID });
        if (r && r.data === true) { location.reload(); return; }
      } catch (e) {}
      btn.disabled = false; btn.textContent = 'Нет прав';
    });
    document.body.prepend(bar);
  }
  function hideGodBar() {
    var b = document.getElementById('amoore-god-bar');
    if (b && b.parentNode) b.parentNode.removeChild(b);
  }

  // ------------------------------------------------------------------ site status
  async function applyStatus() {
    if (!cfg) return;
    if (cfg.status === 'open') { hideLock(); hideGodBar(); return; }
    if (await resolveGod()) { hideLock(); showGodBar(); }
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
  var TYPE_LABEL = { news: 'Новость', patch: 'Патч', soon: 'Скоро' };

  async function renderNews() {
    var target = document.querySelector('#news-list, [data-amoore-news]');
    if (!target) return;

    function setPlaceholder(msg, isError) {
      target.textContent = '';
      var item = document.createElement('div');
      item.className = 'news-item glass-card';
      if (isError) item.setAttribute('data-amoore-news-error', '1');
      else item.setAttribute('data-amoore-news-placeholder', '1');
      var span = document.createElement('span');
      span.textContent = msg;
      item.appendChild(span);
      target.appendChild(item);
    }

    function paintItems(items) {
      target.textContent = '';
      if (!items || !items.length) {
        setPlaceholder('Здесь пока пусто. Новости появятся из панели amoore Dev.', false);
        return;
      }
      var frag = document.createDocumentFragment();
      items.forEach(function (n) {
        var item = document.createElement('div');
        item.className = 'news-item glass-card';
        item.setAttribute('data-type', n.type || 'news');
        var small = document.createElement('small');
        small.textContent = [TYPE_LABEL[n.type] || '', fmtDate(n)].filter(Boolean).join(' · ');
        var title = document.createElement('b');
        title.textContent = n.title || '';
        var body = document.createElement('span');
        body.textContent = n.body || '';
        item.appendChild(small);
        item.appendChild(title);
        item.appendChild(body);
        frag.appendChild(item);
      });
      target.appendChild(frag);
    }

    // Тумблер новостей выключен
    if (cfg && cfg.news_active === false) {
      setPlaceholder('Редакция готовит материалы. Загляните позже', false);
      return;
    }

    // Skeleton cards avoid a blank/lagging state during the first fetch.
    if (!target.querySelector('[data-type]')) {
      target.innerHTML = '<div class="news-skeleton" aria-hidden="true"><i></i><b></b><span></span></div><div class="news-skeleton" aria-hidden="true"><i></i><b></b><span></span></div><div class="news-skeleton" aria-hidden="true"><i></i><b></b><span></span></div>';
    }

    // 1) Пробуем supabase-js
    // 2) Fallback: прямой REST (тот же anon-ключ) — если клиент завис
    function fetchViaClient() {
      if (!client) return Promise.reject(new Error('no-client'));
      return client
        .from('news')
        .select('id, title, body, type, display_date, published_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(20)
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data || [];
        });
    }

    function fetchViaRest() {
      var url = SB_URL.replace(/\/$/, '') +
        '/rest/v1/news?select=id,title,body,type,display_date,published_at' +
        '&is_published=eq.true&order=published_at.desc&limit=20';
      return fetch(url, {
        method: 'GET',
        headers: {
          'apikey': SB_ANON,
          'Authorization': 'Bearer ' + SB_ANON,
          'Accept': 'application/json'
        }
      }).then(function (r) {
        if (!r.ok) throw new Error('http-' + r.status);
        return r.json();
      });
    }

    function withTimeout(promise, ms) {
      return new Promise(function (resolve, reject) {
        var done = false;
        var timer = setTimeout(function () {
          if (done) return;
          done = true;
          reject(new Error('timeout'));
        }, ms);
        Promise.resolve(promise).then(
          function (v) { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
          function (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } }
        );
      });
    }

    try {
      var items = null;
      try {
        items = await withTimeout(fetchViaClient(), 6000);
      } catch (e1) {
        try {
          items = await withTimeout(fetchViaRest(), 6000);
        } catch (e2) {
          throw e2;
        }
      }
      newsCache = items || [];
      publishState();
      paintItems(items);
      applySeo();
    } catch (e) {
      if (!target.querySelector('[data-type]')) {
        var msg = (e && e.message === 'timeout')
          ? 'Сервер новостей не ответил. Обновите страницу.'
          : 'Не удалось загрузить новости. Проверьте соединение.';
        setPlaceholder(msg, true);
        try { console.warn('[amoore-core] news load failed', e); } catch (x) {}
      }
    }
  }

  // ------------------------------------------------------------------ analytics
  function trackVisit() {
    try {
      if (sessionStorage.getItem(VISIT_KEY)) return;       // 1 визит на сессию вкладки
      if (storedTokens().length) return;                    // админов в статистику не пишем
      sessionStorage.setItem(VISIT_KEY, '1');
    } catch (e) {}
    try { client.from('site_visits').insert({ site_id: SITE_ID }).then(function () {}, function () {}); } catch (e) {}
  }

  // ------------------------------------------------------------------ ecosystem cards + SEO
  async function fetchSites() {
    try {
      if (client) {
        var r = await client.from('ecosystem_sites').select('id,name,url,status').order('id');
        if (r && !r.error && r.data) return r.data;
      }
      var url = SB_URL.replace(/\/$/, '') + '/rest/v1/ecosystem_sites?select=id,name,url,status&order=id';
      var res = await fetch(url, {
        headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Accept': 'application/json' }
      });
      if (!res.ok) return [];
      return await res.json();
    } catch (e) { return []; }
  }

  function renderEcosystem() {
    var grid = document.querySelector('#ecosystem .eco-grid, [data-amoore-ecosystem]');
    if (!grid || !sitesCache.length) return;
    // Не трогаем, если уже есть data-amoore-dynamic
    var existing = grid.querySelectorAll('[data-amoore-site]');
    if (existing.length === sitesCache.length) {
      // refresh links/names
    }
    var frag = document.createDocumentFragment();
    sitesCache.forEach(function (s) {
      if (!s || !s.id) return;
      var art = document.createElement('article');
      art.className = 'eco-card glass-card reveal';
      art.setAttribute('data-amoore-site', s.id);
      var icon = document.createElement('div');
      icon.className = 'eco-card-icon';
      icon.textContent = s.id === 'landing' ? '✦' : (s.id === 'studio' ? '◇' : '◆');
      var h3 = document.createElement('h3');
      h3.textContent = s.name || s.id;
      var p = document.createElement('p');
      p.textContent = s.status === 'open' ? 'Онлайн' : 'На обслуживании';
      var a = document.createElement('a');
      a.className = 'eco-link';
      a.href = s.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Открыть →';
      art.appendChild(icon); art.appendChild(h3); art.appendChild(p); art.appendChild(a);
      frag.appendChild(art);
    });
    if (frag.childNodes.length) {
      grid.textContent = '';
      grid.appendChild(frag);
    }
  }

  function applySeo() {
    if (!cfg) return;
    try {
      var name = cfg.name || 'amoore';
      if (cfg.seo_title) document.title = cfg.seo_title;
      else document.title = name + ' | AI companion';
      var desc = cfg.seo_description || cfg.banner_text || '';
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
  async function fetchConfig() {
    try {
      if (client) {
        var r = await client.from('ecosystem_sites').select('*').eq('id', SITE_ID).maybeSingle();
        if (r && !r.error && r.data) return r.data;
      }
      // REST fallback
      var url = SB_URL.replace(/\/$/, '') + '/rest/v1/ecosystem_sites?select=*&id=eq.' + encodeURIComponent(SITE_ID);
      var res = await fetch(url, {
        headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Accept': 'application/json' }
      });
      if (!res.ok) return null;
      var arr = await res.json();
      return arr && arr[0] ? arr[0] : null;
    } catch (e) { return null; }
  }
  async function fetchBotStatus() {
    try {
      if (client) {
        var r = await client.from('bot_status').select('is_online').eq('id', 'main').maybeSingle();
        if (r && !r.error && r.data) { botOnline = r.data.is_online !== false; return botOnline; }
      }
      var url = SB_URL.replace(/\/$/, '') + '/rest/v1/bot_status?select=is_online&id=eq.main';
      var res = await fetch(url, { headers: { apikey: SB_ANON, Authorization: 'Bearer ' + SB_ANON, Accept: 'application/json' }, signal: AbortSignal.timeout ? AbortSignal.timeout(7000) : undefined });
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
      var s = await fetchSites();
      if (s && s.length) { sitesCache = s; publishState(); renderEcosystem(); }
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

  async function boot() {
    captureGodParam();
    if (window.supabase && window.supabase.createClient) {
      client = window.supabase.createClient(SB_URL, SB_ANON, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    } else {
      console.warn('[amoore-core] supabase-js не загружен — новости через REST fallback');
      client = null;
    }
    trackVisit();
    cfg = await fetchConfig();
    await fetchBotStatus();
    sitesCache = await fetchSites();
    publishState();
    applyConfig();
    applySeo();
    renderEcosystem();
    await renderNews();
    if (client) startLive();
    else {
      setInterval(function () {
        if (document.visibilityState && document.visibilityState !== 'visible') return;
        renderNews();
        fetchBotStatus().then(applyVisibility);
        fetchSites().then(function (s) { sitesCache = s; publishState(); renderEcosystem(); });
      }, POLL_MS);
    }
  }

  function publishConfig() {
    window.AMOORE_CONFIG = cfg;
  }

  window.amooreCore = {
    version: '9.0.0',
    siteId: SITE_ID,
    getConfig: function () { return cfg ? Object.assign({}, cfg) : null; },
    isChatEnabled: function () { return !(cfg && cfg.demo_chat_active === false) && botOnline !== false; },
    isNewsEnabled: function () { return !(cfg && cfg.news_active === false); },
    refresh: async function () {
      var c = await fetchConfig();
      await fetchBotStatus();
      if (c) { cfg = c; publishState(); applyConfig(); applySeo(); }
      else applyVisibility();
      sitesCache = await fetchSites();
      publishState();
      renderEcosystem();
      return renderNews();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
