/**
 * ═══════════════════════════════════════════════════════════════
 *  UPLOAD HANDLER — Web App entry point
 *
 *  Accepts file uploads from the Boat Race dashboard.
 *  EmailParser, SalesParser, and CallReportProcessor scripts
 *  must be in the same Apps Script project.
 *
 *  DEPLOY AS:
 *    Execute as: Me
 *    Who has access: Anyone
 *
 *  Sheet IDs are stored in Script Properties (not hardcoded).
 *  Use the Manage tab on the dashboard to update them, or set
 *  them directly in Apps Script → Project Settings → Script Properties.
 * ═══════════════════════════════════════════════════════════════
 */

var DEFAULT_SS_ID   = '1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA';
var DEFAULT_PERF_ID = '1-3t8XAu-59NLOaLiWPxwYtkJfa7rs7JpGLMl52FPHiE';

var MONTH_NAMES = ['January','February','March','April','May','June',
                   'July','August','September','October','November','December'];

function getSheetId() {
  return PropertiesService.getScriptProperties().getProperty('RACE_SHEET_ID') || DEFAULT_SS_ID;
}
function getPerfSheetId() {
  return PropertiesService.getScriptProperties().getProperty('PERF_SHEET_ID') || DEFAULT_PERF_ID;
}


// ─────────────────────────────────────────────────────────────
// WEB APP ENTRY POINTS
// ─────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);
    var type    = payload.fileType;

    if (type === 'setteam') {
      return json(updateAgentTeam(payload.agentId, payload.team));
    }

    if (type === 'setsheetid') {
      return json(updateSheetIds(payload));
    }

    var bytes = Utilities.base64Decode(payload.fileBase64);
    var fname = payload.fileName || 'upload.xlsx';
    var mime  = payload.mimeType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var blob  = Utilities.newBlob(bytes, mime, fname);

    var result = (type === 'sales') ? processSalesUpload(blob) : processCallUpload(blob);
    return json(result);

  } catch(err) {
    return json({ success: false, error: err.message });
  }
}

function doGet(e) {
  try {
    var action = e && e.parameter && e.parameter.action;

    if (action === 'history') {
      return json(getHistoricalData());
    }
    if (action === 'getconfig') {
      return json({
        raceSheetId: getSheetId(),
        perfSheetId: getPerfSheetId(),
      });
    }
    return ContentService.createTextOutput('UploadHandler OK');
  } catch(err) {
    return json({ error: err.message });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


// ─────────────────────────────────────────────────────────────
// SHEET ID MANAGEMENT
// ─────────────────────────────────────────────────────────────
function updateSheetIds(payload) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (payload.raceSheetId && payload.raceSheetId.trim()) {
      // Verify the sheet is accessible before saving
      SpreadsheetApp.openById(payload.raceSheetId.trim());
      props.setProperty('RACE_SHEET_ID', payload.raceSheetId.trim());
    }
    if (payload.perfSheetId && payload.perfSheetId.trim()) {
      SpreadsheetApp.openById(payload.perfSheetId.trim());
      props.setProperty('PERF_SHEET_ID', payload.perfSheetId.trim());
    }
    return { success: true, raceSheetId: getSheetId(), perfSheetId: getPerfSheetId() };
  } catch(err) {
    return { success: false, error: 'Could not access sheet: ' + err.message };
  }
}


// ─────────────────────────────────────────────────────────────
// MONTH MANAGEMENT
// ─────────────────────────────────────────────────────────────
function detectMonthFromRows(rows) {
  if (!rows || rows.length < 2) return null;

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
    if (!val || val === '') {
      for (var c = 0; c < rows[r].length; c++) {
        if (rows[r][c] instanceof Date) { val = rows[r][c]; break; }
      }
    }
    if (!val || val === '') continue;

    var d = null;
    if (val instanceof Date)          { d = val; }
    else if (typeof val === 'string') { d = new Date(val); }
    else if (typeof val === 'number' && val > 40000) { d = new Date((val - 25569) * 86400000); }

    if (d && !isNaN(d.getTime()) && d.getFullYear() > 2020) {
      return MONTH_NAMES[d.getMonth()] + ' ' + d.getFullYear();
    }
  }

  var now = new Date();
  return MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();
}

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

  var histSheet = getOrCreateHistSheet(ss);

  // Remove any existing records for this month (safe to re-archive)
  var existing = histSheet.getDataRange().getValues();
  for (var i = existing.length - 1; i >= 1; i--) {
    if (String(existing[i][0]) === month) histSheet.deleteRow(i + 1);
  }

  var numRows = raceSheet.getLastRow() - 1;
  var numCols = Math.max(raceSheet.getLastColumn(), 18);
  var data    = raceSheet.getRange(2, 1, numRows, numCols).getValues();

  var rwMissed = 0, rwVoicemail = 0;
  for (var i = 0; i < data.length; i++) {
    if (data[i][15] || data[i][16]) {
      rwMissed    = +data[i][15] || 0;
      rwVoicemail = +data[i][16] || 0;
      break;
    }
  }

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
    var deduct  = Math.round(rwMissed*(-3) + rwVoicemail*(-2));
    return {
      agentId:agentId, name:String(row[1]), team:team,
      gross:gross, deduct:deduct, total:Math.max(0,gross+deduct),
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

  SpreadsheetApp.flush();
  Logger.log('archiveToHistorical: archived ' + scored.length + ' agents for ' + month);
}

