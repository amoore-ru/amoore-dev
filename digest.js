/**
 * digest.js — v3.0.0: сборка «умного дайджеста» за период (по умолчанию 7 дней).
 * Чистая логика без DOM и сети: работает в админке (браузер) и в тестах (Node).
 * Зеркальная реализация для бота — amoore-ai/digest.py (формат текста совпадает, это проверяет QA).
 *
 * Источники данных (читаются админкой из Supabase и передаются сюда):
 *   news   — таблица news (опубликованные за период)
 *   logs   — таблица audit_logs (Event System: каждое действие админа)
 *   leads  — таблица leads (заявки с лендинга)
 *   visits — таблица site_visits
 *   admins — id → ник, sites — id → название
 */
(function (root) {
  'use strict';

  // Какие события считаем «переключением тумблеров», какие — прочими
  var TOGGLE = ['close', 'open', 'banner_on', 'banner_off', 'banner_edit', 'chat_on', 'chat_off', 'news_on', 'news_off'];
  var LABELS = {
    close: 'закрыл сайт', open: 'открыл сайт',
    banner_on: 'включил баннер', banner_off: 'выключил баннер', banner_edit: 'изменил баннер',
    chat_on: 'включил демо-чат', chat_off: 'выключил демо-чат',
    news_on: 'включил новости', news_off: 'выключил новости',
    news_add: 'добавил новость', news_delete: 'удалил новость',
    site_add: 'добавил сайт', site_delete: 'удалил сайт',
    admin_add: 'добавил пользователя', admin_delete: 'удалил пользователя',
    role_change: 'сменил роль', perms_change: 'изменил права', media_upload: 'загрузил медиа',
    backup: 'скачал бэкап', lead_done: 'обработал заявку', digest_request: 'запросил дайджест',
    bot_toggle: 'переключил бота', broadcast: 'сделал рассылку'
  };
  var TYPE_LABEL = { news: 'Новость', patch: 'Патч', soon: 'Скоро' };
  var MAX_ITEMS = 10;     // длинные списки сворачиваются: «…и ещё N»

  var p2 = function (n) { return n < 10 ? '0' + n : String(n); };
  // Время показываем в заданном часовом поясе (tzOffsetMin от UTC) — так JS и Python дают одинаковый текст.
  function shifted(ms, off) { return new Date(ms + off * 60000); }
  function fmtDay(ms, off) { var d = shifted(ms, off); return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1); }
  function fmtDayYear(ms, off) { return fmtDay(ms, off) + '.' + shifted(ms, off).getUTCFullYear(); }
  function fmtTime(ms, off) { var d = shifted(ms, off); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); }
  var ts = function (v) { var t = Date.parse(v); return isNaN(t) ? 0 : t; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

  function build(input) {
    input = input || {};
    var now = input.now instanceof Date ? input.now.getTime() : (typeof input.now === 'number' ? input.now : Date.now());
    var days = input.days || 7, off = typeof input.tzOffsetMin === 'number' ? input.tzOffsetMin : 180;   // по умолчанию Москва
    var from = now - days * 86400000;
    var inPeriod = function (v) { var t = ts(v); return t >= from && t <= now; };
    var adminName = {}; (input.admins || []).forEach(function (a) { adminName[a.id] = a.nickname || a.name || a.email || 'админ'; });
    var siteName = {}; (input.sites || []).forEach(function (s) { siteName[s.id] = s.name || s.id; });

    // --- новости ---
    var news = (input.news || []).filter(function (n) { return n.is_published !== false && inPeriod(n.published_at || n.created_at); })
      .sort(function (a, b) { return ts(b.published_at || b.created_at) - ts(a.published_at || a.created_at); })
      .map(function (n) { var t = ts(n.published_at || n.created_at); return { title: n.title || '', type: n.type || 'news', day: fmtDay(t, off), ms: t }; });

    // --- события админки (Event System) ---
    var logs = (input.logs || []).filter(function (l) { return inPeriod(l.created_at); })
      .sort(function (a, b) { return ts(b.created_at) - ts(a.created_at); });
    var mapLog = function (l) {
      var t = ts(l.created_at);
      return { ms: t, day: fmtDay(t, off), time: fmtTime(t, off), who: adminName[l.admin_id] || 'админ', action: l.action, label: LABELS[l.action] || l.action,
        site: l.site_id ? (siteName[l.site_id] || l.site_id) : '', details: l.details || '' };
    };
    var toggles = logs.filter(function (l) { return TOGGLE.indexOf(l.action) >= 0; }).map(mapLog);
    var other = logs.filter(function (l) { return TOGGLE.indexOf(l.action) < 0 && l.action !== 'news_add'; }).map(mapLog);
    var newsEvents = logs.filter(function (l) { return l.action === 'news_add'; }).length;

    // --- заявки ---
    var leadsIn = (input.leads || []).filter(function (l) { return inPeriod(l.created_at); });
    var leads = { total: leadsIn.length, fresh: leadsIn.filter(function (l) { return (l.status || 'new') === 'new'; }).length };
    leads.done = leads.total - leads.fresh;

    // --- визиты ---
    var by = {}, visitsIn = (input.visits || []).filter(function (v) { return inPeriod(v.created_at); });
    visitsIn.forEach(function (v) { by[v.site_id] = (by[v.site_id] || 0) + 1; });
    var bySite = Object.keys(by).map(function (k) { return { site: k, count: by[k] }; })
      .sort(function (a, b) { return b.count - a.count || (a.site < b.site ? -1 : 1); });

    var res = {
      period: { from: from, to: now, label: fmtDay(from, off) + '–' + fmtDayYear(now, off), days: days },
      news: news, toggles: toggles, other: other, leads: leads,
      visits: { total: visitsIn.length, bySite: bySite },
      totals: { news: news.length, toggles: toggles.length, other: other.length, leads: leads.total, leadsNew: leads.fresh, visits: visitsIn.length, newsEvents: newsEvents }
    };
    res.empty = !news.length && !toggles.length && !other.length && !leads.total && !visitsIn.length;
    res.text = render(res, false);
    res.telegram = render(res, true);
    return res;
  }

  // format: html=true → разметка Telegram (parse_mode=HTML); false → простой текст для копирования
  function render(r, html) {
    var b = function (s) { return html ? '<b>' + esc(s) + '</b>' : s; };
    var e = function (s) { return html ? esc(s) : String(s); };
    var out = [];
    out.push('📊 ' + b('Дайджест amoore') + ' · ' + r.period.label);
    out.push('');
    if (r.empty) { out.push('Тихая неделя: изменений, новостей и заявок не было.'); return out.join('\n'); }

    function list(items, line) {
      var shown = items.slice(0, MAX_ITEMS);
      shown.forEach(function (x) { out.push('• ' + line(x)); });
      if (items.length > shown.length) out.push('…и ещё ' + (items.length - shown.length));
    }
    out.push('📰 ' + b('Новости (' + r.news.length + ')'));
    if (r.news.length) list(r.news, function (n) { return n.day + ' — ' + e(n.title) + ' [' + (TYPE_LABEL[n.type] || n.type) + ']'; });
    else out.push('• за неделю новостей не было');
    out.push('');
    out.push('🎛 ' + b('Изменения тумблеров (' + r.toggles.length + ')'));
    if (r.toggles.length) list(r.toggles, function (t) { return t.day + ' ' + t.time + ' — ' + e(t.who) + ' ' + e(t.label) + (t.site ? ' · ' + e(t.site) : ''); });
    else out.push('• без изменений');
    if (r.other.length) {
      out.push('');
      out.push('🗂 ' + b('Прочие события (' + r.other.length + ')'));
      list(r.other, function (t) { return t.day + ' — ' + e(t.who) + ' ' + e(t.label) + (t.site ? ' · ' + e(t.site) : ''); });
    }
    out.push('');
    out.push('📨 ' + b('Заявки') + ': ' + r.leads.total + ' за неделю, новых ' + r.leads.fresh);
    out.push('👁 ' + b('Визиты') + ': ' + r.visits.total + (r.visits.bySite.length ? ' (' + r.visits.bySite.map(function (s) { return e(s.site) + ' ' + s.count; }).join(', ') + ')' : ''));
    return out.join('\n');
  }

  var api = { build: build, render: render, LABELS: LABELS, TOGGLE: TOGGLE, version: '3.0.0' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AmooreDigest = api;
})(typeof window !== 'undefined' ? window : globalThis);
