// ============================================================
// WHITEROCK PORTAL API  — add this as a NEW file (PortalApi.gs)
// in the SAME Apps Script project as your existing doPost.
//
// It lets the staff portal (server-side only) read the Applications
// sheet, list/download/upload Drive files, write status/counselor/notes
// back to the sheet, and send counselor emails from your Gmail.
//
// SETUP
// 1. Project Settings > Script properties > add PORTAL_TOKEN = <long random string>
//    (same value goes in the portal's APPS_SCRIPT_TOKEN env var).
// 2. Optional: add PORTAL_WEBHOOK_URL = https://<portal>/api/sync and
//    PORTAL_WEBHOOK_SECRET = <portal CRON_SECRET> so the portal syncs the
//    moment a new application arrives.
// 3. At the very top of your existing doPost(e) add:
//        if (e && e.parameter && e.parameter.action) return portalDispatch_(e);
//    and at the end of a successful submission (before `return`), add:
//        notifyPortal_();
// 4. Deploy > Manage deployments > edit > New version (Execute as: Me,
//    Who has access: Anyone). The token is what protects it.
// ========================================--====================

const PORTAL_MAX_FILE_BYTES = 25 * 1024 * 1024;
// The hand-maintained sheet (tab name). Only columns A..N are read; the
// pipeline legend in columns O..Q is ignored.
const MASTER_SHEET_NAME = 'Sheet1';
// Regent / CCCU tracking tab (name is matched ignoring case and stray spaces).
const REGENT_SHEET_NAME = 'Regent Only';

function portalTab_(name) {
  const want = String(name).trim().toLowerCase();
  const tabs = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets();
  for (let i = 0; i < tabs.length; i++) if (tabs[i].getName().trim().toLowerCase() === want) return tabs[i];
  throw new Error('Tab "' + name + '" not found');
}

function portalDispatch_(e) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN');
    if (!expected || e.parameter.token !== expected) return portalJson_({ ok: false, error: 'unauthorized' });
    const p = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    switch (e.parameter.action) {
      case 'listApplications': return portalJson_({ ok: true, data: portalListApplications_() });
      case 'listMaster':       return portalJson_({ ok: true, data: portalListMaster_() });
      case 'updateMaster':     return portalJson_({ ok: true, data: portalUpdateMaster_(p) });
      case 'addMaster':        return portalJson_({ ok: true, data: portalAddMaster_(p) });
      case 'listRegent':       return portalJson_({ ok: true, data: portalListRegent_() });
      case 'extractText':      return portalJson_({ ok: true, data: portalExtractText_(p.fileId) });
      case 'extractFull':      return portalJson_({ ok: true, data: portalExtractFull_(p.fileId) });
      case 'aiChat':           return portalJson_({ ok: true, data: portalAiChat_(p) });
      case 'searchFolders':    return portalJson_({ ok: true, data: portalSearchFolders_(p.students || []) });
      case 'updateRegent':     return portalJson_({ ok: true, data: portalUpdateRegent_(p) });
      case 'listFiles':        return portalJson_({ ok: true, data: portalListFiles_(p.folderIds || []) });
      case 'getFile':          return portalJson_({ ok: true, data: portalGetFile_(p.fileId) });
      case 'uploadFile':       return portalJson_({ ok: true, data: portalUploadFile_(p) });
      case 'updateRow':        return portalJson_({ ok: true, data: portalUpdateRow_(p) });
      case 'sendEmail':        return portalJson_({ ok: true, data: portalSendEmail_(p) });
      default: return portalJson_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return portalJson_({ ok: false, error: String(err) });
  }
}

function portalJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function portalHeaders_(sheet) {
  const map = {};
  sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].forEach(function (h, i) { map[String(h).trim()] = i + 1; });
  return map;
}