// Archive old-month call data (call stats only, zero policies) to HistoricalWins
function archiveCallStatsToHistorical(ss, month, totals) {
  var histSheet = getOrCreateHistSheet(ss);

  var existing = histSheet.getDataRange().getValues();
  for (var i = existing.length - 1; i >= 1; i--) {
    if (String(existing[i][0]) === month) histSheet.deleteRow(i + 1);
  }

  var rwMissed = totals.raceWide.missed;
  var rwVm     = totals.raceWide.voicemails;

  var scored = [];
  for (var id in totals.agents) {
    var s   = totals.agents[id];
    var svc = s.team.indexOf('service') !== -1;
    var callPts = s.placed*(svc?0.25:1) + s.answered*(svc?5:1) + s.talkMin*0.1 + s.avgMin*2;
    var gross   = Math.round(callPts);
    var deduct  = Math.round(rwMissed*(-3) + rwVm*(-2));
    scored.push({
      agentId:id, name:s.name, team:s.team,
      gross:gross, deduct:deduct, total:Math.max(0,gross+deduct),
      placed:s.placed, answered:s.answered, talkMin:s.talkMin, avgMin:s.avgMin
    });
  }
  scored.sort(function(a,b) { return b.total - a.total; });

  for (var i = 0; i < scored.length; i++) {
    var s = scored[i];
    histSheet.appendRow([
      month, i+1, s.agentId, s.name, s.team, s.total, s.gross, s.deduct,
      0, 0, 0, 0, 0, 0,
      s.placed, s.answered, 0, 0, s.talkMin, s.avgMin,
      rwMissed, rwVm
    ]);
  }

  SpreadsheetApp.flush();
  Logger.log('archiveCallStatsToHistorical: archived ' + scored.length + ' agents for ' + month);
  return scored.length;
}

function getOrCreateHistSheet(ss) {
  var s = ss.getSheetByName('HistoricalWins');
  if (!s) {
    s = ss.insertSheet('HistoricalWins');
    s.appendRow(['Month','Rank','AgentID','Name','Team','TotalScore','GrossScore','Deductions',
      'WL','UL','Term','Health','Auto','Fire',
      'Placed','Answered','Missed','Voicemail','TalkMin','AvgMin',
      'RaceWideMissed','RaceWideVoicemail']);
    s.setFrozenRows(1);
  }
  return s;
}

function resetRaceScores(ss) {
  var raceSheet = ss.getSheetByName(RACE_CONFIG.RACE_SHEET);
  if (raceSheet && raceSheet.getLastRow() > 1) {
    var n       = raceSheet.getLastRow() - 1;
    var lastCol = raceSheet.getLastColumn();
    if (lastCol > 3) raceSheet.getRange(2, 4, n, lastCol - 3).clearContent();
  }

  var logSheet = ss.getSheetByName(RACE_CONFIG.LOG_SHEET);
  if (logSheet && logSheet.getLastRow() > 1) {
    logSheet.getRange(2, 1, logSheet.getLastRow()-1, logSheet.getLastColumn()).clearContent();
  }

  var salesLog = ss.getSheetByName(SALES_CONFIG.LOG_SHEET);
  if (salesLog && salesLog.getLastRow() > 1) {
    salesLog.getRange(2, 1, salesLog.getLastRow()-1, salesLog.getLastColumn()).clearContent();
  }

  SpreadsheetApp.flush();
  Logger.log('resetRaceScores: race cleared for new month');
}

function getHistoricalData() {
  var ss        = SpreadsheetApp.openById(getSheetId());
  var histSheet = ss.getSheetByName('HistoricalWins');
  if (!histSheet || histSheet.getLastRow() < 2) return [];
  return histSheet.getDataRange().getValues();
}


