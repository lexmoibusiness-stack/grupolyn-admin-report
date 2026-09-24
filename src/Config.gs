/**
 * Config.gs — single source of truth for everything that depends on the
 * template layout or on business rules. If the template changes (a column
 * moves, a tab is renamed, the threshold is renegotiated) only this file
 * needs to be edited.
 */
var LYN_CONFIG = {
  menuName: 'Admin',

  budgetSheetName: 'Monthly Budget',
  layout: {
    yearCell: 'F2',   // selected year  (driven by Lists!S:T)
    monthCell: 'F3',  // selected month (the report always reflects this month)
    sectionCol: 1,    // A — "Income", "Total Income", "Total Expenses", "Cash Flow Position"
    categoryCol: 2,   // B — category headers ("Shelter") and their "Total Shelter" rows
    itemCol: 3,       // C — line items ("Landscaping")
    plannedCol: 4,    // D — month budget
    actualCol: 6      // F — month actual
  },
  // The row in column A that closes the income block. Categories above it are
  // income (more is good); categories below it are expenses/savings/debt.
  incomeEndLabel: 'Total Income',
  // Column-A rows copied into the report footer as the month's bottom line.
  summaryLabels: ['Total Income', 'Total Expenses & Debt Repayment & Savings', 'Cash Flow Position'],

  report: {
    threshold: 0.15,           // |actual - planned| / planned that counts as significant
    minVarianceAmount: 50,     // ...and the gap must be at least this many dollars (avoids "$5 vs $3 = 67%")
    maxDriversPerCategory: 3,  // line items listed under a flagged category
    driverMinShare: 0.10,      // an item must explain >= 10% of its category's gap to be listed
    includeIncome: true,
    hideEmptyCategories: true, // skip categories with $0 planned and $0 actual
    sheetPrefix: 'Admin Report'
  },

  auth: {
    sessionSeconds: 6 * 60 * 60, // unlock lasts 6 h per user per spreadsheet (CacheService max)
    maxAttempts: 5,              // wrong codes before a temporary lockout
    lockoutSeconds: 15 * 60
  }
};
