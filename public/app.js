const $ = id => document.getElementById(id);
let csrf='', defaultPrompt=$('default-prompt').content.textContent, connected=false, running=false, controller=null;
let promptInitialized=false, promptEditing=false;
const promptStorageKey='translator.customPrompt', providerStorageKey='translator.provider';
const usageLinks={chatgpt:'https://chatgpt.com/settings/usage',claude:'https://claude.ai/settings/usage'};
// Claude is the default; an explicit choice is remembered per browser.
let provider='claude', claudeState=null, providerSupport=false;
try{const saved=localStorage.getItem(providerStorageKey);if(saved==='chatgpt'||saved==='claude')provider=saved;}catch{}
$('provider').value=provider;
let maxText=500000, authWindow=null, awaitingAuth=false, language='english';
window.addEventListener('focus',()=>{if(awaitingAuth && !running)init();});
function status(message='', error=false) {
  $('status').textContent=message;
  $('status').className=error?'error':'';
  if(error && (message.includes('Nutzungslimit') || message.includes('Planlimit'))) {
    const link=document.createElement('a');
    link.href=message.includes('Claude')?usageLinks.claude:usageLinks.chatgpt;link.target='_blank';link.rel='noreferrer';link.textContent='Nutzung verwalten';
    $('status').append(' ',link);
  }
}
async function api(path, body) {
  const response=await fetch(path, body===undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-Local-CSRF':csrf},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error || 'Lokale Anfrage fehlgeschlagen.');
  return data;
}
function update() {
  const german=language==='german';
  $('action').textContent=running?'Abbrechen':german?'Kopieren':'Übersetzen';
  const ready=provider==='chatgpt'?connected && !!$('model').value:!!claudeState?.ready;
  $('action').disabled=running?false:german?!$('output').value:!ready || !$('source').value.trim() || $('source').value.length>maxText || !$('prompt').value.trim();
  $('clear').disabled=running || (!$('source').value && !$('output').value);
  $('source').readOnly=running;$('prompt').readOnly=running || !promptEditing;$('model').disabled=running;$('reset').disabled=running;
  $('edit-prompt').disabled=running;$('provider').disabled=running;
  $('edit-prompt').setAttribute('aria-pressed',String(promptEditing));
  $('edit-prompt').setAttribute('aria-label',promptEditing?'Prompt-Bearbeitung beenden':'Prompt bearbeiten');
  $('edit-prompt').title=promptEditing?'Bearbeitung beenden':'Prompt bearbeiten';
  $('count').textContent=$('source').value.length?`${$('source').value.length.toLocaleString('de-DE')} / ${maxText.toLocaleString('de-DE')} Zeichen`:'';
}
function showLanguage(next, focusTab=false) {
  language=next;
  const german=next==='german';
  $('language-switch').dataset.language=next;
  $('english-panel').hidden=german;$('german-panel').hidden=!german;
  for(const name of ['english','german']) {
    const selected=name===next, tab=$(name+'-tab');
    tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;
  }
  if(focusTab)$(next+'-tab').focus();
  update();
}
$('english-tab').onclick=()=>showLanguage('english');
$('german-tab').onclick=()=>showLanguage('german');
$('language-switch').onkeydown=event=>{
  if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
    event.preventDefault();
    showLanguage(event.key==='Home'?'english':event.key==='End'?'german':language==='english'?'german':'english',true);
  }
};
function applyProvider() {
  $('chatgpt-settings').hidden=provider==='claude';
  $('provider-hint').textContent=provider==='claude'?(claudeState?.reason || 'Claude ist noch nicht verfügbar.'):providerSupport?'':'Claude wird nach dem nächsten Serverstart verfügbar. Die laufende App wird dafür nicht automatisch neu gestartet.';
  $('plan-name').textContent=provider==='claude'?'Claude-Plan':'ChatGPT-Plan';
  $('plan-link').href=usageLinks[provider];
  $('plan').hidden=provider==='chatgpt'?!connected:!claudeState?.ready;
  update();
}
$('provider').onchange=()=>{
  provider=$('provider').value;
  try{localStorage.setItem(providerStorageKey,provider);}catch{}
  applyProvider();
};
async function init() {
  try {
    const state=await api('/api/status');csrf=state.csrf;maxText=state.maxText;
    if(!promptInitialized) {
      let saved=null;try{saved=sessionStorage.getItem(promptStorageKey);}catch{}
      $('prompt').value=saved===null?defaultPrompt:saved;promptInitialized=true;
    }
    try{const providers=await api('/api/providers');claudeState=providers.claude;providerSupport=true;}catch{providerSupport=false;claudeState=null;}
    $('claude-option').disabled=!providerSupport;
    if(!providerSupport && provider==='claude'){provider='chatgpt';$('provider').value=provider;}
    const wasConnected=connected;connected=state.connected;
    if(connected && !wasConnected)status();
    if(connected || state.error)awaitingAuth=false;
    $('connection').textContent=connected?'Verbunden':'Nicht verbunden';
    $('settings-toggle').title=connected?'Einstellungen · Verbunden':'Einstellungen · Nicht verbunden';
    $('connect').hidden=connected;$('disconnect').hidden=!connected;$('plan').hidden=!connected;
    if(state.error)status(state.error,true);
    if(!connected) {
      $('model').hidden=true;$('model-label').hidden=true;$('model').replaceChildren();
    } else {
      if(state.welcome && !$('welcome').open)$('welcome').showModal();
      const previous=$('model').value;
      const {models}=await api('/api/models');
      $('model').replaceChildren(...models.map(model=>{const option=document.createElement('option');option.value=model.slug;option.textContent=model.display_name;return option;}));
      if(models.some(model=>model.slug===previous))$('model').value=previous;
      $('model').hidden=false;$('model-label').hidden=false;
    }
  } catch(error) {status(error.message,true);} finally {applyProvider();}
}
$('connect').onclick=()=>{
  if($('settings').matches(':popover-open'))$('settings').hidePopover();
  $('consent').showModal();
};
$('consent').addEventListener('close',async()=>{
  if($('consent').returnValue!=='continue')return;
  awaitingAuth=true;
  authWindow=window.open('about:blank','translator-chatgpt','popup,width=650,height=780');
  if(!authWindow){awaitingAuth=false;status('Bitte Pop-ups für diese lokale Seite erlauben und erneut verbinden.',true);return;}
  try {
    const {url}=await api('/api/connect',{});authWindow.location.replace(url);status('Anmeldung im geöffneten Fenster abschließen.');
    const timer=setInterval(()=>{if(!authWindow || authWindow.closed){clearInterval(timer);authWindow=null;init();}},1000);
  } catch(error) {authWindow.close();authWindow=null;awaitingAuth=false;status(error.message,true);}
});
$('welcome').addEventListener('cancel',event=>event.preventDefault());
$('welcome').addEventListener('close',async()=>{try{await api('/api/acknowledge',{});}catch(error){status(error.message,true);}});
$('disconnect').onclick=async()=>{
  try {await api('/api/disconnect',{});setOutput('');status();showLanguage('english');await init();}
  catch(error){status(error.message,true);}
};
$('edit-prompt').onclick=()=>{if(running)return;promptEditing=!promptEditing;update();if(promptEditing)$('prompt').focus();};
$('settings').addEventListener('toggle',event=>{if(event.newState==='closed'){promptEditing=false;update();}});
$('prompt-settings').addEventListener('toggle',()=>{if(!$('prompt-settings').open){promptEditing=false;update();}});
$('reset').onclick=()=>{
  $('prompt').value=defaultPrompt;promptEditing=false;
  try{sessionStorage.removeItem(promptStorageKey);}catch{}
  setOutput('');status('Standardprompt wiederhergestellt.');update();
};
for(const id of ['source','prompt'])$(id).oninput=()=>{
  let promptSaved=true;
  if(id==='prompt'){try{sessionStorage.setItem(promptStorageKey,$('prompt').value);}catch{promptSaved=false;}}
  setOutput('');
  const tooLong=$('source').value.length>maxText;
  status(tooLong?'Grenze überschritten. Bitte auf mehrere Übersetzungen verteilen. Es wird nichts abgeschnitten.':promptSaved?'':'Eigener Prompt bleibt nur bis zum Neuladen erhalten; der Browser blockiert den Sitzungsspeicher.',tooLong || !promptSaved);update();
};
$('clear').onclick=()=>{
  if(running)return;
  $('source').value='';setOutput('');status();showLanguage('english');$('source').focus();
};
// Only text nodes plus a small allowlist of formatting elements are created.
// Model/source HTML is never parsed or assigned as HTML.
function appendInline(parent,text,depth=0) {
  if(depth>12){parent.append(document.createTextNode(text));return;}
  const pattern=/\*\*\*(?=\S)([\s\S]*?\S|\S)\*\*\*|\*\*(?=\S)([\s\S]*?\S|\S)\*\*|__(?=\S)([\s\S]*?\S|\S)__|(?<!\*)\*(?=\S)([\s\S]*?\S|\S)\*(?!\*)|(?<![\p{L}\p{N}_])_(?=\S)([\s\S]*?\S|\S)_(?![\p{L}\p{N}_])/gu;
  let position=0;
  for(const match of text.matchAll(pattern)) {
    parent.append(document.createTextNode(text.slice(position,match.index)));
    const bold=match[1]!==undefined || match[2]!==undefined || match[3]!==undefined;
    const element=document.createElement(bold?'strong':'em');
    if(match[1]!==undefined){const emphasis=document.createElement('em');appendInline(emphasis,match[1],depth+1);element.append(emphasis);}
    else appendInline(element,match[2]??match[3]??match[4]??match[5],depth+1);
    parent.append(element);position=match.index+match[0].length;
  }
  parent.append(document.createTextNode(text.slice(position)));
}
function setOutput(text) {
  $('output').value=text;$('output-view').replaceChildren();
  if(!text)return;
  for(const paragraph of text.replace(/\r\n/g,'\n').split(/\n[ \t]*\n/)) {
    const element=document.createElement('p');appendInline(element,paragraph);$('output-view').append(element);
  }
}
function plainOutput(){return [...$('output-view').children].map(element=>element.textContent).join('\n\n');}
async function copy() {
  if(!$('output').value)return;
  const text=plainOutput();
  try {
    if(typeof ClipboardItem==='function' && navigator.clipboard.write) {
      try {
        await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([$('output-view').innerHTML],{type:'text/html'})})]);
      } catch {await navigator.clipboard.writeText(text);}
    } else await navigator.clipboard.writeText(text);
    status('Kopiert.');
  } catch {
    const range=document.createRange();range.selectNodeContents($('output-view'));
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('output-view').focus();
    status('Bitte den markierten Text mit ⌘C oder Strg+C kopieren.');
  }
}
async function translate() {
  running=true;controller=new AbortController();setOutput('');status('Übersetzt …');update();
  let completed=false;
  try {
    const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json','X-Local-CSRF':csrf},signal:controller.signal,body:JSON.stringify({provider,text:$('source').value,prompt:$('prompt').value,model:$('model').value})});
    if(!response.ok){const data=await response.json();throw new Error(data.error || 'Übersetzung fehlgeschlagen.');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    function event(line) {
      if(!line.trim())return;
      const item=JSON.parse(line);
      if(item.type==='error')throw new Error(item.error);
      if(item.type==='progress')status(`Übersetzt · ${item.done} / ${item.total} Teile`);
      if(item.type==='completed') {
        if(typeof item.text!=='string'||!item.text.trim())throw new Error('Leere Übersetzung.');
        setOutput(item.text);completed=true;
      }
    }
    while(true) {
      const {value,done}=await reader.read();if(done)break;
      buffer+=decoder.decode(value,{stream:true});let index;
      while((index=buffer.indexOf('\n'))>=0){event(buffer.slice(0,index));buffer=buffer.slice(index+1);}
    }
    buffer+=decoder.decode();if(buffer.trim())event(buffer);
    if(!completed)throw new Error('Verbindung abgebrochen. Keine vollständige Übersetzung erhalten.');
    status();showLanguage('german');
  } catch(error) {
    setOutput('');status(error.name==='AbortError'?'Abgebrochen. Keine vollständige Übersetzung erstellt.':error.message,true);
    controller?.abort();if(error.name!=='AbortError')await init();
  } finally {running=false;controller=null;update();}
}
$('action').onclick=()=>{
  if(running){controller?.abort();return;}
  if(language==='german')return copy();
  if(!$('action').disabled)return translate();
};
document.addEventListener('keydown',event=>{
  if((event.metaKey||event.ctrlKey)&&event.key==='Enter'&&!$('action').disabled){event.preventDefault();$('action').click();}
});
init();
