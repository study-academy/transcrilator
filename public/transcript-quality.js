// Conservative review warning; repeated speech can be intentional. Never discard text.
function repetitiveTranscript(text) {
  const words=text.toLowerCase().match(/[\p{L}\p{N}']+/gu)||[];
  for(let size=4;size<=16;size++) {
    for(let start=0;start+size*4<=words.length;start++) {
      const phrase=words.slice(start,start+size).join(' ');
      if([1,2,3].every(n=>words.slice(start+n*size,start+(n+1)*size).join(' ')===phrase))return true;
    }
  }
  return false;
}
globalThis.repetitiveTranscript=repetitiveTranscript;

function transcriptionConfig(language='en') {
  if(!['en','de'].includes(language))throw new Error('Bitte Deutsch oder Englisch als Videosprache wählen.');
  return language==='de'
    ? {model:'onnx-community/whisper-small',language:'de',task:'transcribe',generation:{language:'german',task:'transcribe'}}
    : {model:'onnx-community/whisper-small.en',language:'en',task:'transcribe',generation:{}};
}
globalThis.transcriptionConfig=transcriptionConfig;
