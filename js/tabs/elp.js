import { askClaude, generateSpeechWithElevenLabs } from "../api.js";
import { debugLog } from "../debug.js";
import { FLUENCY_TASKS } from "../fluency-data.js";
import { buildPart1FollowupQuestions, buildPart4DiscussionQuestions, buildPart4FollowupQuestions, getImageDescriptor, getKnownLocalImageKeys } from "../image-context.js";
import { KEYS, addPerformance, getHistory, getSettings, upsertDay } from "../storage.js";
import { createLoadingOverlay, escapeHTML, getTodayString, isDevMode, randomPick } from "../utils.js";
import { createPlaybackController, createRecorder } from "./elp-audio.js";
import { analyzePinpoints, scoreICAO, transcribeResponse } from "./elp-analysis.js";

const STATES = [
    "IDLE",
    "PART1_WARMUP",
    "PART1_PICTURE",
    "PART1_FOLLOWUPS",
    "PART2_SUB1_PLAY",
    "PART2_SUB1_DESCRIBE",
    "PART2_SUB1_ANALYZE",
    "PART2_SUB1_FOLLOWUP",
    "PART2_SUB2_PLAY",
    "PART2_SUB2_DESCRIBE",
    "PART2_SUB2_ANALYZE",
    "PART2_SUB2_FOLLOWUP",
    "PART3_SET1",
    "PART3_SET1_DESCRIBE",
    "PART3_SET2",
    "PART3_SET2_DESCRIBE",
    "PART3_SET3",
    "PART3_SET3_DESCRIBE",
    "PART4_PICTURE1",
    "PART4_PICTURE2_COMPARE",
    "PART4_FOLLOWUPS",
    "PART4_DISCUSSION",
    "SCORING",
    "COMPLETE"
];

const STATE_META = {
    IDLE:                   { part: 0, section: "Getting Started",        label: "Ready",       instruction: "Press Start to begin your ELP exam simulation." },
    PART1_WARMUP:           { part: 1, section: "Part 1 \u2014 Introduction",  label: "Warmup",      instruction: "Answer each warmup question aloud. Take your time." },
    PART1_PICTURE:          { part: 1, section: "Part 1 \u2014 Introduction",  label: "Picture",     instruction: "Study the image below, then describe the scene and any safety concerns you observe." },
    PART1_FOLLOWUPS:        { part: 1, section: "Part 1 \u2014 Introduction",  label: "Follow-ups",  instruction: "Answer the follow-up questions based on the picture you described." },
    PART2_SUB1_PLAY:        { part: 2, section: "Part 2 \u2014 Listening",     label: "Listen",      instruction: "Listen carefully to the story. You will hear it only once." },
    PART2_SUB1_DESCRIBE:    { part: 2, section: "Part 2 \u2014 Listening",     label: "Describe",    instruction: "Describe what you heard in the story.", auto: "record" },
    PART2_SUB1_ANALYZE:     { part: 2, section: "Part 2 \u2014 Listening",     label: "Processing",  instruction: "Analyzing your response\u2026", auto: "process" },
    PART2_SUB1_FOLLOWUP:    { part: 2, section: "Part 2 \u2014 Listening",     label: "Follow-ups",  instruction: "Answer these follow-up questions about the story." },
    PART2_SUB2_PLAY:        { part: 2, section: "Part 2 \u2014 Listening",     label: "Listen",      instruction: "Listen carefully to the second story. You will hear it only once." },
    PART2_SUB2_DESCRIBE:    { part: 2, section: "Part 2 \u2014 Listening",     label: "Describe",    instruction: "Describe what you heard in the second story.", auto: "record" },
    PART2_SUB2_ANALYZE:     { part: 2, section: "Part 2 \u2014 Listening",     label: "Processing",  instruction: "Analyzing your response\u2026", auto: "process" },
    PART2_SUB2_FOLLOWUP:    { part: 2, section: "Part 2 \u2014 Listening",     label: "Follow-ups",  instruction: "Answer these follow-up questions about the second story." },
    PART3_SET1:             { part: 3, section: "Part 3 \u2014 Communication", label: "Set 1",       instruction: "Read these short communications carefully." },
    PART3_SET1_DESCRIBE:    { part: 3, section: "Part 3 \u2014 Communication", label: "Describe",    instruction: "Describe what you just read.", auto: "record" },
    PART3_SET2:             { part: 3, section: "Part 3 \u2014 Communication", label: "Set 2",       instruction: "Read these medium-length communications." },
    PART3_SET2_DESCRIBE:    { part: 3, section: "Part 3 \u2014 Communication", label: "Describe",    instruction: "Describe what you just read.", auto: "record" },
    PART3_SET3:             { part: 3, section: "Part 3 \u2014 Communication", label: "Set 3",       instruction: "This is the final and most detailed communication scenario." },
    PART3_SET3_DESCRIBE:    { part: 3, section: "Part 3 \u2014 Communication", label: "Describe",    instruction: "Describe the scenario in detail.", auto: "record" },
    PART4_PICTURE1:         { part: 4, section: "Part 4 \u2014 Discussion",    label: "Picture 1",   instruction: "Study this aviation image carefully." },
    PART4_PICTURE2_COMPARE: { part: 4, section: "Part 4 \u2014 Discussion",    label: "Compare",     instruction: "Compare these two images. Identify similarities and differences." },
    PART4_FOLLOWUPS:        { part: 4, section: "Part 4 \u2014 Discussion",    label: "Follow-ups",  instruction: "Answer these follow-up questions about the images." },
    PART4_DISCUSSION:       { part: 4, section: "Part 4 \u2014 Discussion",    label: "Discussion",  instruction: "Discuss these broader aviation topics." },
    SCORING:                { part: 4, section: "Scoring",                      label: "Results",     instruction: "Calculating your ICAO proficiency scores\u2026", auto: "process" },
    COMPLETE:               { part: 4, section: "Complete",                     label: "Complete",    instruction: "Your ELP session is complete." }
};

