/** Local original-SDK container for the real compiled app's task-owned visual
 * fixture. Uses the exact file-table operation in src/utils/lix.ts. No sync.
 */
import {openLixInMemory, toBlob, closeLix} from "@lix-js/sdk";
import {plugin} from "@lix-js/plugin-json";
const fixture = await Bun.file(`${import.meta.dir}/visual-native.json`).json();
const lix = await openLixInMemory({providePlugins:[plugin as any],keyValues:[{key:"lix_sync",value:"false"}]});
try {
  await lix.db.insertInto("file").values({path:"/bibliography.json",
    data:new TextEncoder().encode(JSON.stringify(fixture.bibliography))}).execute();
  const blob = await toBlob({lix});
  await Bun.write(`${import.meta.dir}/visual-bibliography.lix`,blob);
  console.log(`Wrote original SDK Lix blob (${blob.size} bytes); no research/connection.`);
} finally {await closeLix({lix});}
