import { loadFoliosFromIdb, removeFolioWorkspaceFromIdb } from "./idb";
import { markDirty } from "./convex-sync";
import { loadHouseState, setFolioCollection } from "./house-store";

/** Remove the working copy; published copies and revision history are separate. */
export async function removeFolio(id: string): Promise<void> {
  await removeFolioWorkspaceFromIdb(id);
  // Legacy mirrors must not recreate the last deleted folio on editor startup.
  if ((await loadFoliosFromIdb()).length === 0) {
    localStorage.removeItem("twyne-project-brief");
    localStorage.removeItem("twyne-document");
  }
  markDirty();
  window.dispatchEvent(new CustomEvent("twyne:remote-sync"));
  const house = await loadHouseState();
  if (
    house.collections.some((collection) => collection.folioIds.includes(id))
  ) {
    await setFolioCollection(id, null);
  }
}