const ICAO_LEVELS = { 1: "Pre-elementary", 2: "Elementary", 3: "Pre-operational", 4: "Operational", 5: "Extended", 6: "Expert" };
const DEFAULT_ICAO_SCORE = {
    pronunciation: 3,
    structure: 3,
    vocabulary: 3,
    fluency: 3,
    comprehension: 3,
    interactions: 3,
    overall: 3
};

const DEFAULT_LOCAL_IMAGE_LIBRARY = Object.freeze({
    single: [
        "assets/img/aviation-apron-1.jpg",
        "assets/img/aviation-wing-1.jpg",
        "assets/img/aviation-cockpit-1.jpg"
    ],
    compare: [
        "assets/img/aviation-apron-1.jpg",
        "assets/img/aviation-wing-1.jpg",
        "assets/img/aviation-cockpit-1.jpg"
    ]
});

const REMOTE_IMAGE_FALLBACK = Object.freeze([
    "https://images.pexels.com/photos/62623/wing-plane-flying-airplane-62623.jpeg",
    "https://images.pexels.com/photos/358319/pexels-photo-358319.jpeg",
    "https://images.pexels.com/photos/912050/pexels-photo-912050.jpeg"
]);

const DEFAULT_ELEVEN_STORY_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

const imageLoadCache = new Map();

const BURST_TEXTS = {
    set1: [
        "Ground reports low visibility on taxiway alpha.",
        "Cabin crew requests additional briefing before departure.",
        "Expect delay due to stand congestion."
    ],
    set2: [
        "ATC clears you direct to waypoint LOMKI, maintain flight level three five zero, expect descent in twenty minutes.",
        "Weather radar shows convective activity ahead; evaluate deviate left by thirty nautical miles and coordinate with control.",
        "A passenger medical issue requires cabin coordination, possible diversion, and fuel reassessment."
    ],
    set3: [
        "After departure from Warsaw you are informed of a hydraulic caution light and unusual flap indications. The captain asks for QRH actions while ATC offers vectors to hold. Cabin reports calm passengers, but forecast at destination includes gusty crosswinds and moderate turbulence. You must decide whether to continue, hold, or divert while balancing fuel, weather trend, and maintenance implications.",
        "During descent into busy terminal airspace, CPDLC message conflicts with voice ATC clearance. You cross-check FMS, verify waypoint constraints, and brief expected STAR changes. Shortly after, TCAS traffic advisory appears while cabin prepares landing. Communicate priorities, crew tasks, and stabilization criteria.",
        "On turnaround, documents reveal a load sheet discrepancy and a late crew change. Pushback is delayed, slot time at risk, and passengers are informed. Explain your coordination with dispatch, ground operations, and ATC to restore compliance and maintain safety margins before departure."
    ]
};

let root;
let onDataUpdated;
let state = "IDLE";
let busy = false;
let recorder;
let playback;
let audioEl;

const runtime = {
    transcripts: [],
    pinpoints: {
        sub1: ["timeline", "role actions", "non-normal clues", "ATC exchange", "crew coordination", "final outcome"],
        sub2: ["event trigger", "risk assessment", "decision path", "communication quality", "mitigation", "result"],
        part3: [],
        part4: ["differences captured", "safety interpretation", "operational recommendation"]
    },
    story: { sub1: null, sub2: null }
};

/* ── Helpers ── */

function getTodayElp() {
    const day = getHistory()[getTodayString()] || {};
    return day.elp || null;
}

function dev() { return isDevMode(); }

function setState(next) {
    const previous = state;
    state = next;
    debugLog("elp.state", "State changed", { tab: "elp", from: previous, to: next });
    const badge = root.querySelector("#elpState");
    if (badge) badge.textContent = state;

    const meta = STATE_META[state];
    const progressEl = root.querySelector("#elpProgress");
    const instrEl = root.querySelector("#elpInstruction");

    if (progressEl && meta) {
        const idx = STATES.indexOf(state);
        const total = STATES.length - 2;
        const current = Math.max(0, idx - 1);
        const pct = Math.round((current / total) * 100);
        progressEl.innerHTML = `
            <div class="progress-label">${escapeHTML(meta.section)}</div>
            <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
            <div class="progress-step">${escapeHTML(meta.label)} \u2014 Step ${current} of ${total}</div>
        `;
    }
    if (instrEl && meta) {
        instrEl.textContent = meta.instruction;
    }
}

function setBusy(isBusy) {
    busy = isBusy;
    root.querySelectorAll("button:not(.btn-stop)").forEach((btn) => { btn.disabled = isBusy; });
}

function saveElpPatch(patch) {
    upsertDay(getTodayString(), (day) => {
        const base = day.elp || {};
        return { elp: { ...base, ...patch, state, updatedAt: new Date().toISOString() } };
    });
    onDataUpdated();
}

function pickEnglishSpeechVoice() {
    if (!("speechSynthesis" in window)) {
        return null;
    }

    const voices = speechSynthesis.getVoices();
    return voices.find((voice) => /^en-(GB|US)$/i.test(voice.lang))
        || voices.find((voice) => /^en/i.test(voice.lang))
        || null;
}

function speakEnglishFallback(text, debugContext = {}) {
    if (!("speechSynthesis" in window)) {
        return;
    }

    speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    const voice = pickEnglishSpeechVoice();
    utter.lang = voice?.lang || "en-GB";
    utter.rate = 0.95;

    if (voice) {
        utter.voice = voice;
    }

    debugLog("elp.fallbackSpeech", "Using browser speech fallback", {
        ...debugContext,
        lang: utter.lang,
        voiceName: voice?.name || null,
        voiceURI: voice?.voiceURI || null
    }, "warn");

    speechSynthesis.speak(utter);
}

function makeFallbackScore(rationale = "Fallback score used.") {
    return { ...DEFAULT_ICAO_SCORE, rationale };
}

function buildTranscriptPatch(stateName, transcript) {
    const patch = { lastTranscript: { state: stateName, transcript } };
    if (stateName === "PART2_SUB1_DESCRIBE") patch.part2Sub1Transcript = transcript;
    if (stateName === "PART2_SUB2_DESCRIBE") patch.part2Sub2Transcript = transcript;
    if (stateName === "PART3_SET1_DESCRIBE") patch.part3Set1Transcript = transcript;
    if (stateName === "PART3_SET2_DESCRIBE") patch.part3Set2Transcript = transcript;
    if (stateName === "PART3_SET3_DESCRIBE") patch.part3Set3Transcript = transcript;
    return patch;
}

