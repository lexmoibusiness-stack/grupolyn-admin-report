/**
 * SelfTest.gs — end-to-end check runnable from the Apps Script editor
 * (select "lynSelfTest" and press Run). Exercises everything that does not
 * need the menu: reads "Monthly Budget", applies the report rules, writes the
 * report tab and creates a Gmail draft addressed to yourself. See the log.
 *
 * Menus and dialogs have no UI context when run from the editor
 * ("Cannot call SpreadsheetApp.getUi() from this context"), so those are
 * tested from the spreadsheet itself. This skips the admin check on purpose:
 * anyone who can run code from the editor can already edit the code.
 */
function lynSelfTest() {
  var report = lynReportForSelectedMonth_();
  console.log('1/3 Report built: ' + report.categories.length + ' categories, ' + report.flagged.length + ' flagged.');
  console.log(lynRenderPlainText_(report));

  var sheet = lynWriteReportSheet_(report);
  console.log('2/3 Report tab written: "' + sheet.getName() + '".');

  var me = Session.getActiveUser().getEmail();
  lynCreateReportDraft_(report, me);
  console.log('3/3 Gmail draft created for ' + me + ' (Gmail → Drafts).');
}
