import { KEYS, getPerformance } from "./storage.js";

function avg(values) {
    if (!values.length) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function renderAnalytics(container) {
    const psych = getPerformance(KEYS.performance);
    const technical = getPerformance(KEYS.technicalPerformance);
    const elp = getPerformance(KEYS.elpPerformance);
    const interview = getPerformance(KEYS.interviewPerformance);

    const psychAvg = avg(psych.map((x) => x.percentage ?? 0));
    const technicalAvg = avg(technical.map((x) => (x.isCorrect ? 100 : 0)));
    const elpAvg = avg(elp.map((x) => x.overall ?? 0));
    const interviewCount = interview.length;

    container.innerHTML = `
        <div class="analytics-row">
            <div class="analytics-metric">Psychomotor Average: ${psychAvg.toFixed(1)}%</div>
            <small>${psych.length} saved attempts</small>
        </div>
        <div class="analytics-row">
            <div class="analytics-metric">Technical MC Accuracy: ${technicalAvg.toFixed(1)}%</div>
            <small>${technical.length} marked MC answers</small>
        </div>
        <div class="analytics-row">
            <div class="analytics-metric">ELP Overall (ICAO scale proxy): ${elpAvg.toFixed(2)}</div>
            <small>${elp.length} completed ELP sessions</small>
        </div>
        <div class="analytics-row">
            <div class="analytics-metric">Interview Sessions: ${interviewCount}</div>
            <small>Saved HR/technical preparation sets</small>
        </div>
    `;
}