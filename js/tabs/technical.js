import { askClaude } from "../api.js";
import { debugLog } from "../debug.js";
import { KEYS, addPerformance, getHistory, getSettings, upsertDay } from "../storage.js";
import { createLoadingOverlay, escapeHTML, getTodayString, isDevMode } from "../utils.js";

function getOfflineHint() {
    const key = getSettings().apiKeys.anthropic;
    return key ? "" : `<div class="elp-offline-banner"><strong>Offline mode</strong> \u2014 no Anthropic API key configured. Questions will use a static fallback set. Add your key in Settings for AI-generated questions.</div>`;
}

const SUBJECTS = [
    "Air Law",
    "Airframe & Systems",
    "Electrics",
    "Powerplant",
    "Instrumentation",
    "Mass & Balance",
    "Performance",
    "Flight Planning",
    "Human Performance & Limitations",
    "Meteorology",
    "General Navigation",
    "Radio Navigation",
    "Operational Procedures",
    "Principles of Flight",
    "Communications"
];

let root;
let onDataUpdated;

function getTodayTechnical() {
    const day = getHistory()[getTodayString()] || {};
    return day.technical || null;
}

const FALLBACK_QUESTIONS = [
    {
        subject: "Air Law",
        multipleChoice: {
            question: "According to ICAO Annex 2, which aircraft has the right of way over all other categories?",
            options: {
                A: "An aircraft on final approach",
                B: "A powered aircraft giving way to airships",
                C: "An aircraft in distress",
                D: "A formation flight leader"
            },
            correctAnswer: "C",
            explanation: "An aircraft in distress has the right of way over all other air traffic (ICAO Annex 2, 3.2.2)."
        },
        open: {
            question: "Explain the difference between ICAO Standards and Recommended Practices (SARPs). What happens when a state files a difference to a Standard?",
            guidance: "Cover the binding nature of Standards vs advisory nature of Recommended Practices, and the notification process through ICAO."
        }
    },
    {
        subject: "Airframe & Systems",
        multipleChoice: {
            question: "In a hydraulic system with a constant-displacement pump, system pressure is regulated by:",
            options: {
                A: "varying the pump output volume",
                B: "a pressure relief valve that returns excess fluid to the reservoir",
                C: "adjusting engine RPM to control pump speed",
                D: "an accumulator that absorbs all excess pressure"
            },
            correctAnswer: "B",
            explanation: "Constant-displacement pumps deliver a fixed volume; a pressure relief valve limits system pressure by bypassing fluid back to the reservoir."
        },
        open: {
            question: "Describe how a modern fly-by-wire flight control system provides protection against exceeding structural limitations. What are the advantages and potential risks?",
            guidance: "Cover flight envelope protection, load factor limits, angle of attack protection, and discuss mode degradation scenarios."
        }
    },
    {
        subject: "Electrics",
        multipleChoice: {
            question: "In a typical transport aircraft electrical system, what is the primary purpose of the bus tie breaker (BTB)?",
            options: {
                A: "To connect the battery directly to the essential bus",
                B: "To isolate the left and right AC buses from each other in case of a generator fault",
                C: "To regulate voltage output of the transformer rectifier unit",
                D: "To provide automatic load shedding during single-engine operations"
            },
            correctAnswer: "B",
            explanation: "The bus tie breaker connects or isolates the main AC buses, preventing a faulty generator from affecting the entire electrical system."
        },
        open: {
            question: "Explain how an AC generator (alternator) maintains a constant frequency output despite changes in engine RPM. What happens if the constant speed drive (CSD) fails?",
            guidance: "Cover the CSD/IDG mechanism, frequency-RPM relationship, and the operational consequences of CSD disconnect."
        }
    },
    {
        subject: "Powerplant",
        multipleChoice: {
            question: "During a climb at constant Mach number above the tropopause, the thrust of a jet engine will:",
            options: {
                A: "increase because air density decreases",
                B: "remain constant because temperature is constant in the stratosphere",
                C: "decrease because air density decreases despite constant temperature",
                D: "increase because TAS increases"
            },
            correctAnswer: "C",
            explanation: "Above the tropopause, temperature is constant but pressure and density continue to decrease with altitude, reducing engine mass airflow and thrust."
        },
        open: {
            question: "Describe the stages of a gas turbine engine and explain what happens to pressure, temperature, and velocity of the airflow through each stage.",
            guidance: "Cover intake, compressor, combustion chamber, turbine, and exhaust nozzle. Describe the Brayton cycle principles."
        }
    },
    {
        subject: "Instrumentation",
        multipleChoice: {
            question: "An aircraft flying from a high-pressure area to a low-pressure area without adjusting the altimeter subscale will have an altimeter that reads:",
            options: {
                A: "correctly at all times if the ISA deviation is zero",
                B: "higher than actual altitude",
                C: "lower than actual altitude",
                D: "correctly only at the transition altitude"
            },
            correctAnswer: "B",
            explanation: "Flying from high to low pressure without resetting QNH causes the altimeter to over-read: 'high to low, look out below.'"
        },
        open: {
            question: "Explain the operating principle of an Inertial Reference System (IRS). What are its main errors, and why does it require alignment before use?",
            guidance: "Cover gyroscope and accelerometer principles, Schuler tuning, drift rate, and the alignment process to establish local vertical and true north."
        }
    },
    {
        subject: "Mass & Balance",
        multipleChoice: {
            question: "If the centre of gravity is located aft of the aft CG limit, the aircraft will:",
            options: {
                A: "require excessive forward stick force during cruise",
                B: "become longitudinally unstable and may be difficult to recover from a stall",
                C: "have increased stall speed due to higher wing loading",
                D: "have reduced range due to increased induced drag"
            },
            correctAnswer: "B",
            explanation: "An aft CG beyond limits reduces the stabilizing moment of the tailplane, decreasing longitudinal static stability and potentially making stall recovery impossible."
        },
        open: {
            question: "Explain why operating with the CG at the forward limit increases fuel consumption compared to operating at the aft limit. What is the operational trade-off?",
            guidance: "Cover trim drag, tailplane down-force, effective wing loading, and the stability-vs-efficiency trade-off."
        }
    },
    {
        subject: "Performance",
        multipleChoice: {
            question: "During a take-off, V1 is defined as:",
            options: {
                A: "the speed at which the pilot must begin rotation",
                B: "the maximum speed at which the pilot must take the first action to stop the aircraft within the remaining ASDA",
                C: "the minimum speed at which the aircraft can safely become airborne",
                D: "the speed at which an engine failure is first recognized"
            },
            correctAnswer: "B",
            explanation: "V1 is the maximum speed at which the rejected take-off action must be initiated to stop within the accelerate-stop distance available (CS-25.107)."
        },
        open: {
            question: "Explain the relationship between V1, VR, V2, and VMCG. Why must V1 never be less than VMCG?",
            guidance: "Cover the speed sequence, the meaning of each V-speed, and why directional control on the ground (VMCG) constrains the minimum V1."
        }
    },
    {
        subject: "Flight Planning",
        multipleChoice: {
            question: "For ETOPS operations, the maximum diversion time is determined by:",
            options: {
                A: "the total fuel on board divided by single-engine fuel flow",
                B: "the approved ETOPS type design of the aircraft and the operator's specific approval",
                C: "the distance to the nearest alternate airport only",
                D: "the captain's discretion based on weather conditions"
            },
            correctAnswer: "B",
            explanation: "ETOPS maximum diversion time depends on the aircraft type design approval and the specific operational approval granted to the operator by the authority."
        },
        open: {
            question: "Describe the fuel planning requirements for an IFR flight under EU-OPS. What are the different fuel components and why is each required?",
            guidance: "Cover taxi fuel, trip fuel, contingency fuel (5%), alternate fuel, final reserve (30 min jet / 45 min piston), additional and extra fuel."
        }
    },
    {
        subject: "Human Performance & Limitations",
        multipleChoice: {
            question: "The 'Swiss cheese model' of accident causation (Reason's model) illustrates that:",
            options: {
                A: "a single human error is always the cause of an accident",
                B: "accidents occur when failures in multiple defensive layers align simultaneously",
                C: "organisational factors play no role in aviation accidents",
                D: "technical failures are the primary cause of most accidents"
            },
            correctAnswer: "B",
            explanation: "Reason's Swiss cheese model shows that accidents result from a combination of latent conditions and active failures that align through multiple layers of defence."
        },
        open: {
            question: "Explain the types and effects of hypoxia relevant to flight crew. At what cabin altitude does performance begin to degrade, and what are the warning signs?",
            guidance: "Cover hypoxic, stagnant, anaemic, and histotoxic hypoxia. Discuss the time of useful consciousness, symptoms at various altitudes, and night vision effects above 5,000 ft."
        }
    },
    {
        subject: "Meteorology",
        multipleChoice: {
            question: "Wind shear associated with a microburst during approach will typically cause the aircraft to first experience:",
            options: {
                A: "a sudden decrease in headwind, causing the aircraft to go below the glide path",
                B: "an increase in headwind followed by a downdraft and then a tailwind",
                C: "steady turbulence with no significant airspeed changes",
                D: "a constant downdraft from the beginning of the encounter"
            },
            correctAnswer: "B",
            explanation: "A microburst encounter on approach produces an initial headwind increase (performance increase), then a strong downdraft and transition to tailwind (severe performance loss)."
        },
        open: {
            question: "Describe how a cumulonimbus cloud develops through its lifecycle stages. What hazards does each stage present to aviation?",
            guidance: "Cover the cumulus, mature, and dissipating stages. Include updrafts/downdrafts, icing, turbulence, hail, lightning, microbursts, and gust fronts."
        }
    },
    {
        subject: "General Navigation",
        multipleChoice: {
            question: "On a direct Mercator chart, a rhumb line is represented as:",
            options: {
                A: "a curved line concave to the equator",
                B: "a straight line",
                C: "a curved line concave to the nearest pole",
                D: "a great circle"
            },
            correctAnswer: "B",
            explanation: "On a Mercator projection, rhumb lines (lines of constant track) appear as straight lines, while great circles (except the equator and meridians) appear as curves."
        },
        open: {
            question: "Explain the difference between a great circle and a rhumb line. Why does a great circle represent the shortest distance, and when would a pilot prefer to fly a rhumb line?",
            guidance: "Cover spherical geometry, convergency, constant track vs shortest distance, and practical considerations for navigation at different latitudes."
        }
    },
    {
        subject: "Radio Navigation",
        multipleChoice: {
            question: "An ILS glide slope transmitter operates in which frequency band?",
            options: {
                A: "75 MHz (VHF marker beacon band)",
                B: "108.10 \u2013 111.95 MHz (VHF band, paired with localizer)",
                C: "329.15 \u2013 335.00 MHz (UHF band)",
                D: "960 \u2013 1215 MHz (DME band)"
            },
            correctAnswer: "C",
            explanation: "The ILS glide slope operates in the UHF band (329.15\u2013335.00 MHz) and is automatically paired with the VHF localizer frequency."
        },
        open: {
            question: "Explain the principle of DME operation, including the frequency pairing with VOR. What is DME slant range error and when is it most significant?",
            guidance: "Cover interrogator/transponder principle, 63 \u00b5s pulse pair delay, frequency pairing, and slant range geometry at high altitude close to the station."
        }
    },
    {
        subject: "Operational Procedures",
        multipleChoice: {
            question: "According to ICAO standards, the minimum flight visibility required for a CAT I ILS approach is:",
            options: {
                A: "800 m or 550 m RVR",
                B: "350 m RVR",
                C: "200 m RVR",
                D: "75 m RVR"
            },
            correctAnswer: "A",
            explanation: "CAT I ILS requires a minimum RVR of 550 m (or 800 m visibility) and a decision height not lower than 200 ft (ICAO Annex 6 / EU-OPS)."
        },
        open: {
            question: "Describe the procedures and considerations for operating in RVSM airspace. What are the equipment requirements and monitoring obligations?",
            guidance: "Cover FL290\u2013FL410, two independent altitude measurement systems, altitude alerting, transponder with Mode C, height monitoring, and contingency procedures."
        }
    },
    {
        subject: "Principles of Flight",
        multipleChoice: {
            question: "As an aircraft approaches the critical angle of attack, the boundary layer separation point moves:",
            options: {
                A: "from the trailing edge towards the leading edge",
                B: "from the leading edge towards the trailing edge",
                C: "remains fixed at the thickest point of the wing",
                D: "oscillates between the leading and trailing edges"
            },
            correctAnswer: "A",
            explanation: "As angle of attack increases towards the stall, the adverse pressure gradient strengthens and the separation point moves forward from trailing edge to leading edge."
        },
        open: {
            question: "Explain the concept of Mach tuck and how a Mach trimmer prevents it. What happens aerodynamically as an aircraft exceeds its critical Mach number?",
            guidance: "Cover shockwave formation, movement of the centre of pressure, pitch-down tendency, and how the Mach trimmer provides automatic stabilizer input."
        }
    },
    {
        subject: "Communications",
        multipleChoice: {
            question: "The radiotelephony distress signal consists of:",
            options: {
                A: "the word PAN PAN spoken three times",
                B: "the word MAYDAY spoken three times",
                C: "the phrase DECLARING EMERGENCY spoken once",
                D: "squawking 7600 only"
            },
            correctAnswer: "B",
            explanation: "The distress signal is the spoken word MAYDAY repeated three times, followed by station called, callsign, nature of distress, intention, position, and other information (ICAO Annex 10)."
        },
        open: {
            question: "Explain the difference between a MAYDAY and a PAN PAN call. What are the correct procedures and pilot obligations for each?",
            guidance: "Cover the definitions of distress vs urgency, the correct format, squawk codes (7700 vs 7600), and the responsibilities of the pilot and ATC."
        }
    }
];

