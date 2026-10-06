<script setup lang="ts">
const props = defineProps<{
  text: string
  contextMeanings: Record<string, string>
  targets: Set<string>          // words currently being pushed - the only ones marked
}>()
const emit = defineEmits<{
  (e: 'add-chunk', text: string): void
  (e: 'word-closed'): void
}>()

const { analyze } = useLemmatizer()
const { speak, stop } = useTTS()
const { markTargetsOnly } = useSettings()

interface Segment { raw: string; isWord: boolean; lemma: string; ambiguous: boolean; candidates: string[] }
const root = ref<HTMLElement | null>(null)
const popupWord = ref<string | null>(null)
const popupCandidates = ref<string[]>([])
const popupSentence = ref('')

// analyze() is a plain table lookup now: synchronous, no model to load
const segments = computed<Segment[]>(() => {
  const toks = analyze(props.text)
  const out: Segment[] = []
  let last = 0
  for (const t of toks) {
    if (t.start > last) out.push({ raw: props.text.slice(last, t.start), isWord: false, lemma: '', ambiguous: false, candidates: [] })
    out.push({ raw: props.text.slice(t.start, t.end), isWord: t.isWord, lemma: t.lemma, ambiguous: t.ambiguous, candidates: t.candidates })
    last = t.end
  }
  if (last < props.text.length) out.push({ raw: props.text.slice(last), isWord: false, lemma: '', ambiguous: false, candidates: [] })
  return out
})

function classFor(seg: Segment) {
  if (!seg.isWord) return ''
  const target = !seg.ambiguous && props.targets.has(seg.lemma)
  if (target) return 'word-target'
  return markTargetsOnly.value ? 'word-plain' : 'word-plain word-hinted'
}

function sentenceAround(index: number) {
  const offset = segments.value.slice(0, index).reduce((n, s) => n + s.raw.length, 0)
  const full = props.text
  const prev = Math.max(full.lastIndexOf('.', offset), full.lastIndexOf('!', offset),
                        full.lastIndexOf('?', offset), full.lastIndexOf('\n', offset))
  const nexts = ['.', '!', '?', '\n'].map(c => full.indexOf(c, offset)).filter(i => i >= 0)
  const next = nexts.length ? Math.min(...nexts) + 1 : full.length
  return full.slice(prev + 1, next).trim()
}

// --- tap handling -------------------------------------------------------
// Phones fire click late and turn a double tap into a text selection or a
// zoom, so taps are read from pointer events directly: first tap speaks at
// once, a second tap within the window opens the card instead.
let lastTapAt = 0
let lastIndex = -1
let singleTimer: any = null
const TAP_WINDOW = 420

function openCard(seg: Segment, index: number) {
  stop()
  popupSentence.value = sentenceAround(index)
  popupCandidates.value = seg.ambiguous ? seg.candidates : []
  popupWord.value = seg.ambiguous ? seg.raw.toLowerCase() : seg.lemma
}

function onWordTap(seg: Segment, index: number, ev: PointerEvent) {
  if (!seg.isWord) return
  const speakAs = seg.ambiguous ? seg.raw.toLowerCase() : seg.lemma
  ev.preventDefault()          // no text selection, no zoom, no ghost click
  const now = Date.now()
  if (index === lastIndex && now - lastTapAt < TAP_WINDOW) {
    clearTimeout(singleTimer)
    lastTapAt = 0
    lastIndex = -1
    openCard(seg, index)
    return
  }
  lastTapAt = now
  lastIndex = index
  speak(speakAs)                                   // instant, from cache
  singleTimer = setTimeout(() => { lastIndex = -1 }, TAP_WINDOW)
}

// --- selection ("ask about this passage") --------------------------------
const showAdd = ref(false)
const addPos = ref({ top: 0, left: 0 })
let pendingText = ''

function onSelectionChange() {
  const sel = window.getSelection()
  const text = sel?.toString().trim() || ''
  if (!sel || !text || sel.rangeCount === 0 || !root.value) { showAdd.value = false; return }
  const range = sel.getRangeAt(0)
  if (!root.value.contains(range.commonAncestorContainer)) { showAdd.value = false; return }
  const rect = range.getBoundingClientRect()
  pendingText = text
  addPos.value = { top: Math.max(8, rect.top - 44), left: Math.max(8, rect.left) }
  showAdd.value = true
}

function addChunk() {
  if (pendingText) emit('add-chunk', pendingText)
  window.getSelection()?.removeAllRanges()
  showAdd.value = false
  pendingText = ''
}

function closePopup() {
  popupWord.value = null
  emit('word-closed')
}

onMounted(() => document.addEventListener('selectionchange', onSelectionChange))
onUnmounted(() => document.removeEventListener('selectionchange', onSelectionChange))
</script>

<template>
  <div ref="root" class="leading-8 text-[15px] whitespace-pre-wrap">
    <span
      v-for="(seg, i) in segments"
      :key="i"
      :class="classFor(seg)"
      @pointerup="seg.isWord ? onWordTap(seg, i, $event) : null"
      @dblclick.prevent
    >{{ seg.raw }}</span>

    <Teleport to="body">
      <button
        v-if="showAdd"
        class="fixed z-40 bg-amber-500 text-white text-xs px-3 py-1.5 rounded-full shadow-lg"
        :style="{ top: addPos.top + 'px', left: addPos.left + 'px' }"
        @mousedown.prevent
        @click="addChunk"
      >+ Add to selection</button>

      <WordPopup
        v-if="popupWord"
        :word="popupWord"
        :candidates="popupCandidates"
        :context-meanings="contextMeanings"
        :context-sentence="popupSentence"
        @close="closePopup"
      />
    </Teleport>
  </div>
</template>
