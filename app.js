// amoore Dev Mission Control v4.0
const SUPABASE_URL  = 'https://wogouiecoigzmxqccnsk.supabase.co';
const SUPABASE_ANON = 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const SESSION_KEY = 'amoore_dev_auth';
const EMAIL_KEY = 'amoore_dev_email';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);
let currentAdmin = null;
let pendingCloseSiteId = null;
let tokenOnlyMode = false;

// ---------- Session ----------
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
  if (/failed to fetch|networkerror|load failed/i.test(msg))
    return 'Нет связи с Supabase. Проверьте URL/ключ.';
  if (/invalid login credentials/i.test(msg)) return 'Неверный email или пароль';
  return msg || 'Ошибка';
}
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}
function showToast(msg, type = 'success') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast visible ' + type;
  setTimeout(() => el.classList.remove('visible'), 2800);
}
function isSuper() { return currentAdmin?.role === 'super_admin'; }
function isAdminPlus() { return currentAdmin && (currentAdmin.role === 'super_admin' || currentAdmin.role === 'admin'); }
function canToggleSites() { return isAdminPlus(); }

// ---------- Auth ----------
async function verifyAdmin(email, accessToken) {
  const { data: admin, error } = await sb.from('admins').select('*')
    .eq('email', email).eq('access_token', accessToken).single();
  if (error || !admin) throw new Error('Неверный токен или аккаунт не найден');
  return {
    admin_id: admin.id, email: admin.email, nickname: admin.nickname,
    name: admin.name, role: admin.role, access_token: accessToken
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

// ---------- UI shell ----------
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
  $('login-screen').style.display = 'none';
  $('app').classList.add('visible');
  $('admin-nickname').textContent = admin.nickname || admin.name || admin.email;
  applyRoleUI(admin.role);
  switchView('dashboard');
  loadDashboard();
}
function applyRoleUI(role) {
  const map = {
    dashboard: true,
    content: role === 'super_admin' || role === 'admin',
    bot: role === 'super_admin' || role === 'admin',
    media: role === 'super_admin' || role === 'admin',
    settings: role === 'super_admin',
    team: role === 'super_admin',
    logs: role === 'super_admin' || role === 'admin'
  };
  Object.keys(map).forEach(k => {
    const btn = $('tab-' + k);
    if (btn) btn.style.display = map[k] ? '' : 'none';
  });
}

function switchView(name) {
  if (name === 'team' && !isSuper()) name = 'dashboard';
  if (name === 'settings' && !isSuper()) name = 'dashboard';
  if ((name === 'content' || name === 'bot' || name === 'media' || name === 'logs') && !isAdminPlus()) name = 'dashboard';
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
  $('topbar-tabs')?.classList.remove('open');
  $('burger')?.setAttribute('aria-expanded', 'false');
  if (name === 'dashboard') loadDashboard();
  if (name === 'content') loadNewsAdmin();
  if (name === 'bot') loadBotLogs();
  if (name === 'media') loadMedia();
  if (name === 'settings') loadFlags();
  if (name === 'team') loadTeam();
  if (name === 'logs') loadLogs();
}

// Burger
$('burger')?.addEventListener('click', () => {
  const tabs = $('topbar-tabs');
  const open = tabs.classList.toggle('open');
  $('burger').setAttribute('aria-expanded', open ? 'true' : 'false');
});
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ---------- Dashboard ----------
async function loadDashboard() {
  loadSites();
  loadBotStatus();
  loadVisits();
  loadMiniAudit();
}

async function loadSites() {
  const grid = $('sites-grid');
  grid.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data: sites, error } = await sb.from('ecosystem_sites').select('*').order('id');
  if (error) { grid.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  const list = sites || [];
  $('stat-total').textContent = list.length;
  $('stat-closed').textContent = list.filter(s => s.status === 'closed').length;
  $('stat-open').textContent = list.filter(s => s.status === 'open').length;
  if (!list.length) { grid.innerHTML = '<div class="loading-state">Нет сайтов</div>'; return; }
  const locked = !canToggleSites();
  const labels = { maintenance: 'Плановые работы', crash: 'Крах', private: 'Приват' };
  grid.innerHTML = list.map(site => {
    const isOpen = site.status === 'open';
    return `<div class="site-card glass" data-id="${esc(site.id)}">
      <div class="site-card-header">
        <div class="site-info"><h3>${esc(site.name)}</h3>
          <a href="${esc(site.url)}" target="_blank" rel="noopener">${esc(site.url)}</a></div>
        <div class="status-pill ${isOpen ? 'online' : 'offline'}"><span class="dot"></span>${isOpen ? 'Online' : 'Offline'}</div>
      </div>
      <div class="toggle-row">
        <span class="toggle-label">${isOpen ? 'Открыт' : 'Закрыт'}${locked ? ' · просмотр' : ''}</span>
        <div class="toggle ${isOpen ? 'open' : 'closed'}${locked ? ' disabled' : ''}" data-id="${esc(site.id)}"></div>
      </div>
      ${!isOpen ? `<div class="overlay-meta">Заставка: <strong>${labels[site.overlay_type] || site.overlay_type}</strong></div>` : ''}
    </div>`;
  }).join('');
  grid.querySelectorAll('.toggle').forEach(el => {
    el.innerHTML = '<div class="toggle-knob"></div>';
    el.addEventListener('click', () => {
      if (el.classList.contains('disabled') || !canToggleSites()) { showToast('Недостаточно прав', 'error'); return; }
      const id = el.dataset.id;
      if (el.classList.contains('open')) {
        pendingCloseSiteId = id;
        $('modal-site-name').textContent = 'Выберите заставку';
        document.querySelectorAll('.radio-item').forEach((r, i) => {
          r.classList.toggle('selected', i === 0);
          r.querySelector('input').checked = i === 0;
        });
        $('close-modal').classList.add('visible');
      } else openSite(id);
    });
  });
}

async function closeSite(siteId, overlayType) {
  const { error } = await sb.from('ecosystem_sites').update({ status: 'closed', overlay_type: overlayType }).eq('id', siteId);
  if (error) { showToast(error.message, 'error'); return; }
  await sb.from('audit_logs').insert({ admin_id: currentAdmin.admin_id, action: 'close', site_id: siteId, overlay_type: overlayType });
  showToast('Сайт закрыт'); loadSites();
}
async function openSite(siteId) {
  const { error } = await sb.from('ecosystem_sites').update({ status: 'open' }).eq('id', siteId);
  if (error) { showToast(error.message, 'error'); return; }
  await sb.from('audit_logs').insert({ admin_id: currentAdmin.admin_id, action: 'open', site_id: siteId });
  showToast('Сайт открыт'); loadSites();
}

document.querySelectorAll('.radio-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.radio-item').forEach(r => r.classList.remove('selected'));
    item.classList.add('selected');
    item.querySelector('input').checked = true;
  });
});
$('modal-cancel')?.addEventListener('click', () => { $('close-modal').classList.remove('visible'); pendingCloseSiteId = null; });
$('modal-confirm')?.addEventListener('click', () => {
  const sel = document.querySelector('input[name="overlay"]:checked');
  if (!sel || !pendingCloseSiteId) return;
  $('close-modal').classList.remove('visible');
  closeSite(pendingCloseSiteId, sel.value);
  pendingCloseSiteId = null;
});
$('close-modal')?.addEventListener('click', e => {
  if (e.target === $('close-modal')) { $('close-modal').classList.remove('visible'); pendingCloseSiteId = null; }
});

