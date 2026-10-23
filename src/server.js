import http from 'node:http';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChatGPTConnection } from './auth.js';
import { ClaudePlan } from './claude.js';
import { translate, DEFAULT_PROMPT, MAX_TEXT, apiError } from './translate.js';
const root = new URL('../',import.meta.url);
// The only files the browser may load. Local transcription adds a worker and the vendored ONNX runtime.
const STATIC={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/transcribe-worker.js':'transcribe-worker.js',
  '/vendor/transformers.min.js':'vendor/transformers.min.js','/vendor/ort-wasm-simd-threaded.asyncify.mjs':'vendor/ort-wasm-simd-threaded.asyncify.mjs',
  '/vendor/ort-wasm-simd-threaded.asyncify.wasm':'vendor/ort-wasm-simd-threaded.asyncify.wasm'};
const TYPES={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',wasm:'application/wasm'};
// The Whisper model is fetched once from Hugging Face; WebAssembly needs 'wasm-unsafe-eval', and the
// ONNX runtime imports its own loader from a same-origin blob: copy inside the worker.
const MODEL_HOSTS='https://huggingface.co https://*.huggingface.co https://*.hf.co';
// Opens the official Claude Code sign-in in the user's own Terminal; the app never sees the login.
// Only macOS is supported; elsewhere the user runs the command themselves.
export function openClaudeLogin() {
  if(process.platform!=='darwin')return false;
  const child=spawn('osascript',['-e','tell application "Terminal" to activate','-e','tell application "Terminal" to do script "claude auth login --claudeai"'],{stdio:'ignore',detached:true});
  child.on('error',()=>{});child.unref();
  return true;
}
export async function createApp({fetcher=fetch, runtime=new URL('.runtime/',root),claude=new ClaudePlan(),claudeLogin=openClaudeLogin}={}) {
  await mkdir(runtime,{recursive:true,mode:0o700});
  const metadata=new URL('host.json',runtime);
  let saved;
  try { saved=JSON.parse(await readFile(metadata,'utf8')); } catch(e) { if(e.code!=='ENOENT') throw e; saved={hostId:`urn:uuid:${randomUUID()}`}; }
  if (!/^urn:uuid:[a-f0-9-]{36}$/.test(saved.hostId)) throw new Error('Ungültige Host-Konfiguration.');
  const persist=async () => { const tmp=new URL('host.json.tmp',runtime); await writeFile(tmp,JSON.stringify(saved),{mode:0o600}); await rename(tmp,metadata); };
  await persist();
  const auth=new ChatGPTConnection({hostId:saved.hostId,registration:saved.registration,fetcher,saveRegistration:async registration=>{saved.registration=registration;await persist();}});
  const csrf=randomBytes(32).toString('hex');
  let busy=false, active=null, catalog=[];
  const app=http.createServer(async (req,res)=>{
    const origin=`http://127.0.0.1:${app.address().port}`;
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',`default-src 'self'; connect-src 'self' ${MODEL_HOSTS}; script-src 'self' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    try {
      if(req.headers.host !== new URL(origin).host) return json(403,{error:'Ungültiger Host.'});
      const url=new URL(req.url,origin);
      if(req.headers.origin && req.headers.origin!==origin) return json(403,{error:'Fremder Ursprung blockiert.'});
      if(req.method==='POST' && (req.headers.origin!==origin || req.headers['x-local-csrf']!==csrf)) return json(403,{error:'Ungültige lokale Anfrage.'});
      if(req.method==='GET' && Object.hasOwn(STATIC,url.pathname)) {
        const name=STATIC[url.pathname];
        const data=await readFile(new URL(`public/${name}`,root));
        res.writeHead(200,{'Content-Type':TYPES[name.split('.').pop()]}); return res.end(data);
      }
      if(req.method==='GET' && url.pathname==='/auth/finished') {res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><html lang="de"><meta charset="utf-8"><title>ChatGPT-Verbindung</title><p>Die Anmeldung ist beendet. Dieses Fenster schließen und zum Übersetzer zurückkehren.</p></html>');}
      if(req.method==='GET' && url.pathname==='/api/providers') return json(200,{claude:await claude.inspect()});
      if(req.method==='GET' && url.pathname==='/api/status') return json(200,{...auth.status(),csrf,defaultPrompt:DEFAULT_PROMPT,maxText:MAX_TEXT});
      if(req.method==='GET' && url.pathname==='/auth/callback') {
        try { await auth.callback(url.searchParams); } catch { auth.lastError='ChatGPT-Verbindung fehlgeschlagen oder abgelehnt. Bitte erneut ausdrücklich verbinden.'; }
        res.writeHead(303,{Location:'/auth/finished'}); return res.end();
      }
      if(req.method==='POST' && url.pathname==='/api/connect') { if(busy) return json(409,{error:'Übersetzung läuft.'}); return json(200,{url:auth.start(`${origin}/auth/callback`)}); }
      if(req.method==='POST' && url.pathname==='/api/claude/login') { if(busy) return json(409,{error:'Übersetzung läuft.'}); return json(200,{opened:claudeLogin()}); }
      if(req.method==='POST' && url.pathname==='/api/acknowledge') { await auth.acknowledge(); return json(200,{ok:true}); }
      if(req.method==='POST' && url.pathname==='/api/disconnect') { active?.abort(); auth.disconnect(); catalog=[]; return json(200,{ok:true}); }
      if(req.method==='GET' && url.pathname==='/api/models') {
        const response=await fetcher('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${auth.token()}`},signal:AbortSignal.timeout(20000)});
        if(!response.ok) {await response.body?.cancel();if(response.status===401)auth.disconnect();throw new Error(apiError(response.status));}
        const body=await response.json();
        catalog=(body.models || []).filter(m=>m.visibility==='list' && typeof m.slug==='string' && typeof m.display_name==='string').map(m=>({slug:m.slug,display_name:m.display_name}));
        if(!catalog.length) throw new Error('Für dieses Konto ist kein Modell verfügbar.');
        return json(200,{models:catalog});
      }
      if(req.method==='POST' && url.pathname==='/api/translate') {
        if(busy) return json(409,{error:'Eine Übersetzung läuft bereits.'});
        const parts=[]; let bytes=0;
        for await(const part of req) { bytes+=part.length; if(bytes>3_100_000) return json(413,{error:'Anfrage zu groß. Es wurde nichts abgeschnitten.'}); parts.push(part); }
        let data; try {data=JSON.parse(Buffer.concat(parts).toString('utf8'));} catch { return json(400,{error:'Ungültige Anfrage.'}); }
        const provider=data.provider ?? 'chatgpt';
        if(!['chatgpt','claude'].includes(provider))return json(400,{error:'Unbekannter Anbieter.'});
        let token;
        if(provider==='chatgpt') {
          token=auth.token();
          if(auth.welcome)return json(409,{error:'Bitte zuerst die ChatGPT-Plannutzung bestätigen.'});
        }
        if(typeof data.text!=='string' || typeof data.prompt!=='string' || !data.prompt.trim() || data.prompt.length>12000 || (provider==='chatgpt' && !catalog.some(m=>m.slug===data.model)))return json(400,{error:'Text, Prompt oder Modellauswahl ungültig.'});
        if(busy)return json(409,{error:'Eine Übersetzung läuft bereits.'});
        busy=true; active=new AbortController(); const controller=active;
        res.on('close',()=>controller.abort());
        res.writeHead(200,{'Content-Type':'application/x-ndjson; charset=utf-8'});
        const send=data=>{if(!res.destroyed)res.write(JSON.stringify(data)+'\n');};
        try {
          const request={text:data.text,prompt:data.prompt,signal:controller.signal,progress:p=>send({type:'progress',...p})};
          const output=provider==='claude'?await claude.translate(request):await translate({...request,model:data.model,token,fetcher});
          send({type:'completed',text:output});
        } catch(e) { if(provider==='chatgpt' && e.status===401)auth.disconnect(); send({type:'error',error:e.name==='TimeoutError'?'Zeitlimit erreicht. Keine vollständige Übersetzung erstellt.':e.name==='AbortError'?'Übersetzung abgebrochen.':e.message==='fetch failed'?'Verbindung zu OpenAI fehlgeschlagen.':e.message}); }
        finally {busy=false;active=null;res.end();} return;
      }
      return json(404,{error:'Nicht gefunden.'});
    } catch(e) { if(!res.headersSent)json(400,{error:e.message==='fetch failed'?'OpenAI ist nicht erreichbar.':e.message}); else res.end(); }
  });
  app.requestTimeout=30000;
  return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT || 4317);
  if(!Number.isInteger(port)||port<1024||port>65535) throw new Error('PORT muss zwischen 1024 und 65535 liegen.');
  const app=await createApp();
  app.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} ist belegt. Anderen PORT wählen.`:'Lokaler Server konnte nicht starten.');process.exitCode=1;});
  app.listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}`));
  for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{app.closeAllConnections();app.close(()=>process.exit(0));});
}