// Returns every application row. Rows created before the ID patch get an
// Application ID + Drive Folder ID backfilled (folder id parsed from the
// "Open Drive Folder" hyperlink formula).
function portalListApplications_() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getApplicationsSheet_();
    const last = sheet.getLastRow();
    if (last < 2) return [];
    const H = portalHeaders_(sheet);
    const width = sheet.getLastColumn();
    const values = sheet.getRange(2, 1, last - 1, width).getValues();
    const formulas = sheet.getRange(2, H['Drive Folder'], last - 1, 1).getFormulas();
    const out = [];
    values.forEach(function (r, i) {
      if (!r[H['Name'] - 1] && !r[H['Email'] - 1]) return;
      const rowNum = i + 2;
      let appId = r[H['Application ID'] - 1];
      let folderId = r[H['Drive Folder ID'] - 1];
      if (!appId) { appId = Utilities.getUuid(); sheet.getRange(rowNum, H['Application ID']).setValue(appId); }
      if (!folderId) {
        const m = /folders\/([A-Za-z0-9_-]+)/.exec(formulas[i][0] || '');
        if (m) { folderId = m[1]; sheet.getRange(rowNum, H['Drive Folder ID']).setValue(folderId); }
      }
      const sub = r[H['Submission Date'] - 1];
      out.push({
        applicationId: String(appId),
        row: rowNum,
        submittedAt: sub instanceof Date ? sub.toISOString() : String(sub || ''),
        name: r[H['Name'] - 1], email: r[H['Email'] - 1], phone: String(r[H['Phone'] - 1] || ''),
        school: r[H['School'] - 1], programme: r[H['Programme'] - 1], country: r[H['Country'] - 1],
        city: r[H['City'] - 1], gender: r[H['Gender'] - 1], dob: String(r[H['Date of Birth'] - 1] || ''),
        age: String(r[H['Age'] - 1] || ''), counselor: r[H['Counselor'] - 1],
        status: r[H['Application Status'] - 1], notes: r[H['Notes'] - 1],
        driveFolderId: folderId ? String(folderId) : ''
      });
    });
    return out;
  } finally { lock.releaseLock(); }
}

function portalFileInfo_(f, path) {
  return { id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), size: f.getSize(),
           url: f.getUrl(), createdAt: f.getDateCreated().toISOString(), path: path || '' };
}

// Files in the student's folder plus one level of subfolders.
function portalCollect_(folder, path, depth, out) {
  const it = folder.getFiles();
  while (it.hasNext()) out.push(portalFileInfo_(it.next(), path));
  if (depth > 0) {
    const subs = folder.getFolders();
    while (subs.hasNext()) { const sf = subs.next(); portalCollect_(sf, (path ? path + '/' : '') + sf.getName(), depth - 1, out); }
  }
}

function portalListFiles_(folderIds) {
  const result = {};
  folderIds.forEach(function (id) {
    try {
      const files = [];
      portalCollect_(DriveApp.getFolderById(id), '', 1, files);
      result[id] = files;
    } catch (err) { result[id] = { error: String(err) }; }
  });
  return result;
}

function portalGetFile_(fileId) {
  const f = DriveApp.getFileById(fileId);
  const mime = f.getMimeType();
  // Google Docs / Sheets / Slides can't be downloaded as-is: export to PDF.
  const native = mime.indexOf('application/vnd.google-apps') === 0;
  const blob = native ? f.getAs('application/pdf') : f.getBlob();
  const bytes = blob.getBytes();
  if (bytes.length > PORTAL_MAX_FILE_BYTES) throw new Error('File too large to preview; open in Drive');
  return { name: native ? f.getName() + '.pdf' : f.getName(), mimeType: blob.getContentType(), base64: Utilities.base64Encode(bytes) };
}

function portalUploadFile_(p) {
  const bytes = Utilities.base64Decode(p.base64);
  if (bytes.length > PORTAL_MAX_FILE_BYTES) throw new Error('File too large (25MB max)');
  const folder = DriveApp.getFolderById(p.folderId);
  const file = folder.createFile(Utilities.newBlob(bytes, p.mimeType || 'application/octet-stream', p.name));
  portalRefreshDocLinks_(p.applicationId, folder);
  return portalFileInfo_(file);
}

