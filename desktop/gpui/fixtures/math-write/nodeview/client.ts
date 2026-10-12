import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { MathExtensions } from "../../../../../src/components/editor/extensions/math";
import { loadKatexPeer } from "../../../../../src/components/editor/math/math-renderer";

// Fixture assembly only. All math NodeView, source editor, render, transaction,
// and history behavior comes from the actual imports above, never copied here.
const corpus = [
  {id:"ordinary",display:"inline",source:"x+1"},
  {id:"fraction",display:"inline",source:String.raw`\frac{1}{1+x^2}`},
  {id:"radical",display:"inline",source:String.raw`\sqrt{x^2+y^2}`},
  {id:"scripts",display:"inline",source:String.raw`x^{n+1}_{i}`},
  {id:"block",display:"block",source:String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`},
  {id:"unicode",display:"inline",source:String.raw`\text{Café}\quad\alpha`},
  {id:"invalid",display:"inline",source:String.raw`\frac{`},
  {id:"empty",display:"inline",source:""},
];
const editors=new Map<string,Editor>();
const root=document.querySelector("#cases")!;
const profile=new URL(location.href).searchParams.get("profile")??"original";
let active="ordinary";
for(const row of corpus){
  const section=document.createElement("section");section.dataset.case=row.id;section.className="fixture-case";
  const heading=document.createElement("h2");heading.className="fixture-caption";heading.textContent=`${row.id} / ${row.display}`;section.append(heading);
  const target=document.createElement("div");target.className="twyne-editor";section.append(target);root.append(section);
  const math={type:row.display==="block"?"blockMath":"inlineMath",attrs:{source:row.source}};
  const text=(value:string)=>({type:"paragraph",content:[{type:"text",text:value}]});
  const content=row.display==="block"?[text("Before block."),math,text("After block.")]:[{type:"paragraph",content:[{type:"text",text:"Before "},math,{type:"text",text:" after."}]}];
  const editor=new Editor({element:target,extensions:[StarterKit,...MathExtensions],content:{type:"doc",content},editorProps:{attributes:{class:"ProseMirror"}},onFocus(){active=row.id;}});
  editors.set(row.id,editor);
}
document.querySelector('[data-testid="fixture-undo"]')!.addEventListener("click",()=>editors.get(active)!.chain().focus().undo().run());
document.querySelector('[data-testid="fixture-redo"]')!.addEventListener("click",()=>editors.get(active)!.chain().focus().redo().run());
function data(){return{profile,active,rows:corpus.map(row=>({...row,html:editors.get(row.id)!.getHTML(),json:editors.get(row.id)!.getJSON(),canUndo:editors.get(row.id)!.can().undo(),canRedo:editors.get(row.id)!.can().redo()}))};}
// Non-DOM fixture state only, used for canonical manuscript assertions.
(globalThis as any).nodeviewFixture={data,corpus,settleFonts:()=>document.fonts.ready.then(()=>true)};
await loadKatexPeer();
await document.fonts.ready;
// Asset delivery is reported by font status/CDP; no face substitution occurs.
(globalThis as any).nodeviewFixture.ready=true;
document.querySelector("#fixture-status")!.textContent="Actual NodeViews ready";
