/**
 * amoore-id.js — v5.8.0 «SMART AUTH & PRE-RUST» · amoore id (единый аккаунт). Побайтно одинаков во всех трёх сайтах.
 * Подключение (после supabase-js):  <script src="amoore-id.js"></script>
 *   amooreID.init({ site: 'dev'|'studio'|'landing', sb: <существующий клиент, необязательно> })
 * API: signIn(email,pw) · sendCode(email, create)/verifyCode (вход ТОЛЬКО по 6-значному коду из письма) · consumeUrl() (SSO) · ensureOnboarded()
 *      openProfile() / renderProfile(host) (вкладки: Профиль · Бизнес-ассистент · Баллы · Безопасность · Уведомления) · ssoOpen(target) · listSessions/revokeOthers · linkTelegram · people.* (только Boss)
 */
/* ⚠ ГЕНЕРИРУЕТСЯ из src/shared/id/*.ts (npm run build:shared). Не правьте руками. */
"use strict";
(() => {
  // src/shared/id/config.ts
  var SB_URL = window.AMOORE_SUPABASE_URL || "https://wogouiecoigzmxqccnsk.supabase.co";
  var SB_ANON = window.AMOORE_SUPABASE_ANON || "sb_publishable_iGhPrxcxzUuop_bKdy-k7g_zWPzTT8Q";
  var SITES = { dev: "https://amoore-dev.pages.dev/", studio: "https://amoore-studio.pages.dev/", landing: "https://amoore.ru/" };
  var USERNAME_RE = /^[a-z0-9_]{3,24}$/;
  var ROLE_RU = { user: "Пользователь", moderator: "Модератор", admin: "Администратор", super_admin: "Основатель", founder: "Основатель" };
  var ROLE_EN2RU = { founder: "Основатель", cofounder: "Сооснователь", super_admin: "Основатель", superadmin: "Основатель", admin: "Администратор", administrator: "Администратор", moder: "Модератор", moderator: "Модератор", mod: "Модератор", user: "Пользователь" };

  // src/shared/id/state.ts
  var S = {
    sb: null,
    site: "landing",
    profile: null,
    roleOverrides: null
  };

  // src/shared/id/ui.ts
  var AVATAR_COLORS = ["#d4af37", "#8b7cf7", "#3ddc84", "#ff7b7b", "#4cc9f0", "#f78fb3", "#ff9f43", "#6c8cff"];
  function initial(p) {
    var n = String(p && (p.display_name || p.username) || "?").trim();
    return (n.charAt(0) || "?").toUpperCase();
  }
  function avatarEl(p, cls) {
    cls = cls || "aid-av";
    if (p && p.avatar_url) return el("img", { class: cls, alt: "", src: p.avatar_url });
    return el("div", { class: cls + " aid-av-ph", "aria-hidden": "true", text: initial(p), style: "background:" + (p && p.avatar_color || AVATAR_COLORS[0]) });
  }
  async function registerSite(title, url) {
    var u = await user();
    if (!u || !/^https:\/\/[^\s]{3,300}$/i.test(String(url || ""))) return false;
    var r = await S.sb.from("user_sites").upsert({ user_id: u.id, title: String(title || "Сайт").slice(0, 80), url, is_public: true }, { onConflict: "user_id,url" });
    return !r.error;
  }
  function announce(p) {
    try {
      document.dispatchEvent(new CustomEvent("amoore:profile", { detail: p }));
    } catch (e) {
    }
  }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function(k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function(c) {
      if (c) n.appendChild(c);
    });
    return n;
  }
  function err(e) {
    var m = e && e.message || String(e);
    if (/Invalid login/i.test(m)) return "Неверный email или пароль";
    if (/otp|token has expired|invalid/i.test(m)) return "Код неверный или устарел";
    if (/rate limit|too many/i.test(m)) return "Слишком много попыток, подождите немного";
    if (/forbidden/i.test(m)) return "Недостаточно прав";
    if (/username/i.test(m) && /duplicate|unique/i.test(m)) return "Этот username уже занят";
    return m;
  }

  // src/shared/id/profile-data.ts
  async function getProfile(force) {
    if (S.profile && !force) return S.profile;
    var u = await user();
    if (!u) return null;
    var r = await S.sb.from("profiles").select("id,username,avatar_url,role,telegram_id,is_banned,ban_reason,onboarded,rewards_balance,bio,is_public,referred_by,display_name,avatar_color,banner_url,show_telegram,show_points").eq("id", u.id).maybeSingle();
    S.profile = r.data || null;
    window.amooreProfileCache = S.profile;
    if (S.profile) announce(S.profile);
    return S.profile;
  }
  function toWebp(file, size) {
    return new Promise(function(ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function() {
        var c = document.createElement("canvas");
        c.width = c.height = size;
        var s = Math.min(img.width, img.height), ctx = c.getContext("2d");
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        URL.revokeObjectURL(url);
        c.toBlob(function(b) {
          b ? ok(b) : bad(new Error("Не удалось обработать картинку"));
        }, "image/webp", 0.85);
      };
      img.onerror = function() {
        URL.revokeObjectURL(url);
        bad(new Error("Файл не похож на изображение"));
      };
      img.src = url;
    });
  }
  async function saveProfile(username, file, color) {
    var u = await user();
    if (!u) throw new Error("Нужно войти");
    username = (username || "").trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw new Error("Никнейм (username): 3–24 символа, a–z, 0–9 и _");
    var p = await getProfile(), url = p && p.avatar_url;
    if (file) url = await uploadAvatar(file, u);
    color = color || p && p.avatar_color || "";
    if (!url && !color) throw new Error("Загрузите фото или выберите цвет аватарки");
    var patch = { username, avatar_url: url || "" };
    if (color) patch.avatar_color = color;
    var r = await S.sb.from("profiles").update(patch).eq("id", u.id);
    if (r.error) throw new Error(err(r.error));
    await S.sb.rpc("log_event", { p_action: "profile_update" });
    var np = await getProfile(true);
    announce(np);
    return np;
  }
  async function uploadAvatar(file, u) {
    if (file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 МБ");
    var blob = await toWebp(file, 256), path = u.id + "/avatar.webp";
    var up = await S.sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
    if (up.error) throw new Error(err(up.error));
    return S.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
  }

  // src/shared/id/auth.ts
  function init(o) {
    o = o || {};
    S.site = o.site || window.AMOORE_SITE_ID || "landing";
    S.sb = o.sb || window.supabase && window.supabase.createClient(SB_URL, SB_ANON, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "amoore-id-" + S.site }
    });
    api.sb = S.sb;
    return S.sb;
  }
  async function user() {
    var r = await S.sb.auth.getSession();
    return r.data.session ? r.data.session.user : null;
  }
  function sessionId() {
    try {
      return S.sb.auth.getSession().then(function(r) {
        var t = r.data.session && r.data.session.access_token;
        return t ? JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).session_id : null;
      });
    } catch (e) {
      return Promise.resolve(null);
    }
  }
  async function lockLeft(email) {
    var r = await S.sb.rpc("auth_lock_status", { p_email: email });
    return r.error ? 0 : r.data || 0;
  }
  function lockMsg(s) {
    return "Аккаунт временно заблокирован. Повторите через " + Math.ceil(s / 60) + " мин.";
  }
  async function afterLogin() {
    await S.sb.rpc("auth_note_success");
    await S.sb.rpc("register_session");
    return getProfile(true);
  }
  async function signIn(email, password) {
    email = (email || "").trim().toLowerCase();
    var left = await lockLeft(email);
    if (left > 0) throw new Error(lockMsg(left));
    var r = await S.sb.auth.signInWithPassword({ email, password });
    if (r.error) {
      var l2 = await S.sb.rpc("auth_note_failure", { p_email: email });
      if (l2.data > 0) throw new Error(lockMsg(l2.data));
      throw new Error(err(r.error));
    }
    return afterLogin();
  }
  async function sendCode(email, create) {
    var e = (email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Введите корректный email");
    var left = await lockLeft(e);
    if (left > 0) throw new Error(lockMsg(left));
    var r = await S.sb.auth.signInWithOtp({ email: e, options: { shouldCreateUser: !!create } });
    if (r.error) throw new Error(err(r.error));
  }
  async function verifyCode(email, code) {
    var r = await S.sb.auth.verifyOtp({ email: (email || "").trim().toLowerCase(), token: String(code).trim(), type: "email" });
    if (r.error) {
      await S.sb.rpc("auth_note_failure", { p_email: email });
      throw new Error(err(r.error));
    }
    return afterLogin();
  }
  async function signOut() {
    try {
      await S.sb.rpc("log_event", { p_action: "logout" });
    } catch (e) {
    }
    await S.sb.auth.signOut();
    S.profile = null;
  }
  async function consumeUrl() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ""));
    var clean = function() {
      history.replaceState(null, "", location.pathname + location.search);
    };
    if (h.get("access_token") || h.get("refresh_token")) {
      clean();
      return null;
    }
    if (h.get("sso")) {
      var tok = h.get("sso");
      clean();
      var res = await fetch(SB_URL + "/functions/v1/sso-exchange", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SB_ANON },
        body: JSON.stringify({ token: tok, target: S.site })
      });
      var d = await res.json().catch(function() {
        return {};
      });
      if (!res.ok) throw new Error(d.error === "invalid_or_expired" ? "SSO-ссылка устарела, откройте заново" : "SSO не удался");
      var v = await S.sb.auth.verifyOtp({ token_hash: d.token_hash, type: d.type });
      if (v.error) throw new Error(err(v.error));
      return afterLogin();
    }
    return null;
  }
  async function ssoOpen(target) {
    var r = await S.sb.rpc("sso_issue", { p_target: target });
    if (r.error) throw new Error(err(r.error));
    window.open(SITES[target] + "#sso=" + r.data, "_blank", "noopener");
  }

  // src/shared/id/overlay.ts
  var CSS = ".aid-ov{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;padding:max(16px,env(safe-area-inset-top)) 16px max(16px,env(safe-area-inset-bottom));background:rgba(7,11,22,.82);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);font-family:var(--nx-font-body,system-ui,sans-serif)}.aid-card{width:100%;max-width:400px;max-height:90vh;overflow:auto;padding:22px;border-radius:20px;color:var(--nx-ink,#eef0f7);background:var(--nx-modal-bg,rgba(13,18,32,.95));border:var(--nx-glass-border,1px solid rgba(212,175,55,.2));box-shadow:var(--nx-glass-shadow,0 8px 32px rgba(0,0,0,.35))}.aid-card h2{margin:0 0 6px;font:700 calc(20px * var(--fs, 1)) var(--nx-font-head,system-ui)}.aid-card p{margin:0 0 14px;font-size:calc(13px * var(--fs, 1));color:var(--nx-muted,#8b90a5)}.aid-card input[type=text]{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(212,175,55,.25);background:rgba(255,255,255,.05);color:inherit;font-size:calc(16px * var(--fs, 1));margin-bottom:12px}.aid-btn{width:100%;padding:12px;border:0;border-radius:12px;font-weight:700;font-size:calc(15px * var(--fs, 1));cursor:pointer;color:#17151d;background:var(--nx-btn-gradient,#d4af37);transition:transform .35s cubic-bezier(.34,1.56,.64,1)}.aid-btn:active{transform:scale(.96)}.aid-btn[disabled]{opacity:.6}.aid-ghost{background:transparent;color:var(--nx-muted,#8b90a5);border:1px solid rgba(212,175,55,.2);margin-top:8px}.aid-err{min-height:18px;color:#ff7b7b;font-size:calc(13px * var(--fs, 1));margin:0 0 8px}.aid-av{width:84px;height:84px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.08);display:block;margin:0 auto 12px;border:2px solid rgba(212,175,55,.4)}.aid-wide{max-width:520px}/* вкладки .aid-tabs — единый компонент «Пилюли» в amoore-theme.css (v5.5) */.aid-f{display:block;margin:0 0 12px}.aid-f>span{display:block;font-size:calc(12px * var(--fs, 1));color:var(--nx-muted,#8b90a5);margin-bottom:4px}.aid-inl{display:flex;align-items:center;gap:10px}.aid-card textarea,.aid-card input[type=password],.aid-card input[readonly]{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid rgba(212,175,55,.25);background:rgba(255,255,255,.05);color:inherit;font:calc(16px * var(--fs, 1)) var(--nx-font-body,system-ui);margin-bottom:12px;resize:vertical}.aid-hint{font-size:calc(12px * var(--fs, 1));color:var(--nx-muted,#8b90a5);margin:6px 0 12px;overflow-wrap:anywhere}.aid-hint a{color:inherit}.aid-big{font:700 calc(28px * var(--fs, 1)) var(--nx-font-head,system-ui);margin:4px 0 8px}.aid-x{border:0;background:none;color:inherit;font-size:calc(22px * var(--fs, 1));line-height:1;cursor:pointer;padding:0 6px}.aid-row{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid rgba(212,175,55,.12);font-size:calc(13px * var(--fs, 1))}.aid-row small{color:var(--nx-muted,#8b90a5)}.aid-av-ph{display:flex;align-items:center;justify-content:center;font:800 calc(34px * var(--fs, 1)) var(--nx-font-head,system-ui);color:#17151d;border-color:rgba(255,255,255,.25)}.aid-pal{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}.aid-sw-c{width:30px;height:30px;border-radius:50%;border:2px solid transparent;cursor:pointer;padding:0;box-shadow:0 0 0 1px rgba(255,255,255,.2)}.aid-sw-c.on{border-color:#fff;box-shadow:0 0 0 2px rgba(212,175,55,.9)}.aid-inline{max-width:100%;max-height:none;overflow:visible;box-shadow:none;border:0;background:transparent;padding:0}.aid-role{display:inline-block;padding:3px 12px;border-radius:999px;font:700 calc(12px * var(--fs, 1)) var(--nx-font-body,system-ui);background:rgba(212,175,55,.16);color:var(--nx-gold,#d4af37);border:1px solid rgba(212,175,55,.35)}.aid-center{text-align:center}.aid-card input,.aid-card textarea,.aid-card select{box-sizing:border-box;max-width:100%}.aid-card{overflow-x:hidden}.aid-send{margin:-2px 0 12px;background:transparent;color:inherit;border:1px solid rgba(212,175,55,.45)}.aid-codebox{margin:0 0 4px}.aid-codebox input{letter-spacing:.35em;text-align:center;font-weight:700}.aid-white{margin-top:10px;background:#fff;color:#17151d;border:1px solid rgba(0,0,0,.12)}.aid-btn.aid-sm{width:auto;min-height:0;padding:7px 16px;font-size:calc(13px * var(--fs, 1));border-radius:10px}.aid-card .aid-f{width:100%;min-width:0}.aid-card .aid-f input,.aid-card .aid-f textarea{display:block;width:100%;margin-bottom:0}.aid-card .aid-f+.aid-f{margin-top:14px}.aid-card .aid-av{flex:none;margin-left:auto;margin-right:auto}.aid-card .aid-center{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:14px}.aid-card .aid-center>*{margin-top:0;margin-bottom:0}.aid-card .aid-f.aid-inl{display:flex;flex-flow:row nowrap;align-items:center;justify-content:space-between;gap:12px;min-height:44px;padding:4px 0}.aid-card .aid-f.aid-inl>span{flex:1 1 auto;min-width:0;margin:0;font-size:calc(14px * var(--fs, 1));color:inherit;overflow-wrap:anywhere}.aid-card .aid-f.aid-inl>.aid-sw{order:2}.aid-banner{width:100%;height:110px;border-radius:16px;background:linear-gradient(120deg,#d4af37 0%,#8a5cf6 55%,#2dd4bf 100%);background-size:cover;background-position:center}.aid-banwrap{margin-bottom:8px}.aid-link{display:block;margin:-4px 0 10px;padding:0;border:0;background:none;color:var(--nx-gold,#d4af37);font-size:calc(13px * var(--fs, 1));cursor:pointer;text-align:left;text-decoration:underline}.aid-sel,.aid-card textarea,.aid-search{width:100%;box-sizing:border-box;padding:11px 12px;margin-bottom:8px;border-radius:12px;border:1px solid rgba(139,144,165,.32);background:transparent;color:inherit;font-size:calc(16px * var(--fs, 1))}.aid-person{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:14px;text-decoration:none;color:inherit;border:1px solid rgba(139,144,165,.22);margin-bottom:6px;min-width:0}.aid-person span{display:flex;flex-direction:column;min-width:0}.aid-person b,.aid-person small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.aid-person:hover{border-color:rgba(212,175,55,.6)}.aid-btnrow{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}.aid-pill{padding:7px 16px;border-radius:999px;font-weight:600;font-size:calc(13px * var(--fs, 1));cursor:pointer;color:inherit;background:rgba(139,144,165,.16);border:1px solid rgba(139,144,165,.32)}.aid-pill:hover{background:rgba(139,144,165,.26)}.aid-soon{padding:22px 16px;text-align:center;border-radius:16px;border:1px dashed rgba(139,144,165,.4);margin-top:12px}.aid-soon p{margin:6px 0 0;font-size:calc(13px * var(--fs, 1));opacity:.75}.aid-toast{position:fixed;left:50%;bottom:calc(110px + env(safe-area-inset-bottom));transform:translate(-50%,20px);opacity:0;z-index:100000;padding:12px 22px;border-radius:999px;font-weight:700;color:#17151d;background:var(--nx-btn-gradient,#d4af37);box-shadow:0 12px 32px rgba(0,0,0,.35);transition:all .35s ease}.aid-toast.on{opacity:1;transform:translate(-50%,0)}@media (max-width:420px){.aid-card{padding:18px 14px}.aid-ov{padding-left:10px;padding-right:10px}}";
  function ensureCss() {
    if (!document.getElementById("aid-css")) {
      var s = el("style", { id: "aid-css" });
      s.textContent = CSS;
      document.head.appendChild(s);
    }
  }
  function overlay(card) {
    ensureCss();
    var ov = el("div", { class: "aid-ov", role: "dialog", "aria-modal": "true" }, [card]);
    document.body.appendChild(ov);
    return ov;
  }

  // src/shared/id/onboarding.ts
  var OB_KEY = "amoore_onboarded_";
  function hasUsername(p) {
    return !!(p && String(p.username || "").trim());
  }
  function isOnboarded(p) {
    return !!(p && (p.onboarded || hasUsername(p)));
  }
  function obFlag(uid, set) {
    try {
      if (set) localStorage.setItem(OB_KEY + uid, "1");
      return localStorage.getItem(OB_KEY + uid) === "1";
    } catch (e) {
      return false;
    }
  }
  function ensureOnboarded() {
    return getProfile(true).then(function(p) {
      if (!p) return null;
      if (p.is_banned) {
        alert("Аккаунт заблокирован" + (p.ban_reason ? ": " + p.ban_reason : ""));
        return signOut().then(function() {
          return null;
        });
      }
      if (isOnboarded(p)) {
        obFlag(p.id, true);
        return p;
      }
      if (obFlag(p.id)) return p;
      return new Promise(function(done) {
        var picked = null, color = p.avatar_color || AVATAR_COLORS[0], avWrap = el("div", { class: "aid-center" });
        function paintAv() {
          avWrap.textContent = "";
          avWrap.appendChild(avatarEl({ username: name.value || p.username, avatar_url: picked ? URL.createObjectURL(picked) : p.avatar_url, avatar_color: color }));
        }
        var file = el("input", { type: "file", accept: "image/*", hidden: "" }), name = el("input", { type: "text", placeholder: "никнейм (латиницей)", maxlength: "24", autocomplete: "off", autocapitalize: "none" });
        name.value = p.username || "";
        var msg = el("div", { class: "aid-err", role: "alert" });
        file.addEventListener("change", function() {
          picked = file.files[0] || null;
          paintAv();
        });
        name.addEventListener("input", function() {
          if (!picked && !p.avatar_url) paintAv();
        });
        var pal = el("div", { class: "aid-pal", role: "radiogroup", "aria-label": "Цвет аватарки" });
        AVATAR_COLORS.forEach(function(c) {
          pal.appendChild(el("button", { type: "button", class: "aid-sw-c" + (c === color ? " on" : ""), style: "background:" + c, "aria-label": "Цвет " + c, onclick: function() {
            color = c;
            Array.prototype.forEach.call(pal.children, function(b) {
              b.classList.toggle("on", b.style.background === c || b.getAttribute("aria-label") === "Цвет " + c);
            });
            paintAv();
          } }));
        });
        paintAv();
        var go = el("button", { class: "aid-btn", type: "button", text: "Продолжить" });
        go.addEventListener("click", function() {
          go.disabled = true;
          msg.textContent = "";
          saveProfile(name.value, picked, picked || p.avatar_url ? "" : color).then(function(np) {
            obFlag(np.id, true);
            ov.remove();
            done(np);
          }).catch(function(e) {
            msg.textContent = err(e);
            go.disabled = false;
          });
        });
        var out = el("button", { class: "aid-btn aid-ghost", type: "button", text: "Выйти", onclick: function() {
          signOut().then(function() {
            ov.remove();
            done(null);
          });
        } });
        var ov = overlay(el("div", { class: "aid-card" }, [
          el("h2", { text: "Добро пожаловать в amoore" }),
          el("p", { text: "Выберите никнейм и аватарку: загрузите фото или просто выберите цвет — без этого внутренние функции недоступны." }),
          avWrap,
          el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "Загрузить фото", onclick: function() {
            file.click();
          } }),
          file,
          el("div", { style: "height:12px" }),
          pal,
          name,
          msg,
          go,
          out
        ]));
      });
    });
  }

  // src/shared/id/profile-helpers.ts
  var TABS = [["system", "Системные"], ["profile", "Профиль"], ["bot", "Бот"]];
  var TAB_ALIAS = { business: ["bot", "business"], rewards: ["profile", "rewards"], follows: ["profile", "follows"], security: ["profile", "security"], notify: ["system", "notify"] };
  function fmtDt(d) {
    return new Date(d).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function field(label, node) {
    return el("label", { class: "aid-f" }, [el("span", { text: label }), node]);
  }
  function toggle(on, onchange) {
    var cb = el("input", { type: "checkbox", role: "switch", class: "aid-sw" });
    cb.checked = !!on;
    cb.addEventListener("change", function() {
      onchange && onchange(cb.checked);
    });
    return cb;
  }
  function shareUrl(p) {
    return location.origin + "/?ref=" + encodeURIComponent(p.username || "");
  }
  function publicUrl(p) {
    return location.origin + "/#u/" + encodeURIComponent(p.username || "");
  }
  async function copy(text, msg, ok) {
    try {
      await navigator.clipboard.writeText(text);
      msg.style.color = "#3ddc84";
      msg.textContent = ok || "Скопировано";
    } catch (e) {
      msg.style.color = "";
      msg.textContent = text;
    }
  }
  function say(msg, text, good) {
    msg.style.color = good ? "#3ddc84" : "";
    msg.textContent = text || "";
  }

  // src/shared/appearance.ts
  var KEY_TEXT = "amoore_text_size";
  var KEY_GLASS = "amoore_glass";
  var TEXT_STEPS = [0.82, 0.88, 0.92, 1, 1.08, 1.16, 1.26];
  var DEFAULT_TEXT_STEP = 2;
  var DEFAULT_GLASS = 50;
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch (e) {
    }
  }
  function getTextStep() {
    const n = parseInt(lsGet(KEY_TEXT), 10);
    return n >= 0 && n < TEXT_STEPS.length ? n : DEFAULT_TEXT_STEP;
  }
  function getGlass() {
    const n = parseInt(lsGet(KEY_GLASS), 10);
    return n >= 0 && n <= 100 ? n : DEFAULT_GLASS;
  }
  function applyAppearance() {
    const root = document.documentElement;
    root.style.setProperty("--fs", String(TEXT_STEPS[getTextStep()]));
    root.style.setProperty("--glass-k", String(getGlass() / 100));
  }
  function setTextStep(i) {
    lsSet(KEY_TEXT, String(i));
    applyAppearance();
  }
  function setGlass(v) {
    lsSet(KEY_GLASS, String(v));
    applyAppearance();
  }
  function resetAppearance() {
    try {
      localStorage.removeItem(KEY_TEXT);
      localStorage.removeItem(KEY_GLASS);
    } catch (e) {
    }
    applyAppearance();
  }
  var ICON_GLASS_CLEAR = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="7" width="13" height="10" rx="3.5"/><rect x="8" y="10" width="13" height="10" rx="3.5"/></svg>';
  var ICON_GLASS_TINT = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="3" y="7" width="13" height="10" rx="3.5" opacity=".55"/><rect x="8" y="10" width="13" height="10" rx="3.5"/></svg>';
  function mk(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function svgEl(markup) {
    return document.importNode(new DOMParser().parseFromString(markup, "image/svg+xml").documentElement, true);
  }
  function iconSpan(markup) {
    const s = mk("span", "ap-ico");
    s.appendChild(svgEl(markup));
    return s;
  }
  function appearanceControls() {
    const wrap = mk("div", "ap-wrap");
    const t = mk("div", "ap-card");
    const tRow = mk("div", "ap-row");
    const small = mk("span", "ap-a ap-a-s", "A"), big = mk("span", "ap-a ap-a-l", "A");
    const tr = document.createElement("input");
    tr.type = "range";
    tr.className = "ap-range";
    tr.min = "0";
    tr.max = String(TEXT_STEPS.length - 1);
    tr.step = "1";
    tr.value = String(getTextStep());
    tr.setAttribute("aria-label", "Размер текста");
    tr.id = "ap-text";
    const ticks = mk("div", "ap-ticks");
    for (let i = 0; i < TEXT_STEPS.length; i++) ticks.appendChild(mk("i"));
    const track = mk("div", "ap-track");
    track.appendChild(tr);
    track.appendChild(ticks);
    tRow.appendChild(small);
    tRow.appendChild(track);
    tRow.appendChild(big);
    t.appendChild(tRow);
    const sample = mk("p", "ap-sample", "Так будет выглядеть текст на сайте.");
    const paintT = () => tr.style.setProperty("--ap-p", parseInt(tr.value, 10) / (TEXT_STEPS.length - 1) * 100 + "%");
    paintT();
    tr.addEventListener("input", () => {
      setTextStep(parseInt(tr.value, 10));
      paintT();
    });
    wrap.appendChild(mk("h3", "ap-h", "Размер текста"));
    wrap.appendChild(t);
    wrap.appendChild(sample);
    const g = mk("div", "ap-card");
    const gRow = mk("div", "ap-row");
    const gl = iconSpan(ICON_GLASS_CLEAR), gr = iconSpan(ICON_GLASS_TINT);
    const gi = document.createElement("input");
    gi.type = "range";
    gi.className = "ap-range";
    gi.min = "0";
    gi.max = "100";
    gi.step = "1";
    gi.value = String(getGlass());
    gi.setAttribute("aria-label", "Эффект стекла");
    gi.id = "ap-glass";
    const gTrack = mk("div", "ap-track");
    gTrack.appendChild(gi);
    gRow.appendChild(gl);
    gRow.appendChild(gTrack);
    gRow.appendChild(gr);
    g.appendChild(gRow);
    const paintG = () => gi.style.setProperty("--ap-p", gi.value + "%");
    paintG();
    gi.addEventListener("input", () => {
      setGlass(parseInt(gi.value, 10));
      paintG();
    });
    const cap = mk("div", "ap-cap");
    cap.appendChild(mk("span", "", "Прозрачный"));
    cap.appendChild(mk("span", "", "Плотный"));
    wrap.appendChild(mk("h3", "ap-h", "Эффект стекла"));
    wrap.appendChild(g);
    wrap.appendChild(cap);
    wrap.appendChild(mk("p", "ap-note", "Прозрачный — больше просвечивает фон, плотный — выше контраст текста и элементов."));
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "aid-pill ap-reset";
    reset.textContent = "Сбросить";
    reset.addEventListener("click", () => {
      resetAppearance();
      tr.value = String(DEFAULT_TEXT_STEP);
      gi.value = String(DEFAULT_GLASS);
      paintT();
      paintG();
    });
    wrap.appendChild(reset);
    return wrap;
  }

  // src/shared/id/devices.ts
  async function listSessions() {
    var r = await S.sb.from("user_sessions").select("id,user_agent,ip,created_at,last_seen_at").order("last_seen_at", { ascending: false });
    if (r.error) throw new Error(err(r.error));
    return r.data;
  }
  async function revokeOthers() {
    var r = await S.sb.rpc("revoke_other_sessions");
    if (r.error) throw new Error(err(r.error));
    return r.data;
  }
  async function linkTelegram(code) {
    var r = await S.sb.rpc("claim_telegram_code", { input_code: String(code).trim() });
    if (r.error) throw new Error(err(r.error));
    return r.data;
  }
  function ua(s) {
    s = s || "";
    var b = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "Браузер";
    var o = /iPhone|iPad/.test(s) ? "iOS" : /Android/.test(s) ? "Android" : /Windows/.test(s) ? "Windows" : /Mac OS/.test(s) ? "macOS" : /Linux/.test(s) ? "Linux" : "";
    return b + (o ? " · " + o : "");
  }

  // src/shared/id/roles.ts
  function ruLabel(v, role) {
    var t = String(v == null ? "" : v).trim();
    if (!t) return ROLE_RU[role] || role;
    var k = t.toLowerCase();
    return ROLE_EN2RU[k] || t;
  }
  function roleRu(role) {
    return ruLabel(S.roleOverrides && S.roleOverrides[role] || ROLE_RU[role] || ROLE_EN2RU[String(role).toLowerCase()] || role, role);
  }
  function loadRoleLabels() {
    if (S.roleOverrides || !S.sb) return Promise.resolve();
    return Promise.resolve(S.sb.from("global_settings").select("value").eq("key", "role_labels").maybeSingle()).then(function(r) {
      S.roleOverrides = r && r.data && r.data.value && typeof r.data.value === "object" ? r.data.value : {};
    }, function() {
      S.roleOverrides = {};
    });
  }

  // src/shared/id/social.ts
  async function uploadBanner(file, u) {
    if (file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 МБ");
    var url = URL.createObjectURL(file), img = new Image();
    await new Promise(function(ok, bad) {
      img.onload = ok;
      img.onerror = function() {
        bad(new Error("Не удалось прочитать картинку"));
      };
      img.src = url;
    });
    var W = 1200, H = 400, c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    var k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k;
    c.getContext("2d").drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
    URL.revokeObjectURL(url);
    var blob = await new Promise(function(ok) {
      c.toBlob(ok, "image/webp", 0.85);
    });
    var path = u.id + "/banner.webp";
    var up = await S.sb.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
    if (up.error) throw new Error(err(up.error));
    return S.sb.storage.from("avatars").getPublicUrl(path).data.publicUrl + "?v=" + Date.now();
  }
  function bannerEl(url) {
    var d = el("div", { class: "aid-banner" });
    if (/^https:\/\//.test(url || "")) d.style.backgroundImage = 'url("' + url.replace(/"/g, "%22") + '")';
    return d;
  }
  function openSupport(prefillEmail) {
    var msg = el("div", { class: "aid-err", role: "status" }), ov;
    var name = el("input", { type: "text", maxlength: "80", placeholder: "Как к вам обращаться?", autocomplete: "name" });
    var prob = el("textarea", { maxlength: "1000", rows: "3", placeholder: "В чём проблема? (кратко)" });
    var way = el("select", { class: "aid-sel" }, [el("option", { value: "Email", text: "Email" }), el("option", { value: "Телефон", text: "Телефон" }), el("option", { value: "Telegram", text: "Telegram" })]);
    var con = el("input", { type: "text", maxlength: "120", placeholder: "Ваш контакт", autocapitalize: "none", spellcheck: "false" });
    if (prefillEmail) con.value = prefillEmail;
    var send = el("button", { class: "aid-btn", type: "button", text: "Отправить" });
    function shut() {
      ov.remove();
    }
    send.addEventListener("click", async function() {
      if (name.value.trim().length < 2 || !prob.value.trim() || !con.value.trim()) {
        say(msg, "Заполните все поля");
        return;
      }
      send.disabled = true;
      say(msg, "");
      var r = await S.sb.from("leads").insert({ name: name.value.trim().slice(0, 120), contact: (way.value + ": " + con.value.trim()).slice(0, 200), message: prob.value.trim().slice(0, 2e3), status: "new", tags: ["access"] });
      send.disabled = false;
      if (r.error) {
        say(msg, "Не удалось отправить. Попробуйте позже.");
        return;
      }
      say(msg, "Заявка отправлена — ответим лично", true);
      setTimeout(shut, 1600);
    });
    ov = overlay(el("div", { class: "aid-card" }, [
      el("h2", { text: "Нет доступа к почте?", style: "font-size:calc(18px * var(--fs, 1));margin:0 0 6px" }),
      el("p", { class: "aid-hint", text: "Опишите ситуацию — мы свяжемся с вами и поможем восстановить доступ." }),
      name,
      prob,
      way,
      con,
      msg,
      send,
      el("button", { class: "aid-btn aid-ghost", type: "button", text: "Закрыть", onclick: shut })
    ]));
    ov.addEventListener("click", function(e) {
      if (e.target === ov) shut();
    });
  }
  function personRow(x) {
    var a = el("a", { class: "aid-person", href: "#u/" + encodeURIComponent(x.username) }, [avatarEl({ username: x.username, display_name: x.display_name, avatar_url: x.avatar_url, avatar_color: x.avatar_color }), el("span", {}, [el("b", { text: x.display_name || x.username }), el("small", { text: "@" + x.username })])]);
    return a;
  }
  function peopleSearch() {
    var inp = el("input", { type: "search", maxlength: "40", placeholder: "Поиск людей по имени или username", autocomplete: "off", class: "aid-search" }), res = el("div", { class: "aid-results" }), tm = null;
    inp.addEventListener("input", function() {
      clearTimeout(tm);
      var q = inp.value.trim();
      if (q.length < 2) {
        res.textContent = "";
        return;
      }
      tm = setTimeout(async function() {
        var r = await S.sb.rpc("search_profiles", { p_q: q });
        res.textContent = "";
        if (r.error || !r.data || !r.data.length) {
          res.appendChild(el("p", { class: "aid-hint", text: "Никого не найдено" }));
          return;
        }
        r.data.forEach(function(x) {
          res.appendChild(personRow(x));
        });
      }, 250);
    });
    return el("div", { class: "aid-people" }, [inp, res]);
  }
  var people = {
    list: async function() {
      var r = await S.sb.rpc("admin_list_people");
      if (r.error) throw new Error(err(r.error));
      return r.data;
    },
    ban: async function(id, reason) {
      var r = await S.sb.rpc("admin_ban_user", { p_user: id, p_reason: reason });
      if (r.error) throw new Error(err(r.error));
    },
    unban: async function(id) {
      var r = await S.sb.rpc("admin_unban_user", { p_user: id });
      if (r.error) throw new Error(err(r.error));
    },
    setRole: async function(id, role) {
      var r = await S.sb.rpc("admin_set_role", { p_user: id, p_role: role });
      if (r.error) throw new Error(err(r.error));
      return r.data;
    }
  };

  // src/shared/id/profile-tabs.ts
  async function tabProfile(p, box, reload) {
    await loadRoleLabels();
    var msg = el("div", { class: "aid-err", role: "status" });
    var color = p.avatar_color || AVATAR_COLORS[0], avWrap = el("div", { class: "aid-center" });
    function paintAv() {
      avWrap.textContent = "";
      avWrap.appendChild(avatarEl({ username: p.username, display_name: nick.value || p.display_name, avatar_url: p.avatar_url, avatar_color: color }));
    }
    var nick = el("input", { type: "text", maxlength: "40", placeholder: "Как вас называть", autocomplete: "nickname", id: "aid-nick" });
    nick.value = p.display_name || "";
    var bio = el("textarea", { maxlength: "300", rows: "3", placeholder: "Коротко о себе (до 300 символов)" });
    bio.value = p.bio || "";
    var pub = toggle(p.is_public, null);
    var file = el("input", { type: "file", accept: "image/*", hidden: "" });
    var pal = el("div", { class: "aid-pal", role: "radiogroup", "aria-label": "Цвет аватарки" });
    AVATAR_COLORS.forEach(function(c) {
      pal.appendChild(el("button", { type: "button", class: "aid-sw-c" + (c === color ? " on" : ""), "data-c": c, style: "background:" + c, "aria-label": "Цвет " + c, onclick: function() {
        color = c;
        Array.prototype.forEach.call(pal.children, function(b2) {
          b2.classList.toggle("on", b2.getAttribute("data-c") === c);
        });
        paintAv();
      } }));
    });
    nick.addEventListener("input", paintAv);
    file.addEventListener("change", function() {
      var f = file.files && file.files[0];
      if (!f) return;
      say(msg, "Загружаю фото…");
      user().then(function(u) {
        return uploadAvatar(f, u);
      }).then(function(url) {
        return S.sb.from("profiles").update({ avatar_url: url }).eq("id", p.id).then(function(r) {
          if (r.error) throw r.error;
          p.avatar_url = url;
          paintAv();
          say(msg, "Фото обновлено", true);
          return getProfile(true).then(announce);
        });
      }).catch(function(e) {
        say(msg, err(e));
      });
    });
    paintAv();
    var banWrap = el("div", { class: "aid-banwrap" }), banFile = el("input", { type: "file", accept: "image/*", hidden: "" });
    function paintBan() {
      banWrap.textContent = "";
      banWrap.appendChild(bannerEl(p.banner_url));
    }
    banFile.addEventListener("change", function() {
      var f = banFile.files && banFile.files[0];
      if (!f) return;
      say(msg, "Загружаю обложку…");
      user().then(function(u) {
        return uploadBanner(f, u);
      }).then(function(url) {
        return S.sb.from("profiles").update({ banner_url: url }).eq("id", p.id).then(function(r) {
          if (r.error) throw r.error;
          p.banner_url = url;
          paintBan();
          say(msg, "Обложка обновлена", true);
        });
      }).catch(function(e) {
        say(msg, err(e));
      });
    });
    paintBan();
    box.appendChild(banWrap);
    box.appendChild(el("div", { class: "aid-btnrow" }, [
      el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "Загрузить обложку", onclick: function() {
        banFile.click();
      } }),
      p.banner_url ? el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "Убрать", onclick: function() {
        S.sb.from("profiles").update({ banner_url: null }).eq("id", p.id).then(function(r) {
          if (r.error) return say(msg, err(r.error));
          p.banner_url = null;
          paintBan();
        });
      } }) : null
    ].filter(Boolean)));
    box.appendChild(banFile);
    box.appendChild(avWrap);
    box.appendChild(el("div", { class: "aid-center", style: "margin:0 0 12px" }, [el("h2", { text: p.display_name || "@" + (p.username || "—"), style: "margin:0 0 6px" }), el("span", { class: "aid-role", id: "aid-role", text: roleRu(p.role) })]));
    box.appendChild(el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "Загрузить фото", onclick: function() {
      file.click();
    } }));
    box.appendChild(file);
    if (p.avatar_url) box.appendChild(el("button", { class: "aid-btn aid-ghost", type: "button", text: "Убрать фото (будет цвет)", onclick: function() {
      S.sb.from("profiles").update({ avatar_url: "", avatar_color: color }).eq("id", p.id).then(function(r) {
        if (r.error) return say(msg, err(r.error));
        p.avatar_url = "";
        paintAv();
        getProfile(true).then(announce);
        reload && reload();
      });
    } }));
    box.appendChild(el("p", { class: "aid-hint", text: "Цвет аватарки (если нет фото):", style: "margin-top:14px" }));
    box.appendChild(pal);
    var uname = el("input", { type: "text", maxlength: "24", placeholder: "username", autocapitalize: "none", spellcheck: "false", id: "aid-username" });
    uname.value = p.username || "";
    box.appendChild(field("Никнейм", nick));
    box.appendChild(field("Имя пользователя (username)", uname));
    box.appendChild(el("p", { class: "aid-hint", text: "Только a–z, 0–9 и _, уникальное. Ссылка на профиль: /u/username" }));
    box.appendChild(field("О себе", bio));
    var showTg = toggle(p.show_telegram, null), showPts = toggle(p.show_points, null);
    box.appendChild(el("label", { class: "aid-f aid-inl" }, [pub, el("span", { text: "Публичная страница профиля" })]));
    box.appendChild(el("label", { class: "aid-f aid-inl" }, [showTg, el("span", { text: "Показывать Telegram" })]));
    box.appendChild(el("label", { class: "aid-f aid-inl" }, [showPts, el("span", { text: "Показывать баллы" })]));
    if (!p.telegram_id) box.appendChild(el("p", { class: "aid-hint", text: "Кнопка «Написать в Telegram» появится, когда бот будет привязан (/link)." }));
    box.appendChild(el("p", { class: "aid-hint" }, [el("a", { href: publicUrl(p), text: publicUrl(p) })]));
    box.appendChild(el("button", { class: "aid-btn", type: "button", id: "aid-save", text: "Сохранить", onclick: function() {
      var dn = nick.value.trim().slice(0, 40), un = uname.value.trim().toLowerCase();
      if (!USERNAME_RE.test(un)) return say(msg, "Username: 3–24 символа, a–z, 0–9 и _");
      S.sb.from("profiles").update({ display_name: dn || null, username: un, avatar_color: color, bio: bio.value.trim().slice(0, 300), is_public: pub.checked, show_telegram: showTg.checked, show_points: showPts.checked }).eq("id", p.id).then(function(r) {
        if (r.error) return say(msg, /duplicate|unique|23505/i.test(String(r.error.message || r.error.code)) ? "Этот username уже занят" : err(r.error));
        S.sb.rpc("log_event", { p_action: "profile_update" }).then(function() {
        });
        say(msg, "Сохранено", true);
        return getProfile(true).then(announce);
      });
    } }));
    box.appendChild(el("h2", { text: "Мои сайты", style: "font-size:calc(16px * var(--fs, 1));margin-top:18px" }));
    box.appendChild(el("p", { text: "Публичные сайты показываются на вашей странице профиля. Только https://", class: "aid-hint" }));
    var list = el("div");
    async function paintSites() {
      list.textContent = "";
      var r = await S.sb.from("user_sites").select("id,title,url,is_public").order("created_at", { ascending: false });
      if (r.error) return say(msg, err(r.error));
      (r.data || []).forEach(function(s2) {
        var vis = toggle(s2.is_public, function(v) {
          S.sb.from("user_sites").update({ is_public: v }).eq("id", s2.id).then(function(x) {
            if (x.error) say(msg, err(x.error));
          });
        });
        list.appendChild(el("div", { class: "aid-row" }, [
          el("div", { style: "min-width:0" }, [el("div", { text: s2.title }), el("small", { text: s2.url, style: "overflow-wrap:anywhere" })]),
          el("div", { class: "aid-inl" }, [vis, el("button", { class: "aid-x", type: "button", "aria-label": "Удалить сайт", text: "×", onclick: function() {
            S.sb.from("user_sites").delete().eq("id", s2.id).then(paintSites);
          } })])
        ]));
      });
    }
    box.appendChild(list);
    var st = el("input", { type: "text", maxlength: "80", placeholder: "Название сайта" }), su = el("input", { type: "text", inputmode: "url", maxlength: "300", placeholder: "https://…", autocapitalize: "none" });
    box.appendChild(st);
    box.appendChild(su);
    box.appendChild(el("button", { class: "aid-btn aid-ghost", type: "button", text: "Добавить сайт", onclick: function() {
      if (!/^https:\/\/[^\s]{3,300}$/i.test(su.value.trim()) || !st.value.trim()) return say(msg, "Укажите название и адрес, начинающийся с https://");
      S.sb.from("user_sites").insert({ title: st.value.trim(), url: su.value.trim(), is_public: true }).then(function(r) {
        if (r.error) return say(msg, err(r.error));
        st.value = "";
        su.value = "";
        say(msg, "");
        paintSites();
      });
    } }));
    paintSites();
    box.appendChild(el("h2", { text: "Телеграм", style: "font-size:calc(16px * var(--fs, 1));margin-top:18px" }));
    var code = el("input", { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "6-значный код из бота (/link)", autocomplete: "one-time-code" });
    if (p.telegram_id) box.appendChild(el("p", { text: "Телеграм привязан ✓ (ID " + p.telegram_id + ")" }));
    else {
      box.appendChild(el("p", { class: "aid-hint", text: "Откройте бота, отправьте ему /link в личных сообщениях и введите полученный код." }));
      box.appendChild(code);
      box.appendChild(el("button", { class: "aid-btn", type: "button", text: "Привязать Телеграм", onclick: function() {
        linkTelegram(code.value).then(reload).catch(function(e) {
          say(msg, err(e));
        });
      } }));
    }
    box.appendChild(msg);
  }
  async function tabBusiness(p, box) {
    box.appendChild(el("h2", { text: "AI Бизнес-ассистент", style: "font-size:calc(18px * var(--fs, 1))" }));
    box.appendChild(el("div", { class: "aid-soon" }, [el("b", { text: "В разработке" }), el("p", { text: "Ассистент для ваших клиентов в Telegram скоро появится. Мы сообщим, когда он будет готов." })]));
  }
  function promoToast(text) {
    var t = el("div", { class: "aid-toast", role: "status", text });
    document.body.appendChild(t);
    requestAnimationFrame(function() {
      t.classList.add("on");
    });
    setTimeout(function() {
      t.classList.remove("on");
      setTimeout(function() {
        t.remove();
      }, 400);
    }, 3200);
  }
  function openPromo(onDone) {
    var msg = el("div", { class: "aid-err", role: "status" });
    var inp = el("input", { type: "text", maxlength: "32", placeholder: "Промокод", autocomplete: "off", autocapitalize: "characters", id: "promo-input" });
    var ov, btn = el("button", { class: "aid-btn", type: "button", text: "Активировать" });
    function shut() {
      ov.remove();
    }
    async function go() {
      var code = inp.value.trim();
      if (!code) {
        say(msg, "Введите промокод");
        return;
      }
      btn.disabled = true;
      say(msg, "");
      var r = await S.sb.rpc("activate_promocode", { p_code: code });
      btn.disabled = false;
      if (r.error) {
        say(msg, err(r.error));
        return;
      }
      var got = r.data && typeof r.data === "object" ? r.data : { points: r.data };
      shut();
      promoToast("+" + got.points + " баллов");
      if (onDone) onDone(got.points, got.balance);
    }
    btn.addEventListener("click", go);
    inp.addEventListener("keydown", function(e) {
      if (e.key === "Enter") go();
    });
    var card = el("div", { class: "aid-card" }, [
      el("h2", { text: "Промокод", style: "font-size:calc(18px * var(--fs, 1));margin:0 0 10px" }),
      inp,
      msg,
      btn,
      el("button", { class: "aid-x", type: "button", "aria-label": "Закрыть", text: "×", onclick: shut, style: "position:absolute;top:10px;right:10px" })
    ]);
    card.style.position = "relative";
    ov = overlay(card);
    ov.addEventListener("click", function(e) {
      if (e.target === ov) shut();
    });
    setTimeout(function() {
      inp.focus();
    }, 50);
  }
  async function tabRewards(p, box) {
    var msg = el("div", { class: "aid-err", role: "status" });
    box.appendChild(el("h2", { text: "Баллы", style: "font-size:calc(18px * var(--fs, 1))" }));
    box.appendChild(el("div", { class: "aid-big", id: "rw-balance", text: String(p.rewards_balance || 0) + " баллов" }));
    box.appendChild(el("p", { text: "Приглашайте друзей: +10 баллов за каждого, кто зарегистрируется по вашей ссылке." }));
    var link = shareUrl(p), inp = el("input", { type: "text", readonly: "", value: link, id: "rw-link", title: link });
    var cp = el("button", { class: "aid-copyicon", type: "button", "aria-label": "Скопировать ссылку", title: "Скопировать ссылку", onclick: function() {
      copy(link, msg, "Ссылка скопирована");
    } });
    cp.appendChild(svgEl('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="3"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>'));
    box.appendChild(el("div", { class: "aid-linkrow" }, [
      el("div", { class: "aid-copyfield" }, [inp, cp]),
      el("button", { class: "aid-pill aid-compact", type: "button", text: "Ввести промокод", onclick: function() {
        openPromo(function(n, bal) {
          p.rewards_balance = bal != null ? bal : (p.rewards_balance || 0) + n;
          var b = document.getElementById("rw-balance");
          if (b) b.textContent = p.rewards_balance + " баллов";
          paintHistory();
        });
      } })
    ]));
    box.appendChild(msg);
    var h = el("div", { class: "aid-hist" });
    box.appendChild(el("h2", { text: "История", style: "font-size:calc(16px * var(--fs, 1));margin-top:12px;margin-bottom:4px" }));
    box.appendChild(h);
    var RS = { referral: "приглашение", promocode: "промокод" };
    async function paintHistory() {
      h.textContent = "";
      var r = await S.sb.from("rewards_log").select("delta,reason,created_at").order("created_at", { ascending: false }).limit(20);
      if (r.error || !r.data || !r.data.length) h.appendChild(el("p", { class: "aid-hint", text: "Пока пусто." }));
      else r.data.forEach(function(x) {
        h.appendChild(el("div", { class: "aid-row" }, [el("div", { text: (x.delta > 0 ? "+" : "") + x.delta + " · " + (RS[x.reason] || x.reason) }), el("small", { text: fmtDt(x.created_at) })]));
      });
    }
    await paintHistory();
  }
  async function tabFollows(p, box) {
    box.appendChild(el("h2", { text: "Люди", style: "font-size:calc(18px * var(--fs, 1))" }));
    box.appendChild(peopleSearch());
    box.appendChild(el("h2", { text: "Мои подписки", style: "font-size:calc(16px * var(--fs, 1));margin-top:16px" }));
    var h = el("div");
    box.appendChild(h);
    var r = await S.sb.rpc("my_following");
    if (r.error || !r.data || !r.data.length) h.appendChild(el("p", { class: "aid-hint", text: "Вы пока ни на кого не подписаны." }));
    else r.data.forEach(function(x) {
      h.appendChild(personRow(x));
    });
  }
  async function tabSecurity(p, box) {
    var cur = await sessionId(), list = el("div"), msg = el("div", { class: "aid-err", role: "status" });
    async function paint() {
      list.textContent = "";
      (await listSessions()).forEach(function(s2) {
        list.appendChild(el("div", { class: "aid-row" }, [el("div", {}, [el("div", { text: ua(s2.user_agent) + (s2.id === cur ? " (это устройство)" : "") }), el("small", { text: s2.ip || "IP скрыт" })]), el("small", { text: fmtDt(s2.last_seen_at) })]));
      });
    }
    box.appendChild(el("h2", { text: "Безопасность", style: "font-size:calc(18px * var(--fs, 1))" }));
    var newEmail = el("input", { type: "text", inputmode: "email", placeholder: "Новый email", autocapitalize: "none", autocomplete: "email", id: "aid-newemail" });
    var emailCode = el("input", { type: "text", inputmode: "numeric", maxlength: "6", placeholder: "Код с новой почты", autocomplete: "one-time-code", hidden: "", id: "aid-emailcode" });
    var emailBtn = el("button", { class: "aid-btn aid-ghost", type: "button", text: "Выслать код на новую почту" }), pendingEmail = "";
    emailBtn.addEventListener("click", async function() {
      emailBtn.disabled = true;
      say(msg, "");
      try {
        if (!pendingEmail) {
          var em = newEmail.value.trim().toLowerCase();
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error("Введите корректный email");
          var u1 = await S.sb.auth.updateUser({ email: em });
          if (u1.error) throw u1.error;
          pendingEmail = em;
          emailCode.hidden = false;
          emailBtn.textContent = "Подтвердить email";
          say(msg, "Код отправлен на " + em, true);
        } else {
          var v = await S.sb.auth.verifyOtp({ email: pendingEmail, token: emailCode.value.trim(), type: "email_change" });
          if (v.error) throw v.error;
          pendingEmail = "";
          emailCode.hidden = true;
          emailCode.value = "";
          newEmail.value = "";
          emailBtn.textContent = "Выслать код на новую почту";
          say(msg, "Email изменён", true);
        }
      } catch (e) {
        say(msg, err(e));
      }
      emailBtn.disabled = false;
    });
    var pw1 = el("input", { type: "password", minlength: "8", placeholder: "Новый пароль (от 8 символов)", autocomplete: "new-password", id: "aid-newpw" });
    var pw2 = el("input", { type: "password", minlength: "8", placeholder: "Повторите пароль", autocomplete: "new-password", id: "aid-newpw2" });
    var pwBtn = el("button", { class: "aid-btn aid-ghost", type: "button", text: "Сменить пароль" });
    pwBtn.addEventListener("click", async function() {
      if (pw1.value.length < 8) return say(msg, "Пароль — от 8 символов");
      if (pw1.value !== pw2.value) return say(msg, "Пароли не совпадают");
      pwBtn.disabled = true;
      var r2 = await S.sb.auth.updateUser({ password: pw1.value });
      pwBtn.disabled = false;
      if (r2.error) return say(msg, err(r2.error));
      pw1.value = "";
      pw2.value = "";
      S.sb.rpc("log_event", { p_action: "password_change" }).then(function() {
      });
      say(msg, "Пароль изменён", true);
    });
    box.appendChild(el("h2", { text: "Смена email", style: "font-size:calc(16px * var(--fs, 1))" }));
    box.appendChild(newEmail);
    box.appendChild(emailCode);
    box.appendChild(emailBtn);
    box.appendChild(el("h2", { text: "Смена пароля", style: "font-size:calc(16px * var(--fs, 1));margin-top:14px" }));
    box.appendChild(pw1);
    box.appendChild(pw2);
    box.appendChild(pwBtn);
    box.appendChild(el("h2", { text: "Устройства", style: "font-size:calc(16px * var(--fs, 1))" }));
    box.appendChild(list);
    box.appendChild(el("button", { class: "aid-btn aid-ghost", type: "button", id: "revoke-others", text: "Завершить все другие сессии", onclick: function() {
      revokeOthers().then(function(n) {
        say(msg, "Завершено сессий: " + n, true);
        return paint();
      }).catch(function(e) {
        say(msg, err(e));
      });
    } }));
    box.appendChild(el("button", { class: "aid-btn aid-ghost", type: "button", id: "revoke-all", text: "Завершить все сессии", onclick: function() {
      if (!window.confirm("Выйти на всех устройствах, включая это?")) return;
      S.sb.rpc("revoke_all_sessions").then(function(r) {
        if (r.error) throw r.error;
        return S.sb.auth.signOut({ scope: "global" });
      }).then(function() {
        location.reload();
      }).catch(function(e) {
        say(msg, err(e));
      });
    } }));
    box.appendChild(msg);
    paint().catch(function(e) {
      say(msg, err(e));
    });
  }
  async function tabNotify(p, box) {
    var msg = el("div", { class: "aid-err", role: "status" }), P = window.amoorePush;
    box.appendChild(el("h2", { text: "Push-уведомления", style: "font-size:calc(18px * var(--fs, 1))" }));
    box.appendChild(el("p", { text: "Получайте уведомление, когда в amoore выходит новость. Для iPhone сначала добавьте сайт на экран «Домой»." }));
    var btn = el("button", { class: "aid-btn", type: "button", id: "push-enable", text: "Разрешить уведомления" });
    if (P && P.configured && !P.configured()) {
      box.appendChild(el("p", { class: "aid-hint", text: "Push-уведомления пока недоступны. Новости появятся в колокольчике на сайте." }));
      return;
    }
    async function refresh() {
      if (!P || !P.supported()) {
        btn.disabled = true;
        btn.textContent = "Не поддерживается в этом браузере";
        return;
      }
      var sub = await P.isSubscribed();
      btn.disabled = false;
      btn.textContent = sub ? "Отключить уведомления" : "Разрешить уведомления";
      btn.dataset.on = sub ? "1" : "";
    }
    btn.addEventListener("click", function() {
      btn.disabled = true;
      say(msg, "");
      (btn.dataset.on ? P.disable(S.sb) : P.enable(S.sb)).then(function() {
        say(msg, btn.dataset.on ? "Уведомления отключены" : "Уведомления включены", true);
      }).catch(function(e) {
        say(msg, err(e));
      }).then(refresh);
    });
    box.appendChild(btn);
    box.appendChild(msg);
    refresh();
  }

  // src/shared/id/profile-blocks.ts
  async function section(box, id, title, build) {
    var s = el("section", { class: "aid-sec", "data-sec": id });
    if (title) s.appendChild(el("h2", { class: "aid-sec-h", text: title }));
    box.appendChild(s);
    try {
      await build(s);
    } catch (e) {
      s.appendChild(el("div", { class: "aid-err", text: e && e.message || String(e) }));
    }
  }
  async function blockSystem(p, box, reload) {
    await section(box, "look", "Внешний вид", async function(s) {
      s.appendChild(appearanceControls());
    });
    var P0 = window.amoorePush;
    if (P0 && P0.supported && P0.supported() && P0.configured && P0.configured()) await section(box, "notify", "Уведомления", function(s) {
      return tabNotify(p, s);
    });
  }
  async function blockProfile(p, box, reload) {
    await section(box, "main", null, function(s) {
      return tabProfile(p, s, reload);
    });
    await section(box, "rewards", null, function(s) {
      return tabRewards(p, s);
    });
    await section(box, "follows", null, function(s) {
      return tabFollows(p, s);
    });
    await section(box, "security", "Безопасность", function(s) {
      return tabSecurity(p, s);
    });
  }
  async function blockBot(p, box, reload) {
    await section(box, "business", null, function(s) {
      return tabBusiness(p, s);
    });
  }

  // src/shared/id/profile.ts
  var BUILD = { system: blockSystem, profile: blockProfile, bot: blockBot };
  async function renderProfile(host, tab, onClose) {
    var p = await getProfile(true);
    if (!p) return null;
    ensureCss();
    await loadRoleLabels();
    var alias = TAB_ALIAS[tab], secId = alias ? alias[1] : null, cur = BUILD[alias ? alias[0] : tab] ? alias ? alias[0] : tab : "profile", body = el("div", { class: "aid-body" }), nav = el("div", { class: "aid-tabs", role: "tablist" });
    var card = el("div", { class: "aid-card aid-wide" + (host ? " aid-inline" : "") }, [nav, body]);
    async function show(t) {
      cur = t;
      body.textContent = "";
      Array.prototype.forEach.call(nav.children, function(b) {
        var on = b.dataset.tab === t;
        b.classList.toggle("on", on);
        b.setAttribute("aria-selected", on ? "true" : "false");
      });
      try {
        await BUILD[t](await getProfile(true), body, function() {
          renderProfile(host, t, onClose);
          if (ov) ov.remove();
        });
      } catch (e) {
        body.appendChild(el("div", { class: "aid-err", text: err(e) }));
      }
      if (secId) {
        var sec = body.querySelector('[data-sec="' + secId + '"]');
        secId = null;
        if (sec && sec.scrollIntoView) sec.scrollIntoView({ block: "start" });
      }
    }
    var inStudio = !!(host && host.id === "studio-profile-host");
    TABS.forEach(function(t) {
      nav.appendChild(el("button", { type: "button", role: "tab", "data-tab": t[0], text: inStudio && t[0] === "profile" ? "Основное" : t[1], onclick: function() {
        show(t[0]);
      } }));
    });
    var ov = null;
    if (host) {
      host.textContent = "";
      host.appendChild(card);
    } else {
      card.appendChild(el("button", { class: "aid-btn aid-ghost", type: "button", text: "Закрыть", onclick: function() {
        ov.remove();
        onClose && onClose();
      } }));
      ov = overlay(card);
    }
    show(cur);
    return card;
  }
  function openProfile(tab) {
    return renderProfile(null, typeof tab === "string" ? tab : "profile");
  }

  // src/shared/id/referral.ts
  var REF_KEY = "amoore_ref";
  function captureRef() {
    try {
      var q = new URLSearchParams(location.search), r = (q.get("ref") || "").trim().toLowerCase();
      if (r && /^[a-z0-9_]{3,24}$/.test(r)) {
        localStorage.setItem(REF_KEY, r);
      }
      if (q.has("ref")) {
        q.delete("ref");
        var qs = q.toString();
        history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
      }
    } catch (e) {
    }
  }
  function pendingRef() {
    try {
      return localStorage.getItem(REF_KEY) || "";
    } catch (e) {
      return "";
    }
  }
  async function claimRef() {
    var r = pendingRef();
    if (!r) return 0;
    try {
      var res = await S.sb.rpc("claim_referral", { p_ref: r });
      if (!res.error) {
        try {
          localStorage.removeItem(REF_KEY);
        } catch (e) {
        }
        return res.data || 0;
      }
    } catch (e) {
    }
    try {
      localStorage.removeItem(REF_KEY);
    } catch (e) {
    }
    return 0;
  }

  // src/shared/id/chip.ts
  async function mountChip() {
    var old = document.getElementById("aid-chip");
    if (old) old.remove();
    return;
    var p = await getProfile(true);
    if (!isOnboarded(p)) return;
    ensureCss();
    var st = document.getElementById("aid-chip-css") || el("style", { id: "aid-chip-css" });
    st.textContent = "#aid-chip>.aid-chip-ph{width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font:800 calc(18px * var(--fs, 1)) system-ui;color:#17151d;background:" + (p.avatar_color || "#d4af37") + ";border:2px solid rgba(212,175,55,.5);cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.35)}#aid-chip{position:fixed;left:max(12px,env(safe-area-inset-left));bottom:max(12px,env(safe-area-inset-bottom));z-index:9990}#aid-chip>img{width:42px;height:42px;border-radius:50%;object-fit:cover;border:2px solid rgba(212,175,55,.5);cursor:pointer;display:block;transition:transform .35s cubic-bezier(.34,1.56,.64,1)}#aid-chip>img:active{transform:scale(.9)}#aid-menu{position:absolute;bottom:52px;left:0;min-width:210px;padding:6px;border-radius:14px;background:var(--nx-modal-bg,rgba(13,18,32,.95));border:var(--nx-glass-border,1px solid rgba(212,175,55,.2));display:none}#aid-menu.open{display:block}#aid-menu button{display:block;width:100%;text-align:left;padding:10px 12px;border:0;background:none;color:var(--nx-ink,#eef0f7);font:calc(14px * var(--fs, 1)) var(--nx-font-body,system-ui);border-radius:10px;cursor:pointer}#aid-menu button:hover{background:rgba(212,175,55,.12)}";
    if (!st.parentNode) document.head.appendChild(st);
    var menu = el("div", { id: "aid-menu" }), items = [["Профиль и устройства", openProfile]];
    if (S.site !== "dev" && /admin|moderator|super_admin/.test(p.role)) items.push(["Открыть Админку", function() {
      return ssoOpen("dev");
    }]);
    if (S.site !== "studio" && p.role !== "user") items.push(["Открыть Студию", function() {
      return ssoOpen("studio");
    }]);
    if (S.site !== "landing") items.push(["Открыть сайт", function() {
      return ssoOpen("landing");
    }]);
    items.push(["Выйти", function() {
      return signOut().then(function() {
        location.reload();
      });
    }]);
    items.forEach(function(it) {
      menu.appendChild(el("button", { type: "button", text: it[0], onclick: function() {
        menu.classList.remove("open");
        Promise.resolve(it[1]()).catch(function(e) {
          alert(err(e));
        });
      } }));
    });
    var img = p.avatar_url ? el("img", { src: p.avatar_url, alt: "@" + p.username, onclick: function() {
      menu.classList.toggle("open");
    } }) : el("div", { class: "aid-chip-ph", text: initial(p), "aria-label": "@" + p.username, onclick: function() {
      menu.classList.toggle("open");
    } });
    document.body.appendChild(el("div", { id: "aid-chip" }, [menu, img]));
  }
  async function postLogin() {
    if (await user()) {
      await register();
      var okp = await ensureOnboarded();
      if (okp) await claimRef();
      await mountChip();
    }
  }
  async function boot(o) {
    init(o);
    try {
      await consumeUrl();
    } catch (e) {
      console.warn("[amoore-id]", e);
    }
    await postLogin();
  }
  async function register() {
    try {
      await S.sb.rpc("register_session");
    } catch (e) {
    }
  }

  // src/shared/id/god.ts
  function godPanel(username, onChange) {
    var box = el("details", { class: "god-box", id: "god-box" }, [el("summary", { text: "Действия администратора" })]);
    var msg = el("div", { class: "aid-err", role: "status" }), info = null, loaded = false;
    var bal = el("div", { class: "aid-big", id: "god-balance", text: "…" });
    var amount = el("input", { type: "number", inputmode: "numeric", min: "1", max: "1000000", placeholder: "Сумма баллов", id: "god-amount" });
    var nick = el("input", { type: "text", maxlength: "40", placeholder: "Никнейм", id: "god-nick" });
    var uname = el("input", { type: "text", maxlength: "24", placeholder: "username", autocapitalize: "none", id: "god-username" });
    var rank = el("input", { type: "text", maxlength: "24", placeholder: "Бейдж ранга (например, Ангел)", id: "god-rank" });
    function need() {
      if (!info) {
        say(msg, "Профиль ещё загружается");
        return false;
      }
      return true;
    }
    async function adjust(sign) {
      if (!need()) return;
      var n = parseInt(amount.value, 10);
      if (!n || n < 1) return say(msg, "Введите сумму больше нуля");
      var r = await S.sb.rpc("admin_adjust_points", { p_user: info.id, p_delta: sign * n, p_reason: sign > 0 ? "начисление" : "списание" });
      if (r.error) return say(msg, err(r.error));
      info.rewards_balance = r.data;
      bal.textContent = r.data + " баллов";
      amount.value = "";
      say(msg, (sign > 0 ? "Начислено: +" : "Списано: −") + n, true);
      if (onChange) onChange({ points: r.data });
    }
    var plus = el("button", { class: "aid-btn aid-sm", type: "button", text: "+ Начислить", onclick: function() {
      adjust(1);
    } });
    var minus = el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "− Списать", onclick: function() {
      adjust(-1);
    } });
    var saveData = el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "Сохранить данные", onclick: async function() {
      if (!need()) return;
      var r = await S.sb.rpc("admin_edit_profile", { p_user: info.id, p_display_name: nick.value, p_username: uname.value });
      if (r.error) return say(msg, err(r.error));
      info.username = r.data.username;
      say(msg, "Сохранено. Новая ссылка: /u/" + r.data.username, true);
      if (onChange) onChange({ username: r.data.username, display_name: r.data.display_name });
    } });
    var saveRank = el("button", { class: "aid-btn aid-ghost aid-sm", type: "button", text: "Сохранить бейдж", onclick: async function() {
      if (!need()) return;
      var r = await S.sb.rpc("admin_set_rank_label", { p_user: info.id, p_label: rank.value });
      if (r.error) return say(msg, err(r.error));
      say(msg, r.data ? "Бейдж: " + r.data : "Бейдж сброшен", true);
      if (onChange) onChange({ rank_label: r.data });
    } });
    box.appendChild(el("div", { class: "god-row" }, [bal]));
    box.appendChild(el("h3", { text: "Баллы", style: "font-size:calc(15px * var(--fs, 1));margin:12px 0 0" }));
    box.appendChild(el("div", { class: "god-row" }, [amount, plus, minus]));
    box.appendChild(el("h3", { text: "Данные", style: "font-size:calc(15px * var(--fs, 1));margin:12px 0 0" }));
    box.appendChild(el("div", { class: "god-row" }, [nick, uname, saveData]));
    box.appendChild(el("h3", { text: "Ранг", style: "font-size:calc(15px * var(--fs, 1));margin:12px 0 0" }));
    box.appendChild(el("div", { class: "god-row" }, [rank, saveRank]));
    box.appendChild(el("p", { class: "god-note", text: "Бейдж — только подпись. Системная роль и права пользователя не меняются. Пустое поле сбрасывает бейдж." }));
    box.appendChild(msg);
    box.addEventListener("toggle", async function() {
      if (!box.open || loaded) return;
      loaded = true;
      var r = await S.sb.rpc("admin_profile_info", { p_username: username });
      if (r.error) {
        loaded = false;
        return say(msg, err(r.error));
      }
      if (!r.data || typeof r.data !== "object") {
        loaded = false;
        return say(msg, "Профиль не найден или нет прав");
      }
      info = r.data;
      bal.textContent = (info.rewards_balance == null ? 0 : info.rewards_balance) + " баллов";
      nick.value = info.display_name || "";
      uname.value = info.username || "";
      rank.value = info.rank_label || "";
    });
    return box;
  }

  // src/shared/id/login.ts
  function openLogin(reason) {
    var inp = el("input", { type: "text", inputmode: "email", placeholder: "email", autocomplete: "username", autocapitalize: "none", spellcheck: "false", id: "aid-email" });
    var msg = el("div", { class: "aid-err", role: "status" });
    var codeInp = el("input", { type: "text", inputmode: "numeric", pattern: "[0-9]*", maxlength: "6", placeholder: "6 цифр из письма", autocomplete: "one-time-code", id: "aid-code" });
    var codeBox = el("div", { class: "aid-codebox", hidden: "" }, [codeInp]);
    var send = el("button", { class: "aid-btn aid-send", type: "button", id: "aid-send", text: "Выслать код" });
    var go = el("button", { class: "aid-btn", type: "button", id: "aid-login", text: "Войти" });
    var reg = el("button", { class: "aid-btn aid-white", type: "button", id: "aid-register", text: "Зарегистрироваться" });
    var creating = false;
    function say2(t, ok) {
      msg.style.color = ok ? "#3ddc84" : "";
      msg.textContent = t || "";
    }
    function sent(isNew) {
      creating = !!isNew;
      codeBox.hidden = false;
      codeInp.value = "";
      say2("Код отправлен на " + inp.value.trim() + " — введите его ниже", true);
      send.textContent = "Выслать код ещё раз";
      setTimeout(function() {
        try {
          codeInp.focus();
        } catch (e) {
        }
      }, 30);
    }
    function request(isNew, btn) {
      say2("");
      btn.disabled = true;
      return sendCode(inp.value, isNew).then(function() {
        sent(isNew);
      }).catch(function(e) {
        say2(err(e));
      }).then(function() {
        btn.disabled = false;
      });
    }
    send.addEventListener("click", function() {
      request(false, send);
    });
    reg.addEventListener("click", function() {
      request(true, reg);
    });
    codeInp.addEventListener("input", function() {
      codeInp.value = codeInp.value.replace(/\D/g, "").slice(0, 6);
      if (codeInp.value.length === 6) go.focus();
    });
    go.addEventListener("click", function() {
      if (codeBox.hidden) {
        say2("Сначала нажмите «Выслать код» — пришлём 6 цифр на почту");
        return;
      }
      if (codeInp.value.length !== 6) {
        say2("Введите 6 цифр из письма");
        return;
      }
      go.disabled = true;
      say2("");
      verifyCode(inp.value, codeInp.value).then(function() {
        return postLogin();
      }).then(function() {
        ov.remove();
        document.dispatchEvent(new CustomEvent("amoore:login"));
      }).catch(function(e) {
        say2(err(e));
        go.disabled = false;
      });
    });
    var kids = [
      el("h2", { text: "Вход в amoore id" }),
      el("p", { text: reason || "Введите Email, и мы пришлём 6-значный код" }),
      inp,
      el("button", { class: "aid-link", type: "button", id: "aid-nomail", text: "Нет доступа к почте?", onclick: function() {
        openSupport(inp.value.trim());
      } }),
      send,
      codeBox,
      msg,
      go,
      reg
    ];
    var ov = overlay(el("div", { class: "aid-card" }, kids.concat([
      el("button", { class: "aid-btn aid-ghost", type: "button", text: "Закрыть", onclick: function() {
        ov.remove();
      } })
    ])));
    setTimeout(function() {
      try {
        inp.focus();
      } catch (e) {
      }
    }, 30);
  }

  // src/shared/id/main.ts
  var api = {
    godPanel,
    openLogin,
    openSupport,
    peopleSearch,
    renderProfile,
    pendingRef,
    claimRef,
    shareUrl,
    boot,
    mountChip,
    init,
    signIn,
    sendCode,
    verifyCode,
    signOut,
    consumeUrl,
    ssoOpen,
    getProfile,
    saveProfile,
    ensureOnboarded,
    isOnboarded,
    openProfile,
    listSessions,
    revokeOthers,
    linkTelegram,
    roleRu,
    registerSite,
    avatarEl,
    AVATAR_COLORS,
    lockLeft,
    people,
    friendlyError: err,
    USERNAME_RE,
    sb: null
  };
  if (!window.amooreID) {
    captureRef();
    window.amooreID = api;
  }
})();
