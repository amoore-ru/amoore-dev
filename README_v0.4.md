# Amoore Dev — v0.4 onboarding & broadcast

## First deployment
1. Deploy the SQL files in order: `shared/sql/001_amoore_schema.sql`, `002_v202_bot_leads.sql`, then `003_v04_onboarding_broadcast.sql`.
2. In Supabase Storage create a bucket named `media`; apply only the Storage policies appropriate to your deployment.
3. Configure Edge Function secrets: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key must remain server-side and must never be embedded in browser code.
4. Deploy `shared/edge-functions/send-telegram/index.ts` with `supabase functions deploy send-telegram`.
5. Configure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment where you run the DB checker.

## Database preflight
Requires Node.js 18+ and has no npm dependencies:

```bash
SUPABASE_URL="https://YOUR_PROJECT.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
DATABASE_URL="postgresql://..." node check_db.js
```

The REST checks validate the required tables and the `media` bucket. RLS status is read from PostgreSQL catalogs through `psql` when `DATABASE_URL` and the `psql` executable are available. A REST-only check cannot authoritatively inspect `pg_class.relrowsecurity`.

## Telegram broadcast
The bot registers private-chat users in `bot_subscribers` through `supabase_bridge.py`. The broadcast Edge Function is restricted to `super_admin` (or an explicitly granted `broadcast_telegram` permission). Users who have never initiated a private conversation are not in the recipient list. Telegram blocks are marked inactive automatically after a 403 response.

## Onboarding
The dashboard checks access to `admins`, `ecosystem_sites`, `news` and optional `bot_status`. The quick-start buttons focus the news form and open the landing page with the current God Mode token. The wizard is a convenience layer; database RLS and SQL triggers remain the security boundary.
