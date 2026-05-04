# Boat Race Dashboard — Project Context

## What This Is
A multi-tenant SaaS sales competition dashboard. Each Supabase user = one company with fully isolated data. Agents earn points for policies sold and call activity. All data enters via file upload on the Manage tab.

## Architecture

```
Browser (index.html, served by Vercel)
  ↓ Supabase JS client (anon key, via /api/config)
    → race_data, scoring_config, race_config, accounts (RLS-filtered to auth.uid())
    → account_members (member reads own row; owner reads all their member rows)
  ↓ POST /api/upload  (Authorization: Bearer <jwt>)
    → SheetJS parses XLSX/XLS, resolves user from JWT
    → SHA-256 dedup for calls; month-scoped replace for sales
    → writes call_log, sales_log, race_data, historical_wins, historical_months (service key)
    → members: Captain/Chief Officer only; writes to owner's user_id
  ↓ GET /api/history  (Authorization: Bearer <jwt>)
    → queries historical_wins filtered by dataUserId (owner's id for members)
  ↓ GET /api/perf     (Authorization: Bearer <jwt>)
    → aggregates call_log filtered by dataUserId
  ↓ GET|PATCH /api/admin  (Authorization: Bearer <jwt>, admin only)
    → lists/updates all accounts rows
  ↓ GET /api/config
    → serves SUPABASE_URL + SUPABASE_ANON_KEY to browser
  ↓ GET /api/ai-analysis  (Authorization: Bearer <jwt>, Premium or admin)
    → returns cached analysis if <5 days old; otherwise calls Claude and rebuilds history key
  ↓ POST /api/ai-analysis?action=email  (Authorization: Bearer <jwt>)
    → emails current cached analysis via Resend to acct.report_email || acct.email
  ↓ POST /api/delete-account  (Authorization: Bearer <jwt>)
    → cancels Stripe subscriptions, deletes all user data, removes auth user
    → admin can pass targetUserId to delete another (non-admin) user's account
  ↓ POST /api/signup  (no auth required)
    → creates auth user via Supabase Admin API (service key, email_confirm: true)
    → sends admin notification email via Resend to russelsaiassistant@gmail.com
    → returns { ok: true } or { error: 'already_exists' } / { error: message }
  ↓ GET /api/invite?token=  (no auth)
    → validates invite token, returns { valid, email, role, roleLabel, customTabs, company }
  ↓ POST /api/invite?action=accept  (no auth)
    → creates sub-user auth account, deletes trigger-created accounts row, links member_user_id
  ↓ POST /api/invite  (Authorization: Bearer <jwt>, owner only)
    → creates/upserts invite record, sends Resend email with link /app?invite=<token>
  ↓ POST /api/invite?action=resend  (Authorization: Bearer <jwt>, owner only)
    → refreshes invite token (7-day expiry reset) and resends email
  ↓ GET /api/members  (Authorization: Bearer <jwt>, owner only)
    → lists active/invited members for the authenticated owner
  ↓ PATCH /api/members  (Authorization: Bearer <jwt>, owner only)
    → updates member role / custom_tabs
  ↓ DELETE /api/members?memberId=  (Authorization: Bearer <jwt>, owner only)
    → sets status='removed', clears member_user_id
  ↓ GET /api/email-report  (Vercel cron or admin JWT)
    → sends daily performance report to pro/premium paid accounts at their configured hour
    → sends to acct.report_email || acct.email
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — auth screens, scoring, rendering, upload UI, account tab, admin panel, agency management |
| `api/upload.js` | Upload processor — JWT auth, XLSX parsing, user-scoped dedup, Supabase writes; member role guard |
| `api/history.js` | JWT-scoped historical_wins query; resolves dataUserId for members |
| `api/perf.js` | JWT-scoped call_log aggregation → daily/weekly/monthly/yearly + heatmap; resolves dataUserId |
| `api/admin.js` | Admin-only: list + update all accounts |
| `api/config.js` | Serves public Supabase keys to the browser; returns 500 if env vars missing |
| `api/ai-analysis.js` | Premium/admin AI analysis — Claude prompt, caching, email via Resend; resolves dataUserId |
| `api/email-report.js` | Hourly cron — sends daily performance report to eligible pro/premium accounts |
| `api/delete-account.js` | Self-delete or admin-delete: cancels Stripe, wipes all user data + auth user |
| `api/signup.js` | Creates auth user via Admin API + sends admin notification email via Resend |
| `api/invite.js` | Invite lifecycle: create, validate token, accept (creates sub-user), resend |
| `api/members.js` | Agency member CRUD: list, update role, remove |
| `setup.sql` | Full migration — run once in Supabase SQL Editor |
| `members-migration.sql` | Directive 1 migration — account_members table + RLS policies; run once after setup.sql |
| `vercel.json` | Builds + routes |
| `package.json` | Dependencies: `@supabase/supabase-js`, `xlsx` |

## Vercel Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | all API routes + `/api/config` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `/api/config` → browser | Public key for client-side auth + reads |
| `SUPABASE_SERVICE_KEY` | upload, history, perf, admin, signup | Service role key — bypasses RLS for server writes |
| `RESEND_API_KEY` | email-report, ai-analysis, signup | Resend API key for all outbound email |

## Supabase Tables

All data tables have a `user_id uuid` column (FK → auth.users) and RLS policy `user_id = auth.uid()`.

| Table | Purpose | PK |
|-------|---------|-----|
| `accounts` | One row per user — billing status, company info, column map | `user_id` |
| `race_data` | Live race totals per agent per user | `(user_id, agent_id)` |
| `call_log` | Every classified call | `(user_id, hash)` |
| `sales_log` | Every classified sale | `(user_id, hash)` |
| `historical_wins` | Archived end-of-month per-agent results | `(user_id, month, agent_id)` |
| `historical_months` | Archived end-of-month team-level aggregates for trend charts | `(user_id, month)` |
| `race_config` | Key-value store — `current_month` | `(user_id, key)` |
| `scoring_config` | Point values per category | `(user_id, config_key)` |

| `account_members` | Sub-user invite/access records | `id (uuid)` |

### accounts columns
`user_id, email, company_name, contact_name, phone, plan, agent_count, referral_source, status (trial/paid/deferred/past_due/cancelled), is_admin, notes, trial_ends_at, paid_through, stripe_customer_id, sales_column_map (jsonb), ai_analysis_cache (jsonb), ai_analysis_at (timestamptz), ai_history_key (jsonb), timezone, report_hour (smallint, default 7), report_email (text, nullable), last_report_date (date), created_at, last_login`

### account_members columns
`id (uuid PK), owner_user_id, member_user_id (nullable until accepted), email, role ('captain'|'chief_officer'|'bosun'|'custom'), custom_tabs (jsonb), status ('invited'|'active'|'removed'), invite_token (unique, nullable after accept), invite_expires_at, created_at`
UNIQUE(owner_user_id, email)

### race_data columns
`user_id, agent_id, name, team, wl, ul, term, health, auto, fire, placed, answered, missed, voicemail, talk_min, avg_min, race_wide_missed, race_wide_voicemail, last_updated`

### historical_months columns
`user_id, month (text, "Apr 2026" format), placed, answered, missed, voicemail, talk_min, policies, created_at`

Written by `archiveCallStatsToHistorical` (upload.js) and `confirmArchive` (frontend). Read by `ai-analysis.js` for trend chart and r90 calculation. Deleted on account delete, data delete, and admin sandbox reset.

### call_log columns
`user_id, hash, agent_id, disposition, talk_secs, call_dt (DATE), call_slot (SMALLINT 0–47)`

### scoring_config columns
`user_id, config_key, config_value`
Keys: `wl, ul, term, health, auto, fire, placed_sales, placed_service, answered_sales, answered_service, talk_per_min, avg_min, missed_deduct, voicemail_deduct`

## Account Status & Access
| Status | Dashboard | Uploads | Notes |
|--------|-----------|---------|-------|
| `trial` | Teaser tabs (see gating) | ✓ | 21-day trial from signup — auto-checked on login |
| `paid` | Per plan (see gating) | ✓ | |
| `deferred` | Per plan (see gating) | ✓ | Grace period — treated same as paid for access |
| `past_due` | Read-only | ✗ | Banner shown, uploads hidden |
| `cancelled` | Read-only | ✗ | Banner shown, uploads hidden |

Trial expiry is checked client-side: if `status=trial` and `trial_ends_at < now()`, treated as `past_due`.

## Feature Gating by Plan

| Feature | Trial | Basic (paid) | Pro (paid) | Premium (paid) | Admin |
|---------|-------|--------------|------------|----------------|-------|
| Race / Scoring tab | ✓ | ✓ | ✓ | ✓ | ✓ |
| Call Performance table | Teaser → "Upgrade to Pro" | Teaser → "Upgrade to Pro" | ✓ | ✓ | ✓ |
| Voicemail Heatmap | — | Upsell panel | ✓ | ✓ | ✓ |
| AI Analysis tab | Teaser → "Upgrade to Premium" | Teaser → "Upgrade to Premium" | Teaser → "Upgrade to Premium" | ✓ | ✓ |

**Access logic:**
```js
const perfFullAccess     = _isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
const analysisFullAccess = _isAdmin || (_currentPlan === 'premium' && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
```

**Heatmap gating** (inside `loadPerf()`):
```js
const heatmapAllowed = _isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
```
Shows `#heatmap-panel` if allowed; shows `#heatmap-upsell` (description + "Manage Subscription" → account tab) otherwise.

## Sandbox Reset (Admin only)
Account tab shows a "Sandbox — Reset My Data" section for `_isAdmin` accounts. Two-click confirm (5s timeout). Deletes `call_log`, `sales_log`, `historical_wins`, `historical_months`, resets `race_data` to zero, clears `race_config.current_month`. No server endpoint needed — uses anon Supabase client with RLS (user deletes their own rows). Intended for `wilrus01` sandbox testing; grant `is_admin=true` to that account via SQL.

## Danger Zone (Non-admin account tab)

Non-admin users see a "Danger Zone" section (left-aligned below main account panel) with two destructive actions:

**Delete Data** (`confirmDeleteData`): Deletes all user data — `call_log`, `sales_log`, `historical_wins`, `historical_months`, `race_data`, clears `race_config.current_month`. Keeps the account record. Used to start fresh without cancelling the subscription.

**Delete Account** (`confirmDeleteAccount`): Calls `POST /api/delete-account` → cancels Stripe subscriptions, deletes all data + auth user. Confirmation requires typing "DELETE" then a 6s timeout button. On success, signs out.

Both actions use a two-step confirmation UI (confirm button appears, then starts a countdown).

## Archive & Reset Flow

### confirmArchive (index.html)
Called when user clicks "Archive Month" after uploading. Flow:
1. Reads `race_config.current_month` for the month label
2. **Month label fallback**: if `current_month` is blank → scan `call_log` dates, pick most common month by frequency → fallback to current date if call_log also empty
3. Scores current `race_data` using `scoring_config` → inserts/replaces `historical_wins` rows (per-agent)
4. Writes team-level aggregates to `historical_months` (placed, answered, missed, voicemail, talk_min, policies)
5. **Deletes** `race_data` rows (not zeroed) — next upload creates a fresh roster
6. Clears `race_config.current_month`
7. Deletes-before-insert on `historical_wins` to prevent PK conflicts on re-archive

Month format written by `confirmArchive`: `"Apr 2026"` (abbreviated, `_ABBR[month]` array).

### archiveCallStatsToHistorical (upload.js)
Called server-side when an out-of-order upload is detected (uploaded month < current race month). Writes both `historical_wins` (per-agent) and `historical_months` (team totals) for the uploaded month.

Month format written: `"January 2026"` (full month name). Normalized to `"Jan 2026"` in `ai-analysis.js` via:
```js
const normalizedMonth = row.month.slice(0, 3) + ' ' + row.month.split(' ')[1];
```

### Out-of-order uploads
If user uploads data for a month earlier than the current race month:
- Server detects (`cmp < 0` branch in upload.js)
- Archives that historical data to `historical_wins` and `historical_months`
- Does NOT touch `call_log` or `race_data` (current month is preserved)
- Frontend shows amber warning: "Historical data saved — live race and current month unchanged."

## AI Analysis

- **Timer**: 5-day cooldown driven by `_analysisAt` (read from `accounts.ai_analysis_at` on login). Button shows remaining time (days + hours).
- **Tab open**: `displayCachedAnalysis()` called. If `_analysisAt` is null, clears localStorage and shows empty state. If localStorage has data for a different `userId`, clears it and falls through to server fetch. Otherwise renders from localStorage immediately.
- **Different browser, same user**: no localStorage → silent server fetch from `accounts.ai_analysis_cache` on tab open.
- **Analyze button**: only active when timer expired. Calls `/api/ai-analysis`, saves result + timestamp + `userId` to `br-analysis-data` localStorage.
- **Archive invalidation**: `confirmArchive()` clears `accounts.ai_analysis_cache`, `accounts.ai_analysis_at`, `br-analysis-data` localStorage, and `_analysisAt` — any browser gets a clean state on next login.
- **Email Analysis button**: appears after analysis is displayed. Two-click confirm (6s timeout). Calls `POST /api/ai-analysis?action=email` → Resend to `report_email || email`.
- **Server cache**: `accounts.ai_analysis_cache` (jsonb) + `accounts.ai_analysis_at` (timestamptz) — TTL 5 days.
- **History key**: `accounts.ai_history_key` (jsonb) — compact snapshot of last 6 months. Used by Claude to compare improvements, declines, areas to monitor.
- **max_tokens**: 1000

### AI Prompt Structure (5 paragraphs)
1. **Team Trends** — improvements / concerns / things to monitor
2. **Individual Standouts** — top performers and outliers vs their own history
3. **Coaching Priorities** — agents needing attention with specific metrics
4. **Weekly Signals** — recent week vs prior weeks
5. **This Week's Actions** — 2–3 concrete action items

### History key schema
```json
{ "ts": "ISO", "m": { "Mon YYYY": { "p":n, "a":n, "tk":n, "vm":n, "ms":n, "pol":n } },
  "w": { "YYYY-Wnn": { "p":n, "a":n, "tk":n, "vm":n, "ms":n } },
  "r90": { "p":n, "a":n, "tk":n, "vm":n, "ms":n, "pol":n },
  "ag": { "agentId": { "p":n, "a":n, "pol":n } },
  "note": "last sentence from prior AI narrative (≤200 chars)" }
```
Keys: p=placed, a=answered, tk=talkMin, vm=voicemail, ms=missed, pol=policies. Last 6 months, last 4 weeks, rolling 90-day totals, per-agent 90-day, and AI's own prior summary note.

### r90 calculation (ai-analysis.js)
Rolling 90-day totals accumulate from both live `call_log` rows and `historical_months` rows whose last day of month falls within the 90-day window:
```js
const lastDayOfMonth = new Date(Date.UTC(yr, mo + 1, 0));
if (lastDayOfMonth >= cutoff) { r90.p += hm.placed || 0; ... }
```

### Per-agent historical breakdown
`ai-analysis.js` reads `historical_wins` to build `agentHistory` — each agent's last N months of placed/answered/talk/policies/rank. Agents present only in history (archived, not in current race) are included via `agentMeta` backfill. This enables the AI to reference individual trends across archived months.

## Agency Management (Sub-user System)

### Overview
Account owners can invite team members who log in and view the owner's data with tab-level access control. Members are detected by the **absence of an accounts row** — the `on_auth_user_created` trigger creates one for all new users, so `api/invite.js` deletes it immediately after creating the member's auth user.

### Member detection in checkAccountAndShow
```
1. Query accounts for user_id → if found → owner path (_dataUserId = _userId)
2. If NOT found → query account_members for active membership
3. If found → member path (_isMember=true, _dataUserId = owner's user_id)
4. If neither → show login error
```

### _dataUserId pattern (critical)
All data queries — frontend and API — use `_dataUserId` (frontend) or `dataUserId` (API), never `_userId`/`user.id` directly. For owners these are equal; for members `_dataUserId` is the owner's UUID. **Never use `_userId` for data reads/writes** — it would silently read/write the member's own (empty) data.

### Role access
| Role | Tabs allowed | Write access |
|------|-------------|--------------|
| Bosun | Race, History | None |
| Chief Officer | Scoring, Manage, Performance, History | None |
| Captain | All tabs | saveScoring, setAgentTeam, confirmArchive |
| Custom | Owner-selected | None (unless captain-level) |

Admin tab is always hidden for members. Analysis tab shown for Captain/Custom only if owner's plan is Premium.

### Invite flow
1. Owner fills invite form in Account → Agency Management → Send Invite
2. Email sent via Resend with link `/app?invite=<token>` (not `/?invite=` — that routes to landing.html)
3. Invitee clicks link → invite accept screen → sets name + password
4. `POST /api/invite?action=accept` creates auth user, **deletes trigger-created accounts row**, links member_user_id, sets status='active'
5. Frontend auto-signs in after accept
6. Resend button visible for `status='invited'` members — refreshes token + resends email

### RLS policies (members-migration.sql)
- `account_members`: owner_all (full CRUD), member_read_own (SELECT only)
- All data tables (race_data, race_config, scoring_config, call_log, sales_log, historical_wins, historical_months, accounts): additive SELECT policy allowing reads where `user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')`
- `race_data`: captain write policy for role='captain' members

## Daily Email Report

Cron: `0 * * * *` (every hour). Fires for each eligible account when `currentHourInTz(tz) === report_hour`.

**Requirements to receive:**
- `plan` = `pro` or `premium`
- `status` = `paid` or `deferred`
- `timezone`, `report_hour`, `last_report_date` columns must exist on accounts row
- Call or sales data must exist for yesterday (`hasData` check — zero-activity days are skipped)
- `last_report_date` must not already equal yesterday (dedup)

**Delivery address:** `report_email` if set, otherwise `email`. Use `report_email` for users on corporate domains that block external senders (e.g. `@statefarm.com`).

**Admin override:** `GET /api/email-report?date=YYYY-MM-DD` with admin JWT bypasses hour check and dedup — always sends if data exists.

## Auth Screens
1. **Login** — email + password + links to forgot password / sign up
2. **Sign Up** — company name, contact, phone, agent count, plan, referral source, password → POSTs to `/api/signup` → 21-day trial created server-side; admin notification email sent via Resend
3. **Forgot Password** — sends Supabase reset link to email
4. **Password Recovery** — shown when user clicks reset link in email (`PASSWORD_RECOVERY` event)
5. **Invite Accept** — shown when URL contains `?invite=<token>`; validates token, collects name + password
6. **App** — full dashboard with Account tab (password change, account info, column map, agency management, danger zone) and Admin tab (is_admin only)

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
- Sales date query uses `< first day of next month` (not `<= day 31`) to avoid invalid date errors on PostgreSQL DATE columns

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

## Vercel Analytics

Vercel Analytics is enabled via a single script tag — no npm package required:
```html
<script defer src="/_vercel/insights/script.js"></script>
```
Added to `<head>` in both `index.html` and `landing.html`. No configuration needed; Vercel injects it automatically on deployment.

## /api/config Response Shape

`config.js` returns `{ supabaseUrl, supabaseKey }`. Returns HTTP 500 if either env var is missing. The frontend checks `r.ok` before using the response. Do not rename these fields without updating both files.

## Admin Account

- `russelsaiassistant@gmail.com` is the designated admin — `is_admin=true`, `status='paid'`, `trial_ends_at=NULL`
- Admin account was seeded via the SQL in `setup.sql` section 5
- Admin sees an extra **Admin** tab with full account management (view all users, change status, add notes)
- To grant admin to another account: `UPDATE accounts SET is_admin = true WHERE email = 'user@example.com';`
- To revoke admin: `UPDATE accounts SET is_admin = false WHERE email = 'user@example.com';`
- Admin accounts cannot self-delete and cannot be deleted by other admins (`/api/delete-account` enforces both)

## Common Tasks

### First-time setup
1. Run `setup.sql` in Supabase SQL Editor
2. Ensure `russelsaiassistant@gmail.com` exists in Supabase Auth **before** running the seed
3. Disable email confirmation: Supabase → Auth → Providers → Email → Confirm email **OFF**
4. Set Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`

### Add historical_months table (if missing)
```sql
CREATE TABLE IF NOT EXISTS historical_months (
  user_id    uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  month      text        NOT NULL,
  placed     int         NOT NULL DEFAULT 0,
  answered   int         NOT NULL DEFAULT 0,
  missed     int         NOT NULL DEFAULT 0,
  voicemail  int         NOT NULL DEFAULT 0,
  talk_min   numeric     NOT NULL DEFAULT 0,
  policies   int         NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, month)
);
ALTER TABLE historical_months ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own" ON historical_months USING (user_id = auth.uid());
```

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
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ai_analysis_cache  jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ai_analysis_at     timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ai_history_key     jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone           text NOT NULL DEFAULT 'America/Los_Angeles';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS report_hour        smallint NOT NULL DEFAULT 7;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_report_date   date;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS report_email       text;
```

