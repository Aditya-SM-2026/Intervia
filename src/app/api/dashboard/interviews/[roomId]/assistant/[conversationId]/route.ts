import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { getInterviewRepository } from "@/server/repositories";

type RouteParams = { params: Promise<{ roomId: string; conversationId: string }> };

const conversationIdSchema = z.string().trim().min(8).max(80);

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId, conversationId } = await params;
  if (!roomIdSchema.safeParse(roomId).success || !conversationIdSchema.safeParse(conversationId).success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "This conversation link is invalid." } },
      { status: 400 },
    );
  }

  const repository = getInterviewRepository();
  const conversation = await repository.getAssistantConversation(conversationId, roomId);
  if (!conversation) {
    return NextResponse.json(
      { error: { code: "CONVERSATION_NOT_FOUND", message: "This conversation does not exist." } },
      { status: 404 },
    );
  }
  const messages = await repository.getAssistantMessages(conversationId);
  return NextResponse.json({ conversation, messages });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId, conversationId } = await params;
  if (!roomIdSchema.safeParse(roomId).success || !conversationIdSchema.safeParse(conversationId).success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "This conversation link is invalid." } },
      { status: 400 },
    );
  }

  const deleted = await getInterviewRepository().deleteAssistantConversation(
    conversationId,
    roomId,
  );
  if (!deleted) {
    return NextResponse.json(
      { error: { code: "CONVERSATION_NOT_FOUND", message: "This conversation does not exist." } },
      { status: 404 },
    );
  }
  return NextResponse.json({ deleted: true });
}
