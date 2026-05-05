import { getTodayString, tryParseJSON } from "./utils.js";

export const KEYS = {
    oldHistory: "assessmentFunner_history",
    oldPerformance: "assessmentFunner_performance",
    oldAtplPerformance: "assessmentFunner_atplPerformance",
    oldApiKey: "assessmentFunner_apiKey",
    oldAuth: "assessmentFunner_authenticated",
    migrated: "af_migrated",
    history: "af_history",
    performance: "af_performance",
    technicalPerformance: "af_technicalPerformance",
    elpPerformance: "af_elpPerformance",
    interviewPerformance: "af_interviewPerformance",
    settings: "af_settings"
};

const DEFAULT_SETTINGS = {
    apiKeys: {
        anthropic: "",
        openai: "",
        elevenlabs: "",
        pexels: ""
    },
    imageDescriptors: {},
    sync: {
        lastExportAt: null,
        lastImportAt: null
    },
    devMode: false
};

function read(key, fallback) {
    return tryParseJSON(localStorage.getItem(key), fallback);
}

function write(key, data) {
    localStorage.setItem(key, JSON.stringify(data));
}

export function ensureMigration() {
    if (localStorage.getItem(KEYS.migrated) === "v2") {
        return;
    }

    const oldHistory = read(KEYS.oldHistory, null);
    if (!oldHistory) {
        if (!localStorage.getItem(KEYS.settings)) {
            write(KEYS.settings, DEFAULT_SETTINGS);
        }
        localStorage.setItem(KEYS.migrated, "v2");
        return;
    }

    const oldPerformance = read(KEYS.oldPerformance, []);
    const oldAtplPerformance = read(KEYS.oldAtplPerformance, []);

    const history = {};
    for (const [date, day] of Object.entries(oldHistory)) {
        history[date] = {
            psychomotor: {
                examNumbers: day.examNumbers || null,
                scores: day.scores || null
            },
            technical: {
                questions: day.atplQuestions || null,
                answers: day.atplAnswers || null,
                questionCount: day.atplQuestionCount || null
            },
            elp: null,
            interview: null,
            legacy: {
                fluencyTask: day.fluencyTask || null,
                fluencyNotes: day.fluencyNotes || null,
                generatedAt: day.generatedAt || null
            },
            updatedAt: day.generatedAt || new Date(`${date}T00:00:00Z`).toISOString()
        };
    }

    const settings = getSettings();
    const oldApiKey = localStorage.getItem(KEYS.oldApiKey);
    if (oldApiKey && !settings.apiKeys.anthropic) {
        settings.apiKeys.anthropic = oldApiKey;
    }

    write(KEYS.history, history);
    write(KEYS.performance, oldPerformance);
    write(KEYS.technicalPerformance, oldAtplPerformance);
    write(KEYS.settings, settings);
    if (!localStorage.getItem(KEYS.elpPerformance)) {
        write(KEYS.elpPerformance, []);
    }
    if (!localStorage.getItem(KEYS.interviewPerformance)) {
        write(KEYS.interviewPerformance, []);
    }
    localStorage.setItem(KEYS.migrated, "v2");
}

export function getSettings() {
    const saved = read(KEYS.settings, DEFAULT_SETTINGS);
    return {
        ...DEFAULT_SETTINGS,
        ...saved,
        apiKeys: { ...DEFAULT_SETTINGS.apiKeys, ...(saved.apiKeys || {}) },
        imageDescriptors: { ...DEFAULT_SETTINGS.imageDescriptors, ...(saved.imageDescriptors || {}) }
    };
}

export function saveSettings(settings) {
    write(KEYS.settings, settings);
}

export function applyLocalApiKeys(apiKeys = {}) {
    const settings = getSettings();
    const providers = ["anthropic", "openai", "elevenlabs", "pexels"];
    let changed = false;

    for (const provider of providers) {
        const value = typeof apiKeys[provider] === "string" ? apiKeys[provider].trim() : "";
        if (!value || settings.apiKeys[provider] === value) {
            continue;
        }
        settings.apiKeys[provider] = value;
        changed = true;
    }

    if (changed) {
        write(KEYS.settings, settings);
    }

    return changed;
}

