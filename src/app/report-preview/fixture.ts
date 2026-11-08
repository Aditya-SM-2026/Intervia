import type { InterviewDetailResponse } from "@/lib/interviews/scorecard.types";

/**
 * A report shaped like a real 30-minute interview (AI Developer, Oct 29), with
 * names and wording made up. Local design preview only.
 */
const start = Date.parse("2026-10-29T07:00:39Z");
const at = (seconds: number) => new Date(start + seconds * 1000).toISOString();

const topics = [
  { id: "llm-integration", name: "Integrating LLM APIs into working applications", minutes: 7 },
  { id: "retrieval-grounding", name: "Retrieval, semantic search and grounding", minutes: 7 },
  { id: "backend-apis", name: "Building backend services and REST APIs", minutes: 6 },
  { id: "deployment-reliability", name: "Deploying with Docker and AWS", minutes: 5 },
  { id: "frontend-delivery", name: "Building the user-facing side in React", minutes: 5 },
];

// 21 answers spread over the five topics, with the interviewer's questions between.
const answerStarts = [14, 130, 272, 298, 465, 624, 649, 761, 1022, 1091, 1164, 1199, 1316, 1452, 1474, 1514, 1567, 1606, 1680, 1750, 1790];
const turns = answerStarts.flatMap((answerAt, index) => {
  const topic = topics[Math.min(4, Math.floor(index / 4.2))];
  const length = [95, 125, 17, 163, 84, 30, 230, 45, 49, 85, 134, 23, 29, 35, 40, 26, 50, 38, 60, 32, 18][index];
  return [
    { roomId: "preview", seq: index * 2 + 1, speaker: "interviewer", text: `Question ${index + 1} about ${topic.name.toLowerCase()}.`, startedAt: at(answerAt - 12), endedAt: at(answerAt - 2), responseLatencyMs: null, interrupted: false, phase: "topic", competencyId: topic.id },
    { roomId: "preview", seq: index * 2 + 2, speaker: "candidate", text: "So actually I have used the OpenAI API in my Sigma GPT project, where the frontend sends the prompt to the backend and the backend calls the API and returns the response, and we store it in MongoDB.", startedAt: at(answerAt), endedAt: at(answerAt + length), responseLatencyMs: 1800, interrupted: false, phase: "topic", competencyId: topic.id },
  ];
});
const candidateSeqs = turns.filter((turn) => turn.speaker === "candidate").map((turn) => turn.seq);

const competencies = [
  { score: 3, originality: "natural", rationale: "She describes a real feature end to end in her own project, which meets the fair anchor: the backend call to the OpenAI API, the response returned to the frontend and stored in MongoDB, and one concrete problem (slow responses on long prompts) with a fix. She does not cover prompt structure, parameters, streaming or rate limits." },
  { score: 1, originality: "natural", rationale: "She never describes a retrieval step. Asked how to put specific source information in front of the model, she talks about training a model and then a spam classifier, and says she has not done this." },
  { score: 3, originality: "natural", rationale: "She names Express, a concrete route, Passport.js for authentication and MongoDB for storage, and a real design problem (local image storage) solved with Cloudinary. No validation, status codes or error handling." },
  { score: 2, originality: "natural", rationale: "She says plainly that her projects have not been deployed. Keeping keys in a .env file and moving images to Cloudinary lift it above the bottom." },
  { score: 2, originality: "natural", rationale: "She names React and Axios but does not describe what the user sees while waiting or when a request fails." },
].map((item, index) => ({
  competencyId: topics[index].id,
  name: topics[index].name,
  status: "scored" as const,
  score: item.score,
  rationale: item.rationale,
  evidence: [{ turnSeq: candidateSeqs[index * 4], quote: "So actually I have used the OpenAI API in my Sigma GPT project" }],
  gaps: [],
  secondScore: item.score,
  judgesAgree: true,
  dimensions: { relevance: item.score === 1 ? 1 : 4, ownership: item.score + 1 > 5 ? 5 : item.score + 1, correctness: item.score, depth: Math.max(1, item.score - 1) },
  definitionOnly: item.score === 2,
  originality: item.originality as "natural",
}));

const measuresAnswers = answerStarts.map((answerAt, index) => {
  const length = [95, 125, 17, 163, 84, 30, 230, 45, 49, 85, 134, 23, 29, 35, 40, 26, 50, 38, 60, 32, 18][index];
  return {
    turnSeq: candidateSeqs[index],
    start: answerAt,
    end: answerAt + length,
    measuredFrames: length * 15,
    totalFrames: length * 15,
    quality: { brightness: 165, facePx: 143, sharpness: 248, measurable: 1, enhanced: 0 },
    atScreenShare: 0.58,
    spotShare: 0.33,
    medianOffset: [-1.5, -1.4] as [number, number],
    reading: { sweeps: index % 3 === 0 ? 2 : 14, perMinute: index % 3 === 0 ? 2 : 12, direction: 1 },
    lipSync: { correlation: 0.31, lag: 0.07, voicedFrames: 400 },
    multiFaceSeconds: 0,
    phoneSeconds: 0,
    extraPersonSeconds: 0,
    sampledSeconds: length,
    voiceSimilarity: 0.9,
    delivery: null,
  };
});
const spotHeld = candidateSeqs.filter((_, index) => index % 3 !== 2).slice(0, 14);
const readingSeqs = candidateSeqs.filter((_, index) => index % 3 !== 0).slice(0, 13);

