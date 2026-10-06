<script setup lang="ts">
// Adaptive, positively-phrased placement: the person taps every word they
// genuinely know - never the ones they don't - and each round samples
// densely around the current known/unknown boundary, narrowing toward their
// real level. This is used only to set how simply the AI writes from the
// first reply; it never adds, skips, or changes which words get learned -
// the daily queue still starts at rank 300 and climbs exactly as it always
// does, regardless of this result.
const emit = defineEmits(['done'])
const vocab = useVocabDB()

const round = ref(0)
const totalRounds = vocab.PLACEMENT_ROUNDS
const lo = ref(0)
const hi = ref(vocab.TOTAL_WORDS)
const words = ref<{ lemma: string; rank: number }[]>([])
const known = ref<Set<string>>(new Set())
const allRounds: { lemma: string; rank: number }[][] = []
const allKnown: boolean[][] = []
const exclude = new Set<string>()
const saving = ref(false)
const done = ref(false)
const resultEdge = ref(0)

onMounted(() => {
  words.value = vocab.placementFirstRound()
})

function toggle(lemma: string) {
  const s = new Set(known.value)
  s.has(lemma) ? s.delete(lemma) : s.add(lemma)
  known.value = s
}

async function next() {
  const flags = words.value.map(w => known.value.has(w.lemma))
  allRounds.push(words.value)
  allKnown.push(flags)

  const ratio = flags.length ? flags.filter(Boolean).length / flags.length : 0
  const mid = Math.round((lo.value + hi.value) / 2)
  if (ratio >= 0.7) lo.value = mid; else hi.value = mid

  round.value++
  if (round.value >= totalRounds) return finish()

  words.value = vocab.placementNextRound(lo.value, hi.value, ratio, exclude)
  known.value = new Set()
  if (!words.value.length) return finish()
}

async function finish() {
  saving.value = true
  resultEdge.value = vocab.placementResult(allRounds, allKnown)
  await vocab.savePlacement(resultEdge.value)
  done.value = true
  saving.value = false
}

async function skip() {
  await vocab.skipPlacement()
  emit('done')
}
</script>

<template>
  <div class="min-h-[100dvh] bg-slate-50">
    <div class="max-w-2xl mx-auto px-4 py-6">
      <template v-if="!done">
        <p class="text-xs text-slate-400 mb-1">Round {{ round + 1 }} of {{ totalRounds }}</p>
        <h1 class="text-xl font-bold mb-1">Tap every word you actually know</h1>
        <p class="text-sm text-slate-500 mb-5">
          Only tap a word if you genuinely know what it means and could use it in a sentence.
          Leave the rest untapped - this sets how simply the AI writes for you from the start,
          nothing more.
        </p>

        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-6">
          <button
            v-for="w in words" :key="w.lemma"
            class="border rounded-xl px-3 py-3 text-left transition"
            :class="known.has(w.lemma) ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-white border-slate-200'"
            @click="toggle(w.lemma)"
          >
            <span class="text-[15px] font-medium">{{ w.lemma }}</span>
            <span class="block text-[10px] text-slate-400">rank {{ w.rank }}</span>
          </button>
        </div>

        <button class="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-medium" @click="next">
          {{ round + 1 >= totalRounds ? 'Finish' : 'Next' }}
        </button>
        <button class="w-full text-slate-400 text-xs py-2" @click="skip">Skip - start simple and let it adjust naturally</button>
      </template>

      <template v-else>
        <h1 class="text-xl font-bold mb-2">Starting point set</h1>
        <p class="text-sm text-slate-500 mb-6">
          The AI will write at roughly the {{ Math.max(resultEdge, 500) }} most common English words to start.
          This updates automatically from your own reading once enough words are fully learned -
          this result only shaped the very first replies.
        </p>
        <button class="w-full bg-emerald-600 text-white rounded-xl py-3 text-sm font-medium" @click="emit('done')">Start reading</button>
      </template>
    </div>
  </div>
</template>
