# Boat Race Dashboard — Project Context

## What This Is
A multi-tenant SaaS sales competition dashboard. Each Supabase user = one company with fully isolated data. Agents earn points for policies sold and call activity. All data enters via file upload on the Manage tab.

## Architecture

```
Browser (index.html, served by Vercel)
  ↓ Supabase JS client (anon key, via /api/config)
    → race_data, scoring_config, race_config, accounts (RLS-filtered to auth.uid())
  ↓ POST /api/upload  (Authorization: Bearer <jwt>)
    → SheetJS parses XLSX/XLS, resolves user from JWT
    → SHA-256 dedup for calls; month-scoped replace for sales
    → writes call_log, sales_log, race_data, historical_wins (service key)
  ↓ GET /api/history  (Authorization: Bearer <jwt>)
    → queries historical_wins filtered by user_id
  ↓ GET /api/perf     (Authorization: Bearer <jwt>)
    → aggregates call_log filtered by user_id
  ↓ GET|PATCH /api/admin  (Authorization: Bearer <jwt>, admin only)
    → lists/updates all accounts rows
  ↓ GET /api/config
    → serves SUPABASE_URL + SUPABASE_ANON_KEY to browser
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — auth screens, scoring, rendering, upload UI, account tab, admin panel |
| `api/upload.js` | Upload processor — JWT auth, XLSX parsing, user-scoped dedup, Supabase writes |
| `api/history.js` | JWT-scoped historical_wins query |
| `api/perf.js` | JWT-scoped call_log aggregation → daily/weekly/monthly/yearly + heatmap |
| `api/admin.js` | Admin-only: list + update all accounts |
| `api/config.js` | Serves public Supabase keys to the browser |
| `setup.sql` | Full migration — run once in Supabase SQL Editor |
| `vercel.json` | Builds + routes |
| `package.json` | Dependencies: `@supabase/supabase-js`, `xlsx` |

## Vercel Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | all API routes + `/api/config` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `/api/config` → browser | Public key for client-side auth + reads |
| `SUPABASE_SERVICE_KEY` | upload, history, perf, admin | Service role key — bypasses RLS for server writes |

## Supabase Tables

All data tables have a `user_id uuid` column (FK → auth.users) and RLS policy `user_id = auth.uid()`.

| Table | Purpose | PK |
|-------|---------|-----|
| `accounts` | One row per user — billing status, company info, column map | `user_id` |
| `race_data` | Live race totals per agent per user | `(user_id, agent_id)` |
| `call_log` | Every classified call | `(user_id, hash)` |
| `sales_log` | Every classified sale | `(user_id, hash)` |
| `historical_wins` | Archived end-of-month results | `user_id + month + agent_id` |
| `race_config` | Key-value store — `current_month` | `(user_id, key)` |
| `scoring_config` | Point values per category | `(user_id, config_key)` |

### accounts columns
`user_id, email, company_name, contact_name, phone, plan, agent_count, referral_source, status (trial/paid/deferred/past_due/cancelled), is_admin, notes, trial_ends_at, paid_through, stripe_customer_id, sales_column_map (jsonb), created_at, last_login`

### race_data columns
`user_id, agent_id, name, team, wl, ul, term, health, auto, fire, placed, answered, missed, voicemail, talk_min, avg_min, race_wide_missed, race_wide_voicemail, last_updated`

### call_log columns
`user_id, hash, agent_id, disposition, talk_secs, call_dt (DATE), call_slot (SMALLINT 0–47)`

### scoring_config columns
`user_id, config_key, config_value`
Keys: `wl, ul, term, health, auto, fire, placed_sales, placed_service, answered_sales, answered_service, talk_per_min, avg_min, missed_deduct, voicemail_deduct`

## Account Status & Access
| Status | Dashboard | Uploads | Notes |
|--------|-----------|---------|-------|
| `trial` | Full | ✓ | 21-day trial from signup — auto-checked on login |
| `paid` | Full | ✓ | |
| `deferred` | Full | ✓ | Grace period |
| `past_due` | Read-only | ✗ | Banner shown, uploads hidden |
| `cancelled` | Read-only | ✗ | Banner shown, uploads hidden |

Trial expiry is checked client-side: if `status=trial` and `trial_ends_at < now()`, treated as `past_due`.

## Auth Screens
1. **Login** — email + password + links to forgot password / sign up
2. **Sign Up** — company name, contact, phone, agent count, plan, referral source, password → 21-day trial
3. **Forgot Password** — sends Supabase reset link to email
4. **Password Recovery** — shown when user clicks reset link in email (`PASSWORD_RECOVERY` event)
5. **App** — full dashboard with Account tab (password change, account info, column map) and Admin tab (is_admin only)

## Sales Upload — Format Flexibility
- Auto-detects columns via synonym lists (see `SALES_COL_SYNONYMS` in upload.js)
- If detection fails → returns `{needsMapping: true, headers: [...]}` → browser shows column mapper modal
- User's mapping saved to `accounts.sales_column_map` (JSONB) and reused on future uploads
- Sales uploads are **month-scoped replace**: all sales_log rows for that user+month are deleted then re-inserted — automatically handles removed sales

## Scoring Formula (frontend `calcScore`)
```javascript
polPts      = wl*SCORING.wl + ul*SCORING.ul + term*SCORING.term + ...
placedPts   = placed   * (service ? SCORING.placed_service  : SCORING.placed_sales)
answeredPts = answered * (service ? SCORING.answered_service : SCORING.answered_sales)
talkPts     = talkMin*SCORING.talk_per_min + avgMin*SCORING.avg_min
gross       = round(polPts + placedPts + answeredPts + talkPts)
deduct      = round(raceWideMissed*SCORING.missed_deduct + raceWideVoicemail*SCORING.voicemail_deduct)
total       = max(0, gross + deduct)
```
Deductions are race-wide — applied equally to all agents.

## Agents (hardcoded in upload.js + perf.js)
ashley, fiona, jocelyn, joseph, peyton, susan, tiffany, tracy, amin, andy, russel

Team is stored in `race_data.team` (source of truth).

## Frontend Script Load Order (critical)

Scripts in `index.html` must load in this order — Supabase **before** app code:
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script>/* app code */</script>
```
`window.supabase.createClient(...)` is called inside `init()` on `DOMContentLoaded`. If the Supabase script loads after the inline script, `window.supabase` may be undefined and `_supabase` stays null, causing silent failures on every auth call.