export const PREVIEW_DETAIL = {
  session: {
    id: "preview",
    title: "AI Developer",
    candidateName: "Gayathri",
    status: "completed",
    createdAt: "2026-10-28T11:48:35Z",
    expiresAt: null,
    scheduledAt: null,
    reminderSentAt: null,
    uploadToken: null,
    uploadUsedAt: null,
    recruiterName: "Sreemedhas",
    candidateEmail: "candidate@example.com",
    roleTitle: "AI Developer",
    roleId: null,
    difficulty: "medium",
    durationMinutes: 30,
    voiceMode: "standard",
    jobDescription: { source: "text", text: "AI Developer: LLM features, retrieval over company documents, REST APIs, React, Docker and AWS." },
    resume: { fileName: "resume.pdf", text: "Projects: SigmaGPT, Wanderlust, Sentiment analysis." },
    consent: null,
    completedAt: at(1802),
    plan: { version: 1, generatedAt: at(0), source: "llm", model: "preview", roleSummary: "", candidateSummary: "", competencies: topics.map((topic) => ({ ...topic, description: "", question: `Tell me about ${topic.name.toLowerCase()}.`, followUps: [], lookFor: [], resumeProbe: null, anchors: { poor: "", good: "", excellent: "" } })) },
    outcome: { reason: "time_up", endedAt: at(1802), elapsedSeconds: 1802, usage: [], coverage: topics.map((topic, index) => ({ competencyId: topic.id, name: topic.name, status: "covered", startedAtSeconds: 110 + index * 340, endedAtSeconds: 110 + index * 340 + 290, budgetSeconds: topic.minutes * 60, interviewerSummary: null, interviewerEvidence: null, advancedBy: "interviewer" })) },
    decision: null,
  },
  turns,
  events: [],
  scorecard: {
    roomId: "preview",
    generatedAt: at(1900),
    model: "preview",
    transcriptSource: "live",
    summary:
      "Gayathri walked through three student projects: Sigma GPT (an OpenAI API chat app), Wanderlust (an Express listings app with Passport.js login and Cloudinary uploads) and a spam classifier, and does produce concrete detail when pushed on the first two. Her LLM integration answer was the strongest: she traced a request from the React frontend through the Express backend to the OpenAI API and back, and named one real problem, slow responses on long prompts, with the fix she tried. The weakness is depth beyond her own projects: the retrieval question was never answered, she moved to the spam classifier instead, and she says plainly that nothing she built has been deployed. Frontend and backend answers stay at the level of naming tools, with nothing on loading and error states, validation, status codes or how failures reach the user.",
    strengths: [
      "Traced a full request in her own Sigma GPT project, from the React frontend through the Express backend to the OpenAI API, and explained where the response is stored in MongoDB.",
      "Recognised a real LLM failure mode in her own work, slow responses on long prompts, and described the change she made to shorten them.",
      "Kept API keys and the Cloudinary URL in a .env file rather than in source, and could say why that matters.",
      "Explained Passport.js authentication and owner-only edit rights in Wanderlust with a concrete route.",
      "Answered honestly when she had not done something, instead of guessing.",
    ],
    concerns: [
      "The retrieval and grounding question was never answered; she moved to a spam classifier and said she has not built retrieval over documents.",
      "No deployment experience at all: no Docker, no cloud hosting, and no production debugging story.",
      "Frontend answers named React and Axios but said nothing about loading or error states the user would see.",
      "Backend answers never reached validation, status codes or error handling, even when asked directly.",
      "Answers often opened with a textbook definition before any detail of her own work, which cost time.",
    ],
    competencies,
    overallScore: 2.2,
    suggestion: "weak",
    integrity: { tabHiddenCount: 0, tabHiddenSeconds: 0, windowBlurCount: 0, candidateDisconnects: 0, medianResponseLatencyMs: 1800, notes: [] },
    notes: [],
    needsHumanReview: false,
    answerQuality: 44,
    partScores: null,
    ownAnswers: { scored: 5, good: 2, goodOwn: 2 },
    resumeMatch: {
      score: 81,
      reason: null,
      jobFit: [
        { requirement: "LLM API integration", level: "strong", evidence: "SigmaGPT uses the OpenAI API" },
        { requirement: "REST APIs with Node.js", level: "strong", evidence: "Wanderlust, Express routes and auth" },
        { requirement: "React front ends", level: "some", evidence: "SigmaGPT frontend" },
        { requirement: "Retrieval over documents (RAG)", level: "none", evidence: "" },
        { requirement: "Docker and AWS deployment", level: "none", evidence: "" },
        { requirement: "Python", level: "some", evidence: "Sentiment analysis in TensorFlow" },
      ],
      claims: [
        { claim: "CGPA of 8.94", verdict: "confirmed", note: "Stated in her introduction.", turnSeqs: [candidateSeqs[0]] },
        { claim: "Built Wanderlust, a full-stack listings app", verdict: "confirmed", note: "Described listings routes and edit rights.", turnSeqs: [candidateSeqs[6]] },
        { claim: "Authentication with secure routes", verdict: "confirmed", note: "Explained Passport.js checks.", turnSeqs: [candidateSeqs[6]] },
        { claim: "Image uploads in Wanderlust", verdict: "confirmed", note: "Cloudinary upload, URL stored.", turnSeqs: [candidateSeqs[7]] },
        { claim: "Built SigmaGPT with the OpenAI API", verdict: "confirmed", note: "Described the backend call.", turnSeqs: [candidateSeqs[1]] },
        { claim: "Saved chat threads with Mongoose", verdict: "partly_supported", note: "Said responses are stored in MongoDB, nothing on threads.", turnSeqs: [candidateSeqs[1]] },
        { claim: "SigmaGPT frontend in React with Axios", verdict: "partly_supported", note: "Named React and Axios only.", turnSeqs: [candidateSeqs[17]] },
        { claim: "Trained an RNN-LSTM sentiment model", verdict: "partly_supported", note: "Only named the project.", turnSeqs: [candidateSeqs[0]] },
        { claim: "Internship at Skill Desire", verdict: "not_discussed", note: "", turnSeqs: [] },
        { claim: "Proficient in Java", verdict: "not_discussed", note: "", turnSeqs: [] },
      ],
    },
    authenticity: { score: 100, signals: [], status: "checked", reason: null, answers: candidateSeqs.map((seq) => ({ turnSeq: seq, verdict: "natural", reasons: [] })) },
    video: {
      status: "analysed",
      version: 2,
      score: 64,
      attentionPercent: 58,
      moments: [],
      summary: "",
      model: "preview",
      reason: null,
      answers: [],
      pattern: null,
      durationSeconds: 1802,
      measures: {
        fps: 15,
        baseline: { frames: 835, source: "listening", x: 0.06, y: -0.03, sx: 0.07, sy: 0.1 },
        spots: [{ id: 0, x: -0.05, y: -0.23, where: "above and to the left of the screen", distance: 2.66, heldAnswers: spotHeld, listeningShare: 0.1 }],
        answers: measuresAnswers,
        absences: [],
        quality: { brightness: 165, facePx: 143, sharpness: 248, measurable: 1, enhanced: 0 },
        faceSeen: true,
        checks: { audio: true, transcriber: true, voice: true, phone: true },
        partial: false,
        processingSeconds: 743,
      },
    },
    overall: { score: 41, factors: [{ id: "answers", score: 44, weight: 80 }, { id: "resume", score: 81, weight: 20 }] },
    integrityCheck: {
      level: "review",
      summary:
        "In 14 of 21 answers the candidate's eyes kept going back to one spot above and to the left of the screen, and in 13 answers they moved like reading. Watch answers at 4:58 and 12:41 first.",
      summaryBy: "model",
      findings: [
        { kind: "fixed_spot", source: "video", strength: 3, title: "Eyes held on one spot above and to the left of the screen in 14 of 21 answers", detail: "While answering she kept going back to the same place, and hardly looked there while listening.", turnSeqs: spotHeld, atSeconds: 14 },
        { kind: "screen_reading", source: "video", strength: 1, title: "Reading-like eye movement while looking at the screen in 13 answers", detail: "The eyes moved across the same part of the screen line by line.", turnSeqs: readingSeqs, atSeconds: 130 },
      ],
      checks: { ownAnswers: "done", camera: "done", voice: "done", lipSync: "done", browser: "done" },
      limits: [],
    },
  },
  reason: null,
  peers: [
    { roomId: "p1", candidateName: "Pranjul", overall: { score: 60, factors: [] }, decision: null },
    { roomId: "p2", candidateName: "Dharmateja", overall: { score: 46, factors: [] }, decision: null },
    { roomId: "preview", candidateName: "Gayathri", overall: { score: 41, factors: [] }, decision: null },
  ],
  hasRecording: true,
  recordingStartedAt: at(0),
} as unknown as InterviewDetailResponse;
