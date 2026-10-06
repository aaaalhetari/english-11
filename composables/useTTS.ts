// Kokoro-82M neural voice in a Web Worker. Clips are kept in memory for this
// session only (never written to the device); words sent to the AI are voiced
// ahead of time in the background, so a tap plays instantly.

export const VOICE_OPTIONS = [
  { id: 'af_heart', label: 'Heart (US, female) - grade A' },
  { id: 'af_bella', label: 'Bella (US, female) - grade A-' },
  { id: 'bf_emma', label: 'Emma (UK, female) - grade B-' },
  { id: 'am_fenrir', label: 'Fenrir (US, male) - grade C+' },
  { id: 'am_michael', label: 'Michael (US, male) - grade C+' }
]

const downloading = ref(false)
const downloadProgress = ref(0)
const prefetching = ref(0)          // words still queued for pre-generation
const lastError = ref('')

let worker: Worker | null = null
let workerBroken = false
let nextId = 1
const pending = new Map<number, (b: Blob | null) => void>()
const urls = new Map<string, string>()   // key -> object URL (in-memory)

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/tts.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'loading') downloading.value = true
      else if (m.type === 'progress') { downloading.value = true; downloadProgress.value = m.value }
      else if (m.type === 'ready') downloading.value = false
      else if (m.type === 'audio' || m.type === 'error') {
        downloading.value = false
        if (m.type === 'error') lastError.value = m.message || 'voice failed'
        const done = pending.get(m.id)
        pending.delete(m.id)
        done?.(m.type === 'audio' ? m.blob : null)
      }
    }
    worker.onerror = () => {
      workerBroken = true
      downloading.value = false
      pending.forEach(r => r(null))
      pending.clear()
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

function generate(word: string, voice: string): Promise<Blob | null> {
  const w = getWorker()
  if (!w) return Promise.resolve(null)
  const id = nextId++
  return new Promise(resolve => {
    pending.set(id, resolve)
    w.postMessage({ id, text: word, voice })
  })
}

function speakFallback(word: string, repeat: number) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  for (let i = 0; i < repeat; i++) {
    const u = new SpeechSynthesisUtterance(word)
    u.lang = 'en-US'
    u.rate = 0.9
    window.speechSynthesis.speak(u)
  }
}

let current: HTMLAudioElement | null = null

function playUrl(url: string, repeat: number) {
  current?.pause()
  let left = repeat
  const audio = new Audio(url)
  current = audio
  audio.onended = () => {
    left--
    if (left > 0 && current === audio) {
      audio.currentTime = 0
      audio.play().catch(() => {})
    }
  }
  audio.play().catch(() => {})
}

export function useTTS() {
  const { voiceId, ttsRepeat, ttsPrefetch } = useSettings()

  function stop() {
    current?.pause()
    current = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  // Instant path: memory -> IndexedDB -> generate
  async function speak(word: string) {
    const key = `${voiceId.value}|${word}`
    const cached = urls.get(key)
    if (cached) return playUrl(cached, ttsRepeat.value)

    const blob = await generate(word, voiceId.value)
    if (!blob) return speakFallback(word, ttsRepeat.value)
    const url = URL.createObjectURL(blob)
    urls.set(key, url)
    playUrl(url, ttsRepeat.value)
  }

  // Background pre-generation so the first click is already instant
  let queue: string[] = []
  let running = false

  async function drain() {
    if (running) return
    running = true
    while (queue.length) {
      const word = queue.shift()!
      prefetching.value = queue.length
      const key = `${voiceId.value}|${word}`
      if (urls.has(key)) continue
      const blob = await generate(word, voiceId.value)
      if (blob) urls.set(key, URL.createObjectURL(blob))
      else break    // voice unavailable: stop trying
    }
    prefetching.value = 0
    running = false
  }

  function prefetch(words: string[]) {
    if (!ttsPrefetch.value || workerBroken) return
    const set = new Set(queue)
    for (const w of words) if (!set.has(w)) queue.push(w)
    prefetching.value = queue.length
    drain()
  }

  const clipCount = () => urls.size
  return {
    speak, stop, prefetch, clipCount,
    downloading, downloadProgress, prefetching, lastError,
    selectedVoice: voiceId, voiceOptions: VOICE_OPTIONS
  }
}
