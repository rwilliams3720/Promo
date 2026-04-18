/**
 * ═══════════════════════════════════════════════════════════════
 *  UPLOAD HANDLER — Web App entry point
 *
 *  Accepts file uploads from the Boat Race dashboard and runs
 *  the existing parsing logic (EmailParser + SalesParser scripts
 *  must be in the same Apps Script project).
 *
 *  DEPLOY AS:
 *    Execute as: Me
 *    Who has access: Anyone
 *
 *  After deploying, copy the web app URL and add it to Vercel:
 *    Settings → Environment Variables → GAS_UPLOAD_URL = <your URL>
 * ═══════════════════════════════════════════════════════════════
 */

var SS_ID = '1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA';
var MONTH_NAMES = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];


function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var type    = payload.fileType;

    // Handle non-file actions first — before any base64 decode
    if (type === 'setteam') {
      return ContentService
        .createTextOutput(JSON.stringify(updateAgentTeam(payload.agentId, payload.team)))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // File upload actions
    var bytes = Utilities.base64Decode(payload.fileBase64);
    var fname = payload.fileName || 'upload.xlsx';
    var mime  = payload.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var blob  = Utilities.newBlob(bytes, mime, fname);

    var result = (type === 'sales') ? processSalesUpload(blob) : processCallUpload(blob);

    return ContentService
      .createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ success: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// GET ?action=history — returns HistoricalWins rows as JSON array
function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;
    if (action === 'history') {
      return ContentService
        .createTextOutput(JSON.stringify(getHistoricalData()))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput('UploadHandler OK');
  } catch(err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}


// ─────────────────────────────────────────────────────────────
// MONTH MANAGEMENT
// ─────────────────────────────────────────────────────────────

// Scan rows for a recognisable date; return "Month YYYY" string or null
function detectMonthFromRows(rows) {
  if (!rows || rows.length < 2) return null;

  // Find a header column that sounds like a date
  var header = rows[0];
  var dateColIdx = -1;
  for (var c = 0; c < header.length; c++) {
    var h = String(header[c]).toLowerCase();
    if (h.indexOf('date') !== -1 || h.indexOf('start') !== -1 || h.indexOf('time') !== -1) {
      dateColIdx = c; break;
    }
  }

  for (var r = 1; r < Math.min(rows.length, 30); r++) {
    var val = (dateColIdx >= 0) ? rows[r][dateColIdx] : null;

    // Fall back to scanning all cells for a Date object
    if (!val || val === '') {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] instanceof Date) { val = rows[r][c]; break; }
      }
    }
    if (!val || val === '') continue;

    var d = null;
    if (val instanceof Date)           { d = val; }
    else if (typeof val === 'string')  { d = new Date(val); }
    else if (typeof val === 'number' && val > 40000) { d = new Date((val - 25569) * 86400000); }

    if (d && !isNaN(d.getTime()) && d.getFullYear() > 2020) {
      return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
    }
  }

  // Fallback: current month
  var now = new Date();
  Logger.log('detectMonthFromRows: could not detect from data, using current month');
  return MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();
}

// Compare two "Month YYYY" strings. Returns >0 if a is later, <0 if earlier, 0 if equal.
function compareMonths(a, b) {
  var idx = function(str) {
    var s = String(str).toLowerCase();
    for (var i = 0; i < MONTH_NAMES.length; i++) {
      if (s.indexOf(MONTH_NAMES[i].toLowerCase()) !== -1) return i;
    }
    return -1;
  };
  var yr = function(str) { var m = String(str).match(/\d{4}/); return m ? +m[0] : 0; };
  var ay = yr(a), by = yr(b);
  if (ay !== by) return ay - by;
  return idx(a) - idx(b);
}

function getOrCreateConfigSheet(ss) {
  var s = ss.getSheetByName('RaceConfig');
  if (!s) {
    s = ss.insertSheet('RaceConfig');
    s.getRange(1, 1).setValue('CurrentMonth');
    s.getRange(1, 2).setValue('');
  }
  return s;
}

