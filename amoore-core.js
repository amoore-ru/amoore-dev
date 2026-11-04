/**
 * amoore-core.js  v2.0
 * Скрипт-инжектор статуса сайтов экосистемы amoore.
 *
 * Подключение (перед </body>):
 *   <script>
 *     window.AMOORE_SITE_ID = 'landing'; // или 'studio'
 *     window.AMOORE_SUPABASE_URL = 'https://wogouiecoigzmxqccnsk.supabase.co';
 *     window.AMOORE_SUPABASE_ANON = 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';
 *   </script>
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="/path/to/amoore-core.js"></script>
 *
 * God Mode через URL:  ?god=ВАШ_ТОКЕН
 *   → токен сохраняется в sessionStorage и страница перезагружается.
 */
(function () {
  'use strict';

  // ---------- Config ----------
  var SITE_ID  = window.AMOORE_SITE_ID   || 'landing';
  var SB_URL   = window.AMOORE_SUPABASE_URL  || 'https://YOUR_PROJECT.supabase.co';
  var SB_ANON  = window.AMOORE_SUPABASE_ANON || 'YOUR_ANON_KEY';
  var AUTH_KEY = 'amoore_dev_auth';

  // ---------- ?god=TOKEN → sessionStorage + reload ----------
  (function captureGodToken() {
    try {
      var params = new URLSearchParams(window.location.search);
      var godToken = params.get('god');
      if (!godToken) return;

      // Сохраняем минимальную сессию, чтобы hasAdminSession() сработал
      var existing = null;
      try { existing = JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); } catch (e) {}
      var session = existing && existing.admin_id ? existing : {
        admin_id: 'god-mode',
        access_token: godToken,
        nickname: 'God'
      };
      session.access_token = godToken;
      session.expires_at = Date.now() + 6 * 60 * 60 * 1000;
      try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (e) {}
      try { localStorage.setItem(AUTH_KEY, JSON.stringify(session)); } catch (e) {}

      // Убираем параметр из URL и перезагружаем
      params.delete('god');
      var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
      window.history.replaceState(null, '', clean);
      window.location.reload();
    } catch (e) {
      console.warn('[amoore-core] god token capture failed', e);
    }
  })();

  // ---------- Helpers ----------
  function hasAdminSession() {
    try {
      var raw = sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      if (!data || !data.access_token) return false;
      if (data.expires_at && Date.now() > data.expires_at) return false;
      return true;
    } catch (e) {
      return false;
    }
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

  // ---------- Overlay templates ----------
  var OVERLAYS = {
    maintenance: {
      css: [
        '.amoore-lock-screen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;',
        'background:radial-gradient(ellipse at 50% 30%,rgba(212,175,55,0.12),transparent 60%),#070b16;',
        'font-family:Manrope,system-ui,sans-serif;color:#e8ecf4;}',
        '.amoore-lock-card{text-align:center;padding:48px 40px;max-width:420px;margin:20px;',
        'background:rgba(16,24,48,0.65);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);',
        'border:1px solid rgba(212,175,55,0.28);border-radius:20px;box-shadow:0 12px 48px rgba(0,0,0,0.5);}',
        '.amoore-lock-icon{font-size:48px;margin-bottom:20px;line-height:1;}',
        '.amoore-lock-title{font-size:22px;font-weight:700;margin-bottom:12px;letter-spacing:-0.02em;}',
        '.amoore-lock-text{font-size:15px;color:#8b95a8;line-height:1.55;}'
      ].join(''),
      html: [
        '<div class="amoore-lock-card">',
        '<div class="amoore-lock-icon">⚙️</div>',
        '<div class="amoore-lock-title">Технические работы</div>',
        '<div class="amoore-lock-text">Мы проводим технические работы.<br>Скоро вернёмся.</div>',
        '</div>'
      ].join('')
    },

    crash: {
      css: [
        '.amoore-lock-screen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;',
        'background:#0a0a0c;font-family:Manrope,system-ui,sans-serif;color:#f0f0f0;overflow:hidden;}',
        '.amoore-lock-screen::before{content:"";position:absolute;inset:0;background:',
        'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(255,0,0,0.03) 2px,rgba(255,0,0,0.03) 4px);',
        'pointer-events:none;animation:amoore-scan 4s linear infinite;}',
        '@keyframes amoore-scan{0%{transform:translateY(0)}100%{transform:translateY(40px)}}',
        '.amoore-lock-card{text-align:center;padding:48px 40px;max-width:420px;margin:20px;position:relative;z-index:1;}',
        '.amoore-glitch{font-size:24px;font-weight:800;letter-spacing:-0.03em;margin-bottom:16px;',
        'animation:amoore-glitch 2.5s infinite;position:relative;}',
        '@keyframes amoore-glitch{',
        '0%,90%,100%{transform:translate(0);text-shadow:none;}',
        '92%{transform:translate(-3px,1px);text-shadow:2px 0 #ff0040,-2px 0 #00e5ff;}',
        '94%{transform:translate(3px,-1px);text-shadow:-2px 0 #ff0040,2px 0 #00e5ff;}',
        '96%{transform:translate(-2px,0);text-shadow:2px 0 #ff0040,-2px 0 #00e5ff;}',
        '}',
        '.amoore-lock-text{font-size:15px;color:#a0a0a8;line-height:1.55;}'
      ].join(''),
      html: [
        '<div class="amoore-lock-card">',
        '<div class="amoore-glitch">САЙТ УПАЛ</div>',
        '<div class="amoore-lock-text">Мы уже чиним.<br>Пожалуйста, подождите.</div>',
        '</div>'
      ].join('')
    },

    private: {
      css: [
        '.amoore-lock-screen{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;',
        'background:#000;font-family:Manrope,system-ui,sans-serif;color:#fff;}',
        '.amoore-lock-card{text-align:center;padding:48px 40px;max-width:380px;margin:20px;',
        'border:1px solid #333;border-radius:4px;}',
        '.amoore-lock-icon{font-size:40px;margin-bottom:20px;opacity:0.7;}',
        '.amoore-lock-title{font-size:18px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:10px;}',
        '.amoore-lock-text{font-size:13px;color:#888;letter-spacing:0.04em;}'
      ].join(''),
      html: [
        '<div class="amoore-lock-card">',
        '<div class="amoore-lock-icon">🔒</div>',
        '<div class="amoore-lock-title">Доступ ограничен</div>',
        '<div class="amoore-lock-text">Private access only</div>',
        '</div>'
      ].join('')
    }
  };

  // ---------- God Mode panel (position: relative + prepend) ----------
  function renderGodBar(siteId) {
    injectStyles([
      '.amoore-god-bar{position:relative;display:flex;align-items:center;',
      'justify-content:space-between;padding:10px 20px;background:linear-gradient(90deg,#1a1508,#2a220c);',
      'border-bottom:1px solid #d4af37;font-family:Manrope,system-ui,sans-serif;font-size:13px;color:#e8c96a;',
      'box-shadow:0 4px 20px rgba(0,0,0,0.4);width:100%;box-sizing:border-box;z-index:999998;}',
      '.amoore-god-bar strong{font-weight:700;}',
      '.amoore-god-btn{padding:6px 14px;background:#d4af37;color:#0a0e18;border:none;border-radius:8px;',
      'font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;transition:transform 0.15s;}',
      '.amoore-god-btn:active{transform:scale(0.95);}'
    ].join(''));

    var bar = createEl('div', 'amoore-god-bar');
    bar.innerHTML = [
      '<span><strong>Режим Админа:</strong> Сайт закрыт для всех</span>',
      '<button class="amoore-god-btn" type="button">Открыть</button>'
    ].join('');

    bar.querySelector('.amoore-god-btn').addEventListener('click', function () {
      openSiteFromGodMode(siteId);
    });

    // prepend — сдвигает контент вниз, не перекрывает шапку
    document.body.prepend(bar);
  }

  async function openSiteFromGodMode(siteId) {
    if (!window.supabase || !window.supabase.createClient) {
      alert('Supabase client не загружен');
      return;
    }
    var client = window.supabase.createClient(SB_URL, SB_ANON);
    var result = await client
      .from('ecosystem_sites')
      .update({ status: 'open' })
      .eq('id', siteId);

    if (result.error) {
      alert('Ошибка открытия: ' + result.error.message);
      return;
    }
    location.reload();
  }

  // ---------- Lock screen ----------
  function showLock(type) {
    var overlay = OVERLAYS[type] || OVERLAYS.maintenance;
    injectStyles(overlay.css);
    var screen = createEl('div', 'amoore-lock-screen', overlay.html);
    document.body.appendChild(screen);
  }

  // ---------- Fetch status ----------
  async function checkStatus() {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('[amoore-core] Supabase JS not found, skipping status check');
      return;
    }

    var client = window.supabase.createClient(SB_URL, SB_ANON);

    try {
      var result = await client
        .from('ecosystem_sites')
        .select('status, overlay_type')
        .eq('id', SITE_ID)
        .single();

      if (result.error || !result.data) {
        console.warn('[amoore-core] status fetch failed', result.error);
        return;
      }

      var data = result.data;
      if (data.status === 'open') return;

      if (hasAdminSession()) {
        renderGodBar(SITE_ID);
      } else {
        showLock(data.overlay_type || 'maintenance');
      }
    } catch (err) {
      console.warn('[amoore-core] error', err);
    }
  }

  // ---------- Boot ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkStatus);
  } else {
    checkStatus();
  }
})();
