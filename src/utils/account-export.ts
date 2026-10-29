/**
 * Browser half of "Export everything". The server archive holds every synced
 * row; this adds a `this-device/` folder with what only this browser holds.
 */
import { strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import {
  loadAllBriefsFromIdb,
  loadCommentsFromIdb,
  loadFolioContentSnapshotFromIdb,
  loadFoliosFromIdb,
  loadLixBlobFromIdb,
  loadPersonasFromIdb,
} from "./idb";
import { readPortablePreferences } from "./account-preferences";
import { usageLedger } from "./usage-ledger";

const json = (value: unknown) => strToU8(JSON.stringify(value, null, 2));

export async function collectThisDevice(): Promise<Zippable> {
  const files: Zippable = {};
  const folios = await loadFoliosFromIdb();
  files["folios.json"] = json(folios);
  for (const folio of folios) {
    const snapshot = await loadFolioContentSnapshotFromIdb(folio.id);
    if (!snapshot) continue;
    const base = `manuscripts/${folio.id}`;
    if (snapshot.html) files[`${base}.html`] = strToU8(snapshot.html);
    if (snapshot.typstSource)
      files[`${base}.typ`] = strToU8(snapshot.typstSource);
  }
  files["briefs.json"] = json(await loadAllBriefsFromIdb());
  files["personas.json"] = json(await loadPersonasFromIdb());
  files["comments.json"] = json(await loadCommentsFromIdb());
  files["preferences.json"] = json(await readPortablePreferences());
  files["usage-history.json"] = strToU8(
    await usageLedger.exportUsageHistory({
      from: null,
      to: Number.MAX_SAFE_INTEGER,
      format: "json",
    }),
  );
  const lix = await loadLixBlobFromIdb();
  if (lix)
    files["workspace.lix"] = [
      new Uint8Array(await lix.arrayBuffer()),
      { level: 0 },
    ];
  return files;
}

/** Merge this device's data into the server archive and save the result. */
export async function downloadAccountExport(url: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Export download failed (${response.status})`);
  const archive: Zippable = unzipSync(
    new Uint8Array(await response.arrayBuffer()),
  );
  for (const [path, value] of Object.entries(await collectThisDevice()))
    archive[`this-device/${path}`] = value;
  const zip = zipSync(archive, { level: 6 });
  const href = URL.createObjectURL(
    new Blob([zip], { type: "application/zip" }),
  );
  const link = document.createElement("a");
  link.href = href;
  link.download = `twyne-export-${new Date().toISOString().slice(0, 10)}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}
