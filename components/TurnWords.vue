<script setup lang="ts">
// Shows exactly which words were offered to the AI for this reply, where each
// one came from, and whether it actually made it into the text.
const props = defineProps<{
  sent: { lemma: string; source: string }[]
  used: string[]
  frontier: number
}>()

const open = ref(false)
const usedSet = computed(() => new Set(props.used))

const SOURCE_LABEL: Record<string, string> = {
  required: 'required (queue engine, day-old)',
  due: 'SRS review due (by priority)',
  tapped: 'tapped today',
  watching: 'closest to 10 views (view engine)',
  queue: "today's queue (importance engine)"
}
const SOURCE_COLOR: Record<string, string> = {
  required: 'bg-rose-50 border-rose-200 text-rose-800',
  due: 'bg-amber-50 border-amber-200 text-amber-800',
  tapped: 'bg-violet-50 border-violet-200 text-violet-800',
  watching: 'bg-teal-50 border-teal-200 text-teal-800',
  queue: 'bg-sky-50 border-sky-200 text-sky-800'
}

const groups = computed(() => {
  const by: Record<string, { lemma: string; used: boolean }[]> = {}
  for (const it of props.sent) {
    (by[it.source] ||= []).push({ lemma: it.lemma, used: usedSet.value.has(it.lemma) })
  }
  for (const k in by) by[k].sort((a, b) => Number(b.used) - Number(a.used))
  return by
})

const usedCount = computed(() => props.sent.filter(i => usedSet.value.has(i.lemma)).length)
</script>

<template>
  <div v-if="sent.length" class="mt-2 ml-9">
    <button class="text-[11px] text-slate-400 hover:text-slate-600 flex items-center gap-1" @click="open = !open">
      <span>{{ open ? '▾' : '▸' }}</span>
      {{ usedCount }} of {{ sent.length }} offered words used · edge {{ frontier }}
    </button>

    <div v-if="open" class="mt-2 bg-white border border-slate-200 rounded-xl p-3 space-y-3">
      <div v-for="(list, source) in groups" :key="source">
        <p class="text-[11px] font-medium text-slate-500 mb-1">
          {{ SOURCE_LABEL[source] || source }}
          <span class="text-slate-400">({{ list.filter(l => l.used).length }}/{{ list.length }} used)</span>
        </p>
        <div class="flex flex-wrap gap-1">
          <span v-for="w in list" :key="w.lemma"
            class="text-[11px] border rounded-full px-2 py-0.5"
            :class="w.used ? SOURCE_COLOR[source] + ' font-medium' : 'border-slate-200 text-slate-300 line-through'">
            {{ w.lemma }}
          </span>
        </div>
      </div>
      <p class="text-[10px] text-slate-400 pt-1 border-t border-slate-100">
        Faded and struck through = offered but not used. Unused queue words become required tomorrow
        (max 3 per reply); unused optional words rest for a few turns after repeated skips.
      </p>
    </div>
  </div>
</template>
