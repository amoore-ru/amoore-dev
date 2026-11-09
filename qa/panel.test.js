/* QA: админка amoore-dev (вкладки, «Что нового», красный счётчик заявок, дайджест, публикация новостей, права, адаптив).
   Запуск: node qa/panel.test.js */
const path = require('path'), fs = require('fs');
const H = require('./harness'), S = require('./seed'), { suite, sleep, until } = require('./lib');
const DEV = path.resolve(__dirname, '..'), RU = path.resolve(__dirname, '../../amoore-ru');
const SHOTS = path.join(__dirname, 'results', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sessionInit = (id, role, seen) => `localStorage.setItem('amoore_dev_auth', JSON.stringify({admin_id:'${id}',email:'x@amoore.ru',nickname:'U',name:'U',role:'${role}',access_token:'tok',expires_at:Date.now()+3e6}));` + (seen ? `localStorage.setItem('amoore_dev_seen_version','4.0.0');` : '');

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
    T.check('порядок вкладок: Дашборд → Новости → Медиа → Дайджест → Настройки, затем Команда / Логи / Заявки', tabs.join('>') === 'Дашборд>Новости>Медиа>Дайджест>Настройки>Команда>Логи>Заявки', tabs.join('>'));
    T.check('чип версии показывает v4.0.0', (await page.textContent('#version-chip')) === 'v4.0.0');
    T.check('нет ошибок JS при входе', errors.length === 0, errors.join('; '));
    T.check('если версия уже просмотрена — окно «Что нового» не показывается', !(await page.$eval('#whatsnew-modal', e => e.classList.contains('visible'))));
    await page.click('#version-chip'); await sleep(500);
    T.check('клик по чипу версии открывает историю обновлений', await page.$eval('#whatsnew-modal', e => e.classList.contains('visible')) && /История обновлений/.test(await page.textContent('#whatsnew-title')));
    await page.click('#whatsnew-ok'); await page.context().close(); }
  { const { page } = await open({ seen: false });
    const shown = await until(async () => page.$eval('#whatsnew-modal', e => e.classList.contains('visible')), 3000);
    T.check('первый вход за версию: выскакивает окно «Что нового»', !!shown);
    T.check('заголовок «Обновление v4.0»', /Обновление v4\.0/.test(await page.textContent('#whatsnew-title')), await page.textContent('#whatsnew-title'));
    const li = await page.$$eval('#whatsnew-list li li', e => e.map(x => x.textContent));
    T.check('в списке изменения NEXUS: дизайн-система, тумблеры Safari, «Админы в сети», версии из БД', li.length >= 4 && li.some(t => /NEXUS/i.test(t)) && li.some(t => /Safari/i.test(t)) && li.some(t => /в сети/i.test(t)) && li.some(t => /Changelog/i.test(t)), li.length + ' пунктов');
    await page.click('#whatsnew-ok'); await sleep(300);
    T.check('после «Понятно» версия запоминается', (await page.evaluate(() => localStorage.getItem('amoore_dev_seen_version'))) === '4.0.0');
    await page.reload(); await sleep(1500);
    T.check('после перезагрузки окно больше не появляется', !(await page.$eval('#whatsnew-modal', e => e.classList.contains('visible'))));
    await page.context().close(); }
  { const core = fs.readFileSync(path.join(DEV, 'shared/amoore-core.js'), 'utf8'), app = fs.readFileSync(path.join(DEV, 'app.js'), 'utf8');
    const cv = (core.match(/var AMOORE_VERSION = '([\d.]+)'/) || [])[1], av = (app.match(/const AMOORE_VERSION = '([\d.]+)'/) || [])[1];
    const cl = JSON.parse(fs.readFileSync(path.join(DEV, 'changelog.json'), 'utf8'));
    T.check('синхронизация версий: core = app.js = changelog (4.0.0)', cv === '4.0.0' && av === '4.0.0' && cl.current === '4.0.0', `${cv}/${av}/${cl.current}`); }

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
    T.check('после анимации контент чёткий и на месте', +fin.o >= 0.99 && (fin.f === 'none' || parseFloat((fin.f.match(/[\d.]+/) || [0])[0]) < 0.6), JSON.stringify(fin));
    await page.click('#tab-logs'); await page.click('#tab-dashboard'); await sleep(900);
    T.check('быстрые переключения не оставляют два экрана одновременно', (await page.$$('.view.active')).length === 1 && (await page.$$('.view.leaving')).length === 0);
    await page.context().close(); }
  { const { page } = await open({ reducedMotion: 'reduce' });
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await page.click('#tab-media'); await sleep(120);
    T.check('prefers-reduced-motion: переключение мгновенное, без анимации', (await page.$eval('#view-media', e => getComputedStyle(e).animationName)) === 'none' && (await page.$$('.view.leaving')).length === 0);
    await page.context().close(); }


  // ---------- статус бота (хотфикс 4.0.0) ----------
  console.log('Статус бота');
  { const stat = async (page) => { await until(async () => !/загрузка/i.test(await page.textContent('#bot-status-line')), 4000); return page.textContent('#bot-status-line'); };
    const { page } = await open();
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    T.check('статус бота загружается сам при открытии дашборда (не висит на «Загрузка…») — «Онлайн»', /Онлайн/.test(await stat(page)));
    await page.evaluate(() => { window.__mock.calls.length = 0; });
    await page.click('#bot-toggle-btn'); await sleep(600);
    const upd = await page.evaluate(() => window.__mock.calls.filter(c => c.table === 'bot_status' && c.op === 'update').map(c => Object.keys(c.payload)));
    T.check('тумблер бота обновляет ТОЛЬКО колонку is_online (без updated_at/token/status)', upd.length === 1 && upd[0].join() === 'is_online', JSON.stringify(upd));
    T.check('в БД бот переведён в офлайн, статус на экране обновился сразу', (await page.evaluate(() => window.__db.bot_status[0].is_online)) === false && /Офлайн/.test(await page.textContent('#bot-status-line')));
    T.check('событие bot_toggle записано в журнал', await page.evaluate(() => window.__db.audit_logs.some(l => l.action === 'bot_toggle')));
    await page.click('#bot-toggle-btn'); await sleep(500);
    T.check('повторный клик включает бота обратно', (await page.evaluate(() => window.__db.bot_status[0].is_online)) === true && /Онлайн/.test(await page.textContent('#bot-status-line')));
    await page.context().close(); }
  { const s = S.seed(); s.bot_status = [];            // строки main ещё нет — должна создаться одной колонкой
    const { page } = await open({ seed: s }); await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await sleep(600); await page.click('#bot-toggle-btn'); await sleep(700);
    const row = await page.evaluate(() => window.__db.bot_status[0]);
    T.check('если строки bot_status нет — создаётся с одной колонкой is_online', !!row && row.id === 'main' && Object.keys(row).filter(k => !['id', 'created_at'].includes(k)).join() === 'is_online', JSON.stringify(row));
    await page.context().close(); }
  { const { page } = await open({ mockInit: "window.__mock={hang:[],fail:['bot_status'],calls:[],session:true,failMsg:'column \"updated_at\" of relation \"bot_status\" does not exist'};" });
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await sleep(600); await page.click('#bot-toggle-btn'); await sleep(500);
    const toast = await page.textContent('#toast');
    T.check('ошибка схемы БД показывается по-человечески: «Ошибка связи с сервером. Попробуйте позже»', /Ошибка связи с сервером\. Попробуйте позже/.test(toast), toast);
    T.check('в тексте нет упоминаний SQL, миграций и файлов', !/sql|миграц|\.sql|shared\//i.test(toast + (await page.textContent('#bot-status-line'))));
    await page.context().close(); }
  { const { page } = await open({ mockInit: "window.__mock={hang:['bot_status'],fail:[],calls:[],session:true};" });
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    const t0 = Date.now();
    const ok = await until(async () => !/загрузка/i.test(await page.textContent('#bot-status-line')), 5000, 100);
    const dt = Date.now() - t0;
    T.check('запрос завис: через 3 секунды статус «Офлайн», лоадер исчезает', !!ok && /Офлайн/.test(await page.textContent('#bot-status-line')) && dt >= 2500 && dt <= 4500, dt + ' мс');
    T.check('после таймаута кнопка бота доступна для повторной попытки', await page.$eval('#bot-toggle-btn', b => !b.disabled));
    await page.context().close(); }
  { const app = fs.readFileSync(path.join(DEV, 'app.js'), 'utf8'), html = fs.readFileSync(path.join(DEV, 'index.html'), 'utf8');
    T.check('в app.js и index.html нет упоминаний .sql и «SQL-миграция»', !/\.sql|sql-миграц|выполните sql|запустите sql/i.test(app + html), (app + html).match(/.{20}(\.sql|sql-миграц|запустите sql).{20}/i));
    T.check('app.js не пишет в bot_status лишние колонки (updated_at/token/status)', !/bot_status'\)\.(update|upsert|insert)\([^)]*(updated_at|token|status:)/.test(app)); }

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
    await dev.click('#tab-news'); await sleep(400);
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
    T.check('RBAC: модератор (только чтение + логи) видит Дашборд/Новости/Дайджест/Логи/Заявки, но не Медиа/Команду/Настройки', tabs.join(',') === 'Дашборд,Новости,Дайджест,Логи,Заявки', tabs.join(','));
    await page.click('#tab-news'); await sleep(500);
    T.check('новости у модератора: режим чтения (нет формы, нет правки и удаления)', !(await page.isVisible('#news-form')) && (await page.$$('.news-edit, .news-del')).length === 0 && (await page.$$('#news-admin-list .news-card')).length >= 1);
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
    for (const v of ['dashboard', 'news', 'media', 'team', 'logs', 'leads', 'digest', 'settings']) {
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


  // ---------- NEXUS v4.0 ----------
  console.log('NEXUS: тумблеры iPhone, новости по ролям, профили, роли, changelog');
  { // тумблеры на узком экране (Safari/iOS): размеры жёсткие, не растягиваются
    const { page } = await open({ viewport: { width: 375, height: 800 }, mobile: true });
    await until(async () => (await page.$$('.site-card .toggle')).length >= 3, 5000);
    const m = await page.$$eval('.site-card .toggle', els => els.map(e => { const c = getComputedStyle(e), k = e.querySelector('.toggle-knob'), kc = getComputedStyle(k), r = e.getBoundingClientRect(), kr = k.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), kw: Math.round(kr.width), kh: Math.round(kr.height), fs: c.flexShrink, bs: c.boxSizing, ov: c.overflow, mw: c.minWidth, inside: kr.left >= r.left && kr.right <= r.right && kr.top >= r.top && kr.bottom <= r.bottom }; }));
    T.check('тумблеры на iPhone-ширине: ровно 46×28, кружок 20×20 (не растягиваются)', m.length >= 3 && m.every(x => x.w === 46 && x.h === 28 && x.kw === 20 && x.kh === 20), JSON.stringify(m[0]));
    T.check('тумблеры: flex-shrink 0, border-box, overflow hidden, min-width 46, кружок внутри', m.every(x => x.fs === '0' && x.bs === 'border-box' && x.ov === 'hidden' && x.mw === '46px' && x.inside), JSON.stringify(m[0]));
    await page.context().close(); }
  { // super_admin: полный доступ к новостям
    const s = S.seed(); const { page } = await open({ seed: s });
    await until(async () => (await page.$$('.site-card')).length >= 2, 5000);
    await page.click('#tab-news'); await sleep(500);
    T.check('новости: форма, правка и удаление доступны основателю', await page.isVisible('#news-form') && (await page.$$('.news-edit')).length >= 3 && (await page.$$('.news-del')).length >= 3);
    T.check('новости: тип «Дайджест» доступен только super_admin', (await page.$$eval('#news-type option', o => o.map(x => x.value))).includes('digest'));
    await page.fill('#news-title', 'Дайджест недели'); await page.selectOption('#news-type', 'digest'); await page.fill('#news-body', 'Итоги недели: всё хорошо.'); await page.click('#news-submit-btn'); await sleep(700);
    T.check('дайджест публикуется с типом digest', await page.evaluate(() => window.__db.news.some(n => n.title === 'Дайджест недели' && n.type === 'digest' && n.is_published)));
    await page.click('.news-edit >> nth=0'); await sleep(300);
    await page.fill('#ne-title', 'Дайджест правка'); await page.click('#ne-published'); await page.click('#ne-save'); await sleep(700);
    T.check('основатель правит новость и снимает с публикации', await page.evaluate(() => window.__db.news.some(n => n.title === 'Дайджест правка' && n.is_published === false)));
    T.check('событие news_edit пишется в журнал', await page.evaluate(() => window.__db.audit_logs.some(l => l.action === 'news_edit')));
    await page.click('#tab-digest'); await page.click('#digest-build'); await sleep(900);
    await page.click('#digest-publish'); await sleep(700);
    T.check('кнопка «Опубликовать на сайте как Дайджест» создаёт новость type=digest', await page.evaluate(() => window.__db.news.filter(n => n.type === 'digest').length >= 2));
    await page.context().close(); }
  { // admin: добавляет, но не правит и не удаляет; дайджест недоступен
    const { page } = await open({ admin: { id: 'a3', email: 'adm@amoore.ru', name: 'Adm', nickname: 'Adm', role: 'admin', permissions: null }, init: sessionInit('a3', 'admin', true) });
    await until(async () => (await page.$$('.site-card')).length >= 2, 4000);
    await page.click('#tab-news'); await sleep(500);
    T.check('админ: может добавлять новости, но без правки/удаления и без типа «Дайджест»', await page.isVisible('#news-form') && (await page.$$('.news-edit, .news-del')).length === 0 && !(await page.$$eval('#news-type option', o => o.map(x => x.value))).includes('digest'));
    await page.context().close(); }
  { // команда: «в сети», профиль, роли
    const s = S.seed(); s.admins[1].last_seen_at = new Date(Date.now() - 2 * 60000).toISOString(); s.admins.push({ id: 'a9', email: 'old@amoore.ru', name: 'Old', nickname: 'Old', role: 'admin', permissions: null, created_at: new Date(Date.now() - 5 * 86400000).toISOString(), last_seen_at: new Date(Date.now() - 3 * 3600000).toISOString() });
    const { page } = await open({ seed: s });
    await until(async () => (await page.$$('.site-card')).length >= 2, 5000);
    await page.click('#tab-team'); await until(async () => (await page.$$('.team-card')).length >= 3, 4000);
    const line = await page.textContent('#team-online-line');
    T.check('«Админы в сети»: Boss и Mod (в сети), Old (офлайн)', /Boss \(в сети\)/.test(line) && /Mod \(в сети\)/.test(line) && /Old \(офлайн\)/.test(line), line);
    T.check('в карточках подписи ролей по умолчанию: Основатель / Модератор / Админ', (await page.$$eval('.team-card .widget-meta', e => e.map(x => x.textContent)).then(a => a.join('|'))).match(/Основатель.*Модератор.*Админ/) !== null);
    await page.click('.edit-admin[data-id="a2"]'); await sleep(300);
    await page.fill('#ea-name', 'Модер Новый'); await page.fill('#ea-nickname', 'ModNew'); await page.fill('#ea-email', 'modnew@amoore.ru'); await page.selectOption('#ea-role', 'admin'); await page.click('#ea-save'); await sleep(700);
    T.check('редактирование профиля: name, nickname, email, role сохраняются', await page.evaluate(() => window.__db.admins.some(a => a.id === 'a2' && a.name === 'Модер Новый' && a.nickname === 'ModNew' && a.email === 'modnew@amoore.ru' && a.role === 'admin')));
    await page.click('.edit-admin[data-id="a2"]'); await sleep(200); await page.fill('#ea-email', 'не-почта'); await page.click('#ea-save'); await sleep(300);
    T.check('невалидный email отклоняется', await page.evaluate(() => window.__db.admins.find(a => a.id === 'a2').email === 'modnew@amoore.ru')); await page.click('#ea-cancel');
    await page.click('#tab-settings'); await sleep(500);
    await page.fill('#rl-super_admin', 'Шеф'); await page.fill('#rl-moderator', 'Страж'); await page.click('#role-labels-save'); await sleep(700);
    const stored = await page.evaluate(() => (window.__db.global_settings || []).find(r => r.key === 'role_labels'));
    T.check('названия ролей сохраняются в global_settings.role_labels', !!stored && stored.value.super_admin === 'Шеф' && stored.value.moderator === 'Страж' && stored.value.admin === 'Админ', JSON.stringify(stored));
    await page.click('#tab-team'); await sleep(600);
    T.check('новые названия ролей («Шеф») применяются в команде', /Шеф/.test(await page.textContent('#team-list')));
    await page.click('#tab-settings'); await sleep(500);
    await page.click('#cl-add'); const card = '.cl-card >> nth=0';
    await page.fill('.cl-card:nth-child(1) .cl-version', '4.1.0'); await page.fill('.cl-card:nth-child(1) .cl-title', 'Тест'); await page.fill('.cl-card:nth-child(1) .cl-items', 'Первое\nВторое'); await page.click('#cl-save'); await sleep(800);
    const cl = await page.evaluate(() => (window.__db.global_settings || []).find(r => r.key === 'changelog'));
    T.check('редактор Changelog пишет в БД; текущая версия = первая запись', !!cl && cl.value.current === '4.1.0' && cl.value.versions[0].items.length === 2 && cl.value.versions.length >= 2, JSON.stringify(cl && cl.value.current));
    T.check('чип версии в админке обновился из БД', (await page.textContent('#version-chip')) === 'v4.1.0');
    await page.fill('.cl-card:nth-child(1) .cl-version', 'abc'); await page.click('#cl-save'); await sleep(300);
    T.check('неверный формат версии не сохраняется', (await page.evaluate(() => window.__db.global_settings.find(r => r.key === 'changelog').value.current)) === '4.1.0');
    await page.context().close(); }
  { // версия из БД на старте: «Что нового» + чип
    const s = S.seed(); s.global_settings = [{ key: 'changelog', value: { current: '5.0.0', versions: [{ version: '5.0.0', title: 'Из базы', items: ['Новое из БД'] }] } }, { key: 'role_labels', value: { super_admin: 'Босс', admin: 'Админ', moderator: 'Модератор' } }];
    const { page } = await open({ seed: s, seen: false });
    const ok = await until(async () => (await page.textContent('#version-chip')) === 'v5.0.0', 4000);
    const wn = await until(async () => /5\.0/.test(await page.textContent('#whatsnew-title')), 4000);
    T.check('админка берёт версию из БД, код — только фоллбэк (v4.0.0)', !!ok && !!wn, await page.textContent('#whatsnew-title'));
    T.check('названия ролей из БД применяются сразу после входа (список ролей в форме)', await until(async () => (await page.$$eval('#new-role option', o => o.map(x => x.textContent))).includes('Босс'), 3000));
    await page.context().close(); }

  await b.close(); srv.close(); srvRu.close();
  process.exit(T.finish({ matrix }) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