const FALLBACK_BY_SUBJECT = new Map(FALLBACK_QUESTIONS.map((item) => [item.subject, item]));

function fallbackQuestions() {
    return FALLBACK_QUESTIONS;
}

function fallbackForSubjects(subjectsBatch) {
    debugLog("technical", "Using fallback questions for subjects", { subjectsBatch });
    return subjectsBatch
        .map((subject) => {
            const found = FALLBACK_BY_SUBJECT.get(subject);
            if (found) return found;
            return {
                subject,
                multipleChoice: {
                    question: `Which statement is most correct regarding ${subject}?`,
                    options: {
                        A: "It is irrelevant for ATPL-level operations",
                        B: "It should be understood and applied with operational context",
                        C: "It only matters for maintenance staff",
                        D: "It can be ignored below cruise altitude"
                    },
                    correctAnswer: "B",
                    explanation: `${subject} should be applied with operational reasoning and current ATPL references.`
                },
                open: {
                    question: `How do you understand ${subject} in practical airline operations?`,
                    guidance: "Explain core principles, decision impact, and safety implications."
                }
            };
        });
}

function parseJSONCandidate(raw) {
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function extractJSON(content) {
    if (!content) return null;
    const trimmed = content.trim();

    const direct = parseJSONCandidate(trimmed);
    if (direct) return direct;

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]) {
        const parsedFence = parseJSONCandidate(fenced[1].trim());
        if (parsedFence) return parsedFence;
    }

    const firstObject = trimmed.indexOf("{");
    const firstArray = trimmed.indexOf("[");
    const start = [firstObject, firstArray].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
    if (start === undefined) return null;

    for (let end = trimmed.length; end > start; end -= 1) {
        const candidate = parseJSONCandidate(trimmed.slice(start, end));
        if (candidate) return candidate;
    }
    return null;
}

