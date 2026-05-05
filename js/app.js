import { applyLocalApiKeys, ensureMigration, KEYS } from "./storage.js";
import { ACCESS_PASSWORD, createLoadingOverlay, escapeHTML, formatDate, getTodayString, isDevMode } from "./utils.js";
import { buildDebugLogBundle, clearDebugLogs, debugLog, formatDebugLogBundle, getAppRuntimeVersion, subscribeDebugLogs } from "./debug.js";
import * as psychomotorTab from "./tabs/psychomotor.js";
import * as technicalTab from "./tabs/technical.js";
import * as elpTab from "./tabs/elp.js";
import * as interviewTab from "./tabs/interview.js";
import * as analyticsTab from "./tabs/analytics.js";
import * as settingsTab from "./tabs/settings.js";

const PASSWORD_KEY = KEYS.oldAuth;
let cachedLogs = [];
let currentTab = "psychomotor";
let debugScope = "active";
let selectedDebugLogId = null;

const tabs = {
    psychomotor: psychomotorTab,
    technical: technicalTab,
    elp: elpTab,
    interview: interviewTab,
    analytics: analyticsTab,
    settings: settingsTab
};

function activateTab(name) {
    currentTab = name;
    document.querySelectorAll(".tab-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.toggle("active", panel.id === `tab-${name}`);
    });
    renderDebugPanel();
}

function refreshDerivedViews() {
    tabs.analytics.loadToday();
    renderDebugPanel();
}

function formatDebugTimestamp(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleString();
}

function formatDebugPreview(entry) {
    const details = entry.details ? JSON.stringify(entry.details) : "";
    return [entry.message, details].filter(Boolean).join(" ").slice(0, 140);
}

function getOrderedScopedLogs() {
    return [...getScopedLogs()].reverse();
}

function getSelectedDebugEntry(scopedLogs) {
    if (!scopedLogs.length) {
        selectedDebugLogId = null;
        return null;
    }

    const selected = scopedLogs.find((entry) => entry.id === selectedDebugLogId);
    if (selected) {
        return selected;
    }

    selectedDebugLogId = scopedLogs[0].id;
    return scopedLogs[0];
}

function getScopedLogs() {
    if (debugScope === "all") return cachedLogs;
    if (debugScope === "active") return cachedLogs.filter((entry) => entry.tab === currentTab);
    return cachedLogs.filter((entry) => entry.tab === debugScope);
}

function renderDebugPanel() {
    const panel = document.getElementById("debugPanel");
    if (!panel) return;
    if (!isDevMode()) {
        panel.hidden = true;
        panel.innerHTML = "";
        return;
    }

    panel.hidden = false;
    const scopedLogs = getOrderedScopedLogs();
    const selectedEntry = getSelectedDebugEntry(scopedLogs);
    const appVersion = getAppRuntimeVersion();
    const detailContent = selectedEntry?.details
        ? JSON.stringify(selectedEntry.details, null, 2)
        : "No detail payload for this log entry.";
    const tocContent = scopedLogs.length
        ? scopedLogs.map((entry, index) => `
            <button
                type="button"
                class="debug-toc-item${entry.id === selectedEntry?.id ? " active" : ""}"
                data-debug-log-id="${entry.id}"
                title="${escapeHTML(entry.message)}"
            >
                <span class="debug-toc-index">#${scopedLogs.length - index}</span>
                <span class="debug-toc-main">
                    <span class="debug-toc-message">${escapeHTML(entry.message)}</span>
                    <span class="debug-toc-meta">${escapeHTML(formatDebugTimestamp(entry.timestamp))} | ${escapeHTML(entry.source)} | ${escapeHTML(entry.level.toUpperCase())}</span>
                    <span class="debug-toc-preview">${escapeHTML(formatDebugPreview(entry))}</span>
                </span>
            </button>
        `).join("")
        : `<div class="debug-empty">No debug logs yet.</div>`;

    panel.innerHTML = `
        <section class="card debug-card">
            <div class="debug-header">
                <h2>Developer Logs</h2>
                <div class="debug-controls">
                    <label for="debugScopeSelect">Scope</label>
                    <select id="debugScopeSelect">
                        <option value="active"${debugScope === "active" ? " selected" : ""}>Active Tab (${currentTab})</option>
                        <option value="all"${debugScope === "all" ? " selected" : ""}>All Tabs</option>
                        <option value="psychomotor"${debugScope === "psychomotor" ? " selected" : ""}>Psychomotor</option>
                        <option value="technical"${debugScope === "technical" ? " selected" : ""}>Technical</option>
                        <option value="elp"${debugScope === "elp" ? " selected" : ""}>ELP</option>
                        <option value="interview"${debugScope === "interview" ? " selected" : ""}>Interview</option>
                        <option value="analytics"${debugScope === "analytics" ? " selected" : ""}>Analytics</option>
                        <option value="settings"${debugScope === "settings" ? " selected" : ""}>Settings</option>
                        <option value="api"${debugScope === "api" ? " selected" : ""}>API</option>
                    </select>
                    <button id="debugExportBtn" class="btn btn-secondary">Export Logs (.log)</button>
                    <button id="debugClearBtn" class="btn btn-secondary">Clear Logs</button>
                </div>
            </div>
            <div class="hint">Runtime version: ${escapeHTML(appVersion)}</div>
            <div class="debug-layout">
                <aside class="debug-toc">
                    <div class="debug-toc-summary">${scopedLogs.length} entr${scopedLogs.length === 1 ? "y" : "ies"}</div>
                    <div class="debug-toc-list">${tocContent}</div>
                </aside>
                <section class="debug-detail">
                    ${selectedEntry ? `
                        <div class="debug-detail-header">
                            <div class="debug-detail-badges">
                                <span class="debug-badge">${escapeHTML(selectedEntry.tab)}</span>
                                <span class="debug-badge">${escapeHTML(selectedEntry.level.toUpperCase())}</span>
                                <span class="debug-badge">${escapeHTML(selectedEntry.source)}</span>
                            </div>
                            <div class="debug-detail-time">${escapeHTML(formatDebugTimestamp(selectedEntry.timestamp))}</div>
                        </div>
                        <h3 class="debug-detail-title">${escapeHTML(selectedEntry.message)}</h3>
                        <pre class="debug-pre">${escapeHTML(detailContent)}</pre>
                    ` : `
                        <div class="debug-empty">Select a log entry to inspect its details.</div>
                    `}
                </section>
            </div>
        </section>
    `;

    panel.querySelector("#debugClearBtn")?.addEventListener("click", () => clearDebugLogs());
    panel.querySelector("#debugExportBtn")?.addEventListener("click", () => {
        const bundle = buildDebugLogBundle({
            logsSnapshot: scopedLogs,
            allLogsSnapshot: cachedLogs,
            totalLogs: cachedLogs.length,
            scope: debugScope,
            activeTab: currentTab,
            debugScope
        });
        const output = formatDebugLogBundle(bundle);
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `assessmentfunner-debug-${stamp}.log`;
        const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    });
    panel.querySelector("#debugScopeSelect")?.addEventListener("change", (event) => {
        debugScope = event.target.value;
        selectedDebugLogId = null;
        renderDebugPanel();
    });
    panel.querySelectorAll("[data-debug-log-id]").forEach((button) => {
        button.addEventListener("click", () => {
            selectedDebugLogId = button.dataset.debugLogId;
            renderDebugPanel();
        });
    });
}

