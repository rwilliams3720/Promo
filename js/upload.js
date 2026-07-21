// ── FILE UPLOAD ───────────────────────────────────────────────────────────────
function dzDragOver(e, id) {
  e.preventDefault();
  document.getElementById(id).classList.add('drag-over');
}
function dzDragLeave(id) {
  document.getElementById(id).classList.remove('drag-over');
}
function dzDrop(e, type) {
  e.preventDefault();
  const id = 'dz-' + type;
  document.getElementById(id).classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const input = document.getElementById('fi-' + type);
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  handleFile(type, input);
}

function handleFile(type, input) {
  if (_acctStatus === 'past_due' || _acctStatus === 'cancelled') return;
  if (_uploadInProgress) return;
  const file = input.files[0];
  if (!file) return;

  _uploadInProgress = true;
  ['calls','sales'].forEach(t => { const fi = document.getElementById('fi-'+t); if (fi) fi.disabled = true; });

  const logEl = document.getElementById('ul-' + type);
  logEl.innerHTML = '<span>Reading file…</span>';

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      // Send raw file as base64 — much smaller than JSON-encoding the parsed rows
      const bytes = new Uint8Array(e.target.result);
      let binary = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.byteLength; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
      }
      const fileBase64 = btoa(binary);
      logEl.innerHTML = `<span>Uploading…</span>`;

      const hdrs    = authHeaders();
      const payload = { type, fileBase64 };
      if (_columnMap && Object.keys(_columnMap).length) payload.columnMap = _columnMap;

      const res  = await fetch('/api/upload', {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (json.needsMapping) {
        _pendingUploadData = fileBase64;
        _pendingUploadType = type;
        openColMapper(json.headers, json.suggestedMap);
        logEl.innerHTML = '<span class="warn">Column mapping required — see modal.</span>';
        return;
      }

      if (json.needsMonthConfirm) {
        _pendingUploadData = fileBase64;
        _pendingUploadType = type;
        openNewMonthConfirmModal(json.uploadedMonth, json.currentMonth);
        logEl.innerHTML = `<span class="warn">New month detected (${json.uploadedMonth}) — confirm to proceed.</span>`;
        return;
      }

      if (json.needsTypeMapping) {
        _pendingUploadData = fileBase64;
        _pendingUploadType = type;
        openTypeMapper(json.unknownTypes);
        logEl.innerHTML = '<span class="warn">Policy type classification required — see modal.</span>';
        return;
      }

      if (!res.ok || json.success === false) {
        logEl.innerHTML = `<span class="err">Error: ${json.error || 'Upload failed'}</span>`;
        return;
      }

      if (json.archived) {
        logEl.innerHTML = `<span class="warn">${json.message}</span>`
          + `<br><span class="warn">Historical data saved — live race and current month unchanged.</span>`;
        return;
      }

      logEl.innerHTML = `<span class="ok">${json.message || 'Upload complete'}</span>`
        + (json.new != null ? `<br><span>${json.new} new record${json.new !== 1 ? 's' : ''} inserted</span>` : '')
        + (json.skipped ? `<br><span class="warn">${json.skipped} duplicate${json.skipped !== 1 ? 's' : ''} skipped</span>` : '');

      await _supabase.from('race_config').upsert(
        { user_id: _dataUserId, key: 'last_upload_at', value: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );
      await loadRaceData();
      if (type === 'sales' && _raceData.length > 0) {
        const hasCallData = _raceData.some(ag => (ag.placed||0) + (ag.answered||0) > 0);
        if (!hasCallData) logEl.innerHTML += '<br><span class="warn">No call data on file — upload a call report to show full standings.</span>';
      }
      if (type === 'calls' && typeof loadPerf === 'function' && document.getElementById('perf-body')) {
        await loadPerf();
      }
    } catch(err) {
      document.getElementById('ul-' + type).innerHTML = `<span class="err">Error: ${err.message}</span>`;
    } finally {
      _uploadInProgress = false;
      ['calls','sales'].forEach(t => { const fi = document.getElementById('fi-'+t); if (fi) fi.disabled = false; });
    }
  };
  reader.readAsArrayBuffer(file);
  input.value = '';
}

// ── NEW MONTH CONFIRM MODAL ───────────────────────────────────────────────────

