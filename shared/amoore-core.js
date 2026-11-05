/**
 * amoore-core.js — v8.1.1 (Update v1.1 — exact TZ)
 * Один скрипт для всех сайтов экосистемы. Подключение (3 строки в конце body):
 *   <script>window.AMOORE_SITE_ID = 'landing';</script>   // или 'studio'
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="amoore-core.js"></script>
 *
 * Что делает:
 *   1. Статус сайта: closed → заставка (iOS / Telegram WebView hardened)
 *   2. God Mode: ?god=ТОКЕН (токен проверяется на сервере) → сайт открыт + золотая плашка
 *   3. Баннер под шапкой (banner_active / banner_text)
 *   4. Новости → #news-list, секция #news скрывается при news_active = false
 *      + умная очистка плейсхолдера «Загрузка…»
 *   5. Демо-чат: #chat скрывается + жёсткая блокировка (disabled) при demo_chat_active = false
 *   6. Аналитика: INSERT в site_visits (1 раз за сессию вкладки)
 *   7. Live-обновление: Supabase Realtime + страховочный polling
 *   8. Глобальный экспорт: window.amooreCore (config, refresh, version)
 */
(function () {
  'use strict';
  if (window.__amooreCoreLoaded) return;
  window.__amooreCoreLoaded = true;

  var SITE_ID = window.AMOORE_SITE_ID || 'landing';
  var SB_URL  = window.AMOORE_SUPABASE_URL  || 'https://wogouiecoigzmxqccnsk.supabase.co';
  var SB_ANON = window.AMOORE_SUPABASE_ANON || 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';

  var GOD_KEY  = 'amoore_god';        // токен God Mode (этот домен)
  var AUTH_KEY = 'amoore_dev_auth';   // сессия админки (если админка на этом же домене)
  var VISIT_KEY = 'amoore_visit_' + SITE_ID;
  var TTL_MS = 6 * 60 * 60 * 1000;    // 6 часов
  var POLL_MS = 60 * 1000;

  var client = null;
  var cfg = null;          // строка ecosystem_sites для этого сайта
  var godToken = null;     // проверенный токен или null
  var godChecked = false;

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
    styleOnce('amoore-god-css', GOD_CSS);
    var bar = el('div', 'amoore-god-bar',
      '<span><strong>Режим Админа:</strong> сайт закрыт для всех</span>' +
      '<button class="amoore-god-btn" type="button">Открыть сайт</button>');
    bar.id = 'amoore-god-bar';
    bar.querySelector('button').addEventListener('click', async function () {
      var btn = this; btn.disabled = true;
      try {
        var r = await client.rpc('god_open_site', { p_token: godToken, p_site: SITE_ID });
        if (r && r.data === true) { location.reload(); return; }
      } catch (e) {}
      btn.disabled = false; btn.textContent = 'Нет прав';
    });
    document.body.prepend(bar);              // prepend + relative: контент сдвигается, шапка не перекрыта
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
    styleOnce('amoore-hide-css', '.amoore-hidden{display:none!important}');
    var hideChat = !!cfg && cfg.demo_chat_active === false;
    var hideNews = !!cfg && cfg.news_active === false;
    Array.prototype.forEach.call(document.querySelectorAll('#chat, [data-amoore-chat], a[href="#chat"]'), function (n) {
      n.classList.toggle('amoore-hidden', hideChat);
    });
    Array.prototype.forEach.call(document.querySelectorAll('#news, [data-amoore-news-section], a[href="#news"]'), function (n) {
      n.classList.toggle('amoore-hidden', hideNews);
    });

    // 2.2 Жёсткая блокировка чата: disabled на #chat-input / #chat-send + сообщение в лог
    var chatInput = document.getElementById('chat-input');
    var chatSend  = document.getElementById('chat-send');
    var chatLog   = document.getElementById('chat-log');
    if (hideChat) {
      if (chatInput) { chatInput.disabled = true; chatInput.setAttribute('aria-disabled', 'true'); }
      if (chatSend)  { chatSend.disabled  = true; chatSend.setAttribute('aria-disabled', 'true'); }
      // Сообщение от бота один раз (не дублируем)
      if (chatLog && !chatLog.querySelector('[data-amoore-off]')) {
        var row = document.createElement('div');
        row.className = 'chat-bubble chat-bot';
        row.setAttribute('data-amoore-off', '1');
        var name = document.createElement('span');
        name.className = 'chat-name';
        name.textContent = 'amoore';
        var p = document.createElement('p');
        p.textContent = 'Мой создатель забрал меня на обед. Я вернусь, как только он меня включит!';
        row.appendChild(name);
        row.appendChild(p);
        chatLog.appendChild(row);
        try { chatLog.scrollTop = chatLog.scrollHeight; } catch (e) {}
      }
    } else {
      if (chatInput) { chatInput.disabled = false; chatInput.removeAttribute('aria-disabled'); }
      if (chatSend)  { chatSend.disabled  = false; chatSend.removeAttribute('aria-disabled'); }
      if (chatLog) {
        var offMsg = chatLog.querySelector('[data-amoore-off]');
        if (offMsg) offMsg.remove();
      }
    }
  }

  // ------------------------------------------------------------------ news
  var TYPE_LABEL = { news: 'Новость', patch: 'Патч', soon: 'Скоро' };

  async function renderNews() {
    var target = document.querySelector('#news-list, [data-amoore-news]');
    if (!target) return;
    // 2.3 Умная очистка: при выключенных новостях — пустой список + 1 случайный текст
    if (cfg && cfg.news_active === false) {
      target.textContent = '';
      var pauses = [
        'Редакция ушла на перерыв. Скоро вернёмся.',
        'Новости на паузе. Но мы готовим кое-что крутое.',
        'Тишина в эфире...'
      ];
      var item = document.createElement('div');
      item.className = 'news-item glass-card';
      var span = document.createElement('span');
      span.textContent = pauses[Math.floor(Math.random() * pauses.length)];
      item.appendChild(span);
      target.appendChild(item);
      return;
    }
    // Убрать «Загрузка…», если ещё висит
    if (target.childElementCount === 1 && /загрузк/i.test((target.textContent || '').trim())) {
      target.textContent = '';
    }
    try {
      var res = await client.from('news')
        .select('id, title, body, type, display_date, published_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(20);
      if (res.error) throw res.error;
      var items = res.data || [];
      target.textContent = '';
      if (!items.length) {
        var empty = el('div', 'news-item glass-card');
        empty.appendChild(el('span')).textContent = 'Здесь пока пусто.';
        target.appendChild(empty);
        return;
      }
      var frag = document.createDocumentFragment();
      items.forEach(function (n) {
        var item = el('div', 'news-item glass-card');
        item.setAttribute('data-type', n.type || 'news');
        var small = el('small'); small.textContent = [TYPE_LABEL[n.type] || '', fmtDate(n)].filter(Boolean).join(' · ');
        var title = el('b');     title.textContent = n.title || '';
        var text = el('span');   text.textContent = n.body || '';
        item.appendChild(small); item.appendChild(title); item.appendChild(text);
        frag.appendChild(item);
      });
      target.appendChild(frag);
    } catch (e) {
      if (!target.querySelector('[data-type]')) {
        target.textContent = '';
        var err = el('div', 'news-item glass-card');
        err.appendChild(el('span')).textContent = 'Не удалось загрузить новости.';
        target.appendChild(err);
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

  // ------------------------------------------------------------------ config + live
  async function fetchConfig() {
    try {
      var r = await client.from('ecosystem_sites').select('*').eq('id', SITE_ID).maybeSingle();
      return r && !r.error && r.data ? r.data : null;
    } catch (e) { return null; }
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
      if (c) { cfg = c; window.AMOORE_CONFIG = cfg; applyConfig(); renderNews(); }
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
      refreshCfg();
      renderNews();                                   // 2.4 принудительно при возврате на вкладку
    }
    setInterval(tick, POLL_MS);                     // страховка, если Realtime выключен
    document.addEventListener('visibilitychange', tick);
  }

  async function boot() {
    if (!window.supabase || !window.supabase.createClient) {
      console.warn('[amoore-core] supabase-js не загружен');
      return;
    }
    captureGodParam();
    client = window.supabase.createClient(SB_URL, SB_ANON, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    trackVisit();                                   // быстрый INSERT, не ждём остального
    cfg = await fetchConfig();
    window.AMOORE_CONFIG = cfg;                     // 2.1 глобальный экспорт конфига
    applyConfig();
    await renderNews();
    startLive();
  }

  function publishConfig() {
    window.AMOORE_CONFIG = cfg;
  }

  window.amooreCore = {
    version: '8.1.1',
    siteId: SITE_ID,
    getConfig: function () { return cfg ? Object.assign({}, cfg) : null; },
    isChatEnabled: function () { return !(cfg && cfg.demo_chat_active === false); },
    isNewsEnabled: function () { return !(cfg && cfg.news_active === false); },
    refresh: async function () {
      var c = await fetchConfig();
      if (c) { cfg = c; window.AMOORE_CONFIG = cfg; applyConfig(); }
      return renderNews();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
