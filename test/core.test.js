import test from 'node:test';
import assert from 'node:assert/strict';
import {frameHeader,scanFrames,keepRanges,normalizeCuts,parseRange} from '../processor/media.js';
import {parseFeed,publicURL,rss,boundedText,safeFetch} from '../processor/feeds.js';
import app from '../worker/index.js';

function mp3(n=500){const h=Uint8Array.from([255,251,144,0]),f=frameHeader(h);const b=new Uint8Array(f.length*n);for(let i=0;i<n;i++)b.set(h,i*f.length);return b;}
test('MP3 frame scanner preserves exact sample duration and frame boundaries',()=>{const b=mp3(),r=scanFrames(b,0,0,5);assert.ok(r.end>=5&&r.end<5.027);assert.equal(r.offset%417,0);assert.equal(r.frames[0][0],0);const next=scanFrames(b.subarray(r.offset),r.offset,r.end);assert.equal(next.frames[0][0],r.offset);assert.equal(next.start,r.end);});
test('MP3 trim only discards requested frames and preserves contiguous ranges',()=>{const r=scanFrames(mp3(100));const c=[{start:r.frames[20][2],end:r.frames[40][2]}];const kept=keepRanges(r.frames,c);assert.equal(kept.ranges.length,2);assert.equal(kept.ranges.reduce((n,x)=>n+x.length,0),80*417);assert.ok(Math.abs(kept.duration-80*1152/44100)<1e-6);});
test('cuts are confidence filtered, clamped, sorted and merged',()=>{assert.deepEqual(normalizeCuts([{start:5,end:10,confidence:.95},{start:9,end:12,confidence:.99},{start:20,end:30,confidence:.6}],25).map(x=>[x.start,x.end]),[[5,12]]);});
test('cut merging preserves short conversation gaps and rejects invalid confidence',()=>{
  const cuts=normalizeCuts([{start:0,end:2,confidence:.99},{start:2.1,end:4,confidence:.95},{start:7,end:8,confidence:Infinity},{start:8,end:9,confidence:1.5}],10);
  assert.deepEqual(cuts.map(c=>[c.start,c.end]),[[0,2],[2.1,4]]);
});
test('frames crossing a cut boundary stay audible',()=>{
  const frames=[[0,10,0,1],[10,10,1,1],[20,10,2,1],[30,10,3,1]];
  const kept=keepRanges(frames,[{start:.8,end:3.2}]);
  assert.deepEqual(kept,{ranges:[{offset:0,length:10},{offset:30,length:10}],duration:2});
});
test('audio ranges support byte seeks and suffix requests',()=>{assert.deepEqual(parseRange('bytes=20-29',100),{offset:20,length:10});assert.deepEqual(parseRange('bytes=-10',100),{offset:90,length:10});assert.deepEqual(parseRange('bytes=90-',100),{offset:90,length:10});assert.throws(()=>parseRange('bytes=100-',100));assert.throws(()=>parseRange('bytes=1-3,8-10',100));});
test('RSS parsing preserves CDATA, enclosures and stable GUIDs',()=>{const f=parseFeed('<?xml version="1.0"?><rss version="2.0"><channel><title>A &amp; B</title><item><title><![CDATA[Hello <b>world</b>]]></title><guid isPermaLink="false">abc</guid><pubDate>Sun, 08 Nov 2026 12:00:00 GMT</pubDate><enclosure url="https://audio.example.com/a.mp3?a=1&amp;b=2" type="audio/mpeg"/></item></channel></rss>');assert.equal(f.title,'A & B');assert.equal(f.episodes[0].guid,'abc');assert.equal(f.episodes[0].title,'Hello world');assert.match(f.episodes[0].source_url,/a=1&b=2/);});
test('RSS rejects entities and non-podcast documents',()=>{assert.throws(()=>parseFeed('<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///etc/passwd">]><rss/>'));assert.throws(()=>parseFeed('<html><title>Web</title></html>'));});
test('large RSS archives are cancelled after a complete validated episode prefix',async()=>{const item=i=>'<item><title>Episode '+i+'</title><guid>'+i+'</guid><pubDate>Sun, 08 Nov 2026 12:00:00 GMT</pubDate><description><![CDATA['+'x'.repeat(1200)+']]></description><enclosure url="https://audio.example.com/'+i+'.mp3" type="audio/mpeg"/></item>';const xml='<rss version="2.0"><channel><title>Large archive</title>'+Array.from({length:500},(_,i)=>item(i)).join('')+'</channel></rss>';let offset=0,cancelled=false;const stream=new ReadableStream({pull(c){if(offset>=xml.length){c.close();return;}c.enqueue(new TextEncoder().encode(xml.slice(offset,offset+8192)));offset+=8192;},cancel(){cancelled=true;}});const prefix=await boundedText(new Response(stream));assert.equal(parseFeed(prefix).episodes.length,30);assert.ok(cancelled);assert.ok(prefix.length<xml.length/2);});
test('upstream fetching rejects private addresses, credentials, ports and non-HTTPS',()=>{for(const x of ['http://example.com/feed','https://127.0.0.1/a','https://2130706433/a','https://localhost/a','https://[::1]/a','https://user:pw@example.com/a','https://example.com:8443/a'])assert.throws(()=>publicURL(x));assert.equal(publicURL('https://feeds.example.com/a'),'https://feeds.example.com/a');});
test('publisher audio can pass through eight redirects and releases every intermediate body',async()=>{
  const oldFetch=globalThis.fetch,trace=[];let requests=0,cancelled=0;
  globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.headers.Range,'bytes=0-0');requests++;const i=Number(new URL(url).pathname.slice(1));if(i===8)return new Response('audio',{headers:{'Content-Type':'audio/mpeg'}});return new Response(new ReadableStream({cancel(){cancelled++;}}),{status:[301,302,307,308][i%4],headers:{Location:i%2?'/'+(i+1):'https://cdn.example.com/'+(i+1)}});};
  try{const r=await safeFetch('https://publisher.example.com/0',{headers:{Range:'bytes=0-0'},redirectTrace:trace});assert.equal(await r.text(),'audio');assert.equal(requests,9);assert.equal(cancelled,8);assert.equal(trace.length,8);assert.deepEqual(trace[0],{status:301,from:'publisher.example.com',to:'cdn.example.com'});}finally{globalThis.fetch=oldFetch;}
});
test('redirect handling rejects cycles and private destinations before another request',async()=>{
  const oldFetch=globalThis.fetch;
  try{
    let calls=0;globalThis.fetch=async url=>{calls++;return new Response(null,{status:302,headers:{Location:new URL(url).pathname==='/a'?'/b':'/a'}});};
    await assert.rejects(()=>safeFetch('https://publisher.example.com/a'),/redirect loop/);assert.equal(calls,2);
    calls=0;globalThis.fetch=async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}});};
    await assert.rejects(()=>safeFetch('https://publisher.example.com/a'),/public HTTPS/);assert.equal(calls,1);
  }finally{globalThis.fetch=oldFetch;}
});
test('redirect handling permits twenty redirects and bounds longer chains',async()=>{
  const oldFetch=globalThis.fetch;
  try{
    for(const limit of [20,21]){let calls=0;globalThis.fetch=async url=>{calls++;const n=Number(new URL(url).pathname.slice(1));return n===limit?new Response('done'):new Response(null,{status:302,headers:{Location:'/'+(n+1)}});};
      if(limit===20)assert.equal(await (await safeFetch('https://publisher.example.com/0')).text(),'done');
      else await assert.rejects(()=>safeFetch('https://publisher.example.com/0'),/limit: 20/);
      assert.equal(calls,21);
    }
  }finally{globalThis.fetch=oldFetch;}
});
test('generated feeds escape metadata and use edited durations and byte lengths',()=>{const text=rss({title:'A&B',description:'<script>',self:'https://example.com/rss',link:'https://example.com',items:[{id:'123',title:'A<B',description:'Text',published_at:1700000000,duration:100,cleaned_duration:80,audio_bytes:1000,audio_url:'https://example.com/a.mp3?a=1&b=2'}]});assert.match(text,/<title>A&amp;B<\/title>/);assert.match(text,/<itunes:duration>80<\/itunes:duration>/);assert.match(text,/length="1000"/);assert.ok(!text.includes('<script>'));});
test('anonymous dashboard uses the native sign-in route',async()=>{const r=await app.fetch(new Request('https://example.com/app'),{PODPLANE_NATIVE_AUTH:true});assert.equal(r.status,302);assert.match(r.headers.get('location'),/\/signin$/);});
test('legacy website redirects to the staging host',async()=>{const r=await app.fetch(new Request('https://example.com/catalog'),{});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'https://podplane-staging.challoner.dev/catalog');});
test('HTML escapes signed-in identity and all page scripts parse',async()=>{for(const path of ['/app','/settings','/signin','/catalog','/privacy']){const r=await app.fetch(new Request('https://example.com'+path),{PODPLANE_NATIVE_AUTH:true,PODPLANE_USER:{id:'x',email:'<script>evil</script>'}});const body=await r.text();assert.ok(!body.includes('<script>evil</script>'));if(path==='/settings')assert.ok(body.includes('&lt;script&gt;evil&lt;/script&gt;'));for(const source of body.matchAll(/<script>([\s\S]*?)<\/script>/g))assert.doesNotThrow(()=>new Function(source[1]));assert.ok(!body.includes('signin-with-chatgpt'));}});