function extractItemsFromPartialContent(content) {
    if (!content) return [];
    const source = String(content);
    const itemsKey = /"items"\s*:\s*\[/i;
    const match = itemsKey.exec(source);
    if (!match) return [];

    const arrayStart = source.indexOf("[", match.index);
    if (arrayStart < 0) return [];
    const slice = source.slice(arrayStart + 1);

    const chunks = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let i = 0; i < slice.length; i += 1) {
        const ch = slice[i];

        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (ch === "\\") {
                escaped = true;
            } else if (ch === "\"") {
                inString = false;
            }
            continue;
        }

        if (ch === "\"") {
            inString = true;
            continue;
        }
        if (ch === "{") {
            if (depth === 0) start = i;
            depth += 1;
            continue;
        }
        if (ch === "}") {
            depth -= 1;
            if (depth === 0 && start >= 0) {
                chunks.push(slice.slice(start, i + 1));
                start = -1;
            }
        }
    }

    return chunks
        .map((chunk) => parseJSONCandidate(chunk))
        .filter(Boolean);
}

function normalizeOptions(rawOptions) {
    if (!rawOptions) return null;
    if (Array.isArray(rawOptions)) {
        const letters = ["A", "B", "C", "D"];
        const mapped = {};
        rawOptions.slice(0, 4).forEach((opt, idx) => {
            mapped[letters[idx]] = String(opt ?? "");
        });
        return Object.keys(mapped).length === 4 ? mapped : null;
    }

    const letters = ["A", "B", "C", "D"];
    const mapped = {};
    letters.forEach((letter) => {
        const value = rawOptions[letter] ?? rawOptions[letter.toLowerCase()];
        if (typeof value === "string" && value.trim()) mapped[letter] = value.trim();
    });
    return Object.keys(mapped).length === 4 ? mapped : null;
}

