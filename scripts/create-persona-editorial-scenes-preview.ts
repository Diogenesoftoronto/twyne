import { readFile } from "node:fs/promises";
import { PERSONAS } from "../src/utils/personas";

interface Asset {
  personaId: string;
  name: string;
  group: string;
  label: string;
  gif: string;
  still: string;
}
const out = `${process.cwd()}/output/persona-motion/volume-three`;
const { assets }: { assets: Asset[] } = JSON.parse(
  await readFile(`${out}/manifest.json`, "utf8"),
);
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Back at the desk</title><style>
*{box-sizing:border-box}body{margin:0;color:var(--foreground,#25211d);font:14px/1.55 var(--font-sans,system-ui)}h2{font-size:21px;margin:0 0 8px}h3{font-size:15px;margin:10px 0 3px}p{color:var(--muted-foreground,#59534d);font-size:13px;margin:0 0 18px;max-width:68ch}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:18px 0 12px}.tabs,.transport{display:flex;gap:5px;flex-wrap:wrap}button{font:inherit;font-size:13px;border:1px solid var(--border,#ccc);border-radius:6px;background:var(--secondary,#eee);color:var(--foreground,#25211d);padding:8px 11px;cursor:pointer}button[aria-selected="true"]{background:var(--primary,#25211d);color:var(--primary-foreground,#fff);border-color:transparent}button:focus-visible{outline:2px solid var(--ring,#2c4a7c);outline-offset:3px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:22px 18px}.study{min-width:0}.study img.motion{display:block;width:100%;height:auto;border-radius:6px}.study img[hidden]{display:none}.study p{font-size:12px;margin:0}.notes{margin-top:24px}.reduced{display:none}@media(prefers-reduced-motion:reduce){.reduced{display:block}}@media(max-width:520px){.gallery{grid-template-columns:1fr}h2{font-size:19px}}
</style><body><h2>Back at the desk</h2><p>Fifteen more loops, bringing the collection to 35. This batch puts the editors to work on a sample passage, follows a complete conversational turn, and lets each offer you a note.</p><div class="toolbar"><div class="tabs" role="tablist" aria-label="Editorial animation"><button id="tab-action" type="button" role="tab" aria-controls="gallery" aria-selected="true">On the page</button><button id="tab-turn" type="button" role="tab" aria-controls="gallery" aria-selected="false" tabindex="-1">Taking a turn</button><button id="tab-handoff" type="button" role="tab" aria-controls="gallery" aria-selected="false" tabindex="-1">Passing a note</button></div><div class="transport"><button id="replay" type="button">Replay loops</button><button id="pause" type="button" aria-pressed="false">Pause</button></div></div><p id="explanation">A contradiction marked, a sentence protected, a reference found, a line tightened, a scene followed.</p><p class="reduced">Animations start paused to respect reduced motion.</p><div class="gallery" id="gallery" role="tabpanel" aria-labelledby="tab-action">${PERSONAS.map(
  (p) =>
    `<article class="study">${assets
      .filter((a) => a.personaId === p.id)
      .map(
        (a) =>
          `<img src="${out}/previews/${a.still}" hidden alt=""><img class="motion" data-group="${a.group}" src="${out}/previews/${a.gif}" ${a.group !== "action" ? "hidden" : ""} width="420" height="340" alt="${esc(p.name)}: ${esc(a.label)}">`,
      )
      .join("")}<h3>${esc(p.name)}</h3><p>${esc(p.role)}</p></article>`,
).join(
  "",
)}</div><p class="notes">Original artwork with animated sample text and editorial marks. Excerpts and references are illustrative. These are silent review assets; they do not perform edits or infer a model’s intentions.</p><script>
const tabs=Array.from(document.querySelectorAll('[role="tab"]')),gifs=Array.from(document.querySelectorAll('img.motion')).map(img=>({img,motion:img.src,still:img.previousElementSibling.src}));const descriptions={action:'A contradiction marked, a sentence protected, a reference found, a line tightened, a scene followed.',turn:'Listening, considering, making a note, then returning the floor to you. A complete six-second sequence.',handoff:'A note leaves the desk and settles beside its editor, with a suggestion ready for review.'};let active='action',paused=false;const pause=document.querySelector('#pause');
function setState(state,focus=false){active=state;tabs.forEach(tab=>{const selected=tab.id==='tab-'+state;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus()});gifs.forEach(({img})=>img.hidden=img.dataset.group!==state);document.querySelector('#gallery').setAttribute('aria-labelledby','tab-'+state);document.querySelector('#explanation').textContent=descriptions[state]}
tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>setState(tab.id.slice(4)));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();setState(tabs[next].id.slice(4),true)}})});
function setPaused(value){paused=value;gifs.forEach(({img,motion,still})=>img.src=paused?still:motion);pause.textContent=paused?'Play':'Pause';pause.setAttribute('aria-pressed',String(paused))}pause.addEventListener('click',()=>setPaused(!paused));document.querySelector('#replay').addEventListener('click',()=>{setPaused(true);requestAnimationFrame(()=>setPaused(false))});const reduce=matchMedia('(prefers-reduced-motion: reduce)');if(reduce.matches)setPaused(true);reduce.addEventListener('change',e=>setPaused(e.matches));
console.log(JSON.stringify({assets:gifs.length,visible:document.querySelectorAll('img.motion:not([hidden])').length}));
</script></body></html>`;
await Bun.write(`${out}/preview.html`, html);
console.log(`${out}/preview.html`);