// Keep the sheet's "Document Links" cell in step with the folder contents.
function portalRefreshDocLinks_(applicationId, folder) {
  if (!applicationId) return;
  const sheet = getApplicationsSheet_();
  const H = portalHeaders_(sheet);
  const row = portalFindRow_(sheet, H, applicationId);
  if (!row) return;
  const links = [];
  const it = folder.getFiles();
  while (it.hasNext()) { const f = it.next(); links.push('HYPERLINK("' + escapeFormula_(f.getUrl()) + '","' + escapeFormula_(f.getName()) + '")'); }
  sheet.getRange(row, H['Document Links']).setFormula(links.length ? '=' + links.join('&CHAR(10)&') : '="No documents"');
}

function portalFindRow_(sheet, H, applicationId) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const ids = sheet.getRange(2, H['Application ID'], last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === String(applicationId)) return i + 2;
  return 0;
}

// p = { applicationId, fields: { status?, counselor?, notes? } }
function portalUpdateRow_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = getApplicationsSheet_();
    const H = portalHeaders_(sheet);
    const row = portalFindRow_(sheet, H, p.applicationId);
    if (!row) throw new Error('Application not found in sheet');
    const map = { status: 'Application Status', counselor: 'Counselor', notes: 'Notes' };
    Object.keys(p.fields || {}).forEach(function (k) {
      if (map[k] && H[map[k]]) sheet.getRange(row, H[map[k]]).setValue(p.fields[k]);
    });
    if (p.notesAppend && H['Notes']) portalAppendNote_(sheet.getRange(row, H['Notes']), p.notesAppend, p.by);
    return { row: row };
  } finally { lock.releaseLock(); }
}

// Never overwrite hand-written notes: add a dated line underneath.
function portalAppendNote_(cell, text, by) {
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd MMM');
  const line = '[' + stamp + (by ? ' ' + String(by).split('@')[0] : '') + '] ' + text;
  const cur = String(cell.getValue() || '');
  cell.setValue(cur ? cur + '\n' + line : line);
}

function portalSchoolKey_(school) {
  const s = String(school || '').toLowerCase();
  if (!s) return '';
  if (/regent|\brcl\b/.test(s)) return 'rcl';
  if (/canterbury|\bcccu\b/.test(s)) return 'cccu';
  if (/\bbpp\b/.test(s)) return 'bpp';
  if (/york st/.test(s)) return 'ysj';
  return s.replace(/[^a-z0-9]+/g, '');
}

function portalCell_(v) { return v instanceof Date ? v.toISOString() : String(v == null ? '' : v); }

// Rows of the hand-maintained master sheet (A..N).
function portalListMaster_() {
  const sheet = portalTab_(MASTER_SHEET_NAME);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const vals = sheet.getRange(2, 1, last - 1, 14).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (!String(r[1]).trim() && !String(r[2]).trim()) return;
    out.push({
      row: i + 2, studentIdOrDate: portalCell_(r[0]), name: portalCell_(r[1]), email: portalCell_(r[2]),
      phone: portalCell_(r[3]), school: portalCell_(r[4]), programme: portalCell_(r[5]), country: portalCell_(r[6]),
      city: portalCell_(r[7]), gender: portalCell_(r[8]), dob: portalCell_(r[9]), age: portalCell_(r[10]),
      counselor: portalCell_(r[11]), status: portalCell_(r[12]).trim(), notes: portalCell_(r[13])
    });
  });
  return out;
}

// Rows of the Regent Only tab (A..O). The legend in P..R is ignored.
function portalListRegent_() {
  const sheet = portalTab_(REGENT_SHEET_NAME);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const vals = sheet.getRange(2, 1, last - 1, 15).getValues();
  const out = [];
  vals.forEach(function (r, i) {
    if (!String(r[1]).trim() && !String(r[2]).trim()) return;
    out.push({
      row: i + 2, date: portalCell_(r[0]), name: portalCell_(r[1]), email: portalCell_(r[2]), phone: portalCell_(r[3]),
      school: portalCell_(r[4]), programme: portalCell_(r[5]), country: portalCell_(r[6]), city: portalCell_(r[7]),
      gender: portalCell_(r[8]), oppId: portalCell_(r[9]).trim(), payment: portalCell_(r[10]).trim(), counselor: portalCell_(r[11]),
      status: portalCell_(r[12]).trim(), notes: portalCell_(r[13]), interview: portalCell_(r[14]).trim()
    });
  });
  return out;
}

