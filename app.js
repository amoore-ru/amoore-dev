// amoore Dev — Mission Control (Clean Build v1.0)
// Единый скрипт: авторизация (Supabase Auth + токен, сессия 6 ч), дашборд, новости, медиа, команда, логи, настройки.
const SUPABASE_URL  = 'https://wogouiecoigzmxqccnsk.supabase.co';
const SUPABASE_ANON = 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});

const SESSION_KEY = 'amoore_dev_auth';
const EMAIL_KEY = 'amoore_dev_email';
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const LANDING_ID = 'landing';
// Единая версия экосистемы. Должна совпадать с AMOORE_VERSION в amoore-core.js (это проверяет run_qa.sh).
const AMOORE_VERSION = '4.3.0';          // фоллбэк: живая версия берётся из БД (global_settings.changelog)
let liveVersion = null;
const curVersion = () => liveVersion || AMOORE_VERSION;

// ---- права: ключи совпадают с правами в базе данных ----
const PERMS = [
  ['toggle_status',  'Открывать и закрывать сайты'],
  ['toggle_banner',  'Управлять баннером'],
  ['toggle_chat',    'Включать и выключать демо-чат'],
  ['toggle_news',    'Включать и выключать блок новостей'],
  ['manage_news',    'Добавлять и удалять новости'],
  ['manage_media',   'Загружать медиа'],
  ['view_logs',      'Смотреть логи'],
  ['manage_sites',   'Добавлять и удалять сайты'],
  ['manage_admins',  'Добавлять пользователей'],
  ['download_backup','Скачивать резервную копию']
];
const PERM_KEYS = PERMS.map(p => p[0]);
const MODERATOR_DEFAULT = ['view_logs'];
const ADMIN_DEFAULT = ['toggle_status', 'toggle_banner', 'toggle_chat', 'toggle_news', 'manage_news', 'manage_media', 'view_logs'];
const roleDefault = (role, key) => role === 'super_admin' ? true : role === 'admin' ? ADMIN_DEFAULT.includes(key) : role === 'moderator' ? MODERATOR_DEFAULT.includes(key) : false;

// ---- названия ролей (global_settings.role_labels): ключи ролей неизменны, меняется только подпись ----
const ROLE_DEFAULT_LABELS = { super_admin: 'Основатель', admin: 'Админ', moderator: 'Модератор' };
let roleLabels = { ...ROLE_DEFAULT_LABELS };
const rl = (role) => roleLabels[role] || role;

const ACTION_LABELS = {
  close: 'Закрыл сайт', open: 'Открыл сайт',
  banner_on: 'Включил баннер', banner_off: 'Выключил баннер', banner_edit: 'Изменил баннер',
  chat_on: 'Включил демо-чат', chat_off: 'Выключил демо-чат',
  news_on: 'Включил новости', news_off: 'Выключил новости',
  news_add: 'Добавил новость', news_delete: 'Удалил новость',
  site_add: 'Добавил сайт', site_delete: 'Удалил сайт',
  admin_add: 'Добавил пользователя', admin_delete: 'Удалил пользователя',
  role_change: 'Сменил роль', perms_change: 'Изменил права', media_upload: 'Загрузил медиа', backup: 'Скачал бэкап',
  admin_edit: 'Изменил профиль', news_edit: 'Изменил новость', digest_publish: 'Опубликовал дайджест', labels_edit: 'Изменил названия ролей', changelog_edit: 'Изменил changelog',
  lead_done: 'Обработал заявку', digest_request: 'Запросил дайджест', bot_toggle: 'Переключил бота', broadcast: 'Сделал рассылку'
};
const OVERLAY_LABELS = { maintenance: 'Плановые работы', crash: 'Крах', private: 'Приват' };
const NEWS_TYPES = { news: 'Новость', patch: 'Патч', soon: 'Скоро', digest: 'Дайджест' };
const TRASH_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

const $ = (id) => document.getElementById(id);
// Network state is explicit: never leave the operator with an unexplained blank panel.
(function installNetworkNotice() {
  const show = () => {
    let node = document.getElementById('amoore-network-notice');
    if (!node) {
      node = document.createElement('div'); node.id = 'amoore-network-notice';
      node.setAttribute('role', 'status'); node.setAttribute('aria-live', 'polite');
      node.textContent = 'Нет связи с сервером. Проверьте интернет';
      document.body.appendChild(node);
    }
    node.hidden = navigator.onLine;
  };
  window.addEventListener('online', show); window.addEventListener('offline', show);
  document.addEventListener('DOMContentLoaded', show); show();
})();
let me = null;                 // текущий админ
// Конкретные поля вместо select('*'): меньше трафика, схема явная.
const SITE_COLS = 'id,name,url,status,overlay_type,banner_active,banner_text,demo_chat_active,news_active,sort_order,updated_at';
const NEWS_COLS = 'id,title,body,type,display_date,is_published,published_at';
const LOG_COLS = 'id,message,status,error_text,source,created_at';
const LEAD_COLS = 'id,name,contact,message,status,created_at';
let sitesCache = [];
let pendingCloseSiteId = null;
let tokenOnlyMode = false;
let permsTarget = null;        // { id, role }
let permsDraft = null;

// ======================================================================= utils
function esc(v) {
  const d = document.createElement('div');
  d.textContent = v == null ? '' : String(v);
  return d.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const pad2 = (n) => String(n).padStart(2, '0');
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function fmtDate(v) {
  if (!v) return '';
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : String(v);
}
function fmtDateTime(iso, short) {
  return new Date(iso).toLocaleString('ru-RU', short
    ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/no permission|only super_admin|cannot (demote|delete)/i.test(msg)) return 'Недостаточно прав для этого действия';
  if (/failed to fetch|networkerror|load failed|timeout/i.test(msg)) {
    const notice = $('amoore-network-notice'); if (notice) notice.hidden = false;
    return 'Нет связи с сервером. Проверьте интернет';
  }
  if (/invalid login credentials/i.test(msg)) return 'Неверный email или пароль';
  if (/row-level security|violates row-level|permission denied/i.test(msg)) return 'Недостаточно прав (RLS)';
  // Любая «техническая» ошибка схемы БД показывается пользователю по-человечески, без имён файлов и таблиц
  if (/column .* does not exist|schema cache|could not find|function .* does not exist|relation .* does not exist/i.test(msg)) return 'Ошибка связи с сервером. Попробуйте позже';
  if (/duplicate|already exists|unique/i.test(msg)) return 'Такая запись уже существует';
  return msg || 'Ошибка';
}
let toastTimer = 0;
function toast(msg, type = 'success') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast visible ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('visible'), 3000);
}
async function copyText(text) {
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (_) {}
  try {
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
function genToken(len = 24) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const buf = new Uint32Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, n => chars[n % chars.length]).join('');
}
async function logAction(action, siteId = null, overlay = null, details = null) {
  try {
    await sb.from('audit_logs').insert({ admin_id: me.admin_id, action, site_id: siteId, overlay_type: overlay, details });
  } catch (_) {}
}

// ======================================================================= права
function resolvePermissions(role, custom) {
  const out = {};
  PERM_KEYS.forEach(k => {
    out[k] = role === 'super_admin' ? true
      : (custom && typeof custom[k] === 'boolean') ? custom[k] : roleDefault(role, k);
  });
  return out;
}
const can = (key) => !!me && !!me.perms[key];
const isSuper = () => me?.role === 'super_admin';

// ======================================================================= сессия (6 часов, localStorage + токен)
function saveSession(data, expiresAt) {
  const payload = { ...data, expires_at: expiresAt || Date.now() + SESSION_TTL_MS };
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (_) {}
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(payload)); } catch (_) {}
  if (data.email) try { localStorage.setItem(EMAIL_KEY, data.email); } catch (_) {}
}
function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d?.admin_id) return null;
    if (d.expires_at && Date.now() > d.expires_at) { clearSession(false); return null; }
    return d;
  } catch { return null; }
}
function clearSession(full) {
  try { localStorage.removeItem(SESSION_KEY); sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  if (full) try { localStorage.removeItem(EMAIL_KEY); } catch (_) {}
}
const rememberedEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || ''; } catch { return ''; } };

// токен проверяется на сервере (rpc verify_admin), колонка access_token клиенту не отдаётся
async function verifyAdmin(accessToken) {
  const { data, error } = await sb.rpc('verify_admin', { p_token: accessToken });
  if (error) throw error;
  if (!data) throw new Error('Неверный токен или аккаунт не найден');
  return {
    admin_id: data.id, email: data.email, nickname: data.nickname, name: data.name,
    role: data.role, permissions: data.permissions || null, access_token: accessToken
  };
}
async function loginFull(email, password, token) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyError(error));
  try {
    const s = await verifyAdmin(token);
    saveSession(s);
    return s;
  } catch (e) { await sb.auth.signOut().catch(() => {}); throw e; }
}
async function loginTokenOnly(token) {
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error('NEED_PASSWORD');
  const s = await verifyAdmin(token);
  saveSession(s);
  return s;
}

