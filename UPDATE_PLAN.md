# AssessmentFunner Major Redesign Plan

## Context

The app is a vanilla JS/HTML/CSS single-page assessment tool for ATPL pilot training. Currently it has 3 files (`index.html`, `app.js` at 1554 lines, `styles.css`), uses localStorage for persistence, and calls the Anthropic Claude API for question generation. The user wants to expand it from a daily practice generator into a full-featured assessment platform with 5 tabs, ELP exam simulation with audio, airline interview prep, and cross-device sync -- all while preserving existing data.

---

## Architecture: Modular ES Modules (no build tools)

Split the monolithic `app.js` into ES modules loaded via `<script type="module">`:

```
AssessmentFunner/
  index.html                    -- Tab shell + password gate
  styles.css                    -- Shared styles + tab nav
  styles/
    psychomotor.css
    technical.css
    elp.css
    interview.css
    settings.css
    analytics.css
  js/
    app.js                      -- Entry: auth, tab router, init
    storage.js                  -- localStorage + migration
    api.js                      -- All AI API calls (Claude, OpenAI, ElevenLabs)
    data-transfer.js            -- JSON export/import for cross-device sync
    utils.js                    -- Date, random, formatting helpers
    analytics.js                -- Performance dashboard
    tabs/
      psychomotor.js            -- Renamed "Practical Exam"
      technical.js              -- Expanded ATPL (30 questions)
      elp.js                    -- ELP state machine + orchestration
      elp-audio.js              -- MediaRecorder + playback
      elp-analysis.js           -- STT + pinpoint analysis
      interview.js              -- 3 tech + 3 HR questions
      settings.js               -- API keys, sync config, data mgmt
  assets/
    images/                     -- Curated aviation photos (fallback)
```

Each tab module exports `{ init(), generate(), loadToday() }`.

---

## Data Migration Strategy

**Critical**: Run migration on first load, preserve old keys as backup.

```
Old keys -> New keys:
  assessmentFunner_history      -> af_history (restructured per-tab)
  assessmentFunner_performance  -> af_performance (extended)
  assessmentFunner_atplPerf     -> af_technicalPerformance
  assessmentFunner_apiKey       -> af_settings.apiKeys.anthropic
  (new)                         -> af_elpPerformance
  (new)                         -> af_interviewPerformance
```

Migration function in `js/storage.js`:
1. Detect old schema by checking `assessmentFunner_history` existence
2. Transform each date entry: wrap `examNumbers`/`scores` under `psychomotor`, wrap `atplQuestions`/`atplAnswers` under `technical`
3. Preserve `fluencyTask`/`fluencyNotes` as legacy data
4. Move API key into settings object
5. Write new keys, keep old keys as backup for one release cycle
6. Mark migration done with `af_migrated: 'v2'`

---

## Tab 1: Psychomotor (rename only)

- Rename "Practical Exam Numbers" to "Psychomotor" in UI
- Same 9 exam categories, same random generation, same scoring
- Source: current `app.js` lines 27-51 (config), 366-376 (generation), 564-784 (display/scoring)
- No logic changes, just module extraction

---

## Tab 2: Technical (expanded ATPL)

- **30 questions**: 2 per each of 15 EASA ATPL subjects
- Per subject: 1 multiple-choice (4 options) + 1 open-answer
- Open-answer style: "How do you understand [topic]?" -- general comprehension, not niche
- Split into 3 API calls (5 subjects each) to stay within token limits
- Display grouped by subject with heading, MC question, then open-answer
- Remove the question count selector (fixed at 30)
- Source: current `app.js` lines 54-70 (subjects), 427-542 (AI generation), 786-946 (display)

---

## Tab 3: ELP (English Language Proficiency)

### State Machine Flow

```
IDLE -> PART1_WARMUP -> PART1_PICTURE -> PART1_FOLLOWUPS
     -> PART2_SUB1_PLAY -> PART2_SUB1_DESCRIBE -> PART2_SUB1_ANALYZE -> PART2_SUB1_FOLLOWUP
     -> PART2_SUB2_PLAY -> PART2_SUB2_DESCRIBE -> PART2_SUB2_ANALYZE -> PART2_SUB2_FOLLOWUP
     -> PART3_SET1 (3 recordings, can repeat once each) -> PART3_SET1_DESCRIBE
     -> PART3_SET2 -> PART3_SET2_DESCRIBE
     -> PART3_SET3 -> PART3_SET3_DESCRIBE
     -> PART4_PICTURE1 -> PART4_PICTURE2_COMPARE -> PART4_FOLLOWUPS -> PART4_DISCUSSION
     -> SCORING -> COMPLETE
```

