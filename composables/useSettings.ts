// Everything you can change, in one place. Each value is stored on this device.
export interface LlmOption {
  id: string; label: string; repo: string
  task: 'text-generation' | 'text2text-generation'
  size: string; note: string
}

export const LLM_OPTIONS: LlmOption[] = [
  { id: 'off', label: 'Off (Claude / dictionary)', repo: '', task: 'text-generation', size: '0 MB', note: 'No local model. New words need internet once.' },
  { id: 'qwen3-0.6b', label: 'Qwen3 0.6B', repo: 'onnx-community/Qwen3-0.6B-ONNX', task: 'text-generation', size: '~550 MB', note: 'Good balance. Try this first.' },
  { id: 'lfm25-350m', label: 'LFM2.5 350M', repo: 'onnx-community/LFM2.5-350M-ONNX', task: 'text-generation', size: '~280 MB', note: 'Fastest, smallest, weaker quality.' },
  { id: 'gemma3-270m', label: 'Gemma 3 270M', repo: 'onnx-community/gemma-3-270m-it-ONNX', task: 'text-generation', size: '~300 MB', note: 'Very small. May invent meanings.' },
  { id: 'qwen3-1.7b', label: 'Qwen3 1.7B', repo: 'onnx-community/Qwen3-1.7B-ONNX', task: 'text-generation', size: '~1.4 GB', note: 'Best quality, heaviest.' },
  { id: 'lamini-flan-248m', label: 'LaMini-Flan-T5 248M', repo: 'Xenova/LaMini-Flan-T5-248M', task: 'text2text-generation', size: '~250 MB', note: 'Seq2seq, dictionary-like answers.' }
]

let cache: any = null

export function useSettings() {
  if (!cache) {
    cache = {
      // --- voice ---
      voiceId: useLocalStorage('vocab_app_voice_id', 'af_heart'),
      ttsRepeat: useLocalStorage('set_tts_repeat', 1),
      ttsPrefetch: useLocalStorage('set_tts_prefetch', true),

      // --- on-device model ---
      llmModel: useLocalStorage('set_llm_model', 'off'),

      // --- what the system tracks ---
      minTrackRank: useLocalStorage('set_min_track_rank', 300),

      // --- two engines pushing words toward SRS ---
      viewsToEnter: useLocalStorage('set_views_to_enter', 10),   // fixed for every word
      queuePerDay: useLocalStorage('set_queue_per_day', 10),     // engine 1: most important not-yet-in-SRS words
      forcedPerReply: useLocalStorage('set_forced_per_reply', 3),

      // --- scheduler (FSRS) ---
      learningSteps: useLocalStorage('set_learning_steps', '10m, 1h'),
      relearningSteps: useLocalStorage('set_relearning_steps', '10m, 1h, 3h, 6h'),
      reviewFraction: useLocalStorage('set_review_fraction', 0.5),

      // --- the edge (writing difficulty only) ---
      edgePercentile: useLocalStorage('set_edge_pct', 0.98),
      minReviewForEdge: useLocalStorage('set_min_review_edge', 30),

      // --- what gets sent to the AI ---
      candidateCount: useLocalStorage('set_candidates', 50),
      historyTurns: useLocalStorage('set_history_turns', 2),
      cooldownAfter: useLocalStorage('set_cooldown_after', 5),
      cooldownTurns: useLocalStorage('set_cooldown_turns', 3),

      // --- display ---
      markTargetsOnly: useLocalStorage('set_mark_targets', true)
    }
  }
  return { ...cache, LLM_OPTIONS }
}
