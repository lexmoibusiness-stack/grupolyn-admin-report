/**
 * Menu.gs — the "Admin" menu and every public entry point.
 *
 * Public functions (no trailing underscore) are the only ones reachable from
 * the menu and from the dialog (google.script.run). Each admin action goes
 * through lynRunAsAdmin_, which re-checks the session on the server.
 *
 * When this code lives in the master library, each client spreadsheet needs a
 * one-line wrapper per entry point (menus and google.script.run only see the
 * bound script). LYN_ENTRY_POINTS + lynClientStubSource() generate those
 * wrappers, so the list exists in exactly one place.
 */
var LYN_ENTRY_POINTS = [
  'lynAdminBuildMenu', 'lynAdminUnlock', 'lynAdminSubmitCode', 'lynAdminSaveCode',
  'lynAdminSetCode', 'lynAdminLock', 'lynAdminReportSheet', 'lynAdminReportEmail'
];

/** Builds (or rebuilds) the Admin menu for the current state. Menus with the same name are replaced. */
function lynAdminBuildMenu() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu(LYN_CONFIG.menuName);

  if (lynIsAdminUnlocked_()) {
    menu.addItem('Monthly Comparative Report → new tab', 'lynAdminReportSheet')
      .addItem('Monthly Comparative Report → Gmail draft', 'lynAdminReportEmail')
      .addSeparator()
      .addItem('Change admin code…', 'lynAdminSetCode')
      .addItem('Lock admin tools', 'lynAdminLock');
  } else {
    menu.addItem('🔒 Unlock admin tools…', 'lynAdminUnlock');
    if (lynCodeMissingSafe_()) menu.addItem('Set up admin code (owner)…', 'lynAdminSetCode');
  }
  menu.addToUi();
}

/** Never lets a Properties error (e.g. restricted trigger context) stop the menu from rendering. */
function lynCodeMissingSafe_() {
  try {
    return !lynIsAdminCodeConfigured_();
  } catch (e) {
    return true; // lynAdminSetCode re-checks on the server anyway
  }
}

function lynAdminUnlock() {
  lynShowCodeDialog_('unlock');
}

/** Called by the dialog. Returns {ok, message}; the dialog shows the message. */
function lynAdminSubmitCode(code) {
  var result = lynVerifyAdminCode_(code);
  if (result.ok) lynAdminBuildMenu();
  return result;
}

function lynAdminSetCode() {
  var ui = SpreadsheetApp.getUi();
  if (lynIsAdminCodeConfigured_() ? !lynIsAdminUnlocked_() : !lynIsOwner_()) {
    ui.alert(lynIsAdminCodeConfigured_()
      ? 'Unlock the admin tools first to change the code.'
      : 'Only the spreadsheet owner can set the admin code for the first time.');
    return;
  }
  lynShowCodeDialog_('set');
}

/** Called by the dialog in "set" mode. Re-checks authorization server-side. */
function lynAdminSaveCode(code, confirmation) {
  var allowed = lynIsAdminCodeConfigured_() ? lynIsAdminUnlocked_() : lynIsOwner_();
  if (!allowed) return { ok: false, message: 'Not authorized.' };
  if (code !== confirmation) return { ok: false, message: 'The two codes do not match.' };
  try {
    lynStoreAdminCode_(code);
  } catch (e) {
    return { ok: false, message: e.message };
  }
  lynLockAdmin_(); // force a fresh unlock with the new code
  lynAdminBuildMenu();
  return { ok: true, message: 'Admin code saved. Use Admin → Unlock to sign in with it.' };
}

function lynAdminLock() {
  lynLockAdmin_();
  lynAdminBuildMenu();
  SpreadsheetApp.getActive().toast('Admin tools locked.', LYN_CONFIG.menuName, 3);
}

function lynAdminReportSheet() {
  lynRunAsAdmin_(function (ui) {
    var report = lynReportForSelectedMonth_();
    var sheet = lynWriteReportSheet_(report);
    ui.alert('Report ready', '"' + sheet.getName() + '" created. ' + report.flagged.length +
      ' categor' + (report.flagged.length === 1 ? 'y' : 'ies') + ' flagged.', ui.ButtonSet.OK);
  });
}

function lynAdminReportEmail() {
  lynRunAsAdmin_(function (ui) {
    var last = lynLastEmail_();
    var answer = ui.prompt('Gmail draft', 'Client email address' + (last ? ' (leave blank for ' + last + ')' : '') + ':', ui.ButtonSet.OK_CANCEL);
    if (answer.getSelectedButton() !== ui.Button.OK) return;

    var recipient = answer.getResponseText().trim() || last;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      ui.alert('Please enter a valid email address.');
      return;
    }
    var report = lynReportForSelectedMonth_();
    lynCreateReportDraft_(report, recipient);
    ui.alert('Draft created', 'A draft to ' + recipient + ' is waiting in Gmail → Drafts. Review it and press Send.', ui.ButtonSet.OK);
  });
}

/** Reads the month currently selected in the budget tab (F3/F2) and builds the report model. */
function lynReportForSelectedMonth_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(LYN_CONFIG.budgetSheetName);
  if (!sheet) throw new Error('Tab "' + LYN_CONFIG.budgetSheetName + '" was not found in this spreadsheet.');

  var parsed = lynParseBudget_(sheet.getDataRange().getValues());
  if (!parsed.categories.length) throw new Error('No budget categories were found in "' + LYN_CONFIG.budgetSheetName + '". Has the template layout changed?');

  return lynBuildReport_(parsed, {
    month: sheet.getRange(LYN_CONFIG.layout.monthCell).getDisplayValue(),
    year: sheet.getRange(LYN_CONFIG.layout.yearCell).getDisplayValue(),
    generatedAt: Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'MMM d, yyyy HH:mm')
  });
}

/** Session check + uniform error handling for every admin action. */
function lynRunAsAdmin_(action) {
  var ui = SpreadsheetApp.getUi();
  if (!lynIsAdminUnlocked_()) {
    lynAdminBuildMenu();
    ui.alert('Your admin session is locked or has expired. Use Admin → Unlock admin tools.');
    return;
  }
  try {
    action(ui);
  } catch (e) {
    console.error(e);
    ui.alert('Something went wrong', e.message, ui.ButtonSet.OK);
  }
}

function lynShowCodeDialog_(mode) {
  var t = HtmlService.createTemplateFromFile('CodeDialog');
  t.mode = mode;
  var html = t.evaluate().setWidth(340).setHeight(mode === 'set' ? 250 : 190);
  SpreadsheetApp.getUi().showModalDialog(html, mode === 'set' ? 'Set admin code' : 'Admin access');
}

/**
 * Source code of the wrapper file injected into each client spreadsheet when
 * this code is served from the master library (see deploy/Deployer.gs).
 * @param {string} librarySymbol  identifier of the library in the client project, e.g. "ProsprScript"
 */
function lynClientStubSource(librarySymbol) {
  var lines = [
    '/**',
    ' * LynAdmin.gs — GENERATED by the LyN deployer. Do not edit by hand:',
    ' * the logic lives in the ' + librarySymbol + ' library; this file only exposes',
    ' * its entry points to the menu and to dialogs.',
    ' */'
  ];
  LYN_ENTRY_POINTS.forEach(function (fn) {
    lines.push('function ' + fn + '(a, b) { return ' + librarySymbol + '.' + fn + '(a, b); }');
  });
  return lines.join('\n') + '\n';
}
