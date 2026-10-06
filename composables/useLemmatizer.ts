// Every word we track resolves through one static lookup table, built once
// from UniMorph (data/word-forms.json) and validated against a real
// dictionary. No guessing at runtime: a spelling either maps to exactly one
// of our 9,000 words, or it is flagged ambiguous (shared by two+ of them) and
// carries its candidate list instead of a single answer.
import formsData from '~/data/word-forms.json'
import ambiguousData from '~/data/ambiguous-forms.json'
import frequencyData from '~/data/frequency.json'

const forms = formsData as Record<string, string[]>
const ambiguous = ambiguousData as Record<string, string[]>
const freq = frequencyData as Record<string, { rank: number; cefr: string }>

let formToLemma: Map<string, string> | null = null
function table() {
  if (!formToLemma) {
    formToLemma = new Map()
    for (const lemma in forms) for (const f of forms[lemma]) formToLemma!.set(f, lemma)
  }
  return formToLemma
}

export interface Token { start: number; end: number; form: string; lemma: string; ambiguous: boolean; candidates: string[]; isWord: boolean }

// A spelling flagged "ambiguous" in the data is only a real ambiguity if two
// or more of its candidate words are actually tracked (rank >= minTrackRank).
// If every candidate but one is untracked (e.g. "done" vs "do", and "do" is
// far too common to track), there is no real doubt: it resolves to the one
// tracked candidate instead of being thrown away as unresolvable.
function resolveWord(word: string): { lemma: string; ambiguous: boolean; candidates: string[] } {
  const w = word.toLowerCase()
  const cands = ambiguous[w]
  if (cands) {
    const minRank = useSettings().minTrackRank.value ?? 300
    const tracked = cands.filter(c => (freq[c]?.rank ?? -1) >= minRank)
    if (tracked.length <= 1) return { lemma: tracked[0] || w, ambiguous: false, candidates: [] }
    return { lemma: '', ambiguous: true, candidates: cands }
  }
  const lemma = table().get(w) || w
  return { lemma, ambiguous: false, candidates: [] }
}

function tokenize(text: string): string[] {
  return (text.match(/[A-Za-z']+/g) || []).map(t => t.toLowerCase())
}

// Synchronous - a plain table lookup, so no async model to await
function analyze(text: string): Token[] {
  const out: Token[] = []
  const re = /[A-Za-z']+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const raw = m[0]
    const form = raw.replace(/'.*$/, '').toLowerCase()
    const isWord = /^[a-z]+$/.test(form)
    const r = isWord ? resolveWord(form) : { lemma: '', ambiguous: false, candidates: [] }
    out.push({ start: m.index, end: m.index + raw.length, form, lemma: r.lemma, ambiguous: r.ambiguous, candidates: r.candidates, isWord })
  }
  return out
}

function lemmatize(word: string): string {
  const r = resolveWord(word)
  return r.ambiguous ? word.toLowerCase() : r.lemma
}

export function useLemmatizer() {
  return { tokenize, lemmatize, analyze }
}
