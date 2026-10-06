<script setup lang="ts">
const emit = defineEmits(['close'])
const vocab = useVocabDB()
const { speak, prefetching, lastError: ttsError, voiceOptions, clipCount } = useTTS()
const { cardCount } = useSessionCache()
const st = useSettings()
const { preload, loading: llmLoading, progress: llmProgress, error: llmError, option: llmOption, lastMs } = useLocalLLM()

const tab = ref<'progress' | 'words' | 'history' | 'ai' | 'settings'>('progress')
const stats = ref<any>({ counts: {}, total: 0, inSrs: 0, due: 0, tappedToday: 0 })
const edge = ref<any>({ edge: 0, reviewCount: 0, pct: 0.98, fromQueue: true })
const queue = ref<any>({ batch: [], delivered: [], required: [] })
const todayRow = ref<any>({ queueDelivered: 0, requiredDelivered: 0, viewEntries: 0, taps: 0, turns: 0 })
const daily = ref<any[]>([])
const ignored = ref<any[]>([])

const CATS: [string, string][] = [
  ['review', 'In SRS — review'], ['learning', 'In SRS — learning'], ['new', 'In SRS — new (not yet rated)'],
  ['relearning', 'In SRS — relearning'], ['required', 'Required (carried over)'], ['queue-today', "Today's queue"],
  ['collecting', 'Collecting views'], ['not-started', 'Not started'], ['untracked', 'Too common, ignored']
]
const maxDue = computed(() => Math.max(1, ...daily.value.map((d: any) => Math.max(d.dueMax, d.queueDelivered + d.requiredDelivered))))