function normalizeCorrectAnswer(correctAnswer, options) {
    if (!correctAnswer || !options) return null;
    const normalized = String(correctAnswer).trim().toUpperCase();
    if (["A", "B", "C", "D"].includes(normalized)) return normalized;

    const found = Object.entries(options).find(([, text]) => text.trim().toLowerCase() === String(correctAnswer).trim().toLowerCase());
    return found?.[0] || null;
}

function normalizeItem(item, subjectFallback) {
    const options = normalizeOptions(item?.multipleChoice?.options || item?.multipleChoice?.choices);
    const correctAnswer = normalizeCorrectAnswer(item?.multipleChoice?.correctAnswer || item?.multipleChoice?.answer, options);
    const mcQuestion = item?.multipleChoice?.question;
    const explanation = item?.multipleChoice?.explanation || "Review this topic with current ATPL references.";
    const openQuestion = item?.open?.question || item?.openAnswer?.question;
    const guidance = item?.open?.guidance || item?.openAnswer?.guidance || "Explain your reasoning step by step and include operational implications.";

    if (!options || !correctAnswer || !mcQuestion || !openQuestion) {
        return null;
    }

    return {
        subject: item.subject || subjectFallback,
        multipleChoice: {
            question: String(mcQuestion),
            options,
            correctAnswer,
            explanation: String(explanation)
        },
        open: {
            question: String(openQuestion),
            guidance: String(guidance)
        }
    };
}

