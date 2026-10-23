import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,createHash} from 'node:crypto';
import {ChatGPTConnection} from '../src/auth.js';
const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test',use:'sig',alg:'RS256'};
function jwt(claims,wrongSignature=false){const header=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url');const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');const text=`${header}.${payload}`;return `${text}.${wrongSignature?Buffer.from('wrong').toString('base64url'):sign('RSA-SHA256',Buffer.from(text),privateKey).toString('base64url')}`;}
function fixture({claims={},scopes='openid resource.invoke chatgpt.tokens.use.direct',signature=false,registration,fail=false}={}){
 let authorization,exchange,calls=0,persisted;
 const connection=new ChatGPTConnection({hostId:'urn:uuid:test',registration,saveRegistration:async value=>{persisted=value;},fetcher:async(url,options)=>{
  calls++;
  if(url.endsWith('jwks.json'))return Response.json({keys:[jwk]});
  exchange=new URLSearchParams(options.body);
  if(fail)return Response.json({error:'invalid_grant'},{status:400});
  return Response.json({access_token:'FAKE_ACCESS_TOKEN',refresh_token:'FAKE_REFRESH_TOKEN',token_type:'Bearer',expires_in:3600,scope:scopes,id_token:jwt({iss:'https://auth.openai.com',aud:'oaiapp_test',exp:Math.floor(Date.now()/1000)+3600,sub:'test-user',nonce:authorization.searchParams.get('nonce'),...claims},signature)});
 }});
 authorization=new URL(connection.start('http://127.0.0.1:4317/auth/callback'));
 const callback=(extra={})=>new URLSearchParams({state:authorization.searchParams.get('state'),code:'fake-code',client_id:'oaiapp_test',...extra});
 return {connection,authorization,callback,get exchange(){return exchange;},get calls(){return calls;},get persisted(){return persisted;}};
}
test('PKCE registration exchanges issued ID and exact loopback URI, validates JWKS and retains tokens only in memory',async()=>{
 const f=fixture();assert.equal(f.authorization.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(f.authorization.searchParams.get('code_challenge_method'),'S256');
 await f.connection.callback(f.callback());assert.equal(f.exchange.get('client_id'),'oaiapp_test');assert.equal(f.exchange.get('redirect_uri'),'http://127.0.0.1:4317/auth/callback');
 assert.equal(createHash('sha256').update(f.exchange.get('code_verifier')).digest('base64url'),f.authorization.searchParams.get('code_challenge'));
 assert.equal(f.connection.token(),'FAKE_ACCESS_TOKEN');assert.equal(f.connection.status().welcome,true);
 assert.ok(!JSON.stringify(f.persisted).includes('TOKEN'));assert.ok(!JSON.stringify(f.connection.status()).includes('TOKEN'));
 await f.connection.acknowledge();assert.equal(f.persisted.welcomed,true);f.connection.disconnect();assert.throws(()=>f.connection.token(),/verbinden/);
});
for(const [name,options] of [
 ['signature',{signature:true}],['issuer',{claims:{iss:'https://evil.invalid'}}],['audience',{claims:{aud:'wrong'}}],['expiry',{claims:{exp:0}}],['nonce',{claims:{nonce:'wrong'}}],['subject',{claims:{sub:''}}],['missing permission',{scopes:'openid resource.invoke'}],['exchange failure',{fail:true}]
])test(`rejects invalid ${name}`,async()=>{const f=fixture(options);await assert.rejects(f.connection.callback(f.callback()));assert.equal(f.connection.status().connected,false);});
test('state mismatch never exchanges code and does not consume valid pending attempt',async()=>{const f=fixture();await assert.rejects(f.connection.callback(f.callback({state:'wrong'})));assert.equal(f.calls,0);await f.connection.callback(f.callback());});
test('access denied consumes attempt and never exchanges, replay rejected',async()=>{const f=fixture();await assert.rejects(f.connection.callback(f.callback({error:'access_denied'})));assert.equal(f.calls,0);await assert.rejects(f.connection.callback(f.callback()));});
test('expired pending attempt rejected',async()=>{const f=fixture();f.connection.pending.expires=0;await assert.rejects(f.connection.callback(f.callback()));assert.equal(f.calls,0);});
test('registration without issued client ID rejected',async()=>{const f=fixture();const cb=f.callback();cb.delete('client_id');await assert.rejects(f.connection.callback(cb));assert.equal(f.calls,0);});
test('returning registration reuses issued ID and rejects changed identity or client ID',async()=>{
 const registration={clientId:'oaiapp_test',subject:'test-user',welcomed:true};
 const f=fixture({registration});assert.equal(f.authorization.searchParams.get('client_id'),'oaiapp_test');assert.equal(f.authorization.searchParams.has('agent_name_hint'),false);
 const cb=f.callback();cb.delete('client_id');await f.connection.callback(cb);assert.equal(f.connection.status().welcome,false);
 const g=fixture({registration});await assert.rejects(g.connection.callback(g.callback({client_id:'oaiapp_other'})));assert.equal(g.calls,0);
 const h=fixture({registration,claims:{sub:'someone-else'}});await assert.rejects(h.connection.callback(h.callback()));
});
test('failed exchange retains issued client ID in memory for explicit retry, without saving tokens',async()=>{
 const f=fixture({fail:true});await assert.rejects(f.connection.callback(f.callback()));
 const retry=new URL(f.connection.start('http://127.0.0.1:4317/auth/callback'));
 assert.equal(retry.searchParams.get('client_id'),'oaiapp_test');assert.equal(retry.searchParams.has('agent_name_hint'),false);assert.equal(f.persisted,undefined);
});
test('expired access token requires explicit reconnect',async()=>{const f=fixture();await f.connection.callback(f.callback());f.connection.credentials.expires=0;assert.equal(f.connection.status().connected,false);assert.throws(()=>f.connection.token(),/verbinden/);});