function getCurrentRaceMonth(ss) {
  return String(getOrCreateConfigSheet(ss).getRange(1, 2).getValue()) || '';
}

function setCurrentRaceMonth(ss, month) {
  getOrCreateConfigSheet(ss).getRange(1, 2).setValue(month);
}

// Archive RaceData to HistoricalWins with computed final scores
function archiveToHistorical(ss, month) {
  var raceSheet = ss.getSheetByName(RACE_CONFIG.RACE_SHEET);
  if (!raceSheet || raceSheet.getLastRow() < 2) {
    Logger.log('archiveToHistorical: RaceData empty, nothing to archive');
    return;
  }

  var histSheet = ss.getSheetByName('HistoricalWins');
  if (!histSheet) {
    histSheet = ss.insertSheet('HistoricalWins');
    histSheet.appendRow(['Month','Rank','AgentID','Name','Team','TotalScore','GrossScore','Deductions',
      'WL','UL','Term','Health','Auto','Fire',
      'Placed','Answered','Missed','Voicemail','TalkMin','AvgMin',
      'RaceWideMissed','RaceWideVoicemail']);
    histSheet.setFrozenRows(1);
  }

  // Remove any existing records for this month so re-archiving is safe
  var existing = histSheet.getDataRange().getValues();
  for (var i = existing.length - 1; i >= 1; i--) {
    if (String(existing[i][0]) === month) histSheet.deleteRow(i + 1);
  }

  // Read all agent rows from RaceData
  // Columns: A=AgentID B=Name C=Team D=WL E=UL F=Term G=Health H=Auto I=Fire
  //          J=Placed K=Answered L=Missed M=Voicemail N=TalkMin O=AvgMin
  //          P=RaceWideMissed Q=RaceWideVoicemail R=Timestamp
  var numRows = raceSheet.getLastRow() - 1;
  var numCols = Math.max(raceSheet.getLastColumn(), 18);
  var data    = raceSheet.getRange(2, 1, numRows, numCols).getValues();

  // Race-wide deductions (same on every row)
  var rwMissed = 0, rwVoicemail = 0;
  for (var i = 0; i < data.length; i++) {
    if (data[i][15] || data[i][16]) {
      rwMissed   = +data[i][15] || 0;
      rwVoicemail = +data[i][16] || 0;
      break;
    }
  }

  // Score each agent using the same formula as the frontend
  var scored = data.map(function(row) {
    var agentId = String(row[0]);
    if (!agentId || agentId === '0' || agentId === '') return null;
    var team = String(row[2]).toLowerCase();
    var svc  = team.indexOf('service') !== -1;
    var wl=+row[3]||0, ul=+row[4]||0, term=+row[5]||0, health=+row[6]||0, auto=+row[7]||0, fire=+row[8]||0;
    var placed=+row[9]||0, answered=+row[10]||0, missed=+row[11]||0, voicemail=+row[12]||0;
    var talkMin=+row[13]||0, avgMin=+row[14]||0;
    var polPts  = wl*100 + ul*75 + term*50 + health*30 + auto*15 + fire*10;
    var callPts = placed*(svc?0.25:1) + answered*(svc?5:1) + talkMin*0.1 + avgMin*2;
    var gross   = Math.round(polPts + callPts);
    var deduct  = Math.round((missed+rwMissed)*(-3) + (voicemail+rwVoicemail)*(-2));
    return {
      agentId:agentId, name:String(row[1]), team:team,
      gross:gross, deduct:deduct, total:gross+deduct,
      wl:wl, ul:ul, term:term, health:health, auto:auto, fire:fire,
      placed:placed, answered:answered, missed:missed, voicemail:voicemail,
      talkMin:talkMin, avgMin:avgMin
    };
  }).filter(function(a) { return a !== null; });

  scored.sort(function(a, b) { return b.total - a.total; });

  for (var i = 0; i < scored.length; i++) {
    var s = scored[i];
    histSheet.appendRow([
      month, i+1, s.agentId, s.name, s.team, s.total, s.gross, s.deduct,
      s.wl, s.ul, s.term, s.health, s.auto, s.fire,
      s.placed, s.answered, s.missed, s.voicemail, s.talkMin, s.avgMin,
      rwMissed, rwVoicemail
    ]);
  }

  Logger.log('archiveToHistorical: archived ' + scored.length + ' agents for ' + month);
}

