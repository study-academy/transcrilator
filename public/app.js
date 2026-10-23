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
// Paste hint names the platform's modifier key.
if(!/Mac|iPhone|iPad/.test(navigator.platform||navigator.userAgent))$('paste-keys').textContent='Strg V';
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
// The ⌘ button swaps the settings for a read-only list of shortcuts; closing the popover returns to the settings.
function showShortcuts(visible) {
  $('shortcuts').hidden=!visible;$('settings-main').hidden=visible;
  $('settings-title').textContent=visible?'Kurzbefehle':'Einstellungen';
  $('shortcuts-toggle').setAttribute('aria-expanded',String(visible));
  $('shortcuts-toggle').setAttribute('aria-label',visible?'Zurück zu den Einstellungen':'Kurzbefehle anzeigen');
}
$('shortcuts-toggle').onclick=()=>showShortcuts($('shortcuts').hidden);
$('settings').addEventListener('toggle',event=>{if(event.newState==='closed'){promptEditing=false;showShortcuts(false);update();}});
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
  // Desktop app: native clipboard via the preload bridge, independent of window focus.
  if(window.transcrilatorDesktop){await window.transcrilatorDesktop.copy(text,$('output-view').innerHTML);return;}
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
    if(automatic)return;
    const range=document.createRange();range.selectNodeContents($('output-view'));
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('output-view').focus();
    status('Bitte den markierten Text mit ⌘C oder Strg+C kopieren.');
  }
}
// Progress veil: playful phrases about what happens to the script, each acted out by the scribble,
// plus a bar that creeps towards the next milestone. It lasts exactly as long as the request.
const PHRASES=[
  ['Kitzle die Pointen heraus','sparkle'],['Bügle die Absätze glatt','iron'],['Sortiere die Gedanken','sort'],
  ['Schicke [Musik] nach Hause','sweep'],['Fädle deutsche Sätze auf','type'],['Poliere die Überschriften','sparkle'],
  ['Fette die Überschriften an','bold'],['Lege Aha-Momente schräg','slant'],['Streiche Füllwörter mit Gefühl','sweep'],
  ['Mache aus „Hey“ ein „Hallo“','type'],['Zähle heimlich die Kommas','bounce'],['Gönne den Absätzen eine Pause','iron'],
  ['Suche das eine richtige Wort','sparkle'],['Bringe die Sätze in Reih und Glied','sort'],['Übersetze ohne zu schummeln','type'],
  ['Wecke müde Verben auf','bounce'],['Lasse Anglizismen höflich los','sweep'],['Rücke Kernsätze ins rechte Licht','slant']
];
const progress={target:0,shown:0,cap:0,timer:null,phraseTimer:null,order:[],next:0};
function showPhrase() {
  if(progress.next>=progress.order.length){progress.order=[...PHRASES].sort(()=>Math.random()-0.5);progress.next=0;}
  const [text,anim]=progress.order[progress.next++];
  $('progress-text').classList.add('swap');
  setTimeout(()=>{$('progress-text').textContent=text;$('scribble').dataset.anim=anim;$('progress-text').classList.remove('swap');},140);
}
function progressStep(target,cap=target){progress.target=Math.max(progress.target,target);progress.cap=Math.max(cap,progress.target);}
function startProgress() {
  Object.assign(progress,{target:0,shown:0,cap:0,next:progress.order.length});
  $('progress-fill').style.transform='scaleX(0)';$('progress-detail').hidden=true;
  showPhrase();$('progress').hidden=false;requestAnimationFrame(()=>$('progress').classList.add('visible'));
  progressStep(0.04,0.1);
  progress.phraseTimer=setInterval(showPhrase,2400);
  progress.timer=setInterval(()=>{
    progress.shown=Math.max(progress.target,progress.shown+(progress.cap-progress.shown)*0.04);
    $('progress-fill').style.transform=`scaleX(${progress.shown.toFixed(3)})`;
  },300);
}
function chunkProgress({done,total}) {
  if(total>1){$('progress-detail').hidden=false;$('progress-detail').textContent=`${done} von ${total} Teilen fertig`;}
  progressStep(done<total?0.1+0.8*done/total:0.94,done<total?0.1+0.8*(done+1)/total-0.02:0.98);
}
// No artificial pause: the veil goes the moment the request ends; its fade runs on its own.
function stopProgress() {
  clearInterval(progress.timer);clearInterval(progress.phraseTimer);
  $('progress').classList.remove('visible');
  setTimeout(()=>{if(!running)$('progress').hidden=true;},180);
}
async function translate() {
  running=true;controller=new AbortController();setOutput('');status();update();
  startProgress();
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
    stopProgress();
    status();showLanguage('german');
    await copy({automatic:true});
  } catch(error) {
    stopProgress();
    setOutput('');status(error.name==='AbortError'?'Abgebrochen. Keine vollständige Übersetzung erstellt.':error.message,true);
    controller?.abort();if(error.name!=='AbortError')await init();
  } finally {running=false;controller=null;update();}
}
$('action').onclick=()=>{
  if(running){controller?.abort();return;}
  if(language==='german')return copy();
  if(!$('action').disabled)return translate();
};
// Keyboard: Cmd/Ctrl+Enter runs the main action, Cmd/Ctrl+Backspace clears, Cmd/Ctrl+, opens settings,
// Shift+Tab (main area only), Ctrl+Tab or Cmd+Shift+[ ] switch language (Cmd+Tab belongs to macOS).
// Paste and copy work without focusing a field first.
const isField=element=>element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement;
document.addEventListener('keydown',event=>{
  const mod=event.metaKey||event.ctrlKey;
  if(mod&&event.key==='Enter'&&!$('action').disabled){event.preventDefault();$('action').click();return;}
  if(mod&&event.key===','){event.preventDefault();$('settings').togglePopover();return;}
  const inOverlay=!!document.querySelector('dialog[open]') || $('settings').matches(':popover-open');
  if(mod&&event.key==='Backspace'&&!inOverlay&&!$('clear').disabled){event.preventDefault();$('clear').click();return;}
  // Shift+Tab keeps its usual focus role inside settings and dialogs.
  const shiftTab=event.shiftKey&&!mod&&!event.altKey&&event.key==='Tab'&&!inOverlay;
  const tabSwitch=event.ctrlKey&&!event.metaKey&&event.key==='Tab';
  const bracketSwitch=event.metaKey&&event.shiftKey&&(event.code==='BracketLeft'||event.code==='BracketRight');
  if((shiftTab||tabSwitch||bracketSwitch)&&!running&&!document.querySelector('dialog[open]')) {
    event.preventDefault();
    showLanguage(language==='english'?'german':'english',true);
  }
});
document.addEventListener('paste',event=>{
  const source=$('source');
  if(running || event.target===source || (isField(document.activeElement)&&document.activeElement!==source) || document.querySelector('dialog[open]'))return;
  const text=event.clipboardData?.getData('text/plain');
  if(!text)return;
  event.preventDefault();
  const focused=document.activeElement===source;
  showLanguage('english');source.focus();
  if(!focused)source.setSelectionRange(source.value.length,source.value.length);
  source.setRangeText(text,source.selectionStart,source.selectionEnd,'end');
  source.dispatchEvent(new Event('input'));
});
document.addEventListener('copy',event=>{
  const active=document.activeElement;
  if(isField(active)&&active.selectionStart!==active.selectionEnd)return;
  if(!window.getSelection().isCollapsed)return;
  if(!$('output').value)return;
  event.preventDefault();
  event.clipboardData.setData('text/plain',plainOutput());
  event.clipboardData.setData('text/html',$('output-view').innerHTML);
  toast('In die Zwischenablage kopiert');
});
init();