### Fix member getting treated as owner (stale accounts row)
If an invited member has an accounts row (trigger fired before the delete fix was deployed), remove it:
```sql
DELETE FROM accounts WHERE email = 'member@email.com';
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
DELETE FROM race_data     WHERE user_id = '<uuid>';
DELETE FROM call_log      WHERE user_id = '<uuid>';
DELETE FROM sales_log     WHERE user_id = '<uuid>';
DELETE FROM historical_wins   WHERE user_id = '<uuid>';
DELETE FROM historical_months WHERE user_id = '<uuid>';
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
| `handleSignup()` | button disabled during `/api/signup` fetch, re-enabled in `finally` |
| `handleFile()` | `_uploadInProgress` flag + both file inputs disabled; reset in `finally` |
| `onAuthStateChange` | `_processingToken` deduplicates concurrent session events |

If this error resurfaces, look for a new async path that lacks a disable/finally guard.

## Signup Flow (api/signup.js)

`handleSignup()` in index.html POSTs to `/api/signup` instead of calling `supabase.auth.signUp` directly. The endpoint:
1. Calls `supabase.auth.admin.createUser` with `email_confirm: true` (service key — no email verification required)
2. Sends admin notification to `russelsaiassistant@gmail.com` via Resend (fire-and-forget — never blocks signup)
3. The existing `on_auth_user_created` Supabase trigger still fires and inserts the `accounts` row

Notification email includes: company, contact, email, phone, plan, agent count, referral source, timestamp.

Duplicate-email detection: server returns `{ error: 'already_exists' }` (HTTP 409); frontend shows the "sign in here" link.

## Race Tab Voicemail/Missed Counts

`race_data.race_wide_missed` and `race_wide_voicemail` columns are NOT used for scoring or display. After archive+reset, these denormalized values can be 0.

Instead, `loadRaceData()` queries `call_log` directly for counts (two `count: exact` queries filtered by `disposition`). Results stored in module-level `_raceWideMissed` and `_raceWideVm`. These are used in:
- `calcScore()` — deduction calculation
- `renderRace()` — race tab display
- `confirmArchive()` — written to `historical_months` and `historical_wins`

Do not read `ag.race_wide_missed` / `ag.race_wide_voicemail` from `race_data` rows — they are unreliable after archive.

### Wire Stripe billing later
1. Create Supabase Edge Function to handle Stripe webhooks
2. On `invoice.payment_succeeded` → set `accounts.status = 'paid'`, update `paid_through`
3. On `invoice.payment_failed` → set `accounts.status = 'past_due'`
4. Store `stripe_customer_id` in `accounts` table (column already exists)
