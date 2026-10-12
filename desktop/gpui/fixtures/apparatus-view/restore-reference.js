// Restore only the eight exact keys backed up by seed-reference.js in the
// owned, isolated localhost test tab. Never clear a database or browser profile.
const fs = require("node:fs");
const root = "/home/diogenes/Projects/twyne/desktop/gpui/fixtures/apparatus-view";
if (!state.page?.url().startsWith("http://localhost:5180/")) throw new Error("Use only the owned offline localhost tab.");
const backup = state.apparatusBackup ?? JSON.parse(fs.readFileSync(`${root}/browser-storage-before.json`, "utf8"));
if (!state.page.url().includes("/dossier/create")) await state.page.goto("http://localhost:5180/dossier/create/", {waitUntil:"domcontentloaded"});
await state.page.getByRole("textbox",{name:"What are we calling it, for now?",exact:true}).waitFor({timeout:10000});
console.log(state.page.url());
console.log(await snapshot({page:state.page}));
await state.page.evaluate(async backup => {
  const db = await new Promise((resolve,reject)=>{const r=indexedDB.open("twyne",4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx = db.transaction([...new Set(backup.rows.map(row=>row.store))], "readwrite");
  const done = new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});
  for (const row of backup.rows) {
    if (row.value === null) tx.objectStore(row.store).delete(row.key);
    else {
      const value = {...row.value};
      if (row.blob !== undefined) value.value = new Blob([Uint8Array.from(atob(row.blob),char=>char.charCodeAt(0))],{type:row.blobType??""});
      tx.objectStore(row.store).put(value);
    }
  }
  await done; db.close();
  for (const [key,value] of backup.local) {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key,value);
  }
}, backup);
await state.page.setViewportSize({width:1280,height:860});
await state.page.reload({waitUntil:"domcontentloaded"});
await state.page.getByRole("textbox",{name:"What are we calling it, for now?",exact:true}).waitFor({timeout:10000});
console.log(await snapshot({page:state.page}));
const after = await state.page.evaluate(async backup => {
  const db=await new Promise((resolve,reject)=>{const r=indexedDB.open("twyne",4);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const rows=[];
  for (const row of backup.rows) {
    const value=await new Promise((resolve,reject)=>{const r=db.transaction(row.store).objectStore(row.store).get(row.key);r.onsuccess=()=>resolve(r.result??null);r.onerror=()=>reject(r.error);});
    if (row.store==="lix-blob" && value?.value instanceof Blob) {
      const bytes=new Uint8Array(await value.value.arrayBuffer());
      let binary="";for(let i=0;i<bytes.length;i+=4096)binary+=String.fromCharCode(...bytes.slice(i,i+4096));
      rows.push({store:row.store,key:row.key,value:{...value,value:null},blob:btoa(binary),blobType:value.value.type});
    } else rows.push({store:row.store,key:row.key,value});
  }
  db.close();
  return {rows,local:backup.local.map(([key])=>[key,localStorage.getItem(key)])};
}, backup);
if (JSON.stringify(after)!==JSON.stringify(backup)) throw new Error("Owned reference keys did not match the exact backup after reload.");
// The original Dossier departure listener creates a recovery row even without
// submission. Remove only our synthetic folio's row, leaving other drafts.
const recoveryKey="twyne:brief-form:v1:"+JSON.stringify(["create:"+state.apparatusScope,null]);
const scopedRecoveryRemoved=await state.page.evaluate(key=>{
  sessionStorage.removeItem(key);
  if(sessionStorage.getItem("twyne:brief-form:active")===key) sessionStorage.removeItem("twyne:brief-form:active");
  return sessionStorage.getItem(key)===null;
},recoveryKey);
state.apparatusRestoration={url:state.page.url(),dimensions:{width:1280,height:860},keys:after.rows.map(({store,key})=>({store,key})),localKeys:after.local.map(([key])=>key),exactReadBack:true,taskRecoveryKey:recoveryKey,scopedRecoveryRemoved};
fs.writeFileSync(`${root}/browser-restoration.json`,JSON.stringify(state.apparatusRestoration,null,2)+"\n");
console.log(state.apparatusRestoration);
console.log(await getLatestLogs({page:state.page,sinceLastCall:true}));
