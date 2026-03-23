// Assessment Funner - Daily Practice Generator
// Uses Anthropic Claude API for dynamic ATPL question generation
// Stores history in localStorage and prevents repeats

const STORAGE_KEY = 'assessmentFunner_history';
const PERFORMANCE_KEY = 'assessmentFunner_performance';
const ATPL_PERFORMANCE_KEY = 'assessmentFunner_atplPerformance';
const PASSWORD_KEY = 'assessmentFunner_authenticated';

// Default ATPL question count (can be changed by user)
let selectedAtplCount = 4;

// API key stored in localStorage, prompted on first use
const API_KEY_STORAGE = 'assessmentFunner_apiKey';
function getApiKey() {
    let key = localStorage.getItem(API_KEY_STORAGE);
    if (!key) {
        key = prompt('Enter your Anthropic API key:');
        if (key) localStorage.setItem(API_KEY_STORAGE, key);
    }
    return key;
}

// Password for access
const ACCESS_PASSWORD = 'Sandrolka';

// Friendly names for exam categories
const EXAM_LABELS = {
    aptitude: 'Aptitude Tests',
    deductive: 'Deductive Test',
    inductiveThinking: 'Inductive Thinking',
    inductiveReasoning: 'Inductive Reasoning',
    knowledge: 'Knowledge Tests',
    englishAudio: 'English Audio',
    completeSentence: 'Complete Sentence',
    englishGrammar: 'English Grammar',
    englishVocabulary: 'English Vocabulary'
};

// Configuration for exam numbers
const EXAM_CONFIG = {
    aptitude: { pick: 4, total: 8 },
    deductive: { pick: 1, total: 3 },
    inductiveThinking: { pick: 1, total: 2 },
    inductiveReasoning: { pick: 2, total: 4 },
    knowledge: { pick: 1, total: 5 },
    englishAudio: { pick: 1, total: 8 },
    completeSentence: { pick: 6, total: 60 },
    englishGrammar: { pick: 4, total: 19 },
    englishVocabulary: { pick: 4, total: 36 }
};

// EASA ATPL Subject Areas for AI generation context
const ATPL_SUBJECTS = [
    "Air Law (EASA Part-FCL, Part-OPS, EU regulations, ICAO Annexes)",
    "Airframe & Systems (CS-25 requirements, hydraulics, pneumatics, landing gear, flight controls)",
    "Electrics (DC/AC circuits, generators, electrical systems per EASA standards)",
    "Powerplant (turbine engines, propellers, fuel systems, EASA type certification)",
    "Instrumentation (flight instruments, autopilot, EFIS, EASA requirements)",
    "Mass & Balance (EASA load calculations, CG limits, load sheets)",
    "Performance (EASA performance classes, takeoff/landing analysis, CS-25)",
    "Flight Planning (EASA fuel policy, route planning, EUROCONTROL, NOTAMs)",
    "Human Performance & Limitations (EASA Part-FCL medical, fatigue, CRM)",
    "Meteorology (European weather services, METAR/TAF, significant weather charts)",
    "General Navigation (chart reading, time calculations, European airspace)",
    "Radio Navigation (VOR, NDB, ILS, GNSS, PBN/RNAV per EASA standards)",
    "Operational Procedures (EU-OPS, RVSM in EUR RVSM airspace, emergency procedures)",
    "Principles of Flight (aerodynamics, stability, control, high-speed flight)",
    "Communications (EASA phraseology, VHF/HF, CPDLC, European ATC procedures)"
];

// English Fluency Tasks
const FLUENCY_TASKS = [
    {
        type: "Describe a Topic",
        tasks: [
            "Describe your ideal holiday destination and explain why you would choose it.",
            "Describe a memorable flight experience you've had or would like to have.",
            "Describe the perfect workday from start to finish.",
            "Describe a technological advancement that has changed aviation.",
            "Describe the process of preparing for a long-haul flight as a pilot.",
            "Describe your hometown to someone who has never visited.",
            "Describe a challenging situation you handled well and what you learned.",
            "Describe the most important qualities of a good team leader.",
            "Describe a book, movie, or documentary that influenced your career choice.",
            "Describe the differences between flying in different weather conditions.",
            "Describe a typical pre-flight briefing and its key components.",
            "Describe an airport you find particularly efficient or well-designed.",
            "Describe the evolution of cockpit technology over the decades.",
            "Describe a situation where clear communication prevented a problem.",
            "Describe your morning routine and how it helps you prepare for work.",
            "Describe the most scenic flight route you know about.",
            "Describe how you manage stress in high-pressure situations.",
            "Describe the role of teamwork in aviation safety.",
            "Describe a cultural difference you've observed in international travel.",
            "Describe what makes a good first officer or captain."
        ]
    },
    {
        type: "Express an Opinion",
        tasks: [
            "Should pilots be required to have regular psychological evaluations? Why or why not?",
            "Is automation in aviation making flying safer or creating new risks?",
            "Should there be stricter regulations on pilot rest times?",
            "Is English proficiency testing for pilots rigorous enough?",
            "Should airlines invest more in pilot training or technology?",
            "Is the current system of air traffic control efficient enough for growing traffic?",
            "Should single-pilot operations be allowed for commercial flights?",
            "Is climate change impacting aviation safety significantly?",
            "Should passengers be informed about all technical issues during flight?",
            "Is the current pilot recruitment process selecting the best candidates?",
            "Should flight simulators replace more actual flight training hours?",
            "Is the aviation industry doing enough to reduce its carbon footprint?",
            "Should there be age limits for commercial pilots?",
            "Is fatigue the biggest threat to aviation safety today?",
            "Should airlines standardize cockpit layouts across all aircraft types?"
        ]
    },
    {
        type: "Explain a Procedure",
        tasks: [
            "Explain the procedure for a go-around decision and execution.",
            "Explain how to handle an engine failure during takeoff.",
            "Explain the steps involved in a standard instrument approach.",
            "Explain the procedure for dealing with a pressurization failure.",
            "Explain how weather information is obtained and used for flight planning.",
            "Explain the procedure for fuel management on a long-haul flight.",
            "Explain how crew resource management works in practice.",
            "Explain the procedure for handling a medical emergency on board.",
            "Explain the steps for conducting a proper pre-flight inspection.",
            "Explain how to coordinate with ATC during busy airspace operations.",
            "Explain the procedure for alternate airport selection.",
            "Explain how to manage a bird strike incident.",
            "Explain the procedure for handling icing conditions in flight.",
            "Explain the steps for a proper crew briefing before departure.",
            "Explain the procedure for maintaining situational awareness in complex environments."
        ]
    },
    {
        type: "Compare and Contrast",
        tasks: [
            "Compare flying in IMC versus VMC conditions.",
            "Compare the responsibilities of a captain and first officer.",
            "Compare regional and long-haul flying careers.",
            "Compare manual flying skills with automated flight management.",
            "Compare the challenges of landing at high-altitude versus sea-level airports.",
            "Compare daytime and nighttime flying challenges.",
            "Compare flying over land versus over water on long routes.",
            "Compare the training requirements for different aircraft types.",
            "Compare working for a major airline versus a low-cost carrier.",
            "Compare the advantages of glass cockpit versus traditional instruments."
        ]
    },
    {
        type: "Hypothetical Scenario",
        tasks: [
            "What would you do if you noticed a colleague showing signs of fatigue before a flight?",
            "How would you handle a disagreement with the captain about a safety concern?",
            "What would you do if you encountered unexpected severe weather en route?",
            "How would you manage a situation where passengers are becoming unruly?",
            "What would you do if you suspected a security threat during flight?",
            "How would you handle a communication breakdown with ATC?",
            "What would you do if you discovered a technical problem just before pushback?",
            "How would you manage fuel concerns on a flight with significant delays?",
            "What would you do if you felt unwell during a flight?",
            "How would you handle a situation where ground crew made an error?"
        ]
    },
    {
        type: "Storytelling",
        tasks: [
            "Tell about a time when teamwork made a significant difference in a situation.",
            "Tell about your most challenging learning experience in aviation.",
            "Tell about a situation where attention to detail prevented a problem.",
            "Tell about someone who inspired you in your aviation career.",
            "Tell about a time when you had to adapt quickly to changing circumstances.",
            "Tell about your first solo flight or a significant aviation milestone.",
            "Tell about a time when communication was crucial to success.",
            "Tell about an experience that taught you the importance of preparation.",
            "Tell about a situation where you had to make a difficult decision under pressure.",
            "Tell about a time when cultural awareness helped in a professional situation."
        ]
    }
];