// Clear score/phone columns but preserve AgentID, Name, Team; also wipe dedup logs
function resetRaceScores(ss) {
  var raceSheet = ss.getSheetByName(RACE_CONFIG.RACE_SHEET);
  if (raceSheet && raceSheet.getLastRow() > 1) {
    var n       = raceSheet.getLastRow() - 1;
    var lastCol = raceSheet.getLastColumn();
    if (lastCol > 3) raceSheet.getRange(2, 4, n, lastCol - 3).clearContent();
  }

  // Clear call dedup log
  var logSheet = ss.getSheetByName(RACE_CONFIG.LOG_SHEET);
  if (logSheet && logSheet.getLastRow() > 1) {
    logSheet.getRange(2, 1, logSheet.getLastRow()-1, logSheet.getLastColumn()).clearContent();
  }

  // Clear sales dedup log
  var salesLog = ss.getSheetByName(SALES_CONFIG.LOG_SHEET);
  if (salesLog && salesLog.getLastRow() > 1) {
    salesLog.getRange(2, 1, salesLog.getLastRow()-1, salesLog.getLastColumn()).clearContent();
  }

  SpreadsheetApp.flush();
  Logger.log('resetRaceScores: race cleared for new month');
}

// Return all HistoricalWins rows as a 2D array (row 0 = headers)
function getHistoricalData() {
  var ss        = SpreadsheetApp.openById(SS_ID);
  var histSheet = ss.getSheetByName('HistoricalWins');
  if (!histSheet || histSheet.getLastRow() < 2) return [];
  return histSheet.getDataRange().getValues();
}


