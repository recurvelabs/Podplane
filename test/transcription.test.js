import test from 'node:test';
import assert from 'node:assert/strict';
import {transcribeAudio} from '../processor/transcription.js';

function environment(){
  const objects=new Map();let calls=0;
  return {objects,get calls(){return calls;},env:{
    AUDIO:{async get(key){return objects.has(key)?{json:async()=>JSON.parse(objects.get(key))}:null;},async put(key,value){objects.set(key,value);}},
    AI:{async run(){calls++;return {segments:[{start:0,end:5,text:'Podcast conversation.'}]};}}
  }};
}
test('identical audio reuses transcription across retries and episodes',async()=>{
  const f=environment(),bytes=new Uint8Array([1,2,3]);
  const first=await transcribeAudio(f.env,bytes,6),second=await transcribeAudio(f.env,bytes.slice(),6);
  assert.deepEqual(second,first);assert.equal(f.calls,1);assert.equal(f.objects.size,1);
});
test('changed publisher audio and changed chunk duration require fresh transcription',async()=>{
  const f=environment();await transcribeAudio(f.env,new Uint8Array([1,2,3]),6);
  await transcribeAudio(f.env,new Uint8Array([1,2,4]),6);
  await transcribeAudio(f.env,new Uint8Array([1,2,4]),7);
  assert.equal(f.calls,3);
});
test('expired, malformed and invalid cached timestamps are regenerated',async()=>{
  for(const corrupt of ['{',JSON.stringify({created_at:0,duration:6,segments:[]}),JSON.stringify({created_at:Math.floor(Date.now()/1000),duration:6,segments:[{start:0,end:99,text:'Bad timestamps.'}]})]){
    const f=environment(),bytes=new Uint8Array([1,2,3]);await transcribeAudio(f.env,bytes,6);
    const key=[...f.objects.keys()][0];f.objects.set(key,corrupt);
    await transcribeAudio(f.env,bytes,6);assert.equal(f.calls,2);
  }
});
test('operator retranscription bypasses a valid cache',async()=>{
  const f=environment(),bytes=new Uint8Array([1,2,3]);await transcribeAudio(f.env,bytes,6);
  await transcribeAudio(f.env,bytes,6,{force:true});assert.equal(f.calls,2);
});
test('provider failures and missing timestamps never populate the cache',async()=>{
  const f=environment(),bytes=new Uint8Array([1,2,3]);
  f.env.AI.run=async()=>{throw Error('Provider unavailable');};
  await assert.rejects(()=>transcribeAudio(f.env,bytes,6),/Provider unavailable/);assert.equal(f.objects.size,0);
  f.env.AI.run=async()=>({text:'Speech with no timestamps.'});
  await assert.rejects(()=>transcribeAudio(f.env,bytes,6),/no timestamps/);assert.equal(f.objects.size,0);
});
test('VTT fallback and silent audio reuse valid relative timestamps',async()=>{
  const f=environment(),bytes=new Uint8Array([1,2,3]);
  f.env.AI.run=async()=>({vtt:'00:00:01.000 --> 00:00:08.000\nHello from a podcast.\n\n'});
  assert.deepEqual(await transcribeAudio(f.env,bytes,6),[{start:1,end:6,text:'Hello from a podcast.'}]);
  f.env.AI.run=async()=>{throw Error('Cached VTT must be reused');};
  assert.deepEqual(await transcribeAudio(f.env,bytes,6),[{start:1,end:6,text:'Hello from a podcast.'}]);
  const silent=environment();silent.env.AI.run=async()=>({segments:[]});
  assert.deepEqual(await transcribeAudio(silent.env,bytes,6),[]);
  silent.env.AI.run=async()=>{throw Error('Silent chunks must be reused');};
  assert.deepEqual(await transcribeAudio(silent.env,bytes,6),[]);
});
