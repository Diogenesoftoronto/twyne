/** Publish the approved GIF collection without loading it into the editor bundle. */
import { cp, mkdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const source = resolve(process.argv[2] ?? "output/persona-motion");
const destination = resolve("public/assets/persona-motion");
await mkdir(destination, { recursive: true });
const categories = [
  ["speaking", "Speaking"],
  ["listening", "Listening"],
  ["thinking", "Thinking"],
  ["gesture", "Editorial gestures"],
  ["action", "On the page"],
  ["turn", "Taking a turn"],
  ["handoff", "Passing a note"],
];
const roles: Record<string, string> = {
  devil: "The Devil’s Advocate",
  angel: "The Patron of Strengths",
  scholar: "The Scholar",
  editor: "The Copy Chief",
  reader: "The Target Reader",
};
const assets = [];
for (const directory of ["", "volume-two", "volume-three"]) {
  const manifest = JSON.parse(
    await readFile(resolve(source, directory, "manifest.json"), "utf8"),
  );
  for (const entry of manifest.assets ?? manifest.personas) {
    const personaId = entry.personaId ?? entry.id;
    const category =
      directory === ""
        ? "speaking"
        : directory === "volume-three"
          ? entry.group
          : ["listening", "thinking"].includes(entry.state)
            ? entry.state
            : "gesture";
    const key = `${personaId}-${category}`;
    const bytes = await readFile(resolve(source, directory, entry.gif));
    await Bun.write(`${destination}/${key}.gif`, bytes);
    await cp(
      resolve(source, directory, entry.still),
      `${destination}/${key}-still.png`,
    );
    assets.push({
      key,
      personaId,
      name: entry.name,
      role: roles[personaId],
      category,
      label: entry.label ?? "Speaking",
      src: `/assets/persona-motion/${key}.gif`,
      poster: `/assets/persona-motion/${key}-still.png`,
      frames: entry.frames,
      durationMs: entry.durationMs,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
if (assets.length !== 35 || new Set(assets.map((a) => a.key)).size !== 35)
  throw new Error("Expected 35 unique approved GIFs");
const catalog = {
  note: "Silent motion studies using original persona artwork and authored sample text. Editorial actions and references are illustrative.",
  categories,
  assets,
};
await Bun.write(
  `${destination}/manifest.json`,
  JSON.stringify(catalog, null, 2),
);
const embedded = JSON.stringify(catalog).replaceAll("<", "\\u003c");
await Bun.write(
  "public/motion.html",
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>The room in motion · Twyne</title><style>
:root{color-scheme:light;--paper:#faf8f2;--ink:#25211d;--muted:#59534d;--rule:#bfb8ac;--accent:#2c4a7c}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 system-ui,sans-serif}main{max-width:1000px;margin:36px auto;padding:0 24px 40px}a{color:var(--accent)}.back{font-size:13px}h1{font:500 42px/1.15 Georgia,serif;margin:30px 0 14px}p{max-width:65ch;color:var(--muted)}.intro{margin-bottom:28px}.controls{display:flex;flex-wrap:wrap;gap:16px;align-items:end;padding:20px 0;border-top:1px solid var(--rule);border-bottom:1px solid var(--rule)}label{display:grid;gap:5px;font-size:13px;font-weight:500}select,button{font:inherit;font-size:14px;border:1px solid var(--rule);border-radius:5px;padding:10px 12px;background:#fffdf8;color:var(--ink)}select{max-width:100%}button{cursor:pointer}button:focus-visible,select:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.viewer{display:grid;grid-template-columns:minmax(0,480px) minmax(0,1fr);gap:32px;align-items:center;margin-top:28px}figure{margin:0;min-width:0}figure img{display:block;width:100%;height:auto;aspect-ratio:420/340;object-fit:contain;background:var(--paper)}h2{font:500 26px/1.25 Georgia,serif;margin:0 0 8px}.role{font-size:13px;margin:0 0 18px}.state{font-size:17px;margin:0 0 18px;color:var(--ink)}.detail{font-size:14px}.downloads{display:flex;gap:18px;flex-wrap:wrap;font-size:14px;margin-top:22px}.note{font-size:12px;margin-top:26px}#load-state{font-size:12px;min-height:19px;margin:10px 0 0}@media(max-width:650px){main{margin-top:20px;padding:0 18px 30px}h1{font-size:34px}.viewer{grid-template-columns:1fr;gap:18px}.controls{gap:12px}label{flex:1 1 190px}select{width:100%}.viewer img{max-width:480px;margin:auto}}
</style></head><body><main><a class="back" href="/editor/">← Back to the writing desk</a><h1>The room in motion</h1><p class="intro">35 motion studies with Twyne’s resident editors. Choose a persona and a moment to see the full-size loop.</p><div class="controls"><label>Persona<select id="persona" aria-controls="viewer"></select></label><label>Moment<select id="category" aria-controls="viewer"></select></label><button id="pause" type="button" aria-pressed="false">Pause animation</button></div><div class="viewer" id="viewer"><figure><img id="portrait" src="/assets/persona-motion/devil-speaking-still.png" width="420" height="340" alt="Mlle. Sceptique motion study"><figcaption id="load-state" role="status"></figcaption></figure><section aria-labelledby="name"><h2 id="name">Mlle. Sceptique</h2><p id="role" class="role">The Devil’s Advocate</p><p id="state" class="state">Speaking</p><p class="detail">The speaking loops use an illustrative rhythm. Listening, thinking, editorial marks, and handoffs are authored motion studies. Sample excerpts and references are illustrative.</p><div class="downloads"><a id="download" href="/assets/persona-motion/devil-speaking.gif" download>Download this GIF</a><a href="/assets/persona-motion/manifest.json">View the collection manifest</a></div><p class="note">Only the selected animation loads. Reduced motion starts with a still image. In the editor, writing, listening, and research feedback follow the application’s actual state.</p></section></div></main><script>
const catalog=${embedded};const persona=document.querySelector('#persona'),category=document.querySelector('#category'),image=document.querySelector('#portrait'),pause=document.querySelector('#pause'),loading=document.querySelector('#load-state');const reduce=matchMedia('(prefers-reduced-motion: reduce)');let paused=reduce.matches;let selected=catalog.assets[0];
for(const item of catalog.assets.filter(a=>a.category==='speaking')){const option=document.createElement('option');option.value=item.personaId;option.textContent=item.name;persona.append(option)}for(const [key,label] of catalog.categories){const option=document.createElement('option');option.value=key;option.textContent=label;category.append(option)}
function render(){selected=catalog.assets.find(a=>a.personaId===persona.value&&a.category===category.value);document.querySelector('#name').textContent=selected.name;document.querySelector('#role').textContent=selected.role;document.querySelector('#state').textContent=selected.label;document.querySelector('#download').href=selected.src;image.alt=selected.name+': '+selected.label;pause.textContent=paused?'Play animation':'Pause animation';pause.setAttribute('aria-pressed',String(paused));loading.textContent=paused?'Still preview':'Loading animation…';image.src=paused?selected.poster:selected.src}
image.addEventListener('load',()=>loading.textContent=paused?'Still preview':'Six-second and shorter silent loops');image.addEventListener('error',()=>{loading.textContent='Could not load this animation.'});persona.addEventListener('change',render);category.addEventListener('change',render);pause.addEventListener('click',()=>{paused=!paused;render()});reduce.addEventListener('change',event=>{paused=event.matches;render()});render();
</script></body></html>`,
);
console.log(`Published ${assets.length} GIFs and posters to ${destination}`);
