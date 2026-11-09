import { WorkflowEntrypoint } from 'cloudflare:workers';
import { Buffer } from 'node:buffer';
import { parseFeed, publicURL, safeFetch, boundedText, rss } from './feeds.js';
import { scanFrames, normalizeCuts, keepRanges, parseRange } from './media.js';
import { detectCandidates, reviewCandidates, REVIEW_BATCH_SIZE } from './detection.js';

const NOW=()=>Math.floor(Date.now()/1000);
const ORIGIN='https://podplane-audio.dchalloner.workers.dev';
const SITE='https://podplane.dchalloner.chatgpt.site';
const RETENTION=30*86400,MAX_BYTES=220*1024*1024;
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const err=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
async function hmac(secret,value){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(value))).toString('base64url');}
async function equal(a,b){return (await digest(a))===(await digest(b));}
const tokenFor=(env,a)=>hmac(env.FEED_SECRET,`${a.id}:${a.token_version}`);
async function feedBase(env,a){return `${env.PUBLIC_ORIGIN||ORIGIN}/f/${a.id}/${await tokenFor(env,a)}`;}
async function quota(env,key,max,amount=1,ttl=86400){
  const row=await env.DB.prepare('INSERT INTO limits(key,amount,expires_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET amount=amount+excluded.amount WHERE amount+excluded.amount<=? RETURNING amount').bind(key,amount,NOW()+ttl,max).first();
  if(!row)throw err('This beta has reached its processing limit. Please try again later.',429);
}
export async function episodeIsUnlimited(env,episodeId){
  return Boolean(await env.DB.prepare(`SELECT 1 AS unlimited FROM episodes e
    JOIN subscriptions s ON s.podcast_id=e.podcast_id JOIN accounts a ON a.id=s.account_id
    WHERE e.id=? AND a.unlimited=1 LIMIT 1`).bind(episodeId).first());
}
export async function reserveProcessingBudget(env,id,seconds){
  const existing=await env.DB.prepare('SELECT * FROM reservations WHERE episode_id=?').bind(id).first();
  if(existing)return;
  const day=new Date().toISOString().slice(0,10);
  if(!await episodeIsUnlimited(env,id))await quota(env,`audio:${day}`,600,seconds/60,3*86400);
  await env.DB.prepare('INSERT OR IGNORE INTO reservations(episode_id,day,minutes) VALUES(?,?,?)').bind(id,day,seconds/60).run();
}
async function account(env,subject){
  await env.DB.prepare('INSERT OR IGNORE INTO accounts(id,subject,created_at) VALUES(?,?,?)').bind(crypto.randomUUID(),subject,NOW()).run();
  return env.DB.prepare('SELECT * FROM accounts WHERE subject=?').bind(subject).first();
}
async function authorizedFeed(env,id,token){
  const a=await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(id).first();
  if(!a||!await equal(await tokenFor(env,a),token))throw err('Feed not found',404);return a;
}
async function dashboard(env,a){
  const base=await feedBase(env,a);
  const {results:shows}=await env.DB.prepare(`SELECT p.id,p.title,p.author,p.artwork,p.last_sync,p.last_error,s.created_at,
    (SELECT count(*) FROM episodes e WHERE e.podcast_id=p.id AND e.status='ready') AS ready_count
    FROM subscriptions s JOIN podcasts p ON p.id=s.podcast_id WHERE s.account_id=? ORDER BY s.created_at DESC`).bind(a.id).all();
  const {results:episodes}=await env.DB.prepare(`SELECT e.id,e.podcast_id,e.title,e.published_at,e.duration,e.cleaned_duration,e.audio_bytes,e.status,e.progress,e.cuts_json,e.error,p.title AS podcast_title,p.artwork
    FROM episodes e JOIN podcasts p ON p.id=e.podcast_id JOIN subscriptions s ON s.podcast_id=p.id WHERE s.account_id=? AND e.created_at>? ORDER BY e.published_at DESC LIMIT 60`).bind(a.id,NOW()-RETENTION).all();
  return {feed_url:`${base}/rss`,plan:a.unlimited?'unlimited':'beta',max_shows:a.unlimited?null:5,daily_audio_minutes:a.unlimited?null:600,retention_days:30,shows:shows.map(s=>({...s,feed_url:`${base}/${s.id}/rss`})),episodes:episodes.map(e=>({...e,cuts:JSON.parse(e.cuts_json),cuts_json:undefined,audio_url:e.status==='ready'?`${base}/audio/${e.id}.mp3`:null}))};
}
async function insertEpisodes(env,podcastId,items){
  for(const item of items){
    const id=(await digest(`${podcastId}:${item.guid}`)).slice(0,40);
    await env.DB.prepare('INSERT OR IGNORE INTO episodes(id,podcast_id,guid,title,description,source_url,published_at,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,podcastId,item.guid,item.title,item.description,item.source_url,item.published_at,NOW()).run();
  }
}
async function syncPodcast(env,p,force=false){
  const now=NOW();
  if(!force&&now-p.last_sync<1700)return;
  const claimed=await env.DB.prepare('UPDATE podcasts SET last_sync=? WHERE id=? AND last_sync=?').bind(now,p.id,p.last_sync).run();
  if(!claimed.meta.changes)return;
  try{
    const headers={};if(p.etag)headers['If-None-Match']=p.etag;if(p.modified)headers['If-Modified-Since']=p.modified;
    const res=await safeFetch(p.feed_url,{headers});if(res.status===304)return;
    if(!res.ok)throw new Error(`Publisher returned HTTP ${res.status}`);
    const feed=parseFeed(await boundedText(res));
    const candidates=feed.episodes.filter(e=>e.published_at>=p.last_sync-7*86400).slice(0,3);
    await insertEpisodes(env,p.id,candidates);
    await env.DB.prepare('UPDATE podcasts SET title=?,description=?,author=?,artwork=?,last_error=NULL,etag=?,modified=? WHERE id=?')
      .bind(feed.title,feed.description,feed.author,feed.artwork,res.headers.get('etag'),res.headers.get('last-modified'),p.id).run();
  }catch(e){await env.DB.prepare('UPDATE podcasts SET last_error=? WHERE id=?').bind('Could not refresh the publisher feed. We will retry automatically.',p.id).run();console.log(JSON.stringify({event:'feed_refresh_failed',podcast:p.id,message:e.message}));}
}
async function startJobs(env){
  const {results}=await env.DB.prepare(`SELECT e.id,e.attempts FROM episodes e WHERE e.status='queued' AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.podcast_id=e.podcast_id) ORDER BY e.created_at LIMIT 8`).all();
  for(const e of results){
    const attempt=e.attempts+1,id=`ep-${e.id}-${attempt}`;
    const claim=await env.DB.prepare("UPDATE episodes SET status='processing',progress=1,workflow_id=?,attempts=?,error=NULL WHERE id=? AND status='queued'").bind(id,attempt,e.id).run();
    if(!claim.meta.changes)continue;
    try{await env.PROCESS.create({id,params:{episode_id:e.id}});}catch(error){
      await env.DB.prepare("UPDATE episodes SET status='queued',error=? WHERE id=? AND workflow_id=?").bind('Waiting for a processing slot.',e.id,id).run();
      console.log(JSON.stringify({event:'workflow_start_failed',episode:e.id,message:error.message}));
    }
  }
}
async function addPodcast(req,env,a){
  const body=await req.json();
  let selected=null;if(body.podcast_id){selected=await env.DB.prepare('SELECT * FROM podcasts WHERE id=? AND public_catalog=1').bind(String(body.podcast_id)).first();if(!selected)throw err('Podcast not found in the shared library.',404);}
  let url;try{url=selected?.feed_url||publicURL(body.feed_url);}catch{throw err('Enter a public HTTPS podcast RSS feed URL.');}
  const existing=await env.DB.prepare('SELECT count(*) AS n FROM subscriptions WHERE account_id=?').bind(a.id).first();if(!a.unlimited&&existing.n>=5)throw err('The beta supports five podcasts per account. Remove one to add another.');
  if(!a.unlimited)await quota(env,`add:${a.id}:${new Date().toISOString().slice(0,10)}`,15);
  let p=selected||await env.DB.prepare('SELECT * FROM podcasts WHERE feed_url=?').bind(url).first();
  if(!p){
    const res=await safeFetch(url);if(!res.ok)throw err(`The podcast publisher returned HTTP ${res.status}.`);
    const feed=parseFeed(await boundedText(res));const id=(await digest(url)).slice(0,32);
    await env.DB.prepare('INSERT OR IGNORE INTO podcasts(id,feed_url,title,description,author,artwork,website,last_sync,etag,modified) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(id,url,feed.title,feed.description,feed.author,feed.artwork,feed.website,NOW(),res.headers.get('etag'),res.headers.get('last-modified')).run();
    p=await env.DB.prepare('SELECT * FROM podcasts WHERE id=?').bind(id).first();
    await insertEpisodes(env,id,feed.episodes.slice(0,1));
  }
  if(body.directory_id){
    const listed=await env.DB.prepare('SELECT feed_url FROM directory_results WHERE id=? AND expires_at>?').bind(String(body.directory_id),NOW()).first();
    if(listed?.feed_url===url)await env.DB.prepare('UPDATE podcasts SET public_catalog=1 WHERE id=?').bind(p.id).run();
  }
  const hasEpisode=await env.DB.prepare("SELECT id FROM episodes WHERE podcast_id=? AND status!='expired' LIMIT 1").bind(p.id).first();
  if(!hasEpisode){const res=await safeFetch(p.feed_url);if(!res.ok)throw err('The publisher feed is temporarily unavailable.',502);const feed=parseFeed(await boundedText(res));await insertEpisodes(env,p.id,feed.episodes.slice(0,1));}
  await env.DB.prepare('INSERT OR IGNORE INTO subscriptions(account_id,podcast_id,created_at) SELECT ?,?,? WHERE ?=1 OR (SELECT count(*) FROM subscriptions WHERE account_id=?)<5').bind(a.id,p.id,NOW(),a.unlimited?1:0,a.id).run();
  if(!await env.DB.prepare('SELECT 1 AS ok FROM subscriptions WHERE account_id=? AND podcast_id=?').bind(a.id,p.id).first())throw err('The beta supports five podcasts per account. Remove one to add another.');
  await startJobs(env);return json(await dashboard(env,a),201);
}
export async function internal(req,env,url){
  if(!env.INTERNAL_SECRET||!await equal(req.headers.get('Authorization')||'',`Bearer ${env.INTERNAL_SECRET}`))throw err('Unauthorized',401);
  const subject=req.headers.get('X-Podplane-Subject');if(!subject||subject.length>300)throw err('Sign in first',401);
  const a=await account(env,subject);
  await quota(env,`api:${a.id}:${Math.floor(NOW()/60)}`,80,1,120);
  if(url.pathname==='/internal/account'&&req.method==='DELETE'){
    if(env.PUBLIC_ORIGIN)await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(a.id),env.DB.prepare('DELETE FROM passkeys WHERE account_id=?').bind(a.id),env.DB.prepare('DELETE FROM auth_challenges WHERE account_id=?').bind(a.id),env.DB.prepare('DELETE FROM email_codes WHERE email=(SELECT email FROM accounts WHERE id=?)').bind(a.id)]);
    await env.DB.batch([env.DB.prepare('DELETE FROM subscriptions WHERE account_id=?').bind(a.id),env.DB.prepare('DELETE FROM accounts WHERE id=?').bind(a.id)]);
    return json({deleted:true});
  }
  if(url.pathname==='/internal/dashboard'&&req.method==='GET')return json(await dashboard(env,a));
  if(url.pathname==='/internal/podcasts'&&req.method==='POST')return addPodcast(req,env,a);
  const show=/^\/internal\/podcasts\/([a-f0-9]{32})$/.exec(url.pathname);
  if(show&&req.method==='DELETE'){await env.DB.prepare('DELETE FROM subscriptions WHERE account_id=? AND podcast_id=?').bind(a.id,show[1]).run();return json(await dashboard(env,a));}
  if(url.pathname==='/internal/rotate'&&req.method==='POST'){
    await env.DB.prepare('UPDATE accounts SET token_version=token_version+1 WHERE id=?').bind(a.id).run();a.token_version++;return json(await dashboard(env,a));
  }
  if(url.pathname==='/internal/refresh'&&req.method==='POST'){
    if(!a.unlimited)await quota(env,`refresh:${a.id}:${Math.floor(NOW()/3600)}`,3,1,7200);
    const {results}=await env.DB.prepare('SELECT p.* FROM podcasts p JOIN subscriptions s ON s.podcast_id=p.id WHERE s.account_id=?').bind(a.id).all();
    for(const p of results)await syncPodcast(env,p);await startJobs(env);return json(await dashboard(env,a));
  }
  const retry=/^\/internal\/episodes\/([a-f0-9]{40})\/retry$/.exec(url.pathname);
  if(retry&&req.method==='POST'){
    const e=await env.DB.prepare('SELECT e.* FROM episodes e JOIN subscriptions s ON s.podcast_id=e.podcast_id WHERE s.account_id=? AND e.id=?').bind(a.id,retry[1]).first();
    if(!e)throw err('Episode not found',404);if(e.status!=='failed')throw err('This episode is already queued or complete.');if(!a.unlimited&&e.attempts>=3)throw err('This episode needs operator attention after three attempts.');
    if(!a.unlimited)await quota(env,`retry:${a.id}:${Math.floor(NOW()/3600)}`,5,1,7200);
    await env.DB.prepare("UPDATE episodes SET status='queued',progress=0,error=NULL WHERE id=?").bind(e.id).run();await startJobs(env);return json(await dashboard(env,a));
  }
  throw err('Not found',404);
}
export async function publicFeed(req,env,url){
  const match=/^\/f\/([a-f0-9-]{36})\/([A-Za-z0-9_-]{43})\/(.*)$/.exec(url.pathname);if(!match)throw err('Not found',404);
  const a=await authorizedFeed(env,match[1],match[2]),route=match[3],base=await feedBase(env,a);
  if(req.method!=='GET'&&req.method!=='HEAD')throw err('Method not allowed',405);
  const audio=/^audio\/([a-f0-9]{40})\.mp3$/.exec(route);
  if(audio){
    const e=await env.DB.prepare("SELECT e.id,e.audio_bytes FROM episodes e JOIN subscriptions s ON s.podcast_id=e.podcast_id WHERE s.account_id=? AND e.id=? AND e.status='ready' AND e.created_at>?").bind(a.id,audio[1],NOW()-RETENTION).first();if(!e)throw err('Episode not found',404);
    let range;try{range=parseRange(req.headers.get('Range'),e.audio_bytes);}catch{return new Response(null,{status:416,headers:{'Content-Range':`bytes */${e.audio_bytes}`}});}
    const headers={'Content-Type':'audio/mpeg','Accept-Ranges':'bytes','Content-Length':String(range?.length??e.audio_bytes),'Cache-Control':'private, max-age=3600','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
    if(range)headers['Content-Range']=`bytes ${range.offset}-${range.offset+range.length-1}/${e.audio_bytes}`;
    if(req.method==='HEAD')return new Response(null,{status:range?206:200,headers});
    const obj=await env.AUDIO.get(`clean/${e.id}.mp3`,range?{range}:undefined);if(!obj)throw err('Audio temporarily unavailable',503);
    return new Response(obj.body,{status:range?206:200,headers});
  }
  const specific=/^([a-f0-9]{32})\/rss$/.exec(route);if(route!=='rss'&&!specific)throw err('Not found',404);
  let show=null;if(specific){show=await env.DB.prepare('SELECT p.* FROM podcasts p JOIN subscriptions s ON s.podcast_id=p.id WHERE s.account_id=? AND p.id=?').bind(a.id,specific[1]).first();if(!show)throw err('Feed not found',404);}
  const {results:items}=await env.DB.prepare(`SELECT e.*,p.title AS podcast_title,p.author,p.artwork FROM episodes e JOIN podcasts p ON p.id=e.podcast_id JOIN subscriptions s ON s.podcast_id=p.id WHERE s.account_id=? AND e.status='ready' AND e.created_at>? ${show?'AND p.id=?':''} ORDER BY e.published_at DESC LIMIT 100`).bind(...[a.id,NOW()-RETENTION,...(show?[show.id]:[])]).all();
  const body=rss({title:show?`${show.title} · Podplane`:'My podcasts · Podplane',description:show?.description||'Your private podcast feed, with detected advertising removed.',artwork:show?.artwork,link:env.PUBLIC_ORIGIN||SITE,self:url.href,items:items.map(e=>({...e,audio_url:`${base}/audio/${e.id}.mp3`}))});
  return new Response(req.method==='HEAD'?null:body,{headers:{'Content-Type':'application/rss+xml; charset=utf-8','Cache-Control':'private, max-age=120','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}});
}
export async function tick(env){
  const {results}=await env.DB.prepare('SELECT p.* FROM podcasts p WHERE p.last_sync<? AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.podcast_id=p.id) ORDER BY p.last_sync LIMIT 25').bind(NOW()-1700).all();
  for(const p of results)await syncPodcast(env,p);
  // Recover workflows that reached a terminal failure without recording the result.
  const {results:stale}=await env.DB.prepare("SELECT id,workflow_id FROM episodes WHERE status IN ('processing','transcribing','detecting','editing') AND created_at<? LIMIT 15").bind(NOW()-3600).all();
  for(const e of stale){try{const instance=await env.PROCESS.get(e.workflow_id);const s=await instance.status();if(['errored','terminated'].includes(s.status))await env.DB.prepare("UPDATE episodes SET status='failed',error='Processing was interrupted. You can retry this episode.' WHERE id=?").bind(e.id).run();}catch{}}
  await startJobs(env);
  const {results:expired}=await env.DB.prepare("SELECT id FROM episodes WHERE created_at<? AND status!='expired' LIMIT 20").bind(NOW()-RETENTION).all();
  for(const e of expired){await env.AUDIO.delete([`clean/${e.id}.mp3`,`original/${e.id}.mp3`]);await env.DB.prepare("UPDATE episodes SET status='expired' WHERE id=?").bind(e.id).run();}
  await env.DB.prepare('DELETE FROM limits WHERE expires_at<?').bind(NOW()).run();
  if(env.PUBLIC_ORIGIN){await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(NOW()),env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at<?').bind(NOW()),env.DB.prepare('DELETE FROM email_codes WHERE expires_at<?').bind(NOW()),env.DB.prepare('DELETE FROM directory_results WHERE expires_at<?').bind(NOW())]);}
}
export default {
  async fetch(req,env){
    try{const url=new URL(req.url);if(url.pathname==='/health')return json({service:'Podplane audio',ok:true});if(url.pathname.startsWith('/internal/'))return await internal(req,env,url);return await publicFeed(req,env,url);}catch(e){console.log(JSON.stringify({event:'request_error',status:e.status||500,message:e.message}));return json({error:e.status?e.message:'The service could not complete this request. Please try again.'},e.status||500);}
  },
  async scheduled(event,env,ctx){ctx.waitUntil(tick(env));}
};

const STEP={retries:{limit:2,delay:'15 seconds',backoff:'exponential'},timeout:'5 minutes'};
async function progress(env,id,status,n){await env.DB.prepare('UPDATE episodes SET status=?,progress=? WHERE id=?').bind(status,n,id).run();}
function segmentsOf(result,start,end){
  let segments=(result.segments||[]).map(s=>({start:Number(s.start),end:Number(s.end),text:String(s.text||'')}));
  if(!segments.length&&result.vtt){const re=/(\d{2}:)?(\d{2}):(\d{2})\.(\d{3}) --> (\d{2}:)?(\d{2}):(\d{2})\.(\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;let m;while((m=re.exec(result.vtt))){const secs=(h,m,s,ms)=>(parseInt(h||'0')*3600)+Number(m)*60+Number(s)+Number(ms)/1000;segments.push({start:secs(m[1],m[2],m[3],m[4]),end:secs(m[5],m[6],m[7],m[8]),text:m[9].trim()});}}
  segments=segments.filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.text.trim()).map(s=>({...s,start:start+s.start,end:Math.min(end,start+s.end)})).filter(s=>s.end>s.start);
  if(!segments.length&&String(result.text||'').trim())throw new Error('The transcription provider returned no timestamps.');
  return segments;
}
export class EpisodeWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    // REST-triggered instances can supply a JSON-encoded payload, while the
    // Worker binding supplies an object. Validate before any D1 work or retries.
    let payload=event.payload;
    if(typeof payload==='string'){try{payload=JSON.parse(payload);}catch{throw new Error('Workflow payload must be valid JSON');}}
    const env=this.env,id=payload?.episode_id;
    if(typeof id!=='string'||!/^[a-f0-9]{40}$/.test(id))throw new Error('Workflow requires a valid episode_id');
    try{
      const unlimited=await episodeIsUnlimited(env,id);
      const meta=await step.do('download',STEP,async()=>{
        const ep=await env.DB.prepare('SELECT * FROM episodes WHERE id=?').bind(id).first();if(!ep)throw new Error('Episode missing');
        await progress(env,id,'processing',3);
        const key=`original/${id}.mp3`,cached=await env.AUDIO.head(key);if(cached)return {size:cached.size,key,title:ep.title};
        const redirects=[];
        const res=await safeFetch(ep.source_url,{redirectTrace:redirects});if(!res.ok)throw new Error(`Audio download returned ${res.status}`);
        const size=Number(res.headers.get('content-length'));if(!Number.isSafeInteger(size)||size<=0||(!unlimited&&size>MAX_BYTES)){await res.body?.cancel();throw new Error(unlimited?'The publisher must provide a known audio download size.':'This beta supports MP3 episodes up to 220 MB with a known download size.');}
        const mime=res.headers.get('content-type')||'';if(/mp4|m4a|video|ogg|wav|html|json/.test(mime)){await res.body?.cancel();throw new Error('This beta supports MP3 audio feeds. This episode uses a different format.');}
        await env.AUDIO.put(key,res.body,{httpMetadata:{contentType:'audio/mpeg'}});return {size,key,title:ep.title,redirect_count:redirects.length,redirect_hosts:redirects.map(h=>h.to)};
      });
      const chunks=[];let offset=0,time=0;
      for(let i=0;offset<meta.size-128&&(unlimited||i<70);i++){
        const previous={offset,time},index=i;
        const chunk=await step.do(`index-${i}`,STEP,async()=>{
          const object=await env.AUDIO.get(meta.key,{range:{offset:previous.offset,length:Math.min(8*1024*1024,meta.size-previous.offset)}});
          const bytes=new Uint8Array(await object.arrayBuffer());const scanned=scanFrames(bytes,previous.offset,previous.time);
          const key=`work/${id}/index-${index}.json`;await env.AUDIO.put(key,JSON.stringify(scanned));
          return {key,offset:scanned.offset,start:scanned.start,end:scanned.end,byteStart:scanned.byteStart,byteLength:scanned.byteLength};
        });chunks.push(chunk);offset=chunk.offset;time=chunk.end;if(!unlimited&&time>10800)throw new Error('This beta supports episodes up to three hours.');
        // ID3v1/APEv2 trailers are not audio and must not start a new chunk.
        if(offset>=meta.size)break;
        if(meta.size-offset<8192){const tail=await step.do(`tail-${i}`,STEP,async()=>{const o=await env.AUDIO.get(meta.key,{range:{offset,length:meta.size-offset}});const b=new Uint8Array(await o.arrayBuffer());return !b.some((v,j)=>v===255&&j+1<b.length&&(b[j+1]&224)===224);});if(tail)break;}
      }
      await step.do('reserve-budget',STEP,async()=>{
        await reserveProcessingBudget(env,id,time);
        await env.DB.prepare('UPDATE episodes SET duration=? WHERE id=?').bind(time,id).run();
      });
      const transcript=[];
      for(let i=0;i<chunks.length;i++){
        const c=chunks[i],index=i;
        const segments=await step.do(`transcribe-${i}`,STEP,async()=>{
          await progress(env,id,'transcribing',10+Math.round(index/chunks.length*60));
          const object=await env.AUDIO.get(meta.key,{range:{offset:c.byteStart,length:c.byteLength}});
          const audio=Buffer.from(await object.arrayBuffer()).toString('base64');
          const result=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{audio,task:'transcribe',vad_filter:false,condition_on_previous_text:false});
          const segments=segmentsOf(result,c.start,c.end);await env.AUDIO.put(`work/${id}/transcript-${index}.json`,JSON.stringify(segments));return segments;
        });transcript.push(...segments);
      }
      const cuts=[];let candidates=0,keptByReview=0,unreviewed=0;
      // 150 transcript segments per pass, with overlapping context. IDs make boundaries deterministic.
      for(let i=0;i<transcript.length;i+=150){
        const coreStart=i,coreEnd=Math.min(i+150,transcript.length),lo=Math.max(0,i-20),hi=Math.min(transcript.length,coreEnd+20);
        const detected=await step.do(`detect-${i}`,STEP,async()=>{
          await progress(env,id,'detecting',72+Math.round(coreStart/Math.max(1,transcript.length)*18));
          return detectCandidates(env.AI,{title:meta.title,transcript,lo,hi,coreStart,coreEnd});
        });candidates+=detected.length;
        for(let j=0;j<detected.length;j+=REVIEW_BATCH_SIZE){
          const batch=detected.slice(j,j+REVIEW_BATCH_SIZE);
          const reviewed=await step.do(`review-${i}-${j}`,STEP,()=>reviewCandidates(env.AI,{title:meta.title,transcript,candidates:batch,lo,hi}));
          cuts.push(...reviewed.cuts);keptByReview+=reviewed.kept;unreviewed+=reviewed.unreviewed||0;
        }
      }
      const normalized=normalizeCuts(cuts,time),removed=normalized.reduce((n,c)=>n+c.end-c.start,0);
      if(removed>time*0.4)throw new Error('More than 40% was marked as ads. This episode was held to protect the conversation.');
      const reviewNotice=unreviewed?'Some possible ads were left in this episode because their review was incomplete.':null;
      if(unreviewed)console.log(JSON.stringify({event:'ad_review_incomplete',episode:id,candidates,unreviewed}));
      await step.do('edit-and-publish',{...STEP,timeout:'10 minutes'},async()=>{
        await progress(env,id,'editing',94);const ranges=[];let duration=0;
        for(const c of chunks){const index=await (await env.AUDIO.get(c.key)).json();const kept=keepRanges(index.frames,normalized);duration+=kept.duration;for(const r of kept.ranges){const last=ranges.at(-1);if(last&&last.offset+last.length===r.offset)last.length+=r.length;else ranges.push({...r});}}
        const size=ranges.reduce((n,r)=>n+r.length,0);if(!size)throw new Error('No playable audio remains');
        const fixed=new FixedLengthStream(size),writer=fixed.writable.getWriter();
        const write=(async()=>{try{for(const range of ranges){const o=await env.AUDIO.get(meta.key,{range});const reader=o.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;await writer.write(value);}}finally{reader.releaseLock();}}await writer.close();}catch(e){await writer.abort(e);throw e;}})();
        await Promise.all([env.AUDIO.put(`clean/${id}.mp3`,fixed.readable,{httpMetadata:{contentType:'audio/mpeg'}}),write]);
        await env.DB.prepare("UPDATE episodes SET status='ready',progress=100,cleaned_duration=?,audio_bytes=?,cuts_json=?,ready_at=?,error=? WHERE id=?").bind(duration,size,JSON.stringify(normalized),NOW(),reviewNotice,id).run();
      });
      await step.do('cleanup',STEP,async()=>{await env.AUDIO.delete(meta.key);const list=await env.AUDIO.list({prefix:`work/${id}/`,limit:1000});if(list.objects.length)await env.AUDIO.delete(list.objects.map(o=>o.key));});
      return {episode_id:id,ads:normalized.length,removed_seconds:Math.round(removed),candidates,kept_by_review:keptByReview,unreviewed};
    }catch(error){
      await step.do('record-failure',async()=>{await env.DB.prepare("UPDATE episodes SET status='failed',error=? WHERE id=? AND status!='ready'").bind(String(error.message||'Processing failed').slice(0,400),id).run();});
      throw error;
    }
  }
}
