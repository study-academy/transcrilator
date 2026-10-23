// Disposable browser fixture. Never contacts OpenAI or uses real credentials.
import {createApp} from '../src/server.js';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
let nonce;
const runtime=await mkdtemp(`${tmpdir()}/translator-browser-mock-`);
const app=await createApp({runtime:pathToFileURL(runtime+'/'),claude:{inspect:async()=>({ready:false,reason:'Isolierte Testfixture: kein Claude-Zugang.'}),translate:async()=>{throw new Error('Kein Claude in dieser Testfixture.');}},fetcher:async(url,options)=>{
 if(url.endsWith('jwks.json'))return Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'fixture'}]});
 if(url.endsWith('/oauth/token')){
  const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'fixture'})).toString('base64url');
  const payload=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_fixture',sub:'synthetic-fixture',exp:Date.now()/1000+3600,nonce})).toString('base64url');
  const text=`${head}.${payload}`;
  return Response.json({access_token:'SYNTHETIC_FIXTURE_ONLY',id_token:`${text}.${sign('RSA-SHA256',Buffer.from(text),privateKey).toString('base64url')}`,token_type:'Bearer',expires_in:3600,scope:'chatgpt.tokens.use.direct resource.invoke'});
 }
 if(url.endsWith('/models'))return Response.json({models:[{slug:'fixture',display_name:'Testfixture (keine KI)',visibility:'list'}]});
 if(url!=='https://api.openai.com/v1/responses')throw new Error('Network prohibited');
 const input=JSON.parse(options.body).input[0].content;
 if(input==='FAIL')return new Response('Limit',{status:429});
 if(input==='CUT')return new Response('data: {"type":"response.output_text.delta","delta":"Unvollständig"}\n\n');
 if(input==='SLOW')await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,10000);options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new DOMException('Aborted','AbortError'));},{once:true});});
 const output=input==='FORMAT'?'**Vorhandene Überschrift**\n\nEin *wertvolles Konzept* mit <img src=x onerror=alert(1)> und <script>alert(1)</script>.':'Hallo.\n\nDer zweite Punkt bleibt hier.';
 return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:output})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}})}\n\n`);
}});
await new Promise(resolve=>app.listen(4318,'127.0.0.1',resolve));
const origin='http://127.0.0.1:4318';
const {csrf}=await(await fetch(origin+'/api/status')).json();
const authorization=new URL((await(await fetch(origin+'/api/connect',{method:'POST',headers:{Origin:origin,'X-Local-CSRF':csrf}})).json()).url);
nonce=authorization.searchParams.get('nonce');
const callback=new URL('/auth/callback',origin);callback.search=new URLSearchParams({state:authorization.searchParams.get('state'),code:'synthetic',client_id:'oaiapp_fixture'});
await fetch(callback,{redirect:'manual'});
console.log('Browser testfixture only: '+origin);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{app.closeAllConnections();app.close();await rm(runtime,{recursive:true,force:true});process.exit(0);});