async function loadBotStatus() {
  try {
    const { data } = await sb.from('bot_status').select('*').eq('id', 1).maybeSingle();
    const dot = $('bot-dot');
    const text = $('bot-status-text');
    const hb = $('bot-heartbeat');
    if (!data) { text.textContent = 'Нет данных'; return; }
    const age = data.last_heartbeat ? (Date.now() - new Date(data.last_heartbeat).getTime()) : Infinity;
    const online = data.is_online && age < 2 * 60 * 60 * 1000;
    dot.className = 'status-dot ' + (online ? 'online' : 'offline');
    text.textContent = online ? 'Онлайн' : 'Офлайн';
    hb.textContent = data.last_heartbeat
      ? 'Heartbeat: ' + new Date(data.last_heartbeat).toLocaleString('ru-RU')
      : 'Heartbeat не поступал';
  } catch {
    $('bot-status-text').textContent = 'Ошибка';
  }
}

async function loadVisits() {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await sb.from('site_visits').select('site_id').gte('created_at', since);
    const rows = data || [];
    $('stat-visits').textContent = rows.length;
    const map = {};
    rows.forEach(r => { map[r.site_id] = (map[r.site_id] || 0) + 1; });
    $('visits-breakdown').textContent = Object.keys(map).length
      ? Object.entries(map).map(([k, v]) => `${k}: ${v}`).join(' · ')
      : 'нет данных';
  } catch {
    $('stat-visits').textContent = '—';
  }
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
      const act = l.action === 'close' ? 'закрыл' : 'открыл';
      const t = new Date(l.created_at).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
      return `<div class="mini-audit-row"><span>${esc(who)} ${act} <b>${esc(l.site_id)}</b></span><span class="meta">${t}</span></div>`;
    }).join('');
  } catch { box.textContent = 'Нет доступа'; }
}

