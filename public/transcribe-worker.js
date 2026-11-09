// Local speech recognition with Whisper, off the main thread. Audio never leaves the machine;
// only the model files are downloaded once from Hugging Face and then served from the browser cache.
import {pipeline, env, AutoProcessor, WhisperForConditionalGeneration, Tensor} from '/vendor/transformers.min.js';

import './transcript-quality.js';
const CHUNK_S = 30, STRIDE_S = 5, RATE = 16000;
env.allowLocalModels = false;
// transformers.js 4.3 always loads the asyncify build of the ONNX runtime (WebGPU and CPU).
// Absolute same-origin URLs let it import the runtime directly instead of through a blob: copy.
const vendor = name => new URL('/vendor/' + name, self.location.origin).href;
env.backends.onnx.wasm.wasmPaths = {mjs: vendor('ort-wasm-simd-threaded.asyncify.mjs'), wasm: vendor('ort-wasm-simd-threaded.asyncify.wasm')};

let recognizer = null, device = null, loadedLanguage = null, detector = null;
// Reports one combined download progress across all model files of a load.
function downloadProgress() {
  const files = new Map();
  return info => {
    if (info.status === 'progress' && info.total) {
      files.set(info.file, {loaded: info.loaded, total: info.total});
      let loaded = 0, total = 0;
      for (const file of files.values()) { loaded += file.loaded; total += file.total; }
      postMessage({type: 'download', loaded, total});
    }
  };
}
// Spoken language from the first 30 s: one decoder step of the small multilingual Whisper tiny model,
// comparing only the German and English language tokens. The pipeline itself cannot detect the language
// (a multilingual model without a language defaults to English).
const DETECT_MODEL = 'onnx-community/whisper-tiny';
async function detect(audio) {
  detector ||= await Promise.all([
    AutoProcessor.from_pretrained(DETECT_MODEL, {progress_callback: downloadProgress()}),
    WhisperForConditionalGeneration.from_pretrained(DETECT_MODEL, {device: 'wasm', dtype: 'q8', progress_callback: downloadProgress()})
  ]);
  const [processor, model] = detector;
  const {input_features} = await processor(audio.subarray(0, CHUNK_S * RATE));
  const config = model.generation_config;
  const start = new Tensor('int64', BigInt64Array.from([BigInt(config.decoder_start_token_id)]), [1, 1]);
  const {logits} = await model({input_features, decoder_input_ids: start});
  const de = logits.data[config.lang_to_id['<|de|>']], en = logits.data[config.lang_to_id['<|en|>']];
  return {language: de > en ? 'de' : 'en', margin: Math.abs(de - en)};
}
async function load(language) {
  if (recognizer && loadedLanguage===language) return recognizer;
  if(recognizer){await recognizer.dispose();recognizer=null;}
  const config=globalThis.transcriptionConfig(language);
  const progress_callback = downloadProgress();
  // WebGPU runs Whisper on the Apple Silicon GPU; without it the quantised model runs on the CPU.
  const gpu = typeof navigator !== 'undefined' && navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null);
  const options = gpu && language==='en'
    ? {device: 'webgpu', dtype: {encoder_model: 'fp16', decoder_model_merged: 'q4'}, progress_callback}
    : {device: 'wasm', dtype: 'q8', progress_callback};
  device=options.device;
  recognizer = await pipeline('automatic-speech-recognition', config.model, options);
  loadedLanguage=language;
  return recognizer;
}

self.onmessage = async ({data}) => {
  if (data?.type !== 'transcribe' || !(data.audio instanceof Float32Array)) return;
  try {
    let language = data.language;
    if (language === 'auto') {
      const detected = await detect(data.audio);
      language = detected.language;
      postMessage({type: 'language', ...detected});
    }
    const config=globalThis.transcriptionConfig(language);
    const asr = await load(config.language);
    const window = CHUNK_S * RATE, jump = (CHUNK_S - 2 * STRIDE_S) * RATE;
    const total = data.audio.length <= window ? 1 : 1 + Math.ceil((data.audio.length - window) / jump);
    let done = 0;
    postMessage({type: 'chunks', done, total});
    // The pipeline calls end() once per 30 s chunk it has decoded.
    const streamer = {put() {}, end() { postMessage({type: 'chunks', done: Math.min(++done, total), total}); }};
    const output = await asr(data.audio, {...config.generation,chunk_length_s: CHUNK_S, stride_length_s: STRIDE_S, streamer});
    const text = (output?.text || '').trim();
    if (!text) throw new Error('In der Tonspur wurde keine Sprache erkannt.');
    postMessage({type: 'done', text, metadata:{model:config.model,language:config.language,task:config.task,device,chunkSeconds:CHUNK_S,strideSeconds:STRIDE_S}});
  } catch (error) {
    postMessage({type: 'error', error: error?.message || String(error)});
  }
};
