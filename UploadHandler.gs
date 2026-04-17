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


// ─────────────────────────────────────────────────────────────
// CALL REPORT — reuses EmailParser functions
// ─────────────────────────────────────────────────────────────
function processCallUpload(blob) {
  var bytes = blob.getBytes();
  var rows  = [];

  // Attempt 1 — direct bytes (fastest)
  rows = parseXlsxBytes(bytes);

  // Attempt 2 — Drive round-trip (mirrors email path, normalizes bytes)
  if (!rows || rows.length === 0) {
    Logger.log('Direct parse empty — trying Drive round-trip (mirrors email path)');
    var driveBytes = getXlsxBytesViaDrive(blob);
    if (driveBytes) rows = parseXlsxBytes(driveBytes);
  }

  // Attempt 3 — Script 3 parser on original bytes
  if (!rows || rows.length === 0) {
    Logger.log('Drive round-trip empty — trying parseXlsxBytesToRows fallback');
    rows = parseXlsxBytesToRows(bytes);
  }

  if (!rows || rows.length === 0)
    return { success: false, error: 'Could not parse call report. Ensure it is a valid .xlsx file containing a "Call Direction" column.' };

  // Verify the call direction header is present before proceeding
  var hasHeader = false;
  for (var r = 0; r < Math.min(rows.length, 20); r++) {
    if (rows[r].join('|').indexOf('Call Direction') !== -1) { hasHeader = true; break; }
  }
  if (!hasHeader)
    return { success: false, error: 'File parsed but no "Call Direction" header found. Make sure you are uploading the Search Call Details report, not a different file.' };

  var ss        = SpreadsheetApp.openById('1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA');
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

  return {
    success:  true,
    message:  'Call report processed successfully.',
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

  var ss        = SpreadsheetApp.openById('1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA');
  var raceSheet = getOrCreateSalesSheet(ss, SALES_CONFIG.RACE_SHEET);
  var logSheet  = getOrCreateSalesSheet(ss, SALES_CONFIG.LOG_SHEET);

  var knownHashes = loadSalesHashes(logSheet);
  var result      = classifySales(rows, knownHashes);

  if (result.newLogRows.length === 0)
    return { success: true, message: 'No new sales found — all already logged.', new: 0, skipped: result.duplicatesSkipped };

  appendSalesToLog(logSheet, result.newLogRows);
  var allSales = getAllSalesRows(logSheet);
  var totals   = aggregateSalesFromLog(allSales);
  writePolicyTotals(raceSheet, totals);

  return {
    success: true,
    message: 'Sales report processed successfully.',
    new:     result.newLogRows.length,
    skipped: result.duplicatesSkipped,
  };
}


// ─────────────────────────────────────────────────────────────
// Upload xlsx to Drive, download back — mirrors email attachment path
// exactly so parseXlsxBytes receives bytes in the same form it expects.
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
// Blob-based version of readXlsAsSheet (no email attachment needed)
// Uploads blob to Drive for conversion, reads as Spreadsheet, deletes.
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

    // Patch mimeType if Drive didn't auto-convert
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
    var ss        = SpreadsheetApp.openById('1gfqzLbjNgt7KVvhGNETtBB6TN7qMZAK13R_yKh6RMHA');
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
