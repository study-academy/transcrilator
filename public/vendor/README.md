# Vendored libraries for local transcription

Copied unchanged from the npm packages so the app never loads code from a CDN:

| File | Package | License |
|---|---|---|
| `transformers.min.js` | `@huggingface/transformers@4.3.1` (`dist/`) | Apache-2.0, see `LICENSE-transformers.js.txt` |
| `ort-wasm-simd-threaded.asyncify.mjs`, `ort-wasm-simd-threaded.asyncify.wasm` | `onnxruntime-web@1.31.0-dev.20260914-8d85527a0` (`dist/`), the version bundled by transformers.js 4.3.1 | MIT, see `LICENSE-onnxruntime-web.txt` |

To update, run `npm pack` for both packages and copy the same files from their `dist/` folders.
