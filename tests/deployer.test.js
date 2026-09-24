// Unit tests for the pure parts of deploy/Deployer.gs (manifest patching, URL parsing).
// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'deploy', 'Deployer.gs'), 'utf8'), ctx);
vm.runInContext("DEPLOY.libraryScriptId = 'LIB_ID'; DEPLOY.targetVersion = 7;", ctx);
const plain = (o) => JSON.parse(JSON.stringify(o));

test('a template manifest on Rhino is moved to V8 and pinned to the library version', () => {
  const rhino = JSON.stringify({
    timeZone: 'America/New_York',
    runtimeVersion: 'DEPRECATED_ES5',
    dependencies: { libraries: [{ userSymbol: 'ProsprScript', libraryId: 'OLD_ID', version: '3', developmentMode: true }] }
  });
  const m = JSON.parse(ctx.patchManifest_(rhino));
  assert.equal(m.runtimeVersion, 'V8');
  assert.deepEqual(plain(m.dependencies.libraries), [
    { userSymbol: 'ProsprScript', libraryId: 'LIB_ID', version: '7', developmentMode: false }
  ]);
  assert.equal(m.timeZone, 'America/New_York'); // everything else is preserved
});

test('other libraries in the client manifest are left alone', () => {
  const src = JSON.stringify({ dependencies: { libraries: [{ userSymbol: 'Other', libraryId: 'X', version: '1' }] } });
  const libs = JSON.parse(ctx.patchManifest_(src)).dependencies.libraries;
  assert.equal(libs.length, 2);
  assert.deepEqual(plain(libs[0]), { userSymbol: 'Other', libraryId: 'X', version: '1' });
});

test('explicit scopes are merged without duplicates; implicit ones are not introduced', () => {
  const explicit = JSON.parse(ctx.patchManifest_(JSON.stringify({ oauthScopes: ['https://mail.google.com/'] })));
  assert.equal(explicit.oauthScopes.filter((s) => s === 'https://mail.google.com/').length, 1);
  assert.equal(explicit.oauthScopes.length, 4);
  const implicit = JSON.parse(ctx.patchManifest_('{}'));
  assert.equal(implicit.oauthScopes, undefined);
});

test('spreadsheet id is extracted from full URLs and bare ids', () => {
  const id = '1wl-Gq-G1yiyFXPnzEPAMDbL7Mpzj1scJVeH_WwVvf74';
  assert.equal(ctx.spreadsheetIdFromUrl_('https://docs.google.com/spreadsheets/d/' + id + '/edit?usp=sharing'), id);
  assert.equal(ctx.spreadsheetIdFromUrl_(id), id);
  assert.throws(() => ctx.spreadsheetIdFromUrl_('https://example.com/nope'));
});

test('upsert replaces the wrapper file, keeps the rest, and strips read-only metadata', () => {
  const files = [
    { name: 'Charts', type: 'SERVER_JS', source: 'a', lastModifyUser: {} },
    { name: 'LynAdmin', type: 'SERVER_JS', source: 'old' }
  ];
  const out = plain(ctx.upsertFile_(files, { name: 'LynAdmin', type: 'SERVER_JS', source: 'new' }));
  assert.deepEqual(out, [
    { name: 'Charts', type: 'SERVER_JS', source: 'a' },
    { name: 'LynAdmin', type: 'SERVER_JS', source: 'new' }
  ]);
});
