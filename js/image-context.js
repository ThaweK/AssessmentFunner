import { askClaude } from "./api.js";
import { debugLog } from "./debug.js";
import { getSettings, saveSettings } from "./storage.js";

const IMAGE_MANIFEST_PATH = "assets/img/manifest.json";
const MANIFEST_TIMEOUT_MS = 4500;
const IMAGE_RECOGNITION_MODEL = "claude-sonnet-4-20250514";

let manifestPromise = null;

function parseJSON(value) {
    if (!value || typeof value !== "string") return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function extractJSON(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;

    const direct = parseJSON(trimmed);
    if (direct) return direct;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        const parsed = parseJSON(fenced[1].trim());
        if (parsed) return parsed;
    }

    const start = trimmed.indexOf("{");
    if (start < 0) return null;
    for (let end = trimmed.length; end > start; end -= 1) {
        const candidate = parseJSON(trimmed.slice(start, end));
        if (candidate) return candidate;
    }
    return null;
}

function normalizeText(value, fallback = "") {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeList(value, { max = 6, fallback = [] } = {}) {
    if (!Array.isArray(value)) return fallback;
    const unique = [];
    const seen = new Set();
    for (const item of value) {
        const clean = normalizeText(item);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(clean);
        if (unique.length >= max) break;
    }
    return unique.length ? unique : fallback;
}

function uniqueQuestions(items, max = 3) {
    const out = [];
    const seen = new Set();
    for (const item of items) {
        const clean = normalizeText(item);
        if (!clean) continue;
        const key = clean.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(clean);
        if (out.length >= max) break;
    }
    return out;
}

function toImageKey(src) {
    if (!src) return "";
    try {
        const url = new URL(src, window.location.href);
        if (url.origin === window.location.origin) {
            return url.pathname.replace(/^\//, "");
        }
    } catch {
        // no-op
    }
    return src;
}

function fileLabelFromKey(imageKey) {
    const file = imageKey.split("/").pop() || imageKey;
    return file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
}

function mediaTypeFromSrc(src) {
    const normalized = src.toLowerCase();
    if (normalized.endsWith(".png")) return "image/png";
    if (normalized.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
}

async function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("Could not read image blob."));
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

async function dataURLToImage(dataUrl) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Could not decode image data."));
        image.src = dataUrl;
    });
}

async function prepareImageForVision(src, maxSide = 1024) {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`Could not fetch image (${response.status}).`);
    }
    const originalBlob = await response.blob();
    const dataUrl = await blobToDataURL(originalBlob);
    const image = await dataURLToImage(dataUrl);

    const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height, 1);
    const scale = Math.min(1, maxSide / longestSide);
    const width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Could not initialize canvas context.");
    }
    ctx.drawImage(image, 0, 0, width, height);

    const jpegDataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = jpegDataUrl.split(",")[1] || "";
    if (!base64) throw new Error("Could not encode image for recognition.");
    return { base64, mediaType: "image/jpeg" };
}

function fallbackDescriptor(imageKey) {
    const label = fileLabelFromKey(imageKey);
    const lower = label.toLowerCase();
    const isRemoteUrl = imageKey.startsWith("http://") || imageKey.startsWith("https://");
    const hazards = [];
    if (lower.includes("cockpit")) {
        hazards.push("high cockpit workload");
        hazards.push("possible automation mode confusion");
    } else if (lower.includes("wing")) {
        hazards.push("weather and turbulence awareness");
        hazards.push("trajectory and separation monitoring");
    } else if (isRemoteUrl) {
        hazards.push("situational awareness and threat identification");
        hazards.push("communication clarity under operational pressure");
    } else {
        hazards.push("ground movement conflict risk");
        hazards.push("communication gaps during busy operations");
    }

    const sceneSummary = isRemoteUrl
        ? "Aviation scene from dynamic image source."
        : `Aviation scene (${label}).`;

    return {
        imageKey,
        source: "fallback",
        model: "fallback-v1",
        sceneSummary,
        operationalContext: "Assess operational priorities, communication clarity, and safety margins based on visible cues.",
        hazards,
        keyObjects: ["aircraft", "airport environment"],
        communicationFocus: ["priority setting", "clear readback", "crew coordination"],
        questionSeeds: {
            part1Followups: [
                "What are your first operational priorities in this scene?",
                "Which visible cue creates the highest communication demand, and why?"
            ],
            part4Followups: [
                "Which safety risk should be addressed first in this scenario?",
                "How would you brief the crew to reduce ambiguity here?",
                "What trigger would make you change your current plan?"
            ],
            part4Discussion: [
                "How should phraseology adapt when workload suddenly rises?",
                "How can crews balance strict procedure with fast decision-making?"
            ]
        }
    };
}

