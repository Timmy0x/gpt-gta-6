import test from 'node:test';import assert from 'node:assert/strict';
import {GoogleCloudAuthPlugin,CesiumIonAuthPlugin} from '3d-tiles-renderer/core/plugins';
import {redactDiagnosticArgs} from '../src/diagnostics';
// These tests intercept every fetch. Dummy values are never sent to a provider.
interface Plugin {init(tiles:unknown):void;fetchData(url:string,options:RequestInit):Promise<unknown>;loadRootTileset():Promise<unknown>;}
test('Google403 and nested framework errors are redacted without a live API request',async()=>{
 const original=globalThis.fetch,key='synthetic-google-key-not-valid';const urls:string[]=[];
 globalThis.fetch=async(input)=>{urls.push(String(input));return new Response(JSON.stringify({error:{code:403,message:'Synthetic denied'}}),{status:403,headers:{'Content-Type':'application/json'}});};
 try{const plugin=new GoogleCloudAuthPlugin({apiToken:key}) as unknown as Plugin;plugin.init({rootURL:'https://tile.googleapis.com/v1/3dtiles/root.json',resetFailedTiles(){},addEventListener(){}});
  await assert.rejects(()=>plugin.fetchData('https://tile.googleapis.com/v1/3dtiles/root.json',{}));assert.equal(urls.length,1);assert.ok(urls[0].includes(key));
  const logged=JSON.stringify(redactDiagnosticArgs([new Error(`Failed ${urls[0]}&session=sensitive-session`),{auth:{apiToken:key},url:urls[0],message:key}],key));assert.ok(!logged.includes(key));assert.ok(!logged.includes('sensitive-session'));assert.ok(!logged.includes('?key='));
 }finally{globalThis.fetch=original;}
});
test('ion403 emits a root load-error even when its promise resolves, with redacted metadata',async()=>{
 const original=globalThis.fetch,key='synthetic-ion-token-not-valid';let requests=0;const events:Array<{type:string;error?:Error;url?:string}>=[];
 globalThis.fetch=async()=>{requests++;return new Response('Synthetic unauthorized',{status:403});};
 try{const plugin=new CesiumIonAuthPlugin({apiToken:key,assetId:'2275207'}) as unknown as Plugin;const tiles={rootURL:'',resetFailedTiles(){},dispatchEvent(event:{type:string;error?:Error;url?:string}){events.push(event);}};plugin.init(tiles);await plugin.loadRootTileset();assert.equal(requests,1);assert.equal(events[0]?.type,'load-error');assert.match(events[0].error!.message,/403/);assert.ok(!JSON.stringify(redactDiagnosticArgs(events,key)).includes(key));}
 finally{globalThis.fetch=original;}
});
