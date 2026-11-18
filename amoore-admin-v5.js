/* amoore-admin-v5.js — v5.8.0 «APEX»: «Люди» (Boss), CRM заявок, аналитика (Chart.js), карта, онлайн.
   Классический скрипт после app.js: использует его глобальные sb, $, esc, toast, friendlyError, me, isSuper, fmtDate. */
(function () {
  'use strict';
  const STATUS = { new: 'Новая', in_progress: 'В работе', rejected: 'Отказ', done: 'Обработана' };
  const TAGS = { vip: 'VIP', spam: 'Спам', pending: 'В ожидании', access: 'Проблема с доступом' };
  const ROLE_LABEL = { user: 'Пользователь', moderator: 'Модератор', admin: 'Администратор', super_admin: 'Основатель' };
  const CC = { RU:[61,100],UA:[49,32],BY:[53.7,28],KZ:[48,68],UZ:[41,64],GE:[42,43.5],AM:[40,45],AZ:[40.4,47.7],MD:[47,28.4],LV:[57,25],LT:[55.3,23.9],EE:[58.6,25],PL:[52,19],DE:[51,10],FR:[46.6,2.5],GB:[54,-2],IE:[53,-8],ES:[40,-4],PT:[39.5,-8],IT:[42.8,12.5],NL:[52.2,5.3],BE:[50.6,4.6],CH:[46.8,8.2],AT:[47.6,14.1],CZ:[49.8,15.5],SK:[48.7,19.7],HU:[47.2,19.5],RO:[45.9,25],BG:[42.7,25.5],GR:[39,22],RS:[44,21],HR:[45.1,15.2],FI:[64,26],SE:[62,15],NO:[61,9],DK:[56,10],TR:[39,35],IL:[31,35],AE:[24,54],SA:[24,45],EG:[26.8,30.8],IN:[21,78],CN:[35,103],JP:[36,138],KR:[36.5,127.8],TH:[15,101],VN:[16,106],ID:[-2,118],MY:[4,102],SG:[1.35,103.8],PH:[12.9,122],US:[39.8,-98.6],CA:[56,-106],MX:[23.6,-102.5],BR:[-10,-52],AR:[-34,-64],CL:[-30,-71],CO:[4,-72],AU:[-25,134],NZ:[-41,174],ZA:[-29,24],NG:[9,8],KE:[0,38],MA:[31.8,-7] };
  const D = (n) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
  const loadScript = (src) => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  const loadCss = (href) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.appendChild(l); };
  const css = document.createElement('style');
  css.textContent = '.v5-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px;margin-top:16px}.v5-card{padding:16px;border-radius:18px}.v5-card h3{margin:0 0 10px;font-size:15px}.v5-chart{position:relative;height:220px}#v5-map{height:300px;border-radius:14px;overflow:hidden}.v5-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.v5-chip{padding:6px 12px;border-radius:999px;border:1px solid rgba(212,175,55,.25);background:transparent;color:inherit;font:13px inherit;cursor:pointer}.v5-chip.on{background:rgba(212,175,55,.18)}.v5-live{display:inline-flex;align-items:center;gap:6px}.v5-live i{width:8px;height:8px;border-radius:50%;background:#3ddc84;animation:v5p 1.6s infinite}@keyframes v5p{50%{opacity:.35}}.v5-note{padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.05);font-size:13px;margin-top:6px}.v5-in{width:100%;box-sizing:border-box;padding:10px;border-radius:10px;border:1px solid rgba(212,175,55,.25);background:rgba(255,255,255,.05);color:inherit;font-size:16px}.v5-sel{padding:8px;border-radius:10px;border:1px solid rgba(212,175,55,.25);background:rgba(255,255,255,.05);color:inherit}.v5-sk{height:20px;border-radius:8px;background:rgba(255,255,255,.08);animation:v5p 1.4s infinite;margin:8px 0}';
  document.head.appendChild(css);

  // =========================================================== «Люди» (только Boss; права дублирует БД)
  let people = [], q = '';
  async function loadPeople() {
    const box = $('people-list'); if (!box) return;
    box.innerHTML = '<div class="v5-sk"></div><div class="v5-sk"></div><div class="v5-sk"></div>';
    try { const got = await amooreID.people.list(); people = Array.isArray(got) ? got : []; } catch (e) { box.innerHTML = `<div class="loading-state">${esc(friendlyError(e))}</div>`; return; }
    paintPeople();
  }
  function paintPeople() {
    const box = $('people-list'), s = q.toLowerCase();
    const rows = people.filter(p => !s || (p.email || '').toLowerCase().includes(s) || (p.username || '').includes(s));
    if (!rows.length) { box.innerHTML = '<div class="loading-state">Никого не найдено</div>'; return; }
    box.innerHTML = rows.map(p => {
      const name = p.display_name || (p.username ? p.username : 'Без имени');
      const av = p.avatar_url ? `<img src="${esc(p.avatar_url)}" alt="" width="36" height="36" loading="lazy" class="pp-av">` : `<span class="pp-av pp-av-ph" aria-hidden="true">${esc((String(name).trim()[0] || '?').toUpperCase())}</span>`;
      const badges = `<span class="role-badge ${p.role === 'user' ? 'moderator' : 'admin'}">${esc(ROLE_LABEL[p.role] || p.role)}</span>${p.is_banned ? ' <span class="role-badge" style="background:#c0392b;color:#fff">бан</span>' : ''}`;
      const controls = p.role === 'super_admin' ? '' : `<div class="v5-row">
        <select class="v5-sel" data-role="${esc(p.id)}" aria-label="Роль"><option value="user"${p.role === 'user' ? ' selected' : ''}>Пользователь</option><option value="moderator"${p.role === 'moderator' ? ' selected' : ''}>Модератор</option><option value="admin"${p.role === 'admin' ? ' selected' : ''}>Админ</option></select>
        ${p.is_banned ? `<button class="btn btn-ghost btn-sm" data-unban="${esc(p.id)}">Разбанить</button>` : `<button class="btn btn-ghost btn-sm" data-ban="${esc(p.id)}">Забанить</button>`}</div>`;
      // v5.8.1: в свёрнутом виде — только аватар, имя и @username; остальное раскрывается по клику
      return `<details class="admin-card glass pp-acc" data-uid="${esc(p.id)}"><summary class="pp-sum">${av}<span class="pp-name">${esc(name)}</span><span class="pp-user">${p.username ? '@' + esc(p.username) : 'без username'}</span></summary>
        <div class="pp-body"><p class="pp-badges">${badges}</p>
        <dl class="pp-grid"><dt>Email</dt><dd class="cell-ellipsis" title="${esc(p.email || '')}">${esc(p.email || '—')}</dd><dt>Регистрация</dt><dd>${esc(fmtDate(p.created_at))}</dd><dt>Telegram ID</dt><dd>${p.telegram_id ? esc(p.telegram_id) : '—'}</dd>${p.last_sign_in_at ? `<dt>Вход</dt><dd>${esc(fmtDate(p.last_sign_in_at))}</dd>` : ''}</dl>
        ${p.is_banned && p.ban_reason ? `<p class="muted" style="font-size:12px">Причина: ${esc(p.ban_reason)}</p>` : ''}${controls}</div></details>`;
    }).join('');
  }
  document.addEventListener('input', e => { if (e.target.id === 'people-search') { q = e.target.value; paintPeople(); } });
  document.addEventListener('change', async e => {
    const sel = e.target.closest('[data-role]'); if (!sel) return;
    if (!confirm('Изменить роль? Пользователь, ставший админом, получит секретный токен.')) return loadPeople();
    try {
      const r = await amooreID.people.setRole(sel.dataset.role, sel.value);
      if (r.access_token) prompt('Секретный токен админа — покажется ТОЛЬКО сейчас. Передайте его владельцу безопасным способом:', r.access_token);
      toast('Роль обновлена');
    } catch (err) { toast(friendlyError(err), 'error'); }
    loadPeople();
  });
  document.addEventListener('click', async e => {
    const ban = e.target.closest('[data-ban]'), unban = e.target.closest('[data-unban]');
    try {
      if (ban) { const r = prompt('Причина бана (обязательно):'); if (!r) return; await amooreID.people.ban(ban.dataset.ban, r); toast('Пользователь забанен, сессии завершены'); loadPeople(); }
      if (unban) { await amooreID.people.unban(unban.dataset.unban); toast('Бан снят'); loadPeople(); }
    } catch (err) { toast(friendlyError(err), 'error'); }
  });

  // =========================================================== CRM заявок
  let leadFilter = 'all', tagFilter = '', leadsCache = [];
  window.loadLeads = async function () {
    const list = $('leads-list'); if (!list) return;
    list.innerHTML = '<div class="v5-sk"></div><div class="v5-sk"></div><div class="v5-sk"></div>';
    const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(200);
    if (error) { list.innerHTML = `<div class="loading-state">${esc(friendlyError(error))}</div>`; return; }
    // v5.8.1: одна строка фильтров: [Все] [Новая] [ВИП] [Обработана] [Скачать CSV]
    const FILTERS = [['all', 'Все'], ['new', 'Новая'], ['vip', 'ВИП'], ['done', 'Обработана']];
    const match = (l, k) => k === 'all' || (k === 'vip' ? (l.tags || []).includes('vip') : (l.status || 'new') === k);
    const chips = FILTERS.map(([k, t]) => `<button class="v5-chip${leadFilter === k ? ' on' : ''}" data-lf="${k}" title="${data.filter(l => match(l, k)).length}">${t}</button>`).join('');
    const rows = data.filter(l => match(l, leadFilter));
    leadsCache = rows;
    const canDel = typeof isSuper === 'function' && isSuper();
    list.innerHTML = `<div class="leads-toolbar leads-one-row">${chips}<button class="v5-chip v5-chip-csv" id="leads-csv" type="button">⇩ Скачать CSV</button></div>` + (rows.length ? rows.map(l => `
      <div class="admin-card glass lead-card" data-lead="${esc(l.id)}" data-new="${l.status === 'done' ? 0 : 1}"><div class="admin-card-info">
        <h4>${esc(l.name || 'Без имени')} <span class="role-badge ${l.status === 'done' ? 'admin' : 'moderator'}">${esc(STATUS[l.status || 'new'] || l.status)}</span></h4>
        <p>${esc(l.contact || '')}</p><p class="muted">${esc((l.message || '').slice(0, 400))}</p><p class="muted" style="font-size:12px">${esc(fmtDate(l.created_at))}</p></div>
        <div class="lead-tags" data-tags-for="${esc(l.id)}">${Object.keys(TAGS).map(k => `<button type="button" class="lead-tag${(l.tags || []).includes(k) ? ' on' : ''}" data-tag="${k}" data-lead-id="${esc(l.id)}" aria-pressed="${(l.tags || []).includes(k)}">${TAGS[k]}</button>`).join('')}</div>
        <div class="lead-actions"><select class="v5-sel" data-lstatus="${esc(l.id)}" aria-label="Статус">${Object.keys(STATUS).map(k => `<option value="${k}"${(l.status || 'new') === k ? ' selected' : ''}>${STATUS[k]}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" data-notes="${esc(l.id)}">Заметки</button>${canDel ? `<button type="button" class="btn btn-danger-outline btn-sm" data-lead-del="${esc(l.id)}">Удалить</button>` : ''}${l.status !== 'done' ? `<button type="button" class="btn btn-ghost btn-sm lead-done" data-id="${esc(l.id)}">Обработана</button>` : ''}</div><div class="v5-notes" id="notes-${esc(l.id)}" hidden></div></div>`).join('') : '<div class="loading-state">В этом статусе заявок нет</div>');
  };
  async function paintNotes(id) {
    const box = $('notes-' + id); if (!box) return;
    const { data, error } = await sb.from('leads_notes').select('id,note,created_at').eq('lead_id', id).order('created_at', { ascending: false });
    box.innerHTML = (error ? `<div class="v5-note">${esc(friendlyError(error))}</div>` : (data || []).map(n => `<div class="v5-note">${esc(n.note)}<br><small class="muted">${esc(fmtDate(n.created_at))}</small></div>`).join('')) +
      `<div class="v5-row" style="margin-top:8px"><input class="v5-in" id="note-in-${esc(id)}" maxlength="4000" placeholder="Заметка к заявке…" style="flex:1"><button class="btn btn-primary btn-sm" data-addnote="${esc(id)}">Добавить</button></div>`;
  }
  // CSV: экранирование кавычек + защита от формул Excel (=, +, -, @ в начале ячейки)
  const csvCell = v => { let t = Array.isArray(v) ? v.join('; ') : String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  function exportLeadsCsv() {
    if (!leadsCache.length) return toast('Нет заявок для экспорта', 'error');
    const head = ['id', 'created_at', 'name', 'contact', 'message', 'status', 'tags'];
    const csv = '\ufeff' + [head.join(',')].concat(leadsCache.map(l => [l.id, l.created_at, l.name, l.contact, l.message, l.status || 'new', (l.tags || []).map(t => TAGS[t] || t)].map(csvCell).join(','))).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'amoore-leads-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    amooreID.sb.rpc('log_event', { p_action: 'lead_export', p_details: String(leadsCache.length) }).then(() => {});
  }
  window.amooreExportLeadsCsv = exportLeadsCsv;
  document.addEventListener('click', async e => {
    const tg = e.target.closest('[data-tag]'), tf = e.target.closest('[data-tf]');
    if (e.target.closest('#leads-csv')) return exportLeadsCsv();
    if (tf) { tagFilter = tagFilter === tf.dataset.tf ? '' : tf.dataset.tf; return loadLeads(); }
    if (tg) {
      const id = tg.dataset.leadId, lead = leadsCache.find(x => x.id === id); if (!lead) return;
      const cur = new Set(lead.tags || []); cur.has(tg.dataset.tag) ? cur.delete(tg.dataset.tag) : cur.add(tg.dataset.tag);
      const tags = Array.from(cur);
      const { error } = await sb.from('leads').update({ tags, updated_at: new Date().toISOString() }).eq('id', id);
      if (error) return toast(friendlyError(error), 'error');
      lead.tags = tags; tg.classList.toggle('on'); tg.setAttribute('aria-pressed', String(cur.has(tg.dataset.tag)));
      amooreID.sb.rpc('log_event', { p_action: 'lead_tag', p_details: id + ' → ' + tags.join(',') }).then(() => {});
      return;
    }
  });
  document.addEventListener('click', async e => {
    const f = e.target.closest('[data-lf]'), n = e.target.closest('[data-notes]'), a = e.target.closest('[data-addnote]'), del = e.target.closest('[data-lead-del]');
    if (f) { leadFilter = f.dataset.lf; loadLeads(); }
    if (del) {
      if (!confirm('Удалить заявку навсегда? Заметки к ней тоже пропадут.')) return;
      const { data: gone, error } = await sb.from('leads').delete().eq('id', del.dataset.leadDel).select('id');
      if (error) return toast(friendlyError(error), 'error');
      if (!gone || !gone.length) return toast('Не удалось удалить: нужны права основателя', 'error');
      amooreID.sb.rpc('log_event', { p_action: 'lead_delete', p_details: del.dataset.leadDel }).then(() => {});
      toast('Заявка удалена'); loadLeads(); if (typeof refreshLeadsBadge === 'function') refreshLeadsBadge();
    }
    if (n) { const box = $('notes-' + n.dataset.notes); box.hidden = !box.hidden; if (!box.hidden) paintNotes(n.dataset.notes); }
    if (a) {
      const id = a.dataset.addnote, inp = $('note-in-' + id), t = inp.value.trim(); if (!t) return;
      const { error } = await sb.from('leads_notes').insert({ lead_id: id, note: t, author_id: (await sb.auth.getUser()).data.user.id });
      if (error) toast(friendlyError(error), 'error'); else { inp.value = ''; paintNotes(id); }
    }
  });
  document.addEventListener('change', async e => {
    const s = e.target.closest('[data-lstatus]'); if (!s) return;
    const { error } = await sb.from('leads').update({ status: s.value, updated_at: new Date().toISOString() }).eq('id', s.dataset.lstatus);
    if (error) { toast(friendlyError(error), 'error'); return loadLeads(); }
    amooreID.sb.rpc('log_event', { p_action: 'lead_status', p_details: s.dataset.lstatus + ' → ' + s.value }).then(() => {});
    toast('Статус обновлён'); if (typeof refreshLeadsBadge === 'function') refreshLeadsBadge(); loadLeads();
  });

  // =========================================================== аналитика на дашборде
  let charts = [], map = null, liveTimer = null, ready = null, liveData = [], liveCh = null, liveRedraw = null;
  function libs() {
    return ready || (ready = Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js').then(() => loadCss('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'))
    ]));
  }
  function mount() {
    if ($('v5-analytics')) return;
    const sec = document.createElement('section'); sec.id = 'v5-analytics';
    sec.innerHTML = `<div class="v5-row" style="margin-top:20px"><h3 style="margin:0">Аналитика</h3><span class="v5-live" aria-live="polite"><i></i><b id="v5-online">—</b> онлайн</span></div>
      <div class="v5-grid"><div class="v5-card glass"><h3>Посещения за 7 дней</h3><div class="v5-chart"><canvas id="v5-visits"></canvas></div></div>
      <div class="v5-card glass"><h3>Топ страниц</h3><div class="v5-chart"><canvas id="v5-pages"></canvas></div></div></div>
      <div class="v5-card glass" style="margin-top:14px"><h3>Откуда заходят</h3><div id="v5-map"></div><p class="muted" id="v5-geo-note" style="font-size:12px;margin:8px 0 0"></p></div>`;
    $('view-dashboard').appendChild(sec);
  }
  async function pollOnline() {
    if (document.hidden || !$('v5-online')) return;
    const { data } = await sb.rpc('online_now', { p_site: null }); if (data != null) $('v5-online').textContent = data;
  }
  async function loadAnalytics() {
    mount(); pollOnline(); clearInterval(liveTimer); liveTimer = setInterval(pollOnline, 20000);
    const since = D(6).toISOString();
    const { data, error } = await sb.from('site_visits').select('created_at,path,country_code,country,visitor_id,city,lat,lon').gte('created_at', since).order('created_at', { ascending: false }).limit(5000);
    if (error) { $('v5-geo-note').textContent = friendlyError(error); return; }
    try { await libs(); } catch (_) { $('v5-geo-note').textContent = 'Не удалось загрузить Chart.js / Leaflet (проверьте сеть)'; return; }
    charts.forEach(c => c.destroy()); charts = [];
    liveData = data;
    const days = [...Array(7)].map((_, i) => D(6 - i)), key = d => d.toISOString().slice(0, 10), by = {};
    data.forEach(v => { const k = key(new Date(new Date(v.created_at).setHours(0, 0, 0, 0))); by[k] = (by[k] || 0) + 1; });
    const grid = 'rgba(139,144,165,.18)', txt = '#8b90a5';
    const opts = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: txt }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: txt, precision: 0 }, grid: { color: grid } } } };
    charts.push(new Chart($('v5-visits'), { type: 'line', data: { labels: days.map(d => d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })), datasets: [{ data: days.map(d => by[key(d)] || 0), borderColor: '#d4af37', backgroundColor: 'rgba(212,175,55,.15)', fill: true, tension: .35 }] }, options: opts }));
    const pages = {}; data.forEach(v => { const p = v.path || '/'; pages[p] = (pages[p] || 0) + 1; });
    const top = Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const pagesCard = $('v5-pages').closest('.v5-card'); if (pagesCard) pagesCard.style.display = top.length ? '' : 'none';      // пустой «Топ страниц» не показываем
    if (top.length) charts.push(new Chart($('v5-pages'), { type: 'bar', data: { labels: top.map(t => t[0]), datasets: [{ data: top.map(t => t[1]), backgroundColor: '#8b7cf7' }] }, options: { ...opts, indexAxis: 'y' } }));
    // карта: пузыри по городам (lat/lon визита; если их нет — центр страны)
    const geo = {};
    data.forEach(v => {
      let pos = (typeof v.lat === 'number' && typeof v.lon === 'number') ? [v.lat, v.lon] : (v.country_code ? CC[v.country_code] : null);
      if (!pos) return;
      const name = v.city ? `${v.city}${v.country ? ', ' + v.country : ''}` : (v.country || v.country_code);
      const k = name + '|' + pos[0].toFixed(1) + pos[1].toFixed(1);
      (geo[k] || (geo[k] = { n: name, p: pos, c: 0 })).c++;
    });
    if (!map) { map = L.map('v5-map', { worldCopyJump: true, attributionControl: true, scrollWheelZoom: false }).setView([45, 40], 2); L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 12, attribution: '© OpenStreetMap' }).addTo(map); }
    map.eachLayer(l => { if (l instanceof L.CircleMarker) map.removeLayer(l); });
    const max = Math.max(1, ...Object.values(geo).map(g => g.c)), pts = [];
    Object.values(geo).forEach(g => { pts.push(g.p); L.circleMarker(g.p, { radius: 6 + 16 * g.c / max, color: '#d4af37', fillColor: '#d4af37', fillOpacity: .5, weight: 1 }).addTo(map).bindTooltip(`${g.n}: ${g.c}`); });
    if (pts.length) { try { map.fitBounds(pts, { padding: [30, 30], maxZoom: 6 }); } catch (_) {} }
    const nCity = new Set(data.filter(v => v.city).map(v => v.city)).size;
    $('v5-geo-note').textContent = Object.keys(geo).length ? `Городов: ${nCity}, мест на карте: ${Object.keys(geo).length}. Гео ставится по IP при визите (сам IP не хранится).` : 'Гео-данных пока нет: они появятся после деплоя Edge Function geo и новых визитов.';
    setTimeout(() => map.invalidateSize(), 200);
    startLive();
  }
  // Live Activity: новые визиты прилетают по Supabase Realtime, графики обновляются без перезагрузки
  function redrawLive() {
    if (!charts.length || !liveData.length && !$('v5-visits')) return;
    const days = [...Array(7)].map((_, i) => D(6 - i)), key = d => d.toISOString().slice(0, 10), by = {};
    liveData.forEach(v => { const k = key(new Date(new Date(v.created_at).setHours(0, 0, 0, 0))); by[k] = (by[k] || 0) + 1; });
    charts[0].data.datasets[0].data = days.map(d => by[key(d)] || 0); charts[0].update('none');
    const pages = {}; liveData.forEach(v => { const p = v.path || '/'; pages[p] = (pages[p] || 0) + 1; });
    const top = Object.entries(pages).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (charts[1]) { charts[1].data.labels = top.map(t => t[0]); charts[1].data.datasets[0].data = top.map(t => t[1]); charts[1].update('none'); }
  }
  function startLive() {
    if (liveCh) return;
    try {
      liveCh = sb.channel('amoore-live-activity').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'site_visits' }, p => {
        liveData.unshift(p.new); if (liveData.length > 6000) liveData.pop();
        clearTimeout(liveRedraw); liveRedraw = setTimeout(() => { redrawLive(); pollOnline(); }, 400);   // пачка визитов — одна перерисовка
      }).subscribe();
    } catch (_) { /* без Realtime остаётся опрос онлайна раз в 20 с */ }
  }

  // =========================================================== Промокоды (админ и Основатель; лимиты проверяет БД)
  let promoRows = [];
  const toLocalDt = iso => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  function paintPromoList(rows) {
    const box = $('pm-list'); if (!box) return; promoRows = rows;
    if (!rows.length) { box.innerHTML = '<div class="loading-state">Промокодов пока нет</div>'; return; }
    box.innerHTML = rows.map(r => {
      const exp = r.expires_at ? fmtDate(r.expires_at) : 'бессрочно';
      const left = r.max_uses == null ? `${r.uses} / ∞` : `${r.uses} / ${r.max_uses}`;
      return `<div class="promo-row" data-pm-row="${esc(r.id)}"><div class="promo-main"><b>${esc(r.code)}</b><small>+${esc(r.points)} · активаций ${esc(left)} · ${esc(exp)}</small></div>
        <div class="promo-actions"><button type="button" class="btn btn-ghost btn-sm" data-pm-toggle="${esc(r.id)}" data-active="${r.active ? '1' : '0'}">${r.active ? 'Выключить' : 'Включить'}</button>
        <button type="button" class="btn btn-ghost btn-sm" data-pm-edit="${esc(r.id)}">Редактировать</button>
        <button type="button" class="btn btn-ghost btn-sm" data-pm-del="${esc(r.id)}">Удалить</button></div></div>`;
    }).join('');
  }
  function openPromoEdit(id) {
    const r = promoRows.find(x => x.id === id); const row = document.querySelector(`[data-pm-row="${CSS.escape(id)}"]`); if (!r || !row) return;
    row.innerHTML = `<div class="promo-main"><b>${esc(r.code)}</b><small>код менять нельзя — создайте новый</small></div>
      <div class="promo-edit">
        <input class="pe-points" type="number" min="1" ${me.role !== 'super_admin' ? 'max="100"' : ''} inputmode="numeric" value="${esc(r.points)}" aria-label="Номинал">
        <input class="pe-max" type="number" min="1" inputmode="numeric" value="${r.max_uses == null ? '' : esc(r.max_uses)}" placeholder="Лимит (пусто — без лимита)" aria-label="Лимит активаций">
        <input class="pe-exp" type="datetime-local" value="${esc(toLocalDt(r.expires_at))}" ${r.expires_at ? '' : 'disabled'} aria-label="Срок действия">
        <label class="promo-chk"><input class="pe-forever" type="checkbox" ${r.expires_at ? '' : 'checked'}> Бессрочно</label>
        <div class="promo-actions"><button type="button" class="btn btn-primary btn-sm" data-pm-save="${esc(id)}">Сохранить</button><button type="button" class="btn btn-ghost btn-sm" data-pm-cancel="1">Отмена</button></div>
      </div>`;
  }
  async function loadPromo() {
    const card = $('set-promo'); if (!card) return;
    const ok = me && (me.role === 'super_admin' || me.role === 'admin');
    card.hidden = !ok; if (!ok) return;
    const pts = $('pm-points'); if (me.role !== 'super_admin') pts.max = 100;
    const r = await sb.rpc('admin_list_promocodes');
    if (r.error) { $('pm-list').innerHTML = `<div class="loading-state">${esc(friendlyError(r.error))}</div>`; return; }
    paintPromoList(r.data || []);
  }
  document.addEventListener('click', async e => {
    if (e.target.id === 'pm-create') {
      const code = $('pm-code').value.trim(), points = parseInt($('pm-points').value, 10), mx = parseInt($('pm-max').value, 10);
      const exp = $('pm-forever').checked || !$('pm-exp').value ? null : new Date($('pm-exp').value).toISOString();
      if (!code || !points) return toast('Укажите название и номинал', 'error');
      if (me.role !== 'super_admin' && points > 100) return toast('Админ может создавать коды до 100 баллов', 'error');
      const r = await sb.rpc('admin_create_promocode', { p_code: code, p_points: points, p_max_uses: Number.isFinite(mx) ? mx : null, p_expires: exp });
      if (r.error) return toast(friendlyError(r.error), 'error');
      ['pm-code', 'pm-points', 'pm-max'].forEach(i => { $(i).value = ''; });
      toast('Промокод создан'); loadPromo();
    }
    const ed = e.target.closest('[data-pm-edit]'); if (ed) return openPromoEdit(ed.dataset.pmEdit);
    if (e.target.closest('[data-pm-cancel]')) return paintPromoList(promoRows);
    const sv = e.target.closest('[data-pm-save]');
    if (sv) {
      const row = sv.closest('[data-pm-row]'), pts = parseInt(row.querySelector('.pe-points').value, 10), mx = parseInt(row.querySelector('.pe-max').value, 10);
      const forever = row.querySelector('.pe-forever').checked, expv = row.querySelector('.pe-exp').value;
      if (!pts || pts < 1) return toast('Укажите номинал', 'error');
      if (me.role !== 'super_admin' && pts > 100) return toast('Админ может создавать коды до 100 баллов', 'error');
      const r = await sb.rpc('admin_update_promocode', { p_id: sv.dataset.pmSave, p_points: pts, p_max_uses: Number.isFinite(mx) ? mx : null, p_expires: forever || !expv ? null : new Date(expv).toISOString() });
      if (r.error) return toast(friendlyError(r.error), 'error');
      toast('Промокод обновлён'); return loadPromo();
    }
    const dl = e.target.closest('[data-pm-del]');
    if (dl) {
      const r0 = promoRows.find(x => x.id === dl.dataset.pmDel);
      if (!window.confirm(`Удалить промокод ${r0 ? r0.code : ''}? Уже начисленные баллы останутся у пользователей.`)) return;
      const r = await sb.rpc('admin_delete_promocode', { p_id: dl.dataset.pmDel });
      if (r.error) return toast(friendlyError(r.error), 'error');
      toast('Промокод удалён'); return loadPromo();
    }
    const t = e.target.closest('[data-pm-toggle]');
    if (t) {
      const r = await sb.rpc('admin_toggle_promocode', { p_id: t.dataset.pmToggle, p_active: t.dataset.active !== '1' });
      if (r.error) return toast(friendlyError(r.error), 'error');
      loadPromo();
    }
  });
  document.addEventListener('change', e => { if (e.target.id === 'pm-forever') $('pm-exp').disabled = e.target.checked; if (e.target.classList && e.target.classList.contains('pe-forever')) e.target.closest('.promo-edit').querySelector('.pe-exp').disabled = e.target.checked; });

  window.amooreV5 = { onView(name) { if (name === 'settings') loadPromo(); if (name === 'people') loadPeople(); if (name === 'dashboard') loadAnalytics(); } };
})();

