import { askClaude } from "../api.js";
import { debugLog } from "../debug.js";
import { KEYS, addPerformance, getHistory, getSettings, upsertDay } from "../storage.js";
import { createLoadingOverlay, escapeHTML, getTodayString, isDevMode } from "../utils.js";

function getOfflineHint() {
    const key = getSettings().apiKeys.anthropic;
    return key ? "" : `<div class="elp-offline-banner"><strong>Offline mode</strong> \u2014 no Anthropic API key configured. Questions will use a static fallback set. Add your key in Settings for AI-generated questions.</div>`;
}

let root;
let onDataUpdated;

const FALLBACK = {
    technical: [
        "Explain your decision path for a go-around in unstable approach conditions.",
        "How do you prioritize ECAM/EICAS messages during high workload phases?",
        "Describe how you would brief an alternate strategy when destination weather degrades."
    ],
    hr: [
        "Tell me about a time you challenged a decision for safety reasons.",
        "How do you handle conflict inside a multicultural cockpit team?",
        "Why do you want to join this airline and where do you see yourself in 5 years?"
    ],
    sample: "Use STAR structure: situation, task, action, result. Tie it to safety and CRM."
};

function getTodayInterview() {
    const day = getHistory()[getTodayString()] || {};
    return day.interview || null;
}

function parseJSON(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
        return JSON.parse(match[0]);
    } catch {
        return null;
    }
}

async function generateQuestions() {
    const key = getSettings().apiKeys.anthropic;
    if (!key) {
        debugLog("interview.generateQuestions", "Missing Anthropic key, using fallback.", { tab: "interview" }, "warn");
        return FALLBACK;
    }

    try {
        const prompt = `Generate 6 airline cadet interview questions: 3 technical and 3 HR. Return JSON format {"technical":[...],"hr":[...],"sample":"short answer framework"}. Technical scope: systems/procedures/regulations. HR scope: motivation/teamwork/stress/decisions/conflict/career goals.`;
        debugLog("interview.generateQuestions", "Sending generation request", { tab: "interview", prompt });
        const text = await askClaude({
            apiKey: key,
            prompt,
            maxTokens: 900,
            temperature: 0.3,
            debugContext: { tab: "interview", operation: "generateQuestions" }
        });
        const parsed = parseJSON(text);
        if (!parsed?.technical || !parsed?.hr) {
            throw new Error("Invalid interview payload");
        }
        debugLog("interview.generateQuestions", "Interview payload parsed", {
            tab: "interview",
            technicalCount: parsed.technical.length || 0,
            hrCount: parsed.hr.length || 0
        });
        return parsed;
    } catch (err) {
        console.error(err);
        alert(`Interview generation used fallback: ${err.message}`);
        debugLog("interview.generateQuestions", "Fallback after error", {
            tab: "interview",
            error: err?.message || String(err)
        }, "error");
        return FALLBACK;
    }
}

function saveNotes(notesByIndex) {
    const date = getTodayString();
    upsertDay(date, (day) => {
        const interview = day.interview || {};
        return {
            interview: {
                ...interview,
                notes: notesByIndex,
                savedAt: new Date().toISOString()
            }
        };
    });

    addPerformance(KEYS.interviewPerformance, {
        tab: "interview",
        date,
        questionCount: Object.keys(notesByIndex).length,
        timestamp: new Date().toISOString()
    });
    debugLog("interview.saveNotes", "Saved interview notes", {
        tab: "interview",
        noteCount: Object.keys(notesByIndex).length
    });
    onDataUpdated();
}

function renderCards(data) {
    if (!data?.questions) {
        root.querySelector(".interview-grid").innerHTML = "<p class='hint'>No interview set generated for today.</p>";
        return;
    }

    const all = [
        ...data.questions.technical.map((q) => ({ type: "Technical", question: q })),
        ...data.questions.hr.map((q) => ({ type: "HR", question: q }))
    ];

    root.querySelector(".interview-grid").innerHTML = all.map((item, idx) => {
        const note = data.notes?.[idx] || "";
        return `
            <article class="interview-card" data-idx="${idx}">
                <small>${escapeHTML(item.type)}</small>
                <h3>${escapeHTML(item.question)}</h3>
                <textarea rows="5" placeholder="Your answer notes">${escapeHTML(note)}</textarea>
                <div class="elp-controls">
                    <button class="btn btn-secondary sample-toggle">Sample Answer</button>
                </div>
                <div class="sample-answer" hidden>${escapeHTML(data.questions.sample || FALLBACK.sample)}</div>
            </article>
        `;
    }).join("");

    root.querySelectorAll(".sample-toggle").forEach((btn) => {
        btn.addEventListener("click", () => {
            const panel = btn.closest(".interview-card").querySelector(".sample-answer");
            panel.hidden = !panel.hidden;
        });
    });
}

function render() {
    renderCards(getTodayInterview());
}

function setup() {
    root.innerHTML = `
        <section class="card">
            <h2>Interview Prep (Airline Cadet Pilot)</h2>
            <p class="hint">Session contains 3 technical + 3 HR questions. You can store answer notes and reveal sample framework.</p>
            ${getOfflineHint()}
            <div class="elp-controls">
                <button id="interviewGenerate" class="btn btn-primary">Generate Interview Session</button>
                <button id="interviewSave" class="btn btn-secondary">Save Notes</button>
                ${isDevMode() ? `<button id="interviewClear" class="btn btn-danger">Clear Today's Interview</button>` : ""}
            </div>
            <div class="interview-grid"></div>
        </section>
    `;

    if (isDevMode()) {
        root.querySelector("#interviewClear").addEventListener("click", () => {
            if (!confirm("Clear today's interview questions and notes?")) return;
            upsertDay(getTodayString(), () => ({ interview: null }));
            render();
            onDataUpdated();
        });
    }

    root.querySelector("#interviewGenerate").addEventListener("click", async () => {
        const today = getTodayString();
        const button = root.querySelector("#interviewGenerate");
        button.disabled = true;
        const loader = createLoadingOverlay(root, "Generating interview questions\u2026");

        try {
            const questions = await generateQuestions();
            upsertDay(today, (day) => ({
                interview: {
                    questions,
                    notes: day.interview?.notes || {},
                    generatedAt: new Date().toISOString()
                }
            }));
            render();
            onDataUpdated();
        } finally {
            loader.remove();
            button.disabled = false;
        }
    });

    root.querySelector("#interviewSave").addEventListener("click", () => {
        const notes = {};
        root.querySelectorAll(".interview-card").forEach((card) => {
            const idx = Number(card.dataset.idx);
            notes[idx] = card.querySelector("textarea").value.trim();
        });
        saveNotes(notes);
        root.querySelector("#interviewSave").textContent = "Saved";
        setTimeout(() => {
            root.querySelector("#interviewSave").textContent = "Save Notes";
        }, 1200);
    });

    render();
}

export function init(container, deps) {
    root = container;
    onDataUpdated = deps.onDataUpdated;
    setup();
}

export async function generate() {
    if (getTodayInterview()?.questions) return;
    const today = getTodayString();
    const button = root.querySelector("#interviewGenerate");
    button.disabled = true;
    const loader = createLoadingOverlay(root, "Generating interview questions\u2026");
    try {
        const questions = await generateQuestions();
        upsertDay(today, (day) => ({
            interview: {
                questions,
                notes: day.interview?.notes || {},
                generatedAt: new Date().toISOString()
            }
        }));
        render();
        onDataUpdated();
    } finally {
        loader.remove();
        button.disabled = false;
    }
}

export function loadToday() {
    render();
}
