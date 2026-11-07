/* Общие тестовые данные для QA (имитация БД Supabase). */
const now = Date.now(), day = 86400000, iso = (ms) => new Date(now - ms).toISOString();
const sites = [
  { id: 'landing', name: 'amoore-ru (Лендинг)', url: 'https://amoore.ru/', status: 'open', overlay_type: 'maintenance', banner_active: false, banner_text: '', demo_chat_active: true, news_active: true, sort_order: 0 },
  { id: 'studio', name: 'amoore-studio (Студия)', url: 'https://studio.amoore.ru/', status: 'open', overlay_type: 'maintenance', banner_active: false, banner_text: '', demo_chat_active: false, news_active: true, sort_order: 1 }
];
const news = [
  { id: 'n1', title: 'amoore Studio — обновилось', body: 'Новый дизайн и чат с аморэ ии.', type: 'news', display_date: '2026-11-02', is_published: true, published_at: iso(1 * day) },
  { id: 'n2', title: 'Голосовые, память и карма', body: 'Скоро: долгая память о собеседнике и карма за «спасибо».', type: 'soon', display_date: null, is_published: true, published_at: iso(2 * day) },
  { id: 'n3', title: 'Обновление', body: 'Чистка чата, защита группы, игры и погода.', type: 'patch', display_date: '2026-10-29', is_published: true, published_at: iso(4 * day) },
  { id: 'n4', title: 'Черновик (не опубликован)', body: 'не должен попасть на лендинг', type: 'news', display_date: null, is_published: false, published_at: iso(1 * day) }
];
const admins = [
  { id: 'a1', email: 'boss@amoore.ru', name: 'Boss', nickname: 'Boss', role: 'super_admin', permissions: null, created_at: iso(30 * day) },
  { id: 'a2', email: 'mod@amoore.ru', name: 'Mod', nickname: 'Mod', role: 'moderator', permissions: null, created_at: iso(10 * day) }
];
const audit_logs = [
  { id: 1, admin_id: 'a1', action: 'banner_on', site_id: 'landing', overlay_type: null, details: null, created_at: iso(1 * day) },
  { id: 2, admin_id: 'a1', action: 'news_add', site_id: null, overlay_type: null, details: 'amoore Studio — обновилось', created_at: iso(1.2 * day) },
  { id: 3, admin_id: 'a1', action: 'close', site_id: 'studio', overlay_type: 'maintenance', details: null, created_at: iso(2 * day) },
  { id: 4, admin_id: 'a1', action: 'open', site_id: 'studio', overlay_type: null, details: null, created_at: iso(2 * day - 3600000) },
  { id: 5, admin_id: 'a1', action: 'chat_off', site_id: 'studio', overlay_type: null, details: null, created_at: iso(3 * day) },
  { id: 6, admin_id: 'a1', action: 'news_add', site_id: null, overlay_type: null, details: 'Старая новость', created_at: iso(12 * day) }
];
const leads = [
  { id: 'l1', name: 'Артём', contact: '@artem', message: 'Хочу подключить бота в чат', status: 'new', created_at: iso(3 * 3600000) },
  { id: 'l2', name: 'Ира', contact: '+7 900 000-00-00', message: '', status: 'new', created_at: iso(day) },
  { id: 'l3', name: 'Олег', contact: '@oleg', message: 'Спасибо!', status: 'done', created_at: iso(5 * day) }
];
const site_visits = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, site_id: i % 4 ? 'landing' : 'studio', created_at: iso(i * 3600000) }));
const bot_status = [{ id: 'main', is_online: true, last_heartbeat: iso(120000), note: '' }];
const bot_logs = [];
const feature_flags = [];
const digest_queue = [];
module.exports = { sites, news, admins, audit_logs, leads, site_visits, bot_status, bot_logs, feature_flags, digest_queue,
  seed: () => JSON.parse(JSON.stringify({ ecosystem_sites: sites, news, admins, audit_logs, leads, site_visits, bot_status, bot_logs, feature_flags, digest_queue })) };
