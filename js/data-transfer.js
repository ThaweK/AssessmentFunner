import { buildExportBundle, mergeImportBundle, saveSettings, getSettings } from "./storage.js";
import { downloadJSON } from "./utils.js";

export function exportData() {
    const bundle = buildExportBundle();
    const fileDate = new Date().toISOString().replace(/[:.]/g, "-");
    downloadJSON(`assessment-funner-${fileDate}.json`, bundle);

    const settings = getSettings();
    settings.sync.lastExportAt = new Date().toISOString();
    saveSettings(settings);
}

export async function importData(file) {
    const raw = await file.text();
    let payload;
    try {
        payload = JSON.parse(raw);
    } catch {
        throw new Error("Invalid JSON file. Please check the file format.");
    }
    mergeImportBundle(payload);
}