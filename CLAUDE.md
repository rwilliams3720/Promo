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

### Cross-report consistency — Race tab, Sales Performance tab, and the Daily Report must agree (fixed 2026-08-18)

Reported as "sales numbers don't seem to align across the 3 reports — which is correct?" Investigated by recomputing all three pipelines' logic directly against the same real production data (August 2026) and diffing them line by line — `race_data` itself was confirmed NOT stale (matches a fresh recompute of its own logic exactly), so this was never a staleness bug. It was three independently-built features quietly answering three different questions with the same underlying `sales_log` rows:

| Filter | Race tab (`rebuildRaceData`) | Sales Performance (`GET /api/sales` + `spGroup`) | Daily Report (`aggregateSalesByAgentProduct` / `api/chart.js`) |
|---|---|---|---|
| `sale_weight` (0.5/side of a split sale) | Applied | ~~Ignored (flat +1/row)~~ **Applied** | ~~Ignored~~ **Applied** |
| `is_cancelled` (charged-back sales) | Excluded | ~~Included~~ **Excluded** | ~~Included~~ **Excluded** |
| `source` (`upload` vs `manual`/`checklist`) | All included | ~~`upload` excluded~~ **All included** | All included |
| `hidden` (owner-decluttered unissued sales) | Included (unaffected) | Excluded (unaffected — deliberately kept list-view-only, see below) | Included (unaffected) |

Strikethrough = the pre-fix behavior; bold = what it was changed to. For the live account this was reported against, only the `sale_weight` row was actually causing a visible August 2026 discrepancy (exactly 4 agents with split sales that month — Tiffany Dabe, Joseph Underwood, Ashley McEniry, Fiona Rodriguez — every other agent already matched exactly); `is_cancelled` and `source` had zero cancelled sales and zero `upload`-sourced rows in-month respectively, so those gaps were real but latent, not yet visibly manifesting. Confirmed via `git log`: the `source` filter had already been identified and removed from the Chargeback Report's query for this exact reason once before (`f76baee`, 2026-07-02, "Fix chargeback report missing uploaded policies" — "Uploaded sales have no source value set so they were silently excluded... The commissions report... showed them correctly") — the main Sales Log/Performance query was apparently just never updated to match at the time.

