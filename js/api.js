import { debugLog } from "./debug.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const OPENAI_STT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";

async function fetchWithTimeout(url, options, timeoutMs = 45000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (err?.name === "AbortError") {
            throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
        }
        throw err;
    } finally {
        clearTimeout(timer);
    }
}

async function httpJSON(url, options, defaultError, timeoutMs = 45000, debugContext = {}) {
    debugLog("api.httpJSON", "Request started", {
        ...debugContext,
        url,
        method: options?.method || "GET",
        timeoutMs
    });
    const response = await fetchWithTimeout(url, options, timeoutMs);
    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        debugLog("api.httpJSON", "Request failed", {
            ...debugContext,
            url,
            status: response.status,
            payload
        }, "error");
        throw new Error(payload.error?.message || defaultError || `Request failed (${response.status})`);
    }
    debugLog("api.httpJSON", "Request succeeded", {
        ...debugContext,
        url,
        status: response.status
    });
    return response.json();
}

export async function askClaude({ apiKey, prompt, messages, maxTokens = 2000, temperature = 0.2, timeoutMs = 45000, debugContext = {} }) {
    if (!apiKey) {
        throw new Error("Anthropic API key is missing.");
    }
    const requestMessages = Array.isArray(messages) && messages.length
        ? messages
        : [{ role: "user", content: prompt }];
    debugLog("api.askClaude", "Sending Claude request", {
        ...debugContext,
        model: "claude-sonnet-4-20250514",
        maxTokens,
        temperature,
        messageCount: requestMessages.length,
        prompt: Array.isArray(messages) ? "[multimodal-content]" : prompt
    });
    const data = await httpJSON(
        ANTHROPIC_ENDPOINT,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true"
            },
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: maxTokens,
                temperature,
                messages: requestMessages
            })
        },
        "Claude request failed",
        timeoutMs,
        debugContext
    );
    const text = data.content?.[0]?.text || "";
    debugLog("api.askClaude", "Received Claude response", {
        ...debugContext,
        contentBlocks: data.content?.length || 0,
        text
    });
    return text;
}

export async function transcribeWithWhisper({ apiKey, audioBlob, language = "en", debugContext = {} }) {
    if (!apiKey) {
        throw new Error("OpenAI API key is missing.");
    }

    const formData = new FormData();
    formData.append("file", audioBlob, "recording.webm");
    formData.append("model", "whisper-1");
    formData.append("language", language);

    debugLog("api.transcribeWithWhisper", "Sending transcription request", {
        ...debugContext,
        language,
        blobSize: audioBlob?.size || 0,
        blobType: audioBlob?.type || null
    });
    const response = await fetchWithTimeout(OPENAI_STT_ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData
    }, 120000);

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        debugLog("api.transcribeWithWhisper", "Transcription failed", {
            ...debugContext,
            status: response.status,
            payload
        }, "error");
        throw new Error(payload.error?.message || "Whisper transcription failed");
    }

    const payload = await response.json();
    debugLog("api.transcribeWithWhisper", "Transcription succeeded", {
        ...debugContext,
        text: payload.text || ""
    });
    return payload.text || "";
}

