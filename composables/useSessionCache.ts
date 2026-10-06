// Definition cards live in memory for this session only. Closing or reloading
// the app clears them; nothing is written to the device.
export interface SessionCard { definition: string; examples: string[]; source: string }
const cards = new Map<string, SessionCard>()

function key(lemma: string, context: string) {
  let h = 0
  for (let i = 0; i < context.length; i++) h = (h * 31 + context.charCodeAt(i)) | 0
  return `${lemma}::${h}`
}

export function useSessionCache() {
  return {
    getCard: (lemma: string, context: string) => cards.get(key(lemma, context)) || null,
    saveCard: (lemma: string, context: string, card: SessionCard) => { cards.set(key(lemma, context), card) },
    cardCount: () => cards.size
  }
}