function subjectKey(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "");
}

function resolveSubject(subjectRaw, subjectsBatch, idxFallback = 0) {
    const fallback = subjectsBatch[idxFallback] || subjectsBatch[0] || "ATPL Subject";
    if (!subjectRaw) return fallback;

    const rawKey = subjectKey(subjectRaw);
    const exact = subjectsBatch.find((s) => subjectKey(s) === rawKey);
    if (exact) return exact;

    const fuzzy = subjectsBatch.find((s) => {
        const k = subjectKey(s);
        return rawKey.includes(k) || k.includes(rawKey);
    });
    return fuzzy || fallback;
}

function normalizeMCFromAny(raw) {
    if (!raw || typeof raw !== "object") return null;
    const options = normalizeOptions(raw.options || raw.choices || raw.answers);
    const question = raw.question || raw.mcQuestion || raw.multipleChoiceQuestion;
    const correctAnswer = normalizeCorrectAnswer(raw.correctAnswer || raw.answer || raw.correct, options);
    const explanation = raw.explanation || raw.rationale || "Review this topic with current ATPL references.";
    if (!options || !question || !correctAnswer) return null;
    return {
        question: String(question),
        options,
        correctAnswer,
        explanation: String(explanation)
    };
}

function normalizeOpenFromAny(raw, allowQuestionFallback = false) {
    if (!raw || typeof raw !== "object") return null;
    const question = raw.question || raw.openQuestion || raw.descriptiveQuestion || raw.prompt;
    if (!question) return null;
    if (!allowQuestionFallback && (raw.options || raw.choices || raw.answers || raw.correctAnswer || raw.answer)) {
        return null;
    }
    const guidance = raw.guidance || raw.hint || raw.expectedAnswer || "Explain your reasoning step by step and include operational implications.";
    return {
        question: String(question),
        guidance: String(guidance)
    };
}

