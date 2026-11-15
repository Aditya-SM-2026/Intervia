import { ORGANIZATION_NAME } from "@/lib/brand";
import { validateRoomAccess } from "@/lib/interviews/interview.service";
import { InterviewRoom } from "@/components/interview/InterviewRoom";
import { JoinError } from "@/components/interview/JoinError";

export default async function InterviewPage({
  params,
}: PageProps<"/interview/[roomId]">) {
  const { roomId } = await params;
  const result = await validateRoomAccess(roomId);

  if (!result.ok) {
    return <JoinError code={result.code} message={result.message} finished={result.finished} />;
  }

  return (
    <InterviewRoom
      roomId={result.room.id}
      roomTitle={result.room.title}
      candidateName={result.room.candidateName}
      // Candidates see the organisation, never an internal login name.
      recruiterName={ORGANIZATION_NAME}
      durationMinutes={result.room.durationMinutes}
    />
  );
}