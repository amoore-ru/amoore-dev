// amoore Dev Mission Control v7.0 — Smart Toggles
const SUPABASE_URL  = 'https://wogouiecoigzmxqccnsk.supabase.co';
const SUPABASE_ANON = 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const SESSION_KEY = 'amoore_dev_auth';
const EMAIL_KEY = 'amoore_dev_email';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const ROLE_DEFAULTS = {
  super_admin: { toggle_sites: true, manage_news: true, view_logs: true, manage_admins: true },
  admin:       { toggle_sites: true, manage_news: true, view_logs: true, manage_admins: false },
  moderator:   { toggle_sites: false, manage_news: false, view_logs: false, manage_admins: false }
};

const $ = (id) => document.getElementById(id);
let currentAdmin = null;
let pendingCloseSiteId = null;
let tokenOnlyMode = false;
let permsTargetId = null;
let permsDraft = null;

function saveSession(data) {
  const payload = { ...data, expires_at: Date.now() + SESSION_TTL_MS };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (_) {}
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (_) {}
  if (data.email) try { localStorage.setItem(EMAIL_KEY, data.email); } catch (_) {}
}
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.admin_id) return null;
    if (data.expires_at && Date.now() > data.expires_at) {
      try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
      try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
      return null;
    }
    return data;
  } catch { return null; }
}
function clearSession(full = false) {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  if (full) try { localStorage.removeItem(EMAIL_KEY); } catch (_) {}
}
function rememberedEmail() {
  try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; }
}
function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/failed to fetch|networkerror|load failed/i.test(msg)) return 'Нет связи с Supabase. Проверьте URL/ключ.';
  if (/invalid login credentials/i.test(msg)) return 'Неверный email или пароль';
  if (/column .* does not exist|schema cache|could not find the/i.test(msg)) return 'В БД нет новых колонок — выполните SQL-миграцию v7';
  if (/row-level security|violates row-level/i.test(msg)) return 'Недостаточно прав в БД (RLS). Проверьте SQL-миграцию v7';
  return msg || 'Ошибка';
}
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function todayISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function fmtDate(v) {
  // 'YYYY-MM-DD' -> 'ДД.ММ.ГГГГ' (без сдвига часовых поясов); произвольный текст — как есть
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v);
}
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch (_) {}
  try { // fallback: iOS / http / старые WebView
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
    document.body.appendChild(ta);
    ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (_) { return false; }
}
const ACTION_LABELS = {
  close: 'Закрыл', open: 'Открыл',
  banner_on: 'Включил баннер', banner_off: 'Выключил баннер', banner_edit: 'Изменил баннер',
  chat_on: 'Включил чат', chat_off: 'Выключил чат', site_add: 'Добавил сайт'
};
async function logAction(action, siteId, overlay = null) {
  try {
    await sb.from('audit_logs').insert({ admin_id: currentAdmin.admin_id, action, site_id: siteId, overlay_type: overlay });
  } catch (_) {}
}
function showToast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast visible ' + type;
  setTimeout(() => el.classList.remove('visible'), 2800);
}

function resolvePermissions(role, custom) {
  const base = { ...(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.moderator) };
  if (custom && typeof custom === 'object') {
    ['toggle_sites', 'manage_news', 'view_logs', 'manage_admins'].forEach(k => {
      if (typeof custom[k] === 'boolean') base[k] = custom[k];
    });
  }
  return base;
}
function can(key) {
  if (!currentAdmin) return false;
  const p = currentAdmin.permissions_resolved || resolvePermissions(currentAdmin.role, currentAdmin.permissions);
  return !!p[key];
}
function isSuper() { return currentAdmin?.role === 'super_admin'; }

async function verifyAdmin(email, accessToken) {
  const { data: admin, error } = await sb.from('admins').select('*')
    .eq('email', email).eq('access_token', accessToken).single();
  if (error || !admin) throw new Error('Неверный токен или аккаунт не найден');
  const resolved = resolvePermissions(admin.role, admin.permissions);
  return {
    admin_id: admin.id,
    email: admin.email,
    nickname: admin.nickname,
    name: admin.name,
    role: admin.role,
    access_token: accessToken,
    permissions: admin.permissions || null,
    permissions_resolved: resolved
  };
}
async function loginFull(email, password, accessToken) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  const session = await verifyAdmin(email, accessToken);
  saveSession(session);
  return session;
}
async function loginTokenOnly(email, accessToken) {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error('NEED_PASSWORD');
  const session = await verifyAdmin(email, accessToken);
  saveSession(session);
  return session;
}

