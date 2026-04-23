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
  ↓ GET /api/ai-analysis  (Authorization: Bearer <jwt>, Premium or admin)
    → returns cached analysis if <5 days old; otherwise calls Claude and rebuilds history key
  ↓ POST /api/ai-analysis?action=email  (Authorization: Bearer <jwt>)
    → emails current cached analysis via Resend to the account's email address
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — auth screens, scoring, rendering, upload UI, account tab, admin panel |
| `api/upload.js` | Upload processor — JWT auth, XLSX parsing, user-scoped dedup, Supabase writes |
| `api/history.js` | JWT-scoped historical_wins query |
| `api/perf.js` | JWT-scoped call_log aggregation → daily/weekly/monthly/yearly + heatmap |
| `api/admin.js` | Admin-only: list + update all accounts |
| `api/config.js` | Serves public Supabase keys to the browser; returns 500 if env vars missing |
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

## Feature Gating by Plan
| Feature | Basic | Pro | Premium |
|---------|-------|-----|---------|
| Race/Scoring tab | ✓ | ✓ | ✓ |
| Call Performance table | ✓ | ✓ | ✓ |
| Voicemail Heatmap | Upsell panel | ✓ | ✓ |
| AI Analysis tab | — | — | ✓ (admin always) |
| Daily email reports | — | ✓ | ✓ |

**Heatmap gating**: `loadPerf()` shows `#heatmap-panel` for Pro/Premium/admin; shows `#heatmap-upsell` (description + "Manage Subscription" button → account tab) for Basic.

## Sandbox Reset (Admin only)
Account tab shows a "Sandbox — Reset My Data" section for `_isAdmin` accounts. Two-click confirm (5s timeout). Deletes `call_log`, `sales_log`, resets `race_data` to zero, clears `race_config.current_month`. No server endpoint needed — uses anon Supabase client with RLS (user deletes their own rows). Intended for `wilrus01` sandbox testing; grant `is_admin=true` to that account via SQL.

## AI Analysis
- **Timer**: 5-day cooldown enforced client-side (`br-analysis-last` in localStorage). Button shows remaining time (days + hours).
- **Tab open**: displays cached analysis from `br-analysis-data` localStorage — no server call.
- **Analyze button**: only active when timer expired. Calls `/api/ai-analysis`, saves result + timestamp to localStorage.
- **Email Analysis button**: appears after analysis is displayed. Two-click confirm (6s timeout). Calls `POST /api/ai-analysis?action=email` → Resend to account email.
- **Server cache**: `accounts.ai_analysis_cache` (jsonb) + `accounts.ai_analysis_at` (timestamptz) — TTL 5 days.
- **History key**: `accounts.ai_history_key` (jsonb) — compact snapshot of last analysis (abbreviated keys). Used by Claude to compare improvements, declines, areas to monitor.

### History key schema
```json
{ "ts": "ISO", "m": { "Mon YYYY": { "p":n, "a":n, "tk":n, "vm":n, "ms":n, "pol":n } },
  "w": { "YYYY-Wnn": { "p":n, "a":n, "tk":n, "vm":n, "ms":n } },
  "r90": { "p":n, "a":n, "tk":n, "vm":n, "ms":n, "pol":n },
  "ag": { "agentId": { "p":n, "a":n, "pol":n } },
  "note": "last sentence from prior AI narrative (≤200 chars)" }
```
Keys: p=placed, a=answered, tk=talkMin, vm=voicemail, ms=missed, pol=policies. Last 3 months, last 4 weeks, rolling 90-day totals, per-agent 90-day, and AI's own prior summary note.

## Auth Screens
1. **Login** — email + password + links to forgot password / sign up
2. **Sign Up** — company name, contact, phone, agent count, plan, referral source, password → 21-day trial
3. **Forgot Password** — sends Supabase reset link to email
4. **Password Recovery** — shown when user clicks reset link in email (`PASSWORD_RECOVERY` event)
5. **App** — full dashboard with Account tab (password change, account info, column map) and Admin tab (is_admin only)

## Auth Flow (index.html)

The auth flow uses `onAuthStateChange` as the sole source of truth — **do not add `getSession()` calls**; they cause duplicate `checkAccountAndShow` execution.

### Init sequence
1. `init()` runs on `DOMContentLoaded`
2. Before `createClient`, expired/expiring stored sessions are cleared from `localStorage` (any `sb-*-auth-token` key with `expires_at < now + 60s`) — this prevents Supabase's startup token refresh from holding the auth lock and blocking `signInWithPassword`
3. `createClient` is called
4. `onAuthStateChange` is registered; events drive all screen transitions