function composeItemsFromFragments(candidateItems, subjectsBatch) {
    const grouped = new Map();
    subjectsBatch.forEach((subject) => {
        grouped.set(subject, { subject, multipleChoice: null, open: null });
    });

    candidateItems.forEach((item, idx) => {
        if (!item || typeof item !== "object") return;
        const subject = resolveSubject(item.subject || item.topic || item.area, subjectsBatch, idx);
        const bucket = grouped.get(subject) || { subject, multipleChoice: null, open: null };

        const combined = normalizeItem(item, subject);
        if (combined) {
            bucket.multipleChoice = bucket.multipleChoice || combined.multipleChoice;
            bucket.open = bucket.open || combined.open;
            grouped.set(subject, bucket);
            return;
        }

        const nestedMC = normalizeMCFromAny(item.multipleChoice || item.mc || {});
        const rootMC = normalizeMCFromAny(item);
        const mc = nestedMC || rootMC;
        if (mc && !bucket.multipleChoice) bucket.multipleChoice = mc;

        const nestedOpen = normalizeOpenFromAny(item.open || item.openAnswer || {}, true);
        const rootOpen = normalizeOpenFromAny(item, !mc);
        const open = nestedOpen || rootOpen;
        if (open && !bucket.open) bucket.open = open;

        grouped.set(subject, bucket);
    });

    return subjectsBatch
        .map((subject) => grouped.get(subject))
        .filter((bucket) => bucket?.multipleChoice && bucket?.open)
        .map((bucket) => ({
            subject: bucket.subject,
            multipleChoice: bucket.multipleChoice,
            open: bucket.open
        }));
}

function parseBatchItems(text, subjectsBatch) {
    const parsed = extractJSON(text);
    debugLog("technical.parseBatchItems", "Raw model response", {
        subjectsBatch,
        text
    });
    let candidateItems = Array.isArray(parsed)
        ? parsed
        : parsed?.items || parsed?.questions || parsed?.data || parsed?.result?.items || parsed?.result?.questions || [];

    if (!Array.isArray(candidateItems) && parsed && typeof parsed === "object") {
        // Accept dictionary-like payloads keyed by subject names.
        candidateItems = Object.entries(parsed)
            .filter(([, value]) => value && typeof value === "object")
            .map(([subject, value]) => ({ ...value, subject: value.subject || subject }));
    }

    if (!Array.isArray(candidateItems)) {
        if (!parsed) {
            const partialItems = extractItemsFromPartialContent(text);
            if (partialItems.length) {
                debugLog("technical.parseBatchItems", "Recovered items from partial/truncated response", {
                    subjectsBatch,
                    recoveredCount: partialItems.length
                }, "warn");
                candidateItems = partialItems;
            }
        }
    }

    if (!Array.isArray(candidateItems)) {
        debugLog("technical.parseBatchItems", "Candidate items are not an array", {
            subjectsBatch,
            parsedType: typeof parsed
        }, "warn");
        return [];
    }

    const normalized = candidateItems
        .map((item, idx) => normalizeItem(item, subjectsBatch[idx] || item?.subject || "ATPL Subject"))
        .filter(Boolean)
        .slice(0, 5);

    debugLog("technical.parseBatchItems", "Normalized items result", {
        subjectsBatch,
        candidateCount: candidateItems.length,
        normalizedCount: normalized.length
    });

    if (normalized.length >= 5) {
        return normalized;
    }

    const composed = composeItemsFromFragments(candidateItems, subjectsBatch).slice(0, 5);
    debugLog("technical.parseBatchItems", "Composed fragmented items result", {
        subjectsBatch,
        composedCount: composed.length
    });
    return composed;
}

async function generateBatch(apiKey, subjectsBatch) {
    const prompt = `Generate exactly 5 ATPL subject blocks for these 5 subjects (one block per subject, no duplicates).\nSubjects: ${subjectsBatch.join(", ")}\nFor each subject provide:\n1) One multiple-choice question with 4 options and one correct answer.\n2) One open-answer question in style: How do you understand [topic]?\nKeep explanations and guidance concise (max 1 sentence each).\nReturn strict JSON only in this shape: {"items":[{"subject":"...","multipleChoice":{"question":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"correctAnswer":"A|B|C|D","explanation":"..."},"open":{"question":"...","guidance":"..."}}]}`;

    debugLog("technical.generateBatch", "Generating batch", { subjectsBatch, prompt });
    const text = await askClaude({
        apiKey,
        prompt,
        maxTokens: 1600,
        temperature: 0.2,
        debugContext: { tab: "technical", operation: "generateBatch", subjectsBatch }
    });
    const items = parseBatchItems(text, subjectsBatch);

    const bySubject = new Map();
    items.forEach((item) => {
        const resolvedSubject = resolveSubject(item?.subject, subjectsBatch);
        if (resolvedSubject && !bySubject.has(resolvedSubject)) {
            bySubject.set(resolvedSubject, { ...item, subject: resolvedSubject });
        }
    });

    const merged = subjectsBatch.map((subject) => bySubject.get(subject)).filter(Boolean);
    if (merged.length === subjectsBatch.length) {
        debugLog("technical.generateBatch", "Batch parsed successfully", {
            subjectsBatch,
            mergedCount: merged.length
        });
        return merged;
    }

    const fallback = fallbackForSubjects(subjectsBatch);
    const completed = subjectsBatch.map((subject, idx) => bySubject.get(subject) || fallback[idx]);
    const fallbackSubjects = subjectsBatch.filter((subject) => !bySubject.get(subject));
    console.warn("Technical batch partially recovered with fallback items.", {
        expected: subjectsBatch.length,
        parsed: merged.length
    });
    debugLog("technical.generateBatch", "Batch partially recovered with fallback", {
        subjectsBatch,
        parsedCount: merged.length,
        fallbackSubjects
    }, "warn");
    return completed;
}

