/**
 * The interviewer voices a recruiter can pick in Settings.
 *
 * The UI names are our own. Each one maps to a Gemini Live prebuilt voice,
 * which is what the agent worker actually asks for. The Gemini name is never
 * shown to the recruiter: only the name, the tone and a short description are.
 *
 * The sample text is what the preview button speaks, so a recruiter can hear
 * the voice before choosing it.
 */

export const AGENT_VOICE_IDS = ["mira", "sana", "noah", "liam", "ethan"] as const;
export type AgentVoiceId = (typeof AGENT_VOICE_IDS)[number];

export interface AgentVoiceOption {
  /** Stable id stored in settings and sent by the form. */
  id: AgentVoiceId;
  /** Name the recruiter sees. */
  name: string;
  /** How the voice sounds, in a few words. */
  tone: string;
  gender: "female" | "male";
  description: string;
  /** The Gemini Live prebuilt voice. Internal: never render this. */
  geminiVoice: string;
}

export const VOICE_SAMPLE_TEXT = "Hey, are you ready for the interview?";

export const AGENT_VOICES: readonly AgentVoiceOption[] = [
  {
    id: "mira",
    name: "Mira",
    tone: "Warm & reassuring",
    gender: "female",
    description: "A calm, warm voice that puts candidates at ease in a high-pressure conversation.",
    geminiVoice: "Sulafat",
  },
  {
    id: "sana",
    name: "Sana",
    tone: "Clear & friendly",
    gender: "female",
    description: "Bright and approachable, easy to follow even through long answers.",
    geminiVoice: "Aoede",
  },
  {
    id: "noah",
    name: "Noah",
    tone: "Clear & informative",
    gender: "male",
    description: "Neutral and clearly spoken. The default voice the platform has always used.",
    geminiVoice: "Charon",
  },
  {
    id: "liam",
    name: "Liam",
    tone: "Firm & professional",
    gender: "male",
    description: "Steady and direct, keeps a structured interview moving without sounding cold.",
    geminiVoice: "Orus",
  },
  {
    id: "ethan",
    name: "Ethan",
    tone: "Calm & steady",
    gender: "male",
    description: "Even and unhurried, a low-fatigue choice for longer interviews.",
    geminiVoice: "Schedar",
  },
];

/** The historical default (Charon), so an untouched workspace keeps its voice. */
export const DEFAULT_AGENT_VOICE_ID: AgentVoiceId = "noah";

/** The option for a stored id, falling back to the default. */
export function findAgentVoice(id: string | null | undefined): AgentVoiceOption {
  return AGENT_VOICES.find((voice) => voice.id === id) ?? defaultAgentVoice();
}

export function defaultAgentVoice(): AgentVoiceOption {
  return AGENT_VOICES.find((voice) => voice.id === DEFAULT_AGENT_VOICE_ID)!;
}

/**
 * The Gemini Live voice name for a stored id, or "" when nothing has been
 * chosen so the agent worker keeps its environment default.
 */
export function geminiVoiceFor(id: string | null | undefined): string {
  if (!id) return "";
  return AGENT_VOICES.find((voice) => voice.id === id)?.geminiVoice ?? "";
}
