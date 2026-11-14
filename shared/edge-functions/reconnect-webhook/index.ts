// Edge Function: reconnect-webhook (v5.4) — переустановка Telegram-вебхука по кнопке в админке. Только Основатель.
// Секреты: TELEGRAM_BOT_TOKEN, BOT_WEBHOOK_URL (https://<сервис>.onrender.com/webhook), WEBHOOK_SECRET.
import { cors, json, caller } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  const c = await caller(req);
  if (!c) return json(req, { error: "unauthorized" }, 401);
  if (c.profile.role !== "super_admin") return json(req, { error: "Только Основатель" }, 403);
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN"), url = Deno.env.get("BOT_WEBHOOK_URL"), secret = Deno.env.get("WEBHOOK_SECRET") ?? "";
  if (!token || !url) return json(req, { error: "Не заданы TELEGRAM_BOT_TOKEN / BOT_WEBHOOK_URL" }, 500);
  const api = `https://api.telegram.org/bot${token}`;
  const set = await (await fetch(`${api}/setWebhook`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, secret_token: secret || undefined, allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"], drop_pending_updates: false }),
  })).json();
  const info = await (await fetch(`${api}/getWebhookInfo`)).json();
  if (!set.ok) return json(req, { error: set.description ?? "Telegram отклонил setWebhook" }, 502);
  return json(req, { ok: true, url: info.result?.url ?? url, pending: info.result?.pending_update_count ?? 0, last_error: info.result?.last_error_message ?? null });
});
