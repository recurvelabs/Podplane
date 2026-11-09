import website from '../worker/index.js';
import {internal,publicFeed,tick,EpisodeWorkflow} from './index.js';
import {currentUser,authRoute} from './auth.js';
import {catalog,directorySearch,seedCatalog,importChartCatalog} from './catalog.js';
import passkeyClient from './generated/passkeys.js';
export {EpisodeWorkflow};
const noStore={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'};
function fail(message,status=400){return Object.assign(new Error(message),{status});}
export default {
  async fetch(req,env){
    try{
      const url=new URL(req.url);
      if(url.origin!==env.PUBLIC_ORIGIN)return new Response(null,{status:308,headers:{Location:env.PUBLIC_ORIGIN+url.pathname+url.search,...noStore}});
      if(url.pathname==='/health')return Response.json({ok:true,service:'Podplane',environment:'staging'},{headers:noStore});
      if(url.pathname.startsWith('/f/'))return await publicFeed(req,env,url);
      if(url.pathname==='/assets/passkeys.js')return new Response(passkeyClient,{headers:{'Content-Type':'application/javascript; charset=utf-8','Cache-Control':'public, max-age=3600','X-Content-Type-Options':'nosniff'}});
      if(url.pathname.startsWith('/admin/')){
        if(req.headers.get('Authorization')!==`Bearer ${env.INTERNAL_SECRET}`)throw fail('Not found',404);
        if(url.pathname==='/admin/catalog/seed'&&req.method==='POST')return Response.json(await seedCatalog(env,(await req.json()).feeds));
        if(url.pathname==='/admin/catalog/import'&&req.method==='POST')return Response.json(await importChartCatalog(env,await req.json()));
        throw fail('Not found',404);
      }
      if(url.pathname.startsWith('/internal/'))throw fail('Not found',404);
      const user=await currentUser(req,env);
      if(url.pathname.startsWith('/auth/')||url.pathname.startsWith('/api/auth/')){const r=await authRoute(req,env,url,user);if(r)return r;}
      if(url.pathname==='/api/catalog'&&req.method==='GET')return await catalog(env,url,user);
      if(url.pathname.startsWith('/api/')){
        if(!user)throw fail('Sign in to open your library.',401);
        if(!['GET','HEAD'].includes(req.method)&&req.headers.get('Origin')!==env.PUBLIC_ORIGIN)throw fail('Request origin rejected.',403);
        if(url.pathname==='/api/search'&&req.method==='GET')return await directorySearch(env,url);
        const headers=new Headers({'Authorization':'Bearer '+env.INTERNAL_SECRET,'X-Podplane-Subject':user.subject,'Content-Type':'application/json'});
        const text=['GET','HEAD'].includes(req.method)?undefined:await req.text();if(text?.length>12000)throw fail('Request too large',413);
        const target=new URL(url);target.pathname=url.pathname.replace('/api/','/internal/');
        return await internal(new Request(target,{method:req.method,headers,body:text}),env,target);
      }
      const response=await website.fetch(req,{...env,PODPLANE_NATIVE_AUTH:true,PODPLANE_USER:user?{id:user.id,email:user.email,unlimited:!!user.unlimited}:null});
      const headers=new Headers(response.headers);for(const [key,value] of Object.entries(noStore))headers.set(key,value);return new Response(response.body,{status:response.status,headers});
    }catch(error){
      const url=new URL(req.url);if(url.pathname.startsWith('/auth/')&&!url.pathname.startsWith('/auth/logout'))return Response.redirect(env.PUBLIC_ORIGIN+'/signin?error='+encodeURIComponent(error.status?error.message:'Sign-in could not be completed. Please try again.'),303);
      return Response.json({error:error.status?error.message:'The service could not complete this request. Please try again.'},{status:error.status||500,headers:noStore});
    }
  },
  async scheduled(event,env,ctx){ctx.waitUntil(tick(env));}
};
