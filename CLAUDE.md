# Boat Race Dashboard — Project Context

## What This Is
An internal sales competition dashboard. Agents earn points for policies sold and call activity. All data enters via file upload on the Admin tab. The backend is fully Supabase (Postgres + Auth) — Google Apps Script and Google Sheets are no longer used.

## Architecture

```
Browser (index.html, served by Vercel)
  ↓ Supabase JS client (anon key, via /api/config)
    → race_data table (read on load, team writes)
    → scoring_config table (read/write from Admin tab)
  ↓ POST /api/upload
Vercel Node function (api/upload.js)
  → SheetJS parses XLSX/XLS in-process
  → SHA-256 dedup against call_log / sales_log
  → writes call_log, sales_log, race_data, historical_wins (service key)
  ↓ GET /api/history
Vercel Node function (api/history.js)
  → queries historical_wins directly (service key)
  ↓ GET /api/perf
Vercel Node function (api/perf.js)
  → aggregates call_log into daily/weekly/monthly/yearly + heatmap (service key)
  ↓ GET /api/config
Vercel Node function (api/config.js)
  → serves SUPABASE_URL + SUPABASE_ANON_KEY to browser
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — auth, scoring, rendering, upload UI, admin tab |
| `api/upload.js` | Upload processor — XLSX parsing, dedup, Supabase writes |
| `api/history.js` | Queries `historical_wins` table, returns 2-D array for History tab |
| `api/perf.js` | Aggregates `call_log` into perf views + heatmap for Admin tab |
| `api/config.js` | Serves public Supabase keys to the browser |
| `vercel.json` | Builds + routes for all API files and index.html |
| `package.json` | Dependencies: `@supabase/supabase-js`, `xlsx` |

## Vercel Environment Variables

| Variable | Used by | Purpose |
|----------|---------|---------|
| `SUPABASE_URL` | all API routes + `/api/config` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `/api/config` → browser | Public key for client-side auth + reads |
| `SUPABASE_SERVICE_KEY` | upload, history, perf | Service role key for trusted server writes |

## Supabase Tables

| Table | Purpose |
|-------|---------|
| `race_data` | One row per agent — live race totals, team, call stats |
| `call_log` | Every classified call — hash, agent_id, disposition, talk_secs, call_dt, call_slot |
| `sales_log` | Every classified sale — hash, agent_id, category, sale_date |
| `historical_wins` | Archived end-of-month results — one row per agent per month |
| `race_config` | Key-value store — `current_month` tracks active race month |
| `scoring_config` | Point values per category — editable from Admin tab |

### race_data columns
`agent_id, name, team, wl, ul, term, health, auto, fire, placed, answered, missed, voicemail, talk_min, avg_min, race_wide_missed, race_wide_voicemail, last_updated`

### call_log columns
`hash (PK), agent_id, disposition, talk_secs, call_dt (DATE), call_slot (SMALLINT 0–47)`
- `call_slot` = half-hour slot index for voicemail heatmap (0 = 12:00–12:30 AM)

### scoring_config columns
`config_key (PK), config_value`
Keys: `wl, ul, term, health, auto, fire, placed_sales, placed_service, answered_sales, answered_service, talk_per_min, avg_min, missed_deduct, voicemail_deduct`

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
**Deductions are race-wide** — applied equally to all agents.
**Default values** (loaded from `scoring_config`, fallback if table empty):
WL=100, UL=75, Term=50, Health=30, Auto=15, Fire=10 | Placed sales=1, service=0.25 | Answered sales=1, service=5 | Talk/min=0.1, AvgMin=2 | Missed=-3, VM=-2

## Agents
| ID | Name | Team |
|----|------|------|
| ashley | Ashley McEniry | service |
| fiona | Fiona Rodriguez | service |
| jocelyn | Jocelyn Hernandez | service |
| joseph | Joseph Underwood | sales |
| peyton | Peyton Tooze | sales |
| susan | Susan Navarro | sales |
| tiffany | Tiffany Dabe | sales |
| tracy | Tracy Ankrah | service |
| amin | Amin Kalas | sales |
| andy | Andy Rose | service |
| russel | Russel Williams | service |

Team is stored in `race_data.team` (source of truth). Admin tab Team Assignment writes directly to Supabase.

## Call Classification (`classifyCalls` in api/upload.js)
- **INBOUND VM, external** → `voicemail` → race-wide voicemail count
- **OUTBOUND VM, external** → `placed` → counts as placed call for agent
- **VM with Internal / Voice Mail Access** → `internal` → skipped
- **Abandon** → `missed` → race-wide missed count
- **Internal** → `internal` → skipped
- **OUTBOUND non-VM** → `placed` for agent
- **INBOUND Handled** → `answered` for agent

### Dedup Logic
- **Answered/Placed:** SHA-256 of `[dt, ext, dir, dur, disp]`
- **Voicemail/Missed:** SHA-256 of `[dt, dir, dur, disp]` — no ext, prevents hunt-group N-counting

### Month Upload Logic
- **Future month:** rejected
- **New month:** archives current race → `historical_wins`, resets logs, starts new month
- **Same month:** dedup + append
- **Old month:** archives call stats for that month; current race untouched

## Frontend Auth Flow
1. `initSupabase()` — fetches `/api/config`, creates Supabase client
2. `getSession()` — if session exists → `showDashboard()`, else → `showLogin()`
3. `onAuthStateChange` — keeps login/dashboard in sync
4. `showDashboard()` — calls `loadScoring()` + `fetchRaceData()` + starts refresh timer
5. Users managed in **Supabase → Authentication → Users**
6. Email confirmation must be **disabled** (Supabase → Auth → Providers → Email → Confirm email OFF)

## Common Tasks

### Add a new user
Supabase → Authentication → Users → Add user → Create new user (email + password)

### Redeploy after code changes
```bash
git add <files>
git commit -m "message"
git push   # Vercel auto-deploys from main
```

### Reset the race manually
In Supabase SQL Editor:
```sql
UPDATE race_data SET wl=0,ul=0,term=0,health=0,auto=0,fire=0,
  placed=0,answered=0,missed=0,voicemail=0,talk_min=0,avg_min=0,
  race_wide_missed=0,race_wide_voicemail=0;
DELETE FROM call_log;
DELETE FROM sales_log;
UPDATE race_config SET value='' WHERE key='current_month';
```

### Re-populate heatmap after adding call_slot column
Re-upload the current month's call report from the Admin tab — dedup will skip all existing rows (no race data change) but the new `call_slot` column will be populated for voicemail calls.

### Update scoring values
Admin tab → Scoring Configuration panel → edit values → Save Scoring.
Changes take effect immediately and persist in `scoring_config` table.
