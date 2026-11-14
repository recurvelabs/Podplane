import test from 'node:test';
import assert from 'node:assert/strict';
import {refineBoundaries} from '../processor/boundaries.js';
import {findBoundaryIssues} from '../processor/detection.js';

test('mixed ad disclaimer and returning host are split at observed word timestamps and reviewed again',async()=>{
  const transcript=[{start:0,end:5,text:'This episode is sponsored by Example.'},{start:5,end:10,text:"Terms apply. Scott, we are back."},{start:10,end:20,text:'Congress passed a bill.'}];
  const cuts=[{start_index:0,end_index:1,start:0,end:10,confidence:.98,sponsor:'Example',reviews:[{start_index:0,end_index:1}]}];
  let boundaryChecks=0,wordCalls=0;
  const ai={async run(_model,input){
    const p=JSON.parse(input.messages[1].content);
    if(p.edges){boundaryChecks++;return {response:{assessments:p.edges.map(e=>({segment_id:e.segment_id,contains_editorial:boundaryChecks===1&&e.segment_id===1,editorial_quote:boundaryChecks===1&&e.segment_id===1?'Scott, we are back.':''}))}};}
    if(p.proposals){assert.match(p.proposals[0].candidate_transcript,/\[3\].*Scott/);return {response:{decisions:[{candidate_id:0,action:'remove',start_index:0,end_index:2,confidence:.98,evidence:'This episode is sponsored by Example.'}]}};}
    return {response:{ads:[]}};
  }};
  const r=await refineBoundaries(ai,{title:'Mixed speech',transcript,cuts,duration:20,transcribeSegment:async s=>{
    wordCalls++;assert.deepEqual(s,transcript[1]);return [{start:5,end:5.5,text:'Terms'},{start:5.5,end:6,text:'apply.'},{start:6,end:7,text:'Scott,'},{start:7,end:8,text:'we'},{start:8,end:9,text:'are'},{start:9,end:10,text:'back.'}];
  }});
  assert.equal(r.refined_segments,1);assert.equal(wordCalls,1);assert.equal(boundaryChecks,2);assert.equal(r.cuts[0].end,6);assert.equal(r.coverage.converged,true);
  assert.equal(r.transcript[r.cuts[0].end_index+1].text,'Scott,');
});

test('uncertain boundary timing holds publication; fabricated segment IDs cannot trigger transcription',async()=>{
  const transcript=[{start:0,end:10,text:'An ad. Back to the show.'}],cuts=[{start_index:0,end_index:0,start:0,end:10,confidence:.98}];
  const ai={async run(){return {response:{assessments:[{segment_id:0,contains_editorial:true,editorial_quote:'Back to the show.'}]}};}};
  await assert.rejects(()=>refineBoundaries(ai,{title:'No timestamps',transcript,cuts,duration:10,transcribeSegment:async()=>[]}),/could not be transcribed/);
  await assert.rejects(()=>findBoundaryIssues({async run(){return {response:{assessments:[{segment_id:99,contains_editorial:true,editorial_quote:'Back to the show.'}]}};}},{title:'Invalid IDs',transcript,cuts}),/omitted a verdict/);
});

test('final boundary checks read word-timed editorial phrases together',async()=>{
 const transcript=[{start:0,end:2,text:'Sponsored by Example.'},...['Terms','apply.','We','are','going','to','start'].map((text,i)=>({start:2+i,end:3+i,text,boundary_group:1}))];
 const cuts=[{start_index:0,end_index:7,start:0,end:9,confidence:.98}];
 const ai={async run(_model,input){
  const p=JSON.parse(input.messages[1].content);
  assert.equal(p.edges[1].target_text,'Terms apply. We are going to start');
  return {response:{assessments:p.edges.map(e=>({segment_id:e.segment_id,contains_editorial:e.segment_id===7,editorial_quote:e.segment_id===7?'We are going to start':''}))}};
 }};
 assert.deepEqual(await findBoundaryIssues(ai,{title:'Word boundary',transcript,cuts}),[7]);
});

test('an independent boundary quote repairs a contradictory reviewer range through production review',async()=>{
 const transcript=[{start:0,end:5,text:'Sponsored by Example.'},{start:5,end:10,text:'Terms apply. We are back.'},{start:10,end:20,text:'Our next topic.'}];
 const cuts=[{start_index:0,end_index:1,start:0,end:10,confidence:.98,sponsor:'Example'}];
 let reviews=0,audits=0;
 const ai={async run(_model,input){
  const p=JSON.parse(input.messages[1].content);
  if(p.edges)return {response:{assessments:p.edges.map(e=>({segment_id:e.segment_id,contains_editorial:e.target_text.includes('We are back.'),editorial_quote:e.target_text.includes('We are back.')?'We are back.':''}))}};
  if(p.proposals){reviews++;const c=p.proposals[0];return {response:{decisions:[{candidate_id:0,action:'remove',start_index:c.start_index,end_index:c.end_index,confidence:.99,evidence_segment_id:0,reason:'Sponsor read'}]}};}
  audits++;return {response:{ads:[]}};
 }};
 const r=await refineBoundaries(ai,{title:'Contradictory indices',transcript,cuts,duration:20,transcribeSegment:async()=>['Terms','apply.','We','are','back.'].map((text,i)=>({start:5+i,end:6+i,text}))});
 assert.equal(reviews,2);assert.equal(audits,2);assert.equal(r.boundary_repairs,1);
 assert.equal(r.cuts[0].end,7);assert.equal(r.transcript[r.cuts[0].end_index+1].text,'We');
 assert.equal(r.cuts[0].boundary_protection[0].evidence,'We are back.');
});

test('a partly cut editorial transition is recognized from its full original phrase',async()=>{
 const transcript=[{start:0,end:2,text:'Sponsored by Example.'},...['Terms','apply.','We','are','going','to','start'].map((text,i)=>({start:2+i,end:3+i,text,boundary_group:1})),{start:9,end:15,text:'with our next guest.'}];
 const ai={async run(_model,input){
  const p=JSON.parse(input.messages[1].content);
  assert.equal(p.edges[1].target_text,'Terms apply. We are going to start');
  return {response:{assessments:p.edges.map((e,i)=>({segment_id:e.segment_id,contains_editorial:i===1,editorial_quote:i===1?'We are going to start':''}))}};
 }};
 const cut={start_index:0,end_index:6,start:0,end:8,confidence:.98};
 assert.deepEqual(await findBoundaryIssues(ai,{title:'Partial phrase',transcript,cuts:[cut]}),[6]);
 assert.deepEqual(await findBoundaryIssues(ai,{title:'Protected phrase',transcript,cuts:[{...cut,end_index:2,end:4}]}),[]);
});