async function generateTechnicalQuestions() {
    const apiKey = getSettings().apiKeys.anthropic;
    if (!apiKey) {
        debugLog("technical.generateTechnicalQuestions", "No Anthropic key. Full fallback.", {});
        return fallbackQuestions();
    }

    const batches = [SUBJECTS.slice(0, 5), SUBJECTS.slice(5, 10), SUBJECTS.slice(10, 15)];
    const results = [];
    const batchErrors = [];

    for (const batch of batches) {
        try {
            const part = await generateBatch(apiKey, batch);
            results.push(...part);
        } catch (err) {
            console.error(err);
            batchErrors.push(err.message || "Unknown batch error");
            results.push(...fallbackForSubjects(batch));
            debugLog("technical.generateTechnicalQuestions", "Batch failed, used fallback", {
                batch,
                error: err?.message || String(err)
            }, "error");
        }
    }

    if (batchErrors.length) {
        alert(`Technical generation used partial fallback for ${batchErrors.length} batch(es): ${batchErrors.join(" | ")}`);
        debugLog("technical.generateTechnicalQuestions", "Generation completed with batch errors", {
            batchErrors
        }, "warn");
    }

    const finalQuestions = results.length === 15 ? results : fallbackQuestions();
    debugLog("technical.generateTechnicalQuestions", "Final technical generation result", {
        totalQuestions: finalQuestions.length,
        subjects: finalQuestions.map((q) => q.subject)
    });
    return finalQuestions;
}

function saveMCAnswer(subject, idx, selected, correct) {
    const date = getTodayString();
    const isCorrect = selected === correct;

    upsertDay(date, (day) => {
        const technical = day.technical || {};
        const answers = { ...(technical.answers || {}), mc: { ...(technical.answers?.mc || {}) } };
        answers.mc[idx] = { subject, selected, correct, isCorrect, savedAt: new Date().toISOString() };
        return {
            technical: {
                ...technical,
                answers
            }
        };
    });

    addPerformance(KEYS.technicalPerformance, {
        tab: "technical",
        subject,
        questionIndex: idx,
        isCorrect,
        date,
        timestamp: new Date().toISOString()
    });

    onDataUpdated();
}

function saveOpenNote(idx, text) {
    upsertDay(getTodayString(), (day) => {
        const technical = day.technical || {};
        const answers = { ...(technical.answers || {}), open: { ...(technical.answers?.open || {}) } };
        answers.open[idx] = { notes: text, savedAt: new Date().toISOString() };
        return { technical: { ...technical, answers } };
    });
    onDataUpdated();
}