// Find a student's row by email (+school); name if there is no email.
function portalFindStudentRow_(sheet, p) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const vals = sheet.getRange(2, 1, last - 1, 5).getValues();
  const email = String(p.email || '').trim().toLowerCase();
  const name = String(p.name || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
  const school = portalSchoolKey_(p.school);
  for (let i = 0; i < vals.length; i++) {
    const rEmail = String(vals[i][2]).trim().toLowerCase();
    const rName = String(vals[i][1]).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    const same = email ? rEmail === email : rName === name;
    const rs = portalSchoolKey_(vals[i][4]);
    if (same && (!school || !rs || rs === school)) return i + 2;
  }
  return 0;
}

// p = { email, name, school, fields: { oppId?, payment?, interview? }, notesAppend?, by? }
function portalUpdateRegent_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = portalTab_(REGENT_SHEET_NAME);
    const row = portalFindStudentRow_(sheet, p);
    if (!row) throw new Error('Student not found in ' + REGENT_SHEET_NAME);
    const f = p.fields || {};
    if (f.oppId !== undefined) sheet.getRange(row, 10).setValue(f.oppId);
    if (f.payment !== undefined) sheet.getRange(row, 11).setValue(f.payment);
    if (f.interview !== undefined) sheet.getRange(row, 15).setValue(f.interview);
    if (p.notesAppend) portalAppendNote_(sheet.getRange(row, 14), p.notesAppend, p.by);
    return { row: row };
  } finally { lock.releaseLock(); }
}

// p = { email, name, school, fields: { status?, counselor? }, notesAppend?, by? }
// The row is found by email (+school) each time, because rows move when
// someone sorts the sheet.
function portalUpdateMaster_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = portalTab_(MASTER_SHEET_NAME);
    const last = sheet.getLastRow();
    const vals = sheet.getRange(2, 1, Math.max(last - 1, 1), 14).getValues();
    const email = String(p.email || '').trim().toLowerCase();
    const name = String(p.name || '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();
    const school = portalSchoolKey_(p.school);
    let row = 0;
    vals.forEach(function (r, i) {
      if (row) return;
      const rEmail = String(r[2]).trim().toLowerCase();
      const rName = String(r[1]).toLowerCase().replace(/[^a-z]+/g, ' ').trim();
      const same = email ? rEmail === email : rName === name;
      const rs = portalSchoolKey_(r[4]);
      if (same && (!school || !rs || rs === school)) row = i + 2;
    });
    if (!row) throw new Error('Student not found in ' + MASTER_SHEET_NAME);
    const f = p.fields || {};
    if (f.status !== undefined) sheet.getRange(row, 13).setValue(f.status);
    if (f.counselor !== undefined) sheet.getRange(row, 12).setValue(f.counselor);
    if (p.notesAppend) portalAppendNote_(sheet.getRange(row, 14), p.notesAppend, p.by);
    return { row: row };
  } finally { lock.releaseLock(); }
}

