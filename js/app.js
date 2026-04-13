import { ensureMigration, KEYS } from "./storage.js";
import { ACCESS_PASSWORD, createLoadingOverlay, escapeHTML, formatDate, getTodayString, isDevMode } from "./utils.js";
import { clearDebugLogs, subscribeDebugLogs } from "./debug.js";
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

function formatDebugEntry(entry) {
    const details = entry.details ? JSON.stringify(entry.details, null, 2) : "";
    return [
        `[${entry.timestamp}] [${entry.level}] [${entry.tab}] [${entry.source}] ${entry.message}`,
        details
    ].filter(Boolean).join("\n");
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
    const scopedLogs = getScopedLogs();
    const content = scopedLogs.length
        ? scopedLogs.map(formatDebugEntry).join("\n\n----------------------------------------\n\n")
        : "No debug logs yet.";

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
                    <button id="debugClearBtn" class="btn btn-secondary">Clear Logs</button>
                </div>
            </div>
            <pre class="debug-pre">${escapeHTML(content)}</pre>
        </section>
    `;

    panel.querySelector("#debugClearBtn")?.addEventListener("click", () => clearDebugLogs());
    panel.querySelector("#debugScopeSelect")?.addEventListener("change", (event) => {
        debugScope = event.target.value;
        renderDebugPanel();
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

document.addEventListener("DOMContentLoaded", () => {
    ensureMigration();
    setupPasswordGate();
});
