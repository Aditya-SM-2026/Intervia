import { logActivity } from "@/lib/activity/activity";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/guards";
import {
  getAgentPersonality,
  resetAgentPersonality,
  saveAgentPersonality,
} from "@/lib/agent/personality.service";
import { personalityInputSchema } from "@/lib/agent/personality.validation";

/**
 * The interviewer's personality. GET returns what is set now; PUT saves the
 * override (blank fields fall back to prompts.py); DELETE restores the basic
 * personality by clearing every override.
 *
 * Admin-only: this controls how every live interview behaves and sounds, so a
 * team member cannot read or change it.
 */

function failure(message: string, status: number) {
  return NextResponse.json({ error: { code: "SERVER_ERROR", message } }, { status });
}

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    return NextResponse.json({ personality: await getAgentPersonality() });
  } catch (error) {
    console.error(`[agent-settings] read failed: ${(error as Error).message}`);
    return failure("Could not load the agent settings. Please try again.", 500);
  }
}

export async function PUT(request: NextRequest) {
  const denied = await requireAdmin();
  if (denied) return denied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Expected a JSON body." } },
      { status: 400 },
    );
  }

  const parsed = personalityInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: parsed.error.issues[0]?.message ?? "Invalid settings.",
        },
      },
      { status: 400 },
    );
  }

  try {
    const personality = await saveAgentPersonality(parsed.data);
    await logActivity({ action: "settings.agent_saved", summary: "Saved the interviewer's behaviour and voice", details: { voice: personality.voice } });
    return NextResponse.json({ personality });
  } catch (error) {
    console.error(`[agent-settings] save failed: ${(error as Error).message}`);
    return failure("Could not save the agent settings. Please try again.", 500);
  }
}

export async function DELETE() {
  const denied = await requireAdmin();
  if (denied) return denied;

  try {
    const personality = await resetAgentPersonality();
    await logActivity({ action: "settings.agent_reset", summary: "Restored the interviewer's basic personality" });
    return NextResponse.json({ personality });
  } catch (error) {
    console.error(`[agent-settings] reset failed: ${(error as Error).message}`);
    return failure("Could not restore the basic personality. Please try again.", 500);
  }
}
