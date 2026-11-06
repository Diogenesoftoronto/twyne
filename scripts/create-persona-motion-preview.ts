import { readFile } from "node:fs/promises";
import { PERSONAS } from "../src/utils/personas";
import { resolvePersonaPortrait } from "../src/utils/persona-portrait";

const root = process.cwd();
const out = `${root}/output/persona-motion`;
const manifest = JSON.parse(await readFile(`${out}/manifest.json`, "utf8"));
const css = await Promise.all(
  [
    "src/components/ui/editorial-activity.css",
    "src/components/ui/editorial-loader.css",
    "src/components/personas/persona-portrait.css",
  ].map((file) => readFile(file, "utf8")),
);
const esc = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const portrait = (id: string, size = 32, writing = false) => {
  const p = resolvePersonaPortrait({ personaId: id });
  const f = p.focus!;
  return `<span class="persona-portrait" data-framing="face" ${writing ? 'data-activity="writing"' : ""} style="--persona-portrait-size:${size}px;--pp-color:${manifest.personas.find((p: any) => p.id === id).color};--fx:${f.fx};--fy:${f.fy};--pp-zoom:${size <= 40 ? 2.75 : 2.35}" aria-hidden="true"><span class="persona-portrait__stage"><img src="${root}/public${p.src}" alt="" width="480" height="600"></span></span>`;
};
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Persona motion studies</title>
<style>
:root{--color-paper:#faf8f2;--color-paper-soft:#f3efe5;--color-rule:#c9c3b8;--color-ink:#25211d;--color-ink-light:#59534d;--color-ink-muted:#6e675e;--color-cobalt:#2c4a7c;--color-vermilion:#c1272d;--font-display:Georgia,serif;--font-serif:Georgia,serif}
*{box-sizing:border-box}body{margin:0;font-family:var(--font-sans,system-ui);color:var(--foreground,#25211d)}h2{font-size:20px;margin:0 0 8px}h3{font-size:15px;margin:12px 0 4px}p{font-size:13px;line-height:1.55;margin:0 0 14px;color:var(--muted-foreground,#59534d)}.controls{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 16px}button{font:inherit;font-size:13px;background:var(--secondary,#eee);color:var(--foreground,#222);border:1px solid var(--border,#bbb);border-radius:6px;padding:8px 12px;cursor:pointer}button:focus-visible{outline:2px solid var(--ring,#2c4a7c);outline-offset:3px}.gallery{display:grid;grid-template-columns:1fr 1fr;gap:24px 18px}.study{min-width:0}.study img.motion{display:block;width:100%;height:auto;border-radius:6px}.role{font-size:12px;margin:0 0 4px}.state-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:16px}.state{padding:20px;background:#faf8f2;color:#25211d;border-radius:var(--radius,8px)}.state p{color:#59534d}.state h3{margin:0 0 20px}.writing{display:flex;align-items:center;gap:18px;min-height:175px}.writing>div{display:grid;gap:16px}.footer{margin-top:14px}.section{margin-top:32px}.paused *{animation-play-state:paused!important}.editorial-loader{padding:0}.editorial-loader__aside{font-family:Georgia,serif}.reduced-note{display:none}@media(prefers-reduced-motion:reduce){.reduced-note{display:block}}@media(max-width:520px){.gallery,.state-grid{grid-template-columns:1fr}.controls{align-items:start}h2{font-size:18px}}
${css.join("\n")}
</style><body>
<h2>Speaking motion studies</h2>
<p>Five silent GIFs made from Twyne’s existing portraits. Each pairs a face crop with the full figure, using sample lines and small gestures. Timing is illustrative; these are not synchronized to recorded speech.</p>
<div class="controls"><span style="font-size:12px;color:var(--muted-foreground)">Six-second loops · original artwork</span><button id="toggle" type="button" aria-pressed="false">Pause animations</button></div>
<p class="reduced-note">Animations start paused to respect your reduced-motion preference.</p>
<div class="gallery">${manifest.personas.map((p: any) => `<article class="study"><img class="still" src="${out}/${p.still}" hidden alt=""><img class="motion" src="${out}/${p.gif}" width="420" height="320" alt="${esc(p.name)} speaking, with a ${esc(p.cues[2].toLowerCase())}"><h3>${esc(p.name)}</h3><p class="role">${esc(p.role)}</p></article>`).join("")}</div>
<div class="section"><h2>Writing and loading in the app</h2><p>These use the same CSS and artwork as the updated app components. Written replies now have a pen and closed-mouth portrait movement. Loading uses manuscript lines and the participating cast.</p>
<div class="state-grid"><section class="state"><h3>A persona writing</h3><div class="writing">${portrait("editor", 80, true)}<div><span class="editorial-activity" data-kind="writing" role="status"><span class="editorial-activity__paper" aria-hidden="true"><span class="editorial-activity__line"></span><span class="editorial-activity__line"></span><span class="editorial-activity__line"></span><span class="editorial-activity__pen"></span></span><span>Writing a reply…</span></span><p style="margin:0;color:#59534d">The mouth stays closed.<br>Speech animation starts with audio.</p></div></div></section>
<section class="state"><h3>The room reading</h3><div class="editorial-loader" role="status"><div class="editorial-loader__scene" aria-hidden="true"><span class="editorial-loader__sheet editorial-loader__sheet--back"></span><span class="editorial-loader__sheet">${'<span class="editorial-loader__rule"></span>'.repeat(4)}</span><span class="editorial-loader__mark"></span></div><div class="editorial-loader__cast" aria-hidden="true">${PERSONAS.map((p, i) => `<span class="editorial-loader__resident" style="--reader-index:${i}">${portrait(p.id)}</span>`).join("")}</div><p class="editorial-loader__label">The room is reading</p><p class="editorial-loader__aside" aria-hidden="true">A manuscript at the proof desk.</p></div></section></div>
<p class="footer">The GIF studies are saved separately for review. The app keeps CSS motion so it can stop, react to audio, and respect reduced motion.</p></div>
<script>
const toggle=document.querySelector('#toggle');const gifs=Array.from(document.querySelectorAll('img.motion')).map(img=>({img,animated:img.src,still:img.previousElementSibling.src}));let paused=false;
function setPaused(value){paused=value;document.body.classList.toggle('paused',paused);gifs.forEach(({img,animated,still})=>img.src=paused?still:animated);toggle.textContent=paused?'Play animations':'Pause animations';toggle.setAttribute('aria-pressed',String(paused));}
toggle.addEventListener('click',()=>setPaused(!paused));const reduce=matchMedia('(prefers-reduced-motion: reduce)');if(reduce.matches)setPaused(true);reduce.addEventListener('change',e=>setPaused(e.matches));
console.log(JSON.stringify({gifCount:gifs.length,writingStates:document.querySelectorAll('[data-activity="writing"]').length,loadingScenes:document.querySelectorAll('.editorial-loader').length}));
</script></body></html>`;
await Bun.write(`${out}/preview.html`, html);
console.log(`${out}/preview.html`);
