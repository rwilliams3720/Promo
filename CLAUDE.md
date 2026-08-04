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
  ↓ GET|PATCH /api/checklist-config  (Authorization: Bearer <jwt>)
    → GET: returns hasSalesAddon, salesEntryMode, checklistToken, formConfig, subcategories,
           emailConfig, agents (with commission_structure_ids[]), selfReportConfig, hasCommissionsAddon
    → auto-seeds checklist_config and sales_subcategories on first access
    → PATCH actions: regenerate_token, update formTypes, subcategoryUpdates, emailConfig,
           salesEntryMode, update_activity_goals, update_self_report
  ↓ GET|POST|PATCH|DELETE /api/sales  (Authorization: Bearer <jwt>)
    → GET: lists manual + checklist sales_log entries (up to 200, date desc)
    → GET params: fromDate / toDate (YYYY-MM-DD) override default month window
    → POST: creates manual entry; members (non-captain/CO) auto-fill own agent_id
    → PATCH: updates any field including is_cancelled, chargeback_date
    → DELETE: removes entry, rebuilds race_data
    → Access: owner, captain, chief_officer; members if sales_enabled in self_report_config
  ↓ GET|POST|PATCH|DELETE /api/agent-roster  (Authorization: Bearer <jwt>, owner only)
    → CRUD for agent_roster table; POST slugifies name → agent_id
    → PATCH actions: add_commission_structure, remove_commission_structure, update_qualifier
  ↓ GET /api/checklist-form?token=  (no auth)
    → public form endpoint; validates checklist_token, returns form config + agent list + lead sources
  ↓ POST /api/checklist-form  (no auth, token in body)
    → submits checklist completion, writes to checklist_submissions + sales_log
    → accepts apptLocation (appointment location name, flows to customer email) and location (sales location name, stored in sales_log)
  ↓ POST /api/addon-checkout  (Authorization: Bearer <jwt>)
    → creates Stripe checkout session for sales add-on ($25/mo)
  ↓ DELETE /api/addon-checkout  (Authorization: Bearer <jwt>)
    → cancels sales add-on Stripe subscription
  ↓ POST /api/commissions-checkout  (Authorization: Bearer <jwt>)
    → creates Stripe checkout session for commissions add-on ($25/mo)
  ↓ DELETE /api/commissions-checkout  (Authorization: Bearer <jwt>)
    → cancels commissions add-on Stripe subscription
  ↓ GET /api/commissions  (Authorization: Bearer <jwt>)
    → calculates per-agent commissions for a month; requires has_commissions_addon
    → returns earned, bonus_earned, chargebacks, net_earned, recalculated flag, structure_details
    → breakdown items include customer_name (decrypted), sale_date, subcategory per sale
    → supports multiple structures per agent via agent_commission_structures junction table
  ↓ GET|POST|PATCH|DELETE /api/commission-structures  (Authorization: Bearer <jwt>)
    → CRUD for commission_structures table (rate tiers, thresholds, escalators, floors)
  ↓ GET|POST|PATCH|DELETE /api/bonus-activities  (Authorization: Bearer <jwt>)
    → GET ?resource=types: list activity types with payment rates
    → GET ?resource=pending: pending approvals (approver only)
    → GET: entries for month with call-log auto-aggregation
    → POST action=add_type | add_entry
    → PATCH action=update_type | update_entry | set_status (approve/reject)
    → DELETE ?resource=types|entries
    → Members with self_report_config.activities_enabled can submit; requires_approval → status=pending
  ↓ GET /api/analysis-credits  (Authorization: Bearer <jwt>)
    → returns { balance } from accounts.credit_balance
  ↓ POST /api/analysis-credits  (Authorization: Bearer <jwt>)
    → action=charge_run: deducts $3 from credit_balance; 402 if insufficient
    → action=checkout: creates Stripe one-time Checkout session ($5/$10/$20 via price_data); Stripe initialized lazily inside branch only
  ↓ GET /api/member-org  (Authorization: Bearer <jwt>)
    → owner path: returns all active account_members for the authenticated owner
    → captain-member path: returns all active account_members for the captain's owner
    → returns: [{ id, email, role, roster_agent_id, managed_by }]
    → used by frontend to build org chart tree for Goals tab + Chargeback Report grouping
```

### Paginated queries must always `.order()` — silent count corruption otherwise (fixed 2026-07-24)

`api/upload.js` (`fetchAllPages`), `api/perf.js`, `api/ai-analysis.js`, and `api/lead-analysis.js` all page through `call_log`/`sales_log` in 1000-row chunks via `.range(from, from+999)` in a loop. Postgres gives **no default stable row order** across separate unordered queries — without an explicit `.order()`, a multi-page unordered fetch can non-deterministically return the same row on two different pages (inflating whatever count depends on it) or skip a row entirely (deflating it), and which rows land where can differ between two runs of the identical query. This only manifests once an account crosses 1000 `call_log`/`sales_log` rows (single-page fetches are trivially stable regardless of ordering) — invisible in low-volume testing, real in production.

Found via a real audit (user reported "voicemails appear high"): a raw duplicate-hash check on `call_log` showed 1036 "duplicates" — but re-running the identical fetch with `.order('hash')` added made that number **exactly 0**, and the row count matched Supabase's authoritative `count: 'exact'` head-query. The underlying data was never duplicated; only the *aggregate counts computed from unordered pagination* were wrong. Confirmed live corruption from this on the affected production account: stored `race_data.race_wide_voicemail` was 260 vs. a true 242, `race_wide_missed` 179 vs. true 176, and **every single agent's** `placed`/`answered` counts were off — in both directions (some inflated, some deflated), the exact fingerprint of this bug rather than a data-entry issue. 5 accounts crossed the 1000-row threshold and were affected account-wide.

**Fix**: add `.order('hash', { ascending: true })` to every paginated `.range()` query (`hash` is part of both `call_log` and `sales_log`'s `(user_id, hash)` primary key — always present, always unique per user, doesn't need to be in the `.select()` list to be ordered by). This is a **self-healing** fix — no data rewrite needed for it to take effect; any account's *next* call/sales upload recomputes cleanly from the now-correctly-paginated fetch. If you add a new paginated query anywhere in this codebase, it needs `.order()` too — there's no shared helper enforcing this consistently, each call site added its own copy of the pagination loop.

**This list was not exhaustive — a second, separate instance turned up later the same day in `api/ai-analysis.js`'s `buildFreshChartData()`.** That function is a *different* code path from the one fixed above: a lightweight "recompute just the current month live" query used only on `checkOnly=1` (so the Team Trends chart shows up-to-date numbers without paying for a Claude call), separate from the main paginated fetch inside the full-generation flow in the same file. It had no pagination at all — not even the unordered kind — just a single `.select()` with no `.range()`, so it silently hit Supabase's default 1000-row cap outright. Found via a user report that the Team Trends "Voicemail & Missed" chart (41) didn't match the Call Performance report (252) for the same month; the truncated total was exactly 1000 (623 placed + 307 answered + 41 voicemail + 29 missed), which is what gave it away. **Takeaway: don't assume "the pagination bug" means the 4 files listed above — grep for every `call_log`/`sales_log` query without a `.range()`+`.order()` pair before treating this class of bug as closed.**

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — auth screens, scoring, rendering, upload UI, account tab (5 sub-tabs), admin panel, agency management, manual sales entry, sales log, sales performance charts (Chart.js 4), commissions calculator, activity bonuses, self-reporting |
| `api/upload.js` | Upload processor — JWT auth, XLSX parsing, user-scoped dedup, Supabase writes; member role guard |
| `api/history.js` | JWT-scoped historical_wins query; resolves dataUserId for members |
| `api/perf.js` | JWT-scoped call_log aggregation → daily/weekly/monthly/yearly + heatmap; resolves dataUserId |
| `api/admin.js` | Admin-only: list + update all accounts (includes has_commissions_addon toggle) |
| `api/config.js` | Serves public Supabase keys to the browser; returns 500 if env vars missing |
| `api/ai-analysis.js` | Premium/admin AI analysis — Claude prompt, caching, email via Resend; resolves dataUserId |
| `api/email-report.js` | Hourly cron — sends daily performance report to eligible pro/premium accounts |
| `api/delete-account.js` | Self-delete or admin-delete: cancels Stripe, wipes all user data + auth user |
| `api/signup.js` | Creates auth user via Admin API + sends admin notification email via Resend |
| `api/invite.js` | Invite lifecycle: create, validate token, accept (creates sub-user), resend |
| `api/members.js` | Agency member CRUD: list, update role, remove |
| `api/sales.js` | Manual/checklist sales CRUD; supports is_cancelled, chargeback_date, sale_weight; split sales create two rows at 0.5 weight each; member self-reporting |
| `api/agent-roster.js` | Agent roster CRUD + multi-structure PATCH actions |
| `api/checklist-config.js` | Sales config GET/PATCH; returns commission_structure_ids per agent; update_self_report action |
| `api/checklist-form.js` | Public checklist form — token-gated; writes checklist_submissions + sales_log |
| `api/addon-checkout.js` | Stripe checkout/cancel for sales tracking add-on ($25/mo) |
| `api/commissions-checkout.js` | Stripe checkout/cancel for commissions add-on ($25/mo) |
| `api/stripe-webhook.js` | Handles all Stripe subscription events for plan + sales_addon + commissions_addon |
| `api/commissions.js` | Per-agent commission calculation — multi-structure, chargebacks, bonus_earned, recalculation flag |
| `api/commission-structures.js` | CRUD for commission_structures table |
| `api/bonus-activities.js` | Activity type + entry CRUD with approval workflow and call-log auto-aggregation |
| `api/analysis-credits.js` | Credit wallet: GET balance, POST charge_run ($3 deduct), POST checkout (Stripe one-time payment) |
| `api/member-org.js` | Returns full org member list for owner or captain; used to build org chart tree |
| `setup.sql` | Full migration — run once in Supabase SQL Editor |
| `vercel.json` | Builds + routes |
| `package.json` | Dependencies: `@supabase/supabase-js`, `xlsx` |

## Vercel Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | all API routes + `/api/config` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `/api/config` → browser | Public key for client-side auth + reads |
| `SUPABASE_SERVICE_KEY` | upload, history, perf, admin, signup | Service role key — bypasses RLS for server writes |
| `RESEND_API_KEY` | email-report, ai-analysis, signup | Resend API key for all outbound email |
| `STRIPE_SECRET_KEY` | stripe-checkout, addon-checkout, commissions-checkout, analysis-credits, stripe-webhook, stripe-portal | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | Webhook signature verification |
| `STRIPE_PRICE_BASIC` | stripe-checkout, stripe-webhook | Stripe price ID for Basic plan |
| `STRIPE_PRICE_PRO` | stripe-checkout, stripe-webhook | Stripe price ID for Pro plan |
| `STRIPE_PRICE_PREMIUM` | stripe-checkout, stripe-webhook | Stripe price ID for Premium plan |
| `STRIPE_PRICE_SALES_ADDON` | addon-checkout, stripe-webhook | Stripe price ID for Sales Tracking add-on |
| `STRIPE_PRICE_COMMISSIONS_ADDON` | commissions-checkout, stripe-webhook | Stripe price ID for Commissions add-on |

## Supabase Tables

All data tables have a `user_id uuid` column (FK → auth.users) and RLS policy `user_id = auth.uid()`.

| Table | Purpose | PK |
|-------|---------|-----|
| `accounts` | One row per user — billing status, company info, column map | `user_id` |
| `race_data` | Live race totals per agent per user | `(user_id, agent_id)` |
| `call_log` | Every classified call | `(user_id, hash)` |
| `sales_log` | Every classified sale (upload, manual, checklist) | `(user_id, hash)` |
| `historical_wins` | Archived end-of-month per-agent results | no unique constraint — use delete+insert, never upsert |
| `historical_months` | Archived end-of-month team-level aggregates for trend charts | `(user_id, month)` |
| `race_config` | Key-value store — `current_month`, `last_upload_at` | `(user_id, key)` |
| `commission_bank` | Commission deferral ledger — one row per agent per month | `(user_id, agent_id, month)` |
| `scoring_config` | Point values per category | `(user_id, config_key)` |
| `account_members` | Sub-user invite/access records | `id (uuid)` |
| `agent_roster` | Per-account agent list for manual sales entry dropdowns | `(user_id, agent_id)` |
| `checklist_config` | Active form types per account (GSD, DSS, SCD, etc.) | `(user_id, form_key)` |
| `sales_subcategories` | Product subcategory options per account | `id (uuid)` |
| `checklist_submissions` | Public checklist form submissions | `id (uuid)` |
| `commission_structures` | Commission rate structures with tiers, thresholds, escalators | `id (uuid)` |
| `agent_commission_structures` | Junction table — agents ↔ commission structures (many-to-many) | `id (uuid)` |
| `bonus_activity_types` | Configurable activity types with payment rates | `id (uuid)` |
| `bonus_activities` | Per-agent activity entries with approval status | `id (uuid)` |

### accounts columns
`user_id, email, company_name, contact_name, phone, plan, agent_count, referral_source, status (trial/paid/deferred/past_due/cancelled), is_admin, notes, trial_ends_at, paid_through, stripe_customer_id, sales_column_map (jsonb), ai_analysis_cache (jsonb), ai_analysis_at (timestamptz), ai_history_key (jsonb), timezone, report_hour (smallint, default 7), report_email (text, nullable), last_report_date (date), created_at, last_login`

Added by `directive2-migration.sql`:
`checklist_token (uuid unique), has_sales_addon (boolean default false), sales_entry_mode (text default 'upload'), checklist_email_config (jsonb)`

Added by `lead-sources-migration.sql` (also in `setup.sql` as `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lead_sources jsonb`):
`lead_sources (jsonb)` — array of lead source label strings; editable in Account → Sales → Products. **Never include `lead_sources` in the critical accounts SELECT** (the one that checks auth/plan). Fetch it separately after auth succeeds with a standalone `.select('lead_sources')` query so a missing column doesn't break agents/locations/checklist.

`PATCH /api/checklist-config` with `{ leadSources }` now returns HTTP 500 with the Supabase error message on save failure (previously returned `{ ok: true }` silently).

Added for commissions/self-reporting:
`has_commissions_addon (boolean default false)`, `self_report_config (jsonb default '{}')` — see Self-Reporting section.

Added by `credits-migration.sql`:
`credit_balance (numeric default 0)` — pre-paid credit wallet; deducted $3 per on-demand analysis re-run.
`credit_waived (boolean default false)` — when true, the account can re-run analyses without spending credits (waived by admin). Admins (`is_admin=true`) always bypass credits on their own account regardless of this flag.

Added by `member-analysis-migration.sql`:
`has_member_analysis (boolean default false)`, `member_analysis_count (smallint default 0)`, `member_analysis_agents (jsonb default '[]')`, `member_analysis_agents_set_at (timestamptz)`, `member_analysis_cache (jsonb)`, `member_analysis_at (timestamptz)`, `member_hours_data (jsonb)`.
**`member_analysis_agents_set_at` is required** — the PATCH in `api/member-analysis.js` saves both `member_analysis_agents` and `member_analysis_agents_set_at` on a full save. If this column is missing the entire update fails silently, so agent selection never persists.

**Agent selection lock rules** (`api/member-analysis.js`):
- Full save (any existing agent removed or replaced): saves `member_analysis_agents_set_at = now`, starts 30-day lock. Returns `{ ok: true, lockedUntil }`.
- Additive save (seats available + no existing agent removed): saves `member_analysis_agents` only, lock clock unchanged. Returns `{ ok: true }` (no `lockedUntil`).
- `removeInactiveOnly: true`: saves `member_analysis_agents` only, no lock clock update, works for all users including admin. Validated server-side to block additions.
- Frontend: `saveMemberAnalysisAgents` only sets `_memberAnalysisAgentsSetAt = new Date()` when `d.lockedUntil` is present in response.

**Historical snapshots (`member_analysis_history` table), added 2026-07-24 — pending SQL migration:**
```sql
CREATE TABLE IF NOT EXISTS member_analysis_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id text NOT NULL,
  agent_name text NOT NULL,
  analysis_text text NOT NULL,
  generated_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS member_analysis_history_lookup ON member_analysis_history (user_id, agent_id, generated_at DESC);
