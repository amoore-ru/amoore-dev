/**
 * amoore-core.js  v4.1 — Bugfix & Mobile Hardening
 *
 * window.AMOORE_SITE_ID / AMOORE_SUPABASE_URL / AMOORE_SUPABASE_ANON
 * window.AMOORE_NEWS_SELECTOR
 * God Mode: ?god=TOKEN  (cross-domain via localStorage)
 */
(function () {
  'use strict';

  var SITE_ID  = window.AMOORE_SITE_ID   || 'landing';
  var SB_URL   = window.AMOORE_SUPABASE_URL  || 'https://wogouiecoigzmxqccnsk.supabase.co';
  var SB_ANON  = window.AMOORE_SUPABASE_ANON || 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';
  var AUTH_KEY = 'amoore_dev_auth';
  var NEWS_SEL = window.AMOORE_NEWS_SELECTOR || '#news-list, .news-list, [data-amoore-news]';

  // ---------- 5. God Mode domain trap: ?god=TOKEN ----------
  (function captureGodToken() {
    try {
      var params = new URLSearchParams(window.location.search);
      var godToken = params.get('god');
      if (!godToken) return;
      var existing = null;
      try {
        existing = JSON.parse(
          sessionStorage.getItem(AUTH_KEY) ||
          localStorage.getItem(AUTH_KEY) ||
          'null'
        );
      } catch (e) {}
      var session = (existing && existing.access_token) ? existing : {
        admin_id: 'god-mode',
        nickname: 'God'
      };
      session.access_token = godToken;
      session.expires_at = Date.now() + 6 * 60 * 60 * 1000;
      try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (e) {}
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (e) {}
      params.delete('god');
      var clean = window.location.pathname +
        (params.toString() ? '?' + params.toString() : '') +
        window.location.hash;
      window.history.replaceState(null, '', clean);
      window.location.reload();
    } catch (e) {}
  })();

  function hasAdminSession() {
    try {
      var raw = sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.access_token) return false;
      if (data.expires_at && Date.now() > data.expires_at) return false;
      return true;
    } catch (e) { return false; }
  }

  function injectStyles(css) {
    var style = document.createElement('style');
    style.setAttribute('data-amoore-core', '1');
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createEl(tag, className, html) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function getClient() {
    if (!window.supabase || !window.supabase.createClient) return null;
    return window.supabase.createClient(SB_URL, SB_ANON);
  }

  // Shared lock CSS — iOS / Telegram WebView hardened
  var LOCK_BASE_CSS = [
    'html.amoore-locked,html.amoore-locked body{',
    'overflow:hidden!important;',
    'overscroll-behavior:none!important;',
    'touch-action:none!important;',
    'height:100%!important;',
    'width:100%!important;',
    '}',
    'body.amoore-locked{',
    'position:fixed!important;',
    'inset:0!important;',
    'overflow:hidden!important;',
    'width:100%!important;',
    'height:100%!important;',
    'height:100dvh!important;',
    'overscroll-behavior:none!important;',
    'touch-action:none!important;',
    '-webkit-overflow-scrolling:auto!important;',
    '}',
    '.amoore-lock-screen{',
    'position:fixed!important;',
    'top:0!important;right:0!important;bottom:0!important;left:0!important;',
    'width:100%!important;',
    'height:100vh!important;',
    'height:100dvh!important;',
    'min-height:100vh!important;',
    'min-height:100dvh!important;',
    'z-index:2147483647!important;',
    'display:flex!important;',
    'align-items:center!important;',
    'justify-content:center!important;',
    'overflow:hidden!important;',
    'overscroll-behavior:none!important;',
    'touch-action:none!important;',
    '-webkit-user-select:none!important;',
    'user-select:none!important;',
    'padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) env(safe-area-inset-bottom,0) env(safe-area-inset-left,0)!important;',
    'box-sizing:border-box!important;',
    'font-family:Manrope,system-ui,-apple-system,sans-serif!important;',
    '}'
  ].join('');

  var OVERLAYS = {
    maintenance: {
      css: LOCK_BASE_CSS + [
        '.amoore-lock-screen{',
        'background:#070b16!important;',
        'background-image:radial-gradient(ellipse at 50% 30%,rgba(212,175,55,0.14),transparent 60%)!important;',
        'color:#e8ecf4!important;',
        '}',
        '.amoore-lock-card{text-align:center;padding:48px 32px;max-width:420px;margin:16px;',
        'background:rgba(16,24,48,0.92);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
        'border:1px solid rgba(212,175,55,0.28);border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.55)}',
        '.amoore-lock-icon{font-size:48px;margin-bottom:20px;line-height:1}',
        '.amoore-lock-title{font-size:22px;font-weight:700;margin-bottom:12px;letter-spacing:-0.02em}',
        '.amoore-lock-text{font-size:15px;color:#8b95a8;line-height:1.55}'
      ].join(''),
      html: '<div class="amoore-lock-card"><div class="amoore-lock-icon">⚙️</div><div class="amoore-lock-title">Технические работы</div><div class="amoore-lock-text">Мы проводим технические работы.<br>Скоро вернёмся.</div></div>'
    },
    crash: {
      css: LOCK_BASE_CSS + [
        '.amoore-lock-screen{background:#0a0a0c!important;color:#f0f0f0!important}',
        '.amoore-lock-screen::before{content:"";position:absolute;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,0,0,.03) 2px,rgba(255,0,0,.03) 4px);pointer-events:none;animation:amoore-scan 4s linear infinite}',
        '@keyframes amoore-scan{to{transform:translateY(40px)}}',
        '.amoore-lock-card{text-align:center;padding:48px 32px;max-width:420px;margin:16px;position:relative;z-index:1}',
        '.amoore-glitch{font-size:24px;font-weight:800;margin-bottom:16px;animation:amoore-glitch 2.5s infinite}',
        '@keyframes amoore-glitch{0%,90%,100%{text-shadow:none}92%{text-shadow:2px 0 #ff0040,-2px 0 #00e5ff}94%{text-shadow:-2px 0 #ff0040,2px 0 #00e5ff}}',
        '.amoore-lock-text{font-size:15px;color:#a0a0a8;line-height:1.55}'
      ].join(''),
      html: '<div class="amoore-lock-card"><div class="amoore-glitch">САЙТ УПАЛ</div><div class="amoore-lock-text">Мы уже чиним.<br>Пожалуйста, подождите.</div></div>'
    },
    private: {
      css: LOCK_BASE_CSS + [
        '.amoore-lock-screen{background:#000!important;color:#fff!important}',
        '.amoore-lock-card{text-align:center;padding:48px 32px;max-width:380px;margin:16px;border:1px solid #333;border-radius:4px}',
        '.amoore-lock-icon{font-size:40px;margin-bottom:20px;opacity:.75;line-height:1}',
        '.amoore-lock-title{font-size:18px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}',
        '.amoore-lock-text{font-size:13px;color:#888;letter-spacing:.04em}'
      ].join(''),
      html: '<div class="amoore-lock-card"><div class="amoore-lock-icon">🔒</div><div class="amoore-lock-title">Доступ ограничен</div><div class="amoore-lock-text">Private access only</div></div>'
    }
  };

  var _lockScrollY = 0;

  function lockBodyScroll() {
    try {
      _lockScrollY = window.scrollY || window.pageYOffset || 0;
      document.documentElement.classList.add('amoore-locked');
      document.body.classList.add('amoore-locked');
      document.body.style.top = '-' + _lockScrollY + 'px';
    } catch (e) {}
  }

  // ---------- 1. Lock screens (iOS / Telegram WebView) ----------
  function showLock(type) {
    var o = OVERLAYS[type] || OVERLAYS.maintenance;
    injectStyles(o.css);
    lockBodyScroll();
    var screen = createEl('div', 'amoore-lock-screen', o.html);
    // Block touchmove bubble (rubber-band)
    screen.addEventListener('touchmove', function (e) {
      e.preventDefault();
    }, { passive: false });
    document.body.appendChild(screen);
  }

  // ---------- 2. God Bar: relative + prepend ----------
  function renderGodBar(siteId) {
    injectStyles([
      '.amoore-god-bar{',
      'position:relative!important;',
      'display:flex;align-items:center;justify-content:space-between;',
      'gap:12px;flex-wrap:wrap;',
      'padding:10px 16px;',
      'padding-top:calc(10px + env(safe-area-inset-top,0px));',
      'background:linear-gradient(90deg,#1a1508,#2a220c);',
      'border-bottom:1px solid #d4af37;',
      'font-family:Manrope,system-ui,sans-serif;font-size:13px;color:#e8c96a;',
      'width:100%;box-sizing:border-box;z-index:999998;',
      '}',
      '.amoore-god-btn{padding:8px 14px;min-height:40px;background:#d4af37;color:#0a0e18;border:none;',
      'border-radius:8px;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer}',
      '.amoore-god-btn:active{transform:scale(0.97)}'
    ].join(''));

    var bar = createEl('div', 'amoore-god-bar',
      '<span><strong>Режим Админа:</strong> Сайт закрыт для всех</span>' +
      '<button class="amoore-god-btn" type="button">Открыть</button>');

    bar.querySelector('.amoore-god-btn').addEventListener('click', function () {
      var client = getClient();
      if (!client) return;
      client.from('ecosystem_sites').update({ status: 'open' }).eq('id', siteId)
        .then(function () { location.reload(); });
    });

    // prepend — сдвигает весь контент вниз, не перекрывает шапку
    document.body.prepend(bar);
  }

  async function checkStatus(client) {
    try {
      var res = await client.from('ecosystem_sites')
        .select('status, overlay_type').eq('id', SITE_ID).single();
      if (res.error || !res.data) return;
      if (res.data.status === 'open') return;
      if (hasAdminSession()) renderGodBar(SITE_ID);
      else showLock(res.data.overlay_type || 'maintenance');
    } catch (e) {}
  }

  async function trackVisit(client) {
    try { await client.from('site_visits').insert({ site_id: SITE_ID }); } catch (e) {}
  }

  async function applyFlags(client) {
    try {
      var res = await client.from('feature_flags').select('key, is_enabled');
      if (res.error || !res.data) return;
      res.data.forEach(function (f) {
        if (f.is_enabled) document.body.classList.add('flag-' + f.key);
        else document.body.classList.remove('flag-' + f.key);
      });
      window.AMOORE_FLAGS = res.data.reduce(function (acc, f) {
        acc[f.key] = !!f.is_enabled;
        return acc;
      }, {});
    } catch (e) {}
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleDateString('ru-RU', {
        day: '2-digit', month: 'short', year: 'numeric'
      });
    } catch (e) { return ''; }
  }

  async function renderNews(client) {
    var target = document.querySelector(NEWS_SEL);
    if (!target) return;
    try {
      var res = await client.from('news')
        .select('id, title, body, type, published_at')
        .eq('is_published', true)
        .order('published_at', { ascending: false })
        .limit(20);
      if (res.error || !res.data || !res.data.length) return;
      var typeLabel = { news: 'Новость', patch: 'Патч', soon: 'Скоро' };
      target.innerHTML = res.data.map(function (n) {
        return '<article class="amoore-news-item" data-type="' + esc(n.type) + '">' +
          '<div class="amoore-news-meta"><span class="amoore-news-type">' +
          esc(typeLabel[n.type] || n.type) + '</span><time>' +
          esc(formatDate(n.published_at)) + '</time></div>' +
          '<h3 class="amoore-news-title">' + esc(n.title) + '</h3>' +
          '<p class="amoore-news-body">' + esc(n.body) + '</p></article>';
      }).join('');
    } catch (e) {}
  }

  async function boot() {
    var client = getClient();
    if (!client) {
      console.warn('[amoore-core] Supabase not found');
      return;
    }
    await Promise.all([
      checkStatus(client),
      trackVisit(client),
      applyFlags(client),
      renderNews(client)
    ]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
