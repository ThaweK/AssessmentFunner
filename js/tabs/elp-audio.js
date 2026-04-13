const MAX_RECORDING_MS = 120000; // 2 minutes

export function createRecorder() {
    let mediaRecorder = null;
    let stream = null;
    let chunks = [];
    let timeout = null;

    async function ensureStream() {
        if (!stream) {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        return stream;
    }

    // Returns a promise that resolves to the audio Blob when recording stops.
    // Call stop() to end recording early.
    async function start() {
        const mic = await ensureStream();
        chunks = [];
        mediaRecorder = new MediaRecorder(mic, { mimeType: "audio/webm;codecs=opus" });
        mediaRecorder.ondataavailable = (evt) => {
            if (evt.data.size > 0) chunks.push(evt.data);
        };

        return new Promise((resolve) => {
            mediaRecorder.onstop = () => {
                if (timeout) { clearTimeout(timeout); timeout = null; }
                resolve(chunks.length ? new Blob(chunks, { type: "audio/webm" }) : null);
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
    const PLAYBACK_TIMEOUT_MS = 180000;

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
            let timeout = null;
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
            const cleanup = () => {
                if (timeout) {
                    clearTimeout(timeout);
                    timeout = null;
                }
                audioElement.removeEventListener("ended", onEnded);
                audioElement.removeEventListener("error", onError);
                audioElement.removeEventListener("abort", onAbort);
            };

            audioElement.addEventListener("ended", onEnded);
            audioElement.addEventListener("error", onError);
            audioElement.addEventListener("abort", onAbort);
            timeout = setTimeout(() => {
                cleanup();
                reject(new Error("Audio playback timed out."));
            }, PLAYBACK_TIMEOUT_MS);
        });
        playCountById.set(id, (playCountById.get(id) || 0) + 1);
        return { plays: playCountById.get(id), remaining: maxPlays - playCountById.get(id) };
    }

    return { play, canPlay };
}
