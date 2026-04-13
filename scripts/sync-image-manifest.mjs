#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const imageDir = path.join(rootDir, "assets", "img");
const manifestPath = path.join(imageDir, "manifest.json");

function seedDescriptor(imageKey) {
    const base = path.basename(imageKey, path.extname(imageKey)).replace(/[-_]+/g, " ").trim();
    const lower = base.toLowerCase();
    const hazards = [];
    if (lower.includes("cockpit")) {
        hazards.push("high cockpit workload", "automation mode confusion risk");
    } else if (lower.includes("wing") || lower.includes("flight")) {
        hazards.push("weather-driven decision risk", "delayed route adjustment risk");
    } else {
        hazards.push("surface operation conflict risk", "communication breakdown risk");
    }

    return {
        model: "sync-seed-v1",
        sceneSummary: `Aviation scene (${base}).`,
        operationalContext: "Use this image to discuss priorities, communication quality, and safety margins.",
        hazards,
        keyObjects: ["aircraft", "operational environment"],
        communicationFocus: ["readback discipline", "crew coordination", "clear intent"],
        questionSeeds: {
            part1Followups: [
                "What are your immediate priorities in this scene?",
                "Which communication step is most safety-critical here?"
            ],
            part4Followups: [
                "Which visible risk is most likely to escalate?",
                "How would you brief the crew for this scenario?",
                "What condition would make you change your current plan?"
            ],
            part4Discussion: [
                "How should communication adapt when workload increases?",
                "How do you balance procedure discipline with time pressure?"
            ]
        }
    };
}

async function readManifest() {
    try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        const parsed = JSON.parse(raw);
        if (parsed?.images && typeof parsed.images === "object") return parsed;
    } catch {
        // no-op
    }
    return { version: "af-image-manifest-v1", updatedAt: null, images: {} };
}

async function main() {
    await fs.mkdir(imageDir, { recursive: true });
    const entries = await fs.readdir(imageDir, { withFileTypes: true });
    const imageFiles = entries
        .filter((entry) => entry.isFile() && /\.(jpe?g|png|webp)$/i.test(entry.name))
        .map((entry) => entry.name)
        .sort();

    const manifest = await readManifest();
    let added = 0;

    for (const file of imageFiles) {
        const imageKey = `assets/img/${file}`;
        if (!manifest.images[imageKey]) {
            manifest.images[imageKey] = seedDescriptor(imageKey);
            added += 1;
        }
    }

    manifest.updatedAt = new Date().toISOString();
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
    console.log(`Manifest synced. Images: ${imageFiles.length}, added: ${added}`);
}

main().catch((err) => {
    console.error(err.message || String(err));
    process.exit(1);
});
