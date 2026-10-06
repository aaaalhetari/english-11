<script setup lang="ts">
// Pick a range of chats (e.g. chat 5 to chat 6) and see every word that
// changed in it: its full state before the range, after it, and why.
import { AgGridVue } from 'ag-grid-vue3'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
ModuleRegistry.registerModules([AllCommunityModule])

const vocab = useVocabDB()
const turns = ref<any[]>([])
const fromTurn = ref(0)
const toTurn = ref(0)
const rows = ref<any[]>([])
const shown = ref(0)

const STATE = ['new', 'learning', 'review', 'relearning']
const stateName = (n: number) => (n === -1 ? 'not in SRS' : STATE[n] ?? '')
const dueTxt = (ms: number) => {
  if (!ms) return ''
  const d = (ms - Date.now()) / 86400000
  return d <= 0 ? 'now' : d < 1 ? Math.round(d * 24) + 'h' : Math.round(d) + 'd'
}
const pair = (a: any, b: any) => (a === b ? String(a ?? '') : `${a ?? '—'} → ${b ?? '—'}`)

async function loadTurns() {
  const list = await vocab.getTurns(300)
  turns.value = list.filter((t: any) => t.turn).sort((a: any, b: any) => a.turn - b.turn)
  const last = turns.value.length ? turns.value[turns.value.length - 1].turn : 0
  fromTurn.value = last; toTurn.value = last
  await load()
}

async function load() {
  const lo = Math.min(fromTurn.value, toTurn.value), hi = Math.max(fromTurn.value, toTurn.value)
  const list = await vocab.getChanges(lo, hi)
  const full = new Map((await vocab.getFullList()).map((w: any) => [w.lemma, w]))
  rows.value = list.map((r: any) => {
    const b = r.before, a = r.after
    return {
      lemma: r.lemma, rank: full.get(r.lemma)?.freq_rank ?? null, turns: r.turns.join(', '),
      reasons: r.reasons.join(' · '),
      category: pair(b.category, a.category), categoryChanged: b.category !== a.category ? 'yes' : 'no',
      srs: pair(b.inSrs ? 'yes' : 'no', a.inSrs ? 'yes' : 'no'), enteredSrs: !b.inSrs && a.inSrs ? 'yes' : 'no',
      stage: pair(stateName(b.state), stateName(a.state)),
      gate: pair(b.views, a.views), gateDelta: (a.views ?? 0) - (b.views ?? 0),
      taps: pair(b.clicks, a.clicks), tapsDelta: a.clicks - b.clicks,
      sent: pair(b.sentCount, a.sentCount), delivered: pair(b.deliveredCount, a.deliveredCount),
      skipped: pair(b.skipped, a.skipped),
      due: pair(dueTxt(b.due), dueTxt(a.due)), stability: pair(b.stability, a.stability)
    }
  })
  shown.value = rows.value.length
}

const columnDefs = [
  { field: 'lemma', headerName: 'word', pinned: 'left', width: 115, filter: 'agTextColumnFilter' },
  { field: 'rank', headerName: 'rank', width: 85, filter: 'agNumberColumnFilter' },
  { field: 'turns', headerName: 'in chats', width: 95, filter: 'agTextColumnFilter' },
  { field: 'reasons', headerName: 'what happened', width: 300, filter: 'agTextColumnFilter' },
  { field: 'category', headerName: 'category', width: 230, filter: 'agTextColumnFilter' },
  { field: 'categoryChanged', headerName: 'category changed', width: 130, filter: 'agTextColumnFilter' },
  { field: 'srs', headerName: 'in SRS', width: 100 },
  { field: 'enteredSrs', headerName: 'entered SRS', width: 115, filter: 'agTextColumnFilter' },
  { field: 'stage', headerName: 'stage', width: 190, filter: 'agTextColumnFilter' },
  { field: 'gate', headerName: 'views', width: 100 },
  { field: 'gateDelta', headerName: 'Δ views', width: 95, filter: 'agNumberColumnFilter' },
  { field: 'taps', headerName: 'taps', width: 85 },
  { field: 'tapsDelta', headerName: 'Δ taps', width: 90, filter: 'agNumberColumnFilter' },
  { field: 'sent', headerName: 'sent', width: 90 },
  { field: 'delivered', headerName: 'delivered', width: 100 },
  { field: 'skipped', headerName: 'skipped', width: 95 },
  { field: 'due', headerName: 'next review', width: 120 },
  { field: 'stability', headerName: 'stability', width: 120 }
]
const defaultColDef = { sortable: true, resizable: true, floatingFilter: true }
const onFilterChanged = (p: any) => { shown.value = p.api.getDisplayedRowCount() }
const turnLabel = (t: any) => `#${t.turn} · ${new Date(t.at).toLocaleString()} · ${String(t.question).slice(0, 40)}`

onMounted(loadTurns)
</script>

<template>
  <div class="space-y-3">
    <div v-if="!turns.length" class="text-sm text-slate-400 bg-white border border-slate-200 rounded-xl p-4">
      No chats recorded yet. Every chat from now on is logged here.
    </div>
    <template v-else>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label class="text-xs text-slate-500">From chat
          <select v-model.number="fromTurn" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm" @change="load">
            <option v-for="t in turns" :key="t.turn" :value="t.turn">{{ turnLabel(t) }}</option>
          </select>
        </label>
        <label class="text-xs text-slate-500">To chat
          <select v-model.number="toTurn" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm" @change="load">
            <option v-for="t in turns" :key="t.turn" :value="t.turn">{{ turnLabel(t) }}</option>
          </select>
        </label>
      </div>
      <p class="text-[11px] text-slate-400">
        Shows every word whose state changed in the selected chats. "a → b" is the value before the first
        chat and after the last one. Choose the same chat twice to see one chat alone; choose 5 and 6 to see
        everything that changed across both. Taps made after a reply are counted in that chat.
      </p>
      <p class="text-xs text-slate-500">{{ shown }} words changed</p>
      <ClientOnly>
        <div class="h-[60vh] rounded-xl overflow-hidden border border-slate-200">
          <AgGridVue style="height:100%;width:100%" :theme="themeQuartz" :row-data="rows"
            :column-defs="columnDefs" :default-col-def="defaultColDef" @filter-changed="onFilterChanged" />
        </div>
      </ClientOnly>
    </template>
  </div>
</template>
