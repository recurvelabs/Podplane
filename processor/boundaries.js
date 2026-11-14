import {findBoundaryIssues,reviewCandidates} from './detection.js';
import {auditTranscript} from './audit.js';
import {normalizeCuts} from './media.js';

export async function refineBoundaries(ai,{title,transcript,cuts,duration,transcribeSegment,runStep=(_name,fn)=>fn()}){
  const issues=await runStep('boundary-check-v7',()=>findBoundaryIssues(ai,{title,transcript,cuts}));
  if(!issues.length)return {transcript,cuts,refined_segments:0,coverage:null};
  const replacements=new Map();
  for(const i of issues){
    const words=await runStep(`boundary-words-v7-${i}`,()=>transcribeSegment(transcript[i]));
    if(!words.length)throw new Error('A mixed ad boundary could not be transcribed precisely');
    replacements.set(i,words);
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
    let review=await runStep(`boundary-review-v7-${i}`,()=>reviewCandidates(ai,args));
    if(review.unreviewed)review=await runStep(`boundary-review-retry-v7-${i}`,()=>reviewCandidates(ai,{...args,retry:true}));
    accepted.push(...review.cuts);if(review.unreviewed)pending.push(c);
  }
  const coverage=await auditTranscript(ai,{title,transcript:refined,cuts:accepted,pending,runStep:(name,fn)=>runStep('refined-'+name,fn)});
  if(!coverage.converged)throw new Error('The refined-boundary transcript audit did not finish cleanly');
  const final=normalizeCuts([...accepted,...coverage.cuts],duration);
  const remaining=await runStep('boundary-check-final-v7',()=>findBoundaryIssues(ai,{title,transcript:refined,cuts:final}));
  if(remaining.length)throw new Error('An ad cut still contains an editorial boundary; publication was held');
  return {transcript:refined,cuts:final,refined_segments:issues.length,coverage:{passes:coverage.passes,converged:coverage.converged,unreviewed:coverage.unreviewed}};
}
