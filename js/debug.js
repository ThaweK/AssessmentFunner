import { isDevMode } from "./utils.js";

const LOG_LIMIT = 500;
const logs = [];
const listeners = new Set();
const APP_RUNTIME_VERSION = "af-web-v2.2026-04-28-debuglog1";
const DEBUG_BUNDLE_VERSION = "af-debug-log-v1";
const DEBUG_SESSION_ID = `dbg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
const DEBUG_SESSION_STARTED_AT = new Date().toISOString();

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
        const normalizedKey = String(key || "").toLowerCase();
        const shouldRedact = blocked.has(key)
            || normalizedKey.includes("apikey")
            || normalizedKey.includes("authorization")
            || normalizedKey.includes("token")
            || normalizedKey.includes("secret");
        if (shouldRedact) {
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
        appVersion: APP_RUNTIME_VERSION,
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

function getRuntimeMeta() {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    const loc = typeof location !== "undefined" ? location : null;
    const doc = typeof document !== "undefined" ? document : null;

    const scriptSrc = doc?.querySelector('script[src*="js/app.js"]')?.getAttribute("src") || null;
    let timezone = null;
    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch {
        timezone = null;
    }

    return {
        appVersion: APP_RUNTIME_VERSION,
        appScriptSrc: scriptSrc,
        url: loc?.href || null,
        origin: loc?.origin || null,
        userAgent: nav?.userAgent || null,
        language: nav?.language || null,
        languages: nav?.languages || null,
        platform: nav?.platform || null,
        cookieEnabled: nav?.cookieEnabled ?? null,
        onLine: nav?.onLine ?? null,
        viewport: (typeof window !== "undefined")
            ? { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio || 1 }
            : null,
        timezone,
        nowIso: new Date().toISOString(),
        localNow: new Date().toString(),
        visibilityState: doc?.visibilityState || null
    };
}

function getStorageMeta() {
    if (typeof localStorage === "undefined" || typeof sessionStorage === "undefined") {
        return null;
    }
    const storageKeys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        storageKeys.push(key);
    }
    return {
        localStorageKeys: storageKeys.sort(),
        localStorageCount: storageKeys.length,
        migrationMarker: localStorage.getItem("af_migrated") || null,
        sessionAuth: sessionStorage.getItem("assessmentFunner_authenticated") === "true"
    };
}

export function getAppRuntimeVersion() {
    return APP_RUNTIME_VERSION;
}

export function buildDebugLogBundle({
    logsSnapshot = null,
    allLogsSnapshot = null,
    totalLogs = null,
    scope = "active",
    activeTab = "unknown",
    debugScope = "active"
} = {}) {
    const allLogs = Array.isArray(allLogsSnapshot) ? allLogsSnapshot.map((entry) => sanitize(entry)) : getDebugLogs();
    const scopedLogs = Array.isArray(logsSnapshot) ? logsSnapshot.map((entry) => sanitize(entry)) : allLogs;
    const allLogsCount = Number.isFinite(totalLogs) ? totalLogs : allLogs.length;

    return {
        bundleVersion: DEBUG_BUNDLE_VERSION,
        exportedAt: new Date().toISOString(),
        session: {
            id: DEBUG_SESSION_ID,
            startedAt: DEBUG_SESSION_STARTED_AT
        },
        scope: {
            scope,
            debugScope,
            activeTab,
            scopedLogCount: scopedLogs.length,
            totalLogCount: allLogsCount
        },
        runtime: getRuntimeMeta(),
        storage: getStorageMeta(),
        scopedLogs,
        logs: allLogs
    };
}

export function formatDebugLogBundle(bundle) {
    return [
        "Assessment Funner Debug Log",
        `Bundle Version: ${bundle?.bundleVersion || "unknown"}`,
        `App Version: ${bundle?.runtime?.appVersion || "unknown"}`,
        `Exported At: ${bundle?.exportedAt || new Date().toISOString()}`,
        `Session ID: ${bundle?.session?.id || "unknown"}`,
        `Scope: ${bundle?.scope?.scope || "unknown"} | Active Tab: ${bundle?.scope?.activeTab || "unknown"}`,
        "",
        JSON.stringify(bundle, null, 2),
        ""
    ].join("\n");
}
