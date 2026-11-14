/* QA v5.1 «MASTER» (браузер): лендинг как Web App (вкладки, хэш), бизнес-ассистент, Rewards, публичные профили, админка (теги, CSV, фильтр журнала).
   Запуск: node qa/v51.test.js */
const path = require('path'), fs = require('fs');
const H = require('./harness'), S = require('./seed'), { suite, sleep, until } = require('./lib');
const RU = path.resolve(__dirname, '../../amoore-ru'), DEV = path.resolve(__dirname, '..');

const profiles = () => [
  { id: 'a1', username: 'tester', avatar_url: 'https://example.com/a.png', role: 'user', telegram_id: 777, is_banned: false, onboarded: true, rewards_balance: 30, bio: 'Люблю сайты <b>и</b> ботов', is_public: true },
  { id: 'p2', username: 'hidden_one', avatar_url: 'https://example.com/b.png', role: 'user', is_banned: false, onboarded: true, bio: 'секрет', is_public: false },
];
const withProfile = () => { const s = S.seed(); s.profiles = profiles(); s.business_automations = []; s.rewards_log = [{ id: 'r1', user_id: 'a1', delta: 10, reason: 'referral', created_at: new Date().toISOString() }];
  s.user_sites = [{ id: 'x1', user_id: 'a1', title: 'Мой лендинг', url: 'https://tester.example/', is_public: true, created_at: new Date().toISOString() }, { id: 'x2', user_id: 'a1', title: 'Черновик', url: 'https://draft.example/', is_public: false, created_at: new Date().toISOString() }]; s.user_sessions = []; return s; };

