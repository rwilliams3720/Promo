# Boat Race Dashboard — Project Context

## What This Is
An internal sales competition dashboard. Agents earn points for policies sold and call activity. Uploads come from two sources: a "Search Call Details" XLSX report and a sales XLSX report. Data flows through Vercel serverless functions into Google Apps Script, which writes to a Google Sheet. The frontend reads the sheet directly via GViz JSON API.

## Architecture

```
Browser (index.html, served by Vercel)
  ↓ fetch /api/sheet
Vercel proxy (api/sheet.js) → Google Sheets GViz JSON API (read-only, public)
  ↓ fetch /api/upload (POST)
Vercel proxy (api/upload.js) → GAS Web App (doPost) → Google Sheet (read/write)
  ↓ fetch /api/history (GET)
Vercel proxy (api/history.js) → GAS Web App (doGet?action=history) → HistoricalWins sheet
```

## Key Files

| File | Purpose |
|------|---------|
| `index.html` | Entire frontend — scoring logic, rendering, upload UI, admin panel |
| `api/upload.js` | Vercel proxy — streams raw body to GAS, follows redirect, guards HTML responses |
| `api/sheet.js` | Vercel proxy — fetches GViz JSON from Google Sheet |
| `api/history.js` | Vercel proxy — fetches historical wins from GAS |
| `UploadHandler.gs` | GAS entry point (doPost/doGet) — month detection, archive, reset |
| `EmailParser.gs` | GAS — XLSX parsing (XML-based), call classification, dedup, RaceData writes |
| `vercel.json` | Builds + routes for all three API files and index.html |

## Google Sheet
- **Sheet ID:** `1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA`
- **GViz gid:** `471942583` (RaceData sheet)
- **Tabs:** RaceData, CallLog, SalesLog, HistoricalWins, RaceConfig

### RaceData columns (A–R)
A=AgentID, B=Name, C=Team, D=WL, E=UL, F=Term, G=Health, H=Auto, I=Fire,
J=Placed, K=Answered, L=Missed, M=Voicemail, N=TalkMin, O=AvgMin,
P=RaceWideMissed, Q=RaceWideVoicemail, R=LastUpdated

## Scoring Formula (frontend `calcScore`)
```javascript
polPts  = wl*100 + ul*75 + term*50 + health*30 + auto*15 + fire*10
placedPts  = placed  * (service ? 0.25 : 1)
answeredPts = answered * (service ? 5    : 1)
talkPts = talkMin*0.1 + avgMin*2
gross   = round(polPts + placedPts + answeredPts + talkPts)
deduct  = round(raceWideMissed*(-3) + raceWideVoicemail*(-2))  // applied equally to all agents
total   = max(0, gross + deduct)
```
**Deductions are race-wide only** — individual per-agent missed/voicemail columns (L, M) are not used in scoring.

## Agents
| ID | Name | Default Team |
|----|------|-------------|
| ashley | Ashley McEniry | sales |
| fiona | Fiona Rodriguez | service |
| jocelyn | Jocelyn Hernandez | service |
| joseph | Joseph Underwood | sales |
| peyton | Peyton Tooze | sales |
| susan | Susan Navarro | sales |
| tiffany | Tiffany Dabe | sales |
| tracy | Tracy Ankrah | service |
| amin | Amin Kalas | sales |
| andy | Andy Rose | sales |
| russel | Russel Williams | service |

**Team is source of truth from the sheet** (overrides hardcoded defaults on load).

## GAS Scripts (in Apps Script project)
Three script files share the same global namespace:
- **UploadHandler.gs** — web app entry point, month management, archive/reset logic
- **EmailParser.gs** — call report parsing and classification (`classifyCalls`, `aggregateFromLog`, `writeRaceData`)
- **SalesParser.gs** — sales report parsing (`classifySales`, `aggregateSalesFromLog`, `writePolicyTotals`)

### GAS Web App
- Execute as: Me
- Who has access: Anyone
- URL stored in Vercel env var: `GAS_UPLOAD_URL`
- **After any GAS change: Deploy → Manage deployments → Edit → New version → Deploy**

### XLSX Parsing (call reports)
GAS cannot use npm packages. Call reports are parsed via 4-attempt fallback:
1. `parseXlsxBytes` — direct XML unzip
2. `getXlsxBytesViaDrive` — Drive round-trip then re-parse
3. `parseXlsxBytesToRows` — alternate parser
4. `readXlsxBlobViaSheets` — Drive→Sheets conversion (most reliable)

Sales reports use `readXlsBlobAsSheet` (Drive→Sheets conversion).

### Dedup Logic
- **Call dedup:** SHA-256 of `[dt, ext, dir, dur, disp]` for answered/placed; SHA-256 of `[dt, dir, dur, disp]` (NO ext) for voicemail/missed — hunt groups ring multiple extensions for the same event, ext-less hash prevents N-counting.
- **Sales dedup:** SHA-256 of key sale fields, stored in SalesLog col A.

### Month Auto-Reset
On upload, `processCallUpload` detects the data month:
- **New month:** archives RaceData → HistoricalWins, clears CallLog + SalesLog + RaceData cols D+, updates RaceConfig
- **Same month:** normal processing
- **Previous month:** rejected with error message

## Frontend Data Flow
1. Page load → reads `localStorage` key `brd3` for cached DATA
2. `fetchSheet('/api/sheet')` called immediately → `parseSheet` resets `DATA.policies`, `DATA.phone`, `DATA.raceWideMissed/Voicemail` to 0 then repopulates from sheet rows
3. `render()` called → re-renders race leaderboard and stats
4. Auto-refresh every 300s

**localStorage key `brd3`** caches the full DATA object. `parseSheet` resets data before populating, so a cleared sheet correctly shows zeros (not stale cached values).

## Known Pending Items
- **EmailParser not yet deployed** with the hunt-group VM dedup fix (category-before-hash). After deploying the new EmailParser.gs, clear the CallLog sheet rows and re-upload the call report to correct the voicemail count.
- **mapPolicyCategory in SalesParser** — replace exact string matches with `indexOf` partial matching to fix sales falling into "other" category.
- **Sales count mystery** — SalesLog may show fewer policies than expected. Diagnostics added to `processSalesUpload` (returns `diag.categories` breakdown). Re-upload sales after deploying updated UploadHandler to see the breakdown.

## Common Tasks

### Redeploy after GAS changes
1. Apps Script editor → Deploy → Manage deployments
2. Edit (pencil icon) → New version → Deploy
3. No Vercel redeploy needed unless `api/*.js` or `index.html` changed

### Redeploy after frontend/API changes
```bash
git add <files>
git commit -m "message"
git push   # Vercel auto-deploys from main
```

### Reset the race manually
Clear rows 2+ on: RaceData (cols D–R only), CallLog, SalesLog. Leave headers and RaceData cols A–C (agent IDs/names/teams).

### Fix voicemail count (when ready)
1. Deploy new EmailParser.gs (hunt-group hash fix)
2. Delete all rows below header in CallLog sheet
3. Re-upload call report from dashboard
