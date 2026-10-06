<script setup lang="ts">
const { apiKey } = useApiKey()
const demoMode = ref(false)
const placementDone = ref(true)
const checkingPlacement = ref(true)
const { isPlacementDone } = useVocabDB()

async function onStartReal(key: string) {
  apiKey.value = key
  demoMode.value = false
}

watchEffect(async () => {
  if (apiKey.value && apiKey.value.trim()) {
    checkingPlacement.value = true
    placementDone.value = await isPlacementDone()
    checkingPlacement.value = false
  }
})
</script>

<template>
  <ClientOnly>
    <template v-if="apiKey && apiKey.trim()">
      <PlacementTest v-if="!checkingPlacement && !placementDone" @done="placementDone = true" />
      <ReaderPanel v-else-if="!checkingPlacement" />
    </template>
    <DemoPanel v-else-if="demoMode" @start-real="onStartReal" />
    <ApiKeySetup v-else @demo="demoMode = true" />
  </ClientOnly>
</template>
