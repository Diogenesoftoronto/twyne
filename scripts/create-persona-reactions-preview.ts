import { readFile } from "node:fs/promises";
import { PERSONAS } from "../src/utils/personas";

interface Asset {
  key: string;
  personaId: string;
  name: string;
  state: string;
  label: string;
  cue: string;
  gif: string;
  still: string;
}
const out = `${process.cwd()}/output/persona-motion/volume-two`;
const { assets }: { assets: Asset[] } = JSON.parse(
  await readFile(`${out}/manifest.json`, "utf8"),
);
const css = await readFile("src/components/ui/editorial-activity.css", "utf8");
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const glyph = (kind: string, label: string) =>
  `<span class="editorial-activity" data-kind="${kind}"><span class="editorial-activity__paper" aria-hidden="true"><span class="editorial-activity__line"></span><span class="editorial-activity__line"></span><span class="editorial-activity__line"></span><span class="editorial-activity__pen"></span><span class="editorial-activity__lens"></span><span class="editorial-activity__check"></span></span><span>${label}</span></span>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>More of the room</title><style>
:root{--color-paper:#faf8f2;--color-ink-light:#59534d;--color-cobalt:#2c4a7c}*{box-sizing:border-box}body{margin:0;color:var(--foreground,#25211d);font:14px/1.55 var(--font-sans,system-ui)}h2{font-size:21px;margin:0 0 8px}h3{font-size:15px;margin:10px 0 3px}p{color:var(--muted-foreground,#59534d);font-size:13px;margin:0 0 18px;max-width:70ch}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;margin:20px 0}.tabs{display:flex;flex-wrap:wrap;gap:5px}button{font:inherit;font-size:13px;border:1px solid var(--border,#ccc);border-radius:6px;background:var(--secondary,#eee);color:var(--foreground,#25211d);padding:8px 11px;cursor:pointer}button[aria-selected="true"]{background:var(--primary,#25211d);color:var(--primary-foreground,#fff);border-color:transparent}button:focus-visible{outline:2px solid var(--ring,#2c4a7c);outline-offset:3px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:22px 18px}.study{min-width:0}.study img.motion{width:100%;height:auto;display:block;border-radius:6px}.study img[hidden]{display:none}.study p{font-size:12px;margin:0}.role{color:var(--muted-foreground)}.section{margin-top:30px}.glyphs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px 14px;padding:22px;background:#faf8f2;border-radius:var(--radius,8px)}.glyphs .editorial-activity{font-size:12px}.note{margin-top:18px}.paused *{animation-play-state:paused!important}.reduced{display:none}@media(prefers-reduced-motion:reduce){.reduced{display:block}}@media(max-width:520px){.gallery{grid-template-columns:1fr}.glyphs{grid-template-columns:1fr 1fr}.toolbar{align-items:flex-start}h2{font-size:19px}}
${css}</style><body><h2>More of the room</h2><p>Fifteen new silent loops. Switch between listening, thinking, and a gesture specific to each editor. These preserve the engravings and use authored motion cues.</p><div class="toolbar"><div class="tabs" role="tablist" aria-label="Persona animation state"><button id="tab-gesture" type="button" role="tab" aria-controls="gallery" aria-selected="true">Editorial gestures</button><button id="tab-listening" type="button" role="tab" aria-controls="gallery" aria-selected="false" tabindex="-1">Listening</button><button id="tab-thinking" type="button" role="tab" aria-controls="gallery" aria-selected="false" tabindex="-1">Thinking</button></div><button id="pause" type="button" aria-pressed="false">Pause animations</button></div><p class="reduced">Animations start paused to respect reduced motion.</p><div id="gallery" class="gallery" role="tabpanel" aria-labelledby="tab-gesture">${PERSONAS.map(
  (p) =>
    `<article class="study" data-persona="${p.id}">${assets
      .filter((a) => a.personaId === p.id)
      .map(
        (a) =>
          `<img src="${out}/previews/${a.still}" hidden alt=""><img class="motion" data-group="${a.state === "listening" || a.state === "thinking" ? a.state : "gesture"}" data-label="${esc(a.label)}" src="${out}/previews/${a.gif}" ${a.state === "listening" || a.state === "thinking" ? "hidden" : ""} width="420" height="320" alt="${esc(p.name)}: ${esc(a.label)}">`,
      )
      .join(
        "",
      )}<h3>${esc(p.name)}</h3><p class="role">${esc(p.role)}</p></article>`,
).join(
  "",
)}</div><div class="section"><h2>A few more working states</h2><p>Reusable app animations for writing, reading, searching, filing, and completion. Listening is connected to the live voice state; research uses the reading, searching, and filing icons.</p><div class="glyphs">${glyph("writing", "Writing a reply")}${glyph("reading", "Reading a passage")}${glyph("searching", "Checking sources")}${glyph("saving", "Filing a source")}${glyph("ready", "Source filed")}</div><p class="note">The expressive gestures are review assets. The app uses its existing state signals for listening and research activity; it does not infer agreement or emotion from a reply.</p></div><script>
const tabs=Array.from(document.querySelectorAll('[role="tab"]')),gifs=Array.from(document.querySelectorAll('img.motion')).map(img=>({img,motion:img.src,still:img.previousElementSibling.src}));let paused=false;let active='gesture';const pause=document.querySelector('#pause');
function setState(state,focus=false){active=state;tabs.forEach(tab=>{const selected=tab.id==='tab-'+state;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus()});gifs.forEach(({img})=>{img.hidden=img.dataset.group!==state});document.querySelector('#gallery').setAttribute('aria-labelledby','tab-'+state);}
tabs.forEach((tab,i)=>{tab.addEventListener('click',()=>setState(tab.id.slice(4)));tab.addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(i+1)%tabs.length;if(e.key==='ArrowLeft')next=(i+tabs.length-1)%tabs.length;if(e.key==='Home')next=0;if(e.key==='End')next=tabs.length-1;if(next!==undefined){e.preventDefault();setState(tabs[next].id.slice(4),true)}})});
function setPaused(value){paused=value;document.body.classList.toggle('paused',paused);gifs.forEach(({img,motion,still})=>{img.src=paused?still:motion});pause.textContent=paused?'Play animations':'Pause animations';pause.setAttribute('aria-pressed',String(paused))};pause.addEventListener('click',()=>setPaused(!paused));const reduce=matchMedia('(prefers-reduced-motion: reduce)');if(reduce.matches)setPaused(true);reduce.addEventListener('change',e=>setPaused(e.matches));
console.log(JSON.stringify({assets:gifs.length,visible:document.querySelectorAll('img.motion:not([hidden])').length,activityKinds:document.querySelectorAll('.editorial-activity').length}));
</script></body></html>`;
await Bun.write(`${out}/preview.html`, html);
console.log(`${out}/preview.html`);
