import { askClaude, transcribeWithWhisper } from "../api.js";
import { debugLog } from "../debug.js";

function tryParseJSON(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function extractJSON(text) {
    if (!text) return null;
    const trimmed = text.trim();

    const direct = tryParseJSON(trimmed);
    if (direct) return direct;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        const parsedFence = tryParseJSON(fenced[1].trim());
        if (parsedFence) return parsedFence;
    }

    const start = trimmed.indexOf("{");
    if (start < 0) return null;
    for (let end = trimmed.length; end > start; end -= 1) {
        const candidate = tryParseJSON(trimmed.slice(start, end));
        if (candidate) return candidate;
    }
    return null;
}

function toStringList(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => String(item ?? "").trim())
        .filter(Boolean);
}

function toLevel(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 3;
    return Math.min(6, Math.max(1, Math.round(number)));
}

export async function transcribeResponse({ openaiKey, audioBlob, label = "unknown" }) {
    debugLog("elp.transcribeResponse", "Transcribing audio response", {
        tab: "elp",
        label,
        blobSize: audioBlob?.size || 0
    });
    return transcribeWithWhisper({
        apiKey: openaiKey,
        audioBlob,
        language: "en",
        debugContext: { tab: "elp", operation: "transcribeResponse", label }
    });
}

export async function analyzePinpoints({ anthropicKey, transcript, pinpoints, context }) {
    const prompt = `You are an examiner. Analyze transcript against pinpoints.\nContext: ${context}\nPinpoints: ${JSON.stringify(pinpoints)}\nTranscript: ${transcript}\nReturn strict JSON: {"covered":["..."],"missed":["..."],"followUps":["..."]}`;
    const text = await askClaude({
        apiKey: anthropicKey,
        prompt,
        maxTokens: 800,
        temperature: 0.2,
        debugContext: { tab: "elp", operation: "analyzePinpoints", context }
    });
    const parsed = extractJSON(text);
    if (!parsed || typeof parsed !== "object") {
        return { covered: [], missed: pinpoints, followUps: [] };
    }
    return {
        covered: toStringList(parsed.covered),
        missed: toStringList(parsed.missed),
        followUps: toStringList(parsed.followUps)
    };
}

export async function scoreICAO({ anthropicKey, evidence }) {
    const prompt = `Score this ELP evidence using ICAO descriptors 1-6 for Pronunciation, Structure, Vocabulary, Fluency, Comprehension, Interactions. Return JSON: {"pronunciation":1-6,"structure":1-6,"vocabulary":1-6,"fluency":1-6,"comprehension":1-6,"interactions":1-6,"overall":1-6,"rationale":"short"}. Evidence: ${JSON.stringify(evidence)}`;
    const text = await askClaude({
        apiKey: anthropicKey,
        prompt,
        maxTokens: 700,
        temperature: 0.1,
        debugContext: { tab: "elp", operation: "scoreICAO" }
    });
    const fallbackScore = {
        pronunciation: 3,
        structure: 3,
        vocabulary: 3,
        fluency: 3,
        comprehension: 3,
        interactions: 3,
        overall: 3,
        rationale: "Fallback scoring used due to parsing failure."
    };
    const parsed = extractJSON(text);
    if (!parsed || typeof parsed !== "object") {
        return fallbackScore;
    }
    return {
        pronunciation: toLevel(parsed.pronunciation),
        structure: toLevel(parsed.structure),
        vocabulary: toLevel(parsed.vocabulary),
        fluency: toLevel(parsed.fluency),
        comprehension: toLevel(parsed.comprehension),
        interactions: toLevel(parsed.interactions),
        overall: toLevel(parsed.overall),
        rationale: String(parsed.rationale || "").trim() || fallbackScore.rationale
    };
}