// ─────────────────────────────────────────────────────────────
// CALL REPORT — reuses EmailParser functions
// ─────────────────────────────────────────────────────────────
function processCallUpload(blob) {
  var bytes = blob.getBytes();
  var rows  = [];
  var diagErrors = [];

  // Verify magic bytes — XLSX (ZIP) files start with PK (0x50 0x4B)
  var magic = bytes.length >= 4
    ? [bytes[0] & 0xFF, bytes[1] & 0xFF, bytes[2] & 0xFF, bytes[3] & 0xFF]
    : [];
  var magicHex = magic.map(function(b){ return ('0'+b.toString(16)).slice(-2); }).join(' ');
  Logger.log('File bytes received: ' + bytes.length + ', magic: ' + magicHex);
  var isXlsx = (magic[0] === 0x50 && magic[1] === 0x4B);

  // Attempt 1 — direct bytes (fastest)
  try { rows = parseXlsxBytes(bytes); } catch(e1) { diagErrors.push('Attempt1: ' + e1.message); }

  // Attempt 2 — Drive round-trip (mirrors email path, normalizes bytes)
  if (!rows || rows.length === 0) {
    try {
      var driveBytes = getXlsxBytesViaDrive(blob);
      if (driveBytes) rows = parseXlsxBytes(driveBytes);
      else diagErrors.push('Attempt2: Drive upload returned null');
    } catch(e2) { diagErrors.push('Attempt2: ' + e2.message); }
  }

  // Attempt 3 — Script 3 parser on original bytes
  if (!rows || rows.length === 0) {
    try { rows = parseXlsxBytesToRows(bytes); } catch(e3) { diagErrors.push('Attempt3: ' + e3.message); }
  }

  // Attempt 4 — Convert to Google Sheet via Drive
  if (!rows || rows.length === 0) {
    try { rows = readXlsxBlobViaSheets(blob); } catch(e4) { diagErrors.push('Attempt4: ' + e4.message); }
  }

  if (!rows || rows.length === 0)
    return {
      success: false,
      error: 'Could not parse call report. Ensure it is a valid .xlsx file containing a "Call Direction" column.',
      diag: { bytes: bytes.length, magic: magicHex, isXlsx: isXlsx, errors: diagErrors }
    };

  // Verify the call direction header is present
  var hasHeader = false;
  for (var r = 0; r < Math.min(rows.length, 20); r++) {
    if (rows[r].join('|').indexOf('Call Direction') !== -1) { hasHeader = true; break; }
  }
  if (!hasHeader)
    return { success: false, error: 'File parsed but no "Call Direction" header found. Make sure you are uploading the Search Call Details report, not a different file.' };

  // ── Month detection ──────────────────────────────────────────
  var ss         = SpreadsheetApp.openById(SS_ID);
  var dataMonth  = detectMonthFromRows(rows);
  var storedMonth = getCurrentRaceMonth(ss);
  Logger.log('Data month: ' + dataMonth + ' | Stored month: ' + storedMonth);

  if (dataMonth && storedMonth) {
    var cmp = compareMonths(dataMonth, storedMonth);

    if (cmp > 0) {
      // New month — archive the finished race and start fresh
      Logger.log('New month detected. Archiving ' + storedMonth + ' → starting ' + dataMonth);
      archiveToHistorical(ss, storedMonth);
      resetRaceScores(ss);
      setCurrentRaceMonth(ss, dataMonth);

    } else if (cmp < 0) {
      // Previous month — do NOT touch current race data
      Logger.log('Previous month data (' + dataMonth + '). Current race is ' + storedMonth + '. Skipping.');
      return {
        success: false,
        error: 'This file contains data from ' + dataMonth + '. The current race is ' + storedMonth + '. Previous month data cannot be added to the active race. To update ' + dataMonth + ' history, finish the current month first.'
      };
    }
    // cmp === 0 → same month, continue normally
  } else if (dataMonth && !storedMonth) {
    setCurrentRaceMonth(ss, dataMonth);
  }
  // ─────────────────────────────────────────────────────────────

  var raceSheet = getOrCreateSheet(ss, RACE_CONFIG.RACE_SHEET);
  var logSheet  = getOrCreateSheet(ss, RACE_CONFIG.LOG_SHEET);

  // Script 1 flow: log-based dedup → per-agent phone stats → RaceData
  var knownHashes = loadKnownHashes(logSheet);
  var result      = classifyCalls(rows, knownHashes);

  if (result.newLogRows.length === 0)
    return { success: true, message: 'No new calls found — all already logged.', new: 0, skipped: result.duplicatesSkipped };

  appendToLog(logSheet, result.newLogRows);
  var allLogRows = getAllLogRows(logSheet);
  var totals     = aggregateFromLog(allLogRows);
  writeRaceData(raceSheet, totals);

  // Update race-wide deductions + timestamp
  var now = Utilities.formatDate(new Date(), 'America/New_York', 'M/d/yyyy h:mm a');
  if (raceSheet.getLastRow() > 1) {
    var n = raceSheet.getLastRow() - 1;
    raceSheet.getRange(2, 16, n, 1).setValue(totals.raceWide.missed);
    raceSheet.getRange(2, 17, n, 1).setValue(totals.raceWide.voicemails);
    raceSheet.getRange(2, 18, n, 1).setValue(now);
  }
  SpreadsheetApp.flush();

  // Script 3 flow: aggregate raw rows → write to Performance Tracking sheet
  try {
    var aggregated = aggregateCallData(rows);
    if (aggregated) writeToPerformanceSheet(aggregated);
    Logger.log('Performance Tracking sheet updated.');
  } catch(perfErr) {
    Logger.log('Performance sheet write error (non-fatal): ' + perfErr.message);
  }

  var msg = 'Call report processed successfully.';
  if (dataMonth && storedMonth && compareMonths(dataMonth, storedMonth) > 0) {
    msg = 'New month detected (' + dataMonth + '). Previous race archived to Historical Wins. ' + msg;
  }

  return {
    success:  true,
    message:  msg,
    new:      result.newLogRows.length,
    skipped:  result.duplicatesSkipped,
    raceWide: totals.raceWide,
  };
}


