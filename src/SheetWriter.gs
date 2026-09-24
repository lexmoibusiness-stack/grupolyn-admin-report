/**
 * SheetWriter.gs — renders the report model into its own tab.
 *
 * Layout: one compact row per category (Planned / Actual / Variance / % / Status).
 * Under every flagged category, a few merged note lines are inserted: the
 * headline ("Food & Supplies is over budget by 21.5%.") and the line items
 * responsible for it, highlighted.
 *
 * Values are written in one setValues() call and formats are applied per row
 * kind with RangeLists, so the cost does not grow with one API call per cell.
 */
var LYN_SHEET_COLS = ['Category', 'Planned', 'Actual', 'Variance', 'Variance %', 'Status'];

var LYN_SHEET_STYLE = {
  header:  { background: '#1f3864', fontColor: '#ffffff', fontWeight: 'bold' },
  section: { background: '#d9e1f2', fontWeight: 'bold' },
  flagged: { background: '#fce4d6', fontWeight: 'bold' },
  note:    { fontStyle: 'italic', fontColor: '#843c0c' },
  driver:  { background: '#fff2cc', fontColor: '#7f6000' },
  total:   { fontWeight: 'bold', borderTop: true }
};

function lynWriteReportSheet_(report) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = LYN_CONFIG.report.sheetPrefix + ' - ' + report.period.month + ' ' + report.period.year;
  var sheet = lynFreshSheet_(ss, name);

  var rows = lynBuildSheetRows_(report);
  var width = LYN_SHEET_COLS.length;
  var firstRow = 4;

  sheet.getRange(1, 1).setValue(report.title).setFontSize(14).setFontWeight('bold');
  sheet.getRange(2, 1).setValue(
    'Source: "' + LYN_CONFIG.budgetSheetName + '" tab · Generated ' + report.period.generatedAt +
    ' · Flagged when the gap is ≥ ' + lynPercent_(report.threshold) + ' and ≥ ' + lynMoney_(LYN_CONFIG.report.minVarianceAmount)
  ).setFontColor('#666666');

  sheet.getRange(firstRow, 1, rows.length, width).setValues(rows.map(function (r) { return r.values; }));
  sheet.getRange(firstRow + 1, 2, rows.length - 1, 3).setNumberFormat('$#,##0.00;[Red]-$#,##0.00');
  sheet.getRange(firstRow + 1, 5, rows.length - 1, 1).setNumberFormat('0.0%;[Red]-0.0%');

  var byKind = {};
  rows.forEach(function (r, i) {
    (byKind[r.kind] = byKind[r.kind] || []).push(firstRow + i);
  });
  lynStyleRows_(sheet, byKind, width);

  sheet.setFrozenRows(firstRow);
  sheet.setColumnWidth(1, 260);
  sheet.setColumnWidths(2, 4, 110);
  sheet.setColumnWidth(6, 120);
  sheet.setHiddenGridlines(true);
  ss.setActiveSheet(sheet);
  return sheet;
}

/** Pure: report model -> [{kind, values[6]}]. Kept separate so it can be unit-tested. */
function lynBuildSheetRows_(report) {
  var rows = [{ kind: 'header', values: LYN_SHEET_COLS.slice() }];
  var blank = function (text) { return [text || '', '', '', '', '', '']; };
  var sections = [
    { type: 'income', label: 'Income' },
    { type: 'expense', label: 'Expenses, Savings & Debt' }
  ];

  sections.forEach(function (section) {
    var cats = report.categories.filter(function (c) { return c.type === section.type; });
    if (!cats.length) return;
    rows.push({ kind: 'section', values: blank(section.label) });
    cats.forEach(function (c) {
      rows.push({
        kind: c.significant ? 'flagged' : 'category',
        values: [c.name, c.planned, c.actual, c.variance, c.pct === null ? '' : c.pct, c.status]
      });
      if (c.significant) {
        rows.push({ kind: 'note', values: blank(c.headline) });
        c.drivers.forEach(function (d) { rows.push({ kind: 'driver', values: blank(lynDriverLine_(d)) }); });
        rows.push({ kind: 'spacer', values: blank() });
      }
    });
  });

  if (report.summary.length) {
    rows.push({ kind: 'section', values: blank('Bottom line') });
    report.summary.forEach(function (s) {
      var variance = s.actual - s.planned;
      rows.push({ kind: 'total', values: [s.name, s.planned, s.actual, variance, s.planned ? variance / Math.abs(s.planned) : '', ''] });
    });
  }
  return rows;
}

function lynStyleRows_(sheet, byKind, width) {
  var ranges = function (kind) {
    return (byKind[kind] || []).map(function (r) { return 'A' + r + ':' + String.fromCharCode(64 + width) + r; });
  };
  Object.keys(LYN_SHEET_STYLE).forEach(function (kind) {
    var list = ranges(kind);
    if (!list.length) return;
    var style = LYN_SHEET_STYLE[kind];
    var rl = sheet.getRangeList(list);
    if (style.background) rl.setBackground(style.background);
    if (style.fontColor) rl.setFontColor(style.fontColor);
    if (style.fontWeight) rl.setFontWeight(style.fontWeight);
    if (style.fontStyle) rl.setFontStyle(style.fontStyle);
    if (style.borderTop) rl.setBorder(true, null, null, null, null, null);
  });
  // Note/driver lines are sentences: merge them across the table width.
  ranges('note').concat(ranges('driver')).forEach(function (a1) { sheet.getRange(a1).merge(); });
}

/** Re-running the report for the same month replaces the old tab instead of piling up copies. */
function lynFreshSheet_(ss, name) {
  var existing = ss.getSheetByName(name);
  if (!existing) return ss.insertSheet(name);
  var index = existing.getIndex();
  ss.deleteSheet(existing);
  return ss.insertSheet(name, index - 1);
}