function renderQuestions(questions, answers = {}) {
    if (!questions?.length) {
        root.querySelector(".technical-list").innerHTML = "<p class='hint'>No technical set for today.</p>";
        return;
    }

    root.querySelector(".technical-list").innerHTML = questions.map((item, idx) => {
        const mcSaved = answers?.mc?.[idx];
        const openSaved = answers?.open?.[idx]?.notes || "";

        const options = Object.entries(item.multipleChoice.options).map(([letter, text]) => {
            const cls = mcSaved
                ? letter === item.multipleChoice.correctAnswer
                    ? "mc-option correct"
                    : letter === mcSaved.selected
                        ? "mc-option wrong"
                        : "mc-option"
                : "mc-option";
            return `<div class="${cls}" data-idx="${idx}" data-letter="${escapeHTML(letter)}"><strong>${escapeHTML(letter)}</strong> ${escapeHTML(text)}</div>`;
        }).join("");

        return `
            <article class="tech-subject" data-idx="${idx}">
                <h3>${escapeHTML(item.subject)}</h3>
                <p><strong>MC:</strong> ${escapeHTML(item.multipleChoice.question)}</p>
                <div>${options}</div>
                <small>${mcSaved ? `Saved: ${escapeHTML(mcSaved.selected)} (${mcSaved.isCorrect ? "correct" : "incorrect"})` : "Select one answer"}</small>
                <hr>
                <p><strong>Open:</strong> ${escapeHTML(item.open.question)}</p>
                <textarea class="tech-open" rows="3" placeholder="Your understanding notes">${escapeHTML(openSaved)}</textarea>
                <button class="btn btn-secondary tech-save-open" data-idx="${idx}">Save Open Notes</button>
            </article>
        `;
    }).join("");

    root.querySelectorAll(".mc-option").forEach((node) => {
        node.addEventListener("click", () => {
            const idx = Number(node.dataset.idx);
            const letter = node.dataset.letter;
            const question = questions[idx];
            saveMCAnswer(question.subject, idx, letter, question.multipleChoice.correctAnswer);
            render();
        });
    });

    root.querySelectorAll(".tech-save-open").forEach((button) => {
        button.addEventListener("click", () => {
            const idx = Number(button.dataset.idx);
            const text = button.parentElement.querySelector(".tech-open").value.trim();
            saveOpenNote(idx, text);
            button.textContent = "Saved";
        });
    });
}

function render() {
    const data = getTodayTechnical();
    renderQuestions(data?.questions, data?.answers);
}

function setup() {
    root.innerHTML = `
        <section class="card">
            <h2>Technical (30 Questions)</h2>
            <p class="hint">Fixed format: 15 subjects, each with 1 MC + 1 open-answer question.</p>
            ${getOfflineHint()}
            <div class="elp-controls">
                <button id="techGenerate" class="btn btn-primary">Generate 30 Questions</button>
                <button id="techLoad" class="btn btn-secondary">Load Today's Technical</button>
                ${isDevMode() ? `<button id="techClear" class="btn btn-danger">Clear Today's Technical</button>` : ""}
            </div>
            <div class="technical-list"></div>
        </section>
    `;

    if (isDevMode()) {
        root.querySelector("#techClear").addEventListener("click", () => {
            if (!confirm("Clear today's technical questions and answers?")) return;
            upsertDay(getTodayString(), () => ({ technical: null }));
            render();
            onDataUpdated();
        });
    }

    root.querySelector("#techGenerate").addEventListener("click", async () => {
        const today = getTodayString();
        const existing = getTodayTechnical()?.questions?.length;
        if (existing) {
            const shouldReplace = confirm("Today's Technical is already generated. Replace it with a new set?");
            debugLog("technical.ui", "Generate clicked with existing set", {
                existingCount: existing,
                shouldReplace
            });
            if (!shouldReplace) {
                render();
                return;
            }
        }

        const button = root.querySelector("#techGenerate");
        button.disabled = true;
        const loader = createLoadingOverlay(root, "Generating 30 ATPL questions\u2026");

        try {
            const questions = await generateTechnicalQuestions();
            upsertDay(today, (day) => ({
                technical: {
                    questions,
                    answers: day.technical?.answers || {},
                    questionCount: 30
                }
            }));
            render();
            onDataUpdated();
        } finally {
            loader.remove();
            button.disabled = false;
        }
    });

    root.querySelector("#techLoad").addEventListener("click", () => render());
    render();
}

export function init(container, deps) {
    root = container;
    onDataUpdated = deps.onDataUpdated;
    setup();
}

export async function generate() {
    if (getTodayTechnical()?.questions?.length) return;
    const today = getTodayString();
    const button = root.querySelector("#techGenerate");
    button.disabled = true;
    const loader = createLoadingOverlay(root, "Generating 30 ATPL questions\u2026");
    try {
        const questions = await generateTechnicalQuestions();
        upsertDay(today, (day) => ({
            technical: {
                questions,
                answers: day.technical?.answers || {},
                questionCount: 30
            }
        }));
        render();
        onDataUpdated();
    } finally {
        loader.remove();
        button.disabled = false;
        button.textContent = "Generate 30 Questions";
    }
}

export function loadToday() {
    render();
}