function parseJSON(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function extractJSON(text) {
    if (!text) return null;
    const trimmed = text.trim();

    const direct = parseJSON(trimmed);
    if (direct) return direct;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        const parsedFence = parseJSON(fenced[1].trim());
        if (parsedFence) return parsedFence;
    }

    const start = trimmed.indexOf("{");
    if (start < 0) return null;

    for (let end = trimmed.length; end > start; end -= 1) {
        const candidate = parseJSON(trimmed.slice(start, end));
        if (candidate) return candidate;
    }
    return null;
}

function getOfflineWarning() {
    const keys = getSettings().apiKeys;
    const missing = [];
    if (!keys.anthropic) missing.push("Anthropic (questions, image context, analysis, scoring)");
    if (!keys.openai) missing.push("OpenAI (speech-to-text)");
    if (!keys.elevenlabs) missing.push("ElevenLabs (audio stories)");
    if (!missing.length) return "";
    return `<div class="elp-offline-banner">
        <strong>Offline mode</strong> \u2014 using static fallback content. Missing API keys: ${missing.join(", ")}.
        Configure them in the Settings tab for AI-assisted content.
    </div>`;
}

function renderMain(content) {
    root.querySelector("#elpContent").innerHTML = content;
}

function renderQuestionList(items) {
    return `<ul class="elp-questions">${items.map((q) => `<li>${escapeHTML(q)}</li>`).join("")}</ul>`;
}

function savedPicture(key) {
    const src = getTodayElp()?.[key];
    return src ? `<img class="elp-picture elp-picture-ref" src="${src}" alt="reference image">` : "";
}

function savedPicturePair() {
    const p1 = getTodayElp()?.part4Picture1;
    const p2 = getTodayElp()?.part4Picture2;
    if (!p1 && !p2) return "";
    return `<div class="elp-compare">${p1 ? `<img class="elp-picture elp-picture-ref" src="${p1}" alt="picture 1">` : ""}${p2 ? `<img class="elp-picture elp-picture-ref" src="${p2}" alt="picture 2">` : ""}</div>`;
}

/* ── Action area (production controls) ── */

function renderActionArea() {
    if (dev()) return;
    const area = root.querySelector("#elpActionArea");
    if (!area) return;

    const meta = STATE_META[state];

    if (state === "IDLE") {
        area.innerHTML = `<button id="prodStart" class="btn btn-primary btn-lg">Begin ELP Exam</button>`;
        area.querySelector("#prodStart").addEventListener("click", async () => {
            if (busy) return;
            setState("PART1_WARMUP");
            setBusy(true);
            try { await runCurrentState(); } finally { setBusy(false); }
        });
        return;
    }

    if (meta?.auto === "record") {
        area.innerHTML = `
            <div class="recording-controls">
                <button id="prodRecord" class="btn btn-primary btn-lg"><span class="rec-dot"></span> Start Recording</button>
                <div id="prodRecActive" hidden>
                    <div class="rec-timer"><span class="rec-dot"></span> Recording: <span id="prodElapsed">0</span>s <span class="hint">(max 2 min)</span></div>
                    <button id="prodStopRec" class="btn btn-danger btn-lg btn-stop">Stop Recording</button>
                </div>
            </div>
        `;
        area.querySelector("#prodRecord").addEventListener("click", async () => {
            if (busy) return;
            setBusy(true);
            try {
                const recordingState = state;
                area.querySelector("#prodRecord").hidden = true;
                area.querySelector("#prodRecActive").hidden = false;
                const elapsedSpan = area.querySelector("#prodElapsed");

                let seconds = 0;
                const tick = setInterval(() => { seconds++; if (elapsedSpan) elapsedSpan.textContent = seconds; }, 1000);

                const blobPromise = recorder.start();
                area.querySelector("#prodStopRec").addEventListener("click", () => recorder.stop());
                const blob = await blobPromise;
                clearInterval(tick);

                area.innerHTML = `<div class="elp-loading"><div class="spinner"></div> Transcribing your response\u2026</div>`;

                const openaiKey = getSettings().apiKeys.openai;
                let transcript = "";
                if (openaiKey && blob) {
                    try { transcript = await transcribeResponse({ openaiKey, audioBlob: blob, label: recordingState }); } catch { transcript = ""; }
                }
                runtime.transcripts.push({ label: recordingState, transcript });
                saveElpPatch(buildTranscriptPatch(recordingState, transcript));

                // Auto-advance
                await nextState({ force: true });
            } catch (err) {
                area.innerHTML = `<p class="status-bad">Recording failed: ${escapeHTML(err.message)}</p>`;
            } finally {
                setBusy(false);
            }
        });
        return;
    }

    if (meta?.auto === "process") {
        area.innerHTML = `<div class="elp-loading"><div class="spinner"></div> Processing\u2026</div>`;
        return;
    }

    if (state === "COMPLETE") {
        area.innerHTML = `<p class="hint">You can review your scores in the History and Performance Dashboard below.</p>`;
        return;
    }

    // Default: Continue button
    area.innerHTML = `<button id="prodContinue" class="btn btn-primary btn-lg">Continue</button>`;
    area.querySelector("#prodContinue").addEventListener("click", async () => {
        if (busy) return;
        await nextState();
    });
}

/* ── Scorecard (production) ── */

function renderScorecard(score) {
    const dims = [
        { name: "Pronunciation", val: score.pronunciation },
        { name: "Structure", val: score.structure },
        { name: "Vocabulary", val: score.vocabulary },
        { name: "Fluency", val: score.fluency },
        { name: "Comprehension", val: score.comprehension },
        { name: "Interactions", val: score.interactions }
    ];
    return `
        <div class="scorecard">
            <h3>Your ICAO Proficiency Scores</h3>
            <div class="score-grid">
                ${dims.map((d) => `
                    <div class="score-item">
                        <div class="score-label">${d.name}</div>
                        <div class="score-value">${d.val}</div>
                        <div class="score-bar"><div class="score-bar-fill" style="width:${((d.val || 0) / 6) * 100}%"></div></div>
                    </div>
                `).join("")}
            </div>
            <div class="score-overall">
                <span class="score-overall-label">Overall Level</span>
                <span class="score-overall-value">${score.overall}</span>
                <span class="score-overall-desc">${ICAO_LEVELS[score.overall] || ""}</span>
            </div>
        </div>
    `;
}

