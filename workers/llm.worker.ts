// Runs a small language model in the background thread to produce a
// contextual definition + examples, fully offline once downloaded.
import { pipeline, env } from '@huggingface/transformers'

env.allowLocalModels = false

let pipe: any = null
let loadedKey = ''

async function load(repo: string, task: string) {
  const key = `${task}:${repo}`
  if (pipe && loadedKey === key) return pipe
  pipe = null
  const hasGPU = typeof (self as any).navigator !== 'undefined' && 'gpu' in (self as any).navigator
  const progress_callback = (p: any) => {
    if (p?.status === 'progress' && typeof p.progress === 'number') {
      self.postMessage({ type: 'progress', value: Math.round(p.progress) })
    }
  }
  try {
    pipe = await pipeline(task as any, repo, { dtype: 'q4f16', device: hasGPU ? 'webgpu' : 'wasm', progress_callback })
  } catch {
    // some repos only ship q8 / some devices reject webgpu
    pipe = await pipeline(task as any, repo, { dtype: 'q8', device: 'wasm', progress_callback })
  }
  loadedKey = key
  return pipe
}

function buildPrompt(word: string, sentence: string, level: string) {
  return `Sentence: "${sentence}"
Word: "${word}"
Reader level: ${level}

Explain the meaning of the word AS USED IN THIS SENTENCE, in simple English suitable for a ${level} learner. Then give two short example sentences using the same meaning.
Answer with JSON only, no other text:
{"definition": "...", "examples": ["...", "..."]}`
}

function parse(raw: string) {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const o = JSON.parse(raw.slice(start, end + 1))
      if (o && typeof o.definition === 'string') {
        return { definition: o.definition.trim(), examples: Array.isArray(o.examples) ? o.examples.slice(0, 2).map(String) : [] }
      }
    } catch {}
  }
  // model ignored the format: keep the first sentence as the definition
  const text = raw.replace(/```[a-z]*|```/g, '').trim()
  if (!text) return null
  return { definition: text.split('\n')[0].slice(0, 200), examples: [] }
}

self.onmessage = async (e: MessageEvent) => {
  const { id, action, repo, task, word, sentence, level } = e.data
  try {
    if (action === 'load') {
      await load(repo, task)
      self.postMessage({ type: 'loaded', id })
      return
    }
    const p = await load(repo, task)
    const prompt = buildPrompt(word, sentence, level)
    let raw = ''
    if (task === 'text2text-generation') {
      const out = await p(prompt, { max_new_tokens: 96 })
      raw = out?.[0]?.generated_text ?? ''
    } else {
      const messages = [
        { role: 'system', content: 'You are a dictionary for English learners. Reply with JSON only.' },
        { role: 'user', content: prompt }
      ]
      const out = await p(messages, { max_new_tokens: 128, do_sample: false })
      const gen = out?.[0]?.generated_text
      raw = Array.isArray(gen) ? (gen[gen.length - 1]?.content ?? '') : String(gen ?? '')
      raw = raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    }
    const parsed = parse(raw)
    if (!parsed) throw new Error('empty output')
    self.postMessage({ type: 'result', id, ...parsed })
  } catch (err: any) {
    self.postMessage({ type: 'error', id, message: String(err?.message || err).slice(0, 200) })
  }
}
