<script setup lang="ts">
// All 9,000 words in AG Grid. Every column has its own filter (two conditions
// joined by AND/OR), columns sort (shift-click for multi-column), and the
// preset buttons answer the common questions in one tap.
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
ModuleRegistry.registerModules([AllCommunityModule])

const vocab = useVocabDB()
const { speak } = useTTS()
const { viewsToEnter } = useSettings()

const rows = ref<any[]>([])
const edge = ref(0)
const grid = ref<any>(null)
const detail = ref<any>(null)
const shown = ref(0)
const activePreset = ref('all')

const CATEGORY_LABEL: Record<string, string> = {
  untracked: 'too common (ignored)', 'not-started': 'not started', collecting: 'collecting views',
  'queue-today': "today's queue", required: 'required (carried over)',
  new: 'SRS · new', learning: 'SRS · learning', review: 'SRS · review', relearning: 'SRS · relearning'
}

const fmtTime = (ts: number) => {
  if (!ts) return ''
  const d = (Date.now() - ts) / 86400000
  return d < 1 ? Math.round(d * 24) + 'h ago' : Math.round(d) + 'd ago'
}
const fmtDue = (w: any) => {
  if (!w.inSrs) return ''
  const diff = w.due - Date.now()
  if (diff <= 0) return 'now'
  const d = diff / 86400000
  return d < 1 ? Math.round(diff / 3600000) + 'h' : Math.round(d) + 'd'
}

const columnDefs = computed(() => [
  { field: 'lemma', headerName: 'word', pinned: 'left', width: 120, filter: 'agTextColumnFilter' },
  { field: 'freq_rank', headerName: 'rank', width: 90, filter: 'agNumberColumnFilter' },
  { field: 'category', headerName: 'category', width: 210, filter: 'agTextColumnFilter',
    valueFormatter: (p: any) => CATEGORY_LABEL[p.value] || p.value },
  { field: 'inSrs', headerName: 'in SRS', width: 90, filter: 'agTextColumnFilter' },
  { field: 'entrySource', headerName: 'entered by', width: 110, filter: 'agTextColumnFilter' },
  { field: 'views', headerName: `views /${viewsToEnter.value}`, width: 100, filter: 'agNumberColumnFilter' },
  { field: 'tappedOn', headerName: 'last tap', width: 110, filter: 'agTextColumnFilter' },
  { field: 'clicks', headerName: 'taps (info only)', width: 130, filter: 'agNumberColumnFilter' },
  { field: 'clicks', headerName: 'taps', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'sentCount', headerName: 'sent', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'deliveredCount', headerName: 'delivered', width: 100, filter: 'agNumberColumnFilter' },
  { field: 'skipped', headerName: 'skipped', width: 95, filter: 'agNumberColumnFilter' },
  { field: 'lastSentAs', headerName: 'last sent as', width: 130, filter: 'agTextColumnFilter' },
  { field: 'stability', headerName: 'stability', width: 100, filter: 'agNumberColumnFilter' },
  { field: 'difficulty', headerName: 'difficulty', width: 100, filter: 'agNumberColumnFilter' },
  { field: 'reps', headerName: 'reps', width: 80, filter: 'agNumberColumnFilter' },
  { field: 'lapses', headerName: 'lapses', width: 90, filter: 'agNumberColumnFilter' },
  { field: 'dueLabel', headerName: 'next review', width: 115 },
  { field: 'dueAt', headerName: 'due (ms)', width: 110, filter: 'agNumberColumnFilter', hide: true },
  { field: 'lastViewLabel', headerName: 'last counted view', width: 140 },
  { field: 'cefr', headerName: 'band', width: 80, filter: 'agTextColumnFilter' }
])

const defaultColDef = { sortable: true, resizable: true, floatingFilter: true }

async function load() {
  const [list, e] = await Promise.all([vocab.getFullList(), vocab.computeEdge()])
  edge.value = e.edge
  rows.value = list.map((w: any) => ({
    ...w,
    stability: w.card?.stability ? +w.card.stability.toFixed(1) : null,
    difficulty: w.card?.difficulty ? +w.card.difficulty.toFixed(1) : null,
    reps: w.card?.reps ?? null, lapses: w.card?.lapses ?? null,
    dueLabel: fmtDue(w), dueAt: w.inSrs ? w.due : null, lastViewLabel: fmtTime(w.lastViewAt)
  }))
  shown.value = rows.value.length
}