function setLoginMode(tokenOnly) {
  tokenOnlyMode = tokenOnly;
  $('email-group').style.display = tokenOnly ? 'none' : '';
  $('password-group').style.display = tokenOnly ? 'none' : '';
  $('email').required = !tokenOnly;
  $('password').required = !tokenOnly;
  $('full-login-btn').style.display = tokenOnly ? 'block' : 'none';
  const em = rememberedEmail();
  if (em) $('email').value = em;
}
function showLogin(preferTokenOnly) {
  $('login-screen').style.display = 'flex';
  $('app').classList.remove('visible');
  $('login-error').classList.remove('visible');
  $('password').value = '';
  $('token').value = '';
  setLoginMode(!!(preferTokenOnly && rememberedEmail()));
}
function showApp(admin) {
  currentAdmin = admin;
  currentAdmin.permissions_resolved = resolvePermissions(admin.role, admin.permissions);
  $('login-screen').style.display = 'none';
  $('app').classList.add('visible');
  $('admin-nickname').textContent = admin.nickname || admin.name || admin.email;
  applyRoleUI();
  if ($('news-date') && !$('news-date').value) $('news-date').value = todayISO();
  switchView('dashboard');
  loadDashboard();
}
function applyRoleUI() {
  const map = {
    dashboard: true,
    media: isSuper() || can('manage_news') || currentAdmin?.role === 'admin',
    settings: isSuper(),
    team: isSuper() || can('manage_admins'),
    logs: can('view_logs')
  };
  // media: super + admin by default
  map.media = isSuper() || currentAdmin?.role === 'admin';
  Object.keys(map).forEach(k => {
    const btn = $('tab-' + k);
    if (btn) btn.style.display = map[k] ? '' : 'none';
  });
  const newsBlock = $('news-dashboard-block');
  if (newsBlock) newsBlock.style.display = can('manage_news') ? '' : 'none';
  const addSiteBtn = $('add-site-btn');
  if (addSiteBtn) addSiteBtn.style.display = isSuper() ? '' : 'none';
  const addWrap = $('add-admin-wrap');
  if (addWrap) addWrap.style.display = can('manage_admins') ? '' : 'none';
}

function switchView(name) {
  if (name === 'team' && !(isSuper() || can('manage_admins'))) name = 'dashboard';
  if (name === 'settings' && !isSuper()) name = 'dashboard';
  if (name === 'logs' && !can('view_logs')) name = 'dashboard';
  if (name === 'media' && !(isSuper() || currentAdmin?.role === 'admin')) name = 'dashboard';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $('topbar-tabs')?.classList.remove('open');
  $('burger')?.setAttribute('aria-expanded', 'false');
  if (name === 'dashboard') loadDashboard();
  if (name === 'media') loadMedia();
  if (name === 'settings') loadFlags();
  if (name === 'team') loadTeam();
  if (name === 'logs') loadLogs();
}

