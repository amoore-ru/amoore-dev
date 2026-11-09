/* QA: лендинг amoore-ru (новости, заявка, версия, курсор, меню, адаптив). Запуск: node qa/landing.test.js */
const path = require('path'), fs = require('fs');
const H = require('./harness'), S = require('./seed'), { suite, sleep, until } = require('./lib');
const ROOT = path.resolve(__dirname, '../../amoore-ru');
const SHOTS = path.join(__dirname, 'results', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const { chromium } = H.pwRequire();
  const T = suite('landing');
  const srv = await H.serve(ROOT, 8301), URL = 'http://localhost:8301/index.html';
  const b = await chromium.launch();
  const open = (seed, o = {}) => H.openPage(b, URL + (o.query || ''), seed || S.seed(), o);
  const items = (page) => page.$$eval('#news-list .news-item', els => els.map(e => ({ t: e.querySelector('b') && e.querySelector('b').textContent, s: e.querySelector('small') && e.querySelector('small').textContent, ph: e.hasAttribute('data-amoore-news-placeholder'), er: e.hasAttribute('data-amoore-news-error') })));

  // ---------- новости ----------
  console.log('Новости');
  { const { page, errors } = await open();
    await until(async () => (await items(page)).filter(i => i.t).length >= 3, 5000);
    const it = await items(page);
    T.check('опубликованные новости показаны (3 из 4, черновик скрыт)', it.filter(i => i.t).length === 3 && !it.some(i => /Черновик/.test(i.t || '')), JSON.stringify(it.map(i => i.t)));
    T.check('дата в формате ДД.ММ.ГГГГ (display_date → 02.11.2026)', it.some(i => /02\.11\.2026/.test(i.s || '')), it.map(i => i.s).join(' | '));
    T.check('тип новости подписан («Новость/Патч/Скоро»)', it.some(i => /Патч/.test(i.s)) && it.some(i => /Скоро/.test(i.s)));
    T.check('нет ошибок JS на странице', errors.length === 0, errors.join('; '));
    // realtime: новая новость без перезагрузки
    await page.evaluate(() => { window.__db.news.unshift({ id: 'nx', title: 'Свежая из админки', body: 'тест', type: 'news', display_date: '2026-11-06', is_published: true, published_at: new Date().toISOString() }); window.__emit('news', { eventType: 'INSERT' }); });
    const live = await until(async () => (await items(page)).some(i => /Свежая из админки/.test(i.t || '')), 3000);
    T.check('новость из админки появляется без перезагрузки (Realtime)', live);
    // XSS
    await page.evaluate(() => { window.__db.news.unshift({ id: 'xs', title: '<img src=x onerror="window.__xss=1">', body: '<script>window.__xss=1</script>', type: 'news', is_published: true, published_at: new Date().toISOString() }); window.__emit('news', {}); });
    await sleep(700);
    T.check('XSS в заголовке/тексте новости экранируется (textContent)', !(await page.evaluate(() => window.__xss)) && (await page.$$('#news-list img')).length === 0);
    await page.context().close(); }

  { // КЛЮЧЕВОЙ СЦЕНАРИЙ БАГА: supabase-js «зависает» на всех запросах — новости обязаны прийти по REST
    const { page } = await open(S.seed(), { init: 'window.__mockHangAll=1;', mockInit: "window.__mock={hang:['ecosystem_sites','bot_status','news'],fail:[],calls:[]};" });
    const t0 = Date.now();
    const ok = await until(async () => (await items(page)).filter(i => i.t).length >= 3, 6000);
    T.check('зависший supabase-js (config/bot/news) НЕ блокирует новости — REST-канал выдаёт их', ok, `за ${Date.now() - t0} мс`);
    T.check('новости появились быстрее 4 с при зависшем клиенте', ok && Date.now() - t0 < 4000, `${Date.now() - t0} мс`);
    await page.context().close(); }

  { // оба канала упали → ошибка с кнопкой «Повторить», затем восстановление
    const { page } = await open(S.seed(), { mockInit: "window.__mock={hang:[],fail:['news'],calls:[],rest:'fail'};" });
    const err = await until(async () => (await items(page)).some(i => i.er), 6000);
    T.check('при отказе обоих каналов показана понятная ошибка', !!err);
    T.check('в ошибке есть кнопка «Повторить»', !!(await page.$('.news-retry')));
    await page.evaluate(() => { window.__mock.fail = []; window.__mock.rest = 'ok'; });
    await page.click('.news-retry');
    T.check('«Повторить» загружает новости после восстановления сети', !!(await until(async () => (await items(page)).filter(i => i.t).length >= 3, 5000)));
    await page.context().close(); }

  { // кэш: второй заход при мёртвой сети рисует прошлые новости сразу
    const { page, ctx } = await open();
    await until(async () => (await items(page)).filter(i => i.t).length >= 3, 5000);
    const page2 = await ctx.newPage();
    await H.openPage; // (тот же контекст = тот же localStorage)
    await page2.route(/cdn\.jsdelivr\.net\/npm\/@supabase/, r => r.fulfill({ contentType: 'text/javascript', body: 'window.supabase=undefined;' }));
    await page2.route(/\.supabase\.co\//, r => r.abort());
    await page2.goto(URL, { waitUntil: 'domcontentloaded' });
    const cached = await until(async () => (await items(page2)).filter(i => i.t).length >= 3, 3000);
    T.check('офлайн/сбой сети: новости показываются из локального кэша', !!cached);
    await ctx.close(); }

  { const s = S.seed(); s.ecosystem_sites[0].news_active = false;
    const { page } = await open(s);
    const ok = await until(async () => (await items(page)).some(i => i.ph && /Редакция готовит/.test(i.t || '') || i.ph), 4000);
    const hidden = await page.$eval('a[href="#news"]', a => getComputedStyle(a).display).catch(() => '');
    T.check('тумблер «Новости» выключен → заглушка и скрытая ссылка в меню', !!ok && hidden === 'none', hidden);
    await page.context().close(); }

  // ---------- баннер / чат / статус ----------
  console.log('Баннер, чат, статус сайта');
  { const s = S.seed(); Object.assign(s.ecosystem_sites[0], { banner_active: true, banner_text: 'Сайт на <b>профилактике</b>', demo_chat_active: false });
    const { page } = await open(s);
    const ban = await until(async () => page.$('#amoore-banner'), 4000);
    T.check('золотой баннер показан и экранирован', !!ban && (await page.$eval('#amoore-banner', e => e.textContent)).includes('<b>'));
    T.check('баннер вставлен под шапкой', await page.$eval('#amoore-banner', e => e.previousElementSibling && e.previousElementSibling.tagName) === 'HEADER');
    const chatDisabled = await page.$eval('#chat-input', e => e.disabled).catch(() => null);
    T.check('демо-чат заблокирован (disabled) при demo_chat_active=false', chatDisabled === true);
    await page.context().close(); }
  { const s = S.seed(); s.ecosystem_sites[0].status = 'closed';
    const { page } = await open(s, { init: "localStorage.clear();" });
    const lock = await until(async () => page.$('.amoore-lock-screen'), 4000);
    T.check('закрытый сайт показывает заставку обслуживания', !!lock);
    await page.context().close(); }
  { const s = S.seed(); s.ecosystem_sites[0].status = 'closed';
    const { page } = await open(s, { query: '?god=TESTTOKEN' });
    const bar = await until(async () => page.$('#amoore-god-bar'), 4000);
    T.check('God Mode (?god=ТОКЕН) пропускает админа и показывает золотую плашку', !!bar && !(await page.$('.amoore-lock-screen')));
    T.check('токен убран из адресной строки', !(await page.url()).includes('god='));
    await page.context().close(); }

  // ---------- версия ----------
  console.log('Версия и история обновлений');
  { const { page } = await open();
    await sleep(800);
    const info = await page.evaluate(() => ({ v: window.AMOORE_VERSION, api: window.amooreCore && window.amooreCore.version, st: window.AMOORE_STATE && window.AMOORE_STATE.version, ftr: document.querySelector('.version-btn [data-amoore-version]').textContent }));
    T.check('AMOORE_VERSION = 4.0.0 (core, state, API)', info.v === '4.0.0' && info.api === '4.0.0' && info.st === '4.0.0', JSON.stringify(info));
    T.check('в подвале показана «Версия 4.0.0»', info.ftr === '4.0.0');
    await page.click('#version-btn');
    await until(async () => (await page.$$('#nx-changelog.open .nx-cl-entry')).length >= 3, 3000);
    const n = (await page.$$('#nx-changelog .nx-cl-entry')).length;
    T.check('модалка истории обновлений (ядро) загружает changelog.json, если БД пуста', n >= 3, n + ' версий');
    const first = await page.$eval('#nx-changelog .nx-cl-entry h3', e => e.textContent);
    T.check('первая запись — v4.0.0', /v4\.0\.0/.test(first), first);
    await page.keyboard.press('Escape'); await sleep(350);
    T.check('Esc закрывает модалку', !(await page.$eval('#nx-changelog', e => e.classList.contains('open'))));
    const cl = JSON.parse(fs.readFileSync(path.join(ROOT, 'changelog.json'), 'utf8'));
    T.check('changelog.json: current совпадает с версией core', cl.current === info.v && cl.versions[0].version === info.v);
    await page.context().close(); }

  // ---------- NEXUS v4.0: чип версии, версия из БД, 🔒-вход, Quick Admin, дайджесты ----------
  console.log('NEXUS: чип версии, вход, дайджесты');
  { const { page } = await open();
    const chip = await until(async () => page.$('#nx-version-chip'), 4000);
    T.check('чип версии v4.0.0 стоит рядом с логотипом', !!chip && (await page.textContent('#nx-version-chip')) === 'v4.0.0' && await page.$eval('#nx-version-chip', c => c.previousElementSibling && c.previousElementSibling.classList.contains('brand')));
    await page.click('#nx-version-chip');
    const opened = await until(async () => (await page.$$('#nx-changelog.open .nx-cl-entry')).length >= 3, 3000);
    T.check('клик по чипу открывает историю обновлений', !!opened);
    await page.context().close(); }
  { const s = S.seed(); s.global_settings = [{ key: 'changelog', value: { current: '4.1.0', versions: [{ version: '4.1.0', title: 'Из базы', date: '2026-11-09', items: ['Версия пришла из БД'] }, { version: '4.0.0', title: 'NEXUS', items: ['x'] }] } }];
    const { page } = await open(s);
    const ok = await until(async () => (await page.textContent('#nx-version-chip')) === 'v4.1.0', 4000);
    T.check('версия в чипе тянется из БД (global_settings.changelog), а не из кода', !!ok && (await page.evaluate(() => window.AMOORE_VERSION)) === '4.1.0');
    T.check('подвал лендинга показывает ту же версию из БД', (await page.textContent('.version-btn [data-amoore-version]')) === '4.1.0');
    await page.click('#version-btn');
    await until(async () => (await page.$$('#nx-changelog.open .nx-cl-entry')).length === 2, 3000);
    T.check('модалка показывает историю из БД (2 версии, первая 4.1.0)', /4\.1\.0/.test(await page.$eval('#nx-changelog .nx-cl-entry h3', e => e.textContent)));
    await page.context().close(); }
  { const s = S.seed(); Object.assign(s.ecosystem_sites[0], { status: 'closed', overlay_type: 'private' });
    const { page } = await open(s);
    const lockBtn = await until(async () => page.$('.nx-lock-btn'), 4000);
    T.check('закрытый сайт (private): в футере кнопка 🔒', !!lockBtn);
    await page.click('.nx-lock-btn');
    T.check('🔒 открывает модалку входа: Email, Пароль, Токен', await until(async () => page.$('#nx-login.open input[name=email]'), 2000) && !!(await page.$('#nx-login input[name=password]')) && !!(await page.$('#nx-login input[name=token]')));
    await page.fill('#nx-login input[name=email]', 'boss@amoore.ru'); await page.fill('#nx-login input[name=password]', 'pw'); await page.fill('#nx-login input[name=token]', 'TOK');
    await page.click('#nx-login .nx-login-submit');
    const bar = await until(async () => page.$('#amoore-god-bar'), 6000);
    T.check('после входа: перезагрузка, заставка снята, появилось плавающее меню', !!bar && !(await page.$('.amoore-lock-screen')));
    const sess = await page.evaluate(() => JSON.parse(localStorage.getItem('amoore_dev_auth') || 'null'));
    T.check('сессия в localStorage на 6 часов (токен + роль)', !!sess && sess.access_token === 'TOK' && sess.role === 'super_admin' && Math.abs(sess.expires_at - Date.now() - 6 * 3600 * 1000) < 120000, JSON.stringify(sess));
    await page.click('.nx-qa-fab');
    const labels = await page.$$eval('.nx-qa-actions .nx-qa-btn', e => e.map(x => x.textContent.trim()));
    T.check('меню: «Открыть Админку», «Редактировать», «Выйти»', ['Открыть Админку', 'Редактировать', 'Выйти'].every(x => labels.includes(x)), labels.join('|'));
    await until(async () => /Tester/.test(await page.textContent('[data-qa-list]')), 3000);
    const online = await page.textContent('[data-qa-list]');
    T.check('«Админы в сети»: Boss (в сети), Tester (офлайн)', /Boss \(в сети\)/.test(online) && /Tester \(офлайн\)/.test(online), online);
    T.check('роль в меню — подпись «Основатель»', /Основатель/.test(await page.textContent('.nx-qa-role')));
    await page.click('.nx-qa-btn[data-act=logout]');
    const locked = await until(async () => page.$('.amoore-lock-screen'), 5000);
    T.check('«Выйти» стирает сессию и возвращает заставку', !!locked && !(await page.evaluate(() => localStorage.getItem('amoore_dev_auth'))));
    await page.context().close(); }
  { const s = S.seed(); Object.assign(s.ecosystem_sites[0], { status: 'closed', overlay_type: 'private' });
    const { page } = await open(s);
    await until(async () => page.$('.nx-lock-btn'), 4000);
    await page.click('.nx-lock-btn'); await page.fill('#nx-login input[name=email]', 'a@b.ru'); await page.click('#nx-login .nx-login-submit');
    T.check('пустые пароль и токен не пропускаются (понятная ошибка)', await until(async () => /Заполните/.test(await page.textContent('#nx-login .nx-login-error')), 2000));
    await page.context().close(); }
  { const s = S.seed();
    s.news.push({ id: 'dg1', title: 'Дайджест недели', body: 'Итоги: 3 новости, 2 заявки', type: 'digest', display_date: '2026-11-08', is_published: true, published_at: new Date().toISOString() });
    const { page } = await open(s);
    await until(async () => (await items(page)).filter(i => i.t).length >= 4, 5000);
    const names = await page.$$eval('#news-tabs .tab', e => e.map(x => x.firstChild.textContent.trim()));
    T.check('вкладки новостей: Все | Дайджесты | Обновления | Патчи | Планы', names.join('|') === 'Все|Дайджесты|Обновления|Патчи|Планы', names.join('|'));
    const wide = await page.$eval('.news-item-digest', e => { const o = document.querySelector('.news-item:not(.news-item-digest)'); return { w: e.getBoundingClientRect().width, other: o.getBoundingClientRect().width, label: e.querySelector('small').textContent }; });
    T.check('карточка дайджеста шире обычных и подписана «Дайджест»', wide.w > wide.other + 100 && /Дайджест/.test(wide.label), JSON.stringify(wide));
    await page.click('#news-tabs [data-filter="digest"]'); await sleep(450);
    T.check('вкладка «Дайджесты» показывает только дайджесты', (await page.$$eval('#news-list .news-item[data-type]:not([hidden])', e => e.map(x => x.getAttribute('data-type')))).join() === 'digest');
    await page.context().close(); }

  // ---------- заявка ----------
  console.log('Форма «Оставить заявку»');
  { const { page } = await open();
    const inStart = await page.$eval('#start #lead-form', e => !!e).catch(() => false);
    T.check('форма находится в блоке #start', inStart);
    T.check('отдельной секции #lead (старой) больше нет', (await page.$$('section#lead')).length === 0);
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('visible')));
    const css = await page.$eval('#lead-name', e => { const c = getComputedStyle(e); return { fs: parseFloat(c.fontSize), w: e.getBoundingClientRect().width, br: c.borderTopWidth }; });
    T.check('поля формы стилизованы (шрифт ≥16px — без зума на iPhone, ширина > 200px)', css.fs >= 16 && css.w > 200, JSON.stringify(css));
    T.check('подписи полей видимы и не «сломаны» (label не sr-only)', await page.$eval('label[for="lead-name"]', e => e.getBoundingClientRect().width > 20));
    await page.click('#lead-submit');
    T.check('пустая форма: понятная ошибка, ничего не отправлено', /имя/i.test(await page.textContent('#lead-status')) && (await page.evaluate(() => window.__db.leads.length)) === 3);
    await page.fill('#lead-name', 'Тест'); await page.fill('#lead-contact', 'abc'); await page.click('#lead-submit');
    T.check('некорректный контакт отклоняется', /Telegram|телефон|email/i.test(await page.textContent('#lead-status')));
    await page.fill('#lead-contact', '@test_user'); await page.fill('#lead-message', 'Хочу бота <b>в чат</b>'); await page.click('#lead-submit');
    await until(async () => (await page.evaluate(() => window.__db.leads.length)) === 4, 3000);
    const lead = await page.evaluate(() => window.__db.leads[0]);
    T.check('заявка записана в таблицу leads (status=new)', lead && lead.name === 'Тест' && lead.contact === '@test_user' && lead.status === 'new', JSON.stringify(lead));
    T.check('пользователь видит подтверждение', /Спасибо/.test(await page.textContent('#lead-status')));
    T.check('форма очищена после успеха', (await page.inputValue('#lead-name')) === '');
    await page.fill('#lead-name', 'Тест2'); await page.fill('#lead-contact', '@second_user'); await page.click('#lead-submit');
    await sleep(300);
    T.check('повторная отправка в течение 30 с блокируется (антиспам)', (await page.evaluate(() => window.__db.leads.length)) === 4 && /Подождите|уже отправлена/i.test(await page.textContent('#lead-status')));
    await page.evaluate(() => localStorage.removeItem('amoore_lead_ts'));
    await page.fill('#lead-hp', 'spam'); await page.click('#lead-submit'); await sleep(300);
    T.check('honeypot: бот не создаёт заявку', (await page.evaluate(() => window.__db.leads.length)) === 4);
    await page.fill('#lead-hp', '');
    await page.evaluate(() => { window.__mock.fail = ['leads']; window.__mock.rest = 'fail'; });
    await page.fill('#lead-name', 'Ошибка'); await page.fill('#lead-contact', '@error_user'); await page.click('#lead-submit');
    await until(async () => /Telegram/.test(await page.textContent('#lead-status')), 3000);
    T.check('при отказе БД показана запасная ссылка на Telegram (@asoave_bot)', /@asoave_bot/.test(await page.textContent('#lead-status')) && (await page.$eval('#lead-submit', e => !e.disabled)));
    await page.context().close(); }
  { // REST-запасной канал заявок (supabase-js недоступен)
    const { page } = await open(S.seed(), { mockInit: "window.__mock={hang:[],fail:['leads'],calls:[],rest:'ok'};" });
    await page.fill('#lead-name', 'Rest'); await page.fill('#lead-contact', '@rest_user'); await page.click('#lead-submit');
    await until(async () => /Спасибо/.test(await page.textContent('#lead-status')), 4000);
    T.check('заявка уходит через REST-канал, если клиент supabase-js вернул ошибку', /Спасибо/.test(await page.textContent('#lead-status')));
    await page.context().close(); }

  // ---------- курсор убран ----------
  console.log('Курсор и меню');
  { const { page } = await open();
    await page.mouse.move(300, 300); await page.mouse.move(420, 360); await sleep(300);
    T.check('кастомного курсора нет (ни элемента, ни класса на <html>)', !(await page.$('#amoore-cursor')) && !(await page.evaluate(() => document.documentElement.className.includes('amoore-cursor'))));
    T.check('системный курсор мыши на месте (cursor ≠ none на странице и на кнопке)', await page.evaluate(() => getComputedStyle(document.body).cursor !== 'none' && getComputedStyle(document.querySelector('.btn')).cursor !== 'none'));
    const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), js = fs.readFileSync(path.join(ROOT, 'landing.js'), 'utf8');
    T.check('в style.css и landing.js нет кода курсора', !/amoore-cursor|has-amoore-cursor/.test(css + js)); 
    await page.context().close(); }
  { const { page } = await open(S.seed(), { mobile: true, viewport: { width: 390, height: 844 } });
    await sleep(600);
    await page.click('#menu-toggle'); await sleep(450);
    const st = await page.evaluate(() => ({ open: document.getElementById('mobile-nav').classList.contains('open'), ov: document.body.style.overflow, ar: document.getElementById('menu-toggle').getAttribute('aria-expanded'), links: document.querySelectorAll('#mobile-nav a').length }));
    T.check('бургер открывает меню, scroll-lock включён, aria-expanded=true', st.open && st.ov === 'hidden' && st.ar === 'true' && st.links >= 7, JSON.stringify(st));
    await page.keyboard.press('Escape'); await sleep(300);
    T.check('Esc закрывает меню и снимает scroll-lock', !(await page.$eval('#mobile-nav', e => e.classList.contains('open'))) && (await page.evaluate(() => document.body.style.overflow)) === '');
    await page.click('#menu-toggle'); await sleep(400); await page.click('#mobile-nav a[href="#news"]'); await sleep(900);
    T.check('тап по пункту меню закрывает его и прокручивает к разделу', !(await page.$eval('#mobile-nav', e => e.classList.contains('open'))) && (await page.evaluate(() => scrollY)) > 500);
    await page.context().close(); }


  // ---------- вкладки новостей (хотфикс 4.0.0) ----------
  console.log('Вкладки новостей и золото');
  { const s = S.seed();
    s.news.push({ id: 'p2', title: 'Патч новее', body: 'свежий патч', type: 'patch', display_date: '2026-11-04', is_published: true, published_at: new Date(Date.now() - 6 * 86400000).toISOString() });
    s.news.push({ id: 'u2', title: 'Обновление старое', body: 'старое', type: 'news', display_date: '2026-10-01', is_published: true, published_at: new Date(Date.now() - 30 * 86400000).toISOString() });
    const { page } = await open(s);
    await until(async () => (await items(page)).filter(i => i.t).length >= 5, 5000);
    const vis = async () => page.$$eval('#news-list .news-item[data-type]', els => els.filter(e => !e.hidden && getComputedStyle(e).display !== 'none').map(e => e.querySelector('b').textContent));
    const names = await page.$$eval('#news-tabs .tab', e => e.map(x => x.firstChild.textContent.trim()));
    T.check('над списком 5 вкладок: Все / Дайджесты / Обновления / Патчи / Планы', names.join('|') === 'Все|Дайджесты|Обновления|Патчи|Планы', names.join('|'));
    const cnt = await page.$$eval('#news-tabs .news-count', e => e.map(x => x.textContent));
    T.check('на вкладках счётчики (Все 5 · Дайджесты 0 · Обновления 2 · Патчи 2 · Планы 1)', cnt.join() === '5,0,2,2,1', cnt.join());
    const all = await vis();
    T.check('«Все»: показано всё, самое свежее сверху (по дате новости)', all.length === 5 && all[0] === 'Голосовые, память и карма' && all[all.length - 1] === 'Обновление старое', all.join(' > '));
    await page.click('#news-tabs [data-filter="patch"]'); await sleep(450);
    const pt = await vis();
    T.check('«Патчи»: остаются только патчи, свежий патч выше старого', pt.join('|') === 'Патч новее|Обновление', pt.join('|'));
    T.check('активная вкладка выделена (aria-selected, класс)', await page.$eval('#news-tabs [data-filter="patch"]', b => b.getAttribute('aria-selected') === 'true' && b.classList.contains('is-active')) && (await page.$$eval('#news-tabs [aria-selected="true"]', e => e.length)) === 1);
    await page.click('#news-tabs [data-filter="news"]'); await sleep(450);
    const up = await vis();
    T.check('«Обновления»: только type=news, свежее сверху', up.join('|') === 'amoore Studio — обновилось|Обновление старое', up.join('|'));
    await page.click('#news-tabs [data-filter="soon"]'); await sleep(450);
    T.check('«Планы»: только type=soon', (await vis()).join('|') === 'Голосовые, память и карма');
    await page.evaluate(() => { window.__db.news.unshift({ id: 'nx', title: 'Свежий план', body: 'x', type: 'soon', display_date: '2026-11-07', is_published: true, published_at: new Date().toISOString() }); window.__emit('news', {}); });
    await until(async () => (await vis())[0] === 'Свежий план', 3000);
    T.check('новая новость по Realtime подчиняется активному фильтру и встаёт наверх', (await vis()).join('|') === 'Свежий план|Голосовые, память и карма', (await vis()).join('|'));
    await page.focus('#news-tabs [data-filter="soon"]'); await page.keyboard.press('ArrowRight'); await sleep(450);
    T.check('стрелки ← → переключают вкладки (доступность)', await page.$eval('#news-tabs [data-filter="all"]', b => b.getAttribute('aria-selected') === 'true'));
    await page.evaluate(() => { window.__db.news = window.__db.news.filter(n => n.type !== 'patch'); window.__emit('news', {}); });
    await until(async () => (await page.$$eval('#news-tabs .news-count', e => e[3].textContent)) === '0', 3000);
    await page.click('#news-tabs [data-filter="patch"]'); await sleep(450);
    T.check('пустая категория: аккуратное сообщение вместо пустоты', /В этой категории пока ничего нет/.test(await page.textContent('#news-list')));
    await page.click('#news-tabs [data-filter="all"]'); await sleep(450);
    T.check('возврат на «Все» убирает сообщение и возвращает карточки', !(await page.$('.news-empty')) && (await vis()).length >= 3);
    await page.context().close(); }
  { const { page } = await open(S.seed(), { reducedMotion: 'reduce' });
    await until(async () => (await items(page)).filter(i => i.t).length >= 3, 5000);
    await page.click('#news-tabs [data-filter="patch"]'); await sleep(60);
    T.check('prefers-reduced-motion: фильтр срабатывает мгновенно', (await page.$$eval('#news-list .news-item[data-type]:not([hidden])', e => e.length)) === 1);
    await page.context().close(); }
  { const { page } = await open(S.seed(), { mockInit: "window.__mock={hang:[],fail:['news'],calls:[],rest:'fail'};" });
    await until(async () => (await items(page)).some(i => i.er), 6000);
    T.check('пока новостей нет (ошибка/скелетон) — вкладки скрыты', await page.$eval('#news-tabs', e => e.hidden || getComputedStyle(e).display === 'none'));
    await page.context().close(); }
  { // золото: нет залитых золотых кнопок/карточек, есть тонкие контуры
    const { page } = await open(); await sleep(1200);
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('visible'))); await sleep(900);
    const res = await page.evaluate(() => {
      const gold = (c) => { const m = c.match(/[\d.]+/g); if (!m) return false; const [r, g, b, a] = m.map(Number); const alpha = a === undefined ? 1 : a; return alpha > 0.5 && r > 150 && g > 120 && b < 120 && r - b > 70; };
      const bad = []; document.querySelectorAll('button, .btn, a.btn, .glass-card, .news-item, .eco-card, .feat-card, .cmd-card, .steps li, .tab, .chip, .lead-form, .qr-box').forEach(el => { const cs = getComputedStyle(el); if (gold(cs.backgroundColor) || /(rgba?\([^)]*\))[^,]*gold/.test(cs.backgroundImage) ) bad.push((el.className || el.tagName).toString().slice(0, 30)); });
      const card = document.querySelector('.news-item'), b = card ? getComputedStyle(card) : null;
      return { bad: bad.slice(0, 5), border: b && b.borderTopColor, bw: b && b.borderTopWidth };
    });
    T.check('нет золотых заливок у кнопок, вкладок, чипов и карточек', res.bad.length === 0, res.bad.join(','));
    const m = (res.border || '').match(/[\d.]+/g) || [];
    T.check('карточки: тонкая (1px) золотая обводка с прозрачностью ≤ 0.3', res.bw === '1px' && (m[3] === undefined ? false : +m[3] <= 0.3), JSON.stringify(res));
    const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
    T.check('золотого свечения (glow) у карточек в hover больше нет', !/0 22px 56px rgba\(var\(--gold-rgb\), 0\.16\)/.test(css));
    await page.context().close(); }

  // ---------- safe-area (статическая проверка: Chromium не эмулирует env()) ----------
  { const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    T.check('viewport-fit=cover включён', /viewport-fit=cover/.test(html));
    T.check('safe-area-inset-* применён к шапке, меню, нижней панели, подвалу и модалке', ['.topbar', '.mobile-nav', '.mobile-cta', 'footer', '.modal-overlay'].every(sel => new RegExp(sel.replace('.', '\\.') + '[^{]*\\{[^}]*safe-area-inset', 's').test(css)));
    T.check('кэш: CSS/JS подключены с версией ?v=4.0.0', /style\.css\?v=4\.0\.0/.test(html) && /amoore-core\.js\?v=4\.0\.0/.test(html) && /landing\.js\?v=4\.0\.0/.test(html));
    const hdr = fs.readFileSync(path.join(ROOT, '_headers'), 'utf8');
    T.check('_headers: CSS больше не «immutable на год»', !/\/\*\.css\s*\n\s*Cache-Control:[^\n]*immutable/.test(hdr)); }

  // ---------- матрица адаптива ----------
  console.log('Адаптив');
  const widths = [320, 360, 375, 390, 414, 430, 540, 768, 820, 1024, 1280, 1440, 1920];
  const matrix = [];
  for (const w of widths) {
    const mobile = w < 820;
    const { page, errors } = await open(S.seed(), { viewport: { width: w, height: mobile ? 800 : 900 }, mobile });
    await until(async () => (await items(page)).filter(i => i.t).length >= 3, 5000);
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('visible')));
    await sleep(1100);   // дожидаемся конца анимации появления (0.75 с + задержки)
    const m = await page.evaluate(() => {
      const d = document.documentElement, vw = innerWidth; const wide = [];
      document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('.news-tabs, .mobile-nav, .hero-ornaments, .ambient, .page-loader')) wide.push((el.className || el.tagName).toString().slice(0, 40)); });
      const small = []; document.querySelectorAll('a.btn, button, input, textarea').forEach(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width && cs.visibility !== 'hidden' && cs.display !== 'none' && r.height < 32 && !el.closest('.mobile-nav, .chat-chips, .tab, [hidden]') && !el.classList.contains('chip')) small.push((el.id || el.className || el.tagName).toString().slice(0, 30) + ':' + Math.round(r.height)); });
      return { sw: d.scrollWidth, vw, over: d.scrollWidth - vw, wide: wide.slice(0, 4), small: small.slice(0, 4) };
    });
    await page.screenshot({ path: path.join(SHOTS, `landing-${w}.png`), fullPage: true });
    matrix.push({ w, ...m });
    T.check(`${w}px: нет горизонтальной прокрутки`, m.over <= 1 && !m.wide.length, `scrollWidth=${m.sw}, лишние: ${m.wide.join(',')}`);
    if (mobile) T.check(`${w}px: интерактивные элементы не мельче 32px`, !m.small.length, m.small.join(', '));
    T.check(`${w}px: нет ошибок JS`, errors.length === 0, errors.join('; '));
    await page.context().close();
  }

  await b.close(); srv.close();
  process.exit(T.finish({ matrix }) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
