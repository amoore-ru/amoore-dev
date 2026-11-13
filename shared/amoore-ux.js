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
  function readTheme() {
    var t = lsGet(THEME_KEY) || lsGet(LEGACY_THEME_KEY);
    return t === 'light' || t === 'dark' ? t : systemTheme();
  }
  function paintTheme(t) {
    root.setAttribute('data-theme', t);
    root.style.colorScheme = t;
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < metas.length; i++) metas[i].setAttribute('content', BAR_COLOR[t]);
    var btns = document.querySelectorAll('[data-ux-theme]');
    for (var j = 0; j < btns.length; j++) {
      btns[j].setAttribute('aria-label', t === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему');
      btns[j].setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    }
  }
  function setTheme(t) {
    t = t === 'light' ? 'light' : 'dark';
    lsSet(THEME_KEY, t);
    paintTheme(t);
    try { document.dispatchEvent(new CustomEvent('amoore:theme', { detail: { theme: t } })); } catch (e) {}
    return t;
  }
  function getTheme() { return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function toggleTheme() { return setTheme(getTheme() === 'dark' ? 'light' : 'dark'); }

  paintTheme(readTheme());     // до первой отрисовки: скрипт подключается в <head>

  // ------------------------------------------------------------------ версия
  function shortVer(v) { return String(v == null ? '' : v).replace(/^(\d+\.\d+)\.0$/, '$1'); }
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
    var name = on ? String(u.nickname || u.name || u.email || 'Admin') : '';
    var isAdmin = on && (u.role === 'super_admin' || u.role === 'admin');
    each('[data-ux-user]', function (n) { n.hidden = !on; });
    each('[data-ux-logout]', function (n) { n.hidden = !on; });
    each('[data-ux-settings]', function (n) { n.hidden = !isAdmin; });
    each('[data-ux-user-name]', function (n) { n.textContent = name; });
    each('[data-ux-avatar]', function (n) { n.textContent = name ? name.charAt(0).toUpperCase() : ''; });
  }
  function clearUser() { setUser(null); }
  function logout() {
    var ev;
    try { ev = new CustomEvent('amoore:logout', { cancelable: true }); } catch (e) { ev = null; }
    if (ev && !document.dispatchEvent(ev)) return;   // сайт сам обработал выход (админка)
    lsDel(AUTH_KEY); lsDel(GOD_KEY);
    location.reload();
  }

  // ------------------------------------------------------------------ меню (бургер)
  function bar() { return document.querySelector('.ux-topbar'); }
  function setMenu(open) {
    var b = bar(); if (!b) return;
    b.classList.toggle('open', open);
    root.classList.toggle('ux-menu-open', open);
    each('[data-ux-burger]', function (n) {
      n.setAttribute('aria-expanded', open ? 'true' : 'false');
      n.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
    });
  }
  function closeMenu() { setMenu(false); }

  function init() {
    var b = bar();
    paintTheme(getTheme());
    if (!b) return;
    each('[data-ux-theme]', function (n) { n.addEventListener('click', toggleTheme); });
    each('[data-ux-burger]', function (n) {
      n.addEventListener('click', function (e) { e.stopPropagation(); setMenu(!b.classList.contains('open')); });
    });
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
        var burger = b.querySelector('[data-ux-burger]'); if (burger) burger.focus();
      }
    });
    document.addEventListener('click', function (e) {
      if (b.classList.contains('open') && !e.target.closest('.ux-topbar')) closeMenu();
    });
    window.addEventListener('resize', function () { if (window.innerWidth > 1119) closeMenu(); });
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
    getTheme: getTheme, setTheme: setTheme, toggleTheme: toggleTheme,
    setUser: setUser, clearUser: clearUser, session: session,
    setVersion: setVersion, shortVer: shortVer, closeMenu: closeMenu
  };
})();