async function refresh() {
  const [s, e, q, t, d, ig] = await Promise.all([
    vocab.getStats(), vocab.computeEdge(), vocab.getQueue(), vocab.getToday(), vocab.getDaily(14), vocab.getIgnoredWords()
  ])
  stats.value = s; edge.value = e; queue.value = q; todayRow.value = t; daily.value = d; ignored.value = ig
}
async function handleExport() {
  const url = URL.createObjectURL(new Blob([await vocab.exportData()], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = `vocab_backup_${new Date().toISOString().slice(0, 10)}.json`; a.click()
  URL.revokeObjectURL(url)
}
async function redoPlacement() {
  await vocab.setMeta('placementDone', false)
  location.reload()
}
function triggerImport() {
  const el = document.createElement('input'); el.type = 'file'; el.accept = 'application/json'
  el.onchange = async (e: any) => { const f = e.target.files[0]; if (f) { await vocab.importData(await f.text()); await refresh() } }
  el.click()
}
onMounted(refresh)
</script>

<template>
  <div class="fixed inset-0 bg-slate-50 z-50 flex flex-col">
    <header class="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between">
      <h2 class="font-bold">Dashboard</h2>
      <button class="text-sm text-slate-500 px-3 py-1.5 rounded-lg hover:bg-slate-100" @click="emit('close')">Done</button>
    </header>
    <nav class="bg-white border-b border-slate-200 flex text-sm">
      <button v-for="t in (['progress','words','history','ai','settings'] as const)" :key="t"
        class="flex-1 py-2.5 capitalize border-b-2"
        :class="tab === t ? 'border-emerald-600 text-emerald-700 font-medium' : 'border-transparent text-slate-500'"
        @click="tab = t">{{ t }}</button>
    </nav>

    <div class="flex-1 overflow-y-auto">
      <div class="max-w-3xl mx-auto p-4 space-y-4">

        <!-- PROGRESS -->
        <template v-if="tab === 'progress'">
          <div class="bg-white rounded-xl p-4 border border-slate-200">
            <h3 class="font-medium text-sm mb-3">Today</h3>
            <div class="grid grid-cols-2 gap-3 text-center">
              <div class="bg-sky-50 rounded-lg p-2"><p class="text-xl font-bold text-sky-700">{{ queue.delivered.length }}/{{ queue.batch.length }}</p><p class="text-[11px] text-sky-800">queue words delivered</p></div>
              <div class="bg-rose-50 rounded-lg p-2"><p class="text-xl font-bold text-rose-700">{{ queue.required.length }}</p><p class="text-[11px] text-rose-800">required, still pending</p></div>
              <div class="bg-amber-50 rounded-lg p-2"><p class="text-xl font-bold text-amber-700">{{ stats.due }}</p><p class="text-[11px] text-amber-800">reviews due now</p></div>
              <div class="bg-violet-50 rounded-lg p-2"><p class="text-xl font-bold text-violet-700">{{ stats.tappedToday }}</p><p class="text-[11px] text-violet-800">tapped today</p></div>
            </div>
            <p class="text-[11px] text-slate-500 mt-3">
              Entered the scheduler today: {{ todayRow.queueDelivered + todayRow.requiredDelivered }} from the queue,
              {{ todayRow.viewEntries }} through the view gate. Chats today: {{ todayRow.turns }}.
            </p>
            <p v-if="queue.batch.length" class="text-[11px] text-slate-400 mt-1">
              Today's queue: {{ queue.batch.join(', ') }}
            </p>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200">
            <div class="flex items-baseline justify-between mb-1">
              <h3 class="font-medium text-sm">Writing level (edge)</h3>
              <span class="text-2xl font-bold text-emerald-600">{{ edge.edge }}</span>
            </div>
            <p class="text-[11px] text-slate-400">
              Only tells the AI how simply to write: the rank below which {{ Math.round(edge.pct * 100) }}% of your review words sit.
              <template v-if="edge.fromPlacement">Until {{ st.minReviewForEdge.value }} words reach review ({{ edge.reviewCount }} so far) it follows your placement test result.</template>
              <template v-else-if="edge.fromQueue">Until {{ st.minReviewForEdge.value }} words reach review ({{ edge.reviewCount }} so far) it follows the queue position.</template>
            </p>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200">
            <h3 class="font-medium text-sm mb-2">All 9,000 words by category</h3>
            <div v-for="[key, label] in CATS" :key="key" class="flex justify-between text-xs py-1 border-b border-slate-50 last:border-0">
              <span class="text-slate-600">{{ label }}</span><span class="font-medium">{{ stats.counts?.[key] || 0 }}</span>
            </div>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200">
            <h3 class="font-medium text-sm mb-1">Reviews due vs. words used, per day</h3>
            <p class="text-[11px] text-slate-400 mb-3">If the amber bars keep growing while the green ones stay flat, reviews are piling up.</p>
            <div v-if="!daily.length" class="text-sm text-slate-400">No data yet.</div>
            <div v-for="d in daily" :key="d.date" class="mb-2">
              <div class="flex justify-between text-[11px] text-slate-500 mb-0.5">
                <span>{{ d.date.slice(5) }}</span><span>{{ d.dueMax }} due · {{ d.queueDelivered + d.requiredDelivered }} new in · {{ d.viewEntries }} by views · {{ d.taps }} taps</span>
              </div>
              <div class="flex gap-1">
                <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-amber-400" :style="{ width: (d.dueMax / maxDue * 100) + '%' }"></div></div>
                <div class="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-emerald-500" :style="{ width: ((d.queueDelivered + d.requiredDelivered) / maxDue * 100) + '%' }"></div></div>
              </div>
            </div>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 text-xs text-slate-500 space-y-1">
            <p>This session only (cleared when the app closes): {{ cardCount() }} meaning cards, {{ clipCount() }} audio clips<span v-if="prefetching"> · voicing {{ prefetching }} more</span>.</p>
            <p v-if="ttsError" class="text-amber-600">Voice: {{ ttsError }}</p>
          </div>
        </template>

        <template v-else-if="tab === 'words'"><WordTable /></template>
        <template v-else-if="tab === 'history'"><TurnHistory /></template>

        <!-- AI -->
        <template v-else-if="tab === 'ai'">
          <div class="bg-white rounded-xl p-4 border border-slate-200">
            <h3 class="font-medium text-sm mb-1">Optional words the AI keeps skipping</h3>
            <p class="text-[11px] text-slate-400 mb-3">After {{ st.cooldownAfter.value }} skips a word rests for {{ st.cooldownTurns.value }} turns. Required words never rest.</p>
            <div v-if="!ignored.length" class="text-sm text-slate-400">Nothing skipped yet.</div>
            <div v-for="w in ignored" :key="w.lemma" class="flex justify-between py-1.5 border-b border-slate-50 last:border-0 text-sm">
              <span>{{ w.lemma }}</span><span class="text-[11px] text-slate-400">skipped {{ w.skipped }}× · sent {{ w.sentCount }}×</span>
            </div>
          </div>
          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-3">
            <h3 class="font-medium text-sm">On-device model (offline meanings)</h3>
            <select v-model="st.llmModel.value" class="w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
              <option v-for="o in st.LLM_OPTIONS" :key="o.id" :value="o.id">{{ o.label }} — {{ o.size }}</option>
            </select>
            <p class="text-xs text-slate-500">{{ llmOption.note }}</p>
            <div class="flex items-center gap-2">
              <button class="text-xs bg-slate-100 rounded-lg px-3 py-1.5" :disabled="st.llmModel.value === 'off'" @click="preload">Download / load now</button>
              <span v-if="llmLoading" class="text-xs text-slate-400">{{ llmProgress }}%</span>
              <span v-else-if="lastMs" class="text-xs text-slate-400">last answer {{ lastMs }} ms</span>
            </div>
            <p v-if="llmError" class="text-xs text-amber-600">{{ llmError }}</p>
          </div>
        </template>

        <!-- SETTINGS -->
        <template v-else>
          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Entry rule (one for every word)</h3>
            <label class="block text-xs text-slate-500">Views without a tap needed to enter: {{ st.viewsToEnter.value }}
              <input v-model.number="st.viewsToEnter.value" type="range" min="3" max="20" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">Fixed for every word, whatever its rank. At least 1 hour must pass between two counted views. A tap only shows the meaning - it never enters a word that is outside the scheduler.</span>
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Engine A — the daily queue</h3>
            <label class="block text-xs text-slate-500">Most-important words pushed per day: {{ st.queuePerDay.value }}
              <input v-model.number="st.queuePerDay.value" type="range" min="0" max="40" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">Takes the most important word not yet in the scheduler, whatever its current view count, and offers it to the AI so it gets used. This is what guarantees no word is ever skipped forever.</span>
            </label>
            <label class="block text-xs text-slate-500">Required words per reply, at most: {{ st.forcedPerReply.value }}
              <input v-model.number="st.forcedPerReply.value" type="range" min="0" max="10" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">A queue word the AI did not use on its day becomes required the next day.</span>
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-2">
            <h3 class="font-medium text-sm">Engine B — closest to done</h3>
            <p class="text-[11px] text-slate-400">No setting: among words that already have at least one view, the ones with the most views are always offered first, because they need the fewest more to finish.</p>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">The scheduler (FSRS)</h3>
            <label class="block text-xs text-slate-500">Learning steps for new words
              <input v-model="st.learningSteps.value" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm" placeholder="10m, 1h" />
              <span class="block text-[11px] text-slate-400">Times between the first appearances of a queue word, e.g. "10m, 1h". Units: m, h, d.</span>
            </label>
            <label class="block text-xs text-slate-500">Relearning steps after a tap
              <input v-model="st.relearningSteps.value" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm" placeholder="10m, 1h, 3h, 6h" />
              <span class="block text-[11px] text-slate-400">How often a tapped word comes back during the day. "10m, 1h, 3h, 6h" brings it back about five times before it returns to review. A tapped word is also offered in every chat for the rest of the day.</span>
            </label>
            <p class="text-[11px] text-slate-400 mb-1">Reviews due are sent by priority: how overdue a word is, combined with how frequent it is - not simply oldest-due-first.</p>
            <label class="block text-xs text-slate-500">A review word counts once {{ Math.round(st.reviewFraction.value * 100) }}% of its interval has passed
              <input v-model.number="st.reviewFraction.value" type="range" min="0.1" max="1" step="0.05" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">Stops common words from drifting years away just because they keep appearing.</span>
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Writing level</h3>
            <label class="block text-xs text-slate-500">Edge percentile: {{ Math.round(st.edgePercentile.value * 100) }}%
              <input v-model.number="st.edgePercentile.value" type="range" min="0.8" max="0.99" step="0.01" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">Higher = simpler wording. Affects only how the AI writes, never which words are learned.</span>
            </label>
            <label class="block text-xs text-slate-500">Follow the queue position until {{ st.minReviewForEdge.value }} words are in review
              <input v-model.number="st.minReviewForEdge.value" type="range" min="10" max="200" step="10" class="w-full mt-1" />
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">What gets sent to the AI</h3>
            <label class="block text-xs text-slate-500">Optional words per reply: {{ st.candidateCount.value }}
              <input v-model.number="st.candidateCount.value" type="range" min="10" max="100" step="5" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">Order: reviews due, words tapped today, today's queue. Required words come on top and are never cut.</span>
            </label>
            <label class="block text-xs text-slate-500">Previous exchanges sent with each question: {{ st.historyTurns.value }}
              <input v-model.number="st.historyTurns.value" type="range" min="0" max="20" class="w-full mt-1" />
              <span class="block text-[11px] text-slate-400">The AI has no memory; past messages are re-sent every time. Fewer = cheaper.</span>
            </label>
            <label class="block text-xs text-slate-500">Rest an optional word after {{ st.cooldownAfter.value }} skips, for {{ st.cooldownTurns.value }} turns
              <input v-model.number="st.cooldownAfter.value" type="range" min="1" max="15" class="w-full mt-1" />
              <input v-model.number="st.cooldownTurns.value" type="range" min="1" max="10" class="w-full mt-1" />
            </label>
            <label class="block text-xs text-slate-500">Ignore words more common than rank {{ st.minTrackRank.value }}
              <input v-model.number="st.minTrackRank.value" type="range" min="0" max="1500" step="50" class="w-full mt-1" />
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Voice</h3>
            <label class="block text-xs text-slate-500">Voice
              <select v-model="st.voiceId.value" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm">
                <option v-for="v in voiceOptions" :key="v.id" :value="v.id">{{ v.label }}</option>
              </select>
            </label>
            <label class="block text-xs text-slate-500">Say each word {{ st.ttsRepeat.value }}× per tap
              <input v-model.number="st.ttsRepeat.value" type="range" min="1" max="5" class="w-full mt-1" />
            </label>
            <label class="flex items-start gap-2 text-sm"><input v-model="st.ttsPrefetch.value" type="checkbox" class="mt-1" />
              <span>Voice words in advance<span class="block text-[11px] text-slate-400">Kept in memory for this session only, so a tap plays at once.</span></span>
            </label>
            <button class="text-xs bg-slate-100 rounded-lg px-3 py-1.5" @click="speak('recover')">Test the voice</button>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-4">
            <h3 class="font-medium text-sm">Display</h3>
            <label class="flex items-start gap-2 text-sm"><input v-model="st.markTargetsOnly.value" type="checkbox" class="mt-1" />
              <span>Highlight only the words sent this turn<span class="block text-[11px] text-slate-400">Every word stays tappable either way.</span></span>
            </label>
          </div>

          <div class="bg-white rounded-xl p-4 border border-slate-200 space-y-2">
            <h3 class="font-medium text-sm">Data</h3>
            <div class="flex gap-2">
              <button class="flex-1 text-xs bg-slate-100 rounded-lg px-3 py-2" @click="handleExport">⬇ Export</button>
              <button class="flex-1 text-xs bg-slate-100 rounded-lg px-3 py-2" @click="triggerImport">⬆ Import</button>
            </div>
            <button class="w-full text-xs bg-slate-100 rounded-lg px-3 py-2" @click="redoPlacement">↻ Redo the placement test</button>
            <p class="text-[11px] text-slate-400">Only affects writing difficulty until enough words reach review on their own - never which words you learn.</p>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