// p = { date(ISO), name, email, phone, school, programme, country, city, gender, dob, age, counselor, status, notes }
// Appends a student to the bottom of the master sheet (A..N), copying the
// formatting of the row above. Skips students who are already there.
function portalAddMaster_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = portalTab_(MASTER_SHEET_NAME);
    const maxRows = sheet.getMaxRows();
    const names = sheet.getRange(1, 2, maxRows, 1).getValues();
    let last = 1;
    for (let i = names.length - 1; i >= 1; i--) { if (String(names[i][0]).trim()) { last = i + 1; break; } }
    const email = String(p.email || '').trim().toLowerCase();
    const school = portalSchoolKey_(p.school);
    if (last >= 2) {
      const ex = sheet.getRange(2, 1, last - 1, 14).getValues();
      for (let i = 0; i < ex.length; i++) {
        const rs = portalSchoolKey_(ex[i][4]);
        if (email && String(ex[i][2]).trim().toLowerCase() === email && (!school || !rs || rs === school)) return { exists: true, row: i + 2 };
      }
    }
    const row = last + 1;
    if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), 1);
    try { sheet.getRange(last, 1, 1, 14).copyTo(sheet.getRange(row, 1, 1, 14), SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false); } catch (e) {}
    sheet.getRange(row, 4).setNumberFormat('@');   // phone stays text (+234...)
    sheet.getRange(row, 10).setNumberFormat('@');  // date of birth stays dd/mm/yyyy text
    sheet.getRange(row, 1, 1, 14).setValues([[
      p.date ? new Date(p.date) : new Date(), p.name || '', p.email || '', p.phone || '', p.school || '', p.programme || '',
      p.country || '', p.city || '', p.gender || '', p.dob || '', p.age || '', p.counselor || '', p.status || '', p.notes || ''
    ]]);
    return { exists: false, row: row };
  } finally { lock.releaseLock(); }
}

