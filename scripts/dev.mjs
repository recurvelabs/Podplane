// Local preview only. The deployed entrypoint is worker/index.js.
import http from 'node:http';
import {pathToFileURL} from 'node:url';
const portIndex=process.argv.indexOf('--port');
const port=Number(portIndex>=0?process.argv[portIndex+1]:process.env.PORT||process.env.SITES_PREVIEW_PORT||3000);
http.createServer(async(req,res)=>{
  try{
    const host=req.headers.host||'localhost';const url=new URL(req.url,`http://${host}`);
    if(url.pathname==='/__mobile'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Mobile layout check</title><body style="margin:0;background:#d8dcd0;display:grid;place-items:center;padding:20px"><iframe title="Mobile Podplane preview" src="'+(url.searchParams.get('view')==='app'?'/app':'/')+'" style="width:390px;height:844px;border:0;border-radius:16px;box-shadow:0 10px 40px #0002"></iframe></body>');return;}
    const mod=await import(pathToFileURL(process.cwd()+'/worker/index.js')+'?t='+Date.now());
    const headers=new Headers();for(const [key,v] of Object.entries(req.headers)){if(v)headers.set(key,Array.isArray(v)?v.join(','):v);}
    if(url.pathname==='/app'||url.pathname.startsWith('/api/')){headers.set('oai-authenticated-user-id','local-preview');headers.set('oai-authenticated-user-email','preview@example.com');}
    if(url.pathname==='/api/dashboard'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({feed_url:'https://podplane.example/private-feed',max_shows:5,shows:[],episodes:[]}));return;}
    const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
    if(url.pathname==='/api/catalog'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({podcasts:[],shared:true}));return;}
    const result=await mod.default.fetch(new Request(url,{method:req.method,headers,...(body.length?{body,duplex:'half'}:{})}),{PODPLANE_NATIVE_AUTH:true,PODPLANE_USER:url.pathname==='/app'||url.pathname==='/settings'?{id:'local-preview',email:'preview@example.com'}:null});
    res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
  }catch(e){res.writeHead(500);res.end('Preview failed: '+e.message);}
}).listen(port,'0.0.0.0',()=>console.log(`Podplane preview listening on ${port}`));
