// One shared reactive value for the whole app (stored only in this browser's
// localStorage, sent directly to Anthropic per request, never to any server)
let shared: ReturnType<typeof useLocalStorage<string>> | null = null

export function useApiKey() {
  if (!shared) shared = useLocalStorage<string>('vocab_app_api_key', '')
  const apiKey = shared

  function hasKey() {
    return !!apiKey.value && apiKey.value.trim().length > 0
  }

  function clearKey() {
    apiKey.value = ''
  }

  return { apiKey, hasKey, clearKey }
}
