// Direct cached-artifact check: no Cargo, Devenv, downloads or devices.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
const root=path.resolve(import.meta.dir,"../../../..");
const deps=path.join(root,"desktop/gpui/target/debug/deps");
const rustc=process.env.NATIVE_AUDIO_RUSTC??"/home/diogenes/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin/rustc";
const externs=["serde","serde_json","regex","sha2"].flatMap(name=>{
  const candidate=fs.readdirSync(deps).filter(file=>file.startsWith(`lib${name}-`)&&file.endsWith(".rlib")).map(file=>path.join(deps,file)).sort((a,b)=>fs.statSync(b).mtimeMs-fs.statSync(a).mtimeMs)[0];
  if(!candidate)throw new Error(`Cached ${name} is unavailable; this check never installs dependencies.`);
  return["--extern",`${name}=${candidate}`];
});
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"twyne-native-audio-"));
function run(command:string[]){
  const result=spawnSync("rtk",["proxy",...command],{cwd:root,stdio:"inherit",env:{...process.env,PATH:`/usr/bin:${process.env.PATH}`}});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`Direct check failed (${result.status}); select a cached-artifact-compatible NATIVE_AUDIO_RUSTC. No Cargo fallback runs.`);
}
try{
  const flags=["--edition=2024","-L",`dependency=${deps}`,...externs];
  run([rustc,...flags,"--crate-type=lib","-Dwarnings","desktop/gpui/src/native_audio/mod.rs","-o",path.join(scratch,"native_audio.rlib")]);
  const runner=path.join(scratch,"tests");
  run([rustc,...flags,"--test","desktop/gpui/fixtures/native-audio/synthetic_loopback.rs","-o",runner]);
  run([runner]);
}finally{fs.rmSync(scratch,{recursive:true,force:true});}
