/* QA: дайджест — логика JS, пустая неделя, сворачивание списков, XSS-экранирование и ПАРИТЕТ с Python-версией. */
const fs = require('fs'), path = require('path'), cp = require('child_process');
const D = require('../digest.js'), { suite } = require('./lib');
const T = suite('digest');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/digest-fixture.json'), 'utf8'));
const empty = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/digest-empty.json'), 'utf8'));
const r = D.build(fx);
T.check('новости: только опубликованные и только за 7 дней (2 из 4)', r.totals.news === 2, r.totals.news);
T.check('новости отсортированы от новых к старым', r.news[0].title.startsWith('Новый') && r.news[1].title === 'Патч 3.0');
T.check('тумблеры: учитываются только события за неделю (баннер, закрытие, чат + 12 правок баннера)', r.totals.toggles === 15, r.totals.toggles);
T.check('news_add не дублируется в «прочих событиях»', !r.other.some(o => o.action === 'news_add'));
T.check('прочие события: site_add и lead_done', r.totals.other === 2, r.totals.other);
T.check('неизвестный админ подписан «админ»', r.other.some(o => o.who === 'админ'));
T.check('заявки: 2 за неделю, 1 новая', r.leads.total === 2 && r.leads.fresh === 1 && r.leads.done === 1, JSON.stringify(r.leads));
T.check('визиты: 10 (landing 7, studio 3), старые отброшены', r.visits.total === 10 && r.visits.bySite[0].site === 'landing' && r.visits.bySite[0].count === 7);
T.check('список свыше 10 пунктов сворачивается «…и ещё N»', /…и ещё 5/.test(r.text), r.text.split('\n').filter(l => l.startsWith('…')).join('|'));
T.check('Telegram-версия экранирует <, > и & (нет инъекции HTML)', r.telegram.includes('Новый &lt;дизайн&gt; &amp; чат') && !/<дизайн>/.test(r.telegram));
T.check('Telegram-версия использует только теги <b>', (r.telegram.match(/<\/?[a-z]+>/g) || []).every(t => /^<\/?b>$/.test(t)));
T.check('сообщение укладывается в лимит Telegram (4096)', r.telegram.length < 4096, r.telegram.length);
T.check('заголовок содержит период и эмодзи', /^📊 <b>Дайджест amoore<\/b> · \d{2}\.\d{2}–\d{2}\.\d{2}\.\d{4}/.test(r.telegram), r.telegram.split('\n')[0]);
const e = D.build(empty);
T.check('пустая неделя: понятное сообщение вместо пустого отчёта', e.empty && /Тихая неделя/.test(e.text));
T.check('устойчивость: build() без аргументов не падает', !!D.build().text);
T.check('устойчивость: мусорные даты не ломают сборку', D.build({ now: fx.now, news: [{ title: 'x', published_at: 'мусор' }], logs: [{ action: 'open', created_at: null }] }).empty === true);

// --- паритет с Python ---
const py = cp.spawnSync('python3', ['-c', `
import json,sys
sys.path.insert(0, ${JSON.stringify(path.resolve(__dirname, '../../amoore-ai'))})
import digest
d=json.load(open(sys.argv[1],encoding='utf-8'))
r=digest.build(d)
print(json.dumps({'text':r['text'],'telegram':r['telegram'],'empty':r['empty']},ensure_ascii=False))
`, path.join(__dirname, 'fixtures/digest-fixture.json')], { encoding: 'utf8' });
if (py.status !== 0) T.check('Python-версия запускается', false, py.stderr.slice(0, 300));
else {
  const p = JSON.parse(py.stdout);
  T.check('ПАРИТЕТ: простой текст JS = Python (побайтно)', p.text === r.text, p.text === r.text ? '' : '\nJS:\n' + r.text + '\nPY:\n' + p.text);
  T.check('ПАРИТЕТ: Telegram-HTML JS = Python (побайтно)', p.telegram === r.telegram);
}
fs.writeFileSync(path.join(__dirname, 'results', 'digest-sample.txt'), r.text);
process.exit(T.finish() ? 1 : 0);
