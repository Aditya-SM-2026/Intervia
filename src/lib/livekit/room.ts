import "server-only";

/**
 * LiveKit room name prefix. MEETINGBOT_ROOM_PREFIX lets a local dev stack
 * isolate its rooms from a deployed agent watching the same LiveKit project
 * (the deployed agent keeps the default "interview-"). Read lazily: the
 * standalone worker loads .env only after its imports are evaluated, so an
 * import-time constant would see a stale (empty) environment.
 */
export function getRoomNamePrefix(): string {
  return process.env.MEETINGBOT_ROOM_PREFIX?.trim() || "interview-";
}

/**
 * LiveKit room name for an interview room. The prefix keeps interview rooms
 * namespaced if other room types are added later.
 */
export function getLiveKitRoomName(roomId: string): string {
  return `${getRoomNamePrefix()}${roomId}`;
}