// ---------- CMS ----------
$('news-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isAdminPlus()) return;
  const title = $('news-title').value.trim();
  const body = $('news-body').value.trim();
  const type = $('news-type').value;
  const { error } = await sb.from('news').insert({ title, body, type, is_published: true });
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Опубликовано');
  e.target.reset();
  loadNewsAdmin();
});

async function loadNewsAdmin() {
  const list = $('news-admin-list');
  list.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data, error } = await sb.from('news').select('*').order('published_at', { ascending: false });
  if (error) { list.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="loading-state">Нет новостей</div>'; return; }
  list.innerHTML = data.map(n => `
    <div class="admin-card glass" data-id="${n.id}">
      <div class="admin-card-info">
        <div class="admin-meta">
          <h4>${esc(n.title)} <span class="role-badge ${n.is_published ? 'super_admin' : 'admin'}">${n.is_published ? 'pub' : 'hidden'} · ${esc(n.type)}</span></h4>
          <p>${esc((n.body || '').slice(0, 120))}</p>
        </div>
      </div>
      <div class="admin-card-actions">
        <button class="btn btn-ghost btn-sm news-toggle" data-id="${n.id}" data-pub="${n.is_published ? '1' : '0'}">${n.is_published ? 'Скрыть' : 'Опубликовать'}</button>
        <button class="btn btn-danger-outline btn-sm news-del" data-id="${n.id}">Удалить</button>
      </div>
    </div>`).join('');
  list.querySelectorAll('.news-toggle').forEach(b => b.addEventListener('click', async () => {
    const pub = b.dataset.pub !== '1';
    await sb.from('news').update({ is_published: pub }).eq('id', b.dataset.id);
    loadNewsAdmin();
  }));
  list.querySelectorAll('.news-del').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Удалить новость?')) return;
    await sb.from('news').delete().eq('id', b.dataset.id);
    loadNewsAdmin();
  }));
}

// ---------- Bot ----------
$('tg-send-btn')?.addEventListener('click', async () => {
  if (!isAdminPlus()) return;
  const message = $('tg-message').value.trim();
  if (!message) { showToast('Введите текст', 'error'); return; }
  const btn = $('tg-send-btn');
  btn.disabled = true;
  try {
    const { data, error } = await sb.functions.invoke('send-telegram', { body: { message } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    showToast('Отправлено');
    $('tg-message').value = '';
    loadBotLogs();
  } catch (e) {
    showToast(friendlyError(e), 'error');
  } finally {
    btn.disabled = false;
  }
});

async function loadBotLogs() {
  const list = $('bot-logs-list');
  list.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data, error } = await sb.from('bot_logs').select('*').order('created_at', { ascending: false }).limit(30);
  if (error) { list.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="loading-state">Пусто</div>'; return; }
  list.innerHTML = data.map(l => `
    <div class="admin-card glass">
      <div class="admin-card-info"><div class="admin-meta">
        <h4><span class="action-pill ${l.status === 'sent' ? 'open' : 'close'}">${esc(l.status)}</span></h4>
        <p style="white-space:pre-wrap">${esc(l.message)}</p>
      </div></div>
      <span class="widget-meta">${new Date(l.created_at).toLocaleString('ru-RU')}</span>
    </div>`).join('');
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
mediaFile?.addEventListener('change', () => {
  if (mediaFile.files?.[0]) uploadMedia(mediaFile.files[0]);
});

async function uploadMedia(file) {
  if (!isAdminPlus()) return;
  const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await sb.storage.from('media').upload(path, file, { upsert: false });
  if (error) { showToast(error.message, 'error'); return; }
  showToast('Загружено');
  loadMedia();
}

async function loadMedia() {
  const grid = $('media-grid');
  grid.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data, error } = await sb.storage.from('media').list('', { limit: 50, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  const files = (data || []).filter(f => f.name && !f.name.endsWith('/'));
  if (!files.length) { grid.innerHTML = '<div class="loading-state">Пусто · создайте bucket media</div>'; return; }
  grid.innerHTML = files.map(f => {
    const { data: pub } = sb.storage.from('media').getPublicUrl(f.name);
    const url = pub.publicUrl;
    return `<div class="media-item glass">
      <img src="${esc(url)}" alt="" loading="lazy">
      <button type="button" class="btn btn-ghost btn-sm copy-url" data-url="${esc(url)}">Скопировать ссылку</button>
    </div>`;
  }).join('');
  grid.querySelectorAll('.copy-url').forEach(b => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.url); showToast('Ссылка скопирована'); }
    catch { showToast(b.dataset.url); }
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
      const { error: err } = await sb.from('feature_flags').update({ is_enabled: enabled, updated_at: new Date().toISOString() }).eq('key', el.dataset.key);
      if (err) { showToast(err.message, 'error'); return; }
      el.classList.toggle('open', enabled);
      el.classList.toggle('closed', !enabled);
      showToast(enabled ? 'Включено' : 'Выключено');
    });
  });
}

