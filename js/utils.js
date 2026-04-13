export const ACCESS_PASSWORD = "Sandrolka";

export function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function formatDate(dateString) {
    const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    return new Date(dateString).toLocaleDateString("en-US", options);
}

export function randomPick(items) {
    return items[Math.floor(Math.random() * items.length)];
}

export function randomize(items) {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

export function uniqueRandomIntegers(count, max, exclude = []) {
    const denied = new Set(exclude);
    const pool = [];
    for (let i = 1; i <= max; i += 1) {
        if (!denied.has(i)) {
            pool.push(i);
        }
    }
    if (pool.length < count) {
        for (let i = 1; i <= max; i += 1) {
            if (!pool.includes(i)) {
                pool.push(i);
            }
        }
    }
    return randomize(pool).slice(0, count).sort((a, b) => a - b);
}

export function nowTimeLabel() {
    return new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function tryParseJSON(raw, fallback) {
    try {
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

export function downloadJSON(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function createId(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function escapeHTML(str) {
    if (typeof str !== "string") return String(str ?? "");
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export function isDevMode() {
    try {
        const raw = localStorage.getItem("af_settings");
        if (!raw) return false;
        return JSON.parse(raw).devMode === true;
    } catch {
        return false;
    }
}

export function setStatus(node, text, className = "") {
    node.textContent = text;
    node.className = className;
}

export function createLoadingOverlay(container, message = "Generating\u2026") {
    const overlay = document.createElement("div");
    overlay.className = "ai-loading-overlay";
    overlay.innerHTML = `
        <div class="ai-loading-inner">
            <div class="ai-spinner"></div>
            <div class="ai-loading-msg">${escapeHTML(message)}</div>
        </div>
    `;
    container.prepend(overlay);

    return {
        remove() { overlay.remove(); }
    };
}