$('burger')?.addEventListener('click', () => {
  const tabs = $('topbar-tabs');
  const open = tabs.classList.toggle('open');
  $('burger').setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

async function loadDashboard() {
  loadSites();
  loadVisits();
  loadMiniAudit();
  if (can('manage_news')) loadNewsAdmin();
}

let sitesCache = [];
const OVERLAY_LABELS = { maintenance: 'Плановые работы', crash: 'Крах', private: 'Приват' };
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

async function loadSites() {
  const grid = $('sites-grid');
  grid.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data: sites, error } = await sb.from('ecosystem_sites').select('*').order('id');
  if (error) { grid.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
  sitesCache = sites || [];
  renderSites();
}

function renderSites() {
  const grid = $('sites-grid');
  const list = sitesCache;
  $('stat-total').textContent = list.length;
  $('stat-closed').textContent = list.filter(s => s.status === 'closed').length;
  $('stat-open').textContent = list.filter(s => s.status === 'open').length;
  if (!list.length) { grid.innerHTML = '<div class="loading-state">Нет сайтов</div>'; return; }
  const locked = !can('toggle_sites');
  const dis = locked ? ' disabled' : '';
  grid.innerHTML = list.map(site => {
    const id = esc(site.id);
    const isOpen = site.status === 'open';
    const bannerOn = site.banner_active === true;
    const chatOn = site.demo_chat_active === true;
    return `<div class="site-card glass" data-id="${id}">
      <div class="site-card-header">
        <div class="site-info"><h3>${esc(site.name)}</h3>
          <a href="${esc(site.url)}" target="_blank" rel="noopener">${esc(site.url)}</a></div>
        <div class="site-card-side">
          <div class="status-pill ${isOpen ? 'online' : 'offline'}"><span class="dot"></span>${isOpen ? 'Online' : 'Offline'}</div>
          ${isSuper() ? `<button type="button" class="btn-trash" data-act="delete" data-id="${id}" title="Удалить сайт" aria-label="Удалить сайт">${TRASH_SVG}</button>` : ''}
        </div>
      </div>
      <div class="toggle-list">
        <div class="toggle-row">
          <div class="toggle-text"><span class="toggle-label">Статус сайта</span>
            <span class="toggle-sub">${isOpen ? 'Открыт' : 'Закрыт'}${locked ? ' · нет прав' : ''}</span></div>
          <div class="toggle ${isOpen ? 'open' : 'closed'}${dis}" data-act="status" data-id="${id}" role="switch" aria-checked="${isOpen}" aria-label="Статус сайта"><div class="toggle-knob"></div></div>
        </div>
        <div class="toggle-row">
          <div class="toggle-text"><span class="toggle-label">Глобальный баннер</span>
            <span class="toggle-sub">${bannerOn ? 'Показывается' : 'Выключен'}</span></div>
          <div class="toggle ${bannerOn ? 'on' : 'off'}${dis}" data-act="banner" data-id="${id}" role="switch" aria-checked="${bannerOn}" aria-label="Глобальный баннер"><div class="toggle-knob"></div></div>
        </div>
        ${bannerOn ? `<div class="banner-edit">
          <input type="text" class="banner-input" maxlength="160" value="${esc(site.banner_text || '')}" placeholder="Например: Сайт на профилактике" aria-label="Текст баннера"${locked ? ' disabled' : ''}>
          <button type="button" class="btn btn-ghost btn-sm" data-act="banner-apply" data-id="${id}"${locked ? ' disabled' : ''}>Применить</button>
        </div>` : ''}
        <div class="toggle-row">
          <div class="toggle-text"><span class="toggle-label">Демо-чат</span>
            <span class="toggle-sub">${chatOn ? 'Виден на лендинге' : 'Скрыт'}</span></div>
          <div class="toggle ${chatOn ? 'on' : 'off'}${dis}" data-act="chat" data-id="${id}" role="switch" aria-checked="${chatOn}" aria-label="Демо-чат"><div class="toggle-knob"></div></div>
        </div>
      </div>
      ${!isOpen ? `<div class="overlay-meta">Заставка: <strong>${esc(OVERLAY_LABELS[site.overlay_type] || site.overlay_type)}</strong></div>` : ''}
    </div>`;
  }).join('');
}

// Один делегированный обработчик на всю сетку сайтов
$('sites-grid')?.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const site = sitesCache.find(s => s.id === el.dataset.id);
  if (!site) return;
  const act = el.dataset.act;

  if (act === 'delete') { deleteSite(site); return; }

  if (!can('toggle_sites')) { showToast('Недостаточно прав', 'error'); return; }

  if (act === 'status') {
    if (site.status === 'open') {
      pendingCloseSiteId = site.id;
      $('modal-site-name').textContent = `${site.name} — выберите заставку`;
      document.querySelectorAll('#close-modal .radio-item').forEach((r, i) => {
        r.classList.toggle('selected', i === 0);
        r.querySelector('input').checked = i === 0;
      });
      $('close-modal').classList.add('visible');
    } else openSite(site.id);
  } else if (act === 'banner') {
    toggleBanner(site);
  } else if (act === 'banner-apply') {
    const input = el.closest('.site-card')?.querySelector('.banner-input');
    applyBannerText(site, input ? input.value : '');
  } else if (act === 'chat') {
    toggleChat(site);
  }
});
$('sites-grid')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('banner-input')) {
    e.preventDefault();
    const site = sitesCache.find(s => s.id === e.target.closest('.site-card')?.dataset.id);
    if (site && can('toggle_sites')) applyBannerText(site, e.target.value);
  }
});

