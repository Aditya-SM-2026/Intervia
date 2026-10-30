import "server-only";
import {
  DIFFICULTIES,
  EMPTY_PERSONALITY,
  type AgentDifficulty,
  type AgentPersonality,
} from "./personality.types";
import {
  readAgentPersonality,
  writePersonality,
} from "@/server/repositories/personality-repository";

/**
 * Read and write the interviewer's personality. Every field is optional: an
 * empty string means "use the built-in default from prompts.py", which is what
 * makes the agent's behaviour unchanged until a recruiter actually writes
 * something here.
 */

/** A read result that says whether the stored settings could be reached. */
export interface PersonalityRead {
  personality: AgentPersonality;
  /** False when the store failed, so the screen can say so instead of crashing. */
  available: boolean;
}

function trimStyles(styles: Partial<Record<AgentDifficulty, string>>): Record<string, string> {
  const cleaned: Record<string, string> = {};
  for (const difficulty of DIFFICULTIES) {
    const value = (styles[difficulty] ?? "").trim();
    if (value) cleaned[difficulty] = value;
  }
  return cleaned;
}

export async function getAgentPersonality(): Promise<AgentPersonality> {
  return readAgentPersonality();
}

/**
 * The settings screen must still render when the database is unreachable (a
 * proxy down, a paused instance): it shows the built-in personality and says
 * the saved one could not be loaded, rather than throwing an error page.
 */
export async function readAgentPersonalityForSettings(): Promise<PersonalityRead> {
  try {
    return { personality: await readAgentPersonality(), available: true };
  } catch (error) {
    console.error(`[agent-settings] could not read settings: ${(error as Error).message}`);
    return { personality: { ...EMPTY_PERSONALITY }, available: false };
  }
}

export async function saveAgentPersonality(input: {
  persona?: string;
  conduct?: string;
  styles?: Partial<Record<AgentDifficulty, string>>;
  voice?: string;
  voiceMode?: AgentPersonality["voiceMode"];
}): Promise<AgentPersonality> {
  // A partial save must not wipe the fields it did not mention: the behaviour
  // page sends text only, the voice page sends a voice only.
  const current = await readAgentPersonality();
  return writePersonality({
    persona: input.persona !== undefined ? input.persona.trim() : current.persona,
    conduct: input.conduct !== undefined ? input.conduct.trim() : current.conduct,
    styles: input.styles !== undefined ? trimStyles(input.styles) : current.styles,
    voice: input.voice !== undefined ? input.voice : current.voice,
    voiceMode: input.voiceMode !== undefined ? input.voiceMode : current.voiceMode,
  });
}

/** Clears every override, so the agent goes back to the code's defaults. */
export async function resetAgentPersonality(): Promise<AgentPersonality> {
  return writePersonality({ persona: "", conduct: "", styles: {}, voice: "", voiceMode: "" });
}
