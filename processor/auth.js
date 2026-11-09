import {Buffer} from 'node:buffer';
import {timingSafeEqual} from 'node:crypto';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
const now=()=>Math.floor(Date.now()/1000);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const hash=async value=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))).toString('hex');
const random=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
const cookie=(name,value,age)=>`${name}=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
export function cookies(req){const out={};for(const c of (req.headers.get('Cookie')||'').split(';')){const i=c.indexOf('=');if(i>0)out[c.slice(0,i).trim()]=c.slice(i+1).trim();}return out;}
export async function currentUser(req,env){
  const raw=cookies(req)['__Host-podplane'];if(!raw||!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
  return env.DB.prepare('SELECT a.*,s.auth_method,s.created_at AS authenticated_at FROM sessions s JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await hash(raw),now()).first();
}
async function session(env,account,method){
  const raw=random();await env.DB.prepare('INSERT INTO sessions(token_hash,account_id,created_at,expires_at,auth_method) VALUES(?,?,?,?,?)').bind(await hash(raw),account.id,now(),now()+30*86400,method).run();
  return cookie('__Host-podplane',raw,30*86400);
}
async function rate(env,key,max=20){
  const n=await env.DB.prepare('INSERT INTO limits(key,amount,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET amount=amount+1 WHERE amount<? RETURNING amount').bind(key,now()+3600,max).first();if(!n)throw failure('Too many sign-in attempts. Please try again later.',429);
}
function csrf(req,env){if(req.headers.get('Origin')!==env.PUBLIC_ORIGIN)throw failure('Request origin rejected.',403);}
async function body(req){if(Number(req.headers.get('Content-Length'))>16000)throw failure('Request too large',413);const text=await req.text();if(text.length>16000)throw failure('Request too large',413);return JSON.parse(text||'{}');}
const response=(data,headers={},status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
async function saveChallenge(env,purpose,value,accountId=null){
  const id=random();await env.DB.prepare('INSERT INTO auth_challenges(id_hash,challenge,purpose,account_id,expires_at) VALUES(?,?,?,?,?)').bind(await hash(id),value,purpose,accountId,now()+600).run();return id;
}
async function takeChallenge(req,env,purpose,accountId=null){
  const token=cookies(req)['__Host-podplane-challenge'];if(!token)throw failure('The sign-in request expired. Please start again.');
  // DELETE RETURNING atomically prevents two requests from consuming one challenge.
  const row=await env.DB.prepare('DELETE FROM auth_challenges WHERE id_hash=? AND purpose=? AND expires_at>? RETURNING *').bind(await hash(token),purpose,now()).first();
  if(!row||(accountId&&row.account_id!==accountId))throw failure('The sign-in request expired. Please start again.');return row;
}
function emailCode(){
  const n=new Uint32Array(1);do{crypto.getRandomValues(n);}while(n[0]>=4294000000);
  return String(n[0]%1000000).padStart(6,'0');
}
function emailAddress(value){
  const email=String(value||'').trim().toLowerCase();
  if(email.length>254||!/^[a-z0-9.!#$%&'*+\-/=?^_`{|}~]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(email))throw failure('Enter a valid email address.');
  return email;
}
async function startEmail(req,env){
  if(!env.EMAIL?.send||!env.EMAIL_FROM)throw failure('Email login is being configured.',503);
  const email=emailAddress((await body(req)).email),ip=req.headers.get('CF-Connecting-IP')||'unknown',hour=Math.floor(now()/3600);
  await rate(env,`email-ip:${ip}:${hour}`,20);
  const emailHash=await hash(email);
  await rate(env,`email-address:${emailHash}:${hour}`,5);
  await rate(env,`email-resend:${emailHash}:${Math.floor(now()/60)}`,1);
  const id=random(),idHash=await hash(id),code=emailCode();
  // The random browser token is needed to test a code, even with a database copy.
  const codeHash=await hash(`podplane:email-code:${id}:${email}:${code}`);
  await env.DB.prepare('INSERT INTO email_codes(id_hash,email,code_hash,attempts,expires_at) VALUES(?,?,?,0,?)').bind(idHash,email,codeHash,now()+600).run();
  try{
    await env.EMAIL.send({from:{email:env.EMAIL_FROM,name:'Podplane'},to:email,subject:'Your Podplane sign-in code',text:`Your Podplane sign-in code is ${code}.\n\nEnter this code in the browser where you requested it. It expires in 10 minutes and can be used once.\n\nIf you did not request this code, you can ignore this email.`,html:`<div style="font-family:Arial,sans-serif;max-width:480px;margin:32px auto;color:#202d27"><h1 style="font-size:24px">Sign in to Podplane</h1><p>Your sign-in code is:</p><p style="font-size:36px;font-weight:bold;letter-spacing:8px">${code}</p><p>Enter it in the browser where you requested it. This code expires in 10 minutes and can be used once.</p><p>If you did not request this code, you can ignore this email.</p></div>`});
  }catch(error){
    await env.DB.prepare('DELETE FROM email_codes WHERE id_hash=?').bind(idHash).run();
    console.error(JSON.stringify({event:'email_send_failed',code:String(error.code||'unknown').slice(0,80)}));
    throw failure('We could not send your code. Please try again in a minute.',503);
  }
  const previous=cookies(req)['__Host-podplane-email'];
  if(previous)await env.DB.prepare('DELETE FROM email_codes WHERE id_hash=?').bind(await hash(previous)).run();
  return response({sent:true,email,expires_in:600},{'Set-Cookie':cookie('__Host-podplane-email',id,600)});
}
async function verifyEmail(req,env){
  const invalid=()=>failure('The code is incorrect or expired. Request a new code if needed.',401);
  const id=cookies(req)['__Host-podplane-email'],data=await body(req),code=String(data.code||'').trim();
  if(!id||!/^[A-Za-z0-9_-]{43}$/.test(id)||!/^\d{6}$/.test(code))throw invalid();
  await rate(env,`email-verify:${req.headers.get('CF-Connecting-IP')||'unknown'}:${Math.floor(now()/3600)}`,100);
  const idHash=await hash(id);
  const row=await env.DB.prepare('UPDATE email_codes SET attempts=attempts+1 WHERE id_hash=? AND expires_at>? AND attempts<5 RETURNING *').bind(idHash,now()).first();
  if(!row)throw invalid();
  const codeHash=await hash(`podplane:email-code:${id}:${row.email}:${code}`);
  if(!timingSafeEqual(Buffer.from(codeHash,'hex'),Buffer.from(row.code_hash,'hex')))throw invalid();
  // Atomic consumption permits only one successful sign-in, including concurrent requests.
  const consumed=await env.DB.prepare('DELETE FROM email_codes WHERE id_hash=? AND code_hash=? AND expires_at>? RETURNING email').bind(idHash,codeHash,now()).first();
  if(!consumed)throw invalid();
  const subject='email:'+consumed.email;
  await env.DB.prepare('INSERT OR IGNORE INTO accounts(id,subject,email,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),subject,consumed.email,now()).run();
  const account=await env.DB.prepare('SELECT * FROM accounts WHERE subject=?').bind(subject).first();
  const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});
  headers.append('Set-Cookie',await session(env,account,'email'));
  headers.append('Set-Cookie',cookie('__Host-podplane-email','',0));
  return new Response(JSON.stringify({verified:true,redirect:'/app'}),{headers});
}
export async function authRoute(req,env,url,user){
  const path=url.pathname;
  if((path==='/auth/email/start'||path==='/auth/email/callback')&&req.method==='GET')return Response.redirect(env.PUBLIC_ORIGIN+'/signin',303);
  if(path==='/auth/logout'&&req.method==='POST'){
    csrf(req,env);const raw=cookies(req)['__Host-podplane'];if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(raw)).run();
    return new Response(null,{status:303,headers:{Location:'/signin','Set-Cookie':cookie('__Host-podplane','',0),'Cache-Control':'no-store'}});
  }
  if(!path.startsWith('/api/auth/'))return null;
  if(req.method==='POST')csrf(req,env);
  if(path==='/api/auth/email/start'&&req.method==='POST')return startEmail(req,env);
  if(path==='/api/auth/email/verify'&&req.method==='POST')return verifyEmail(req,env);
  if(path==='/api/auth/me'&&req.method==='GET')return response({user:user?{email:user.email,id:user.id,plan:user.unlimited?'unlimited':'beta'}:null});
  if(path==='/api/auth/passkeys'&&req.method==='GET'){
    if(!user)throw failure('Sign in first.',401);const {results}=await env.DB.prepare('SELECT id,name,created_at,last_used_at FROM passkeys WHERE account_id=? ORDER BY created_at DESC').bind(user.id).all();return response({passkeys:results});
  }
  if(path==='/api/auth/passkeys/register/options'&&req.method==='POST'){
    if(!user)throw failure('Sign in with email before adding a passkey.',401);
    // Require recent verified possession before adding another sign-in method.
    if(now()-user.authenticated_at>900)throw failure('Sign in again before adding a passkey.',401);
    await rate(env,`register:${user.id}:${Math.floor(now()/3600)}`,10);
    const {results:keys}=await env.DB.prepare('SELECT id,transports FROM passkeys WHERE account_id=?').bind(user.id).all();if(keys.length>=10)throw failure('You can save up to ten passkeys.');
    const options=await generateRegistrationOptions({rpName:'Podplane staging',rpID:new URL(env.PUBLIC_ORIGIN).hostname,userName:user.email,userDisplayName:user.email,userID:new TextEncoder().encode(user.id),attestationType:'none',excludeCredentials:keys.map(k=>({id:k.id,transports:JSON.parse(k.transports)})),authenticatorSelection:{residentKey:'required',userVerification:'required'},supportedAlgorithmIDs:[-7,-257]});
    const id=await saveChallenge(env,'register',options.challenge,user.id);return response(options,{'Set-Cookie':cookie('__Host-podplane-challenge',id,600)});
  }
  if(path==='/api/auth/passkeys/register/verify'&&req.method==='POST'){
    if(!user||now()-user.authenticated_at>900)throw failure('Sign in again before adding a passkey.',401);
    const challenge=await takeChallenge(req,env,'register',user.id),data=await body(req);
    const verification=await verifyRegistrationResponse({response:data.credential,expectedChallenge:challenge.challenge,expectedOrigin:env.PUBLIC_ORIGIN,expectedRPID:new URL(env.PUBLIC_ORIGIN).hostname,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
    if(!verification.verified)throw failure('The passkey could not be verified.');
    const {credential,credentialDeviceType,credentialBackedUp}=verification.registrationInfo;
    const name=String(data.name||'My passkey').trim().slice(0,80)||'My passkey';
    await env.DB.prepare('INSERT INTO passkeys(id,account_id,public_key,counter,transports,name,created_at,device_type,backed_up) VALUES(?,?,?,?,?,?,?,?,?)').bind(credential.id,user.id,Buffer.from(credential.publicKey).toString('base64url'),credential.counter,JSON.stringify(credential.transports||[]),name,now(),credentialDeviceType,credentialBackedUp?1:0).run();
    return response({verified:true},{'Set-Cookie':cookie('__Host-podplane-challenge','',0)});
  }
  if(path==='/api/auth/passkeys/login/options'&&req.method==='POST'){
    await rate(env,`passkey-login:${req.headers.get('CF-Connecting-IP')||'unknown'}:${Math.floor(now()/3600)}`,40);
    const options=await generateAuthenticationOptions({rpID:new URL(env.PUBLIC_ORIGIN).hostname,userVerification:'required'});
    const id=await saveChallenge(env,'login',options.challenge);return response(options,{'Set-Cookie':cookie('__Host-podplane-challenge',id,600)});
  }
  if(path==='/api/auth/passkeys/login/verify'&&req.method==='POST'){
    const challenge=await takeChallenge(req,env,'login'),data=await body(req);
    const key=await env.DB.prepare('SELECT * FROM passkeys WHERE id=?').bind(String(data.credential?.id||'')).first();if(!key)throw failure('This passkey is not registered with Podplane.',401);
    const verification=await verifyAuthenticationResponse({response:data.credential,expectedChallenge:challenge.challenge,expectedOrigin:env.PUBLIC_ORIGIN,expectedRPID:new URL(env.PUBLIC_ORIGIN).hostname,requireUserVerification:true,credential:{id:key.id,publicKey:new Uint8Array(Buffer.from(key.public_key,'base64url')),counter:key.counter,transports:JSON.parse(key.transports)}});
    if(!verification.verified)throw failure('The passkey could not be verified.',401);
    const updated=await env.DB.prepare('UPDATE passkeys SET counter=?,last_used_at=? WHERE id=? AND counter=?').bind(verification.authenticationInfo.newCounter,now(),key.id,key.counter).run();
    if(!updated.meta.changes)throw failure('This passkey was just used in another request. Please sign in again.',401);
    const a=await env.DB.prepare('SELECT * FROM accounts WHERE id=?').bind(key.account_id).first();if(!a)throw failure('Account not found.',401);
    const headers=new Headers({'Cache-Control':'no-store','Content-Type':'application/json'});headers.append('Set-Cookie',await session(env,a,'passkey'));headers.append('Set-Cookie',cookie('__Host-podplane-challenge','',0));return new Response(JSON.stringify({verified:true,redirect:'/app'}),{headers});
  }
  const remove=/^\/api\/auth\/passkeys\/([^/]+)$/.exec(path);
  if(remove&&req.method==='DELETE'){
    csrf(req,env);if(!user)throw failure('Sign in first.',401);if(now()-user.authenticated_at>900)throw failure('Sign in again before removing a passkey.',401);
    await env.DB.prepare('DELETE FROM passkeys WHERE id=? AND account_id=?').bind(remove[1],user.id).run();return response({deleted:true});
  }
  throw failure('Not found',404);
}