async function patchSite(site, patch) {
  const { error } = await sb.from('ecosystem_sites').update(patch).eq('id', site.id);
  if (error) { showToast(friendlyError(error), 'error'); return false; }
  Object.assign(site, patch);   // обновляем кэш — карточка перерисуется без «мигания»
  return true;
}

async function toggleBanner(site) {
  const next = site.banner_active !== true;
  if (!(await patchSite(site, { banner_active: next }))) return;
  renderSites();
  logAction(next ? 'banner_on' : 'banner_off', site.id);
  if (next && !(site.banner_text || '').trim()) showToast('Введите текст баннера и нажмите «Применить»');
  else showToast(next ? 'Баннер включён' : 'Баннер выключен');
  loadMiniAudit();
}

async function applyBannerText(site, raw) {
  const text = String(raw || '').trim().slice(0, 160);
  if (!text) { showToast('Введите текст баннера', 'error'); return; }
  if (!(await patchSite(site, { banner_text: text, banner_active: true }))) return;
  renderSites();
  logAction('banner_edit', site.id);
  showToast('Баннер применён');
  loadMiniAudit();
}

async function toggleChat(site) {
  const next = site.demo_chat_active !== true;
  if (!(await patchSite(site, { demo_chat_active: next }))) return;
  renderSites();
  logAction(next ? 'chat_on' : 'chat_off', site.id);
  showToast(next ? 'Демо-чат включён' : 'Демо-чат скрыт');
  loadMiniAudit();
}

// ---------- Site manager (super_admin) ----------
function openSiteModal() {
  if (!isSuper()) { showToast('Только для super_admin', 'error'); return; }
  $('site-form').reset();
  $('site-modal').classList.add('visible');
  setTimeout(() => $('site-new-id').focus(), 50);
}
function closeSiteModal() { $('site-modal').classList.remove('visible'); }

$('add-site-btn')?.addEventListener('click', openSiteModal);
$('site-cancel')?.addEventListener('click', closeSiteModal);
$('site-modal')?.addEventListener('click', e => { if (e.target === $('site-modal')) closeSiteModal(); });
$('site-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isSuper()) { showToast('Только для super_admin', 'error'); return; }
  const id = $('site-new-id').value.trim().toLowerCase();
  const name = $('site-new-name').value.trim();
  let url = $('site-new-url').value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(id)) {
    showToast('ID: латиница, цифры, - и _ (2–32 символа)', 'error'); return;
  }
  if (!name) { showToast('Введите название', 'error'); return; }
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { url = new URL(url).href; } catch { showToast('Некорректный URL', 'error'); return; }

  const btn = $('site-save');
  btn.disabled = true;
  const { error } = await sb.from('ecosystem_sites').insert({ id, name, url, status: 'open', overlay_type: 'maintenance' });
  btn.disabled = false;
  if (error) {
    showToast(/duplicate|already exists|unique/i.test(error.message) ? 'Сайт с таким ID уже есть' : friendlyError(error), 'error');
    return;
  }
  logAction('site_add', id);
  closeSiteModal();
  showToast('Сайт добавлен');
  loadSites(); loadMiniAudit();
});

async function deleteSite(site) {
  if (!isSuper()) { showToast('Только для super_admin', 'error'); return; }
  if (!confirm(`Удалить сайт «${site.name}» (${site.id})?\n\nВместе с ним удалится его история действий. Это нельзя отменить.`)) return;
  const { error } = await sb.from('ecosystem_sites').delete().eq('id', site.id);
  if (error) { showToast(friendlyError(error), 'error'); return; }
  sitesCache = sitesCache.filter(s => s.id !== site.id);
  renderSites();
  showToast('Сайт удалён');
  loadMiniAudit();
}

async function closeSite(siteId, overlayType) {
  const { error } = await sb.from('ecosystem_sites').update({ status: 'closed', overlay_type: overlayType }).eq('id', siteId);
  if (error) { showToast(error.message, 'error'); return; }
  await sb.from('audit_logs').insert({ admin_id: currentAdmin.admin_id, action: 'close', site_id: siteId, overlay_type: overlayType });
  showToast('Сайт закрыт'); loadSites(); loadMiniAudit();
}
async function openSite(siteId) {
  const { error } = await sb.from('ecosystem_sites').update({ status: 'open' }).eq('id', siteId);
  if (error) { showToast(error.message, 'error'); return; }
  await sb.from('audit_logs').insert({ admin_id: currentAdmin.admin_id, action: 'open', site_id: siteId });
  showToast('Сайт открыт'); loadSites(); loadMiniAudit();
}

