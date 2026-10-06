// Runs Kokoro in a background thread so the page never freezes while the
// model loads or while speech is being generated.
import { KokoroTTS } from 'kokoro-js'

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'
let tts: any = null
let loading: Promise<any> | null = null

async function load() {
  if (tts) return tts
  if (loading) return loading
  const progress_callback = (p: any) => {
    if (p?.status === 'progress' && typeof p.progress === 'number') {
      self.postMessage({ type: 'progress', value: Math.round(p.progress) })
    }
  }
  loading = (async () => {
    const hasWebGPU = typeof (self as any).navigator !== 'undefined' && 'gpu' in (self as any).navigator
    try {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: hasWebGPU ? 'fp32' : 'q8',
        device: hasWebGPU ? 'webgpu' : 'wasm',
        progress_callback
      })
    } catch {
      tts = await KokoroTTS.from_pretrained(MODEL_ID, { dtype: 'q8', device: 'wasm', progress_callback })
    }
    return tts
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

self.onmessage = async (e: MessageEvent) => {
  const { id, text, voice } = e.data
  try {
    self.postMessage({ type: 'loading' })
    const model = await load()
    self.postMessage({ type: 'ready' })
    const audio = await model.generate(text, { voice })
    const blob: Blob = audio.toBlob()
    self.postMessage({ type: 'audio', id, blob })
  } catch (err: any) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err) })
  }
}
