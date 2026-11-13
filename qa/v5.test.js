// QA v5.0 «APEX»: статические проверки безопасности и целостности (без браузера и без БД).
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, extra) => { ok ? pass++ : (fail++, console.error('  ✗', name, extra || '')); };

// ---- SQL: единый файл 001_init_database.sql (v5.1)
const sql = read('amoore-dev/shared/sql/001_init_database.sql');
const tables = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
check('009: найдены таблицы', tables.length >= 8, tables.join(','));
for (const t of tables) check(`RLS включён: ${t}`, new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(sql));
const fnBlocks = sql.split(/create or replace function/i).slice(1);
for (const b of fnBlocks) {
  const name = (/^\s*public\.(\w+)/.exec(b) || [])[1];
  if (/security definer/i.test(b)) check(`security definer + search_path: ${name}`, /set search_path/i.test(b.slice(0, 700)));
}
check('sso_tokens/login_attempts/tg_link_codes закрыты от клиентов', ['sso_tokens', 'login_attempts', 'tg_link_codes'].every((t) => new RegExp(`revoke all on public\\.${t} from anon, authenticated`).test(sql)));
check('auth_note_success не доступен anon', !/grant execute on function public\.auth_note_success\(\) to[^;]*anon/.test(sql));
check('profiles: клиент не может менять role/is_banned/rewards_balance (grant только username, avatar_url, bio, is_public)', /grant update \(username, avatar_url\) on public\.profiles/.test(sql));
check('бан и смена ролей проверяют is_boss()', ['admin_ban_user', 'admin_set_role', 'admin_list_people'].every((f) => new RegExp(`function public\\.${f}[\\s\\S]*?is_boss\\(\\)`).test(sql)));
check('SSO-токен хранится как sha256, TTL 60 с', /digest\(tok, 'sha256'\)/.test(sql) && /interval '60 seconds'/.test(sql));

