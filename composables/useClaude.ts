export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

// Static site = no server proxy. We call Anthropic directly from the browser
// using their official "bring your own key" CORS header. The key never
// leaves the user's device except in this direct request.
const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

export function useClaude() {
  const { apiKey } = useApiKey()

  // The reply is written for the reader's current position in the 9,000-word
  // list, so the text itself gets harder as the frontier moves forward.
  // A knowledgeable assistant first. The learner's level only shapes the
  // wording, never the depth or the subject of the answer.
  //
  // When the user asks a real question, that question is the topic and the
  // words are purely decorative (used only if they fit). When the user asks
  // for something to read (an empty-ish prompt, or explicitly "surprise me" /
  // "give me something to read"), the words become the SOURCE of the topic:
  // the model studies the candidate list, finds a thread running through
  // several of them, and writes a short magazine-style feature article on
  // whatever real subject that thread points to - the article's quality
  // (coherence, how well-written and genuinely interesting it is, how much
  // real information it carries) always outranks fitting in more words.
  function systemPrompt(edge: number, total: number, recentTopics: string[]) {
    const known = Math.max(800, edge)
    const avoid = recentTopics.length
      ? `\n\nTopics already covered recently - do not write about these or anything close to them: ${recentTopics.join('; ')}.`
      : ''
    return `You write for an educated general-interest audience, in the voice of a magazine like Scientific American or National Geographic: a strong opening that draws the reader in, real information that teaches something true and specific, and a sense of narrative movement from paragraph to paragraph - never a flat list of facts and never a direct-answer-then-stop format.

Two modes, decided by what the user wrote:
- If the user asked a real question or gave a real topic, that question is what you answer, fully and directly, in the same engaging style. The word lists below are purely optional seasoning for this mode.
- If the user's message is empty, or only asks you to pick something, surprise them, or give them something to read, you choose the subject yourself: study the candidate word lists below, look for a thread that connects several of them (a shared field, a shared image, a shared idea), and write a short feature article (250-450 words) on the real-world subject that thread suggests. The article's coherence, how genuinely interesting and well-written it is, and how much real, accurate information it carries always matter more than how many words you fit in. Pick something a curious reader would actually want to read, not the most obvious or safest idea.${avoid}

Language rules:
- Always reply in English, whatever language the user wrote in. Do not mention that you are switching language.
- Never talk about language learning. Do not comment on the user's English, do not encourage practice, do not turn the piece into a lesson. The reader wants real content.
- Keep the content complete and accurate. Adapt only the wording: the reader comfortably knows roughly the ${known} most common English words (out of ${total}). Prefer words inside that range and clear sentences, but never cut or flatten an idea just to make it simple.

Format: plain text only, no Markdown, no asterisks, no headings, no bullet symbols. Use short paragraphs separated by a blank line.

Words: the user's message may end with two lists.
- "Required words": make a real effort to weave each one into the piece naturally, in a sentence that actually makes sense. If one genuinely cannot fit without forcing or damaging the writing, leave it out rather than bend the piece around it.
- "Optional words": use only the ones that fit what you are already writing. Never force one in, and never change the content to fit one.

After the piece, add two hidden lines, exactly in this order:
"---TOPIC---" followed by a 3-6 word phrase naming what you wrote about (used only to avoid repeating it later).
"---MEANINGS---" followed by ONLY a JSON object mapping each listed word you actually used to a short one-sentence English definition of it as used in this context. If you used none, return {}.`
  }

  async function callApi(messages: any[], system?: string, maxTokens = 1000) {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.value,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: system || undefined,
        messages
      })
    })
    if (!res.ok) {
      let detail = ''
      try {
        const j = await res.json()
        detail = j?.error?.message || ''
      } catch {}
      if (res.status === 401) throw new Error('Invalid API key. Use "Change key" at the top to fix it.')
      if (res.status === 429) throw new Error('Rate limit reached. Wait a moment and try again.')
      if (res.status === 529 || res.status === 503) throw new Error('Anthropic is overloaded right now. Try again in a moment.')
      throw new Error(`API error ${res.status}${detail ? ': ' + detail : ''}`)
    }
    return res.json()
  }

  function splitReply(raw: string): { text: string; meanings: Record<string, string>; topic: string } {
    const topicMarker = '---TOPIC---'
    const meaningsMarker = '---MEANINGS---'
    const meaningsIdx = raw.indexOf(meaningsMarker)
    const topicIdx = raw.indexOf(topicMarker)
    const cutIdx = [topicIdx, meaningsIdx].filter(i => i !== -1).sort((a, b) => a - b)[0] ?? -1
    const text = (cutIdx === -1 ? raw : raw.slice(0, cutIdx)).trim()

    let topic = ''
    if (topicIdx !== -1) {
      const end = meaningsIdx !== -1 && meaningsIdx > topicIdx ? meaningsIdx : raw.length
      topic = raw.slice(topicIdx + topicMarker.length, end).trim().split('\n')[0].slice(0, 80)
    }
    let meanings: Record<string, string> = {}
    if (meaningsIdx !== -1) {
      try { meanings = JSON.parse(raw.slice(meaningsIdx + meaningsMarker.length).trim()) } catch {}
    }
    return { text, meanings, topic }
  }

  async function ask(question: string, history: ChatTurn[], opts: {
    required: string[]; optional: string[]; edge: number; total: number; recentTopics?: string[]
  }) {
    let extra = ''
    if (opts.required.length) extra += `\n\n[Required words: ${opts.required.join(', ')}]`
    if (opts.optional.length) extra += `\n[Optional words: ${opts.optional.join(', ')}]`
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: (question || '(no specific question - pick something genuinely interesting to read)') + extra }
    ]
    const res = await callApi(messages, systemPrompt(opts.edge, opts.total, opts.recentTopics || []), 1600)
    const rawText = res.content?.find((c: any) => c.type === 'text')?.text || ''
    return splitReply(rawText)
  }

  async function askAboutSelection(chunks: string[], question: string) {
    const chunksBlock = chunks.map((c, i) => `${i + 1}. "${c}"`).join('\n')
    const prompt = `Selected passages:\n${chunksBlock}\n\nUser question: "${question}"\n\nAnswer the question fully and directly, in English, whatever language it was asked in. Focus on the content, not on language learning. Plain text, short paragraphs.`
    const res = await callApi([{ role: 'user', content: prompt }], undefined, 500)
    return res.content?.find((c: any) => c.type === 'text')?.text || ''
  }

  // Full card: contextual meaning + two examples, written for the learner's level
  async function askWordCard(word: string, context: string, level: string) {
    const prompt = `Sentence: "${context}"\nWord: "${word}"\nReader level: ${level}\n\nExplain the meaning of the word as used in this sentence, in simple English suitable for a ${level} learner, in one short sentence. Then give two short example sentences using the same meaning.\nReply with JSON only: {"definition": "...", "examples": ["...", "..."]}`
    try {
      const res = await callApi([{ role: 'user', content: prompt }], undefined, 300)
      const raw = res.content?.find((c: any) => c.type === 'text')?.text || ''
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
      if (start !== -1 && end > start) {
        const o = JSON.parse(raw.slice(start, end + 1))
        return { definition: String(o.definition || '').trim(), examples: Array.isArray(o.examples) ? o.examples.slice(0, 2).map(String) : [] }
      }
      return { definition: raw.trim(), examples: [] }
    } catch {
      return null
    }
  }

  // For an ambiguous spelling (e.g. "left"), Claude wrote the sentence, so it
  // knows which candidate word it meant. One call: pick the word, then define it.
  async function askDisambiguate(spelling: string, context: string, candidates: string[]) {
    const prompt = `Sentence: "${context}"\nWord: "${spelling}"\n\nIn English, the spelling "${spelling}" can be the word ${candidates.map(c => `"${c}"`).join(' or ')}. Which one is it in this exact sentence?\nReply with JSON only: {"lemma": "<one of: ${candidates.join(', ')}>", "definition": "<short one-sentence meaning as used here>", "examples": ["<short example>", "<short example>"]}`
    try {
      const res = await callApi([{ role: 'user', content: prompt }], undefined, 200)
      const raw = res.content?.find((c: any) => c.type === 'text')?.text || ''
      const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
      if (start === -1 || end <= start) return null
      const o = JSON.parse(raw.slice(start, end + 1))
      if (!candidates.includes(o.lemma)) return null
      return { lemma: o.lemma as string, definition: String(o.definition || '').trim(), examples: Array.isArray(o.examples) ? o.examples.slice(0, 2).map(String) : [] }
    } catch {
      return null
    }
  }

  async function askWordMeaning(word: string, context: string) {
    const prompt = `Give only a short one-sentence English definition of the word "${word}" as used in this context: "${context}". No preamble, just the definition.`
    try {
      const res = await callApi([{ role: 'user', content: prompt }], undefined, 100)
      return res.content?.find((c: any) => c.type === 'text')?.text?.trim() || ''
    } catch {
      return ''
    }
  }

  return { ask, askAboutSelection, askWordMeaning, askWordCard, askDisambiguate }
}