function sanitizeDescriptor(raw, imageKey, source, model) {
    const fallback = fallbackDescriptor(imageKey);
    const sceneSummary = normalizeText(raw?.sceneSummary, fallback.sceneSummary);
    const operationalContext = normalizeText(raw?.operationalContext, fallback.operationalContext);
    const hazards = normalizeList(raw?.hazards, { max: 6, fallback: fallback.hazards });
    const keyObjects = normalizeList(raw?.keyObjects, { max: 6, fallback: fallback.keyObjects });
    const communicationFocus = normalizeList(raw?.communicationFocus, { max: 5, fallback: fallback.communicationFocus });

    const questionSeeds = {
        part1Followups: uniqueQuestions(
            raw?.questionSeeds?.part1Followups || raw?.part1Followups || fallback.questionSeeds.part1Followups,
            3
        ),
        part4Followups: uniqueQuestions(
            raw?.questionSeeds?.part4Followups || raw?.part4Followups || fallback.questionSeeds.part4Followups,
            4
        ),
        part4Discussion: uniqueQuestions(
            raw?.questionSeeds?.part4Discussion || raw?.part4Discussion || fallback.questionSeeds.part4Discussion,
            3
        )
    };

    return {
        imageKey,
        source,
        model,
        generatedAt: new Date().toISOString(),
        sceneSummary,
        operationalContext,
        hazards,
        keyObjects,
        communicationFocus,
        questionSeeds
    };
}

function readDescriptorFromCache(imageKey, hasAnthropic) {
    const settings = getSettings();
    const desc = settings.imageDescriptors?.[imageKey];
    if (!desc) return null;
    if (!hasAnthropic || desc.source === "recognition") return desc;
    const lastFailure = Date.parse(desc.recognitionErrorAt || "");
    if (Number.isFinite(lastFailure) && (Date.now() - lastFailure) < (6 * 60 * 60 * 1000)) {
        return desc;
    }
    return null;
}

function writeDescriptorToCache(imageKey, descriptor) {
    const settings = getSettings();
    settings.imageDescriptors = {
        ...(settings.imageDescriptors || {}),
        [imageKey]: descriptor
    };
    saveSettings(settings);
}

async function loadManifest() {
    if (manifestPromise) return manifestPromise;
    manifestPromise = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS);
        try {
            const response = await fetch(IMAGE_MANIFEST_PATH, { cache: "no-store", signal: controller.signal });
            if (!response.ok) return {};
            const payload = await response.json();
            return payload?.images && typeof payload.images === "object" ? payload.images : {};
        } catch {
            return {};
        } finally {
            clearTimeout(timer);
        }
    })();
    return manifestPromise;
}

async function recognizeWithClaude(imageSrc, imageKey) {
    const anthropicKey = getSettings().apiKeys.anthropic;
    if (!anthropicKey) return fallbackDescriptor(imageKey);

    const { base64, mediaType } = await prepareImageForVision(imageSrc);
    const prompt = `Analyze this aviation photo for pilot ELP practice.
Return strict JSON only:
{
  "sceneSummary": "one concise sentence",
  "operationalContext": "one concise sentence",
  "hazards": ["risk 1", "risk 2", "risk 3"],
  "keyObjects": ["item 1", "item 2", "item 3"],
  "communicationFocus": ["focus 1", "focus 2", "focus 3"],
  "questionSeeds": {
    "part1Followups": ["question 1", "question 2"],
    "part4Followups": ["question 1", "question 2", "question 3"],
    "part4Discussion": ["question 1", "question 2"]
  }
}
Rules:
- part1Followups MUST directly reference specific objects, hazards, or details visible in this photo.
- Keep questions practical and aviation-specific.
- Do not invent hidden details.
- If something is unclear, use cautious language.`;

    const text = await askClaude({
        apiKey: anthropicKey,
        maxTokens: 900,
        temperature: 0.2,
        debugContext: { tab: "elp", operation: "imageContext.recognize", imageKey },
        messages: [{
            role: "user",
            content: [
                {
                    type: "image",
                    source: {
                        type: "base64",
                        media_type: mediaType || mediaTypeFromSrc(imageSrc),
                        data: base64
                    }
                },
                { type: "text", text: prompt }
            ]
        }]
    });

    const parsed = extractJSON(text);
    return sanitizeDescriptor(parsed || {}, imageKey, "recognition", IMAGE_RECOGNITION_MODEL);
}

