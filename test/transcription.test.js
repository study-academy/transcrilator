import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const quality=readFileSync(new URL('../public/transcript-quality.js',import.meta.url),'utf8');
const worker=readFileSync(new URL('../public/transcribe-worker.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'');
test('explicit German uses multilingual q8 locally, English retains its GPU path; model switch disposes previous pipeline',async()=>{
 const calls=[],outputs=[],generation=[];let disposed=0;
 const context=vm.createContext({Float32Array,URL,self:{location:{origin:'http://127.0.0.1:1234'}},env:{backends:{onnx:{wasm:{}}}},navigator:{gpu:{requestAdapter:async()=>({})}},postMessage:item=>outputs.push(item),
 pipeline:async(task,model,options)=>{calls.push({task,model,options});const asr=async(audio,options)=>{generation.push(options);return {text:options.language==='german'?'Guten Tag.':'Hello.'};};asr.dispose=async()=>disposed++;return asr;}});
 vm.runInContext(quality,context);vm.runInContext(worker,context);
 for(const language of ['de','de','en'])await context.self.onmessage({data:{type:'transcribe',language,audio:new Float32Array(16000)}});
 assert.equal(calls.length,2);assert.equal(disposed,1);
 assert.equal(calls[0].model,'onnx-community/whisper-small');assert.equal(calls[0].options.device,'wasm');assert.equal(calls[0].options.dtype,'q8');
 assert.equal(generation[0].language,'german');assert.equal(generation[0].task,'transcribe');
 assert.equal(calls[1].model,'onnx-community/whisper-small.en');assert.equal(calls[1].options.device,'webgpu');assert.equal(generation[2].language,undefined);
 assert.deepEqual(outputs.filter(x=>x.type==='done').map(x=>x.metadata.language),['de','de','en']);
 await context.self.onmessage({data:{type:'transcribe',language:'fr',audio:new Float32Array(1)}});
 assert.match(outputs.at(-1).error,/Deutsch oder Englisch/);assert.equal(calls.length,2);
});
