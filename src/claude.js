import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {splitText,DEFAULT_PROMPT} from './translate.js';
const REQUIRED=['--safe-mode','--tools','--disallowedTools','--strict-mcp-config','--mcp-config','--no-session-persistence','--output-format','--system-prompt','--model','--permission-prompts','--no-chrome'];
const ENV_KEYS=['PATH','HOME','USER','LOGNAME','TMPDIR','LANG','LC_ALL','SHELL','SystemRoot','WINDIR','APPDATA','LOCALAPPDATA','USERPROFILE'];
export function claudeEnvironment(source=process.env){return Object.fromEntries(ENV_KEYS.filter(key=>source[key]!==undefined).map(key=>[key,source[key]]));}
function runCommand(executable,args,{cwd,env,input='',signal,timeout=15000}) {
  return new Promise((resolve,reject)=>{
    signal?.throwIfAborted();
    const child=spawn(executable,args,{cwd,env,shell:false,stdio:['pipe','pipe','ignore'],windowsHide:true});
    let stdout='',failure=null,forceTimer;
    const stop=error=>{failure ||= error;child.kill('SIGTERM');forceTimer ||= setTimeout(()=>child.kill('SIGKILL'),1000);};
    const timer=setTimeout(()=>stop(new DOMException('Claude-Zeitlimit erreicht.','TimeoutError')),timeout);
    const abort=()=>stop(new DOMException('Abgebrochen.','AbortError'));
    signal?.addEventListener('abort',abort,{once:true});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',part=>{stdout+=part;if(stdout.length>1_000_000)stop(new Error('Claude-Antwort überschreitet die sichere Grenze.'));});
    child.stdin.on('error',()=>{});
    child.on('error',error=>{failure=Object.assign(new Error(error.code==='ENOENT'?'Claude Code ist nicht installiert.':'Claude Code konnte nicht gestartet werden.'),{code:error.code});});
    child.on('close',code=>{
      clearTimeout(timer);clearTimeout(forceTimer);signal?.removeEventListener('abort',abort);
      if(failure)reject(failure);else resolve({code,stdout});
    });
    if(signal?.aborted)abort();
    child.stdin.end(input);
  });
}
export class ClaudePlan {
  constructor({run=runCommand,environment=process.env,executable='claude'}={}) {
    this.run=run;this.env=claudeEnvironment(environment);this.executable=executable;this.capabilities=null;
  }
  async inEmptyDirectory(callback) {
    const cwd=await mkdtemp(`${tmpdir()}/local-translator-claude-`);
    try{return await callback(cwd);}finally{await rm(cwd,{recursive:true,force:true});}
  }
  async inspect({signal}={}) {
    signal?.throwIfAborted();
    try {
      return await this.inEmptyDirectory(async cwd=>{
        if(!this.capabilities) {
          const version=await this.run(this.executable,['--version'],{cwd,env:this.env,signal});
          const help=await this.run(this.executable,['--help'],{cwd,env:this.env,signal});
          const match=version.stdout.match(/^\d+\.\d+\.\d+/);
          if(version.code!==0 || help.code!==0 || !match)return {installed:true,ready:false,reason:'CLI-Prüfung fehlgeschlagen.'};
          this.capabilities={version:match[0],safe:REQUIRED.every(flag=>help.stdout.includes(flag))};
        }
        if(!this.capabilities.safe)return {installed:true,version:this.capabilities.version,ready:false,reason:'Diese Claude-Code-Version unterstützt die erforderliche Isolation nicht. Bitte Claude Code selbst aktualisieren.'};
        const response=await this.run(this.executable,['--safe-mode','auth','status'],{cwd,env:this.env,signal});
        let auth;try{auth=JSON.parse(response.stdout);}catch{return {installed:true,version:this.capabilities.version,ready:false,reason:'Claude-Anmeldestatus konnte nicht geprüft werden.'};}
        const ready=response.code===0 && auth.loggedIn===true && auth.authMethod==='claude.ai';
        return {installed:true,version:this.capabilities.version,ready,loggedIn:auth.loggedIn===true,authMethod:['none','claude.ai','oauth_token','api_key','api_key_helper','third_party'].includes(auth.authMethod)?auth.authMethod:'unavailable',reason:ready?'Eigener Claude-Plan über lokales Claude Code.':'Bitte in Claude Code selbst mit deinem Claude-Plan anmelden: claude auth login. API-/Cloud-Zugänge werden hier nicht verwendet.'};
      });
    } catch(error) {
      if(error.name==='AbortError')throw error;
      return {installed:error.code!=='ENOENT',ready:false,reason:error.code==='ENOENT'?'Claude Code separat von Anthropic installieren und persönlich mit dem eigenen Claude-Plan anmelden.':'Claude Code konnte nicht sicher geprüft werden. Bitte Installation und Anmeldung im Terminal prüfen.'};
    }
  }
  async translate({text,prompt=DEFAULT_PROMPT,signal,progress=()=>{}}) {
    const chunks=splitText(text);
    if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw new Error('Ungültiger Prompt.');
    const availability=await this.inspect({signal});
    if(!availability.ready)throw new Error(availability.reason);
    const result=[];
    for(let index=0;index<chunks.length;index++) {
      signal?.throwIfAborted();progress({done:index,total:chunks.length});
      const response=await this.inEmptyDirectory(cwd=>this.run(this.executable,[
        '-p','--safe-mode','--tools','','--disallowedTools','mcp__*','--strict-mcp-config','--mcp-config','{"mcpServers":{}}',
        '--no-session-persistence','--no-chrome','--permission-prompts','none','--output-format','json','--model','sonnet','--system-prompt',prompt
      ],{cwd,env:this.env,input:chunks[index],signal,timeout:180000}));
      let data;try{data=JSON.parse(response.stdout);}catch{throw new Error('Claude Code hat keine gültige vollständige JSON-Antwort geliefert.');}
      if(response.code!==0 || data.type!=='result' || data.subtype!=='success' || data.is_error!==false || typeof data.result!=='string' || !data.result.trim() || data.result.length>200000 || data.permission_denials?.length || data.stop_reason==='max_tokens') {
        const message=typeof data.result==='string'?data.result:'';
        const category=/usage.?limit|rate.?limit|limit reached|hit your limit|resets/i.test(message)?'usage_limit':/unknown option|unsupported option|invalid.*(?:argument|option|flag)/i.test(message)?'cli_options':/api.?key|billing|credit/i.test(message)?'billing':/not logged|log.?in|authentication|oauth/i.test(message)?'authentication':/permission|denied/i.test(message)?'policy':/network|connection|ENOTFOUND|fetch failed/i.test(message)?'network':'incomplete_result';
        const error=new Error(category==='usage_limit'?'Claude-Planlimit erreicht. Bitte die Nutzung direkt in Claude Code prüfen. Keine API-Ausweichroute verwendet.':'Claude Code hat diesen Teil nicht vollständig abgeschlossen. Bitte Planlimit oder Anmeldung im offiziellen CLI prüfen. Keine API-Ausweichroute verwendet.');
        error.diagnostics={exitCode:response.code,category,resultType:data.type==='result'?'result':'other',successSubtype:data.subtype==='success',isError:data.is_error===true,resultCharacters:message.length,permissionDenials:Array.isArray(data.permission_denials)?data.permission_denials.length:0};
        throw error;
      }
      result.push(data.result.trim());progress({done:index+1,total:chunks.length});
    }
    return result.join('\n\n');
  }
}