## /api/config Response Shape

`config.js` returns `{ supabaseUrl, supabaseKey }`. The frontend reads those exact keys:
```javascript
_supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
```
Do not rename these fields without updating both files.

## Common Tasks

### First-time setup
1. Run `setup.sql` in Supabase SQL Editor
2. Ensure `russelsaiassistant@gmail.com` exists in Supabase Auth before running the seed
3. Disable email confirmation: Supabase → Auth → Providers → Email → Confirm email **OFF**
4. Set Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

### Add admin to an account
```sql
UPDATE accounts SET is_admin = true WHERE email = 'admin@example.com';
```

### Reset race for a specific user
```sql
UPDATE race_data SET wl=0,ul=0,term=0,health=0,auto=0,fire=0,
  placed=0,answered=0,missed=0,voicemail=0,talk_min=0,avg_min=0,
  race_wide_missed=0,race_wide_voicemail=0
WHERE user_id = '<uuid>';
DELETE FROM call_log  WHERE user_id = '<uuid>';
DELETE FROM sales_log WHERE user_id = '<uuid>';
UPDATE race_config SET value='' WHERE key='current_month' AND user_id='<uuid>';
```

### Redeploy after code changes
```bash
git add <files>
git commit -m "message"
git push   # Vercel auto-deploys from main
```

### Wire Stripe billing later
1. Create Supabase Edge Function to handle Stripe webhooks
2. On `invoice.payment_succeeded` → set `accounts.status = 'paid'`, update `paid_through`
3. On `invoice.payment_failed` → set `accounts.status = 'past_due'`
4. Store `stripe_customer_id` in `accounts` table (column already exists)