document.querySelectorAll('#close-modal .radio-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('#close-modal .radio-item').forEach(r => r.classList.remove('selected'));
    item.classList.add('selected');
    item.querySelector('input').checked = true;
  });
});
$('modal-cancel')?.addEventListener('click', () => { $('close-modal').classList.remove('visible'); pendingCloseSiteId = null; });
$('modal-confirm')?.addEventListener('click', () => {
  const sel = document.querySelector('#close-modal input[name="overlay"]:checked');
  if (!sel || !pendingCloseSiteId) return;
  $('close-modal').classList.remove('visible');
  closeSite(pendingCloseSiteId, sel.value);
  pendingCloseSiteId = null;
});
$('close-modal')?.addEventListener('click', e => {
  if (e.target === $('close-modal')) { $('close-modal').classList.remove('visible'); pendingCloseSiteId = null; }
});

async function loadVisits() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb.from('site_visits').select('site_id').gte('created_at', since);
    const rows = data || [];
    $('stat-visits').textContent = rows.length;
    const map = {};
    rows.forEach(r => { map[r.site_id] = (map[r.site_id] || 0) + 1; });
    $('visits-breakdown').textContent = Object.keys(map).length
      ? Object.entries(map).map(([k, v]) => `${k}: ${v}`).join(' · ') : 'нет данных';
  } catch { $('stat-visits').textContent = '—'; }
}

async function loadMiniAudit() {
  const box = $('mini-audit');
  try {
    const { data } = await sb.from('audit_logs')
      .select('action, site_id, created_at, admins(nickname)')
      .order('created_at', { ascending: false }).limit(5);
    if (!data?.length) { box.textContent = 'Пусто'; return; }
    box.innerHTML = data.map(l => {
      const who = l.admins?.nickname || '—';
      const act = (ACTION_LABELS[l.action] || l.action || '').toLowerCase();
      const t = new Date(l.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
      return `<div class="mini-audit-row"><span>${esc(who)} ${act} <b>${esc(l.site_id)}</b></span><span class="meta">${t}</span></div>`;
    }).join('');
  } catch { box.textContent = '—'; }
}

// ---------- News on dashboard ----------
$('news-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!can('manage_news')) { showToast('Недостаточно прав', 'error'); return; }
  const title = $('news-title').value.trim();
  const body = $('news-body').value.trim();
  const type = $('news-type').value;
  const display_date = $('news-date').value || todayISO();
  const btn = $('news-submit-btn');
  btn.disabled = true;
  const { error } = await sb.from('news').insert({ title, body, type, display_date, is_published: true });
  btn.disabled = false;
  if (error) { showToast(friendlyError(error), 'error'); return; }
  showToast('Опубликовано — уже на сайте');
  e.target.reset();
  $('news-date').value = todayISO();
  loadNewsAdmin();
});

async function loadNewsAdmin() {
  const list = $('news-admin-list');
  if (!list) return;
  list.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data, error } = await sb.from('news').select('*').order('published_at', { ascending: false }).limit(5);
  if (error) { list.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="loading-state">Нет новостей</div>'; return; }
  const typeLabel = { news: 'Новость', patch: 'Патч', soon: 'Скоро' };
  list.innerHTML = data.map(n => `
    <div class="admin-card glass news-card" data-id="${n.id}">
      <div class="admin-card-info">
        <div class="admin-meta">
          <h4>${esc(n.title)} <span class="role-badge admin">${esc(typeLabel[n.type] || n.type)}</span> <span class="news-date">${esc(fmtDate(n.display_date || n.published_at))}</span></h4>
          <p>${esc((n.body || '').slice(0, 140))}</p>
        </div>
      </div>
      <button type="button" class="btn-icon news-del" data-id="${n.id}" aria-label="Удалить" title="Удалить">×</button>
    </div>`).join('');
  list.querySelectorAll('.news-del').forEach(b => b.addEventListener('click', async () => {
    if (!can('manage_news')) return;
    if (!confirm('Удалить новость?')) return;
    const { error: delErr } = await sb.from('news').delete().eq('id', b.dataset.id);
    if (delErr) showToast(friendlyError(delErr), 'error'); else showToast('Новость удалена');
    loadNewsAdmin();
  }));
}

