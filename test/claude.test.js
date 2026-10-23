import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,access} from 'node:fs/promises';
import {ClaudePlan,claudeEnvironment} from '../src/claude.js';
import {DEFAULT_PROMPT,splitText} from '../src/translate.js';
const help='--safe-mode --tools --disallowedTools --strict-mcp-config --mcp-config --no-session-persistence --output-format --system-prompt --model --permission-prompts --no-chrome';
function fixture({auth={loggedIn:true,authMethod:'claude.ai'},helpText=help,result,missing=false}={}) {
 const calls=[];
 const adapter=new ClaudePlan({environment:{PATH:'/native',HOME:'/fake-home',ANTHROPIC_API_KEY:'must-not-pass',CLAUDE_CODE_OAUTH_TOKEN:'must-not-pass',AWS_SECRET_ACCESS_KEY:'must-not-pass',OPENAI_API_KEY:'must-not-pass'},run:async(executable,args,options)=>{
  calls.push({executable,args,options});assert.deepEqual(await readdir(options.cwd),[]);
  if(missing)throw Object.assign(new Error('missing'),{code:'ENOENT'});
  if(args[0]==='--version')return {code:0,stdout:'2.1.270 (Claude Code)'};
  if(args[0]==='--help')return {code:0,stdout:helpText};
  if(args.includes('status'))return {code:auth.loggedIn?0:1,stdout:JSON.stringify(auth)};
  const number=calls.filter(call=>call.args.includes('-p')).length;
  return result?result(number,options.input,options.signal):{code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:`Teil ${number}`})};
 }});
 return {adapter,calls};
}
test('only native claude.ai login is eligible; API and missing logins never infer',async()=>{
 for(const auth of [{loggedIn:false,authMethod:'none'},{loggedIn:true,authMethod:'api_key'},{loggedIn:true,authMethod:'oauth_token'},{loggedIn:true,authMethod:'third_party'}]) {
  const f=fixture({auth});await assert.rejects(f.adapter.translate({text:'Hello'}));assert.equal(f.calls.some(c=>c.args.includes('-p')),false);
 }
});
test('missing CLI and missing isolation fail closed without inference',async()=>{
 for(const options of [{missing:true},{helpText:'--tools --output-format'}]) {
  const f=fixture(options);assert.equal((await f.adapter.inspect()).ready,false);assert.equal(f.calls.some(c=>c.args.includes('-p')),false);
 }
});
test('billing credentials and configuration overrides are absent from child environment',()=>{
 assert.deepEqual(claudeEnvironment({PATH:'/bin',HOME:'/home',ANTHROPIC_API_KEY:'x',CLAUDE_CODE_USE_BEDROCK:'1',CLAUDE_CONFIG_DIR:'/other',CLAUDE_CODE_OAUTH_TOKEN:'x',AWS_ACCESS_KEY_ID:'x'}),{PATH:'/bin',HOME:'/home'});
});
test('long source passes unchanged via stdin, exact prompt separately, tools off and temporary cwd cleaned',async()=>{
 const text='$(touch NEVER_EXECUTE) [Music] '.repeat(300),chunks=splitText(text);
 const f=fixture({result:(_,input)=>({code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:`Teil ${chunks.indexOf(input)+1}`})})});
 const output=await f.adapter.translate({text,prompt:DEFAULT_PROMPT});
 const calls=f.calls.filter(c=>c.args.includes('-p'));
 assert.ok(calls.length>1);assert.deepEqual(calls.map(c=>c.options.input).sort(),[...chunks].sort());
 assert.equal(output,chunks.map((_,i)=>`Teil ${i+1}`).join('\n\n'));
 for(const call of calls) {
  assert.equal(call.args.includes(text),false);assert.equal(call.args[call.args.indexOf('--tools')+1],'');
  assert.equal(call.args[call.args.indexOf('--system-prompt')+1],DEFAULT_PROMPT);
  assert.ok(call.args.includes('--safe-mode'));assert.ok(call.args.includes('--no-session-persistence'));
  assert.equal(call.args.includes('--bare'),false);assert.equal(call.args.includes('--dangerously-skip-permissions'),false);
  assert.equal(call.options.env.ANTHROPIC_API_KEY,undefined);assert.equal(call.options.env.CLAUDE_CODE_OAUTH_TOKEN,undefined);
  await assert.rejects(access(call.options.cwd));
 }
});
for(const [name,result] of [
 ['malformed',{code:0,stdout:'not json'}],['nonzero',{code:1,stdout:'{}'}],
 ['failed',{code:0,stdout:JSON.stringify({type:'result',subtype:'error_during_execution',is_error:true,result:'partial'})}],
 ['empty',{code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:''})}],
 ['truncated',{code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:'partial',stop_reason:'max_tokens'})}]
])test(`Claude ${name} rejects without fallback`,async()=>{const f=fixture({result:()=>result});await assert.rejects(f.adapter.translate({text:'Hello'}));assert.equal(f.calls.filter(c=>c.args.includes('-p')).length,1);});
test('cancelled Claude request never starts a subprocess',async()=>{const f=fixture(),c=new AbortController();c.abort();await assert.rejects(f.adapter.translate({text:'Hello',signal:c.signal}));assert.equal(f.calls.length,0);});
test('parallel Claude chunks keep source order, cap concurrency and report progress',async()=>{
 const text=Array.from({length:1200},(_,i)=>`Sentence ${i} is here. `).join(''),chunks=splitText(text);let active=0,peak=0;const progress=[];
 const f=fixture({result:async(_,input)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(chunks.length-chunks.indexOf(input))*3));active--;return {code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:`T${chunks.indexOf(input)}`})};}});
 assert.ok(chunks.length>3);
 const output=await f.adapter.translate({text,progress:p=>progress.push(p.done)});
 assert.equal(output,chunks.map((_,i)=>`T${i}`).join('\n\n'));assert.equal(peak,3);
 assert.deepEqual(progress,Array.from({length:chunks.length+1},(_,i)=>i));
});
test('one failed parallel chunk aborts siblings and returns no partial translation',async()=>{
 const text=Array.from({length:1200},(_,i)=>`Sentence ${i} is here. `).join(''),chunks=splitText(text);const aborted=[];
 const f=fixture({result:async(_,input,signal)=>{
  if(chunks.indexOf(input)===1)return {code:1,stdout:'{}'};
  await new Promise(r=>{const t=setTimeout(r,200);signal.addEventListener('abort',()=>{clearTimeout(t);aborted.push(chunks.indexOf(input));r();},{once:true});});
  return {code:0,stdout:JSON.stringify({type:'result',subtype:'success',is_error:false,result:'ok'})};
 }});
 await assert.rejects(f.adapter.translate({text}),/nicht vollständig/);
 assert.ok(aborted.length>=1);assert.ok(f.calls.filter(c=>c.args.includes('-p')).length<chunks.length);
});
