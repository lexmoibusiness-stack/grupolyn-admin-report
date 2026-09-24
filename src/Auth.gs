/**
 * Auth.gs — admin access control.
 *
 * Design:
 *  - The admin code is never stored in clear text: only a salted SHA-256 hash
 *    lives in Script Properties (one code per script project, shared by every
 *    admin — not one code per user).
 *  - A successful unlock opens a session for THIS user on THIS spreadsheet
 *    (CacheService user cache, auto-expires). Nothing to clean up.
 *  - Every admin action re-checks the session server-side (lynRequireAdmin_),
 *    so hiding menu items is a convenience, not the security boundary.
 *  - Wrong codes are rate-limited (lockout after N attempts).
 *  - Only the spreadsheet owner can set the code the first time.
 */
var LYN_AUTH_KEYS = {
  hash: 'LYN_ADMIN_CODE_HASH',
  salt: 'LYN_ADMIN_CODE_SALT',
  session: 'LYN_ADMIN_SESSION',
  fails: 'LYN_ADMIN_FAILS'
};

function lynIsAdminCodeConfigured_() {
  return !!PropertiesService.getScriptProperties().getProperty(LYN_AUTH_KEYS.hash);
}

/** Session key scoped to the spreadsheet, so unlocking client A never unlocks client B. */
function lynSessionKey_(base) {
  return base + ':' + SpreadsheetApp.getActiveSpreadsheet().getId();
}

function lynIsAdminUnlocked_() {
  try {
    return CacheService.getUserCache().get(lynSessionKey_(LYN_AUTH_KEYS.session)) === '1';
  } catch (e) {
    return false; // any failure (e.g. restricted simple-trigger context) = locked
  }
}

function lynLockAdmin_() {
  CacheService.getUserCache().remove(lynSessionKey_(LYN_AUTH_KEYS.session));
}

/**
 * Checks a code and opens a session if it is correct.
 * @return {{ok: boolean, message: string}}
 */
function lynVerifyAdminCode_(code) {
  var cache = CacheService.getUserCache();
  var failsKey = lynSessionKey_(LYN_AUTH_KEYS.fails);
  var fails = Number(cache.get(failsKey) || 0);
  var auth = LYN_CONFIG.auth;

  if (fails >= auth.maxAttempts) {
    return { ok: false, message: 'Too many failed attempts. Try again in ' + Math.round(auth.lockoutSeconds / 60) + ' minutes.' };
  }
  if (!lynIsAdminCodeConfigured_()) {
    return { ok: false, message: 'No admin code has been configured yet. The spreadsheet owner must set one first.' };
  }

  var props = PropertiesService.getScriptProperties();
  var expected = props.getProperty(LYN_AUTH_KEYS.hash);
  var actual = lynHash_(String(code || ''), props.getProperty(LYN_AUTH_KEYS.salt));

  if (!lynSafeEquals_(expected, actual)) {
    cache.put(failsKey, String(fails + 1), auth.lockoutSeconds);
    var left = auth.maxAttempts - fails - 1;
    return { ok: false, message: 'Incorrect code.' + (left > 0 ? ' ' + left + ' attempt(s) left.' : '') };
  }

  cache.remove(failsKey);
  cache.put(lynSessionKey_(LYN_AUTH_KEYS.session), '1', auth.sessionSeconds);
  return { ok: true, message: 'Admin tools unlocked.' };
}

/** Stores a new admin code (hash + fresh salt). Callers must authorize first. */
function lynStoreAdminCode_(code) {
  if (!code || String(code).length < 6) throw new Error('The admin code must have at least 6 characters.');
  var salt = Utilities.getUuid();
  var values = {};
  values[LYN_AUTH_KEYS.salt] = salt;
  values[LYN_AUTH_KEYS.hash] = lynHash_(String(code), salt);
  PropertiesService.getScriptProperties().setProperties(values);
}

function lynIsOwner_() {
  var owner = SpreadsheetApp.getActiveSpreadsheet().getOwner();
  var me = Session.getActiveUser().getEmail();
  return !!owner && !!me && owner.getEmail() === me;
}

function lynHash_(code, salt) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + code, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/** Length-constant comparison so response time does not leak how many characters matched. */
function lynSafeEquals_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