// ─────────────────────────────────────────────────────────────
// CALL REPORT UPLOAD
// ─────────────────────────────────────────────────────────────
function processCallUpload(blob) {
  var bytes = blob.getBytes();
  var rows  = [];
  var diagErrors = [];

  var magic    = bytes.length >= 4
    ? [bytes[0] & 0xFF, bytes[1] & 0xFF, bytes[2] & 0xFF, bytes[3] & 0xFF]
    : [];
  var magicHex = magic.map(function(b){ return ('0'+b.toString(16)).slice(-2); }).join(' ');
  var isXlsx   = (magic[0] === 0x50 && magic[1] === 0x4B);
  Logger.log('File bytes: ' + bytes.length + ', magic: ' + magicHex);

  try { rows = parseXlsxBytes(bytes); } catch(e1) { diagErrors.push('Attempt1: ' + e1.message); }

  if (!rows || rows.length === 0) {
    try {
      var driveBytes = getXlsxBytesViaDrive(blob);
      if (driveBytes) rows = parseXlsxBytes(driveBytes);
      else diagErrors.push('Attempt2: Drive upload returned null');
    } catch(e2) { diagErrors.push('Attempt2: ' + e2.message); }
  }

  if (!rows || rows.length === 0) {
    try { rows = readXlsxBlobViaSheets(blob); } catch(e3) { diagErrors.push('Attempt3: ' + e3.message); }
  }

  if (!rows || rows.length === 0)
    return {
      success: false,
      error: 'Could not parse call report. Ensure it is a valid .xlsx file containing a "Call Direction" column.',
      diag: { bytes: bytes.length, magic: magicHex, isXlsx: isXlsx, errors: diagErrors }
    };

  var hasHeader = false;
  for (var r = 0; r < Math.min(rows.length, 20); r++) {
    if (rows[r].join('|').indexOf('Call Direction') !== -1) { hasHeader = true; break; }
  }
  if (!hasHeader)
    return { success: false, error: 'File parsed but no "Call Direction" header found. Make sure you are uploading the Search Call Details report.' };

  // ── Month check ──────────────────────────────────────────────
  var ss         = SpreadsheetApp.openById(getSheetId());
  var dataMonth  = detectMonthFromRows(rows);
  var storedMonth = getCurrentRaceMonth(ss);
  Logger.log('Data month: ' + dataMonth + ' | Stored month: ' + storedMonth);

  if (dataMonth) {
    var now         = new Date();
    var calMonth    = MONTH_NAMES[now.getMonth()] + ' ' + now.getFullYear();
    var isFuture    = compareMonths(dataMonth, calMonth) > 0;

    if (isFuture) {
      return {
        success: false,
        error: 'This file contains data for ' + dataMonth + ', which has not started yet. Upload is not allowed until the month begins.'
      };
    }

    if (storedMonth) {
      var cmp = compareMonths(dataMonth, storedMonth);

      if (cmp > 0) {
        Logger.log('New month detected. Archiving ' + storedMonth + ' -> starting ' + dataMonth);
        archiveToHistorical(ss, storedMonth);
        resetRaceScores(ss);
        setCurrentRaceMonth(ss, dataMonth);

      } else if (cmp < 0) {
        Logger.log('Old month data (' + dataMonth + '). Archiving to historical.');
        var result = classifyCalls(rows, {});
        if (result.newLogRows.length === 0) {
          return { success: true, message: 'No calls found in ' + dataMonth + ' data. Nothing archived.' };
        }
        var oldTotals = aggregateFromLog(result.newLogRows);
        var archivedCount = archiveCallStatsToHistorical(ss, dataMonth, oldTotals);
        return {
          success:  true,
          message:  dataMonth + ' call data archived to Historical Wins (' + archivedCount + ' agents). Current race (' + storedMonth + ') is unchanged.',
          archived: true,
          calls:    result.newLogRows.length,
          raceWide: oldTotals.raceWide,
        };
      }
      // cmp === 0 → same month, continue normally

    } else {
      setCurrentRaceMonth(ss, dataMonth);
    }
  }
  // ─────────────────────────────────────────────────────────────

  var raceSheet = getOrCreateSheet(ss, RACE_CONFIG.RACE_SHEET);
  var logSheet  = getOrCreateSheet(ss, RACE_CONFIG.LOG_SHEET);

  var knownHashes = loadKnownHashes(logSheet);
  var result      = classifyCalls(rows, knownHashes);

  if (result.newLogRows.length === 0)
    return { success: true, message: 'No new calls found — all already logged.', new: 0, skipped: result.duplicatesSkipped };

  appendToLog(logSheet, result.newLogRows);
  var allLogRows = getAllLogRows(logSheet);
  var totals     = aggregateFromLog(allLogRows);
  writeRaceData(raceSheet, totals);

  var ts = Utilities.formatDate(new Date(), 'America/New_York', 'M/d/yyyy h:mm a');
  if (raceSheet.getLastRow() > 1) {
    var n = raceSheet.getLastRow() - 1;
    raceSheet.getRange(2, 16, n, 1).setValue(totals.raceWide.missed);
    raceSheet.getRange(2, 17, n, 1).setValue(totals.raceWide.voicemails);
    raceSheet.getRange(2, 18, n, 1).setValue(ts);
  }
  SpreadsheetApp.flush();

  try {
    var aggregated = aggregateCallData(rows);
    if (aggregated) writeToPerformanceSheet(aggregated);
  } catch(perfErr) {
    Logger.log('Performance sheet write error (non-fatal): ' + perfErr.message);
  }

  var msg = 'Call report processed successfully.';
  if (dataMonth && storedMonth && compareMonths(dataMonth, storedMonth) > 0) {
    msg = 'New month detected (' + dataMonth + '). Previous race archived. ' + msg;
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
// SALES REPORT UPLOAD
// ─────────────────────────────────────────────────────────────
function processSalesUpload(blob) {
  var rows = readXlsBlobAsSheet(blob);
  if (!rows || rows.length === 0)
    return { success: false, error: 'Could not parse sales report. Make sure it is a valid .xls or .xlsx file.' };

  var ss        = SpreadsheetApp.openById(getSheetId());
  var raceSheet = getOrCreateSalesSheet(ss, SALES_CONFIG.RACE_SHEET);
  var logSheet  = getOrCreateSalesSheet(ss, SALES_CONFIG.LOG_SHEET);

  var knownHashes = loadSalesHashes(logSheet);
  var result      = classifySales(rows, knownHashes);

  if (result.newLogRows.length > 0) {
    appendSalesToLog(logSheet, result.newLogRows);
  }

  var allSales = getAllSalesRows(logSheet);
  var totals   = aggregateSalesFromLog(allSales);
  writePolicyTotals(raceSheet, totals);

  var logTotal  = logSheet.getLastRow() - 1;
  var hashCount = Object.keys(loadSalesHashes(logSheet)).length;
  var catCounts = {};
  for (var i = 0; i < allSales.length; i++) {
    var cat = String(allSales[i][2] || 'blank');
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  }
  var polTotal = 0;
  for (var id in totals) {
    var t = totals[id];
    polTotal += (t.wl||0)+(t.ul||0)+(t.term||0)+(t.health||0)+(t.auto||0)+(t.fire||0);
  }

  return {
    success: true,
    message: result.newLogRows.length === 0
      ? 'No new sales found — all already logged. Totals refreshed.'
      : 'Sales report processed successfully.',
    new:     result.newLogRows.length,
    skipped: result.duplicatesSkipped,
    diag: { logRows:logTotal, hashCount:hashCount, allSalesRows:allSales.length, categories:catCounts, polTotal:polTotal },
  };
}


// ─────────────────────────────────────────────────────────────
// XLSX DRIVE ROUND-TRIP (upload attempt 2)
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
// Drive → Sheets conversion (upload attempt 3)
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
      { method:'POST', contentType:'multipart/related; boundary="'+boundary+'"',
        payload:payload, headers:{Authorization:'Bearer '+token}, muteHttpExceptions:true }
    );
    var uploaded = JSON.parse(up.getContentText());
    if (!uploaded.id) { Logger.log('Attempt3 upload failed: '+up.getContentText()); return []; }
    fileId = uploaded.id;

    var ss = null;
    for (var attempt = 1; attempt <= 8; attempt++) {
      Utilities.sleep(attempt * 1500);
      try { ss = SpreadsheetApp.openById(fileId); if (ss) break; } catch(e) {}
    }
    if (!ss) { Logger.log('Attempt3: could not open converted sheet'); return []; }

    var allRows = [];
    var sheets  = ss.getSheets();
    for (var s = 0; s < sheets.length; s++) {
      var data = sheets[s].getDataRange().getValues();
      if (data.length > allRows.length) allRows = data;
    }
    Logger.log('Attempt3 rows from Drive->Sheets: ' + allRows.length);
    return allRows;

  } catch(e) {
    Logger.log('readXlsxBlobViaSheets error: ' + e.message);
    return [];
  } finally {
    if (fileId) { try { DriveApp.getFileById(fileId).setTrashed(true); } catch(e) {} }
  }
}


// ─────────────────────────────────────────────────────────────
// Sales file via Drive → Sheets conversion
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
      try { ss = SpreadsheetApp.openById(fileId); if (ss) break; } catch(e) {}
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
// TEAM UPDATE
// ─────────────────────────────────────────────────────────────
function updateAgentTeam(agentId, team) {
  try {
    var ss        = SpreadsheetApp.openById(getSheetId());
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