/* ── Data generation (unchanged logic) ── */

async function buildWarmupQuestions() {
    const anthropicKey = getSettings().apiKeys.anthropic;
    const fluencyPrompt = randomPick(FLUENCY_TASKS);
    const fallback = [
        "Tell us about your aviation path and current training stage.",
        "Which flight phase challenges your English most, and how do you manage it?",
        `Fluency variation (${fluencyPrompt.type}): ${randomPick(fluencyPrompt.tasks)}`
    ];
    if (!anthropicKey) {
        debugLog("elp.buildWarmupQuestions", "No Anthropic key, using fallback.", { tab: "elp" }, "warn");
        return fallback;
    }
    try {
        const prompt = `Generate exactly 3 warmup ELP questions for pilot candidate interview. Include aviation background, experience, expectations. One question must incorporate this fluency style: ${fluencyPrompt.type}. Return JSON: {"questions":["...","...","..."]}`;
        debugLog("elp.buildWarmupQuestions", "Requesting warmup questions", { tab: "elp", prompt });
        const text = await askClaude({
            apiKey: anthropicKey,
            prompt,
            maxTokens: 420,
            temperature: 0.3,
            debugContext: { tab: "elp", operation: "buildWarmupQuestions" }
        });
        const parsed = extractJSON(text);
        const questions = Array.isArray(parsed?.questions) && parsed.questions.length ? parsed.questions : fallback;
        debugLog("elp.buildWarmupQuestions", "Warmup ready", {
            tab: "elp",
            count: questions.length,
            usedFallback: questions === fallback
        });
        return questions;
    } catch (err) {
        debugLog("elp.buildWarmupQuestions", "Warmup request failed, using fallback", {
            tab: "elp",
            error: err?.message || String(err)
        }, "error");
        return fallback;
    }
}

async function buildPart2Story(label) {
    const settings = getSettings();
    const anthropicKey = settings.apiKeys.anthropic;
    const elevenKey = settings.apiKeys.elevenlabs;
    const fallbackText = label === "sub1"
        ? "Boarding starts, ATC flow restrictions apply, and crew manages minor technical note before pushback."
        : "Mid-flight non-standard event escalates with weather and passenger pressure, requiring coordinated crew response.";
    let script = fallbackText;
    let pinpoints = runtime.pinpoints[label];
    debugLog("elp.buildPart2Story", "Building story", { tab: "elp", label });
    if (anthropicKey) {
        try {
            const prompt = `Create aviation listening story for ${label}. Include pilot, ATC, cabin crew, passenger dialogue markers and ambient markers. Return JSON {"script":"...","pinpoints":[8-15 short checkpoints]}`;
            const text = await askClaude({
                apiKey: anthropicKey,
                prompt,
                maxTokens: 1500,
                temperature: 0.35,
                debugContext: { tab: "elp", operation: "buildPart2Story", label }
            });
            const parsed = extractJSON(text);
            if (parsed) {
                script = typeof parsed.script === "string" && parsed.script.trim() ? parsed.script : script;
                pinpoints = Array.isArray(parsed.pinpoints) && parsed.pinpoints.length ? parsed.pinpoints : pinpoints;
            }
        } catch (err) {
            debugLog("elp.buildPart2Story", "Story generation failed, fallback story used", {
                tab: "elp",
                label,
                error: err?.message || String(err)
            }, "warn");
        }
    }
    runtime.pinpoints[label] = pinpoints;
    if (elevenKey) {
        try {
            const blob = await generateSpeechWithElevenLabs({
                apiKey: elevenKey,
                text: script,
                voiceId: DEFAULT_ELEVEN_STORY_VOICE_ID,
                debugContext: { tab: "elp", operation: "buildPart2Story.tts", label }
            });
            return { script, pinpoints, audioSrc: URL.createObjectURL(blob) };
        } catch (err) {
            debugLog("elp.buildPart2Story", "TTS failed, speechSynthesis fallback", {
                tab: "elp",
                label,
                error: err?.message || String(err)
            }, "warn");
        }
    }
    speakEnglishFallback(script, { tab: "elp", operation: "buildPart2Story.fallbackTts", label });
    return { script, pinpoints, audioSrc: null };
}

async function ensurePicture(type) {
    const defaultPool = type === "compare" ? DEFAULT_LOCAL_IMAGE_LIBRARY.compare : DEFAULT_LOCAL_IMAGE_LIBRARY.single;
    const preferred = await getKnownLocalImageKeys(defaultPool);
    const verified = await Promise.all(preferred.map(async (src) => ({ src, ok: await canLoadImage(src) })));
    const availableLocal = verified.filter((item) => item.ok).map((item) => item.src);
    if (availableLocal.length) {
        return randomPick(availableLocal);
    }
    debugLog("elp.ensurePicture", "Local image pool unavailable, using remote fallback.", {
        tab: "elp",
        type,
        attempted: preferred
    }, "warn");
    return randomPick(REMOTE_IMAGE_FALLBACK);
}

function canLoadImage(src, timeoutMs = 3500) {
    if (imageLoadCache.has(src)) return imageLoadCache.get(src);

    const promise = new Promise((resolve) => {
        const img = new Image();
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            resolve(false);
        }, timeoutMs);

        img.onload = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(true);
        };
        img.onerror = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(false);
        };
        img.src = src;
    });

    imageLoadCache.set(src, promise);
    return promise;
}

