const BITS1=[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320];
const BITS2=[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160];
export function frameHeader(b,p=0){
  if(p+4>b.length||b[p]!==255||(b[p+1]&224)!==224)return null;
  const version=(b[p+1]>>3)&3, layer=(b[p+1]>>1)&3,bi=b[p+2]>>4,sr=(b[p+2]>>2)&3;
  if(version===1||layer!==1||!bi||bi===15||sr===3)return null;
  const sampleRate=[44100,48000,32000][sr]/(version===3?1:version===2?2:4);
  const bitrate=(version===3?BITS1:BITS2)[bi]*1000;
  const samples=version===3?1152:576;
  return {length:Math.floor((version===3?144:72)*bitrate/sampleRate)+((b[p+2]>>1)&1),duration:samples/sampleRate,sampleRate,version};
}
export function scanFrames(bytes,offset=0,startTime=0,maxSeconds=180){
  let p=0,time=startTime,frames=[],skipped=0;
  if(offset===0&&new TextDecoder().decode(bytes.subarray(0,3))==='ID3'){
    const size=((bytes[6]&127)<<21)|((bytes[7]&127)<<14)|((bytes[8]&127)<<7)|(bytes[9]&127);
    p=10+size+((bytes[5]&16)?10:0);
    if(p>=bytes.length)throw new Error('MP3 metadata is too large');
  }
  while(p+4<=bytes.length){
    const f=frameHeader(bytes,p);
    if(!f){p++;if(++skipped>8192)throw new Error('Unsupported or damaged audio. MP3 feeds are supported in this beta.');continue;}
    if(p+f.length>bytes.length)break;
    if(!frames.length&&offset===0){
      const header=new TextDecoder('latin1').decode(bytes.subarray(p,p+Math.min(f.length,200)));
      if(header.includes('Xing')||header.includes('Info')){p+=f.length;continue;}
      // A second frame must confirm the sync before accepting arbitrary bytes.
      if(p+f.length+4<bytes.length&&!frameHeader(bytes,p+f.length)){p++;continue;}
    }
    frames.push([offset+p,f.length,time,f.duration]); time+=f.duration; p+=f.length;
    if(time-startTime>=maxSeconds)break;
  }
  if(!frames.length)throw new Error('No complete MP3 frames found');
  const first=frames[0][0],last=frames.at(-1);
  return {frames,offset:offset+p,start:startTime,end:time,byteStart:first,byteLength:last[0]+last[1]-first};
}
export function normalizeCuts(cuts,duration){
  const sorted=cuts.filter(x=>Number.isFinite(x.start)&&Number.isFinite(x.end)&&x.end>x.start&&Number.isFinite(x.confidence)&&x.confidence>=0.9&&x.confidence<=1)
    .map(x=>({...x,start:Math.max(0,x.start),end:Math.min(duration,x.end)})).filter(x=>x.end>x.start).sort((a,b)=>a.start-b.start);
  // Preserve even short kept gaps. Merging must never introduce an extra cut.
  const out=[];
  for(const c of sorted){
    const last=out.at(-1);
    if(last&&c.start<=last.end){
      last.end=Math.max(last.end,c.end);last.confidence=Math.min(last.confidence,c.confidence);
      last.sponsor=[...new Set([last.sponsor,c.sponsor])].filter(Boolean).join(', ');
      if(c.reviews)last.reviews=[...(last.reviews||[]),...c.reviews];
    }else out.push({...c});
  }
  return out;
}
export function keepRanges(frames,cuts){
  const ranges=[];let duration=0;
  for(const [offset,length,start,d] of frames){
    // Keep frames that straddle a boundary to avoid clipping nearby speech.
    if(cuts.some(c=>start>=c.start-1e-8&&start+d<=c.end+1e-8))continue;
    const last=ranges.at(-1);if(last&&last.offset+last.length===offset)last.length+=length;else ranges.push({offset,length});
    duration+=d;
  }
  return {ranges,duration};
}
export function parseRange(value,size){
  if(!value)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!m||(!m[1]&&!m[2]))throw new Error('Invalid range');
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));
  let end=m[1]?(m[2]?Math.min(Number(m[2]),size-1):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)throw new Error('Unsatisfiable range');
  return {offset:start,length:end-start+1};
}
