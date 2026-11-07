/* QA: админка amoore-dev (вкладки, «Что нового», красный счётчик заявок, дайджест, публикация новостей, права, адаптив).
   Запуск: node qa/panel.test.js */
const path = require('path'), fs = require('fs');
const H = require('./harness'), S = require('./seed'), { suite, sleep, until } = require('./lib');
const DEV = path.resolve(__dirname, '..'), RU = path.resolve(__dirname, '../../amoore-ru');
const SHOTS = path.join(__dirname, 'results', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sessionInit = (id, role, seen) => `localStorage.setItem('amoore_dev_auth', JSON.stringify({admin_id:'${id}',email:'x@amoore.ru',nickname:'U',name:'U',role:'${role}',access_token:'tok',expires_at:Date.now()+3e6}));` + (seen ? `localStorage.setItem('amoore_dev_seen_version','3.0.0');` : '');

(async () => {
  const { chromium } = H.pwRequire();
  const T = suite('panel');
  const srv = await H.serve(DEV, 8302), srvRu = await H.serve(RU, 8303);
  const URL = 'http://localhost:8302/index.html';
  const b = await chromium.launch();
  const open = (o = {}) => H.openPage(b, URL, o.seed || S.seed(), Object.assign({ init: sessionInit('a1', 'super_admin', o.seen !== false) }, o));
  const visibleTabs = (page) => page.$$eval('.tab-btn', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => e.textContent.replace(/\d+\+?$/, '').trim()));

  // ---------- вкладки, версия, «Что нового» ----------
  console.log('Навигация и версия');
  { const { page, errors } = await open({ seen: true });
    await until(async () => (await page.$$('.site-card')).length >= 2, 5000);
    const tabs = await visibleTabs(page);
    T.check('порядок вкладок: Дашборд → Медиа → Команда → Логи → Заявки → Дайджест → Настройки', tabs.join('>') === 'Дашборд>Медиа>Команда>Логи>Заявки>Дайджест>Настройки', tabs.join('>'));
    T.check('чип версии показывает v3.0.0', (await page.textContent('#version-chip')) === 'v3.0.0');
    T.check('нет ошибок JS при входе', errors.length === 0, errors.join('; '));
    T.check('если версия уже просмотрена — окно «Что нового» не показывается', !(await page.$eval('#whatsnew-modal', e => e.classList.contains('visible'))));
    await page.click('#version-chip'); await sleep(500);
    T.check('клик по чипу версии открывает историю обновлений', await page.$eval('#whatsnew-modal', e => e.classList.contains('visible')) && /История обновлений/.test(await page.textContent('#whatsnew-title')));
    await page.click('#whatsnew-ok'); await page.context().close(); }
  { const { page } = await open({ seen: false });
    const shown = await until(async () => page.$eval('#whatsnew-modal', e => e.classList.contains('visible')), 3000);
    T.check('первый вход за версию: выскакивает окно «Что нового»', !!shown);
    T.check('заголовок «Обновление v3.0»', /Обновление v3\.0/.test(await page.textContent('#whatsnew-title')), await page.textContent('#whatsnew-title'));
    const li = await page.$$eval('#whatsnew-list li li', e => e.map(x => x.textContent));
    T.check('в списке новые функции: дайджест, дизайн, заявки', li.some(t => /айджест/.test(t)) && li.some(t => /дизайн/i.test(t)) && li.some(t => /заявок|заявки/i.test(t)), li.length + ' пунктов');
    await page.click('#whatsnew-ok'); await sleep(300);
    T.check('после «Понятно» версия запоминается', (await page.evaluate(() => localStorage.getItem('amoore_dev_seen_version'))) === '3.0.0');
    await page.reload(); await sleep(1500);
    T.check('после перезагрузки окно больше не появляется', !(await page.$eval('#whatsnew-modal', e => e.classList.contains('visible'))));
    await page.context().close(); }
  { const core = fs.readFileSync(path.join(DEV, 'shared/amoore-core.js'), 'utf8'), app = fs.readFileSync(path.join(DEV, 'app.js'), 'utf8');
    const cv = (core.match(/var AMOORE_VERSION = '([\d.]+)'/) || [])[1], av = (app.match(/const AMOORE_VERSION = '([\d.]+)'/) || [])[1];
    const cl = JSON.parse(fs.readFileSync(path.join(DEV, 'changelog.json'), 'utf8'));
    T.check('синхронизация версий: core = app.js = changelog (3.0.0)', cv === '3.0.0' && av === '3.0.0' && cl.current === '3.0.0', `${cv}/${av}/${cl.current}`); }

  // ---------- красный счётчик заявок ----------
  console.log('Заявки и счётчик');
  { const { page } = await open();
    const ok = await until(async () => !(await page.$eval('#leads-badge', e => e.hidden)), 4000);
    T.check('красный бейдж на вкладке «Заявки» показывает число новых (2)', !!ok && (await page.textContent('#leads-badge')) === '2');
    T.check('бейдж красный и заметный (цвет фона = красный)', await page.$eval('#leads-badge', e => { const c = getComputedStyle(e).backgroundColor.match(/\d+/g).map(Number); return c[0] > 200 && c[1] < 100; }));
    T.check('карточка «Новых заявок» на дашборде = 2 и подсвечена', (await page.textContent('#stat-leads')) === '2' && await page.$eval('#stat-leads-card', e => e.classList.contains('has-new')));
    await page.evaluate(() => { window.__db.leads.unshift({ id: 'l9', name: 'Новая', contact: '@new_one', message: 'hi', status: 'new', created_at: new Date().toISOString() }); window.__emit('leads', {}); });
    T.check('новая заявка с лендинга увеличивает счётчик без перезагрузки (Realtime)', !!(await until(async () => (await page.textContent('#leads-badge')) === '3', 3000)));
    await page.click('#tab-leads'); await until(async () => (await page.$$('#leads-list .admin-card')).length >= 3, 3000);
    T.check('список заявок: новые помечены, обработанные нет', (await page.$$('#leads-list [data-new="1"]')).length === 3 && (await page.$$('#leads-list [data-new="0"]')).length === 1);
    await page.click('#leads-list .lead-done'); await sleep(600);
    T.check('«Обработана» уменьшает счётчик (3 → 2) и пишет событие lead_done', (await page.textContent('#leads-badge')) === '2' && (await page.evaluate(() => window.__db.audit_logs.some(l => l.action === 'lead_done'))));
    await page.evaluate(() => window.__db.leads.forEach(l => l.status = 'done')); await page.evaluate(() => window.__emit('leads', {})); await sleep(700);
    T.check('когда новых нет — бейдж скрывается', await page.$eval('#leads-badge', e => e.hidden));
    await page.context().close(); }
  { const s = S.seed(); s.leads[0].name = '<img src=x onerror="window.__xss=1">';
    const { page } = await open({ seed: s }); await page.click('#tab-leads'); await sleep(800);
    T.check('XSS в имени заявки экранируется', !(await page.evaluate(() => window.__xss)) && (await page.$$('#leads-list img')).length === 0);
    await page.context().close(); }
  { const { page } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await until(async () => !(await page.$eval('#burger-dot', e => e.hidden)), 4000);
    T.check('мобильный: на бургере есть красная точка при новых заявках', !(await page.$eval('#burger-dot', e => e.hidden)));
    await page.context().close(); }

  // ---------- переходы вкладок ----------
  console.log('Анимации');
  { const { page } = await open();
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await page.click('#tab-media');
    const seenLeaving = await page.evaluate(() => new Promise(r => { const t0 = performance.now(); const tick = () => { if (document.querySelector('.view.leaving')) return r(true); if (performance.now() - t0 > 400) return r(false); requestAnimationFrame(tick); }; tick(); }));
    T.check('уходящая вкладка получает класс leaving (плавное исчезновение)', seenLeaving);
    await sleep(120);
    const anim = await page.$eval('#view-media', e => getComputedStyle(e).animationName);
    T.check('новая вкладка выезжает снизу с blur (amoore-view-in)', anim === 'amoore-view-in', anim);
    await sleep(700);
    const fin = await page.$eval('#view-media', e => { const c = getComputedStyle(e); return { o: c.opacity, f: c.filter, t: c.transform }; });
    T.check('после анимации контент чёткий и на месте', fin.o === '1' && (fin.f === 'none' || /blur\(0/.test(fin.f)), JSON.stringify(fin));
    await page.click('#tab-logs'); await page.click('#tab-dashboard'); await sleep(900);
    T.check('быстрые переключения не оставляют два экрана одновременно', (await page.$$('.view.active')).length === 1 && (await page.$$('.view.leaving')).length === 0);
    await page.context().close(); }
  { const { page } = await open({ reducedMotion: 'reduce' });
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await page.click('#tab-media'); await sleep(120);
    T.check('prefers-reduced-motion: переключение мгновенное, без анимации', (await page.$eval('#view-media', e => getComputedStyle(e).animationName)) === 'none' && (await page.$$('.view.leaving')).length === 0);
    await page.context().close(); }

  // ---------- дайджест ----------
  console.log('Дайджест');
  { const { page, ctx } = await open();
    await page.click('#tab-digest'); await sleep(300);
    T.check('вкладка «Дайджест» открывается, видна кнопка «Сформировать сводку за неделю»', /Сформировать сводку за неделю/.test(await page.textContent('#digest-build')));
    await page.click('#digest-build');
    await until(async () => page.$('.digest-tiles'), 4000);
    const tiles = await page.$$eval('.digest-tiles .stat-value', e => e.map(x => x.textContent));
    T.check('плитки: новости 3, переключения 4, заявки 3, визиты 12', tiles.join(',') === '3,4,3,12', tiles.join(','));
    const secs = await page.$$eval('.digest-section h3', e => e.map(x => x.textContent.replace(/\s+/g, ' ').trim()));
    T.check('разделы отчёта: новости, тумблеры, визиты', secs.some(t => /Новости/.test(t)) && secs.some(t => /тумблеров/.test(t)) && secs.some(t => /Визиты/.test(t)), secs.join(' | '));
    T.check('в отчёте есть реальные записи (баннер landing, закрытие studio)', /включил баннер/.test(await page.textContent('.digest-grid')) && /закрыл сайт/.test(await page.textContent('.digest-grid')));
    T.check('черновик (не опубликован) в дайджест не попадает', !/Черновик/.test(await page.textContent('#digest-result')));
    await page.click('#digest-copy'); await sleep(200);
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    T.check('«Скопировать текст» кладёт дайджест в буфер', /Дайджест amoore/.test(clip) && /📰/.test(clip) && /🎛/.test(clip));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#digest-download')]);
    T.check('«Скачать .txt» отдаёт файл amoore-digest-ДАТА.txt', /^amoore-digest-\d{4}-\d{2}-\d{2}\.txt$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    await page.click('#digest-send'); await sleep(500);
    const q = await page.evaluate(() => window.__db.digest_queue);
    T.check('«Отправить боту» создаёт запрос в digest_queue (source=dev, pending, от имени админа)', q.length === 1 && q[0].status === 'pending' && q[0].source === 'dev' && q[0].requested_by === 'a1', JSON.stringify(q));
    T.check('событие digest_request записано в журнал (Event System)', await page.evaluate(() => window.__db.audit_logs.some(l => l.action === 'digest_request')));
    await page.evaluate(() => { window.__db.digest_queue[0].status = 'sent'; });
    T.check('когда бот отвечает «sent» — пользователь видит подтверждение', !!(await until(async () => /✓ Бот отправил/.test(await page.textContent('#digest-send-status')), 8000)), await page.textContent('#digest-send-status'));
    await page.evaluate(() => { window.__db.digest_queue.length = 0; window.__db.digest_queue.push({ id: 'p', status: 'pending', source: 'dev' }); });
    await page.click('#digest-send'); await sleep(400);
    T.check('повторный запрос, пока предыдущий в очереди, отклоняется понятным сообщением', /уже в очереди/i.test(await page.textContent('#digest-send-status')));
    await page.screenshot({ path: path.join(SHOTS, 'panel-digest-1280.png') });
    await ctx.close(); }
  { const s = S.seed(); s.audit_logs = []; s.news = []; s.leads = []; s.site_visits = [];
    const { page } = await open({ seed: s }); await page.click('#tab-digest'); await page.click('#digest-build');
    await until(async () => /Тихая неделя/.test(await page.textContent('#digest-result')), 4000);
    T.check('пустая неделя: «Тихая неделя…» вместо пустого отчёта', /Тихая неделя/.test(await page.textContent('#digest-result')));
    await page.context().close(); }
  { const { page } = await open({ mockInit: "window.__mock={hang:[],fail:['audit_logs'],calls:[],session:true};" });
    await page.click('#tab-digest'); await page.click('#digest-build'); await sleep(1200);
    T.check('отказ одной таблицы не ломает дайджест: отчёт собирается из остального', !!(await page.$('.digest-tiles')));
    await page.context().close(); }

  // ---------- публикация новостей: админка → лендинг ----------
  console.log('Публикация новостей (E2E админка → лендинг)');
  { const { page: dev, ctx } = await open();
    await until(async () => (await dev.$$('.site-card')).length >= 2, 4000);
    await dev.fill('#news-title', 'Большое обновление 3.0'); await dev.fill('#news-body', 'Дайджесты, заявки и новый дизайн.'); await dev.fill('#news-date', '2026-11-06');
    await dev.dblclick('#news-submit-btn'); await sleep(900);
    const rows = await dev.evaluate(() => window.__db.news.filter(n => n.title === 'Большое обновление 3.0'));
    T.check('двойной клик по «Опубликовать» создаёт ровно одну новость', rows.length === 1, rows.length);
    T.check('новость сохранена опубликованной, с датой и типом', rows[0] && rows[0].is_published === true && rows[0].display_date === '2026-11-06' && rows[0].type === 'news' && !!rows[0].published_at, JSON.stringify(rows[0]));
    T.check('событие news_add пишется в журнал с заголовком', await dev.evaluate(() => window.__db.audit_logs.some(l => l.action === 'news_add' && /Большое обновление/.test(l.details || ''))));
    T.check('валидация: слишком короткий заголовок отклоняется', await (async () => { await dev.fill('#news-title', 'ab'); await dev.fill('#news-body', 'текст достаточной длины'); await dev.click('#news-submit-btn'); await sleep(250); return /минимум 3/.test(await dev.textContent('#toast')) && (await dev.evaluate(() => window.__db.news.filter(n => n.title === 'ab').length)) === 0; })());
    // лендинг получает то же состояние БД и событие Realtime
    const dbNow = await dev.evaluate(() => window.__db.news);
    const seed2 = S.seed(); seed2.news = JSON.parse(JSON.stringify(dbNow));
    const { page: ru } = await H.openPage(b, 'http://localhost:8303/index.html', S.seed(), {});
    await until(async () => (await ru.$$('#news-list [data-type]')).length >= 3, 5000);
    const before = (await ru.$$('#news-list [data-type]')).length;
    await ru.evaluate((news) => { window.__db.news = news; window.__emit('news', { eventType: 'INSERT' }); }, dbNow);
    const ok = await until(async () => (await ru.$$eval('#news-list b', e => e.map(x => x.textContent))).includes('Большое обновление 3.0'), 4000);
    const meta = await ru.$$eval('#news-list .news-item', els => els.map(e => e.textContent)).then(a => a.find(t => /Большое обновление 3\.0/.test(t)) || '');
    T.check('опубликованная в админке новость появляется на лендинге без перезагрузки', !!ok && before >= 3, `было ${before}`);
    T.check('на лендинге показана дата 06.11.2026', /06\.11\.2026/.test(meta), meta);
    await ru.evaluate(() => sessionStorage.setItem('__mockdb', JSON.stringify(window.__db)));
    await ru.reload(); const ok2 = await until(async () => (await ru.$$eval('#news-list b', e => e.map(x => x.textContent))).includes('Большое обновление 3.0'), 5000);
    T.check('после перезагрузки лендинга новость на месте', !!ok2);
    await ctx.close(); }

  // ---------- сайты и тумблеры ----------
  console.log('Сайты, тумблеры, права');
  { const { page } = await open();
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await page.click('.site-card[data-id="landing"] [data-act="banner"]'); await sleep(300);
    await page.fill('.site-card[data-id="landing"] .banner-input', 'Профилактика до 18:00'); await page.click('[data-act="banner-apply"]'); await sleep(400);
    const st = await page.evaluate(() => window.__db.ecosystem_sites.find(s => s.id === 'landing'));
    T.check('баннер: включение + текст сохраняются в БД', st.banner_active === true && st.banner_text === 'Профилактика до 18:00', JSON.stringify([st.banner_active, st.banner_text]));
    await page.click('.site-card[data-id="landing"] [data-act="chat"]'); await sleep(300);
    T.check('демо-чат: тумблер переключает demo_chat_active', (await page.evaluate(() => window.__db.ecosystem_sites.find(s => s.id === 'landing').demo_chat_active)) === false);
    T.check('действия попадают в журнал (banner_on, banner_edit, chat_off)', await page.evaluate(() => ['banner_on', 'banner_edit', 'chat_off'].every(a => window.__db.audit_logs.some(l => l.action === a))));
    await page.click('#add-site-btn'); await page.fill('#site-new-id', 'new-site'); await page.fill('#site-new-name', 'Тест'); await page.fill('#site-new-url', 'example.com'); await page.click('#site-save'); await sleep(500);
    T.check('«+ Добавить сайт»: запись создана, URL нормализован до https://', await page.evaluate(() => { const s = window.__db.ecosystem_sites.find(x => x.id === 'new-site'); return !!s && /^https:\/\/example\.com/.test(s.url); }));
    await page.context().close(); }
  { const { page } = await open({ admin: { id: 'a2', email: 'mod@amoore.ru', name: 'Mod', nickname: 'Mod', role: 'moderator', permissions: null }, init: sessionInit('a2', 'moderator', true) });
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    const tabs = await visibleTabs(page);
    T.check('RBAC: модератор без прав не видит Заявки/Дайджест/Логи/Команду/Настройки', tabs.join(',') === 'Дашборд', tabs.join(','));
    T.check('RBAC: у модератора нет кнопки «+ Добавить сайт» и корзины', !(await page.isVisible('#add-site-btn')) && (await page.$$('.btn-trash')).length === 0);
    await page.context().close(); }

  // ---------- адаптив ----------
  console.log('Адаптив');
  const widths = [320, 360, 375, 390, 414, 430, 540, 768, 820, 900, 1024, 1100, 1101, 1280, 1440, 1920], matrix = [];
  for (const w of widths) {
    const mobile = w <= 1100;   // до 1100px включительно навигация сворачивается в бургер
    const { page, errors } = await open({ viewport: { width: w, height: mobile ? 800 : 900 }, mobile: w < 820, seen: false });
    await until(async () => (await page.$$('.site-card')).length >= 2, 5000);
    await sleep(900);
    const rec = { w, views: {} };
    const modal = await page.evaluate(() => { const m = document.querySelector('#whatsnew-modal .modal'); const r = m.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, vis: document.getElementById('whatsnew-modal').classList.contains('visible') }; });
    T.check(`${w}px: окно «Что нового» целиком помещается на экран`, modal.vis && modal.l >= 0 && modal.r <= modal.vw + 1 && modal.t >= 0 && modal.b <= modal.vh + 1, JSON.stringify(modal));
    await page.click('#whatsnew-ok'); await sleep(250);
    for (const v of ['dashboard', 'media', 'team', 'logs', 'leads', 'digest', 'settings']) {
      if (mobile) { await page.click('#burger'); await sleep(350); }
      await page.click('#tab-' + v); await sleep(900);
      if (v === 'digest') { await page.click('#digest-build'); await sleep(900); }
      const m = await page.evaluate(() => {
        const d = document.documentElement, vw = innerWidth, wide = [];
        document.querySelectorAll('.view.active *').forEach(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width > 0 && r.right > vw + 1 && cs.position !== 'fixed' && !el.closest('.logs-wrap, .table-wrap, pre')) wide.push((el.className || el.tagName).toString().slice(0, 36)); });
        return { over: d.scrollWidth - vw, wide: wide.slice(0, 3) };
      });
      rec.views[v] = m;
      T.check(`${w}px · ${v}: нет горизонтальной прокрутки`, m.over <= 1 && !m.wide.length, `over=${m.over} ${m.wide.join(',')}`);
      if (v === 'dashboard' || v === 'digest') await page.screenshot({ path: path.join(SHOTS, `panel-${v}-${w}.png`), fullPage: false });
    }
    if (mobile) {
      await page.click('#burger'); await sleep(350);
      const tap = await page.$$eval('.topbar-tabs .tab-btn', els => els.filter(e => getComputedStyle(e).display !== 'none').map(e => Math.round(e.getBoundingClientRect().height)));
      T.check(`${w}px: пункты мобильного меню ≥ 44px высотой (удобно пальцем)`, tap.every(h => h >= 44), tap.join(','));
    }
    T.check(`${w}px: нет ошибок JS`, errors.length === 0, errors.join('; '));
    matrix.push(rec);
    await page.context().close();
  }
  { // экран входа на узких экранах
    const ctx = await b.newContext({ viewport: { width: 320, height: 640 }, isMobile: true }); const page = await ctx.newPage();
    await page.route(/supabase-js/, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8') }));
    await page.route(/fonts\./, r => r.abort()); await page.goto(URL); await sleep(900);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    T.check('320px: экран входа без горизонтальной прокрутки', over <= 1 && await page.isVisible('#login-form'), over);
    await ctx.close(); }

  await b.close(); srv.close(); srvRu.close();
  process.exit(T.finish({ matrix }) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