async function recordAndTranscribe(label) {
    root.querySelector("#audioLog").textContent = "Recording... (click Stop or wait 2 min)";
    const blobPromise = recorder.start();

    root.querySelector("#elpContent").insertAdjacentHTML("beforeend",
        `<div id="devStopWrap"><button id="devStopRec" class="btn btn-danger btn-stop">Stop Recording</button>
         <span id="devRecElapsed" class="hint"> 0s</span></div>`);
    const stopBtn = root.querySelector("#devStopRec");
    const elapsedEl = root.querySelector("#devRecElapsed");
    let seconds = 0;
    const tick = setInterval(() => { seconds++; if (elapsedEl) elapsedEl.textContent = ` ${seconds}s`; }, 1000);
    stopBtn.addEventListener("click", () => recorder.stop());

    const blob = await blobPromise;
    clearInterval(tick);
    const wrap = root.querySelector("#devStopWrap");
    if (wrap) wrap.remove();

    root.querySelector("#audioLog").textContent = "Transcribing...";
    const openaiKey = getSettings().apiKeys.openai;
    let transcript = "";
    if (openaiKey && blob) {
        try { transcript = await transcribeResponse({ openaiKey, audioBlob: blob, label }); } catch { transcript = "Transcription unavailable."; }
    } else { transcript = "Transcription unavailable."; }
    runtime.transcripts.push({ label, transcript });
    root.querySelector("#audioLog").textContent = `Captured: ${label}`;
    return transcript;
}

async function analyzePart2(label, transcript) {
    const anthropicKey = getSettings().apiKeys.anthropic;
    if (!anthropicKey) return { covered: [], missed: runtime.pinpoints[label], followUps: ["Summarize the sequence of events again with operational priorities."] };
    try {
        const result = await analyzePinpoints({ anthropicKey, transcript, pinpoints: runtime.pinpoints[label], context: label });
        debugLog("elp.analyzePart2", "Pinpoint analysis completed", {
            tab: "elp",
            label,
            covered: result.covered?.length || 0,
            missed: result.missed?.length || 0
        });
        return result;
    } catch { return { covered: [], missed: runtime.pinpoints[label], followUps: [] }; }
}

/* ── State machine renderer ── */

