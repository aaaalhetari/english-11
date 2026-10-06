// Optional on-device model for contextual definitions. Off by default;
// picked from Settings. Falls back silently when it is off or fails.
const loading = ref(false)
const progress = ref(0)
const ready = ref(false)
const error = ref('')
const lastMs = ref(0)

let worker: Worker | null = null
let broken = false
let nextId = 1
const pending = new Map<number, (v: any) => void>()

function getWorker(): Worker | null {
  if (broken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/llm.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.type === 'progress') { loading.value = true; progress.value = m.value; return }
      if (m.type === 'loaded') { loading.value = false; ready.value = true; pending.get(m.id)?.(true); pending.delete(m.id); return }
      loading.value = false
      if (m.type === 'error') error.value = m.message
      else { ready.value = true; error.value = '' }
      const done = pending.get(m.id)
      pending.delete(m.id)
      done?.(m.type === 'result' ? m : null)
    }
    worker.onerror = () => {
      broken = true
      loading.value = false
      error.value = 'local model failed to start'
      pending.forEach(r => r(null))
      pending.clear()
    }
    return worker
  } catch {
    broken = true
    return null
  }
}

export function useLocalLLM() {
  const { llmModel, LLM_OPTIONS } = useSettings()

  const option = computed(() => LLM_OPTIONS.find(o => o.id === llmModel.value) || LLM_OPTIONS[0])
  const enabled = computed(() => option.value.id !== 'off' && !!option.value.repo)

  function preload() {
    if (!enabled.value) return
    const w = getWorker()
    if (!w) return
    loading.value = true
    const id = nextId++
    pending.set(id, () => {})
    w.postMessage({ id, action: 'load', repo: option.value.repo, task: option.value.task })
  }

  async function define(word: string, sentence: string, level: string) {
    if (!enabled.value) return null
    const w = getWorker()
    if (!w) return null
    const id = nextId++
    const t0 = performance.now()
    const res: any = await new Promise(resolve => {
      pending.set(id, resolve)
      w.postMessage({ id, action: 'generate', repo: option.value.repo, task: option.value.task, word, sentence, level })
    })
    lastMs.value = Math.round(performance.now() - t0)
    if (!res) return null
    return { definition: res.definition as string, examples: (res.examples || []) as string[] }
  }

  return { define, preload, enabled, option, loading, progress, ready, error, lastMs }
}