**`hidden` was deliberately left alone** — asked the account owner directly rather than assuming: hidden is a manual per-sale declutter toggle (only offered on not-yet-issued sales, via the Sales Log's Hide button) representing "don't clutter my list with this," not "this sale didn't happen." Race tab and the Daily Report were already ignoring it (arguably by luck rather than design, since neither ever explicitly considered it), and the owner's call was to keep it that way rather than start excluding hidden sales from competition standings and reports — a materially different, higher-stakes behavior change than the other three, which are all "make these three views count the same underlying activity the same way."

**Where each fix landed**:
- `api/sales.js` `GET` — removed `.in('source', ['manual','checklist'])` from both the month query and the cross-month-unissued query (mirrors the chargebackMode fix above). This endpoint also backs the raw Sales Log list and the Race tab's captain/CO-scoped "Sales by Agent" tile (`js/race.js`, `useSalesLog` branch) — both now show upload-sourced rows too, consistent with Race tab standings already including them.
- `js/sales-perf.js` `spActiveEntries()` — filters out `e.is_cancelled` (shared by every Sales Performance view: summary stat, pie-chart breakdowns, drill-down crumbs). Deliberately NOT applied to `_filteredSalesEntries()` (the separate raw Sales Log list) — that list should keep showing cancelled sales with their chargeback badge; only Sales Performance's *aggregate counts* needed to exclude them.
- `js/sales-perf.js` `spGroup()` / `spRenderSummary()` — count now accumulates `(e.sale_weight ?? 1)` instead of a flat `+1`. Premium sums are untouched — `written_premium` is already each agent's own split share, no weighting needed there.
- `api/email-report.js` — the daily `sales` query and both `mtdSalesRes`/`ytdSalesRes` queries gained `.eq('is_cancelled', false)` and `sale_weight` in their `.select()`; `salesStats`, `aggregateSalesByAgentProduct`, and `totalPolicies` all now accumulate `(row.sale_weight ?? 1)` instead of a flat `+1`. `aggregatePremiumByAgentProduct` needed no weighting change (same reasoning as Sales Performance's premium sum) but now benefits from the same `is_cancelled` exclusion at the query level.
- `api/chart.js` — the per-agent `mtd_policies`/`ytd_policies` chart data already excluded cancelled sales (pre-existing) but wasn't weighted; now is. Dollar-mode charts (`mtd_premium`/`ytd_premium`) untouched, same reasoning.
- `api/_lib/chart-render.js` `fmtVal()` — **had to be fixed too**, or the consistency work above would've been visually undone: it unconditionally `Math.round()`-ed every non-dollar value for display, so a chart now correctly computing `11.5` policies would still print the bar's label as `"12"` — silently reintroducing a mismatch against every other view showing `11.5`, purely as a rendering artifact with no underlying data bug. Now only dollar values round to whole units; policy-count values round to 2 decimals (floating-point noise cleanup only) and display their real value.

Verified by independently recomputing each of the three pipelines directly against live production `sales_log` data for August 2026 and diffing the per-agent, per-product results — all three now match to the exact same fractional values (including the four agents' half-integer split-sale totals), and confirmed live via `vercel dev` against the real `api/chart.js` endpoint (screenshot-verified the `11.5`/`6.5` bar labels specifically, since that's the exact rounding bug above). Note while testing: a stale `.vercel/cache` directory served an old build through several `vercel dev` restarts — deleting it was necessary before code changes took effect locally; unrelated to any of the actual data-consistency fixes but easy to mistake for one if a `vercel dev` restart alone doesn't pick up a change.

**A fourth counter was missed in the original pass — the Sales Log tab's own scorecard (fixed 2026-09-01).** Reported as "Sales log is still showing inaccurate count. Should match the race tab." `_renderSlScorecard()` (`js/sales-log.js`) is a *separate* aggregator from `spGroup()`/`spRenderSummary()` above — it drives the per-product pill counts and the "Total" pill shown directly above the raw Sales Log row list, fed by `_filteredSalesEntries()` rather than `spActiveEntries()`. It was never touched in the 2026-08-18 pass and still counted a flat `+1` per row including cancelled sales, so it retained the exact same inflation the other three views already had fixed (confirmed against real August 2026 data: old logic gave `{term:14, health:6, auto:135, fire:60, wl:2}`, new logic gives `{term:13, health:6, auto:129, fire:57, wl:1}` — matching a fresh `race_data` recompute exactly). Fixed the same way as the others: filter `!e.is_cancelled` before counting, accumulate `(e.sale_weight ?? 1)` instead of a flat `+1` per product, and derive the "Total" pill from the sum of those same weighted per-product counts rather than `entries.length` directly. The raw row list underneath (each individual sale, one row per `sales_log` entry) is intentionally untouched — cancelled sales should still show there with their chargeback badge; only this aggregate scorecard needed the exclusion, same split as Sales Performance's `spActiveEntries()` vs `_filteredSalesEntries()`.

**Takeaway**: when the same undercount/overcount bug exists in multiple places sharing a root cause (unweighted flat-`+1` counting, or an `is_cancelled`/`source` filter gap), grep for every aggregator over `sales_log`/`_salesLogEntries`/`_spEntries` before declaring the fix complete — `_renderSlScorecard` was a plainly analogous function to `spGroup`, just in a different file, and got missed because the original investigation was scoped to "the 3 reports" the user named rather than an exhaustive search for every place a policy gets counted.

### Sales Log sort by team member / policy type (added 2026-09-01)

`renderSalesLog()` (`js/sales-perf.js`) previously had one fixed sort — unissued-first, then most-recent sale date — with no user control. Added a `#sl-sort-sel` dropdown (`index.html`, next to the existing Issued/Not Issued filter) with three options: Date (the original default behavior, unchanged), Team Member, and Policy Type. `_salesLogSort` (`js/sales-log.js` state) drives a `sortFn` selection in `renderSalesLog()` — agent/product sort compares `_agentRoster`-resolved display name / `labelForCat(e.product)` alphabetically, falling back to the original date-sort as a tiebreak so entries within one agent/product group still show most-recent-first. Applied identically to both the in-scope month/quarter/year list and the "unissued from other months" trailing section, so switching to agent/product sort groups matching entries together across both sections rather than only reordering the primary list.

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

**Recurring goals rolled over hours before the account's local day/month actually ended, reading 0/target for a goal genuinely still on pace (fixed 2026-09-01).** Reported as "Goals for agent Tiffany are not capturing the checked products" — investigated end to end and the product-scope filtering (`combined_groups[].products`, checked against `sales_log.product`) was never broken; reimplementing `computeActuals()`'s filter by hand against Tiffany's real August sales reproduced the code's own 36/40 auto+fire count exactly (note: 36 was later found to itself be wrong for an unrelated reason — see "combined_groups double-counted split sales" below — but it matched what the code computed at the time, confirming the product filter wasn't dropping or misrouting any sales). The actual bug being chased here was one level up, in `currentPeriodDates()` (`api/agent-goals.js`): when computing "the current period" for a recurring goal with no explicit `refDate` (the default path both the Race tab's quick-view and the Goals tab's own default view take), it derived year/month from `new Date().getUTCFullYear()`/`getUTCMonth()` — the server's raw UTC calendar date — instead of the account's own business timezone (`accounts.timezone`, e.g. `America/Los_Angeles`). Every US timezone lags UTC, so for several hours every single day (roughly 4-5pm–midnight Pacific) the server's UTC date has already advanced to tomorrow while the account's real local day hasn't ended — and near a month boundary specifically, this meant a recurring monthly goal's "current period" silently flipped to the new (empty) month up to 7-8 hours before the account's own August actually finished, showing 0/40 for a goal that had legitimately been on pace the entire time. Confirmed by computing both ways against the identical real timestamp (`2026-09-01T03:00:00Z` — still 8pm Aug 31 in Pacific): raw UTC resolves to September, `Intl.DateTimeFormat('en-CA', {timeZone: 'America/Los_Angeles'})` correctly resolves to August 31.

This is **not scoped to Tiffany, to product-scoped goals, or even to monthly goals** — `currentPeriodDates()` is the single shared code path for every `is_recurring` goal on the platform (monthly/quarterly/semi_annual/annual; plain single-product, activity-type, and combined-group goals alike), consumed identically by both the Goals tab's default view and the Race tab's quick-view (which trusts `agGoal.actuals` from the server, correctly, per the fix directly above — but that server value was itself wrong during the UTC/local gap). Any account whose `accounts.timezone` lags UTC — i.e. every US-timezone account on the platform — was exposed to the same premature-rollover window near its own period boundaries; it surfaced against Tiffany's goal specifically only because that's the one being actively watched near a month-end.

Fix: `currentPeriodDates()` now takes a `timezone` param and, when no `refDateStr` is given, derives today's date via `new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC' }).format(new Date())` — the exact same technique `todayInTz`/`yesterdayInTz` already use in `api/email-report.js` (en-CA formats as `YYYY-MM-DD` directly, no parsing needed). The `GET /api/agent-goals?withActuals=1` handler now fetches the DATA owner's `accounts.timezone` (not the caller's — a member's own row has no relevant timezone field) and threads it through `computeActuals()` into `currentPeriodDates()`. Verified live: with no `refDate`, September 1st correctly showed a fresh 0/40 (legitimately early in the new month, not a bug); passing `refDate=2026-08` still returned Tiffany's 36/40, confirming the timezone fix didn't change the product-scope logic's behavior.

**`combined_groups` (and every other policy-count actuals field) double-counted split sales — a 4th aggregator missed by the original cross-report reconciliation (fixed 2026-09-01, same day as the fix above).** Follow-up ask: "confirm tiffany goals reflect intent... Sales Performance shows 32.5 policies combined, but goal report is showing 36." Traced exactly: `computeActuals()` counted every matching `sales_log` row as a flat `1` — for per-product `actuals[prod]`, the `policies` total, and `combined_groups` alike — with `sale_weight` never applied anywhere in the function. Confirmed against Tiffany's real August auto+fire sales: 36 unweighted vs. 32.5 weighted, a gap of exactly 3.5 = 7 split-sale rows × 0.5. This is the identical bug already found and fixed once for the Sales Log tab's own scorecard (see "Cross-report consistency" above) — `computeActuals` is simply a **4th** place that independently counts policies over `sales_log` and was never touched by that original reconciliation pass, which only covered "the 3 reports" as they were described at the time (Race tab, Sales Performance, Daily Report). The account owner confirmed 32.5 (weighted) reflects the intended semantics — a split sale is one real deal shared by two agents and shouldn't count twice toward a combined policy goal, same reasoning as everywhere else this convention already applies.

Fix: added `sale_weight` to `computeActuals`'s `sales_log` `.select()`, and changed `actuals[prod]`, `actuals.policies`, and the product-type branch of `actuals['combined_' + grp.id]` from `.filter(...).length` to `.filter(...).reduce((sum, s) => sum + (s.sale_weight ?? 1), 0)`. The activity-type branches (plain `activity_*` goals and activity-type `combined_groups`) were already summing `a.count` rather than counting rows, so they needed no change — activities have no split-sale equivalent. `actuals.premium` also needed no change — `written_premium` is already each agent's own split share, same reasoning as every other premium sum in this codebase. Verified live: Tiffany's August combined auto+fire actuals now returns `32.5`, matching Sales Performance exactly.

**Takeaway, reinforcing the one already in "Cross-report consistency"**: any bug involving an unweighted count over `sales_log` is worth grepping for beyond the specific view that was reported — `_renderSlScorecard` and `computeActuals` were both missed by the same original investigation for the same reason (scoped to the named symptom, not to every place a policy gets counted), and surfaced independently, days apart, as two separate user reports of "these numbers don't match."

**Separately noted, not fixed as part of this report**: several client-side `new Date().getFullYear()`/`.getMonth()` calls in `js/goals.js` (unrelated to the server bug above) resolve "now" using the *viewing device's* local timezone, not the account's business timezone — a different class of drift (an owner checking Goals from a different city than the business) that wasn't part of what was reported and is out of scope here, but worth knowing about if a similar report surfaces again with a client-only reproduction.

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

### Commission premium basis — issued_premium, not written_premium (changed 2026-09-01)

Asked as "confirm chargebacks are calculated based on the issued premium." They weren't — `calcStructurePayout` (and therefore `computeChargebackAmount`, which calls it internally) used `sale.written_premium` exclusively, for BOTH normal commission earning and chargeback clawback, on every structure regardless of its `pay_on_issue` setting. `pay_on_issue` only ever gated which DATE field (`issued_date` vs `sale_date`) decided whether a sale falls in the earning month — it never affected which premium dollar amount the math actually ran on. `issued_premium` was stored (editable in the Sales Log, selected in the Chargeback Report's raw rows) but never read into any commission calculation anywhere.

Fixed via a new shared helper, `commissionPremiumOf(sale)` (`api/_lib/commission-calc.js`, exported): returns `issued_premium` when it's meaningfully set, else `written_premium`. **"Meaningfully set" excludes both NULL and exactly 0** — before shipping, a full audit against real production `sales_log` data found 7 real sales (all Tiffany Dabe, all in already-paid months) with `issued_premium` stored as literal `0` alongside a genuine nonzero `written_premium` — almost certainly a data-entry gap (a form submitting `0` instead of leaving the field blank), not an intentional "this policy issued for free." A naive `!= null` fallback would have zeroed out real commission on a $870 and a $614.80 sale, among others — caught and fixed before deploy via a dry-run blast-radius check against production, not discovered after. `calcStructurePayout`'s per-sale premium, the itemized chargeback list's display premium/share in `api/commissions.js`, and the Chargeback Report's premium column/sort/total in `js/sales-log.js` (`cbPremiumOf`) all now use this same basis, so the displayed premium always matches what actually drove the shown commission/chargeback dollar amount.

**Scope: retroactive, not just going-forward** (explicit account-owner choice, made after being shown the actual scale below) — `calcStructurePayout` always live-recomputes from `sales_log` fresh, so this changed "earned" for every past month with an affected sale the moment the fix deployed, not just future sales. Verified via a full production dry-run before deploying: of 868 non-cancelled sales, 170 have a commission-basis premium that actually changes under the new logic (net −$2,375 in premium across all agents combined — real corrections in both directions, not a one-sided bug). Several already-PAID months (Susan Navarro, Tiffany Dabe, Ashley McEniry, others) contain at least one affected sale, so their live "earned" figure now differs from what was actually paid — this surfaces as the existing `recalculated: true` flag (informational only; it does not alter `commission_payments`/`commission_bank`, force any correction, or re-touch a payment record). This is the same flag mechanism already used for every other "stored payment vs. fresh recompute disagree" case in this system (e.g. a since-fixed calculation bug, a sale edited after the fact) — nothing new was built for it, the premium-basis change just newly triggers it in more places, by design, per the account owner's explicit choice.

**Takeaway**: before shipping ANY change to `calcStructurePayout`'s core premium/rate inputs, dry-run a blast-radius diff against real production data first — this exact process caught a genuine $0-commission landmine (the issued_premium-stored-as-0 sales) that would otherwise have shipped as a severe regression despite the overall design being correct. "The account owner approved the concept" is not the same as "the concrete data has no surprises" — check the data before deploying a global recompute, not after.

### Carry-forward — chronological ordering, not save order

`priorBankBalance` lookup (`api/commissions.js`) must find the closest **chronologically-prior** `commission_bank` row per agent, via `monthKey()` (parses `"April 2026"` → sortable int) filtered to `< currentKey`. **Never** order by `created_at`/`updated_at` alone — a later-saved row (e.g. a future month re-rendered after the current one) can otherwise leak into an earlier month's "prior debt" and cross-contaminate months that never had any real activity. This exact bug caused two unrelated months to show an identical stale negative balance in production (2026-07-17 incident — see task history) because the more-recently-touched month's balance leaked backward into an earlier, actually-inactive month.

`_autoSaveCarryForwards()` (`js/sales.js`) must always persist a fresh ledger snapshot, including `$0` — **do not** re-add an `if (cfOut === 0) continue` early-skip. Skipping the zero case means a stale nonzero balance saved before a calculation bug fix can never self-heal to the now-correct value; it just sits there forever and keeps propagating via `priorBankBalance`. The only skip that's safe is `if (r.paid?.amount_paid != null) continue` — an already-recorded payment freezes that month's ledger row intentionally (see split payments below).

### Split / partial payments

`commission_payments.amount_disbursed` (nullable — NULL means fully disbursed, matching `amount_paid`) tracks how much of a month's full computed obligation (`amount_paid`) has actually been physically paid out. The "Mark Paid" form (`openPayForm`/`saveCommissionPayment` in `js/sales.js`) has a "Split payment" checkbox that reveals an "Amount Actually Paid Now" field for `amount_disbursed`; unchecked, `amount_disbursed` defaults to the full `amount_paid`.

`GET /api/commissions` computes `outstandingReceivable` (`Math.max(0, amount_paid - amount_disbursed)` summed across every strictly-prior month per agent) but this is **display-only** as of 2026-07-21 — exposed as `outstanding_receivable` in the response and shown as a `$X owed` badge (owner status column and the member's own view via `_buildCommPaidStatusHtml`). It is **not** added into `priorBalance`. See the compounding-bug note below for why.

### Commission payment installments (added 2026-08-19)

Requested as: "there needs to be another payment for the second payment that was made to settle the remaining deficit from the split. If the payment is missed it should still roll into the next month." The second half was already true — carry-forward into next month is driven purely by `amount_paid - amount_disbursed`, unaffected by whether or how a shortfall eventually gets settled — but there was no way to actually *record* that second payment. `commission_payments` is one row per `(user_id, month, agent_id)` (`onConflict: 'user_id,month,agent_id'`), holding exactly one `amount_disbursed`/`paid_date`/`notes` triple. Reopening "Mark Paid" for an already-split-paid month pre-filled that single row's values into the same one-shot form; saving again didn't add a second payment, it overwrote the first payment's date and notes with whatever was typed for the second one — the actual first payment date was lost, not preserved alongside it.

Added `commission_payments.installments jsonb default '[]'` (`Old SQLs/commission-payments-installments-migration.sql`, includes a backfill so every existing paid row gets a synthetic single-entry history matching its current amount_disbursed/paid_date/notes). `amount_paid`/`amount_disbursed`/`paid_date`/`notes` are all kept in sync with `installments` (amount_disbursed = sum of installment amounts, paid_date/notes = most recent installment's) specifically so **every existing reconciliation query — the bank carry-forward math, `outstanding_receivable`, `_autoSaveCarryForwards` — needed zero changes**; they only ever read the summary fields, never `installments` itself.

**New PATCH mode**: `{ addInstallment: true, agentId, month, amount, paidDate, notes, bankEntry }` — server fetches the existing row (must already have `amount_paid` set, else 400 "use Mark Paid first"), appends `{amount, date, notes}` to `installments`, recomputes `amount_disbursed` as the new sum (rejects with 400 if it would exceed `amount_paid` by more than a cent), and updates `paid_date`/`notes` to this installment's values. `amount_paid` (the full obligation) is never touched by this path — only ever set once, by the original Mark Paid save. The recomputed cumulative `amountPaid`/`amountDisbursed` then flow into the *same* bank-reconciliation block the normal save path already used (unchanged) — a second installment that fully settles a month reconciles the bank balance to zero exactly the way a single full payment always has.

**UI** (`js/sales.js`): `openPayForm` now branches on whether a payment already exists. Not yet paid → the original one-shot form (`_renderFullPayForm`), unchanged. Already paid → `_renderInstallmentPayView`: shows the full obligation, a payment history list, and — if a balance remains — an "Add Payment" mini-form (amount pre-filled to the exact remaining balance and capped there, date defaults to today) that calls the new `addCommissionInstallment()`. A small "Edit full record instead" link remains as an escape hatch back to `_renderFullPayForm` for correcting an outright data-entry mistake — explicitly labeled as overwriting the whole history, since that path's `saveCommissionPayment` still does a full upsert that resets `installments` to a single fresh entry (same as it always has for a from-scratch save). Both the owner table's Paid cell and `_buildCommPaidStatusHtml` (used identically in the owner view and a member's own-commission card) now show a compact installment trail whenever more than one payment is on record.

Every read/write path degrades gracefully if the migration hasn't run yet on a given account: the GET handler retries the payments query without `installments` on error (this table is shared across every account on the platform — one pending migration must not break commissions for everyone), the full-record upsert retries without the `installments` field on the same error, and the client falls back to synthesizing a single installment from the legacy fields when `installments` is empty. Only `addInstallment` itself hard-requires the column (there's no meaningful degraded behavior for "add a second payment" without anywhere to put it).

Verified end-to-end against a disposable scratch agent_id (not a real agent — created, exercised through add/over-limit/no-prior-payment validation, then deleted) before touching any real data, then confirmed live via `vercel dev` + a real browser session against Tiffany Dabe's actual July 2026 record (the exact case that prompted this): full obligation $885.13, existing $542.27 installment shown in history, remaining $342.86 correctly computed and pre-filled into the add-payment form. Did not submit that real payment — recording it is a real financial action left to the account owner (or a following explicit request).

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

**A pre-redesign split sale had its full premium duplicated onto both agents' rows instead of split — data bug, not a code bug (fixed 2026-08-04).** Reported as "Tiffany and Peyton split a sale — the premium submitted didn't split based on the percentage and the commission was overpaid; submitted premium was $1644 and should've split 50/50." Root cause: this term sale (sale_date 2026-06-15, issued 2026-06-26) was originally logged by Tiffany on 2026-06-17 — before the two-row split-sale redesign — with the *full* $1644 premium in her row instead of her $822 half. When the 2026-07-21 redesign backfilled the missing teammate row for pre-existing split sales (see "Split sales" section above — "Backfilled 4 real production split-sale rows"), the backfill script trusted the original row's `written_premium` as already being the correct pre-halved share (true for the other 3 backfilled rows) and mirrored it via `split_ratio` into the new row — but for this one sale the original value was never actually halved, so the backfill faithfully copied the *wrong* $1644 into Peyton's new row too. Both rows ended up at $1644, recognizing $3288 total instead of $1644 and doubling this policy's commission at the 20% term rate ($328.80 each instead of $164.40 each).

Compounded the effect for Tiffany specifically: her June 2026 was separately hit by the double-halving code bug above (fixed 2026-07-31), and that fix's manual correction added a $164.40 "owed" credit to her bank based on a "corrected June earned" of $567.56 — a figure that was itself still inflated by this same premium-duplication bug. Once both bugs were corrected, her true June earned recomputed to $403.16, exactly matching what she'd already been paid — so the $164.40 bank credit was itself erroneous and had to be reversed, which also reduced her carried-forward balance (July's stored balance dropped from $507.26 to $342.86 once recomputed with the corrected $0 June carry-in).

Fix: corrected `written_premium`/`issued_premium` on both `sales_log` rows (hash `6ed5191f2f41afdb` Tiffany, `51f40879a7819079` Peyton) from 1644 to 822. The rest self-healed through the existing `_autoSaveCarryForwards` mechanism (see the frozen-balance fix above) by visiting June → July → August in order so each month's stored bank balance recomputed off the corrected prior-month value — no other commission_bank/commission_payments rows needed hand-editing. Confirmed live: June now shows Tiffany earned $403.16 (net $0 owed) and Peyton earned $164.40 (previously $328.80); July's stored balance dropped to $342.86; August now shows "$342.86 owed" for Tiffany. Peyton had no recorded `commission_payments` for June, so no payment-side correction was needed for him.

**Takeaway**: a backfill/migration script that infers "this row already has the correct pre-halved value" from a sibling row's shape is only as good as that sibling's data — it has no way to detect a sibling that was *itself* entered wrong pre-redesign. If another old single-row split sale surfaces with a suspicious duplicate-premium pair, check whether the original submitter's row genuinely represents their own share before trusting the backfill math.

**Full split-sale audit (2026-08-04), prompted by the fix above.** Reported separately: "Tiffany and Russel split a sale — premium was 3010, should've split to 1505 each." Same symptom (both rows at the full premium instead of half), but a different mechanism this time — this pair was created 2026-07-23 through the live two-sequential-POST `manualSubmitAll` flow (`js/sales-log.js`), not the 2026-07-21 backfill. That code path's ratio math (`writtenPremium: premFloat * ratio` for the primary, `premFloat * (1 - ratio)` for the teammate) is correct — the only way both sides land on the *same* $3010 is if $6020 was typed into the single "SUBMITTED PREM" field (or the true total really is $3010 and someone entered it twice, once per side, bypassing the auto-split field entirely). Either way this is a data-entry mistake, not a code defect in `manualSubmitAll` — but it means the earlier fix's root cause (bad `written_premium` on a split-sale row) isn't confined to backfill-era rows.

Audited every `split_sale` pair in `sales_log` (32 rows / 16 pairs) by comparing each side's ratio-implied total (`written_premium / split_ratio`) against its partner's. One pair (Ashley/Tiffany, 0.8/0.2-style ratio) is mathematically provable and confirmed correct. The Peyton/Tiffany and Tiffany/Russel pairs above are the two confirmed-and-fixed bugs. The remaining 12 pairs are exact 50/50 splits with equal `written_premium` on both sides — which is *indistinguishable by the numbers alone* from a correctly-split 50/50 sale, since a true 50/50 split of any total also produces two equal halves. Cross-checking against recorded payments (the trick that helped confirm the Tiffany/Peyton fix) only works when a month is both paid *and* not diluted by unrelated sales in the same commission run — only Tiffany's June (already resolved above) and Joseph Underwood's June ($50.40 paid, but mixed with 19 other unrelated June sales, making isolation impractical) had recorded payments to check against. Listed all 12 for the account owner (agents, customer, product, date, stored premium) — 2 backfill-era (Braden/Tiffany $60.09 health 6/15, Tiffany/Joseph $558.54 auto 6/24) and 10 live-flow. **Confirmed correct by the account owner against source records on 2026-08-04 — no further changes needed.**

**A simply-forgotten unpaid month didn't carry forward as owed — only deferred-by-design cases did (fixed 2026-08-04).** Follow-up question from the audit above: "Peyton wasn't paid the June balance — shouldn't that have flowed into the next month as owed?" It didn't, and this was a real gap: `bank_summary.paid_out` (`api/commissions.js`) is computed assuming the full expected amount gets handed to the agent every month, with no awareness of whether `commission_payments.amount_paid` was ever actually recorded — `settledBankBalance` only reconciled against a *shortfall* when a payment row existed (`paid?.amount_paid != null`), so a month that was never marked paid at all sailed through with `settled_balance_after` unchanged from the optimistic `balance_after`, and that optimistic value is exactly what `_autoSaveCarryForwards` persisted into `commission_bank.bank_balance_after` for the next month to read as `priorBankBalance`. Net effect: the ONLY trace that an agent was never paid was the "Unpaid" badge sitting on that one month's own row — it vanished completely the moment you moved to the next month's tab, with no running total anywhere.

Fix: `settledBankBalance` now treats "no payment recorded" as `disbursedNow = 0` (nothing has actually been disbursed) rather than skipping reconciliation — so `outstanding_receivable` for a never-paid month with positive `paid_out` now correctly equals that `paid_out` amount (verified: Ashley McEniry's July, never paid, now shows `$564.97 owed` instead of `$0`). `_autoSaveCarryForwards` (`js/sales.js`) now applies `settled_balance_after` to every month's persisted `balance_after`, not just paid ones, so this correctly self-heals forward the same way the frozen-balance fix above already does — no separate migration needed, it corrects itself as each month is next viewed. Also extended the equivalent (but separate) `outstandingReceivable{}` lookup used for non-bank-enabled accounts to cover the same case, using `commission_bank.paid_out` per prior month as the "expected payout" signal, since bank-disabled accounts never get a `bank_summary` object to reconcile in the first place.

**`commission_bank` manual override — the always-trust-the-recompute assumption breaks when the recompute structurally cannot see the whole picture (fixed 2026-08-05).** Reported same-day as the fix above, and caused by it in part: "Susan's commissions now show she owes $2,440.03 instead of being owed $875 like before." Traced precisely: Susan's June 2026 commission tracking predates this system's rollout — her June `commission_payments` row (`amount_paid: $12,916.04`, note `"Split 50/50"`) is a manually-verified true total from a legacy process this system has no visibility into, not a figure this system ever computed itself. `sales_log`-derived recompute for the same month gives `$9,600.21` net — a real, but *incomplete*, number. Historically this didn't matter because `_autoSaveCarryForwards` skipped already-paid months entirely (the pre-2026-08-04 behavior) — June's `bank_balance_after` was written once, near the time of payment, and then left alone, correctly carrying `$6,458.02` (the true remaining owed after $6,458.02 already disbursed) forward through July → August → September to land at the account owner's independently-verified `$875.80`. The 2026-08-04 fix (directly above and further up) made every month self-heal on every view, which is correct for a stale *wrong* value (Tiffany's case, same day) — but for June here, the stored value was the *correct* one and the fresh sales_log recompute is what's incomplete; self-healing overwrote $6,458.02 with the recompute-derived $3,142.19 the next time June was viewed, and that wrong figure compounded down to -$2,440.03 by September.

These two scenarios — "stored value is stale/wrong, recompute is right" and "stored value is right, recompute is structurally incomplete" — produce the *identical* signal (`recalculated: true`, i.e. `amount_paid` recorded doesn't match today's freshly computed expected payout) and are not distinguishable by the numbers alone; telling them apart requires knowing which one actually happened, which only the account owner can say. No blanket formula change can satisfy both without breaking the other (verified: naively trusting the recorded `amount_paid` as the reconciliation anchor for every "recalculated" month fixes Susan's June but reintroduces the wrong number for Tiffany's July, whose recorded `amount_paid` was itself based on the now-fixed double-premium bug).

Fix: added `commission_bank.manual_override boolean default false` (`Old SQLs/commission-bank-manual-override-migration.sql`). When true for a given agent/month row, both the PATCH handler's `commission_payments`-adjacent bank upsert (covers `_autoSaveCarryForwards`'s passive snapshot AND a real Mark Paid reconciliation — same code path, gated once) and the GET handler's displayed `outstanding_receivable`/`bank_summary.settled_balance_after` for that exact month skip the fresh recompute and use the stored `bank_balance_after` as-is — so the human correction sticks both in what carries forward *and* in what's displayed on that month's own tab (without the display half of this fix, a locked June would still show "$3,142.19 owed" even though the correct $6,458.02 was what actually flowed to July, an inconsistency that would read as a new bug on its own). The lock-check runs in its own try/catch, separate from the upsert's — on an account whose `commission_bank` table predates this column, the check fails closed to "unlocked" rather than the whole bank-write block silently going dark for every agent on that account.

Susan's June corrected to `bank_balance_after: 6458.02` and locked, with an audit note. July/August/September were left unlocked and re-triggered through their normal self-heal path (verified via direct PATCH calls mirroring exactly what `_autoSaveCarryForwards` sends) to confirm the corrected chain: July `$2,495.92` → August `$875.80` → September `$875.80` — all reproduced the account owner's independently-remembered $875 exactly. Also ran a full regression check across every other agent/month before deploying to confirm the lock-check addition didn't alter anyone else's numbers.

**Takeaway**: when a stored value and a fresh recompute disagree and both "self-heal always" and "trust the human record always" have real, opposite failure modes, don't pick one globally — add an explicit, targeted override a human sets deliberately, exactly like the `bankOnly` flag from the wipe-regression fix above. Don't try to infer which case you're in from the shape of the data.

Side effect, intentional: an agent who simply hasn't been marked paid yet for the *current* month (payroll hasn't run yet, nothing wrong) will now also show the "$X owed" badge instead of a plain "Unpaid" one, since both read from the same reconciled figure — this is more accurate, not a regression; "owed" is a strict superset of "unpaid, and here's how much." Verified locally against production data via `vercel dev` across June and July for every agent before deploying — no negative/unsane values, and one apparent oddity (Fiona Rodriguez showing $10 owed for July despite $0 July earnings) checked out exactly: $5 carried forward from a still-unpaid June shortfall plus a new, also-unpaid $5 July bonus.

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

### Annual Raise-Eligibility Tracker (added 2026-09-02)

Flags an existing **annual** `agent_goals` row as counting toward an end-of-year raise, with configurable combination mode, reward calculation, an individual-performance gate, and an agent-facing annualize/pace-color toggle. Designed via an HTML mockup (never committed as code) iterated with the owner over several rounds before implementation — no separate raise-goal type, just a flag + config bundle layered on the existing Goals system.

**Migration** (`Old SQLs/raise-goals-migration.sql`, already run):
```sql
ALTER TABLE agent_goals ADD COLUMN IF NOT EXISTS is_raise_goal boolean NOT NULL DEFAULT false;
ALTER TABLE agent_goals ADD COLUMN IF NOT EXISTS raise_config  jsonb   NOT NULL DEFAULT '{}'::jsonb;
```
`raise_config` shape: `{ combination_mode, agency_location_id, agency_metric, blend_individual_weight, reward_mode, proportional: { target_pct, max_pct, stretch_mode, stretch_breakpoint_pct }, threshold_tiers: [{pct, raise}], gate_enabled, gate_floor_pct }`. Only meaningful when `period_type === 'annual'` — enforced in `api/agent-goals.js` (400 on POST/PATCH otherwise), not a DB constraint, matching this table's existing style.

**Combination mode** (`individual` | `blended` | `separate`) — `individual` tracks only the agent's own progress; `blended` weights the agent's individual % against an Agency Location's annual goal % (owner sets the split, e.g. 70/30); `separate` shows both side by side with **no combined number at all** (the API omits `earned_pct`/`projected_pct` entirely for this mode — not `null`, the keys are absent — so whoever makes the actual raise call weighs both manually). The gate always keys off the agent's own individual % regardless of mode, since its whole purpose is stopping a strong agency number from papering over personal underperformance.

**No agent-to-location link exists anywhere in the schema** — confirmed via full search of `agent_roster`/roster/sales/checklist code before building this. Which `sales_locations` row supplies "the agency side" is therefore an explicit per-goal picker (`agency_location_id`), not inferred. There was also **no existing actual-vs-annual-agency-goal computation anywhere** — `_renderAgencyGoalsSection()` (`js/goals.js`) is pure static display of the goal numbers themselves, and `_renderSlScorecard()`'s progress math (`js/sales-log.js`) only ever covers the *monthly* `goal_count`/`goal_premium` fields, never `_annual`. `attachRaiseStatus()` in `api/agent-goals.js` builds this fresh: one year-scoped, `sale_weight`-summed `sales_log` query per unique referenced location (deduped across goals/agents sharing one), matching the corrected weighted pattern — explicitly not `_renderSlScorecard`'s inconsistent unweighted `entries.length` "all locations" branch.

**Reward calculation** (`proportional` | `threshold`, `api/_lib/raise-calc.js`):
- `proportional` (default) — `target_pct` earned in full at 100% of goal (linear from 0%), then the *same per-point rate* keeps earning into a stretch zone for exceeding goal, capped at `max_pct`. The stretch zone's width is either derived automatically from the target/max ratio (`100 + (max-target)/rate`), or an explicit custom breakpoint — **a custom breakpoint genuinely changes the stretch-zone rate**, not just where the bar visually caps (verified: target=3/max=4, 120% progress → 3.6% auto-breakpoint(133.33) vs 3.4% custom-breakpoint(150), both hand-checked against the live API before considering this correct).
- `threshold` — an ordered `{pct, raise}` tier list, pays the **highest** tier whose `pct <= progress` (a step function — 79%/80%/99%/100%/105% against tiers `[80→3, 100→4]` returns `0/3/3/4/4`, NOT additive/cumulative like `bonus_activity_types.threshold_tiers`' milestone+repeat semantics above — same validated-array *shape* precedent, deliberately different evaluation logic since this is "% of goal breakpoints," not "raw occurrence count milestones").

**Annualize toggle (agent's own view only)** — converts YTD progress into a projected pace: `monthsElapsed` (fractional, by calendar days within the annual period) `= progress% / monthsElapsed × 12`, reusing the exact `Intl.DateTimeFormat('en-CA', {timeZone})` "today in account timezone" technique already used by `currentPeriodDates()` in this same file (the one that had the UTC-rollover bug fixed 2026-09-01 — built on the same helper deliberately, not a second reimplementation). The projected number then runs through the same reward math as the real one, producing a `projected_pct` alongside the actual `earned_pct`.

**Two independent color-threshold schemes**, not one reused twice — "how much have you done" and "are you on pace" are different questions with different honest answers, and can legitimately disagree (e.g. 79% YTD progress through 8 months reads yellow, but the same data point projects to 117% annualized, which reads green):
- YTD (raw magnitude): red `<50%`, yellow `50–79%`, green `≥80%`.
- Annualized (projected pace): red `<80%`, yellow `80–99%`, green `≥100%`.

**Visibility carve-out fix** — `renderRaceGoalsRow()`'s `canSee()` (`js/goals.js`) never special-cased "is this my own row": the server already scopes a non-writer member's `GET` to their own `agent_id` only regardless of `is_public` (`api/agent-goals.js`), so a bosun's own private goal was always correctly *fetched*, but this client-side check still hid it from their own Race-tab quick-view since `canPrivate` requires an elevated role. Added `isOwnRow` as a third `canSee` condition. This was a pre-existing gap surfaced while building the raise module's own visibility (which was written gate-free from the start), not something introduced by this feature.

**Two new `HELP_GUIDES` entries** (`js/help.js`): `raise-eligibility-member` (`visibility: ['all']`) and `raise-eligibility-owner` (`visibility: ['owner']`), text-only steps (no screenshots yet — the feature was verified via direct API calls, not a full browser walkthrough, since the Chrome extension was disconnected for this session's testing pass).

**Verification performed**: every worked example above was checked against the live API (`vercel dev`) with seeded `sales_log`/`sales_locations` test data, not just unit-level — including the exact gate example (40% individual / 95% agency → 56.5% blended, gated to $0 because individual is below the 50% floor) and confirming `separate` mode returns no `earned_pct`/`projected_pct` keys at all. Confirmed a pre-existing non-raise goal still returns unchanged (no `raise_status` key, `actuals` intact) — no regression. **Not verified**: live UI rendering (form re-population, help guide display, the interactive annualize checkbox, a real member-login visibility check) — the browser automation tool was unavailable for this session; these are still correct by code review but haven't been visually confirmed.

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
7. **Also deletes all `call_log` rows for the account** (`js/account.js`, immediately after the `historical_wins`/`historical_months` writes) — not previously documented here even though it's been true all along; found while investigating why the Call Performance tab's "Yearly" view only ever showed the current unarchived stretch (see "Yearly Call Performance archive merge" below). Only a scored per-agent-per-month snapshot survives into `historical_wins` — no per-call, per-day, or `call_slot` detail is retained anywhere past this point.
8. Clears `race_config.current_month`
9. Deletes-before-insert on `historical_wins` to prevent duplicate rows (no unique constraint)

Month format written by `confirmArchive`: `"Apr 2026"` (abbreviated, `_ABBR[month]` array).

### Yearly Call Performance archive merge (fixed 2026-09-01)

Reported as "Performance call tab shows an option for yearly, but the data is not there because of the archive and reset." Confirmed exactly right: `api/perf.js` built its `yearly` bucket purely from `call_log`, which `confirmArchive` (above) deletes entirely on every archive — so "Yearly" silently showed only whatever had accumulated since the last archive point, not the calendar year. Verified against real production data mid-fix, in an unplanned but perfect natural test: the account's own August archive fired *while this was being investigated*, moving `call_log` from ~16,700 August-only rows to zero and folding August into `historical_wins` — before-and-after querying both states confirmed the merge below reproduces the exact combined total either way.

`historical_wins` retains enough per-agent-per-month detail (`placed, answered, missed, voicemail, talk_min, avg_min`) to reconstruct every Yearly metric **except Max Min** (single longest call) — that column was never archived anywhere at any granularity and structurally cannot be recovered for a past month. Fix, in `api/perf.js`: after building `yearly` from live `call_log` as before, fetch every `historical_wins` row for the account, group by year (parsed from the trailing token of `month`, robust to both the abbreviated `"Apr 2026"` `confirmArchive` writes and the full `"January 2026"` the out-of-order-upload path writes), and merge each row's stats directly into the same `yearly[year][agent_id]` accumulator `mapToRows()` already reads — so no changes were needed to the row-building or JSON response shape itself, only to what feeds it. `voicemail`/`missed` merge into the same `__race` bucket the live path already populates.

**Avg Min** is weighted, not naively averaged: an archived month has no surviving raw call count, so `talk_min / avg_min` (when `avg_min > 0`) backs out an *implied* call count, added to that agent's yearly `talkCalls` alongside the live month's real count — an archived month with hundreds of calls correctly outweighs a partial live month with a handful, rather than the two months' averages being blended 50/50 regardless of volume.

**Max Min** is explicitly suppressed (`null`, not `0` or a silently-partial number) for any yearly agent-row that includes at least one archived month — tracked via a `hasArchived` Set keyed `${year}|${agent_id}`, passed into `mapToRows()`'s existing max-min line only for the `yearly` call (`daily`/`weekly`/`monthly` are untouched, since those periods don't span an archive boundary the same way). `js/perf.js`'s renderer shows "—" when `r[9] == null`, distinct from a real `0`. This was an explicit account-owner choice between two options (merge-with-Max-Min-caveat vs. drop the Yearly option entirely) — chosen over simply removing Yearly, since every other metric IS fully reconstructable.

**Takeaway**: `js/account.js`'s `confirmArchive()` deleting `call_log` in full was true well before this fix and is a hard constraint on any future "make X work across an archive boundary" request for call data — anything not captured in `historical_wins`/`historical_months` at archive time (per-call detail, per-day granularity, the voicemail heatmap, Max Min) is gone permanently, not just hard to query. Check what the archive actually retains before assuming a "just query further back" fix is possible.

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

**Cross-agent data leak for unlinked bosun/custom members — scoping was gated on link presence, not role (fixed 2026-08-05).** Reported as "added a bosun and they can see all agents' commissions and goals, that should not happen." Root cause, found in `api/commissions.js` (`if (memberAgentId) { results = results.filter(...) }`) and `api/agent-goals.js` (`if (isMember && !canWrite && memberAgentId) { q = q.eq(...) }`): both scoped a non-captain/CO member to their own agent only when `roster_agent_id` happened to be set on their `account_members` row — with no check of `memberRole`/`canWrite` gating the filter's presence at all. A bosun or custom member who hasn't yet been linked to a roster agent (very much the normal state right after `/api/invite.js` creates them, before an owner does that separate linking step in Account → Members) fell through the `if` entirely and got the complete, unfiltered dataset — every agent's commissions, every agent's goals. The client has no independent check of its own; `renderCommissions()` (`js/sales.js`) just maps over whatever `results` array the server returns for a member. Confirmed live against the real account that surfaced this (`colby.gillen@gmail.com`, bosun role, `roster_agent_id: null`, added to the sandbox account) — before the fix, both endpoints returned all 12 agents' full financial data to that unlinked bosun.

`api/bonus-activities.js` had the identical pattern (`if (ctx.isMember && !ctx.canApprove && ctx.memberAgentId)`) and got the same fix. `api/sales.js` was already correct — it fails closed with an explicit `if (ctx.isMember && !ctx.isCapOrCO && !ctx.memberAgentId) return { entries: [] }` guard before any per-row filtering, which is the pattern the other three now follow: gate on **role** (`isCapOrCO`/`canApprove`/`canWrite`), and when a non-privileged member has no roster link, match a sentinel agent_id that can never exist (`memberAgentId || '__unlinked_member__'`) rather than skipping the filter — fail closed, not open. Verified locally via `vercel dev` against real production data with three real member sessions: the unlinked bosun now gets `results: []` / `[]` from all three endpoints; a properly-linked bosun (Braden Rickey) still correctly sees only his own row; the owner still sees all 12 agents — no regression.

**Takeaway**: the same "explicit flag, don't infer intent" lesson from the `commission_payments`/`bankOnly` incident applies here in the opposite direction — a security-scoping `if` must be gated on the property that actually determines the right to see the data (role), never on an unrelated field (a roster link) that merely *usually* happens to correlate with it. If a new member-scoped endpoint is added, check it against `api/sales.js`'s pattern (explicit fail-closed check gated on role) before assuming "if (memberAgentId)" is sufficient.

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

**Unscoped query when `current_month` is blank (fixed 2026-09-02).** `confirmArchive()` (`js/account.js`) blanks `race_config.current_month` to `''` the instant a month is archived, and it stays that way until the owner clicks Set Month for the new one. `rebuildRaceData` (`api/_lib/race-data.js`, shared by `api/sales.js` and `api/checklist-form.js`) parses `current_month` into `fromDate`/`toDate` but only conditionally applied them (`if (fromDate) q = q.gte(...)`) — when the month couldn't be parsed, both stayed `null` and the `sales_log` query ran with **no date filter at all**, summing every sale that agent has ever entered (not "this month," not even "this year") into their `race_data` row. Every *other* agent untouched during that gap stayed correctly at zero from the archive's `race_data` delete — so the bug only ever struck whichever agent happened to get a sale mutation (checklist submission, manual entry, edit) during the window between an archive and the next Set Month click, which is exactly why it presented as "a few agents show wildly inflated numbers while the rest of the roster looks normal." Reported as "Sales by Agent tile and podium totals appear annual for a few agents." Fixed by skipping the `sales_log` aggregation entirely (leaving `totals` at the already-initialized zero) whenever `fromDate`/`toDate` can't both be resolved, rather than ever letting the query run unscoped. The equivalent client-side gap in `loadRaceData()`'s voicemail/missed/deposit-and-other query (`js/race.js`) got the same guard for consistency, though that path only affects race-wide deductions and the Deposit/Other pills, not policy counts.

**Goals sub-pill silently swapped period types per viewer (fixed 2026-09-02).** `renderRaceGoalsRow(ag)` (`js/goals.js`) shows a small "Goals" progress pill under each agent's name on the Race tab, with a fallback chain: exact-month match → recurring monthly → current-calendar-month → any active non-monthly goal (quarterly/semi-annual/annual) as a last resort. That fallback chain's `.find()` predicates all bundled the viewer's own visibility (`canSee`/`canPrivate`, gated by role and `is_public`) into the *selection* itself, not just the display — so for an agent with both a private monthly goal and a public annual one, an owner (who can see the private monthly goal) would select and show that, while a bosun (who can't) would fall straight through to the public annual goal instead: the same agent, same pill, showing a completely different time scope depending on who's looking. Reported as "my view shows this month, while most bosuns show the annual for a few agents" (surfaced for `braden_rickey` once real annual goals — the raise-eligibility ones, see above — started existing for some agents; rare before that since annual goals were uncommon). Fixed by separating the two concerns: goal *selection* now uses `belongsToAgent` (existence only, ignores visibility) so every viewer resolves to the identical goal, and `canSee` is applied once afterward purely to decide whether real numbers render or a locked `🔒` placeholder does — a viewer who can't see the selected goal now sees "can't see this," never a different, unrelated goal's numbers.

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

**Every chart label rendered as an empty box — no title, axis numbers, category labels, or values, just the bars/gridlines/dots (fixed 2026-08-06, two false starts before the real fix).** Reported as "the daily report charts don't have labels on the axis — only boxes." Confirmed by fetching a real signed chart URL directly and inspecting the PNG: bars/gridlines rendered correctly, every `<text>` element was a blank tofu (missing-glyph) box.

*Attempt 1* diagnosed the immediate cause correctly — Vercel's serverless Node runtime has no system fonts installed at all, so `renderChartSvg`'s `font-family="Helvetica,Arial,sans-serif"` matched nothing and `sharp`'s SVG renderer (librsvg) drew each character as a missing-glyph placeholder — but picked the wrong fix. It embedded `BebasNeue.ttf` into the SVG as a base64 `@font-face` data URI, modeled on `api/og.js`'s comment claiming that exact technique was "already proven working on Vercel." Verified locally via `vercel dev` and looked completely fixed. **It wasn't** — `vercel dev` serves straight off the working directory with real fonts resolvable on the dev machine (macOS), so what actually rendered locally was the CSS fallback chain's `'Helvetica'` — a real font on a Mac — silently standing in for the still-nonfunctional BebasNeue embed. Production, with no fallback font available at all, still showed empty boxes after deploy.

*Attempt 2* misdiagnosed the local/production gap as a `vercel.json` bundling problem: this project's legacy `builds`/`routes` array requires every deployed file to be an explicit whitelist entry, and `BebasNeue.ttf` had never been added (unlike `og.svg`, which has its own `@vercel/static` entry). Added one for the font and shipped again. Still broken — because the real problem was one level deeper: `sharp`'s SVG renderer (librsvg, via fontconfig) **does not reliably support fonts embedded as base64 data URIs at all**, deployed or not — confirmed by testing `api/og.js` directly in production, which showed the identical blank-box text despite its "already proven working" embedded-font approach. That comment was never actually true; nobody had scrutinized an OG preview image closely enough to notice its text was invisible too.

**The actual fix**: switched the renderer from `sharp` to `@resvg/resvg-js` (`api/_lib/chart-render.js`) — a Rust SVG renderer (via napi-rs, same category of prebuilt-native-binary dependency `sharp` already is) that accepts an explicit font **file path** (`font: { fontFiles: [...], loadSystemFonts: false }`) and renders it directly, with no dependency on system fontconfig or data-URI embedding at all. `BebasNeue.ttf` is loaded from `path.join(process.cwd(), 'BebasNeue.ttf')`, made deployable via `"config": { "includeFiles": "BebasNeue.ttf" }` on the `api/chart.js` build entry in `vercel.json` (this part of attempt 2's theory was directionally right, just solving the wrong renderer's problem). `renderChartPng` now throws loudly (`Error` → surfaces as an HTTP 500 on the chart `<img>`, an obviously-broken image) if the font file isn't found at render time, rather than silently degrading to blank labels the way all three prior states did — this exact failure mode shipped invisible in production twice in one day specifically because nothing ever errored.

**Takeaways**: (1) A prior comment claiming a technique is "already proven working" is a claim to verify, not a fact to inherit — the whole reason this took three attempts is that `og.js`'s "proven" pipeline was never actually checked closely and had the identical bug the whole time. (2) `vercel dev` matching production is not guaranteed for anything that depends on the host environment (fonts, system libraries, bundled files) — for this class of bug, only a real deployed URL, fetched fresh (past any CDN cache) and visually inspected, counts as verification. (3) A rendering fallback that degrades silently (missing font → blank box, not an error) turns every future regression of this kind invisible again; prefer throwing/logging loudly over "at least it didn't crash" for anything a human is expected to actually look at.

**Fourth surprise: even after the real fix deployed and was verified live, a freshly re-sent test report still showed the old broken charts (fixed 2026-08-07).** Chart image URLs (`chartImgTag()`, `api/email-report.js`) are a pure deterministic function of `(account, agent, dataset, chart type, report date)` — the exact same tuple always produces the exact same URL — and `api/chart.js` sets `Cache-Control: public, max-age=86400` on the response. That combination means any client anywhere along the delivery path that fetched a given tuple's URL even once **before** the resvg-js fix shipped — this session's own repeated `curl` verification requests during the two failed attempts earlier the same day, but far more consequentially, **Gmail's server-side image proxy**, which caches inbound email images by URL independent of any recipient action and does not clear on a page/inbox refresh — will keep serving those cached broken bytes for up to 24h, regardless of how correct the server-side code now is. A "hard refresh" (mentioned as already tried) only affects the local browser tab; it has no effect on a mail provider's own image cache.

Fixed by appending an unsigned, cosmetic `v=<8-char commit sha>` (`CHART_RENDER_VERSION`, from Vercel's auto-injected `VERCEL_GIT_COMMIT_SHA`) to every chart URL — `api/chart.js` never reads it, its only job is to change the URL (and therefore the cache key everywhere) exactly when the deployed code changes, while staying stable for repeat opens of the same already-sent report between deploys. This is the same unsigned-cosmetic-param pattern already established for `color`/`opacity`/`outline`. Does not retroactively fix any already-sent/already-cached email — only prevents this exact failure from recurring on the *next* chart-rendering change. The account owner's stuck test send was separately unblocked by resetting `accounts.last_report_date` (see "Self-service immediate send" above — the `last_report_date` dedup is a deliberate app-level guard, not a Resend platform limit; there is no such thing on Resend's side) so a fresh send — carrying the new versioned URL — could go out immediately.

**Takeaway, extending the three above**: a fix isn't confirmed by "the endpoint returns the right thing now" alone when the response is cacheable and was ever fetched under the broken version — check what's downstream of the cache header, not just the code path, especially for anything embedded in an email (recipients' mail providers cache images server-side, invisibly, and outside any control this app has).

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
