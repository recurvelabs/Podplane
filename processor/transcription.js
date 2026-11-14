import { Buffer } from 'node:buffer';

const MODEL='@cf/openai/whisper-large-v3-turbo';
// Bump this namespace whenever the model, decoding options or timestamp parsing changes.
const CACHE_PREFIX='transcripts/whisper-turbo-v1/';
const CACHE_SECONDS=30*86400;

export function transcriptGaps(segments,duration,{minimum=6,maximum=90}={}){
  const gaps=[];let end=0;
  const add=(start,stop)=>{if(stop-start<minimum)return;for(let p=start;p<stop;p+=maximum)gaps.push({start:p,end:Math.min(stop,p+maximum)});};
  for(const s of [...segments].sort((a,b)=>a.start-b.start)){add(end,Math.min(s.start,duration));end=Math.max(end,s.end);}
  add(end,duration);return gaps;
}

function segmentsOf(result,duration,words=false){
  let segments=words?(result.segments||[]).flatMap(s=>(s.words||[]).map(w=>({start:Number(w.start),end:Number(w.end),text:String(w.word||'')}))):(result.segments||[]).map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text||'')}));
  if(words&&!segments.length)throw new Error('Boundary transcription returned no word timestamps');
  if(!segments.length&&result.vtt){const re=/(\d{2}:)?(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}:)?(\d{2}):(\d{2})\.(\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;let m;while((m=re.exec(result.vtt))){const secs=(h,m,s,ms)=>(parseInt(h||'0')*3600)+Number(m)*60+Number(s)+Number(ms)/1000;segments.push({start:secs(m[1],m[2],m[3],m[4]),end:secs(m[5],m[6],m[7],m[8]),text:m[9].trim()});}}
  segments=segments.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.text.trim()).map(s=>({...s,end:Math.min(duration,s.end)})).filter(s=>s.end>s.start);
  if(!segments.length&&String(result.text||'').trim())throw new Error('The transcription provider returned no timestamps.');
  return segments;
}

function validCache(value,duration,now){
  return value&&Number.isFinite(value.created_at)&&value.created_at<=now&&value.created_at>now-CACHE_SECONDS&&
    Number.isFinite(value.duration)&&Math.abs(value.duration-duration)<0.001&&Array.isArray(value.segments)&&
    value.segments.every(s=>s&&Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.end<=duration+0.001&&typeof s.text==='string'&&s.text.trim());
}

export async function transcribeAudio(env,bytes,duration,{force=false,words=false}={}){
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const key=(words?'transcripts/whisper-turbo-words-v1/':CACHE_PREFIX)+hash+'.json',now=Math.floor(Date.now()/1000);
  if(!force){
    const object=await env.AUDIO.get(key);
    if(object){
      let cached;try{cached=await object.json();}catch{/* Rebuild malformed cache entries. */}
      if(validCache(cached,duration,now)){
        console.log(JSON.stringify({event:'transcription_usage',model:MODEL,cache_hit:true,audio_seconds:duration}));
        return cached.segments;
      }
    }
  }
  const audio=Buffer.from(bytes).toString('base64');
  const result=await env.AI.run(MODEL,{audio,task:'transcribe',vad_filter:false,condition_on_previous_text:false});
  const segments=segmentsOf(result,duration,words);
  await env.AUDIO.put(key,JSON.stringify({created_at:now,duration,segments}),{httpMetadata:{contentType:'application/json'}});
  console.log(JSON.stringify({event:'transcription_usage',model:MODEL,cache_hit:false,audio_seconds:duration}));
  return segments;
}