// ======================================================================= экраны
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
function showApp(session) {
  me = { ...session, perms: resolvePermissions(session.role, session.permissions) };
  $('login-screen').style.display = 'none';
  $('app').classList.add('visible');
  paintUser();
  if ($('news-date') && !$('news-date').value) $('news-date').value = todayISO();
  applyRoleUI();
  switchView(location.hash === '#settings' ? 'settings' : 'dashboard');
  loadRoleLabels();               // названия ролей из БД (фоллбэк — стандартные)
  touchSeen();                    // «в сети»: обновляем last_seen_at
  startLeadsWatcher();          // красный счётчик новых заявок
  maybeShowWhatsNew();          // окно «Что нового», если это первый вход за версию
}
const VIEW_RULES = {
  news:      () => true,                       // модератор читает, админ добавляет, super_admin правит и публикует дайджесты
  leads: () => can('view_logs') || isSuper(),
  digest:    () => can('view_logs') || isSuper(),
  dashboard: () => true,
  media:     () => can('manage_media'),
  team:      () => isSuper() || can('manage_admins'),
  logs:      () => can('view_logs'),
  settings:  () => isSuper() || me?.role === 'admin' || can('download_backup')
};
function paintUser() {
  if (!window.amooreUX) return;
  window.amooreUX.setUser({ nickname: me.nickname, name: me.name, email: me.email, role: me.role });
  const gear = document.querySelector('[data-ux-settings]');
  if (gear) gear.hidden = !VIEW_RULES.settings();      // шестерёнка — только тем, у кого есть доступ к настройкам
}
function applyRoleUI() {
  Object.keys(VIEW_RULES).forEach(k => { const b = $('tab-' + k); if (b) b.style.display = VIEW_RULES[k]() ? '' : 'none'; });
  $('news-form-wrap').style.display = can('manage_news') ? '' : 'none';
  $('news-role-note').textContent = isSuper() ? 'Полный доступ: добавление, правка, удаление и публикация дайджестов.' : can('manage_news') ? 'Вы можете добавлять новости.' : 'Режим чтения: просмотр опубликованных новостей.';
  const nt = $('news-type'); if (nt && isSuper() && !nt.querySelector('option[value="digest"]')) nt.insertAdjacentHTML('beforeend', '<option value="digest">Дайджест</option>');
  if ($('set-backup')) $('set-backup').style.display = can('download_backup') ? '' : 'none';
  document.querySelectorAll('[data-super]').forEach(n => { n.style.display = isSuper() ? '' : 'none'; });
  paintUser();
  $('add-site-btn').style.display = can('manage_sites') ? '' : 'none';
  $('add-admin-wrap').style.display = can('manage_admins') ? '' : 'none';
  $('mini-audit-widget').style.display = can('view_logs') ? '' : 'none';
  if ($('broadcast-card')) $('broadcast-card').style.display = isSuper() ? '' : 'none';
  const sel = $('new-role');
  sel.innerHTML = ['moderator', 'admin'].concat(isSuper() ? ['super_admin'] : []).map(r => `<option value="${r}">${esc(rl(r))}</option>`).join('');
}
// Переход между вкладками: старый экран гаснет с размытием (~140 мс), новый выезжает снизу из blur.
// Анимации — в style.css (.view.leaving / .view.active); при prefers-reduced-motion переключение мгновенное.
let viewTimer = 0;
function switchView(name) {
  if (!VIEW_RULES[name] || !VIEW_RULES[name]()) name = 'dashboard';
  document.querySelectorAll('.ux-tab').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  document.querySelector('[data-ux-settings]')?.classList.toggle('active', name === 'settings');
  const next = $('view-' + name), prev = document.querySelector('.view.active');
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  clearTimeout(viewTimer);
  document.querySelectorAll('.view.leaving').forEach(v => v.classList.remove('leaving'));
  const show = () => {
    document.querySelectorAll('.view').forEach(v => { v.classList.remove('leaving'); v.classList.toggle('active', v === next); });
  };
  if (prev && prev !== next && !reduce) { prev.classList.add('leaving'); viewTimer = setTimeout(show, 140); }
  else show();
  closeMobileMenu();
  window.scrollTo(0, 0);
  if (name === 'dashboard') loadDashboard();
  if (name === 'news') loadNewsAdmin();
  if (name === 'media') loadMedia();
  if (name === 'settings') renderSettingsBlocks();
  if (name === 'team') loadTeam();
  if (name === 'logs') loadLogs();
  if (name === 'leads') loadLeads();
  if (name === 'digest') loadDigestView();
}
const closeMobileMenu = () => window.amooreUX?.closeMenu();
document.querySelectorAll('.ux-tab').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
document.querySelector('[data-ux-settings]')?.addEventListener('click', e => { e.preventDefault(); switchView('settings'); });

