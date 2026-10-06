<script setup lang="ts">
const emit = defineEmits(['demo'])
const { apiKey } = useApiKey()
const input = ref(apiKey.value)

function save() {
  apiKey.value = input.value.trim()
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-slate-50 px-4">
    <div class="bg-white shadow-sm border border-slate-200 rounded-xl p-6 w-full max-w-sm">
      <h1 class="text-lg font-bold mb-1">Anthropic API Key</h1>
      <p class="text-sm text-slate-500 mb-4">
        Stored only on this device (localStorage). Sent directly to Anthropic per request, never to any other server.
      </p>
      <input
        v-model="input"
        type="password"
        placeholder="sk-ant-..."
        class="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-emerald-500"
        @keyup.enter="save"
      />
      <button
        class="w-full bg-emerald-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-40"
        :disabled="!input.trim()"
        @click="save"
      >
        Save &amp; continue
      </button>

      <div class="flex items-center gap-2 my-4">
        <div class="flex-1 h-px bg-slate-200"></div>
        <span class="text-xs text-slate-400">or</span>
        <div class="flex-1 h-px bg-slate-200"></div>
      </div>

      <button
        class="w-full bg-slate-100 text-slate-700 rounded-lg py-2 text-sm font-medium hover:bg-slate-200"
        @click="emit('demo')"
      >
        Try a demo first — no key needed
      </button>
      <p class="text-xs text-slate-400 mt-2 text-center">
        Test clicking words, the voice, and text selection with sample data.
      </p>
    </div>
  </div>
</template>
