import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import {frameHeader} from '../processor/media.js';
registerHooks({resolve(spec,ctx,next){if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class WorkflowEntrypoint {constructor(ctx,env){this.env=env;this.ctx=ctx;}}',shortCircuit:true};return next(spec,ctx);}});
const {default:service,EpisodeWorkflow}=await import('../processor/index.js');
globalThis.FixedLengthStream=class {constructor(length){let count=0;const stream=new TransformStream({transform(chunk,controller){count+=chunk.length;controller.enqueue(chunk);},flush(){assert.equal(count,length);}});this.readable=stream.readable;this.writable=stream.writable;}};
function environment(){
  const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../processor/schema.sql',import.meta.url),'utf8'));db.exec(fs.readFileSync(new URL('../processor/migrations/005-account-unlimited.sql',import.meta.url),'utf8'));
  function prepare(sql,values=[]){return {bind(...v){return prepare(sql,v);},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};}
  const data=new Map();const AUDIO={async head(key){const b=data.get(key);return b?{size:b.length}:null;},async get(key,options){let b=data.get(key);if(!b)return null;if(options?.range){const {offset,length}=options.range;if(length<=0||offset>=b.length)throw Error('get: range not satisfiable');b=b.slice(offset,offset+length);}return {body:new Response(b).body,arrayBuffer:async()=>b.slice().buffer,json:async()=>JSON.parse(new TextDecoder().decode(b))};},async put(key,value){const b=typeof value==='string'?new TextEncoder().encode(value):new Uint8Array(await new Response(value).arrayBuffer());data.set(key,b);},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])data.delete(key);},async list({prefix}){return {objects:[...data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}))};}};
  return {db,data,env:{DB:{prepare,async batch(statements){return Promise.all(statements.map(x=>x.run()));}},AUDIO,INTERNAL_SECRET:'internal-test-secret',FEED_SECRET:'feed-test-secret'}};
}
const episodeId='e'.repeat(40),podcastId='a'.repeat(32);
function seed(db){db.prepare('INSERT INTO podcasts(id,feed_url,title) VALUES(?,?,?)').run(podcastId,'https://podcast.example.com/feed','Test show');db.prepare('INSERT INTO episodes(id,podcast_id,guid,title,source_url,published_at,created_at,status) VALUES(?,?,?,?,?,?,?,?)').run(episodeId,podcastId,'test','A real pipeline fixture','https://audio.example.com/episode.mp3',Math.floor(Date.now()/1000),Math.floor(Date.now()/1000),'processing');}
function audio(){const h=Uint8Array.from([255,251,144,0]),f=frameHeader(h),b=new Uint8Array(f.length*1000);for(let i=0;i<1000;i++)b.set(h,i*f.length);return b;}
const step={async do(name,config,callback){return (callback||config)();}};
test('complete MP3 pipeline handles exact EOF, cuts advertisements, streams audio and cleans temporary objects',async()=>{
  const {db,data,env}=environment();seed(db);const bytes=audio(),oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
  const calls=[];
  env.AI={async run(model,input){calls.push(model);if(model.includes('whisper'))return {segments:[{start:0,end:5,text:'This is a paid advertisement. Visit Sponsor for a discount.'},{start:5,end:26,text:'Now let us discuss the science of ocean currents.'}]};
    return {response:JSON.stringify(input.messages[0].content.startsWith('Review')?{decisions:[{candidate_id:0,action:'remove',start_index:0,end_index:0,confidence:.97,evidence:'Visit Sponsor for a discount.',reason:'Commercial offer'}]}:{ads:[{start_index:0,end_index:0,confidence:.99,sponsor:'Sponsor',reason:'Paid commercial'}]})};}};
  try{const result=await new EpisodeWorkflow({},env).run({payload:{episode_id:episodeId}},step);assert.equal(result.ads,1);assert.equal(result.candidates,1);assert.equal(calls.length,3);const ep=db.prepare('SELECT * FROM episodes WHERE id=?').get(episodeId);assert.equal(ep.status,'ready');assert.ok(ep.cleaned_duration<ep.duration-4.9);assert.equal(JSON.parse(ep.cuts_json)[0].verified,true);assert.equal(ep.audio_bytes,data.get('clean/'+episodeId+'.mp3').length);assert.ok(!data.has('original/'+episodeId+'.mp3'));assert.ok(![...data.keys()].some(k=>k.startsWith('work/')));}finally{globalThis.fetch=oldFetch;db.close();}
});
test('review rejects a false positive without removing any MP3 frames',async()=>{
  const {db,data,env}=environment();seed(db);const bytes=audio(),oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
  env.AI={async run(model,input){if(model.includes('whisper'))return {segments:[{start:0,end:26,text:'Sponsor stock fell after quarterly earnings. We discuss the business.'}]};return {response:input.messages[0].content.startsWith('Review')?{decisions:[{candidate_id:0,action:'keep',reason:'Editorial company news'}]}:{ads:[{start_index:0,end_index:0,confidence:.99,sponsor:'Sponsor'}]}};}};
  try{const result=await new EpisodeWorkflow({},env).run({payload:{episode_id:episodeId}},step);assert.equal(result.ads,0);assert.equal(result.kept_by_review,1);assert.deepEqual(data.get('clean/'+episodeId+'.mp3'),bytes);assert.equal(db.prepare('SELECT status FROM episodes WHERE id=?').get(episodeId).status,'ready');}finally{globalThis.fetch=oldFetch;db.close();}
});
test('review provider failure cannot publish a first-pass cut',async()=>{
  const {db,data,env}=environment();seed(db);const bytes=audio(),oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
  env.AI={async run(model,input){if(model.includes('whisper'))return {segments:[{start:0,end:5,text:'This is a paid advertisement for Sponsor.'},{start:5,end:26,text:'Ocean science.'}]};if(input.messages[0].content.startsWith('Review'))throw Error('Reviewer unavailable');return {response:{ads:[{start_index:0,end_index:0,confidence:.99}]}};}};
  try{await assert.rejects(()=>new EpisodeWorkflow({},env).run({payload:{episode_id:episodeId}},step),/Reviewer unavailable/);assert.ok(!data.has('clean/'+episodeId+'.mp3'));assert.equal(db.prepare('SELECT status FROM episodes WHERE id=?').get(episodeId).status,'failed');}finally{globalThis.fetch=oldFetch;db.close();}
});
test('REST JSON payloads run the same audio pipeline and invalid payloads make no database calls',async()=>{
  const {db,data,env}=environment();seed(db);const bytes=audio(),oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});
  env.AI={async run(model){return model.includes('whisper')?{segments:[{start:0,end:26,text:'An episode about ocean currents.'}]}:{response:'{"ads":[]}'};}};
  try{
    const result=await new EpisodeWorkflow({},env).run({payload:JSON.stringify({episode_id:episodeId})},step);assert.equal(result.episode_id,episodeId);assert.equal(db.prepare('SELECT status FROM episodes WHERE id=?').get(episodeId).status,'ready');assert.ok(data.has('clean/'+episodeId+'.mp3'));
    const noDB={DB:{prepare(){throw Error('Invalid payload reached D1');}}};
    for(const payload of ['invalid JSON',{},null,{episode_id:'invalid-id'}])await assert.rejects(()=>new EpisodeWorkflow({},noDB).run({payload},step),/payload|episode_id/);
  }finally{globalThis.fetch=oldFetch;db.close();}
});
test('transcription failure leaves episode out of ready feeds',async()=>{
  const {db,data,env}=environment();seed(db);const bytes=audio(),oldFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(bytes,{headers:{'Content-Type':'audio/mpeg','Content-Length':String(bytes.length)}});env.AI={async run(){throw Error('Provider unavailable');}};
  try{await assert.rejects(()=>new EpisodeWorkflow({},env).run({payload:{episode_id:episodeId}},step),/Provider unavailable/);assert.equal(db.prepare('SELECT status FROM episodes WHERE id=?').get(episodeId).status,'failed');assert.ok(!data.has('clean/'+episodeId+'.mp3'));}finally{globalThis.fetch=oldFetch;db.close();}
});
test('accounts are isolated; feed rotation and account deletion revoke old capabilities',async()=>{
  const {db,data,env}=environment();seed(db);
  const internal=(subject,path,method='GET')=>service.fetch(new Request('https://service.example/internal/'+path,{method,headers:{Authorization:'Bearer '+env.INTERNAL_SECRET,'X-Podplane-Subject':subject}}),env);
  const a=await (await internal('alice','dashboard')).json(),b=await (await internal('bob','dashboard')).json();assert.notEqual(a.feed_url,b.feed_url);
  const alice=db.prepare('SELECT id FROM accounts WHERE subject=?').get('alice');db.prepare('INSERT INTO subscriptions VALUES(?,?,?)').run(alice.id,podcastId,Math.floor(Date.now()/1000));db.prepare("UPDATE episodes SET status='ready',audio_bytes=5,duration=20,cleaned_duration=15 WHERE id=?").run(episodeId);data.set('clean/'+episodeId+'.mp3',new Uint8Array([1,2,3,4,5]));
  assert.equal((await (await internal('alice','dashboard')).json()).shows.length,1);assert.equal((await (await internal('bob','dashboard')).json()).shows.length,0);
  const aliceAudio=a.feed_url.replace(/rss$/,'audio/'+episodeId+'.mp3'),bobAudio=b.feed_url.replace(/rss$/,'audio/'+episodeId+'.mp3');
  assert.equal((await service.fetch(new Request(aliceAudio),env)).status,200);assert.equal((await service.fetch(new Request(bobAudio),env)).status,404);
  const range=await service.fetch(new Request(aliceAudio,{headers:{Range:'bytes=1-3'}}),env);assert.equal(range.status,206);assert.equal(range.headers.get('Content-Range'),'bytes 1-3/5');assert.deepEqual([...new Uint8Array(await range.arrayBuffer())],[2,3,4]);
  const rotated=await (await internal('alice','rotate','POST')).json();assert.equal((await service.fetch(new Request(a.feed_url),env)).status,404);assert.equal((await service.fetch(new Request(rotated.feed_url),env)).status,200);
  assert.equal((await internal('alice','account','DELETE')).status,200);assert.equal((await service.fetch(new Request(rotated.feed_url),env)).status,404);db.close();
});