(async () => {
  const { chromium } = H.pwRequire();
  const T = suite('v51');
  const srv = await H.serve(RU, 8351), URL = 'http://localhost:8351/index.html';
  const b = await chromium.launch();
  const open = (seed, o = {}) => H.openPage(b, URL + (o.query || ''), seed, o);
  const closeCtx = async (page) => { await sleep(250); await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {}); await page.context().close().catch(() => {}); };
  const active = (page) => page.$$eval('.spa-view.is-active', e => e.map(x => x.dataset.view));

  console.log('Лендинг как Web App: вкладки');
  { const { page, errors } = await open(withProfile());
    await sleep(500);
    T.check('на старте активна ровно одна вкладка — Главная', (await active(page)).join() === 'home');
    T.check('в шапке 5 вкладок: Главная | Новости | Чат | Экосистема | Профиль', (await page.$$eval('.ux-nav a[data-spa-tab]', a => a.map(x => x.textContent.trim()))).join('|') === 'Главная|Новости|Чат|Экосистема|Профиль');
    await page.evaluate(() => { window.__marker = 'same-page'; });
    for (const [tab, sel] of [['news', '#news-list'], ['chat', '#chat-input'], ['ecosystem', '#ecosystem'], ['profile', '#profile'], ['home', '.hero']]) {
      await page.click(`.ux-nav a[data-spa-tab="${tab}"]`); await sleep(250);
      const on = await active(page), hash = await page.evaluate(() => location.hash), vis = await page.$eval(sel, e => e.getBoundingClientRect().height > 0).catch(() => false);
      T.check(`вкладка «${tab}»: активна одна, hash=#${tab}, содержимое видно`, on.join() === tab && hash === '#' + tab && vis, `${on} ${hash} ${vis}`);
    }
    T.check('страница не перезагружалась при переключении (маркер window жив)', (await page.evaluate(() => window.__marker)) === 'same-page');
    T.check('неактивные вкладки скрыты через display:none', await page.$$eval('.spa-view:not(.is-active)', v => v.every(x => getComputedStyle(x).display === 'none')));
    T.check('у активной вкладки aria-current="page"', await page.$eval('.ux-nav a[data-spa-tab="home"]', a => a.getAttribute('aria-current') === 'page'));
    await page.click('.ux-nav a[data-spa-tab="chat"]'); await sleep(200);
    await page.goBack(); await sleep(250);
    T.check('кнопка «Назад» возвращает на прошлую вкладку', (await active(page)).join() === 'home' && (await page.evaluate(() => location.hash)) === '#home');
    await page.evaluate(() => amooreSPA.go('#features')); await sleep(400);
    T.check('якорь #features открывает Главную и прокручивает к разделу', (await active(page)).join() === 'home' && (await page.evaluate(() => scrollY)) > 200);
    T.check('нет ошибок JS', errors.length === 0, errors.join('; '));
    await closeCtx(page); }

  { const { page } = await open(withProfile(), { query: '#chat' });
    await sleep(500);
    T.check('открытие /#chat сразу показывает «Чат» (без мигания Главной)', (await active(page)).join() === 'chat');
    await page.reload(); await sleep(600);
    T.check('после обновления страницы остаёмся на вкладке «Чат»', (await active(page)).join() === 'chat' && await page.$eval('#chat-input', e => e.getBoundingClientRect().height > 0));
    await closeCtx(page); }

  { const { page } = await open(withProfile(), { mobile: true, viewport: { width: 390, height: 844 } });
    await sleep(500);
    const bar = await page.$eval('#spa-tabbar', e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { pos: c.position, disp: c.display, bottom: Math.round(innerHeight - r.bottom), n: e.querySelectorAll('a').length }; });
    T.check('на мобильном внизу фиксированный таб-бар из 5 вкладок', bar.pos === 'fixed' && bar.disp !== 'none' && bar.bottom <= 1 && bar.n === 5, JSON.stringify(bar));
    await page.tap('#spa-tabbar a[data-spa-tab="news"]'); await sleep(300);
    T.check('тап по таб-бару переключает вкладку и подсвечивает её', (await active(page)).join() === 'news' && await page.$eval('#spa-tabbar a[data-spa-tab="news"]', a => a.classList.contains('active')));
    T.check('нет горизонтальной прокрутки на 390px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await closeCtx(page); }

  console.log('Профиль Amoore ID: Бизнес-ассистент, Rewards, Безопасность, Уведомления');
  { const { page, errors } = await open(withProfile(), { query: '#profile' });
    await until(async () => page.$('#profile-host .aid-tabs'), 6000);
    T.check('вкладка «Профиль» показывает панель Amoore ID с 5 разделами', (await page.$$eval('#profile-host .aid-tabs button', b => b.map(x => x.textContent))).join('|') === 'Профиль|Бизнес-ассистент|Rewards|Безопасность|Уведомления');
    await page.click('#profile-host .aid-tabs [data-tab="business"]');
    await until(async () => page.$('#biz-company'), 3000);
    T.check('открывается «Бизнес-ассистент»: тумблер, название компании, инструкции', !!(await page.$('#profile-host .aid-sw')) && !!(await page.$('#biz-company')) && !!(await page.$('#biz-instructions')));
    await page.check('#profile-host .aid-sw'); await page.fill('#biz-company', 'ООО «Ромашка»'); await page.fill('#biz-hours', 'Пн–Пт 10–19'); await page.fill('#biz-instructions', 'Доставка 300 руб.');
    await page.click('#profile-host .aid-btn:has-text("Сохранить")'); await sleep(400);
    const row = await page.evaluate(() => (window.__db.business_automations || [])[0]);
    T.check('настройки сохранены в business_automations (user_id, is_enabled, company_name, instructions)', row && row.user_id === 'a1' && row.is_enabled === true && row.company_name === 'ООО «Ромашка»' && row.custom_instructions === 'Доставка 300 руб.' && row.working_hours === 'Пн–Пт 10–19', JSON.stringify(row));
    await page.click('#profile-host .aid-tabs [data-tab="rewards"]'); await until(async () => page.$('#rw-link'), 3000);
    T.check('Rewards: баланс и ссылка ?ref=USERNAME', (await page.textContent('#rw-balance')).startsWith('30') && (await page.$eval('#rw-link', i => i.value)).endsWith('/?ref=tester'));
    await page.click('#profile-host .aid-tabs [data-tab="security"]'); await until(async () => page.$('#revoke-others'), 3000);
    await page.click('#revoke-others'); await sleep(300);
    T.check('Безопасность: «Завершить все другие сессии» вызывает revoke_other_sessions', await page.evaluate(() => window.__mock.calls.some(c => c.rpc === 'revoke_other_sessions')));
    await page.fill('#profile-host input[type=password]', 'new-password-123'); await page.click('#profile-host .aid-btn:has-text("Сменить пароль")'); await sleep(300);
    T.check('смена пароля пишет событие password_change в журнал', await page.evaluate(() => window.__pwChanged === true && window.__mock.calls.some(c => c.rpc === 'log_event' && c.args.p_action === 'password_change')));
    await page.click('#profile-host .aid-tabs [data-tab="notify"]'); await until(async () => page.$('#push-enable'), 3000);
    T.check('Уведомления: кнопка «Разрешить уведомления» на месте', /Разрешить|Не поддерживается/.test(await page.textContent('#push-enable')));
    T.check('нет ошибок JS в профиле', errors.length === 0, errors.join('; '));
    await closeCtx(page); }

  { const { page } = await open(withProfile(), { query: '#profile/business' });
    T.check('deep link #profile/business сразу открывает «Бизнес-ассистент»', !!(await until(async () => page.$('#biz-company'), 6000)));
    await closeCtx(page); }

  { const s = withProfile();
    const { page } = await open(s, { mockInit: 'window.__mock={hang:[],fail:[],calls:[],session:false};' , query: '#profile' });
    await sleep(900);
    T.check('без входа вкладка «Профиль» предлагает войти', await page.$eval('#profile-guest', e => !e.hidden) && await page.$eval('#profile-host', e => e.hidden));
    await closeCtx(page); }

  console.log('Rewards: реферальная ссылка');
  { const { page } = await open(withProfile(), { query: '?ref=Alice_1' });
    await until(async () => page.evaluate(() => window.__referral), 6000);
    T.check('?ref=USERNAME → claim_referral вызван с username пригласившего', (await page.evaluate(() => window.__referral)) === 'alice_1');
    T.check('параметр ?ref стёрт из адреса', !(await page.evaluate(() => location.search)).includes('ref='));
    await closeCtx(page); }
  { const { page } = await open(withProfile(), { query: '?ref=%3Cscript%3E' });
    await sleep(800);
    T.check('невалидный ref игнорируется', !(await page.evaluate(() => window.__referral)));
    await closeCtx(page); }

  console.log('Публичные профили');
  { const { page, errors } = await open(withProfile(), { query: '#u/tester' });
    await until(async () => page.$('#user-host .user-av'), 6000);
    T.check('#u/username открывает публичную страницу', (await active(page)).join() === 'user' && (await page.textContent('#user-host h2')) === '@tester');
    T.check('показаны био (как текст, без HTML), аватарка', (await page.textContent('#user-host .user-bio')) === 'Люблю сайты <b>и</b> ботов' && (await page.$$('#user-host .user-bio b')).length === 0 && (await page.$eval('#user-host .user-av', i => i.src)) === 'https://example.com/a.png');
    const links = await page.$$eval('#user-host .user-sites a', a => a.map(x => [x.textContent, x.href, x.rel]));
    T.check('в списке только публичные сайты (rel=noopener nofollow)', links.length === 1 && links[0][0] === 'Мой лендинг' && /noopener/.test(links[0][2]), JSON.stringify(links));
    T.check('email и роль не раскрываются', !/@amoore\.ru|role|user_id/.test(await page.textContent('#user-host')));
    T.check('нет ошибок JS', errors.length === 0, errors.join('; '));
    await closeCtx(page); }
  { const { page } = await open(withProfile(), { query: '#u/hidden_one' });
    await until(async () => (await page.textContent('#user-host')).includes('не найден'), 5000);
    T.check('скрытый профиль (is_public=false) не показывается', (await page.textContent('#user-host')).includes('Профиль не найден') && !(await page.textContent('#user-host')).includes('секрет'));
    await closeCtx(page); }
  { const vj = JSON.parse(fs.readFileSync(path.join(RU, 'vercel.json'), 'utf8')), rd = fs.readFileSync(path.join(RU, '_redirects'), 'utf8');
    T.check('хостинг: /u/username → /#u/username (vercel.json и _redirects)', vj.redirects.some(r => r.source === '/u/:name' && r.destination === '/#u/:name') && /\/u\/\*\s+\/#u\/:splat/.test(rd)); }

  console.log('Админка: CRM, журнал, Realtime');
  { srv.close(); const dsrv = await H.serve(DEV, 8352);
    const seed = S.seed(); seed.leads = [
      { id: 'l1', name: 'Иван', contact: '@ivan', message: 'Нужен сайт', status: 'new', tags: [], created_at: new Date().toISOString() },
      { id: 'l2', name: '=HYPERLINK("evil")', contact: 'a@b.c', message: 'спам "кавычки"', status: 'new', tags: ['spam'], created_at: new Date().toISOString() }];
    seed.audit_logs = [{ id: 'g1', admin_id: 'a1', action: 'login', created_at: new Date().toISOString() }, { id: 'g2', admin_id: 'a1', action: 'password_change', created_at: new Date().toISOString() }, { id: 'g3', admin_id: 'a1', action: 'news_add', created_at: new Date().toISOString() }];
    const { page, errors } = await H.openPage(b, 'http://localhost:8352/index.html', seed, { init: "localStorage.setItem('amoore_dev_auth', JSON.stringify({admin_id:'a1',email:'boss@amoore.ru',name:'Boss',nickname:'Boss',role:'super_admin',access_token:'tok',expires_at:Date.now()+3e6}));localStorage.setItem('amoore_dev_seen_version','5.3.0');" });
    await until(async () => page.$('#tab-leads'), 6000).catch(() => {});
    const tabVisible = await until(async () => page.$eval('#tab-leads', e => e.offsetParent !== null).catch(() => false), 8000);
    if (!tabVisible) { T.check('админка открылась (сессия подставлена)', false, 'вкладка Заявки не найдена'); }
    else {
      await page.click('#tab-leads'); await until(async () => page.$('.lead-card'), 4000);
      T.check('карточки заявок используют .lead-card', (await page.$$('.lead-card')).length === 2);
      const css = await page.$eval('.lead-card', e => { const c = getComputedStyle(e); return { d: c.flexDirection, j: c.justifyContent, g: c.rowGap }; });
      T.check('.lead-card: column, без space-between, gap 12px', css.d === 'column' && css.j !== 'space-between' && css.g === '12px', JSON.stringify(css));
      T.check('теги VIP / Спам / В ожидании на каждой заявке', (await page.$$eval('[data-lead="l1"] .lead-tag', t => t.map(x => x.textContent))).join('|') === 'VIP|Спам|В ожидании');
      await page.click('[data-lead="l1"] .lead-tag[data-tag="vip"]'); await sleep(300);
      T.check('клик по тегу сохраняет tags в БД', JSON.stringify(await page.evaluate(() => window.__db.leads.find(l => l.id === 'l1').tags)) === '["vip"]');
      await page.click('.v5-chip[data-tf="spam"]'); await sleep(300);
      T.check('фильтр по тегу «Спам» оставляет одну заявку', (await page.$$('.lead-card')).length === 1);
      await page.click('.v5-chip[data-tf="spam"]'); await sleep(300);
      const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), page.click('#leads-csv')]);
      const csv = fs.readFileSync(await dl.path(), 'utf8');
      T.check('«Экспорт в CSV»: файл .csv, заголовок и строки заявок, BOM', dl.suggestedFilename().endsWith('.csv') && csv.charCodeAt(0) === 0xFEFF && csv.includes('name') && csv.includes('Иван') && csv.split('\r\n').length === 3, csv.slice(0, 160));
      T.check('CSV: формулы Excel экранированы, кавычки удвоены', csv.includes('"\'=HYPERLINK(""evil"")"') && csv.includes('""кавычки""'), csv);
      await page.click('#tab-logs'); await until(async () => (await page.$$('#logs-tbody tr')).length >= 3, 4000);
      const all = (await page.$$('#logs-tbody tr')).length;
      await page.selectOption('#logs-filter', 'password'); await sleep(500);
      const rows = await page.$$eval('#logs-tbody tr', r => r.map(x => x.textContent));
      T.check('журнал: фильтр по типу события (Смена пароля) оставляет нужные записи', all === 3 && rows.length === 1 && /Смена пароля/.test(rows[0]), `${all} → ${rows.length}`);
    }
    T.check('нет ошибок JS в админке', errors.length === 0, errors.join('; '));
    await closeCtx(page); dsrv.close(); }

  await b.close();
  process.exit(T.finish() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
