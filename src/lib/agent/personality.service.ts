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
}): Promise<AgentPersonality> {
  return writePersonality({
    persona: (input.persona ?? "").trim(),
    conduct: (input.conduct ?? "").trim(),
    styles: trimStyles(input.styles ?? {}),
  });
}

/** Clears every override, so the agent goes back to the code's defaults. */
export async function resetAgentPersonality(): Promise<AgentPersonality> {
  return writePersonality({ persona: "", conduct: "", styles: {} });
}
