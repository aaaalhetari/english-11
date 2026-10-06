<script setup lang="ts">
const emit = defineEmits<{ (e: 'start-real', key: string): void }>()
const { seedDemo, getStats, getAllWords, computeEdge } = useVocabDB()
const showDashboard = ref(false)

const stats = ref({ tracked: 0, due: 0, total: 0 })
const targets = ref(new Set<string>())
const frontier = ref(0)
const keyInput = ref('')
const chunks = ref<string[]>([])
const question = ref('')
const answers = ref<{ q: string; chunks: string[]; a: string }[]>([])

// A fixed sample reply, so clicking words, the voice and selection can all be
// tested with zero API calls
const demoText = `New research suggests that coral reefs can be surprisingly resilient when given enough time to recover.

Scientists acknowledge that the process is slow, but improved technology could help facilitate faster restoration in marine environments. The findings offer a substantial and credible reason for optimism among biologists.`

// Simulates the context-meaning section a real reply includes
const demoContextMeanings = {
  resilient: 'able to recover quickly after being damaged, as coral reefs can when given time'
}

async function refresh() {
  const [st, all, e] = await Promise.all([getStats(), getAllWords(), computeEdge()])
  stats.value = st as any
  frontier.value = e.edge
  // in the demo, the seeded words play the role of the pushed words
  targets.value = new Set(all.map(w => w.lemma))
}

function askDemo() {
  const q = question.value.trim()
  if (!q || !chunks.value.length) return
  answers.value.push({
    q,
    chunks: [...chunks.value],
    a: 'This is a demo answer. Once you add your API key, the AI will answer your question about the selected passages here.'
  })
  chunks.value = []
  question.value = ''
}

function start() {
  const key = keyInput.value.trim()
  if (key) emit('start-real', key)
}

onMounted(async () => {
  await seedDemo()
  await refresh()
})
</script>

<template>
  <div class="min-h-[100dvh] bg-slate-50">
    <div class="max-w-3xl mx-auto px-4 py-6">
      <div class="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2 mb-4 text-xs text-amber-800">
        Demo mode: sample data only, no API calls are made.
      </div>

      <div class="flex items-center justify-between mb-5">
        <h1 class="text-base font-bold">Vocab Reader</h1>
        <button class="text-xs border border-slate-200 rounded-lg px-3 py-1.5 bg-white" @click="showDashboard = true">Dashboard</button>
        <div class="text-[11px] text-slate-500 flex gap-3">
          <span>edge {{ frontier }}/{{ stats.total }}</span><span>seen {{ stats.tracked }}</span>
        </div>
      </div>

      <div class="space-y-5">
        <div class="flex justify-end">
          <div class="max-w-[85%] bg-emerald-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[15px]">
            How do coral reefs recover after damage?
          </div>
        </div>

        <div class="flex justify-start gap-2">
          <div class="w-7 h-7 shrink-0 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center mt-0.5">AI</div>
          <div class="max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
            <ClickableText
              :text="demoText"
              :context-meanings="demoContextMeanings"
              :targets="targets"
              @add-chunk="t => chunks.push(t)"
              @word-closed="refresh"
            />
          </div>
        </div>

        <template v-for="(item, i) in answers" :key="i">
          <div class="flex justify-end">
            <div class="max-w-[85%] bg-emerald-600 text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[15px]">
              <div v-for="(c, j) in item.chunks" :key="j" class="text-xs bg-emerald-700/60 rounded-lg px-2 py-1 italic mb-1">“{{ c }}”</div>
              {{ item.q }}
            </div>
          </div>
          <div class="flex justify-start gap-2">
            <div class="w-7 h-7 shrink-0 rounded-full bg-slate-800 text-white text-xs flex items-center justify-center">AI</div>
            <div class="max-w-[85%] bg-white border border-slate-200 rounded-2xl rounded-tl-md px-4 py-3 text-[15px] shadow-sm">{{ item.a }}</div>
          </div>
        </template>
      </div>

      <div class="mt-4 text-xs text-slate-400 space-y-1">
        <p>• <strong>One tap</strong> on any word says it out loud. <strong>Two taps</strong> open its meaning card. Green words are the ones being pushed right now.</p>
        <p>• Select a phrase with the mouse, press “+ Add to selection”, select another, then ask about them below.</p>
      </div>

      <div v-if="chunks.length" class="mt-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
        <div class="flex flex-wrap gap-1.5 mb-2">
          <span v-for="(c, i) in chunks" :key="i" class="selection-marked text-xs px-2 py-1 flex items-center gap-1">
            “{{ c.length > 40 ? c.slice(0, 40) + '…' : c }}”
            <button class="text-amber-800 font-bold" @click="chunks.splice(i, 1)">×</button>
          </span>
        </div>
        <div class="flex gap-2">
          <input v-model="question" class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" placeholder="Ask about the selected passages…" @keyup.enter="askDemo" />
          <button class="bg-amber-500 text-white rounded-lg px-4 text-sm" @click="askDemo">Ask</button>
        </div>
      </div>

      <div class="mt-10 border-t border-slate-200 pt-5">
        <p class="text-sm font-medium mb-1">Everything working the way you expect?</p>
        <p class="text-xs text-slate-500 mb-3">Add your Anthropic API key to start real conversations.</p>
        <div class="flex gap-2">
          <input v-model="keyInput" type="password" placeholder="sk-ant-..." class="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" @keyup.enter="start" />
          <button class="bg-emerald-600 text-white rounded-lg px-4 text-sm font-medium disabled:opacity-40" :disabled="!keyInput.trim()" @click="start">Start learning</button>
        </div>
      </div>
    </div>

    <ClientOnly>
      <Dashboard v-if="showDashboard" @close="showDashboard = false; refresh()" />
    </ClientOnly>
  </div>
</template>
