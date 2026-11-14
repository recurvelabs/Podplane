import test from 'node:test';
import assert from 'node:assert/strict';
import {auditTranscript,coveredSegments} from '../processor/audit.js';

test('full audit recovers midroll setup, a consecutive sponsor and a closing tagline, then checks every retained segment again',async()=>{
  const t=Array.from({length:300},(_,i)=>({start:i*5,end:i*5+5,text:'Editorial company news and host conversation.'}));
  t[148].text='A personal anecdote introducing our sponsor.';
  t[149].text='Sponsored by Example. Visit example.com for a discount.';
  t[150].text='Example: always here for you.';
  t[151].text='Our next sponsor is Another. Try Another today.';
  t[299].text='This closing message is sponsored by Last.';
  const cuts=[{start_index:149,end_index:149,start:745,end:750,confidence:.98}];
  const windows=[],reviewed=[];
  const ai={async run(_model,input){
    const p=JSON.parse(input.messages[1].content);
    if(p.proposals){
      const c=p.proposals[0];reviewed.push(c);
      const evidence=c.start_index===148?t[149].text:t[299].text;
      return {response:{decisions:[{candidate_id:0,action:'remove',start_index:c.start_index,end_index:c.end_index,confidence:.98,evidence}]}};
    }
    windows.push([p.target_start_index,p.target_end_index]);
    const covered=(n)=>p.verified_cuts.some(c=>c.start_index<=n&&c.end_index>=n);
    const ads=[];
    if(p.target_start_index===120&&!covered(148))ads.push({start_index:148,end_index:151,confidence:.98,sponsor:'Example and Another'});
    if(p.target_start_index===240&&!covered(299))ads.push({start_index:299,end_index:299,confidence:.98,sponsor:'Last'});
    return {response:{ads}};
  }};
  const r=await auditTranscript(ai,{title:'Audit regression',transcript:t,cuts});
  assert.equal(r.converged,true);assert.equal(r.passes.length,2);assert.deepEqual(r.passes.map(p=>p.added_segments),[4,0]);
  assert.deepEqual(windows,[[0,119],[120,239],[240,299],[0,119],[120,239],[240,299]]);
  assert.equal(reviewed.length,2);assert.ok(reviewed[0].candidate_transcript.includes(t[149].text));
  const covered=coveredSegments(t,[...cuts,...r.cuts]);
  assert.equal(covered[147],false);assert.equal(covered[152],false);assert.equal(covered[299],true);
});

test('audit never bridges an editorial gap or removes an unreviewed fragment',async()=>{
  const t=[{start:0,end:2,text:'Sponsored by Alpha.'},{start:2,end:3,text:'Back to our conversation.'},{start:3,end:5,text:'Sponsored by Beta.'}];
  const cuts=[{start_index:0,end_index:0,start:0,end:2,confidence:.98},{start_index:2,end_index:2,start:3,end:5,confidence:.98}];
  const ai={async run(_model,input){return {response:input.messages[0].content.startsWith('Review')?{decisions:[{candidate_id:0,action:'keep'}]}:{ads:[{start_index:1,end_index:1,confidence:.98}]}};}};
  const r=await auditTranscript(ai,{title:'Editorial gap',transcript:t,cuts});
  assert.equal(r.converged,true);assert.deepEqual(r.cuts,[]);assert.deepEqual(coveredSegments(t,cuts),[true,false,true]);
});

test('missing reviewer decisions remain pending across audit passes even when redetection misses them',async()=>{
  const t=[{start:0,end:5,text:'This episode is sponsored by Example.'}],pending=[{start_index:0,end_index:0,start:0,end:5,confidence:.98}];
  const ai={async run(_model,input){return {response:input.messages[0].content.startsWith('Review')?{decisions:[]}:{ads:[]}};}};
  const r=await auditTranscript(ai,{title:'Incomplete review',transcript:t,cuts:[],pending});
  assert.equal(r.converged,false);assert.equal(r.unreviewed,1);assert.equal(r.passes.length,3);assert.deepEqual(r.cuts,[]);
});

test('coverage uses the union of timestamps and ignores stale merged index metadata',()=>{
  const t=[{start:0,end:2},{start:2,end:4},{start:4,end:6}];
  assert.deepEqual(coveredSegments(t,[{start:0,end:4,start_index:0,end_index:0}]),[true,true,false]);
  assert.deepEqual(coveredSegments(t,[{start:0,end:1},{start:1,end:2}]),[true,false,false]);
  assert.deepEqual(coveredSegments(t,[{start:0,end:.9},{start:1,end:2}]),[false,false,false]);
});