// ======================================================================= глобальный поиск по новостям, сайтам и администраторам
(function installGlobalSearch() {
  const input = $('global-search'), panel = $('global-search-results');
  if (!input || !panel) return;
  let timer = 0, requestId = 0;
  const close = () => { panel.hidden = true; panel.innerHTML = ''; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      const id = ++requestId;
      panel.hidden = false; panel.innerHTML = '<div class="global-search-empty">Ищем…</div>';
      const safeQuery = q.replace(/[\\%_,().]/g, ' ').trim();
      const pattern = `%${safeQuery}%`;
      try {
        const jobs = [
          sb.from('news').select('id,title').ilike('title', pattern).limit(6),
          sb.from('ecosystem_sites').select('id,name,url').ilike('name', pattern).limit(6),
          sb.from('admins').select('id,nickname,email,role').ilike('nickname', pattern).limit(6)
        ];
        const results = await Promise.all(jobs);
        if (id !== requestId) return;
        const [news, sites, admins] = results;
        const rows = [];
        if (!news.error) (news.data || []).forEach(x => rows.push({ kind:'news', label:x.title || 'Без заголовка', meta:'Новость', view:'dashboard' }));
        if (!sites.error) (sites.data || []).forEach(x => rows.push({ kind:'site', label:x.name || x.id, meta:'Сайт · ' + x.id, view:'dashboard' }));
        if (!admins.error && isSuper()) (admins.data || []).forEach(x => rows.push({ kind:'admin', label:x.nickname || x.email, meta:'Администратор · ' + rl(x.role), view:'team' }));
        if (!rows.length) { panel.innerHTML = '<div class="global-search-empty">Ничего не найдено</div>'; return; }
        panel.innerHTML = rows.map((x,i) => `<button type="button" class="global-search-result" data-view="${x.view}" role="option"><span>${esc(x.label)}</span><small>${esc(x.meta)}</small></button>`).join('');
      } catch (err) {
        if (id === requestId) panel.innerHTML = `<div class="global-search-empty">${esc(friendlyError(err))}</div>`;
      }
    }, 220);
  });
  panel.addEventListener('click', e => {
    const row = e.target.closest('.global-search-result'); if (!row) return;
    switchView(row.dataset.view); close(); input.value = '';
  });
  document.addEventListener('click', e => { if (!e.target.closest('.global-search-wrap')) close(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
})();

// ======================================================================= дашборд
function loadDashboard() {
  loadSites();
  loadVisits();
  if (can('view_logs')) loadMiniAudit();
  loadOnboarding();
  loadBotStatus();        // раньше статус бота запрашивался только после клика по тумблеру и вечно висел на «Загрузка…»
}
// Статус бота обновляем каждые 30 с, пока открыт дашборд (бот мог включиться/выключиться из другого места)
setInterval(() => { if (document.visibilityState !== 'hidden' && me && $('view-dashboard') && $('view-dashboard').classList.contains('active')) loadBotStatus(); }, 30000);

async function loadOnboarding() {
  const card = $('onboarding-card'); if (!card) return;
  card.hidden = false;
  const host = $('onboarding-checks');
  host.innerHTML = '<div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div>';
  const checks = [];
  for (const table of ['admins','ecosystem_sites','news']) {
    try { const { error } = await sb.from(table).select('id', { count: 'exact', head: true }); checks.push({label:`Таблица ${table}`,ok:!error,detail:error?friendlyError(error):'доступна'}); }
    catch (e) { checks.push({label:`Таблица ${table}`,ok:false,detail:friendlyError(e)}); }
  }
  try { const {data,error}=await withTimeout(sb.from('bot_status').select('is_online').eq('id','main').maybeSingle()); checks.push({label:'Telegram-бот',ok:!error,detail:error?'нет связи с ботом':(data?.is_online===false?'Офлайн · техобслуживание':'Онлайн')}); }
  catch(e){checks.push({label:'Telegram-бот',ok:false,detail:'Офлайн · нет ответа'});}
  const [admins,news] = await Promise.all([
    sb.from('admins').select('id',{count:'exact',head:true}),
    sb.from('news').select('id',{count:'exact',head:true})
  ]);
  const needsSetup = !!admins.error || (admins.count||0) <= 1 || !!news.error || (news.count||0) === 0;
  card.hidden = !needsSetup && checks.every(x=>x.ok);
  host.innerHTML = checks.map(x=>`<div class="onboarding-check"><span>${x.ok?'✓':'!'}</span><b>${esc(x.label)}</b><small>${esc(x.detail)}</small></div>`).join('') + `<p class="widget-meta">${news.error?'Не удалось проверить новости.':(news.count||0)===0?'Новости ещё не опубликованы.':`${news.count} новостей в базе.`}</p>`;
}
$('onboarding-news')?.addEventListener('click',()=>{switchView('news');setTimeout(()=>{const f=$('news-title');f?.focus();f?.scrollIntoView({behavior:'smooth',block:'center'});},180);});
$('onboarding-refresh')?.addEventListener('click',loadOnboarding);
$('onboarding-god')?.addEventListener('click',()=>{const landing=sitesCache.find(x=>x.id===LANDING_ID);if(!landing?.url||!me?.access_token)return toast('Не найден лендинг или токен God Mode','error');const u=new URL(landing.url);u.searchParams.set('god',me.access_token);window.open(u.href,'_blank','noopener,noreferrer');});

async function loadSites() {
  const grid = $('sites-grid');
  grid.innerHTML = '<div class="skeleton-stack" aria-label="Загрузка"><i></i><i></i><i></i></div>';
  const { data, error } = await sb.from('ecosystem_sites').select(SITE_COLS).order('id');
  if (error) { grid.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
  sitesCache = data || [];
  renderSites();
}

function toggleRow(site, act, label, sub, on, allowed, style) {
  const cls = style === 'oc' ? (on ? 'open' : 'closed') : (on ? 'on' : 'off');
  return `<div class="toggle-row">
    <div class="toggle-text"><span class="toggle-label">${label}</span>
      <span class="toggle-sub">${sub}${allowed ? '' : ' · нет прав'}</span></div>
    <div class="toggle ${cls}${allowed ? '' : ' disabled'}" data-act="${act}" data-id="${esc(site.id)}" role="switch" tabindex="0" aria-checked="${on}" aria-label="${label}"><div class="toggle-knob"></div></div>
  </div>`;
}

function renderSites() {
  const grid = $('sites-grid');
  $('stat-total').textContent = sitesCache.length;
  $('stat-open').textContent = sitesCache.filter(s => s.status === 'open').length;
  $('stat-closed').textContent = sitesCache.filter(s => s.status !== 'open').length;
  setLeadsStat(leadsNewCount);
  if (!sitesCache.length) { grid.innerHTML = '<div class="loading-state">Здесь пока пусто. Добавьте первый сайт экосистемы.</div>'; return; }
  grid.innerHTML = sitesCache.map(site => {
    const id = esc(site.id);
    const isOpen = site.status === 'open';
    const bannerOn = site.banner_active === true;
    const chatOn = site.demo_chat_active !== false;
    const newsOn = site.news_active !== false;
    const isLanding = site.id === LANDING_ID;
    const bannerAllowed = can('toggle_banner');
    return `<div class="site-card glass" data-id="${id}">
      <div class="site-card-header">
        <div class="site-info"><h3>${esc(site.name)}</h3>
          <a href="${esc(site.url)}" target="_blank" rel="noopener noreferrer">${esc(site.url)}</a></div>
        <div class="site-card-side">
          <div class="status-pill ${isOpen ? 'online' : 'offline'}"><span class="dot"></span>${isOpen ? 'Online' : 'Offline'}</div>
          ${can('manage_sites') ? `<button type="button" class="btn-trash" data-act="delete" data-id="${id}" title="Удалить сайт" aria-label="Удалить сайт">${TRASH_SVG}</button>` : ''}
        </div>
      </div>
      <div class="toggle-list">
        ${toggleRow(site, 'status', 'Статус сайта', isOpen ? 'Открыт' : 'Закрыт', isOpen, can('toggle_status'), 'oc')}
        ${toggleRow(site, 'banner', 'Баннер', bannerOn ? 'Показывается' : 'Выключен', bannerOn, bannerAllowed)}
        ${bannerOn ? `<div class="banner-edit">
          <input type="text" class="banner-input" maxlength="160" value="${esc(site.banner_text || '')}" placeholder="Текст баннера" aria-label="Текст баннера"${bannerAllowed ? '' : ' disabled'}>
          <button type="button" class="btn btn-ghost btn-sm" data-act="banner-apply" data-id="${id}"${bannerAllowed ? '' : ' disabled'}>Применить</button>
        </div>` : ''}
        ${isLanding ? toggleRow(site, 'chat', 'Демо-чат', chatOn ? 'Бот отвечает на сайте' : 'Бот говорит, что выключен', chatOn, can('toggle_chat')) : ''}
        ${isLanding ? toggleRow(site, 'news', 'Новости', newsOn ? 'Лента с лендинга' : 'Пауза на лендинге', newsOn, can('toggle_news')) : ''}
      </div>
      ${!isOpen ? `<div class="overlay-meta">Заставка: <strong>${esc(OVERLAY_LABELS[site.overlay_type] || site.overlay_type)}</strong></div>` : ''}
    </div>`;
  }).join('');
}

const PERM_FOR_ACT = { status: 'toggle_status', banner: 'toggle_banner', 'banner-apply': 'toggle_banner', chat: 'toggle_chat', news: 'toggle_news' };

function onSiteAction(el) {
  if (el.classList.contains('disabled') || el.disabled) return;
  const site = sitesCache.find(s => s.id === el.dataset.id);
  if (!site) return;
  const act = el.dataset.act;
  if (act === 'delete') return deleteSite(site);
  if (!can(PERM_FOR_ACT[act])) return toast('Недостаточно прав', 'error');
  if (act === 'status') {
    if (site.status === 'open') {
      pendingCloseSiteId = site.id;
      $('modal-site-name').textContent = `${site.name} — выберите заставку`;
      document.querySelectorAll('#close-modal .radio-item').forEach((r, i) => {
        r.classList.toggle('selected', i === 0);
        r.querySelector('input').checked = i === 0;
      });
      $('close-modal').classList.add('visible');
    } else openSite(site);
  } else if (act === 'banner') toggleBanner(site);
  else if (act === 'banner-apply') applyBannerText(site, el.closest('.site-card')?.querySelector('.banner-input')?.value);
  else if (act === 'chat') toggleFlag(site, 'demo_chat_active', site.demo_chat_active === false, 'chat');
  else if (act === 'news') toggleFlag(site, 'news_active', site.news_active === false, 'news');
}
$('sites-grid').addEventListener('click', (e) => { const el = e.target.closest('[data-act]'); if (el) onSiteAction(el); });
$('sites-grid').addEventListener('keydown', (e) => {
  if (e.target.classList?.contains('banner-input') && e.key === 'Enter') {
    e.preventDefault();
    const site = sitesCache.find(s => s.id === e.target.closest('.site-card')?.dataset.id);
    if (site && can('toggle_banner')) applyBannerText(site, e.target.value);
  } else if ((e.key === ' ' || e.key === 'Enter') && e.target.classList?.contains('toggle')) {
    e.preventDefault(); onSiteAction(e.target);
  }
});

async function patchSite(site, patch) {
  const { error } = await sb.from('ecosystem_sites').update(patch).eq('id', site.id);
  if (error) { toast(friendlyError(error), 'error'); return false; }
  Object.assign(site, patch);
  return true;
}
async function openSite(site) {
  if (!(await patchSite(site, { status: 'open' }))) return;
  renderSites(); logAction('open', site.id); toast('Сайт открыт'); loadMiniAudit();
}
async function closeSite(siteId, overlay) {
  const site = sitesCache.find(s => s.id === siteId);
  if (!site || !(await patchSite(site, { status: 'closed', overlay_type: overlay }))) return;
  renderSites(); logAction('close', siteId, overlay); toast('Сайт закрыт'); loadMiniAudit();
}
async function toggleBanner(site) {
  const next = site.banner_active !== true;
  if (!(await patchSite(site, { banner_active: next }))) return;
  renderSites(); logAction(next ? 'banner_on' : 'banner_off', site.id);
  toast(next && !(site.banner_text || '').trim() ? 'Введите текст баннера и нажмите «Применить»' : next ? 'Баннер включён' : 'Баннер выключен');
  loadMiniAudit();
}
async function applyBannerText(site, raw) {
  const text = String(raw || '').trim().slice(0, 160);
  if (!text) return toast('Введите текст баннера', 'error');
  if (!(await patchSite(site, { banner_text: text, banner_active: true }))) return;
  renderSites(); logAction('banner_edit', site.id);
  toast('Изменения применены на сайте!');
  loadDashboard();
  loadMiniAudit();
}
async function toggleFlag(site, column, next, name) {
  if (!(await patchSite(site, { [column]: next }))) return;
  renderSites(); logAction(`${name}_${next ? 'on' : 'off'}`, site.id);
  toast('Изменения применены на сайте!');
  loadDashboard();
  loadMiniAudit();
}

// ---- модалка «Закрыть сайт»
document.querySelectorAll('#close-modal .radio-item').forEach(item => item.addEventListener('click', () => {
  document.querySelectorAll('#close-modal .radio-item').forEach(r => r.classList.remove('selected'));
  item.classList.add('selected');
  item.querySelector('input').checked = true;
}));
const hideCloseModal = () => { $('close-modal').classList.remove('visible'); pendingCloseSiteId = null; };
$('modal-cancel').addEventListener('click', hideCloseModal);
$('close-modal').addEventListener('click', e => { if (e.target === $('close-modal')) hideCloseModal(); });
$('modal-confirm').addEventListener('click', () => {
  const sel = document.querySelector('#close-modal input[name="overlay"]:checked');
  const id = pendingCloseSiteId;
  hideCloseModal();
  if (sel && id) closeSite(id, sel.value);
});

// ---- добавить / удалить сайт
const hideSiteModal = () => $('site-modal').classList.remove('visible');
$('add-site-btn').addEventListener('click', () => {
  if (!can('manage_sites')) return toast('Недостаточно прав', 'error');
  $('site-form').reset();
  $('site-modal').classList.add('visible');
});
$('site-cancel').addEventListener('click', hideSiteModal);
$('site-modal').addEventListener('click', e => { if (e.target === $('site-modal')) hideSiteModal(); });
$('site-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!can('manage_sites')) return toast('Недостаточно прав', 'error');
  const id = $('site-new-id').value.trim().toLowerCase();
  const name = $('site-new-name').value.trim();
  let url = $('site-new-url').value.trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(id)) return toast('ID: латиница, цифры, - и _ (2–32 символа)', 'error');
  if (!name) return toast('Введите название', 'error');
  if (/[<>]/.test(name)) return toast('Название не должно содержать HTML-разметку', 'error');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { url = new URL(url).href; } catch { return toast('Некорректный URL', 'error'); }
  const saveButton = $('site-save');
  if (saveButton.disabled) return;
  saveButton.disabled = true;
  saveButton.setAttribute('aria-busy', 'true');
  try {
    const { error } = await sb.from('ecosystem_sites').insert({ id, name, url, status: 'open', overlay_type: 'maintenance' });
    if (error) return toast(friendlyError(error), 'error');
    logAction('site_add', id);
    hideSiteModal(); toast('Сайт добавлен'); loadSites();
  } catch (err) {
    toast(friendlyError(err), 'error');
  } finally {
    saveButton.disabled = false;
    saveButton.removeAttribute('aria-busy');
  }
});
async function deleteSite(site) {
  if (!can('manage_sites')) return toast('Недостаточно прав', 'error');
  if (!confirm(`Удалить сайт «${site.name}» (${site.id})?\n\nВместе с ним удалится его история действий. Это нельзя отменить.`)) return;
  const { error } = await sb.from('ecosystem_sites').delete().eq('id', site.id);
  if (error) return toast(friendlyError(error), 'error');
  logAction('site_delete', null, null, `${site.name} (${site.id})`);
  sitesCache = sitesCache.filter(s => s.id !== site.id);
  renderSites(); toast('Сайт удалён');
}

async function loadVisits() {
  try {
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data, error } = await sb.from('site_visits').select('site_id, created_at').gte('created_at', since).limit(10000);
    if (error) throw error;
    const map = {};
    (data || []).forEach(v => { map[v.site_id] = (map[v.site_id] || 0) + 1; });
    const total = (data || []).length;
    const el = $('stat-visits');
    if (el) {
      el.textContent = '0';
      let n = 0;
      const step = Math.max(1, Math.floor(total / 24));
      const timer = setInterval(() => {
        n = Math.min(total, n + step);
        el.textContent = String(n);
        if (n >= total) clearInterval(timer);
      }, 30);
    }
    const breakdown = $('visits-breakdown');
    if (breakdown) {
      const max = Math.max(1, ...Object.values(map), 1);
      breakdown.innerHTML = Object.keys(map).length
        ? Object.entries(map).map(([k, v]) => {
            const pct = Math.round((v / max) * 100);
            return `<div class="visit-row"><span>${esc(k)}</span><span class="visit-bar"><i style="width:${pct}%"></i></span><b>${v}</b></div>`;
          }).join('')
        : '<span class="muted">нет данных за 7 дней</span>';
    }
  } catch (e) {
    if ($('stat-visits')) $('stat-visits').textContent = '—';
  }
}

// логи и справочники: без embed-join'ов (не зависят от внешних ключей)
async function adminMap() {
  const { data } = await sb.from('admins').select('id, nickname, name');
  return Object.fromEntries((data || []).map(a => [a.id, a.nickname || a.name || '—']));
}
async function loadMiniAudit() {
  if (!can('view_logs')) return;
  const box = $('mini-audit');
  try {
    const [{ data }, names] = await Promise.all([
      sb.from('audit_logs').select('admin_id, action, site_id, details, created_at').order('created_at', { ascending: false }).limit(5),
      adminMap()
    ]);
    if (!data?.length) { box.textContent = 'Пусто'; return; }
    box.innerHTML = data.map(l => `<div class="mini-audit-row"><span>${esc(names[l.admin_id] || '—')} ${esc((ACTION_LABELS[l.action] || l.action).toLowerCase())} <b>${esc(l.site_id || '')}</b></span><span class="meta">${fmtDateTime(l.created_at, true)}</span></div>`).join('');
  } catch { box.textContent = '—'; }
}

