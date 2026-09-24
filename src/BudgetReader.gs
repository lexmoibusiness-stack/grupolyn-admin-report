/**
 * BudgetReader.gs — turns the raw "Monthly Budget" grid into plain data.
 *
 * Pure function (no Apps Script services) so it can be unit-tested outside
 * Google with a snapshot of the sheet.
 *
 * The template is read by its labels, not by fixed row numbers:
 *   column B "Shelter"          -> opens a category
 *   column C "Landscaping"      -> line item of the open category
 *   column B "Total Shelter"    -> closes it; its D/F values are the category totals
 *   column A "Total Income"     -> everything after it is expense / savings / debt
 * so adding or removing line items in a client copy does not break the report.
 */

/**
 * @param {Array<Array<*>>} values  sheet.getDataRange().getValues()
 * @return {{categories: Array<Object>, summary: Array<Object>}}
 */
function lynParseBudget_(values) {
  var L = LYN_CONFIG.layout;
  var categories = [];
  var summary = [];
  var current = null;
  var type = 'income';

  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var section = lynText_(row[L.sectionCol - 1]);
    var category = lynText_(row[L.categoryCol - 1]);
    var item = lynText_(row[L.itemCol - 1]);
    var planned = lynNumber_(row[L.plannedCol - 1]);
    var actual = lynNumber_(row[L.actualCol - 1]);

    if (section) {
      if (LYN_CONFIG.summaryLabels.indexOf(section) !== -1) {
        summary.push({ name: section, planned: planned, actual: actual });
      }
      if (section === LYN_CONFIG.incomeEndLabel) type = 'expense';
      continue;
    }

    if (category) {
      if (/^Total\b/i.test(category)) {
        if (current) {
          current.planned = planned; // trust the template's own subtotal formulas
          current.actual = actual;
          categories.push(current);
          current = null;
        }
      } else {
        current = { name: category, type: type, row: r + 1, items: [] };
      }
      continue;
    }

    if (item && current) {
      current.items.push({ name: item, planned: planned, actual: actual, row: r + 1 });
    }
  }
  return { categories: categories, summary: summary };
}

function lynText_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function lynNumber_(v) {
  var n = typeof v === 'number' ? v : parseFloat(v);
  return isFinite(n) ? n : 0;
}
