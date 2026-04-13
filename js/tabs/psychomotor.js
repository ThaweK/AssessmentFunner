import { KEYS, addPerformance, getHistory, upsertDay } from "../storage.js";
import { debugLog } from "../debug.js";
import { getTodayString, isDevMode, nowTimeLabel, uniqueRandomIntegers } from "../utils.js";

const EXAM_CONFIG = {
    aptitude: { pick: 4, total: 8, label: "Aptitude Tests" },
    deductive: { pick: 1, total: 3, label: "Deductive Test" },
    inductiveThinking: { pick: 1, total: 2, label: "Inductive Logical Thinking" },
    inductiveReasoning: { pick: 2, total: 4, label: "Inductive Logical Reasoning" },
    knowledge: { pick: 1, total: 5, label: "Knowledge Tests" },
    englishAudio: { pick: 1, total: 8, label: "English Audio Tests" },
    completeSentence: { pick: 6, total: 60, label: "Complete the Sentence" },
    englishGrammar: { pick: 4, total: 19, label: "English Grammar" },
    englishVocabulary: { pick: 4, total: 36, label: "English Vocabulary" }
};

let root;
let onDataUpdated;

function usedNumbers(category) {
    const history = getHistory();
    const used = [];
    for (const day of Object.values(history)) {
        const values = day.psychomotor?.examNumbers?.[category] || day.examNumbers?.[category];
        if (values) {
            used.push(...values);
        }
    }
    return used;
}

function generateNumbers() {
    const examNumbers = {};
    for (const [category, config] of Object.entries(EXAM_CONFIG)) {
        examNumbers[category] = uniqueRandomIntegers(config.pick, config.total, usedNumbers(category));
    }
    debugLog("psychomotor.generateNumbers", "Generated psychomotor set", {
        tab: "psychomotor",
        examNumbers
    });
    return examNumbers;
}

function saveScore(category, examNo, value) {
    const today = getTodayString();
    upsertDay(today, (day) => {
        const psych = day.psychomotor || { examNumbers: null, scores: {} };
        const scores = { ...(psych.scores || {}) };
        const byCategory = { ...(scores[category] || {}) };
        byCategory[examNo] = {
            percentage: value,
            timeOfDay: nowTimeLabel(),
            savedAt: new Date().toISOString()
        };
        scores[category] = byCategory;
        return { psychomotor: { ...psych, scores } };
    });

    addPerformance(KEYS.performance, {
        tab: "psychomotor",
        category,
        examNumber: examNo,
        percentage: value,
        date: today,
        timeOfDay: nowTimeLabel(),
        timestamp: new Date().toISOString()
    });

    debugLog("psychomotor.saveScore", "Saved score", {
        tab: "psychomotor",
        category,
        examNo,
        value
    });
    onDataUpdated();
}

function renderGrid(data) {
    const numbers = data?.examNumbers;
    const scores = data?.scores || {};

    if (!numbers) {
        root.querySelector(".pm-grid").innerHTML = "<p class=\"hint\">No psychomotor set generated for today.</p>";
        return;
    }

    root.querySelector(".pm-grid").innerHTML = Object.entries(EXAM_CONFIG).map(([category, cfg]) => {
        const nums = numbers[category] || [];
        const rows = nums.map((examNo) => {
            const existing = scores?.[category]?.[examNo]?.percentage;
            return `
                <div class="pm-score-row" data-category="${category}" data-exam="${examNo}">
                    <span>#${examNo}</span>
                    <input type="number" min="0" max="100" value="${existing ?? ""}" placeholder="score %">
                    <button class="btn btn-secondary pm-save">Save</button>
                </div>
            `;
        }).join("");

        return `
            <article class="pm-item">
                <div class="pm-label">${cfg.label} (${cfg.pick}/${cfg.total})</div>
                <div class="pm-num">${nums.join(", ")}</div>
                ${rows}
            </article>
        `;
    }).join("");

    root.querySelectorAll(".pm-save").forEach((btn) => {
        btn.addEventListener("click", () => {
            const row = btn.closest(".pm-score-row");
            const category = row.dataset.category;
            const examNo = Number(row.dataset.exam);
            const input = row.querySelector("input");
            const value = Number(input.value);
            if (Number.isNaN(value) || value < 0 || value > 100) {
                alert("Enter score between 0 and 100.");
                return;
            }
            saveScore(category, examNo, value);
            btn.textContent = "Saved";
        });
    });
}

function getTodayData() {
    const day = getHistory()[getTodayString()] || {};
    return day.psychomotor || null;
}

function render() {
    renderGrid(getTodayData());
}

function setup() {
    root.innerHTML = `
        <section class="card">
            <h2>Psychomotor</h2>
            <p class="hint">Same 9 practical categories and scoring model. Only the tab name changed.</p>
            <div class="elp-controls">
                <button id="pmGenerate" class="btn btn-primary">Generate Psychomotor Set</button>
                <button id="pmLoad" class="btn btn-secondary">Load Today's Set</button>
                ${isDevMode() ? `<button id="pmClear" class="btn btn-danger">Clear Today's Psychomotor</button>` : ""}
            </div>
            <div class="pm-grid"></div>
        </section>
    `;

    if (isDevMode()) {
        root.querySelector("#pmClear").addEventListener("click", () => {
            if (!confirm("Clear today's psychomotor set and scores?")) return;
            upsertDay(getTodayString(), () => ({ psychomotor: null }));
            render();
            onDataUpdated();
        });
    }

    root.querySelector("#pmGenerate").addEventListener("click", () => {
        const today = getTodayString();
        const existing = getTodayData();
        if (existing?.examNumbers) {
            debugLog("psychomotor.ui", "Generate clicked with existing set", {
                tab: "psychomotor",
                existing: true
            }, "warn");
            render();
            return;
        }

        upsertDay(today, (day) => ({
            psychomotor: {
                examNumbers: generateNumbers(),
                scores: day.psychomotor?.scores || {}
            }
        }));
        render();
        debugLog("psychomotor.ui", "Generated today's psychomotor set", { tab: "psychomotor", today });
        onDataUpdated();
    });

    root.querySelector("#pmLoad").addEventListener("click", () => render());
    render();
}

export function init(container, deps) {
    root = container;
    onDataUpdated = deps.onDataUpdated;
    setup();
}

export function generate() {
    const today = getTodayString();
    if (getTodayData()?.examNumbers) {
        return;
    }
    upsertDay(today, () => ({ psychomotor: { examNumbers: generateNumbers(), scores: {} } }));
    render();
}

export function loadToday() {
    render();
}