// Tips for fluency tasks
const FLUENCY_TIPS = {
    "Describe a Topic": [
        "Use vivid adjectives and specific details",
        "Structure your response with a beginning, middle, and end",
        "Include sensory details (what you see, hear, feel)",
        "Speak for at least 2 minutes continuously"
    ],
    "Express an Opinion": [
        "State your position clearly at the start",
        "Provide at least 2-3 supporting arguments",
        "Acknowledge the opposing viewpoint",
        "Conclude by reinforcing your main point"
    ],
    "Explain a Procedure": [
        "Use sequence words (first, then, next, finally)",
        "Be clear and methodical in your explanation",
        "Include the reasoning behind each step",
        "Mention any safety considerations"
    ],
    "Compare and Contrast": [
        "Use comparison language (whereas, while, on the other hand)",
        "Identify at least 3 similarities and 3 differences",
        "Organize by either topic-by-topic or point-by-point",
        "Conclude with your overall assessment"
    ],
    "Hypothetical Scenario": [
        "Use conditional language (would, could, might)",
        "Consider multiple options before deciding",
        "Explain your reasoning process",
        "Discuss potential consequences of your actions"
    ],
    "Storytelling": [
        "Set the scene with context and background",
        "Build tension or interest as you progress",
        "Use past tense consistently",
        "End with the lesson learned or outcome"
    ]
};

// Utility Functions
function getTodayString() {
    return new Date().toISOString().split('T')[0];
}

function formatDate(dateString) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

function getRandomNumbers(count, max, exclude = []) {
    const available = [];
    for (let i = 1; i <= max; i++) {
        if (!exclude.includes(i)) {
            available.push(i);
        }
    }

    if (available.length < count) {
        for (let i = 1; i <= max; i++) {
            if (!available.includes(i)) {
                available.push(i);
            }
        }
    }

    const shuffled = available.sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count).sort((a, b) => a - b);
}

// Storage Functions
function getHistory() {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
}

function saveHistory(history) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

function clearHistory() {
    localStorage.removeItem(STORAGE_KEY);
}