ALTER TABLE member_analysis_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON member_analysis_history USING (user_id = auth.uid());
CREATE POLICY "member_read" ON member_analysis_history FOR SELECT USING (
  user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')
);
```
`accounts.member_analysis_cache` only ever holds the *latest* generated analysis — every regeneration overwrote it, so there was no way to see how coaching insights evolved over time. `member_analysis_history` is the append-only counterpart: whenever `generateAnalysis()` produces a fresh payload (GET handler's non-cached branch, after the `member_analysis_cache` save), one row per selected agent is inserted from `payload.agentSections` (keyed by display name — resolved to `agent_id` via `payload.agentData`) alongside `generated_at = payload.generatedAt`.

**24-month retention, enforced at write time** (not a separate cron job): immediately after inserting the new rows, delete any `member_analysis_history` rows for this `user_id` with `generated_at` older than 24 months. This keeps retention correct on every single write with no dependency on the monthly `api/cleanup.js` cron remembering to also prune this table. Chosen over 6/12 months specifically to support year-over-year comparison ("this July vs. last July") — the single most valuable longitudinal coaching comparison, which a shorter window would lose entirely — while still bounding storage growth (analyses regenerate at most every 5 days under normal use via `CACHE_TTL_MS`, so 24 months caps out around ~150 snapshots per agent in the worst case).

**Read path**: `GET /api/member-analysis?resource=history&agentId=X` returns that agent's snapshots newest-first, `{ generated_at, analysis_text }[]`. Access follows the same broad account-member model the rest of this file already uses (any active member/owner of the account, not scoped further by role) — there was no existing per-role restriction on the main cached analysis to match, so none was invented for history either.

**Frontend**: a "History" toggle inside each agent's expandable card (`js/member-analysis.js`, `renderMemberAnalysisCards`) lazy-fetches and renders past snapshots the first time it's opened, same lazy-load-on-expand pattern already used for the chart tiles (`renderAgentChartsIfNeeded`).

Added by `commission-bank-migration.sql`:
`commission_bank_config (jsonb default '{}')` — shape: `{ enabled, cap_per_period, interest_rate, interest_period }`. Managed in Account → Sales → Commissions sub-tab.

### account_members columns
`id (uuid PK), owner_user_id, member_user_id (nullable until accepted), email, role ('captain'|'chief_officer'|'bosun'|'custom'), custom_tabs (jsonb), status ('invited'|'active'|'removed'), invite_token (unique, nullable after accept), invite_expires_at, created_at, managed_by (uuid FK → account_members.id ON DELETE SET NULL), roster_agent_id (text nullable — links member to their agent_roster row)`

`roster_agent_id` is fetched at member login and stored in `_memberAgentId`. Used to auto-scope the Chargeback Report for bosun/custom members (chargeback filter locked to their own agent).
UNIQUE(owner_user_id, email)

`managed_by` — links a member to their direct manager (captain or CO). Used to build the org chart tree in `loadMemberOrgTree()`. Added by:
```sql
ALTER TABLE account_members ADD COLUMN IF NOT EXISTS managed_by uuid REFERENCES account_members(id) ON DELETE SET NULL;
```

### race_data columns
`user_id, agent_id, name, team, wl, ul, term, health, auto, fire, placed, answered, missed, voicemail, talk_min, avg_min, race_wide_missed, race_wide_voicemail, last_updated`

`wl, ul, term, health, auto, fire` on both `race_data` and `historical_wins` are **`numeric`**, not `integer` — migrated 2026-07-21 after split-sale (`sale_weight=0.5`) totals produced fractional category counts that failed to write against the old integer columns with `22P02 invalid input syntax for type integer`. This failure was silent at every call site (no error handling existed), so a current-month split sale landing on an odd total could quietly fail to update `race_data` with no visible symptom besides a wrong-looking race board. Migration:
```sql
ALTER TABLE race_data       ALTER COLUMN wl     TYPE numeric USING wl::numeric;
ALTER TABLE race_data       ALTER COLUMN ul     TYPE numeric USING ul::numeric;
ALTER TABLE race_data       ALTER COLUMN term   TYPE numeric USING term::numeric;
ALTER TABLE race_data       ALTER COLUMN health TYPE numeric USING health::numeric;
ALTER TABLE race_data       ALTER COLUMN auto   TYPE numeric USING auto::numeric;
ALTER TABLE race_data       ALTER COLUMN fire   TYPE numeric USING fire::numeric;
ALTER TABLE historical_wins ALTER COLUMN wl     TYPE numeric USING wl::numeric;
ALTER TABLE historical_wins ALTER COLUMN ul     TYPE numeric USING ul::numeric;
ALTER TABLE historical_wins ALTER COLUMN term   TYPE numeric USING term::numeric;
ALTER TABLE historical_wins ALTER COLUMN health TYPE numeric USING health::numeric;
ALTER TABLE historical_wins ALTER COLUMN auto   TYPE numeric USING auto::numeric;
ALTER TABLE historical_wins ALTER COLUMN fire   TYPE numeric USING fire::numeric;
```
All four `race_data`-update call sites (`api/_lib/race-data.js`, `js/account.js` `recalcSales()` and `setRaceMonth()`) now log (`console.error`) on write failure instead of swallowing it — still best-effort/non-blocking, but no longer invisible.

### historical_months columns
`user_id, month (text, "Apr 2026" format), placed, answered, missed, voicemail, talk_min, policies, created_at`

Written by `archiveCallStatsToHistorical` (upload.js) and `confirmArchive` (frontend). Read by `ai-analysis.js` for trend chart and r90 calculation. Deleted on account delete, data delete, and admin sandbox reset.

### sales_log columns (extended)
Base (from upload): `user_id, hash, agent_id, product, sale_date, written_premium`
Added by `directive2-migration.sql`: `source ('upload'|'manual'|'checklist'), customer_name, subcategory, lead_source, period (smallint), auto_issued (boolean), split_sale (boolean), teammate, checklist_id (uuid FK → checklist_submissions)`
Added manually: `issued_date (date)` — run `ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS issued_date date;`
Added for chargebacks: `is_cancelled (boolean default false)`, `chargeback_date (date)` — when `is_cancelled=true` and `chargeback_date` falls in the commission month, a negative line item is deducted from the agent's commissions.
Added by `split-sale-migration.sql`: `sale_weight (numeric NOT NULL DEFAULT 1)` — split sales create two rows each with `sale_weight=0.5`; `api/commissions.js` multiplies policy rates by this weight so split sales count as half a policy each.

### Split sales — always TWO independent rows, never one row with a "teammate" field

A split sale is represented as **two separate `sales_log` rows** — one per agent, each with its own real `agent_id`, its own already-halved `written_premium`, `split_ratio: 0.5`, and `sale_weight: 0.5`. `teammate` on each row just points at the *other* row's agent, for display/attribution — it is not a stand-in for a second agent's credit. This means every consumer of `sales_log` (race_data tallies, commission calc, chargeback calc, the Sales Log UI) can treat every row as fully self-contained and owned by its own `agent_id`; nothing needs to special-case `split_sale`/`teammate` to find "the other half."

**Do not "fix" a missing-teammate-credit bug by crediting `row.teammate` in addition to `row.agent_id`** — if both rows exist (the normal case), that double-counts the sale for both agents. This was tried and reverted during the 2026-07-21 investigation once real production data showed the two-row model was already in place for most split sales; the actual bug was a row *going missing*, not a crediting gap. If you see a split sale under-crediting one agent, check whether their row exists at all before touching the crediting logic.

**Where each row gets created:**
- Manual entry (`manualSubmitAll` in `js/sales-log.js`): sends two sequential `POST /api/sales` calls (primary, then teammate). The second call is retried once on failure and any remaining failure is surfaced in the save message (`teammateFailures`) rather than silently dropped — this used to fail silently, which is why some historical split sales in production only have one side's row.
- Checklist form (`api/checklist-form.js`): a single request builds both rows via `flatMap` in one atomic `sales_log` insert — no partial-failure window like the manual-entry two-request approach. (Before 2026-07-21 this only ever wrote the submitter's row; the teammate got no row, no race credit, and never showed up in their own Sales Log.)
- `rebuildRaceData` (`api/_lib/race-data.js`, shared by `api/sales.js` and `api/checklist-form.js`) and `_tallySalesTotals` (`js/account.js`, shared by `recalcSales()`/`setRaceMonth()`) both do a plain per-row `totals[row.agent_id] += (row.sale_weight ?? 1)` tally — correct precisely because every agent always has their own row.

`api/commissions.js`'s `calcStructurePayout` also has a `teammate`-matching "teammate role" branch (`roster.find(a => a.name.toLowerCase() === tmName)`) left over from an earlier single-row design — `teammate` stores an `agent_id`, not a display name, so this comparison never matches and the branch is effectively dead code. Each agent's own row (matched via the ordinary `sale.agent_id === agentId` branch) already gives them their correct, independently-split commission, so this dead branch is harmless as-is; a future cleanup could remove it, but nothing currently depends on it firing.

`other` and `deposit` products do NOT increment policy counts in race_data (excluded in `rebuildRaceData`).

### Split sales — issuing one side must issue the other (fixed 2026-07-31)

Both rows of a split sale always represent the same real-world sale, so there is no valid state where one side is issued and the other isn't. At **creation** time this was already consistent — both `manualSubmitAll` (`js/sales-log.js`) and `api/checklist-form.js` build both rows from one shared `baseBody`/`base` object, so `auto_issued`/`issued_date` start out identical on both sides. The gap was entirely at **edit** time: `PATCH /api/sales` (`api/sales.js`) only ever updated the single row matched by `hash`, with no lookup of the sibling row at all. A comment already on that handler (`"...e.g. issuing a split sale..."`, next to the `rebuildRaceData` call) refers only to `race_data` point-tally recompute, not `issued_date` — easy to misread as "issuance is already linked," which it wasn't.

**Fix**: after a successful `PATCH /api/sales` write, if the update touched `issued_date` (a direct edit, or the `auto_issued` derivation a few lines above it) and the row has a `teammate`, the handler now looks up the sibling row — matched on `(agent_id = teammate, teammate = this row's agent_id, sale_date, product, subcategory)`, since a split sale's two rows differ on `agent_id` and therefore on `hash` (hash is derived per-agent) — and propagates the same `issued_date` to it if it differs. This fires in both directions (issuing OR un-issuing either side), matching the actual invariant: the two rows must always share issued state. Response now includes `siblingHash` when a propagation happened; `js/sales-log.js`'s `saveSalesLogRow` already does a full `loadSalesLog()` refetch after every save, so the sibling's updated state shows up without any frontend change needed.

### agent_roster columns
`id (uuid PK), user_id, agent_id (text, slugified name), name (text), active (boolean default true), commission_structure_id (uuid nullable — legacy single-structure), commission_all_must_qualify (boolean default false), commission_product_overrides (jsonb default '{}' — see Overlapping-product attribution under Commission Structures), roster_agent_id (text nullable — links a member user to this agent for self-reporting), team (text default 'sales')`
UNIQUE(user_id, agent_id).

`team`: `'sales'` or `'service'`. **Persistent team assignment** — this is the source of truth for team, not `race_data.team`. `setAgentTeam()` writes to both `race_data` and `agent_roster` (via `PATCH /api/agent-roster` `set_team` action) so assignments survive month-end archive. `ensureRaceDataRows()` (upload.js) and `setRaceMonth()` seed `race_data.team` from this column instead of defaulting to `'sales'`. Migration SQL:
```sql
ALTER TABLE agent_roster ADD COLUMN IF NOT EXISTS team text NOT NULL DEFAULT 'sales';
UPDATE agent_roster ar SET team = rd.team FROM race_data rd
WHERE ar.user_id = rd.user_id AND ar.agent_id = rd.agent_id AND rd.team IS NOT NULL;
```

`commission_all_must_qualify`: when true and the agent has multiple structures, if any structure fails its threshold the entire payout is blocked. When false, each structure pays or doesn't independently.

### agent_commission_structures columns
`id (uuid PK), user_id, agent_id (text), commission_structure_id (uuid FK → commission_structures), sort_order (smallint default 0), created_at`
UNIQUE(user_id, agent_id, commission_structure_id). Supports multiple independent commission structures per agent. `api/commissions.js` checks this table first; falls back to legacy `commission_structure_id` on agent_roster if no junction rows exist.

### commission_structures columns
`id (uuid PK), user_id, name (text), ...` — stores rate tiers, threshold groups, escalators, floor amounts, min thresholds, required activity counts. Managed via Account → Sales → Commissions sub-tab.

### bonus_activity_types columns
`id (uuid PK), user_id, name (text), category, subcategory, source ('manual'|'call_log'), call_disposition (text nullable — filter for call_log auto-agg), active (boolean), sort_order (smallint), payment (numeric default 0 — $ per occurrence)`

### bonus_activities columns
`id (uuid PK), user_id, activity_type_id (uuid FK), agent_id (text), activity_date (date), count (int), notes (text), status ('approved'|'pending'|'rejected'), approval_note (text), submitted_by (uuid FK → auth.users), created_at`

### checklist_config columns
`user_id, form_key, label, active (boolean), sort_order (smallint)`. Auto-seeded on first GET to `/api/checklist-config`. Default form keys: GSD, DSS, SCD, DTD, SFPP.

### sales_subcategories columns
`id (uuid), user_id, scoring_category, label, is_financial_service (boolean), active (boolean), sort_order (smallint), is_default (boolean)`. ~40 defaults seeded on first access. Filterable by scoring_category in dropdowns.

### sales_locations columns
`id (uuid PK), user_id, name (text), active (boolean), sort_order (smallint), created_at, address (text), phone (text), hours (text)`

Goal columns — **pending SQL migration** (run in Supabase SQL editor):
```sql
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS goal_count_annual    integer;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS goal_premium_annual  numeric;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS goals_visibility     jsonb DEFAULT '["all"]'::jsonb;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS product_goals_monthly jsonb DEFAULT '{}'::jsonb;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS product_goals_annual  jsonb DEFAULT '{}'::jsonb;
```

`goals_visibility` — JSONB array of roles that can see this location's goals in the Goals tab. Values: `'all'`, `'captain'`, `'chief_officer'`, `'bosun'`, `'custom'`. "All" is mutually exclusive with role-specific values.

`product_goals_monthly` / `product_goals_annual` — JSONB objects keyed by scoring category (`wl`, `ul`, `term`, `health`, `auto`, `fire`) with numeric goal values.

### call_log columns
`user_id, hash, agent_id, disposition, talk_secs, call_dt (DATE), call_slot (SMALLINT 0–47)`

**`agent_id` is AES-256-GCM encrypted** with a random IV — the same value produces a different ciphertext on every write. Always use `decryptField(r.agent_id)` when reading agent_id back from call_log (implemented in `upload.js`, `sales.js`, and `ai-analysis.js`). Never compare raw ciphertext to plain agent IDs, and never use it as an aggregation/dictionary key without decrypting first — since the ciphertext differs on every row, doing so silently creates one fake "agent" per call_log row instead of grouping by real agent. This exact bug existed in `api/ai-analysis.js`'s Team AI Analysis for months (never decrypted `call_log.agent_id` before using it as an object key): a real ~13-agent team's call history exploded into thousands of single-call "agents" with garbled ciphertext names, bloating the Claude prompt to 350k+ characters and hitting the API's 200k-token limit (`prompt is too long`), while `ai_analysis_at` stayed `null` forever since the request never succeeded. Fixed 2026-07-18 — if any AI-analysis-adjacent feature starts hitting token-limit errors or shows garbled agent names, check for a raw (undecrypted) `call_log.agent_id` read first.

### scoring_config columns
`user_id, config_key, config_value`
Keys: `wl, ul, term, health, auto, fire, placed_sales, placed_service, answered_sales, answered_service, talk_per_min, avg_min, missed_deduct, voicemail_deduct`

## Account Tab Structure

The Account tab uses 6 sub-tabs controlled by `showAccountSubTab(name, btn)`. Sub-tab nav (`#acct-subtab-nav`) is hidden for members (they get a simplified view via `loadMemberAccountTab`).

| Sub-tab | Pane ID | Contents |
|---------|---------|----------|
| Profile | `#acct-pane-profile` | Account Info, Contact Info, Change Password |
| Billing | `#acct-pane-billing` | Plan & Billing, Sales Add-On card, Team Member Analysis card, Commissions Add-On card |
| Sales | `#acct-pane-sales` | Agent Roster, Checklist Link, Data Entry Mode, Email Template, Form Types, Product Subcategories, Lead Sources, Locations, Commissions structures, Bonus types, Access settings — locked (`#sales-pane-locked`) without add-on |
| Team | `#acct-pane-team` | Agency Management (invite/manage members) |
| Settings | `#acct-pane-settings` | Report Delivery (pro/premium only), Sales Column Mapping |
| Help | `#acct-pane-help` | How-to guides — see "Help / How-To Guides" below |

### Help / How-To Guides

`js/help.js` — `HELP_GUIDES` is a static array of `{ id, category, title, description, visibility, steps }`. `visibility` is an array of audiences: `'all'`, `'owner'` (`!_isMember || _isAdmin`), or specific member roles (`'captain'|'chief_officer'|'bosun'|'custom'`) — checked per-guide by `_canSeeHelpGuide(g)`, same pattern as `goals_visibility`/`canPrivate` elsewhere. Static/code-authored, not a DB table or admin-editable CMS — add guides by editing `HELP_GUIDES` directly (with matching image assets, see below) since this is low-frequency documentation content, not something that needs a live editor.

`renderHelpTab(listId, wrapperId)` renders guides grouped by category (only categories with ≥1 visible guide render, so the section never looks sparse) into two separate call sites since owners and members use structurally different Account layouts:
- Owner: `#help-guides-list` inside `#acct-pane-help`, rendered on `showAccountSubTab('help', ...)`.
- Member: `#member-help-guides-list` inside `#member-help-section` (within `#member-account-panel`), rendered from `loadMemberAccountTab()` — the whole section is hidden via the `wrapperId` param when no guides are visible to that member's role, so an empty state doesn't show up in the middle of their simplified Account view.

**Screenshots are re-hosted in-repo**, not linked externally (Scribe-exported guides originally point at `colony-recorder.s3.amazonaws.com`, third-party storage that could disappear). Stored at `img/help/<guide-id>-<n>.jpg`. **This repo's static routing requires every asset explicitly listed in both `builds` and `routes` in `vercel.json`** — there's no wildcard/directory serving — so adding a guide's images means adding one `builds` + one `routes` entry per image file, same as the existing `js/*.js` pattern.

**Before re-hosting any Scribe screenshot, check every edge for cropped-in PII** — Scribe's auto-blur only catches elements fully inside the crop frame; a sliver of an element (e.g. a table row's email column) cut off at the image boundary can leak unblurred. Caught one real instance 2026-07-23: an agent's email address was visible in a ~50px strip at the very top of a Team-page screenshot, cropped out before the file was committed. Check all four edges of every screenshot at full resolution before adding it to `img/help/`.

**Lead Sources** are managed inside Account → Sales → Products. Stored as `accounts.lead_sources (jsonb)`. Frontend state: `_leadSources` (Account tab) and `_clLeadSources` (checklist form).

`loadAccountTab()` always resets to Profile pane on open. `goToAccountTab('billing')` deep-links to Billing.

**Billing pane add-on cards** (all owner-only, hidden for members):
- `#sales-addon-section` — Sales Tracking ($25/mo): `renderSalesAddonSection(acct)` drives upsell vs active
- `#member-analysis-section` — Team Member Analysis ($10/seat/mo): `renderMemberAnalysisSection(acct)`
- `#commissions-addon-section` — Commissions ($25/mo): `renderCommissionsAddonSection(acct)` — shows upsell or active state; active state links to Commissions tab
- `#analysis-credits-section` — Analysis Credits wallet (visible when `has_member_analysis || _isAdmin`). Shows current balance, three Add buttons ($5/$10/$20). `fetchAnalysisCredits()` loads balance from `GET /api/analysis-credits`. `addAnalysisCredits(amount)` calls `POST /api/analysis-credits` action=checkout and redirects to Stripe. On return, `?billing=credit_success` shows a toast. `loadAccountTab()` calls `fetchAnalysisCredits()` when credits section is visible.

**Sales sub-tabs** (inside `#acct-pane-sales`): Team | Checklist | Products | Locations | Commissions | Bonus | Access

## Sales Tracking Add-On

