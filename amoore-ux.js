(function(){try{var d=document.documentElement,a=localStorage.getItem('amoore_text_size'),g=localStorage.getItem('amoore_glass'),S=[.82,.88,.92,1,1.08,1.16,1.26];if(a!==null&&S[+a])d.style.setProperty('--fs',S[+a]);if(g!==null&&+g>=0&&+g<=100)d.style.setProperty('--glass-k',+g/100);}catch(e){}})(); // v5.8.1: размер текста и эффект стекла
/* =====================================================================
   amoore-ux.js — v4.3 POLISH · единая шапка (Unified Topbar) и тема
   ЕДИНЫЙ файл для amoore-dev / amoore-ru / amoore-studio: побайтно одинаков (проверяет run_qa.sh).
   Что делает:
   • тема Тёмная/Светлая: хранится в localStorage["theme"], ставит data-theme на <html> до отрисовки;
   • шапка .ux-topbar: бургер-меню на мобильных, кнопка темы, шестерёнка (только админам),
     блок пользователя и «Выйти» (по сессии админа из localStorage["amoore_dev_auth"]);
   • чип версии: клик → событие "amoore:changelog" (каждый сайт открывает свою модалку Changelog).
   Не зависит от Supabase и других скриптов.
   ===================================================================== */
(function () {
  'use strict';
  if (window.amooreUX) return;

  var THEME_KEY = 'theme';
  var LEGACY_THEME_KEY = 'amoore-studio-theme-v2';   // старый ключ Студии — переносим один раз
  var AUTH_KEY = 'amoore_dev_auth';                   // сессия админа (общий ключ экосистемы)
  var GOD_KEY = 'amoore_god';
  var BAR_COLOR = { dark: '#070b16', light: '#f3f1f8' };
  var root = document.documentElement;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }

  // ------------------------------------------------------------------ тема
  function systemTheme() {
    try { if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'; } catch (e) {}
    return 'dark';
  }
  // три режима: 'light' | 'dark' | 'system' (нет записи = «системная»). data-theme всегда light|dark (итог), data-theme-pref — выбор человека
  function themePref() {
    var t = lsGet(THEME_KEY) || lsGet(LEGACY_THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  }
  function readTheme() { var p = themePref(); return p === 'system' ? systemTheme() : p; }
  var THEME_LABEL = { system: 'Тема: системная', light: 'Тема: светлая', dark: 'Тема: тёмная' };
  var AUTO_ICO = '<svg class="ux-ico-auto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>';
  function paintTheme(t) {
    root.setAttribute('data-theme', t);
    root.setAttribute('data-theme-pref', themePref());
    root.style.colorScheme = t;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', BAR_COLOR[t]);
    var btns = document.querySelectorAll('[data-ux-theme]');
    for (var j = 0; j < btns.length; j++) {
      if (!btns[j].querySelector('.ux-ico-auto')) btns[j].insertAdjacentHTML('beforeend', AUTO_ICO);
      var pref = themePref(), nextName = pref === 'system' ? 'светлая' : pref === 'light' ? 'тёмная' : 'системная';
      btns[j].setAttribute('aria-label', THEME_LABEL[pref] + '. Нажмите — ' + nextName);
      btns[j].setAttribute('title', THEME_LABEL[pref]);
      btns[j].setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    }
  }
  function setTheme(p) {
    p = p === 'light' || p === 'dark' ? p : 'system';
    if (p === 'system') { try { localStorage.removeItem(THEME_KEY); localStorage.removeItem(LEGACY_THEME_KEY); } catch (e) {} } else lsSet(THEME_KEY, p);
    var t = readTheme();
    paintTheme(t);
    try { document.dispatchEvent(new CustomEvent('amoore:theme', { detail: { theme: t, pref: p } })); } catch (e) {}
    return t;
  }
  function getTheme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function toggleTheme() { var p = themePref(); return setTheme(p === 'system' ? 'light' : p === 'light' ? 'dark' : 'system'); }
  try {   // «системная» тема следует за ОС «на лету»
    var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)');
    var onMq = function () { if (themePref() === 'system') paintTheme(readTheme()); };
    if (mq) { if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }
  } catch (e) {}

  paintTheme(readTheme());     // до первой отрисовки: скрипт подключается в <head>

  // ------------------------------------------------------------------ версия
  // v6.0: чип версии на главном экране — только мажор: 5.8.0 → «v5». Полная запись (v6.1.1) — только внутри Changelog (core: fmtVerFull).
  function shortVer(v) { var m = /^\s*v?(\d+)/i.exec(String(v == null ? '' : v)); return m ? m[1] : String(v == null ? '' : v); }
  function setVersion(v) {
    var chips = document.querySelectorAll('[data-ux-chip]');
    for (var i = 0; i < chips.length; i++) chips[i].textContent = 'v' + shortVer(v);
  }

  // ------------------------------------------------------------------ пользователь
  function session() {
    try {
      var raw = lsGet(AUTH_KEY) || sessionStorage.getItem(AUTH_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.access_token) return null;
      if (d.expires_at && Date.now() > d.expires_at) return null;
      return d;
    } catch (e) { return null; }
  }
  function each(sel, fn) { var n = document.querySelectorAll(sel); for (var i = 0; i < n.length; i++) fn(n[i]); }
  function setUser(u) {
    var on = !!u;
    var pc = window.amooreProfileCache;      // v5.2: ник и роль — из единого профиля amoore id
    var name = on ? String((pc && pc.display_name) || u.nickname || u.name || u.email || 'Пользователь') : '';
    var isAdmin = on && (u.role === 'super_admin' || u.role === 'admin' || (pc && pc.role === 'super_admin'));
    each('[data-ux-user]', function (n) { n.hidden = !on; });
    each('[data-ux-logout]', function (n) { n.hidden = !on; });
    each('[data-ux-settings]', function (n) { n.hidden = !isAdmin; });
    each('[data-ux-user-name]', function (n) { n.textContent = name; });
    each('[data-ux-avatar]', function (n) {
      n.textContent = name ? name.charAt(0).toUpperCase() : '';
      if (pc && pc.avatar_color) { n.style.background = pc.avatar_color; n.style.color = '#17151d'; }
    });
  }
  function clearUser() { setUser(null); }
  document.addEventListener('amoore:profile', function () { var s = session(); if (s) setUser(s); });
  function logout() {
    var ev;
    try { ev = new CustomEvent('amoore:logout', { cancelable: true }); } catch (e) { ev = null; }
    if (ev && !document.dispatchEvent(ev)) return;   // сайт сам обработал выход (админка)
    lsDel(AUTH_KEY); lsDel(GOD_KEY);
    location.reload();
  }

  // ------------------------------------------------------------------ меню (бургер)
  function bar() { return document.querySelector('.ux-topbar'); }
  // v6.0: бургер-меню удалено навсегда (навигация — пилюли). setMenu оставлен только как внутренний сброс состояния.
  function setMenu(open) {
    var b = bar(); if (!b) return;
    b.classList.toggle('open', open);
    root.classList.toggle('ux-menu-open', open);
  }
  function closeMenu() { setMenu(false); }

  function init() {
    var b = bar();
    paintTheme(getTheme());
    if (!b) return;
    each('[data-ux-theme]', function (n) { n.addEventListener('click', toggleTheme); });
    each('[data-ux-logout]', function (n) { n.addEventListener('click', logout); });
    each('[data-ux-chip]', function (n) {
      n.addEventListener('click', function () {
        closeMenu();
        try { document.dispatchEvent(new CustomEvent('amoore:changelog')); } catch (e) {}
      });
    });
    // нажатие на пункт меню закрывает выпадашку (мобильные)
    each('.ux-nav a, .ux-nav button, .ux-settings-link', function (n) { n.addEventListener('click', closeMenu); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && b.classList.contains('open')) {
        closeMenu();
      }
    });
    document.addEventListener('click', function (e) {
      if (b.classList.contains('open') && !e.target.closest('.ux-topbar')) closeMenu();
    });
    window.addEventListener('resize', function () { if (window.innerWidth > 1359) closeMenu(); });
    setUser(session());
    window.addEventListener('storage', function (e) {
      if (e.key === AUTH_KEY || e.key === THEME_KEY) {
        if (e.key === THEME_KEY) paintTheme(readTheme()); else setUser(session());
      }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.amooreUX = {
    version: '4.4',
    getTheme: getTheme, getThemePref: themePref, setTheme: setTheme, toggleTheme: toggleTheme,
    setUser: setUser, clearUser: clearUser, session: session,
    setVersion: setVersion, shortVer: shortVer, closeMenu: closeMenu
  };
})();

/* v6.1: у вкладок навигации-пилюли на широком экране виден только значок — подпись дублируем в title (подсказка при наведении) */
(function () {
  function label() {
    var tabs = document.querySelectorAll('.ux-tab, .spa-tab');
    for (var i = 0; i < tabs.length; i++) {
      var el = tabs[i]; if (el.getAttribute('title')) continue;
      var s = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s*\d+\s*$/, '').replace(/\s+/g, ' ').trim();
      if (s) el.setAttribute('title', s);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', label); else label();
})();
