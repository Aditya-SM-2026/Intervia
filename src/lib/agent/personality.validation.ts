import { z } from "zod";
import { DIFFICULTIES } from "./personality.types";
import { AGENT_VOICE_IDS } from "./agent-voices";

const MAX_PERSONA = 8000;
const MAX_CONDUCT = 12000;
const MAX_STYLE = 4000;

/** All fields optional: leaving one out keeps the built-in default. */
export const personalityInputSchema = z.object({
  persona: z.string().max(MAX_PERSONA).optional(),
  conduct: z.string().max(MAX_CONDUCT).optional(),
  styles: z
    .object(
      Object.fromEntries(
        DIFFICULTIES.map((difficulty) => [difficulty, z.string().max(MAX_STYLE).optional()]),
      ) as Record<(typeof DIFFICULTIES)[number], z.ZodOptional<z.ZodString>>,
    )
    .partial()
    .optional(),
  /** One of the voices offered in Settings. Left out keeps the current one. */
  voice: z.enum(AGENT_VOICE_IDS).optional(),
  /** Voice engine for new interviews. Left out keeps the current one. */
  voiceMode: z.enum(["standard", "rolling"]).optional(),
});

export type PersonalityInput = z.infer<typeof personalityInputSchema>;