### loadAddonConfig()
Called `await`-ed at login for all non-member owners (not gated behind `_hasSalesAddon`). Fetches `GET /api/checklist-config` and populates:
- `_hasSalesAddon`, `_salesEntryMode`, `_checklistToken`, `_checklistEmailCfg`, `_checklistFormCfg`, `_salesSubcats`, `_agentRoster`, `_hasCommissionsAddon`, `_selfReportConfig`

**Critical**: must be awaited before `renderManageTabMode()` — race condition existed previously where `_agentRoster` was empty when `manualAddRow()` ran.

### Manual Sales Entry (Manage tab)
Shown when `_salesEntryMode === 'manual'` (or `_isAdmin`). Entry row fields:
- Row 1: Agent (from `_agentRoster`) | Product (SCORING_CATS) | Subcategory (filtered by product)
- Row 2: Sale Date | Issued Date | Premium | Period | Lead Source
- Row 3: Customer Name | Auto Issued | Split Sale | Remove
- Conditional: Teammate (when Split Sale checked)

**Auto Issued**: when checked, Issued Date auto-fills from Sale Date and is disabled. `msrSaleDateChanged` keeps them in sync if date changes while checked.

Submitted via `POST /api/sales`. On success: row removed, `loadRaceData()` refreshed, and `manualAddRow()` is called automatically to seed a fresh blank row for sequential entry.

**Duplicate detection**: the API computes a hash of `[agentId, product, subcategory, saleDate, writtenPremium, normalizedName]`. If that hash already exists and `force` is not set, the API returns `{ duplicate: true }` (HTTP 409). The frontend (`_msrShowDupWarning` in `sales-log.js`) shows an amber warning on the row with **Add anyway** / **Skip** buttons. "Add anyway" sets `row.dataset.dupForce='1'` and resubmits with `force: true`; the API then salts the hash with `Date.now()` to insert a new row without overwriting the existing one.

### Sales Log (Performance tab → Sales Log sub-tab)
Shows last 200 manual + checklist entries. Gated by `_hasSalesAddon || _isAdmin`.

**Sort**: unissued first (no `issued_date`), then by `sale_date` desc within each group.
**Columns**: source icon | sale date | agent | product · subcategory | customer name | premium | Issued badge | Chargeback badge (red, when is_cancelled=true) | Edit | ✕

**Edit form** includes a Chargeback section: "Policy Cancelled" checkbox (`is_cancelled`) + conditional chargeback date input. `slCancelledChanged()` shows/hides the date row.

`_salesLogEntries` module-level array holds the fetched entries; `filterSalesLog()` → `renderSalesLog()` re-renders without re-fetching.

**Date filter modes**: Monthly | Quarterly (Q1–Q4) | **Specific Dates** — the "Specific Dates" option shows two `<input type="date">` fields (`#sl-date-from`, `#sl-date-to`). `onSalesLogSpecificDateChange()` sets `_salesLogCustomFrom`/`_salesLogCustomTo` and calls `loadSalesLog()` when both dates are valid and from ≤ to. `_slHideSpecificRange()` restores the month/year selectors when switching away.

### Sales Scorecard
`_renderSlScorecard(entries)`: when "All Locations" filter is active, aggregates cumulative goals across all `goals_enabled` locations and shows color-coded progress pills alongside per-product scorecards.

### Checklist Form — Two Location Fields

| Field | Element ID | Panel | Purpose | Flows to |
|-------|-----------|-------|---------|----------|
| Appointment Location | `#cl-appt-location` | Customer Info | Location of in-person appointment | Customer notification email |
| Sales Location | `#cl-location` | Sales panel | Where the sale occurred | `sales_log.location` |

`cl-appt-location` shown only when Meeting Type = "In Person". `cl-location` shown whenever `_clLocations.length > 0`.

### Checklist Email Template — Spanish (Dual-Language)

The customer email sent after a checklist form submission supports full Spanish. The agency maintains separate English and Spanish template fields; no AI translation is used.

**UI** — Account → Sales → Email: an English | Español tab toggle (`etSetLang(lang)`) shows/hides the respective field groups. All structural labels and user-customized text have independent Spanish fields. Leaving a Spanish field blank falls back to the built-in `ET_DEFAULT_*_ES` constant for that section.

**Pre-built Spanish defaults** (`ET_DEFAULT_BODY_PARA1_ES`, `ET_DEFAULT_BODY_PARA2_ES`, `ET_DEFAULT_IMPORTANT_TITLE_ES`, `ET_DEFAULT_IMPORTANT_BODY_ES`, `ET_DEFAULT_RESOURCES_TITLE_ES`, `ET_DEFAULT_RESOURCES_LINKS_ES`, `ET_DEFAULT_THANK_YOU_ES`) — written directly into `index.html`; the feature works without any configuration.

**Storage** — all `*_es` fields are stored in `accounts.checklist_email_config` alongside their English counterparts:
`greeting_es, footer_es, body_para1_es, body_para2_es, important_title_es, important_body_es, resources_title_es, resources_links_es, thank_you_es`

**Rendering** — `buildCustomerEmailHtmlEs(payload)` wraps `buildCustomerEmailHtml(esPayload, esFormItems)`:
- Merges `*Es` payload fields over English fields, falling back to `ET_DEFAULT_*_ES` constants
- Builds `esFormItems` map using each form item's `title_es / description_es / link_label_es` (falls back to English)
- Post-processes the returned HTML to replace hardcoded English strings: `'YOUR NEXT APPOINTMENT'` → `'SU PRÓXIMA CITA'`, `'>Best regards,<'` → `'>Atentamente,<'`

`buildCustomerEmailHtml` accepts an optional `formItemsOverride` second parameter to avoid global state mutation; `buildCustomerEmailHtmlEs` uses this to pass the derived Spanish items map.

**Outlook copy-paste compatibility**: `buildCustomerEmailHtml` produces `fullHtml` as an array joined with `\n` (not a template literal). Before writing to the clipboard blob, `bodyHtml` is compacted via `bodyHtml.replace(/>\s+</g, '><')` to strip whitespace text nodes between table elements. The `fullHtml` wrapper includes:
- `xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"` on `<html>`
- `<!--[if gte mso 9]><xml><o:OfficeDocumentSettings>...</o:OfficeDocumentSettings></xml><![endif]-->`
- `-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%` on `<body>`

These match the original `sales-checklist1` repo's output exactly. Do not revert to a template literal for `fullHtml` — it reintroduces whitespace nodes that Outlook renders as extra line spacing.

### Checklist Form Items — Spanish Fields

Each form item (GSD, DSS, SCD, etc.) has an English | Español tab panel in Account → Sales → Email → Form Items. `fiSetLang(lang)` toggles `.fi-lang-en` / `.fi-lang-es` CSS classes across all item panels simultaneously.

**Spanish fields per item** (stored in `checklist_email_config.formConfig[key]`):
- `title_es` — Spanish title (falls back to English `title` when blank)
- `description_es` — Spanish description
- `link_label_es` — Spanish link label (link URL is shared with English)

`saveFormItems()` collects and persists these fields via `PATCH /api/checklist-config` with `action: 'update formTypes'`. `buildCustomerEmailHtmlEs` reads them from `_clFormItems` at send time.

### Checklist sale silently lost after submission — three-bug fix (2026-07-31)

Reported symptom: an agent (Braden Rickey) submitted the sales checklist for a sale and it never appeared in the Sales Log, with no visible error. Investigation (confirmed against production Supabase data — `agent_roster`/`checklist_submissions`/`sales_log` for that agent) found three independent bugs in the same submit path, all fixed:

1. **`js/checklist.js` — inline validation didn't block submission.** The per-sale-row validation (product/premium/lead source/split-sale teammate required, `~line 415`) calls `clErr()` to flag a field red, which sets the shared `firstErrEl` — but the early-return guard (`if (firstErrEl) { ...; return; }`) only ran once, right after the earlier top-of-form validations, *before* the sale rows were even collected. A sale row missing e.g. a lead source flashed red but the form submitted anyway. Fixed by adding the same `if (firstErrEl) { scrollIntoView; return; }` guard again immediately after the sale-row validation loop.
2. **`api/checklist-form.js` — sales validated after the checklist row was already saved.** `missingSrc`/`missingTeammate` checks ran *after* the `checklist_submissions` insert, so a rejected sales array still left the appointment logged with no way to reattach the sale afterward. Fixed by moving both checks up next to the existing roster/security validation, before any insert happens.
3. **`api/checklist-form.js` — `sales_log` insert failures were completely silent.** `const { error: salesErr } = await supabase.from('sales_log').insert(...); if (salesErr) console.error(...)` never returned an error — the handler still responded `200 { ok: true }`, so the agent saw the success modal and the customer confirmation email sent normally while the sale itself never landed in `sales_log`, with zero symptom on the agent's end. This is the most likely root cause of the reported incident specifically, since bugs 1–2 would at least show an inline error. Fixed to return `500` with an explicit message (`"Appointment saved, but the sale details failed to save..."`) when `salesErr` is set, instead of falling through to success.

**Not itself a fix, but worth knowing:** `checklist_submissions` doesn't store the submitted `sales` array anywhere, so a submission row with no matching `sales_log` row is not distinguishable after the fact from a legitimate no-sale visit — there's no audit trail of "a sale was attempted but failed" beyond the (now-fixed) error response at submit time and whatever Vercel function logs still exist for that request.

### api/sales.js — resolveUser
Checks `is_admin` and sets `hasSalesAddon = true` for admins. Members must be captain/chief_officer, OR have `self_report_config.sales_enabled = true` on the owner account. Non-captain/CO members auto-fill their own `agent_id` from `roster_agent_id`.

### api/sales.js — Date Range Params
`GET /api/sales` supports optional `fromDate` and `toDate` query params (YYYY-MM-DD). Used by `spLoad()` in Sales Performance for custom date ranges.

### Agency Goals (Goals tab)

`_renderAgencyGoalsSection()` — renders location goals at the top of the Goals tab. Reads `_salesLocations`, filters by `goals_enabled = true` and `goals_visibility` matching the current user's role. Shows:
- Monthly policy goal / monthly premium goal
- Annual policy goal / annual premium goal
- Per-product monthly goals (WL/UL/Term/Health/Auto/Fire)
- Per-product annual goals

Visibility is set per-location in Account → Sales → Locations → Goals section. Checkboxes: Everyone (mutual exclusive with role-specific) / Captain / Chief Officer / Bosun / Custom. `onLocVisChange(id)` handles mutual exclusion.

`saveLocationDetails()` reads all goal fields and sends `goal_count_annual`, `goal_premium_annual`, `goals_visibility`, `product_goals_monthly`, `product_goals_annual` to `PATCH /api/checklist-config` action `update_details`. **Requires the 5 `sales_locations` goal columns to exist in Supabase** (see pending migration above).

### Org Chart / Member Hierarchy

**State variables**:
```js
let _memberOrgTree   = [];    // built tree of member nodes with .subordinates arrays
let _memberOrgLoaded = false; // guard to avoid duplicate fetches
```

**`loadMemberOrgTree()`** — fetches `GET /api/member-org`, builds parent-child tree using `managed_by` FK. Members with no `managed_by` become roots. Called before rendering Goals tab and Chargeback Report when the user is an owner or captain.

**`_getOrgGroups()`** — returns CO-grouped sections for display, or `null` when no COs exist:
```js
[{ label, coAgentId, agentIds: [coId, ...subordinateIds], isUnassigned: false }]
```
Appends an "Unassigned" group for any active roster agents not assigned under any CO.

**`renderGoalsTab()`** uses org groups to render a CO header → CO's own goals → indented subordinate goals. Falls back to flat display when `_getOrgGroups()` returns null.

**Race tab goal quick-view vs Goals tab drift (fixed 2026-07-21)**: the Goals tab always displays `agGoal.actuals` — computed server-side by `computeActuals()` (`api/agent-goals.js`), scoped to the goal's own `period_start`/`period_end` and counting raw `sales_log` rows unweighted. The small goal-progress box under an agent's name on the Race tab (`renderRaceGoalsRow(ag)` in `js/goals.js`) used to special-case monthly goals to read `ag[key]` (the live `race_data` row) instead — a different pipeline scoped to `race_config.current_month` and weighted by `sale_weight`, which silently drifts from `computeActuals()` whenever "Set Race Month" is used, an out-of-order upload occurs, `race_data` hasn't been recalculated since a sale was edited/cancelled, or the agent has split sales (weighted 0.5 in `race_data`, unweighted in `computeActuals`). Fixed by always using `agGoal.actuals` in `renderRaceGoalsRow`, same as the Goals tab — the `ag[key]` fallback branches are dead code now, kept deleted rather than left unreachable.

### Agent Roster
`agent_roster` is the canonical source for manual entry agent dropdowns. `agent_id` in roster must match `agent_id` in `race_data` for manual sales to roll up correctly. `refreshAgentDropdowns()` is called automatically after every add, edit, or delete operation to keep all live dropdowns in sync without a page reload.

**Active filter on race tab**: `renderRace(data)` filters `race_data` to only agents where `agent_roster.active !== false`. Agents marked inactive are excluded from the leaderboard and scoring grid. `buildTeamToggleUI()` applies the same filter. `_agentRoster` is the source of truth — if roster is empty (no sales add-on), all agents show.

**Name resolution on race tab**: `renderRace` resolves display names from `_agentRoster.find(a => a.agent_id === ag.agent_id)?.name` — not from `race_data.name`. This ensures renames show immediately without requiring a new data upload. `api/agent-roster.js` PATCH also syncs `race_data.name` on rename for consistency.

**Team assignment persistence**: `setAgentTeam()` writes to both `race_data.team` (live race) and `agent_roster.team` (permanent) in parallel. `race_data` rows are deleted on archive; `agent_roster.team` persists across months so captains never need to re-assign teams. `_agentRoster` cache is updated in-place immediately after save.

**Sales-by-Agent tile bosun-scoping bug (fixed 2026-07-21)**: `renderSalesTile()` (`js/race.js`) has two data sources — the office-wide `_raceData` fallback, and a richer `_salesTileEntries` populated by `loadSalesTileData()` (`GET /api/sales?month=&year=`, fetched a moment after the initial render). `GET /api/sales` intentionally scopes results to just the caller's own `agent_id` for bosun/custom members (correct for the Sales Log tab) — so for a bosun with `roster_agent_id` linked, `_salesTileEntries` only ever contains their own row. The tile's render logic used to switch to `_salesTileEntries` unconditionally whenever any entries existed, which meant the office-wide render flashed briefly then narrowed to "just me" once that fetch resolved — reproduced only on bosuns whose *owner account* has the sales add-on enabled (since `loadSalesTileData()` only fires when `_hasSalesAddon || _isAdmin`). Fixed by gating `useSalesLog` on `isCapOrCO` (`!_isMember || ['captain','chief_officer'].includes(_memberRole)`) so non-captain/CO members always fall through to the unfiltered `_raceData` aggregate for this tile, regardless of whether `_salesTileEntries` got populated.

**Sales-by-Agent tile ignored `sale_weight` for owner/captain/CO (fixed 2026-07-24)**: the fix above routes bosun/custom members to the `_raceData` fallback branch, which already correctly sums `sale_weight` (`rebuildRaceData` does `+= (row.sale_weight ?? 1)`). But the OTHER branch — `_salesTileEntries`-based, used whenever `useSalesLog` is true (owner, or captain/CO members) — incremented `products[e.product]++`/`total++` by a flat 1 per row regardless of weight, so a split sale (two rows at 0.5 each) counted as **2 full sales** instead of 1. Compounding this, `sale_weight` wasn't even in the `COLS` list `GET /api/sales` selected for this query path, so it was always `undefined` on the entries this branch received. This is why the bug surfaced as "admin doesn't see .5 sales, individual agents do" — non-captain/CO members were (as of the fix above) already bypassing this branch entirely via `_raceData`, which was never affected. Fixed by adding `sale_weight` to `COLS` in `api/sales.js` and changing the tile's per-row increment to `+= (e.sale_weight ?? 1)` in `js/race.js`. `0.5` is exactly representable in IEEE-754 float (unlike e.g. `0.1`), so summing any number of `0.5`/`1` weights needs no extra rounding to avoid floating-point drift in the displayed totals.

Debug query:
```sql
SELECT agent_id, name, active FROM agent_roster
WHERE user_id = (SELECT id FROM auth.users WHERE email = 'user@example.com')
ORDER BY name;
```

## Commissions Add-On

Gated by `has_commissions_addon = true` on accounts (`_hasCommissionsAddon || _isAdmin` in frontend). $25/mo, purchased via `/api/commissions-checkout`.

### Commission Structures
Managed in Account → Sales → Commissions sub-tab. Each structure has: name, product rates per category, a minimum threshold, a floor (only amount above floor pays), threshold groups (multiple products combined), and optional escalators (rate upgrades at volume breakpoints).

Multiple structures can be assigned to a single agent via the `agent_commission_structures` junction table. The agent roster UI shows each agent's assigned structures with remove buttons, an "Add structure" dropdown for unassigned ones, and (when >1 structure) an "All structures must qualify" checkbox.

**Agent Roster is a React island, not `renderAgentRoster()`** — `js/roster-island.js` mounts a React root on `#agent-roster-list` at `DOMContentLoaded` and overwrites `window.renderAgentRoster` with its own re-render function. The `renderAgentRoster()` function defined in `js/sales.js` is dead code — it never runs once the island mounts (which happens before any user-triggered call could occur). All agent-card HTML — including the commission structure section, overlap-override picker, and goals section — is built by `buildAgentCardHtml()`/`buildCommissionSectionHtml()`/`buildOverlapHtml()` in `js/roster-island.js` and injected via `dangerouslySetInnerHTML`. **Any Agent Roster UI change must go in `js/roster-island.js`, not the `js/sales.js` function of the same name** — confirmed by browser-testing during the commission-overlap fix, where the `js/sales.js` version silently never rendered.

**Overlapping-product attribution** (`agent_roster.commission_product_overrides jsonb`, shape `{ [productKey]: structureId | 'both' }`): when an agent has 2+ structures both rating the same product (e.g. two structures each configure a flat $25 `deposit` rate), the DEFAULT behavior sums commission across every structure that rates it — this is the original/unchanged behavior, so no one's pay changes automatically. The Agent Roster UI shows a "⚠ Overlapping products rated in multiple structures" panel (only when 2+ overlapping products are detected from `_commissionStructures` rates) with a per-product dropdown so the owner can explicitly restrict a product to one specific structure instead of summing both. `saveCommissionProductOverride()` → `PATCH /api/agent-roster` action `update_product_override`. The override is honored identically by **both** the earned calculation (`calcStructurePayout` skips a sale for a structure when overridden to a different one) and the chargeback deduction (`chargebackCommission` in `api/_lib/commission-calc.js`), so earned and chargeback always stay consistent with each other for a given agent/product.

