import { XMLParser, XMLValidator } from 'fast-xml-parser';
export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const str=x=>typeof x==='object'?String(x?.['#text']??''):String(x??'');
const arr=x=>x?(Array.isArray(x)?x:[x]):[];
export const plain=x=>str(x).replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim().slice(0,12000);
export function publicURL(raw){
  const u=new URL(raw);const h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||h==='localhost'||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.localhost')||!h.includes('.')||h.includes(':')||/^\d+(\.\d+){3}$/.test(h))throw new Error('Use a public HTTPS feed URL');
  return u.href;
}
export async function safeFetch(raw,options={}){
  const {redirectTrace,...requestOptions}=options;
  let url=publicURL(raw);const seen=new Set([url]);
  // Publisher enclosures commonly pass through multiple measurement services
  // before the audio CDN. Validate each hop and permit up to twenty redirects.
  for(let redirects=0;;redirects++){
    const res=await fetch(url,{...requestOptions,redirect:'manual',signal:AbortSignal.timeout(90000),headers:{'User-Agent':'Podplane/1.0 (private podcast feed processor)',...requestOptions.headers}});
    if(![301,302,303,307,308].includes(res.status))return res;
    const loc=res.headers.get('location');await res.body?.cancel();
    if(!loc)throw new Error('Redirect missing a location');
    const next=publicURL(new URL(loc,url).href);
    if(redirects>=20)throw new Error('Too many redirects (limit: 20)');
    if(seen.has(next))throw new Error('Publisher redirect loop detected');
    redirectTrace?.push({status:res.status,from:new URL(url).hostname,to:new URL(next).hostname});
    seen.add(next);url=next;
  }
}
export async function boundedText(res,max=4*1024*1024){
  const reader=res.body.getReader(),decoder=new TextDecoder();let size=0,text='';
  try{for(;;){
    const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw new Error('Feed is too large');text+=decoder.decode(value,{stream:true});
    // Large publisher archives can contain thousands of episodes. Stop at a
    // complete, validated recent prefix instead of buffering the entire archive.
    if(/<rss\b/i.test(text)&&/<channel\b/i.test(text)){
      const endings=[...text.matchAll(/<\/item\s*>/gi)];
      if(endings.length>=30){const end=endings[29].index+endings[29][0].length,candidate=text.slice(0,end)+'</channel></rss>';if(!/<!DOCTYPE|<!ENTITY/i.test(candidate)&&XMLValidator.validate(candidate)===true)return candidate;}
    }
  }}finally{await reader.cancel();}
  return text+decoder.decode();
}
export function parseFeed(xml){
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('This URL did not return a valid podcast RSS feed');
  const data=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_',parseTagValue:false,processEntities:true,htmlEntities:true}).parse(xml);
  const c=data.rss?.channel;if(!c||!str(c.title))throw new Error('This URL is not a podcast RSS feed');
  const title=plain(c.title).slice(0,300),artwork=c['itunes:image']?.['@_href']||c.image?.url||'';
  const episodes=arr(c.item).map(i=>{
    const e=arr(i.enclosure).find(e=>e['@_url']&&(!e['@_type']||e['@_type'].startsWith('audio/')));
    if(!e)return null;let audio;try{audio=publicURL(e['@_url']);}catch{return null;}
    const published=Date.parse(str(i.pubDate));if(!Number.isFinite(published))return null;
    return {guid:str(i.guid)||audio,title:plain(i.title).slice(0,500)||'Untitled episode',description:plain(i.description||i['itunes:summary']),source_url:audio,published_at:Math.floor(published/1000)};
  }).filter(Boolean).sort((a,b)=>b.published_at-a.published_at);
  if(!episodes.length)throw new Error('No audio episodes found in this RSS feed');
  return {title,description:plain(c.description),author:plain(c['itunes:author']),artwork:str(artwork),website:str(c.link),episodes};
}
export function rss({title,description,artwork,link,self,items}){
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(title)}</title><link>${esc(link)}</link><description>${esc(description)}</description><language>en</language><itunes:explicit>true</itunes:explicit><itunes:block>yes</itunes:block><atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/><ttl>30</ttl>${artwork?`<itunes:image href="${esc(artwork)}"/>`:''}${items.map(e=>`<item><title>${esc(e.title)}</title><guid isPermaLink="false">podplane:${esc(e.id)}</guid><pubDate>${new Date(e.published_at*1000).toUTCString()}</pubDate><description>${esc(e.description)}\n\nProcessed by Podplane. ${Math.round(e.duration-e.cleaned_duration)} seconds removed. Ad detection may miss some ads.</description><itunes:author>${esc(e.author||e.podcast_title)}</itunes:author><itunes:duration>${Math.round(e.cleaned_duration)}</itunes:duration>${e.artwork?`<itunes:image href="${esc(e.artwork)}"/>`:''}<enclosure url="${esc(e.audio_url)}" length="${e.audio_bytes}" type="audio/mpeg"/></item>`).join('')}</channel></rss>`;
}
