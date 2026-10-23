const $ = id => document.getElementById(id);
let csrf='', defaultPrompt=$('default-prompt').content.textContent, connected=false, running=false, controller=null;
let promptInitialized=false, promptEditing=false;
const promptStorageKey='translator.customPrompt', providerStorageKey='translator.provider';
const usageLinks={chatgpt:'https://chatgpt.com/settings/usage',claude:'https://claude.ai/settings/usage'};
// Claude is the default; an explicit choice is remembered per browser.
let provider='claude', claudeState=null, providerSupport=false;
try{const saved=localStorage.getItem(providerStorageKey);if(saved==='chatgpt'||saved==='claude')provider=saved;}catch{}
let maxText=500000, authWindow=null, awaitingAuth=false, awaitingClaude=false, language='english';
// Returning from a sign-in (browser or Terminal) refreshes both connection states.
window.addEventListener('focus',()=>{if((awaitingAuth || awaitingClaude) && !running)init();});
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
  $('edit-prompt').disabled=running;
  for(const id of ['pick-claude','pick-chatgpt','claude-reconnect','connect','disconnect'])$(id).disabled=running || (id==='pick-claude' && !providerSupport);
  $('edit-prompt').setAttribute('aria-pressed',String(promptEditing));
  $('edit-prompt').setAttribute('aria-label',promptEditing?'Prompt-Bearbeitung beenden':'Prompt bearbeiten');
  $('edit-prompt').title=promptEditing?'Bearbeitung beenden':'Prompt bearbeiten';
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
// Traffic-light status per provider: green usable, yellow needs a step from the user, red unavailable.
function claudeStatus() {
  if(!providerSupport)return ['red','Nicht verfügbar'];
  if(!claudeState)return ['yellow','Wird geprüft …'];
  if(claudeState.ready)return ['green','Verbunden über dein Claude-Abo'];
  if(!claudeState.installed)return ['red','Claude Code nicht installiert'];
  if(claudeState.loggedIn)return ['yellow','Kein Claude-Abo-Login'];
  if(claudeState.authMethod==='none')return ['yellow','Nicht angemeldet'];
  return ['red','Nicht verfügbar'];
}
function chatgptStatus() {
  if(connected)return ['green','Verbunden über deinen ChatGPT-Plan'];
  if(awaitingAuth)return ['yellow','Anmeldung läuft …'];
  return ['red','Nicht verbunden'];
}
function applyProvider() {
  const states={claude:claudeStatus(),chatgpt:chatgptStatus()};
  $('providers').dataset.provider=provider;
  for(const name of ['claude','chatgpt']) {
    const pick=$('pick-'+name),[level,text]=states[name];
    pick.setAttribute('aria-checked',String(provider===name));pick.tabIndex=provider===name?0:-1;pick.setAttribute('aria-label',`${name==='claude'?'Claude':'ChatGPT'}, ${text}`);
    $(name+'-dot').dataset.level=level;
  }
  // One status line for the selected provider, with only the action that fits it.
  $('provider-state').textContent=states[provider][1];
  $('claude-reconnect').hidden=provider!=='claude';
  $('connect').hidden=provider!=='chatgpt';$('disconnect').hidden=provider!=='chatgpt' || !connected;
  $('chatgpt-settings').hidden=provider!=='chatgpt' || !connected;
  $('provider-hint').textContent=provider==='claude' && claudeState && !claudeState.ready?claudeState.reason:'';
  const level=states[provider][0];
  $('settings-toggle').title=`Einstellungen · ${provider==='claude'?'Claude':'ChatGPT'} · ${level==='green'?'Verbunden':'Nicht verbunden'}`;
  // OpenAI requires the plan notice near the composer while ChatGPT plan usage is active; Claude needs none.
  $('plan').hidden=provider!=='chatgpt' || !connected;
  update();
}
function selectProvider(next, focus=false) {
  provider=next;
  try{localStorage.setItem(providerStorageKey,provider);}catch{}
  applyProvider();
  if(focus)$('pick-'+next).focus();
}
for(const name of ['claude','chatgpt'])$('pick-'+name).onclick=()=>selectProvider(name);
$('providers').onkeydown=event=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)) {
    event.preventDefault();
    const next=provider==='claude'?'chatgpt':'claude';
    if(!$('pick-'+next).disabled)selectProvider(next,true);
  }
};
$('claude-reconnect').onclick=async()=>{
  try {
    const {opened}=await api('/api/claude/login',{});
    awaitingClaude=opened;
    status(opened?'Claude-Anmeldung im Terminal abschließen und danach zur App zurückkehren.':'Im Terminal anmelden: claude auth login');
  } catch(error) {status(error.message,true);}
  claudeState=null;applyProvider();await init();
};
async function init() {
  try {
    const state=await api('/api/status');csrf=state.csrf;maxText=state.maxText;
    if(!promptInitialized) {
      let saved=null;try{saved=sessionStorage.getItem(promptStorageKey);}catch{}
      $('prompt').value=saved===null?defaultPrompt:saved;promptInitialized=true;
    }
    try{const providers=await api('/api/providers');claudeState=providers.claude;providerSupport=true;}catch{providerSupport=false;claudeState=null;}
    if(!providerSupport && provider==='claude')provider='chatgpt';
    if(claudeState?.ready)awaitingClaude=false;
    const wasConnected=connected;connected=state.connected;
    if(connected && !wasConnected)status();
    if(connected || state.error)awaitingAuth=false;
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
  awaitingAuth=true;applyProvider();
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
let toastTimer=null;
function toast(message) {
  clearTimeout(toastTimer);
  $('toast-text').textContent=message;$('toast').hidden=false;
  requestAnimationFrame(()=>$('toast').classList.add('visible'));
  toastTimer=setTimeout(()=>{$('toast').classList.remove('visible');toastTimer=setTimeout(()=>{$('toast').hidden=true;},250);},1800);
}
async function writeClipboard() {
  const text=plainOutput();
  if(typeof ClipboardItem==='function' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([$('output-view').innerHTML],{type:'text/html'})})]);
      return;
    } catch {}
  }
  await navigator.clipboard.writeText(text);
}
// automatic: right after a finished translation; a refusal there only hints at the button and never selects text.
async function copy({automatic=false}={}) {
  if(!$('output').value)return;
  try {
    await writeClipboard();
    toast('In die Zwischenablage kopiert');
  } catch {
    if(automatic){status('Fertig. Mit „Kopieren“ in die Zwischenablage übernehmen.');return;}
    const range=document.createRange();range.selectNodeContents($('output-view'));
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('output-view').focus();
    status('Bitte den markierten Text mit ⌘C oder Strg+C kopieren.');
  }
}
// Progress veil: phase text plus a bar that creeps towards the next milestone so long chunks still feel alive.
const progress={target:0,shown:0,cap:0,timer:null};
function progressText(text) {
  if($('progress-text').textContent===text)return;
  $('progress-text').classList.add('swap');
  setTimeout(()=>{$('progress-text').textContent=text;$('progress-text').classList.remove('swap');},140);
}
function progressStep(text,target,cap=target) {
  progressText(text);progress.target=Math.max(progress.target,target);progress.cap=Math.max(cap,progress.target);
}
function startProgress(name) {
  Object.assign(progress,{target:0,shown:0,cap:0});
  $('progress-fill').style.transform='scaleX(0)';$('progress-text').textContent='';
  $('progress').hidden=false;requestAnimationFrame(()=>$('progress').classList.add('visible'));
  progressStep(`${name} wird vorbereitet`,0.04,0.1);
  progress.timer=setInterval(()=>{
    progress.shown=Math.max(progress.target,progress.shown+(progress.cap-progress.shown)*0.04);
    $('progress-fill').style.transform=`scaleX(${progress.shown.toFixed(3)})`;
  },300);
}
function chunkProgress({done,total}) {
  const share=done/total, next=(done+1)/total;
  if(done<total)progressStep(total===1?'Übersetze den Text':`Übersetze ${total} Teile · ${done} fertig`,0.1+0.8*share,0.1+0.8*next-0.02);
  else progressStep('Setze die Übersetzung zusammen',0.94,0.98);
}
async function stopProgress(finished) {
  clearInterval(progress.timer);
  if(finished){$('progress-fill').style.transform='scaleX(1)';progressText('Fertig');await new Promise(r=>setTimeout(r,450));}
  $('progress').classList.remove('visible');
  await new Promise(r=>setTimeout(r,180));$('progress').hidden=true;
}
async function translate() {
  running=true;controller=new AbortController();setOutput('');status();update();
  startProgress(provider==='claude'?'Claude':'ChatGPT');
  let completed=false;
  try {
    const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json','X-Local-CSRF':csrf},signal:controller.signal,body:JSON.stringify({provider,text:$('source').value,prompt:$('prompt').value,model:$('model').value})});
    if(!response.ok){const data=await response.json();throw new Error(data.error || 'Übersetzung fehlgeschlagen.');}
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    function event(line) {
      if(!line.trim())return;
      const item=JSON.parse(line);
      if(item.type==='error')throw new Error(item.error);
      if(item.type==='progress')chunkProgress(item);
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
    // The German view only appears once the whole translation is complete.
    await stopProgress(true);
    status();showLanguage('german');
    await copy({automatic:true});
  } catch(error) {
    await stopProgress(false);
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
