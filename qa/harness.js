/* QA-стенд: статический сервер + запуск Playwright с имитацией Supabase. Используется qa/*.test.js. */
const http = require('http'), fs = require('fs'), path = require('path');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };

function pwRequire() {
  const cands = [process.env.PLAYWRIGHT_PATH, '/home/claude/.npm-global/lib/node_modules/playwright', 'playwright'].filter(Boolean);
  for (const c of cands) { try { return require(c); } catch (e) {} }
  throw new Error('Playwright не найден. Установите: npm i -D playwright (или задайте PLAYWRIGHT_PATH).');
}

function serve(root, port) {
  return new Promise((resolve) => {
    const srv = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]); if (u.endsWith('/')) u += 'index.html';
      const f = path.join(root, u);
      if (!f.startsWith(root)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end('404'); } else { r.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); r.end(d); } });
    }).listen(port, () => resolve(srv));
  });
}

/* Открывает страницу с подменённым Supabase. seed — начальные таблицы, opts.admin — запись админа. */
async function openPage(browser, url, seed, opts = {}) {
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1280, height: 800 }, deviceScaleFactor: opts.dpr || 1,
    isMobile: !!opts.mobile, hasTouch: !!opts.mobile, acceptDownloads: true, permissions: ['clipboard-read', 'clipboard-write'], reducedMotion: opts.reducedMotion || 'no-preference' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  const mock = fs.readFileSync(path.join(__dirname, 'mock-supabase.js'), 'utf8');
  const pre = `window.__seed=${JSON.stringify(seed || {})};` + (opts.admin ? `window.__admin=${JSON.stringify(opts.admin)};` : '') + (opts.mockInit || '');
  await page.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, r => r.fulfill({ contentType: 'text/javascript', body: pre + mock }));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  // REST-канал (запасной путь core.js) отвечает из той же in-memory БД
  await page.route(/\.supabase\.co\/rest\/v1\//, async r => {
    const req = r.request(); const u = new URL(req.url()); const t = u.pathname.split('/').pop();
    const mode = await page.evaluate(() => window.__mock && window.__mock.rest || 'ok').catch(() => 'ok');
    if (mode === 'fail') return r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"Invalid API key"}' });
    if (mode === 'hang') return; 
    if (req.method() === 'POST') {
      const body = req.postDataJSON();
      const res = await page.evaluate(([t, b]) => { (window.__db[t] = window.__db[t] || []).unshift(Object.assign({ id: 'rest-' + Math.random() }, b)); return true; }, [t, body]);
      return r.fulfill({ status: 201, body: '' });
    }
    const rows = await page.evaluate(t => (window.__db[t] || []).slice(), t);
    let out = rows;
    for (const [k, v] of u.searchParams) { if (v.startsWith('eq.')) { const x = v.slice(3); out = out.filter(row => String(row[k]) === x); } }
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(out) });
  });
  if (opts.init) await page.addInitScript(opts.init);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return { page, ctx, errors };
}

module.exports = { serve, openPage, pwRequire };
