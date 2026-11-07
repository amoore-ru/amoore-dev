/* Мини-фреймворк проверок для QA: check(name, ok, detail) → итоговый JSON + код выхода. */
const fs = require('fs'), path = require('path');
function suite(name) {
  const rows = [];
  return {
    check(title, ok, detail) { rows.push({ title, ok: !!ok, detail: detail === undefined ? '' : String(detail) }); console.log((ok ? '  ✓ ' : '  ✗ ') + title + (ok || detail === undefined ? '' : '  → ' + detail)); },
    finish(extra) {
      const failed = rows.filter(r => !r.ok).length;
      const dir = path.join(__dirname, 'results'); fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name + '.json'), JSON.stringify({ suite: name, total: rows.length, passed: rows.length - failed, failed, rows, extra: extra || null }, null, 2));
      console.log(`[${name}] ${rows.length - failed}/${rows.length} passed`);
      return failed;
    },
    rows
  };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 4000, step = 80) { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(step); } return false; }
module.exports = { suite, sleep, until };
