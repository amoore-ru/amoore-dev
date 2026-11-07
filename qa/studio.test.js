/* QA: Студия — версия, ошибки JS, адаптив, модалка. Запуск: node qa/studio.test.js */
const path = require('path'), fs = require('fs');
const H = require('./harness'), S = require('./seed'), { suite, sleep } = require('./lib');
const ROOT = path.resolve(__dirname, '../../amoore-studio'), SHOTS = path.join(__dirname, 'results', 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
(async () => {
  const { chromium } = H.pwRequire(); const T = suite('studio');
  const srv = await H.serve(ROOT, 8304), b = await chromium.launch(), matrix = [];
  for (const w of [320, 360, 375, 390, 414, 430, 540, 768, 820, 1024, 1280, 1440, 1920]) {
    const { page, errors } = await H.openPage(b, 'http://localhost:8304/index.html', S.seed(), { viewport: { width: w, height: w < 820 ? 800 : 900 }, mobile: w < 820 });
    await sleep(1300);
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth - innerWidth, v: window.AMOORE_VERSION, chip: (document.querySelector('[data-amoore-version]') || {}).textContent }));
    T.check(`${w}px: нет горизонтальной прокрутки`, m.over <= 1, m.over);
    T.check(`${w}px: версия 3.0.0 показана в интерфейсе`, m.v === '3.0.0' && m.chip === '3.0.0', JSON.stringify(m));
    await page.click('#new-project-button').catch(() => {}); await sleep(500);
    const modal = await page.evaluate(() => { const e = document.querySelector('.modal-card'); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
    T.check(`${w}px: окно «Новый проект» помещается на экран`, !modal || (modal.l >= 0 && modal.r <= modal.vw + 1 && modal.t >= 0 && modal.b <= modal.vh + 1), JSON.stringify(modal));
    if (w === 390 || w === 1280) await page.screenshot({ path: path.join(SHOTS, `studio-${w}.png`) });
    T.check(`${w}px: нет ошибок JS`, errors.length === 0, errors.join('; '));
    matrix.push({ w, over: m.over }); await page.context().close();
  }
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  T.check('кэш: все скрипты и CSS подключены с ?v=3.0.0', (html.match(/\?v=3\.0\.0/g) || []).length >= 13, (html.match(/\?v=3\.0\.0/g) || []).length);
  T.check('безопасные зоны iPhone: env(safe-area-inset-*) в CSS', /safe-area-inset-top/.test(fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8')));
  await b.close(); srv.close(); process.exit(T.finish({ matrix }) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