// one-tap answers to the questions you asked about
const today = new Date().toISOString().slice(0, 10)
const eq = (field: string, v: string) => ({ [field]: { filterType: 'text', type: 'equals', filter: v } })
const PRESETS: Record<string, { label: string; model: any }> = {
  all: { label: 'All 9,000', model: null },
  queue: { label: "Today's queue (engine A)", model: eq('category', 'queue-today') },
  required: { label: 'Required', model: eq('category', 'required') },
  collecting: { label: 'Closest to done (engine B)', model: eq('category', 'collecting') },
  notStarted: { label: 'Not started', model: eq('category', 'not-started') },
  due: { label: 'Due now', model: { inSrs: { filterType: 'text', type: 'equals', filter: 'true' }, dueAt: { filterType: 'number', type: 'lessThanOrEqual', filter: Date.now() } } },
  tappedToday: { label: 'Tapped today', model: eq('tappedOn', today) },
  learning: { label: 'SRS learning', model: eq('category', 'learning') },
  review: { label: 'SRS review', model: eq('category', 'review') },
  relearning: { label: 'SRS relearning', model: eq('category', 'relearning') },
  byQueue: { label: 'Entered by queue', model: eq('entrySource', 'queue') },
  byViews: { label: 'Entered by views', model: eq('entrySource', 'views') }
}

function applyPreset(key: string) {
  activePreset.value = key
  const api = grid.value?.api
  if (!api) return
  if (key === 'due') PRESETS.due.model.dueAt.filter = Date.now()
  api.setFilterModel(PRESETS[key].model)
}
function onGridReady(p: any) { grid.value = { api: p.api } }
function onFilterChanged(p: any) { shown.value = p.api.getDisplayedRowCount() }
function exportCsv() { grid.value?.api.exportDataAsCsv({ fileName: 'vocab_words.csv' }) }
function onRowClicked(e: any) { detail.value = e.data }

async function act(kind: 'reset') {
  const l = detail.value.lemma
  await vocab.resetWord(l)
  detail.value = null
  await load()
}

onMounted(load)
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap gap-1.5">
      <button v-for="(p, key) in PRESETS" :key="key"
        class="text-[11px] rounded-full px-3 py-1.5 border"
        :class="activePreset === key ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white border-slate-200 text-slate-600'"
        @click="applyPreset(key as string)">{{ p.label }}</button>
    </div>
    <div class="flex items-center justify-between text-xs text-slate-500">
      <span>{{ shown }} of {{ rows.length }} words</span>
      <button class="bg-slate-100 rounded-lg px-3 py-1.5" @click="exportCsv">⬇ CSV (current view)</button>
    </div>
    <p class="text-[11px] text-slate-400">
      Each column has a filter row under its title; open the filter icon to add a second condition with AND/OR.
      Shift-click column titles to sort by several columns. Tap a row for full details.
    </p>

    <ClientOnly>
      <div class="h-[65vh] rounded-xl overflow-hidden border border-slate-200">
        <AgGridVue
          style="height: 100%; width: 100%"
          :theme="themeQuartz"
          :row-data="rows"
          :column-defs="columnDefs"
          :default-col-def="defaultColDef"
          :animate-rows="false"
          @grid-ready="onGridReady"
          @filter-changed="onFilterChanged"
          @row-clicked="onRowClicked"
        />
      </div>
    </ClientOnly>

    <div v-if="detail" class="fixed inset-0 bg-black/30 z-50 flex items-end sm:items-center justify-center" @click.self="detail = null">
      <div class="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-md max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between mb-2">
          <h3 class="font-bold text-xl">{{ detail.lemma }}</h3>
          <button class="text-slate-400" @click="speak(detail.lemma)">🔊</button>
        </div>
        <p class="text-xs text-emerald-700 mb-3">{{ CATEGORY_LABEL[detail.category] }}</p>
        <dl class="text-sm divide-y divide-slate-100">
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">rank</dt><dd>{{ detail.freq_rank }} of {{ rows.length }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">counted views (gate)</dt><dd>{{ detail.inSrs ? 'in the scheduler' : `${detail.views} / ${viewsToEnter.value}` }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">last counted view</dt><dd>{{ detail.lastViewLabel || 'never' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">taps / last tap</dt><dd>{{ detail.clicks }} / {{ detail.tappedOn || '—' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">entered the scheduler by</dt><dd>{{ detail.entrySource || '—' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">sent / used / skipped</dt><dd>{{ detail.sentCount }} / {{ detail.deliveredCount }} / {{ detail.skipped }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">last sent as</dt><dd>{{ detail.lastSentAs || '—' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">stability / difficulty</dt><dd>{{ detail.stability ?? '—' }} / {{ detail.difficulty ?? '—' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">reviews / lapses</dt><dd>{{ detail.reps ?? '—' }} / {{ detail.lapses ?? '—' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">next review</dt><dd>{{ detail.dueLabel || '—' }}</dd></div>
          <div class="flex justify-between py-1.5"><dt class="text-slate-500">forms seen</dt><dd>{{ detail.forms_seen?.join(', ') || '—' }}</dd></div>
        </dl>
        <button class="w-full mt-4 bg-slate-100 rounded-lg py-2 text-xs" @click="act('reset')">Reset this word</button>
        <button class="mt-2 w-full text-slate-400 text-sm py-1" @click="detail = null">Close</button>
      </div>
    </div>
  </div>
</template>