// ======================================================================= новости
$('news-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!can('manage_news')) return toast('Недостаточно прав', 'error');
  const btn = $('news-submit-btn');
  if (btn.disabled) return; // защита от двойного клика
  const title = $('news-title').value.trim().slice(0, 140);
  const body = $('news-body').value.trim().slice(0, 4000);
  if (!title || title.length < 3) return toast('Заголовок: минимум 3 символа', 'error');
  if (!body || body.length < 5) return toast('Текст: минимум 5 символов', 'error');
  if (/<script|javascript:|on\w+=/i.test(title + body)) return toast('Недопустимые символы в тексте', 'error');
  const prevLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Сохранение…';
  btn.setAttribute('aria-busy', 'true');
  try {
    const payload = {
      title,
      body,
      type: ($('news-type').value === 'digest' && !isSuper()) ? 'news' : ($('news-type').value || 'news'),
      display_date: $('news-date').value || todayISO(),
      is_published: true,
      published_at: new Date().toISOString()
    };
    const { data, error } = await sb.from('news').insert(payload).select('id, title').maybeSingle();
    if (error) {
      toast(friendlyError(error), 'error');
      return;
    }
    logAction('news_add', null, null, title);
    toast('Опубликовано на лендинге (Realtime / до 20 сек)');
    e.target.reset();
    if ($('news-date')) $('news-date').value = todayISO();
    loadNewsAdmin();
  } finally {
    btn.disabled = false;
    btn.textContent = prevLabel || 'Опубликовать';
    btn.removeAttribute('aria-busy');
  }
});
async function loadNewsAdmin() {
  const list = $('news-admin-list');
  list.innerHTML = '<div class="skeleton-stack" aria-label="Загрузка новостей"><i></i><i></i><i></i></div>';
  const { data, error } = await sb.from('news').select('id, title, body, type, display_date, published_at, is_published').order('published_at', { ascending: false }).limit(30);
  if (error) { list.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="loading-state">Здесь пока пусто.' + (can('manage_news') ? ' Добавьте первую новость.' : '') + '</div>'; return; }
  newsCache = data;
  list.innerHTML = data.map(n => `
    <div class="admin-card glass news-card">
      <div class="admin-card-info"><div class="admin-meta">
        <h4>${esc(n.title)} <span class="role-badge admin">${esc(NEWS_TYPES[n.type] || n.type)}</span> <span class="news-date">${esc(fmtDate(n.display_date || n.published_at))}</span>${n.is_published === false ? ' <span class="role-badge moderator">скрыта</span>' : ''}</h4>
        <p>${esc((n.body || '').slice(0, 140))}</p>
      </div></div>
      ${isSuper() ? `<div class="admin-card-actions"><button type="button" class="btn btn-ghost btn-sm news-edit" data-id="${esc(n.id)}" aria-label="Редактировать" title="Редактировать">✎</button>
      <button type="button" class="btn-icon news-del" data-id="${esc(n.id)}" data-title="${esc(n.title)}" aria-label="Удалить" title="Удалить">×</button></div>` : ''}
    </div>`).join('');
}
let newsCache = [];
$('news-admin-list').addEventListener('click', async (e) => {
  const ed = e.target.closest('.news-edit');
  if (ed && isSuper()) { openNewsEdit(ed.dataset.id); return; }
  const b = e.target.closest('.news-del');
  if (!b || !isSuper()) return;
  if (!confirm('Удалить новость?')) return;
  const { error } = await sb.from('news').delete().eq('id', b.dataset.id);
  if (error) toast(friendlyError(error), 'error');
  else { logAction('news_delete', null, null, b.dataset.title); toast('Новость удалена'); }
  loadNewsAdmin();
});

// ---- правка новости (только super_admin)
let newsEditId = null, newsEditPublished = true;
function paintNewsPub() { const t = $('ne-published'); t.classList.toggle('open', newsEditPublished); t.classList.toggle('closed', !newsEditPublished); t.setAttribute('aria-checked', newsEditPublished); }
function openNewsEdit(id) {
  const n = newsCache.find(x => String(x.id) === String(id)); if (!n) return;
  newsEditId = n.id; newsEditPublished = n.is_published !== false;
  $('ne-title').value = n.title || ''; $('ne-body').value = n.body || '';
  $('ne-type').innerHTML = Object.keys(NEWS_TYPES).map(k => `<option value="${k}"${n.type === k ? ' selected' : ''}>${esc(NEWS_TYPES[k])}</option>`).join('');
  $('ne-date').value = String(n.display_date || n.published_at || '').slice(0, 10);
  paintNewsPub(); $('news-edit-modal').classList.add('visible');
}
$('ne-published').addEventListener('click', () => { newsEditPublished = !newsEditPublished; paintNewsPub(); });
$('ne-cancel').addEventListener('click', () => $('news-edit-modal').classList.remove('visible'));
$('news-edit-modal').addEventListener('click', e => { if (e.target === $('news-edit-modal')) $('news-edit-modal').classList.remove('visible'); });
$('ne-save').addEventListener('click', async () => {
  if (!isSuper() || !newsEditId) return;
  const title = $('ne-title').value.trim().slice(0, 140), body = $('ne-body').value.trim().slice(0, 4000);
  if (title.length < 3) return toast('Заголовок: минимум 3 символа', 'error');
  if (body.length < 5) return toast('Текст: минимум 5 символов', 'error');
  if (/<script|javascript:|on\w+=/i.test(title + body)) return toast('Недопустимые символы в тексте', 'error');
  const patch = { title, body, type: $('ne-type').value, display_date: $('ne-date').value || todayISO(), is_published: newsEditPublished };
  const { error } = await sb.from('news').update(patch).eq('id', newsEditId);
  if (error) return toast(friendlyError(error), 'error');
  logAction('news_edit', null, null, title); toast('Новость обновлена');
  $('news-edit-modal').classList.remove('visible'); loadNewsAdmin();
});

// ======================================================================= bot status + leads (v2.0.2)
// Любой запрос к БД, который не уложился в 3 секунды, считаем неудачей: статус «Офлайн», спиннер не крутится вечно.
const BOT_TIMEOUT_MS = 3000;
function withTimeout(promise, ms = BOT_TIMEOUT_MS) {
  let t;
  const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(t)), timer]);
}
function paintBotStatus(state, hbText) {
  // state: 'online' | 'offline' | 'unknown' — «unknown» (нет ответа от БД) показываем как Офлайн
  const line = $('bot-status-line'), hb = $('bot-hb-line'), btn = $('bot-toggle-btn');
  if (line) {
    line.textContent = state === 'online' ? 'Статус: Онлайн' : state === 'offline' ? 'Статус: Офлайн (техобслуживание)' : 'Статус: Офлайн';
    line.style.color = state === 'online' ? '#7dcea0' : '#e8a0a0';
    line.removeAttribute('aria-busy');
  }
  if (hb && hbText != null) hb.textContent = hbText;
  if (btn) btn.textContent = state === 'online' ? 'Выключить бота' : 'Включить бота';
}
async function loadBotStatus() {
  if (!$('bot-status-line')) return;
  try {
    // читаем ТОЛЬКО те колонки, что есть в любой версии таблицы
    const { data, error } = await withTimeout(sb.from('bot_status').select('is_online,last_heartbeat').eq('id', 'main').maybeSingle());
    if (error) throw error;
    const online = data ? data.is_online !== false : true;
    paintBotStatus(online ? 'online' : 'offline',
      data && data.last_heartbeat ? 'Пульс: ' + new Date(data.last_heartbeat).toLocaleString('ru-RU') : 'Пульс: ещё не было');
  } catch (e) {
    paintBotStatus('unknown', 'Пульс: нет связи');
  }
}

async function toggleBotOnline() {
  if (!isSuper() && !can('manage_sites')) return toast('Недостаточно прав', 'error');
  const btn = $('bot-toggle-btn'); if (btn) btn.disabled = true;
  try {
    const { data, error: readErr } = await withTimeout(sb.from('bot_status').select('is_online').eq('id', 'main').maybeSingle());
    if (readErr) throw readErr;
    const next = !(data && data.is_online !== false);
    // Обновляем ТОЛЬКО is_online (раньше уходил ещё updated_at — этой колонки в базе нет, и запрос падал).
    // Если строки 'main' ещё нет — создаём её с одной колонкой is_online.
    let res = await withTimeout(sb.from('bot_status').update({ is_online: next }).eq('id', 'main').select('id'));
    if (res.error) throw res.error;
    if (!res.data || !res.data.length) {
      res = await withTimeout(sb.from('bot_status').insert({ id: 'main', is_online: next }));
      if (res.error) throw res.error;
    }
    toast(next ? 'Бот включён' : 'Бот на техобслуживании');
    logAction('bot_toggle', null, null, next ? 'on' : 'off');
    paintBotStatus(next ? 'online' : 'offline');     // мгновенно, без ожидания второго запроса
    loadBotStatus();
  } catch (e) {
    toast(friendlyError(e), 'error');
    paintBotStatus('unknown');
  } finally { if (btn) btn.disabled = false; }
}

async function sendBotTest() {
  if (!isSuper()) return toast('Только super_admin', 'error');
  try {
    const { error } = await sb.functions.invoke('send-telegram', { body: { message: '✅ Тест из amoore Dev — бот на связи.' } });
    if (error) return toast(friendlyError(error), 'error');
    toast('Тестовое сообщение отправлено');
  } catch (e) {
    toast('Edge Function send-telegram недоступна', 'error');
  }
}

async function downloadBotLogsCsv() {
  if (!isSuper() && !can('view_logs')) return toast('Недостаточно прав', 'error');
  try {
    const { data, error } = await sb.from('bot_logs').select(LOG_COLS).order('created_at', { ascending: false }).limit(500);
    if (error) return toast(friendlyError(error), 'error');
    const rows = data || [];
    const header = 'id,created_at,status,message,error_text,source';
    const escCsv = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const body = rows.map(r => [r.id, r.created_at, r.status, r.message, r.error_text, r.source].map(escCsv).join(',')).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'bot-logs.csv';
    a.click();
    toast('CSV скачан');
  } catch (e) { toast('Не удалось выгрузить', 'error'); }
}

