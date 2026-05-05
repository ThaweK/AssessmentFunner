const MAX_RECORDING_MS = 120000; // 2 minutes
const RECORDING_MIME_CANDIDATES = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
    "audio/ogg"
];

export function createRecorder() {
    let mediaRecorder = null;
    let stream = null;
    let chunks = [];
    let timeout = null;
    let blobMimeType = "audio/webm";

    function unsupportedRecordingMessage() {
        const protocol = globalThis.location?.protocol || "";
        const host = globalThis.location?.hostname || "";
        const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1";
        if (!globalThis.isSecureContext && protocol !== "file:" && !isLocalhost) {
            return "Microphone recording requires a secure page in Chrome. Open this app on https:// or localhost and try again.";
        }
        if (protocol === "file:") {
            return "Microphone recording is unavailable from a local file in Chrome. Run this app from localhost or https:// and try again.";
        }
        return "Microphone recording is not supported in this browser.";
    }

    async function ensureStream() {
        if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error(unsupportedRecordingMessage());
        }
        if (!stream) {
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            } catch (error) {
                if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
                    throw new Error("Microphone access was blocked. Please allow microphone permission and try again.");
                }
                if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
                    throw new Error("No microphone was found on this device.");
                }
                throw new Error("Unable to access the microphone.");
            }
        }
        return stream;
    }

    function pickRecorderOptions() {
        if (typeof MediaRecorder === "undefined") {
            throw new Error("Audio recording is not supported in this browser.");
        }

        if (typeof MediaRecorder.isTypeSupported !== "function") {
            blobMimeType = "audio/webm";
            return undefined;
        }

        const supportedMimeType = RECORDING_MIME_CANDIDATES.find((mimeType) => MediaRecorder.isTypeSupported(mimeType));
        if (!supportedMimeType) {
            blobMimeType = "audio/webm";
            return undefined;
        }

        blobMimeType = supportedMimeType.split(";")[0];
        return { mimeType: supportedMimeType };
    }

    // Returns a promise that resolves to the audio Blob when recording stops.
    // Call stop() to end recording early.
    async function start() {
        if (mediaRecorder?.state === "recording") {
            throw new Error("Recording is already in progress.");
        }
        const mic = await ensureStream();
        chunks = [];
        mediaRecorder = new MediaRecorder(mic, pickRecorderOptions());
        mediaRecorder.ondataavailable = (evt) => {
            if (evt.data.size > 0) chunks.push(evt.data);
        };

        return new Promise((resolve, reject) => {
            mediaRecorder.onstop = () => {
                if (timeout) { clearTimeout(timeout); timeout = null; }
                resolve(chunks.length ? new Blob(chunks, { type: blobMimeType }) : null);
            };
            mediaRecorder.onerror = () => {
                if (timeout) { clearTimeout(timeout); timeout = null; }
                reject(new Error("Recording failed while capturing audio."));
            };
            mediaRecorder.start();
            timeout = setTimeout(() => stop(), MAX_RECORDING_MS);
        });
    }

    // Triggers stop — the start() promise resolves with the blob.
    function stop() {
        if (timeout) { clearTimeout(timeout); timeout = null; }
        if (mediaRecorder && mediaRecorder.state === "recording") {
            mediaRecorder.stop();
        }
    }

    function isRecording() {
        return mediaRecorder?.state === "recording";
    }

    function close() {
        stop();
        if (stream) {
            stream.getTracks().forEach((track) => track.stop());
            stream = null;
        }
    }

    return { start, stop, isRecording, close };
}

export function createPlaybackController(audioElement) {
    const playCountById = new Map();
    const INITIAL_PLAYBACK_TIMEOUT_MS = 15000;
    const STALL_TIMEOUT_MS = 12000;

    function canPlay(id, maxPlays) {
        return (playCountById.get(id) || 0) < maxPlays;
    }

    async function play({ id, src, maxPlays }) {
        if (!canPlay(id, maxPlays)) {
            throw new Error("Playback limit reached for this clip.");
        }
        audioElement.src = src;
        await audioElement.play();
        await new Promise((resolve, reject) => {
            let stallTimer = null;
            let hasStarted = false;
            let lastTime = 0;
            const onEnded = () => {
                cleanup();
                resolve();
            };
            const onError = () => {
                cleanup();
                reject(new Error("Audio playback failed."));
            };
            const onAbort = () => {
                cleanup();
                reject(new Error("Audio playback was aborted."));
            };
            const startStallTimer = (timeoutMs) => {
                if (stallTimer) clearTimeout(stallTimer);
                stallTimer = setTimeout(() => {
                    cleanup();
                    reject(new Error("Audio playback stalled before finishing."));
                }, timeoutMs);
            };
            const onPlaying = () => {
                hasStarted = true;
                lastTime = audioElement.currentTime || lastTime;
                startStallTimer(STALL_TIMEOUT_MS);
            };
            const onTimeUpdate = () => {
                const currentTime = audioElement.currentTime || 0;
                if (currentTime > lastTime) {
                    hasStarted = true;
                    lastTime = currentTime;
                    startStallTimer(STALL_TIMEOUT_MS);
                }
            };
            const onWaiting = () => {
                startStallTimer(hasStarted ? STALL_TIMEOUT_MS : INITIAL_PLAYBACK_TIMEOUT_MS);
            };
            const cleanup = () => {
                if (stallTimer) {
                    clearTimeout(stallTimer);
                    stallTimer = null;
                }
                audioElement.removeEventListener("ended", onEnded);
                audioElement.removeEventListener("error", onError);
                audioElement.removeEventListener("abort", onAbort);
                audioElement.removeEventListener("playing", onPlaying);
                audioElement.removeEventListener("timeupdate", onTimeUpdate);
                audioElement.removeEventListener("waiting", onWaiting);
                audioElement.removeEventListener("stalled", onWaiting);
                audioElement.removeEventListener("canplay", onPlaying);
            };

            audioElement.addEventListener("ended", onEnded);
            audioElement.addEventListener("error", onError);
            audioElement.addEventListener("abort", onAbort);
            audioElement.addEventListener("playing", onPlaying);
            audioElement.addEventListener("timeupdate", onTimeUpdate);
            audioElement.addEventListener("waiting", onWaiting);
            audioElement.addEventListener("stalled", onWaiting);
            audioElement.addEventListener("canplay", onPlaying);
            startStallTimer(INITIAL_PLAYBACK_TIMEOUT_MS);
        });
        playCountById.set(id, (playCountById.get(id) || 0) + 1);
        return { plays: playCountById.get(id), remaining: maxPlays - playCountById.get(id) };
    }

    return { play, canPlay };
}