async function runCurrentState() {
    const isDev = dev();
    debugLog("elp.runCurrentState", "Rendering state", { tab: "elp", state, isDev });

    switch (state) {
        case "IDLE": {
            const offline = getOfflineWarning();
            if (isDev) {
                renderMain(`${offline}<p>ELP exam is ready. Start full flow or jump to next state manually.</p>`);
            } else {
                renderMain(`${offline}<p>Welcome to your ELP exam simulation. This assessment covers four parts: Introduction, Listening, Communication, and Discussion. Your responses will be recorded and scored against ICAO proficiency descriptors.</p>`);
            }
            break;
        }

        case "PART1_WARMUP": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Preparing warmup questions\u2026");
            const warmup = await buildWarmupQuestions();
            loader.remove();
            if (isDev) {
                renderMain(`<h3>Part 1 Warmup</h3><ol>${warmup.map((q) => `<li>${escapeHTML(q)}</li>`).join("")}</ol><p class="hint">Use microphone recording for each answer.</p>`);
            } else {
                renderMain(`<h3>Warmup Questions</h3>${renderQuestionList(warmup)}`);
            }
            saveElpPatch({ part1Warmup: warmup });
            break;
        }

        case "PART1_PICTURE": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Loading aviation image\u2026");
            const picture = await ensurePicture("single");
            const pictureContext = await getImageDescriptor(picture, { debugContext: { tab: "elp", state: "PART1_PICTURE" } });
            loader.remove();
            renderMain(`<h3>${isDev ? "Part 1 Picture" : "Describe This Scene"}</h3><img class="elp-picture" src="${picture}" alt="aviation scenario">`);
            saveElpPatch({ part1Picture: picture, part1PictureContext: pictureContext });
            break;
        }

        case "PART1_FOLLOWUPS": {
            const pic = savedPicture("part1Picture");
            const day = getTodayElp() || {};
            let context = day.part1PictureContext || null;
            if (!context && day.part1Picture) {
                context = await getImageDescriptor(day.part1Picture, { debugContext: { tab: "elp", state: "PART1_FOLLOWUPS" } });
                saveElpPatch({ part1PictureContext: context });
            }
            const questions = buildPart1FollowupQuestions(context);
            if (isDev) {
                renderMain(`<h3>Part 1 Follow-ups</h3>${pic}<ul>${questions.map((q) => `<li>${q}</li>`).join("")}</ul>`);
            } else {
                renderMain(`<h3>Follow-up Questions</h3>${pic}${renderQuestionList(questions)}`);
            }
            break;
        }

        case "PART2_SUB1_PLAY": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Generating listening story\u2026");
            runtime.story.sub1 = await buildPart2Story("sub1");
            loader.remove();
            if (isDev) {
                renderMain(`<h3>Part 2 Sub-part 1 (Play once)</h3><p>${escapeHTML(runtime.story.sub1.script)}</p><p class="hint">Use Play button once.</p>`);
            } else {
                renderMain(`<h3>Listening Story</h3><p class="hint">Press Play to listen to the story. You will hear it only once.</p>`);
                if (runtime.story.sub1.audioSrc) {
                    const area = root.querySelector("#elpActionArea");
                    if (area) {
                        area.innerHTML = `<button id="prodPlay" class="btn btn-primary btn-lg">Play Story</button>`;
                        area.querySelector("#prodPlay").addEventListener("click", async () => {
                            try {
                                area.innerHTML = `<div class="elp-loading"><div class="spinner"></div> Playing story\u2026</div>`;
                                await playback.play({ id: "sub1", src: runtime.story.sub1.audioSrc, maxPlays: 1 });
                                area.innerHTML = `<button id="prodContinue" class="btn btn-primary btn-lg">Continue</button>`;
                                area.querySelector("#prodContinue").addEventListener("click", () => nextState());
                            } catch (err) {
                                area.innerHTML = `<p class="status-bad">${escapeHTML(err.message)}</p>`;
                            }
                        });
                        return; // Skip default renderActionArea
                    }
                }
            }
            break;
        }

        case "PART2_SUB1_DESCRIBE": {
            if (isDev) {
                const transcript = await recordAndTranscribe("part2_sub1_description");
                renderMain(`<h3>Sub-part 1 Description</h3><p>${escapeHTML(transcript)}</p>`);
                saveElpPatch({ part2Sub1Transcript: transcript });
            } else {
                renderMain(`<h3>Describe What You Heard</h3><p>When you are ready, click the button below to start recording your answer.</p>`);
            }
            break;
        }

        case "PART2_SUB1_ANALYZE": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Analyzing your response\u2026");
            const transcript = getTodayElp()?.part2Sub1Transcript || getTodayElp()?.lastTranscript?.transcript || "";
            const analysis = await analyzePart2("sub1", transcript);
            loader.remove();
            if (isDev) {
                renderMain(`<h3>Sub-part 1 Pinpoint Analysis</h3><p><strong>Covered:</strong> ${(analysis.covered || []).map(escapeHTML).join(", ") || "none"}</p><p><strong>Missed:</strong> ${(analysis.missed || []).map(escapeHTML).join(", ") || "none"}</p>`);
            }
            saveElpPatch({ part2Sub1Analysis: analysis });
            if (!isDev) {
                setTimeout(() => nextState(), 600);
                return;
            }
            break;
        }

        case "PART2_SUB1_FOLLOWUP": {
            const follow = getTodayElp()?.part2Sub1Analysis?.followUps || [];
            if (isDev) {
                renderMain(`<h3>Sub-part 1 Follow-up Questions</h3><ul>${follow.map((q) => `<li>${escapeHTML(q)}</li>`).join("")}</ul>`);
            } else {
                if (follow.length) {
                    renderMain(`<h3>Follow-up Questions</h3>${renderQuestionList(follow)}`);
                } else {
                    renderMain(`<h3>Follow-up Questions</h3><p>No additional follow-up needed. Well done!</p>`);
                }
            }
            break;
        }

        case "PART2_SUB2_PLAY": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Generating second story\u2026");
            runtime.story.sub2 = await buildPart2Story("sub2");
            loader.remove();
            if (isDev) {
                renderMain(`<h3>Part 2 Sub-part 2 (Play once)</h3><p>${escapeHTML(runtime.story.sub2.script)}</p><p class="hint">Continuation with non-standard event handling.</p>`);
            } else {
                renderMain(`<h3>Second Listening Story</h3><p class="hint">Press Play to listen. You will hear it only once.</p>`);
                if (runtime.story.sub2.audioSrc) {
                    const area = root.querySelector("#elpActionArea");
                    if (area) {
                        area.innerHTML = `<button id="prodPlay2" class="btn btn-primary btn-lg">Play Story</button>`;
                        area.querySelector("#prodPlay2").addEventListener("click", async () => {
                            try {
                                area.innerHTML = `<div class="elp-loading"><div class="spinner"></div> Playing story\u2026</div>`;
                                await playback.play({ id: "sub2", src: runtime.story.sub2.audioSrc, maxPlays: 1 });
                                area.innerHTML = `<button id="prodContinue" class="btn btn-primary btn-lg">Continue</button>`;
                                area.querySelector("#prodContinue").addEventListener("click", () => nextState());
                            } catch (err) {
                                area.innerHTML = `<p class="status-bad">${escapeHTML(err.message)}</p>`;
                            }
                        });
                        return;
                    }
                }
            }
            break;
        }

        case "PART2_SUB2_DESCRIBE": {
            if (isDev) {
                const transcript = await recordAndTranscribe("part2_sub2_description");
                renderMain(`<h3>Sub-part 2 Description</h3><p>${escapeHTML(transcript)}</p>`);
                saveElpPatch({ part2Sub2Transcript: transcript });
            } else {
                renderMain(`<h3>Describe What You Heard</h3><p>When you are ready, click the button below to start recording your answer.</p>`);
            }
            break;
        }

        case "PART2_SUB2_ANALYZE": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Analyzing your response\u2026");
            const transcript = getTodayElp()?.part2Sub2Transcript || getTodayElp()?.lastTranscript?.transcript || "";
            const analysis = await analyzePart2("sub2", transcript);
            loader.remove();
            if (isDev) {
                renderMain(`<h3>Sub-part 2 Pinpoint Analysis</h3><p><strong>Covered:</strong> ${(analysis.covered || []).map(escapeHTML).join(", ") || "none"}</p><p><strong>Missed:</strong> ${(analysis.missed || []).map(escapeHTML).join(", ") || "none"}</p>`);
            }
            saveElpPatch({ part2Sub2Analysis: analysis });
            if (!isDev) {
                setTimeout(() => nextState(), 600);
                return;
            }
            break;
        }

        case "PART2_SUB2_FOLLOWUP": {
            const follow = getTodayElp()?.part2Sub2Analysis?.followUps || [];
            if (isDev) {
                renderMain(`<h3>Sub-part 2 Follow-up Questions</h3><ul>${follow.map((q) => `<li>${escapeHTML(q)}</li>`).join("")}</ul>`);
            } else {
                if (follow.length) {
                    renderMain(`<h3>Follow-up Questions</h3>${renderQuestionList(follow)}`);
                } else {
                    renderMain(`<h3>Follow-up Questions</h3><p>No additional follow-up needed. Well done!</p>`);
                }
            }
            break;
        }

        case "PART3_SET1":
        case "PART3_SET2":
        case "PART3_SET3": {
            const key = state === "PART3_SET1" ? "set1" : state === "PART3_SET2" ? "set2" : "set3";
            const setNum = key === "set1" ? 1 : key === "set2" ? 2 : 3;
            const list = BURST_TEXTS[key];
            if (isDev) {
                renderMain(`<h3>${state.replace("_", " ")}</h3><ol>${list.map((line) => `<li>${line}</li>`).join("")}</ol><p class="hint">Set replay limit: 2 plays max each clip.</p>`);
            } else {
                renderMain(`<h3>Communication Set ${setNum}</h3>${renderQuestionList(list)}`);
            }
            saveElpPatch({ [key]: list });
            break;
        }

        case "PART3_SET1_DESCRIBE":
        case "PART3_SET2_DESCRIBE":
        case "PART3_SET3_DESCRIBE": {
            if (isDev) {
                const transcript = await recordAndTranscribe(state.toLowerCase());
                renderMain(`<h3>${escapeHTML(state)}</h3><p>${escapeHTML(transcript)}</p><p>No follow-up in Part 3 by design.</p>`);
            } else {
                renderMain(`<h3>Describe What You Read</h3><p>When you are ready, click the button below to start recording your answer.</p>`);
            }
            break;
        }

        case "PART4_PICTURE1": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Loading aviation image\u2026");
            const picture1 = await ensurePicture("single");
            const picture1Context = await getImageDescriptor(picture1, { debugContext: { tab: "elp", state: "PART4_PICTURE1" } });
            loader.remove();
            renderMain(`<h3>${isDev ? "Part 4 Picture 1" : "Study This Image"}</h3><img class="elp-picture" src="${picture1}" alt="aviation scenario">`);
            saveElpPatch({ part4Picture1: picture1, part4Picture1Context: picture1Context });
            break;
        }

        case "PART4_PICTURE2_COMPARE": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Loading comparison image\u2026");
            const picture1 = getTodayElp()?.part4Picture1 || await ensurePicture("single");
            let picture2 = await ensurePicture("compare");
            if (picture2 === picture1) {
                const allCompare = await getKnownLocalImageKeys(DEFAULT_LOCAL_IMAGE_LIBRARY.compare);
                const alternatives = allCompare.filter((src) => src !== picture1);
                if (alternatives.length) {
                    const verified = await Promise.all(alternatives.map(async (src) => ({ src, ok: await canLoadImage(src) })));
                    const availableAlternatives = verified.filter((item) => item.ok).map((item) => item.src);
                    if (availableAlternatives.length) picture2 = randomPick(availableAlternatives);
                }
            }
            const [picture1Context, picture2Context] = await Promise.all([
                getImageDescriptor(picture1, { debugContext: { tab: "elp", state: "PART4_PICTURE2_COMPARE", role: "picture1" } }),
                getImageDescriptor(picture2, { debugContext: { tab: "elp", state: "PART4_PICTURE2_COMPARE", role: "picture2" } })
            ]);
            loader.remove();
            if (isDev) {
                renderMain(`<h3>Part 4 Compare</h3><div class="elp-controls"><img class="elp-picture" src="${picture1}" alt="picture 1"><img class="elp-picture" src="${picture2}" alt="picture 2"></div><p>Describe similarities and differences in operational context.</p>`);
            } else {
                renderMain(`<h3>Compare These Two Scenes</h3><div class="elp-compare"><img class="elp-picture" src="${picture1}" alt="picture 1"><img class="elp-picture" src="${picture2}" alt="picture 2"></div>`);
            }
            saveElpPatch({
                part4Picture1: picture1,
                part4Picture2: picture2,
                part4Picture1Context: picture1Context,
                part4Picture2Context: picture2Context
            });
            break;
        }

        case "PART4_FOLLOWUPS": {
            const pics = savedPicturePair();
            const day = getTodayElp() || {};
            let picture1Context = day.part4Picture1Context || null;
            let picture2Context = day.part4Picture2Context || null;
            if (!picture1Context && day.part4Picture1) {
                picture1Context = await getImageDescriptor(day.part4Picture1, { debugContext: { tab: "elp", state: "PART4_FOLLOWUPS", role: "picture1" } });
            }
            if (!picture2Context && day.part4Picture2) {
                picture2Context = await getImageDescriptor(day.part4Picture2, { debugContext: { tab: "elp", state: "PART4_FOLLOWUPS", role: "picture2" } });
            }
            if (picture1Context || picture2Context) {
                saveElpPatch({ part4Picture1Context: picture1Context, part4Picture2Context: picture2Context });
            }
            const questions = buildPart4FollowupQuestions(picture1Context, picture2Context);
            if (isDev) {
                renderMain(`<h3>Part 4 Follow-ups</h3>${pics}<ul>${questions.map((q) => `<li>${q}</li>`).join("")}</ul>`);
            } else {
                renderMain(`<h3>Follow-up Questions</h3>${pics}${renderQuestionList(questions)}`);
            }
            break;
        }

        case "PART4_DISCUSSION": {
            const pics = savedPicturePair();
            const day = getTodayElp() || {};
            let picture1Context = day.part4Picture1Context || null;
            let picture2Context = day.part4Picture2Context || null;
            if (!picture1Context && day.part4Picture1) {
                picture1Context = await getImageDescriptor(day.part4Picture1, { debugContext: { tab: "elp", state: "PART4_DISCUSSION", role: "picture1" } });
            }
            if (!picture2Context && day.part4Picture2) {
                picture2Context = await getImageDescriptor(day.part4Picture2, { debugContext: { tab: "elp", state: "PART4_DISCUSSION", role: "picture2" } });
            }
            if (picture1Context || picture2Context) {
                saveElpPatch({ part4Picture1Context: picture1Context, part4Picture2Context: picture2Context });
            }
            const questions = buildPart4DiscussionQuestions(picture1Context, picture2Context);
            if (isDev) {
                renderMain(`<h3>Part 4 Discussion</h3>${pics}<ul>${questions.map((q) => `<li>${q}</li>`).join("")}</ul>`);
            } else {
                renderMain(`<h3>Discussion Topics</h3>${pics}${renderQuestionList(questions)}`);
            }
            break;
        }

        case "SCORING": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Calculating your ICAO scores\u2026");
            const anthropicKey = getSettings().apiKeys.anthropic;
            const evidence = { stateLog: STATES, transcripts: runtime.transcripts, day: getTodayElp() };
            let score = makeFallbackScore("Fallback score (no Anthropic API key configured).");
            try {
                if (anthropicKey) {
                    score = await scoreICAO({ anthropicKey, evidence });
                }
            } catch (err) {
                console.error(err);
                score = makeFallbackScore(`Fallback scoring used due to API error: ${err.message}`);
            } finally {
                loader.remove();
            }

            if (isDev) {
                renderMain(`
                    <h3>ICAO Score</h3>
                    <p>Pronunciation: ${score.pronunciation}</p><p>Structure: ${score.structure}</p><p>Vocabulary: ${score.vocabulary}</p>
                    <p>Fluency: ${score.fluency}</p><p>Comprehension: ${score.comprehension}</p><p>Interactions: ${score.interactions}</p>
                    <p><strong>Overall: ${score.overall}</strong></p><p class="hint">${escapeHTML(score.rationale)}</p>
                `);
            } else {
                renderMain(renderScorecard(score));
            }
            saveElpPatch({ scoring: score, completedAt: new Date().toISOString() });
            addPerformance(KEYS.elpPerformance, { tab: "elp", date: getTodayString(), overall: score.overall, scoring: score, timestamp: new Date().toISOString() });
            onDataUpdated();
            break;
        }

        case "COMPLETE": {
            if (isDev) {
                renderMain("<h3>ELP session complete.</h3><p>You can review saved data in History and Dashboard.</p>");
            } else {
                const overall = getTodayElp()?.scoring?.overall;
                renderMain(`
                    <h3>Session Complete</h3>
                    <p>Your ELP exam simulation is finished.${overall ? ` Your overall ICAO level: <strong>${overall} (${ICAO_LEVELS[overall] || ""})</strong>.` : ""}</p>
                    <p>Review your detailed scores and history in the Analytics tab.</p>
                `);
            }
            cleanup();
            break;
        }

        default:
            renderMain("<p>Unknown ELP state.</p>");
    }

    renderActionArea();
}

