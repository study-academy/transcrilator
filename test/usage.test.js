import {test} from 'node:test';
import assert from 'node:assert/strict';
import {translate} from '../src/translate.js';
import {reportedUsage} from '../src/usage.js';
test('only finite nonnegative reported token counts survive, unknown stays null',()=>{
 assert.equal(reportedUsage(undefined,'chatgpt'),null);
 assert.deepEqual(reportedUsage({input_tokens:10,output_tokens:4,total_tokens:14,secret:'excluded'},'chatgpt'),{inputTokens:10,outputTokens:4,totalTokens:14});
 assert.deepEqual(reportedUsage({input_tokens:0,cache_read_input_tokens:15,cost:99},'claude'),{inputTokens:0,cacheReadInputTokens:15});
 assert.equal(reportedUsage({input_tokens:-1,output_tokens:'12',total_tokens:Infinity},'chatgpt'),null);
});
test('stream records incomplete text and authoritative completed text with actual usage',async()=>{
 const parts=[];
 const output=await translate({text:'Hello',model:'fixture',token:'fake',part:p=>parts.push(p),fetcher:async()=>new Response([
 {type:'response.output_text.delta',delta:'Entwurf'},
 {type:'response.completed',response:{status:'completed',usage:{input_tokens:17,output_tokens:3},output:[{type:'message',content:[{type:'output_text',text:'Fertig'}]}]}}
 ].map(x=>'data: '+JSON.stringify(x)+'\n\n').join(''))});
 assert.equal(output,'Fertig');assert.equal(parts[0].complete,false);assert.equal(parts[0].delta,'Entwurf');
 assert.deepEqual(parts.at(-1),{index:0,text:'Fertig',complete:true,usage:{inputTokens:17,outputTokens:3}});
});
test('failed stream keeps generated partial text and does not invent usage',async()=>{
 const parts=[];
 await assert.rejects(translate({text:'Hello',model:'fixture',token:'fake',part:p=>parts.push(p),fetcher:async()=>new Response('data: {"type":"response.output_text.delta","delta":"Teilantwort"}\n\n')}));
 assert.equal(parts[0].delta,'Teilantwort');assert.equal(parts[0].usage,null);assert.equal(parts[0].complete,false);
});