// ---- Edge Functions
const edge = { 'sso-exchange': 0, 'ai-copy': 1, 'send-email': 1, geo: 0, 'push-news': 1 };
for (const [fn, needsAuth] of Object.entries(edge)) {
  const code = read(`supabase/functions/${fn}/index.ts`);
  check(`${fn}: нет зашитых ключей`, !/gsk_[A-Za-z0-9]|re_[A-Za-z0-9]{10}|eyJ[A-Za-z0-9_-]{20}|sb_secret/.test(code));
  if (needsAuth) check(`${fn}: проверяет пользователя`, /caller\(req\)/.test(code));
}
check('sso-exchange гасит токен атомарно', /update\(\{ used_at/.test(read('supabase/functions/sso-exchange/index.ts')) && /is\("used_at", null\)/.test(read('supabase/functions/sso-exchange/index.ts')));

// ---- amoore-id.js (в песочнице)
const idCode = read('amoore-dev/amoore-id.js'), win = {};
vm.runInNewContext(idCode, { window: win, document: { createElement() { return {}; } }, location: {}, console, URLSearchParams, setTimeout });
const API = win.amooreID;
check('amooreID экспортируется', !!API && typeof API.signIn === 'function' && typeof API.consumeUrl === 'function');
check('username: допустимые', ['ab1', 'amoore_dev', 'a'.repeat(24)].every((u) => API.USERNAME_RE.test(u)));
check('username: недопустимые', ['ab', 'Имя', 'a b', 'A_B', 'a'.repeat(25), 'x-y'].every((u) => !API.USERNAME_RE.test(u)));
check('токен SSO и ссылки стираются из адресной строки', /history\.replaceState/.test(idCode));
check('нет innerHTML в amoore-id.js (XSS)', !/innerHTML/.test(idCode));

// ---- версии
const v = '5.1.0';
check('AMOORE_VERSION в core', /var AMOORE_VERSION = '5.1.0'/.test(read('amoore-ru/amoore-core.js')));
check('версия в bot.py', /AMOORE_VERSION = "5.1.0"/.test(read('amoore-ai/bot.py')));
for (const d of ['amoore-dev', 'amoore-ru', 'amoore-studio', 'amoore-ai']) check(`changelog ${d}`, JSON.parse(read(`${d}/changelog.json`)).current === v);

// ---- PWA
for (const d of ['amoore-ru', 'amoore-studio', 'amoore-dev']) {
  const m = JSON.parse(read(`${d}/manifest.json`)), html = read(`${d}/index.html`);
  check(`${d}: manifest (standalone, иконки на месте)`, m.display === 'standalone' && m.icons.every((i) => fs.existsSync(path.join(ROOT, d, i.src))));
  check(`${d}: pwa.js и cmdk.js подключены`, /amoore-pwa\.js/.test(html) && /amoore-cmdk\.js/.test(html));
  check(`${d}: viewport-fit=cover`, /viewport-fit=cover/.test(html) || /viewport-fit/.test(read(`${d}/amoore-pwa.js`)));
}
const sw = read('amoore-ru/sw.js');
check('sw.js не кэширует чужие домены (Supabase, функции)', /u\.origin !== location\.origin/.test(sw));
check('sw.js: только GET', /r\.method !== 'GET'/.test(sw));

// ---- бот
const bot = read('amoore-ai/bot.py');
check('бот: /link зарегистрирован', /"\/link": cmd_link/.test(bot) && /def cmd_link/.test(bot));
check('бот: /link только в личке', /chat_type_of\(chat_id\) != "private"/.test(bot));
check('бот: код привязки из secrets, не random', /import secrets/.test(read('amoore-ai/supabase_bridge.py')) && /randbelow/.test(read('amoore-ai/supabase_bridge.py')));


// ======================================================================= v5.1 «MASTER»
const sqlDir = path.join(ROOT, 'amoore-dev/shared/sql');
check('SQL: в shared/sql единственная миграция — 001_init_database.sql (кроме cleanup.sql)', fs.readdirSync(sqlDir).filter((f) => /^\d+_.*\.sql$/.test(f)).join() === '001_init_database.sql', fs.readdirSync(sqlDir).join());
check('SQL: нет файлов 002–010 ни в shared/sql, ни в корне', !fs.readdirSync(sqlDir).some((f) => /^0(0[2-9]|10)_/.test(f)) && !fs.readdirSync(ROOT).some((f) => /^0\d\d_.*\.sql$/.test(f)));
for (const t of ['admins', 'profiles', 'business_automations', 'changelog_versions', 'leads', 'news', 'audit_logs', 'user_sessions', 'push_subscriptions', 'user_sites', 'rewards_log']) check(`SQL: таблица ${t} создаётся в едином файле`, new RegExp(`create table if not exists public\\.${t}\\b`).test(sql));
check('SQL: Storage bucket media и политики', /storage\.buckets/.test(sql) && /'media'/.test(sql));
check('SQL: идемпотентность — у каждой политики есть DROP POLICY IF EXISTS', [...sql.matchAll(/^create policy (\w+) on ([\w.]+)/gm)].every((m) => new RegExp(`drop policy if exists ${m[1]} on ${m[2].replace('.', '\\.')}`).test(sql)));
check('SQL: нет голых CREATE TABLE без IF NOT EXISTS', ![...sql.matchAll(/^create table (?!if not exists)/gim)].length);
check('SQL: индексы на user_id / created_at / is_published', /news_is_published_idx/.test(sql) && /user_sites_user_idx/.test(sql) && /rewards_log_user_idx/.test(sql) && /profiles_created_at_idx/.test(sql));
check('SQL: баллы и referred_by защищены триггером (клиент не может накрутить)', /new\.rewards_balance is distinct from old\.rewards_balance/.test(sql) && /new\.referred_by is distinct from old\.referred_by/.test(sql));
check('SQL: claim_referral — +10, один раз, не самому себе, окно 7 дней', /function public\.claim_referral/.test(sql) && /rewards_balance \+ 10/.test(sql) && /referred_by is not null then return 0/.test(sql) && /id <> me\.id/.test(sql) && /interval '7 days'/.test(sql));
check('SQL: RLS включён на новых таблицах', ['business_automations', 'push_subscriptions', 'user_sites', 'rewards_log'].every((t) => new RegExp(`alter table public\\.${t}\\s+enable row level security`).test(sql)));
check('SQL: public_profile отдаёт только username/avatar/bio/публичные сайты', /function public\.public_profile/.test(sql) && !/'email'/.test(sql.slice(sql.indexOf('function public.public_profile'), sql.indexOf('function public.public_profile') + 900)));
check('SQL: теги заявок ограничены VIP/Спам/В ожидании', /tags <@ array\['vip','spam','pending'\]/.test(sql));
check('SQL: Realtime для leads/site_visits/audit_logs', /supabase_realtime/.test(sql) && /'site_visits'/.test(sql));
check('SQL: changelog 5.1.0 (26.11.2026) в таблице и global_settings', (sql.match(/5\.1\.0/g) || []).length >= 4 && /2026-11-26/.test(sql));

check('Edge push-news: защита от повторов и очистка мёртвых подписок', /push_sent_at/.test(read('supabase/functions/push-news/index.ts')) && /404 \|\| code === 410/.test(read('supabase/functions/push-news/index.ts')));
check('Edge push-news: секрет вебхука сравнивается и нужен ≥16 символов', /secret\.length >= 16/.test(read('supabase/functions/push-news/index.ts')));
check('sw.js: обработчики push и notificationclick, переход только на свой домен', /addEventListener\('push'/.test(sw) && /addEventListener\('notificationclick'/.test(sw) && /target\.origin !== location\.origin/.test(sw));
check('pwa.js: amoorePush (enable/disable, VAPID из meta)', /amoorePush/.test(read('amoore-ru/amoore-pwa.js')) && /amoore-vapid-public-key/.test(read('amoore-ru/amoore-pwa.js')));
check('Amoore ID: вкладки Профиль / Бизнес-ассистент / Rewards / Безопасность / Уведомления', ['Бизнес-ассистент', 'Rewards', 'Безопасность', 'Уведомления'].every((x) => idCode.includes(x)) && /Завершить все другие сессии/.test(idCode) && /Разрешить уведомления/.test(idCode));
check('Amoore ID: ссылка ?ref=USERNAME и claim_referral', /'\/\?ref='/.test(idCode) && /claim_referral/.test(idCode));
const html = read('amoore-ru/index.html'), ljs = read('amoore-ru/landing.js');
check('лендинг: 6 SPA-вкладок (home/news/chat/ecosystem/profile/user)', ['home', 'news', 'chat', 'ecosystem', 'profile', 'user'].every((v) => new RegExp(`id="view-${v}" data-view="${v}"`).test(html)));
check('лендинг: хэш-навигация (hashchange, popstate, #u/username)', /hashchange/.test(ljs) && /popstate/.test(ljs) && /\^u\\\//.test(ljs));
check('лендинг: prefetch картинок и шрифтов', /rel="prefetch"/.test(html) && /document\.fonts\.load/.test(ljs));
check('лендинг: публичный профиль строится через textContent (нет innerHTML)', !/innerHTML/.test(ljs.slice(ljs.indexOf('async function loadUser'), ljs.indexOf('return { go: go'))));
check('бот: /studio открывает Студию как WebApp (https-only)', /def cmd_studio/.test(bot) && /"web_app": \{"url": url\}/.test(bot) && /"\/studio": cmd_studio/.test(bot));
check('бот: заявки приходят с кнопками «Взять в работу» / «Отклонить»', /lead_take_/.test(bot) && /lead_rej_/.test(bot) && /Взять в работу/.test(bot) && /Отклонить/.test(bot));
check('бот: бизнес-ассистент читает business_automations и отвечает на «Вы» без смайликов', /fetch_business_automation/.test(bot) && /на «Вы»/.test(bot) && /sanitize_business_reply/.test(bot));
const css = read('amoore-dev/style.css');
check('CSS: .lead-card / .news-card — column, gap 12px, без space-between', /\.lead-card, \.news-card \{[^}]*flex-direction: column;[^}]*gap: 12px/.test(css) && !/\.lead-card[^{]*\{[^}]*space-between/.test(css));
check('админка: ошибка рассылки «Ошибка: проверьте BOT_TOKEN»', /Ошибка: проверьте BOT_TOKEN/.test(read('amoore-dev/app.js')));
check('админка: теги заявок, CSV, фильтр журнала, Realtime-графики', /Экспорт в CSV/.test(read('amoore-dev/amoore-admin-v5.js')) && /amoore-live-activity/.test(read('amoore-dev/amoore-admin-v5.js')) && /id="logs-filter"/.test(read('amoore-dev/index.html')));
const cl = JSON.parse(read('amoore-ru/changelog.json')).versions[0];
check('changelog: v5.1 MASTER от 2026-11-26', cl.version === '5.1.0' && cl.title === 'v5.1 MASTER' && cl.date === '2026-11-26' && cl.items.length >= 6);

console.log(`v5: ${pass}/${pass + fail} проверок пройдено`);
process.exit(fail ? 1 : 0);