/* ── Navigation ── */

function cleanup() {
    if (recorder) recorder.close();
    for (const key of ["sub1", "sub2"]) {
        if (runtime.story[key]?.audioSrc) {
            URL.revokeObjectURL(runtime.story[key].audioSrc);
            runtime.story[key].audioSrc = null;
        }
    }
    speechSynthesis.cancel();
}

async function playCurrentStory() {
    if (busy) return;
    if (state !== "PART2_SUB1_PLAY" && state !== "PART2_SUB2_PLAY") {
        alert("Play is enabled only in Part 2 play states.");
        return;
    }
    const key = state === "PART2_SUB1_PLAY" ? "sub1" : "sub2";
    const story = runtime.story[key];
    if (!story) { alert("Generate story first by entering this state."); return; }
    if (!story.audioSrc) { alert("No generated audio file. System speech was already played."); return; }
    try {
        const result = await playback.play({ id: key, src: story.audioSrc, maxPlays: 1 });
        root.querySelector("#audioLog").textContent = `Part 2 playback used (${result.plays}/1)`;
    } catch (err) { alert(err.message); }
}

async function nextState(options = {}) {
    const force = options?.force === true;
    if (busy && !force) return;
    const idx = STATES.indexOf(state);
    if (idx < STATES.length - 1) setState(STATES[idx + 1]);
    setBusy(true);
    try { await runCurrentState(); } finally { setBusy(false); }
}

