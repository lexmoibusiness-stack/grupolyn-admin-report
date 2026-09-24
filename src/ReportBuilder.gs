/**
 * ReportBuilder.gs — business logic of the "Monthly Comparative Report".
 *
 * Builds ONE report model that every output (sheet tab, Gmail draft) renders.
 * Pure functions: no Apps Script services, unit-testable in Node.
 */

/**
 * @param {{categories: Array, summary: Array}} parsed  output of lynParseBudget_
 * @param {{month: string, year: string, generatedAt: string}} period
 * @param {Object=} options  overrides for LYN_CONFIG.report
 */
function lynBuildReport_(parsed, period, options) {
  var opts = lynMerge_(LYN_CONFIG.report, options);
  var rows = parsed.categories
    .filter(function (c) { return opts.includeIncome || c.type !== 'income'; })
    .filter(function (c) { return !opts.hideEmptyCategories || c.planned !== 0 || c.actual !== 0; })
    .map(function (c) { return lynAnalyzeCategory_(c, opts); });

  return {
    title: 'Monthly Comparative Report — ' + period.month + ' ' + period.year,
    period: period,
    threshold: opts.threshold,
    categories: rows,
    flagged: rows.filter(function (c) { return c.significant; }),
    summary: parsed.summary
  };
}

function lynAnalyzeCategory_(cat, opts) {
  var variance = cat.actual - cat.planned;
  var pct = cat.planned !== 0 ? variance / Math.abs(cat.planned) : null; // null = nothing was planned
  var significant = Math.abs(variance) >= opts.minVarianceAmount &&
    (pct === null || Math.abs(pct) >= opts.threshold);

  return {
    name: cat.name,
    type: cat.type,
    planned: cat.planned,
    actual: cat.actual,
    variance: variance,
    pct: pct,
    significant: significant,
    status: lynStatus_(cat.type, variance, significant),
    headline: significant ? lynHeadline_(cat, variance, pct) : '',
    drivers: significant ? lynFindDrivers_(cat.items, variance, opts) : []
  };
}

/**
 * The line items that explain the category gap: same direction as the
 * category (an under-spent item does not explain an over-spent category),
 * each covering a meaningful share of the gap, largest first.
 */
function lynFindDrivers_(items, categoryVariance, opts) {
  var direction = categoryVariance > 0 ? 1 : -1;
  var minGap = Math.abs(categoryVariance) * opts.driverMinShare;
  return items
    .map(function (i) { return { name: i.name, planned: i.planned, actual: i.actual, variance: i.actual - i.planned }; })
    .filter(function (i) { return i.variance * direction > 0 && Math.abs(i.variance) >= minGap; })
    .sort(function (a, b) { return Math.abs(b.variance) - Math.abs(a.variance); })
    .slice(0, opts.maxDriversPerCategory);
}

function lynStatus_(type, variance, significant) {
  if (!significant) return 'On track';
  if (type === 'income') return variance > 0 ? 'Above plan' : 'Below plan';
  return variance > 0 ? 'Over budget' : 'Under budget';
}

/** "Shelter is over budget by 20%." — wording depends on income vs expense. */
function lynHeadline_(cat, variance, pct) {
  if (pct === null) {
    return cat.name + (cat.type === 'income'
      ? ' received ' + lynMoney_(cat.actual) + ' with nothing planned.'
      : ' has ' + lynMoney_(cat.actual) + ' of unplanned spending (no budget set).');
  }
  var amount = lynPercent_(Math.abs(pct));
  if (cat.type === 'income') {
    var subject = /income/i.test(cat.name) ? cat.name : cat.name + ' income';
    return subject + ' is ' + (variance > 0 ? 'above' : 'below') + ' plan by ' + amount + '.';
  }
  return cat.name + ' is ' + (variance > 0 ? 'over' : 'under') + ' budget by ' + amount + '.';
}

/** "- Landscaping: $2,000.00 (Actual) vs $1,000.00 (Planned)" */
function lynDriverLine_(d) {
  return '- ' + d.name + ': ' + lynMoney_(d.actual) + ' (Actual) vs ' + lynMoney_(d.planned) + ' (Planned)';
}

/** Plain-text version of the whole report (email fallback body, logs). */
function lynRenderPlainText_(report) {
  var lines = [report.title, ''];
  report.categories.forEach(function (c) {
    lines.push(c.name + ': ' + lynMoney_(c.actual) + ' actual vs ' + lynMoney_(c.planned) + ' planned');
    if (c.significant) {
      lines.push('  ' + c.headline);
      c.drivers.forEach(function (d) { lines.push('  ' + lynDriverLine_(d)); });
      lines.push('');
    }
  });
  if (report.summary.length) {
    lines.push('');
    report.summary.forEach(function (s) {
      lines.push(s.name + ': ' + lynMoney_(s.actual) + ' actual vs ' + lynMoney_(s.planned) + ' planned');
    });
  }
  return lines.join('\n');
}

function lynMoney_(n) {
  var parts = Math.abs(n).toFixed(2).split('.');
  return (n < 0 ? '-' : '') + '$' + parts[0].replace(/\B(?=(\d{3})+$)/g, ',') + '.' + parts[1];
}

function lynPercent_(ratio) {
  var p = Math.round(ratio * 1000) / 10; // one decimal: 21.5%
  return (p % 1 === 0 ? p.toFixed(0) : p.toFixed(1)) + '%';
}

function lynMerge_(base, extra) {
  var out = {};
  Object.keys(base).forEach(function (k) { out[k] = base[k]; });
  Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
  return out;
}
