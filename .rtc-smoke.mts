import fs from "node:fs";
import { AccessToken } from "livekit-server-sdk";
import { Room, RoomEvent } from "@livekit/rtc-node";

function readEnv(path) {
  const entries = {};
  for (const line of fs.readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    entries[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return entries;
}

async function main() {
  const env = readEnv("C:/Users/Aditya/Desktop/meeting-bot/.env");
  const roomName = `smoke-${Date.now()}`;

  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: "smoke-node-participant",
    ttl: 120,
  });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const jwt = await token.toJwt();

  const room = new Room();
  let sawConnection = false;
  room.on(RoomEvent.Connected, () => {
    sawConnection = true;
  });

  await room.connect(env.LIVEKIT_URL, jwt);
  console.log("connected:", room.isConnected, "| local identity:", room.localParticipant?.info?.identity);
  console.log("Connected event fired:", sawConnection);

  const data = new TextEncoder().encode(JSON.stringify({ hello: "from node" }));
  await room.localParticipant.publishData(data, { reliable: true });
  console.log("publishData: ok");

  await room.disconnect();
  console.log("disconnected cleanly");
}

main().catch((error) => {
  console.error("SMOKE TEST FAILED:", error?.message ?? error);
  process.exit(1);
});