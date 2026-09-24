/**
 * Main.gs — simple trigger. Replaces the previous Code.gs.
 *
 * Builds the Admin menu first (fast, no external calls), then restores the
 * template's own menus (ProsprScript.onOpen, which the previous Code.gs had
 * dropped). Order matters: simple triggers are killed after 30 s, so a slow
 * library call must never prevent the Admin menu from appearing. Each part is
 * isolated so a failure in one never hides the other.
 */
function onOpen(e) {
  try {
    lynAdminBuildMenu();
  } catch (err) {
    console.error('Admin menu could not be built: ' + err);
  }
  try {
    if (typeof ProsprScript !== 'undefined') ProsprScript.onOpen(e);
  } catch (err) {
    console.warn('ProsprScript.onOpen failed: ' + err);
  }
}
