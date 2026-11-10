import { timingSafeEqual } from "node:crypto";
import { validateRoomAccess } from "@/lib/interviews/interview.service";
import { HrRoom } from "@/components/interview/HrRoom";
import { JoinError } from "@/components/interview/JoinError";

function tokenMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The HR link from the invitation. The token in the URL is the credential, so
 * a wrong or missing one never reaches the call.
 */
export default async function HrInterviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const { roomId } = await params;
  const { token } = await searchParams;
  const supplied = typeof token === "string" ? token : null;

  const result = await validateRoomAccess(roomId);
  if (!result.ok) {
    return <JoinError code={result.code} message={result.message} />;
  }
  if (!result.room.hrToken || !supplied || !tokenMatches(result.room.hrToken, supplied)) {
    return (
      <JoinError
        code="ROOM_NOT_FOUND"
        message="This HR link is not valid for this interview. Ask the recruiter for a new link."
      />
    );
  }

  return (
    <HrRoom
      roomId={result.room.id}
      roomTitle={result.room.title}
      candidateName={result.room.candidateName}
      durationMinutes={result.room.durationMinutes}
      token={supplied}
    />
  );
}