export function getHistory() {
    return read(KEYS.history, {});
}

export function saveHistory(history) {
    write(KEYS.history, history);
}

export function getDayEntry(date = getTodayString()) {
    const history = getHistory();
    if (!history[date]) {
        history[date] = {
            psychomotor: null,
            technical: null,
            elp: null,
            interview: null,
            legacy: null,
            updatedAt: new Date().toISOString()
        };
    }
    return history[date];
}

export function upsertDay(date, updater) {
    const history = getHistory();
    const base = history[date] || {
        psychomotor: null,
        technical: null,
        elp: null,
        interview: null,
        legacy: null,
        updatedAt: new Date().toISOString()
    };
    history[date] = {
        ...base,
        ...updater(base),
        updatedAt: new Date().toISOString()
    };
    saveHistory(history);
    return history[date];
}

export function addPerformance(key, item) {
    const arr = read(key, []);
    arr.push(item);
    write(key, arr);
}

export function getPerformance(key) {
    return read(key, []);
}

export function clearAllData() {
    for (const key of Object.values(KEYS)) {
        localStorage.removeItem(key);
    }
    // Also remove any legacy keys not in KEYS map
    const legacyPrefixes = ["assessmentFunner_", "af_"];
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (legacyPrefixes.some((prefix) => k.startsWith(prefix))) {
            toRemove.push(k);
        }
    }
    for (const k of toRemove) {
        localStorage.removeItem(k);
    }
}

export function buildExportBundle() {
    const settings = getSettings();
    const { apiKeys, ...safeSettings } = settings;
    return {
        version: "af-v2",
        exportedAt: new Date().toISOString(),
        payload: {
            history: getHistory(),
            performance: getPerformance(KEYS.performance),
            technicalPerformance: getPerformance(KEYS.technicalPerformance),
            elpPerformance: getPerformance(KEYS.elpPerformance),
            interviewPerformance: getPerformance(KEYS.interviewPerformance),
            settings: safeSettings
        }
    };
}

function deduplicatePerformance(existing, incoming) {
    const seen = new Set(existing.map((item) => item.timestamp).filter(Boolean));
    const merged = [...existing];
    for (const item of incoming) {
        if (item.timestamp && seen.has(item.timestamp)) continue;
        if (item.timestamp) seen.add(item.timestamp);
        merged.push(item);
    }
    return merged;
}

export function mergeImportBundle(bundle) {
    if (!bundle || bundle.version !== "af-v2" || !bundle.payload) {
        throw new Error("Unsupported import format. Expected af-v2 bundle.");
    }

    const currentHistory = getHistory();
    const incomingHistory = bundle.payload.history || {};
    const mergedHistory = { ...currentHistory };

    for (const [date, incomingDay] of Object.entries(incomingHistory)) {
        const current = currentHistory[date];
        if (!current) {
            mergedHistory[date] = incomingDay;
            continue;
        }
        const incomingTs = Date.parse(incomingDay.updatedAt || `${date}T00:00:00Z`) || 0;
        const currentTs = Date.parse(current.updatedAt || `${date}T00:00:00Z`) || 0;
        mergedHistory[date] = incomingTs >= currentTs ? incomingDay : current;
    }

    write(KEYS.history, mergedHistory);
    write(KEYS.performance, deduplicatePerformance(getPerformance(KEYS.performance), bundle.payload.performance || []));
    write(KEYS.technicalPerformance, deduplicatePerformance(getPerformance(KEYS.technicalPerformance), bundle.payload.technicalPerformance || []));
    write(KEYS.elpPerformance, deduplicatePerformance(getPerformance(KEYS.elpPerformance), bundle.payload.elpPerformance || []));
    write(KEYS.interviewPerformance, deduplicatePerformance(getPerformance(KEYS.interviewPerformance), bundle.payload.interviewPerformance || []));

    const currentSettings = getSettings();
    write(KEYS.settings, {
        ...currentSettings,
        ...bundle.payload.settings,
        apiKeys: currentSettings.apiKeys,
        sync: {
            ...(currentSettings.sync || {}),
            ...(bundle.payload.settings?.sync || {}),
            lastImportAt: new Date().toISOString()
        }
    });
}
