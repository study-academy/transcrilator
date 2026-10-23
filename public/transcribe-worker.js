// Local speech recognition with Whisper, off the main thread. Audio never leaves the machine;
// only the model files are downloaded once from Hugging Face and then served from the browser cache.
import {pipeline, env} from '/vendor/transformers.min.js';

const MODEL = 'onnx-community/whisper-small.en';
const CHUNK_S = 30, STRIDE_S = 5, RATE = 16000;
env.allowLocalModels = false;
// transformers.js 4.3 always loads the asyncify build of the ONNX runtime (WebGPU and CPU).
// Absolute same-origin URLs let it import the runtime directly instead of through a blob: copy.
const vendor = name => new URL('/vendor/' + name, self.location.origin).href;
env.backends.onnx.wasm.wasmPaths = {mjs: vendor('ort-wasm-simd-threaded.asyncify.mjs'), wasm: vendor('ort-wasm-simd-threaded.asyncify.wasm')};

let recognizer = null;
async function load() {
  if (recognizer) return recognizer;
  const files = new Map();
  const progress_callback = info => {
    if (info.status === 'progress' && info.total) {
      files.set(info.file, {loaded: info.loaded, total: info.total});
      let loaded = 0, total = 0;
      for (const file of files.values()) { loaded += file.loaded; total += file.total; }
      postMessage({type: 'download', loaded, total});
    }
  };
  // WebGPU runs Whisper on the Apple Silicon GPU; without it the quantised model runs on the CPU.
  const gpu = typeof navigator !== 'undefined' && navigator.gpu && await navigator.gpu.requestAdapter().catch(() => null);
  const options = gpu
    ? {device: 'webgpu', dtype: {encoder_model: 'fp16', decoder_model_merged: 'q4'}, progress_callback}
    : {device: 'wasm', dtype: 'q8', progress_callback};
  recognizer = await pipeline('automatic-speech-recognition', MODEL, options);
  return recognizer;
}

self.onmessage = async ({data}) => {
  if (data?.type !== 'transcribe' || !(data.audio instanceof Float32Array)) return;
  try {
    const asr = await load();
    const window = CHUNK_S * RATE, jump = (CHUNK_S - 2 * STRIDE_S) * RATE;
    const total = data.audio.length <= window ? 1 : 1 + Math.ceil((data.audio.length - window) / jump);
    let done = 0;
    postMessage({type: 'chunks', done, total});
    // The pipeline calls end() once per 30 s chunk it has decoded.
    const streamer = {put() {}, end() { postMessage({type: 'chunks', done: Math.min(++done, total), total}); }};
    const output = await asr(data.audio, {chunk_length_s: CHUNK_S, stride_length_s: STRIDE_S, streamer});
    const text = (output?.text || '').trim();
    if (!text) throw new Error('In der Tonspur wurde keine Sprache erkannt.');
    postMessage({type: 'done', text});
  } catch (error) {
    postMessage({type: 'error', error: error?.message || String(error)});
  }
};