### api/_lib/commission-calc.js — Shared Commission Math

Not a route (absent from `vercel.json` `builds`/`routes` — plain importable module). Exports `applyRate()` (rate lookup, moved here from `api/commissions.js`), `calcStructurePayout()` (one structure's payout for one agent over a date range — rates, threshold groups, floors, escalators), and `computeChargebackAmount(ctx, sale, structList, overrides)` — used by both `api/commissions.js` (its own chargeback line items) and `api/sales.js` (`chargebackMode` on the Chargeback Report) so the two reports always agree on dollar amounts, by internally re-running `calcStructurePayout` with/without the cancelled sale and taking the marginal difference (`marginalStructureValue`). Honors `commission_product_overrides`: a specific structure ID restricts the deduction to that structure only; `'both'` or unset sums every assigned structure with a non-zero rate (mirroring earned's default). Also exports `buildStructureListLookup(roster, structureById, junctionRows)` for building a `getStructureList(agentId)` lookup outside `api/commissions.js`. (This section previously referenced a `chargebackCommission()` export that no longer exists under that name — corrected 2026-07-31.)

**Split-sale commission was double-halved — dollar share and policy count both wrong (fixed 2026-07-31).** Reported as "the premium splits correctly, but the commission share gets split again, and count-based commissions look inflated." Both were real, and both traced to the same root cause: `calcStructurePayout`'s per-sale math (`share = premium * ratio`, plus a flat `+1` per row into `groupCounts` for threshold/escalator gating) was written for the *original* single-row split-sale design, where one `sales_log` row held the full deal premium and `split_ratio` derived each agent's cut from it. The 2026-07-21 redesign moved split sales to **two independent rows**, each with `written_premium` already halved *at insert time* (`api/sales.js`, `api/checklist-form.js`) — but this commission math was never updated to match, so it was re-applying `split_ratio` on top of an amount that was already halved (quarter of real premium instead of half), and counting each side of a split sale as a full policy (inflating `min_count` thresholds and escalator tiers keyed off `groupCounts`).

Fix: `share = premium` directly (the row's own `written_premium` already *is* this agent's correct share — no ratio math needed), and `groupCounts` now accumulates `sale.sale_weight` (0.5 for either side of a split, the same "counts as half a policy" convention `race_data` already uses) instead of a flat `+1`. Also removed the `role: 'teammate'` branch (matched `sale.teammate` against roster display names) — already documented elsewhere in this file as confirmed-dead code from the same old single-row design (teammate stores an agent_id, not a name, so it never matched) — rather than leave equally-stale math sitting next to the fix. The parallel display-only `share` computed in `api/commissions.js`'s itemized chargeback list got the identical fix; the actual chargeback dollar amount was already correct since it goes through `computeChargebackAmount`/`calcStructurePayout`.

**Verified live** (`vercel dev`, real production data on the one account with active split sales): stashed the fix to capture "before" and "after" from the exact same endpoint for July and June 2026. Every agent *without* split sales that month showed byte-identical `earned`/`net_earned` old vs. new (zero regression risk for normal commissions). Every agent *with* split sales changed by precisely the expected amount — e.g. an agent with one simple split sale and no threshold complications saw their commission exactly double (quarter → half), and `groupCounts` shifted down by exactly `0.5` per split row now properly weighted.

**Historical audit**: system-wide, only two accounts have ever had a `split_sale=true` row. One's split sales are all dated today with no commission ever yet recorded against them (nothing to true up). The other has exactly one affected historical payment: **Tiffany Dabe, June 2026 — recorded/actually paid $403.16 (matches the old buggy calculation exactly); corrected calculation for that same month is $567.56 — a $164.40 underpayment.** No other agent/month/account is affected.

**Remediation applied (2026-07-31)**: rather than alter the historical `commission_payments` record (the $403.16 really was paid, and should stay an accurate record of that), the $164.40 delta was added directly to her `commission_bank` ledger — June's row updated to `earned: 567.56, banked_amount: 164.40, bank_balance_after: 164.40` (was `0`), with a `notes` field explaining the correction. This works because `bank_balance_after` is the *only* field the GET handler actually reads back (as `priorBankBalance`, matched by closest chronologically-prior month — see "Carry-forward" above) — every other bank-ledger column is historical/display-only. Verified live: July 2026's calculation now shows `bank_summary.balance_before: 164.40` and `outstanding_receivable: 164.40`, confirming the credit correctly carries forward and is visible to the owner, with no cap configured on this account so it isn't auto-drawn-down — it just sits as a tracked, visible balance until the owner accounts for it in a future payment.

### api/commissions.js — Key Patterns

**`calcStructurePayout(agentId, struct, sales, roster, isFinancialService, actCounts, fromDate, toDate, overrides)`** — standalone helper called once per structure per agent. `overrides` is the agent's `commission_product_overrides`; a sale's product is skipped for this structure when overridden to a different structure ID. Returns `{ earned, breakdown, threshold_note, group_details, ungrouped_earned }`. Each `breakdown` item includes `{ hash, product, premium, share, commission, split, role, customer_name, sale_date, subcategory }` — `customer_name` is decrypted via `decryptField` (same AES-256-GCM as `api/sales.js`, key from `CUSTOMER_ENCRYPTION_KEY` env var).

**Ungrouped commissions blocking rule**: products with rates in a structure but NOT assigned to any threshold group go to `ungrouped` and normally always pay. Exception: if any threshold group has activity (counts > 0 or earned > 0) and fails its floor, AND no group with activity passes, `effectiveUngrouped = 0` — the entire structure earns $0. This prevents ungrouped products from double-counting when the same products are also rated in a second passing structure. Multi-group case: if at least one group with activity passes, ungrouped still pays.

**`SKIP_PRODUCTS`** (`new Set(['other','other2','other3','other4','other5','deposit','skip'])`) — module-level constant in `api/ai-analysis.js`. Excluded from policy counts in both `buildFreshChartData` and the full analysis sales loop.

**`getStructureList(agentId)`** — checks `agent_commission_structures` junction table first, falls back to legacy `commission_structure_id` field on `agent_roster`. Backward compatible.

**Multi-structure result shape** (when agent has >1 structure):
```js
{
  earned,          // total across all structures
  bonus_earned,    // Σ(actCount[typeId] × actPayments[typeId]) for approved activities
  chargebacks,     // negative line items from cancelled sales where chargeback_date in month
  chargeback_total,
  net_earned,      // earned + bonus_earned - chargeback_total
  recalculated,    // true when paid.amount_paid != net_earned (within $0.01)
  structure_details: [{ structure_id, structure_name, earned, threshold_note, breakdown, blocked_by_qualifier }]
}
```
Single-structure agents: `structure_details` is null; compat fields (`earned`, `breakdown`, `threshold_note`) at top level.

**Chargeback logic**: finds `sales_log` rows for the agent where `is_cancelled=true` and `chargeback_date` falls within the commission month. Calculates commission amount via `chargebackCommission()` (`api/_lib/commission-calc.js`), which respects `commission_product_overrides`, and returns as a negative.

**Recalculation detection**: `recalculated = paid != null && Math.abs(paid.amount_paid - net_earned) > 0.01`. Shown as amber row highlight + "⚠ Recalculated" badge in the commissions table.

### Commissions Tab (Performance → Commissions)
Gated by `_hasCommissionsAddon || _isAdmin`. Teaser shows $25/mo price and "Add to Plan" button linking to Billing.

Commissions table columns: Agent | Structures | Earned | Bonus | Chargebacks | Net | Status (Paid/Unpaid).
Expanding a row (↓ button) opens the breakdown panel, rendered by `_buildCommAgentDetailHtml(r)` in `js/sales.js` — structure/group breakdowns (via `_buildCommBreakdownHtml(breakdown, sdPrefix)`), commission bank summary, itemized chargebacks, and carry-forward. This function is shared verbatim between the owner's expandable row and the member's own-commission view (below) so both always show identical numbers:
- Sales are **grouped by product** with a bold header row showing count, total premium, total share, and total commission per product
- Each individual sale has a **+ button** (`toggleCommSaleDetail`) that expands an inline detail row showing date, customer name, subcategory, and split role
- `_fmtCommDate(d)` formats `YYYY-MM-DD` → `"Jan 15, 2026"` for display
- Multi-structure agents: `_buildCommBreakdownHtml` is called once per structure with a prefix of `agentId + '-' + structureId.slice(0,6)` to keep detail row IDs unique across structures

**Member view** (`_isMember` branch of `renderCommissions()`): shows the member's own agent row(s) with the same `_buildCommSummaryStatsHtml(r)` summary line the owner sees (Earned, Bonus, CB, Prior Debt when carry-forward debt applies, Net) followed by the same `_buildCommAgentDetailHtml(r)` detail panel — full transparency into how the member's own compensation was calculated, not just a bare earned total.

### api/agent-roster.js — PATCH Actions
- `set_team`: updates `agent_roster.team` for an agent — accessible to both **owners and captain members** (all other actions are owner-only)
- `add_commission_structure`: upserts into `agent_commission_structures` with auto sort_order
- `remove_commission_structure`: deletes from junction table
- `update_qualifier`: sets `commission_all_must_qualify` on the agent_roster row
- `update_product_override`: read-modify-write merge into `agent_roster.commission_product_overrides` — `{ agent_id, product, structure_id }`; `structure_id` of `'both'`/falsy deletes the override key (reverts to default sum-both behavior)

### Commission Bank

Defers a configurable portion of earned commissions across periods (e.g., hold-back for chargebacks, interest accrual).

**`commission_bank_config jsonb`** (on `accounts`):
```json
{ "enabled": true, "cap_per_period": 500, "interest_rate": 0.05, "interest_period": "monthly" }
```
Managed in Account → Sales → Commissions sub-tab.

**Bank toggle behavior**: the "Enable Commission Bank" checkbox (`#bank-enabled`) uses `onchange="this.checked ? toggleBankFields(true) : (toggleBankFields(false), saveBankConfig(this))"`. Unchecking auto-saves `enabled: false` immediately — the Save button lives inside `#bank-config-fields` which is hidden when unchecked, so auto-save is the only way to persist the disabled state. Do not revert to `onchange="toggleBankFields(this.checked)"` — that makes it impossible to save when turning off.

**`commission_bank` table** — ledger of deferred/banked amounts per agent per month:
PK `(user_id, agent_id, month)`. Each row records how much was deferred that period and whether it has been released.

### Chargeback amount — marginal contribution, not a flat rate

`computeChargebackAmount()` (`api/_lib/commission-calc.js`) deducts the sale's MARGINAL contribution to the agent's payout in the month it was actually earned — `(month's earned WITH the sale) − (WITHOUT it)`, computed per structure via `calcStructurePayout()` with the sale's cancelled flag temporarily flipped. A flat per-sale rate is wrong whenever a structure has threshold groups: a sale that tipped a group over its floor is worth the group's WHOLE payout, not its own raw rate; a sale that didn't change the outcome is worth $0. Both `api/commissions.js` (its own chargeback processing) and `api/sales.js` (`chargebackMode` — the Chargeback Report) call this same function, so the two reports always agree. Known limitation: this evaluates each structure independently and does not replicate `commission_all_must_qualify` / `commission_cap_total` cross-structure interactions for the historical earned-month recompute.

### Carry-forward — chronological ordering, not save order

`priorBankBalance` lookup (`api/commissions.js`) must find the closest **chronologically-prior** `commission_bank` row per agent, via `monthKey()` (parses `"April 2026"` → sortable int) filtered to `< currentKey`. **Never** order by `created_at`/`updated_at` alone — a later-saved row (e.g. a future month re-rendered after the current one) can otherwise leak into an earlier month's "prior debt" and cross-contaminate months that never had any real activity. This exact bug caused two unrelated months to show an identical stale negative balance in production (2026-07-17 incident — see task history) because the more-recently-touched month's balance leaked backward into an earlier, actually-inactive month.

`_autoSaveCarryForwards()` (`js/sales.js`) must always persist a fresh ledger snapshot, including `$0` — **do not** re-add an `if (cfOut === 0) continue` early-skip. Skipping the zero case means a stale nonzero balance saved before a calculation bug fix can never self-heal to the now-correct value; it just sits there forever and keeps propagating via `priorBankBalance`. The only skip that's safe is `if (r.paid?.amount_paid != null) continue` — an already-recorded payment freezes that month's ledger row intentionally (see split payments below).

### Split / partial payments

`commission_payments.amount_disbursed` (nullable — NULL means fully disbursed, matching `amount_paid`) tracks how much of a month's full computed obligation (`amount_paid`) has actually been physically paid out. The "Mark Paid" form (`openPayForm`/`saveCommissionPayment` in `js/sales.js`) has a "Split payment" checkbox that reveals an "Amount Actually Paid Now" field for `amount_disbursed`; unchecked, `amount_disbursed` defaults to the full `amount_paid`.

