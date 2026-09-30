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
// ============================================================

const PORTAL_MAX_FILE_BYTES = 25 * 1024 * 1024;

function portalDispatch_(e) {
  try {
    const expected = PropertiesService.getScriptProperties().getProperty('PORTAL_TOKEN');
    if (!expected || e.parameter.token !== expected) return portalJson_({ ok: false, error: 'unauthorized' });
    const p = e.parameter.payload ? JSON.parse(e.parameter.payload) : {};
    switch (e.parameter.action) {
      case 'listApplications': return portalJson_({ ok: true, data: portalListApplications_() });
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

function portalFileInfo_(f) {
  return { id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), size: f.getSize(),
           url: f.getUrl(), createdAt: f.getDateCreated().toISOString() };
}

function portalListFiles_(folderIds) {
  const result = {};
  folderIds.forEach(function (id) {
    try {
      const files = [];
      const it = DriveApp.getFolderById(id).getFiles();
      while (it.hasNext()) files.push(portalFileInfo_(it.next()));
      result[id] = files;
    } catch (err) { result[id] = { error: String(err) }; }
  });
  return result;
}

function portalGetFile_(fileId) {
  const f = DriveApp.getFileById(fileId);
  if (f.getSize() > PORTAL_MAX_FILE_BYTES) throw new Error('File too large to preview; open in Drive');
  const blob = f.getBlob();
  return { name: f.getName(), mimeType: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
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
    return { row: row };
  } finally { lock.releaseLock(); }
}

// p = { to, cc?, subject, body, replyTo? }
function portalSendEmail_(p) {
  if (!p.to || !p.subject || !p.body) throw new Error('to, subject and body are required');
  const opts = { name: 'WhiteRock Admissions' };
  if (p.cc) opts.cc = p.cc;
  if (p.replyTo) opts.replyTo = p.replyTo;
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