function initTabs() {
    const deps = { onDataUpdated: refreshDerivedViews };
    tabs.psychomotor.init(document.getElementById("tab-psychomotor"), deps);
    tabs.technical.init(document.getElementById("tab-technical"), deps);
    tabs.elp.init(document.getElementById("tab-elp"), deps);
    tabs.interview.init(document.getElementById("tab-interview"), deps);
    tabs.analytics.init(document.getElementById("tab-analytics"), deps);
    tabs.settings.init(document.getElementById("tab-settings"), deps);
}

function setupNavigation() {
    document.querySelectorAll(".tab-btn").forEach((button) => {
        button.addEventListener("click", () => {
            activateTab(button.dataset.tab);
            tabs[button.dataset.tab]?.loadToday?.();
        });
    });
}

function setupGenerateAll() {
    document.getElementById("runDailyAll").addEventListener("click", async () => {
        const btn = document.getElementById("runDailyAll");
        btn.disabled = true;
        const loader = createLoadingOverlay(document.querySelector("main"), "Generating across all tabs\u2026");
        try {
            tabs.psychomotor.generate();
            await tabs.technical.generate();
            await tabs.interview.generate();
            tabs.elp.generate();
        } finally {
            loader.remove();
            btn.disabled = false;
            refreshDerivedViews();
        }
    });
}

function checkPassword() {
    const input = document.getElementById("passwordInput");
    const error = document.getElementById("passwordError");

    if (input.value === ACCESS_PASSWORD) {
        sessionStorage.setItem(PASSWORD_KEY, "true");
        document.getElementById("passwordGate").style.display = "none";
        document.getElementById("app").hidden = false;
        boot();
    } else {
        error.textContent = "Incorrect password.";
        input.value = "";
    }
}

function setupPasswordGate() {
    const gate = document.getElementById("passwordGate");
    if (sessionStorage.getItem(PASSWORD_KEY) === "true") {
        gate.style.display = "none";
        document.getElementById("app").hidden = false;
        boot();
        return;
    }

    gate.style.display = "flex";
    document.getElementById("passwordSubmit").addEventListener("click", checkPassword);
    document.getElementById("passwordInput").addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            checkPassword();
        }
    });
}

function boot() {
    document.getElementById("currentDate").textContent = formatDate(getTodayString());
    debugLog("app.boot", "Application boot", {
        tab: "app",
        appVersion: getAppRuntimeVersion(),
        url: window.location.href,
        userAgent: navigator.userAgent
    });
    subscribeDebugLogs((logs) => {
        cachedLogs = logs;
        renderDebugPanel();
    });
    initTabs();
    setupNavigation();
    setupGenerateAll();
    refreshDerivedViews();
    activateTab("psychomotor");
}

async function preloadLocalApiKeys() {
    try {
        const response = await fetch("./local-secrets.json", { cache: "no-store" });
        if (!response.ok) {
            return;
        }

        const payload = await response.json();
        if (!payload || typeof payload !== "object") {
            return;
        }

        const changed = applyLocalApiKeys(payload);
        if (changed) {
            debugLog("app.preloadLocalApiKeys", "Loaded local API keys from local-secrets.json", {
                tab: "app",
                providers: Object.keys(payload).filter((key) => Boolean(payload[key]))
            });
        }
    } catch {
        // Local secrets file is optional for local-only launches.
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    ensureMigration();
    await preloadLocalApiKeys();
    setupPasswordGate();
});
