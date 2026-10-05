import "server-only";

export const ROOM_NAME_PREFIX = "interview-";

/**
 * LiveKit room name for an interview room. The prefix keeps interview rooms
 * namespaced if other room types are added later.
 */
export function getLiveKitRoomName(roomId: string): string {
  return `${ROOM_NAME_PREFIX}${roomId}`;
}