export async function generateSpeechWithElevenLabs({ apiKey, text, voiceId, voiceSettings, debugContext = {} }) {
    if (!apiKey) {
        throw new Error("ElevenLabs API key is missing.");
    }

    debugLog("api.generateSpeechWithElevenLabs", "Sending TTS request", {
        ...debugContext,
        voiceId,
        text
    });
    const response = await fetchWithTimeout(`${ELEVENLABS_BASE}/${voiceId}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey
        },
        body: JSON.stringify({
            text,
            model_id: "eleven_multilingual_v2",
            voice_settings: voiceSettings || { stability: 0.4, similarity_boost: 0.7 }
        })
    }, 120000);

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        debugLog("api.generateSpeechWithElevenLabs", "TTS failed", {
            ...debugContext,
            status: response.status,
            payload
        }, "error");
        throw new Error(payload.detail?.message || "ElevenLabs TTS failed");
    }

    debugLog("api.generateSpeechWithElevenLabs", "TTS succeeded", { ...debugContext, status: response.status });
    return response.blob();
}

export async function generateSoundEffect({ apiKey, text, durationSeconds = 3, debugContext = {} }) {
    if (!apiKey) {
        throw new Error("ElevenLabs API key is missing.");
    }

    debugLog("api.generateSoundEffect", "Sending SFX request", { ...debugContext, text, durationSeconds });
    const response = await fetchWithTimeout("https://api.elevenlabs.io/v1/sound-generation", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "xi-api-key": apiKey
        },
        body: JSON.stringify({
            text,
            duration_seconds: durationSeconds,
            prompt_influence: 0.5
        })
    }, 30000);

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        debugLog("api.generateSoundEffect", "SFX failed", { ...debugContext, status: response.status, payload }, "error");
        throw new Error(payload.detail?.message || "Sound effect generation failed");
    }

    debugLog("api.generateSoundEffect", "SFX succeeded", { ...debugContext, status: response.status });
    return response.blob();
}

const PEXELS_SEARCH_ENDPOINT = "https://api.pexels.com/v1/search";
const PEXELS_SEARCH_QUERIES = [
    "aviation cockpit",
    "airport apron aircraft",
    "airplane wing flight",
    "air traffic control tower",
    "aircraft landing runway",
    "airport terminal gate",
    "pilot airplane",
    "commercial aircraft taxiway"
];

export async function searchPexels({ apiKey, exclude = [], query, page, perPage = 15, debugContext = {} }) {
    if (!apiKey) throw new Error("Pexels API key is missing.");

    const chosenQuery = query || PEXELS_SEARCH_QUERIES[Math.floor(Math.random() * PEXELS_SEARCH_QUERIES.length)];
    const chosenPage = Number.isInteger(page) ? page : (Math.floor(Math.random() * 10) + 1);

    debugLog("api.searchPexels", "Searching Pexels", { ...debugContext, query: chosenQuery, page: chosenPage, perPage });

    const url = `${PEXELS_SEARCH_ENDPOINT}?query=${encodeURIComponent(chosenQuery)}&per_page=${perPage}&page=${chosenPage}&orientation=landscape`;
    const response = await fetchWithTimeout(url, {
        method: "GET",
        headers: { Authorization: apiKey }
    }, 15000);

    if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        debugLog("api.searchPexels", "Pexels search failed", { ...debugContext, status: response.status, payload }, "error");
        throw new Error(payload.error || `Pexels search failed (${response.status})`);
    }

    const data = await response.json();
    const photos = (data.photos || []).filter((p) => !exclude.includes(p.id));
    if (!photos.length) throw new Error("No Pexels results after filtering.");

    const photo = photos[Math.floor(Math.random() * photos.length)];
    const result = {
        url: photo.src?.large2x || photo.src?.large || photo.src?.original,
        photographerCredit: photo.photographer || "Unknown",
        photographerUrl: photo.photographer_url || "",
        pexelsId: photo.id,
        pexelsUrl: photo.url || ""
    };

    debugLog("api.searchPexels", "Pexels result selected", { ...debugContext, pexelsId: result.pexelsId, photographer: result.photographerCredit });
    return result;
}

export async function smokeTestProvider({ provider, apiKey, debugContext = { tab: "settings" } }) {
    if (provider === "anthropic") {
        await askClaude({ apiKey, prompt: "Reply with exact text: OK", maxTokens: 16, temperature: 0, debugContext });
        return "Anthropic key works.";
    }

    if (provider === "openai") {
        await httpJSON(
            "https://api.openai.com/v1/models",
            {
                method: "GET",
                headers: { Authorization: `Bearer ${apiKey}` }
            },
            "OpenAI key test failed",
            45000,
            debugContext
        );
        return "OpenAI key works.";
    }

    if (provider === "pexels") {
        const result = await searchPexels({ apiKey, debugContext });
        if (!result?.url) throw new Error("Pexels key test failed: no results returned.");
        return "Pexels key works.";
    }

    if (provider === "elevenlabs") {
        const response = await fetchWithTimeout("https://api.elevenlabs.io/v1/voices", {
            method: "GET",
            headers: { "xi-api-key": apiKey }
        }, 30000);
        if (!response.ok) {
            throw new Error(`ElevenLabs key test failed (${response.status})`);
        }
        return "ElevenLabs key works.";
    }

    throw new Error(`Unknown provider: ${provider}`);
}
