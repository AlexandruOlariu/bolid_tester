/** Plain-English texts shared by every write surface (plan 23). Dependency-free, so services can
 *  import them without pulling in the stores. */

/** The refusal every write surface shows when a module needs SecurityAccess and nothing unlocks it. */
export const NO_PLUGIN_MESSAGE =
  'Locked — this module needs security access and no plugin is installed for it.';