// ─────────────────────────────────────────────────────────────
// SALES REPORT — reuses SalesParser functions
// ─────────────────────────────────────────────────────────────
function processSalesUpload(blob) {
  var rows = readXlsBlobAsSheet(blob);
  if (!rows || rows.length === 0)
    return { success: false, error: 'Could not parse sales report. Make sure it is a valid .xls or .xlsx file.' };

  var ss        = SpreadsheetApp.openById(SS_ID);
  var raceSheet = getOrCreateSalesSheet(ss, SALES_CONFIG.RACE_SHEET);
  var logSheet  = getOrCreateSalesSheet(ss, SALES_CONFIG.LOG_SHEET);

  var knownHashes = loadSalesHashes(logSheet);
  var result      = classifySales(rows, knownHashes);

  if (result.newLogRows.length > 0) {
    appendSalesToLog(logSheet, result.newLogRows);
  }

  // Always re-aggregate and write totals — sheet may be stale if previous
  // uploads returned early before writing (e.g. all-already-logged case).
  var allSales = getAllSalesRows(logSheet);
  var totals   = aggregateSalesFromLog(allSales);
  writePolicyTotals(raceSheet, totals);

  var msg = result.newLogRows.length === 0
    ? 'No new sales found — all already logged. Totals refreshed.'
    : 'Sales report processed successfully.';

  return {
    success: true,
    message: msg,
    new:     result.newLogRows.length,
    skipped: result.duplicatesSkipped,
  };
}


// ─────────────────────────────────────────────────────────────
// Upload xlsx to Drive, download back — mirrors email attachment path
// ─────────────────────────────────────────────────────────────
function getXlsxBytesViaDrive(blob) {
  var fileId = null;
  try {
    var token    = ScriptApp.getOAuthToken();
    var boundary = 'xlsxboundary';
    var meta     = '{"name":"__call_upload_tmp__","mimeType":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}';
    var head     = Utilities.newBlob('--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n').getBytes();
    var tail     = Utilities.newBlob('\r\n--'+boundary+'--').getBytes();
    var payload  = head.concat(blob.getBytes()).concat(tail);

    var up = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method:'POST', contentType:'multipart/related; boundary="'+boundary+'"',
        payload:payload, headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true }
    );
    var uploaded = JSON.parse(up.getContentText());
    if (!uploaded.id) { Logger.log('Drive upload failed: '+up.getContentText()); return null; }
    fileId = uploaded.id;

    var dl = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/'+fileId+'?alt=media',
      { headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true }
    );
    return dl.getContent();
  } catch(e) {
    Logger.log('getXlsxBytesViaDrive error: ' + e.message);
    return null;
  } finally {
    if (fileId) {
      try { UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+fileId,
        { method:'DELETE', headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
          muteHttpExceptions:true }); } catch(e) {}
    }
  }
}


// ─────────────────────────────────────────────────────────────
// Attempt 4 — Convert XLSX blob to Google Sheet via Drive, read all rows
// ─────────────────────────────────────────────────────────────
function readXlsxBlobViaSheets(blob) {
  var fileId = null;
  try {
    var token    = ScriptApp.getOAuthToken();
    var mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var meta     = JSON.stringify({ name: '__call_upload_tmp__', mimeType: 'application/vnd.google-apps.spreadsheet' });
    var boundary = 'calluploadboundary';
    var head     = Utilities.newBlob('--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: '+mimeType+'\r\n\r\n').getBytes();
    var tail     = Utilities.newBlob('\r\n--'+boundary+'--').getBytes();
    var payload  = head.concat(blob.getBytes()).concat(tail);

    var up = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&convert=true',
      { method: 'POST', contentType: 'multipart/related; boundary="'+boundary+'"',
        payload: payload, headers: { Authorization: 'Bearer '+token }, muteHttpExceptions: true }
    );
    var uploaded = JSON.parse(up.getContentText());
    if (!uploaded.id) { Logger.log('Attempt4 upload failed: '+up.getContentText()); return []; }
    fileId = uploaded.id;

    var ss = null;
    for (var attempt = 1; attempt <= 8; attempt++) {
      Utilities.sleep(attempt * 1500);
      try { ss = SpreadsheetApp.openById(fileId); if (ss) break; } catch(e) {}
    }
    if (!ss) { Logger.log('Attempt4: could not open converted sheet'); return []; }

    var allRows = [];
    var sheets  = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var data = sheets[s].getDataRange().getValues();
      if (data.length > allRows.length) allRows = data;
    }
    Logger.log('Attempt4 rows from Drive→Sheets: ' + allRows.length);
    return allRows;

  } catch(e) {
    Logger.log('readXlsxBlobViaSheets error: ' + e.message);
    return [];
  } finally {
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {} }
  }
}


