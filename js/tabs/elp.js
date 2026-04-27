import { askClaude, generateSpeechWithElevenLabs, searchPexels } from "../api.js";
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
    PART2_SUB2_PLAY:        { part: 2, section: "Part 2 \u2014 Listening",     label: "Listen",      instruction: "Listen carefully to the continuation of the story. You will hear it only once." },
    PART2_SUB2_DESCRIBE:    { part: 2, section: "Part 2 \u2014 Listening",     label: "Describe",    instruction: "Describe what you heard in the continuation, focusing on the non-standard/emergency handling.", auto: "record" },
    PART2_SUB2_ANALYZE:     { part: 2, section: "Part 2 \u2014 Listening",     label: "Processing",  instruction: "Analyzing your response\u2026", auto: "process" },
    PART2_SUB2_FOLLOWUP:    { part: 2, section: "Part 2 \u2014 Listening",     label: "Follow-ups",  instruction: "Answer these follow-up questions about the story continuation." },
    PART3_SET1:             { part: 3, section: "Part 3 \u2014 Communication", label: "Set 1",       instruction: "Listen to three short recordings. Each can be played max two times." },
    PART3_SET1_DESCRIBE:    { part: 3, section: "Part 3 \u2014 Communication", label: "Describe",    instruction: "Describe what you understood from the recordings.", auto: "record" },
    PART3_SET2:             { part: 3, section: "Part 3 \u2014 Communication", label: "Set 2",       instruction: "Listen to three medium recordings. Each can be played max two times." },
    PART3_SET2_DESCRIBE:    { part: 3, section: "Part 3 \u2014 Communication", label: "Describe",    instruction: "Describe what you understood from the recordings.", auto: "record" },
    PART3_SET3:             { part: 3, section: "Part 3 \u2014 Communication", label: "Set 3",       instruction: "Listen to three dialogue recordings. Each can be played max two times." },
    PART3_SET3_DESCRIBE:    { part: 3, section: "Part 3 \u2014 Communication", label: "Describe",    instruction: "Describe the dialogue details and operational meaning.", auto: "record" },
    PART4_PICTURE1:         { part: 4, section: "Part 4 \u2014 Discussion",    label: "Picture 1",   instruction: "Study this aviation image carefully." },
    PART4_PICTURE2_COMPARE: { part: 4, section: "Part 4 \u2014 Discussion",    label: "Compare",     instruction: "Compare these two images. Identify similarities and differences." },
    PART4_FOLLOWUPS:        { part: 4, section: "Part 4 \u2014 Discussion",    label: "Follow-ups",  instruction: "Answer these follow-up questions about the images." },
    PART4_DISCUSSION:       { part: 4, section: "Part 4 \u2014 Discussion",    label: "Discussion",  instruction: "Discuss these broader aviation topics." },
    SCORING:                { part: 4, section: "Scoring",                      label: "Results",     instruction: "Calculating your ICAO proficiency scores\u2026", auto: "process" },
    COMPLETE:               { part: 4, section: "Complete",                     label: "Complete",    instruction: "Your ELP session is complete." }
};

/* States hidden from the TOC (internal processing steps) */
const TOC_HIDDEN = new Set(["IDLE", "PART2_SUB1_ANALYZE", "PART2_SUB2_ANALYZE"]);

/* Friendly TOC labels that disambiguate sub-parts */
const TOC_LABELS = {
    PART1_FOLLOWUPS:     "Picture: Follow-ups",
    PART2_SUB1_PLAY:     "Story 1: Listen",
    PART2_SUB1_DESCRIBE: "Story 1: Describe",
    PART2_SUB1_FOLLOWUP: "Story 1: Follow-ups",
    PART2_SUB2_PLAY:     "Story Continuation: Listen",
    PART2_SUB2_DESCRIBE: "Story Continuation: Describe",
    PART2_SUB2_FOLLOWUP: "Story Continuation: Follow-ups",
    SCORING:             "Scoring",
    COMPLETE:            "Results"
};

/* Voice IDs for multi-voice TTS (ElevenLabs default library) */
const VOICE_MAP = {
    NARRATOR:   "JBFqnCBsd6RMkjVDRZzb", // George (male)
    CPT_M:      "TX3LPaxmHKxFdv7VOQHJ", // Liam (male)
    CPT_F:      "EXAVITQu4vr4xnSDxMaL", // Sarah (female)
    FO_M:       "onwK4e9ZLuTAKqWW03F9", // Daniel (male)
    FO_F:       "EXAVITQu4vr4xnSDxMaL", // Sarah (female)
    ATC_M:      "onwK4e9ZLuTAKqWW03F9", // Daniel (male)
    ATC_F:      "ThT5KcBeYPX3keUQqHPh", // Dorothy (female)
    CC_M:       "onwK4e9ZLuTAKqWW03F9", // Daniel (male)
    CC_F:       "ThT5KcBeYPX3keUQqHPh", // Dorothy (female)
    PAX_M:      "TX3LPaxmHKxFdv7VOQHJ", // Liam (male)
    PAX_F:      "AZnzlk1XvdvUeBnXmlld", // Domi (female)
    DISPATCH_M: "onwK4e9ZLuTAKqWW03F9", // Daniel (male)
    DISPATCH_F: "ThT5KcBeYPX3keUQqHPh", // Dorothy (female)
    OPS_M:      "onwK4e9ZLuTAKqWW03F9", // Daniel (male)
    OPS_F:      "ThT5KcBeYPX3keUQqHPh"  // Dorothy (female)
};

const VOICE_SETTINGS = {
    ATC_M:      { stability: 0.7, similarity_boost: 0.5 },
    ATC_F:      { stability: 0.7, similarity_boost: 0.5 },
    CPT_M:      { stability: 0.5, similarity_boost: 0.7 },
    CPT_F:      { stability: 0.5, similarity_boost: 0.7 },
    DISPATCH_M: { stability: 0.7, similarity_boost: 0.5 },
    DISPATCH_F: { stability: 0.7, similarity_boost: 0.5 }
};

const ROLE_LABELS = Object.freeze({
    NARRATOR: "Narrator",
    CPT_M: "Captain (male)",
    CPT_F: "Captain (female)",
    FO_M: "First Officer (male)",
    FO_F: "First Officer (female)",
    ATC_M: "Air Traffic Control (male)",
    ATC_F: "Air Traffic Control (female)",
    CC_M: "Cabin Crew (male)",
    CC_F: "Cabin Crew (female)",
    PAX_M: "Passenger (male)",
    PAX_F: "Passenger (female)",
    DISPATCH_M: "Dispatcher (male)",
    DISPATCH_F: "Dispatcher (female)",
    OPS_M: "Operations (male)",
    OPS_F: "Operations (female)"
});

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

const ELEVEN_SEGMENT_CONCURRENCY = 2;
const ELEVEN_RETRY_LIMIT = 3;
const ELEVEN_RETRY_BASE_DELAY_MS = 800;
const IMAGE_USAGE_CACHE_KEY = "af_elp_image_usage_v1";

const imageLoadCache = new Map();

const PART3_SET_KEYS = Object.freeze(["set1", "set2", "set3"]);

