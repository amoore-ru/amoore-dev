/**
 * amoore-core.js  v4.0 — Mission Control injector
 *
 * window.AMOORE_SITE_ID = 'landing' | 'studio'
 * window.AMOORE_SUPABASE_URL / window.AMOORE_SUPABASE_ANON
 * window.AMOORE_NEWS_SELECTOR = '#news-list'  (optional)
 */
(function () {
  'use strict';

  var SITE_ID  = window.AMOORE_SITE_ID   || 'landing';
  var SB_URL   = window.AMOORE_SUPABASE_URL  || 'https://wogouiecoigzmxqccnsk.supabase.co';
  var SB_ANON  = window.AMOORE_SUPABASE_ANON || 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';
  var AUTH_KEY = 'amoore_dev_auth';
  var NEWS_SEL = window.AMOORE_NEWS_SELECTOR || '#news-list, .news-list, [data-amoore-news]';

  (function captureGodToken() {
    try {
      var params = new URLSearchParams(window.location.search);
      var godToken = params.get('god');
      if (!godToken) return;
      var existing = null;
      try { existing = JSON.parse(sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) {}
      var session = existing && existing.access_token ? existing : { admin_id: 'god-mode', nickname: 'God' };
      session.access_token = godToken;
      session.expires_at = Date.now() + 6 * 60 * 60 * 1000;
      try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (e) {}
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (e) {}
      params.delete('god');
      var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
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

  var OVERLAYS = {
    maintenance: {
      css: '.amoore-lock-screen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:radial-gradient(ellipse at 50% 30%,rgba(212,175,55,0.12),transparent 60%),#070b16;font-family:Manrope,system-ui,sans-serif;color:#e8ecf4}.amoore-lock-card{text-align:center;padding:48px 40px;max-width:420px;margin:20px;background:rgba(16,24,48,0.65);backdrop-filter:blur(24px);border:1px solid rgba(212,175,55,0.28);border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,.5)}.amoore-lock-icon{font-size:48px;margin-bottom:20px}.amoore-lock-title{font-size:22px;font-weight:700;margin-bottom:12px}.amoore-lock-text{font-size:15px;color:#8b95a8;line-height:1.55}',
      html: '<div class="amoore-lock-card"><div class="amoore-lock-icon">⚙️</div><div class="amoore-lock-title">Технические работы</div><div class="amoore-lock-text">Мы проводим технические работы.<br>Скоро вернёмся.</div></div>'
    },
    crash: {
      css: '.amoore-lock-screen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:#0a0a0c;font-family:Manrope,system-ui,sans-serif;color:#f0f0f0;overflow:hidden}.amoore-glitch{font-size:24px;font-weight:800;margin-bottom:16px;animation:amoore-glitch 2.5s infinite}@keyframes amoore-glitch{0%,90%,100%{text-shadow:none}92%{text-shadow:2px 0 #ff0040,-2px 0 #00e5ff}}.amoore-lock-text{font-size:15px;color:#a0a0a8}',
      html: '<div class="amoore-lock-card" style="text-align:center;padding:48px"><div class="amoore-glitch">САЙТ УПАЛ</div><div class="amoore-lock-text">Мы уже чиним.<br>Пожалуйста, подождите.</div></div>'
    },
    private: {
      css: '.amoore-lock-screen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;background:#000;font-family:Manrope,system-ui,sans-serif;color:#fff}.amoore-lock-card{text-align:center;padding:48px 40px;border:1px solid #333}',
      html: '<div class="amoore-lock-card"><div style="font-size:40px;margin-bottom:16px">🔒</div><div style="letter-spacing:.12em;text-transform:uppercase;font-weight:600">Доступ ограничен</div></div>'
    }
  };

  function renderGodBar(siteId) {
    injectStyles('.amoore-god-bar{position:relative;display:flex;align-items:center;justify-content:space-between;padding:10px 20px;background:linear-gradient(90deg,#1a1508,#2a220c);border-bottom:1px solid #d4af37;font-family:Manrope,system-ui,sans-serif;font-size:13px;color:#e8c96a;width:100%;box-sizing:border-box;z-index:999998}.amoore-god-btn{padding:6px 14px;background:#d4af37;color:#0a0e18;border:none;border-radius:8px;font-weight:700;cursor:pointer}');
    var bar = createEl('div', 'amoore-god-bar', '<span><strong>Режим Админа:</strong> Сайт закрыт для всех</span><button class="amoore-god-btn" type="button">Открыть</button>');
    bar.querySelector('.amoore-god-btn').addEventListener('click', function () {
      var client = getClient();
      if (!client) return;
      client.from('ecosystem_sites').update({ status: 'open' }).eq('id', siteId).then(function () { location.reload(); });
    });
    document.body.prepend(bar);
  }

  function showLock(type) {
    var o = OVERLAYS[type] || OVERLAYS.maintenance;
    injectStyles(o.css);
    document.body.appendChild(createEl('div', 'amoore-lock-screen', o.html));
  }

  async function checkStatus(client) {
    try {
      var res = await client.from('ecosystem_sites').select('status, overlay_type').eq('id', SITE_ID).single();
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
        acc[f.key] = !!f.is_enabled; return acc;
      }, {});
    } catch (e) {}
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function formatDate(iso) {
    try { return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  async function renderNews(client) {
    var target = document.querySelector(NEWS_SEL);
    if (!target) return;
    try {
      var res = await client.from('news').select('id, title, body, type, published_at')
        .eq('is_published', true).order('published_at', { ascending: false }).limit(20);
      if (res.error || !res.data || !res.data.length) return;
      var typeLabel = { news: 'Новость', patch: 'Патч', soon: 'Скоро' };
      target.innerHTML = res.data.map(function (n) {
        return '<article class="amoore-news-item" data-type="' + esc(n.type) + '">' +
          '<div class="amoore-news-meta"><span class="amoore-news-type">' + esc(typeLabel[n.type] || n.type) +
          '</span><time>' + esc(formatDate(n.published_at)) + '</time></div>' +
          '<h3 class="amoore-news-title">' + esc(n.title) + '</h3>' +
          '<p class="amoore-news-body">' + esc(n.body) + '</p></article>';
      }).join('');
    } catch (e) {}
  }

  async function boot() {
    var client = getClient();
    if (!client) { console.warn('[amoore-core] Supabase not found'); return; }
    await Promise.all([checkStatus(client), trackVisit(client), applyFlags(client), renderNews(client)]);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
