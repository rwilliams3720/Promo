# Boat Race Dashboard — Project Context

## What This Is
An internal sales competition dashboard. Agents earn points for policies sold and call activity. All data enters via file upload on the Manage tab (no email monitoring). Data flows through Vercel serverless functions into Google Apps Script, which writes to Google Sheets. The frontend reads the sheet directly via GViz JSON API.

## Architecture

```
Browser (index.html, served by Vercel)
  ↓ fetch /api/sheet?sid=<id>
Vercel proxy (api/sheet.js) → Google Sheets GViz JSON API (read-only, public)
  ↓ fetch /api/upload (POST)
Vercel proxy (api/upload.js) → GAS Web App (doPost) → Google Sheet (read/write)
  ↓ fetch /api/history?action=<action> (GET)
Vercel proxy (api/history.js) → GAS Web App (doGet) → HistoricalWins / config
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — scoring, rendering, upload UI, Manage tab |
| `api/upload.js` | Vercel proxy — streams raw body to GAS, follows redirect |
| `api/sheet.js` | Vercel proxy — fetches GViz JSON; accepts `?sid=` for custom sheet ID |
| `api/history.js` | Vercel proxy — passes `?action=` through to GAS doGet |
| `UploadHandler.gs` | GAS entry point (doPost/doGet) — month detection, archive, reset, Sheet ID config |
| `EmailParser.gs.txt` | GAS — XLSX parsing, call classification, dedup, RaceData writes |
| `SalesParser.gs.txt` | GAS — sales classification, dedup, policy totals |
| `CallReportProcessor.gs.txt` | GAS — call aggregation, Performance Tracking sheet, Voicemail Heatmap |
| `vercel.json` | Builds + routes for all API files and index.html |

> The `.gs.txt` files are the source of truth for GAS scripts. Copy their contents into the corresponding files in the Apps Script editor when deploying.

## Google Sheet
- **Default Race Sheet ID:** `1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA`
- **Default Perf Sheet ID:** `1-3t8XAu-59NLOaLiWPxwYtkJfa7rs7JpGLMl52FPHiE`
- **GViz gid:** `471942583` (RaceData tab)
- **Race sheet tabs:** RaceData, CallLog, SalesLog, HistoricalWins, RaceConfig

Sheet IDs are stored in **Script Properties** (not hardcoded). The Manage tab "Sheet ID Configuration" section updates them. Falls back to the default IDs above if not set.

### RaceData columns (A–R)
A=AgentID, B=Name, C=Team, D=WL, E=UL, F=Term, G=Health, H=Auto, I=Fire,
J=Placed, K=Answered, L=Missed, M=Voicemail, N=TalkMin, O=AvgMin,
P=RaceWideMissed, Q=RaceWideVoicemail, R=LastUpdated

## Scoring Formula (frontend `calcScore`)
```javascript
polPts      = wl*100 + ul*75 + term*50 + health*30 + auto*15 + fire*10
placedPts   = placed   * (service ? 0.25 : 1)
answeredPts = answered * (service ? 5    : 1)
talkPts     = talkMin*0.1 + avgMin*2
gross       = round(polPts + placedPts + answeredPts + talkPts)
deduct      = round(raceWideMissed*(-3) + raceWideVoicemail*(-2))  // applied equally to all agents
total       = max(0, gross + deduct)
```
**Deductions are race-wide only** — individual per-agent missed/voicemail columns (L, M) are not used in scoring.

## Agents
| ID | Name | Default Team |
|----|------|-------------|
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

**Team is source of truth from the sheet** (overrides hardcoded defaults on load).

## GAS Scripts (in Apps Script project)
Four script files share the same global namespace:
- **UploadHandler.gs** — web app entry point, month management, archive/reset, Sheet ID management
- **EmailParser.gs** — XLSX parsing (`parseXlsxBytes`), call classification (`classifyCalls`), aggregation, RaceData writes
- **SalesParser.gs** — sales classification (`classifySales`), aggregation, policy totals
- **CallReportProcessor.gs** — call aggregation (`aggregateCallData`), Performance Tracking sheet, Voicemail Heatmap

### GAS Web App
- Execute as: Me
- Who has access: Anyone
- URL stored in Vercel env var: `GAS_UPLOAD_URL`
- **After any GAS change: Deploy → Manage deployments → Edit → New version → Deploy**

### GAS doPost actions
| `fileType` value | Handler |
|-----------------|---------|
| `calls` | `processCallUpload(blob)` |
| `sales` | `processSalesUpload(blob)` |
| `setteam` | `updateAgentTeam(agentId, team)` |
| `setsheetid` | `updateSheetIds({raceSheetId, perfSheetId})` |

### GAS doGet actions
| `action` param | Returns |
|---------------|---------|
| `history` | HistoricalWins rows as JSON array |
| `getconfig` | `{raceSheetId, perfSheetId}` from Script Properties |

### XLSX Parsing (call reports)
GAS cannot use npm packages. Call reports are parsed via 3-attempt fallback:
1. `parseXlsxBytes` — direct XML unzip (handles inlineStr, sharedStrings optional)
2. `getXlsxBytesViaDrive` — Drive round-trip then re-parse
3. `readXlsxBlobViaSheets` — Drive→Sheets conversion (most reliable)

Sales reports use `readXlsBlobAsSheet` (Drive→Sheets conversion).

**"Search Call Details" XLSX format:** uses `inlineStr` for all string cells; **no `sharedStrings.xml`** in the zip. `parseXlsxBytes` treats sharedStrings as optional — absent = empty array, parsing continues via inlineStr path.

### Dedup Logic
- **Call dedup:** SHA-256 of `[dt, ext, dir, dur, disp]` for answered/placed; SHA-256 of `[dt, dir, dur, disp]` (NO ext) for voicemail/missed — hunt groups ring multiple extensions for the same event, ext-less hash prevents N-counting.
- **Sales dedup:** SHA-256 of `[agent, policyName, product, date]`, stored in SalesLog col A.

### Voicemail Counting Rules (`classifyCalls` in EmailParser.gs)
- **INBOUND VM, external** (not Internal, not Voice Mail Access) → `'voicemail'` category → increments `raceWide.voicemails`
- **OUTBOUND VM, external** → `'placed'` category → counts as a placed call for the agent (agent called a customer who didn't answer)
- **Any VM with Internal or Voice Mail Access in disposition** → `'internal'` → skipped entirely
- Correct external inbound VM count for April 2026 report: **175**

### Month Upload Logic (`processCallUpload`)
- **Future month** (data month > current calendar month): rejected with error
- **New month** (data month > stored race month, not future): archives current RaceData → HistoricalWins, clears logs, starts new month
- **Same month:** normal dedup + append processing
- **Old month** (data month < stored race month): call stats archived to HistoricalWins for that month; current race untouched

### Sheet ID Management
Sheet IDs stored in Script Properties keys `RACE_SHEET_ID` and `PERF_SHEET_ID`. Updated via Manage tab UI or directly in Apps Script → Project Settings → Script Properties. `getSheetId()` / `getPerfSheetId()` in UploadHandler read these with hardcoded fallbacks.

## Frontend Data Flow
1. Page load → reads `localStorage` key `brd3` for cached DATA; `brd_race_sheet_id` for custom sheet ID
2. `fetchSheet('/api/sheet?sid=<id>')` called immediately → `parseSheet` resets DATA then repopulates
3. `render()` called → re-renders leaderboard and stats
4. Auto-refresh every 300s (configurable in Manage tab)

**localStorage keys:**
- `brd3` — full DATA object cache
- `brd_race_sheet_id` — custom Race Sheet ID (appended as `?sid=` on sheet fetches)

## Common Tasks

### Redeploy after GAS changes
1. Copy updated `.gs.txt` file content into Apps Script editor
2. Deploy → Manage deployments → Edit (pencil) → New version → Deploy
3. No Vercel redeploy needed unless `api/*.js` or `index.html` changed

### Redeploy after frontend/API changes
```bash
git add <files>
git commit -m "message"
git push   # Vercel auto-deploys from main
```

### Reset the race manually
Clear rows 2+ on: RaceData (cols D–R only), CallLog, SalesLog. Leave headers and RaceData cols A–C (agent IDs/names/teams).

### Apply voicemail fix to live data
The voicemail classification fix is in `EmailParser.gs.txt`. After deploying to Apps Script:
1. Delete all rows below header in CallLog sheet
2. Re-upload the call report from the Manage tab
3. Voicemail counts will recalculate correctly on the fresh log