// ---------- Team ----------
function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
$('gen-token-btn')?.addEventListener('click', () => { $('new-token').value = genToken(); });
$('add-admin-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!isSuper()) return;
  const payload = {
    email: $('new-email').value.trim(), name: $('new-name').value.trim(),
    nickname: $('new-nickname').value.trim(), role: $('new-role').value,
    access_token: $('new-token').value.trim()
  };
  const { error } = await sb.from('admins').insert(payload);
  if (error) { showToast(error.message.includes('duplicate') ? 'Email уже есть' : error.message, 'error'); return; }
  showToast('Добавлен'); e.target.reset(); loadTeam();
});

async function loadTeam() {
  if (!isSuper()) return;
  const list = $('team-list');
  list.innerHTML = '<div class="loading-state">Загрузка…</div>';
  const { data: admins, error } = await sb.from('admins').select('*').order('created_at');
  if (error) { list.innerHTML = `<div class="loading-state">${esc(error.message)}</div>`; return; }
  list.innerHTML = (admins || []).map(a => {
    const isSelf = a.id === currentAdmin.admin_id;
    const roles = ['moderator', 'admin', 'super_admin'];
    return `<div class="admin-card glass">
      <div class="admin-card-info">
        <div class="admin-avatar">${esc((a.nickname || '?')[0].toUpperCase())}</div>
        <div class="admin-meta"><h4>${esc(a.nickname)}${isSelf ? ' <span class="role-badge super_admin">вы</span>' : ''}</h4>
          <p>${esc(a.email)} · ${esc(a.name)}</p></div>
      </div>
      <div class="admin-card-actions">
        <select class="role-select" data-id="${a.id}" ${isSelf ? 'disabled' : ''}>
          ${roles.map(r => `<option value="${r}" ${a.role === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
        ${!isSelf ? `<button class="btn btn-danger-outline btn-sm del-admin" data-id="${a.id}">Удалить</button>` : ''}
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
}

// ---------- Logs ----------
async function loadLogs() {
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
    const act = l.action === 'close' ? 'Закрыл' : 'Открыл';
    const t = new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<tr><td>${esc(who)}</td><td><span class="action-pill ${l.action}">${act}</span></td><td>${esc(site)}</td><td>${esc(l.overlay_type ? labels[l.overlay_type] || l.overlay_type : '—')}</td><td style="color:var(--text-muted);white-space:nowrap">${t}</td></tr>`;
  }).join('');
  cards.innerHTML = logs.map(l => {
    const who = l.admins?.nickname || '—';
    const site = l.ecosystem_sites?.name || l.site_id || '—';
    const act = l.action === 'close' ? 'Закрыл' : 'Открыл';
    const t = new Date(l.created_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="log-card glass"><div class="log-card-row"><strong>${esc(who)}</strong><span class="action-pill ${l.action}">${act}</span></div>
      <div class="log-card-row"><span class="meta">${esc(site)}</span><span class="meta">${t}</span></div></div>`;
  }).join('');
}

// ---------- Login / Logout ----------
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

// ---------- Boot ----------
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
      if (data.session) { saveSession(session); showApp(session); return; }
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
