import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {splitText,translate} from '../src/translate.js';
let source;
try{source=await readFile(new URL('../user-test/source.txt',import.meta.url),'utf8');}catch(e){if(e.code!=='ENOENT')throw e;}
test('attached user source: exact chunk reconstruction and ordered complete transport through synthetic inference',{skip:!source},async()=>{
 const chunks=splitText(source),seen=[];
 assert.equal(chunks.join(''),source);
 const output=await translate({text:source,model:'synthetic-only',token:'synthetic-only',fetcher:async(url,options)=>{
  const request=JSON.parse(options.body),input=request.input[0].content;seen.push(input);
  // Distinct fixed markers stand in for each translation, independently verifying assembly order.
  const text=`[Ergebnis für Teil ${seen.length}]`;
  return new Response(`data: ${JSON.stringify({type:'response.output_text.delta',delta:text})}\n\ndata: ${JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}]}})}\n\n`);
 }});
 assert.equal(seen.join(''),source);assert.equal(seen.length,chunks.length);
 assert.equal(output,chunks.map((_,i)=>`[Ergebnis für Teil ${i+1}]`).join('\n\n'));
 let position=0;
 const manifest={sourceBytes:Buffer.byteLength(source),sourceCharacters:source.length,unicodeCodePoints:[...source].length,words:source.trim().split(/\s+/u).length,paragraphs:source.split(/\r?\n\s*\r?\n/).filter(x=>x.trim()).length,sha256:createHash('sha256').update(source).digest('hex'),chunks:chunks.map((text,i)=>{const part={index:i+1,start:position,end:position+text.length,characters:text.length,sha256:createHash('sha256').update(text).digest('hex')};position+=text.length;return part;}),losslessReconstruction:true,orderedMockTransport:true,liveInferenceTested:false,semanticCompletenessVerified:false};
 await writeFile(new URL('../user-test/source-check.json',import.meta.url),JSON.stringify(manifest,null,2)+'\n');
});