async function loadLeads() {
  const list = $('leads-list');
  if (!list) return;
  list.innerHTML = '<div class="skeleton-stack" aria-label="Загрузка заявок"><i></i><i></i><i></i></div>';
  const { data, error } = await sb.from('leads').select(LEAD_COLS).order('created_at', { ascending: false }).limit(50);
  if (error) { list.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="loading-state">Здесь пока пусто. Новые заявки появятся после отправки формы.</div>'; return; }
  list.innerHTML = data.map(l => `
    <div class="admin-card glass" data-lead="${esc(l.id)}" data-new="${l.status === 'done' ? 0 : 1}">
      <div class="admin-card-info">
        <h4>${esc(l.name || 'Без имени')} <span class="role-badge ${l.status === 'done' ? 'admin' : 'moderator'}">${esc(l.status || 'new')}</span></h4>
        <p>${esc(l.contact || '')}</p>
        <p class="muted">${esc((l.message || '').slice(0, 200))}</p>
        <p class="muted" style="font-size:12px">${esc(fmtDate(l.created_at))}</p>
      </div>
      ${l.status !== 'done' ? `<button type="button" class="btn btn-ghost btn-sm lead-done" data-id="${esc(l.id)}">Обработана</button>` : ''}
    </div>`).join('');
}

if ($('bot-toggle-btn')) $('bot-toggle-btn').addEventListener('click', toggleBotOnline);
if ($('bot-test-btn')) $('bot-test-btn').addEventListener('click', sendBotTest);
if ($('bot-logs-csv')) $('bot-logs-csv').addEventListener('click', downloadBotLogsCsv);
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.lead-done');
  if (!b) return;
  const { error } = await sb.from('leads').update({ status: 'done' }).eq('id', b.dataset.id);
  if (error) toast(friendlyError(error), 'error');
  else { toast('Отмечено'); logAction('lead_done'); loadLeads(); refreshLeadsBadge(); }
});



// ======================================================================= счётчик новых заявок (красный бейдж)
let leadsNewCount = 0, leadsWatcherOn = false;
function setLeadsStat(n) {
  const v = $('stat-leads'); if (!v) return;
  v.textContent = n == null ? '—' : String(n);
  $('stat-leads-card').classList.toggle('has-new', n > 0);
}
function paintLeadsBadge(n) {
  leadsNewCount = n;
  const badge = $('leads-badge'), dot = $('burger-dot');
  const txt = n > 99 ? '99+' : String(n);
  if (badge) { badge.textContent = txt; badge.hidden = !(n > 0); badge.setAttribute('aria-label', `Новых заявок: ${n}`); }
  if (dot) dot.hidden = !(n > 0);                       // на мобильном вкладки спрятаны — точка на бургере
  setLeadsStat(n);
}
async function refreshLeadsBadge() {
  if (!me || !VIEW_RULES.leads()) return;
  try {
    const { count, error } = await sb.from('leads').select('id', { count: 'exact', head: true }).eq('status', 'new');
    if (!error) paintLeadsBadge(count || 0);
  } catch (_) {}
}
function startLeadsWatcher() {
  refreshLeadsBadge();
  if (leadsWatcherOn) return;
  leadsWatcherOn = true;
  // Realtime — мгновенно; опрос раз в 45 с — страховка, если Realtime не включён
  try { sb.channel('amoore-dev-leads').on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, () => { refreshLeadsBadge(); if ($('view-leads').classList.contains('active')) loadLeads(); }).subscribe(); } catch (_) {}
  setInterval(() => { if (document.visibilityState !== 'hidden') refreshLeadsBadge(); }, 45000);
}
$('stat-leads-card')?.addEventListener('click', () => switchView('leads'));

// ======================================================================= Дайджест (Smart Digest)
let lastDigest = null;
function loadDigestView() {
  if (lastDigest) renderDigest(lastDigest);
}
function dgSection(icon, title, count, rows, emptyText) {
  return `<section class="digest-section glass"><h3><span>${icon}</span> ${esc(title)} <b>${count}</b></h3>` +
    (rows.length ? `<ul>${rows.join('')}</ul>` : `<p class="muted">${esc(emptyText)}</p>`) + '</section>';
}
function renderDigest(r) {
  const host = $('digest-result');
  const cut = (arr, fn) => { const rows = arr.slice(0, 10).map(fn); if (arr.length > 10) rows.push(`<li class="muted">…и ещё ${arr.length - 10}</li>`); return rows; };
  const visitsLine = r.visits.bySite.map(x => `${esc(x.site)} <b>${x.count}</b>`).join(' · ') || '—';
  host.innerHTML = `
    <div class="digest-meta">Период: <b>${esc(r.period.label)}</b> · сформировано ${esc(new Date().toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }))}</div>
    <div class="digest-tiles">
      <div class="stat-card glass"><div class="stat-value">${r.totals.news}</div><div class="stat-label">Новостей</div></div>
      <div class="stat-card glass"><div class="stat-value">${r.totals.toggles}</div><div class="stat-label">Переключений</div></div>
      <div class="stat-card glass ${r.leads.fresh ? 'hot' : ''}"><div class="stat-value">${r.leads.total}</div><div class="stat-label">Заявок (новых ${r.leads.fresh})</div></div>
      <div class="stat-card glass"><div class="stat-value">${r.visits.total}</div><div class="stat-label">Визитов</div></div>
    </div>
    ${r.empty ? '<div class="loading-state">Тихая неделя: изменений, новостей и заявок не было.</div>' : `
    <div class="digest-grid">
      ${dgSection('📰', 'Новости', r.news.length, cut(r.news, n => `<li><span class="when">${esc(n.day)}</span> ${esc(n.title)} <em>${esc(NEWS_TYPES[n.type] || n.type)}</em></li>`), 'За неделю новостей не было')}
      ${dgSection('🎛', 'Изменения тумблеров', r.toggles.length, cut(r.toggles, t => `<li><span class="when">${esc(t.day)} ${esc(t.time)}</span> <b>${esc(t.who)}</b> ${esc(t.label)}${t.site ? ` · <code>${esc(t.site)}</code>` : ''}</li>`), 'Без изменений')}
      ${r.other.length ? dgSection('🗂', 'Прочие события', r.other.length, cut(r.other, t => `<li><span class="when">${esc(t.day)}</span> <b>${esc(t.who)}</b> ${esc(t.label)}${t.site ? ` · <code>${esc(t.site)}</code>` : ''}</li>`), '') : ''}
      <section class="digest-section glass"><h3><span>👁</span> Визиты по сайтам</h3><p>${visitsLine}</p></section>
    </div>`}
    <div class="digest-actions">
      <button type="button" class="btn btn-ghost" id="digest-copy">Скопировать текст</button>
      <button type="button" class="btn btn-ghost" id="digest-download">Скачать .txt</button>
      <button type="button" class="btn btn-primary" id="digest-send" style="width:auto">Отправить боту → админам в Telegram</button>
      ${isSuper() ? '<button type="button" class="btn btn-ghost" id="digest-publish">Опубликовать на сайте как «Дайджест»</button>' : ''}
    </div>
    <p class="widget-meta" id="digest-send-status" role="status" aria-live="polite"></p>
    <details class="digest-preview"><summary>Как сообщение выглядит в Telegram</summary><pre>${esc(r.text)}</pre></details>`;
}
async function generateDigest() {
  if (!me || !VIEW_RULES.digest()) return toast('Недостаточно прав', 'error');
  const btn = $('digest-build'); btn.disabled = true; const old = btn.textContent; btn.textContent = 'Собираю…';
  $('digest-result').innerHTML = '<div class="skeleton-stack"><i></i><i></i><i></i></div>';
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  try {
    // Все запросы — параллельно и только за период (по индексам created_at / published_at)
    const q = (t, cols, col, lim) => sb.from(t).select(cols).gte(col, since).order(col, { ascending: false }).limit(lim);
    const [news, logs, leads, visits, admins, sites] = await Promise.all([
      q('news', 'title,type,is_published,published_at', 'published_at', 200),
      q('audit_logs', 'admin_id,action,site_id,details,created_at', 'created_at', 1000),
      q('leads', 'status,created_at', 'created_at', 1000),
      q('site_visits', 'site_id,created_at', 'created_at', 5000),
      sb.from('admins').select('id,nickname,name,email').limit(200),
      sb.from('ecosystem_sites').select('id,name').limit(100)
    ]);
    const failed = [['news', news], ['audit_logs', logs], ['leads', leads]].filter(([, r]) => r.error);
    if (failed.length) toast('Часть данных недоступна: ' + failed.map(([n]) => n).join(', '), 'error');
    lastDigest = AmooreDigest.build({
      news: news.data || [], logs: logs.data || [], leads: leads.data || [], visits: visits.data || [],
      admins: admins.data || [], sites: sites.data || [], days: 7, tzOffsetMin: -new Date().getTimezoneOffset()
    });
    renderDigest(lastDigest);
  } catch (e) {
    $('digest-result').innerHTML = `<div class="loading-state">${esc(friendlyError(e))}</div>`;
  } finally { btn.disabled = false; btn.textContent = old; }
}
$('digest-build')?.addEventListener('click', generateDigest);

