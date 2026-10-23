import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitText,consumeResponse,translate,MAX_TEXT} from '../src/translate.js';
const delta=text=>({type:'response.output_text.delta',delta:text});
const done=text=>({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}});
const stream=(events,newline='\n')=>events.map(x=>`data: ${JSON.stringify(x)}${newline}${newline}`).join('');
const body=text=>new Response(text).body;
test('short and long input is partitioned without losing a character, changing order or splitting surrogate pairs',()=>{
  for(const text of ['Hello.','First point.\n\nSecond point.','A'.repeat(16001),'🙂é\n'.repeat(4000),'One sentence. Another sentence. '.repeat(1000)]) {
    const parts=splitText(text);
    assert.equal(parts.join(''),text);assert.ok(parts.every(x=>x.length<=6000&&x.length>0));
    assert.ok(parts.every(x=>!/[\uD800-\uDBFF]$/.test(x)));
  }
  assert.deepEqual(splitText('First.\n\nSecond.',10),['First.\n\n','Second.']);
});
test('empty and over-limit inputs fail explicitly instead of truncating',()=>{
  assert.throws(()=>splitText('   '),/eingeben/);assert.throws(()=>splitText('x'.repeat(MAX_TEXT+1)),/nichts abgeschnitten/);
  assert.equal(splitText('x'.repeat(MAX_TEXT)).join('').length,MAX_TEXT);
});
test('only completed matching final text succeeds, fragmented UTF8 and CRLF survive',async()=>{
  const encoded=new TextEncoder().encode(stream([delta('Grüße 🙂'),done('Grüße 🙂')],'\r\n'));
  const fragmented=new ReadableStream({start(controller){for(const x of encoded)controller.enqueue(new Uint8Array([x]));controller.close();}});
  assert.equal(await consumeResponse(fragmented),'Grüße 🙂');
});
for(const [name,events] of [
  ['EOF after delta',[delta('Partial')]], ['done sentinel alone',[]],
  ['incomplete',[delta('Partial'),{type:'response.incomplete'}]], ['failed',[{type:'response.failed'}]],
  ['refusal',[{type:'response.refusal.done'}]], ['API error',[{type:'error'}]],
  ['empty',[done('')]],
  ['missing final output',[delta('A'),{type:'response.completed',response:{status:'completed'}}]],
  ['wrong completion status',[delta('A'),{type:'response.completed',response:{status:'incomplete'}}]],
  ['refusal in final',[delta('A'),{type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]}}]]
])test(`rejects ${name}`,async()=>{await assert.rejects(consumeResponse(body(stream(events))));});
test('malformed event fails',async()=>{await assert.rejects(consumeResponse(body('data: {broken}\n\n')),/Ungültig/);});
test('all long-text chunks are sent exactly once, in order; prompt is separate and result joins all parts',async()=>{
  const text='First point.\n\n'.repeat(900),seen=[],progress=[];
  const result=await translate({text,prompt:'Translate every word.',model:'model-test',token:'fake-test-only',progress:p=>progress.push(p),fetcher:async(url,opts)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');const input=JSON.parse(opts.body);
    assert.equal(input.store,false);assert.equal(input.stream,true);assert.equal(input.instructions,'Translate every word.');
    assert.deepEqual(Object.keys(input).sort(),['input','instructions','model','store','stream']);seen.push(input.input[0].content);
    const out=`Teil ${seen.length}`;return new Response(stream([delta(out),done(out)]));
  }});
  assert.equal(seen.join(''),text);assert.equal(result,seen.map((_,i)=>`Teil ${i+1}`).join('\n\n'));assert.equal(progress.at(-1).done,seen.length);
});
test('later chunk failure rejects whole translation without returning partial output',async()=>{
  let requests=0;await assert.rejects(translate({text:'a'.repeat(13000),model:'test',token:'test',fetcher:async()=>++requests===1?new Response(stream([delta('Erster Teil'),done('Erster Teil')])):new Response('limited',{status:429})}),/Nutzungslimit/);assert.equal(requests,2);
});
for(const code of [401,403,413,429,500])test(`HTTP ${code} is explicit, no retry or fallback`,async()=>{
  let requests=0;await assert.rejects(translate({text:'Hello',token:'test',model:'test',fetcher:async()=>{requests++;return new Response('error',{status:code});}}));assert.equal(requests,1);
});
test('abort stops before the next request',async()=>{const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(translate({text:'Hi',signal:controller.signal,fetcher:()=>{calls++;}}));assert.equal(calls,0);});
test('network timeout rejects translation and is never retried',async()=>{let requests=0;await assert.rejects(translate({text:'Hi',token:'test',model:'test',fetcher:async()=>{requests++;throw new DOMException('Timed out','TimeoutError');}}),{name:'TimeoutError'});assert.equal(requests,1);});
test('completed response is authoritative when streamed deltas differ from finalized text',async()=>{
  const result=await consumeResponse(body(stream([delta('Vorlaufig'),done('Vollständige finale Übersetzung.\n\nZweiter Gedanke.')])));
  assert.equal(result,'Vollständige finale Übersetzung.\n\nZweiter Gedanke.');
});
test('completed final text can arrive without per-token text deltas',async()=>{
  assert.equal(await consumeResponse(body(stream([done('Vollständige Übersetzung.')]))),'Vollständige Übersetzung.');
});

test('completed metadata-only snapshot retains confirmed streamed text',async()=>{
 const completed={type:'response.completed',response:{status:'completed',output:[]}};
 assert.equal(await consumeResponse(body(stream([delta('Vollständiger Text.'),completed]))),'Vollständiger Text.');
});
test('text.done snapshot is used only after completed, in content order',async()=>{
 const a={type:'response.output_text.done',output_index:0,content_index:0,text:'Erster Satz. '};
 const b={type:'response.output_text.done',output_index:0,content_index:1,text:'Zweiter Satz.'};
 const completed={type:'response.completed',response:{status:'completed',output:[]}};
 assert.equal(await consumeResponse(body(stream([b,a,completed]))),'Erster Satz. Zweiter Satz.');
 await assert.rejects(consumeResponse(body(stream([a,b]))));
});