// ─────────────────────────────────────────────────────────────
// Blob-based sales sheet reader — uploads to Drive for conversion
// ─────────────────────────────────────────────────────────────
function readXlsBlobAsSheet(blob) {
  var fileId = null;
  try {
    var token    = ScriptApp.getOAuthToken();
    var mimeType = blob.getContentType() || 'application/vnd.ms-excel';
    var meta     = JSON.stringify({ name:'__sales_upload_tmp__', mimeType:'application/vnd.google-apps.spreadsheet' });
    var boundary = 'uploadboundary';
    var head     = Utilities.newBlob('--'+boundary+'\r\nContent-Type: application/json\r\n\r\n'+meta+'\r\n--'+boundary+'\r\nContent-Type: '+mimeType+'\r\n\r\n').getBytes();
    var tail     = Utilities.newBlob('\r\n--'+boundary+'--').getBytes();
    var payload  = head.concat(blob.getBytes()).concat(tail);

    var up = UrlFetchApp.fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&convert=true',
      { method:'POST', contentType:'multipart/related; boundary="'+boundary+'"',
        payload:payload, headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true }
    );
    var uploaded = JSON.parse(up.getContentText());
    if (!uploaded.id) { Logger.log('Upload failed: '+up.getContentText()); return []; }
    fileId = uploaded.id;

    if (uploaded.mimeType !== 'application/vnd.google-apps.spreadsheet') {
      UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/'+fileId+'?convert=true',
        { method:'PATCH', contentType:'application/json',
          payload:JSON.stringify({ mimeType:'application/vnd.google-apps.spreadsheet' }),
          headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true });
    }

    var ss = null;
    for (var attempt = 1; attempt <= 8; attempt++) {
      Utilities.sleep(attempt * 1500);
      try { ss = SpreadsheetApp.openById(fileId); if (ss) break; } catch(e) { Logger.log('Attempt '+attempt+': '+e.message); }
    }
    if (!ss) return [];

    var sheet = ss.getSheetByName('Sales') || ss.getSheets()[0];
    return sheet.getDataRange().getValues();

  } catch(e) {
    Logger.log('readXlsBlobAsSheet error: ' + e.message);
    return [];
  } finally {
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {} }
  }
}


// ─────────────────────────────────────────────────────────────
// SET TEAM — updates col C (Team) in RaceData for a given AgentID
// ─────────────────────────────────────────────────────────────
function updateAgentTeam(agentId, team) {
  try {
    var ss        = SpreadsheetApp.openById(SS_ID);
    var raceSheet = ss.getSheetByName('RaceData');
    if (!raceSheet) return { success: false, error: 'RaceData sheet not found.' };
    if (raceSheet.getLastRow() < 2) return { success: false, error: 'No agent rows found.' };

    var ids = raceSheet.getRange(2, 1, raceSheet.getLastRow()-1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === agentId) {
        raceSheet.getRange(i+2, 3).setValue(team);
        SpreadsheetApp.flush();
        return { success: true };
      }
    }
    return { success: false, error: 'Agent ID not found: ' + agentId };
  } catch(err) {
    return { success: false, error: err.message };
  }
}


// ─────────────────────────────────────────────────────────────
// TEST — run manually to verify the web app is working
// ─────────────────────────────────────────────────────────────
function testWebApp() {
  Logger.log('UploadHandler is ready.');
  Logger.log('Deploy as a web app, then add the URL to Vercel as GAS_UPLOAD_URL.');
  Logger.log('Execute as: Me  |  Who has access: Anyone');
}
