import Dexie, { type Table } from 'dexie'
import { fsrs, createEmptyCard, Rating, State, generatorParameters } from 'ts-fsrs'
import frequencyData from '~/data/frequency.json'

/*
  THE SYSTEM IN ONE PAGE
  ----------------------
  Only ONE way in: 10 views (fixed for every word), spaced at least 1 hour
  apart, with no tap in between. A tap on a word outside the scheduler shows
  its meaning only - it changes nothing and never enters the word.

  Two engines push words toward that 10-view line, from opposite ends:
    Engine A (the daily queue): the most important word not yet in the
      scheduler, whatever its current view count, pushed to the AI so it
      gets used - up to N per day (default 10).
    Engine B (closest to done): among words that already have at least one
      view, the ones with the most views go first, because they need the
      fewest more views to finish.
  Whichever a reply actually uses adds a view; reaching 10 enters the word
  as known (Good), unrated by us - only FSRS's own next review decides
  anything from then on.

  Inside the scheduler, a tap is Again. Reviews due are sent in PRIORITY
  order: how overdue a word is, combined with how important (frequent) it
  is - not just oldest-due-first.
*/

export type Category = 'untracked' | 'not-started' | 'collecting' | 'queue-today' | 'required'
  | 'new' | 'learning' | 'review' | 'relearning'

export interface VocabWord {
  lemma: string
  forms_seen: string[]
  freq_rank: number
  cefr: string
  views: number
  lastViewAt: number
  clicks: number
  tappedOn: string
  inSrs: boolean
  entrySource: '' | 'queue' | 'views'
  enteredAt: number
  sentCount: number
  deliveredCount: number
  skipped: number
  cooldownUntil: number
  lastSentAs: string
  card: any
  due: number
  state: number
}
export interface Snapshot { category: string; inSrs: boolean; state: number; views: number; clicks: number; sentCount: number; deliveredCount: number; skipped: number; due: number; stability: number | null }
export interface WordEvent { id?: number; turn: number; at: number; lemma: string; reason: string; before: Snapshot; after: Snapshot }
export interface MetaRow { key: string; value: any }
export interface TurnLog { id?: number; turn?: number; at: number; question: string; edge: number; sent: { lemma: string; source: string }[]; used: string[]; skipped: string[] }
export interface DailyRow { date: string; turns: number; dueMax: number; queueDelivered: number; requiredDelivered: number; viewEntries: number; taps: number }
export interface QueueState { date: string; batch: string[]; delivered: string[]; required: string[] }

class VocabDatabase extends Dexie {
  words!: Table<VocabWord, string>
  meta!: Table<MetaRow, string>
  turns!: Table<TurnLog, number>
  daily!: Table<DailyRow, string>
  events!: Table<WordEvent, number>
  constructor() {
    super('vocab_reader_db')
    this.version(1).stores({ words: 'lemma, status, freq_rank' })
    this.version(2).stores({ words: 'lemma, status, freq_rank' })
    this.version(3).stores({ words: 'lemma, status, freq_rank', cards: 'key, lemma', audio: 'key' })
    this.version(4).stores({ words: 'lemma, freq_rank, due, state', cards: 'key, lemma', audio: 'key', meta: 'key' })
    this.version(5).stores({ words: 'lemma, freq_rank, due, state', cards: 'key, lemma', audio: 'key', meta: 'key', turns: '++id, at' })
    this.version(6).stores({ words: 'lemma, freq_rank, due, state', cards: 'key, lemma', audio: 'key', meta: 'key', turns: '++id, at', daily: 'date' })
    this.version(7).stores({ words: 'lemma, freq_rank, due, state, inSrs', cards: 'key, lemma', audio: 'key', meta: 'key', turns: '++id, at', daily: 'date' })
    this.version(8).stores({ words: 'lemma, freq_rank, due, state, inSrs', cards: 'key, lemma', audio: 'key', meta: 'key', turns: '++id, at, turn', daily: 'date', events: '++id, turn, lemma' })
    this.version(9).stores({ words: 'lemma, freq_rank, due, state, inSrs', meta: 'key', turns: '++id, at, turn', daily: 'date', events: '++id, turn, lemma', cards: null, audio: null })
    // v10: a tap no longer enters a word by itself; view threshold is fixed at 10 for everyone
    this.version(10).stores({
      words: 'lemma, freq_rank, due, state, inSrs', meta: 'key', turns: '++id, at, turn', daily: 'date', events: '++id, turn, lemma'
    }).upgrade(async tx => {
      await tx.table('words').toCollection().modify((w: any) => {
        if (!w.inSrs && w.entrySource === 'click') { w.clicks = Math.max(w.clicks, 1) }
      })
    })
  }
}