// p = [{ id, name }]  ->  { id: [ { folderId, name, url, parent, score, exact, fileCount, modified } ] }
// Looks for Drive folders whose name contains the student's first and last name.
// Only suggestions are returned; nothing is linked until staff confirm in the portal.
function portalSearchFolders_(students) {
  const out = {};
  students.forEach(function (st) {
    const tokens = String(st.name || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (t) { return t.length >= 3; });
    if (!tokens.length) { out[st.id] = []; return; }
    const keys = tokens.length > 1 ? [tokens[0], tokens[tokens.length - 1]] : [tokens[0]];
    const q = keys.map(function (t) { return "title contains '" + t.replace(/'/g, "\\'") + "'"; }).join(' and ') + ' and trashed = false';
    const cands = [];
    try {
      const it = DriveApp.searchFolders(q);
      while (it.hasNext() && cands.length < 6) {
        const f = it.next();
        const nm = f.getName().toLowerCase();
        const hit = tokens.filter(function (t) { return nm.indexOf(t) >= 0; }).length;
        let count = 0; const fi = f.getFiles(); while (fi.hasNext() && count < 40) { fi.next(); count++; }
        const ps = f.getParents();
        cands.push({ folderId: f.getId(), name: f.getName(), url: f.getUrl(), parent: ps.hasNext() ? ps.next().getName() : '',
                     score: Math.max(hit / tokens.length, 0.7), exact: hit === tokens.length, fileCount: count,
                     modified: f.getLastUpdated().toISOString() });
      }
    } catch (err) { Logger.log('search failed for ' + st.name + ': ' + err); }
    out[st.id] = cands;
  });
  return out;
}

// ---- AI (Qwen) ----------------------------------------------------------
// Script properties used (reuse the ones you already have):
//   QWEN_API_KEY   (or DASHSCOPE_API_KEY)  required
//   QWEN_BASE_URL  default https://dashscope-intl.aliyuncs.com/compatible-mode/v1
//   QWEN_MODEL     default qwen-plus
// p = { system, user, maxTokens?, json? }  ->  { text, model, tokens }
function portalAiChat_(p) {
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty('QWEN_API_KEY') || props.getProperty('DASHSCOPE_API_KEY');
  if (!key) throw new Error('Qwen API key not found: add QWEN_API_KEY to Script properties');
  const base = (props.getProperty('QWEN_BASE_URL') || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '');
  const model = props.getProperty('QWEN_MODEL') || 'qwen-plus';
  const body = {
    model: model,
    messages: [{ role: 'system', content: String(p.system || '') }, { role: 'user', content: String(p.user || '') }],
    temperature: 0.2,
    max_tokens: Math.min(Number(p.maxTokens) || 700, 1200)
  };
  if (p.json) body.response_format = { type: 'json_object' };
  const res = UrlFetchApp.fetch(base + '/chat/completions', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + key },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  const txt = res.getContentText();
  if (code !== 200) throw new Error('Qwen error ' + code + ': ' + txt.slice(0, 200));
  const j = JSON.parse(txt);
  return { text: (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '',
           model: j.model || model, tokens: (j.usage && j.usage.total_tokens) || 0 };
}

// ---- Read text from a document (for the opt-in AI document check) ---------
// Needs the Drive API advanced service: Apps Script > Services (+) > Drive API > Add.
// PDFs, images and Word files are converted to a temporary Google Doc with OCR, read, then deleted.
function portalExtractText_(fileId) {
  const f = DriveApp.getFileById(fileId);
  const mime = f.getMimeType();
  let text = '';
  if (mime === 'application/vnd.google-apps.document') {
    text = DocumentApp.openById(fileId).getBody().getText();
  } else {
    if (f.getSize() > 10 * 1024 * 1024) throw new Error('File too large to read (10MB max)');
    const tmp = Drive.Files.create({ name: 'portal-ocr-temp', mimeType: 'application/vnd.google-apps.document' }, f.getBlob(), { ocrLanguage: 'en' });
    try { text = DocumentApp.openById(tmp.id).getBody().getText(); }
    finally { try { Drive.Files.remove(tmp.id); } catch (e) { Logger.log('temp cleanup failed: ' + e); } }
  }
  text = String(text || '').replace(/\s+/g, ' ').trim();
  return { text: text.slice(0, 5000), chars: text.length };
}

// Full text of one file with its line breaks kept (for the portal's "Extracted text" page).
// Google Docs and plain text are read directly; PDFs, images and Word files go through Drive's OCR / converter.
function portalExtractFull_(fileId) {
  const f = DriveApp.getFileById(fileId);
  const mime = f.getMimeType(), name = f.getName();
  let text = '', method = 'ocr';
  if (mime === 'application/vnd.google-apps.document') {
    text = DocumentApp.openById(fileId).getBody().getText(); method = 'google-doc';
  } else if (/^text\//.test(mime) || /\.(txt|csv|md)$/i.test(name)) {
    text = f.getBlob().getDataAsString('UTF-8'); method = 'text';
  } else {
    if (f.getSize() > 10 * 1024 * 1024) throw new Error('File too large to read (10MB max)');
    const tmp = Drive.Files.create({ name: 'portal-ocr-temp', mimeType: 'application/vnd.google-apps.document' }, f.getBlob(), { ocrLanguage: 'en' });
    try { text = DocumentApp.openById(tmp.id).getBody().getText(); }
    finally { try { Drive.Files.remove(tmp.id); } catch (e) { Logger.log('temp cleanup failed: ' + e); } }
  }
  text = String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const LIMIT = 120000;
  return { text: text.slice(0, LIMIT), chars: text.length, truncated: text.length > LIMIT, method: method };
}

// ---- Background triggers (no edits to your form's doPost needed) -------------
// 1) Paste your portal address + CRON_SECRET below.  2) Run portalInstallTriggers() once.
const PORTAL_SITE_URL = 'https://applications-2026-kohl.vercel.app';  // your portal address
const PORTAL_CRON_SECRET = '';  // the same value as CRON_SECRET in Vercel

function portalInstallTriggers() {
  if (!PORTAL_SITE_URL || !PORTAL_CRON_SECRET) throw new Error('Fill in PORTAL_SITE_URL and PORTAL_CRON_SECRET near the top of this section first.');
  const props = PropertiesService.getScriptProperties();
  props.setProperty('PORTAL_WEBHOOK_URL', PORTAL_SITE_URL.replace(/\/$/, '') + '/api/sync');
  props.setProperty('PORTAL_WEBHOOK_SECRET', PORTAL_CRON_SECRET);
  portalRemoveTriggers();
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  ScriptApp.newTrigger('portalPoll_').timeBased().everyMinutes(1).create();          // tells the portal when new rows or edits appear
  ScriptApp.newTrigger('portalEnforcePrivacy_').timeBased().everyMinutes(10).create(); // makes new student folders private
  ScriptApp.newTrigger('portalOnEdit_').forSpreadsheet(ss).onEdit().create();         // notices manual edits to the sheets
  Logger.log('Installed: instant-update poll (1 min), privacy sweep (10 min), edit watcher.');
}

function portalRemoveTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['portalPoll_', 'portalEnforcePrivacy_', 'portalOnEdit_'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
}

function portalOnEdit_() { PropertiesService.getScriptProperties().setProperty('PORTAL_DIRTY', '1'); }

// Runs every minute: if rows were added or someone edited a sheet, ping the portal to sync now.
function portalPoll_() {
  const props = PropertiesService.getScriptProperties();
  const sig = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets().map(function (s) { return s.getName() + ':' + s.getLastRow(); }).join('|');
  const changed = props.getProperty('PORTAL_SIG') !== sig || props.getProperty('PORTAL_DIRTY') === '1';
  if (!changed) return;
  props.setProperty('PORTAL_SIG', sig);
  props.deleteProperty('PORTAL_DIRTY');
  notifyPortal_();
}

// Runs every 10 minutes: any student folder created in the last day that is still link-shareable becomes private (team-only).
function portalEnforcePrivacy_() {
  const main = getOrCreateFolder_(DRIVE_FOLDER_NAME);
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19);
  const it = main.searchFolders("createdDate > '" + since + "'");
  while (it.hasNext()) {
    const f = it.next();
    if (f.getSharingAccess() === DriveApp.Access.PRIVATE) continue;
    f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    portalShareFolderPrivately_(f);
    const files = f.getFiles();
    while (files.hasNext()) files.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  }
}

// ---- Privacy ----------------------------------------------------------
// Give the team (not the world) access to a student's folder. Call this in
// doPost instead of setSharing(ANYONE_WITH_LINK ...). Files inherit it.
function portalShareFolderPrivately_(folder) {
  const people = SHEET_EDITORS.concat([RECIPIENT_EMAIL]);
  try { folder.addViewers(people); } catch (err) { Logger.log('addViewers failed: ' + err); }
}

// RUN ONCE BY HAND (Run menu) to make every existing submission private.
// Links that were shared earlier with people outside your team stop working.
function lockDownExistingFolders() {
  const main = getOrCreateFolder_(DRIVE_FOLDER_NAME);
  const subs = main.getFolders();
  let n = 0;
  while (subs.hasNext()) {
    const f = subs.next();
    f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    portalShareFolderPrivately_(f);
    const files = f.getFiles();
    while (files.hasNext()) files.next().setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    n++;
  }
  Logger.log('Locked down ' + n + ' folders');
}

// p = { to, cc?, subject, body, htmlBody?, replyTo? }
function portalSendEmail_(p) {
  if (!p.to || !p.subject || !p.body) throw new Error('to, subject and body are required');
  const opts = { name: 'WhiteRock Admissions' };
  if (p.cc) opts.cc = p.cc;
  if (p.replyTo) opts.replyTo = p.replyTo;
  if (p.htmlBody) opts.htmlBody = p.htmlBody;   // designed version; the plain body stays as the fallback
  GmailApp.sendEmail(p.to, p.subject, p.body, opts);
  return { sent: true };
}

// Call at the end of doPost after a successful submission so the portal
// picks the new application up immediately (optional; portal also polls).
function notifyPortal_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const url = props.getProperty('PORTAL_WEBHOOK_URL');
    if (!url) return;
    UrlFetchApp.fetch(url, { method: 'post', muteHttpExceptions: true,
      headers: { Authorization: 'Bearer ' + props.getProperty('PORTAL_WEBHOOK_SECRET') } });
  } catch (err) { Logger.log('notifyPortal_ failed: ' + err); }
}
