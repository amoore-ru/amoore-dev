/* QA-стенд: имитация supabase-js в памяти браузера. Подменяет CDN-скрипт через page.route().
   Состояние — window.__db (таблицы-массивы) и window.__mock (переключатели отказов). Только для тестов. */
(function () {
  var seedDb = window.__seed || {};
  window.__db = window.__db || JSON.parse(JSON.stringify(seedDb));
  // QA: «постоянная» БД между перезагрузками страницы (как настоящий Supabase) — тест кладёт слепок в sessionStorage
  try { var saved = sessionStorage.getItem('__mockdb'); if (saved) window.__db = JSON.parse(saved); } catch (e) {}
  window.__mock = window.__mock || { hang: [], fail: [], calls: [], session: true };
  var handlers = {};           // table -> [cb] для Realtime
  window.__emit = function (table, payload) { (handlers[table] || []).forEach(function (cb) { try { cb(payload || {}); } catch (e) {} }); };

  function uid() { return 'id-' + Math.random().toString(16).slice(2, 10); }
  function table(name) { return (window.__db[name] = window.__db[name] || []); }
  function matcher(filters) {
    return function (row) {
      return filters.every(function (f) {
        var v = row[f.k];
        switch (f.op) {
          case 'eq': return v === f.v;
          case 'neq': return v !== f.v;
          case 'gte': return v >= f.v;
          case 'lte': return v <= f.v;
          case 'gt': return v > f.v;
          case 'lt': return v < f.v;
          case 'in': return f.v.indexOf(v) >= 0;
          case 'is': return v === f.v || (f.v === null && v == null);
          case 'ilike': return new RegExp('^' + String(f.v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i').test(String(v == null ? '' : v));
        }
        return true;
      });
    };
  }
  function builder(name) {
    var st = { op: 'select', filters: [], order: null, limit: null, payload: null, head: false, count: false, single: false };
    var b = {};
    ['eq', 'neq', 'gte', 'lte', 'gt', 'lt', 'in', 'is', 'ilike'].forEach(function (op) {
      b[op] = function (k, v) { st.filters.push({ op: op, k: k, v: v }); return b; };
    });
    b.select = function (cols, opts) { if (st.op === 'select' || !st.payload) st.op = st.op; st.count = !!(opts && opts.count); st.head = !!(opts && opts.head); return b; };
    b.order = function (k, o) { st.order = { k: k, asc: !(o && o.ascending === false) }; return b; };
    b.limit = function (n) { st.limit = n; return b; };
    b.maybeSingle = function () { st.single = 'maybe'; return b; };
    b.single = function () { st.single = 'one'; return b; };
    b.insert = function (p) { st.op = 'insert'; st.payload = p; return b; };
    b.upsert = function (p) { st.op = 'upsert'; st.payload = p; return b; };
    b.update = function (p) { st.op = 'update'; st.payload = p; return b; };
    b.delete = function () { st.op = 'delete'; return b; };
    function run() {
      window.__mock.calls.push({ table: name, op: st.op, payload: st.payload, filters: st.filters.slice() });
      if (window.__mock.fail.indexOf(name) >= 0) return { data: null, error: { message: 'mock failure: ' + name }, status: 500 };
      var rows = table(name), m = matcher(st.filters), res;
      if (st.op === 'insert') {
        var list = Array.isArray(st.payload) ? st.payload : [st.payload];
        var ins = list.map(function (r) {
          var row = Object.assign({ id: uid(), created_at: new Date().toISOString() }, name === 'news' ? { published_at: new Date().toISOString(), is_published: true } : {}, r);
          if (name === 'ecosystem_sites' && rows.some(function (x) { return x.id === row.id; })) row = null;
          return row;
        });
        if (name === 'digest_queue' && rows.some(function (x) { return x.status === 'pending'; })) return { data: null, error: { message: 'duplicate key value violates unique constraint "digest_one_pending"' }, status: 409 };
        if (ins.indexOf(null) >= 0) return { data: null, error: { message: 'duplicate key value violates unique constraint' }, status: 409 };
        ins.forEach(function (r) { rows.unshift(r); });
        window.__emit(name, { eventType: 'INSERT', new: ins[0] });
        return { data: st.single ? ins[0] : ins, error: null, status: 201 };
      }
      if (st.op === 'update') {
        var hit = rows.filter(m); hit.forEach(function (r) { Object.assign(r, st.payload); });
        hit.forEach(function (r) { window.__emit(name, { eventType: 'UPDATE', new: Object.assign({}, r) }); });
        return { data: hit, error: null, status: 200 };
      }
      if (st.op === 'delete') {
        var before = rows.length; window.__db[name] = rows.filter(function (r) { return !m(r); });
        window.__emit(name, { eventType: 'DELETE', old: {} });
        return { data: null, error: null, status: 204, count: before - window.__db[name].length };
      }
      res = rows.filter(m).map(function (r) { return Object.assign({}, r); });
      if (st.order) res.sort(function (a, c) { var x = a[st.order.k], y = c[st.order.k]; var d = x > y ? 1 : x < y ? -1 : 0; return st.order.asc ? d : -d; });
      var total = res.length;
      if (st.limit != null) res = res.slice(0, st.limit);
      if (st.single) return { data: res[0] || null, error: (st.single === 'one' && !res[0]) ? { message: 'no rows' } : null, status: 200 };
      return { data: st.head ? null : res, error: null, count: st.count ? total : null, status: 200 };
    }
    b.then = function (ok, bad) {
      if (window.__mock.hang.indexOf(name) >= 0) return new Promise(function () {}).then(ok, bad);   // «зависший» запрос
      return Promise.resolve().then(function () { return new Promise(function (r) { setTimeout(r, window.__mock.latency || 0); }); }).then(run).then(ok, bad);
    };
    return b;
  }
  var admin = window.__admin || { id: 'a1', email: 'boss@amoore.ru', name: 'Boss', nickname: 'Boss', role: 'super_admin', permissions: null };
  window.supabase = {
    createClient: function () {
      return {
        from: builder,
        rpc: function (fn, args) {
          window.__mock.calls.push({ rpc: fn, args: args });
          if (fn === 'verify_admin') return Promise.resolve({ data: admin, error: null });
          if (fn === 'verify_god') return Promise.resolve({ data: true, error: null });
          return Promise.resolve({ data: true, error: null });
        },
        auth: {
          getSession: function () { return Promise.resolve({ data: { session: window.__mock.session ? { user: { email: admin.email } } : null } }); },
          signInWithPassword: function () { return Promise.resolve({ data: { session: {} }, error: null }); },
          signOut: function () { return Promise.resolve({}); }
        },
        storage: { from: function () { return {
          list: function () { return Promise.resolve({ data: [{ name: 'a.png' }, { name: 'b.webp' }], error: null }); },
          getPublicUrl: function (n) { return { data: { publicUrl: 'https://x.supabase.co/storage/v1/object/public/media/' + n } }; },
          upload: function () { return Promise.resolve({ error: null }); }, remove: function () { return Promise.resolve({ error: null }); }
        }; } },
        functions: { invoke: function () { return Promise.resolve({ data: { ok: true, sent: 1, failed: 0 }, error: null }); } },
        channel: function () { var c = { on: function (t, f, cb) { (handlers[f.table] = handlers[f.table] || []).push(cb); return c; }, subscribe: function () { return c; } }; return c; },
        removeChannel: function () {}
      };
    }
  };
})();
