const $ = id => document.getElementById(id);
// running: the visible tab is queued or being processed. busy: any tab is.
let csrf='', defaultPrompt=$('default-prompt').content.textContent, connected=false, running=false, busy=false;
let promptInitialized=false, promptEditing=false;
const promptStorageKey='translator.customPrompt', providerStorageKey='translator.provider';
const usageLinks={chatgpt:'https://chatgpt.com/settings/usage',claude:'https://claude.ai/settings/usage'};
// Claude is the default; an explicit choice is remembered per browser.
let provider='claude', claudeState=null, providerSupport=false;
try{const saved=localStorage.getItem(providerStorageKey);if(saved==='chatgpt'||saved==='claude')provider=saved;}catch{}
let maxText=500000, authWindow=null, awaitingAuth=false, awaitingClaude=false, language='english';
// Returning from a sign-in (browser or Terminal) refreshes both connection states.
window.addEventListener('focus',()=>{if((awaitingAuth || awaitingClaude) && !busy)init();});
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
  $('clear').disabled=!busy && tabs.length===1 && isEmptyTab(cur());
  $('source').readOnly=running;$('prompt').readOnly=busy || !promptEditing;$('model').disabled=busy;$('reset').disabled=busy;
  $('edit-prompt').disabled=busy;
  for(const id of ['pick-claude','pick-chatgpt','claude-reconnect','connect','disconnect'])$(id).disabled=busy || (id==='pick-claude' && !providerSupport);
  $('edit-prompt').setAttribute('aria-pressed',String(promptEditing));
  $('edit-prompt').setAttribute('aria-label',promptEditing?'Prompt-Bearbeitung beenden':'Prompt bearbeiten');
  $('edit-prompt').title=promptEditing?'Bearbeitung beenden':'Prompt bearbeiten';
}
function showLanguage(next, focusTab=false) {
  language=next;cur().language=next;
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
  showConnectionError(level);
  update();
}
// While the selected provider is not usable, the empty card shows why instead of the placeholder.
// Nothing shows while Claude is still being checked, so the message never flashes on start.
function showConnectionError(level) {
  const checking=provider==='claude' && providerSupport && !claudeState;
  const missing=!checking && level!=='green';
  document.querySelector('.editor-wrap').dataset.connection=missing?'missing':'ok';
  $('connect-error').hidden=!missing;
  if(!missing)return;
  const name=provider==='claude'?'Claude':'ChatGPT';
  const text=provider==='claude' && claudeState && !claudeState.installed?'Claude Code ist nicht installiert.'
    :provider==='chatgpt' && awaitingAuth?'ChatGPT-Anmeldung läuft …':`${name} ist nicht verbunden.`;
  $('connect-error-text').textContent=text;
  $('connect-error-action').hidden=provider==='chatgpt' && awaitingAuth;
}
$('connect-error-action').onclick=()=>$('settings').showPopover();
// First start without any working connection: open the settings once so a model gets connected right away.
const setupStorageKey='translator.setupShown';
let setupChecked=false;
function firstStartSetup() {
  if(setupChecked || (provider==='claude' && providerSupport && !claudeState))return;
  setupChecked=true;
  let shown=null;try{shown=localStorage.getItem(setupStorageKey);}catch{}
  if(shown || claudeState?.ready || connected)return;
  try{localStorage.setItem(setupStorageKey,'1');}catch{}
  $('settings').showPopover();
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
  } catch(error) {status(error.message,true);} finally {applyProvider();firstStartSetup();}
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
  try {await api('/api/disconnect',{});cur().output='';setOutput('');status();showLanguage('english');await init();}
  catch(error){status(error.message,true);}
};
$('edit-prompt').onclick=()=>{if(busy)return;promptEditing=!promptEditing;update();if(promptEditing)$('prompt').focus();};
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
  cur().output='';setOutput('');status('Standardprompt wiederhergestellt.');update();
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
// Renders a translation into safe paragraphs; also used for history entries that are not on screen.
function renderParagraphs(text,target=document.createElement('div')) {
  target.replaceChildren();
  if(!text)return target;
  for(const paragraph of text.replace(/\r\n/g,'\n').split(/\n[ \t]*\n/)) {
    const element=document.createElement('p');appendInline(element,paragraph);target.append(element);
  }
  return target;
}
function setOutput(text) {$('output').value=text;renderParagraphs(text,$('output-view'));if(!text)$('format-line').hidden=true;}
const plainText=view=>[...view.children].map(element=>element.textContent).join('\n\n');
function plainOutput(){return plainText($('output-view'));}
let toastTimer=null;
function toast(message) {
  clearTimeout(toastTimer);
  $('toast-text').textContent=message;$('toast').hidden=false;
  requestAnimationFrame(()=>$('toast').classList.add('visible'));
  toastTimer=setTimeout(()=>{$('toast').classList.remove('visible');toastTimer=setTimeout(()=>{$('toast').hidden=true;},250);},1800);
}
// Tabs: every tab keeps its own script, result and view. The visible tab is rendered into the single
// card; a queue processes queued tabs one after another in the background (transcribe, then translate).
const newTab=()=>({id:crypto.randomUUID(),source:'',output:'',mediaSeconds:null,formatOverride:null,fileName:null,file:null,language:'english',state:'idle',error:''});
let tabs=[newTab()], active=0;
const cur=()=>tabs[active];
const isEmptyTab=tab=>!tab.source.trim() && !tab.output && !tab.file && tab.state==='idle';
const tabTitle=tab=>tab.fileName || tab.source.replace(/\[[^\]]{1,30}\]/g,' ').trim().split(/\s+/).slice(0,6).join(' ') || 'Leerer Tab';
function renderDots(entering=-1) {
  $('tab-dots').hidden=tabs.length<2;
  $('tab-dots').replaceChildren(...(tabs.length<2?[]:tabs.map((tab,index)=>{
    const dot=document.createElement('button');
    dot.type='button';dot.className='tab-dot'+(index===entering?' entering':'');dot.setAttribute('role','tab');
    dot.setAttribute('aria-selected',String(index===active));dot.tabIndex=index===active?0:-1;
    const state=tab.state==='running'?' · läuft':tab.state==='queued'?' · wartet':tab.output?' · fertig':'';
    dot.dataset.shortcut=tabTitle(tab)+state;dot.setAttribute('aria-label',`Tab ${index+1}, ${tabTitle(tab)}${state}`);
    dot.onclick=()=>goTo(index);
    return dot;
  })));
}
// Shows the visible tab: script, result, view, status and, if it is being processed, the progress veil.
function render(motion='') {
  const tab=cur();
  $('source').value=tab.source;setOutput(tab.output);showLanguage(tab.language);
  running=tab.state==='queued'||tab.state==='running';
  status(tab.error,!!tab.error);
  veilFor(tab);showFormat();renderDots();update();
  if(motion){$('stage').classList.remove('slide-left','slide-right','collapse');void $('stage').offsetWidth;$('stage').classList.add(motion);}
}
$('stage').addEventListener('animationend',()=>$('stage').classList.remove('slide-left','slide-right','collapse'));
// Leaving an empty tab removes it, so empty cards never pile up.
function goTo(index,motion=index>active?'slide-left':'slide-right') {
  if(index===active || index<0 || index>=tabs.length)return;
  const leaving=cur();
  if(tabs.length>1 && isEmptyTab(leaving)){tabs.splice(active,1);if(index>active)index--;}
  active=index;render(motion);
}
// A new tab appears where it is asked for: after the current one (+, ⌘ T, ⌘ → at the end) or before it (⌘ ← at the start).
function openTab(where='after') {
  if(isEmptyTab(cur()))return $('source').focus();
  const index=where==='before'?active:active+1;
  tabs.splice(index,0,newTab());active=index;
  render(where==='before'?'slide-right':'slide-left');renderDots(index);$('source').focus();
}
function step(direction) {
  const target=active+direction;
  if(target<0)return openTab('before');
  if(target>=tabs.length)return openTab('after');
  goTo(target);
}
$('new-tab').onclick=()=>openTab('after');
$('source').oninput=()=>{
  const tab=cur();
  Object.assign(tab,{source:$('source').value,output:'',mediaSeconds:null,formatOverride:null,fileName:null,error:''});
  setOutput('');
  const tooLong=tab.source.length>maxText;
  status(tooLong?'Grenze überschritten. Bitte auf mehrere Übersetzungen verteilen. Es wird nichts abgeschnitten.':'',tooLong);
  renderDots();update();
};
$('prompt').oninput=()=>{
  let promptSaved=true;
  try{sessionStorage.setItem(promptStorageKey,$('prompt').value);}catch{promptSaved=false;}
  cur().output='';setOutput('');
  status(promptSaved?'':'Eigener Prompt bleibt nur bis zum Neuladen erhalten; der Browser blockiert den Sitzungsspeicher.',!promptSaved);update();
};
// Clear returns to the starting point: one empty card. Finished results are already in the history;
// if something is still running or waiting, it asks once.
function clearAll() {
  if(jobController)jobController.abort();
  tabs=[newTab()];active=0;render(tabs.length?'collapse':'');$('source').focus();
}
$('clear').onclick=()=>{
  const pending=tabs.filter(tab=>tab.state==='running'||tab.state==='queued').length;
  if(!pending)return clearAll();
  $('clear-confirm-text').textContent=pending===1?'Eine Übersetzung läuft noch und geht dabei verloren.':`${pending} Übersetzungen laufen noch oder warten und gehen dabei verloren.`;
  $('clear-confirm').showModal();
};
for(const button of $('clear-confirm').querySelectorAll('[data-clear]'))button.onclick=()=>{
  $('clear-confirm').close();if(button.dataset.clear==='confirm')clearAll();
};
// Shortform (under 3 minutes) is copied in the Studyacademy Copywriting Board layout: one scene per row,
// the hook first and the script right after it. Pasted into the last hook row, the two hook rows above
// stay free for ad hook variants. Duration comes from the video, or ~150 spoken words per minute.
const SHORTFORM_SECONDS=180, WORDS_PER_MINUTE=150;
// Length of a script and how it was found: the video itself, timestamps in a pasted
// transcript (YouTube style "4:12"), or an estimate from the word count.
function scriptLength(tab=cur()) {
  if(tab.mediaSeconds!==null)return {seconds:tab.mediaSeconds,basis:'video'};
  const stamps=[...tab.source.matchAll(/(?<![\d:])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g)].map(m=>(+(m[1]||0))*3600+(+m[2])*60+(+m[3]));
  if(stamps.length>=3)return {seconds:Math.max(...stamps),basis:'timestamps'};
  const words=tab.source.replace(/(?<![\d:])(?:\d{1,2}:)?\d{1,2}:\d{2}(?![\d:])/g,' ').trim().split(/\s+/).filter(Boolean).length;
  return {seconds:words/WORDS_PER_MINUTE*60,basis:'estimate'};
}
const formatOf=(tab=cur())=>tab.formatOverride || (scriptLength(tab).seconds<SHORTFORM_SECONDS?'short':'long');
const clock=seconds=>`${Math.floor(seconds/60)}:${String(Math.round(seconds%60)).padStart(2,'0')}`;
// One sentence per scene, independent of how the model split paragraphs; very short sentences
// ("Warum?", "Ganz einfach:") join the next one so every row carries a complete thought.
const MIN_SCENE_WORDS=5;
const sentenceSegmenter=new Intl.Segmenter('de',{granularity:'sentence'});
function boardRows(output) {
  const text=output.replace(/\*\*\*|\*\*|__|(?<![\p{L}\p{N}])[*_]|[*_](?![\p{L}\p{N}])/gu,'');
  const sentences=[...sentenceSegmenter.segment(text)].map(part=>part.segment.replace(/\s+/g,' ').trim()).filter(Boolean);
  const rows=[];let carry='';
  for(const sentence of sentences) {
    const scene=carry?`${carry} ${sentence}`:sentence;
    if(scene.split(' ').length<MIN_SCENE_WORDS){carry=scene;continue;}
    rows.push(scene);carry='';
  }
  if(carry)rows.length?rows[rows.length-1]+=` ${carry}`:rows.push(carry);
  return rows;
}
const escapeHtml=text=>text.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
// The clipboard content for one translation: board rows for shortform, formatted paragraphs otherwise.
function payloadFor({output,kind}) {
  if(kind==='long'){const view=renderParagraphs(output);return {text:plainText(view),html:view.innerHTML,board:false};}
  const rows=boardRows(output);
  // Voice Over spans the merged columns C to F. A plain multi-row paste would unmerge them, so every
  // row brings its own four-column cell in the board's cell style (Arial 10, wrapped, top aligned).
  const cell='font-family:Arial;font-size:10pt;vertical-align:top;white-space:normal;word-wrap:break-word;wrap-strategy:4;overflow:hidden;padding:6px 8px;border:1px solid #d8d8d8';
  const html=`<meta charset="utf-8"><table style="border-collapse:collapse"><tbody>${rows.map(row=>`<tr><td colspan="4" style="${cell}">${escapeHtml(row)}</td></tr>`).join('')}</tbody></table>`;
  return {text:rows.join('\n'),html,board:true};
}
const clipboardPayload=(tab=cur())=>payloadFor({output:tab.output,kind:formatOf(tab)});
const copiedMessage=board=>board?'Fürs Copywriting Board kopiert':'In die Zwischenablage kopiert';
async function writeClipboard({text,html}) {
  // Desktop app: native clipboard via the preload bridge, independent of window focus.
  if(window.transcrilatorDesktop){await window.transcrilatorDesktop.copy(text,html);return;}
  if(typeof ClipboardItem==='function' && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({'text/plain':new Blob([text],{type:'text/plain'}),'text/html':new Blob([html],{type:'text/html'})})]);
      return;
    } catch {}
  }
  await navigator.clipboard.writeText(text);
}
// automatic: right after a finished translation; a refusal there only hints at the button and never selects text.
async function copy({automatic=false}={}) {
  if(!cur().output)return;
  try {
    const payload=clipboardPayload();
    await writeClipboard(payload);
    toast(copiedMessage(payload.board));
    showFormat();
  } catch {
    if(automatic)return;
    const range=document.createRange();range.selectNodeContents($('output-view'));
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);$('output-view').focus();
    status('Bitte den markierten Text mit ⌘C oder Strg+C kopieren.');
  }
}
// After a translation the status line names the detected format; one click switches it and recopies.
function showFormat() {
  const tab=cur();
  if(!tab.output){$('format-line').hidden=true;return;}
  const {seconds,basis}=scriptLength(tab), kind=formatOf(tab);
  const length=`${basis==='estimate'?'ca. ':''}${clock(seconds)} Min`;
  $('format-text').textContent=kind==='short'?`Shortform · ${length} · in die letzte Hook-Zeile einfügen`:`Longform · ${length}`;
  $('format-switch').textContent=kind==='short'?'Als Longform kopieren':'Als Shortform kopieren';
  $('format-line').hidden=false;
}
$('format-switch').onclick=async()=>{
  const tab=cur();
  tab.formatOverride=formatOf(tab)==='short'?'long':'short';
  updateHistoryKind(tab);
  await copy();
};
// History: the last translations stay on this device only (local app storage) so any of them can be
// copied again in its format. Only the German result and a short title are kept, never the audio.
const historyStorageKey='translator.history', HISTORY_LIMIT=30;
function readHistory(){try{const list=JSON.parse(localStorage.getItem(historyStorageKey)||'[]');return Array.isArray(list)?list:[];}catch{return [];}}
function writeHistory(list) {
  // Long scripts can fill the storage; drop the oldest entries until it fits.
  for(;;) {
    try{localStorage.setItem(historyStorageKey,JSON.stringify(list));return;}
    catch{if(list.length<=1)return;list=list.slice(0,-1);}
  }
}
function saveHistory(tab) {
  // Titles skip transcript markers like [Music] and timestamps.
  const source=tab.source.replace(/\[[^\]]{1,30}\]/g,' ').replace(/(?<![\d:])(?:\d{1,2}:)?\d{1,2}:\d{2}(?![\d:])/g,' ').trim(), {seconds}=scriptLength(tab);
  const title=tab.fileName || source.split(/\s+/).slice(0,8).join(' ')+(source.split(/\s+/).length>8?' …':'');
  const entry={id:tab.id,date:new Date().toISOString(),title,output:tab.output,seconds,kind:formatOf(tab)};
  writeHistory([entry,...readHistory().filter(item=>item.id!==tab.id)].slice(0,HISTORY_LIMIT));
  renderHistory();
}
function updateHistoryKind(tab) {
  const list=readHistory(), entry=list.find(item=>item.id===tab.id);
  if(entry){entry.kind=formatOf(tab);writeHistory(list);renderHistory();}
}
function renderHistory() {
  const list=readHistory();
  $('history-empty').hidden=list.length>0;$('history-clear').hidden=!list.length;
  $('history-list').replaceChildren(...list.map(entry=>{
    const item=document.createElement('li'), button=document.createElement('button');
    button.type='button';button.className='history-item';
    const title=document.createElement('span');title.className='history-title';title.textContent=entry.title||'Ohne Titel';
    const meta=document.createElement('span');meta.className='history-meta';
    const when=new Date(entry.date).toLocaleString('de-DE',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    meta.textContent=`${when} · ${entry.kind==='short'?'Shortform':'Longform'} · ${clock(entry.seconds||0)} Min`;
    button.append(title,meta);
    button.setAttribute('aria-label',`${entry.title}, ${meta.textContent}, kopieren`);
    button.onclick=async()=>{
      try{const payload=payloadFor(entry);await writeClipboard(payload);toast(copiedMessage(payload.board));}
      catch{status('Kopieren nicht möglich. Bitte erneut versuchen.',true);}
    };
    item.append(button);return item;
  }));
}
$('history-clear').onclick=()=>{try{localStorage.removeItem(historyStorageKey);}catch{}renderHistory();};
renderHistory();
// Progress veil: playful phrases about what happens to the script, each acted out by the scribble,
// plus a bar that creeps towards the next milestone. It shows only on the tab being processed and
// lasts exactly as long as the work.
const PHRASES=[
  ['Kitzle die Pointen heraus','sparkle'],['Bügle die Absätze glatt','iron'],['Sortiere die Gedanken','sort'],
  ['Schicke [Musik] nach Hause','sweep'],['Fädle deutsche Sätze auf','type'],['Poliere die Überschriften','sparkle'],
  ['Fette die Überschriften an','bold'],['Lege Aha-Momente schräg','slant'],['Streiche Füllwörter mit Gefühl','sweep'],
  ['Mache aus „Hey“ ein „Hallo“','type'],['Zähle heimlich die Kommas','bounce'],['Gönne den Absätzen eine Pause','iron'],
  ['Suche das eine richtige Wort','sparkle'],['Bringe die Sätze in Reih und Glied','sort'],['Übersetze ohne zu schummeln','type'],
  ['Wecke müde Verben auf','bounce'],['Lasse Anglizismen höflich los','sweep'],['Rücke Kernsätze ins rechte Licht','slant']
];
const LISTEN_PHRASES=[
  ['Spitze die Ohren','bounce'],['Lausche jedem Wort','type'],['Zähle heimlich die Ähms','bounce'],
  ['Schreibe fleißig mit','type'],['Trenne Musik von Worten','sweep'],['Sortiere die Silben','sort'],
  ['Poliere die Aussprache','sparkle'],['Höre zwischen den Zeilen','slant'],['Drehe die Lautstärke im Kopf auf','iron']
];
const WAIT_PHRASES=[['Wartet auf seinen Einsatz','bounce'],['Steht schon in den Startlöchern','type']];
// job: what the queue is doing right now, so the veil can be restored when its tab becomes visible again.
const job={tab:null,phrases:PHRASES,target:0,cap:0,detail:''};
const progress={target:0,shown:0,cap:0,timer:null,phraseTimer:null,order:[],next:0,phrases:PHRASES,shownFor:null};
function showPhrase() {
  if(progress.next>=progress.order.length){progress.order=[...progress.phrases].sort(()=>Math.random()-0.5);progress.next=0;}
  const [text,anim]=progress.order[progress.next++];
  $('progress-text').classList.add('swap');
  setTimeout(()=>{$('progress-text').textContent=text;$('scribble').dataset.anim=anim;$('progress-text').classList.remove('swap');},140);
}
function showVeil(phrases,target,cap,detail) {
  clearInterval(progress.timer);clearInterval(progress.phraseTimer);
  Object.assign(progress,{target,shown:target,cap:Math.max(cap,target),next:Infinity,phrases});
  $('progress-fill').style.transform=`scaleX(${target.toFixed(3)})`;
  $('progress-detail').hidden=!detail;$('progress-detail').textContent=detail;
  showPhrase();$('progress').hidden=false;requestAnimationFrame(()=>$('progress').classList.add('visible'));
  progress.phraseTimer=setInterval(showPhrase,2400);
  progress.timer=setInterval(()=>{
    progress.shown=Math.max(progress.target,progress.shown+(progress.cap-progress.shown)*0.04);
    $('progress-fill').style.transform=`scaleX(${progress.shown.toFixed(3)})`;
  },300);
}
// No artificial pause: the veil goes the moment the work ends; its fade runs on its own.
function hideVeil() {
  clearInterval(progress.timer);clearInterval(progress.phraseTimer);progress.shownFor=null;
  $('progress').classList.remove('visible');
  setTimeout(()=>{if(!progress.shownFor)$('progress').hidden=true;},180);
}
function veilFor(tab) {
  const key=tab.state==='running'?`${tab.id}:${job.phrases===LISTEN_PHRASES?'listen':'translate'}`:tab.state==='queued'?`${tab.id}:wait`:null;
  if(!key)return hideVeil();
  if(progress.shownFor===key)return;
  if(tab.state==='queued')showVeil(WAIT_PHRASES,0,0,'Kommt gleich dran');
  else showVeil(job.phrases,job.target,job.cap,job.detail);
  progress.shownFor=key;
}
// Progress of the running job; only drawn when its tab is visible.
function jobStep(tab,{target,cap=target,detail}) {
  job.target=Math.max(job.target,target);job.cap=Math.max(job.cap,cap,job.target);
  if(detail!==undefined)job.detail=detail;
  if(tab!==cur())return;
  progress.target=Math.max(progress.target,job.target);progress.cap=Math.max(progress.cap,job.cap);
  if(detail!==undefined){$('progress-detail').hidden=!detail;$('progress-detail').textContent=detail;}
}
function jobPhase(tab,phrases,detail='') {
  Object.assign(job,{tab,phrases,target:0.04,cap:0.1,detail});
  if(tab===cur()){progress.shownFor=null;veilFor(tab);}
}
// Local transcription: the audio track is decoded here, Whisper runs in a worker. Nothing is uploaded.
const MEDIA_PATTERN=/\.(mp4|m4v|mov|m4a|mp3|wav|aac|webm|ogg|oga|opus|flac|mkv)$/i;
const isMedia=file=>/^(audio|video)\//.test(file.type) || MEDIA_PATTERN.test(file.name);
let transcriber=null;
async function decodeAudio(file) {
  const context=new AudioContext({sampleRate:16000});
  try {
    const decoded=await context.decodeAudioData(await file.arrayBuffer());
    const audio=new Float32Array(decoded.length);
    for(let channel=0;channel<decoded.numberOfChannels;channel++) {
      const data=decoded.getChannelData(channel);
      for(let i=0;i<data.length;i++)audio[i]+=data[i]/decoded.numberOfChannels;
    }
    return audio;
  } catch {
    throw new Error('Die Tonspur dieser Datei lässt sich nicht lesen. Bitte MP4, MOV, M4A, MP3, WAV oder WebM verwenden.');
  } finally {context.close();}
}
function runWhisper(audio,signal,tab) {
  return new Promise((resolve,reject)=>{
    transcriber ||= new Worker('/transcribe-worker.js',{type:'module'});
    const worker=transcriber;
    const stop=()=>{worker.terminate();if(transcriber===worker)transcriber=null;reject(new DOMException('Abgebrochen.','AbortError'));};
    signal.addEventListener('abort',stop,{once:true});
    worker.onerror=event=>{signal.removeEventListener('abort',stop);event.preventDefault();transcriber=null;worker.terminate();reject(new Error('Die lokale Spracherkennung konnte nicht starten.'));};
    worker.onmessage=({data})=>{
      const mb=n=>Math.round(n/1e6);
      if(data.type==='download')jobStep(tab,{target:0.04+0.26*data.loaded/data.total,cap:0.3,detail:`Lade Spracherkennung (einmalig) · ${mb(data.loaded)} von ${mb(data.total)} MB`});
      if(data.type==='chunks')jobStep(tab,{target:0.3+0.68*data.done/data.total,cap:0.3+0.68*(data.done+1)/data.total-0.02,detail:data.total>1?`Transkribiere · ${data.done} von ${data.total} Abschnitten`:'Transkribiere'});
      if(data.type==='done'||data.type==='error') {
        signal.removeEventListener('abort',stop);
        if(data.type==='done')resolve(data.text);else reject(new Error(`Transkription fehlgeschlagen: ${data.error}`));
      }
    };
    worker.postMessage({type:'transcribe',audio},[audio.buffer]);
  });
}
async function transcribeTab(tab,signal) {
  jobPhase(tab,LISTEN_PHRASES,'Lese die Tonspur');
  const audio=await decodeAudio(tab.file);
  signal.throwIfAborted();
  if(!audio.length)throw new Error('Die Datei enthält keine Tonspur.');
  tab.mediaSeconds=audio.length/16000;
  tab.source=await runWhisper(audio,signal,tab);
  tab.file=null;   // the video itself is not kept; only its transcript
  if(tab===cur())$('source').value=tab.source;
}
async function translateTab(tab,signal) {
  jobPhase(tab,PHRASES);
  const response=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json','X-Local-CSRF':csrf},signal,body:JSON.stringify({provider,text:tab.source,prompt:$('prompt').value,model:$('model').value})});
  if(!response.ok){const data=await response.json();throw new Error(data.error || 'Übersetzung fehlgeschlagen.');}
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',result=null;
  function event(line) {
    if(!line.trim())return;
    const item=JSON.parse(line);
    if(item.type==='error')throw new Error(item.error);
    if(item.type==='progress') {
      const {done,total}=item;
      jobStep(tab,{target:done<total?0.1+0.8*done/total:0.94,cap:done<total?0.1+0.8*(done+1)/total-0.02:0.98,detail:total>1?`${done} von ${total} Teilen fertig`:''});
    }
    if(item.type==='completed') {
      if(typeof item.text!=='string'||!item.text.trim())throw new Error('Leere Übersetzung.');
      result=item.text;
    }
  }
  while(true) {
    const {value,done}=await reader.read();if(done)break;
    buffer+=decoder.decode(value,{stream:true});let index;
    while((index=buffer.indexOf('\n'))>=0){event(buffer.slice(0,index));buffer=buffer.slice(index+1);}
  }
  buffer+=decoder.decode();if(buffer.trim())event(buffer);
  if(!result)throw new Error('Verbindung abgebrochen. Keine vollständige Übersetzung erhalten.');
  return result;
}
const providerReady=()=>provider==='chatgpt'?connected && !!$('model').value:!!claudeState?.ready;
let jobController=null;
// One job at a time: the local server translates one text at a time anyway.
async function runQueue() {
  if(busy)return;
  busy=true;update();
  try {
    for(;;) {
      const tab=tabs.find(item=>item.state==='queued');
      if(!tab)break;
      tab.state='running';tab.error='';jobController=new AbortController();const signal=jobController.signal;
      if(tab===cur())render();else renderDots();
      try {
        if(tab.file)await transcribeTab(tab,signal);
        if(!providerReady()){tab.state='idle';tab.error='Englisches Transkript fertig. Zum Übersetzen einen Anbieter verbinden.';continue;}
        tab.output=await translateTab(tab,signal);
        tab.state='idle';tab.language='german';
        saveHistory(tab);
        finished(tab);
      } catch(error) {
        tab.state='idle';tab.output='';
        tab.error=error.name==='AbortError'?'Abgebrochen. Keine vollständige Übersetzung erstellt.':error.message;
        if(error.name!=='AbortError' && !tab.file)init();
      } finally {
        if(job.tab===tab)job.tab=null;
        jobController=null;
        if(tabs.includes(tab) && tab===cur())render();else renderDots();
      }
    }
  } finally {busy=false;running=cur().state!=='idle';update();}
}
// One tab copies itself as before; with several tabs nothing overwrites the clipboard, a toast reports.
function finished(tab) {
  if(!tabs.includes(tab))return;
  if(tabs.length===1 && tab===cur()){render();copy({automatic:true});return;}
  toast(`Tab ${tabs.indexOf(tab)+1} fertig`);
}
function queueTab(tab) {
  Object.assign(tab,{state:'queued',output:'',error:''});
  if(tab===cur())render();else renderDots();
  runQueue();
}
// Only a plain-text estimate close to the 3-minute line is unclear (speaking pace varies roughly
// 130 to 180 words per minute); then the user picks the format once before translating.
const UNCLEAR_SECONDS=[120,240];
function formatUnclear(tab=cur()) {
  const {seconds,basis}=scriptLength(tab);
  return !tab.formatOverride && basis==='estimate' && seconds>=UNCLEAR_SECONDS[0] && seconds<=UNCLEAR_SECONDS[1];
}
function startTranslation() {
  if($('format-choice').open)return;
  if(!formatUnclear())return queueTab(cur());
  $('format-choice').showModal();
}
// The buttons act on click directly; the dialog's close event can be deferred while the window is hidden.
for(const button of $('format-choice').querySelectorAll('[data-format]'))button.onclick=()=>{
  cur().formatOverride=button.dataset.format;$('format-choice').close();queueTab(cur());
};
// Several files: the first fills the visible tab if it is empty, every further file gets a tab to the right.
function addFiles(fileList) {
  const files=[...fileList].filter(isMedia);
  if(!files.length){if(fileList.length)status('Bitte eine Video- oder Audiodatei wählen.',true);return;}
  let insertAt=active+1, first=null;
  files.forEach((file,i)=>{
    const tab=Object.assign(newTab(),{file,fileName:file.name,state:'queued'});
    if(i===0 && isEmptyTab(cur()))tabs[active]=tab;else tabs.splice(insertAt++,0,tab);
    first ??= tab;
  });
  const index=tabs.indexOf(first), motion=index===active?'':'slide-left';
  active=index;render(motion);renderDots();runQueue();
}
$('file-input').onchange=()=>{const files=$('file-input').files;addFiles(files);$('file-input').value='';};
const editorWrap=document.querySelector('.editor-wrap');
let dragDepth=0;
const hasFiles=event=>[...(event.dataTransfer?.types||[])].includes('Files');
document.addEventListener('dragenter',event=>{if(!hasFiles(event))return;dragDepth++;editorWrap.dataset.drop='on';});
document.addEventListener('dragleave',event=>{if(!hasFiles(event))return;dragDepth=Math.max(0,dragDepth-1);if(!dragDepth)delete editorWrap.dataset.drop;});
document.addEventListener('dragover',event=>{if(hasFiles(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}});
document.addEventListener('drop',event=>{
  if(!hasFiles(event))return;
  event.preventDefault();dragDepth=0;delete editorWrap.dataset.drop;
  addFiles(event.dataTransfer.files);
});
$('action').onclick=()=>{
  const tab=cur();
  if(tab.state==='running'){jobController?.abort();return;}
  if(tab.state==='queued'){tab.state='idle';tab.error='';render();return;}
  if(language==='german')return copy();
  if(!$('action').disabled)return startTranslation();
};
// Keyboard: Cmd/Ctrl+Enter runs the main action, Cmd/Ctrl+Backspace clears, Cmd/Ctrl+, opens settings,
// Cmd/Ctrl+T opens a tab, Cmd/Ctrl+arrows switch tabs (and open one at either end), Shift+Tab (main area),
// Ctrl+Tab or Cmd+Shift+[ ] switch language (Cmd+Tab belongs to macOS). Paste and copy need no focused field.
const isField=element=>element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement;
document.addEventListener('keydown',event=>{
  const mod=event.metaKey||event.ctrlKey;
  const dialogOpen=!!document.querySelector('dialog[open]');
  const inOverlay=dialogOpen || $('settings').matches(':popover-open');
  if(mod&&event.key==='Enter'&&!$('action').disabled&&!dialogOpen){event.preventDefault();$('action').click();return;}
  if(mod&&event.key===','){event.preventDefault();$('settings').togglePopover();return;}
  if(mod&&event.key.toLowerCase()==='o'&&!dialogOpen){event.preventDefault();$('file-input').click();return;}
  if(mod&&event.key.toLowerCase()==='t'&&!inOverlay){event.preventDefault();openTab('after');return;}
  if(mod&&!event.shiftKey&&!event.altKey&&(event.key==='ArrowLeft'||event.key==='ArrowRight')&&!inOverlay){event.preventDefault();step(event.key==='ArrowLeft'?-1:1);return;}
  if(mod&&event.key==='Backspace'&&!inOverlay&&!$('clear').disabled){event.preventDefault();$('clear').click();return;}
  // Shift+Tab keeps its usual focus role inside settings and dialogs.
  const shiftTab=event.shiftKey&&!mod&&!event.altKey&&event.key==='Tab'&&!inOverlay;
  const tabSwitch=event.ctrlKey&&!event.metaKey&&event.key==='Tab';
  const bracketSwitch=event.metaKey&&event.shiftKey&&(event.code==='BracketLeft'||event.code==='BracketRight');
  if((shiftTab||tabSwitch||bracketSwitch)&&!running&&!dialogOpen) {
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
  if(!cur().output)return;
  event.preventDefault();
  const {text,html,board}=clipboardPayload();
  event.clipboardData.setData('text/plain',text);
  event.clipboardData.setData('text/html',html);
  toast(copiedMessage(board));
});
init();
