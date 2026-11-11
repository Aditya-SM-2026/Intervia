import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRecruiter } from "@/lib/auth/guards";
import { roomIdSchema } from "@/lib/interviews/interview.validation";
import { getInterviewRepository } from "@/server/repositories";
import { AssistantError, askCandidateAssistant } from "@/lib/assistant/service";

export const maxDuration = 60;

type RouteParams = { params: Promise<{ roomId: string }> };

const askSchema = z.object({
  conversationId: z.string().trim().min(8).max(80).nullish(),
  message: z.string().trim().min(2).max(600),
  stream: z.boolean().optional(),
});

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "This interview link is invalid." } },
      { status: 400 },
    );
  }

  const repository = getInterviewRepository();
  const session = await repository.get(roomId);
  if (!session) {
    return NextResponse.json(
      { error: { code: "ROOM_NOT_FOUND", message: "This interview does not exist." } },
      { status: 404 },
    );
  }
  const conversations = await repository.listAssistantConversations(roomId);
  return NextResponse.json({ conversations });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const denied = await requireRecruiter();
  if (denied) return denied;

  const { roomId } = await params;
  if (!roomIdSchema.safeParse(roomId).success) {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "This interview link is invalid." } },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_INPUT", message: "Send a JSON body with a message." } },
      { status: 400 },
    );
  }
  const parsed = askSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "INVALID_INPUT",
          message: "Ask a question between 2 and 600 characters.",
        },
      },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.stream) {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        async start(controller) {
          let open = true;
          const send = (event: string, data: unknown) => {
            if (!open) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
              );
            } catch {
              open = false;
            }
          };

          try {
            const result = await askCandidateAssistant({
              roomId,
              conversationId: parsed.data.conversationId ?? null,
              question: parsed.data.message,
              stream: {
                onDelta: (text) => send("delta", { text }),
                onReset: () => send("reset", {}),
              },
            });
            send("answer", result);
          } catch (error) {
            if (error instanceof AssistantError) {
              send("error", { code: error.code, message: error.message });
            } else {
              console.error(
                `[assistant] stream failed: ${error instanceof Error ? error.message : String(error)}`,
              );
              send("error", {
                code: "SERVER_ERROR",
                message: "The assistant could not answer that. Please try again.",
              });
            }
          } finally {
            open = false;
            controller.close();
          }
        },
      });

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const result = await askCandidateAssistant({
      roomId,
      conversationId: parsed.data.conversationId ?? null,
      question: parsed.data.message,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AssistantError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }
    console.error(
      `[assistant] question failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return NextResponse.json(
      {
        error: {
          code: "SERVER_ERROR",
          message: "The assistant could not answer that. Please try again.",
        },
      },
      { status: 500 },
    );
  }
}
