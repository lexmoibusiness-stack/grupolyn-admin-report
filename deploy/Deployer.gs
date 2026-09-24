/**
 * Deployer.gs — bulk rollout of the Admin tools to client copies (BONUS).
 *
 * Lives in a "LyN Deploy Control" spreadsheet (bound script). That spreadsheet
 * has a "Clients" tab:
 *
 *   A: Spreadsheet URL | B: Bound script ID (optional) | C: Status | D: Library version | E: Last run | F: Detail
 *
 * Model (same pattern the template already uses with ProsprScript):
 *   - ALL logic lives in the master library (ProsprScript). Shipping a change
 *     = edit the library + publish a new version. Clients never hold logic.
 *   - Each client project only needs (1) the library pinned to the target
 *     version and (2) the generated wrapper file LynAdmin.gs, because menus and
 *     google.script.run can only call functions of the bound script.
 *   - The wrapper source comes from the library itself
 *     (ProsprScript.lynClientStubSource), so the list of entry points exists once.
 *
 * Per client row:
 *   1. Preflight: the file opens and has a "Monthly Budget" tab.
 *   2a. Bound script ID known -> GET its content, upsert LynAdmin.gs, pin the
 *       library version in the manifest, PUT it back. Every other file is kept.
 *   2b. Unknown -> create a NEW container-bound project on the spreadsheet with
 *       just the manifest + wrapper + an onOpen that builds the Admin menu.
 *       Additive: the client's existing project is never touched.
 *   3. Write status/version/time back to the row. Rows already at the target
 *      version are skipped, so the job is idempotent and safe to re-run.
 *   4. Stops before the 6-minute limit and schedules itself to continue.
 *
 * Requirements (one-time):
 *   - Apps Script API ON for the deploying account: https://script.google.com/home/usersettings
 *   - This project linked to a standard Google Cloud project with the
 *     "Apps Script API" enabled (Project Settings → Google Cloud Platform project).
 *   - Deploying account has edit access to every client spreadsheet.
 *   - ProsprScript library added to THIS project as well (to read the stub source).
 */
var DEPLOY = {
  librarySymbol: 'ProsprScript',
  libraryScriptId: 'PASTE_MASTER_LIBRARY_SCRIPT_ID',
  targetVersion: 0,                 // version number published in the master library
  clientsSheet: 'Clients',
  stubFileName: 'LynAdmin',
  projectTitle: 'LyN Admin Tools',
  requiredScopes: [                 // merged only when a client manifest lists scopes explicitly
    'https://www.googleapis.com/auth/spreadsheets.currentonly',
    'https://www.googleapis.com/auth/script.container.ui',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://mail.google.com/'
  ],
  maxRunMillis: 4.5 * 60 * 1000,
  api: 'https://script.googleapis.com/v1/projects'
};
var COL = { url: 1, scriptId: 2, status: 3, version: 4, lastRun: 5, detail: 6 };

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Deploy')
    .addItem('Deploy Admin tools to all clients', 'deployAll')
    .addItem('Deploy to selected rows only', 'deploySelected')
    .addToUi();
}

function deployAll() { runDeployment_(null); }

function deploySelected() {
  var range = SpreadsheetApp.getActiveRange();
  var rows = [];
  for (var r = range.getRow(); r <= range.getLastRow(); r++) if (r > 1) rows.push(r);
  runDeployment_(rows);
}

/** Trigger target used to resume a run that hit the time limit. */
function deployContinue() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'deployContinue'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  runDeployment_(null);
}

function runDeployment_(onlyRows) {
  if (!DEPLOY.targetVersion) throw new Error('Set DEPLOY.targetVersion to the published library version first.');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Another deployment is already running.');

  try {
    var sheet = SpreadsheetApp.getActive().getSheetByName(DEPLOY.clientsSheet);
    var data = sheet.getDataRange().getValues();
    var stubSource = ProsprScript.lynClientStubSource(DEPLOY.librarySymbol);
    var started = Date.now();
    var done = 0, failed = 0, skipped = 0;

    for (var i = 1; i < data.length; i++) {
      var rowNum = i + 1;
      if (onlyRows && onlyRows.indexOf(rowNum) === -1) continue;
      var row = data[i];
      if (!row[COL.url - 1]) continue;
      if (row[COL.status - 1] === 'OK' && Number(row[COL.version - 1]) === DEPLOY.targetVersion) { skipped++; continue; }

      if (Date.now() - started > DEPLOY.maxRunMillis) {
        ScriptApp.newTrigger('deployContinue').timeBased().after(60 * 1000).create();
        SpreadsheetApp.getActive().toast('Time limit reached — continuing automatically in 1 minute.', 'Deploy');
        return;
      }

      var result = deployOne_(String(row[COL.url - 1]), String(row[COL.scriptId - 1] || ''), stubSource);
      sheet.getRange(rowNum, COL.scriptId, 1, 5).setValues([[
        result.scriptId || row[COL.scriptId - 1] || '',
        result.ok ? 'OK' : 'ERROR',
        result.ok ? DEPLOY.targetVersion : row[COL.version - 1],
        new Date(),
        result.detail
      ]]);
      SpreadsheetApp.flush(); // progress survives a crash mid-run
      result.ok ? done++ : failed++;
    }
    SpreadsheetApp.getActive().toast(done + ' deployed, ' + skipped + ' already up to date, ' + failed + ' failed.', 'Deploy', 10);
  } finally {
    lock.releaseLock();
  }
}

