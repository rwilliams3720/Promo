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

### historical_months columns
`user_id, month (text, "Apr 2026" format), placed, answered, missed, voicemail, talk_min, policies, created_at`

Written by `archiveCallStatsToHistorical` (upload.js) and `confirmArchive` (frontend). Read by `ai-analysis.js` for trend chart and r90 calculation. Deleted on account delete, data delete, and admin sandbox reset.

### sales_log columns (extended)
Base (from upload): `user_id, hash, agent_id, product, sale_date, written_premium`
Added by `directive2-migration.sql`: `source ('upload'|'manual'|'checklist'), customer_name, subcategory, lead_source, period (smallint), auto_issued (boolean), split_sale (boolean), teammate, checklist_id (uuid FK → checklist_submissions)`
Added manually: `issued_date (date)` — run `ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS issued_date date;`
Added for chargebacks: `is_cancelled (boolean default false)`, `chargeback_date (date)` — when `is_cancelled=true` and `chargeback_date` falls in the commission month, a negative line item is deducted from the agent's commissions.
Added by `split-sale-migration.sql`: `sale_weight (numeric NOT NULL DEFAULT 1)` — split sales create two rows each with `sale_weight=0.5`; `api/commissions.js` multiplies policy rates by this weight so split sales count as half a policy each.

`other` and `deposit` products do NOT increment policy counts in race_data (excluded in `rebuildRaceData`).

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

**`agent_id` is AES-256-GCM encrypted** with a random IV — the same value produces a different ciphertext on every write. Always use `decryptField(r.agent_id)` when reading agent_id back from call_log (implemented in both `upload.js` and `sales.js`). Never compare raw ciphertext to plain agent IDs.

### scoring_config columns
`user_id, config_key, config_value`
Keys: `wl, ul, term, health, auto, fire, placed_sales, placed_service, answered_sales, answered_service, talk_per_min, avg_min, missed_deduct, voicemail_deduct`

## Account Tab Structure

The Account tab uses 5 sub-tabs controlled by `showAccountSubTab(name, btn)`. Sub-tab nav (`#acct-subtab-nav`) is hidden for members (they get a simplified view via `loadMemberAccountTab`).

| Sub-tab | Pane ID | Contents |
|---------|---------|----------|
| Profile | `#acct-pane-profile` | Account Info, Contact Info, Change Password |
| Billing | `#acct-pane-billing` | Plan & Billing, Sales Add-On card, Team Member Analysis card, Commissions Add-On card |
| Sales | `#acct-pane-sales` | Agent Roster, Checklist Link, Data Entry Mode, Email Template, Form Types, Product Subcategories, Lead Sources, Locations, Commissions structures, Bonus types, Access settings — locked (`#sales-pane-locked`) without add-on |
| Team | `#acct-pane-team` | Agency Management (invite/manage members) |
| Settings | `#acct-pane-settings` | Report Delivery (pro/premium only), Sales Column Mapping |

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

### Agent Roster
`agent_roster` is the canonical source for manual entry agent dropdowns. `agent_id` in roster must match `agent_id` in `race_data` for manual sales to roll up correctly. `refreshAgentDropdowns()` is called automatically after every add, edit, or delete operation to keep all live dropdowns in sync without a page reload.

**Active filter on race tab**: `renderRace(data)` filters `race_data` to only agents where `agent_roster.active !== false`. Agents marked inactive are excluded from the leaderboard and scoring grid. `buildTeamToggleUI()` applies the same filter. `_agentRoster` is the source of truth — if roster is empty (no sales add-on), all agents show.

**Name resolution on race tab**: `renderRace` resolves display names from `_agentRoster.find(a => a.agent_id === ag.agent_id)?.name` — not from `race_data.name`. This ensures renames show immediately without requiring a new data upload. `api/agent-roster.js` PATCH also syncs `race_data.name` on rename for consistency.

**Team assignment persistence**: `setAgentTeam()` writes to both `race_data.team` (live race) and `agent_roster.team` (permanent) in parallel. `race_data` rows are deleted on archive; `agent_roster.team` persists across months so captains never need to re-assign teams. `_agentRoster` cache is updated in-place immediately after save.

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

Not a route (absent from `vercel.json` `builds`/`routes` — plain importable module). Exports `applyRate()` (rate lookup, moved here from `api/commissions.js`) and `chargebackCommission(structList, product, subcategory, share, premium, isFS, override)` — used by both `api/commissions.js` (its own chargeback line items) and `api/sales.js` (`chargebackMode` on the Chargeback Report) so the two reports always agree on dollar amounts. `chargebackCommission` honors `commission_product_overrides`: a specific structure ID restricts the deduction to that structure only; `'both'` or unset sums every assigned structure with a non-zero rate (mirroring earned's default). Also exports `buildStructureListLookup(roster, structureById, junctionRows)` for building a `getStructureList(agentId)` lookup outside `api/commissions.js`.

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

## Activity Bonuses

Managed in Account → Sales → Bonus sub-tab. Requires commissions add-on.

### bonus_activity_types
Each type has a `payment` field ($/occurrence). Types with `source='call_log'` auto-aggregate from `call_log` using the `call_disposition` filter — no manual entry needed. Types with `source='manual'` require explicit entries.

`renderBonusActivityTypes()` shows a `· $X.XX` payment badge when `t.payment > 0`.

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
