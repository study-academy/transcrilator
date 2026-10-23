import {test} from 'node:test';
import http from 'node:http';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,sign} from 'node:crypto';
import {createApp} from '../src/server.js';
async function setup(t,fetcher=async()=>{throw new Error('External call forbidden in disconnected test');}) {
 const path=await mkdtemp(`${tmpdir()}/translator-test-`),runtime=pathToFileURL(`${path}/`);
 const app=await createApp({runtime,fetcher});await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${app.address().port}`;
 t.after(async()=>{app.closeAllConnections();await new Promise(r=>app.close(r));await rm(path,{recursive:true,force:true});});
 const status=await(await fetch(`${origin}/api/status`)).json();
 const post=(url,data={})=>fetch(origin+url,{method:'POST',headers:{Origin:origin,'X-Local-CSRF':status.csrf,'Content-Type':'application/json'},body:JSON.stringify(data)});
 return {app,origin,post,status,path,runtime};
}
test('real HTTP serves UI without auth; translation cannot pretend success; metadata contains only stable host',async t=>{
 const f=await setup(t);assert.equal(f.status.connected,false);assert.equal(f.app.address().address,'127.0.0.1');
 const page=await fetch(f.origin);assert.equal(page.status,200);assert.match(await page.text(),/Continue with ChatGPT/);
 const translation=await f.post('/api/translate',{text:'Hi'});assert.equal(translation.status,400);assert.match((await translation.json()).error,/verbinden/);
 const saved=JSON.parse(await readFile(`${f.path}/host.json`));assert.deepEqual(Object.keys(saved),['hostId']);
 const second=await createApp({runtime:f.runtime});await new Promise(r=>second.listen(0,'127.0.0.1',r));assert.equal(JSON.parse(await readFile(`${f.path}/host.json`)).hostId,saved.hostId);await new Promise(r=>second.close(r));
});
test('cross-origin posts, missing CSRF, hostile Host and private paths rejected',async t=>{
 const f=await setup(t);
 assert.equal((await fetch(f.origin+'/api/connect',{method:'POST'})).status,403);
 assert.equal((await fetch(f.origin+'/api/connect',{method:'POST',headers:{Origin:'https://evil.invalid','X-Local-CSRF':f.status.csrf}})).status,403);
 const hostile=await new Promise((resolve,reject)=>{const req=http.get(f.origin+'/api/status',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
 assert.equal(hostile,403);
 assert.equal((await fetch(f.origin+'/.runtime/host.json')).status,404);
});
test('full mock OAuth through real HTTP, welcome gate, account models, UTF8 long input, response and disconnect',async t=>{
 const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});let nonce,seen=[];
 const fetcher=async(url,options)=>{
  if(url.endsWith('jwks.json'))return Response.json({keys:[{...publicKey.export({format:'jwk'}),kid:'mock'}]});
  if(url.endsWith('/oauth/token')){
   const code=new URLSearchParams(options.body);assert.equal(code.get('client_id'),'oaiapp_mock');
   const head=Buffer.from(JSON.stringify({alg:'RS256',kid:'mock'})).toString('base64url');
   const payload=Buffer.from(JSON.stringify({iss:'https://auth.openai.com',aud:'oaiapp_mock',sub:'mock-user',exp:Date.now()/1000+3600,nonce})).toString('base64url');
   const text=`${head}.${payload}`,jwt=`${text}.${sign('RSA-SHA256',Buffer.from(text),privateKey).toString('base64url')}`;
   return Response.json({access_token:'mock-only',id_token:jwt,token_type:'Bearer',expires_in:3600,scope:'chatgpt.tokens.use.direct resource.invoke'});
  }
  if(url.endsWith('/models'))return Response.json({models:[{slug:'hidden',display_name:'Hidden',visibility:'hidden'},{slug:'mock-model',display_name:'Mock model',visibility:'list'}]});
  const request=JSON.parse(options.body);seen.push(request.input[0].content);
  const output=`Übersetzung ${seen.length} 🙂`;
  return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:output})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:output}]}]}})}\n\n`);
 };
 const f=await setup(t,fetcher);const authorization=new URL((await(await f.post('/api/connect')).json()).url);nonce=authorization.searchParams.get('nonce');
 const callback=new URL('/auth/callback',f.origin);callback.search=new URLSearchParams({code:'mock',state:authorization.searchParams.get('state'),client_id:'oaiapp_mock'}).toString();
 const response=await fetch(callback,{redirect:'manual'});assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/auth/finished');
 assert.equal((await f.post('/api/translate',{})).status,409);
 await f.post('/api/acknowledge');const models=await(await fetch(f.origin+'/api/models')).json();assert.deepEqual(models.models,[{slug:'mock-model',display_name:'Mock model'}]);
 const text='Hello 🙂 café.\n\n'.repeat(1000);
 const translation=await f.post('/api/translate',{text,prompt:'Every detail.',model:'mock-model'});const events=(await translation.text()).trim().split('\n').map(l=>JSON.parse(l));
 assert.equal(events.at(-1).type,'completed');assert.equal(seen.join(''),text);assert.equal(events.at(-1).text,seen.map((_,i)=>`Übersetzung ${i+1} 🙂`).join('\n\n'));
 const status=await(await fetch(f.origin+'/api/status')).text();assert.ok(!status.includes('mock-only'));
 const disk=await readFile(`${f.path}/host.json`,'utf8');assert.ok(!disk.includes('mock-only'));assert.ok(!disk.includes('id_token'));
 await f.post('/api/disconnect');assert.equal((await(await fetch(f.origin+'/api/status')).json()).connected,false);
});

test('Claude provider works through local HTTP without a ChatGPT session and never invokes OpenAI',async t=>{
 const path=await mkdtemp(`${tmpdir()}/translator-provider-test-`),runtime=pathToFileURL(`${path}/`);
 let request,externalCalls=0;
 const app=await createApp({runtime,fetcher:async()=>{externalCalls++;throw new Error('No API fallback');},claude:{inspect:async()=>({installed:true,ready:true,version:'test'}),translate:async data=>{request=data;data.progress({done:1,total:1});return '**Vollständige Übersetzung**';}}});
 await new Promise(resolve=>app.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{app.closeAllConnections();await new Promise(resolve=>app.close(resolve));await rm(path,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${app.address().port}`;
 const state=await(await fetch(origin+'/api/status')).json();assert.equal(state.connected,false);
 assert.equal((await(await fetch(origin+'/api/providers')).json()).claude.ready,true);
 const response=await fetch(origin+'/api/translate',{method:'POST',headers:{Origin:origin,'X-Local-CSRF':state.csrf,'Content-Type':'application/json'},body:JSON.stringify({provider:'claude',text:'Hello',prompt:'Exact user prompt'})});
 const events=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(events.at(-1).type,'completed');assert.equal(events.at(-1).text,'**Vollständige Übersetzung**');
 assert.equal(request.text,'Hello');assert.equal(request.prompt,'Exact user prompt');assert.equal(externalCalls,0);
});