### onAuthStateChange handler rules
- `PASSWORD_RECOVERY` → show recovery screen, return
- `TOKEN_REFRESHED` → update `_session`, return (no screen change)
- Session present: dedup by `_processingToken` (the access token currently being processed) — if the incoming token matches `_processingToken`, skip; otherwise set `_processingToken` and call `checkAccountAndShow`
- No session: clear `_processingToken`, call `showScreen('login')`

### `_processingToken` (not a boolean flag)
Stores the `access_token` of the session currently being processed. Prevents duplicate `checkAccountAndShow` calls for the same session (e.g. `SIGNED_IN` firing twice for a page-load restore). A new explicit sign-in creates a **new** token, so it always passes through even if a stale page-load restore is pending. Reset to `null` on sign-out and when processing completes.

Do **not** revert to a boolean `_checkingAccount` flag — it caused permanent deadlocks when the page-load session restore hung, blocking `handleLogin` indefinitely.

### `checkAccountAndShow(session)`
- Auth + account setup is wrapped in `try/catch` — errors show `'Sign-in error: …'` on the login screen
- `showScreen('app')` is called inside the try block (before data loading)
- `loadRaceData`, `loadHistory`, `loadPerf` run **outside** the try block with `.catch()` — data load errors are logged but never redirect to login
- `authHeaders()` is sync (reads cached `_session`) — do NOT make it async

### `handleLogin` sign-in timeout
`signInWithPassword` is wrapped in a 15-second `Promise.race` timeout. On timeout, all `sb-*` localStorage keys are cleared (removes stale session) and the user is shown a retry message. Second click succeeds because no stored session means no lock contention.

## Sales Upload — Format Flexibility
- Auto-detects columns via synonym lists (see `SALES_COL_SYNONYMS` in upload.js)
- If detection fails → returns `{needsMapping: true, headers: [...]}` → browser shows column mapper modal
- User's mapping saved to `accounts.sales_column_map` (JSONB) and reused on future uploads
- Sales uploads are **month-scoped replace**: all sales_log rows for that user+month are deleted then re-inserted — automatically handles removed sales

## Call Classification Rules (upload.js `classifyCalls`)

| Condition | Category | Effect |
|-----------|----------|--------|
| Disposition contains "Voice Mail" or "VM" + INBOUND + not internal | `voicemail` | race-wide voicemail count (deduction) |
| Disposition contains "Voice Mail" or "VM" + OUTBOUND | `placed` | agent gets placed-call credit |
| Disposition contains "Internal" or "Voice Mail Access" | `internal` | excluded from all counts |
| Disposition contains "Abandon" | `missed` | race-wide missed count (deduction) |
| OUTBOUND (non-VM, non-internal) | `placed` | agent placed count |
| INBOUND + disposition contains "Handled" | `answered` | agent answered count |
| Everything else | `other` | excluded from all counts |

Voicemail and missed are **mutually exclusive** — a call lands in exactly one bucket. Voicemails are not attributed to individual agents; they are race-wide deductions applied equally to all.

## Supabase Pagination — `fetchAllPages` (upload.js)

Supabase silently caps unpaginated reads at 1000 rows. All call_log/sales_log reads in `upload.js` use the `fetchAllPages` helper to bypass this:

```js
async function fetchAllPages(client, table, columns, userId) {
  const PAGE = 1000;
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await client.from(table)
      .select(columns).eq('user_id', userId)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} read failed: ${error.message}`);
    if (data?.length) rows.push(...data);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}
