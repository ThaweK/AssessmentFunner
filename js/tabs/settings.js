import { smokeTestProvider } from "../api.js";
import { debugLog } from "../debug.js";
import { exportData, importData } from "../data-transfer.js";
import { clearAllData, ensureMigration, getSettings, saveSettings } from "../storage.js";

let root;
let onDataUpdated;

function mask(value) {
    if (!value) return "";
    if (value.length < 8) return "*".repeat(value.length);
    return `${value.slice(0, 4)}${"*".repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`;
}

function render() {
    const settings = getSettings();
    root.querySelector("#anthropicMasked").value = mask(settings.apiKeys.anthropic);
    root.querySelector("#openaiMasked").value = mask(settings.apiKeys.openai);
    root.querySelector("#elevenMasked").value = mask(settings.apiKeys.elevenlabs);

    const status = [];
    if (settings.sync.lastExportAt) status.push(`Last export: ${new Date(settings.sync.lastExportAt).toLocaleString()}`);
    if (settings.sync.lastImportAt) status.push(`Last import: ${new Date(settings.sync.lastImportAt).toLocaleString()}`);
    root.querySelector("#syncStatus").textContent = status.join(" | ") || "No transfer events yet.";

    const devToggle = root.querySelector("#devModeToggle");
    if (devToggle) devToggle.checked = settings.devMode || false;
}

function saveKey(name, inputSelector) {
    const settings = getSettings();
    const value = root.querySelector(inputSelector).value.trim();
    if (!value) {
        return;
    }
    settings.apiKeys[name] = value;
    saveSettings(settings);
    debugLog("settings.saveKey", "Saved API key", { tab: "settings", provider: name });
    render();
    onDataUpdated();
}

function setup() {
    root.innerHTML = `
        <section class="card settings-grid">
            <article class="settings-card">
                <h3>Anthropic (Claude)</h3>
                <input id="anthropicMasked" readonly>
                <div class="key-row">
                    <input id="anthropicInput" type="password" placeholder="Paste Anthropic API key" autocomplete="off">
                    <button id="saveAnthropic" class="btn btn-secondary">Save</button>
                    <button id="testAnthropic" class="btn btn-secondary">Test</button>
                </div>
                <small id="anthropicStatus"></small>
            </article>

            <article class="settings-card">
                <h3>OpenAI (Whisper STT)</h3>
                <input id="openaiMasked" readonly>
                <div class="key-row">
                    <input id="openaiInput" type="password" placeholder="Paste OpenAI API key" autocomplete="off">
                    <button id="saveOpenai" class="btn btn-secondary">Save</button>
                    <button id="testOpenai" class="btn btn-secondary">Test</button>
                </div>
                <small id="openaiStatus"></small>
            </article>

            <article class="settings-card">
                <h3>ElevenLabs (TTS)</h3>
                <input id="elevenMasked" readonly>
                <div class="key-row">
                    <input id="elevenInput" type="password" placeholder="Paste ElevenLabs API key" autocomplete="off">
                    <button id="saveEleven" class="btn btn-secondary">Save</button>
                    <button id="testEleven" class="btn btn-secondary">Test</button>
                </div>
                <small id="elevenStatus"></small>
            </article>

            <article class="settings-card">
                <h3>Data Sync (Manual JSON)</h3>
                <p id="syncStatus" class="hint"></p>
                <div class="elp-controls">
                    <button id="exportBtn" class="btn btn-primary">Export JSON</button>
                    <input id="importFile" class="file-input" type="file" accept="application/json">
                    <button id="importBtn" class="btn btn-secondary">Import + Merge</button>
                </div>
            </article>

            <article class="settings-card">
                <h3>Data Management</h3>
                <p class="hint">Reset clears both old and new keys.</p>
                <button id="resetAll" class="btn btn-danger">Reset All Data</button>
            </article>

            <article class="settings-card">
                <h3>Developer Mode</h3>
                <p class="hint">Shows debug controls, raw state labels, transcripts, and analysis data in the ELP tab.</p>
                <label class="dev-toggle-label">
                    <input type="checkbox" id="devModeToggle">
                    Enable Developer Mode
                </label>
            </article>
        </section>
    `;

    root.querySelector("#saveAnthropic").addEventListener("click", () => saveKey("anthropic", "#anthropicInput"));
    root.querySelector("#saveOpenai").addEventListener("click", () => saveKey("openai", "#openaiInput"));
    root.querySelector("#saveEleven").addEventListener("click", () => saveKey("elevenlabs", "#elevenInput"));

    root.querySelector("#testAnthropic").addEventListener("click", async () => {
        const status = root.querySelector("#anthropicStatus");
        try {
            status.textContent = await smokeTestProvider({ provider: "anthropic", apiKey: getSettings().apiKeys.anthropic });
            status.className = "status-ok";
        } catch (err) {
            status.textContent = err.message;
            status.className = "status-bad";
        }
    });

    root.querySelector("#testOpenai").addEventListener("click", async () => {
        const status = root.querySelector("#openaiStatus");
        try {
            status.textContent = await smokeTestProvider({ provider: "openai", apiKey: getSettings().apiKeys.openai });
            status.className = "status-ok";
        } catch (err) {
            status.textContent = err.message;
            status.className = "status-bad";
        }
    });

    root.querySelector("#testEleven").addEventListener("click", async () => {
        const status = root.querySelector("#elevenStatus");
        try {
            status.textContent = await smokeTestProvider({ provider: "elevenlabs", apiKey: getSettings().apiKeys.elevenlabs });
            status.className = "status-ok";
        } catch (err) {
            status.textContent = err.message;
            status.className = "status-bad";
        }
    });

    root.querySelector("#exportBtn").addEventListener("click", () => {
        exportData();
        render();
    });

    root.querySelector("#importBtn").addEventListener("click", async () => {
        const file = root.querySelector("#importFile").files?.[0];
        if (!file) {
            alert("Select JSON file first.");
            return;
        }
        try {
            await importData(file);
            ensureMigration();
            render();
            onDataUpdated();
            alert("Import completed.");
        } catch (err) {
            alert(`Import failed: ${err.message}`);
        }
    });

    root.querySelector("#devModeToggle").addEventListener("change", (e) => {
        const settings = getSettings();
        settings.devMode = e.target.checked;
        saveSettings(settings);
        debugLog("settings.devMode", "Developer mode changed", { tab: "settings", enabled: settings.devMode });
        onDataUpdated();
    });

    root.querySelector("#resetAll").addEventListener("click", () => {
        if (!confirm("Reset all local data? This cannot be undone.")) {
            return;
        }
        clearAllData();
        ensureMigration();
        render();
        onDataUpdated();
    });

    render();
}

export function init(container, deps) {
    root = container;
    onDataUpdated = deps.onDataUpdated;
    setup();
}

export function generate() {
    // no-op
}

export function loadToday() {
    render();
}