function openNewMonthConfirmModal(uploadedMonth, currentMonth) {
  document.getElementById('new-month-confirm-body').innerHTML =
    `A new month was detected in your upload: <strong>${escHtml(uploadedMonth)}</strong>.<br><br>` +
    `Proceeding will automatically <strong>archive ${escHtml(currentMonth || 'the current month')}'s calls</strong> ` +
    `and reset the race for ${escHtml(uploadedMonth)}. Any current month data not yet archived will be saved to history.`;
  document.getElementById('new-month-confirm-modal').style.display = 'flex';
}

function cancelNewMonthUpload() {
  document.getElementById('new-month-confirm-modal').style.display = 'none';
  _pendingUploadData = null; _pendingUploadType = null;
  _uploadInProgress = false;
  ['calls','sales'].forEach(t => { const fi = document.getElementById('fi-'+t); if (fi) fi.disabled = false; });
}

async function confirmNewMonthUpload() {
  document.getElementById('new-month-confirm-modal').style.display = 'none';
  const type = _pendingUploadType;
  const raw  = _pendingUploadData;
  if (!type || !raw) return;
  _pendingUploadData = null; _pendingUploadType = null;

  const logEl = document.getElementById('ul-' + type);
  logEl.innerHTML = '<span>Uploading with new month confirmed…</span>';
  try {
    const hdrs    = authHeaders();
    const payload = { type, fileBase64: raw, confirmNewMonth: true };
    if (_columnMap && Object.keys(_columnMap).length) payload.columnMap = _columnMap;
    const res  = await fetch('/api/upload', { method: 'POST', headers: { ...hdrs, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      logEl.innerHTML = `<span class="err">Error: ${json.error || 'Upload failed'}</span>`; return;
    }
    logEl.innerHTML = `<span class="ok">${json.message || 'Upload complete'}</span>`
      + (json.new != null ? `<br><span>${json.new} new record${json.new !== 1 ? 's' : ''} inserted</span>` : '');
    await _supabase.from('race_config').upsert(
      { user_id: _dataUserId, key: 'last_upload_at', value: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
    await loadRaceData();
    await loadHistory();
  } catch(err) {
    logEl.innerHTML = `<span class="err">Error: ${err.message}</span>`;
  } finally {
    _uploadInProgress = false;
    ['calls','sales'].forEach(t => { const fi = document.getElementById('fi-'+t); if (fi) fi.disabled = false; });
  }
}

// ── COLUMN MAPPER MODAL ───────────────────────────────────────────────────────
const REQUIRED_FIELDS = new Set(['product', 'written_by', 'written_date']);

function openColMapper(headers, suggestedMap) {
  suggestedMap = suggestedMap || {};
  const container = document.getElementById('col-mapper-fields');
  container.innerHTML = COL_FIELDS.map(field => {
    const suggested = suggestedMap[field] || '';
    const required  = REQUIRED_FIELDS.has(field);
    return `
    <div class="modal-field">
      <div class="field-label-row">
        <label>${FIELD_LABELS[field] || field}${required ? ' <span style="color:var(--accent2)">*</span>' : ''}</label>
        ${FIELD_HINTS[field] ? `<span class="info-tip" data-tip="${FIELD_HINTS[field]}">i</span>` : ''}
      </div>
      <select class="admin-select" id="cm-${field}" style="width:100%;padding:9px 12px;font-size:13px;">
        <option value="">— not mapped —</option>
        ${(headers||[]).map(h => `<option value="${h}"${h === suggested ? ' selected' : ''}>${h}</option>`).join('')}
      </select>
    </div>`;
  }).join('');
  document.getElementById('col-mapper-modal').classList.add('open');
}

function closeColMapper() {
  document.getElementById('col-mapper-modal').classList.remove('open');
  _pendingUploadData = null;
  _pendingUploadType = null;
}

// ── TYPE MAPPER MODAL ─────────────────────────────────────────────────────────
function getCategoryOptions() {
  return [
    ['',       '— skip —'],
    ['wl',     'Whole Life (WL)'],
    ['ul',     'Universal Life (UL)'],
    ['term',   'Term'],
    ['health', 'Health'],
    ['auto',   'Auto'],
    ['fire',   'Fire / Property'],
    ['deposit', CAT_LABELS.deposit],
    ['other',   CAT_LABELS.other],
    ['other2',  CAT_LABELS.other2],
    ['other3',  CAT_LABELS.other3],
    ['other4',  CAT_LABELS.other4],
    ['other5',  CAT_LABELS.other5],
  ];
}

function openTypeMapper(unknownTypes) {
  _pendingUnknownTypes = unknownTypes;
  const container = document.getElementById('type-mapper-fields');
  container.innerHTML = unknownTypes.map(({ product, polType, count }, idx) => `
    <div class="modal-field">
      <div class="field-label-row">
        <label>${product}${polType ? ' — ' + polType : ''} <span style="color:var(--muted);font-size:12px">(${count} ${count === 1 ? 'row' : 'rows'})</span></label>
      </div>
      <select class="admin-select" data-idx="${idx}" style="width:100%;padding:9px 12px;font-size:13px;">
        ${getCategoryOptions().map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
      </select>
    </div>`).join('');
  document.getElementById('type-mapper-modal').classList.add('open');
}

function closeTypeMapper() {
  document.getElementById('type-mapper-modal').classList.remove('open');
  _pendingUploadData   = null;
  _pendingUploadType   = null;
  _pendingUnknownTypes = null;
}

async function submitTypeMapper() {
  const types = {};
  document.querySelectorAll('#type-mapper-fields select').forEach(sel => {
    const { product, polType } = _pendingUnknownTypes[parseInt(sel.dataset.idx)];
    if (sel.value) types[product + '|' + polType] = sel.value;
  });

  _columnMap._types = { ...(_columnMap._types || {}), ...types };
  await _supabase.from('accounts').update({ sales_column_map: _columnMap }).eq('user_id', _userId);

  const pendingData = _pendingUploadData;
  const pendingType = _pendingUploadType;
  closeTypeMapper();

  if (!pendingData || !pendingType) return;
  const logEl = document.getElementById('ul-' + pendingType);
  try {
    const hdrs = authHeaders();
    const res  = await fetch('/api/upload', {
      method: 'POST',
      headers: { ...hdrs, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: pendingType, fileBase64: pendingData, columnMap: _columnMap }),
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
      logEl.innerHTML = `<span class="err">Error: ${json.error || 'Upload failed'}</span>`;
      return;
    }
    logEl.innerHTML = `<span class="ok">${json.message || 'Upload complete'}</span>`
      + (json.new != null ? `<br><span>${json.new} new record${json.new !== 1 ? 's' : ''} inserted</span>` : '')
      + (json.skipped ? `<br><span class="warn">${json.skipped} duplicate${json.skipped !== 1 ? 's' : ''} skipped</span>` : '');
    await _supabase.from('race_config').upsert(
      { user_id: _dataUserId, key: 'last_upload_at', value: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
    await loadRaceData();
  } catch(err) {
    logEl.innerHTML = `<span class="err">Error: ${err.message}</span>`;
  } finally {
    _uploadInProgress = false;
    ['calls','sales'].forEach(t => { const fi = document.getElementById('fi-'+t); if (fi) fi.disabled = false; });
  }
}

async function submitColMapper() {
  const map = {};
  COL_FIELDS.forEach(f => {
    const sel = document.getElementById('cm-' + f);
    if (sel && sel.value) map[f] = sel.value;
  });
  _columnMap = { ..._columnMap, ...map };

  await _supabase.from('accounts')
    .update({ sales_column_map: _columnMap })
    .eq('user_id', _userId);

  const pendingData = _pendingUploadData;
  const pendingType = _pendingUploadType;
  closeColMapper();

  if (pendingData && pendingType) {
    const logEl = document.getElementById('ul-' + pendingType);
    try {
      const hdrs = authHeaders();
      const res  = await fetch('/api/upload', {
        method: 'POST',
        headers: { ...hdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: pendingType, fileBase64: pendingData, columnMap: _columnMap }),
      });
      const json = await res.json();
      if (!res.ok || json.success === false) { logEl.innerHTML = `<span class="err">Error: ${json.error || 'Upload failed'}</span>`; return; }
      logEl.innerHTML = `<span class="ok">${json.message || 'Upload complete after mapping.'}</span>`;
      await _supabase.from('race_config').upsert(
        { user_id: _dataUserId, key: 'last_upload_at', value: new Date().toISOString() },
        { onConflict: 'user_id,key' }
      );
      await loadRaceData();
    } catch(err) {
      logEl.innerHTML = `<span class="err">Error: ${err.message}</span>`;
    }
  }
}

