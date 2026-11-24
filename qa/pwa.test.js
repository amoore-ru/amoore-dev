// QA PWA (v6.1): manifest ×3, <head>, иконки, precache sw.js, offline.html, _headers, идентичность общих файлов. Без браузера.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : (fail++, console.error('  ✗', name, extra || '')); };
const pngSize = (p) => { const b = fs.readFileSync(path.join(ROOT, p)); return b.readUInt32BE(0) === 0x89504e47 ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };

const SITES = { 'amoore-ru': '#0A0A0A', 'amoore-studio': '#0A0A0A', 'amoore-dev': '#140A28' };
for (const [s, color] of Object.entries(SITES)) {
  let m; try { m = JSON.parse(read(`${s}/manifest.json`)); } catch (e) { check(`${s}: manifest.json читается`, false, e.message); continue; }
  check(`${s}: manifest display=standalone, scope=/, start_url`, m.display === 'standalone' && m.scope === '/' && /^\/\?source=pwa/.test(m.start_url));
  check(`${s}: manifest цвета = ${color}`, m.theme_color === color && m.background_color === color);
  check(`${s}: manifest name/short_name/lang`, !!m.name && !!m.short_name && m.lang === 'ru');
  const icons = m.icons || [];
  let okFiles = icons.length > 0;
  for (const i of icons) {
    const sz = exists(`${s}/${i.src}`) ? pngSize(`${s}/${i.src}`) : null;
    const [w, h] = (i.sizes || '').split('x').map(Number);
    if (!sz || sz[0] !== w || sz[1] !== h) { okFiles = false; console.error('    иконка', s, i.src, sz, i.sizes); }
  }
  check(`${s}: иконки manifest существуют, реальные размеры совпадают`, okFiles);
  for (const sz of ['192x192', '512x512']) {
    check(`${s}: есть any и maskable ${sz}`, icons.some((i) => i.sizes === sz && /any/.test(i.purpose || 'any')) && icons.some((i) => i.sizes === sz && /maskable/.test(i.purpose || '')));
  }
  const html = read(`${s}/index.html`);
  check(`${s}: блок pwa:begin…pwa:end в <head>`, /<!-- pwa:begin[\s\S]*pwa:end[^>]*-->/.test(html));
  check(`${s}: link manifest.json, apple-touch-icon, apple-touch-startup-image`, /rel="manifest" href="manifest\.json"/.test(html) && /rel="apple-touch-icon"/.test(html) && /rel="apple-touch-startup-image"/.test(html));
  check(`${s}: viewport-fit=cover`, /viewport-fit=cover/.test(html));
  check(`${s}: theme-color = ${color}`, new RegExp(`name="theme-color"[^>]*content="${color}"`, 'i').test(html));
  const hrefs = [...html.matchAll(/<link[^>]+href="(icons\/[^"]+)"/g)].map((x) => x[1]);
  check(`${s}: все icons/* из <head> существуют`, hrefs.length > 20 && hrefs.every((h) => exists(`${s}/${h}`)), hrefs.filter((h) => !exists(`${s}/${h}`)).join(','));
  check(`${s}: нет ссылок на удалённые иконки`, !/android-chrome|site\.webmanifest|favicon-(16x16|32x32)|apple-touch-icon\.png/.test(html));
  const sw = read(`${s}/sw.js`);
  const shell = [...(/const SHELL = \[([^\]]*)\]/.exec(sw) || [, ''])[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).filter((x) => x !== './');
  const extra = [...(/const EXTRA = \[([^\]]*)\]/.exec(sw) || [, ''])[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  check(`${s}: precache (SHELL+EXTRA) — все файлы существуют, есть offline.html и manifest.json`, shell.concat(extra).every((f) => exists(`${s}/${f}`)) && shell.includes('offline.html') && extra.includes('manifest.json'));
  check(`${s}: offline.html (viewport-fit, safe-area, кнопка)`, exists(`${s}/offline.html`) && /viewport-fit=cover/.test(read(`${s}/offline.html`)) && /safe-area-inset/.test(read(`${s}/offline.html`)) && /Повторить/.test(read(`${s}/offline.html`)));
  const hd = read(`${s}/_headers`);
  check(`${s}: _headers — manifest (application/manifest+json), sw.js no-cache, notify не immutable`, /\/manifest\.json\s+Content-Type: application\/manifest\+json/.test(hd) && /\/sw\.js\s+Cache-Control: no-cache/.test(hd) && /\/icons\/notify-\*\s+Cache-Control: public, max-age=86400\s/.test(hd));
  check(`${s}: нет «/*.png immutable» (затронул бы notify-*)`, !/\/\*\.png/.test(hd));
}
const swR = read('amoore-ru/sw.js');
check('sw.js: иконки уведомлений — icons/notify-*, без старых путей', /icons\/notify-192\.png\?v=/.test(swR) && /icons\/notify-badge\.png\?v=/.test(swR) && !/android-chrome|favicon-32x32/.test(swR));
check('sw.js: fallback навигации → offline.html', /caches\.match\('offline\.html'\)/.test(swR));
const pw = read('amoore-ru/amoore-pwa.js');
check('amoore-pwa.js: standalone-отступы только для body:not(.pill-shell) (safe-area считают пилюли)', /display-mode:standalone\)\{body:not\(\.pill-shell\)\{/.test(pw));
check('amoore-pwa.js: нет ссылок на старые иконки и старый цвет', !/android-chrome|070b16/.test(pw));
for (const f of ['sw.js', 'amoore-pwa.js', 'offline.html']) for (const s of ['amoore-studio', 'amoore-dev']) check(`${f}: ${s} идентичен amoore-ru`, read(`amoore-ru/${f}`) === read(`${s}/${f}`));
check('og:url лендинга = боевой адрес', /property="og:url" content="https:\/\/amoore\.cc\.cd\/"/.test(read('amoore-ru/index.html')));
check('Tauri-иконки на месте (icon.png 1024)', (pngSize('amoore-app/src-tauri/icons/icon.png') || [])[0] === 1024 && exists('amoore-app/src-tauri/icons/icon.ico'));
console.log(`[pwa] ${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
