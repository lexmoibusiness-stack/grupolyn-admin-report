/**
 * Main.gs — simple trigger. Replaces the previous Code.gs.
 *
 * Restores the template's own menus (ProsprScript.onOpen, which the previous
 * Code.gs had dropped) and then adds the Admin menu. Each part is isolated so
 * a failure in one never hides the other.
 */
function onOpen(e) {
  try {
    if (typeof ProsprScript !== 'undefined') ProsprScript.onOpen(e);
  } catch (err) {
    console.warn('ProsprScript.onOpen failed: ' + err);
  }
  try {
    lynAdminBuildMenu();
  } catch (err) {
    console.warn('Admin menu could not be built: ' + err);
  }
}