function getPerformanceData() {
    const stored = localStorage.getItem(PERFORMANCE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function savePerformanceData(data) {
    localStorage.setItem(PERFORMANCE_KEY, JSON.stringify(data));
}

// ATPL Performance tracking
function getAtplPerformanceData() {
    const stored = localStorage.getItem(ATPL_PERFORMANCE_KEY);
    return stored ? JSON.parse(stored) : [];
}

function saveAtplPerformanceData(data) {
    localStorage.setItem(ATPL_PERFORMANCE_KEY, JSON.stringify(data));
}

function addAtplPerformanceEntry(subject, isCorrect, questionIndex, date) {
    const performance = getAtplPerformanceData();
    const now = new Date();
    performance.push({
        subject,
        isCorrect,
        questionIndex,
        date,
        timeOfDay: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        timestamp: now.toISOString()
    });
    saveAtplPerformanceData(performance);
}

function addPerformanceEntry(category, percentage, date, examNumber) {
    const performance = getPerformanceData();
    const now = new Date();
    performance.push({
        category,
        percentage,
        examNumber, // Now stores single exam number instead of array
        date,
        timeOfDay: now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        hour: now.getHours(),
        timestamp: now.toISOString()
    });
    savePerformanceData(performance);
}

function getUsedNumbers(category) {
    const history = getHistory();
    const used = [];
    Object.values(history).forEach(day => {
        if (day.examNumbers && day.examNumbers[category]) {
            used.push(...day.examNumbers[category]);
        }
    });
    return used;
}

function getUsedSubjects() {
    const history = getHistory();
    const used = [];
    Object.values(history).forEach(day => {
        if (day.atplQuestions) {
            // Handle new structure with multipleChoice and descriptive
            if (day.atplQuestions.multipleChoice) {
                day.atplQuestions.multipleChoice.forEach(q => {
                    if (q.subject) used.push(q.subject);
                });
            }
            if (day.atplQuestions.descriptive && day.atplQuestions.descriptive.subject) {
                used.push(day.atplQuestions.descriptive.subject);
            }
            // Handle old structure (array of questions) for backwards compatibility
            if (Array.isArray(day.atplQuestions)) {
                day.atplQuestions.forEach(q => {
                    if (q.subject) used.push(q.subject);
                });
            }
        }
    });
    return used;
}

function getUsedFluencyTasks() {
    const history = getHistory();
    const used = [];
    Object.values(history).forEach(day => {
        if (day.fluencyTask) {
            used.push(JSON.stringify(day.fluencyTask));
        }
    });
    return used;
}

// Generation Functions
function generateExamNumbers() {
    const numbers = {};

    Object.keys(EXAM_CONFIG).forEach(category => {
        const config = EXAM_CONFIG[category];
        const used = getUsedNumbers(category);
        numbers[category] = getRandomNumbers(config.pick, config.total, used);
    });

    return numbers;
}

// Descriptive topics for Q4
const DESCRIPTIVE_TOPICS = {
    aircraftSystems: [
        "Hydraulic System architecture and operation",
        "Pneumatic System (bleed air) and its applications",
        "Landing Gear system components and operation",
        "Flight Control System (fly-by-wire vs conventional)",
        "Fuel System architecture and fuel management",
        "Pressurization System and cabin altitude control",
        "Ice and Rain Protection Systems",
        "Fire Detection and Extinguishing Systems",
        "Oxygen System types and operation",
        "Electrical Power Generation and Distribution",
        "APU (Auxiliary Power Unit) operation",
        "Engine Oil System and cooling",
        "Turbofan Engine components and operation",
        "Autopilot System architecture",
        "Flight Management System (FMS)",
        "Inertial Navigation System (INS/IRS)",
        "TCAS (Traffic Collision Avoidance System)",
        "EGPWS (Enhanced Ground Proximity Warning System)",
        "Weather Radar system operation",
        "Anti-skid and Autobrake systems"
    ],
    weatherPhenomena: [
        "Thunderstorm development and hazards",
        "Wind Shear and Microburst",
        "Clear Air Turbulence (CAT)",
        "Mountain Waves and rotor",
        "Icing conditions and types of ice",
        "Fog formation types and conditions",
        "Frontal systems and associated weather",
        "Jet Streams characteristics and effects",
        "Tropical Cyclones/Hurricanes",
        "Volcanic Ash hazards",
        "Low Level Wind Shear",
        "Cumulonimbus cloud hazards",
        "Temperature Inversions",
        "Sea Breeze and Land Breeze effects",
        "Visibility phenomena (haze, mist, precipitation)",
        "Wake Turbulence",
        "Orographic lifting and precipitation",
        "Convective weather development",
        "High altitude weather phenomena",
        "Sandstorms and Dust Devils"
    ]
};

// Claude API Integration for ATPL Questions
async function generateATPLQuestionsWithAI(apiKey, questionCount = 4) {
    // Number of multiple choice questions (total - 1 for descriptive)
    const mcCount = questionCount - 1;

    // Select subjects for multiple choice, trying to avoid recently used ones
    const usedSubjects = getUsedSubjects();
    let availableSubjects = ATPL_SUBJECTS.filter(s => !usedSubjects.some(used => s.includes(used)));

    if (availableSubjects.length < mcCount) {
        availableSubjects = [...ATPL_SUBJECTS];
    }

    const shuffled = availableSubjects.sort(() => Math.random() - 0.5);
    const selectedSubjects = shuffled.slice(0, mcCount);

    // Select a random descriptive topic
    const topicCategory = Math.random() > 0.5 ? 'aircraftSystems' : 'weatherPhenomena';
    const topicList = DESCRIPTIVE_TOPICS[topicCategory];
    const descriptiveTopic = topicList[Math.floor(Math.random() * topicList.length)];
    const topicCategoryName = topicCategory === 'aircraftSystems' ? 'Aircraft Systems' : 'Meteorology';

    // Build subject list for prompt
    const subjectsList = selectedSubjects.map((s, i) => `${i + 1}. ${s}`).join('\n');

    // Build example MC questions structure
    const mcExamples = selectedSubjects.map((_, i) => {
        const letters = ['A', 'B', 'C', 'D'];
        return `    {
      "subject": "Subject Area Name",
      "question": "The question text",
      "options": {
        "A": "First option text",
        "B": "Second option text",
        "C": "Third option text",
        "D": "Fourth option text"
      },
      "correctAnswer": "${letters[i % 4]}",
      "explanation": "Detailed explanation of why this answer is correct and why others are wrong"
    }`;
    }).join(',\n');

    const prompt = `You are an EASA ATPL (Airline Transport Pilot License) exam instructor specializing in European Aviation Safety Agency regulations and standards. Generate ATPL exam questions for a pilot student preparing for EASA examinations.

IMPORTANT: All questions MUST be based on EASA regulations, European aviation standards, and EASA ATPL theoretical knowledge syllabus. Reference specific EASA regulations (e.g., EU-OPS, Part-FCL, Part-OPS, CS-25, AMC/GM) where applicable.

PART 1: Generate exactly ${mcCount} MULTIPLE CHOICE questions (A, B, C, D format) from these subjects:
${subjectsList}

Each multiple choice question must:
- Be based on EASA ATPL theoretical knowledge requirements
- Reference EASA/European regulations where relevant (not FAA or other authorities)
- Have exactly 4 options (A, B, C, D)
- Have only ONE correct answer
- Include plausible distractors that test understanding
- Be at EASA ATPL exam difficulty level
- Use appropriate aviation units (NM, ft, kts for navigation; hPa for altimetry as per transition altitude)

PART 2: Generate 1 DESCRIPTIVE question about: "${descriptiveTopic}"
This should ask the student to describe/explain this system or phenomenon in detail, with reference to EASA standards where applicable.

Format your response as JSON with this EXACT structure:
{
  "multipleChoice": [
${mcExamples}
  ],
  "descriptive": {
    "subject": "${topicCategoryName}",
    "topic": "${descriptiveTopic}",
    "question": "Describe in detail...",
    "keyPoints": ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"],
    "fullAnswer": "A comprehensive answer covering all aspects of this topic..."
  }
}

Make the multiple choice questions challenging with realistic distractors. The descriptive question should prompt a thorough explanation.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 3500,
            messages: [
                {
                    role: 'user',
                    content: prompt
                }
            ]
        })
    });

    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
    }

    const data = await response.json();
    const content = data.content[0].text;

    // Parse the JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        throw new Error('Could not parse AI response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    return {
        multipleChoice: parsed.multipleChoice,
        descriptive: parsed.descriptive
    };
}

function generateFluencyTask() {
    const usedTasks = getUsedFluencyTasks();

    const taskCategory = FLUENCY_TASKS[Math.floor(Math.random() * FLUENCY_TASKS.length)];

    let task;
    let attempts = 0;
    do {
        task = taskCategory.tasks[Math.floor(Math.random() * taskCategory.tasks.length)];
        attempts++;
    } while (usedTasks.includes(JSON.stringify({ type: taskCategory.type, task: task })) && attempts < 20);

    return {
        type: taskCategory.type,
        task: task,
        tips: FLUENCY_TIPS[taskCategory.type]
    };
}

// Display Functions
function displayExamNumbers(numbers, existingScores = null) {
    Object.keys(numbers).forEach(category => {
        const element = document.getElementById(category);
        if (element) {
            element.textContent = numbers[category].join(', ');
            element.classList.add('generated');
        }

        // Add individual score inputs for each exam number
        const examItem = element?.closest('.exam-item');
        if (examItem && !examItem.querySelector('.individual-scores-container')) {
            const scoresContainer = document.createElement('div');
            scoresContainer.className = 'individual-scores-container';

            // Get existing scores for this category (now indexed by exam number)
            const categoryScores = existingScores && existingScores[category] ? existingScores[category] : {};

            // Create input for each exam number
            const examNumbersHTML = numbers[category].map(num => {
                const existingScore = categoryScores[num];
                const savedPercentage = existingScore ? existingScore.percentage : '';
                const savedTime = existingScore ? existingScore.timeOfDay : '';
                const savedNote = existingScore ? existingScore.note : '';
                const isSaved = existingScore && existingScore.percentage !== null;

                return `
                    <div class="individual-score-item" data-category="${category}" data-exam-num="${num}">
                        <span class="exam-num-label">#${num}</span>
                        <input type="number"
                               class="score-percentage-individual"
                               data-category="${category}"
                               data-exam-num="${num}"
                               min="0"
                               max="100"
                               placeholder="%"
                               value="${savedPercentage !== null && savedPercentage !== '' ? savedPercentage : ''}"
                               ${isSaved ? 'disabled' : ''}>
                        <button class="btn-save-individual ${isSaved ? 'saved' : ''}"
                                data-category="${category}"
                                data-exam-num="${num}"
                                ${isSaved ? 'disabled' : ''}>
                            ${isSaved ? '✓' : 'Save'}
                        </button>
                        <button class="btn-add-note ${savedNote ? 'has-note' : ''}"
                                data-category="${category}"
                                data-exam-num="${num}"
                                title="${savedNote ? 'View/Edit note' : 'Add note'}">
                            ${savedNote ? '📝' : '+'}
                        </button>
                        ${isSaved && savedTime ? `<span class="saved-time-mini">${savedTime}</span>` : ''}
                        ${savedNote ? `<div class="note-preview" title="${savedNote}">${savedNote.length > 20 ? savedNote.substring(0, 20) + '...' : savedNote}</div>` : ''}
                    </div>
                `;
            }).join('');

            scoresContainer.innerHTML = `
                <div class="individual-scores-header">Record score for each test:</div>
                <div class="individual-scores-grid">
                    ${examNumbersHTML}
                </div>
            `;
            examItem.appendChild(scoresContainer);
        }
    });

    // Add event listeners for individual save buttons
    document.querySelectorAll('.btn-save-individual:not([data-listener])').forEach(btn => {
        btn.setAttribute('data-listener', 'true');
        btn.addEventListener('click', handleSaveIndividualScore);
    });

    // Add event listeners for note buttons
    document.querySelectorAll('.btn-add-note:not([data-listener])').forEach(btn => {
        btn.setAttribute('data-listener', 'true');
        btn.addEventListener('click', handleAddNote);
    });
}

function handleSaveIndividualScore(e) {
    const category = e.target.dataset.category;
    const examNum = parseInt(e.target.dataset.examNum);
    const container = e.target.closest('.individual-score-item');
    const percentageInput = container.querySelector('.score-percentage-individual');

    const percentage = percentageInput.value ? parseFloat(percentageInput.value) : null;

    if (percentage === null) {
        alert('Please enter a score percentage');
        return;
    }

    if (percentage < 0 || percentage > 100) {
        alert('Score must be between 0 and 100');
        return;
    }

    const today = getTodayString();
    const history = getHistory();

    if (!history[today]) {
        alert('Please generate today\'s practice first');
        return;
    }

    const now = new Date();
    const timeOfDay = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    // Initialize scores object structure: scores[category][examNum]
    if (!history[today].scores) {
        history[today].scores = {};
    }
    if (!history[today].scores[category]) {
        history[today].scores[category] = {};
    }

    // Save score for this specific exam number
    history[today].scores[category][examNum] = {
        percentage,
        timeOfDay,
        hour: now.getHours(),
        savedAt: now.toISOString()
    };

    saveHistory(history);

    // Also add to performance tracking (with exam number in the entry)
    addPerformanceEntry(
        category,
        percentage,
        today,
        examNum
    );

    // Update UI
    percentageInput.disabled = true;
    e.target.disabled = true;
    e.target.textContent = '✓';
    e.target.classList.add('saved');

    // Add time display
    const timeSpan = document.createElement('span');
    timeSpan.className = 'saved-time-mini';
    timeSpan.textContent = timeOfDay;
    container.appendChild(timeSpan);

    // Update history display
    displayHistory();

    // Update performance analytics if visible
    if (document.getElementById('performanceContent')) {
        displayPerformanceAnalytics();
    }
}

function handleAddNote(e) {
    const category = e.target.dataset.category;
    const examNum = parseInt(e.target.dataset.examNum);
    const container = e.target.closest('.individual-score-item');

    const today = getTodayString();
    const history = getHistory();

    // Get existing note if any
    let existingNote = '';
    if (history[today]?.scores?.[category]?.[examNum]?.note) {
        existingNote = history[today].scores[category][examNum].note;
    }

    // Prompt user for note
    const note = prompt(`Add note for Test #${examNum} (${EXAM_LABELS[category] || category}):`, existingNote);

    // If user cancelled, do nothing
    if (note === null) return;

    // Initialize structure if needed
    if (!history[today]) {
        history[today] = { scores: {} };
    }
    if (!history[today].scores) {
        history[today].scores = {};
    }
    if (!history[today].scores[category]) {
        history[today].scores[category] = {};
    }
    if (!history[today].scores[category][examNum]) {
        history[today].scores[category][examNum] = {};
    }

    // Save the note
    history[today].scores[category][examNum].note = note;
    saveHistory(history);

    // Update UI
    const noteBtn = e.target;
    const existingPreview = container.querySelector('.note-preview');

    if (note) {
        noteBtn.textContent = '📝';
        noteBtn.classList.add('has-note');
        noteBtn.title = 'View/Edit note';

        if (existingPreview) {
            existingPreview.textContent = note.length > 20 ? note.substring(0, 20) + '...' : note;
            existingPreview.title = note;
        } else {
            const notePreview = document.createElement('div');
            notePreview.className = 'note-preview';
            notePreview.textContent = note.length > 20 ? note.substring(0, 20) + '...' : note;
            notePreview.title = note;
            container.appendChild(notePreview);
        }
    } else {
        noteBtn.textContent = '+';
        noteBtn.classList.remove('has-note');
        noteBtn.title = 'Add note';

        if (existingPreview) {
            existingPreview.remove();
        }
    }
}

function displayATPLQuestions(questions, existingAnswers = null) {
    const container = document.getElementById('atplQuestions');
    container.innerHTML = '';

    // Display multiple choice questions
    if (questions.multipleChoice) {
        questions.multipleChoice.forEach((q, index) => {
            const existingAnswer = existingAnswers?.multipleChoice?.[index];
            const isAnswered = existingAnswer?.selectedAnswer !== undefined;
            const wasCorrect = existingAnswer?.isCorrect;

            const element = document.createElement('div');
            element.className = 'atpl-item atpl-multiple-choice generated';
            element.innerHTML = `
                <div class="question-header">
                    <span class="question-number">Q${index + 1}</span>
                    <span class="question-subject">${q.subject}</span>
                    <span class="question-type-badge mc-badge">Multiple Choice</span>
                    ${isAnswered ? `<span class="answer-result ${wasCorrect ? 'correct' : 'incorrect'}">${wasCorrect ? '✓ Correct' : '✗ Incorrect'}</span>` : ''}
                </div>
                <p class="question-text">${q.question}</p>
                <div class="options-container ${isAnswered ? 'answered' : ''}" id="options-${index}" data-question-index="${index}" data-correct-answer="${q.correctAnswer}" data-subject="${q.subject}">
                    ${Object.entries(q.options).map(([letter, text]) => {
                        let optionClass = 'option-item selectable';
                        if (isAnswered) {
                            optionClass = 'option-item';
                            if (letter === q.correctAnswer) {
                                optionClass += ' correct';
                            } else if (letter === existingAnswer?.selectedAnswer) {
                                optionClass += ' incorrect selected-wrong';
                            }
                        }
                        return `
                        <div class="${optionClass}" data-letter="${letter}" data-correct="${letter === q.correctAnswer}">
                            <span class="option-letter">${letter}</span>
                            <span class="option-text">${text}</span>
                        </div>
                    `;
                    }).join('')}
                </div>
                <div class="atpl-answer" ${isAnswered ? '' : 'style="display:none;"'}>
                    <div class="atpl-answer-content ${isAnswered ? 'visible' : ''}" id="answer-${index}">
                        <h4>✓ Correct Answer: ${q.correctAnswer}</h4>
                        <p>${q.explanation}</p>
                    </div>
                </div>
            `;
            container.appendChild(element);
        });

        // Add click listeners for selectable options
        document.querySelectorAll('.option-item.selectable').forEach(option => {
            option.addEventListener('click', handleAtplAnswerSelection);
        });
    }

    // Display descriptive question (last question)
    if (questions.descriptive) {
        const q = questions.descriptive;
        const descIndex = questions.multipleChoice ? questions.multipleChoice.length : 0;
        const existingDescAnswer = existingAnswers?.descriptive;

        const element = document.createElement('div');
        element.className = 'atpl-item atpl-descriptive generated';
        element.innerHTML = `
            <div class="question-header">
                <span class="question-number">Q${descIndex + 1}</span>
                <span class="question-subject">${q.subject}</span>
                <span class="question-type-badge desc-badge">Descriptive</span>
            </div>
            <div class="descriptive-topic">
                <strong>Topic:</strong> ${q.topic}
            </div>
            <p class="question-text">${q.question}</p>
            <div class="descriptive-notes-container">
                <label>Your notes/answer:</label>
                <textarea class="descriptive-notes" id="descriptive-notes-${descIndex}" placeholder="Write your answer notes here..." rows="4">${existingDescAnswer?.notes || ''}</textarea>
                <button class="btn btn-small save-descriptive-notes" data-index="${descIndex}">Save Notes</button>
                <span class="descriptive-saved-indicator" id="desc-saved-${descIndex}">${existingDescAnswer?.notes ? '✓ Saved' : ''}</span>
            </div>
            <div class="atpl-answer">
                <button class="atpl-answer-toggle" onclick="toggleAnswer(${descIndex})">Show Answer</button>
                <div class="atpl-answer-content" id="answer-${descIndex}">
                    <h4>Key Points to Cover:</h4>
                    <ul class="key-points">
                        ${q.keyPoints.map(point => `<li>${point}</li>`).join('')}
                    </ul>
                    <h4>Full Answer:</h4>
                    <p>${q.fullAnswer}</p>
                </div>
            </div>
        `;
        container.appendChild(element);

        // Add listener for descriptive notes save
        element.querySelector('.save-descriptive-notes').addEventListener('click', handleSaveDescriptiveNotes);
    }
}

// Handle ATPL answer selection
function handleAtplAnswerSelection(e) {
    const optionItem = e.target.closest('.option-item');
    if (!optionItem || !optionItem.classList.contains('selectable')) return;

    const optionsContainer = optionItem.closest('.options-container');
    const questionIndex = parseInt(optionsContainer.dataset.questionIndex);
    const correctAnswer = optionsContainer.dataset.correctAnswer;
    const subject = optionsContainer.dataset.subject;
    const selectedLetter = optionItem.dataset.letter;
    const isCorrect = selectedLetter === correctAnswer;

    // Mark container as answered
    optionsContainer.classList.add('answered');

    // Remove selectable class from all options
    optionsContainer.querySelectorAll('.option-item').forEach(opt => {
        opt.classList.remove('selectable');
        const letter = opt.dataset.letter;
        if (letter === correctAnswer) {
            opt.classList.add('correct');
        } else if (letter === selectedLetter && !isCorrect) {
            opt.classList.add('incorrect', 'selected-wrong');
        }
    });

    // Show answer section
    const atplItem = optionsContainer.closest('.atpl-item');
    const answerSection = atplItem.querySelector('.atpl-answer');
    const answerContent = atplItem.querySelector('.atpl-answer-content');
    answerSection.style.display = 'block';
    answerContent.classList.add('visible');

    // Add result indicator to header
    const header = atplItem.querySelector('.question-header');
    if (!header.querySelector('.answer-result')) {
        const resultSpan = document.createElement('span');
        resultSpan.className = `answer-result ${isCorrect ? 'correct' : 'incorrect'}`;
        resultSpan.textContent = isCorrect ? '✓ Correct' : '✗ Incorrect';
        header.appendChild(resultSpan);
    }

    // Save to history
    const today = getTodayString();
    const history = getHistory();

    if (history[today]) {
        if (!history[today].atplAnswers) {
            history[today].atplAnswers = { multipleChoice: {} };
        }
        history[today].atplAnswers.multipleChoice[questionIndex] = {
            selectedAnswer: selectedLetter,
            correctAnswer: correctAnswer,
            isCorrect: isCorrect,
            subject: subject
        };
        saveHistory(history);

        // Track ATPL performance
        addAtplPerformanceEntry(subject, isCorrect, questionIndex, today);
    }
}

// Handle saving descriptive notes
function handleSaveDescriptiveNotes(e) {
    const index = e.target.dataset.index;
    const textarea = document.getElementById(`descriptive-notes-${index}`);
    const notes = textarea.value;

    const today = getTodayString();
    const history = getHistory();

    if (history[today]) {
        if (!history[today].atplAnswers) {
            history[today].atplAnswers = { multipleChoice: {}, descriptive: {} };
        }
        history[today].atplAnswers.descriptive = { notes };
        saveHistory(history);

        const indicator = document.getElementById(`desc-saved-${index}`);
        indicator.textContent = '✓ Saved';
    }
}

function displayATPLError(message) {
    const container = document.getElementById('atplQuestions');
    container.innerHTML = `
        <div class="error-message">
            <strong>Error generating ATPL questions:</strong>
            <p>${message}</p>
            <p>Please check your API key and try again.</p>
        </div>
    `;
}

function displayFluencyTask(task, existingNotes = null) {
    document.getElementById('taskType').textContent = task.type;
    document.getElementById('taskContent').textContent = task.task;

    const tipsElement = document.getElementById('taskTips');
    if (task.tips && task.tips.length > 0) {
        tipsElement.innerHTML = `
            <strong>Speaking Tips:</strong>
            <ul>
                ${task.tips.map(tip => `<li>${tip}</li>`).join('')}
            </ul>
        `;
    }

    // Show and populate notes container
    const notesContainer = document.getElementById('fluencyNotesContainer');
    const notesTextarea = document.getElementById('fluencyNotes');
    const saveBtn = document.getElementById('saveFluencyNotes');
    const savedIndicator = document.getElementById('fluencyNotesSaved');

    notesContainer.style.display = 'block';

    if (existingNotes) {
        notesTextarea.value = existingNotes;
        savedIndicator.textContent = '✓ Saved';
    }

    // Add save listener
    saveBtn.onclick = function() {
        const notes = notesTextarea.value;
        const today = getTodayString();
        const history = getHistory();

        if (history[today]) {
            history[today].fluencyNotes = notes;
            saveHistory(history);
            savedIndicator.textContent = '✓ Saved';
        }
    };

    document.querySelector('.fluency-task').classList.add('generated');
}

function getATPLTopicsFromQuestions(atplQuestions) {
    if (!atplQuestions) return 'N/A';

    const topics = [];

    // Handle new structure
    if (atplQuestions.multipleChoice) {
        atplQuestions.multipleChoice.forEach(q => {
            if (q.subject) topics.push(q.subject);
        });
    }
    if (atplQuestions.descriptive && atplQuestions.descriptive.topic) {
        topics.push(atplQuestions.descriptive.topic);
    }

    // Handle old structure (array)
    if (Array.isArray(atplQuestions)) {
        atplQuestions.forEach(q => {
            if (q.subject) topics.push(q.subject);
        });
    }

    return topics.length > 0 ? topics.join(', ') : 'N/A';
}

function displayHistory() {
    const history = getHistory();
    const historyList = document.getElementById('historyList');
    const dates = Object.keys(history).sort().reverse();

    if (dates.length === 0) {
        historyList.innerHTML = '<p class="no-history">No history yet</p>';
        return;
    }

    const today = getTodayString();

    historyList.innerHTML = dates.map(date => {
        const day = history[date];
        const isToday = date === today;

        let examSummary = '';
        if (day.examNumbers) {
            examSummary = Object.entries(day.examNumbers)
                .map(([key, nums]) => `${key}: ${nums.join(', ')}`)
                .join(' | ');
        }

        // Calculate performance summary if scores exist (new nested structure)
        let performanceSummary = '';
        if (day.scores) {
            const allScores = [];
            Object.values(day.scores).forEach(categoryScores => {
                // Handle new structure: scores[category][examNum] = {percentage, ...}
                if (typeof categoryScores === 'object' && categoryScores !== null) {
                    Object.values(categoryScores).forEach(score => {
                        if (score && score.percentage !== null && score.percentage !== undefined) {
                            allScores.push(score.percentage);
                        }
                    });
                }
            });
            if (allScores.length > 0) {
                const avgScore = allScores.reduce((sum, s) => sum + s, 0) / allScores.length;
                performanceSummary = `<br><strong>Exam Avg:</strong> ${avgScore.toFixed(1)}% (${allScores.length} tests)`;
            }
        }

        // Calculate ATPL performance
        let atplSummary = '';
        if (day.atplAnswers?.multipleChoice) {
            const answers = Object.values(day.atplAnswers.multipleChoice);
            if (answers.length > 0) {
                const correctCount = answers.filter(a => a.isCorrect).length;
                atplSummary = `<br><strong>ATPL:</strong> ${correctCount}/${answers.length} correct`;
            }
        }

        return `
            <div class="history-item ${isToday ? 'today' : ''}">
                <div class="history-date">
                    ${formatDate(date)} ${isToday ? '<span class="status-badge generated">Today</span>' : ''}
                </div>
                <div class="history-details">
                    <strong>Exam Numbers:</strong> ${examSummary || 'N/A'}<br>
                    <strong>ATPL Topics:</strong> ${getATPLTopicsFromQuestions(day.atplQuestions)}<br>
                    <strong>Fluency Task:</strong> ${day.fluencyTask ? day.fluencyTask.type : 'N/A'}${performanceSummary}${atplSummary}
                </div>
            </div>
        `;
    }).join('');
}

function loadTodayData() {
    const today = getTodayString();
    const history = getHistory();

    if (history[today]) {
        const todayData = history[today];
        displayExamNumbers(todayData.examNumbers, todayData.scores);
        displayATPLQuestions(todayData.atplQuestions, todayData.atplAnswers);
        displayFluencyTask(todayData.fluencyTask, todayData.fluencyNotes);
        document.getElementById('generateBtn').textContent = 'Already Generated Today';
        document.getElementById('generateBtn').disabled = true;

        // Set the question count selector to match generated questions
        if (todayData.atplQuestions) {
            const mcCount = todayData.atplQuestions.multipleChoice?.length || 3;
            const totalCount = mcCount + 1; // +1 for descriptive
            document.querySelectorAll('.count-btn').forEach(btn => {
                btn.classList.toggle('active', parseInt(btn.dataset.count) === totalCount);
            });
            selectedAtplCount = totalCount;
        }
    }
}

// Toggle answer visibility for descriptive questions
window.toggleAnswer = function(index) {
    const answerContent = document.getElementById(`answer-${index}`);
    const button = answerContent.previousElementSibling;

    if (answerContent.classList.contains('visible')) {
        answerContent.classList.remove('visible');
        button.textContent = 'Show Answer';
    } else {
        answerContent.classList.add('visible');
        button.textContent = 'Hide Answer';
    }
};

// Toggle answer for multiple choice questions with highlighting
window.toggleMCAnswer = function(index, correctAnswer) {
    const answerContent = document.getElementById(`answer-${index}`);
    const button = answerContent.previousElementSibling;
    const optionsContainer = document.getElementById(`options-${index}`);
    const options = optionsContainer.querySelectorAll('.option-item');

    if (answerContent.classList.contains('visible')) {
        // Hide answer
        answerContent.classList.remove('visible');
        button.textContent = 'Show Answer';
        options.forEach(opt => {
            opt.classList.remove('correct', 'incorrect');
        });
    } else {
        // Show answer and highlight
        answerContent.classList.add('visible');
        button.textContent = 'Hide Answer';
        options.forEach(opt => {
            const letter = opt.getAttribute('data-letter');
            if (letter === correctAnswer) {
                opt.classList.add('correct');
            } else {
                opt.classList.add('incorrect');
            }
        });
    }
};

// Main Generation Function
async function generateDaily() {
    const today = getTodayString();
    const history = getHistory();

    if (history[today]) {
        alert('Already generated for today! Come back tomorrow for new practice items.');
        return;
    }

    const apiKey = getApiKey();
    if (!apiKey) {
        alert('Please enter your Anthropic API key first.');
        document.getElementById('apiKey').focus();
        return;
    }

    const generateBtn = document.getElementById('generateBtn');
    const atplLoading = document.getElementById('atplLoading');

    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';

    // Generate exam numbers and fluency task immediately
    const examNumbers = generateExamNumbers();
    const fluencyTask = generateFluencyTask();

    displayExamNumbers(examNumbers);
    displayFluencyTask(fluencyTask);

    // Show loading for ATPL questions
    document.getElementById('atplQuestions').style.display = 'none';
    atplLoading.style.display = 'block';

    try {
        // Generate ATPL questions with AI using selected count
        const atplQuestions = await generateATPLQuestionsWithAI(apiKey, selectedAtplCount);

        atplLoading.style.display = 'none';
        document.getElementById('atplQuestions').style.display = 'flex';

        displayATPLQuestions(atplQuestions);

        // Save to history
        history[today] = {
            examNumbers,
            atplQuestions,
            atplQuestionCount: selectedAtplCount,
            fluencyTask,
            generatedAt: new Date().toISOString()
        };
        saveHistory(history);

        displayHistory();

        generateBtn.textContent = 'Generated for Today!';
    } catch (error) {
        console.error('Error generating ATPL questions:', error);

        atplLoading.style.display = 'none';
        document.getElementById('atplQuestions').style.display = 'flex';

        displayATPLError(error.message);

        generateBtn.disabled = false;
        generateBtn.textContent = 'Retry Generation';
    }
}

function resetHistory() {
    if (confirm('Are you sure you want to reset all history? This will allow numbers to repeat from the beginning.')) {
        clearHistory();
        localStorage.removeItem(PERFORMANCE_KEY);
        location.reload();
    }
}

// Performance Analytics
function displayPerformanceAnalytics() {
    const container = document.getElementById('performanceContent');
    if (!container) return;

    const performance = getPerformanceData();

    if (performance.length === 0) {
        container.innerHTML = '<p class="no-history">No performance data yet. Complete some exercises and save your scores!</p>';
        return;
    }

    // Group by category
    const byCategory = {};
    performance.forEach(entry => {
        if (!byCategory[entry.category]) {
            byCategory[entry.category] = [];
        }
        byCategory[entry.category].push(entry);
    });

    // Calculate stats for each category
    const categoryStats = Object.entries(byCategory).map(([category, entries]) => {
        const scores = entries.map(e => e.percentage);

        return {
            category,
            label: EXAM_LABELS[category] || category,
            count: entries.length,
            avgScore: scores.reduce((a, b) => a + b, 0) / scores.length,
            minScore: Math.min(...scores),
            maxScore: Math.max(...scores),
            trend: calculateTrend(scores),
            recentEntries: entries.slice(-5).reverse()
        };
    });

    // Sort by average score (lowest first to highlight areas needing improvement)
    categoryStats.sort((a, b) => a.avgScore - b.avgScore);

    // Overall stats
    const allScores = performance.map(e => e.percentage);
    const overallAvg = allScores.reduce((a, b) => a + b, 0) / allScores.length;

    // Time of day analysis
    const timeOfDayStats = analyzeTimeOfDay(performance);

    container.innerHTML = `
        <div class="performance-overview">
            <div class="overview-stat">
                <span class="stat-value">${overallAvg.toFixed(1)}%</span>
                <span class="stat-label">Overall Average</span>
            </div>
            <div class="overview-stat">
                <span class="stat-value">${performance.length}</span>
                <span class="stat-label">Total Entries</span>
            </div>
            <div class="overview-stat">
                <span class="stat-value">${Object.keys(byCategory).length}</span>
                <span class="stat-label">Categories</span>
            </div>
        </div>

        ${timeOfDayStats && timeOfDayStats.periods.length > 0 ? `
        <h4>Time of Day Analysis</h4>
        <div class="time-analysis">
            ${timeOfDayStats.bestPeriod ? `
                <div class="best-time-banner">
                    <span class="best-time-icon">🌟</span>
                    <span class="best-time-text">Best performance: <strong>${timeOfDayStats.bestPeriod.name}</strong> (${timeOfDayStats.bestPeriod.avgScore.toFixed(1)}% avg)</span>
                </div>
            ` : ''}
            <div class="time-periods">
                ${timeOfDayStats.periods.map(period => `
                    <div class="time-period-card ${period.key === timeOfDayStats.bestPeriod?.key ? 'best-period' : ''}">
                        <span class="period-name">${period.name}</span>
                        <span class="period-avg ${getScoreClass(period.avgScore)}">${period.avgScore.toFixed(1)}%</span>
                        <span class="period-count">${period.count} session${period.count !== 1 ? 's' : ''}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <h4>Performance by Category</h4>
        <div class="category-stats">
            ${categoryStats.map(stat => `
                <div class="category-stat-card ${getScoreClass(stat.avgScore)}">
                    <div class="category-header">
                        <span class="category-name">${stat.label}</span>
                        <span class="category-trend ${stat.trend}">${getTrendIcon(stat.trend)}</span>
                    </div>
                    <div class="category-avg">
                        <span class="avg-score">${stat.avgScore.toFixed(1)}%</span>
                        <span class="score-range">(${stat.minScore}% - ${stat.maxScore}%)</span>
                    </div>
                    <div class="category-details">
                        <span>${stat.count} attempt${stat.count !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="recent-scores">
                        ${stat.recentEntries.map(e => `
                            <span class="mini-score ${getScoreClass(e.percentage)}" title="${e.date}${e.timeOfDay ? ' at ' + e.timeOfDay : ''}">
                                ${e.percentage}%
                            </span>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>

        <h4>Recent Activity</h4>
        <div class="recent-activity">
            ${performance.slice(-10).reverse().map(entry => `
                <div class="activity-item">
                    <span class="activity-category">${EXAM_LABELS[entry.category] || entry.category}</span>
                    <span class="activity-score ${getScoreClass(entry.percentage)}">${entry.percentage}%</span>
                    <span class="activity-date">${formatDate(entry.date)}</span>
                    ${entry.timeOfDay ? `<span class="activity-time">at ${entry.timeOfDay}</span>` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

function calculateTrend(scores) {
    if (scores.length < 2) return 'neutral';
    const recent = scores.slice(-3);
    const older = scores.slice(-6, -3);
    if (older.length === 0) return 'neutral';

    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;

    if (recentAvg > olderAvg + 5) return 'up';
    if (recentAvg < olderAvg - 5) return 'down';
    return 'neutral';
}

function getTrendIcon(trend) {
    if (trend === 'up') return '↑';
    if (trend === 'down') return '↓';
    return '→';
}

function getScoreClass(score) {
    if (score >= 80) return 'score-excellent';
    if (score >= 60) return 'score-good';
    if (score >= 40) return 'score-fair';
    return 'score-poor';
}

function analyzeTimeOfDay(performance) {
    if (performance.length === 0) return null;

    // Group entries by time periods
    const periods = {
        morning: { name: 'Morning (6-12)', start: 6, end: 12, scores: [], count: 0 },
        afternoon: { name: 'Afternoon (12-18)', start: 12, end: 18, scores: [], count: 0 },
        evening: { name: 'Evening (18-24)', start: 18, end: 24, scores: [], count: 0 },
        night: { name: 'Night (0-6)', start: 0, end: 6, scores: [], count: 0 }
    };

    performance.forEach(entry => {
        const hour = entry.hour !== undefined ? entry.hour : new Date(entry.timestamp).getHours();

        for (const [key, period] of Object.entries(periods)) {
            if (key === 'night') {
                if (hour >= 0 && hour < 6) {
                    period.scores.push(entry.percentage);
                    period.count++;
                }
            } else if (hour >= period.start && hour < period.end) {
                period.scores.push(entry.percentage);
                period.count++;
            }
        }
    });

    // Calculate averages and find best period
    const periodStats = Object.entries(periods).map(([key, period]) => ({
        key,
        name: period.name,
        count: period.count,
        avgScore: period.count > 0
            ? period.scores.reduce((a, b) => a + b, 0) / period.scores.length
            : null
    })).filter(p => p.count > 0);

    // Find best performing time period
    let bestPeriod = null;
    if (periodStats.length > 0) {
        bestPeriod = periodStats.reduce((best, current) =>
            (current.avgScore > (best.avgScore || 0)) ? current : best
        , periodStats[0]);
    }

    return {
        periods: periodStats,
        bestPeriod,
        totalEntries: performance.length
    };
}

function togglePerformancePanel() {
    const panel = document.getElementById('performancePanel');
    const content = document.getElementById('performanceContent');

    if (panel.classList.contains('expanded')) {
        panel.classList.remove('expanded');
    } else {
        panel.classList.add('expanded');
        displayPerformanceAnalytics();
    }
}

// Password Authentication
function checkPassword() {
    const passwordInput = document.getElementById('passwordInput');
    const passwordError = document.getElementById('passwordError');
    const enteredPassword = passwordInput.value;

    if (enteredPassword === ACCESS_PASSWORD) {
        // Store authentication in session
        sessionStorage.setItem(PASSWORD_KEY, 'true');
        showMainContent();
    } else {
        passwordError.textContent = 'Incorrect password. Please try again.';
        passwordInput.value = '';
        passwordInput.focus();
    }
}

function showMainContent() {
    document.getElementById('passwordGate').style.display = 'none';
    document.getElementById('mainContent').style.display = 'block';
    initializeApp();
}

function initializeApp() {
    // Display current date
    document.getElementById('currentDate').textContent = formatDate(getTodayString());

    // Setup ATPL question count selector
    document.querySelectorAll('.count-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Check if already generated today
            const today = getTodayString();
            const history = getHistory();
            if (history[today]) {
                alert('Questions already generated for today. Count cannot be changed.');
                return;
            }

            // Update selection
            document.querySelectorAll('.count-btn').forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            selectedAtplCount = parseInt(this.dataset.count);
        });
    });

    // Load today's data if exists
    loadTodayData();

    // Display history
    displayHistory();

    // Event listeners
    document.getElementById('generateBtn').addEventListener('click', generateDaily);
    document.getElementById('resetBtn').addEventListener('click', resetHistory);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check if already authenticated in this session
    if (sessionStorage.getItem(PASSWORD_KEY) === 'true') {
        showMainContent();
    } else {
        // Show password gate
        document.getElementById('passwordGate').style.display = 'flex';

        // Setup password handlers
        const passwordInput = document.getElementById('passwordInput');
        const passwordSubmit = document.getElementById('passwordSubmit');

        passwordSubmit.addEventListener('click', checkPassword);
        passwordInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                checkPassword();
            }
        });

        passwordInput.focus();
    }
});
