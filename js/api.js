import { debugLog } from "./debug.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const OPENAI_STT_ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const OPENAI_IMAGE_ENDPOINT = "https://api.openai.com/v1/images/generations";
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

export async function askClaude({ apiKey, prompt, maxTokens = 2000, temperature = 0.2, debugContext = {} }) {
    if (!apiKey) {
        throw new Error("Anthropic API key is missing.");
    }
    debugLog("api.askClaude", "Sending Claude request", {
        ...debugContext,
        model: "claude-sonnet-4-20250514",
        maxTokens,
        temperature,
        prompt
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
                messages: [{ role: "user", content: prompt }]
            })
        },
        "Claude request failed",
        45000,
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

export async function generateImageWithOpenAI({ apiKey, prompt, debugContext = {} }) {
    if (!apiKey) {
        throw new Error("OpenAI API key is missing.");
    }
    debugLog("api.generateImageWithOpenAI", "Sending image request", {
        ...debugContext,
        model: "gpt-image-1",
        prompt
    });
    const data = await httpJSON(
        OPENAI_IMAGE_ENDPOINT,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "gpt-image-1",
                prompt,
                size: "1024x1024"
            })
        },
        "Image generation failed",
        45000,
        debugContext
    );

    const first = data.data?.[0];
    const image = first?.b64_json ? `data:image/png;base64,${first.b64_json}` : null;
    debugLog("api.generateImageWithOpenAI", "Image response received", {
        ...debugContext,
        hasImage: Boolean(image),
        dataItems: data.data?.length || 0
    });
    return image;
}

export async function generateSpeechWithElevenLabs({ apiKey, text, voiceId, debugContext = {} }) {
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
            voice_settings: { stability: 0.4, similarity_boost: 0.7 }
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