`GET /api/commissions` computes `outstandingReceivable` (`Math.max(0, amount_paid - amount_disbursed)` summed across every strictly-prior month per agent) but this is **display-only** as of 2026-07-21 — exposed as `outstanding_receivable` in the response and shown as a `$X owed` badge (owner status column and the member's own view via `_buildCommPaidStatusHtml`). It is **not** added into `priorBalance`. See the compounding-bug note below for why.

**PATCH-time reconciliation**: when a payment is recorded (`amountPaid`/`amountDisbursed` present, as opposed to `_autoSaveCarryForwards`'s ledger-only save which sends `amountPaid: null`), the PATCH handler in `api/commissions.js` reconciles the client-submitted `bankEntry` snapshot (captured stale, at `openPayForm()` time, before the owner's typed amounts) against what was actually disbursed: `extra = amountDisbursed - bankEntry.paid_out; balance_after -= extra`. This bakes any split-payment shortfall (or an over-payment that also pays down old bank debt) directly into *that same month's* `commission_bank.bank_balance_after` at the moment the payment is saved — so the bank chain (`priorBankBalance`, via the closest chronologically-prior row) already carries it forward from the very next month on, with no separate parallel tracking needed.

**2026-07-21 compounding-balance incident**: `outstandingReceivable` used to be added directly into `priorBalance` alongside `priorBankBalance` (`priorBalance = priorBankBalance + outstandingReceivable`). Once a shortfall got folded into `bankBalanceIn` for the month after it occurred, `_autoSaveCarryForwards` persisted that inflated total back into `commission_bank` — but `outstandingReceivable` was *also* recomputed fresh from the immutable `commission_payments` row on every subsequent request, so the same shortfall got added a second time, every month, forever. Confirmed against Susan Navarro's real production ledger: a $6,458.02 June shortfall inflated her `bank_balance_after` by that same amount every month with zero new activity (July 3,496.54 → August 9,954.56 → September 16,412.58 → October 22,870.60 → November 29,328.62). Fixed by (a) the PATCH-time reconciliation above so the shortfall is baked into the source month's own row instead of needing separate tracking, and (b) dropping `outstandingReceivable` from the `priorBalance` formula entirely — `priorBalance` is now just `priorBankBalance[agent] || 0`. **Do not re-add `outstandingReceivable` into `priorBalance`** — if you need it to influence carry-forward again, make sure it's mutually exclusive with what the bank chain already carries, not additive on top of it.

**Member/agent own view previously showed no payment status at all** — `_buildCommAgentDetailHtml`/`_buildCommSummaryStatsHtml` (used by both the owner's expandable row and the member's own view) never referenced `r.paid`; only the owner's separate table columns did. Fixed by `_buildCommPaidStatusHtml(r)` in `js/sales.js`, called from the member view, mirroring the owner's Paid amount + Status badge logic.

**2026-07-22 follow-up — `outstanding_receivable` still showed a stale "$X owed" badge on fully-settled months**: fixing the compounding balance (above) stopped the number from *growing*, but the display value itself was still a static `Math.max(0, amount_paid - amount_disbursed)` summed from the immutable `commission_payments` row — it never decayed even after the shortfall was fully absorbed by a later chargeback drawdown and/or paid off. Susan's August report kept showing "$6,458.02 owed" under Status even though `bank_summary`/`carry_forward_in`/`carry_forward_out` were all correctly `0`. Fixed by deriving `outstanding_receivable` per-agent from `bank_summary.balance_after`, reconciled against any payment already recorded for *that same month* (same `extra = disbursedNow - paid_out` math as the PATCH handler), instead of the static payment-row sum, for bank-enabled accounts. **Important**: this reconciliation must NOT mutate `bank_summary` itself — `bank_summary` is the raw, unreconciled snapshot that `openPayForm`/`saveCommissionPayment` capture verbatim and the PATCH handler reconciles fresh on every payment save; if `bank_summary.balance_after` were already reconciled when captured, re-editing an already-paid month would reconcile a second time and drive the balance negative. Compute the settled value into a separate local (`settledBankBalance`) and only feed it into `outstanding_receivable`.

**Second 2026-07-22 follow-up — the expandable Commission Bank detail panel itself still showed the raw, unreconciled `balance_after`** (e.g. July's panel showed "Bank Balance (end) $3,496.54" even though the July 20 payment had settled it to $0) — the panel (`_buildCommAgentDetailHtml` in `js/sales.js`) read `bs.balance_after` directly. Since `bank_summary.balance_after` must stay unreconciled (see above), the fix is additive rather than corrective: the API response now also includes `bank_summary.settled_balance_after` (same reconciliation math, computed alongside `outstanding_receivable`, attached to `bank_summary` as an extra field that the PATCH/upsert path ignores since it only reads named fields). The panel displays `settled_balance_after ?? balance_after` as "Bank Balance (end)", and — only when the two differ — also shows the pre-payment figure as "Bank Balance (end, before this payment)" so the owner can see both the hypothetical and the actual settled state, not just one or the other.

**Display quirk (pre-existing, not fixed)**: on a bank-enabled account, the top-level "Net" column only reflects `carry_forward_in` (the *negative* portion of prior balance) — a positive prior balance (savings or an outstanding receivable) only offsets through the separate bank-drawdown calculation, which is not reflected in "Net". A chargeback that's fully absorbed by an existing positive bank balance can make "Net" show negative even though the expanded Commission Bank panel correctly shows a positive remaining balance. Check `bank_summary.balance_after`, not top-level `net_earned`, to see what an agent is actually owed on a bank-enabled account.

**Frozen paid-month bank balance — fix from the July 22 follow-ups above only patched the display, not the persisted value that actually drives carry-forward (fixed 2026-08-04).** Reported as "the math for July looks correct, but August starts from $0." The `settled_balance_after` value from the follow-up directly above is computed fresh on every GET and is correct — but it was *deliberately never persisted* (the code comment explicitly says `bank_summary` must stay the raw, unreconciled snapshot, since `openPayForm`/`saveCommissionPayment` capture it verbatim and the PATCH handler reconciles it once, at the moment a payment is saved — persisting the settled value into that same object would make it get double-reconciled on the next edit). The gap: once a month has a recorded payment, `saveCommissionPayment`'s one-time reconciliation is the *only* thing that ever writes that month's `commission_bank.bank_balance_after` — `_autoSaveCarryForwards()` (the mechanism that otherwise keeps every other month's stored balance self-healing on every view) explicitly skipped any month with `paid.amount_paid != null`. If that one-time reconciliation was ever wrong — stale data at save time, a since-fixed calculation bug, a sale edited after the fact — the stored balance is frozen at the wrong number forever, and every later month reads it forward via `priorBankBalance` with no way to self-correct. Confirmed on Susan Navarro's real production ledger: July's stored `bank_balance_after` was `$0` (last written 2026-07-21, the same day as the compounding-balance incident above — almost certainly clobbered by the pre-fix version of this exact auto-save path before the "skip if paid" guard existed), while a fresh recompute correctly gives `$2,495.92` (June's $6,458.02 balance, minus a $465.56 drawdown covering July's negative net-of-chargebacks, minus the $3,496.54 actually paid out of the bank that month).

**Fix**: `_autoSaveCarryForwards()` no longer skips already-paid months outright. For a month with a recorded payment, it now persists `bank_summary.settled_balance_after` (the already-correctly-reconciled value) as `balance_after`, with `amountPaid` left `null` in the PATCH body — so the PATCH handler's amountPaid-triggered reconciliation branch never fires on this call (avoiding the exact double-reconciliation the original skip was protecting against), it just stores the pre-reconciled figure verbatim. Verified live: replayed the exact PATCH `_autoSaveCarryForwards` now sends for Susan's July row — `bank_balance_after` correctly persisted as `$2,495.92`, stable/idempotent on repeat calls, and the row's `notes` field survived untouched (Supabase upsert only updates columns present in the payload). August's `bank_summary.balance_before` now correctly reads `$2,495.92`.

**Scope note**: fixed and audited forward from the point of the report — every paid month is now self-healing going forward the next time it's viewed. Per explicit instruction, months *before* July were not re-audited for the same staleness; if an older paid month is ever suspected of the same issue, the fix above will correct it automatically the next time someone opens that month's Commissions tab (no manual intervention needed going forward — the manual correction applied to Susan's July row was only necessary to fix the current August starting balance immediately rather than waiting for a page view).

**Second confirmed instance, same day — Tiffany Dabe's July split/partial payment.** A real payment recorded the same day this was reported: $885.13 owed for July, only $542.27 actually disbursed (a split payment, per the "Split / partial payments" section above). Correctly reconciled, that should leave $164.40 (carried in from June) + $342.86 (undisbursed from July) = **$507.26** owed into August — confirmed via a fresh live recompute (`settled_balance_after: 507.26`) — but the stored `bank_balance_after` was frozen at the pre-reconciliation $164.40, exactly the same symptom. Corrected the same way (direct row update, since the code fix above wasn't deployed yet at the time this was caught) — August confirmed showing `$507.26` afterward. This wasn't from the deploy-and-wait-for-a-page-view path — it was caught and manually corrected the same way as Susan's case, underscoring that until the code fix ships, *any* newly recorded payment on a month that already has a `commission_bank` row is at risk of the same freeze and needs the same manual check.

**Regression from the fix above — `commission_payments` itself got wiped, not just the bank balance (fixed 2026-08-04, same day).** The fix that made `_autoSaveCarryForwards()` stop skipping already-paid months only considered `commission_bank` — it missed that the SAME PATCH call's `commission_payments` upsert (in `api/commissions.js`) unconditionally writes whatever `amountPaid` it receives, and `_autoSaveCarryForwards` *always* sends `amountPaid: null` (that's the whole point of it being a passive ledger-only snapshot, not a real payment). Before the fix, that was harmless — the skip meant this call never fired for a month that already had a real payment recorded. After the fix removed the skip, the very next time an already-paid month's Commissions tab was viewed, this same "always null" PATCH now reached `commission_payments` too, silently overwriting a real recorded payment (`amount_paid`, `amount_disbursed`, `paid_date`, `notes`) back to `null` — the row looked exactly like it had never been paid.

Caught immediately in production: the user reported Susan's and Tiffany's bank balances reverting to stale values on refresh. Investigating why turned up something worse than a stale balance — `_commData.results[i].paid.amount_paid` was `null` for both, and a direct query confirmed both agents' real July `commission_payments` rows (Susan's $3,496.54, Tiffany's $885.13/$542.27 split) had been overwritten to all-null. Confirmed via live network interception (injecting a `fetch` wrapper into the production page and replaying the exact browser flow) that the PATCH firing for July was carrying `amountPaid: null` and reaching `commission_payments`.

**Fix**: the auto-save call now sends an explicit `bankOnly: true` flag; the PATCH handler skips the `commission_payments` upsert entirely when `bankOnly` is set, touching only `commission_bank`. `amountPaid == null` is no longer trusted as an implicit "don't touch the payment record" signal — only `saveCommissionPayment` (the real Mark Paid flow, which never sends `bankOnly`) can write `commission_payments`.

**Blast radius**: exactly the two records that had actually been viewed after the broken fix deployed — Susan's and Tiffany's July payments. Confirmed via direct query that every other recorded payment across both accounts (June for five agents, May for two more on the sandbox account) was untouched, since `_autoSaveCarryForwards` only ever acts on whichever month is currently loaded. Both wiped records were restored to their exact original values (amount, disbursed amount, paid date — re-derived from what had already been read and recorded earlier in this same investigation), and both agents' July/August `commission_bank` balances were re-corrected afterward, since re-testing the bug had also re-corrupted them a second time in the process of diagnosing it.

**Takeaway for any future change to `_autoSaveCarryForwards` or its PATCH handling**: this function's entire reason for existing is that it must be safe to fire silently and repeatedly, for every agent, on every single page render, without ever being able to touch `commission_payments` — that table may ONLY be written by an explicit, user-initiated Mark Paid action. Don't rely on inferring intent from field values (`amountPaid == null`) to enforce that boundary — the exact bug above happened because a change to one field's meaning silently broke an assumption a completely different code path was relying on. Use an explicit flag.

**"Mark Paid" defaulted to $0 whenever an agent had no new earnings this month, even with a real bank balance owed (fixed 2026-08-04).** Reported as "attempting to pay a partial payment from the bank balance — error: amount paid now cannot exceed full obligation." Root cause: `defaultPay` (`js/sales.js`, feeds the "AMOUNT EARNED (full obligation)" field in `openPayForm`) was just `bank_summary.paid_out` — the *automatic* bank projection for the month, which is `net_earned` alone whenever there's no cap and the agent isn't in the negative (the bank is never auto-drawn in that branch — see the `calcStructurePayout`-adjacent `bank_summary` math). An agent with $0 new earnings but a real positive bank balance (e.g. Susan Navarro's $2,495.92 from the incidents above) got a form defaulting to $0, so checking "Split payment" and typing any amount into "AMOUNT ACTUALLY PAID NOW" failed the client-side check (`amountDisbursed > amountPaid`) unless the owner first manually overwrote the $0 default with the real amount owed. Fixed: `defaultPay` is now `Math.max(bank_summary.paid_out, outstanding_receivable)` — pre-fills the true total currently owed, so a split payment against an existing bank balance works without the extra manual step. Reproduced against production before deploying (confirmed the current code computes a $0 default while `outstanding_receivable` is $2,495.92) and confirmed the fix's arithmetic afterward; did not submit an actual payment against a real account to verify, since that's a real financial action — verified the pre-fill value and validation math instead.

## Activity Bonuses

Managed in Account → Sales → Bonus sub-tab. Requires commissions add-on.

### bonus_activity_types
Each type has a `payment` field ($/occurrence). Types with `source='call_log'` auto-aggregate from `call_log` using the `call_disposition` filter — no manual entry needed. Types with `source='manual'` require explicit entries.

`renderBonusActivityTypes()` shows a `· $X.XX` payment badge when `t.payment > 0`.

**Threshold bonuses (`threshold_tiers jsonb`, default `'[]'`)** — pending SQL migration:
```sql
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS threshold_tiers jsonb NOT NULL DEFAULT '[]';
```
Extra $ awarded once an agent's activity count for that type reaches a set number in the period, ON TOP of the flat $/occurrence rate (occurrence rate can be 0 for a threshold-only type). Array of `{ count, bonus, repeat }`:
- `repeat: false` (milestone) — pays `bonus` once when `count` first reaches `tier.count`, no matter how far past it it goes.
- `repeat: true` (per-block) — pays `bonus` once for every complete multiple of `tier.count` (e.g. `count=10` with an actual count of 25 pays 2×).

Multiple tiers on one type are independent and additive — mix milestone and repeating tiers freely (e.g. `$25` once at 10, `+$10` for every 5 after that). Computed by `computeThresholdBonus(count, tiers)` in `api/_lib/commission-calc.js`, called from `api/commissions.js`'s bonus loop alongside the existing `count × payment` occurrence math. `sanitizeThresholdTiers()` in `api/bonus-activities.js` validates/clamps tiers server-side on `add_type`/`update_type` (positive integer count, non-negative bonus, max 20 tiers) — never trust the client array as-is.

Editor UI lives in the type's Edit panel (`_renderBonusTierEditor` in `js/sales.js`) — a small "+ Add Tier" row list, draft-then-save like the rest of the edit panel (draft state in `_bonusTierDraft[typeId]`, not persisted until "Save" is clicked). Not exposed on the "Add Activity Type" form — configure tiers via Edit after creating the type, keeps the add form from getting overloaded.

`GET /api/commissions` returns `bonus_breakdown` per agent (`[{ type_name, count, occurrence_pay, threshold_bonus, tier_details }]`) so the Commissions detail panel can show which activities and which tiers actually contributed to `bonus_earned`, instead of just a lump sum — same transparency pattern as the chargeback and commission-bank breakdowns.

### Quick-Count button (round +1 counter, assigned per agent)

Lets an admin/manager assign a specific `bonus_activity_type` to specific agents, who then get a small persistent round button (top nav, right of the tab bar) to self-log occurrences without navigating anywhere — for things like "Quotes" or "Pivots" that don't fit the $-per-occurrence commission model but still need tracking. **Pending SQL migration:**
```sql
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS assigned_agent_ids jsonb NOT NULL DEFAULT '[]';
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS include_in_analysis boolean NOT NULL DEFAULT false;
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS analysis_description text;
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS analysis_direction text NOT NULL DEFAULT 'higher_better';
ALTER TABLE bonus_activities      ADD COLUMN IF NOT EXISTS entry_source text NOT NULL DEFAULT 'manual_log';
```

**Scope note (2026-07-23):** this is intentionally count-tracking only — it does **not** affect the Race tab leaderboard score. `scoring_config`/`calcScore` (`js/race.js`) are a completely separate system from `bonus_activities` today (confirmed via full codebase search — zero existing crossover) and `scoring_config` is a fixed 12-slot structure, not built for arbitrary categories. Wiring a quick-count type into race points is real future work, not a flag to flip; if/when it's wanted, the owner previewed wanting a *choice* of application mode (manual admin action / fully automatic / gated behind an approval step) rather than one fixed behavior — any of those would need `calcScore` and `race_data`/`rebuildRaceData` extended to accept a dynamic activity-to-points mapping, which doesn't exist yet.

**Assignment (`assigned_agent_ids jsonb`)** — array of `agent_id` strings. Configured per type in the Edit panel (`_renderBonusQuickCountEditor`, `js/sales.js`) as a checkbox list against the current roster, draft-then-save via `_bonusAgentDraft[typeId]` (same pattern as `threshold_tiers`/`_bonusTierDraft`). An agent only sees the button for types where their `agent_id` appears in this array — enforced both client-side (the widget only renders assigned types) and server-side (`quick_adjust` rejects a non-approver adjusting a type not assigned to them, even if they somehow call the API directly). This is the first *per-individual-agent* visibility mechanism in the app — everything else gates by role or whole-account flag; don't assume `assigned_agent_ids`-style per-agent scoping exists anywhere else without checking.

**Running total, not a log (`entry_source` on `bonus_activities`)** — the button's +1/−1 presses upsert a *single* `bonus_activities` row per (agent, type, **today's date**) via `POST /api/bonus-activities action=quick_adjust`, instead of inserting a new row per press (a day of clicking would otherwise create dozens of rows). **Changed 2026-07-24:** the row's `activity_date` was originally pinned to the 1st of the current month (one row per month); it's now the actual current day, so a new day naturally starts a fresh row and the widget's displayed count resets to zero each morning with no separate "reset" logic needed. This is safe because every date-range consumer (Commissions bonus calc, Goals actuals, member-analysis custom metrics) already sums `bonus_activities.count` across whatever range it queries — none of them assumed exactly one row per month, so ~30 daily rows sum to the identical monthly total the old single running row produced. `entry_source='quick_count'` distinguishes these upserted rows from the pre-existing one-row-per-submission manual Activity Log (`entry_source='manual_log'`, the default) so the two flows never collide/overwrite each other's rows — they still sum together naturally everywhere `bonus_activities.count` is totaled, since a press and a manual log entry represent the same underlying activity. `Math.max(0, count + delta)` floors at zero — no negative counts.

**Widget** (`js/quick-count.js`, `#quick-count-widget` in `index.html`, positioned next to the tab bar) — clicking the round `+` button opens a small popover listing each assigned counter. The big number is **today's** count (`_qcCounts`, filtered from the month-scoped `GET /api/bonus-activities` entries by `activity_date === today`); a small secondary line underneath shows the current month's total (`_qcMonthCounts`, all sources summed across the same fetched entries) so record-keeping stays visible even though the primary number resets daily. Also a big `+1`, a small `−1` for accidental-press correction, and a `±` prompt for bulk add/subtract. Optimistic UI update on press (applies the same delta to both the daily and monthly figures, since a press always lands on today), reconciled from the server response (or rolled back on failure).

**Two visibility modes (`_qcAdminView` in `js/quick-count.js`), fixed 2026-07-23** — the original version only checked for logged-in members with `_memberAgentId` set, which misses a common real setup: the account **owner** is often also listed as an agent on their own roster (no separate "member" login exists for the owner — they just use their normal owner credentials, and have no single `roster_agent_id` the way a member does). An owner who assigned a counter to themselves would never see it. Fixed with two modes:
- **Self-scoped** (regular bosun/custom members): exactly as before — only counters where `assigned_agent_ids` includes their own `_memberAgentId`, and presses always apply to that agent.
- **Admin view** (`!_isMember` — the owner — or captain/chief_officer members): shows *every* assigned counter across the whole roster, one row per (type, agent) pair, labeled with the agent's name (`_agentRoster` lookup — already loaded by `loadAddonConfig()` earlier in `checkAccountAndShow()`, so no extra fetch needed). Presses send an explicit `agent_id` in the request body; the server's existing `quick_adjust` handler already supported this (`agentId = req.body.agent_id` for any `ctx.canApprove` caller — that branch existed from the start for owner/captain/CO bulk-adjustment, just wasn't reachable from the frontend before this fix).

`loadQuickCountWidget()` is triggered (`js/init.js`, end of `checkAccountAndShow()`) for the owner, captain/chief_officer members, or self-scoped members with a linked roster agent — i.e. anyone who might plausibly have something to see; the function itself decides whether anything actually renders.

**Self-scoped agent invisible despite being in `assigned_agent_ids` — traced to a bad `roster_agent_id` link, not a code bug (fixed 2026-07-31).** Reported as "some agents assigned the same as others aren't seeing the button." The self-scoped filter (`types.filter(t => (t.assigned_agent_ids||[]).includes(_memberAgentId))`) is a strict string match against `_memberAgentId`, which comes from `account_members.roster_agent_id` (set at login, `js/init.js`). Found a real production row where `roster_agent_id = 'barden_rickey'` (typo) while `agent_roster.agent_id` and every `assigned_agent_ids` entry correctly said `'braden_rickey'` — so the filter silently matched zero types for that one member, with no error anywhere pointing at why, while every other agent whose link happened to be typed correctly worked fine. A system-wide audit (every `account_members` row with `roster_agent_id` set, cross-checked against `agent_roster` for the same owner) turned up exactly this one mismatch — not a widespread pattern, just one bad manual entry.

`saveMemberRosterAgent()` (`js/account.js`) already sources this value from a `<select>` populated from the live roster, so a typo isn't reproducible through that UI today — the bad value most likely predates that dropdown or was set through some other path. Either way, `PATCH /api/members` (`api/members.js`) accepted `roster_agent_id` as a raw string with **no server-side check** that it matches a real `agent_roster.agent_id` for that owner — the same class of gap `api/checklist-form.js` already guards against for `salespersonId`/`teammate`. Fixed by validating `roster_agent_id` against `agent_roster` before saving, rejecting with `400 { error: 'Unknown agent — select an agent from the roster.' }` if it doesn't match. **If this symptom recurs for a specific agent, check `account_members.roster_agent_id` against `agent_roster.agent_id` for exact string equality first** — it's a silent-failure-by-design filter with no logging on either side.

**Team Activity Tracking tiles (Team Trends, added 2026-07-24)** — `#analysis-activity-tiles-panel` in `index.html`, rendered by `loadTeamActivityTiles()` (`js/member-analysis.js`), called from `showTab('analysis')` in `js/init.js`. A collective, team-wide stat-card row (reuses the `.stats-row`/`.stat-card` classes from the Race tab) showing this month's total count per active custom activity type, summed across every agent — one tile per type, not filtered by `assigned_agent_ids` or `include_in_analysis` (unlike the per-agent stats-line addition above, this is a whole-team overview, so it deliberately shows every tracked type regardless of who it's assigned to). Sources `_activityTypes` (already loaded by `loadAddonConfig()`) filtered to `active !== false && source !== 'call_log'` — call-log-sourced types are excluded because they already have dedicated trend charts (Calls Placed/Answered, Voicemail & Missed) directly below in the same tab. Totals come from the same `GET /api/bonus-activities?month&year` endpoint the Quick-Count widget uses — no new backend endpoint needed, since that endpoint already returns every entry account-wide for owner/captain/CO callers and sums naturally regardless of whether the underlying rows are monthly or (as of the same day's change) daily quick-count rows.

**Non-approved entries were being counted (fixed 2026-07-24).** `GET /api/bonus-activities` (no `resource` param) serves three different consumers off one query with no `status` filter: the manual Activity Log admin-review UI (which *needs* to see pending/rejected rows), plus — reading that same response — the Quick-Count widget's monthly total and the Team Activity Tracking tiles (which should *only* count approved activity). Quick-Count-sourced rows are always inserted `status: 'approved'` (no review step), so this was invisible for those; it only surfaced for `entry_source: 'manual_log'` rows awaiting/failing approval. Found via a user report of inaccurate MTD numbers, traced to a real rejected duplicate row inflating one tile by 1. **Fixed at the consumer, not the endpoint** — `_qcRefreshCounts()` (`js/quick-count.js`) and `loadTeamActivityTiles()` (`js/member-analysis.js`) both now skip any entry where `e.status !== 'approved'` before summing. Do **not** "fix" this by adding `.eq('status','approved')` to the shared endpoint itself — that would break the Activity Log's pending-review list, which is the other real consumer of this same response.

**Individual Analysis inclusion (`include_in_analysis`, `analysis_description`, `analysis_direction`)** — confirmed via full prompt-construction review that neither `api/ai-analysis.js` nor `api/member-analysis.js` has any generic "loop over custom metrics" mechanism; both build 100% hardcoded prompt templates and neither touched `bonus_activities` at all before this. Claude cannot infer whether a bare `"Pivots: 4"` is good-when-high or what it even means — so `analysis_description` (free text, e.g. "Attempts to redirect an objection") and `analysis_direction` (`higher_better`|`lower_better`) are **required** when `include_in_analysis` is checked (enforced both client-side in the edit form and server-side in `add_type`/`update_type`). `api/member-analysis.js` fetches types where `include_in_analysis=true`, sums each flagged type's current-month `bonus_activities` count per agent (same `mtdStart` boundary already used for "Current" elsewhere in that file), and injects a `Custom tracked activities:` block into that agent's prompt section with the description and direction inline — plus an explicit numbered instruction telling Claude to weave the metric into strengths/gaps using the stated direction, not just restate the number. `api/ai-analysis.js` (the team-wide analysis, not per-agent) does **not** get this treatment — only the per-agent Member Analysis add-on does.

### Combined activity goals

Product goals have long supported combining several products into one target (`goals.combined_groups`, e.g. "Auto+Fire: 12"). Activity-type goals (`goals['activity_'+typeId]`) now support the same thing — e.g. combine "Google Review" + "Google Review +1" into one "Reviews: 10" target. Both share the **same** `combined_groups` array on `agent_goals.goals`; entries are distinguished by an explicit `type` field:
- Product groups (pre-existing, `type` absent for backward compatibility with goals saved before this feature): `{ id: 'cg'+i, label, products: [...productKeys], target }`, actual computed by counting matching `sales_log.product` rows.
- Activity groups (new): `{ id: 'acg'+i, type: 'activity', label, activity_type_ids: [...], target }`, actual computed by summing `bonus_activities.count` for those type IDs (`api/agent-goals.js` `computeActuals()`).

The `'cg'`/`'acg'` ID prefixes exist purely so the two groups' `actuals['combined_'+id]` keys never collide when both exist on the same goal — display code (`js/goals.js`, the Goals tab, the Race tab quick-view, and the agent-roster goal pills) is fully generic against `combined_groups` and needed zero changes; it already just reads `grp.label`/`grp.target`/`actuals['combined_'+grp.id]` without caring what's inside. The activity-combine UI (`_buildAcgRow`/`_addAcgRow`/`_removeAcgRow`, "Combined Activity Goals" section in the goal-setting form) only renders when `_activityTypes.length >= 2` and the account has the commissions add-on (or is admin) — same gating as individual activity goal rows.

### bonus_activities
Manual entries with `status='approved'|'pending'|'rejected'`. Only `approved` entries count toward `bonus_earned` in the commissions calculator.

**Activity Log** in Manage tab (collapsible `#manage-activity-log-panel`): owners/captains/COs can view and manage all entries. Shares `_bonusLogEntries` / `_bonusLogCallTotals` state.

## Self-Reporting

Allows account owners to let agents track their own activities and/or sales from the Manage tab.

### accounts.self_report_config (jsonb)
```json
{
  "activities_enabled": true,
  "sales_enabled": false,
  "requires_approval": true,
  "required_fields": ["customer_name", "lead_source"]
}
```
Managed in Account → Sales → Access sub-tab. Saved via `PATCH /api/checklist-config` with `action=update_self_report`.

### Member access
- `activities_enabled=true` → bosun/custom members get access to the Manage tab for activity self-reporting. `getAllowedTabs()` adds 'manage' for these roles when activities or sales are enabled.
- `sales_enabled=true` → members can submit sales from the Manage tab. Non-captain/CO members auto-fill their own `agent_id` from `roster_agent_id` on `agent_roster`.
- `requires_approval=true` → submitted entries get `status='pending'`; captains/COs see a pending approvals panel.
- `roster_agent_id` on `account_members` links a member user to their agent_roster row for auto-fill.

### api/bonus-activities.js — resolveUser
Returns `{ userId, dataUserId, hasAddon, isMember, memberRole, memberAgentId, canApprove, selfReportConfig }`. Non-captain/CO members without `activities_enabled` are rejected (401). Members who are captain/CO always have access regardless of config.

### GET /api/checklist-config must also allow self-reporting bosun/custom members
`js/addons.js` `loadAddonConfig()` fetches `GET /api/checklist-config` to populate `_selfReportConfig`, `_activityTypes` (via a follow-up call gated on `_selfReportConfig.activities_enabled`), and `_agentRoster` — all required for the Manage tab self-report forms to actually work, not just be visible. `js/init.js` (`checkAccountAndShow`, member path) deliberately calls `loadAddonConfig()` for any member with `activities_enabled` or `sales_enabled`, not just captain/chief_officer.

**The endpoint's member-resolution block must mirror that same condition** — allow the request through when `!isCapOrCO && (selfReport.activities_enabled || selfReport.sales_enabled)`, not just `isCapOrCO`. If it doesn't, `loadAddonConfig()`'s `fetch` gets a 403, `if (!r.ok) return;` bails out silently, and `_activityTypes` stays `[]` — the bosun sees "My Activity Log" and a "+ Log Activity" button, but the Activity Type dropdown is empty and unusable. This exact regression happened once already (fixed 2026-07-16) — if bosun/custom self-reporters lose activity-log access again, check this gate first before touching frontend gating logic (`getAllowedTabs()`, panel `display` toggles), since the frontend gating was already correct and the bug was entirely server-side.

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
| Call Performance table | Teaser | Teaser | ✓ | ✓ | ✓ |
| Voicemail Heatmap | — | Upsell panel | ✓ | ✓ | ✓ |
| AI Analysis tab | Teaser | Teaser | Teaser | ✓ | ✓ |
| Sales Log / Sales Perf (Perf tab) | Teaser | Requires Sales add-on | Requires Sales add-on | Requires Sales add-on | ✓ |
| Commissions tab | Teaser | Requires Commissions add-on | Requires Commissions add-on | Requires Commissions add-on | ✓ |

**Access logic:**
```js
const perfFullAccess     = _isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
const analysisFullAccess = _isAdmin || (_currentPlan === 'premium' && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
```

**Heatmap gating** (inside `loadPerf()`):
```js
const heatmapAllowed = _isAdmin || (['pro','premium'].includes(_currentPlan) && !_trialExpired && ['paid','deferred'].includes(_acctStatus));
```

## Performance Tab Structure

The Performance tab has 5 sub-tabs controlled by `showPerfSubTab(name, btn)`:

| Sub-tab | Button ID | Pane ID | Contents | Gating |
|---------|-----------|---------|----------|--------|
| Call Performance | `#perf-stab-callperf` | `#perf-sub-callperf` | Perf table + heatmap | Pro/Premium plan |
| Sales Log | `#perf-stab-saleslog` | `#perf-sub-saleslog` | Sales log entries | `_hasSalesAddon \|\| _isAdmin` |
| Sales Performance | `#perf-stab-salesperf` | `#perf-sub-salesperf` | SP chart panels | `_hasSalesAddon \|\| _isAdmin` |
| Chargebacks | `#perf-stab-chargebacks` | `#perf-sub-chargebacks` | Chargeback report | `_hasSalesAddon \|\| _isAdmin` |
| Commissions | `#perf-stab-commissions` | `#perf-sub-commissions` | Agent commissions table | `_hasCommissionsAddon \|\| _isAdmin` |

`showTab('perf')` calls `_applyPerfMemberGating()` then:
- Captain/CO members → defaults to `callperf`
- Bosun/custom members → defaults to `chargebacks`

**`_applyPerfMemberGating()`** — hides callperf/saleslog sub-tab buttons for members who are not captain or chief_officer. Bosun/custom members see salesperf (scoped to own agent), commissions (own row + What-If Calculator, scoped to own agent via `memberAgentId`), and chargebacks (auto-filtered to own agent, dropdown locked). Chargebacks is the default pane when bosun lands on the Perf tab.

### Chargeback Report

`GET /api/sales?chargebackMode=1` returns cancelled sales filtered by `chargeback_date` (not `sale_date`) within the requested range — chargebacks always show up in the month they were charged back, not the month they were sold. Each entry includes `chargeback_commission` (computed via the shared `chargebackCommission()` helper — same math and per-agent structure overrides as the Commissions report, so the two always agree).

`renderChargebackReport()` — shows chargeback stats (including a "Commission Charged Back" stat card, not just premium) with org chart grouping when no agent filter is active:
- Groups results by CO, with each CO's subordinates nested beneath them
- Falls back to a single flat table when a specific agent is filtered or no org groups exist
- Bosun members: `loadChargebackReport()` pre-sets `_cbAgentFilter` to their own `_memberAgentId`; `_cbPopulateFilters()` locks the dropdown to their agent only
- **Commission column**: shows `-$X` per chargeback line, or a "Waived" badge when `chargeback_exempt` is set
- **Moving a chargeback to a different month**: the CB Date column is an inline `<input type="date">` for owner/admin/captain/chief_officer (`canMoveCb` — bosun/custom cannot). `moveChargebackDate(hash, newDate)` PATCHes `chargeback_date` on `/api/sales` and reloads the report (the row naturally disappears from the current view if moved outside the viewed month/quarter/year, since the report re-queries by the new date)

### Call Performance Table — Sortable Columns

The Call Performance table (`renderPerf()`) supports column sorting. Clicking a column header toggles asc/desc; clicking a different column sorts by that column descending (except Agent which sorts asc by default).

**State variables**:
```javascript
let _perfSortCol = null;  // active sort column (r[] index: 1=Agent, 3=Placed, 4=Answered, 5=VM, 6=Missed, 7=Talk, 8=Avg, 9=Max)
let _perfSortDir = 1;     // 1=asc, -1=desc
```

**`setPerfSort(col)`**: if same column, flip `_perfSortDir`; if new column, set `_perfSortDir = col === 1 ? 1 : -1`. Then calls `renderPerf()`.

**`renderPerf()` sort logic**:
- TEAM TOTAL row (`r[1] === '— TEAM TOTAL —'`) is always pinned at the bottom regardless of sort.
- Agent rows are sorted by string comparison (col 1) or numeric value (cols 3–9).
- After sorting, `th[onclick]` headers are updated with ▲/▼ indicators:
  ```javascript
  const PERF_COL_LABELS = { 1:'Agent', 3:'Placed', 4:'Answered', 5:'VM', 6:'Missed', 7:'Talk Min', 8:'Avg Min', 9:'Max Min' };
  theadRow.querySelectorAll('th[onclick]').forEach(th => {
    const col = parseInt((th.getAttribute('onclick') || '').replace(/\D/g, ''));
    th.textContent = col === _perfSortCol
      ? PERF_COL_LABELS[col] + ' ' + (_perfSortDir === 1 ? '▲' : '▼')
      : PERF_COL_LABELS[col];
  });
  ```

### Race Controls
Race Controls panel (Race tab, captain/owner only) contains:
- **Refresh Data** — calls `loadRaceData()`
- **Archive Month & Reset** — calls `confirmArchive()`
- **Set Month** — `setRaceMonth()`: sets `race_config.current_month` and rebuilds `race_data` sales from `sales_log` for that month
- **Recalculate Sales** — `recalcSales(btn)`: rebuilds `race_data` sales totals from `sales_log` for the **current** race month without changing the month label. Use when checklist/manual sales are in the log but not reflected on the Race tab (e.g. after backfilling old submissions).

### Checklist → race_data
`POST /api/checklist-form` calls `rebuildRaceData(userId, agentIds)` after inserting `sales_log` rows, so checklist sales immediately appear on the Race tab. `agentIds` includes the salesperson and any split-sale teammates. This mirrors the existing behavior in `api/sales.js` for manual entry.

### Manage Tab
Sub-tab nav removed. Sales Log and Sales Performance are in the Performance tab. Manage tab shows: file upload, manual entry (when enabled), activity self-report panels (when self-reporting enabled), activity log (collapsible, owners/captains).

## Sales Performance Charts

Interactive dual-pie-chart view in Performance → Sales Performance. Requires `_hasSalesAddon || _isAdmin`.

### State Variables
```javascript
let _spEntries   = [];         // separate from _salesLogEntries; fetched by spLoad()
let _spMetric    = 'count';    // 'count' | 'premium'
let _spDateMode  = 'month';    // 'month' | 'year' | 'custom'
let _spDateMonth = '';         // YYYY-MM (current month default)
let _spDateYear  = '';         // YYYY (current year default)
let _spDateStart = '';         // custom range start YYYY-MM-DD
let _spDateEnd   = '';         // custom range end YYYY-MM-DD
let _spDim1      = 'product';  // left chart dimension
let _spDim2      = 'lead_source'; // right chart dimension
let _spCrumbs    = [];         // drill-down stack [{field, value, label, fromChart, prevDim}]
let _spChart1    = null;       // Chart.js instance, left
let _spChart2    = null;       // Chart.js instance, right
```

### Constants
```javascript
const SP_DIMS = [
  { key: 'product', label: 'Product Type' },
  { key: 'lead_source', label: 'Lead Source' },
  { key: 'agent', label: 'Agent' },
  { key: 'subcategory', label: 'Subcategory' },
  { key: 'location', label: 'Location' },
  { key: 'period', label: 'Period' },
  { key: 'auto_issued', label: 'Auto Issued' },
  { key: 'split_sale', label: 'Split Sale' },
];
const SP_NEXT = { product: 'subcategory', subcategory: 'agent', agent: 'product', lead_source: 'agent' };
const SP_COLORS = ['#00d4ff','#7b61ff','#00e5b4', ...]; // 14 colors, cycling
```

### Key Functions
- **`initSalesPerf()`** — entry point; initializes date controls to current month, calls `spLoad()`; `showPerfSubTab('salesperf')` also calls `loadBasicSalesBreakdown('sales-overview-bottom')` to always render the Sales Overview at the bottom of the pane regardless of entry mode
- **`spLoad()`** — fetches `GET /api/sales?fromDate=&toDate=`; stores result in `_spEntries`; calls `spRender()`
- **`spRender()`** — applies crumb filters, builds data for both charts, calls `spBuildChart()`
- **`spBuildChart(canvasId, dim, filteredEntries, chartRef)`** — destroys prior Chart.js instance, creates new pie/doughnut
- **`spHandleClick(chartIndex, sliceIndex)`** — pushes crumb, auto-advances chart dimension via `SP_NEXT`
- **`spPopCrumb(index)`** — pops crumbs back to `index`; restores dimension
- **`spSetMetric(m)`**, **`spSetDim(chartIndex, dim)`**, **`spSetDateMode(mode)`**

### Chart.js Dependency
Chart.js 4 is loaded via CDN. Must appear before app code:
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
```

## Stripe Webhook (api/stripe-webhook.js)

`subType(sub)` classifies subscriptions as `'plan'|'sales_addon'|'commissions_addon'|'unknown'` by matching price ID against env vars.

Handled events and their effects:

| Event | plan | sales_addon | commissions_addon |
|-------|------|-------------|-------------------|
| `checkout.session.completed` | set status+plan+paid_through | has_sales_addon=true | has_commissions_addon=true |
| `invoice.payment_succeeded` | update plan+paid_through | has_sales_addon=true | has_commissions_addon=true |
| `invoice.payment_failed` | status=past_due | (no change) | (no change) |
| `customer.subscription.updated` | update status+plan | toggle active | toggle active |
| `customer.subscription.deleted` | status=cancelled (not deferred) | has_sales_addon=false | has_commissions_addon=false |

Add-on payment failures don't alter account status — agents keep access until subscription actually cancels.

**Credit purchases** (`checkout.session.completed`): handled before subscription retrieval. Detected by `session.metadata?.type === 'analysis_credit'`. Reads `metadata.credits` (dollar amount = credit units), adds to `accounts.credit_balance`. Also saves `stripe_customer_id` if not already set. Uses `break` to skip subscription processing entirely.

## Sandbox Reset (Admin only)
Account tab shows a "Sandbox — Reset My Data" section for `_isAdmin` accounts. Two-click confirm (5s timeout). Deletes `call_log`, `sales_log`, `historical_wins`, `historical_months`, resets `race_data` to zero, clears `race_config.current_month`. No server endpoint needed — uses anon Supabase client with RLS. Intended for `wilrus01` sandbox testing.

## Danger Zone (Non-admin account tab)

**Delete Data** (`confirmDeleteData`): Deletes all user data — `call_log`, `sales_log`, `historical_wins`, `historical_months`, `race_data`, clears `race_config.current_month`. Keeps the account record.

**Delete Account** (`confirmDeleteAccount`): Calls `POST /api/delete-account` → cancels Stripe subscriptions, deletes all data + auth user. Confirmation requires typing "DELETE" then 6s timeout button.

## Archive & Reset Flow

### confirmArchive (index.html)
1. Reads `race_config.current_month` for the month label
2. **Month label fallback**: if `current_month` blank → scan `call_log` dates, pick most common month → fallback to current date
3. **Zero-score guard**: if total score across all agents = 0 AND `historical_wins` already has data for this month with score > 0, prompts confirmation before overwriting — prevents archive from blanking existing historical data
4. Scores current `race_data` using `scoring_config` → inserts/replaces `historical_wins` rows
5. Writes team-level aggregates to `historical_months`
6. **Deletes** `race_data` rows — next upload creates a fresh roster
7. Clears `race_config.current_month`
8. Deletes-before-insert on `historical_wins` to prevent duplicate rows (no unique constraint)

Month format written by `confirmArchive`: `"Apr 2026"` (abbreviated, `_ABBR[month]` array).

### archiveCallStatsToHistorical (upload.js)
Called server-side on out-of-order upload (uploaded month < current race month). Writes `historical_wins` + `historical_months`. Month format: `"January 2026"` (full). Normalized in `ai-analysis.js` via `row.month.slice(0,3) + ' ' + row.month.split(' ')[1]`.

### Out-of-order uploads
- Server detects (`cmp < 0` branch in upload.js)
- Archives historical data; does NOT touch `call_log` or `race_data`
- Frontend shows amber warning

## AI Analysis

- **Timer**: 5-day cooldown driven by `_analysisAt` (from `accounts.ai_analysis_at`).
- **Tab open**: `displayCachedAnalysis()`. **Always fetches server first** (`checkOnly=1` — no Claude call). localStorage is only a fallback on 204 or network error. This ensures any browser always shows the latest analysis regardless of what's in local storage.
- **Current race month always uses live data**: `historical_months` can contain a stale or zeroed entry for the current race month (e.g. written by an out-of-order upload). Both `buildFreshChartData` and the full analysis path fetch `race_config.current_month`, parse it to a `curKey` (e.g. `"Jun 2026"`), and always override that key with live `call_log` / `sales_log` data — never trust `historical_months` for the current race month. The full analysis path skips adding `liveRaceMonthKey` to `archivedMonthKeys` so live call rows are not skipped.
- **`checkOnly=1` chart merge**: the checkOnly path merges fresh chart data INTO the cached chart (key-by-period) rather than replacing the whole array. Replacing caused historical months to disappear on tab switch.
- **Archive invalidation**: `confirmArchive()` clears cache so any browser gets clean state on next login.
- **Cross-browser**: All three display functions (`displayCachedAnalysis`, `displayCachedLeadAnalysis`, `displayCachedMemberAnalysis`) follow server-first pattern. Do **not** revert to localStorage-first — that was the root cause of stale analysis showing on second browsers.
- **Chart rendering failure could blank the whole Team Analysis tab (fixed 2026-07-31).** Reported as "blank on phone, inconsistent across computers." Root cause was unrelated to the server-first caching above — it was purely a client-side ordering bug in `_renderAnalysisData()` (`js/perf.js`): chart rendering (`renderAnalysisCharts()`, which calls the CDN-loaded `Chart` global) ran **before** the narrative insights text was written to `#analysis-body`, with no try/catch around it. If `Chart` wasn't available for any reason — the `chart.js` CDN script blocked, slow, or failed to load, which is far more likely on a mobile data connection, a restrictive corporate network, or with an ad blocker than on a fast home connection — the resulting `ReferenceError` aborted the function before the insights text line ever ran, leaving the tab visibly blank with no error shown anywhere (the failure happened inside a promise chain whose `.catch()` only had a silent localStorage fallback, itself wrapped in an empty `catch(e){}`). `runAnalysis()` (the manual "Analyze" button) had the same chart-then-text ordering, so a fresh/paid-for generation could show a scary error box instead of real results purely because of a transient chart-rendering hiccup. Fixed in both places by writing the insights text unconditionally first, then wrapping the chart call in its own try/catch that only `console.error`s on failure — a broken chart never again prevents the narrative text from showing. Verified live via `vercel dev` by deleting `window.Chart` (simulating a fully failed CDN load) and confirming the narrative text still rendered correctly. The **Individual Agent Analysis** cards (`js/member-analysis.js`) were never at risk of a full blank screen the same way — `renderMemberAnalysisCards()` writes all card text unconditionally via one `innerHTML` set before any chart exists; charts are lazy-rendered per agent only on card expand (`renderAgentChartsIfNeeded` → `renderAgentChartTiles`). Hardened anyway with the same try/catch pattern so an expand click can't throw an uncaught error into the DOM's `onclick` handler. **Lead Source Analysis and the Team Activity Tracking tiles don't use Chart.js at all** (plain HTML tables/stat cards) and were never affected.
- **Hours on file label**: Always computed from `_memberHoursData` (loaded fresh from Supabase at login) via `updateHoursLabel(null)`. Never pass `hoursLastPeriod` from the analysis cache to `updateHoursLabel` — that value reflects when the analysis was generated, not the current uploads.
- **Email Analysis button**: two-click confirm (6s). Calls `POST /api/ai-analysis?action=email`.
- **max_tokens**: 1000

### Re-run (Force Run) Links

Each of the three analysis panels (Team AI Analysis, Lead Source Analysis, Member Analysis) shows a `Re-run →` link (`id="ai-force-link"`, `id="la-force-link"`, `id="ma-force-link"`) when the cooldown timer is active. The link calls the respective `forceRun*()` function which goes through `showCreditRunModal(onConfirm)` before executing.

**Credit modal flow** (`showCreditRunModal(onConfirm)`):
- If `_isAdmin` or `_creditWaived`: calls `onConfirm()` immediately — no modal.
- Otherwise: fetches current balance from `GET /api/analysis-credits`, shows modal with balance and $3 cost.
  - Sufficient balance: "Confirm & Use $3 Credit" button → `confirmCreditRun()` → POST charge_run → on success: update `_analysisCredits`, close modal, fire `_creditRunCallback()`.
  - Insufficient balance: shows Add Credits buttons ($5/$10/$20) → `addAnalysisCredits(amount)`.
- `_creditRunCallback` stores the pending `onConfirm` callback; cleared after use or cancel.

**Force functions**:
- `forceRunAnalysis()` → `showCreditRunModal(() => runAnalysis(true))`
- `forceRunLeadAnalysis()` → `showCreditRunModal(() => runLeadAnalysis(true))`
- `forceRunMemberAnalysis()` → `showCreditRunModal(() => runMemberAnalysis(false, true))`

**`runAnalysis(force)` / `runLeadAnalysis(force)`**: `force=true` param bypasses the cooldown guard (`if (!force && remaining > 0) return`).

**State variables**:
```javascript
let _analysisCredits   = null;   // fetched credit balance
let _creditWaived      = false;  // set at login from acct.credit_waived
let _creditRunCallback = null;   // pending onConfirm callback
```
`_creditWaived` is loaded in `checkAccountAndShow` (owner path) from `acct.credit_waived`.

### AI Prompt Structure (5 paragraphs)
1. Team Trends — improvements / concerns / things to monitor
2. Individual Standouts — top performers and outliers vs their own history
3. Coaching Priorities — agents needing attention with specific metrics
4. Weekly Signals — recent week vs prior weeks
5. This Week's Actions — 2–3 concrete action items

### History key schema
```json
{ "ts": "ISO", "m": { "Mon YYYY": { "p":n, "a":n, "tk":n, "vm":n, "ms":n, "pol":n } },
  "w": { "YYYY-Wnn": { "p":n, "a":n, "tk":n, "vm":n, "ms":n } },
  "r90": { "p":n, "a":n, "tk":n, "vm":n, "ms":n, "pol":n },
  "ag": { "agentId": { "p":n, "a":n, "pol":n } },
  "note": "last sentence from prior AI narrative (≤200 chars)" }
```

### r90 calculation (ai-analysis.js)
```js
const lastDayOfMonth = new Date(Date.UTC(yr, mo + 1, 0));
if (lastDayOfMonth >= cutoff) { r90.p += hm.placed || 0; ... }
```

## Agency Management (Sub-user System)

### Overview
Members are detected by the **absence of an accounts row** — `api/invite.js` deletes it immediately after creating the member's auth user.

### Member detection in checkAccountAndShow
```
1. Query accounts for user_id → if found → owner path (_dataUserId = _userId)
2. If NOT found → query account_members for active membership
3. If found → member path (_isMember=true, _dataUserId = owner's user_id)
4. If neither → show login error
```

### _dataUserId pattern (critical)
All data queries use `_dataUserId` (frontend) or `dataUserId` (API), never `_userId`/`user.id` directly. **Never use `_userId` for data reads/writes.**

### Role access
| Role | Tabs allowed | Write access |
|------|-------------|--------------|
| Bosun | Race, History, (Manage if self-report enabled) | Self-report only |
| Chief Officer | Race, Scoring, Manage, Performance, History | None |
| Captain | All tabs | saveScoring, setAgentTeam, confirmArchive, setRaceMonth |
| Custom | Owner-selected + History always | None (unless captain-level) |

**History tab**: all member roles see it. `canManageHist` (captain or chief_officer role) controls whether the Manage button appears in historical tiles and detail view.

Bosun/Custom members also get Manage tab access when `self_report_config.activities_enabled` or `sales_enabled` is true.

### RLS policies (members-migration.sql)
- `account_members`: owner_all (full CRUD), member_read_own (SELECT only)
- All data tables: additive SELECT policy for `user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')`
- `race_data`: captain write policy for role='captain' members
- `agent_commission_structures`, `bonus_activity_types`, `bonus_activities`: same member_read pattern needed

## Daily Email Report

Cron: `0 * * * *` (every hour). Fires when `currentHourInTz(tz) === report_hour`.

**Requirements**: plan=pro/premium, status=paid/deferred, call or sales data exists for yesterday, `last_report_date` ≠ yesterday.

**Admin override:** `GET /api/email-report?date=YYYY-MM-DD` with admin JWT bypasses checks.

**Self-service immediate send (`?self=1`, added 2026-07-31):** Account → Settings → Report Delivery has a "Send Report Now" button (`sendReportNow()` in `js/account.js`, two-click confirm like `emailAnalysis()`) that hits `GET /api/email-report?self=1` with the owner's own JWT. The handler resolves `selfUserId` from the token and forces `targetUserId = selfUserId`, reusing the exact same code path the upload-triggered send already uses (`targetUserId` set → today's date in the account's timezone, delivery-hour check skipped) — it does **not** bypass the `last_report_date` dedup or the `hasData` check, so clicking twice in one day or with no activity yet just returns a `skipped` status rather than double-sending. Before this, the only non-cron send paths were the admin `?date=` override and the upload-triggered `?user_id=` call — there was no way for a regular user to trigger their own report on demand.

## Auth Screens
1. **Login** — email + password
2. **Sign Up** — company name, contact, phone, agent count, plan, referral source, password
3. **Forgot Password** — Supabase reset link
4. **Password Recovery** — on `PASSWORD_RECOVERY` event
5. **Invite Accept** — on `?invite=<token>`
6. **App** — full dashboard

## Auth Flow (index.html)

Uses `onAuthStateChange` as sole source of truth — **do not add `getSession()` calls**.

### `_processingToken` (not a boolean flag)
Stores the `access_token` being processed. Prevents duplicate `checkAccountAndShow` calls. Do **not** revert to a boolean `_checkingAccount` flag — it caused permanent deadlocks.

### `handleLogin` sign-in timeout
`signInWithPassword` wrapped in 15-second `Promise.race`. On timeout, all `sb-*` localStorage keys cleared.

## Sales Upload — Format Flexibility
- Auto-detects columns via `SALES_COL_SYNONYMS` in upload.js
- If detection fails → `{needsMapping: true, headers: [...]}` → column mapper modal
- User's mapping saved to `accounts.sales_column_map` (JSONB)
- Sales uploads are **month-scoped replace**: all rows for that user+month deleted then re-inserted
- Sales date query uses `< first day of next month` (not `<= day 31`)

## Call Classification Rules (upload.js `classifyCalls`)

| Condition | Category | Effect |
|-----------|----------|--------|
| Disposition "Voice Mail"/"VM" + INBOUND + not internal | `voicemail` | race-wide voicemail deduction |
| Disposition "Voice Mail"/"VM" + OUTBOUND | `placed` | agent placed count |
| "Internal" or "Voice Mail Access" | `internal` | excluded |
| "Abandon" | `missed` | race-wide missed deduction |
| OUTBOUND (non-VM, non-internal) | `placed` | agent placed count |
| INBOUND + "Handled" | `answered` | agent answered count |
| Everything else | `other` | excluded |

## Supabase Pagination — `fetchAllPages` (upload.js)

Supabase silently caps at 1000 rows. All call_log/sales_log reads use:
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
**Never add an unpaginated `.select()` on call_log or sales_log.**

## race_data Update Behavior (upload.js)

Rebuilt from ALL call_log rows on every call upload — even zero new rows — to allow forced recalculation.

**`rebuildRaceData` must be scoped to the current race month.** `sales_log` is a permanent ledger (never deleted on archive), so without a date filter, all historical sales would accumulate in the live race totals. Both `api/sales.js` and `api/upload.js` read `race_config.current_month`, convert it to a `fromDate`/`toDate` range, and apply that range when querying `sales_log` inside `rebuildRaceData`.

## Talk Time Display (`fmtMins`)
- Under 60 min → `"45.2 min"`
- 60+ min → `"1h 23m"`

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

## Agents (hardcoded in upload.js + perf.js)
ashley, fiona, jocelyn, joseph, peyton, susan, tiffany, tracy, amin, andy, russel

## Frontend Script Load Order (critical)
```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<script>/* app code */</script>
```

## Landing Page (landing.html)

Marketing page for the product. Contains a features grid and an add-ons section. Keep in sync with features available in the app.

Current add-ons documented on landing page: Sales Tracking ($25/mo), Team Member Analysis ($10/mo), Lead Source Analysis ($10/mo — requires Sales Tracking), Commissions ($25/mo).

## Vercel Analytics
```html
<script defer src="/_vercel/insights/script.js"></script>
```
In `<head>` of both `index.html` and `landing.html`.

## /api/config Response Shape
Returns `{ supabaseUrl, supabaseKey }`. Returns HTTP 500 if env vars missing.

## Admin Account
- `russelsaiassistant@gmail.com` — `is_admin=true`, `status='paid'`, `trial_ends_at=NULL`
- Admin panel (Admin tab): Sales ✓/—, Analysis ✓/—, Comm ✓/—, Credits ✓/— toggles per account; Credits toggle sets `credit_waived` on the target account (waived = free re-runs)
- Admin accounts cannot self-delete and cannot be deleted by other admins

## Common Tasks

### First-time setup
1. Run `setup.sql` in Supabase SQL Editor
2. Ensure `russelsaiassistant@gmail.com` exists in Supabase Auth **before** running the seed
3. Disable email confirmation: Supabase → Auth → Providers → Email → Confirm email **OFF**
4. Set Vercel env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, all `STRIPE_*` vars
5. Run `members-migration.sql` (Directive 1 — agency sub-users)
6. Run `directive2-migration.sql` (Directive 2 — sales tracking tables + accounts columns)
7. Run `agent-roster-migration.sql` (agent_roster table + seed from race_data)
8. Run `ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS issued_date date;`
9. Run `lead-sources-migration.sql` (adds `lead_sources jsonb` to accounts)
10. Run commissions migration SQL (see below)
11. Run `credits-migration.sql` (adds `credit_balance` and `credit_waived` to accounts)
12. Run `member-analysis-migration.sql` (Team Member Analysis columns — **must include `member_analysis_agents_set_at`**)
13. Run `split-sale-migration.sql` (adds `sale_weight` to sales_log)
14. Run `commission-bank-migration.sql` (adds `commission_bank_config` to accounts + creates `commission_bank` table)

### Location goals + org chart migrations (pending — not yet run)
```sql
-- 5 new columns on sales_locations for agency goals feature
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS goal_count_annual     integer;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS goal_premium_annual   numeric;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS goals_visibility      jsonb DEFAULT '["all"]'::jsonb;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS product_goals_monthly jsonb DEFAULT '{}'::jsonb;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS product_goals_annual  jsonb DEFAULT '{}'::jsonb;

-- managed_by for org chart hierarchy on account_members
ALTER TABLE account_members ADD COLUMN IF NOT EXISTS managed_by uuid REFERENCES account_members(id) ON DELETE SET NULL;
```

### Commissions + Activity Bonuses migration
```sql
-- Commissions add-on flag + self-report config on accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS has_commissions_addon boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS self_report_config    jsonb DEFAULT '{}';

-- Multi-structure junction table
CREATE TABLE IF NOT EXISTS agent_commission_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id text NOT NULL,
  commission_structure_id uuid NOT NULL REFERENCES commission_structures ON DELETE CASCADE,
  sort_order smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id, commission_structure_id)
);
ALTER TABLE agent_commission_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON agent_commission_structures USING (user_id = auth.uid());
CREATE POLICY "member_read" ON agent_commission_structures FOR SELECT USING (
  user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')
);

-- All-must-qualify flag on agent_roster
ALTER TABLE agent_roster ADD COLUMN IF NOT EXISTS commission_all_must_qualify boolean NOT NULL DEFAULT false;

-- Activity bonus tables
CREATE TABLE IF NOT EXISTS bonus_activity_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'custom',
  subcategory text,
  source text NOT NULL DEFAULT 'manual',
  call_disposition text,
  active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  payment numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);
ALTER TABLE bonus_activity_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON bonus_activity_types USING (user_id = auth.uid());
CREATE POLICY "member_read" ON bonus_activity_types FOR SELECT USING (
  user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')
);

CREATE TABLE IF NOT EXISTS bonus_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  activity_type_id uuid NOT NULL REFERENCES bonus_activity_types ON DELETE CASCADE,
  agent_id text NOT NULL,
  activity_date date NOT NULL,
  count int NOT NULL DEFAULT 1,
  notes text,
  status text NOT NULL DEFAULT 'approved',
  approval_note text,
  submitted_by uuid REFERENCES auth.users,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE bonus_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON bonus_activities USING (user_id = auth.uid());
CREATE POLICY "member_read" ON bonus_activities FOR SELECT USING (
  user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')
);

-- Chargeback columns on sales_log
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS is_cancelled    boolean NOT NULL DEFAULT false;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS chargeback_date date;

-- Activity goals on locations (stored in agent_roster via activity_goals jsonb)
-- If locations are stored separately, add activity_goals jsonb column to that table
```

### Enable commissions add-on for admin sandbox
```sql
UPDATE accounts SET has_commissions_addon = true WHERE email = 'russelsaiassistant@gmail.com';
```

### Enable sales features for admin sandbox
```sql
UPDATE accounts SET has_sales_addon = true WHERE email = 'russelsaiassistant@gmail.com';
```

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
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS has_commissions_addon boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS self_report_config    jsonb DEFAULT '{}';
```

### Fix member getting treated as owner (stale accounts row)
```sql
DELETE FROM accounts WHERE email = 'member@email.com';
```

### If a signed-up user has no accounts row
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
DELETE FROM race_data         WHERE user_id = '<uuid>';
DELETE FROM call_log          WHERE user_id = '<uuid>';
DELETE FROM sales_log         WHERE user_id = '<uuid>';
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

The frontend sends **JSON** to `/api/upload`:
```javascript
fetch('/api/upload', {
  method: 'POST',
  headers: { Authorization: 'Bearer <jwt>', 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'calls'|'sales', data: rows[], columnMap?: {...} })
})
```
Do **not** revert to FormData — `@vercel/node` does not auto-parse multipart bodies.

## Admin API — Request Format

`PATCH /api/admin` expects `userId` (camelCase):
```javascript
{ userId: '<uuid>', status: 'paid' }   // correct
{ user_id: '<uuid>', status: 'paid' }  // wrong — server ignores it
```

## Concurrency Guards

| Location | Guard |
|----------|-------|
| `handleLogin()` | button disabled during `signInWithPassword`; 15s timeout clears localStorage |
| `handleSignup()` | button disabled during `/api/signup` fetch |
| `handleFile()` | `_uploadInProgress` flag + both file inputs disabled |
| `onAuthStateChange` | `_processingToken` deduplicates concurrent session events |

## Signup Flow (api/signup.js)

1. Calls `supabase.auth.admin.createUser` with `email_confirm: true`
2. Sends admin notification to `russelsaiassistant@gmail.com` via Resend
3. `on_auth_user_created` Supabase trigger inserts the `accounts` row

## Race Controls — Set Race Month (`setRaceMonth`)

Found in the Race tab's Race Controls panel (captain/owner only). Allows manually setting `race_config.current_month` without running an archive + upload cycle.

**Flow:**
1. Updates `race_config` with the selected month label (e.g., "June 2026")
2. Queries `sales_log` for that month's date range → builds per-agent sales totals
3. **Seeds missing `race_data` rows**: upserts placeholder rows (with `ignoreDuplicates: true` so existing call stats are preserved) for any agent found in `sales_log` that doesn't have a `race_data` row — looks up `name` and `team` from `agent_roster` (team persists across archives)
4. Updates all `race_data` rows with the computed sales totals (zeros agents with no sales for that month)
5. Calls `loadRaceData()` to refresh the UI

**Critical**: Step 3 is necessary because `confirmArchive()` deletes all `race_data` rows. Before a call upload runs, the table is empty. Without seeding, the update loop in step 4 finds no rows to iterate.

## Race Tab Voicemail/Missed Counts

`loadRaceData()` queries `call_log` directly for counts (two `count: exact` queries). Results in `_raceWideMissed` and `_raceWideVm`. Do not read `race_data.race_wide_missed/voicemail` — unreliable after archive.

## Hours Label Staleness (`_maLastHoursPeriod`)

`updateHoursLabel()` prefers `_maLastHoursPeriod` (set by `updateHoursLabel(data.hoursLastPeriod)` when cached analysis loads) over `_memberHoursData`. If a prior analysis was loaded in the same session, `_maLastHoursPeriod` sticks and the label shows the old period even after a new upload.

**Fix (in place):** `maHoursSave` and `maHoursDeletePeriod` call `updateHoursLabel(null)` (not `updateHoursLabel()`) to explicitly clear `_maLastHoursPeriod` and recompute from the freshly-returned `_memberHoursData`.

## Agent Performance Charts (daily report, added 2026-07-24)

Account Settings → Report Delivery → "Agent Performance Charts" lets the owner opt into visual charts of each individual agent embedded in the daily report email, choosing which datasets to include and whether each renders as a bar, line, or scatter chart.

**Rendered on demand, not pre-generated.** `api/email-report.js`'s `agentChartsSection()` only mints signed `<img src="/api/chart?...">` URLs when building the email — it does zero data fetching or image rendering itself. The actual PNG is built by `api/chart.js` the moment the recipient's email client loads the image (i.e. when they open the email). This was a deliberate choice over pre-rendering + uploading to storage: no storage bucket, no cleanup/retention cron, and the image always reflects live data anchored to the report's `date` param — not "today," which could be days after send if the recipient opens the email late.

**Signed URLs, not stored images (`api/_lib/chart-sign.js`).** Since an email `<img>` tag can't carry an Authorization header, the URL itself must prove it was minted by our own send process for this exact `(user_id, agent_id, dataset, chart type, report date)` tuple — otherwise anyone with one chart URL could tamper the query string to pull a different agent's or account's numbers. `signChartParams`/`verifyChartParams` HMAC the five params together using `CUSTOMER_ENCRYPTION_KEY` (the same key `decryptField` already uses for `call_log.agent_id` — reused rather than adding a new required env var). If that key isn't configured, `signChartParams` returns `null` and `agentChartsSection` silently skips charts entirely rather than emitting a broken/unsigned URL.

**`CUSTOMER_ENCRYPTION_KEY` was Preview/Production only, not Development (fixed 2026-07-24).** This blocked all local `vercel dev` testing of anything touching it — not just this feature, `decryptField` in `api/email-report.js` had the exact same silent local gap before. Added to Development via `vercel env add` so local testing of encrypted-agent-data features actually works going forward.

**Chart rendering (`api/_lib/chart-render.js`)** is a hand-rolled SVG bar/line/scatter generator (no chart library — needs stayed simple enough that hand-writing was easier than fighting a library's theming API for the email's dark aesthetic) converted to PNG via `sharp`, the exact same SVG→PNG pipeline already proven live in `api/og.js`. Native render size is 2x the `<img>` display size in the email so charts stay sharp on retina.

**Datasets (`CHART_DATASETS` in chart-render.js) mirror exactly what's already in the report tables** — per the explicit requirement that charts not track anything new:
- `trend_placed` / `trend_answered` / `trend_talk` — 14-day daily trend per agent (line makes the most sense here, but bar/scatter are allowed)
- `mtd_policies` / `ytd_policies` — Policies by product (unweighted count — matches `aggregateSalesByAgentProduct` in email-report.js exactly, i.e. split sales count as flat 1s in this report the same way they already do in the existing tables, NOT `sale_weight`-adjusted the way the Race tab is)
- `mtd_premium` / `ytd_premium` — Written premium by product, Premium plan only (`premiumOnly` flag, gated in both `agentChartsSection` and the Account Settings picker)
- `team_talk` / `team_answered` (`teamWide: true`, added 2026-07-31) — one chart TOTAL per report (not per agent), every active agent's name along the x-axis, scoped to the report's own `date` (same numbers as the "Agent Breakdown" table — talk minutes and answered-call count — not the 14-day trend). Added because the per-agent charts made it impossible to compare agents side by side; `agentChartsSection` (email-report.js) now splits `usable` config entries into `teamUsable`/`agentUsable` by the `teamWide` flag and renders a "Team Comparison Charts" block once, above the existing per-agent "Individual Agent Charts" block. `api/chart.js` branches on `spec.teamWide`: instead of scoping to one `agent_id` (the `a` query param), it fetches every `call_log` row for the account on that date, decrypts+aggregates per agent, and resolves display names from `agent_roster`. The signed `a` param is a fixed sentinel (`TEAM_CHART_AGENT = '__team__'` in email-report.js) — signing/verification is unchanged, it just never needs to resolve to a real roster row for these two datasets.

**Per-agent chart colors were changed 2026-07-31** to avoid literally duplicating the report's own chrome (summary stat cards use `#00d4ff`/`#00ff94`/`#ff4d6d`/`#ffd166`/`#ff8c42`; team badges reuse `#00d4ff`/`#00ff94`) — every dataset's default color in `CHART_DATASETS` was picked to be distinct from that set and from every other chart dataset. See the palette in `api/_lib/chart-render.js`.

**Color/opacity/outline customization (added 2026-07-31).** `report_chart_config` entries are now `{dataset, type, color?, opacity?, outline?}` (previously just `{dataset, type}`) — all three new fields are optional and cosmetic only, not signed by `chart-sign.js` (tampering with display styling has no data-access implications). Account Settings → Agent Performance Charts shows a color picker, an opacity slider (0.2–1), and an optional outline color picker per chart row (`renderChartConfigList`/`saveChartPrefs`, `js/account.js`). `chartImgTag()` (email-report.js) appends `&color=&opacity=&outline=` to the signed chart URL when set; `api/chart.js` reads them directly off the query string (regex-validated hex / clamped float, not passed through the HMAC) and forwards them into `renderChartSvg`, which applies `fill-opacity`/`stroke-opacity` and an optional `stroke` outline to bars, lines, and scatter points alike.

**Pagination bug caught during testing (fixed before ship).** The first version of the `trend_*` query used `.limit(5000)` as a "defensive cap, will never be hit" — verified false against real production data (one account had 2866 call_log rows in a single 14-day window for one agent, and Supabase silently truncated to 1000 regardless of the higher `.limit()`, since `.limit()` can only lower the server's default row cap, never raise it). This is the exact same bug class as the `.range()` pagination bug fixed elsewhere in this app (see "Pagination bug" section) — fixed the same way, with a real `.range()` loop ordered by `hash`. Caught by cross-checking the day-bucketed sum against an independent flat count from the identical fetched row set (comparing two *separate* queries against this live, actively-uploading account gave false-positive mismatches from real concurrent data changes — comparing two aggregations of one single fetch eliminated that confound).

**`call_dt` normalization bug (also caught during testing, fixed before ship).** Supabase returns `call_dt` as a full timestamptz string (`"2026-07-23T00:00:00+00:00"`), not a bare `"YYYY-MM-DD"` — the trend query's day-bucketing originally looked up `byDay[row.call_dt]` directly, which never matched any pre-built key, silently producing an all-zero trend line. Fixed with `String(row.call_dt).slice(0, 10)` before the bucket lookup. The pre-existing single-day query in `email-report.js` never hit this because it filters `call_dt` server-side (`.eq('call_dt', dateStr)`) and never reads the column back into JS.

**Account Settings UI (`js/account.js`)** — `renderChartConfigList`/`saveChartPrefs` follow the exact same direct-Supabase-update pattern as `saveReportPrefs` right above it (no dedicated API endpoint). `report_chart_config` is `[{dataset, type, color?, opacity?, outline?}]` (see color/opacity/outline note above); unchecked datasets are simply omitted from the array rather than stored with a disabled flag.

**Migration required:**
```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS report_charts_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS report_chart_config jsonb NOT NULL DEFAULT '[]';
```
(Migration confirmed run 2026-07-24.)

## Team Member Analysis Charts (tracked activities layered into an existing chart, added 2026-07-24)

A second, separate chart-configuration feature from "Agent Performance Charts" above — that one controls server-rendered PNGs in the daily *email*; this one controls the **live in-browser Chart.js canvases** on the Analysis → Team Member Analysis tab (`js/member-analysis.js`, `renderAgentChartTiles`). Don't conflate the two — different rendering pipelines, different settings, different `accounts` columns.

**What it does.** Every analyzed agent already gets exactly three charts: "Calls Placed, Answered & Policies," "Talk Time (min)," and "Premium" (`ma-c-calls-*`/`ma-c-talk-*`/`ma-c-prem-*` canvases). Rather than adding a fourth chart for tracked custom activities (Pivot, Quote Provided, etc.), the account owner picks *one* of the three existing charts in Account Settings → "Team Member Analysis Charts," and every activity type flagged `include_in_analysis` gets layered into it as an additional bar dataset (Chart.js combo/mixed chart — each dataset carries its own `type`, so bar datasets coexist with the chart's existing line datasets on one canvas). A second setting controls whether multiple tracked-activity bars (e.g. both Pivot and Quote Provided) render `stacked` (same Chart.js `stack` id) or `grouped`/side-by-side (unique `stack` id per dataset) relative to each other — the pre-existing line series are never stacked regardless, since `stacked` only affects bar-type datasets sharing an axis.

**Settings:** `ma_chart_activities_enabled` (bool), `ma_chart_activities_target` (`'calls'|'talk'|'premium'`), `ma_chart_activities_mode` (`'grouped'|'stacked'`) — loaded into globals `_maChartActivitiesEnabled`/`_maChartActivitiesTarget`/`_maChartActivitiesMode` in `checkAccountAndShow()` (`js/init.js`), for both the owner branch (`select('*')`, no list to update) and the member branch (explicit column list — captains/COs also view these charts, so they need the same three columns added to that branch's `.select()`).

**Same per-agent visibility rule as the stats-line addition (`current.customMetrics`, added 2026-07-24 earlier the same day)** — a tracked type only contributes bars for agents it's actually `assigned_agent_ids`-assigned to, not blanket-shown as zero for every analyzed agent. Applied identically to the new historical data (`customMetricsHistoryByAgent` in `api/member-analysis.js`).

**Historical per-month data, not just current month (`customMetricsHistoryByAgent` in `api/member-analysis.js`).** The existing `customMetricsByAgent`/`customMetricsVisibleByAgent` (used by the AI prompt and the stats-line) were MTD-only. The chart needs one bar-height per historical month too, aligned to the same `months` array the other three charts already use. Since `bonus_activities` is append-only with its own `activity_date` per row (unlike `race_data`, which needs `historical_wins` as a monthly snapshot archive because it's a *mutable current-state* table), past months are queried directly — no new archive table needed, just a `monthLabelToRange('Jul 2026') → {start,end}` helper to turn each `historical_wins`-derived month label into a date range, then one `bonus_activities` query spanning the full historical window, bucketed by `(agent_id, month, type)`. Each `months[i]` entry gets a `customMetrics: [{name, count}]` array, mirroring `current.customMetrics`'s shape exactly so the frontend can build one aligned array per tracked type across `[...months, current]` the same way `placed`/`answered`/etc. arrays are already built.

**Verified against real data (2026-07-24):** the historical query correctly returns zero rows for Apr/May/Jun 2026 — not a bug, just real: the Quick-Count/activity-tracking feature itself didn't exist before this same day, so there's genuinely no historical `bonus_activities` data yet for prior months. It'll populate naturally going forward. Current month (Jul 2026, via `current.customMetrics`) already has real data and was verified separately when the stats-line feature shipped.

**Gotcha: shipping a new field into `agentData` doesn't retroactively appear in an existing cache.** `accounts.member_analysis_cache` holds a full JSON snapshot from whenever it was last generated (5-day TTL, `CACHE_TTL_MS`) and is served as-is on `checkOnly=1`/normal GET — deploying code that adds a new field (like `current.customMetrics` or `months[i].customMetrics`) does **not** backfill that field into an already-cached payload; the cache just doesn't have it until the next real regeneration (natural TTL expiry, or a manual "Re-run"). Hit exactly this in production the same day: a user reported the individual-agent chart showing 0/missing tracked-activity numbers, traced to a cache generated the night before the `customMetrics` field existed in the code at all. The underlying computation was already correct — verified by recomputing live and comparing against the stale cache — the fix was just forcing one fresh regeneration, not a code change. **When shipping any new field into the analysis payload, expect existing cached accounts to lack it until their next natural or forced regeneration — this is not a bug to "fix," just something to check for and mention if a user reports the new feature "isn't showing anything."**

**Verified end-to-end via a standalone harness loading the actual shipped `js/member-analysis.js`** (not a reimplementation) with mock multi-month data, across all 3 targets × both modes — confirmed bars appear only in the selected chart, the other two render unaffected, legends auto-enable when bars are injected (previously `display:false` on Talk/Premium since they only had one series each), and stacked vs. grouped are visually distinct.

**Migration required:**
```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ma_chart_activities_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ma_chart_activities_target text NOT NULL DEFAULT 'calls';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ma_chart_activities_mode text NOT NULL DEFAULT 'grouped';
```

### Per-type chart appearance (color/opacity/outline, added 2026-07-31)

Each tracked activity type's bar dataset (above) now has the same color/opacity/outline customization as the daily report's Agent Performance Charts (`api/chart.js`/`js/account.js`), just stored per-`bonus_activity_type` instead of per-report-dataset — `chart_color`/`chart_opacity`/`chart_outline` columns on `bonus_activity_types`, all nullable/optional so existing types keep using the fallback cycling palette (`ACTIVITY_BAR_COLORS` in `renderAgentChartTiles`) until customized.

**Editor**: `_renderBonusChartStyleEditor(t, checked)` in `js/sales.js`, nested inside `_renderBonusAnalysisEditor` and toggled by the same "Include in Team Member Analysis" checkbox — chart appearance is only meaningful once a type is actually flagged `include_in_analysis`, so there's no separate visibility flag to keep in sync. Same three-control pattern as the report chart picker: a color swatch, an opacity slider (0.2–1), and an optional outline color + enable checkbox. Saved via the existing `update_type` action (`saveBonusActivityType` in `js/sales.js`), validated server-side in `api/bonus-activities.js` (`sanitizeHexColor`/`sanitizeOpacity` — same hex regex and opacity clamp as `api/chart.js`).

**Rendering**: `renderAgentChartTiles` (`js/member-analysis.js`) looks up each tracked metric's full type row from `_activityTypes` by name (the same name-keyed matching every other consumer of `customMetrics` already uses — there's no `activity_type_id` round-tripped through the analysis payload) and builds `backgroundColor` via a new `hexToRgba()` helper, since Chart.js bar datasets take one combined color string rather than a separate fill-opacity property the way the report's hand-rolled SVG renderer does. `chart_outline`, when set, adds `borderColor`/`borderWidth:1.5` to the dataset.

**Migration required:**
```sql
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS chart_color text;
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS chart_opacity numeric;
ALTER TABLE bonus_activity_types ADD COLUMN IF NOT EXISTS chart_outline text;
```
