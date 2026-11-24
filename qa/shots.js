// Скриншоты для визуальной проверки сетки: node qa/shots.js <tag>
const path = require('path'), fs = require('fs');
const H = require('./harness'), S = require('./seed'), { sleep } = require('./lib');
const tag = process.argv[2] || 'x';
const OUT = path.join('/tmp', 'shots'); fs.mkdirSync(OUT, { recursive: true });
const auth = (role) => `localStorage.setItem('amoore_dev_auth', JSON.stringify({admin_id:'a1',email:'x@amoore.ru',nickname:'U',name:'U',role:'${role}',access_token:'tok',expires_at:Date.now()+3e6}));localStorage.setItem('amoore_dev_seen_version','6.1.0');`;
(async () => {
  const { chromium } = H.pwRequire(); const b = await chromium.launch();
  const sites = [['ru', 'amoore-ru', 8401, ''], ['dev', 'amoore-dev', 8402, auth('super_admin')], ['studio', 'amoore-studio', 8403, '']];
  const vps = [['d1440', { width: 1440, height: 900 }, false], ['m390', { width: 390, height: 844 }, true]];
  for (const [name, dir, port, init] of sites) {
    const srv = await H.serve(path.resolve(__dirname, '../../' + dir), port);
    for (const [vn, vp, mob] of vps) {
      const { page } = await H.openPage(b, `http://localhost:${port}/index.html`, S.seed(), { viewport: vp, mobile: mob, init });
      await sleep(1500);
      await page.screenshot({ path: `${OUT}/${tag}-${name}-${vn}.png` });
      await page.context().close();
    }
    srv.close();
  }
  await b.close(); console.log('ok');
})();
