import { isDevMode } from "./utils.js";

const LOG_LIMIT = 500;
const logs = [];
const listeners = new Set();

function inferTabFromSource(source = "") {
    if (source.startsWith("technical")) return "technical";
    if (source.startsWith("psychomotor")) return "psychomotor";
    if (source.startsWith("interview")) return "interview";
    if (source.startsWith("elp")) return "elp";
    if (source.startsWith("analytics")) return "analytics";
    if (source.startsWith("settings")) return "settings";
    if (source.startsWith("app")) return "app";
    if (source.startsWith("api")) return "api";
    return "global";
}

function sanitize(value) {
    if (value == null) return value;
    if (Array.isArray(value)) return value.map(sanitize);
    if (typeof value !== "object") return value;

    const blocked = new Set(["apiKey", "x-api-key", "authorization", "xi-api-key", "Authorization"]);
    const output = {};
    Object.entries(value).forEach(([key, raw]) => {
        if (blocked.has(key)) {
            output[key] = "[REDACTED]";
        } else {
            output[key] = sanitize(raw);
        }
    });
    return output;
}

function emit() {
    listeners.forEach((fn) => {
        try {
            fn(getDebugLogs());
        } catch {
            // no-op
        }
    });
}

export function debugLog(source, message, details = {}, level = "info") {
    if (!isDevMode()) return;
    const tab = typeof details?.tab === "string" && details.tab ? details.tab : inferTabFromSource(source);
    const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        level,
        tab,
        source,
        message,
        details: sanitize(details)
    };
    logs.push(entry);
    if (logs.length > LOG_LIMIT) {
        logs.splice(0, logs.length - LOG_LIMIT);
    }
    emit();
}

export function getDebugLogs() {
    return [...logs];
}

export function clearDebugLogs() {
    logs.length = 0;
    emit();
}

export function subscribeDebugLogs(listener) {
    listeners.add(listener);
    listener(getDebugLogs());
    return () => listeners.delete(listener);
}
