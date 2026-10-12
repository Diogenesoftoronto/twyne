// Only the owned Playwriter session4 offline test tab. Back up every exact
// storage key changed here; no account/provider/Convex services are called.
const fs = require("node:fs");
const root = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/apparatus-view";
if (!state.page?.url().startsWith("http://localhost:5180/")) throw new Error("Use only the owned offline localhost tab.");
state.apparatusVisual = JSON.parse(fs.readFileSync(`${root}/visual-native.json`, "utf8"));
state.apparatusHtml = fs.readFileSync("/home/diogenes/Projects/twyne/desktop/gpui/fixtures/marginalia/browser-manuscript.html", "utf8");
state.apparatusScope = "original/path/folio:café";
if (!state.apparatusBackup) {
  state.apparatusBackup = await state.page.evaluate(async scope => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("twyne", 4); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const get = (store, key) => new Promise((resolve, reject) => {
      const r = db.transaction(store).objectStore(store).get(key); r.onsuccess = () => resolve(r.result ?? null); r.onerror = () => reject(r.error);
    });
    const rows = [];
    for (const [store, key] of [["folios",scope],["folio-content",scope],["meta","active-folio-id"],["meta","signin-toast-dismissed"],["meta","apparatus-settings"],["lix-blob","current"]]) {
      const value = await get(store,key);
      if (store === "lix-blob" && value?.value instanceof Blob) {
        const bytes = new Uint8Array(await value.value.arrayBuffer());
        let binary = ""; for (let i=0;i<bytes.length;i+=4096) binary += String.fromCharCode(...bytes.slice(i,i+4096));
        rows.push({store,key,value:{...value,value:null},blob:btoa(binary),blobType:value.value.type});
      } else rows.push({store,key,value});
    }
    db.close();
    return {rows,local:["twyne:editor:view:v1","twyne.apparatus-settings.current"].map(key=>[key,localStorage.getItem(key)])};
  }, state.apparatusScope);
  fs.writeFileSync(`${root}/browser-storage-before.json`, JSON.stringify(state.apparatusBackup,null,2)+"\n");
}
await state.page.setViewportSize({width:1280,height:860});
await state.page.evaluate(async ({scope,html,settings}) => {
  const db = await new Promise((resolve,reject)=>{const r=indexedDB.open("twyne",4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction(["folios","folio-content","meta"],"readwrite");
  const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  const now=Date.now();
  tx.objectStore("folios").put({id:scope,name:"The notebook",type:"draft",createdAt:now,updatedAt:now});
  tx.objectStore("folio-content").put({folioId:scope,html,format:"typst",updatedAt:now});
  for (const [key,value] of [["active-folio-id",scope],["signin-toast-dismissed",true],["apparatus-settings",settings]]) tx.objectStore("meta").put({key,value,updatedAt:now});
  await done; db.close();
  localStorage.setItem("twyne:editor:view:v1",JSON.stringify({zenMode:false,compositorOpen:false}));
  localStorage.setItem("twyne.apparatus-settings.current",JSON.stringify(settings));
}, {scope:state.apparatusScope,html:state.apparatusHtml,settings:state.apparatusVisual.settings});
await state.page.evaluate(async bytes => {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("twyne",4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction("lix-blob","readwrite");
  const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  tx.objectStore("lix-blob").put({key:"current",value:new Blob([new Uint8Array(bytes)]),updatedAt:Date.now()});
  await done;db.close();
}, [...fs.readFileSync(`${root}/visual-bibliography.lix`)]);
await state.page.goto("http://localhost:5180/editor/",{waitUntil:"domcontentloaded"});
await state.page.getByRole("region",{name:"Manuscript workspace"}).waitFor({timeout:10000});
console.log(state.page.url()); console.log(await snapshot({page:state.page}));
console.log(await getLatestLogs({page:state.page,count:5}));