const PART3_FALLBACK_CLIPS = Object.freeze({
    set1: [
        { segments: [{ role: "ATC_M", text: "LOT four two one, hold short runway two niner, traffic landing." }] },
        { segments: [{ role: "CC_F", text: "Captain, cabin is secured and passengers are seated for departure." }] },
        { segments: [{ role: "DISPATCH_M", text: "Expect ten-minute delay due stand congestion at your destination." }] }
    ],
    set2: [
        { segments: [{ role: "ATC_M", text: "LOT four two one, proceed direct LOMKI, climb flight level three five zero, expect descent in twenty minutes." }] },
        {
            segments: [
                { role: "CPT_M", text: "Weather radar shows convective cells ahead; request deviation left by thirty miles." },
                { role: "ATC_F", text: "Deviation approved, report back on course in ten minutes." }
            ]
        },
        { segments: [{ role: "CC_F", text: "Passenger in row twelve reports chest pain. Cabin crew requests medical assistance and standby for possible diversion." }] }
    ],
    set3: [
        {
            segments: [
                { role: "CPT_M", text: "Hydraulic caution is on, confirm system pressure trend." },
                { role: "FO_F", text: "Pressure is dropping slowly, QRH non-normal checklist is open." },
                { role: "CPT_M", text: "Tell ATC we need vectors and delay approach." },
                { role: "FO_F", text: "ATC informed, we are cleared to hold at NERSA." },
                { role: "CPT_M", text: "Coordinate with cabin and brief possible diversion." },
                { role: "FO_F", text: "Cabin briefed, fuel allows one hold and diversion to Krakow." }
            ]
        },
        {
            segments: [
                { role: "ATC_M", text: "LOT four two one, descend flight level one eight zero, reduce speed two one zero knots." },
                { role: "FO_F", text: "Descending one eight zero, speed two one zero, LOT four two one." },
                { role: "ATC_M", text: "Traffic twelve o'clock, seven miles, same level." },
                { role: "FO_F", text: "Traffic in sight, we will maintain visual separation." },
                { role: "ATC_M", text: "After traffic, turn right heading two four zero for sequencing." },
                { role: "FO_F", text: "Right heading two four zero, LOT four two one." }
            ]
        },
        {
            segments: [
                { role: "DISPATCH_M", text: "Your destination crosswind is now above company limit." },
                { role: "CPT_F", text: "Copy, evaluate alternate weather and handling status." },
                { role: "DISPATCH_M", text: "Krakow reports stable winds and full emergency services available." },
                { role: "CPT_F", text: "Understood, preparing diversion plan and fuel check." },
                { role: "DISPATCH_M", text: "Slot and stand confirmed at Krakow, continue coordination with ATC." },
                { role: "CPT_F", text: "Confirmed, we are diverting and will advise final ETA shortly." }
            ]
        }
    ]
});

let root;
let onDataUpdated;
let state = "IDLE";
let busy = false;
let recorder;
let playback;
let audioEl;
let initialized = false;
let renderedMode = null;

const runtime = {
    transcripts: [],
    pinpoints: {
        sub1: ["timeline", "role actions", "non-normal clues", "ATC exchange", "crew coordination", "final outcome"],
        sub2: ["event trigger", "risk assessment", "decision path", "communication quality", "mitigation", "result"],
        part3: [],
        part4: ["differences captured", "safety interpretation", "operational recommendation"]
    },
    story: { sub1: null, sub2: null },
    storyTokens: { sub1: 0, sub2: 0 },
    storyProgress: { sub1: null, sub2: null },
    storyBuildJobs: { sub1: null, sub2: null },
    storyQueue: { token: 0, promise: null },
    part3: { set1: null, set2: null, set3: null },
    part3BuildJobs: { set1: null, set2: null, set3: null },
    part3SpeechPlays: {},
    sessionToken: 0,
    pexelsAttribution: {}
};

const PLAY_STATE_TO_STORY_KEY = Object.freeze({
    PART2_SUB1_PLAY: "sub1",
    PART2_SUB2_PLAY: "sub2"
});

const RECORD_STATE_TO_LABEL = Object.freeze({
    PART2_SUB1_DESCRIBE: "part2_sub1_description",
    PART2_SUB2_DESCRIBE: "part2_sub2_description",
    PART3_SET1_DESCRIBE: "part3_set1_describe",
    PART3_SET2_DESCRIBE: "part3_set2_describe",
    PART3_SET3_DESCRIBE: "part3_set3_describe"
});

/* ── Helpers ── */

function getTodayElp() {
    const day = getHistory()[getTodayString()] || {};
    return day.elp || null;
}

function dev() { return isDevMode(); }

function isRecordState(stateName = state) {
    return STATE_META[stateName]?.auto === "record";
}

function isProcessState(stateName = state) {
    return STATE_META[stateName]?.auto === "process";
}

function getPlayableStoryKey(stateName = state) {
    return PLAY_STATE_TO_STORY_KEY[stateName] || null;
}

function isPlayState(stateName = state) {
    return Boolean(getPlayableStoryKey(stateName));
}

function getRecordLabelForState(stateName = state) {
    return RECORD_STATE_TO_LABEL[stateName] || stateName.toLowerCase();
}

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
    if (previous === "IDLE" && next !== "IDLE") {
        runtime.sessionToken += 1;
        startPart2StoryQueue(runtime.sessionToken);
    }
    updateDevControls();
    updateToc();
}