### Part 1 - Warmup (~6-9 min)
- AI generates 3 personal questions (aviation background, experience, expectations)
- **Merged fluency tasks**: Incorporate existing fluency task types (describe a topic, express opinion, explain procedure, compare/contrast, hypothetical scenario, storytelling) as additional warmup prompt variety. Reuse the 80+ existing tasks from current `app.js` lines 76-182.
- Display one at a time, examinee answers via **microphone recording** (transcribed via Whisper)
- Then: show 1 aviation picture (non-normal ops), examinee describes it via mic
- AI generates 2 follow-up questions based on the picture context

### Part 2 - Listening History (~20-25 min)
- **Story generation**: Claude API creates structured story script with:
  - Characters (pilot, ATC, cabin crew, passenger)
  - Dialogue with aviation phraseology
  - Ambient sound markers (`[engine spool up]`, `[boarding sounds]`)
  - 8-15 pinpoints per sub-part (stored in background, hidden from user)
- **Audio**: Either AI-generated via ElevenLabs TTS (multi-voice dialogue) or sourced from internet aviation audio (private use only). TTS is primary approach.
- **Sub-part 1**: Play 6-10 min story ONCE (play button disables after). Examinee describes what was heard via **microphone recording**. System transcribes via Whisper -> analyzes against pinpoints via Claude -> generates follow-ups for missed ones.
- **Sub-part 2**: Continuation with non-standard events (emergency, malfunction, drunk passenger, document issues). Same flow. CANNOT be repeated.

### Part 3 - Short Bursts (~15 min)
- 9 recordings in 3 sets of 3
- Set 1: shortest (1-2 sentences), Set 2: medium, Set 3: longest (up to 1 min)
- Each recording CAN be repeated ONCE on request (replay button, disabled after 2nd play)
- After each set: examinee describes all 3, system checks 1 pinpoint per recording
- NO follow-up questions

### Part 4 - Descriptive Talks (~10-15 min)
- 2 aviation pictures selected for comparison (same domain, e.g., two different pushback scenarios)
- Step 1: Show only picture 1, examinee describes
- Step 2: Reveal picture 2, ask for similarities and differences
- 2-3 follow-ups only if pinpoints about differences were missed
- Step 3: 2 general topic questions (not image-specific, pilot-oriented)
- Note: Be gentler if topic leans toward ATC/ground/maintenance

### Scoring
- Send all transcriptions + pinpoint results to Claude
- Score against ICAO Level descriptors (1-6) across: Pronunciation, Structure, Vocabulary, Fluency, Comprehension, Interactions
- Display breakdown at exam end, save to history

---

## Tab 4: Interview (Airline Cadet Pilot)

- AI generates 6 questions per session:
  - 3 technical (aviation knowledge, systems, procedures, regulations)
  - 3 HR (motivation, teamwork, stress, decision-making, conflict resolution, career goals)
- Display as cards with text areas for answer notes
- Optional "Sample Answer" reveal toggle
- Save answers to history

---

## Tab 5: Settings

### API Keys Management
- Anthropic (Claude) -- text generation, analysis, scoring
- OpenAI -- Whisper STT, DALL-E images, optional TTS
- ElevenLabs -- TTS for story audio
- Each key: masked input, show/hide toggle, save button, "Test" button (makes minimal API call to verify)

### Data Sync (Manual JSON Export/Import)
- **Export**: Download all localStorage data as a single JSON file
- **Import**: Upload JSON file, merge with existing data (latest-write-wins per date)
- No cloud dependency -- user manually transfers the JSON file between devices
- Reset all data (with confirmation)

---

## AI Tool Recommendations