const db = new VocabDatabase()
const freq = frequencyData as Record<string, { rank: number; cefr: string }>
export const RANKS = Object.entries(freq).map(([lemma, m]) => ({ lemma, rank: m.rank, cefr: m.cefr })).sort((a, b) => a.rank - b.rank)
const TOTAL_WORDS = RANKS.length
const HOUR = 3600_000
const today = () => new Date().toISOString().slice(0, 10)

// Parses "10m, 1h, 3h, 6h" style settings into FSRS step strings, falling
// back to the library default if the setting is empty or malformed.
function parseSteps(raw: string, fallback: string[]): string[] {
  const parts = (raw || '').split(',').map(s => s.trim()).filter(Boolean)
  const valid = parts.filter(s => /^\d+[mhd]$/.test(s))
  return valid.length ? valid : fallback
}

let sched: any = null
let schedKey = ''
function scheduler(learningRaw: string, relearningRaw: string) {
  const key = `${learningRaw}|${relearningRaw}`
  if (!sched || schedKey !== key) {
    sched = fsrs(generatorParameters({
      enable_fuzz: true,
      learning_steps: parseSteps(learningRaw, ['1m', '10m']) as any,
      relearning_steps: parseSteps(relearningRaw, ['10m']) as any
    }))
    schedKey = key
  }
  return sched
}

function blank(lemma: string, form = ''): VocabWord | null {
  const m = freq[lemma]
  if (!m) return null
  return {
    lemma, forms_seen: form ? [form] : [], freq_rank: m.rank, cefr: m.cefr,
    views: 0, lastViewAt: 0, clicks: 0, tappedOn: '',
    inSrs: false, entrySource: '', enteredAt: 0,
    sentCount: 0, deliveredCount: 0, skipped: 0, cooldownUntil: 0, lastSentAs: '',
    card: null, due: 0, state: -1
  }
}