export async function getImageDescriptor(imageSrc, { debugContext = {} } = {}) {
    const imageKey = toImageKey(imageSrc);
    if (!imageKey) return fallbackDescriptor("unknown-image");
    const hasAnthropic = Boolean(getSettings().apiKeys.anthropic);

    const cached = readDescriptorFromCache(imageKey, hasAnthropic);
    if (cached && (!hasAnthropic || cached.source === "recognition")) return cached;

    const manifest = await loadManifest();
    const fromManifest = manifest[imageKey]
        ? sanitizeDescriptor(manifest[imageKey], imageKey, "manifest", manifest[imageKey].model || "manifest-v1")
        : null;

    if (!hasAnthropic) {
        const baseline = cached || fromManifest || fallbackDescriptor(imageKey);
        writeDescriptorToCache(imageKey, baseline);
        return baseline;
    }

    try {
        const recognized = await recognizeWithClaude(imageSrc, imageKey);
        writeDescriptorToCache(imageKey, recognized);
        return recognized;
    } catch (err) {
        debugLog("imageContext.getImageDescriptor", "Recognition failed, fallback descriptor used.", {
            ...debugContext,
            imageKey,
            error: err?.message || String(err)
        }, "warn");
        const baseline = sanitizeDescriptor(
            cached || fromManifest || fallbackDescriptor(imageKey),
            imageKey,
            (cached || fromManifest)?.source || "fallback",
            (cached || fromManifest)?.model || "fallback-v1"
        );
        baseline.recognitionErrorAt = new Date().toISOString();
        writeDescriptorToCache(imageKey, baseline);
        return baseline;
    }
}

export async function getKnownLocalImageKeys(defaultKeys = []) {
    const manifest = await loadManifest();
    const fromManifest = Object.keys(manifest).filter((key) => key.startsWith("assets/img/"));
    return uniqueQuestions([...defaultKeys, ...fromManifest], 1000);
}

export function buildPart1FollowupQuestions(descriptor) {
    if (descriptor?.questionSeeds?.part1Followups?.length) {
        return uniqueQuestions(descriptor.questionSeeds.part1Followups, 3);
    }
    const hazards = descriptor?.hazards || [];
    return [
        `What immediate priorities do you identify around ${hazards[0] || "this scenario"}?`,
        "How would your communication change if workload increases in the next minute?"
    ];
}

export function buildPart4FollowupQuestions(primary, secondary) {
    const fallback = [
        "Which difference has the highest safety impact and why?",
        "How would your crew briefing differ between these two scenarios?",
        "If conditions worsen, what decision threshold changes first?"
    ];
    const fromDescriptors = uniqueQuestions([
        ...(primary?.questionSeeds?.part4Followups || []),
        ...(secondary?.questionSeeds?.part4Followups || [])
    ], 5);
    if (!fromDescriptors.length) return fallback;

    const primaryHazard = primary?.hazards?.[0] || "the primary risk in picture 1";
    const secondaryHazard = secondary?.hazards?.[0] || "the primary risk in picture 2";
    return uniqueQuestions([
        ...fromDescriptors,
        `Compare ${primaryHazard} and ${secondaryHazard}. Which one is more time-critical?`,
        fallback[1],
        fallback[2]
    ], 3);
}

export function buildPart4DiscussionQuestions(primary, secondary) {
    const fallback = [
        "How should pilots adapt communication style in multicultural operations?",
        "Where does automation help most and where can it degrade situational awareness?"
    ];
    const fromDescriptors = uniqueQuestions([
        ...(primary?.questionSeeds?.part4Discussion || []),
        ...(secondary?.questionSeeds?.part4Discussion || [])
    ], 4);
    if (!fromDescriptors.length) return fallback;

    return uniqueQuestions([
        ...fromDescriptors,
        fallback[0],
        fallback[1]
    ], 2);
}
