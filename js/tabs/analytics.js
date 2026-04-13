import { KEYS, getHistory, getPerformance } from "../storage.js";
import { debugLog } from "../debug.js";
import { formatDate, getTodayString } from "../utils.js";

let root;

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function scoreFromEntry(entry) {
    if (typeof entry?.percentage === "number") return entry.percentage;
    if (typeof entry?.overall === "number") return Math.max(0, Math.min(100, (entry.overall / 6) * 100));
    if (typeof entry?.isCorrect === "boolean") return entry.isCorrect ? 100 : 0;
    return null;
}

function byHour(entries) {
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0, scores: [] }));
    entries.forEach((entry) => {
        if (!entry?.timestamp) return;
        const date = new Date(entry.timestamp);
        if (Number.isNaN(date.getTime())) return;
        const hour = date.getHours();
        const bucket = buckets[hour];
        bucket.count += 1;
        const score = scoreFromEntry(entry);
        if (typeof score === "number") bucket.scores.push(score);
    });
    return buckets.map((bucket) => ({
        ...bucket,
        avgScore: avg(bucket.scores)
    }));
}

function renderHourlyChart(hourly) {
    const maxCount = Math.max(...hourly.map((x) => x.count), 1);
    return `
        <div class="chart-hourly">
            ${hourly.map((slot) => {
        const height = slot.count ? Math.max(8, Math.round((slot.count / maxCount) * 100)) : 4;
        return `
                    <div class="hour-col" title="${String(slot.hour).padStart(2, "0")}:00 • ${slot.count} entries • avg ${slot.avgScore.toFixed(1)}%">
                        <div class="hour-bar-wrap">
                            <div class="hour-bar" style="height:${height}%"></div>
                        </div>
                        <div class="hour-label">${String(slot.hour).padStart(2, "0")}</div>
                    </div>
                `;
    }).join("")}
        </div>
    `;
}

function renderTechBySubject(technical) {
    const map = {};
    technical.forEach((entry) => {
        if (!entry?.subject) return;
        if (!map[entry.subject]) {
            map[entry.subject] = { total: 0, correct: 0 };
        }
        map[entry.subject].total += 1;
        if (entry.isCorrect) map[entry.subject].correct += 1;
    });

    const rows = Object.entries(map)
        .map(([subject, stats]) => ({ subject, accuracy: (stats.correct / stats.total) * 100, total: stats.total }))
        .sort((a, b) => b.accuracy - a.accuracy);

    if (!rows.length) {
        return "<p class='hint'>No technical MC answers saved yet.</p>";
    }

    return `
        <div class="subject-bars">
            ${rows.map((row) => `
                <div class="subject-row">
                    <div class="subject-name">${row.subject}</div>
                    <div class="subject-bar-track">
                        <div class="subject-bar-fill" style="width:${row.accuracy.toFixed(1)}%"></div>
                    </div>
                    <div class="subject-value">${row.accuracy.toFixed(0)}% (${row.total})</div>
                </div>
            `).join("")}
        </div>
    `;
}

function getHistorySummary(day) {
    const parts = [];
    if (day.psychomotor?.examNumbers) parts.push("Psychomotor");
    if (day.technical?.questions?.length) parts.push(`Technical ${day.technical.questions.length * 2} prompts`);
    if (day.interview?.questions) parts.push("Interview");
    if (day.elp?.completedAt) parts.push(`ELP ${day.elp.scoring?.overall ?? "n/a"}`);
    return parts.length ? parts.join(" | ") : "No modules generated";
}

function renderHistory() {
    const history = getHistory();
    const dates = Object.keys(history).sort().reverse();
    if (!dates.length) return "<p class='hint'>No history yet.</p>";
    const today = getTodayString();
    return dates.map((date) => `
        <article class="history-item">
            <strong>${formatDate(date)} ${date === today ? "(Today)" : ""}</strong>
            <p>${getHistorySummary(history[date])}</p>
        </article>
    `).join("");
}

function render() {
    const psych = getPerformance(KEYS.performance);
    const technical = getPerformance(KEYS.technicalPerformance);
    const elp = getPerformance(KEYS.elpPerformance);
    const interview = getPerformance(KEYS.interviewPerformance);

    const all = [...psych, ...technical, ...elp, ...interview];
    const hourly = byHour(all);

    const psychAvg = avg(psych.map((x) => x.percentage ?? 0));
    const techAvg = avg(technical.map((x) => (x.isCorrect ? 100 : 0)));
    const elpAvg = avg(elp.map((x) => x.overall ?? 0));
    debugLog("analytics.render", "Rendered analytics tab", {
        tab: "analytics",
        psychCount: psych.length,
        technicalCount: technical.length,
        elpCount: elp.length,
        interviewCount: interview.length
    });

    root.innerHTML = `
        <section class="card">
            <h2>Analytics</h2>
            <p class="hint">Hourly distribution and progress across all modules.</p>

            <div class="analytics-kpis">
                <div class="analytics-row">
                    <div class="analytics-metric">Psychomotor Avg: ${psychAvg.toFixed(1)}%</div>
                    <small>${psych.length} saved attempts</small>
                </div>
                <div class="analytics-row">
                    <div class="analytics-metric">Technical MC Accuracy: ${techAvg.toFixed(1)}%</div>
                    <small>${technical.length} marked answers</small>
                </div>
                <div class="analytics-row">
                    <div class="analytics-metric">ELP Overall Avg: ${elpAvg.toFixed(2)}</div>
                    <small>${elp.length} completed sessions</small>
                </div>
                <div class="analytics-row">
                    <div class="analytics-metric">Interview Sessions: ${interview.length}</div>
                    <small>saved note batches</small>
                </div>
            </div>
        </section>

        <section class="card">
            <h3>Hourly Activity</h3>
            <p class="hint">Bars show number of saved actions per local hour (00-23).</p>
            ${renderHourlyChart(hourly)}
        </section>

        <section class="card">
            <h3>Technical Accuracy by Subject</h3>
            ${renderTechBySubject(technical)}
        </section>

        <section class="card history-card">
            <h3>History</h3>
            <div class="history-list">${renderHistory()}</div>
        </section>
    `;
}

export function init(container) {
    root = container;
    render();
}

export function generate() {
    // no-op
}

export function loadToday() {
    render();
}