async function previousState() {
    if (busy) return;
    const idx = STATES.indexOf(state);
    if (idx > 0) setState(STATES[idx - 1]);
    setBusy(true);
    try { await runCurrentState(); } finally { setBusy(false); }
}

/* ── Setup ── */

function setup() {
    const isDev = dev();
    const modeClass = isDev ? "elp-dev" : "elp-production";
    debugLog("elp.setup", "Initializing ELP tab", { tab: "elp", isDev, restoredState: getTodayElp()?.state || "IDLE" });

    root.innerHTML = `
        <section class="card elp-card ${modeClass}">
            <div class="elp-header">
                <h2>ELP Exam Simulation</h2>
                <button id="elpRestart" class="btn btn-secondary btn-sm">Restart Exam</button>
            </div>

            <div class="elp-progress" id="elpProgress"></div>
            <div class="elp-state" id="elpState"></div>
            <div class="elp-instruction" id="elpInstruction"></div>

            <div id="elpContent"></div>

            <div class="elp-action-area" id="elpActionArea"></div>

            <div class="elp-dev-controls">
                <button id="elpStart" class="btn btn-primary">Start / Resume</button>
                <button id="elpPrev" class="btn btn-secondary">Previous State</button>
                <button id="elpNext" class="btn btn-secondary">Next State</button>
                <button id="elpRecord" class="btn btn-secondary">Record Answer</button>
                <button id="elpPlay" class="btn btn-secondary">Play Current Audio</button>
            </div>

            <audio id="elpAudio" controls></audio>
            <div id="audioLog" class="audio-log hint"></div>
        </section>
    `;

    audioEl = root.querySelector("#elpAudio");
    playback = createPlaybackController(audioEl);
    recorder = createRecorder();

    setState(getTodayElp()?.state || "IDLE");

    root.querySelector("#elpRestart").addEventListener("click", () => {
        if (busy) return;
        if (state !== "IDLE" && !confirm("Restart ELP exam? Current progress will be cleared.")) return;
        cleanup();
        runtime.transcripts.length = 0;
        runtime.story.sub1 = null;
        runtime.story.sub2 = null;
        upsertDay(getTodayString(), () => ({ elp: null }));
        setState("IDLE");
        onDataUpdated();
        runCurrentState();
        renderActionArea();
    });

    // Dev controls
    root.querySelector("#elpStart").addEventListener("click", async () => {
        if (busy) return;
        if (state === "IDLE") setState("PART1_WARMUP");
        setBusy(true);
        try { await runCurrentState(); } finally { setBusy(false); }
    });
    root.querySelector("#elpNext").addEventListener("click", nextState);
    root.querySelector("#elpPrev").addEventListener("click", previousState);
    root.querySelector("#elpRecord").addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        try {
            const transcript = await recordAndTranscribe(state);
            root.querySelector("#elpContent").insertAdjacentHTML("beforeend", `<p><strong>Transcript:</strong> ${escapeHTML(transcript)}</p>`);
            saveElpPatch({ lastTranscript: { state, transcript } });
        } catch (err) { alert(`Recording failed: ${err.message}`); }
        finally { setBusy(false); }
    });
    root.querySelector("#elpPlay").addEventListener("click", playCurrentStory);

    runCurrentState();
}

/* ── Exports ── */

export function init(container, deps) {
    root = container;
    onDataUpdated = deps.onDataUpdated;
    setup();
}

export function generate() {
    if (state === "IDLE") setState("PART1_WARMUP");
    runCurrentState();
}

export function loadToday() {
    cleanup();
    setup();
}
