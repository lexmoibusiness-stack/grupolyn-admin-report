// Unit tests for the pure parts of the Apps Script code (parser, analysis,
// renderers), run in Node against a real snapshot of "Monthly Budget" (Jan 2025).
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.join(__dirname, '..', 'src');
const ctx = vm.createContext({ console });
for (const f of ['Config.gs', 'BudgetReader.gs', 'ReportBuilder.gs', 'SheetWriter.gs', 'EmailWriter.gs', 'Menu.gs']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const values = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'monthly_budget_jan2025.json'), 'utf8'));
const period = { month: 'Jan', year: '2025', generatedAt: 'Jan 31, 2025 09:00' };
const parsed = ctx.lynParseBudget_(values);
const report = ctx.lynBuildReport_(parsed, period);
const byName = (n) => report.categories.find((c) => c.name === n);

test('parser finds every category of the template, typed income/expense', () => {
  const names = [...parsed.categories.map((c) => c.name)];
  assert.deepEqual(names, ['Person 1', 'Person 2', 'Other Income', 'Shelter', 'Food & Supplies', 'Medical',
    'Education', 'Personal Care', 'Clothing', 'Transportation', 'Entertainment/Vacation', 'Holiday',
    'Other Expenses', 'Capital Expenses', 'Savings', 'Debt Repayment']);
  assert.equal(parsed.categories.find((c) => c.name === 'Other Income').type, 'income');
  assert.equal(parsed.categories.find((c) => c.name === 'Shelter').type, 'expense');
  assert.equal(parsed.summary.length, 3);
});

test('category totals come from the template subtotal rows', () => {
  const food = byName('Food & Supplies');
  assert.equal(food.planned, 3540);
  assert.equal(food.actual, 4301.42);
});

test('Food & Supplies: flagged with the example wording and its real drivers', () => {
  const food = byName('Food & Supplies');
  assert.equal(food.significant, true);
  assert.equal(food.headline, 'Food & Supplies is over budget by 21.5%.');
  assert.deepEqual([...food.drivers.map((d) => d.name)], ['Grocery', 'Housekeeping Help']);
  assert.equal(ctx.lynDriverLine_(food.drivers[0]), '- Grocery: $3,345.45 (Actual) vs $2,300.00 (Planned)');
});

test('drivers only go in the direction of the gap (under-spent items do not explain an overrun)', () => {
  const food = byName('Food & Supplies');
  assert.ok(!food.drivers.some((d) => d.name === 'Eating Out' || d.name === 'Amazon'));
});

test('small deviations are not flagged', () => {
  assert.equal(byName('Shelter').significant, false); // 1.5%
  assert.equal(byName('Debt Repayment').significant, false);
  assert.equal(byName('Person 2').significant, false); // $25 with no plan: under the $50 floor
});

test('under-budget and income use their own wording', () => {
  assert.equal(byName('Medical').headline, 'Medical is under budget by 63.6%.');
  assert.equal(byName('Person 1').headline, 'Person 1 income is below plan by 100%.');
  assert.equal(byName('Other Income').status, 'Above plan');
  assert.match(byName('Other Income').headline, /^Other Income is above plan by/);
});

test('empty categories are hidden to keep the report compact', () => {
  assert.equal(byName('Holiday'), undefined);
  assert.equal(byName('Capital Expenses'), undefined);
});

test('threshold is configurable per run', () => {
  const strict = ctx.lynBuildReport_(parsed, period, { threshold: 0.25 });
  assert.equal(strict.categories.find((c) => c.name === 'Food & Supplies').significant, false);
});

test('sheet rows: a note line and highlighted drivers follow each flagged category', () => {
  const rows = ctx.lynBuildSheetRows_(report);
  const i = rows.findIndex((r) => r.values[0] === 'Food & Supplies');
  assert.equal(rows[i].kind, 'flagged');
  assert.equal(rows[i + 1].kind, 'note');
  assert.equal(rows[i + 2].kind, 'driver');
  assert.ok(rows.every((r) => r.values.length === 6));
});

test('email HTML escapes names and contains the drivers', () => {
  const html = ctx.lynRenderEmailHtml_(report);
  assert.ok(html.includes('Food &amp; Supplies is over budget by 21.5%.'));
  assert.ok(html.includes('- Grocery: $3,345.45 (Actual) vs $2,300.00 (Planned)'));
  assert.ok(!html.includes('Food & Supplies'));
});

test('money and percent formatting', () => {
  assert.equal(ctx.lynMoney_(1234567.5), '$1,234,567.50');
  assert.equal(ctx.lynMoney_(-54.42), '-$54.42');
  assert.equal(ctx.lynPercent_(0.2), '20%');
});

test('client stub exposes every entry point through the library symbol', () => {
  const src = ctx.lynClientStubSource('ProsprScript');
  for (const fn of ctx.LYN_ENTRY_POINTS) assert.ok(src.includes('function ' + fn + '(a, b) { return ProsprScript.' + fn + '(a, b); }'));
  new vm.Script(src); // must be valid JS
});
