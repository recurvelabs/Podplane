const now=()=>Math.floor(Date.now()/1000);
const retention=30*86400;
const failure=(message,status)=>Object.assign(new Error(message),{status});
const eligible=`SELECT 1 FROM episodes e WHERE e.id=missed_ad_reports.episode_id AND e.status='ready'
  AND coalesce(e.ready_at,0)=missed_ad_reports.version AND e.created_at>?
  AND EXISTS(SELECT 1 FROM subscriptions s WHERE s.podcast_id=e.podcast_id)`;

export async function reportMissedAd(env,account,id,body){
  const version=body?.version,position=body?.position_seconds??null;
  if(!Number.isSafeInteger(version)||version<0||
     (position!==null&&(!Number.isSafeInteger(position)||position<0)))throw failure('Invalid audio version or playback time.',400);
  const ep=await env.DB.prepare(`SELECT e.status,e.ready_at,e.cleaned_duration FROM episodes e
    JOIN subscriptions s ON s.podcast_id=e.podcast_id WHERE e.id=? AND s.account_id=? AND e.created_at>?`)
    .bind(id,account.id,now()-retention).first();
  if(!ep)throw failure('Episode not found.',404);
  if(ep.status!=='ready'||Number(ep.ready_at)!==version)throw failure('This episode has changed. Refresh your library to check the latest audio.',409);
  if(position!==null&&position>ep.cleaned_duration)throw failure('Enter a time within the published episode.',400);
  const existing=await env.DB.prepare('SELECT status,position_seconds FROM missed_ad_reports WHERE episode_id=? AND version=?').bind(id,version).first();
  if(existing){
    // A specific location gives an inconclusive first review new evidence.
    await env.DB.prepare(`UPDATE missed_ad_reports SET status='queued',next_check=0,retries=0,attempt=attempt+1,
      position_seconds=?,detail=NULL,failure=NULL WHERE episode_id=? AND version=? AND (status='closed' OR
      (status='unconfirmed' AND position_seconds IS NULL AND ? IS NOT NULL))`).bind(position,id,version,position).run();
    if(position!==null)await env.DB.prepare("UPDATE missed_ad_reports SET position_seconds=? WHERE episode_id=? AND version=? AND status='queued' AND position_seconds IS NULL")
      .bind(position,id,version).run();
    return;
  }
  let key=`clean/${id}/${version}.mp3`,file=version?await env.AUDIO.head(key):null;
  if(!file){key=`clean/${id}.mp3`;file=await env.AUDIO.head(key);}
  if(!file)throw failure('The published audio is temporarily unavailable. Try reporting it again later.',503);
  await env.DB.prepare(`INSERT INTO missed_ad_reports(episode_id,version,source_key,source_etag,position_seconds,created_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(episode_id,version) DO UPDATE SET position_seconds=excluded.position_seconds
    WHERE missed_ad_reports.status='queued' AND missed_ad_reports.position_seconds IS NULL`)
    .bind(id,version,key,file.etag,position,now()).run();
}

export function reportInstance(id,version,attempt){return `ad-review-${id}-${version}-${attempt}`;}

export async function activeReport(env,id,version,attempt){
  return env.DB.prepare(`SELECT * FROM missed_ad_reports WHERE episode_id=? AND version=? AND attempt=?
    AND status IN ('queued','running') AND EXISTS(${eligible})`).bind(id,version,attempt,now()-retention).first();
}

export async function finishReport(env,id,version,attempt,status,detail){
  await env.DB.prepare(`UPDATE missed_ad_reports SET status=?,detail=? WHERE episode_id=? AND version=? AND attempt=?
    AND status IN ('queued','running')`).bind(status,detail,id,version,attempt).run();
}

export async function retryReport(env,id,version,attempt,error){
  await env.DB.prepare(`UPDATE missed_ad_reports SET status=CASE WHEN retries=0 THEN 'queued' ELSE 'failed' END,
    attempt=attempt+1,retries=retries+1,failure=?,next_check=?,detail=CASE WHEN retries=0 THEN 'Review will retry automatically.'
    ELSE 'Automatic review failed twice. The current audio is still available.' END
    WHERE episode_id=? AND version=? AND attempt=? AND status IN ('queued','running')`)
    .bind(String(error?.message||error).slice(0,400),now()+1800,id,version,attempt).run();
}

export async function serviceReports(env){
  const time=now();
  await env.DB.prepare(`UPDATE missed_ad_reports SET status='closed', detail='The reported version is no longer current or subscribed.'
    WHERE status IN ('queued','running') AND NOT EXISTS(${eligible})`).bind(time-retention).run();
  await env.DB.prepare('DELETE FROM missed_ad_reports WHERE episode_id IN (SELECT id FROM episodes WHERE created_at<=?)').bind(time-retention).run();
  const {results}=await env.DB.prepare(`SELECT * FROM missed_ad_reports WHERE status IN ('queued','running') AND next_check<=?
    ORDER BY next_check,created_at LIMIT 4`).bind(time).all();
  for(const report of results){
    const {episode_id:id,version,attempt,status}=report;
    const claim=await env.DB.prepare(`UPDATE missed_ad_reports SET next_check=? WHERE episode_id=? AND version=?
      AND status=? AND attempt=? AND next_check<=?`).bind(time+1800,id,version,status,attempt,time).run();
    if(!claim.meta.changes)continue;
    const instanceId=reportInstance(id,version,attempt);
    try{
      if(status==='queued'){
        // Re-sending the same instance ID also recovers a lost dispatch acknowledgement.
        await env.PROCESS.createBatch([{id:instanceId,params:{episode_id:id,report_version:version,report_attempt:attempt}}]);
        await env.DB.prepare(`UPDATE missed_ad_reports SET status='running',detail=NULL WHERE episode_id=? AND version=?
          AND attempt=? AND status='queued'`).bind(id,version,attempt).run();
      }else{
        const instance=await env.PROCESS.get(instanceId),state=await instance.status();
        if(['errored','terminated','complete','unknown'].includes(state.status))await retryReport(env,id,version,attempt,state.error?.message||'Workflow ended without recording a review.');
      }
    }catch(error){
      // Control-plane outages leave the same instance eligible on the next tick.
      console.log(JSON.stringify({event:'ad_report_dispatch_error',episode:id,version,attempt}));
      await env.DB.prepare('UPDATE missed_ad_reports SET failure=? WHERE episode_id=? AND version=? AND attempt=?')
        .bind(String(error.message).slice(0,400),id,version,attempt).run();
    }
  }
}

const words=s=>String(s||'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export async function diagnoseCuts(env,id,version,cuts){
  const old=await env.AUDIO.get(`clean/${id}/${version}.audit.json`);
  if(!old)return 'The earlier edit has no saved transcript to compare.';
  const audit=await old.json(),segments=audit.transcript||[];
  const previous=words(segments.map(s=>s.text).join(' '));
  const kept=(audit.kept_candidates||[]).map(c=>words(segments.filter(s=>s.end>c.start&&s.start<c.end).map(s=>s.text).join(' ')));
  const quotes=cuts.map(c=>words(c.evidence)).filter(q=>q.split(' ').length>=3);
  if(quotes.some(q=>kept.some(text=>text.includes(q))))return 'The earlier reviewer kept a passage containing the verified ad wording.';
  if(quotes.some(q=>previous.includes(q)))return 'The earlier transcript captured ad wording that survived the edit.';
  return 'The earlier transcript has no exact match for the verified ad wording.';
}