```

`perf.js` and `ai-analysis.js` use their own inline pagination loops with the same pattern. **Never add an unpaginated `.select()` on call_log or sales_log** — datasets exceed 1000 rows and the truncation is silent.

## race_data Update Behavior (upload.js)

`race_data` is rebuilt from ALL call_log rows on every call upload — even if the uploaded file contains zero new rows (all duplicates). This allows re-uploading the same file to force a recalculation after code fixes.

Flow:
1. Hash dedup: read all existing hashes via `fetchAllPages`
2. Classify new rows from file
3. Insert new rows (skipped if none)
4. Read ALL call_log rows via `fetchAllPages` → `aggregateFromLog` → update race_data (always runs)

## Talk Time Display (`fmtMins` in index.html)

All talk time values are formatted through `fmtMins(minutes)`:
- Under 60 min → `"45.2 min"`
- 60+ min → `"1h 23m"`

Applied to: race tab stats card ("Talk Time"), per-agent race bar labels, and perf table Talk Min / Avg Min / Max Min columns.

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

**Note:** `archiveToHistorical` and `archiveCallStatsToHistorical` both call `fetchScoringConfig(userId)` at archive time and use those values. Defaults match the original hard-coded values if no scoring_config rows exist.

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

`config.js` returns `{ supabaseUrl, supabaseKey }`. Returns HTTP 500 if either env var is missing. The frontend checks `r.ok` before using the response. Do not rename these fields without updating both files.

## Admin Account

- `russelsaiassistant@gmail.com` is the designated admin — `is_admin=true`, `status='paid'`, `trial_ends_at=NULL`
- Admin account was seeded via the SQL in `setup.sql` section 5
- Admin sees an extra **Admin** tab with full account management (view all users, change status, add notes)
- To grant admin to another account: `UPDATE accounts SET is_admin = true WHERE email = 'user@example.com';`
- To revoke admin: `UPDATE accounts SET is_admin = false WHERE email = 'user@example.com';`

## Common Tasks

### First-time setup
1. Run `setup.sql` in Supabase SQL Editor
2. Ensure `russelsaiassistant@gmail.com` exists in Supabase Auth **before** running the seed
3. Disable email confirmation: Supabase → Auth → Providers → Email → Confirm email **OFF**
4. Set Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

### If accounts table is missing columns (signup trigger fails)
The `CREATE TABLE IF NOT EXISTS` in setup.sql won't add columns to an existing table. Run this to patch:
```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS phone              text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS plan               text NOT NULL DEFAULT 'basic';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_count        int  NOT NULL DEFAULT 1;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS referral_source    text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS notes              text NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS trial_ends_at      timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS paid_through       timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sales_column_map   jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login         timestamptz;
```

### If a signed-up user has no accounts row (trigger fired but failed silently)
```sql
INSERT INTO accounts (user_id, email, company_name, contact_name, phone, plan, agent_count, referral_source, status, trial_ends_at)
SELECT
  u.id, u.email,
  COALESCE(u.raw_user_meta_data->>'company_name', ''),
  COALESCE(u.raw_user_meta_data->>'contact_name', ''),
  COALESCE(u.raw_user_meta_data->>'phone', ''),
  COALESCE(u.raw_user_meta_data->>'plan', 'basic'),
  COALESCE((u.raw_user_meta_data->>'agent_count')::int, 1),
  COALESCE(u.raw_user_meta_data->>'referral_source', ''),
  'trial',
  now() + interval '21 days'
FROM auth.users u
LEFT JOIN accounts a ON a.user_id = u.id
WHERE a.user_id IS NULL
ON CONFLICT (user_id) DO NOTHING;
```

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

## Upload API — Request Format

The frontend (`handleFile`, `submitColMapper`) sends **JSON** to `/api/upload`:
```javascript
fetch('/api/upload', {
  method: 'POST',
  headers: { Authorization: 'Bearer <jwt>', 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'calls'|'sales', data: rows[], columnMap?: {...} })
})
```
- `data` is the pre-parsed 2D array from XLSX.js (rows × columns)
- `api/upload.js` reads `body.type` / `body.data` (with fallback to legacy `fileType`/`fileBase64`)
- Do **not** revert to FormData — `@vercel/node` does not auto-parse multipart bodies

## Admin API — Request Format

`PATCH /api/admin` expects `userId` (camelCase) in the request body — not `user_id`:
```javascript
{ userId: '<uuid>', status: 'paid' }   // correct
{ user_id: '<uuid>', status: 'paid' }  // wrong — server ignores it
```

## Concurrency Guards

Supabase throws **"Lock broken by another request with the 'steal' option"** when two concurrent requests hit the same auth or DB operation. Guards in place:

| Location | Guard |
|----------|-------|
| `handleLogin()` | button disabled during `signInWithPassword`, re-enabled in `finally`; 15s timeout clears localStorage on hang |
| `handleSignup()` | button disabled during `signUp`, re-enabled in `finally` |
| `handleFile()` | `_uploadInProgress` flag + both file inputs disabled; reset in `finally` |
| `onAuthStateChange` | `_processingToken` deduplicates concurrent session events |

If this error resurfaces, look for a new async path that lacks a disable/finally guard.

## confirmArchive (index.html)

Deletes existing `historical_wins` rows for the month **before** inserting new ones — prevents silent PK constraint failures if the function is called twice for the same month. The delete-before-insert pattern matches `archiveToHistorical` in upload.js. History tab is also reloaded after archive completes.

### Wire Stripe billing later
1. Create Supabase Edge Function to handle Stripe webhooks
2. On `invoice.payment_succeeded` → set `accounts.status = 'paid'`, update `paid_through`
3. On `invoice.payment_failed` → set `accounts.status = 'past_due'`
4. Store `stripe_customer_id` in `accounts` table (column already exists)
