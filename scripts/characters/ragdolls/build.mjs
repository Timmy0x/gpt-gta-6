import {build} from 'vite';
import {mkdir,readFile,writeFile,symlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const source=resolve(process.env.RAGDOLL_SOURCE||'.local-builds/ragdoll-r1-source'),outDir=resolve(process.env.RAGDOLL_BUILD||'.local-builds/ragdoll-r1');
await build({configFile:false,publicDir:false,resolve:{alias:{'@ragdoll-source':resolve(source,'src')}},build:{outDir,emptyOutDir:false,rollupOptions:{input:resolve('scripts/characters/ragdolls/preview.html')}}});
await mkdir(outDir,{recursive:true});await symlink(resolve(source,'public/characters'),resolve(outDir,'characters')).catch(e=>{if(e.code!=='EEXIST')throw e;});
const files=await Promise.all(['Character.ts','CharacterContactIK.ts','CharacterSkinSupport.ts','Injuries.ts','InjuryPose.ts','combat/RagdollReactions.ts','combat/RagdollAnatomy.ts','police/Officer.ts'].map(async file=>({file,sha256:createHash('sha256').update(await readFile(resolve(source,'src/gameplay',file))).digest('hex')})));
await writeFile(resolve(outDir,'source-fingerprint.json'),JSON.stringify({source,files,scope:'Consecutive native Havok fall and handoff frames with the actual skins. Normal controls are verified separately.'},null,2));
