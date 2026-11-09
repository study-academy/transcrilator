import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const app=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const slice=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end));
class Element {
  constructor(){this.children=[];this.hidden=false;this.disabled=false;this.textContent='';this.value='';this.open=false;}
  focus(){}
  scrollIntoView(){}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
}
function fixture(entries=[]) {
  const nodes={},storage=new Map([['translator.history',JSON.stringify(entries)]]),messages=[];
  const context=vm.createContext({console,crypto,DOMException,AbortController,Float32Array,Number,Math,Uint8Array,TextDecoder,
    $:id=>nodes[id] ||= new Element(), document:{createElement:()=>new Element()},
    localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
    status:(...args)=>messages.push(args),scriptLength:tab=>({seconds:tab.mediaSeconds||10}),formatOf:()=> 'long',clock:String,
    payloadFor:x=>x,writeClipboard:async()=>{},toast:()=>{},render:()=>{},renderDots:()=>{},update:()=>{},init:()=>{},
    finished:()=>{},copy:()=>{},jobPhase:()=>{},LISTEN_PHRASES:[],PHRASES:[],REFINE_PHRASES:[],refinePrompt:'Aufbereiten',textLanguage:()=>null,copiedMessage:()=>'',jobStep:()=>{},job:{},busy:false,running:false,connected:false,
    provider:'chatgpt',claudeState:null,cur:()=>context.tab,tabs:[],jobController:null});
  vm.runInContext(readFileSync(new URL('../public/transcript-quality.js',import.meta.url),'utf8'),context);
  vm.runInContext(slice('// History details','// Progress veil:'),context);
  const rows=()=>{vm.runInContext('renderHistory()',context);return nodes['history-results'].children.filter(child=>child.className==='history-row');};
  // Actions of a row: copy (only with a result), details, delete.
  const action=(row,label)=>row.children[1].children.find(button=>button.title===label);
  return {context,nodes,storage,messages,rows,action,run:code=>vm.runInContext(code,context)};
}
test('history click opens complete long details, safely as text; Back preserves list and data',()=>{
 const long='<script>not executed</script>\n'+'Long content '.repeat(10000);
 const entry={id:'one',title:'Video',date:'2026-10-27',source:long,originalTranscript:'Original',output:'Deutsch',request:{provider:'chatgpt',model:'fixture',prompt:'Prompt'},translationParts:[{index:0,text:'Deutsch',complete:true,usage:{inputTokens:42,outputTokens:12}}]};
 const f=fixture([entry]);f.action(f.rows()[0],'Details').onclick({stopPropagation(){}});
 assert.equal(f.nodes['history-detail'].open,true);
 const sections=f.nodes['history-detail-content'].children;
 assert.equal(sections[2].children[1].textContent,long);
 assert.match(sections[5].children[1].textContent,/inputTokens: 42/);
 f.nodes['history-detail-back'].onclick();assert.equal(f.nodes['history-detail'].open,false);
 assert.deepEqual(JSON.parse(f.storage.get('translator.history')),[entry]);
});
test('legacy history retains German output and explicitly unknown source, prompt and usage',()=>{
 const f=fixture([{id:'old',title:'Old',output:'Alt',seconds:30,kind:'short'}]);
 f.action(f.rows()[0],'Details').onclick({stopPropagation(){}});
 const texts=f.nodes['history-detail-content'].children.map(section=>section.children[1].textContent);
 assert.equal(texts[3],'Alt');assert.match(texts[2],/älteren Eintrag/);assert.match(texts[5],/Unbekannt/);
});
test('storage full never evicts old records or falsely claims success',()=>{
 const f=fixture([{id:'old',output:'Alt'}]);f.run("localStorage.setItem=()=>{throw new Error('quota')}");
 f.context.tab={id:'new',source:'New',output:'Neu',translationParts:[]};
 assert.equal(f.run('saveHistory(tab)'),false);
 assert.equal(JSON.parse(f.storage.get('translator.history'))[0].id,'old');assert.match(f.messages.at(-1)[0],/Bestehende Einträge bleiben erhalten/);
});
test('repetitive ASR review flags reported loop without rejecting ordinary speech',()=>{
 const f=fixture();
 f.context.text="So, I'm going to show you how to learn. which I have a free card, which I have a free card, which I have a free card, which I have a free card,";
 assert.equal(f.run('repetitiveTranscript(text)'),true);
 assert.equal(f.run("repetitiveTranscript('I will explain three ways to learn. First read carefully, then recall, and finally practice.')"),false);
});
test('video warning retains original ASR and metadata without sending a translation',async()=>{
 const f=fixture();
 vm.runInContext(slice('async function transcribeTab','// The prompt decides the task'),f.context);
 f.context.tab={id:'video',file:{name:'example.mp4'},source:'',transcription:{fileName:'example.mp4'}};
 f.context.decodeAudio=async()=>new Float32Array(16000);
 const text='which I have a free card '.repeat(5);f.context.runWhisper=async()=>text;
 await assert.rejects(f.run('transcribeTab(tab,new AbortController().signal)'),/Wiederholungen/);
 assert.equal(f.context.tab.source,text);assert.equal(f.context.tab.originalTranscript,text);assert.equal(f.context.tab.file,null);assert.equal(f.context.tab.media.name,'example.mp4');
 assert.equal(f.context.tab.transcription.durationSeconds,1);
});
test('queue preserves source and generated parts on error and abort; repeated imports retain separate IDs',async()=>{
 for(const aborted of [false,true]){
 const f=fixture();vm.runInContext(slice('// German: shortform is formatted locally','// Only a plain-text estimate'),f.context);
 f.context.connected=true;f.nodes.model={value:'test'};f.context.tab={id:crypto.randomUUID(),source:'English',output:'',state:'queued',translationParts:[]};
 f.context.tabs=[f.context.tab];f.context.providerRun=async tab=>{tab.translationParts=[{index:0,text:'Teil',complete:false}];throw aborted?new DOMException('Stop','AbortError'):new Error('Testfehler');};
 await f.run('runQueue()');let saved=JSON.parse(f.storage.get('translator.history'));
 assert.equal(saved[0].source,'English');assert.equal(saved[0].translationParts[0].text,'Teil');assert.match(saved[0].error,aborted?/Abgebrochen/:/Testfehler/);
 f.context.tabs=[{...f.context.tab,id:crypto.randomUUID(),state:'queued'}];await f.run('runQueue()');
 saved=JSON.parse(f.storage.get('translator.history'));assert.equal(saved.length,2);assert.notEqual(saved[0].id,saved[1].id);
 }
});
test('silent or invalid audio is rejected before ASR, readable audio is preserved',async()=>{
 const f=fixture();vm.runInContext(slice('async function decodeAudio','function runWhisper'),f.context);
 for(const [data,error] of [[new Float32Array(10),/stumm/],[Float32Array.of(NaN),/Ungültige/],[Float32Array.of(.1,.2),null]]){
 f.context.AudioContext=class{async decodeAudioData(){return {length:data.length,numberOfChannels:1,getChannelData:()=>data};}close(){}};
 f.context.file={arrayBuffer:async()=>new ArrayBuffer(0)};
 if(error)await assert.rejects(f.run('decodeAudio(file)'),error);else assert.deepEqual([...await f.run('decodeAudio(file)')],[...data]);
 }
});
test('retry in the same tab preserves earlier request, usage and original ASR after correction',async()=>{
 const f=fixture();vm.runInContext(slice('// German: shortform is formatted locally','// Only a plain-text estimate'),f.context);
 f.context.connected=true;f.nodes.model={value:'test'};
 const tab={id:'same-tab',source:'Original',originalTranscript:'Original ASR',transcription:{model:'whisper'},output:'',state:'queued',translationParts:[]};
 f.context.tab=tab;f.context.tabs=[tab];let attempt=0;
 f.context.providerRun=async tab=>{tab.request={prompt:`Prompt ${++attempt}`};tab.translationParts=[{index:0,text:`Teil ${attempt}`,complete:true,usage:{inputTokens:attempt}}];return `Deutsch ${attempt}`;};
 await f.run('runQueue()');
 // Run the real source edit handler; it must preserve original ASR provenance.
 f.context.setOutput=()=>{};f.context.maxText=500000;f.nodes.source={value:'Corrected'};
 vm.runInContext(slice("$('source').oninput=", "$('prompt').oninput="),f.context);f.nodes.source.oninput();
 assert.equal(tab.originalTranscript,'Original ASR');assert.equal(tab.transcription.model,'whisper');
 tab.state='queued';await f.run('runQueue()');
 const saved=JSON.parse(f.storage.get('translator.history'));assert.equal(saved.length,2);
 assert.equal(saved[0].source,'Corrected');assert.equal(saved[1].source,'Original');assert.equal(saved[1].output,'Deutsch 1');
 assert.equal(saved[1].request.prompt,'Prompt 1');assert.equal(saved[1].translationParts[0].usage.inputTokens,1);
});
test('out-of-order parallel parts remain inspectable after a later failure',()=>{
 const f=fixture();const parts=[];parts[2]={index:2,text:'Dritter Teil',complete:true,usage:null};
 f.context.tab={id:'sparse',source:'Source',output:'',translationParts:parts,error:'Failed'};
 f.run('saveHistory(tab)');const saved=JSON.parse(f.storage.get('translator.history'))[0];
 assert.equal(saved.translationParts.length,1);
 f.run('openHistory(JSON.parse(localStorage.getItem("translator.history"))[0])');
 assert.match(f.nodes['history-detail-content'].children[4].children[1].textContent,/Teil 3/);
});
test('cancelled queued retry does not inherit previous request or usage',()=>{
 const f=fixture();f.context.tab={id:'tab',historyId:'old',source:'Corrected',output:'',request:{prompt:'old'},translationParts:[{index:0,text:'old'}],historySource:'old source'};
 f.run("startHistoryAttempt(tab);tab.error='Abgebrochen';saveHistory(tab)");
 const entry=JSON.parse(f.storage.get('translator.history'))[0];assert.equal(entry.source,'Corrected');assert.equal(entry.request,null);assert.equal(entry.translationParts.length,0);
});
test('German shortform is refined locally without provider calls; longform goes to the provider as refine',async()=>{
 const f=fixture();vm.runInContext(slice('// Language of pasted text','const escapeHtml'),f.context);
 vm.runInContext(slice('// German: shortform is formatted locally','// Only a plain-text estimate'),f.context);
 f.context.connected=true;f.nodes.model={value:'test'};const calls=[];
 f.context.providerRun=async(tab,signal,task)=>{calls.push(task);return 'Aufbereitet.';};
 const text='[Musik] Schlaf ist die zweite Hälfte des Lernens. Jede Stunde in der Nacht zählt für dich.';
 const short={id:'de',sourceLanguage:'de',source:text,output:'',state:'queued',translationParts:[],refined:{},formatOverride:'short',mediaSeconds:20};
 f.context.tab=short;f.context.tabs=[short];await f.run('runQueue()');
 assert.deepEqual(calls,[]);assert.equal(short.output,'Schlaf ist die zweite Hälfte des Lernens.\n\nJede Stunde in der Nacht zählt für dich.');
 assert.equal(short.refined.short,short.output);assert.equal(JSON.parse(f.storage.get('translator.history'))[0].request,null);
 const long={...short,id:'de-long',output:'',state:'queued',refined:{},formatOverride:'long'};
 f.context.tab=long;f.context.tabs=[long];await f.run('runQueue()');
 assert.deepEqual(calls,['refine']);assert.equal(long.output,'Aufbereitet.');
});
test('German transcription keeps a persistent warning if history storage is full',async()=>{
 const f=fixture([{id:'existing',output:'Keep'}]);vm.runInContext(slice('// German: shortform is formatted locally','// Only a plain-text estimate'),f.context);
 f.run("localStorage.setItem=()=>{throw new Error('quota')}");
 f.context.localRefine=text=>text;f.context.tab={id:'de-quota',sourceLanguage:'de',source:'Original',originalTranscript:'Original',output:'',state:'queued',translationParts:[],refined:{}};f.context.tabs=[f.context.tab];
 await f.run('runQueue()');assert.match(f.context.tab.error,/Verlauf nicht gespeichert/);assert.equal(f.context.tab.source,'Original');
 assert.equal(JSON.parse(f.storage.get('translator.history'))[0].id,'existing');
});
test('history lists one row per source with a result or transcript, newest first, grouped by day',()=>{
 const now=new Date().toISOString(), old='2020-01-01T10:00:00Z';
 const f=fixture([{id:'b',title:'Neu',source:'Gleich',output:'Zweite Fassung',date:now},{id:'a',title:'Alt',source:'Gleich',output:'Erste Fassung',date:now},
  {id:'failed',title:'Fehler',source:'Anderes',output:'',error:'Abgebrochen',date:now},{id:'c',title:'Früher',source:'Drittes',output:'Text',date:old}]);
 const rows=f.rows();assert.equal(rows.length,2);assert.equal(rows[0].children[0].children[0].textContent,'Neu');
 assert.deepEqual(f.nodes['history-results'].children.filter(child=>child.className==='history-group').map(child=>child.textContent),['Heute','Älter']);
 f.action(rows[0],'Löschen').onclick({stopPropagation(){}});
 assert.deepEqual(JSON.parse(f.storage.get('translator.history')).map(entry=>entry.id),['failed','c']);
});
test('search ignores case and accents and shows the matching passage',()=>{
 const now=new Date().toISOString();
 const f=fixture([{id:'one',title:'Video eins',source:'x',output:'Koffein hat eine Halbwertszeit von fünf Stunden.',date:now},{id:'two',title:'Anderes',source:'y',output:'Nichts',date:now}]);
 f.nodes['history-search'].value='FUNF';const rows=f.rows();
 assert.equal(rows.length,1);assert.match(rows[0].children[0].children[2].textContent,/fünf Stunden/);
});
test('pasted text language, subtitles and local German refine',()=>{
 const f=fixture();vm.runInContext(slice('// Language of pasted text','const escapeHtml'),f.context);
 vm.runInContext(slice('// Text, transcripts and subtitles','async function textTab'),f.context);
 assert.equal(f.run("textLanguage('Das ist nicht die Lösung, aber es hilft dir und mir.')"),'de');
 assert.equal(f.run("textLanguage('This is not the answer, but it helps you and me with the task.')"),'en');
 assert.equal(f.run("textLanguage('Okay.')"),null);
 const srt='1\n00:00:01,000 --> 00:00:03,500\nHallo und willkommen.\n\n2\n00:02:41,000 --> 00:02:44,250\n<i>Bis gleich.</i>\n';
 assert.deepEqual({...f.run(`readSubtitles(${JSON.stringify(srt)})`)},{text:'Hallo und willkommen. Bis gleich.',seconds:164});
 assert.equal(f.run("localRefine('[Musik] Eins zwei drei vier fünf. Sechs sieben acht neun zehn.','short')"),'Eins zwei drei vier fünf.\n\nSechs sieben acht neun zehn.');
});
