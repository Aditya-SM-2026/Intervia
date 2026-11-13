import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { requireAgent } from "@/lib/auth/guards";
import { getInterviewRepository } from "@/server/repositories";

/**
 * Interviews that are happening right now. The predev deploy script asks this
 * before it replaces the agent container: swapping the container mid-call
 * kills the interviewer and loses that interview's audio.
 */
export async function GET(request: NextRequest) {
  const denied = requireAgent(request);
  if (denied) return denied;

  const rooms = await getInterviewRepository().list({ status: ["active"], limit: 50 });
  return NextResponse.json({
    active: rooms.map((room) => ({
      id: room.id,
      title: room.title,
      createdAt: room.createdAt,
      durationMinutes: room.durationMinutes,
    })),
  });
}
