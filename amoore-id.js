/**
 * amoore-id.js — v5.2.0 «POLISH & SYNC» · amoore ID (единый аккаунт). Побайтно одинаков во всех трёх сайтах.
 * Подключение (после supabase-js):  <script src="amoore-id.js"></script>
 *   amooreID.init({ site: 'dev'|'studio'|'landing', sb: <существующий клиент, необязательно> })
 * API: signIn(email,pw) · sendCode/verifyCode · sendMagicLink · consumeUrl() (magic link + SSO) · ensureOnboarded()
 *      openProfile() / renderProfile(host) (вкладки: Профиль · Бизнес-ассистент · Баллы · Безопасность · Уведомления) · ssoOpen(target) · listSessions/revokeOthers · linkTelegram · people.* (только Boss)
 */
(function () {
  'use strict';
  if (window.amooreID) return;
  var SB_URL = window.AMOORE_SUPABASE_URL || 'https://wogouiecoigzmxqccnsk.supabase.co';
  var SB_ANON = window.AMOORE_SUPABASE_ANON || 'sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q';
  var SITES = { dev: 'https://amoore-dev.pages.dev/', studio: 'https://amoore-studio.pages.dev/', landing: 'https://amoore.ru/' };
  var sb = null, site = 'landing', profile = null;
  var USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  // v5.2: подписи ролей — только по-русски (названия можно переопределить в «Команда → Управление ролями»)
  var ROLE_RU = { user: 'Пользователь', moderator: 'Модератор', admin: 'Администратор', super_admin: 'Основатель' };
  var roleOverrides = null;
  function roleRu(role) { return (roleOverrides && roleOverrides[role]) || ROLE_RU[role] || role; }
  function loadRoleLabels() {
    if (roleOverrides || !sb) return Promise.resolve();
    return Promise.resolve(sb.from('global_settings').select('value').eq('key', 'role_labels').maybeSingle())
      .then(function (r) { roleOverrides = (r && r.data && r.data.value && typeof r.data.value === 'object') ? r.data.value : {}; }, function () { roleOverrides = {}; });
  }
  var AVATAR_COLORS = ['#d4af37', '#8b7cf7', '#3ddc84', '#ff7b7b', '#4cc9f0', '#f78fb3', '#ff9f43', '#6c8cff'];
  function initial(p) { var n = String((p && (p.display_name || p.username)) || '?').trim(); return (n.charAt(0) || '?').toUpperCase(); }
  function avatarEl(p, cls) {
    cls = cls || 'aid-av';
    if (p && p.avatar_url) return el('img', { class: cls, alt: '', src: p.avatar_url });
    return el('div', { class: cls + ' aid-av-ph', 'aria-hidden': 'true', text: initial(p), style: 'background:' + ((p && p.avatar_color) || AVATAR_COLORS[0]) });
  }
  // v5.2: Студия сообщает о публикации — проект появляется в «Мои сайты» профиля amoore ID (уникально по адресу)
  async function registerSite(title, url) {
    var u = await user(); if (!u || !/^https:\/\/[^\s]{3,300}$/i.test(String(url || ''))) return false;
    var r = await sb.from('user_sites').upsert({ user_id: u.id, title: String(title || 'Сайт').slice(0, 80), url: url, is_public: true }, { onConflict: 'user_id,url' });
    return !r.error;
  }
  function announce(p) { try { document.dispatchEvent(new CustomEvent('amoore:profile', { detail: p })); } catch (e) {} }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]); else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function err(e) {
    var m = (e && e.message) || String(e);
    if (/Invalid login/i.test(m)) return 'Неверный email или пароль';
    if (/otp|token has expired|invalid/i.test(m)) return 'Код неверный или устарел';
    if (/rate limit|too many/i.test(m)) return 'Слишком много попыток, подождите немного';
    if (/forbidden/i.test(m)) return 'Недостаточно прав';
    if (/username/i.test(m) && /duplicate|unique/i.test(m)) return 'Этот username уже занят';
    return m;
  }

  // ---------------------------------------------------------------- Rewards: ?ref=USERNAME
  var REF_KEY = 'amoore_ref';
  function captureRef() {
    try {
      var q = new URLSearchParams(location.search), r = (q.get('ref') || '').trim().toLowerCase();
      if (r && /^[a-z0-9_]{3,24}$/.test(r)) { localStorage.setItem(REF_KEY, r); }
      if (q.has('ref')) { q.delete('ref'); var qs = q.toString(); history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); }
    } catch (e) {}
  }
  function pendingRef() { try { return localStorage.getItem(REF_KEY) || ''; } catch (e) { return ''; } }
  async function claimRef() {
    var r = pendingRef(); if (!r) return 0;
    try { var res = await sb.rpc('claim_referral', { p_ref: r }); if (!res.error) { try { localStorage.removeItem(REF_KEY); } catch (e) {} return res.data || 0; } } catch (e) {}
    try { localStorage.removeItem(REF_KEY); } catch (e) {}
    return 0;
  }
  captureRef();

  function init(o) {
    o = o || {}; site = o.site || window.AMOORE_SITE_ID || 'landing';
    sb = o.sb || (window.supabase && window.supabase.createClient(SB_URL, SB_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'amoore-id-' + site }
    }));
    api.sb = sb; return sb;
  }
  async function user() { var r = await sb.auth.getSession(); return r.data.session ? r.data.session.user : null; }
  function sessionId() {
    try { return sb.auth.getSession().then(function (r) { var t = r.data.session && r.data.session.access_token; return t ? JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).session_id : null; }); }
    catch (e) { return Promise.resolve(null); }
  }

  // ---------------------------------------------------------------- вход
  async function lockLeft(email) { var r = await sb.rpc('auth_lock_status', { p_email: email }); return r.error ? 0 : (r.data || 0); }
  function lockMsg(s) { return 'Аккаунт временно заблокирован. Повторите через ' + Math.ceil(s / 60) + ' мин.'; }

  async function afterLogin() {
    await sb.rpc('auth_note_success'); await sb.rpc('register_session'); return getProfile(true);
  }
  // шаг «пароль»: считает ошибки, после 5-й блокирует на 15 минут
  async function signIn(email, password) {
    email = (email || '').trim().toLowerCase();
    var left = await lockLeft(email); if (left > 0) throw new Error(lockMsg(left));
    var r = await sb.auth.signInWithPassword({ email: email, password: password });
    if (r.error) {
      var l2 = await sb.rpc('auth_note_failure', { p_email: email });
      if (l2.data > 0) throw new Error(lockMsg(l2.data));
      throw new Error(err(r.error));
    }
    return afterLogin();
  }
  // шаг «код из письма» (в шаблоне письма Supabase должен быть {{ .Token }})
  async function sendCode(email) {
    var e = (email || '').trim().toLowerCase(); var left = await lockLeft(e); if (left > 0) throw new Error(lockMsg(left));
    var r = await sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: false } }); if (r.error) throw new Error(err(r.error));
  }
  async function verifyCode(email, code) {
    var r = await sb.auth.verifyOtp({ email: (email || '').trim().toLowerCase(), token: String(code).trim(), type: 'email' });
    if (r.error) { await sb.rpc('auth_note_failure', { p_email: email }); throw new Error(err(r.error)); }
    return afterLogin();
  }
  // Magic Link: письмо со ссылкой → при возврате вызывается consumeUrl()
  async function sendMagicLink(email, create) {
    var r = await sb.auth.signInWithOtp({ email: (email || '').trim().toLowerCase(),
      options: { shouldCreateUser: !!create, emailRedirectTo: location.origin + location.pathname } });
    if (r.error) throw new Error(err(r.error));
  }
  async function signOut() { try { await sb.rpc('log_event', { p_action: 'logout' }); } catch (e) {} await sb.auth.signOut(); profile = null; }

  // ---------------------------------------------------------------- возврат по ссылке и SSO (#access_token… / #sso=…)
  async function consumeUrl() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    var clean = function () { history.replaceState(null, '', location.pathname + location.search); };   // токен не остаётся в адресной строке
    if (h.get('access_token') && h.get('refresh_token')) {
      clean();
      var r = await sb.auth.setSession({ access_token: h.get('access_token'), refresh_token: h.get('refresh_token') });
      if (r.error) throw new Error(err(r.error));
      return afterLogin();
    }
    if (h.get('sso')) {
      var tok = h.get('sso'); clean();
      var res = await fetch(SB_URL + '/functions/v1/sso-exchange', { method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SB_ANON }, body: JSON.stringify({ token: tok, target: site }) });
      var d = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(d.error === 'invalid_or_expired' ? 'SSO-ссылка устарела, откройте заново' : 'SSO не удался');
      var v = await sb.auth.verifyOtp({ token_hash: d.token_hash, type: d.type });
      if (v.error) throw new Error(err(v.error));
      return afterLogin();
    }
    return null;
  }
  // перейти на другой сайт уже авторизованным
  async function ssoOpen(target) {
    var r = await sb.rpc('sso_issue', { p_target: target }); if (r.error) throw new Error(err(r.error));
    window.open(SITES[target] + '#sso=' + r.data, '_blank', 'noopener');
  }

  // ---------------------------------------------------------------- профиль / онбординг
  async function getProfile(force) {
    if (profile && !force) return profile;
    var u = await user(); if (!u) return null;
    var r = await sb.from('profiles').select('id,username,avatar_url,role,telegram_id,is_banned,ban_reason,onboarded,rewards_balance,bio,is_public,referred_by,display_name,avatar_color').eq('id', u.id).maybeSingle();
    profile = r.data || null; window.amooreProfileCache = profile; if (profile) announce(profile); return profile;
  }
  function toWebp(file, size) {
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = c.height = size;
        var s = Math.min(img.width, img.height), ctx = c.getContext('2d');
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size); URL.revokeObjectURL(url);
        c.toBlob(function (b) { b ? ok(b) : bad(new Error('Не удалось обработать картинку')); }, 'image/webp', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error('Файл не похож на изображение')); };
      img.src = url;
    });
  }
  async function saveProfile(username, file, color) {
    var u = await user(); if (!u) throw new Error('Нужно войти');
    username = (username || '').trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error('Никнейм (username): 3–24 символа, a–z, 0–9 и _');
    var p = await getProfile(), url = p && p.avatar_url;
    if (file) url = await uploadAvatar(file, u);
    color = color || (p && p.avatar_color) || '';
    if (!url && !color) throw new Error('Загрузите фото или выберите цвет аватарки');
    var patch = { username: username, avatar_url: url || '' };
    if (color) patch.avatar_color = color;
    var r = await sb.from('profiles').update(patch).eq('id', u.id);
    if (r.error) throw new Error(err(r.error));
    await sb.rpc('log_event', { p_action: 'profile_update' });
    var np = await getProfile(true); announce(np); return np;
  }
  async function uploadAvatar(file, u) {
    if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
    var blob = await toWebp(file, 256), path = u.id + '/avatar.webp';
    var up = await sb.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/webp', cacheControl: '3600' });
    if (up.error) throw new Error(err(up.error));
    return sb.storage.from('avatars').getPublicUrl(path).data.publicUrl + '?v=' + Date.now();
  }

  var CSS = '.aid-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:rgba(7,11,22,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:var(--nx-font-body,system-ui,sans-serif)}' +
    '.aid-card{width:100%;max-width:400px;max-height:90vh;overflow:auto;padding:22px;border-radius:20px;color:var(--nx-ink,#eef0f7);background:var(--nx-modal-bg,rgba(13,18,32,.95));border:var(--nx-glass-border,1px solid rgba(212,175,55,.2));box-shadow:var(--nx-glass-shadow,0 8px 32px rgba(0,0,0,.35))}' +
    '.aid-card h2{margin:0 0 6px;font:700 20px var(--nx-font-head,system-ui)}.aid-card p{margin:0 0 14px;font-size:13px;color:var(--nx-muted,#8b90a5)}' +
    '.aid-card input[type=text]{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(212,175,55,.25);background:rgba(255,255,255,.05);color:inherit;font-size:16px;margin-bottom:12px}' +
    '.aid-btn{width:100%;padding:12px;border:0;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;color:#17151d;background:var(--nx-btn-gradient,#d4af37);transition:transform .35s cubic-bezier(.34,1.56,.64,1)}.aid-btn:active{transform:scale(.96)}.aid-btn[disabled]{opacity:.6}' +
    '.aid-ghost{background:transparent;color:var(--nx-muted,#8b90a5);border:1px solid rgba(212,175,55,.2);margin-top:8px}' +
    '.aid-err{min-height:18px;color:#ff7b7b;font-size:13px;margin:0 0 8px}.aid-av{width:84px;height:84px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);display:block;margin:0 auto 12px;border:2px solid rgba(212,175,55,.4)}' +
    '.aid-wide{max-width:520px}.aid-tabs{display:flex;gap:6px;overflow-x:auto;margin:-4px 0 14px;padding-bottom:6px;-webkit-overflow-scrolling:touch}.aid-tabs button{flex:0 0 auto;padding:8px 12px;border-radius:999px;border:1px solid rgba(212,175,55,.25);background:transparent;color:inherit;font:600 13px var(--nx-font-body,system-ui);cursor:pointer}.aid-tabs button.on{background:rgba(212,175,55,.2);border-color:rgba(212,175,55,.6)}' +
    '.aid-f{display:block;margin:0 0 12px}.aid-f>span{display:block;font-size:12px;color:var(--nx-muted,#8b90a5);margin-bottom:4px}.aid-inl{display:flex;align-items:center;gap:10px}.aid-card textarea,.aid-card input[type=password],.aid-card input[readonly]{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(212,175,55,.25);background:rgba(255,255,255,.05);color:inherit;font:16px var(--nx-font-body,system-ui);margin-bottom:12px;resize:vertical}' +
    '.aid-hint{font-size:12px;color:var(--nx-muted,#8b90a5);margin:6px 0 12px;overflow-wrap:anywhere}.aid-hint a{color:inherit}.aid-big{font:800 32px var(--nx-font-head,system-ui);margin:4px 0 8px}.aid-x{border:0;background:none;color:inherit;font-size:22px;line-height:1;cursor:pointer;padding:0 6px}' +
    '.aid-sw{appearance:none;-webkit-appearance:none;width:46px;height:28px;border-radius:999px;background:rgba(255,255,255,.16);position:relative;cursor:pointer;flex:0 0 46px;margin:0;transition:background .2s}.aid-sw:before{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;transition:transform .2s}.aid-sw:checked{background:#d4af37}.aid-sw:checked:before{transform:translateX(18px)}' +
    '.aid-row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid rgba(212,175,55,.12);font-size:13px}.aid-row small{color:var(--nx-muted,#8b90a5)}' +
    '.aid-av-ph{display:flex;align-items:center;justify-content:center;font:800 34px var(--nx-font-head,system-ui);color:#17151d;border-color:rgba(255,255,255,.25)}.aid-pal{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}.aid-sw-c{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:0 0 0 1px rgba(255,255,255,.2)}.aid-sw-c.on{border-color:#fff;box-shadow:0 0 0 2px rgba(212,175,55,.9)}' +
    '.aid-inline{max-width:100%;max-height:none;overflow:visible;box-shadow:none;border:0;background:transparent;padding:0}.aid-role{display:inline-block;padding:3px 12px;border-radius:999px;font:700 12px var(--nx-font-body,system-ui);background:rgba(212,175,55,.16);color:var(--nx-gold,#d4af37);border:1px solid rgba(212,175,55,.35)}.aid-center{text-align:center}.aid-card input,.aid-card textarea,.aid-card select{box-sizing:border-box;max-width:100%}.aid-card{overflow-x:hidden}';
  function ensureCss() { if (!document.getElementById('aid-css')) { var s = el('style', { id: 'aid-css' }); s.textContent = CSS; document.head.appendChild(s); } }
  function overlay(card) { ensureCss(); var ov = el('div', { class: 'aid-ov', role: 'dialog', 'aria-modal': 'true' }, [card]); document.body.appendChild(ov); return ov; }

  // обязательный онбординг: окно нельзя закрыть, пока нет username и аватарки
  function ensureOnboarded() {
    return getProfile(true).then(function (p) {
      if (!p) return null;
      if (p.is_banned) { alert('Аккаунт заблокирован' + (p.ban_reason ? ': ' + p.ban_reason : '')); return signOut().then(function () { return null; }); }
      if (p.onboarded) return p;
      return new Promise(function (done) {
        var picked = null, color = p.avatar_color || AVATAR_COLORS[0], avWrap = el('div', { class: 'aid-center' });
        function paintAv() { avWrap.textContent = ''; avWrap.appendChild(avatarEl({ username: name.value || p.username, avatar_url: picked ? URL.createObjectURL(picked) : p.avatar_url, avatar_color: color })); }
        var file = el('input', { type: 'file', accept: 'image/*', hidden: '' }), name = el('input', { type: 'text', placeholder: 'никнейм (латиницей)', maxlength: '24', autocomplete: 'off', autocapitalize: 'none' });
        name.value = p.username || ''; var msg = el('div', { class: 'aid-err', role: 'alert' });
        file.addEventListener('change', function () { picked = file.files[0] || null; paintAv(); });
        name.addEventListener('input', function () { if (!picked && !p.avatar_url) paintAv(); });
        var pal = el('div', { class: 'aid-pal', role: 'radiogroup', 'aria-label': 'Цвет аватарки' });
        AVATAR_COLORS.forEach(function (c) { pal.appendChild(el('button', { type: 'button', class: 'aid-sw-c' + (c === color ? ' on' : ''), style: 'background:' + c, 'aria-label': 'Цвет ' + c, onclick: function () { color = c; Array.prototype.forEach.call(pal.children, function (b) { b.classList.toggle('on', b.style.background === c || b.getAttribute('aria-label') === 'Цвет ' + c); }); paintAv(); } })); });
        paintAv();
        var go = el('button', { class: 'aid-btn', type: 'button', text: 'Продолжить' });
        go.addEventListener('click', function () {
          go.disabled = true; msg.textContent = '';
          saveProfile(name.value, picked, picked || p.avatar_url ? '' : color).then(function (np) { ov.remove(); done(np); }).catch(function (e) { msg.textContent = err(e); go.disabled = false; });
        });
        var out = el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Выйти', onclick: function () { signOut().then(function () { ov.remove(); done(null); }); } });
        var ov = overlay(el('div', { class: 'aid-card' }, [el('h2', { text: 'Добро пожаловать в amoore' }), el('p', { text: 'Выберите никнейм и аватарку: загрузите фото или просто выберите цвет — без этого внутренние функции недоступны.' }),
          avWrap, el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Загрузить фото', onclick: function () { file.click(); } }), file, el('div', { style: 'height:12px' }), pal, name, msg, go, out]));
      });
    });
  }

  // ---------------------------------------------------------------- устройства, Телеграм
  async function listSessions() { var r = await sb.from('user_sessions').select('id,user_agent,ip,created_at,last_seen_at').order('last_seen_at', { ascending: false }); if (r.error) throw new Error(err(r.error)); return r.data; }
  async function revokeOthers() { var r = await sb.rpc('revoke_other_sessions'); if (r.error) throw new Error(err(r.error)); return r.data; }
  async function linkTelegram(code) { var r = await sb.rpc('link_telegram', { p_code: String(code).trim() }); if (r.error) throw new Error(err(r.error)); return r.data; }
  function ua(s) {
    s = s || ''; var b = /Edg\//.test(s) ? 'Edge' : /OPR\//.test(s) ? 'Opera' : /Chrome\//.test(s) ? 'Chrome' : /Firefox\//.test(s) ? 'Firefox' : /Safari\//.test(s) ? 'Safari' : 'Браузер';
    var o = /iPhone|iPad/.test(s) ? 'iOS' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS/.test(s) ? 'macOS' : /Linux/.test(s) ? 'Linux' : '';
    return b + (o ? ' · ' + o : '');
  }
  // ---------------------------------------------------------------- профиль с вкладками (модалка или inline-панель на лендинге)
  var TABS = [['profile', 'Профиль'], ['business', 'Бизнес-ассистент'], ['rewards', 'Баллы'], ['security', 'Безопасность'], ['notify', 'Уведомления']];
  function fmtDt(d) { return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  function field(label, node) { return el('label', { class: 'aid-f' }, [el('span', { text: label }), node]); }
  function toggle(on, onchange) {
    var cb = el('input', { type: 'checkbox', role: 'switch', class: 'aid-sw' }); cb.checked = !!on; cb.addEventListener('change', function () { onchange && onchange(cb.checked); }); return cb;
  }
  function shareUrl(p) { return location.origin + '/?ref=' + encodeURIComponent(p.username || ''); }
  function publicUrl(p) { return location.origin + '/#u/' + encodeURIComponent(p.username || ''); }
  async function copy(text, msg, ok) { try { await navigator.clipboard.writeText(text); msg.style.color = '#3ddc84'; msg.textContent = ok || 'Скопировано'; } catch (e) { msg.style.color = ''; msg.textContent = text; } }
  function say(msg, text, good) { msg.style.color = good ? '#3ddc84' : ''; msg.textContent = text || ''; }

  async function tabProfile(p, box, reload) {
    await loadRoleLabels();
    var msg = el('div', { class: 'aid-err', role: 'status' });
    var color = p.avatar_color || AVATAR_COLORS[0], avWrap = el('div', { class: 'aid-center' });
    function paintAv() { avWrap.textContent = ''; avWrap.appendChild(avatarEl({ username: p.username, display_name: nick.value || p.display_name, avatar_url: p.avatar_url, avatar_color: color })); }
    var nick = el('input', { type: 'text', maxlength: '40', placeholder: 'Как вас называть', autocomplete: 'nickname', id: 'aid-nick' }); nick.value = p.display_name || '';
    var bio = el('textarea', { maxlength: '300', rows: '3', placeholder: 'Коротко о себе (до 300 символов)' }); bio.value = p.bio || '';
    var pub = toggle(p.is_public, null);
    var file = el('input', { type: 'file', accept: 'image/*', hidden: '' });
    var pal = el('div', { class: 'aid-pal', role: 'radiogroup', 'aria-label': 'Цвет аватарки' });
    AVATAR_COLORS.forEach(function (c) { pal.appendChild(el('button', { type: 'button', class: 'aid-sw-c' + (c === color ? ' on' : ''), 'data-c': c, style: 'background:' + c, 'aria-label': 'Цвет ' + c, onclick: function () {
      color = c; Array.prototype.forEach.call(pal.children, function (b2) { b2.classList.toggle('on', b2.getAttribute('data-c') === c); }); paintAv(); } })); });
    nick.addEventListener('input', paintAv);
    file.addEventListener('change', function () {
      var f = file.files && file.files[0]; if (!f) return; say(msg, 'Загружаю фото…');
      user().then(function (u) { return uploadAvatar(f, u); }).then(function (url) { return sb.from('profiles').update({ avatar_url: url }).eq('id', p.id).then(function (r) { if (r.error) throw r.error; p.avatar_url = url; paintAv(); say(msg, 'Фото обновлено', true); return getProfile(true).then(announce); }); })
        .catch(function (e) { say(msg, err(e)); });
    });
    paintAv();
    box.appendChild(avWrap);
    box.appendChild(el('div', { class: 'aid-center', style: 'margin:0 0 12px' }, [el('h2', { text: p.display_name || ('@' + (p.username || '—')), style: 'margin:0 0 6px' }), el('span', { class: 'aid-role', id: 'aid-role', text: roleRu(p.role) })]));
    box.appendChild(el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Загрузить фото', onclick: function () { file.click(); } })); box.appendChild(file);
    if (p.avatar_url) box.appendChild(el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Убрать фото (будет цвет)', onclick: function () {
      sb.from('profiles').update({ avatar_url: '', avatar_color: color }).eq('id', p.id).then(function (r) { if (r.error) return say(msg, err(r.error)); p.avatar_url = ''; paintAv(); getProfile(true).then(announce); reload && reload(); }); } }));
    box.appendChild(el('p', { class: 'aid-hint', text: 'Цвет аватарки (если нет фото):', style: 'margin-top:14px' })); box.appendChild(pal);
    box.appendChild(field('Никнейм', nick));
    box.appendChild(field('О себе', bio));
    box.appendChild(el('label', { class: 'aid-f aid-inl' }, [pub, el('span', { text: 'Публичная страница профиля' })]));
    box.appendChild(el('p', { class: 'aid-hint' }, [el('a', { href: publicUrl(p), text: publicUrl(p) })]));
    box.appendChild(el('button', { class: 'aid-btn', type: 'button', id: 'aid-save', text: 'Сохранить', onclick: function () {
      var dn = nick.value.trim().slice(0, 40);
      sb.from('profiles').update({ display_name: dn || null, avatar_color: color, bio: bio.value.trim().slice(0, 300), is_public: pub.checked }).eq('id', p.id).then(function (r) {
        if (r.error) return say(msg, err(r.error)); sb.rpc('log_event', { p_action: 'profile_update' }).then(function () {});
        say(msg, 'Сохранено', true); return getProfile(true).then(announce); }); } }));
    // мои сайты
    box.appendChild(el('h2', { text: 'Мои сайты', style: 'font-size:16px;margin-top:18px' }));
    box.appendChild(el('p', { text: 'Публичные сайты показываются на вашей странице профиля. Только https://', class: 'aid-hint' }));
    var list = el('div');
    async function paintSites() {
      list.textContent = '';
      var r = await sb.from('user_sites').select('id,title,url,is_public').order('created_at', { ascending: false });
      if (r.error) return say(msg, err(r.error));
      (r.data || []).forEach(function (s2) {
        var vis = toggle(s2.is_public, function (v) { sb.from('user_sites').update({ is_public: v }).eq('id', s2.id).then(function (x) { if (x.error) say(msg, err(x.error)); }); });
        list.appendChild(el('div', { class: 'aid-row' }, [el('div', { style: 'min-width:0' }, [el('div', { text: s2.title }), el('small', { text: s2.url, style: 'overflow-wrap:anywhere' })]),
          el('div', { class: 'aid-inl' }, [vis, el('button', { class: 'aid-x', type: 'button', 'aria-label': 'Удалить сайт', text: '×', onclick: function () { sb.from('user_sites').delete().eq('id', s2.id).then(paintSites); } })])]));
      });
    }
    box.appendChild(list);
    var st = el('input', { type: 'text', maxlength: '80', placeholder: 'Название сайта' }), su = el('input', { type: 'text', inputmode: 'url', maxlength: '300', placeholder: 'https://…', autocapitalize: 'none' });
    box.appendChild(st); box.appendChild(su);
    box.appendChild(el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Добавить сайт', onclick: function () {
      if (!/^https:\/\/[^\s]{3,300}$/i.test(su.value.trim()) || !st.value.trim()) return say(msg, 'Укажите название и адрес, начинающийся с https://');
      sb.from('user_sites').insert({ title: st.value.trim(), url: su.value.trim(), is_public: true }).then(function (r) { if (r.error) return say(msg, err(r.error)); st.value = ''; su.value = ''; say(msg, ''); paintSites(); }); } }));
    paintSites();
    // Телеграм
    box.appendChild(el('h2', { text: 'Телеграм', style: 'font-size:16px;margin-top:18px' }));
    var code = el('input', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '6-значный код из бота (/link)', autocomplete: 'one-time-code' });
    if (p.telegram_id) box.appendChild(el('p', { text: 'Телеграм привязан ✓ (ID ' + p.telegram_id + ')' }));
    else { box.appendChild(el('p', { class: 'aid-hint', text: 'Откройте бота, отправьте ему /link в личных сообщениях и введите полученный код.' })); box.appendChild(code); box.appendChild(el('button', { class: 'aid-btn', type: 'button', text: 'Привязать Телеграм', onclick: function () { linkTelegram(code.value).then(reload).catch(function (e) { say(msg, err(e)); }); } })); }
    box.appendChild(msg);
  }

  // Бизнес-ассистент (Телеграм Business): настройки читает бот (amoore-ai) из business_automations
  async function tabBusiness(p, box) {
    var msg = el('div', { class: 'aid-err', role: 'status' });
    var r = await sb.from('business_automations').select('is_enabled,company_name,working_hours,custom_instructions').eq('user_id', p.id).maybeSingle();
    var d = r.data || { is_enabled: false, company_name: '', working_hours: '', custom_instructions: '' };
    var on = toggle(d.is_enabled, null);
    var company = el('input', { type: 'text', maxlength: '120', placeholder: 'Например: ООО «Ромашка»', id: 'biz-company' }); company.value = d.company_name || '';
    var hours = el('input', { type: 'text', maxlength: '200', placeholder: 'Пн–Пт 10:00–19:00 (МСК)', id: 'biz-hours' }); hours.value = d.working_hours || '';
    var ins = el('textarea', { maxlength: '2000', rows: '6', placeholder: 'Услуги, цены, условия, что отвечать на частые вопросы, чего не обещать…', id: 'biz-instructions' }); ins.value = d.custom_instructions || '';
    box.appendChild(el('h2', { text: 'AI Бизнес-ассистент', style: 'font-size:18px' }));
    box.appendChild(el('p', { text: 'Отвечает клиентам в ваших личных чатах Телеграм от вашего имени: официально, на «Вы», без смайликов. Нужен Телеграм Premium: Настройки → Телеграм для бизнеса → Чат-боты → @asoave_bot. Телеграм должен быть привязан к профилю.' }));
    box.appendChild(el('label', { class: 'aid-f aid-inl' }, [on, el('span', { text: 'Ассистент включён' })]));
    box.appendChild(field('Название компании', company)); box.appendChild(field('Рабочие часы', hours)); box.appendChild(field('Инструкции для ассистента', ins));
    if (!p.telegram_id) box.appendChild(el('p', { class: 'aid-hint', text: 'Телеграм ещё не привязан: отправьте боту /link и введите код во вкладке «Профиль».' }));
    box.appendChild(el('button', { class: 'aid-btn', type: 'button', text: 'Сохранить', onclick: function () {
      sb.from('business_automations').upsert({ user_id: p.id, is_enabled: on.checked, company_name: company.value.trim(), working_hours: hours.value.trim(), custom_instructions: ins.value.trim() }, { onConflict: 'user_id' })
        .then(function (x) { say(msg, x.error ? err(x.error) : 'Сохранено', !x.error); }); } }));
    box.appendChild(msg);
  }

  async function tabRewards(p, box) {
    var msg = el('div', { class: 'aid-err', role: 'status' });
    box.appendChild(el('h2', { text: 'Баллы', style: 'font-size:18px' }));
    box.appendChild(el('div', { class: 'aid-big', id: 'rw-balance', text: String(p.rewards_balance || 0) + ' баллов' }));
    box.appendChild(el('p', { text: 'Приглашайте друзей: +10 баллов за каждого, кто зарегистрируется по вашей ссылке.' }));
    var link = shareUrl(p), inp = el('input', { type: 'text', readonly: '', value: link, id: 'rw-link' });
    box.appendChild(inp);
    box.appendChild(el('button', { class: 'aid-btn', type: 'button', text: 'Скопировать ссылку', onclick: function () { copy(link, msg, 'Ссылка скопирована'); } }));
    box.appendChild(msg);
    var h = el('div'); box.appendChild(el('h2', { text: 'История', style: 'font-size:16px;margin-top:16px' })); box.appendChild(h);
    var r = await sb.from('rewards_log').select('delta,reason,created_at').order('created_at', { ascending: false }).limit(20);
    if (r.error || !r.data || !r.data.length) h.appendChild(el('p', { class: 'aid-hint', text: 'Пока пусто.' }));
    else r.data.forEach(function (x) { h.appendChild(el('div', { class: 'aid-row' }, [el('div', { text: (x.delta > 0 ? '+' : '') + x.delta + ' · ' + (x.reason === 'referral' ? 'приглашение' : x.reason) }), el('small', { text: fmtDt(x.created_at) })])); });
  }

  async function tabSecurity(p, box) {
    var cur = await sessionId(), list = el('div'), msg = el('div', { class: 'aid-err', role: 'status' });
    async function paint() {
      list.textContent = '';
      (await listSessions()).forEach(function (s2) {
        list.appendChild(el('div', { class: 'aid-row' }, [el('div', {}, [el('div', { text: ua(s2.user_agent) + (s2.id === cur ? ' (это устройство)' : '') }), el('small', { text: s2.ip || 'IP скрыт' })]), el('small', { text: fmtDt(s2.last_seen_at) })]));
      });
    }
    box.appendChild(el('h2', { text: 'Безопасность', style: 'font-size:18px' }));
    box.appendChild(el('h2', { text: 'Устройства', style: 'font-size:16px' })); box.appendChild(list);
    box.appendChild(el('button', { class: 'aid-btn aid-ghost', type: 'button', id: 'revoke-others', text: 'Завершить все другие сессии', onclick: function () {
      revokeOthers().then(function (n) { say(msg, 'Завершено сессий: ' + n, true); return paint(); }).catch(function (e) { say(msg, err(e)); }); } }));
    var pw = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', placeholder: 'Новый пароль (от 8 символов)' });
    box.appendChild(el('h2', { text: 'Смена пароля', style: 'font-size:16px;margin-top:16px' })); box.appendChild(pw);
    box.appendChild(el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Сменить пароль', onclick: function () {
      if (pw.value.length < 8) return say(msg, 'Пароль — минимум 8 символов');
      sb.auth.updateUser({ password: pw.value }).then(function (r) { if (r.error) return say(msg, err(r.error)); pw.value = ''; sb.rpc('log_event', { p_action: 'password_change' }).then(function () {}); say(msg, 'Пароль изменён', true); }); } }));
    box.appendChild(msg);
    paint().catch(function (e) { say(msg, err(e)); });
  }

  async function tabNotify(p, box) {
    var msg = el('div', { class: 'aid-err', role: 'status' }), P = window.amoorePush;
    box.appendChild(el('h2', { text: 'Push-уведомления', style: 'font-size:18px' }));
    box.appendChild(el('p', { text: 'Получайте уведомление, когда в amoore выходит новость. Для iPhone сначала добавьте сайт на экран «Домой».' }));
    var btn = el('button', { class: 'aid-btn', type: 'button', id: 'push-enable', text: 'Разрешить уведомления' });
    if (P && P.configured && !P.configured()) { box.appendChild(el('p', { class: 'aid-hint', text: 'Push-уведомления пока недоступны. Новости появятся в колокольчике на сайте.' })); return; }
    async function refresh() {
      if (!P || !P.supported()) { btn.disabled = true; btn.textContent = 'Не поддерживается в этом браузере'; return; }
      var sub = await P.isSubscribed(); btn.disabled = false; btn.textContent = sub ? 'Отключить уведомления' : 'Разрешить уведомления'; btn.dataset.on = sub ? '1' : '';
    }
    btn.addEventListener('click', function () {
      btn.disabled = true; say(msg, '');
      (btn.dataset.on ? P.disable(sb) : P.enable(sb)).then(function () { say(msg, btn.dataset.on ? 'Уведомления отключены' : 'Уведомления включены', true); }).catch(function (e) { say(msg, err(e)); }).then(refresh);
    });
    box.appendChild(btn); box.appendChild(msg); refresh();
  }

  var BUILD = { profile: tabProfile, business: tabBusiness, rewards: tabRewards, security: tabSecurity, notify: tabNotify };
  // host — контейнер (inline на лендинге) или null → модальное окно. tab — какую вкладку открыть.
  async function renderProfile(host, tab, onClose) {
    var p = await getProfile(true); if (!p) return null; ensureCss(); await loadRoleLabels();
    var cur = BUILD[tab] ? tab : 'profile', body = el('div', { class: 'aid-body' }), nav = el('div', { class: 'aid-tabs', role: 'tablist' });
    var card = el('div', { class: 'aid-card aid-wide' + (host ? ' aid-inline' : '') }, [nav, body]);
    async function show(t) {
      cur = t; body.textContent = '';
      Array.prototype.forEach.call(nav.children, function (b) { var on = b.dataset.tab === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
      try { await BUILD[t](await getProfile(true), body, function () { renderProfile(host, t, onClose); if (ov) ov.remove(); }); } catch (e) { body.appendChild(el('div', { class: 'aid-err', text: err(e) })); }
    }
    var P0 = window.amoorePush, pushOk = !!(P0 && P0.supported && P0.supported() && P0.configured && P0.configured());
    TABS.filter(function (t) { return t[0] !== 'notify' || pushOk; }).forEach(function (t) { nav.appendChild(el('button', { type: 'button', role: 'tab', 'data-tab': t[0], text: t[1], onclick: function () { show(t[0]); } })); });
    var ov = null;
    if (host) { host.textContent = ''; host.appendChild(card); }
    else { card.appendChild(el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Закрыть', onclick: function () { ov.remove(); onClose && onClose(); } })); ov = overlay(card); }
    show(cur); return card;
  }
  function openProfile(tab) { return renderProfile(null, typeof tab === 'string' ? tab : 'profile'); }

  // ---------------------------------------------------------------- «Люди» (только Boss; права проверяет БД)
  var people = {
    list: async function () { var r = await sb.rpc('admin_list_people'); if (r.error) throw new Error(err(r.error)); return r.data; },
    ban: async function (id, reason) { var r = await sb.rpc('admin_ban_user', { p_user: id, p_reason: reason }); if (r.error) throw new Error(err(r.error)); },
    unban: async function (id) { var r = await sb.rpc('admin_unban_user', { p_user: id }); if (r.error) throw new Error(err(r.error)); },
    setRole: async function (id, role) { var r = await sb.rpc('admin_set_role', { p_user: id, p_role: role }); if (r.error) throw new Error(err(r.error)); return r.data; }
  };


  // ---------------------------------------------------------------- плавающий аккаунт-чип (профиль · SSO · выход) на любом сайте
  async function mountChip() {
    var p = await getProfile(true); var old = document.getElementById('aid-chip'); if (old) old.remove();
    if (!p || !p.onboarded) return; ensureCss();
    var st = document.getElementById('aid-chip-css') || el('style', { id: 'aid-chip-css' });
    st.textContent = '#aid-chip>.aid-chip-ph{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 18px system-ui;color:#17151d;background:' + (p.avatar_color || '#d4af37') + ';border:2px solid rgba(212,175,55,.5);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}#aid-chip{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:9990}#aid-chip>img{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid rgba(212,175,55,.5);cursor:pointer;display:block;transition:transform .35s cubic-bezier(.34,1.56,.64,1)}#aid-chip>img:active{transform:scale(.9)}#aid-menu{position:absolute;bottom:52px;left:0;min-width:210px;padding:6px;border-radius:14px;background:var(--nx-modal-bg,rgba(13,18,32,.95));border:var(--nx-glass-border,1px solid rgba(212,175,55,.2));display:none}#aid-menu.open{display:block}#aid-menu button{display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:none;color:var(--nx-ink,#eef0f7);font:14px var(--nx-font-body,system-ui);border-radius:10px;cursor:pointer}#aid-menu button:hover{background:rgba(212,175,55,.12)}';
    if (!st.parentNode) document.head.appendChild(st);
    var menu = el('div', { id: 'aid-menu' }), items = [['Профиль и устройства', openProfile]];
    if (site !== 'dev' && /admin|moderator|super_admin/.test(p.role)) items.push(['Открыть Админку', function () { return ssoOpen('dev'); }]);
    if (site !== 'studio' && p.role !== 'user') items.push(['Открыть Студию', function () { return ssoOpen('studio'); }]);
    if (site !== 'landing') items.push(['Открыть сайт', function () { return ssoOpen('landing'); }]);
    items.push(['Выйти', function () { return signOut().then(function () { location.reload(); }); }]);
    items.forEach(function (it) { menu.appendChild(el('button', { type: 'button', text: it[0], onclick: function () { menu.classList.remove('open'); Promise.resolve(it[1]()).catch(function (e) { alert(err(e)); }); } })); });
    var img = p.avatar_url ? el('img', { src: p.avatar_url, alt: '@' + p.username, onclick: function () { menu.classList.toggle('open'); } })
      : el('div', { class: 'aid-chip-ph', text: initial(p), 'aria-label': '@' + p.username, onclick: function () { menu.classList.toggle('open'); } });
    document.body.appendChild(el('div', { id: 'aid-chip' }, [menu, img]));
  }
  // одна строка для сайта: обработать ссылку/SSO → онбординг → чип
  async function boot(o) {
    init(o);
    try { await consumeUrl(); } catch (e) { console.warn('[amoore-id]', e); }
    if (await user()) { await register(); var okp = await ensureOnboarded(); if (okp) await claimRef(); await mountChip(); }
  }
  async function register() { try { await sb.rpc('register_session'); } catch (e) {} }


  // окно входа по ссылке из письма (для сайтов без собственного экрана входа)
  function openLogin(reason) {
    var inp = el('input', { type: 'text', inputmode: 'email', placeholder: 'email', autocomplete: 'username', autocapitalize: 'none' }), msg = el('div', { class: 'aid-err', role: 'status' });
    var go = el('button', { class: 'aid-btn', type: 'button', text: 'Выслать ссылку для входа' });
    go.addEventListener('click', function () { go.disabled = true; msg.textContent = '';
      sendMagicLink(inp.value).then(function () { msg.style.color = '#3ddc84'; msg.textContent = 'Письмо отправлено — откройте ссылку на этом устройстве'; })
        .catch(function (e) { msg.style.color = ''; msg.textContent = err(e); go.disabled = false; }); });
    var kids = [el('h2', { text: 'Вход в amoore ID' }), el('p', { text: reason || 'Мы пришлём одноразовую ссылку на почту — пароль не нужен.' }), inp, msg, go];
    var hasRef = !!pendingRef();   // бонус начисляется только если пришли по ?ref=…; создать аккаунт может любой
    kids.push(el('button', { class: 'aid-btn aid-ghost', type: 'button', id: 'aid-register', text: hasRef ? 'Создать аккаунт по приглашению' : 'Создать аккаунт', onclick: function () {
      msg.textContent = ''; sendMagicLink(inp.value, true).then(function () { msg.style.color = '#3ddc84'; msg.textContent = 'Письмо отправлено — откройте ссылку на этом устройстве'; })
        .catch(function (e) { msg.style.color = ''; msg.textContent = err(e); }); } }));
    var ov = overlay(el('div', { class: 'aid-card' }, kids.concat([
      el('button', { class: 'aid-btn aid-ghost', type: 'button', text: 'Закрыть', onclick: function () { ov.remove(); } })])));
  }

  var api = { openLogin: openLogin, renderProfile: renderProfile, pendingRef: pendingRef, claimRef: claimRef, shareUrl: shareUrl, boot: boot, mountChip: mountChip,  init: init, signIn: signIn, sendCode: sendCode, verifyCode: verifyCode, sendMagicLink: sendMagicLink, signOut: signOut, consumeUrl: consumeUrl, ssoOpen: ssoOpen,
    getProfile: getProfile, saveProfile: saveProfile, ensureOnboarded: ensureOnboarded, openProfile: openProfile, listSessions: listSessions, revokeOthers: revokeOthers,
    linkTelegram: linkTelegram, roleRu: roleRu, registerSite: registerSite, avatarEl: avatarEl, AVATAR_COLORS: AVATAR_COLORS, lockLeft: lockLeft, people: people, friendlyError: err, USERNAME_RE: USERNAME_RE, sb: null };
  window.amooreID = api;
})();
