/* QA: редактор Changelog в админке (v6.0.1): + версия, + подверсия (глобальная и на карточке), ▲▼, Drag&Drop, удаление, сохранение.
   Запуск: node qa/changelog.test.js */
const path = require('path');
const H = require('./harness'), S = require('./seed'), { suite, sleep, until } = require('./lib');
const DEV = path.resolve(__dirname, '..');
const sessionInit = (id, role) => `localStorage.setItem('amoore_dev_auth', JSON.stringify({admin_id:'${id}',email:'x@amoore.ru',nickname:'U',name:'U',role:'${role}',access_token:'tok',expires_at:Date.now()+3e6}));localStorage.setItem('amoore_dev_seen_version','5.8.0');`;
(async () => {
  const { chromium } = H.pwRequire();
  const T = suite('changelog');
  const srv = await H.serve(DEV, 8312);
  const b = await chromium.launch();
  const seed = S.seed();
  seed.global_settings = [{ key: 'changelog', value: { current: '5.8.0', versions: [
    { version: '5.8.0', title: 'Восемь', date: '2026-11-15', items: ['a'] },
    { version: '5.7.0', title: 'Семь', date: '2026-11-10', items: ['b'] },
    { version: '5.6.0', title: 'Шесть', date: '2026-11-05', items: ['c'] } ] } }];
  for (const [label, o] of [['десктоп мышью', { viewport: { width: 1440, height: 900 } }], ['телефон, касание', { viewport: { width: 390, height: 844 }, mobile: true }]]) {
    console.log('Changelog · ' + label);
    const { page, errors } = await H.openPage(b, 'http://localhost:8312/index.html', JSON.parse(JSON.stringify(seed)), Object.assign({ init: sessionInit('a1', 'super_admin') }, o));
    const mobile = !!o.mobile;
    await until(async () => (await page.$$('.site-card')).length >= 1, 6000);
    if (await page.isVisible('#burger')) { await page.click('#burger'); await sleep(350); }
    await page.click('#tab-news'); await sleep(400); await page.click('[data-pane="updates"]'); await sleep(600);
    const vers = () => page.$$eval('.cl-card .cl-version', i => i.map(x => x.value));
    T.check(label + ': редактор показывает 3 версии из БД', (await vers()).join() === '5.8.0,5.7.0,5.6.0', (await vers()).join());
    await page.click('#cl-add-sub'); await sleep(300);
    T.check(label + ': глобальная «+ Добавить подверсию» добавляет 5.8.1 наверх', (await vers()).join() === '5.8.1,5.8.0,5.7.0,5.6.0', (await vers()).join());
    await page.click('.cl-card:nth-child(3) .cl-sub'); await sleep(300);
    T.check(label + ': «+ подверсия» на карточке 5.7.0 добавляет 5.7.1 над ней', (await vers()).join() === '5.8.1,5.8.0,5.7.1,5.7.0,5.6.0', (await vers()).join());
    await page.click('.cl-card:nth-child(1) .cl-down'); await sleep(250);
    T.check(label + ': ▼ двигает карточку вниз', (await vers()).slice(0, 2).join() === '5.8.0,5.8.1', (await vers()).join());
    await page.click('.cl-card:nth-child(2) .cl-up'); await sleep(250);
    T.check(label + ': ▲ двигает карточку вверх', (await vers()).slice(0, 2).join() === '5.8.1,5.8.0', (await vers()).join());
    await page.fill('.cl-card:nth-child(1) .cl-title', 'Правка'); await page.click('.cl-card:nth-child(1) .cl-down'); await sleep(250);
    T.check(label + ': введённый текст не теряется при перемещении', (await page.$$eval('.cl-card .cl-title', t => t.map(x => x.value))).includes('Правка'));
    await page.click('.cl-card:nth-child(1) .cl-up'); await sleep(250);          // крайняя ▲ — ничего не ломает
    // Drag & Drop: ручку последней карточки тащим на самый верх (pointer events)
    const n = (await vers()).length;
    const h = await page.$(`.cl-card:nth-child(${n}) .cl-handle`); await h.scrollIntoViewIfNeeded();
    const hb = await h.boundingBox(); const first = await (await page.$('.cl-card:nth-child(1)')).boundingBox();
    const lastVer = (await vers())[n - 1];
    if (mobile) {
      const cdp = await page.context().newCDPSession(page);
      const pt = (x, y) => [{ x, y, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(hb.x + hb.width / 2, hb.y + hb.height / 2) });
      for (let k = 1; k <= 12; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(hb.x + hb.width / 2, hb.y + hb.height / 2 + (30 - hb.y - hb.height / 2) * k / 12) }); await sleep(30); }
      for (let k = 0; k < 160; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(hb.x + hb.width / 2, 30 + (k % 2)) }); await sleep(16); }   // палец удерживается у верхнего края → автопрокрутка
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
      await page.mouse.move(hb.x + hb.width / 2, hb.y - 40, { steps: 10 }); await page.mouse.move(hb.x + hb.width / 2, first.y + 4, { steps: 20 }); await page.mouse.up();
    }
    await sleep(500);
    const afterDnD = await vers();
    T.check(label + ': Drag&Drop переносит последнюю версию (' + lastVer + ') на первое место', afterDnD[0] === lastVer && afterDnD.length === n, afterDnD.join());
    const first2 = (await vers())[0];
    await page.click('.cl-card:nth-child(2) .cl-del'); await sleep(250);
    T.check(label + ': «Удалить версию» убирает карточку', (await vers()).length === n - 1 && (await vers())[0] === first2);
    await page.click('#cl-save'); await sleep(800);
    const saved = await page.evaluate(() => window.__db.global_settings.find(r => r.key === 'changelog').value);
    T.check(label + ': порядок и состав сохраняются в БД, current = максимальная версия', saved.versions.length === n - 1 && saved.current === saved.versions.map(v => v.version).sort((a, c) => a.localeCompare(c, 'en', { numeric: true })).pop(), JSON.stringify(saved.versions.map(v => v.version)) + ' cur=' + saved.current);
    T.check(label + ': у сохранённых записей поле order идёт 0..n', saved.versions.every((v, i) => v.order === i));
    T.check(label + ': нет ошибок JS', errors.length === 0, errors.join('; '));
    await page.context().close();
  }
  await b.close(); srv.close(); process.exit(T.finish() ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