| Purpose | Provider | API Endpoint | Why |
|---------|----------|-------------|-----|
| **Text generation** (questions, stories, analysis) | Anthropic Claude | `POST /v1/messages` | Already in use, excellent for structured outputs |
| **Speech-to-text** (examinee recordings) | OpenAI Whisper | `POST /v1/audio/transcriptions` | Best accuracy for accented aviation English |
| **Text-to-speech** (story audio, short bursts) | ElevenLabs | `POST /v1/text-to-speech/{voice_id}` | Multi-voice for dialogue, best natural quality |
| **Image generation** (ELP pictures) | OpenAI DALL-E 3 | `POST /v1/images/generations` | Realistic photos, with conservative prompts |
| **Scoring analysis** | Anthropic Claude | `POST /v1/messages` | Reuse existing, good at structured evaluation |

### Image Strategy
1. **Primary**: Curate 30-50 aviation photos in `assets/images/` (Wikimedia Commons, Unsplash, Pexels)
2. **Fallback**: DALL-E 3 generation with conservative prompts ("realistic professional photograph of...", no fantasy elements)
3. **For comparison pairs**: Pre-pair images by topic to avoid illogical combinations
4. Cache generated images as base64 in session data (DALL-E URLs expire)

### Audio Architecture
- **Recording**: Browser `MediaRecorder` API (`audio/webm;codecs=opus`)
- **Playback**: HTML5 `<audio>` element with play-count tracking
- **Play-once enforcement**: Disable play button after `ended` event fires (Part 2) or after 2nd play (Part 3)

---

## Implementation Phases

### Phase 1: Foundation
- Create directory structure and module skeleton
- Extract utilities, storage, API client from `app.js`
- Implement tab navigation in `index.html`
- Run migration, verify old data loads in new structure
- **Files**: `js/app.js`, `js/storage.js`, `js/utils.js`, `js/api.js`, `index.html`, `styles.css`

### Phase 2: Psychomotor + Settings tabs
- Move exam number logic to `js/tabs/psychomotor.js`
- Build settings UI with API key management
- **Files**: `js/tabs/psychomotor.js`, `js/tabs/settings.js`, `styles/psychomotor.css`, `styles/settings.css`

### Phase 3: Technical tab expansion
- New prompt for 30 questions (2 per subject, split into 3 API calls)
- Subject-grouped display with MC + open-answer
- **Files**: `js/tabs/technical.js`, `styles/technical.css`

### Phase 4: Interview tab
- Question generation prompt (3 tech + 3 HR)
- Card-based display with answer notes
- **Files**: `js/tabs/interview.js`, `styles/interview.css`

### Phase 5: ELP Part 1 (Warmup + Picture)
- State machine skeleton
- Audio recording with `MediaRecorder`
- Picture display (static images first)
- Follow-up question generation
- **Files**: `js/tabs/elp.js`, `js/tabs/elp-audio.js`, `styles/elp.css`

### Phase 6: ELP Part 2 (Listening History)
- Story generation via Claude (structured script with pinpoints)
- TTS via ElevenLabs (multi-voice dialogue)
- Play-once enforcement
- Transcription via Whisper + pinpoint analysis
- **Files**: `js/tabs/elp-analysis.js` (new), extend `elp.js` and `elp-audio.js`

### Phase 7: ELP Parts 3 & 4
- Short bursts: 9 recordings, repeat-once mechanic
- Descriptive talks: 2-picture comparison flow
- **Files**: extend `elp.js`

### Phase 8: ELP Scoring + Analytics Update
- ICAO-aligned scoring dimensions
- Analytics dashboard covering all tabs
- **Files**: `js/analytics.js`, `styles/analytics.css`

### Phase 9: Data Transfer + Polish
- JSON export/import for cross-device sync (`js/data-transfer.js`)
- Loading states, error handling
- Mobile responsive for all new tabs
- Microphone permission UX (request on ELP tab entry, friendly error if denied)
- **Files**: `js/data-transfer.js`, extend `js/tabs/settings.js`

---

## Verification Plan

1. **Migration**: Open app with existing localStorage data -> verify all history, scores, performance data loads correctly in new tab structure
2. **Psychomotor**: Generate daily numbers -> verify scoring works -> check analytics
3. **Technical**: Generate 30 questions -> answer MC + open-answer -> verify per-subject tracking
4. **Interview**: Generate questions -> write notes -> verify saved in history
5. **ELP end-to-end**: Run full 4-part exam -> verify audio playback/recording -> verify pinpoint analysis -> verify scoring output
6. **Settings**: Save/load API keys -> test each key -> verify masked display
7. **Sync**: Export JSON on one browser -> import on another -> verify all data merged correctly
8. **Mobile**: Test all tabs on 375px viewport
