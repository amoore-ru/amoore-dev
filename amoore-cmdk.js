/**
 * amoore-cmdk.js — v5.2.0 · Command Palette (Cmd/Ctrl+K). Побайтно одинаков во всех сайтах.
 * Команды: переход между сайтами (с SSO, если вы вошли), смена темы, поиск новостей из AMOORE_STATE.news.
 * Расширение: amooreCmdk.register({ title, hint, run }).
 */
(function () {
  'use strict';
  if (window.amooreCmdk) return;
  var SITES = { 'Лендинг': 'https://amoore.ru/', 'Студия': 'https://amoore-studio.pages.dev/', 'Админка': 'https://amoore-dev.pages.dev/' };
  var TARGET = { 'Лендинг': 'landing', 'Студия': 'studio', 'Админка': 'dev' };
  var extra = [], ov = null, sel = 0, shown = [];

  function css() {
    if (document.getElementById('cmdk-css')) return; var s = document.createElement('style'); s.id = 'cmdk-css';
    s.textContent = '#cmdk{position:fixed;inset:0;z-index:100000;display:flex;justify-content:center;align-items:flex-start;padding:max(10vh,env(safe-area-inset-top)) 12px 12px;background:rgba(7,11,22,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);animation:cmdkFade .18s ease}' +
      '#cmdk .box{width:100%;max-width:560px;border-radius:18px;overflow:hidden;color:var(--nx-ink,#eef0f7);background:var(--nx-modal-bg,rgba(13,18,32,.95));border:var(--nx-glass-border,1px solid rgba(212,175,55,.2));box-shadow:var(--nx-glass-shadow,0 8px 32px rgba(0,0,0,.4));animation:cmdkPop .35s cubic-bezier(.34,1.56,.64,1)}' +
      '#cmdk input{width:100%;box-sizing:border-box;padding:16px;border:0;border-bottom:1px solid rgba(212,175,55,.15);background:transparent;color:inherit;font:16px var(--nx-font-body,system-ui);outline:none}' +
      '#cmdk ul{list-style:none;margin:0;padding:6px;max-height:50vh;overflow:auto}#cmdk li{padding:11px 12px;border-radius:10px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;font:14px var(--nx-font-body,system-ui)}' +
      '#cmdk li small{color:var(--nx-muted,#8b90a5)}#cmdk li.on{background:rgba(212,175,55,.14)}@keyframes cmdkFade{from{opacity:0}}@keyframes cmdkPop{from{opacity:0;transform:translateY(-12px) scale(.96)}}' +
      '@media (prefers-reduced-motion:reduce){#cmdk,#cmdk .box{animation:none}}';
    document.head.appendChild(s);
  }
  function go(name) {
    var id = window.amooreID, t = TARGET[name];
    if (id && id.sb && t) return id.getProfile().then(function (p) { return p && p.onboarded ? id.ssoOpen(t) : window.open(SITES[name], '_blank', 'noopener'); }).catch(function () { window.open(SITES[name], '_blank', 'noopener'); });
    window.open(SITES[name], '_blank', 'noopener');
  }
  function commands(q) {
    var list = Object.keys(SITES).map(function (n) { return { title: 'Перейти: ' + n, hint: 'сайт', run: function () { go(n); } }; });
    list.push({ title: 'Сменить тему', hint: 'оформление', run: function () { if (window.amooreUX && amooreUX.toggleTheme) amooreUX.toggleTheme(); else { var r = document.documentElement, t = r.getAttribute('data-theme') === 'light' ? 'dark' : 'light'; r.setAttribute('data-theme', t); try { localStorage.setItem('theme', t); } catch (e) {} } } });
    if (window.amooreID && amooreID.sb) list.push({ title: 'Профиль и устройства', hint: 'аккаунт', run: function () { amooreID.openProfile(); } });
    // v5.2: поиск по разделам текущего сайта — вкладки шапки (на всех сайтах это .ux-tab)
    var tabs = document.querySelectorAll('.ux-tab'), seen = {};
    Array.prototype.forEach.call(tabs, function (t) {
      var name = (t.firstChild && t.firstChild.nodeType === 3 ? t.firstChild.textContent : t.textContent || '').replace(/\s+/g, ' ').trim();
      if (!name || seen[name] || t.hidden || t.offsetParent === null && !t.getClientRects().length && false) return; seen[name] = 1;
      list.unshift({ title: 'Раздел: ' + name, hint: 'навигация', run: function () { t.click(); } });
    });
    list = list.concat(extra);
    var news = (window.AMOORE_STATE && AMOORE_STATE.news) || [];
    if (q) news.forEach(function (n) { if (n && n.title) list.push({ title: n.title, hint: 'новость', run: function () { var el = document.querySelector('[data-news-id="' + n.id + '"]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); else location.hash = '#news'; } }); });
    q = (q || '').toLowerCase().trim();
    return q ? list.filter(function (c) { return c.title.toLowerCase().indexOf(q) > -1; }).slice(0, 30) : list.filter(function (c) { return c.hint !== 'новость'; });
  }
  function paint(ul, q) {
    shown = commands(q); sel = Math.min(sel, Math.max(shown.length - 1, 0)); ul.textContent = '';
    if (!shown.length) { var e = document.createElement('li'); e.textContent = 'Ничего не найдено'; ul.appendChild(e); return; }
    shown.forEach(function (c, i) {
      var li = document.createElement('li'); if (i === sel) li.className = 'on';
      var a = document.createElement('span'); a.textContent = c.title; var b = document.createElement('small'); b.textContent = c.hint;
      li.appendChild(a); li.appendChild(b); li.addEventListener('click', function () { run(c); }); ul.appendChild(li);
    });
  }
  function run(c) { close(); try { c.run(); } catch (e) {} }
  function close() { if (ov) { ov.remove(); ov = null; } }
  function open() {
    if (ov) return; css(); ov = document.createElement('div'); ov.id = 'cmdk'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Командная палитра');
    var box = document.createElement('div'); box.className = 'box'; var inp = document.createElement('input'); inp.placeholder = 'Поиск: новости, сайты, тема…'; inp.setAttribute('aria-label', 'Поиск');
    var ul = document.createElement('ul'); box.appendChild(inp); box.appendChild(ul); ov.appendChild(box); document.body.appendChild(ov);
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); }); sel = 0; paint(ul, ''); inp.focus();
    inp.addEventListener('input', function () { sel = 0; paint(ul, inp.value); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); paint(ul, inp.value); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); paint(ul, inp.value); e.preventDefault(); }
      else if (e.key === 'Enter' && shown[sel]) run(shown[sel]);
    });
  }
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key || '').toLowerCase() === 'k') { e.preventDefault(); ov ? close() : open(); }
    else if (e.key === 'Escape') close();
  });
  window.amooreCmdk = { open: open, close: close, register: function (c) { extra.push(c); } };
})();