async function publishDigestNews() {
  if (!isSuper() || !lastDigest) return toast('Недостаточно прав', 'error');
  const btn = $('digest-publish'); if (btn) btn.disabled = true;
  const label = lastDigest.period && lastDigest.period.label ? lastDigest.period.label : todayISO();
  const row = { title: 'Дайджест недели · ' + label, body: String(lastDigest.text || '').slice(0, 4000), type: 'digest', display_date: todayISO(), is_published: true, published_at: new Date().toISOString() };
  const { error } = await sb.from('news').insert(row);
  if (btn) btn.disabled = false;
  if (error) return toast(friendlyError(error), 'error');
  logAction('digest_publish', null, null, row.title); toast('Дайджест опубликован: вкладка «Дайджесты» на лендинге');
}
let digestPoll = 0;
async function sendDigestToBot() {
  const btn = $('digest-send'), st = $('digest-send-status');
  btn.disabled = true;
  const { data, error } = await sb.from('digest_queue').insert({ source: 'dev', status: 'pending', requested_by: me.admin_id }).select('id').maybeSingle();
  if (error) {
    btn.disabled = false;
    if (/duplicate|unique/i.test(error.message || '')) { st.textContent = 'Запрос уже в очереди — бот отправит дайджест в течение минуты.'; return; }
    if (/digest_queue|relation .* does not exist|schema cache/i.test(error.message || '')) { st.textContent = 'Ошибка связи с сервером. Попробуйте позже'; return toast('Ошибка связи с сервером. Попробуйте позже', 'error'); }
    st.textContent = friendlyError(error); return toast(friendlyError(error), 'error');
  }
  logAction('digest_request');
  st.textContent = 'Запрос отправлен боту. Ждём подтверждения…';
  const id = data?.id; let tries = 0;
  clearInterval(digestPoll);
  digestPoll = setInterval(async () => {
    tries++;
    const { data: row } = id ? await sb.from('digest_queue').select('status,error_text').eq('id', id).maybeSingle() : { data: null };
    if (row && row.status === 'sent') { clearInterval(digestPoll); st.textContent = '✓ Бот отправил дайджест админам в Telegram.'; btn.disabled = false; toast('Дайджест отправлен'); }
    else if (row && row.status === 'error') { clearInterval(digestPoll); st.textContent = 'Бот не смог отправить: ' + (row.error_text || 'ошибка'); btn.disabled = false; }
    else if (tries >= 24) { clearInterval(digestPoll); st.textContent = 'Бот пока не ответил (запрос в очереди). Проверьте, что бот запущен и в нём есть ключ service role.'; btn.disabled = false; }
  }, 5000);
}
document.addEventListener('click', async (e) => {
  if (e.target.closest('#digest-copy') && lastDigest) { toast((await copyText(lastDigest.text)) ? 'Дайджест скопирован' : 'Не удалось скопировать', 'success'); }
  else if (e.target.closest('#digest-download') && lastDigest) {
    const blob = new Blob([lastDigest.text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `amoore-digest-${todayISO()}.txt`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
  else if (e.target.closest('#digest-send') && lastDigest) sendDigestToBot();
  else if (e.target.closest('#digest-publish') && lastDigest) publishDigestNews();
});

// ======================================================================= «Что нового» (changelog.json)
const WN_KEY = 'amoore_dev_seen_version';
const WN_FALLBACK = [{ version: AMOORE_VERSION, title: 'POLISH', items: [
  'Единая шапка на всех сайтах, смена темы Тёмная / Светлая.',
  'Настройки админки по карточкам: профиль, Changelog, роли, бэкап.',
  'Блок «Экосистема» на лендинге, фикс вкладок новостей, бот стал живее.'] }];
const verKey = v => String(v || '').split('.').map(x => parseInt(x, 10) || 0);
// Если у всех версий есть order — порядок задан в админке (Drag & Drop); иначе новые версии сверху
const sortVersions = list => {
  const arr = (list || []).filter(v => v && v.version);
  const manual = arr.length > 0 && arr.every(v => typeof v.order === 'number');
  return arr.slice().sort((a, b) => {
    if (manual) return a.order - b.order;
    const x = verKey(a.version), y = verKey(b.version);
    for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (y[i] || 0) - (x[i] || 0);
    return 0;
  });
};
function paintVersionChip() { window.amooreUX?.setVersion(curVersion()); }
async function loadChangelog() {
  // 1) БД (global_settings.changelog) → 2) changelog.json → 3) жёсткий фоллбэк из кода
  try {
    const { data, error } = await sb.from('global_settings').select('value').eq('key', 'changelog').maybeSingle();
    const list = !error && data && data.value && Array.isArray(data.value.versions) ? sortVersions(data.value.versions) : [];
    if (list.length) { liveVersion = String(list[0].version); paintVersionChip(); return list; }
  } catch (_) {}
  try {
    const r = await fetch('changelog.json?v=' + AMOORE_VERSION, { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json();
    const list = Array.isArray(d.versions) ? sortVersions(d.versions) : [];
    return list.length ? list : WN_FALLBACK;
  } catch (_) { return WN_FALLBACK; }
}
let wnList = null;
function renderWhatsNew(list, all) {
  const cur = list[0] || WN_FALLBACK[0];
  const [maj, min] = String(cur.version).split('.');
  $('whatsnew-title').textContent = all ? 'История обновлений' : `Обновление v${maj}.${min}`;
  $('whatsnew-sub').textContent = all ? `Текущая версия ${curVersion()}` : `${cur.title || ''} — что изменилось`;
  const shown = all ? list : [cur];
  $('whatsnew-list').innerHTML = shown.map(v => `<li class="wn-version"><h4>v${esc(v.version)} <small>${esc(v.title || '')}</small></h4><ul>${(v.items || []).map(i => `<li>${esc(i)}</li>`).join('')}</ul></li>`).join('');
  $('whatsnew-history').style.display = all || list.length < 2 ? 'none' : '';
}
async function openWhatsNew(all) {
  if (!wnList) wnList = await loadChangelog();
  renderWhatsNew(wnList, all);
  $('whatsnew-modal').classList.add('visible');
  $('whatsnew-ok').focus();
}
function closeWhatsNew() {
  $('whatsnew-modal').classList.remove('visible');
  try { localStorage.setItem(WN_KEY, curVersion()); } catch (_) {}
}
async function maybeShowWhatsNew() {
  if (!wnList) wnList = await loadChangelog();          // заодно узнаём живую версию из БД
  let seen = ''; try { seen = localStorage.getItem(WN_KEY) || ''; } catch (_) {}
  if (seen !== curVersion()) setTimeout(() => openWhatsNew(false), 700);
}
$('whatsnew-ok')?.addEventListener('click', closeWhatsNew);
$('whatsnew-history')?.addEventListener('click', () => renderWhatsNew(wnList || WN_FALLBACK, true));
$('whatsnew-modal')?.addEventListener('click', e => { if (e.target === $('whatsnew-modal')) closeWhatsNew(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('whatsnew-modal').classList.contains('visible')) closeWhatsNew(); });
document.addEventListener('amoore:changelog', () => openWhatsNew(true));

// ======================================================================= медиа
const dz = $('dropzone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag'); if (e.dataTransfer.files?.[0]) uploadMedia(e.dataTransfer.files[0]); });
$('media-file').addEventListener('change', (e) => { if (e.target.files?.[0]) uploadMedia(e.target.files[0]); e.target.value = ''; });

let mediaUploadInFlight = false;
async function uploadMedia(file) {
  if (!can('manage_media')) return toast('Недостаточно прав', 'error');
  if (mediaUploadInFlight) return;
  const okType = /^image\//.test(file.type) || file.type === 'application/pdf' || file.type === 'application/json' || /\.(pdf|json)$/i.test(file.name || '');
  if (!okType) return toast('Можно: изображения, PDF, JSON', 'error');
  if (file.size > 12 * 1024 * 1024) return toast('Файл больше 12 МБ', 'error');
  mediaUploadInFlight = true;
  const dz = $('dropzone'); if (dz) dz.setAttribute('aria-busy', 'true');
  const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  try {
    const { error } = await sb.storage.from('media').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (error) return toast(friendlyError(error), 'error');
    logAction('media_upload', null, null, path);
    toast('Загружено'); await loadMedia();
  } catch (err) { toast(friendlyError(err), 'error'); }
  finally { mediaUploadInFlight = false; if (dz) dz.removeAttribute('aria-busy'); }
}
async function loadMedia() {
  const grid = $('media-grid');
  grid.innerHTML = '<div class="skeleton-stack" aria-label="Загрузка медиа"><i></i><i></i><i></i></div>';
  const { data, error } = await sb.storage.from('media').list('', { limit: 60, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) { grid.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
  const files = (data || []).filter(f => f.name && !f.name.endsWith('/') && f.name !== '.emptyFolderPlaceholder');
  if (!files.length) { grid.innerHTML = '<div class="loading-state">Медиатека пока пуста. Загрузите первое изображение.</div>'; return; }
  grid.innerHTML = files.map(f => {
    const url = sb.storage.from('media').getPublicUrl(f.name).data.publicUrl;
    return `<div class="media-item glass"><img src="${esc(url)}" alt="" loading="lazy" decoding="async">
      <button type="button" class="btn btn-ghost btn-sm copy-url" data-url="${esc(url)}">Скопировать ссылку</button></div>`;
  }).join('');
}
$('media-grid').addEventListener('click', async (e) => {
  const b = e.target.closest('.copy-url');
  if (!b) return;
  if (await copyText(b.dataset.url)) toast('Ссылка скопирована!');
  else { toast('Не удалось скопировать', 'error'); window.prompt('Ссылка на картинку:', b.dataset.url); }
});

// ======================================================================= настройки: бэкап
if ($('telegram-broadcast-btn')) $('telegram-broadcast-btn').addEventListener('click', async () => {
  if (!isSuper()) return toast('Только super_admin может отправлять рассылки', 'error');
  const btn=$('telegram-broadcast-btn'), message=$('telegram-broadcast-text').value.trim();
  if (!message) return toast('Введите текст сообщения', 'error');
  if (btn.disabled) return;
  if (!confirm('Отправить это сообщение всем активным пользователям amoore-ai?')) return;
  btn.disabled=true; btn.setAttribute('aria-busy','true'); const old=btn.textContent; btn.textContent='Отправка…';
  try { const {data,error}=await sb.functions.invoke('send-telegram',{body:{action:'broadcast',message}}); if(error) throw error; toast(`Рассылка завершена: ${data.sent} отправлено, ${data.failed} ошибок`,data.failed?'error':'success'); }
  catch(e){toast(friendlyError(e),'error');}
  finally{btn.disabled=false;btn.removeAttribute('aria-busy');btn.textContent=old;}
});

$('backup-btn').addEventListener('click', async () => {
  if (!can('download_backup')) return toast('Недостаточно прав', 'error');
  const btn = $('backup-btn'), label = $('backup-btn-text');
  btn.disabled = true; label.textContent = 'Собираю данные…';
  try {
    const [sites, news, admins] = await Promise.all([
      sb.from('ecosystem_sites').select(SITE_COLS).order('id'),
      sb.from('news').select(NEWS_COLS).order('published_at', { ascending: false }),
      sb.from('admins').select('id, email, name, nickname, role, permissions, created_at')
    ]);
    for (const r of [sites, news, admins]) if (r.error) throw r.error;
    const payload = {
      app: 'amoore-dev', version: '8.0', exported_at: new Date().toISOString(),
      exported_by: me.nickname || me.email,
      ecosystem_sites: sites.data, news: news.data, admins: admins.data   // токены доступа в бэкап не попадают
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `amoore-backup-${todayISO()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    logAction('backup');
    toast(`Бэкап: ${sites.data.length} сайтов, ${news.data.length} новостей, ${admins.data.length} пользователей`);
  } catch (err) { toast(friendlyError(err), 'error'); }
  finally { btn.disabled = false; label.textContent = 'Скачать JSON-бэкап базы'; }
});

// ======================================================================= команда и права
$('gen-token-btn').addEventListener('click', () => { $('new-token').value = genToken(); });
$('add-admin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!can('manage_admins')) return toast('Недостаточно прав', 'error');
  const row = {
    email: $('new-email').value.trim().toLowerCase(), name: $('new-name').value.trim(),
    nickname: $('new-nickname').value.trim(), role: $('new-role').value, access_token: $('new-token').value.trim()
  };
  if (row.access_token.length < 12) return toast('Токен слишком короткий (минимум 12 символов)', 'error');
  const { error } = await sb.from('admins').insert(row);
  if (error) return toast(friendlyError(error), 'error');
  logAction('admin_add', null, null, `${row.nickname} · ${row.role}`);
  toast('Добавлен. Не забудьте создать этот email в Supabase → Authentication'); e.target.reset(); loadTeam();
});

const isOnline = (a) => a.id === me?.admin_id || (a.last_seen_at && Date.now() - Date.parse(a.last_seen_at) < 5 * 60 * 1000);
async function touchSeen() { try { await sb.rpc('touch_admin_seen'); } catch (_) {} }
setInterval(() => { if (me && document.visibilityState !== 'hidden') touchSeen(); }, 60000);
let teamCache = [];
async function loadTeam() {
  const list = $('team-list');
  list.innerHTML = '<div class="skeleton-stack" aria-label="Загрузка команды"><i></i><i></i><i></i></div>';
  let { data, error } = await sb.from('admins').select('id, email, name, nickname, role, permissions, last_seen_at').order('created_at');
  if (error) ({ data, error } = await sb.from('admins').select('id, email, name, nickname, role, permissions').order('created_at'));   // миграция 005 ещё не применена
  if (error) { list.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
  if (!data?.length) { list.innerHTML = '<div class="loading-state">Пока нет добавленных администраторов</div>'; return; }
  teamCache = data;
  $('team-online-line').innerHTML = '<b>Админы в сети:</b> ' + data.map(a => `${esc(a.nickname || a.name || a.email)} (${isOnline(a) ? 'в сети' : 'офлайн'})`).join(', ');
  list.innerHTML = (data || []).map(a => {
    const self = a.id === me.admin_id;
    const on = isOnline(a);
    return `<div class="admin-card glass team-card">
      <div class="admin-card-info">
        <div class="admin-avatar">${esc((a.nickname || '?')[0].toUpperCase())}</div>
        <div class="admin-meta">
          <h4>${esc(a.nickname)}${self ? ' <span class="role-badge super_admin">вы</span>' : ''} <span class="presence ${on ? 'on' : ''}" title="${on ? 'в сети' : 'офлайн'}">${on ? '● в сети' : '○ офлайн'}</span></h4>
          <p>${esc(a.email)} · ${esc(a.name)}</p>
          <p class="widget-meta">роль: ${esc(rl(a.role))}${a.permissions ? ' · личные права' : ''}</p>
        </div>
      </div>
      <div class="admin-card-actions">
        ${isSuper() ? `<select class="role-select" data-id="${a.id}" aria-label="Роль"${self ? ' disabled' : ''}>
          ${['moderator', 'admin', 'super_admin'].map(r => `<option value="${r}"${a.role === r ? ' selected' : ''}>${esc(rl(r))}</option>`).join('')}</select>`
          : `<span class="role-badge ${esc(a.role)}">${esc(rl(a.role))}</span>`}
        ${isSuper() ? `<button class="btn btn-ghost btn-sm edit-admin" data-id="${a.id}" aria-label="Редактировать" title="Редактировать">✎</button>` : ''}
        ${isSuper() && !self ? `<button class="btn btn-ghost btn-sm perms-btn" data-id="${a.id}">Права</button>` : ''}
        ${isSuper() && !self ? `<button class="btn btn-danger-outline btn-sm del-admin" data-id="${a.id}" data-nick="${esc(a.nickname)}">Удалить</button>` : ''}
      </div></div>`;
  }).join('');
}

// ---- редактирование профиля: name, nickname, email, role (только super_admin; БД защищает политикой RLS)
let editAdminId = null;
function openEditAdmin(id) {
  const a = teamCache.find(x => x.id === id); if (!a) return;
  editAdminId = id;
  $('ea-name').value = a.name || ''; $('ea-nickname').value = a.nickname || ''; $('ea-email').value = a.email || '';
  $('ea-role').innerHTML = ['moderator', 'admin', 'super_admin'].map(r => `<option value="${r}"${a.role === r ? ' selected' : ''}>${esc(rl(r))}</option>`).join('');
  $('ea-role').disabled = id === me.admin_id;
  $('edit-admin-modal').classList.add('visible');
}
$('ea-cancel').addEventListener('click', () => $('edit-admin-modal').classList.remove('visible'));
$('edit-admin-modal').addEventListener('click', e => { if (e.target === $('edit-admin-modal')) $('edit-admin-modal').classList.remove('visible'); });
$('ea-save').addEventListener('click', async () => {
  if (!isSuper() || !editAdminId) return;
  const patch = { name: $('ea-name').value.trim().slice(0, 80), nickname: $('ea-nickname').value.trim().slice(0, 40), email: $('ea-email').value.trim().toLowerCase() };
  if (!patch.nickname) return toast('Никнейм не может быть пустым', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) return toast('Проверьте email', 'error');
  if (editAdminId !== me.admin_id) patch.role = $('ea-role').value;
  const { error } = await sb.from('admins').update(patch).eq('id', editAdminId);
  if (error) return toast(friendlyError(error), 'error');
  if (editAdminId === me.admin_id) { me.nickname = patch.nickname; me.name = patch.name; me.email = patch.email; paintUser(); }
  logAction('admin_edit', null, null, patch.nickname);
  toast('Профиль обновлён'); $('edit-admin-modal').classList.remove('visible'); loadTeam();
});
$('team-list').addEventListener('change', async (e) => {
  const sel = e.target.closest('.role-select');
  if (!sel || !isSuper()) return;
  const { error } = await sb.from('admins').update({ role: sel.value }).eq('id', sel.dataset.id);
  if (error) toast(friendlyError(error), 'error');
  else { logAction('role_change', null, null, sel.value); toast('Роль обновлена'); }
  loadTeam();
});
$('team-list').addEventListener('click', async (e) => {
  const del = e.target.closest('.del-admin');
  if (del && isSuper()) {
    if (!confirm(`Удалить пользователя «${del.dataset.nick}»?`)) return;
    const { error } = await sb.from('admins').delete().eq('id', del.dataset.id);
    if (error) toast(friendlyError(error), 'error');
    else { logAction('admin_delete', null, null, del.dataset.nick); toast('Удалён'); }
    loadTeam();
    return;
  }
  const eb = e.target.closest('.edit-admin');
  if (eb && isSuper()) { openEditAdmin(eb.dataset.id); return; }
  const pb = e.target.closest('.perms-btn');
  if (pb) openPermsModal(pb.dataset.id);
});

// ---- модалка «Права»: у каждого действия свой тумблер; в БД хранятся только отличия от роли
function renderPermsList() {
  $('perms-list').innerHTML = PERMS.map(([k, label]) => {
    const on = !!permsDraft[k];
    return `<label class="perm-row"><span>${esc(label)}</span><div class="toggle ${on ? 'open' : 'closed'}" data-key="${k}" role="switch" tabindex="0" aria-checked="${on}"><div class="toggle-knob"></div></div></label>`;
  }).join('');
}
async function openPermsModal(id) {
  if (!isSuper()) return;
  const { data, error } = await sb.from('admins').select('id, email, nickname, role, permissions').eq('id', id).single();
  if (error || !data) return toast(friendlyError(error) || 'Не найден', 'error');
  permsTarget = { id: data.id, role: data.role };
  $('perms-user-label').textContent = `${data.nickname || data.email} · ${rl(data.role)}`;
  permsDraft = resolvePermissions(data.role, data.permissions);
  renderPermsList();
  $('perms-modal').classList.add('visible');
}
function flipPerm(t) {
  const k = t.dataset.key;
  permsDraft[k] = !permsDraft[k];
  t.classList.toggle('open', permsDraft[k]); t.classList.toggle('closed', !permsDraft[k]);
  t.setAttribute('aria-checked', permsDraft[k]);
}
$('perms-list').addEventListener('click', e => { const t = e.target.closest('.toggle'); if (t) { e.preventDefault(); flipPerm(t); } });
$('perms-list').addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && e.target.classList.contains('toggle')) { e.preventDefault(); flipPerm(e.target); } });
async function savePerms(value) {
  if (!permsTarget) return;
  const { error } = await sb.from('admins').update({ permissions: value }).eq('id', permsTarget.id);
  if (error) return toast(friendlyError(error), 'error');
  logAction('perms_change');
  toast('Права сохранены'); $('perms-modal').classList.remove('visible'); loadTeam();
}
$('perms-save').addEventListener('click', () => {
  const diff = {};
  PERM_KEYS.forEach(k => { if (!!permsDraft[k] !== roleDefault(permsTarget.role, k)) diff[k] = !!permsDraft[k]; });
  savePerms(Object.keys(diff).length ? diff : null);
});
$('perms-reset').addEventListener('click', () => savePerms(null));
$('perms-modal').addEventListener('click', e => { if (e.target === $('perms-modal')) $('perms-modal').classList.remove('visible'); });

// ======================================================================= настройки: названия ролей и редактор changelog
async function loadRoleLabels() {
  try {
    const { data, error } = await sb.from('global_settings').select('value').eq('key', 'role_labels').maybeSingle();
    if (!error && data && data.value && typeof data.value === 'object') roleLabels = { ...ROLE_DEFAULT_LABELS, ...data.value };
  } catch (_) {}
  if (me) { applyRoleUI(); if ($('view-team').classList.contains('active')) loadTeam(); }
}
let clDraft = [];
function paintClEditor() {
  $('cl-editor').innerHTML = clDraft.map((v, i) => `
    <div class="admin-card glass cl-card" data-i="${i}" style="display:block;margin-bottom:12px">
      <div class="cl-head"><span class="cl-handle" title="Перетащить" aria-label="Перетащить версию">⠿</span><b>v${esc(v.version || '…')}</b>
        <span class="cl-move"><button type="button" class="cl-up" aria-label="Выше">▲</button><button type="button" class="cl-down" aria-label="Ниже">▼</button></span></div>
      <div class="form-row">
        <div class="form-group"><label>Версия</label><input class="cl-version" value="${esc(v.version)}" placeholder="4.3.0" inputmode="decimal"></div>
        <div class="form-group"><label>Название</label><input class="cl-title" value="${esc(v.title || '')}" maxlength="60"></div>
        <div class="form-group"><label>Дата</label><input type="date" class="cl-date" value="${esc(v.date || '')}"></div>
      </div>
      <div class="form-group"><label>Что изменилось (по одному пункту в строке)</label><textarea class="ta cl-items" rows="4">${esc((v.items || []).join('\n'))}</textarea></div>
      <button type="button" class="btn btn-danger-outline btn-sm cl-del">Удалить версию</button>
    </div>`).join('') || '<div class="loading-state">Версий пока нет.</div>';
}
function readClEditor() {
  return [...$('cl-editor').querySelectorAll('.cl-card')].map(c => ({
    version: c.querySelector('.cl-version').value.trim(),
    title: c.querySelector('.cl-title').value.trim(),
    date: c.querySelector('.cl-date').value || '',
    items: c.querySelector('.cl-items').value.split('\n').map(x => x.trim()).filter(Boolean)
  }));
}
// Тема: переключатель «Тёмная / Светлая» (значение хранится в localStorage["theme"] модулем amoore-ux.js)
function paintThemeChoice() {
  const cur = window.amooreUX ? window.amooreUX.getTheme() : 'dark';
  document.querySelectorAll('[data-theme-choice]').forEach(b => {
    const on = b.dataset.themeChoice === cur;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on ? 'true' : 'false');
  });
}
document.querySelectorAll('[data-theme-choice]').forEach(b => b.addEventListener('click', () => window.amooreUX?.setTheme(b.dataset.themeChoice)));
document.addEventListener('amoore:theme', paintThemeChoice);

// Профиль: никнейм и email (в таблице admins; email для входа живёт в Supabase Auth — напоминание в карточке)
$('pf-save').addEventListener('click', async () => {
  if (!me) return;
  const nickname = $('pf-nickname').value.trim().slice(0, 40), email = $('pf-email').value.trim().toLowerCase();
  if (!nickname) return toast('Никнейм не может быть пустым', 'error');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return toast('Проверьте email', 'error');
  const btn = $('pf-save'); btn.disabled = true;
  try {
    const { error } = await sb.from('admins').update({ nickname, email }).eq('id', me.admin_id);
    if (error) return toast(friendlyError(error), 'error');
    const emailChanged = email !== me.email;
    me.nickname = nickname; me.email = email;
    const s = loadSession(); if (s) saveSession({ ...s, nickname, email }, s.expires_at);
    paintUser(); logAction('admin_edit', null, null, nickname);
    toast(emailChanged ? 'Профиль сохранён. Не забудьте сменить email и в Supabase Auth' : 'Профиль сохранён');
  } finally { btn.disabled = false; }
});

async function renderSettingsBlocks() {
  paintThemeChoice();
  $('pf-nickname').value = me.nickname || '';
  $('pf-email').value = me.email || '';
  if (!isSuper()) return;
  ['super_admin', 'admin', 'moderator'].forEach(k => { const i = $('rl-' + k); if (i) i.value = roleLabels[k] || ''; });
  wnList = await loadChangelog();
  clDraft = wnList === WN_FALLBACK ? [] : wnList.map(v => ({ ...v }));
  paintClEditor();
}
$('role-labels-save').addEventListener('click', async () => {
  if (!isSuper()) return;
  const value = {};
  ['super_admin', 'admin', 'moderator'].forEach(k => { value[k] = ($('rl-' + k).value.trim().slice(0, 32)) || ROLE_DEFAULT_LABELS[k]; });
  const { error } = await sb.from('global_settings').upsert({ key: 'role_labels', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return toast(friendlyError(error), 'error');
  roleLabels = { ...ROLE_DEFAULT_LABELS, ...value };
  logAction('labels_edit'); toast('Названия ролей сохранены (бот подхватит за минуту)'); applyRoleUI();
});
$('cl-add').addEventListener('click', () => { clDraft = readClEditor(); clDraft.unshift({ version: '', title: '', date: todayISO(), items: [] }); paintClEditor(); });
$('cl-editor').addEventListener('click', e => {
  const mv = e.target.closest('.cl-up, .cl-down');
  if (mv) { clDraft = readClEditor(); const i = +mv.closest('.cl-card').dataset.i, j = mv.classList.contains('cl-up') ? i - 1 : i + 1; if (j >= 0 && j < clDraft.length) { [clDraft[i], clDraft[j]] = [clDraft[j], clDraft[i]]; paintClEditor(); } return; }
  const d = e.target.closest('.cl-del'); if (!d) return; clDraft = readClEditor(); clDraft.splice(+d.closest('.cl-card').dataset.i, 1); paintClEditor(); });

// Drag & Drop порядка версий: pointer events — работает и мышью, и пальцем на iPhone
(function clDnD() {
  const box = $('cl-editor'); if (!box) return;
  let drag = null;
  function onMove(e) {
    if (!drag) return;
    const others = [...box.querySelectorAll('.cl-card')].filter(c => c !== drag);
    const target = others.find(c => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (target) { if (drag.nextElementSibling !== target) box.insertBefore(drag, target); }
    else if (box.lastElementChild !== drag) box.appendChild(drag);
    if (e.clientY < 90) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 14);
    e.preventDefault();
  }
  function onEnd() {
    if (!drag) return;
    document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onEnd); document.removeEventListener('pointercancel', onEnd);
    drag.classList.remove('cl-dragging'); drag = null;
    clDraft = readClEditor(); paintClEditor();
    toast('Порядок изменён — нажмите «Сохранить и обновить везде»');
  }
  box.addEventListener('pointerdown', e => {
    const h = e.target.closest('.cl-handle'); if (!h) return;
    drag = h.closest('.cl-card'); drag.classList.add('cl-dragging');
    document.addEventListener('pointermove', onMove, { passive: false }); document.addEventListener('pointerup', onEnd); document.addEventListener('pointercancel', onEnd);
    e.preventDefault();
  });
})();
$('cl-save').addEventListener('click', async () => {
  if (!isSuper()) return;
  const list = readClEditor().filter(v => v.version).map((v, i) => ({ ...v, order: i }));   // порядок — как расставлен перетаскиванием
  if (!list.length) return toast('Добавьте хотя бы одну версию', 'error');
  if (new Set(list.map(v => v.version)).size !== list.length) return toast('Версии не должны повторяться', 'error');
  if (list.some(v => !/^\d+\.\d+\.\d+$/.test(v.version))) return toast('Версия — в формате 4.3.0', 'error');
  const { error } = await sb.from('global_settings').upsert({ key: 'changelog', value: { current: list[0].version, versions: list }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) return toast(friendlyError(error), 'error');
  wnList = list; liveVersion = String(list[0].version); paintVersionChip();
  clDraft = list.map(v => ({ ...v })); paintClEditor();
  logAction('changelog_edit', null, null, liveVersion); toast('Changelog сохранён: чипы версий на всех сайтах обновятся');
});

// ======================================================================= логи
function logRow(l, names, sites, full) {
  const where = sites[l.site_id] || l.site_id || l.details || '—';
  return { who: names[l.admin_id] || '—', act: ACTION_LABELS[l.action] || l.action || '—', where, t: fmtDateTime(l.created_at, !full) };
}
async function loadLogs() {
  if (!can('view_logs')) return;
  const tbody = $('logs-tbody'), cards = $('logs-cards');
  tbody.innerHTML = '<tr><td colspan="5"><div class="skeleton-stack" aria-label="Загрузка логов"><i></i><i></i><i></i></div></td></tr>';
  const [{ data: logs, error }, names, sres] = await Promise.all([
    sb.from('audit_logs').select('admin_id, action, site_id, overlay_type, details, created_at').order('created_at', { ascending: false }).limit(100),
    adminMap(),
    sb.from('ecosystem_sites').select('id, name')
  ]);
  if (error) { tbody.innerHTML = `<tr><td colspan="5">${esc(friendlyError(error))}</td></tr>`; return; }
  if (!logs?.length) { tbody.innerHTML = '<tr><td colspan="5" class="loading-state">История пока пуста. Действия появятся здесь.</td></tr>'; cards.innerHTML = '<div class="loading-state">История пока пуста.</div>'; return; }
  const sites = Object.fromEntries((sres.data || []).map(s => [s.id, s.name]));
  tbody.innerHTML = logs.map(l => {
    const r = logRow(l, names, sites, true);
    return `<tr><td>${esc(r.who)}</td><td><span class="action-pill ${esc(l.action)}">${esc(r.act)}</span></td><td>${esc(r.where)}</td><td>${esc(l.overlay_type ? OVERLAY_LABELS[l.overlay_type] || l.overlay_type : '—')}</td><td style="color:var(--text-muted);white-space:nowrap">${r.t}</td></tr>`;
  }).join('');
  cards.innerHTML = logs.map(l => {
    const r = logRow(l, names, sites, false);
    return `<div class="log-card glass"><div class="log-card-row"><strong>${esc(r.who)}</strong><span class="action-pill ${esc(l.action)}">${esc(r.act)}</span></div>
      <div class="log-card-row"><span class="meta">${esc(r.where)}</span><span class="meta">${r.t}</span></div></div>`;
  }).join('');
}

// ======================================================================= вход / выход / старт
$('full-login-btn').addEventListener('click', () => setLoginMode(false));
$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').classList.remove('visible');
  $('login-btn').disabled = true;
  $('login-btn-text').innerHTML = '<span class="spinner"></span>';
  const email = ($('email').value || rememberedEmail()).trim();
  const password = $('password').value;
  const token = $('token').value.trim();
  try {
    if (!token || (!tokenOnlyMode && (!email || !password))) throw new Error('Заполните все поля');
    let session;
    if (tokenOnlyMode) {
      try { session = await loginTokenOnly(token); }
      catch (err) {
        if (err.message === 'NEED_PASSWORD') { setLoginMode(false); throw new Error('Сессия истекла — введите пароль'); }
        throw err;
      }
    } else session = await loginFull(email, password, token);
    showApp(session);
  } catch (err) {
    $('login-error').textContent = friendlyError(err);
    $('login-error').classList.add('visible');
  } finally {
    $('login-btn').disabled = false;
    $('login-btn-text').textContent = 'Войти';
  }
});
document.addEventListener('amoore:logout', e => {
  e.preventDefault();
  clearSession(true);
  sb.auth.signOut().catch(() => {});
  me = null;
  window.amooreUX?.clearUser();
  showLogin(false);
});

(async function boot() {
  const s = loadSession();
  if (s?.admin_id) {
    try {
      const { data } = await sb.auth.getSession();
      if (data.session) {
        const fresh = await verifyAdmin(s.access_token);   // права и роль — всегда из БД
        saveSession(fresh, s.expires_at);                  // 6 часов считаются от момента входа
        showApp(fresh);
        return;
      }
    } catch (_) {}
    clearSession(false);
    showLogin(true);
    return;
  }
  try {
    const { data } = await sb.auth.getSession();
    if (data.session && rememberedEmail()) return showLogin(true);
  } catch (_) {}
  showLogin(false);
})();
