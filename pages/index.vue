<script setup lang="ts">
const { apiKey } = useApiKey()
const demoMode = ref(false)
function onStartReal(key: string) { apiKey.value = key; demoMode.value = false }
</script>

<template>
  <ClientOnly>
    <ReaderPanel v-if="apiKey && apiKey.trim()" />
    <DemoPanel v-else-if="demoMode" @start-real="onStartReal" />
    <ApiKeySetup v-else @demo="demoMode = true" />
  </ClientOnly>
</template>
