import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPairSync,createHash,randomBytes,sign} from 'node:crypto';
import fs from 'node:fs';
import {encodeCBOR} from '../processor/node_modules/@levischuck/tiny-cbor/esm/index.js';
import {authRoute,currentUser} from '../processor/auth.js';
import {catalog,importChartCatalog} from '../processor/catalog.js';
registerHooks({resolve(spec,ctx,next){if(spec==='cloudflare:workers')return {url:'data:text/javascript,export class WorkflowEntrypoint {constructor(ctx,env){this.env=env;this.ctx=ctx;}}',shortCircuit:true};return next(spec,ctx);}});
const {default:staging}=await import('../processor/staging.js');
const {internal,tick,episodeIsUnlimited,reserveProcessingBudget}=await import('../processor/index.js');
const origin='https://podplane-staging.challoner.dev',now=()=>Math.floor(Date.now()/1000),sha=s=>createHash('sha256').update(s).digest();
function setup(){
  const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../processor/schema.sql',import.meta.url),'utf8'));db.exec(fs.readFileSync(new URL('../processor/migrations/002-auth-catalog.sql',import.meta.url),'utf8'));db.exec(fs.readFileSync(new URL('../processor/migrations/003-email-codes.sql',import.meta.url),'utf8'));db.exec(fs.readFileSync(new URL('../processor/migrations/004-chart-catalog.sql',import.meta.url),'utf8'));db.exec(fs.readFileSync(new URL('../processor/migrations/005-account-unlimited.sql',import.meta.url),'utf8'));
  function prepare(sql,values=[]){return {bind(...v){return prepare(sql,v);},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};}
  const env={PUBLIC_ORIGIN:origin,INTERNAL_SECRET:'internal-test',FEED_SECRET:'feed-test',EMAIL_FROM:'signin@notify.podplane-staging.challoner.dev',EMAIL:{messages:[],async send(message){this.messages.push(message);return {messageId:'test-message'};}},DB:{prepare,async batch(s){return Promise.all(s.map(x=>x.run()));}},PROCESS:{async create(){throw Error('Cached selection must not start processing');}}};
  const id=crypto.randomUUID(),session=randomBytes(32).toString('base64url');db.prepare('INSERT INTO accounts(id,subject,email,created_at) VALUES(?,?,?,?)').run(id,'email:alice@example.com','alice@example.com',now());db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?)').run(sha(session).toString('hex'),id,now(),now()+3600,'email');return {db,env,id,session};
}
const req=(path,{method='GET',cookie,body,headers={}}={})=>new Request(origin+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json',...headers},...(body?{body:JSON.stringify(body)}:{})});
const invoke=(request,env,user)=>authRoute(request,env,new URL(request.url),user);
const challengeCookie=r=>r.headers.getSetCookie().find(x=>x.startsWith('__Host-podplane-challenge=')).split(';')[0];
function keyFixture(){const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=publicKey.export({format:'jwk'});const cose=encodeCBOR(new Map([[1,2],[3,-7],[-1,1],[-2,new Uint8Array(Buffer.from(jwk.x,'base64url'))],[-3,new Uint8Array(Buffer.from(jwk.y,'base64url'))]]));return {privateKey,cose,id:randomBytes(32).toString('base64url')};}
function authentication(fixture,challenge,clientOrigin=origin,counter=1){
  const c=Buffer.from(JSON.stringify({type:'webauthn.get',challenge,origin:clientOrigin})),count=Buffer.alloc(4);count.writeUInt32BE(counter);
  const auth=Buffer.concat([sha(new URL(origin).hostname),Buffer.from([5]),count]),signature=sign('sha256',Buffer.concat([auth,sha(c)]),fixture.privateKey);
  return {id:fixture.id,rawId:fixture.id,type:'public-key',clientExtensionResults:{},response:{authenticatorData:auth.toString('base64url'),clientDataJSON:c.toString('base64url'),signature:signature.toString('base64url')}};
}
async function emailStart(env,email='Alice@Example.com',cookie){
  const r=await invoke(req('/api/auth/email/start',{method:'POST',body:{email},cookie}),env);
  return {response:r,cookie:r.headers.getSetCookie().find(x=>x.startsWith('__Host-podplane-email=')).split(';')[0],code:env.EMAIL.messages.at(-1).text.match(/code is (\d{6})/)[1]};
}
test('email codes use the sending binding, stay hashed, sign into the existing account, and cannot be replayed',async()=>{
  const {db,env,id}=setup(),start=await emailStart(env);
  assert.deepEqual(await start.response.json(),{sent:true,email:'alice@example.com',expires_in:600});
  assert.equal(env.EMAIL.messages[0].to,'alice@example.com');assert.equal(env.EMAIL.messages[0].from.email,env.EMAIL_FROM);assert.ok(env.EMAIL.messages[0].html.includes(start.code));
  const row=db.prepare('SELECT * FROM email_codes').get();assert.notEqual(row.code_hash,start.code);assert.notEqual(row.id_hash,start.cookie.split('=')[1]);assert.equal(row.attempts,0);
  const verify=()=>invoke(req('/api/auth/email/verify',{method:'POST',cookie:start.cookie,body:{code:start.code}}),env);
  const result=await verify();assert.equal((await result.json()).verified,true);const cookie=result.headers.getSetCookie().find(x=>x.startsWith('__Host-podplane=')).split(';')[0];
  assert.equal((await currentUser(req('/app',{cookie}),env)).id,id);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_codes').get().n,0);
  assert.match(result.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);await assert.rejects(verify,/incorrect or expired/);db.close();
});
test('email verification requires the requesting browser and the same origin',async()=>{
  const {db,env}=setup(),start=await emailStart(env);
  await assert.rejects(()=>invoke(req('/api/auth/email/verify',{method:'POST',body:{code:start.code}}),env),/incorrect or expired/);
  const r=await staging.fetch(req('/api/auth/email/verify',{method:'POST',cookie:start.cookie,body:{code:start.code},headers:{Origin:'https://evil.example'}}),env);assert.equal(r.status,403);
  assert.equal(db.prepare('SELECT attempts FROM email_codes').get().attempts,0);db.close();
});
test('email codes lock after five wrong attempts and expire after ten minutes',async()=>{
  for(const expired of [false,true]){const {db,env}=setup(),start=await emailStart(env);const wrong=start.code==='000000'?'111111':'000000';
    if(expired)db.prepare('UPDATE email_codes SET expires_at=?').run(now()-1);
    else for(let i=0;i<5;i++)await assert.rejects(()=>invoke(req('/api/auth/email/verify',{method:'POST',cookie:start.cookie,body:{code:wrong}}),env),/incorrect or expired/);
    await assert.rejects(()=>invoke(req('/api/auth/email/verify',{method:'POST',cookie:start.cookie,body:{code:start.code}}),env),/incorrect or expired/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1);db.close();
  }
});
test('concurrent email code verification creates exactly one session',async()=>{
  const {db,env}=setup(),start=await emailStart(env);const attempts=await Promise.allSettled([0,1].map(()=>invoke(req('/api/auth/email/verify',{method:'POST',cookie:start.cookie,body:{code:start.code}}),env)));
  assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,2);db.close();
});
test('email sends validate addresses, reject cross-origin requests and throttle repeats',async()=>{
  const {db,env}=setup();await assert.rejects(()=>invoke(req('/api/auth/email/start',{method:'POST',body:{email:'alice@example.com\r\nBcc: victim@example.com'}}),env),/valid email/);
  assert.equal((await staging.fetch(req('/api/auth/email/start',{method:'POST',body:{email:'alice@example.com'},headers:{Origin:'https://evil.example'}}),env)).status,403);
  await emailStart(env);await assert.rejects(()=>emailStart(env),/Too many/);assert.equal(env.EMAIL.messages.length,1);
  const legacy=await staging.fetch(req('/auth/email/callback',{headers:{'Cf-Access-Jwt-Assertion':'forged'}}),env);assert.equal(legacy.status,303);assert.equal(new URL(legacy.headers.get('location')).pathname,'/signin');db.close();
});
test('a send failure removes its challenge and returns a useful error',async()=>{
  const {db,env}=setup();env.EMAIL.send=async()=>{throw Object.assign(Error('delivery failure'),{code:'E_SENDER_NOT_VERIFIED'});};
  const r=await staging.fetch(req('/api/auth/email/start',{method:'POST',body:{email:'alice@example.com'}}),env);assert.equal(r.status,503);assert.match((await r.json()).error,/could not send/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM email_codes').get().n,0);assert.equal(r.headers.get('set-cookie'),null);db.close();
});
test('session cookies are hashed, expire, and ignore identity headers',async()=>{const {db,env,id,session}=setup();assert.equal((await currentUser(req('/app',{cookie:'__Host-podplane='+session}),env)).id,id);assert.equal(await currentUser(req('/app',{headers:{'oai-authenticated-user-id':id,'oai-authenticated-user-email':'alice@example.com'}}),env),null);db.prepare('UPDATE sessions SET expires_at=?').run(now()-1);assert.equal(await currentUser(req('/app',{cookie:'__Host-podplane='+session}),env),null);db.close();});
test('protected staging APIs require a session and reject cross-origin mutations',async()=>{const {db,env,session}=setup();assert.equal((await staging.fetch(req('/api/dashboard'),env)).status,401);assert.equal((await staging.fetch(req('/internal/dashboard',{headers:{Authorization:'Bearer internal-test','X-Podplane-Subject':'email:alice@example.com'}}),env)).status,404);assert.equal((await staging.fetch(req('/api/podcasts',{method:'POST',cookie:'__Host-podplane='+session,headers:{Origin:'https://evil.example'},body:{}}),env)).status,403);db.close();});
test('a real WebAuthn assertion signs in, advances the counter and cannot be replayed',async()=>{
  const {db,env,id}=setup(),f=keyFixture();db.prepare('INSERT INTO passkeys(id,account_id,public_key,counter,transports,name,created_at,device_type) VALUES(?,?,?,?,?,?,?,?)').run(f.id,id,Buffer.from(f.cose).toString('base64url'),0,'[]','Test key',now(),'singleDevice');
  const optionsRes=await invoke(req('/api/auth/passkeys/login/options',{method:'POST'}),env),options=await optionsRes.json(),cookie=challengeCookie(optionsRes),credential=authentication(f,options.challenge);
  const verified=await invoke(req('/api/auth/passkeys/login/verify',{method:'POST',cookie,body:{credential}}),env);assert.equal((await verified.json()).verified,true);const sessionCookie=verified.headers.getSetCookie().find(x=>x.startsWith('__Host-podplane=')).split(';')[0];assert.match(verified.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Lax/);assert.equal((await currentUser(req('/app',{cookie:sessionCookie}),env)).id,id);assert.equal(db.prepare('SELECT counter FROM passkeys WHERE id=?').get(f.id).counter,1);await assert.rejects(()=>invoke(req('/api/auth/passkeys/login/verify',{method:'POST',cookie,body:{credential}}),env),/expired/);db.close();
});
test('WebAuthn rejects a valid signature for the wrong origin',async()=>{const {db,env,id}=setup(),f=keyFixture();db.prepare('INSERT INTO passkeys(id,account_id,public_key,counter,name,created_at,device_type) VALUES(?,?,?,?,?,?,?)').run(f.id,id,Buffer.from(f.cose).toString('base64url'),0,'Test',now(),'singleDevice');const r=await invoke(req('/api/auth/passkeys/login/options',{method:'POST'}),env),o=await r.json();await assert.rejects(()=>invoke(req('/api/auth/passkeys/login/verify',{method:'POST',cookie:challengeCookie(r),body:{credential:authentication(f,o.challenge,'https://evil.example')}}),env));assert.equal(db.prepare('SELECT counter FROM passkeys WHERE id=?').get(f.id).counter,0);db.close();});
test('passkey enrollment verifies attestation and stores only the public credential',async()=>{
  const {db,env,session,id}=setup(),cookie='__Host-podplane='+session,user=await currentUser(req('/settings',{cookie}),env),f=keyFixture();
  const r=await invoke(req('/api/auth/passkeys/register/options',{method:'POST',cookie}),env,user),o=await r.json();assert.equal(o.authenticatorSelection.residentKey,'required');assert.equal(o.authenticatorSelection.userVerification,'required');
  const idBytes=Buffer.from(f.id,'base64url'),len=Buffer.alloc(2);len.writeUInt16BE(idBytes.length);
  const auth=Buffer.concat([sha(new URL(origin).hostname),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),len,idBytes,Buffer.from(f.cose)]);
  const credential={id:f.id,rawId:f.id,type:'public-key',clientExtensionResults:{credProps:{rk:true}},response:{clientDataJSON:Buffer.from(JSON.stringify({type:'webauthn.create',challenge:o.challenge,origin})).toString('base64url'),attestationObject:Buffer.from(encodeCBOR(new Map([['fmt','none'],['attStmt',new Map()],['authData',new Uint8Array(auth)]]))).toString('base64url'),transports:['internal']}};
  const v=await invoke(req('/api/auth/passkeys/register/verify',{method:'POST',cookie:cookie+'; '+challengeCookie(r),body:{credential,name:'My phone'}}),env,user);assert.equal((await v.json()).verified,true);const key=db.prepare('SELECT * FROM passkeys WHERE id=?').get(f.id);assert.equal(key.account_id,id);assert.equal(key.name,'My phone');assert.equal(key.public_key,Buffer.from(f.cose).toString('base64url'));db.close();
});
test('catalog hides private feeds and ready-only filter selects cached audio',async()=>{const {db,env}=setup();for(const [id,title,visible] of [['a'.repeat(32),'Public show',1],['b'.repeat(32),'Private token feed',0],['c'.repeat(32),'Unprocessed show',1]])db.prepare('INSERT INTO podcasts(id,feed_url,title,public_catalog) VALUES(?,?,?,?)').run(id,'https://example.com/'+id,title,visible);db.prepare('INSERT INTO episodes(id,podcast_id,guid,title,source_url,published_at,created_at,status) VALUES(?,?,?,?,?,?,?,?)').run('e'.repeat(40),'a'.repeat(32),'g','Cached','https://example.com/a.mp3',now(),now(),'ready');const all=await (await catalog(env,new URL(origin+'/api/catalog'),null)).json();assert.equal(all.podcasts.length,2);assert.ok(!JSON.stringify(all).includes('Private token'));const ready=await (await catalog(env,new URL(origin+'/api/catalog?ready=1'),null)).json();assert.deepEqual(ready.podcasts.map(p=>p.title),['Public show']);db.close();});
test('top 200 import and browsing create no episodes or subscriptions, and cron leaves unselected shows alone',async()=>{
  const {db,env}=setup(),snapshot=JSON.parse(fs.readFileSync(new URL('../processor/data/us-top-podcasts.json',import.meta.url),'utf8'));
  const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Metadata import and idle catalog must not fetch publishers');};
  try{
    assert.deepEqual(await importChartCatalog(env,snapshot),{imported:200,processing_started:0});await importChartCatalog(env,snapshot);
    const d=await (await catalog(env,new URL(origin+'/api/catalog'),null)).json();assert.equal(d.podcasts.length,200);assert.equal(d.chart.count,200);assert.deepEqual(d.podcasts.map(p=>p.chart_rank),Array.from({length:200},(_,i)=>i+1));
    const tail=snapshot.podcasts[199],filtered=await (await catalog(env,new URL(origin+'/api/catalog?q='+encodeURIComponent(tail.title)),null)).json();assert.ok(filtered.podcasts.some(p=>p.chart_rank===200));
    await tick({...env,AUDIO:{async delete(){throw Error('No audio should exist');}}});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM episodes').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,0);assert.equal(db.prepare('SELECT SUM(prewarm) AS n FROM podcasts').get().n,0);
  }finally{globalThis.fetch=oldFetch;db.close();}
});
test('adding an unprocessed chart show queues only its latest episode and starts one job',async()=>{
  const {db,env}=setup(),p='a'.repeat(32),started=[];db.prepare('INSERT INTO podcasts(id,feed_url,title,public_catalog,chart_rank) VALUES(?,?,?,1,1)').run(p,'https://publisher.example/rss','Chart show');
  env.PROCESS.create=async job=>{started.push(job);};const oldFetch=globalThis.fetch;let fetched=0;
  globalThis.fetch=async()=>{fetched++;return new Response('<rss version="2.0"><channel><title>Chart show</title><item><guid>latest</guid><title>Latest episode</title><pubDate>Sun, 08 Nov 2026 12:00:00 GMT</pubDate><enclosure url="https://audio.example/latest.mp3" type="audio/mpeg" length="1000"/></item><item><guid>older</guid><title>Older episode</title><enclosure url="https://audio.example/older.mp3" type="audio/mpeg" length="1000"/></item></channel></rss>');};
  try{
    const r=await internal(new Request(origin+'/internal/podcasts',{method:'POST',headers:{Authorization:'Bearer internal-test','X-Podplane-Subject':'email:alice@example.com','Content-Type':'application/json'},body:JSON.stringify({podcast_id:p})}),env,new URL(origin+'/internal/podcasts'));
    assert.equal(r.status,201);assert.equal(fetched,1);assert.equal(started.length,1);assert.deepEqual(db.prepare('SELECT guid,status FROM episodes').all().map(x=>({...x})),[{guid:'latest',status:'processing'}]);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM subscriptions').get().n,1);
  }finally{globalThis.fetch=oldFetch;db.close();}
});
test('following a cached catalog show reuses the episode without publisher fetch or another job',async()=>{const {db,env}=setup(),p='a'.repeat(32),e='e'.repeat(40);db.prepare('INSERT INTO podcasts(id,feed_url,title,public_catalog) VALUES(?,?,?,1)').run(p,'https://example.com/rss','Cached show');db.prepare('INSERT INTO episodes(id,podcast_id,guid,title,source_url,published_at,created_at,status) VALUES(?,?,?,?,?,?,?,?)').run(e,p,'g','Cached episode','https://example.com/a.mp3',now(),now(),'ready');const oldFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Cached follow must not fetch publisher');};try{const r=await internal(new Request(origin+'/internal/podcasts',{method:'POST',headers:{Authorization:'Bearer internal-test','X-Podplane-Subject':'email:alice@example.com','Content-Type':'application/json'},body:JSON.stringify({podcast_id:p})}),env,new URL(origin+'/internal/podcasts'));assert.equal(r.status,201);const d=await r.json();assert.equal(d.episodes[0].id,e);assert.equal(d.episodes[0].status,'ready');assert.ok(d.feed_url.startsWith(origin));}finally{globalThis.fetch=oldFetch;db.close();}});
test('unlimited accounts can add past five shows and the daily add allowance; beta accounts cannot self-upgrade',async()=>{
  for(const unlimited of [0,1]){
    const {db,env,id}=setup();db.prepare('UPDATE accounts SET unlimited=? WHERE id=?').run(unlimited,id);
    for(let i=1;i<=7;i++){const p=i.toString(16).padStart(32,'0');db.prepare('INSERT INTO podcasts(id,feed_url,title,public_catalog) VALUES(?,?,?,1)').run(p,'https://example.com/'+i,'Show '+i);db.prepare('INSERT INTO episodes(id,podcast_id,guid,title,source_url,published_at,created_at,status) VALUES(?,?,?,?,?,?,?,?)').run(p.padStart(40,'0'),p,'g','Cached','https://example.com/'+i+'.mp3',now(),now(),'ready');}
    const add=async i=>{const request=new Request(origin+'/internal/podcasts',{method:'POST',headers:{Authorization:'Bearer internal-test','X-Podplane-Subject':'email:alice@example.com','Content-Type':'application/json'},body:JSON.stringify({podcast_id:i.toString(16).padStart(32,'0'),unlimited:true,plan:'unlimited'})});return internal(request,env,new URL(request.url));};
    for(let i=1;i<=5;i++)await add(i);
    if(unlimited){db.prepare('INSERT OR REPLACE INTO limits VALUES(?,?,?)').run('add:'+id+':'+new Date().toISOString().slice(0,10),15,now()+86400);const r=await add(6),d=await r.json();assert.equal(d.shows.length,6);assert.equal(d.max_shows,null);assert.equal(d.daily_audio_minutes,null);assert.equal(d.plan,'unlimited');await add(7);}
    else{await assert.rejects(()=>add(6),/five podcasts/);assert.equal(db.prepare('SELECT unlimited FROM accounts WHERE id=?').get(id).unlimited,0);}
    db.close();
  }
});
test('processing allowance exemption follows a subscribed unlimited account and does not consume the beta allowance',async()=>{
  const {db,env,id}=setup(),p='a'.repeat(32),e='e'.repeat(40),day=new Date().toISOString().slice(0,10);
  db.prepare('INSERT INTO podcasts(id,feed_url,title) VALUES(?,?,?)').run(p,'https://example.com/rss','Show');db.prepare('INSERT INTO episodes(id,podcast_id,guid,title,source_url,published_at,created_at) VALUES(?,?,?,?,?,?,?)').run(e,p,'g','Episode','https://example.com/e.mp3',now(),now());
  db.prepare('INSERT INTO subscriptions VALUES(?,?,?)').run(id,p,now());db.prepare('INSERT INTO limits VALUES(?,?,?)').run('audio:'+day,600,now()+86400);
  assert.equal(await episodeIsUnlimited(env,e),false);await assert.rejects(()=>reserveProcessingBudget(env,e,240*60),/processing limit/);
  db.prepare('UPDATE accounts SET unlimited=1 WHERE id=?').run(id);assert.equal(await episodeIsUnlimited(env,e),true);await reserveProcessingBudget(env,e,240*60);await reserveProcessingBudget(env,e,240*60);
  assert.equal(db.prepare('SELECT amount FROM limits WHERE key=?').get('audio:'+day).amount,600);assert.equal(db.prepare('SELECT minutes FROM reservations WHERE episode_id=?').get(e).minutes,240);
  db.prepare('DELETE FROM subscriptions WHERE account_id=?').run(id);assert.equal(await episodeIsUnlimited(env,e),false);db.close();
});
test('an existing session and account page reflect an unlimited upgrade immediately',async()=>{
  const {db,env,id,session}=setup(),cookie='__Host-podplane='+session;db.prepare('UPDATE accounts SET unlimited=1 WHERE id=?').run(id);
  assert.equal((await currentUser(req('/app',{cookie}),env)).unlimited,1);
  const me=await staging.fetch(req('/api/auth/me',{cookie}),env);assert.equal((await me.json()).user.plan,'unlimited');
  const page=await (await staging.fetch(req('/settings',{cookie}),env)).text();assert.ok(page.includes('Unlimited · No show or daily processing allowance limits.'));db.close();
});
