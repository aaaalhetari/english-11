<script setup lang="ts">
import dictionaryData from '~/data/dictionary.json'

const props = defineProps<{
  word: string
  candidates?: string[]   // 2+ possible lemmas if `word` is an ambiguous spelling
  contextMeanings: Record<string, string>
  contextSentence: string
}>()
const emit = defineEmits(['close'])

const { registerClick, getAllWords, computeEdge } = useVocabDB()
const { getCard, saveCard } = useSessionCache()
const { askWordCard } = useClaude()
const { define: defineLocal, enabled: localEnabled, option: localOption, loading: localLoading, progress: localProgress, lastMs } = useLocalLLM()
const { speak, downloading, downloadProgress } = useTTS()
const { apiKey } = useApiKey()
const { ttsRepeat } = useSettings()

// On touch screens the tap that opens this card also fires a late click that
// lands on the backdrop. Ignore backdrop closes for a moment after opening.
const mountedAt = Date.now()
function backdropClose() {
  if (Date.now() - mountedAt > 400) emit('close')
}

const definition = ref('')
const examples = ref<string[]>([])
const source = ref('')
const loading = ref(false)
const note = ref('')
const info = ref<any>(null)

const dict = dictionaryData as Record<string, string>

// The explanation is written for the reader's position in the list, and kept
// a little simpler than the word itself.
async function currentLevel() {
  const { edge } = await computeEdge()
  return `someone who knows the ${Math.max(500, edge)} most common English words`
}

const resolvedLemma = ref(props.word)

async function resolve() {
  // an ambiguous spelling (e.g. "left") has no single word until Claude, who
  // wrote the sentence, says which of the candidates it meant
  if (props.candidates?.length) {
    loading.value = true
    const r = await askDisambiguate(props.word, props.contextSentence, props.candidates)
    loading.value = false
    if (r?.lemma) {
      resolvedLemma.value = r.lemma
      registerClick(r.lemma)
      definition.value = r.definition
      examples.value = r.examples
      source.value = 'Claude (resolved from ' + props.candidates.join('/') + ')'
    } else {
      // could not resolve: show a plain dictionary-style answer, register nothing
      definition.value = dict[props.candidates[0]] || 'Could not tell which word this is from context.'
      source.value = 'unresolved - not recorded'
    }
    return
  }

  registerClick(props.word)
  const all = await getAllWords()
  info.value = all.find(w => w.lemma === props.word) || null

  // 1. opened earlier in this session for this sentence (memory only)
  const saved = getCard(props.word, props.contextSentence)
  if (saved) {
    definition.value = saved.definition
    examples.value = saved.examples
    source.value = saved.source + ' (this session)'
    return
  }

  // 2. meaning Claude already gave inside the reply itself (free, instant)
  if (props.contextMeanings[props.word]) {
    definition.value = props.contextMeanings[props.word]
    source.value = 'this reply'
    return
  }

  const level = await currentLevel()
  loading.value = true

  // 3. on-device model, if the user turned one on
  if (localEnabled.value) {
    const res = await defineLocal(props.word, props.contextSentence, level)
    if (res?.definition) {
      definition.value = res.definition
      examples.value = res.examples
      source.value = `${localOption.value.label} · ${lastMs.value} ms`
      loading.value = false
      saveCard(props.word, props.contextSentence, { definition: res.definition, examples: res.examples, source: localOption.value.label })
      return
    }
    note.value = 'The on-device model did not answer; used the next source.'
  }

  // 4. Claude
  if (apiKey.value) {
    const res = await askWordCard(props.word, props.contextSentence, level)
    if (res?.definition) {
      definition.value = res.definition
      examples.value = res.examples
      source.value = 'Claude'
      loading.value = false
      saveCard(props.word, props.contextSentence, { definition: res.definition, examples: res.examples, source: 'Claude' })
      return
    }
  }

  // 5. offline dictionary
  definition.value = dict[props.word] || 'No definition available offline for this word.'
  source.value = 'dictionary'
  loading.value = false
}


onMounted(resolve)
</script>

<template>
  <div class="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50" @click.self="backdropClose()">
    <div class="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md shadow-xl max-h-[85vh] overflow-y-auto">
      <div class="flex items-start justify-between mb-1">
        <div>
          <h3 class="font-bold text-xl">{{ props.candidates?.length ? resolvedLemma : word }}</h3>
          <p v-if="info" class="text-[11px] text-slate-400">
            rank {{ info.freq_rank }} · {{ info.inSrs ? 'in the scheduler' : `views ${info.views}` }} · taps {{ info.clicks }}
          </p>
        </div>
        <button class="text-slate-500 text-sm border border-slate-200 rounded-lg px-3 py-1.5" @click="speak(word)">
          {{ downloading ? `${downloadProgress}%` : `🔊${ttsRepeat > 1 ? ' ×' + ttsRepeat : ''}` }}
        </button>
      </div>

      <p v-if="localLoading" class="text-xs text-slate-400 my-2">Loading the on-device model… {{ localProgress }}%</p>
      <p v-else-if="loading" class="text-sm text-slate-400 my-3">Working on it…</p>

      <template v-if="!loading">
        <p class="text-[15px] text-slate-800 leading-relaxed mt-3">{{ definition }}</p>

        <ul v-if="examples.length" class="mt-3 space-y-1.5">
          <li v-for="(ex, i) in examples" :key="i" class="text-sm text-slate-600 bg-slate-50 rounded-lg px-3 py-2">{{ ex }}</li>
        </ul>

        <p v-if="note" class="text-[11px] text-amber-600 mt-2">{{ note }}</p>
        <p class="text-[11px] text-slate-400 mt-2">Source: {{ source }}</p>
      </template>

      <button class="mt-5 w-full bg-slate-100 rounded-lg py-2 text-sm" @click="emit('close')">Close</button>
    </div>
  </div>
</template>