/** @return {{ok: boolean, scriptId: string, detail: string}} — never throws. */
function deployOne_(url, scriptId, stubSource) {
  try {
    var ssId = spreadsheetIdFromUrl_(url);
    var ss = SpreadsheetApp.openById(ssId);
    if (!ss.getSheetByName('Monthly Budget')) {
      return { ok: false, scriptId: scriptId, detail: 'Not a plan template: no "Monthly Budget" tab.' };
    }

    if (scriptId) {
      var content = api_('get', '/' + scriptId + '/content');
      var files = upsertFile_(content.files, { name: DEPLOY.stubFileName, type: 'SERVER_JS', source: stubSource });
      files = files.map(function (f) { return f.name === 'appsscript' ? { name: f.name, type: f.type, source: patchManifest_(f.source) } : f; });
      api_('put', '/' + scriptId + '/content', { files: files });
      return { ok: true, scriptId: scriptId, detail: 'Updated existing project "' + ss.getName() + '".' };
    }

    var created = api_('post', '', { title: DEPLOY.projectTitle, parentId: ssId });
    api_('put', '/' + created.scriptId + '/content', {
      files: [
        { name: 'appsscript', type: 'JSON', source: patchManifest_('{"timeZone":"' + ss.getSpreadsheetTimeZone() + '","runtimeVersion":"V8"}') },
        { name: DEPLOY.stubFileName, type: 'SERVER_JS', source: stubSource },
        { name: 'LynAdminTrigger', type: 'SERVER_JS', source: 'function onOpen(e) { ' + DEPLOY.librarySymbol + '.lynAdminBuildMenu(); }\n' }
      ]
    });
    return { ok: true, scriptId: created.scriptId, detail: 'Created bound project on "' + ss.getName() + '".' };
  } catch (e) {
    return { ok: false, scriptId: scriptId, detail: String(e.message || e).slice(0, 500) };
  }
}

/** Pins the master library to the target version; merges scopes only if the manifest declares them. */
function patchManifest_(source) {
  var manifest = JSON.parse(source);
  manifest.dependencies = manifest.dependencies || {};
  var libs = manifest.dependencies.libraries = manifest.dependencies.libraries || [];
  var lib = libs.filter(function (l) { return l.userSymbol === DEPLOY.librarySymbol; })[0];
  if (!lib) {
    lib = { userSymbol: DEPLOY.librarySymbol, libraryId: DEPLOY.libraryScriptId };
    libs.push(lib);
  }
  lib.version = String(DEPLOY.targetVersion);
  lib.developmentMode = false;

  if (manifest.oauthScopes) {
    DEPLOY.requiredScopes.forEach(function (s) {
      if (manifest.oauthScopes.indexOf(s) === -1) manifest.oauthScopes.push(s);
    });
  }
  return JSON.stringify(manifest, null, 2);
}

/** Keeps every other file (only name/type/source: GET returns read-only metadata PUT does not need). */
function upsertFile_(files, file) {
  var out = (files || [])
    .filter(function (f) { return f.name !== file.name; })
    .map(function (f) { return { name: f.name, type: f.type, source: f.source }; });
  out.push(file);
  return out;
}

function spreadsheetIdFromUrl_(url) {
  var m = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(url) || /^([a-zA-Z0-9-_]{25,})$/.exec(url.trim());
  if (!m) throw new Error('Not a Google Sheets URL: ' + url);
  return m[1];
}

/** Thin wrapper over the Apps Script API with retries on quota / transient errors. */
function api_(method, path, body) {
  var options = {
    method: method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  };
  if (body) options.payload = JSON.stringify(body);

  for (var attempt = 0; attempt < 4; attempt++) {
    var res = UrlFetchApp.fetch(DEPLOY.api + path, options);
    var code = res.getResponseCode();
    if (code < 300) return JSON.parse(res.getContentText() || '{}');
    if (code !== 429 && code < 500) throw new Error('Apps Script API ' + code + ': ' + res.getContentText().slice(0, 300));
    Utilities.sleep(Math.pow(2, attempt) * 1000);
  }
  throw new Error('Apps Script API kept failing (' + code + ') for ' + method.toUpperCase() + ' ' + path);
}