function setBusy(isBusy) {
    busy = isBusy;
    root.querySelectorAll("button:not(.btn-stop)").forEach((btn) => { btn.disabled = isBusy; });
    updateDevControls();
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

function normalizeTopicPinpoint(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function uniqueTopicPinpoints(values, limit = 24) {
    const result = [];
    const seen = new Set();
    for (const value of values || []) {
        const cleaned = String(value || "").trim();
        if (!cleaned) continue;
        const key = normalizeTopicPinpoint(cleaned);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        result.push(cleaned);
        if (result.length >= limit) break;
    }
    return result;
}

function deriveTopicPinpoints(primary = [], segments = []) {
    const fromPrimary = Array.isArray(primary) ? primary : [];
    const fromSegments = Array.isArray(segments)
        ? segments
            .map((segment) => String(segment?.text || "").trim())
            .filter(Boolean)
            .slice(0, 8)
            .map((line) => line.split(/[.!?]/)[0].trim())
            .filter(Boolean)
        : [];
    return uniqueTopicPinpoints([...fromPrimary, ...fromSegments], 12);
}

function collectPreviousPart2TopicPinpoints(limit = 40) {
    const history = getHistory();
    const dates = Object.keys(history).sort().reverse();
    const collected = [];
    for (const date of dates) {
        const part2 = history[date]?.elp?.part2TopicPinpoints;
        if (!part2) continue;
        const combined = Array.isArray(part2.combined)
            ? part2.combined
            : [
                ...(Array.isArray(part2.sub1) ? part2.sub1 : []),
                ...(Array.isArray(part2.sub2) ? part2.sub2 : [])
            ];
        if (!combined.length) continue;
        collected.push(...combined);
        if (collected.length >= limit * 2) break;
    }
    return uniqueTopicPinpoints(collected, limit);
}

function savePart2TopicPinpointsForLabel(label, topicPinpoints) {
    const current = getTodayElp()?.part2TopicPinpoints || {};
    const nextSub1 = label === "sub1"
        ? uniqueTopicPinpoints(topicPinpoints, 12)
        : (Array.isArray(current.sub1) ? current.sub1 : []);
    const nextSub2 = label === "sub2"
        ? uniqueTopicPinpoints(topicPinpoints, 12)
        : (Array.isArray(current.sub2) ? current.sub2 : []);
    const combined = uniqueTopicPinpoints([...nextSub1, ...nextSub2], 24);
    saveElpPatch({
        part2TopicPinpoints: {
            sub1: nextSub1,
            sub2: nextSub2,
            combined,
            updatedAt: new Date().toISOString()
        }
    });
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

function renderToc() {
    const nav = root.querySelector("#elpToc");
    if (!nav) return;

    let html = "";
    let currentSection = "";

    for (const s of STATES) {
        if (TOC_HIDDEN.has(s)) continue;
        const meta = STATE_META[s];
        if (!meta) continue;

        if (meta.section !== currentSection) {
            currentSection = meta.section;
            html += `<div class="toc-group">${escapeHTML(currentSection)}</div>`;
        }

        const label = TOC_LABELS[s] || meta.label;
        html += `<div class="toc-item" data-state="${s}">${escapeHTML(label)}</div>`;
    }

    nav.innerHTML = html;
    updateToc();
}

function updateToc() {
    const nav = root.querySelector("#elpToc");
    if (!nav) return;

    const idx = STATES.indexOf(state);
    // For hidden (analyze) states, highlight the preceding visible state
    let activeState = state;
    if (TOC_HIDDEN.has(state)) {
        for (let i = idx - 1; i >= 0; i--) {
            if (!TOC_HIDDEN.has(STATES[i])) { activeState = STATES[i]; break; }
        }
    }

    // Build ordered list of visible TOC states
    const visibleStates = STATES.filter(s => !TOC_HIDDEN.has(s));
    const activeVisIdx = visibleStates.indexOf(activeState);
    const WINDOW = 3; // show N items before & after active

    // Determine which states fall within the visible window
    const windowStart = Math.max(0, activeVisIdx - WINDOW);
    const windowEnd = Math.min(visibleStates.length - 1, activeVisIdx + WINDOW);
    const visibleSet = new Set(visibleStates.slice(windowStart, windowEnd + 1));

    // Also figure out which section headers to keep
    const visibleSections = new Set();
    for (const s of visibleSet) {
        visibleSections.add(STATE_META[s]?.section);
    }

    const activeIdx = STATES.indexOf(activeState);

    for (const el of nav.children) {
        if (el.classList.contains("toc-group")) {
            el.classList.toggle("toc-hidden", !visibleSections.has(el.textContent));
        } else if (el.classList.contains("toc-item")) {
            const s = el.dataset.state;
            const sIdx = STATES.indexOf(s);
            el.classList.toggle("toc-active", s === activeState);
            el.classList.toggle("toc-done", sIdx < activeIdx);
            el.classList.toggle("toc-hidden", !visibleSet.has(s));
        }
    }
}

function renderQuestionList(items) {
    return `<ul class="elp-questions">${items.map((q) => `<li>${escapeHTML(q)}</li>`).join("")}</ul>`;
}

function pexelsCredit(src) {
    const attr = runtime.pexelsAttribution?.[src];
    if (!attr) return "";
    const photographerLink = attr.photographerUrl
        ? `<a href="${attr.photographerUrl}" target="_blank" rel="noopener">${escapeHTML(attr.photographerCredit)}</a>`
        : escapeHTML(attr.photographerCredit);
    const pexelsLink = attr.pexelsUrl
        ? `<a href="${attr.pexelsUrl}" target="_blank" rel="noopener">Pexels</a>`
        : "Pexels";
    return `<div class="pexels-credit">Photo by ${photographerLink} on ${pexelsLink}</div>`;
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

function renderTranscriptPrompt(title, transcript, hint, extra = "") {
    return `
        <h3>${escapeHTML(title)}</h3>
        <p class="hint">${escapeHTML(hint)}</p>
        ${transcript ? `<p><strong>Transcript:</strong> ${escapeHTML(transcript)}</p>` : "<p class=\"hint\">No transcript captured yet.</p>"}
        ${extra}
    `;
}

function renderAnalysisDetails(title, analysis, emptyHint) {
    if (!analysis) {
        return `<h3>${escapeHTML(title)}</h3><p class="hint">${escapeHTML(emptyHint)}</p>`;
    }

    return `
        <h3>${escapeHTML(title)}</h3>
        <p><strong>Covered:</strong> ${(analysis.covered || []).map(escapeHTML).join(", ") || "none"}</p>
        <p><strong>Missed:</strong> ${(analysis.missed || []).map(escapeHTML).join(", ") || "none"}</p>
        ${(analysis.followUps || []).length ? `<p><strong>Follow-ups:</strong> ${(analysis.followUps || []).map(escapeHTML).join(" | ")}</p>` : ""}
    `;
}

function renderScoreDetails(score) {
    if (!score) {
        return `<h3>ICAO Score</h3><p class="hint">Use the developer action button to calculate the current score.</p>`;
    }

    return `
        <h3>ICAO Score</h3>
        <p>Pronunciation: ${score.pronunciation}</p><p>Structure: ${score.structure}</p><p>Vocabulary: ${score.vocabulary}</p>
        <p>Fluency: ${score.fluency}</p><p>Comprehension: ${score.comprehension}</p><p>Interactions: ${score.interactions}</p>
        <p><strong>Overall: ${score.overall}</strong></p><p class="hint">${escapeHTML(score.rationale || "")}</p>
    `;
}

function updateModeClass() {
    const card = root?.querySelector(".elp-card");
    if (!card) return;
    const isDev = dev();
    card.classList.toggle("elp-dev", isDev);
    card.classList.toggle("elp-production", !isDev);
    renderedMode = isDev ? "dev" : "production";
}

function updateDevControls() {
    const controls = root?.querySelector("#elpDevControls");
    if (!controls) return;

    const isDev = dev();
    controls.hidden = !isDev;
    if (!isDev) return;

    const runBtn = root.querySelector("#elpStart");
    const prevBtn = root.querySelector("#elpPrev");
    const nextBtn = root.querySelector("#elpNext");
    const recordBtn = root.querySelector("#elpRecord");
    const playBtn = root.querySelector("#elpPlay");

    const showRunButton = state === "IDLE" || isProcessState() || (!isPlayState() && !isRecordState());
    runBtn.hidden = !showRunButton;
    runBtn.textContent = state === "IDLE"
        ? "Start Exam"
        : state === "SCORING"
            ? "Calculate Score"
            : isProcessState()
                ? "Run Analysis"
                : "Refresh Step";

    prevBtn.disabled = busy || STATES.indexOf(state) <= 0;
    nextBtn.disabled = busy || STATES.indexOf(state) >= STATES.length - 1;

    recordBtn.hidden = !isRecordState();
    recordBtn.disabled = busy;

    const storyKey = getPlayableStoryKey();
    const canPlayCurrentStory = Boolean(storyKey && runtime.story[storyKey]?.audioSrc);
    playBtn.hidden = !isPlayState() || !canPlayCurrentStory;
    playBtn.disabled = busy || !canPlayCurrentStory;
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

function normalizeStoryRole(role) {
    const raw = String(role || "").trim().toUpperCase();
    if (!raw) return "NARRATOR";
    if (/^(AMBIENT|AMBIENCE|SFX|FX|BGM|MUSIC|SOUND|SOUNDS|SOUND_EFFECTS?|NOISES?)(?:[_\s-].*)?$/.test(raw)) {
        return null;
    }

    const aliases = {
        CPT: "CPT_M",
        FO: "FO_F",
        ATC: "ATC_M",
        CC: "CC_F",
        PAX: "PAX_M",
        DISPATCH: "DISPATCH_M",
        OPS: "OPS_M",
        CAPTAIN: "CPT_M",
        FIRST_OFFICER: "FO_F",
        CABIN_CREW: "CC_F",
        PASSENGER: "PAX_M"
    };

    const mapped = aliases[raw] || raw;
    return VOICE_MAP[mapped] ? mapped : "NARRATOR";
}

function stripBalancedWrap(text) {
    if (!text) return "";
    const trimmed = text.trim();
    if (!trimmed) return "";
    if ((trimmed.startsWith("[") && trimmed.endsWith("]"))
        || (trimmed.startsWith("(") && trimmed.endsWith(")"))
        || (trimmed.startsWith("*") && trimmed.endsWith("*"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

function isLikelyNonSpokenNote(text) {
    const lower = String(text || "").trim().toLowerCase();
    if (!lower) return true;
    if (/^(ambient|ambience|sfx|fx|bgm|music|sound effects?|sound cue|audio cue|background noise|background noises|noise|noises)\b/.test(lower)) {
        return true;
    }
    if (/^(fade in|fade out|cut to|scene(?:\s*[:\-]|$)|voice ?over(?:\s*[:\-]|$)|narration(?:\s*[:\-]|$))/.test(lower)) {
        return true;
    }
    return false;
}

function sanitizeStoryText(text) {
    let cleaned = stripBalancedWrap(String(text || ""));
    if (!cleaned) return "";

    cleaned = cleaned.replace(
        /^\s*(?:narrator|captain|first officer|air traffic control|atc|cabin crew|passenger|dispatcher|operations)\s*[:\-]\s*/i,
        ""
    ).trim();
    if (!cleaned) return "";

    if (isLikelyNonSpokenNote(cleaned)) return "";
    return cleaned;
}

function sanitizeStorySegments(rawSegments = []) {
    if (!Array.isArray(rawSegments) || !rawSegments.length) {
        return [];
    }
    return rawSegments
        .filter((segment) => segment && segment.text)
        .map((segment) => {
            const role = normalizeStoryRole(segment.role);
            const text = sanitizeStoryText(segment.text);
            if (!role) return null;
            if (!text) return null;
            return {
                role,
                text
            };
        })
        .filter((segment) => segment && segment.text.length > 0);
}

function segmentsToScript(segments) {
    return segments.map((segment) => {
        const role = normalizeStoryRole(segment.role);
        const label = ROLE_LABELS[role] || role;
        return `${label}: ${segment.text}`;
    }).join("\n");
}

function segmentsToPlainText(segments) {
    return segments.map((segment) => segment.text).join(" ");
}

function setStoryProgress(label, patch = {}) {
    runtime.storyProgress[label] = {
        ...(runtime.storyProgress[label] || {}),
        ...patch,
        updatedAt: Date.now()
    };
}

function createPart2ProgressLoader(container, heading = "Generating listening story...") {
    const overlay = document.createElement("div");
    overlay.className = "ai-loading-overlay";
    overlay.innerHTML = `
        <div class="ai-loading-inner elp-story-loader">
            <div class="ai-loading-msg">${escapeHTML(heading)}</div>
            <div class="elp-story-loader-status" data-role="status">Preparing request...</div>
            <div class="elp-story-loader-track">
                <div class="elp-story-loader-fill" data-role="fill" style="width:0%"></div>
            </div>
            <div class="elp-story-loader-percent" data-role="percent">0%</div>
        </div>
    `;
    container.prepend(overlay);

    const statusEl = overlay.querySelector('[data-role="status"]');
    const fillEl = overlay.querySelector('[data-role="fill"]');
    const percentEl = overlay.querySelector('[data-role="percent"]');

    return {
        update(progress) {
            if (!progress) return;
            const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
            if (statusEl && progress.message) statusEl.textContent = progress.message;
            if (fillEl) fillEl.style.width = `${percent}%`;
            if (percentEl) percentEl.textContent = `${Math.round(percent)}%`;
        },
        remove() {
            overlay.remove();
        }
    };
}

function waitMs(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isElevenConcurrencyError(err) {
    const message = String(err?.message || "").toLowerCase();
    return message.includes("too many concurrent requests")
        || message.includes("concurrent_limit_exceeded")
        || message.includes("too_many_concurrent_requests");
}

async function runWithElevenRetry(task, debugContext = {}) {
    for (let attempt = 1; attempt <= ELEVEN_RETRY_LIMIT; attempt += 1) {
        try {
            return await task();
        } catch (err) {
            const retryable = isElevenConcurrencyError(err);
            if (!retryable || attempt === ELEVEN_RETRY_LIMIT) {
                throw err;
            }
            const delay = ELEVEN_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
            debugLog("elp.buildPart2Story", "Segment hit ElevenLabs concurrency limit; retrying", {
                ...debugContext,
                attempt,
                nextDelayMs: delay,
                error: err?.message || String(err)
            }, "warn");
            await waitMs(delay);
        }
    }
    return null;
}

async function mapWithConcurrency(items, concurrency, mapper) {
    if (!Array.isArray(items) || !items.length) {
        return [];
    }
    const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
    const results = new Array(items.length);
    let nextIndex = 0;

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= items.length) {
                return;
            }
            results[currentIndex] = await mapper(items[currentIndex], currentIndex);
        }
    };

    await Promise.all(Array.from({ length: safeConcurrency }, () => worker()));
    return results;
}

async function concatenateAudioBlobs(blobs) {
    const ctx = new AudioContext();
    const buffers = [];
    for (const blob of blobs) {
        try {
            const arrayBuf = await blob.arrayBuffer();
            const decoded = await ctx.decodeAudioData(arrayBuf);
            buffers.push(decoded);
        } catch {
            // skip undecodable segments
        }
    }
    if (!buffers.length) { ctx.close(); return null; }

    const sampleRate = buffers[0].sampleRate;
    const channels = buffers[0].numberOfChannels;
    const totalLength = buffers.reduce((sum, b) => sum + b.length, 0);
    const output = ctx.createBuffer(channels, totalLength, sampleRate);

    let offset = 0;
    for (const buf of buffers) {
        for (let ch = 0; ch < channels; ch++) {
            output.getChannelData(ch).set(buf.getChannelData(ch), offset);
        }
        offset += buf.length;
    }

    // Encode to WAV
    const wavBlob = audioBufferToWav(output);
    ctx.close();
    return wavBlob;
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitsPerSample = 16;
    const interleaved = numChannels === 1
        ? buffer.getChannelData(0)
        : interleaveChannels(buffer);
    const dataLength = interleaved.length * (bitsPerSample / 8);
    const headerLength = 44;
    const arrayBuffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
    view.setUint16(32, numChannels * (bitsPerSample / 8), true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, "data");
    view.setUint32(40, dataLength, true);

    let off = 44;
    for (let i = 0; i < interleaved.length; i++, off += 2) {
        const s = Math.max(-1, Math.min(1, interleaved[i]));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([arrayBuffer], { type: "audio/wav" });
}

function interleaveChannels(buffer) {
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const result = new Float32Array(left.length * 2);
    for (let i = 0; i < left.length; i++) {
        result[i * 2] = left[i];
        result[i * 2 + 1] = right[i];
    }
    return result;
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

async function buildPart2Story(label, options = {}) {
    const settings = getSettings();
    const anthropicKey = settings.apiKeys.anthropic;
    const elevenKey = settings.apiKeys.elevenlabs;
    const fallbackSegments = [
        { role: "NARRATOR", text: label === "sub1"
            ? "Boarding starts, ATC flow restrictions apply, and crew manages minor technical note before pushback."
            : "Continuation: the same flight now faces a non-standard event with weather and cabin pressure, requiring coordinated emergency handling." }
    ];
    let segments = fallbackSegments;
    let pinpoints = runtime.pinpoints[label];
    let topicPinpoints = deriveTopicPinpoints(pinpoints, fallbackSegments);
    const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;
    const previousTopics = label === "sub1" ? collectPreviousPart2TopicPinpoints(40) : [];
    const previousTopicBlock = previousTopics.length
        ? previousTopics.map((topic, index) => `${index + 1}. ${topic}`).join("\n")
        : "None";

    debugLog("elp.buildPart2Story", "Building story", { tab: "elp", label });
    setStoryProgress(label, { phase: "story", percent: 5, message: "Generating story script..." });
    if (onProgress) onProgress(runtime.storyProgress[label]);

    if (anthropicKey) {
        try {
            const prompt = label === "sub1"
                ? `Write Part 1 of one continuous aviation fiction story for ELP listening practice (story ${label}).
Part 1 should take approximately 4-7 minutes when spoken aloud.

OUTPUT FORMAT - return strict JSON only:
{
  "segments": [
    { "role": "NARRATOR", "text": "..." },
    { "role": "CPT_M", "text": "..." },
    { "role": "FO_F", "text": "..." },
    ...
  ],
  "pinpoints": ["checkpoint 1", "checkpoint 2", ...],
  "topicPinpoints": ["short theme/topic phrase", "..."]
}

SEGMENT RULES:
- Each segment has exactly one "role" and one "text".
- Valid roles: NARRATOR, CPT_M, CPT_F, FO_M, FO_F, ATC_M, ATC_F, CC_M, CC_F, PAX_M, PAX_F, DISPATCH_M, DISPATCH_F, OPS_M, OPS_F.
- Do NOT use AMBIENT or sound-effect roles.
- Do NOT put role prefixes inside the text - the role field handles that.
- All segments are spoken dialogue or narration.
- Do NOT include production notes such as "Ambient terminal noises", "[SFX]", "(music)", or scene directions.

STORY STRUCTURE:
Part 1 should cover pre-departure through stable cruise setup and end with unresolved risk/tension that naturally leads to Part 2.

DIALOGUE:
- CPT and FO have a working dynamic - contrasting styles that surface under pressure.
- ATC transmissions use realistic phraseology: callsigns, headings, altitudes, readbacks. Short, clipped, professional.
- At least one cabin crew member has a moment beyond announcements.
- At least one passenger perspective anchors the cabin side.

REALISM:
Include proper aviation terminology: callsigns, flight levels, squawk codes, STAR/SID names, runway designators, standard ATC phrases, checklists, CRM dialogue.

SPEAKER CLARITY:
- The first narrator line must introduce each speaking role in plain English, for example: "Cabin Crew (CC_F): Marta."
- Before the first spoken line of each non-narrator role, add a short NARRATOR line that identifies that speaker by role and name.
- Keep speaker names consistent throughout the story.

PINPOINTS:
- "pinpoints": 8-15 short checkpoints capturing plot/safety moments a listener should recall from Part 1.
- "topicPinpoints": 6-12 concise topic labels (for repetition control in future stories).

AVOID TOPIC OVERLAP WITH PREVIOUS STORIES:
${previousTopicBlock}
Do not reuse these same themes/topics unless absolutely required for realism.`
                : `Write Part 2 as a direct continuation of the SAME story and SAME flight from Part 1 (story ${label}).
Part 2 should take approximately 4-7 minutes when spoken aloud.

Part 1 script (maintain continuity of timeline, names, aircraft context, and unresolved threads):
${runtime.story.sub1?.script || "N/A"}

Part 1 pinpoints:
${JSON.stringify(runtime.story.sub1?.pinpoints || runtime.pinpoints.sub1 || [])}

OUTPUT FORMAT - return strict JSON only:
{
  "segments": [
    { "role": "NARRATOR", "text": "..." },
    { "role": "CPT_M", "text": "..." },
    { "role": "FO_F", "text": "..." },
    ...
  ],
  "pinpoints": ["checkpoint 1", "checkpoint 2", ...],
  "topicPinpoints": ["short theme/topic phrase", "..."]
}

SEGMENT RULES:
- Each segment has exactly one "role" and one "text".
- Valid roles: NARRATOR, CPT_M, CPT_F, FO_M, FO_F, ATC_M, ATC_F, CC_M, CC_F, PAX_M, PAX_F, DISPATCH_M, DISPATCH_F, OPS_M, OPS_F.
- Do NOT use AMBIENT or sound-effect roles.
- Do NOT put role prefixes inside the text - the role field handles that.
- All segments are spoken dialogue or narration.
- Do NOT include production notes such as "Ambient terminal noises", "[SFX]", "(music)", or scene directions.

PART 2 REQUIREMENTS:
- Center on non-standard or emergency evolution (technical, weather, cabin, medical, ATC complexity, or operational pressure), then coordinated handling and outcome.
- Preserve speaker names and role behavior from Part 1.
- Keep ATC phraseology realistic and concise.
- Show CRM decisions, threat/risk assessment, communication quality, and final resolution path.

PINPOINTS:
- "pinpoints": 8-15 short checkpoints focused on non-standard/emergency progression and handling outcomes.
- "topicPinpoints": 6-12 concise topic labels for this continuation segment.`;

            const text = await askClaude({
                apiKey: anthropicKey,
                prompt,
                maxTokens: 8000,
                temperature: 0.35,
                timeoutMs: 120000,
                debugContext: { tab: "elp", operation: "buildPart2Story", label }
            });
            const parsed = extractJSON(text);
            if (parsed) {
                if (Array.isArray(parsed.segments) && parsed.segments.length) {
                    const cleaned = sanitizeStorySegments(parsed.segments);
                    if (cleaned.length) {
                        segments = cleaned;
                    }
                }
                if (Array.isArray(parsed.pinpoints) && parsed.pinpoints.length) {
                    pinpoints = parsed.pinpoints;
                }
                if (Array.isArray(parsed.topicPinpoints) && parsed.topicPinpoints.length) {
                    topicPinpoints = parsed.topicPinpoints;
                }
            }
        } catch (err) {
            debugLog("elp.buildPart2Story", "Story generation failed, fallback used", {
                tab: "elp", label, error: err?.message || String(err)
            }, "warn");
        }
    }

    const script = segmentsToScript(segments);
    runtime.pinpoints[label] = pinpoints;
    topicPinpoints = deriveTopicPinpoints(topicPinpoints.length ? topicPinpoints : pinpoints, segments);
    savePart2TopicPinpointsForLabel(label, topicPinpoints);

    setStoryProgress(label, {
        phase: "tts",
        percent: 15,
        completed: 0,
        total: segments.length,
        message: `Generating speech segments (0/${segments.length})...`
    });
    if (onProgress) onProgress(runtime.storyProgress[label]);

    if (elevenKey) {
        try {
            debugLog("elp.buildPart2Story", `Generating audio for ${segments.length} segments`, {
                tab: "elp",
                label,
                concurrency: ELEVEN_SEGMENT_CONCURRENCY
            });
            const blobs = await mapWithConcurrency(segments, ELEVEN_SEGMENT_CONCURRENCY, async (seg, i) => {
                const role = normalizeStoryRole(seg.role);
                const ctx = { tab: "elp", operation: "buildPart2Story.tts", label, segment: i, role };
                try {
                    const voiceId = VOICE_MAP[role] || VOICE_MAP.NARRATOR;
                    const voiceSettings = VOICE_SETTINGS[role] || undefined;
                    const blob = await runWithElevenRetry(() => generateSpeechWithElevenLabs({
                        apiKey: elevenKey,
                        text: seg.text,
                        voiceId,
                        voiceSettings,
                        debugContext: ctx
                    }), ctx);

                    const current = runtime.storyProgress[label] || { completed: 0, total: segments.length };
                    const completed = Math.min((current.completed || 0) + 1, segments.length);
                    const percent = 15 + ((completed / Math.max(1, segments.length)) * 80);
                    setStoryProgress(label, {
                        phase: "tts",
                        percent,
                        completed,
                        total: segments.length,
                        message: `Generating speech segments (${completed}/${segments.length})...`
                    });
                    if (onProgress) onProgress(runtime.storyProgress[label]);

                    return blob;
                } catch (err) {
                    debugLog("elp.buildPart2Story", "Segment audio failed, skipping segment", {
                        ...ctx,
                        error: err?.message || String(err)
                    }, "warn");
                    return null;
                }
            });

            const successfulBlobs = blobs.filter(Boolean);
            if (successfulBlobs.length) {
                const combined = await concatenateAudioBlobs(successfulBlobs);
                if (combined) {
                    setStoryProgress(label, { phase: "done", percent: 100, message: "Story audio is ready." });
                    if (onProgress) onProgress(runtime.storyProgress[label]);
                    return { script, segments, pinpoints, topicPinpoints, audioSrc: URL.createObjectURL(combined) };
                }
            }
            debugLog("elp.buildPart2Story", "Audio stitching produced no output, falling back", { tab: "elp", label }, "warn");
        } catch (err) {
            debugLog("elp.buildPart2Story", "TTS pipeline failed, speechSynthesis fallback", {
                tab: "elp", label, error: err?.message || String(err)
            }, "warn");
        }
    }

    const plainText = segmentsToPlainText(segments);
    speakEnglishFallback(plainText, { tab: "elp", operation: "buildPart2Story.fallbackTts", label });
    setStoryProgress(label, { phase: "done", percent: 100, message: "Using browser speech fallback." });
    if (onProgress) onProgress(runtime.storyProgress[label]);
    return { script, segments, pinpoints, topicPinpoints, audioSrc: null };
}
async function ensurePart2Story(label, token = runtime.sessionToken, options = {}) {
    if (label === "sub2" && (!runtime.story.sub1 || runtime.storyTokens.sub1 !== token)) {
        await ensurePart2Story("sub1", token);
    }

    if (runtime.story[label] && runtime.storyTokens[label] === token) {
        return runtime.story[label];
    }

    const existingJob = runtime.storyBuildJobs[label];
    if (existingJob && existingJob.token === token) {
        return existingJob.promise;
    }

    const promise = (async () => {
        const story = await buildPart2Story(label, options);
        if (runtime.sessionToken === token) {
            runtime.story[label] = story;
            runtime.storyTokens[label] = token;
        }
        return (runtime.storyTokens[label] === token && runtime.story[label]) ? runtime.story[label] : story;
    })();

    runtime.storyBuildJobs[label] = { token, promise };

    try {
        return await promise;
    } finally {
        const activeJob = runtime.storyBuildJobs[label];
        if (activeJob && activeJob.token === token && activeJob.promise === promise) {
            runtime.storyBuildJobs[label] = null;
        }
    }
}

function startPart2StoryQueue(token = runtime.sessionToken) {
    if (state === "IDLE") {
        return;
    }
    if (runtime.storyQueue.promise && runtime.storyQueue.token === token) {
        return;
    }

    runtime.storyQueue = {
        token,
        promise: (async () => {
            try {
                debugLog("elp.storyQueue", "Starting Part 2 story queue", { tab: "elp", token });
                await ensurePart2Story("sub1", token);
                await ensurePart2Story("sub2", token);
                debugLog("elp.storyQueue", "Part 2 story queue completed", { tab: "elp", token });
            } catch (err) {
                debugLog("elp.storyQueue", "Part 2 story queue failed", {
                    tab: "elp",
                    token,
                    error: err?.message || String(err)
                }, "warn");
            } finally {
                if (runtime.storyQueue.token === token) {
                    runtime.storyQueue.promise = null;
                }
            }
        })()
    };
}

function getPart3SetKey(stateName = state) {
    if (stateName === "PART3_SET1" || stateName === "PART3_SET1_DESCRIBE") return "set1";
    if (stateName === "PART3_SET2" || stateName === "PART3_SET2_DESCRIBE") return "set2";
    if (stateName === "PART3_SET3" || stateName === "PART3_SET3_DESCRIBE") return "set3";
    return null;
}

function part3SpecForSet(setKey) {
    if (setKey === "set1") {
        return "Create exactly 3 short recordings. Each recording is one utterance of 1-2 sentences.";
    }
    if (setKey === "set2") {
        return "Create exactly 3 medium recordings. Each recording is either: (A) one speaker with max 4 sentences, OR (B) a short 2-line dialogue (one sentence per speaker).";
    }
    return "Create exactly 3 dialogue recordings. In each recording, exactly two speakers speak 3 utterances each (6 lines total, alternating turns).";
}

function part3ClipToPlainText(clip) {
    return segmentsToPlainText(clip?.segments || []);
}

function part3ClipPlayCount(clipId) {
    return Number(runtime.part3SpeechPlays[clipId] || 0);
}

function canPlayPart3Clip(clip, maxPlays = 2) {
    if (!clip) return false;
    return part3ClipPlayCount(clip.id) < maxPlays;
}

async function playPart3Clip(clip, maxPlays = 2) {
    if (!clip) throw new Error("Clip not found.");
    if (!canPlayPart3Clip(clip, maxPlays)) {
        throw new Error("Playback limit reached for this clip.");
    }

    if (clip.audioSrc) {
        await playback.play({ id: clip.id, src: clip.audioSrc, maxPlays });
        const plays = part3ClipPlayCount(clip.id) + 1;
        runtime.part3SpeechPlays[clip.id] = plays;
        return { plays, remaining: Math.max(0, maxPlays - plays) };
    }

    // Browser fallback mode when ElevenLabs audio is unavailable.
    const text = part3ClipToPlainText(clip);
    if (!text) throw new Error("Clip text is empty.");
    speakEnglishFallback(text, { tab: "elp", operation: "part3.playFallback", clipId: clip.id });
    const plays = part3ClipPlayCount(clip.id) + 1;
    runtime.part3SpeechPlays[clip.id] = plays;
    return { plays, remaining: Math.max(0, maxPlays - plays) };
}

function normalizePart3Clips(rawClips, setKey) {
    const source = Array.isArray(rawClips) ? rawClips.slice(0, 3) : [];
            const clips = source
        .map((clip, idx) => {
            const segments = sanitizeStorySegments(clip?.segments || []);
            if (!segments.length) return null;
            return {
                id: `part3_s${runtime.sessionToken}_${setKey}_clip${idx + 1}`,
                title: String(clip?.title || `Clip ${idx + 1}`).trim() || `Clip ${idx + 1}`,
                segments
            };
        })
        .filter(Boolean);
    return clips;
}

function fallbackPart3Set(setKey) {
    const fallbackClips = PART3_FALLBACK_CLIPS[setKey] || PART3_FALLBACK_CLIPS.set1;
    return normalizePart3Clips(fallbackClips, setKey);
}

async function buildPart3Set(setKey) {
    const settings = getSettings();
    const anthropicKey = settings.apiKeys.anthropic;
    const elevenKey = settings.apiKeys.elevenlabs;
    let clips = fallbackPart3Set(setKey);

    if (anthropicKey) {
        try {
            const prompt = `Generate ELP Part 3 listening materials in strict JSON.

Output JSON only:
{
  "clips": [
    {
      "title": "short label",
      "segments": [
        { "role": "ATC_M", "text": "..." }
      ]
    }
  ]
}

Global rules:
- Return exactly 3 clips.
- Valid roles only: NARRATOR, CPT_M, CPT_F, FO_M, FO_F, ATC_M, ATC_F, CC_M, CC_F, PAX_M, PAX_F, DISPATCH_M, DISPATCH_F, OPS_M, OPS_F.
- English only, realistic aviation operational phraseology.
- Segments must be spoken words only (no stage directions like "Ambient terminal noises", "[SFX]", "(music)").
- No explanations, no markdown, no extra keys.

Set: ${setKey}
Set-specific format:
${part3SpecForSet(setKey)}`;

            const text = await askClaude({
                apiKey: anthropicKey,
                prompt,
                maxTokens: 2200,
                temperature: 0.35,
                timeoutMs: 90000,
                debugContext: { tab: "elp", operation: "buildPart3Set", setKey }
            });
            const parsed = extractJSON(text);
            const parsedClips = normalizePart3Clips(parsed?.clips, setKey);
            if (parsedClips.length === 3) {
                clips = parsedClips;
            }
        } catch (err) {
            debugLog("elp.buildPart3Set", "Part 3 text generation failed, fallback used", {
                tab: "elp",
                setKey,
                error: err?.message || String(err)
            }, "warn");
        }
    }

    if (elevenKey) {
        try {
            const withAudio = await Promise.all(clips.map(async (clip) => {
                const segmentBlobs = await mapWithConcurrency(clip.segments, 2, async (segment, segmentIndex) => {
                    const role = normalizeStoryRole(segment.role);
                    const voiceId = VOICE_MAP[role] || VOICE_MAP.NARRATOR;
                    const voiceSettings = VOICE_SETTINGS[role] || undefined;
                    return runWithElevenRetry(() => generateSpeechWithElevenLabs({
                        apiKey: elevenKey,
                        text: segment.text,
                        voiceId,
                        voiceSettings,
                        debugContext: { tab: "elp", operation: "buildPart3Set.tts", setKey, clipId: clip.id, segmentIndex, role }
                    }), { tab: "elp", operation: "buildPart3Set.tts", setKey, clipId: clip.id, segmentIndex, role })
                        .catch(() => null);
                });

                const okBlobs = segmentBlobs.filter(Boolean);
                if (!okBlobs.length) {
                    return { ...clip, audioSrc: null };
                }
                const stitched = await concatenateAudioBlobs(okBlobs);
                return { ...clip, audioSrc: stitched ? URL.createObjectURL(stitched) : null };
            }));
            clips = withAudio;
        } catch (err) {
            debugLog("elp.buildPart3Set", "Part 3 TTS failed, fallback speech mode", {
                tab: "elp",
                setKey,
                error: err?.message || String(err)
            }, "warn");
            clips = clips.map((clip) => ({ ...clip, audioSrc: null }));
        }
    } else {
        clips = clips.map((clip) => ({ ...clip, audioSrc: null }));
    }

    return {
        setKey,
        clips
    };
}

async function ensurePart3Set(setKey, token = runtime.sessionToken) {
    if (!PART3_SET_KEYS.includes(setKey)) {
        throw new Error(`Unknown Part 3 set: ${setKey}`);
    }

    if (runtime.part3[setKey]) {
        return runtime.part3[setKey];
    }

    const existingJob = runtime.part3BuildJobs[setKey];
    if (existingJob && existingJob.token === token) {
        return existingJob.promise;
    }

    const promise = (async () => {
        const built = await buildPart3Set(setKey);
        if (runtime.sessionToken === token) {
            runtime.part3[setKey] = built;
        }
        return runtime.part3[setKey] || built;
    })();

    runtime.part3BuildJobs[setKey] = { token, promise };
    try {
        return await promise;
    } finally {
        const active = runtime.part3BuildJobs[setKey];
        if (active && active.promise === promise) {
            runtime.part3BuildJobs[setKey] = null;
        }
    }
}

function getUsedPexelsIds() {
    try {
        return JSON.parse(sessionStorage.getItem("af_pexels_used") || "[]");
    } catch { return []; }
}

function trackPexelsId(id) {
    const used = getUsedPexelsIds();
    if (!used.includes(id)) used.push(id);
    sessionStorage.setItem("af_pexels_used", JSON.stringify(used));
}

function getImageUsageMap() {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(IMAGE_USAGE_CACHE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
        return {};
    }
}

function setImageUsageMap(map) {
    try {
        sessionStorage.setItem(IMAGE_USAGE_CACHE_KEY, JSON.stringify(map || {}));
    } catch {
        // no-op
    }
}

function pickTrackedImage(pool, usageKey) {
    const items = Array.isArray(pool) ? pool.filter(Boolean) : [];
    if (!items.length) return null;

    const usageMap = getImageUsageMap();
    const used = Array.isArray(usageMap[usageKey]) ? usageMap[usageKey].filter((src) => items.includes(src)) : [];
    const available = items.filter((src) => !used.includes(src));

    let chosen;
    if (available.length) {
        chosen = randomPick(available);
    } else {
        const last = used[used.length - 1] || null;
        const withoutLast = items.filter((src) => src !== last);
        chosen = randomPick(withoutLast.length ? withoutLast : items);
    }

    const nextUsed = [...used.filter((src) => src !== chosen), chosen].slice(-Math.max(2, items.length));
    usageMap[usageKey] = nextUsed;
    setImageUsageMap(usageMap);
    return chosen;
}

async function ensurePicture(type) {
    // Priority 1: Pexels API (if key available)
    const pexelsKey = getSettings().apiKeys.pexels;
    if (pexelsKey) {
        try {
            const exclude = getUsedPexelsIds();
            const result = await searchPexels({ apiKey: pexelsKey, exclude, debugContext: { tab: "elp", type } });
            if (result?.url) {
                trackPexelsId(result.pexelsId);
                // Store attribution for later display
                if (!runtime.pexelsAttribution) runtime.pexelsAttribution = {};
                runtime.pexelsAttribution[result.url] = result;
                return result.url;
            }
        } catch (err) {
            debugLog("elp.ensurePicture", "Pexels search failed, falling back to local images.", {
                tab: "elp",
                type,
                error: err?.message || String(err)
            }, "warn");
        }
    }

    // Priority 2: Local images
    const defaultPool = type === "compare" ? DEFAULT_LOCAL_IMAGE_LIBRARY.compare : DEFAULT_LOCAL_IMAGE_LIBRARY.single;
    const preferred = await getKnownLocalImageKeys(defaultPool);
    const verified = await Promise.all(preferred.map(async (src) => ({ src, ok: await canLoadImage(src) })));
    const availableLocal = verified.filter((item) => item.ok).map((item) => item.src);
    if (availableLocal.length) {
        return pickTrackedImage(availableLocal, `local:${type}`) || randomPick(availableLocal);
    }

    // Priority 3: Remote fallback
    debugLog("elp.ensurePicture", "Local image pool unavailable, using remote fallback.", {
        tab: "elp",
        type,
        attempted: preferred
    }, "warn");
    return pickTrackedImage(REMOTE_IMAGE_FALLBACK, `remote:${type}`) || randomPick(REMOTE_IMAGE_FALLBACK);
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

async function recordCurrentDevAnswer() {
    if (!isRecordState()) {
        alert("Recording is only available in response states.");
        return;
    }

    const transcript = await recordAndTranscribe(getRecordLabelForState());
    const patch = buildTranscriptPatch(state, transcript);
    saveElpPatch(patch);
    renderMain(renderTranscriptPrompt(STATE_META[state]?.label || state, transcript, "Transcript captured for this step."));
}

/* ── State machine renderer ── */

async function runCurrentState(options = {}) {
    const executeDevAction = options.executeDevAction === true;
    const isDev = dev();
    debugLog("elp.runCurrentState", "Rendering state", { tab: "elp", state, isDev, executeDevAction });

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
            renderMain(`<h3>${isDev ? "Part 1 Picture" : "Describe This Scene"}</h3><img class="elp-picture" src="${picture}" alt="aviation scenario">${pexelsCredit(picture)}`);
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
            const progressLoader = createPart2ProgressLoader(root.querySelector("#elpContent"), "Generating listening story...");
            const progressTimer = setInterval(() => {
                progressLoader.update(runtime.storyProgress.sub1);
            }, 120);
            try {
                runtime.story.sub1 = await ensurePart2Story("sub1", runtime.sessionToken, {
                    onProgress: (progress) => progressLoader.update(progress)
                });
            } finally {
                clearInterval(progressTimer);
                progressLoader.remove();
            }
            if (isDev) {
                renderMain(`<h3>Part 2 Sub-part 1 (Play once)</h3><pre style="white-space:pre-wrap">${escapeHTML(runtime.story.sub1.script)}</pre><p class="hint">Use Play button once.</p>`);
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
                const transcript = getTodayElp()?.part2Sub1Transcript || "";
                if (executeDevAction) {
                    await recordCurrentDevAnswer();
                } else {
                    renderMain(renderTranscriptPrompt("Sub-part 1 Description", transcript, "Use the developer Record button to capture this response."));
                }
            } else {
                renderMain(`<h3>Describe What You Heard</h3><p>When you are ready, click the button below to start recording your answer.</p>`);
            }
            break;
        }

        case "PART2_SUB1_ANALYZE": {
            if (isDev) {
                if (!executeDevAction) {
                    renderMain(renderAnalysisDetails("Sub-part 1 Pinpoint Analysis", getTodayElp()?.part2Sub1Analysis, "Use the developer action button to analyze the saved transcript."));
                    break;
                }
            }
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Analyzing your response\u2026");
            const transcript = getTodayElp()?.part2Sub1Transcript || getTodayElp()?.lastTranscript?.transcript || "";
            const analysis = await analyzePart2("sub1", transcript);
            loader.remove();
            if (isDev) {
                renderMain(renderAnalysisDetails("Sub-part 1 Pinpoint Analysis", analysis, "No analysis result."));
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
            const progressLoader = createPart2ProgressLoader(root.querySelector("#elpContent"), "Generating story continuation...");
            const progressTimer = setInterval(() => {
                progressLoader.update(runtime.storyProgress.sub2);
            }, 120);
            try {
                runtime.story.sub2 = await ensurePart2Story("sub2", runtime.sessionToken, {
                    onProgress: (progress) => progressLoader.update(progress)
                });
            } finally {
                clearInterval(progressTimer);
                progressLoader.remove();
            }
            if (isDev) {
                renderMain(`<h3>Part 2 Sub-part 2 (Play once)</h3><pre style="white-space:pre-wrap">${escapeHTML(runtime.story.sub2.script)}</pre><p class="hint">Continuation with non-standard event handling.</p>`);
            } else {
                renderMain(`<h3>Story Continuation</h3><p class="hint">Press Play to listen to the continuation. You will hear it only once.</p>`);
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
                const transcript = getTodayElp()?.part2Sub2Transcript || "";
                if (executeDevAction) {
                    await recordCurrentDevAnswer();
                } else {
                    renderMain(renderTranscriptPrompt("Sub-part 2 Description", transcript, "Use the developer Record button to capture this response."));
                }
            } else {
                renderMain(`<h3>Describe What You Heard</h3><p>When you are ready, click the button below to start recording your answer.</p>`);
            }
            break;
        }

        case "PART2_SUB2_ANALYZE": {
            if (isDev) {
                if (!executeDevAction) {
                    renderMain(renderAnalysisDetails("Sub-part 2 Pinpoint Analysis", getTodayElp()?.part2Sub2Analysis, "Use the developer action button to analyze the saved transcript."));
                    break;
                }
            }
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Analyzing your response\u2026");
            const transcript = getTodayElp()?.part2Sub2Transcript || getTodayElp()?.lastTranscript?.transcript || "";
            const analysis = await analyzePart2("sub2", transcript);
            loader.remove();
            if (isDev) {
                renderMain(renderAnalysisDetails("Sub-part 2 Pinpoint Analysis", analysis, "No analysis result."));
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
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Generating communication recordings\u2026");
            const part3Set = await ensurePart3Set(key, runtime.sessionToken);
            loader.remove();
            const clips = part3Set?.clips || [];
            const lines = clips.map((clip) => part3ClipToPlainText(clip));
            if (isDev) {
                renderMain(`<h3>${state.replace("_", " ")}</h3><ol>${lines.map((line) => `<li>${escapeHTML(line)}</li>`).join("")}</ol><p class="hint">Set replay limit: 2 plays max each clip.</p>`);
            } else {
                renderMain(`<h3>Communication Set ${setNum}</h3><p>Listen to all three clips. Each clip can be played maximum 2 times. Then describe what you understood.</p>`);

                const area = root.querySelector("#elpActionArea");
                if (area) {
                    const renderPart3Controls = () => {
                        const playedAllOnce = clips.every((clip) => part3ClipPlayCount(clip.id) >= 1);

                        const rows = clips.map((clip, index) => {
                            const plays = part3ClipPlayCount(clip.id);
                            const disabled = !canPlayPart3Clip(clip, 2);
                            return `
                                <div class="part3-clip-row">
                                    <span class="part3-clip-label">Clip ${index + 1}</span>
                                    <button class="btn btn-secondary" data-clip="${clip.id}" ${disabled ? "disabled" : ""}>Play</button>
                                    <span class="hint">${plays}/2</span>
                                </div>
                            `;
                        }).join("");

                        area.innerHTML = `
                            <div class="part3-clip-controls">
                                ${rows}
                                <button id="part3Continue" class="btn btn-primary btn-lg" ${playedAllOnce ? "" : "disabled"}>Continue</button>
                                ${playedAllOnce ? "" : '<p class="hint">Play each clip at least once to continue.</p>'}
                            </div>
                        `;

                        area.querySelectorAll("[data-clip]").forEach((btn) => {
                            btn.addEventListener("click", async () => {
                                if (busy) return;
                                const clip = clips.find((c) => c.id === btn.dataset.clip);
                                if (!clip) return;
                                setBusy(true);
                                try {
                                    await playPart3Clip(clip, 2);
                                } catch (err) {
                                    alert(err.message);
                                } finally {
                                    setBusy(false);
                                    renderPart3Controls();
                                }
                            });
                        });

                        const continueBtn = area.querySelector("#part3Continue");
                        if (continueBtn) {
                            continueBtn.addEventListener("click", async () => {
                                if (busy) return;
                                await nextState();
                            });
                        }
                    };

                    renderPart3Controls();
                    saveElpPatch({ [key]: lines });
                    updateDevControls();
                    return;
                }
            }
            saveElpPatch({ [key]: lines });
            break;
        }

        case "PART3_SET1_DESCRIBE":
        case "PART3_SET2_DESCRIBE":
        case "PART3_SET3_DESCRIBE": {
            if (isDev) {
                const transcript = getTodayElp()?.lastTranscript?.state === state ? getTodayElp()?.lastTranscript?.transcript || "" : "";
                if (executeDevAction) {
                    await recordCurrentDevAnswer();
                } else {
                    renderMain(renderTranscriptPrompt(state, transcript, "Use the developer Record button to capture this answer.", "<p>No follow-up in Part 3 by design.</p>"));
                }
            } else {
                renderMain(`<h3>Describe What You Heard</h3><p>When you are ready, click the button below to start recording your answer about what you understood.</p>`);
            }
            break;
        }

        case "PART4_PICTURE1": {
            const loader = createLoadingOverlay(root.querySelector("#elpContent"), "Loading aviation image\u2026");
            const picture1 = await ensurePicture("single");
            const picture1Context = await getImageDescriptor(picture1, { debugContext: { tab: "elp", state: "PART4_PICTURE1" } });
            loader.remove();
            renderMain(`<h3>${isDev ? "Part 4 Picture 1" : "Study This Image"}</h3><img class="elp-picture" src="${picture1}" alt="aviation scenario">${pexelsCredit(picture1)}`);
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
                renderMain(`<h3>Part 4 Compare</h3><div class="elp-controls"><img class="elp-picture" src="${picture1}" alt="picture 1"><img class="elp-picture" src="${picture2}" alt="picture 2"></div>${pexelsCredit(picture1)}${pexelsCredit(picture2)}<p>Describe similarities and differences in operational context.</p>`);
            } else {
                renderMain(`<h3>Compare These Two Scenes</h3><div class="elp-compare"><img class="elp-picture" src="${picture1}" alt="picture 1"><img class="elp-picture" src="${picture2}" alt="picture 2"></div>${pexelsCredit(picture1)}${pexelsCredit(picture2)}`);
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
            if (isDev && !executeDevAction) {
                renderMain(renderScoreDetails(getTodayElp()?.scoring));
                break;
            }
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
                renderMain(renderScoreDetails(score));
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
    updateDevControls();
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
    for (const setKey of PART3_SET_KEYS) {
        const clips = runtime.part3[setKey]?.clips || [];
        clips.forEach((clip) => {
            if (clip?.audioSrc) {
                URL.revokeObjectURL(clip.audioSrc);
                clip.audioSrc = null;
            }
        });
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

            <div class="elp-layout">
                <nav class="elp-toc" id="elpToc"></nav>
                <div class="elp-main">
                    <div class="elp-progress" id="elpProgress"></div>
                    <div class="elp-state" id="elpState"></div>
                    <div class="elp-instruction" id="elpInstruction"></div>

                    <div id="elpContent"></div>

                    <div class="elp-action-area" id="elpActionArea"></div>

                    <div class="elp-dev-controls" id="elpDevControls">
                        <button id="elpStart" class="btn btn-primary">Start / Resume</button>
                        <button id="elpPrev" class="btn btn-secondary">Previous State</button>
                        <button id="elpNext" class="btn btn-secondary">Next State</button>
                        <button id="elpRecord" class="btn btn-secondary">Record Answer</button>
                        <button id="elpPlay" class="btn btn-secondary">Play Current Audio</button>
                    </div>

                    <audio id="elpAudio" controls></audio>
                    <div id="audioLog" class="audio-log hint"></div>
                </div>
            </div>
        </section>
    `;

    audioEl = root.querySelector("#elpAudio");
    playback = createPlaybackController(audioEl);
    recorder = createRecorder();
    updateModeClass();

    setState(getTodayElp()?.state || "IDLE");
    renderToc();

    root.querySelector("#elpRestart").addEventListener("click", () => {
        if (busy) return;
        if (state !== "IDLE" && !confirm("Restart ELP exam? Current progress will be cleared.")) return;
        cleanup();
        runtime.transcripts.length = 0;
        runtime.story.sub1 = null;
        runtime.story.sub2 = null;
        runtime.storyTokens.sub1 = 0;
        runtime.storyTokens.sub2 = 0;
        runtime.storyProgress.sub1 = null;
        runtime.storyProgress.sub2 = null;
        runtime.storyBuildJobs.sub1 = null;
        runtime.storyBuildJobs.sub2 = null;
        runtime.storyQueue = { token: runtime.sessionToken, promise: null };
        runtime.part3.set1 = null;
        runtime.part3.set2 = null;
        runtime.part3.set3 = null;
        runtime.part3BuildJobs.set1 = null;
        runtime.part3BuildJobs.set2 = null;
        runtime.part3BuildJobs.set3 = null;
        runtime.part3SpeechPlays = {};
        runtime.pexelsAttribution = {};
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
        try { await runCurrentState({ executeDevAction: isProcessState() }); } finally { setBusy(false); }
    });
    root.querySelector("#elpNext").addEventListener("click", nextState);
    root.querySelector("#elpPrev").addEventListener("click", previousState);
    root.querySelector("#elpRecord").addEventListener("click", async () => {
        if (busy) return;
        setBusy(true);
        try {
            await runCurrentState({ executeDevAction: true });
        } catch (err) { alert(`Recording failed: ${err.message}`); }
        finally { setBusy(false); }
    });
    root.querySelector("#elpPlay").addEventListener("click", playCurrentStory);

    initialized = true;
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
    if (!initialized) {
        setup();
        return;
    }

    const nextMode = dev() ? "dev" : "production";
    if (renderedMode !== nextMode) {
        updateModeClass();
    }
    updateDevControls();
    setState(getTodayElp()?.state || state || "IDLE");
    if (!root.querySelector("#elpContent")?.innerHTML?.trim()) {
        runCurrentState();
    }
}
