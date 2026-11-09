import {parseFeed,safeFetch,boundedText,publicURL} from './feeds.js';
import {Buffer} from 'node:buffer';
const now=()=>Math.floor(Date.now()/1000);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
export async function catalog(env,url,user){
  const q=(url.searchParams.get('q')||'').trim().slice(0,150),ready=url.searchParams.get('ready')==='1';
  const after=now()-30*86400;
  const {results}=await env.DB.prepare(`SELECT p.id,p.title,p.author,p.description,p.artwork,p.category,p.chart_rank,
    (SELECT count(*) FROM episodes e WHERE e.podcast_id=p.id AND e.status='ready' AND e.created_at>?) AS ready_count,
    (SELECT count(*) FROM episodes e WHERE e.podcast_id=p.id AND e.status IN ('queued','processing','transcribing','detecting','editing')) AS processing_count,
    (SELECT max(e.ready_at) FROM episodes e WHERE e.podcast_id=p.id AND e.status='ready' AND e.created_at>?) AS latest_ready,
    EXISTS(SELECT 1 FROM subscriptions s WHERE s.podcast_id=p.id AND s.account_id=?) AS subscribed
    FROM podcasts p WHERE p.public_catalog=1 AND (p.title LIKE ? OR p.author LIKE ? OR p.category LIKE ?)
    ${ready?"AND EXISTS(SELECT 1 FROM episodes e WHERE e.podcast_id=p.id AND e.status='ready' AND e.created_at>?)":''}
    ORDER BY p.chart_rank IS NULL,p.chart_rank,p.title LIMIT 500`).bind(after,after,user?.id||'',`%${q}%`,`%${q}%`,`%${q}%`,...(ready?[after]:[])).all();
  const chart=await env.DB.prepare('SELECT COUNT(*) AS count,MAX(chart_updated_at) AS updated_at FROM podcasts WHERE public_catalog=1 AND chart_rank BETWEEN 1 AND 200').first();
  return Response.json({podcasts:results,shared:true,chart:{...chart,source:'Apple Podcasts',country:'US',url:'https://podcasts.apple.com/us/charts'}},{headers:{'Cache-Control':user?'private, no-store':'public, max-age=30'}});
}
export const catalogImportSQL=`INSERT INTO podcasts(id,feed_url,title,description,author,artwork,website,last_sync,public_catalog,prewarm,category,directory_id,chart_rank,chart_updated_at)
  VALUES(?,?,?,?,?,?,?,0,1,0,?,?,?,?)
  ON CONFLICT(feed_url) DO UPDATE SET public_catalog=1,prewarm=0,category=excluded.category,title=excluded.title,description=excluded.description,author=excluded.author,artwork=excluded.artwork,website=excluded.website,directory_id=excluded.directory_id,chart_rank=excluded.chart_rank,chart_updated_at=excluded.chart_updated_at`;
export async function catalogImportParams(item,updatedAt){
  const url=publicURL(item.feed_url),rank=Number(item.rank),directoryId=String(item.directory_id);
  if(!Number.isInteger(rank)||rank<1||rank>200||!/^\d+$/.test(directoryId)||!item.title)throw failure('Invalid chart entry.');
  const id=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url))).toString('hex').slice(0,32);
  const safeURL=value=>{try{return publicURL(value);}catch{return '';}};
  return [id,url,String(item.title).slice(0,500),String(item.description||'').slice(0,12000),String(item.author||'').slice(0,500),safeURL(item.artwork),safeURL(item.website),String(item.category||'Podcasts').slice(0,100),directoryId,rank,updatedAt];
}
export async function importChartCatalog(env,snapshot){
  if(snapshot.country!=='US'||snapshot.podcasts?.length!==200||new Set(snapshot.podcasts.map(p=>p.rank)).size!==200||new Set(snapshot.podcasts.map(p=>p.directory_id)).size!==200)throw failure('A complete US top 200 chart is required.');
  const updatedAt=Math.floor(Date.parse(snapshot.updated_at)/1000);if(!Number.isFinite(updatedAt))throw failure('Invalid chart date.');
  // Validate everything before writing. Import touches metadata only: no episodes, subscriptions or workflows.
  const params=await Promise.all(snapshot.podcasts.map(p=>catalogImportParams(p,updatedAt)));
  const statements=[env.DB.prepare('UPDATE podcasts SET chart_rank=NULL,chart_updated_at=NULL WHERE chart_rank IS NOT NULL'),...params.map(p=>env.DB.prepare(catalogImportSQL).bind(...p))];
  await env.DB.batch(statements);return {imported:params.length,processing_started:0};
}
export async function directorySearch(env,url){
  const q=(url.searchParams.get('q')||'').trim().slice(0,150);if(q.length<2)return Response.json({results:[]});
  const response=await fetch('https://itunes.apple.com/search?media=podcast&entity=podcast&limit=8&term='+encodeURIComponent(q),{signal:AbortSignal.timeout(15000)});if(!response.ok)throw failure('Podcast search is temporarily unavailable. You can still paste an RSS feed.',502);
  const data=await response.json(),results=[];
  for(const s of data.results||[]){
    if(!s.feedUrl?.startsWith('https://'))continue;let feed;try{feed=publicURL(s.feedUrl);}catch{continue;}
    const row={directory_id:String(s.collectionId),title:String(s.collectionName||''),author:String(s.artistName||''),feed_url:feed,artwork:String(s.artworkUrl100||'')};results.push(row);
    await env.DB.prepare('INSERT INTO directory_results(id,feed_url,title,author,artwork,expires_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET feed_url=excluded.feed_url,title=excluded.title,author=excluded.author,artwork=excluded.artwork,expires_at=excluded.expires_at').bind(row.directory_id,feed,row.title,row.author,row.artwork,now()+3600).run();
  }
  return Response.json({results},{headers:{'Cache-Control':'private, max-age=60'}});
}
export async function seedCatalog(env,feeds){
  const out=[];
  for(const item of feeds.slice(0,15)){
    try{
      const url=publicURL(item.url),res=await safeFetch(url);if(!res.ok)throw Error(`Publisher returned ${res.status}`);
      const feed=parseFeed(await boundedText(res));const id=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url))).toString('hex').slice(0,32);
      await env.DB.prepare('INSERT INTO podcasts(id,feed_url,title,description,author,artwork,website,last_sync,public_catalog,prewarm,category) VALUES(?,?,?,?,?,?,?,0,1,0,?) ON CONFLICT(id) DO UPDATE SET public_catalog=1,category=excluded.category,title=excluded.title,description=excluded.description,author=excluded.author,artwork=excluded.artwork').bind(id,url,feed.title,feed.description,feed.author,feed.artwork,feed.website,item.category||'Podcasts').run();
      out.push({id,title:feed.title,ok:true});
    }catch(e){out.push({ok:false,error:e.message});}
  }return out;
}