// ===================================================================== v5.8: лупа в шапке + колокольчик с Realtime-уведомлениями
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const tgl = $('search-toggle'), wrap = $('main-search'), bellBtn = $('bell-btn'), panel = $('bell-panel');
  if (!tgl || !bellBtn || !panel) return;
  const closePanels = (except) => {
    if (except !== 'search') { wrap.hidden = true; tgl.setAttribute('aria-expanded', 'false'); }
    if (except !== 'bell') { panel.hidden = true; bellBtn.setAttribute('aria-expanded', 'false'); }
  };
  tgl.addEventListener('click', (e) => {
    e.stopPropagation(); const open = wrap.hidden; closePanels(open ? 'search' : ''); wrap.hidden = !open; tgl.setAttribute('aria-expanded', String(open));
    if (open) setTimeout(() => { const i = $('global-search'); if (i) i.focus(); }, 30);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanels(''); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap') && !e.target.closest('#main-search') && !e.target.closest('#search-toggle')) closePanels(''); });
  $('global-search-results')?.addEventListener('click', () => { wrap.hidden = true; tgl.setAttribute('aria-expanded', 'false'); });

  // --- уведомления: новые заявки, новые люди (для Основателя), важные действия в журнале (для тех, кто видит логи)
  let items = [], started = false;
  const seenKey = () => 'amoore_bell_seen_' + (me?.admin_id || 'x');
  const seen = () => Number(localStorage.getItem(seenKey()) || 0);
  const KIND = { lead: ['✉', 'Новая заявка'], person: ['👤', 'Новый пользователь'], log: ['⚙', 'Действие'] };
  const IMPORTANT = new Set(['ban', 'unban', 'set_role', 'role_change', 'sessions_revoked', 'promo_create', 'promo_delete', 'god_points', 'changelog_edit']);
  function paint() {
    const list = $('bell-list'), unread = items.filter(i => i.t > seen()).length, cnt = $('bell-count');
    cnt.hidden = !unread; cnt.textContent = unread > 9 ? '9+' : String(unread);
    bellBtn.setAttribute('aria-label', unread ? 'Уведомления: ' + unread + ' новых' : 'Уведомления');
    if (!items.length) { list.innerHTML = '<p class="bell-empty">Пока тихо.</p>'; return; }
    list.innerHTML = items.slice(0, 30).map(i => `<button type="button" class="bell-item${i.t > seen() ? ' new' : ''}" data-view="${i.view}"><span class="bell-ico" aria-hidden="true">${KIND[i.kind][0]}</span><span class="bell-text"><b>${esc(i.title)}</b><small>${esc(i.text)}</small></span><time>${esc(new Date(i.t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</time></button>`).join('');
  }
  const push = (it, silent) => { if (items.some(x => x.id === it.id)) return; items.push(it); items.sort((a, b) => b.t - a.t); items = items.slice(0, 40); paint(); };
  async function boot() {
    if (started || typeof me === 'undefined' || !me || typeof sb === 'undefined' || !sb) return;
    started = true;
    try {
      const jobs = [sb.from('leads').select('id,name,created_at').order('created_at', { ascending: false }).limit(10)];
      if (isSuper()) jobs.push(sb.from('profiles').select('id,username,created_at').order('created_at', { ascending: false }).limit(10));
      if (can('view_logs')) jobs.push(sb.from('audit_logs').select('id,action,details,created_at').in('action', [...IMPORTANT]).order('created_at', { ascending: false }).limit(10));
      const res = await Promise.all(jobs.map(j => j.then(r => r, () => ({ data: [] }))));
      (res[0].data || []).forEach(l => push({ id: 'l' + l.id, kind: 'lead', title: KIND.lead[1], text: l.name || 'Без имени', t: Date.parse(l.created_at) || 0, view: 'leads' }));
      let k = 1;
      if (isSuper()) { (res[k++]?.data || []).forEach(p => push({ id: 'p' + p.id, kind: 'person', title: KIND.person[1], text: '@' + (p.username || '—'), t: Date.parse(p.created_at) || 0, view: 'people' })); }
      if (can('view_logs')) (res[k]?.data || []).forEach(g => push({ id: 'g' + g.id, kind: 'log', title: KIND.log[1], text: (typeof ACTION_LABELS !== 'undefined' && ACTION_LABELS[g.action]) || g.action, t: Date.parse(g.created_at) || 0, view: 'logs' }));
    } catch (_) {}
    paint();
    try {
      const ch = sb.channel('amoore-dev-bell');
      ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, (m) => { const l = m.new || {}; push({ id: 'l' + l.id, kind: 'lead', title: KIND.lead[1], text: l.name || 'Без имени', t: Date.now(), view: 'leads' }); toast('Новая заявка: ' + (l.name || 'без имени')); });
      if (isSuper()) ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'profiles' }, (m) => { const p = m.new || {}; push({ id: 'p' + p.id, kind: 'person', title: KIND.person[1], text: '@' + (p.username || '—'), t: Date.now(), view: 'people' }); });
      if (can('view_logs')) ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'audit_logs' }, (m) => { const g = m.new || {}; if (!IMPORTANT.has(g.action)) return; push({ id: 'g' + g.id, kind: 'log', title: KIND.log[1], text: (typeof ACTION_LABELS !== 'undefined' && ACTION_LABELS[g.action]) || g.action, t: Date.now(), view: 'logs' }); });
      ch.subscribe();
    } catch (_) {}
  }
  bellBtn.addEventListener('click', (e) => { e.stopPropagation(); const open = panel.hidden; closePanels(open ? 'bell' : ''); panel.hidden = !open; bellBtn.setAttribute('aria-expanded', String(open)); });
  $('bell-readall').addEventListener('click', () => { localStorage.setItem(seenKey(), String(Date.now())); paint(); });
  $('bell-list').addEventListener('click', (e) => { const b = e.target.closest('.bell-item'); if (!b) return; panel.hidden = true; bellBtn.setAttribute('aria-expanded', 'false'); const tab = document.getElementById('tab-' + b.dataset.view); if (tab) tab.click(); });
  const iv = setInterval(() => { if (started) return clearInterval(iv); boot(); }, 800);
})();
