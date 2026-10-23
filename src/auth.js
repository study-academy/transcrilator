import { randomBytes, createHash, createPublicKey, verify, timingSafeEqual } from 'node:crypto';
const ISSUER = 'https://auth.openai.com';
const RESOURCE = 'https://api.openai.com/v1';
const SCOPE = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const random = () => randomBytes(32).toString('base64url');
export async function validateIdToken(jwt, {clientId, nonce, fetcher = fetch}) {
  if (typeof jwt !== 'string' || jwt.length > 32000) throw new Error('Ungültiges ID-Token.');
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('Ungültiges ID-Token.');
  const header = JSON.parse(Buffer.from(parts[0],'base64url'));
  const claims = JSON.parse(Buffer.from(parts[1],'base64url'));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new Error('Nicht unterstützte Token-Signatur.');
  const res = await fetcher(`${ISSUER}/.well-known/jwks.json`, {signal:AbortSignal.timeout(15000)});
  if (!res.ok) throw new Error('Signaturprüfung nicht erreichbar.');
  const {keys} = await res.json();
  const key = keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
  if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({key, format:'jwk'}), Buffer.from(parts[2],'base64url'))) throw new Error('Ungültige Token-Signatur.');
  const now = Date.now()/1000;
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !audience.includes(clientId) || ((audience.length > 1 || claims.azp) && claims.azp !== clientId) || !Number.isFinite(claims.exp) || claims.exp <= now || (claims.nbf && claims.nbf > now) || !claims.sub || claims.nonce !== nonce) throw new Error('ID-Token stimmt nicht mit der Anmeldung überein.');
  return claims;
}
export class ChatGPTConnection {
  constructor({hostId, registration, saveRegistration = async () => {}, fetcher = fetch}) {
    this.hostId=hostId; this.registration=registration; this.saveRegistration=saveRegistration; this.fetcher=fetcher;
    this.retryClientId=null; this.pending=null; this.credentials=null; this.lastError=''; this.welcome=false;
  }
  start(redirectUri) {
    const state=random(), nonce=random(), verifier=random();
    const clientId=this.registration?.clientId || this.retryClientId;
    this.pending={state,nonce,verifier,redirectUri,clientId,subject:this.registration?.subject,expires:Date.now()+600000};
    this.lastError='';
    const params = new URLSearchParams({client_id:clientId || 'dynamic_agent_client',ext_agent_host_id:this.hostId,response_type:'code',redirect_uri:redirectUri,scope:SCOPE,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')});
    if (!clientId) params.set('agent_name_hint','Local English German Translator');
    return `${ISSUER}/api/accounts/authorize?${params}`;
  }
  async callback(params) {
    const p=this.pending;
    const state=params.get('state') || '';
    if (!p || p.expires < Date.now() || state.length !== p.state.length || !timingSafeEqual(Buffer.from(state),Buffer.from(p.state))) throw new Error('Anmeldung abgelaufen oder ungültiger Rückruf.');
    this.pending=null;
    if (params.has('error')) throw new Error('ChatGPT-Anmeldung wurde nicht freigegeben.');
    const issued=params.get('client_id') || p.clientId;
    if (!issued || issued === 'dynamic_agent_client' || (p.clientId && issued !== p.clientId) || !params.get('code')) throw new Error('Unvollständige oder abweichende Client-Registrierung.');
    this.retryClientId=issued;
    const response=await this.fetcher(`${ISSUER}/api/accounts/oauth/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(30000),body:new URLSearchParams({grant_type:'authorization_code',client_id:issued,code:params.get('code'),code_verifier:p.verifier,redirect_uri:p.redirectUri,resource:RESOURCE})});
    if (!response.ok) { await response.body?.cancel(); throw new Error('Token-Austausch fehlgeschlagen. Bitte die Verbindung erneut ausdrücklich starten.'); }
    const data=await response.json();
    const identity=await validateIdToken(data.id_token,{clientId:issued,nonce:p.nonce,fetcher:this.fetcher});
    if (p.subject && identity.sub !== p.subject) throw new Error('Diese Registrierung gehört zu einem anderen ChatGPT-Konto.');
    const scopes=typeof data.scope === 'string' ? data.scope.split(' ') : [];
    if (!scopes.includes('chatgpt.tokens.use.direct') || !scopes.includes('resource.invoke') || data.token_type?.toLowerCase() !== 'bearer' || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error('ChatGPT-Plannutzung wurde nicht freigegeben.');
    const registration={clientId:issued,subject:identity.sub,welcomed:!!this.registration?.welcomed};
    await this.saveRegistration(registration);
    this.registration=registration;
    this.retryClientId=null;
    this.credentials={accessToken:data.access_token,expires:Date.now()+data.expires_in*1000};
    this.welcome=!registration.welcomed;
  }
  token() {
    if (!this.credentials || this.credentials.expires <= Date.now()+5000) { this.credentials=null; throw new Error('Bitte mit ChatGPT verbinden. Die Sitzung ist nicht verbunden oder abgelaufen.'); }
    return this.credentials.accessToken;
  }
  status() { return {connected:!!this.credentials && this.credentials.expires>Date.now()+5000,welcome:this.welcome,error:this.lastError}; }
  async acknowledge() { if (this.registration) { this.registration.welcomed=true; await this.saveRegistration(this.registration); } this.welcome=false; }
  disconnect() { this.credentials=null; this.pending=null; this.lastError=''; }
}