// ---------- Media ----------
const dropzone = $('dropzone');
const mediaFile = $('media-file');
dropzone?.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('drag'); });
dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone?.addEventListener('drop', e => {
  e.preventDefault(); dropzone.classList.remove('drag');
  if (e.dataTransfer.files?.[0]) uploadMedia(e.dataTransfer.files[0]);
});
mediaFile?.addEventListener('change', () => { if (mediaFile.files?.[0]) uploadMedia(mediaFile.files[0]); });

async function uploadMedia(file) {
  const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await sb.storage.from('media').upload(path, file, { upsert: false });
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Загружено'); loadMedia();
}
async function loadMedia() {
  const grid = $('media-grid');
  grid.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data, error } = await sb.storage.from('media').list('', { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  const files = (data || []).filter(f => f.name && !f.name.endsWith('/'));
  if (!files.length) { grid.innerHTML = '<div class="loading-state">Пусто · bucket media</div>'; return; }
  grid.innerHTML = files.map(f => {
    const { data: pub } = sb.storage.from('media').getPublicUrl(f.name);
    const url = pub.publicUrl;
    return `<div class="media-item glass">
      <img src="${esc(url)}" alt="" loading="lazy">
      <button type="button" class="btn btn-ghost btn-sm copy-url" data-url="${esc(url)}">Скопировать</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.copy-url').forEach(b => b.addEventListener('click', async () => {
    const ok = await copyText(b.dataset.url);   // прямая публичная ссылка на файл
    if (ok) showToast('Ссылка на картинку скопирована!');
    else { showToast('Не удалось скопировать — скопируйте вручную', 'error'); window.prompt('Ссылка на картинку:', b.dataset.url); }
  }));
}

// ---------- Flags ----------
async function loadFlags() {
  const list = $('flags-list');
  list.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data, error } = await sb.from('feature_flags').select('*').order('key');
  if (error) { list.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  list.innerHTML = (data || []).map(f => `
    <div class="admin-card glass">
      <div class="admin-card-info"><div class="admin-meta">
        <h4>${esc(f.key)}</h4><p>${esc(f.description)}</p>
      </div></div>
      <div class="toggle ${f.is_enabled ? 'open' : 'closed'} flag-toggle" data-key="${esc(f.key)}"><div class="toggle-knob"></div></div>
    </div>`).join('');
  list.querySelectorAll('.flag-toggle').forEach(el => {
    el.addEventListener('click', async () => {
      if (!isSuper()) return;
      const enabled = !el.classList.contains('open');
      const { error: err } = await sb.from('feature_flags')
        .update({ is_enabled: enabled, updated_at: new Date().toISOString() }).eq('key', el.dataset.key);
      if (err) { showToast(err.message, 'error'); return; }
      el.classList.toggle('open', enabled);
      el.classList.toggle('closed', !enabled);
      showToast(enabled ? 'Включено' : 'Выключено');
    });
  });
}

// ---------- Backup ----------
$('backup-btn')?.addEventListener('click', async () => {
  if (!isSuper()) { showToast('Только для super_admin', 'error'); return; }
  const btn = $('backup-btn'), label = $('backup-btn-text');
  btn.disabled = true; label.textContent = 'Собираю данные…';
  try {
    const [sitesRes, newsRes] = await Promise.all([
      sb.from('ecosystem_sites').select('*').order('id'),
      sb.from('news').select('*').order('published_at', { ascending: false })
    ]);
    if (sitesRes.error) throw sitesRes.error;
    if (newsRes.error) throw newsRes.error;
    const payload = {
      app: 'amoore-dev', version: '7.0',
      exported_at: new Date().toISOString(),
      exported_by: currentAdmin?.nickname || currentAdmin?.email || null,
      ecosystem_sites: sitesRes.data || [],
      news: newsRes.data || []
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'amoore-backup.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    showToast(`Резервная копия скачана: ${payload.ecosystem_sites.length} сайтов, ${payload.news.length} новостей`);
  } catch (err) {
    showToast(friendlyError(err), 'error');
  } finally {
    btn.disabled = false; label.textContent = 'Скачать резервную копию (JSON)';
  }
});

// ---------- Team + permissions modal ----------
function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
$('gen-token-btn')?.addEventListener('click', () => { $('new-token').value = genToken(); });
$('add-admin-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!can('manage_admins')) { showToast('Недостаточно прав', 'error'); return; }
  const payload = {
    email: $('new-email').value.trim(), name: $('new-name').value.trim(),
    nickname: $('new-nickname').value.trim(), role: $('new-role').value,
    access_token: $('new-token').value.trim(), permissions: null
  };
  const { error } = await sb.from('admins').insert(payload);
  if (error) { showToast(error.message.includes('duplicate') ? 'Email уже есть' : error.message, 'error'); return; }
  showToast('Добавлен'); e.target.reset(); loadTeam();
});

async function loadTeam() {
  if (!(isSuper() || can('manage_admins'))) return;
  const list = $('team-list');
  list.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data: admins, error } = await sb.from('admins').select('*').order('created_at');
  if (error) { list.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  list.innerHTML = (admins || []).map(a => {
    const isSelf = a.id === currentAdmin.admin_id;
    const roles = ['moderator', 'admin', 'super_admin'];
    return `<div class="admin-card glass team-card">
      <div class="admin-card-info">
        <div class="admin-avatar">${esc((a.nickname || '?')[0].toUpperCase())}</div>
        <div class="admin-meta">
          <h4>${esc(a.nickname)}${isSelf ? ' <span class="role-badge super_admin">вы</span>' : ''}</h4>
          <p>${esc(a.email)} · ${esc(a.name)}</p>
          <p class="widget-meta">роль: ${esc(a.role)}${a.permissions ? ' · custom perms' : ''}</p>
        </div>
      </div>
      <div class="admin-card-actions">
        ${isSuper() ? `<select class="role-select" data-id="${a.id}" ${isSelf ? 'disabled' : ''}>
          ${roles.map(r => `<option value="${r}" ${a.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>` : `<span class="role-badge ${a.role}">${esc(a.role)}</span>`}
        ${isSuper() && !isSelf ? `<button class="btn btn-ghost btn-sm perms-btn" data-id="${a.id}" data-role="${esc(a.role)}">Права</button>` : ''}
        ${isSuper() && !isSelf ? `<button class="btn btn-danger-outline btn-sm del-admin" data-id="${a.id}">Удалить</button>` : ''}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.role-select').forEach(sel => sel.addEventListener('change', async () => {
    const { error } = await sb.from('admins').update({ role: sel.value }).eq('id', sel.dataset.id);
    if (error) showToast(error.message, 'error'); else showToast('Роль обновлена');
  }));
  list.querySelectorAll('.del-admin').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить?')) return;
    const { error } = await sb.from('admins').delete().eq('id', b.dataset.id);
    if (error) showToast(error.message, 'error'); else { showToast('Удалён'); loadTeam(); }
  }));
  list.querySelectorAll('.perms-btn').forEach(b => b.addEventListener('click', () => openPermsModal(b.dataset.id, b.dataset.role)));
}

async function openPermsModal(adminId, role) {
  if (!isSuper()) return;
  permsTargetId = adminId;
  const { data: admin, error } = await sb.from('admins').select('*').eq('id', adminId).single();
  if (error || !admin) { showToast(error?.message || 'Не найден', 'error'); return; }
  $('perms-user-label').textContent = `${admin.nickname || admin.email} · ${admin.role}`;
  permsDraft = resolvePermissions(admin.role, admin.permissions);
  document.querySelectorAll('#perms-list .toggle').forEach(t => {
    const k = t.dataset.key;
    const on = !!permsDraft[k];
    t.classList.toggle('open', on);
    t.classList.toggle('closed', !on);
  });
  $('perms-modal').classList.add('visible');
}

document.querySelectorAll('#perms-list .toggle').forEach(t => {
  t.addEventListener('click', () => {
    const k = t.dataset.key;
    const on = !t.classList.contains('open');
    t.classList.toggle('open', on);
    t.classList.toggle('closed', !on);
    if (permsDraft) permsDraft[k] = on;
  });
});
$('perms-save')?.addEventListener('click', async () => {
  if (!permsTargetId || !permsDraft) return;
  const { error } = await sb.from('admins').update({ permissions: permsDraft }).eq('id', permsTargetId);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Права сохранены');
  $('perms-modal').classList.remove('visible');
  loadTeam();
});
$('perms-reset')?.addEventListener('click', async () => {
  if (!permsTargetId) return;
  const { error } = await sb.from('admins').update({ permissions: null }).eq('id', permsTargetId);
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Сброшено к роли');
  $('perms-modal').classList.remove('visible');
  loadTeam();
});
$('perms-modal')?.addEventListener('click', e => {
  if (e.target === $('perms-modal')) $('perms-modal').classList.remove('visible');
});

// ---------- Logs ----------
async function loadLogs() {
  if (!can('view_logs')) return;
  const tbody = $('logs-tbody');
  const cards = $('logs-cards');
  tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Загрузка…</td></tr>';
  const { data: logs, error } = await sb.from('audit_logs')
    .select('*, admins(nickname, name), ecosystem_sites(name)')
    .order('created_at', { ascending: false }).limit(100);
  if (error) { tbody.innerHTML = `<tr><td colspan="5">${esc(error.message)}</td></tr>`; return; }
  if (!logs?.length) { tbody.innerHTML = '<tr><td colspan="5" class="loading-state">Пусто</td></tr>'; return; }
  const labels = { maintenance: 'Плановые', crash: 'Крах', private: 'Приват' };
  tbody.innerHTML = logs.map(l => {
    const who = l.admins?.nickname || '—';
    const site = l.ecosystem_sites?.name || l.site_id || '—';
    const act = ACTION_LABELS[l.action] || l.action || '—';
    const t = new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<tr><td>${esc(who)}</td><td><span class="action-pill ${l.action}">${act}</span></td><td>${esc(site)}</td><td>${esc(l.overlay_type ? labels[l.overlay_type] || l.overlay_type : '—')}</td><td style="color:var(--text-muted);white-space:nowrap">${t}</td></tr>`;
  }).join('');
  cards.innerHTML = logs.map(l => {
    const who = l.admins?.nickname || '—';
    const site = l.ecosystem_sites?.name || l.site_id || '—';
    const act = ACTION_LABELS[l.action] || l.action || '—';
    const t = new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="log-card glass"><div class="log-card-row"><strong>${esc(who)}</strong><span class="action-pill ${l.action}">${act}</span></div>
      <div class="log-card-row"><span class="meta">${esc(site)}</span><span class="meta">${t}</span></div></div>`;
  }).join('');
}

// ---------- Login ----------
$('full-login-btn')?.addEventListener('click', () => setLoginMode(false));
$('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').classList.remove('visible');
  $('login-btn').disabled = true;
  $('login-btn-text').innerHTML = '<span class="spinner"></span>';
  const email = ($('email').value || rememberedEmail()).trim();
  const password = $('password').value;
  const token = $('token').value.trim();
  try {
    if (!email || !token) throw new Error('Заполните поля');
    let session;
    if (tokenOnlyMode) {
      try { session = await loginTokenOnly(email, token); }
      catch (err) {
        if (err.message === 'NEED_PASSWORD') { setLoginMode(false); throw new Error('Сессия истекла — введите пароль'); }
        throw err;
      }
    } else {
      if (!password) throw new Error('Укажите пароль');
      session = await loginFull(email, password, token);
    }
    showApp(session);
  } catch (err) {
    $('login-error').textContent = friendlyError(err);
    $('login-error').classList.add('visible');
  } finally {
    $('login-btn').disabled = false;
    $('login-btn-text').textContent = 'Войти';
  }
});
$('logout-btn')?.addEventListener('click', () => {
  clearSession(true);
  sb.auth.signOut().catch(() => {});
  currentAdmin = null;
  showLogin(false);
});

(async function boot() {
  if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_PROJECT') || !SUPABASE_ANON || SUPABASE_ANON === 'YOUR_ANON_KEY') {
    showLogin(false);
    $('login-error').textContent = 'Подставьте SUPABASE_URL и SUPABASE_ANON в app.js';
    $('login-error').classList.add('visible');
    return;
  }
  const session = loadSession();
  if (session?.admin_id) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        // refresh permissions from DB
        try {
          const { data: admin } = await sb.from('admins').select('*').eq('id', session.admin_id).single();
          if (admin) {
            session.role = admin.role;
            session.permissions = admin.permissions || null;
            session.permissions_resolved = resolvePermissions(admin.role, admin.permissions);
          }
        } catch (_) {}
        saveSession(session);
        showApp(session);
        return;
      }
    } catch (_) {}
    clearSession(false);
    showLogin(true);
    return;
  }
  if (rememberedEmail()) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) { showLogin(true); return; }
    } catch (_) {}
  }
  showLogin(false);
})();
