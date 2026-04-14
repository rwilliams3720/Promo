# 🚤 Sales Boat Race Dashboard

Real-time gamified leaderboard with automated email parsing via Google Apps Script.

---

## Scoring System

### Policy Points (both teams equal)
| Policy | Points | Policy | Points |
|--------|--------|--------|--------|
| Whole Life | 100 | Health | 30 |
| Universal Life | 75 | Auto | 15 |
| Term Life | 50 | Fire | 10 |

### Phone Activity
| Metric | Sales Team | Service Team |
|--------|-----------|--------------|
| Placed Calls | +1 pt | +0.25 pts |
| Answered Calls | +1 pt | **+5 pts** |
| Talk Time | +0.1 pt/min | +0.1 pt/min |
| Avg Talk Time | +2 pts/min avg | +2 pts/min avg |

### Deductions (Race-Wide — both teams equally)
| Event | Deduction |
|-------|-----------|
| Missed Call | **-3 pts** |
| Voicemail Received | **-2 pts** |

---

## Deploy to Vercel

1. Push this folder to a GitHub repo
2. [vercel.com](https://vercel.com) → New Project → Import repo → Deploy
3. No build settings needed — static site, deploys in ~30 seconds
4. Every `git push` auto-redeploys

---

## Automate with Google Apps Script (Email → Sheet → Race)

### Architecture
```
Daily Email Report
  → Gmail
    → Apps Script (7 AM trigger)
      → parses agent stats
        → writes to Google Sheet
          → Vercel site fetches JSON every 5 min
            → race updates automatically
```

### Step 1 — Create a Google Sheet
Go to sheets.google.com → New → name it "Boat Race Data". Leave blank.

### Step 2 — Add the Script
Extensions → Apps Script → delete default code → paste `gas/EmailParser.gs` → update `CONFIG.GMAIL_SEARCH` to match your email subject.

### Step 3 — Test
Run → `testParse` → check Execution Log. You should see each agent's stats extracted. If names aren't matched, update `CONFIG.AGENT_MAP` to match your email exactly.

### Step 4 — Activate Trigger
Run → `setupTrigger` → authorizes and schedules 7 AM daily parse.

### Step 5 — Publish Sheet as JSON
File → Share → Publish to web → RaceData tab → copy URL and change it to:
```
https://docs.google.com/spreadsheets/d/YOUR_ID/gviz/tq?tqx=out:json&sheet=RaceData
```

### Step 6 — Connect Dashboard
Open your Vercel site → Manage tab → paste URL → Connect. Green dot = live sync.

---

## Email Format

The parser finds each agent's name as a section header, then extracts numbers. Typical format:
```
Susan Navarro
  Placed Calls: 45     Answered: 38
  Missed: 7            Voicemails: 4
  Total Talk Time: 210 min
  Average Talk Time: 5.5 min
```
Handles label variations: "Outbound/Placed/Calls Placed", "Answered/Inbound", "Missed/Unanswered", "VM/Voicemail/Messages Left", time in "210 min", "3h 30m", or "3:30" format. If your format differs, share a sample to update the patterns.

---

## Add a New Agent
In `index.html` → `DATA.agents` array → add `{ id:'newid', name:'Full Name', team:'sales' }` plus matching entries in `DATA.policies` and `DATA.phone`. Also add to `CONFIG.AGENT_MAP` in the Apps Script.
