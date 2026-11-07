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
    T.check('AMOORE_VERSION = 3.0.0 (core, state, API)', info.v === '3.0.0' && info.api === '3.0.0' && info.st === '3.0.0', JSON.stringify(info));
    T.check('в подвале показана «Версия 3.0.0»', info.ftr === '3.0.0');
    await page.click('#version-btn');
    await until(async () => (await page.$$('#changelog-body .changelog-entry')).length >= 3, 3000);
    const n = (await page.$$('#changelog-body .changelog-entry')).length;
    T.check('модалка истории обновлений загружает changelog.json', n >= 3, n + ' версий');
    const first = await page.$eval('#changelog-body .changelog-entry h3', e => e.textContent);
    T.check('первая запись — v3.0.0', /v3\.0\.0/.test(first), first);
    await page.keyboard.press('Escape'); await sleep(350);
    T.check('Esc закрывает модалку', await page.$eval('#changelog-modal', e => e.hidden));
    const cl = JSON.parse(fs.readFileSync(path.join(ROOT, 'changelog.json'), 'utf8'));
    T.check('changelog.json: current совпадает с версией core', cl.current === info.v && cl.versions[0].version === info.v);
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

  // ---------- курсор ----------
  console.log('Курсор и меню');
  { const { page } = await open();
    await page.mouse.move(300, 300); await page.mouse.move(420, 360); await sleep(300);
    T.check('десктоп: кастомный курсор создан (точка + шлейф)', (await page.$$('#amoore-cursor .amoore-cursor-trail')).length >= 5 && !!(await page.$('#amoore-cursor .amoore-cursor-dot')));
    await page.hover('.header-tg'); await sleep(150);
    T.check('курсор увеличивается над кнопками', await page.$eval('#amoore-cursor', e => e.classList.contains('big')));
    await page.context().close(); }
  { const { page } = await open(S.seed(), { mobile: true, viewport: { width: 390, height: 844 } });
    await sleep(600);
    T.check('мобильный/сенсорный: кастомного курсора нет', !(await page.$('#amoore-cursor')));
    await page.click('#menu-toggle'); await sleep(450);
    const st = await page.evaluate(() => ({ open: document.getElementById('mobile-nav').classList.contains('open'), ov: document.body.style.overflow, ar: document.getElementById('menu-toggle').getAttribute('aria-expanded'), links: document.querySelectorAll('#mobile-nav a').length }));
    T.check('бургер открывает меню, scroll-lock включён, aria-expanded=true', st.open && st.ov === 'hidden' && st.ar === 'true' && st.links >= 7, JSON.stringify(st));
    await page.keyboard.press('Escape'); await sleep(300);
    T.check('Esc закрывает меню и снимает scroll-lock', !(await page.$eval('#mobile-nav', e => e.classList.contains('open'))) && (await page.evaluate(() => document.body.style.overflow)) === '');
    await page.click('#menu-toggle'); await sleep(400); await page.click('#mobile-nav a[href="#news"]'); await sleep(900);
    T.check('тап по пункту меню закрывает его и прокручивает к разделу', !(await page.$eval('#mobile-nav', e => e.classList.contains('open'))) && (await page.evaluate(() => scrollY)) > 500);
    await page.context().close(); }

  // ---------- safe-area (статическая проверка: Chromium не эмулирует env()) ----------
  { const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8'), html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    T.check('viewport-fit=cover включён', /viewport-fit=cover/.test(html));
    T.check('safe-area-inset-* применён к шапке, меню, нижней панели, подвалу и модалке', ['.topbar', '.mobile-nav', '.mobile-cta', 'footer', '.modal-overlay'].every(sel => new RegExp(sel.replace('.', '\\.') + '[^{]*\\{[^}]*safe-area-inset', 's').test(css)));
    T.check('кэш: CSS/JS подключены с версией ?v=3.0.0', /style\.css\?v=3\.0\.0/.test(html) && /amoore-core\.js\?v=3\.0\.0/.test(html) && /landing\.js\?v=3\.0\.0/.test(html));
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
      document.querySelectorAll('body *').forEach(el => { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > vw + 1 && getComputedStyle(el).position !== 'fixed' && !el.closest('#amoore-cursor, .mobile-nav, .hero-ornaments, .ambient, .page-loader')) wide.push((el.className || el.tagName).toString().slice(0, 40)); });
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