export function useVocabDB() {
  const s = useSettings()
  const rate = (w: VocabWord, r: any) => {
    const res = scheduler(s.learningSteps.value, s.relearningSteps.value).next(w.card, new Date(), r)
    w.card = res.card; w.due = +res.card.due; w.state = res.card.state
  }
  function enterKnown(w: VocabWord) {
    Object.assign(w, { inSrs: true, entrySource: 'views', enteredAt: Date.now(), card: createEmptyCard(new Date()), views: 0 })
    rate(w, Rating.Good)
  }

  async function getMeta<T>(k: string, f: T): Promise<T> { const r = await db.meta.get(k); return r ? r.value : f }
  const setMeta = (k: string, v: any) => db.meta.put({ key: k, value: v })
  const getTurn = () => getMeta('turn', 0)
  async function getDay(): Promise<DailyRow> {
    return (await db.daily.get(today())) || { date: today(), turns: 0, dueMax: 0, queueDelivered: 0, requiredDelivered: 0, viewEntries: 0, taps: 0 }
  }

  // Engine A: the most important words not yet in the scheduler, pushed daily
  // regardless of their current view count (even at 9/10).
  async function getQueue(): Promise<QueueState> {
    let q = await getMeta<QueueState | null>('queue', null)
    if (q && q.date === today()) return q
    const carried = q ? [...q.required, ...q.batch.filter(l => !q!.delivered.includes(l))] : []
    const all = await db.words.toArray()
    const inSrs = new Set(all.filter(w => w.inSrs).map(w => w.lemma))
    const required = [...new Set(carried)].filter(l => !inSrs.has(l))
    const minRank = s.minTrackRank.value ?? 300
    const n = s.queuePerDay.value ?? 10
    const taken = new Set(required)
    const batch = RANKS.filter(r => r.rank >= minRank && !inSrs.has(r.lemma) && !taken.has(r.lemma)).slice(0, n).map(r => r.lemma)
    q = { date: today(), batch, delivered: [], required }
    await setMeta('queue', q)
    return q
  }

  // ---------- placement test (writing-difficulty seed only) ----------
  // Dense, adaptive, positively-phrased: the person taps every word they
  // genuinely know (not the ones they don't), so the result only grows from
  // real, demonstrated recall - never from a passing sense of familiarity.
  // It narrows like a binary search: each round samples densely around the
  // last known/unknown boundary, so a single stray tap cannot skew the
  // result the way a fixed two-stage test could.
  const PLACEMENT_ROUNDS = 5
  const PLACEMENT_PER_ROUND = 12
  function placementRound(lo: number, hi: number, exclude: Set<string>) {
    const words: { lemma: string; rank: number }[] = []
    for (let i = 0; i < PLACEMENT_PER_ROUND; i++) {
      const target = Math.round(lo + ((hi - lo) * (i + 0.5)) / PLACEMENT_PER_ROUND)
      const r = RANKS.find(x => x.rank >= target && !exclude.has(x.lemma))
      if (r) { words.push({ lemma: r.lemma, rank: r.rank }); exclude.add(r.lemma) }
    }
    return words
  }
  function placementFirstRound() {
    const minRank = s.minTrackRank.value ?? 300
    return placementRound(minRank, TOTAL_WORDS, new Set())
  }
  // knownRatio = share of this round's words the person tapped as known.
  // >= 70% known -> their level is at or above this band, search the upper
  // half next; otherwise search the lower half. Always re-centers on the
  // boundary, which is what keeps a lucky/unlucky single word from mattering.
  function placementNextRound(lo: number, hi: number, knownRatio: number, exclude: Set<string>) {
    const mid = Math.round((lo + hi) / 2)
    return knownRatio >= 0.7 ? placementRound(mid, hi, exclude) : placementRound(lo, mid, exclude)
  }
  // Final estimate: after all rounds, take every word actually tapped known
  // across the whole test, sorted by rank, and use the point below which
  // 80% of them sit - the same "most of it, not all of it" logic as the
  // real edge, so one remembered rare word cannot inflate the result.
  function placementResult(allRounds: { lemma: string; rank: number }[][], knownSets: boolean[][]) {
    const known: number[] = []
    allRounds.forEach((round, i) => round.forEach((w, j) => { if (knownSets[i][j]) known.push(w.rank) }))
    if (!known.length) return s.minTrackRank.value ?? 300
    known.sort((a, b) => a - b)
    return known[Math.min(known.length - 1, Math.floor(known.length * 0.8))]
  }
  async function savePlacement(edge: number) {
    await setMeta('placementEdge', edge)
    await setMeta('placementDone', true)
  }
  const isPlacementDone = () => getMeta('placementDone', false)
  const skipPlacement = () => savePlacement(s.minTrackRank.value ?? 300)

  // ---------- edge (writing difficulty only) ----------
  async function computeEdge() {
    const pct = s.edgePercentile.value ?? 0.98
    const minN = s.minReviewForEdge.value ?? 30
    const all = await db.words.toArray()
    const ranks = all.filter(w => w.inSrs && w.state === State.Review).map(w => w.freq_rank).sort((a, b) => a - b)
    if (ranks.length < minN) {
      const placed = await getMeta<number | null>('placementEdge', null)
      if (placed != null) return { edge: placed, reviewCount: ranks.length, pct, fromQueue: false, fromPlacement: true }
      const q = await getQueue()
      return { edge: q.batch.length ? freq[q.batch[0]]?.rank ?? 0 : 0, reviewCount: ranks.length, pct, fromQueue: true, fromPlacement: false }
    }
    return { edge: ranks[Math.min(ranks.length - 1, Math.floor(ranks.length * pct))], reviewCount: ranks.length, pct, fromQueue: false, fromPlacement: false }
  }

  // ---------- categories & snapshots ----------
  function categoryOf(w: any, q: QueueState | null, minRank: number): Category {
    if (w.freq_rank < minRank) return 'untracked'
    if (w.inSrs) return (['new', 'learning', 'review', 'relearning'] as Category[])[w.state] || 'learning'
    if (q?.required.includes(w.lemma)) return 'required'
    if (q?.batch.includes(w.lemma)) return 'queue-today'
    return (w.views ?? 0) > 0 ? 'collecting' : 'not-started'
  }
  function snap(w: any, q: QueueState | null, minRank: number, rank = 0): Snapshot {
    const x = w || { freq_rank: rank, inSrs: false, state: -1, views: 0, clicks: 0, sentCount: 0, deliveredCount: 0, skipped: 0, due: 0, card: null }
    return { category: categoryOf(x, q, minRank), inSrs: !!x.inSrs, state: x.state, views: x.views ?? 0, clicks: x.clicks ?? 0, sentCount: x.sentCount ?? 0, deliveredCount: x.deliveredCount ?? 0, skipped: x.skipped ?? 0, due: x.due || 0, stability: x.card?.stability ? +x.card.stability.toFixed(2) : null }
  }
  async function logEvents(reason: string, pairs: { lemma: string; before: Snapshot; after: Snapshot }[]) {
    const changed = pairs.filter(p => JSON.stringify(p.before) !== JSON.stringify(p.after))
    if (!changed.length) return
    const turn = await getTurn(), at = Date.now()
    await db.events.bulkAdd(changed.map(p => ({ turn, at, lemma: p.lemma, reason, before: p.before, after: p.after })))
  }

  // ---------- a reply was shown: the ONLY place views change ----------
  async function recordExposures(pairs: { lemma: string; form: string; ambiguous?: boolean }[]) {
    const minRank = s.minTrackRank.value ?? 300
    const need = s.viewsToEnter.value ?? 10
    const now = Date.now()
    const q = await getQueue()

    const unique = new Map<string, string>()
    for (const p of pairs) {
      if (p.ambiguous) continue
      const m = freq[p.lemma]
      if (m && m.rank >= minRank && !unique.has(p.lemma)) unique.set(p.lemma, p.form)
    }
    const lemmas = [...unique.keys()]
    if (!lemmas.length) return

    const day = await getDay()
    const log: { lemma: string; before: Snapshot; after: Snapshot }[] = []
    const reasons = new Map<string, string>()
    await db.transaction('rw', db.words, async () => {
      const rows = await db.words.bulkGet(lemmas)
      const save: VocabWord[] = []
      lemmas.forEach((lemma, i) => {
        const w = rows[i] || blank(lemma, unique.get(lemma))
        if (!w) return
        const before = snap(rows[i], q, minRank, w.freq_rank)
        const form = unique.get(lemma)!
        if (form && !w.forms_seen.includes(form)) w.forms_seen.push(form)
        w.skipped = 0
        let why: string

        if (w.inSrs) {
          if (w.state === State.Review) {
            const last = w.card?.last_review ? +new Date(w.card.last_review) : w.enteredAt
            if (now - last >= Math.max(HOUR, (w.due - last) * (s.reviewFraction.value ?? 0.5))) { rate(w, Rating.Good); why = 'review counted (Good)' }
            else why = 'too early to count as a review'
          } else if (now >= w.due) { rate(w, Rating.Good); why = 'step passed (Good)' }
          else why = 'appeared before its next step'
        } else if (now - w.lastViewAt >= HOUR) {
          w.views++; w.lastViewAt = now
          why = `view counted (${w.views}/${need})`
          if (w.views >= need) { enterKnown(w); day.viewEntries++; why = 'reached 10 views: entered as known (Good)' }
          if (q.batch.includes(lemma) && !q.delivered.includes(lemma)) { q.delivered.push(lemma); day.queueDelivered++ }
          if (q.required.includes(lemma)) { q.required = q.required.filter(l => l !== lemma); day.requiredDelivered++ }
        } else why = 'appeared again within 1h: not counted'

        reasons.set(lemma, why)
        save.push(w)
        log.push({ lemma, before, after: snap(w, q, minRank) })
      })
      if (save.length) await db.words.bulkPut(save)
    })
    await setMeta('queue', q)
    await db.daily.put(day)
    for (const l of log) await logEvents(reasons.get(l.lemma) || 'appeared', [l])
  }

  // A tap: inside the scheduler it is Again; outside it, it changes nothing.
  async function registerClick(lemma: string) {
    const minRank = s.minTrackRank.value ?? 300
    const q = await getQueue()
    let w = await db.words.get(lemma)
    const existed = !!w
    if (!w) { const b = blank(lemma); if (!b) return; w = b }
    if (w.freq_rank < minRank) return
    const before = snap(existed ? w : null, q, minRank, w.freq_rank)
    w.clicks++
    let why: string
    if (w.inSrs) { w.tappedOn = today(); rate(w, Rating.Again); why = 'tapped: marked not known (Again), offered all day' }
    else { w.views = 0; why = 'tapped outside the scheduler: view count reset to 0 (the 10-view evidence must stay clean)' }
    if (existed || w.inSrs) await db.words.put(w)
    const day = await getDay(); day.taps++; await db.daily.put(day)
    await logEvents(why, [{ lemma, before, after: snap(w, q, minRank) }])
  }

  // ---------- what gets sent ----------
  // Reviews due are ordered by priority = how overdue + how frequent.
  function priority(w: VocabWord, now: number) {
    const overdueHours = Math.max(0, (now - w.due) / HOUR)
    const importance = 1 / Math.sqrt(w.freq_rank)   // more frequent = higher importance
    return overdueHours * importance
  }

  async function getCandidates() {
    const limit = s.candidateCount.value ?? 50
    const maxRequired = s.forcedPerReply.value ?? 3
    const turn = await getTurn()
    const q = await getQueue()
    const { edge } = await computeEdge()
    const all = await db.words.toArray()
    const now = Date.now()
    const free = (l: string) => { const w = all.find(x => x.lemma === l); return !w || w.cooldownUntil <= turn }

    const required = q.required.slice(0, maxRequired).map(l => ({ lemma: l, source: 'required' }))
    const optional: { lemma: string; source: string }[] = []
    const taken = new Set(required.map(r => r.lemma))
    const add = (l: string, source: string) => { if (!taken.has(l) && optional.length < limit && free(l)) { taken.add(l); optional.push({ lemma: l, source }) } }

    // 1. SRS reviews due, by priority (overdue x importance), not just oldest-first
    all.filter(w => w.inSrs && w.due <= now)
      .sort((a, b) => priority(b, now) - priority(a, now))
      .forEach(w => add(w.lemma, 'due'))
    // 2. tapped today, always offered
    all.filter(w => w.inSrs && w.tappedOn === today()).forEach(w => add(w.lemma, 'tapped'))
    // 3. Engine B: closest to done (highest view count first), not yet in SRS
    all.filter(w => !w.inSrs && w.views > 0 && w.freq_rank >= (s.minTrackRank.value ?? 300))
      .sort((a, b) => b.views - a.views)
      .forEach(w => add(w.lemma, 'watching'))
    // 4. Engine A: today's queue (most important never-seen words)
    q.batch.filter(l => !q.delivered.includes(l)).forEach(l => add(l, 'queue'))

    const items = [...required, ...optional]
    return { items, required: required.map(r => r.lemma), optional: optional.map(o => o.lemma), edge, dueCount: all.filter(w => w.inSrs && w.due <= now).length, queue: q }
  }

  async function markSent(items: { lemma: string; source: string }[], dueCount: number) {
    const turn = (await getTurn()) + 1
    await setMeta('turn', turn)
    const minRank = s.minTrackRank.value ?? 300
    const q = await getQueue()
    const log: { lemma: string; before: Snapshot; after: Snapshot }[] = []
    await db.transaction('rw', db.words, async () => {
      const rows = await db.words.bulkGet(items.map(i => i.lemma))
      const save: VocabWord[] = []
      items.forEach((it, i) => {
        const w = rows[i] || blank(it.lemma); if (!w) return
        const before = snap(rows[i], q, minRank, w.freq_rank)
        w.sentCount++; w.lastSentAs = it.source
        save.push(w); log.push({ lemma: it.lemma, before, after: snap(w, q, minRank) })
      })
      if (save.length) await db.words.bulkPut(save)
    })
    await logEvents('sent to the AI', log)
    const day = await getDay(); day.turns++; day.dueMax = Math.max(day.dueMax, dueCount); await db.daily.put(day)
    return turn
  }

  async function reconcileSent(items: { lemma: string; source: string }[], used: Set<string>, turn: number) {
    const minRank = s.minTrackRank.value ?? 300
    const q = await getQueue()
    const after = s.cooldownAfter.value ?? 5, rest = s.cooldownTurns.value ?? 3
    const log: { lemma: string; before: Snapshot; after: Snapshot }[] = []
    await db.transaction('rw', db.words, async () => {
      const rows = await db.words.bulkGet(items.map(i => i.lemma))
      const save: VocabWord[] = []
      items.forEach((it, i) => {
        const w = rows[i]; if (!w) return
        const before = snap(w, q, minRank)
        if (used.has(it.lemma)) w.deliveredCount++
        else if (it.source !== 'required') { w.skipped++; if (w.skipped >= after) w.cooldownUntil = turn + rest }
        save.push(w); log.push({ lemma: it.lemma, before, after: snap(w, q, minRank) })
      })
      if (save.length) await db.words.bulkPut(save)
    })
    await logEvents('delivered or skipped', log)
  }

  // ---------- reporting ----------
  async function getFullList() {
    const all = await db.words.toArray()
    const map = new Map(all.map(w => [w.lemma, w]))
    const q = await getQueue()
    const minRank = s.minTrackRank.value ?? 300
    return RANKS.map(r => { const w: any = map.get(r.lemma) || blank(r.lemma)!; return { ...w, category: categoryOf(w, q, minRank) } })
  }
  async function getStats() {
    const list = await getFullList()
    const counts: Record<string, number> = {}
    for (const w of list) counts[w.category] = (counts[w.category] || 0) + 1
    const now = Date.now()
    const inSrs = list.filter((w: any) => w.inSrs)
    return { counts, total: TOTAL_WORDS, tracked: list.filter((w: any) => w.inSrs || w.views > 0).length, inSrs: inSrs.length, due: inSrs.filter((w: any) => w.due <= now).length, tappedToday: list.filter((w: any) => w.tappedOn === today()).length, learning: (counts.new || 0) + (counts.learning || 0), review: counts.review || 0, relearning: counts.relearning || 0 }
  }
  const getAllWords = () => db.words.toArray()
  const getIgnoredWords = async () => (await db.words.toArray()).filter(w => w.skipped > 0).sort((a, b) => b.skipped - a.skipped).slice(0, 50)
  const getDaily = (n = 30) => db.daily.orderBy('date').reverse().limit(n).toArray()
  const getToday = () => getDay()
  async function resetWord(lemma: string) { const w = await db.words.get(lemma); if (!w) return; await db.words.put({ ...blank(lemma)!, forms_seen: w.forms_seen }) }
  async function saveTurn(log: Omit<TurnLog, 'id'>) {
    await db.turns.add(log as TurnLog)
    const n = await db.turns.count()
    if (n > 300) await db.turns.bulkDelete(await db.turns.orderBy('at').limit(n - 300).primaryKeys())
  }
  const getTurns = (n = 50) => db.turns.orderBy('at').reverse().limit(n).toArray()
  async function getChanges(fromTurn: number, toTurn: number) {
    const evs = await db.events.where('turn').between(fromTurn, toTurn, true, true).sortBy('id')
    const map = new Map<string, any>()
    for (const e of evs) {
      const r = map.get(e.lemma) || { lemma: e.lemma, before: e.before, after: e.after, reasons: [] as string[], turns: new Set<number>() }
      r.after = e.after; if (!r.reasons.includes(e.reason)) r.reasons.push(e.reason); r.turns.add(e.turn); map.set(e.lemma, r)
    }
    return [...map.values()].map(r => ({ ...r, turns: [...r.turns].sort((a: number, b: number) => a - b) }))
  }
  async function exportData() {
    const [words, meta, daily] = await Promise.all([db.words.toArray(), db.meta.toArray(), db.daily.toArray()])
    return JSON.stringify({ exported_at: new Date().toISOString(), version: 10, words, meta, daily }, null, 2)
  }
  async function importData(json: string) {
    const p = JSON.parse(json)
    for (const w of p.words || []) {
      const e = await db.words.get(w.lemma)
      if (!e) { await db.words.put(w); continue }
      e.clicks = Math.max(e.clicks, w.clicks ?? 0); e.views = Math.max(e.views, w.views ?? 0)
      if (w.inSrs && (!e.inSrs || (w.due ?? 0) > e.due)) Object.assign(e, { inSrs: true, card: w.card, due: w.due, state: w.state, entrySource: w.entrySource })
      await db.words.put(e)
    }
    for (const m of p.meta || []) await setMeta(m.key, m.value)
    for (const d of p.daily || []) await db.daily.put(d)
  }
  async function seedDemo() {
    if (await db.words.count()) return
    const rows: VocabWord[] = []
    ;['recover', 'acknowledge', 'facilitate', 'substantial', 'credible'].forEach((l, i) => {
      const w = blank(l); if (!w) return
      if (i % 2) enterKnown(w); else { w.views = 6; w.lastViewAt = Date.now() }
      rows.push(w)
    })
    await db.words.bulkPut(rows)
  }

  return {
    recordExposures, registerClick, getCandidates, markSent, reconcileSent, getQueue, computeEdge, categoryOf,
    getStats, getFullList, getAllWords, getIgnoredWords, getDaily, getToday, resetWord, saveTurn, getTurns, getChanges,
    exportData, importData, seedDemo, getMeta, setMeta, TOTAL_WORDS,
    placementFirstRound, placementNextRound, placementResult, savePlacement, isPlacementDone, skipPlacement, PLACEMENT_ROUNDS
  }
}
