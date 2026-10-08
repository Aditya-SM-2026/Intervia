import "server-only";

/**
 * LiveKit room name prefix. MEETINGBOT_ROOM_PREFIX lets a local dev stack
 * isolate its rooms from a deployed agent watching the same LiveKit project
 * (the deployed agent keeps the default "interview-").
 */
export const ROOM_NAME_PREFIX =
  process.env.MEETINGBOT_ROOM_PREFIX?.trim() || "interview-";

/**
 * LiveKit room name for an interview room. The prefix keeps interview rooms
 * namespaced if other room types are added later.
 */
export function getLiveKitRoomName(roomId: string): string {
  return `${ROOM_NAME_PREFIX}${roomId}`;
}