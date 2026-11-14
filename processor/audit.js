import {detectCandidates,mergeCandidates,reviewCandidates} from './detection.js';

export const AUDIT_VERSION='full-transcript-v3-boundaries';
const WINDOW=120,CONTEXT=30,MAX_PASSES=3;

// Use time coverage rather than merged metadata: a cut's original end_index
// may describe only the first sponsor in a merged commercial break.
export function coveredSegments(transcript,cuts){
  const sorted=[...cuts].sort((a,b)=>a.start-b.start);
  return transcript.map(s=>{
    let end=s.start;
    for(const c of sorted){
      if(c.end<=end)continue;
      if(c.start>end+1e-6)break;
      end=Math.max(end,c.end);
      if(end>=s.end-1e-6)return true;
    }
    return false;
  });
}

export async function auditTranscript(ai,{title,transcript,cuts,pending=[],runStep=(_name,fn)=>fn()}){
  const accepted=[...cuts],passes=[];
  let candidates=0,kept=0,unreviewed=0;
  for(let pass=0;pass<MAX_PASSES;pass++){
    const before=coveredSegments(transcript,accepted),proposals=pending.filter(c=>before.slice(c.start_index,c.end_index+1).some(x=>!x));
    pending=[];
    // All retained speech receives an audit, with original IDs and commercial
    // context intact. Offset windows differ from the first detection pass.
    let windows=0;
    for(let coreStart=0;coreStart<transcript.length;coreStart+=WINDOW){
      const coreEnd=Math.min(transcript.length,coreStart+WINDOW);
      if(before.slice(coreStart,coreEnd).every(Boolean))continue;
      const lo=Math.max(0,coreStart-CONTEXT),hi=Math.min(transcript.length,coreEnd+CONTEXT);
      const found=await runStep(`audit-v7-${pass}-${coreStart}`,()=>detectCandidates(ai,{
        title,transcript,lo,hi,coreStart,coreEnd,focus:'residual',cuts:accepted
      }));
      proposals.push(...found.filter(c=>before.slice(Math.max(coreStart,c.start_index),Math.min(coreEnd,c.end_index+1)).some(x=>!x)));
      windows++;
    }
    const merged=mergeCandidates(transcript,proposals);
    let passUnreviewed=0;
    for(let i=0;i<merged.length;i++){
      const c=merged[i],args={title,transcript,candidates:[c],lo:Math.max(0,c.start_index-12),hi:Math.min(transcript.length,c.end_index+13)};
      let reviewed=await runStep(`audit-review-v7-${pass}-${i}`,()=>reviewCandidates(ai,args));
      if(reviewed.unreviewed)reviewed=await runStep(`audit-review-retry-v7-${pass}-${i}`,()=>reviewCandidates(ai,{...args,retry:true}));
      accepted.push(...reviewed.cuts);candidates++;kept+=reviewed.kept;passUnreviewed+=reviewed.unreviewed;
      if(reviewed.unreviewed)pending.push(c);
    }
    const after=coveredSegments(transcript,accepted),added=after.reduce((n,x,i)=>n+(x&&!before[i]?1:0),0);
    passes.push({windows,retained_segments:before.filter(x=>!x).length,candidates:merged.length,added_segments:added,unreviewed:passUnreviewed});
    // A later successful audit can resolve earlier unusable review responses.
    unreviewed=passUnreviewed;
    if(!added&&!unreviewed)return {cuts:accepted.slice(cuts.length),candidates,kept,unreviewed,passes,converged:true};
  }
  return {cuts:accepted.slice(cuts.length),candidates,kept,unreviewed,passes,converged:false};
}
