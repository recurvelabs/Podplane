import {findBoundaryIssues,findBoundaryFindings,reviewCandidates} from './detection.js';
import {auditTranscript} from './audit.js';
import {normalizeCuts} from './media.js';

export async function refineBoundaries(ai,{title,transcript,cuts,duration,transcribeSegment,runStep=(_name,fn)=>fn()}){
  const issues=await runStep('boundary-check-v11',()=>findBoundaryIssues(ai,{title,transcript,cuts}));
  if(!issues.length)return {transcript,cuts,refined_segments:0,coverage:null};
  const replacements=new Map();
  for(const i of issues){
    const words=await runStep(`boundary-words-v11-${i}`,()=>transcribeSegment(transcript[i]));
    if(!words.length)throw new Error('A mixed ad boundary could not be transcribed precisely');
    replacements.set(i,words.map(s=>({...s,boundary_group:i}))); 
  }
  const refined=[],mapping=[];
  for(let i=0;i<transcript.length;i++){
    const first=refined.length;refined.push(...(replacements.get(i)||[transcript[i]]));
    mapping.push({first,last:refined.length-1});
  }
  const remap=c=>({...c,start_index:mapping[c.start_index].first,end_index:mapping[c.end_index].last,...(c.evidence_segment_id!==undefined?{evidence_segment_id:mapping[c.evidence_segment_id].first}:{})});
  const accepted=[],pending=[];
  for(let i=0;i<cuts.length;i++){
    const original=cuts[i],c={...remap(original),reviews:original.reviews?.map(remap)};
    if(!issues.includes(original.start_index)&&!issues.includes(original.end_index)){accepted.push(c);continue;}
    const args={title,transcript:refined,candidates:[c],lo:Math.max(0,c.start_index-4),hi:Math.min(refined.length,c.end_index+5)};
    let review=await runStep(`boundary-review-v11-${i}`,()=>reviewCandidates(ai,args));
    if(review.unreviewed)review=await runStep(`boundary-review-retry-v11-${i}`,()=>reviewCandidates(ai,{...args,retry:true}));
    accepted.push(...review.cuts);if(review.unreviewed)pending.push(c);
  }
  const passes=[];let current=accepted,unresolved=pending,boundaryRepairs=0;
  for(let round=0;round<3;round++){
    const prefix=round?'corrected-'+round+'-':'refined-';
    const coverage=await auditTranscript(ai,{title,transcript:refined,cuts:current,pending:unresolved,runStep:(name,fn)=>runStep(prefix+name,fn)});
    if(!coverage.converged)throw new Error('The refined-boundary transcript audit did not finish cleanly');
    passes.push(...coverage.passes);
    const final=normalizeCuts([...current,...coverage.cuts],duration);
    const remaining=await runStep(`boundary-check-final-v11-${round}`,()=>findBoundaryFindings(ai,{title,transcript:refined,cuts:final}));
    if(!remaining.length)return {transcript:refined,cuts:final,refined_segments:issues.length,boundary_repairs:boundaryRepairs,coverage:{passes,converged:true,unreviewed:0}};
    if(round===2)break;
    current=[];unresolved=[];
    for(let i=0;i<final.length;i++){
      const c=final[i],findings=remaining.filter(f=>f.segment_id===c.start_index||f.segment_id===c.end_index);
      if(!findings.length){current.push(c);continue;}
      let start_index=c.start_index,end_index=c.end_index;
      for(const f of findings){
        // Only word-timed evidence can narrow a mixed segment. The boundary
        // model's exact quote maps to observed IDs; no timestamp is invented.
        if(refined[f.segment_id].boundary_group===undefined)throw new Error('A new coarse editorial boundary requires precise transcription');
        if(f.segment_id===c.start_index)start_index=Math.max(start_index,f.editorial_end_index+1);
        if(f.segment_id===c.end_index)end_index=Math.min(end_index,f.editorial_start_index-1);
      }
      boundaryRepairs++;
      if(start_index>end_index)continue;
      const candidate={...c,start_index,end_index,start:refined[start_index].start,end:refined[end_index].end};
      const args={title,transcript:refined,candidates:[candidate],lo:Math.max(0,start_index-4),hi:Math.min(refined.length,end_index+5)};
      let review=await runStep(`boundary-repair-v11-${round}-${i}`,()=>reviewCandidates(ai,args));
      if(review.unreviewed)review=await runStep(`boundary-repair-retry-v11-${round}-${i}`,()=>reviewCandidates(ai,{...args,retry:true}));
      current.push(...review.cuts.map(c=>({...c,boundary_protection:findings})));if(review.unreviewed)unresolved.push(candidate);
    }
  }
  throw new Error('An ad cut still contains an editorial boundary; publication was held');
}
