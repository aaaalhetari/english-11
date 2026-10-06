# Vocab Reader — Nuxt 3

An interactive reading app: the AI generates natural answers while weaving in
target vocabulary words, and a local tracking system (active / dormant / pool)
prioritizes words that still need review.

Fully static — no backend server. The app calls the Anthropic API directly
from the browser using Anthropic's official "bring your own key" CORS header,
so it deploys as a plain static site (GitHub Pages, Netlify, anywhere).

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. The first screen asks for your **Anthropic API
key** (stored only in `localStorage` on your device, sent directly to
Anthropic per request, never stored on any server).

## Deploy to GitHub Pages (automatic)

1. Push this project to a new GitHub repository.
2. In the repo: **Settings → Pages → Source → GitHub Actions**.
3. Push to `main` (or run the workflow manually from the Actions tab).

`.github/workflows/deploy.yml` is already included — it builds the static
site with `nuxt generate` and publishes it to GitHub Pages automatically on
every push to `main`. Your site will be live at:

```
https://<your-username>.github.io/<repo-name>/
```

No extra setup needed — the workflow sets the correct base path
automatically from your repository name.

## Libraries used and why

| Library | Why |
|---|---|
| **Nuxt 3** (`ssr: false`) | Static-site output, works on GitHub Pages with no server |
| **Pinia + @vueuse/nuxt** | Ready-made composables (`useLocalStorage`, etc.) |
| **Dexie** | IndexedDB wrapper — handles far more data than localStorage, and supports sorting/filtering directly (needed for the "top 50 active words" query) |
| **wink-lemmatizer** | Reduces words to their root locally (no API) — unifies leverage/leveraging, etc. |
| **kokoro-js** (Kokoro-82M) | Neural voice running fully in-browser via Transformers.js/WebGPU (WASM fallback) — free, no API, studio-grade quality (graded A/A- on the model's own benchmark for the voices offered). A small curated picker (5 top-graded English voices, American + British) is built in; switching voices does not re-download the base model. First playback downloads the base model once (~86-138MB in q8); native Web Speech API is the instant fallback if that fails |
| **Tailwind CSS** | Fast, clean styling |

## How reading works

- **One tap** on *any* word says it out loud, instantly (clips for pushed words
  are generated in the background and cached). Repeat count is a setting.
- **Two taps** open the meaning card: contextual definition + examples, written
  for your current position in the word list.
- Only the words the system is currently pushing are highlighted. Everything
  else stays plain but remains tappable, so an unexpected word (a technical
  sense like "terminal" in computing) is one tap away.

## Reading mode: a real question vs. "Surprise me"

If you ask a real question, that question is the topic and the candidate
words are optional seasoning, as before.

If you tap **📖 Surprise me** (on the empty screen or next to the composer),
no question is sent — instead the model studies the candidate word lists
itself, finds a thread connecting several of them, and writes a short
magazine-style feature article (250-450 words, in the voice of something
like Scientific American) on whatever real subject that thread points to.
Article quality — coherence, how genuinely interesting it is, how much real
information it carries — always outranks fitting in more words. A small
rolling list of your last 10 AI-chosen topics is kept in `localStorage`
(not learning data) and sent back to the model each time so it does not
circle back to the same subject.

Required words (the queue's carried-over words) are no longer absolute in
this mode: the model makes a real effort to weave each one in naturally,
but leaves one out rather than bend the writing around it.

## The placement test (writing difficulty only)

On first use, five rounds of about 12 words each ask you to tap every word
you genuinely know (not the ones you don't) - each round samples densely
around your current known/unknown boundary and narrows toward your real
level, so a single lucky or unlucky word cannot skew the result. The final
estimate is the point below which 80% of your known taps sit, not the single
hardest word you happened to recognize.

This result sets nothing except how simply the AI writes in your first
replies. It never adds a word to the scheduler, never changes the daily
queue (which still starts at rank 300 and climbs exactly as always), and is
automatically replaced the moment 30 words reach review through your own
reading. You can skip it (starts at the simplest setting) or redo it later
from Settings.

## How the learning loop works

**Only one way into the scheduler:** 10 views (fixed for every word, whatever
its rank), spaced at least 1 hour apart, with no tap in between. A tap on a
word outside the scheduler only shows its meaning - it changes nothing and
never enters the word.

**Two engines push words toward that line, from opposite ends:**
- **Engine A (the daily queue):** the single most important word not yet in
  the scheduler - whatever its current view count - is pushed to the AI so
  it gets used, up to 10 a day. This is what guarantees no word is ever
  skipped forever.
- **Engine B (closest to done):** among words that already have at least one
  view, the ones with the most views are offered first, because they need
  the fewest more to finish.

**A tap:** inside the scheduler it is rated Again, and the configured
relearning steps now actually drive it (e.g. 10m, 1h, 3h, 6h, set in
Settings) — it comes back several times that day at widening gaps before
returning to review, instead of a single flat step. Outside the scheduler,
a tap resets the word's view count to 0: the 10-view evidence has to stay
clean, so a word you needed explaining does not slip in just because it had
views before you tapped it.

**What is sent with each question:**
- Required words: queue words (engine A) the AI did not use on their day, at
  most 3 per reply. The AI is told to use every one.
- Optional words, in order: SRS reviews due (by **priority** - how overdue
  combined with how frequent, not simply oldest-first), words tapped today,
  engine B, then engine A.

**The edge** only sets how simply the AI writes.

**Session only:** meaning cards and voice clips live in memory and are gone
when the app closes.

**History:** only the last 2 exchanges are re-sent with each question.

## Word list and word recognition

- `data/frequency.json`: 9,000 lemmas, ranked by the combined frequency of
  all their inflected forms.
- `data/word-forms.json`: a static lookup table (built once from UniMorph)
  mapping every known spelling to its lemma - no runtime guessing.
- `data/ambiguous-forms.json`: spellings shared by two or more of our 9,000
  words (e.g. "left" = direction / past of "leave"). At runtime, a spelling
  here only stays ambiguous if two or more of its candidates are actually
  tracked (rank >= the "ignore words more common than" setting); if every
  candidate but one is too common to track, it resolves to that one
  candidate instead of being discarded as unreadable evidence.

## History tab

Pick any two chats: every word whose state changed between them is listed
with its value before and after (category, stage, gate views, taps, sent,
delivered, next review...) and what happened to it.

## Inspecting every turn

Under each reply there is a collapsible line showing how many of the offered
words the AI actually used. Opening it lists every word grouped by why it was
sent (due for review, gap below the frontier, new past the frontier, random
probe, or steering), with unused words faded and struck through.

## Dashboard

Four tabs: **Progress** (frontier, counts, band-by-band coverage and mastery,
hardest words, cache sizes), **Words** (the full table: every counter the system keeps
per word — rank, stage, times seen, taps, streak, times offered, times skipped,
next review — with search, filters by stage and by why it was sent, sorting on
any column, CSV export, and a per-word detail view), **AI** (words the AI keeps skipping, on-device model
picker), **Settings** (voice and repeat, evidence rules, frontier rules,
conversation and display, export/import) — every control has a one-line
explanation underneath it.

## Honest notes on this version's scope

- **`data/frequency.json`** (9,000 words) and **`data/dictionary.json`**
  (an English definition for every one of them) are generated, not
  hand-typed: frequency order comes from
  [wordfreq-en-25000](https://github.com/aparrish/wordfreq-en-25000); each
  word is reduced with the app's own lemmatizer, then kept only if
  [WordNet](https://wordnet.princeton.edu/) lists it as a lowercase common
  word, which removes people, places and most brand names. Profanity,
  internet slang and a short manual list of name-like words are also
  removed. Definitions are WordNet's most frequent sense. CEFR levels are an
  approximation from frequency rank, not a linguist-reviewed
  classification. A1/A2 words are never tracked (already known at B1-B2).
- **Local data upgrades itself**: when the vocabulary list changes, the
  browser database is migrated on first load — untracked/below-level words
  are removed and your click/exposure progress on the rest is kept.
- **Voice runs in a Web Worker** so generating speech never freezes the page.
- **Try before you connect a key**: the setup screen offers "Try a demo
  first" — it seeds sample vocabulary data and a sample AI reply so you can
  test clicking words, the neural voice, and multi-passage selection with
  zero API calls, then lets you paste your key right there to switch into
  the real app.
- **Scanning engine** matches by lemma (root form) only — it doesn't
  disambiguate between two meanings of the same spelling (e.g. "bank" as a
  financial institution vs. a riverbank).
- **Cross-device sync**: manual Export/Import (JSON) buttons only. Drop the
  exported file in a synced Google Drive folder to move data between devices
  — there's no automatic upload/download in this version.
- **API key security**: calling Anthropic directly from the browser means the
  key is visible to anyone with access to the browser's dev tools on that
  device. Fine for a personal, bring-your-own-key tool like this; not
  suitable for a public multi-user product without a server-side key.

## Project structure

```
composables/
  useApiKey.ts       ← stores the key locally
  useVocabDB.ts        ← Dexie database + ranking/status logic
  useLemmatizer.ts     ← tokenizing and lemmatizing text
  useClaude.ts          ← builds prompts, calls Anthropic directly
  useTTS.ts             ← neural + fallback voice
components/
  ApiKeySetup.vue
  DemoPanel.vue          ← try every feature with sample data, no key needed
  ReaderPanel.vue         ← main interface (used once a key is set)
  ClickableText.vue       ← clickable text + multi-selection tool
  WordPopup.vue           ← three-layer meaning popup + voice picker
data/
  frequency.json        ← frequency ranks (starter set, expand it)
  dictionary.json        ← fallback local dictionary (starter set, expand it)
.github/workflows/
  deploy.yml            ← builds and deploys to GitHub Pages on push
```
