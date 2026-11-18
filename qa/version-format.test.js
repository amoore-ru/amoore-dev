/* QA: правило версий v6 — чип = только мажор, Changelog = полная запись без хвостовых нулей. Запуск: node qa/version-format.test.js */
const fs = require('fs'), path = require('path'), vm = require('vm');
const { suite } = require('./lib');
const R = path.resolve(__dirname, '../..');
const T = suite('version-format');

// 1) исходник core: собираем src/shared/core/changelog-data.ts esbuild-ом и берём экспорт (без DOM)
function loadCore() {
  let esbuild; for (const p of ['esbuild', '/opt/npm-tools/node_modules/esbuild', path.join(R, 'node_modules/esbuild')]) { try { esbuild = require(p); break; } catch (e) {} }
  const out = esbuild.buildSync({ stdin: { contents: "export { fmtVerFull, fmtVerMajor } from './changelog-data';", resolveDir: path.join(R, 'src/shared/core'), loader: 'ts' }, bundle: true, write: false, format: 'cjs', target: 'es2019', logLevel: 'silent' }).outputFiles[0].text;
  const mod = { exports: {} }; const g = { window: { AMOORE_STATE: {} }, document: { querySelectorAll: () => [], getElementById: () => null, addEventListener() {} }, location: { hostname: 'localhost', search: '', hash: '' }, localStorage: { getItem: () => null, setItem() {} }, navigator: { userAgent: 'x' }, console };
  g.self = g.window; g.window.document = g.document; g.window.location = g.location; g.window.localStorage = g.localStorage;
  vm.runInNewContext(out, Object.assign(g, { module: mod, exports: mod.exports }), { timeout: 3000 });
  return mod.exports;
}
// 2) ux.js — функция shortVer
function loadShortVer() {
  const src = fs.readFileSync(path.join(R, 'amoore-ru/amoore-ux.js'), 'utf8');
  const m = /function shortVer\(v\) \{[^\n]*\}/.exec(src);
  return vm.runInNewContext('(' + m[0].replace('function shortVer', 'function') + ')');
}
const core = loadCore(), shortVer = loadShortVer();
T.check('core: fmtVerFull/fmtVerMajor экспортируются из src/shared/core/changelog-data.ts', !!(core && core.fmtVerFull && core.fmtVerMajor));
const MAJOR = [['5.8.0', 'v5'], ['6.0.0', 'v6'], ['6.1.1', 'v6'], ['8.0.0', 'v8'], ['8', 'v8'], ['v6.0.2', 'v6']];
const FULL = [['6.0.0', 'v6'], ['6', 'v6'], ['6.1.0', 'v6.1'], ['6.1', 'v6.1'], ['6.1.1', 'v6.1.1'], ['6.0.2', 'v6.0.2'], ['5.8.0', 'v5.8'], ['8.0.0', 'v8'], ['10.0.0', 'v10'], ['v6.2.0', 'v6.2']];
for (const [i, o] of MAJOR) {
  T.check(`чип: ${i} → ${o} (core)`, core && core.fmtVerMajor(i) === o, core && core.fmtVerMajor(i));
  T.check(`чип: ${i} → ${o} (amoore-ux.js)`, 'v' + shortVer(i) === o, 'v' + shortVer(i));
}
for (const [i, o] of FULL) T.check(`Changelog: ${i} → ${o}`, core && core.fmtVerFull(i) === o, core && core.fmtVerFull(i));
T.check('чип никогда не содержит точку', MAJOR.every(([i]) => !/\./.test('v' + shortVer(i))));
process.exit(T.finish() ? 1 : 0);
